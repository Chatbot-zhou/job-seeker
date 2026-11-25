"""Job Seeker local API used by the CLI controller and Tampermonkey script."""

from __future__ import annotations

import sys
import asyncio
import re
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from fastapi import Body, FastAPI, File, HTTPException, Query, Request, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, PlainTextResponse
    from fastapi.staticfiles import StaticFiles
except ModuleNotFoundError as exc:
    print("[错误] 缺少 Python 依赖，请先运行: pip install -r requirements.txt", file=sys.stderr)
    raise SystemExit(1) from exc

import database
import greeting_service
import resume_service
from cache import cache, profile_grounding_warnings
from config import Config
from core import SCORING_VERSION, analyze_job
from model_queue import FairModelQueue, ModelQueueCancelled
from model_stream import model_execution_snapshot, model_warmup_check
from runtime_state import probe_ollama_models, runtime_state
from schema import (
    ActionCreate,
    ActionDecision,
    ConfigUpdate,
    ControlUpdate,
    EventCreate,
    GreetingGenerateRequest,
    GreetingUpdate,
    JobAnalyzeRequest,
    ModelSelectRequest,
    ModelTestRequest,
    ProfileUpdate,
    ResumeUpdate,
    ScriptHeartbeat,
    SetupCompleteRequest,
)
from tools import script_connect_hosts

BASE_DIR = Path(__file__).resolve().parent
WEB_SCRIPT_PATH = BASE_DIR / "web_script.js"
UI_DIR = BASE_DIR / "ui"
BOSS_SEARCH_URL = "https://www.zhipin.com/web/geek/jobs"
USERSCRIPT_DEFINITIONS = {
    "boss": {
        "name": "Job Seeker - BOSS",
        "description": "Job Seeker BOSS 直聘通道",
        "matches": ("https://www.zhipin.com/*",),
        "icon": "https://www.google.com/s2/favicons?sz=64&domain=zhipin.com",
        "path": "/userscripts/boss.user.js",
    },
}
MODEL_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="jobseeker-model")
MODEL_QUEUE = FairModelQueue(lambda: int(getattr(Config, "model_max_concurrency", 1)))
MODEL_CONFIG_LOCK = threading.Lock()
MODEL_EXECUTOR_SHUTDOWN = False
ALLOW_REMOTE_API_ENV = "JOB_SEEKER_ALLOW_REMOTE"
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
RATE_LIMIT_WINDOW_SECONDS = 60.0
RATE_LIMIT_BUCKET_TTL_SECONDS = RATE_LIMIT_WINDOW_SECONDS * 2
RATE_LIMIT_RULES = {
    "/jobs/analyze": 20,
    "/greeting/generate": 6,
    "/greeting/variants": 2,
}
RATE_LIMIT_BUCKETS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
RATE_LIMIT_LOCK = threading.Lock()
RATE_LIMIT_LAST_CLEANUP = 0.0
MODEL_SCORE_FAILURE_PAUSE_THRESHOLD = 3
MODEL_SCORE_FAILURE_STREAK = 0
MODEL_SCORE_FAILURE_LOCK = threading.Lock()
VERSION_BLOCK_WARNED: set[tuple[str, str]] = set()
VERSION_BLOCK_LOCK = threading.Lock()


def shutdown_model_executor() -> None:
    global MODEL_EXECUTOR_SHUTDOWN
    if MODEL_EXECUTOR_SHUTDOWN:
        return
    MODEL_EXECUTOR_SHUTDOWN = True
    MODEL_EXECUTOR.shutdown(wait=True, cancel_futures=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Config.load()
    database.init_db()
    migration = database.last_migration_result()
    stale_runs = database.reconcile_stale_runs(stale_minutes=10, exclude_run_id=runtime_state.run_id)
    company_repair = database.repair_invalid_company_names()
    database.upsert_run(runtime_state.run_id, control=runtime_state.control, started_at=runtime_state.run_started_at)
    cleanup = database.prune_old_events(normal_days=7, important_days=30)
    cache.load()
    runtime_state.log("Job Seeker 服务已启动")
    runtime_state.log(f"岗位评分版本: {SCORING_VERSION}")
    if stale_runs.get("count"):
        runtime_state.emit(
            "stale_runs_reconciled",
            f"已将 {stale_runs['count']} 个未正常结束的旧任务标记为 interrupted",
            source="database",
            detail={"count": stale_runs["count"], "stale_minutes": 10},
        )
    if migration.get("compacted_events") or migration.get("sanitized_events"):
        runtime_state.emit(
            "event_compaction_completed",
            f"数据库 v5 整理完成：压缩 {migration.get('compacted_events', 0)} 条重复事件，脱敏 {migration.get('sanitized_events', 0)} 条事件",
            source="database",
            detail=migration,
        )
    if company_repair.get("repaired"):
        runtime_state.log(f"已修复历史错误公司字段 {company_repair['repaired']} 条", source="database")
    if cleanup.get("deleted"):
        runtime_state.log(f"已清理过期运行事件 {cleanup['deleted']} 条", source="database")
    try:
        yield
    finally:
        runtime_state.log("正在关闭服务…")
        database.finish_run(runtime_state.run_id, control=runtime_state.control)
        shutdown_model_executor()
        runtime_state.log("Job Seeker 服务已关闭")


app = FastAPI(title="Job Seeker", version="2026.06-cli", lifespan=lifespan)
if UI_DIR.exists():
    app.mount("/ui", StaticFiles(directory=UI_DIR, html=True), name="ui")


def cors_origins() -> list[str]:
    port = int(Config.server_port)
    return [
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
    ]


def remote_api_allowed() -> bool:
    return os.environ.get(ALLOW_REMOTE_API_ENV, "").strip().lower() in {"1", "true", "yes", "y", "on"}


def is_loopback_client(host: str | None) -> bool:
    host = (host or "").strip().lower()
    if host in LOOPBACK_HOSTS:
        return True
    return host.startswith("127.")


def rate_limit_key(request: Request) -> tuple[str, str]:
    client_host = request.client.host if request.client else "unknown"
    return (client_host, request.url.path)


def cleanup_rate_limit_buckets(now: float) -> None:
    global RATE_LIMIT_LAST_CLEANUP
    if now - RATE_LIMIT_LAST_CLEANUP < RATE_LIMIT_WINDOW_SECONDS:
        return
    RATE_LIMIT_LAST_CLEANUP = now
    for key, bucket in list(RATE_LIMIT_BUCKETS.items()):
        while bucket and now - bucket[0] > RATE_LIMIT_BUCKET_TTL_SECONDS:
            bucket.popleft()
        if not bucket:
            del RATE_LIMIT_BUCKETS[key]


def check_rate_limit(request: Request) -> None:
    limit = RATE_LIMIT_RULES.get(request.url.path)
    if not limit or request.method == "OPTIONS":
        return
    now = time.monotonic()
    with RATE_LIMIT_LOCK:
        cleanup_rate_limit_buckets(now)
        bucket = RATE_LIMIT_BUCKETS[rate_limit_key(request)]
        while bucket and now - bucket[0] > RATE_LIMIT_WINDOW_SECONDS:
            bucket.popleft()
        limited = len(bucket) >= limit
        if not limited:
            bucket.append(now)
    if limited:
        runtime_state.emit(
            "rate_limited",
            f"请求过于频繁: {request.url.path}",
            source="api",
            level="warning",
            detail={"path": request.url.path, "limit_per_minute": limit},
        )
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")


@app.middleware("http")
async def local_api_guard(request: Request, call_next):
    if not remote_api_allowed() and not is_loopback_client(request.client.host if request.client else None):
        runtime_state.emit(
            "remote_api_blocked",
            "已拒绝非本机 API 访问",
            source="api",
            level="warning",
            detail={"client": request.client.host if request.client else ""},
        )
        return JSONResponse(status_code=403, content={"detail": "Job Seeker API 仅允许本机访问"})
    try:
        check_rate_limit(request)
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def expected_userscript_version() -> str:
    try:
        text = WEB_SCRIPT_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""
    match = re.search(r"//\s*@version\s+(\S+)", text)
    return match.group(1).strip() if match else ""


def userscript_version_issue(platform: str = "boss") -> str:
    snapshot = runtime_state.script_snapshot(platform)
    if not snapshot.get("connected") and not snapshot.get("stale"):
        return ""
    detail = snapshot.get("detail") or {}
    reported = str(detail.get("version") or "").strip()
    expected = expected_userscript_version()
    if not reported:
        return "检测到未上报版本的油猴脚本，请更新脚本并刷新 BOSS 页面后再开始"
    if expected and reported != expected:
        return (
            f"检测到旧版油猴脚本（{reported}），当前版本 {expected}。"
            "请执行 script 更新脚本，并在 Tampermonkey 中确认后刷新 BOSS 页面。"
        )
    return ""


def fail(message: str, status_code: int = 400) -> None:
    runtime_state.log(message, level="error")
    raise HTTPException(status_code=status_code, detail=message)


def require_resume() -> str:
    if not cache.resume.strip():
        fail("请先在 CLI 中上传或保存简历")
    return cache.resume


def missing_profile_analysis(reason: str) -> dict[str, Any]:
    return {
        "total_score": 0,
        "skill_score": 0,
        "experience_score": 0,
        "industry_score": 0,
        "location_salary_score": 0,
        "education_score": 0,
        "other_score": 0,
        "risks": [reason],
        "recommendation": "skip",
        "greeting": "",
        "decision_source": "profile_missing",
        "match_reason": reason,
        "blocked_reason": reason,
    }


def update_model_score_failure_streak(analysis: dict[str, Any], job: dict[str, Any]) -> bool:
    """Pause automation when the model is unavailable for several jobs in a row."""
    global MODEL_SCORE_FAILURE_STREAK
    risks = {str(risk) for risk in analysis.get("risks") or []}
    failed = bool(risks.intersection({"模型调用失败", "模型评分格式错误"}))
    model_error_kind = str(analysis.get("model_error_kind") or "")
    threshold = 1 if model_error_kind == "connectivity" else MODEL_SCORE_FAILURE_PAUSE_THRESHOLD
    with MODEL_SCORE_FAILURE_LOCK:
        if failed:
            MODEL_SCORE_FAILURE_STREAK += 1
            streak = MODEL_SCORE_FAILURE_STREAK
        else:
            MODEL_SCORE_FAILURE_STREAK = 0
            return False
    runtime_state.emit(
        "model_score_failure_streak",
        f"模型评分连续失败 {streak}/{threshold}: {job.get('title', '')}",
        source="model",
        level="warning",
        detail={
            "streak": streak,
            "threshold": threshold,
            "platform": str(job.get("platform") or "boss"),
            "model_request_id": str(job.get("model_request_id") or ""),
            "model_error_kind": model_error_kind,
            "job_url": job.get("url", ""),
            "job_title": job.get("title", ""),
            "risks": list(risks),
            "reason": analysis.get("match_reason", ""),
        },
    )
    if streak >= threshold:
        runtime_state.set_control("pause", reason="model_unavailable")
        runtime_state.emit(
            "model_score_degraded_pause",
            "模型评分连续失败，已暂停自动化。请先检查模型服务/API 地址/Key，再继续运行。",
            source="model",
            level="error",
            detail={
                "streak": streak,
                "threshold": threshold,
                "provider": Config.model_provider,
                "model": Config.think_model,
                "platform": str(job.get("platform") or "boss"),
                "model_request_id": str(job.get("model_request_id") or ""),
                "model_error_kind": model_error_kind,
                "last_job_url": job.get("url", ""),
                "last_job_title": job.get("title", ""),
                "reason": analysis.get("match_reason", ""),
            },
        )
        return True
    return False


def script_base_url() -> str:
    return f"http://{Config.server_host}:{Config.server_port}"


def render_userscript(platform: str = "boss") -> str:
    if not WEB_SCRIPT_PATH.exists():
        fail("web_script.js 不存在", 404)
    definition = USERSCRIPT_DEFINITIONS.get(platform)
    if not definition:
        fail("不支持的脚本平台", 404)
    base_url = script_base_url()
    script = WEB_SCRIPT_PATH.read_text(encoding="utf-8")
    script = script.replace("serverHost: 'http://127.0.0.1:33333'", f"serverHost: '{base_url}'")
    lines = script.splitlines()
    connect_hosts = script_connect_hosts(base_url)
    canonical_url = f"{base_url}{definition['path']}"
    rendered_lines: list[str] = []
    inserted_connect = False
    inserted_matches = False
    for line in lines:
        if line.startswith("// @name "):
            rendered_lines.append(f"// @name         {definition['name']}")
            continue
        if line.startswith("// @description"):
            rendered_lines.append(f"// @description  {definition['description']}")
            continue
        if line.startswith("// @match"):
            if not inserted_matches:
                rendered_lines.extend(f"// @match        {match}" for match in definition["matches"])
                inserted_matches = True
            continue
        if line.startswith("// @icon"):
            rendered_lines.append(f"// @icon         {definition['icon']}")
            continue
        if line.startswith("// @updateURL"):
            rendered_lines.append(f"// @updateURL    {canonical_url}")
            continue
        if line.startswith("// @downloadURL"):
            rendered_lines.append(f"// @downloadURL  {canonical_url}")
            continue
        if line.startswith("// @connect"):
            if not inserted_connect:
                rendered_lines.extend(f"// @connect      {host}" for host in connect_hosts)
                inserted_connect = True
            continue
        rendered_lines.append(line)
    return "\n".join(rendered_lines) + ("\n" if script.endswith("\n") else "")


@app.get("/")
async def index():
    return {
        "message": "Job Seeker CLI API is running",
        "health": "/health",
        "status": "/status",
        "userscripts": {
            platform: definition["path"]
            for platform, definition in USERSCRIPT_DEFINITIONS.items()
        },
        "legacy_userscript": "/web_script.user.js",
    }


@app.get("/health", summary="轻量存活检查")
async def health():
    return {"ok": True, "version": app.version}


@app.get("/web_script.user.js", summary="安装或更新篡改猴脚本")
async def web_script_user_js():
    return PlainTextResponse(render_userscript("boss"), media_type="application/javascript; charset=utf-8")


@app.get("/userscripts/boss.user.js", summary="安装或更新 BOSS 篡改猴脚本")
async def boss_userscript():
    return PlainTextResponse(render_userscript("boss"), media_type="application/javascript; charset=utf-8")


@app.get("/status", summary="系统状态")
async def status():
    cache.load()
    result = runtime_state.as_dict(cache.status(), cache.cache_status())
    result["database"] = database.database_stats()
    result["run_summary"] = database.summarize_run(runtime_state.run_id)
    result["model_queue"] = {
        **MODEL_QUEUE.snapshot(),
        "execution_gate": model_execution_snapshot(),
    }
    result["diagnostics"] = {
        "recent_event_counts_24h": database.recent_event_counts(
            24,
            (
                "model_failed",
                "model_score_degraded_pause",
                "model_timeout",
                "search_scroll_target_missing",
                "search_result_scroll_all_targets_failed",
                "loop_failed",
                "backend_unavailable_pause",
                "job_detail_popup_blocked",
            ),
        )
    }
    greeting = greeting_service.get_greeting()
    result["greeting"] = {
        "confirmed": bool(greeting.get("confirmed")),
        "active_name": (greeting.get("active") or {}).get("name") if isinstance(greeting.get("active"), dict) else "",
        "variant_count": len(greeting.get("variants") or []),
    }
    return result


@app.get("/config", summary="读取配置")
async def get_config():
    return {"config": Config.public_dict()}


@app.post("/config", summary="保存配置")
async def save_config(payload: ConfigUpdate):
    Config.save(payload.config)
    cache.load()
    runtime_state.log("配置已保存")
    return {"config": Config.public_dict()}


MODEL_TEST_KEYS = {
    "ollama_host",
    "ollama_model",
    "openai_api_base",
    "openai_api_key",
    "cloud_model",
    "external_model_profile",
    "disable_model_thinking",
}


def model_target_payload() -> dict[str, Any]:
    return {
        "provider": Config.model_provider,
        "model": Config.think_model,
        "ollama_model": Config.ollama_model,
        "cloud_model": Config.cloud_model,
        "ollama_host": Config.ollama_host,
        "openai_api_base": Config.openai_api_base,
        "openai_api_key_configured": bool(str(Config.openai_api_key).strip()),
        "warmup": dict(runtime_state.model_warmup),
    }


@app.get("/model/ollama/models", summary="探测本机 Ollama 模型")
async def model_ollama_models():
    return await asyncio.to_thread(probe_ollama_models, Config.ollama_host)


@app.post("/model/test", summary="测试模型连通性")
async def model_test(payload: ModelTestRequest):
    if runtime_state.control == "running" or int(MODEL_QUEUE.snapshot().get("active") or 0) > 0:
        raise HTTPException(status_code=409, detail="正在运行或评分中，请先暂停后再测试模型")
    if not MODEL_CONFIG_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="模型配置正在切换，请稍候")
    previous = Config.as_dict()
    previous_warmup = dict(runtime_state.model_warmup)
    candidate = {
        key: value
        for key, value in payload.config.items()
        if key in MODEL_TEST_KEYS
        and not (key == "openai_api_key" and str(value).startswith("已配置"))
    }
    try:
        Config.apply({**previous, **candidate, "model_provider": payload.provider})
        warmup = await asyncio.to_thread(model_warmup_check)
        return {
            "ok": warmup.get("status") == "ready",
            "warmup": warmup,
            "target": {
                "provider": Config.model_provider,
                "model": Config.think_model,
            },
        }
    finally:
        Config.apply(previous)
        runtime_state.model_warmup.clear()
        runtime_state.model_warmup.update(previous_warmup)
        MODEL_CONFIG_LOCK.release()


@app.post("/model/select", summary="切换当前模型来源")
async def model_select(payload: ModelSelectRequest):
    if not MODEL_CONFIG_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="模型配置正在切换，请稍候")
    previous = Config.as_dict()
    was_running = (
        runtime_state.control == "running"
        and runtime_state.platform_control("boss") == "running"
    )
    paused_for_switch = False
    resumed = False
    try:
        if payload.provider == Config.model_provider:
            warmup = await asyncio.to_thread(model_warmup_check)
            runtime_state.model_warmup.update(warmup)
            return {
                "config": Config.public_dict(),
                "warmup": warmup,
                "switched": False,
            }
        if was_running and not payload.pause_running:
            raise HTTPException(status_code=409, detail="运行中切换模型需要先暂停 BOSS 通道")
        if was_running:
            runtime_state.set_platform_control("boss", "pause", "切换模型")
            paused_for_switch = True
            await MODEL_QUEUE.cancel_all("切换模型")
            for _ in range(50):
                snapshot = MODEL_QUEUE.snapshot()
                if int(snapshot.get("active") or 0) == 0 and int(snapshot.get("queued") or 0) == 0:
                    break
                await asyncio.sleep(0.2)
            else:
                raise HTTPException(status_code=409, detail="当前仍有评分任务，请稍后再切换模型")
        Config.save({"model_provider": payload.provider})
        warmup = await asyncio.to_thread(model_warmup_check)
        runtime_state.model_warmup.update(warmup)
        if warmup.get("status") != "ready":
            Config.save(previous)
            runtime_state.update_model_warmup(
                "unknown",
                provider=Config.model_provider,
                model=Config.think_model,
                error=f"模型切换失败，已回滚: {warmup.get('error') or '连接检查失败'}",
            )
            raise HTTPException(
                status_code=503,
                detail=f"模型不可用，已保持原模型: {warmup.get('error') or '连接检查失败'}",
            )
        runtime_state.emit(
            "model_switched",
            f"模型已切换到 {Config.model_provider} / {Config.think_model}",
            source="model",
            detail={
                "provider": Config.model_provider,
                "model": Config.think_model,
                "warmup": warmup,
            },
        )
        if paused_for_switch:
            runtime_state.set_platform_control("boss", "resume", "模型切换完成")
            resumed = True
        return {
            "config": Config.public_dict(),
            "warmup": warmup,
            "switched": True,
        }
    finally:
        if paused_for_switch and not resumed:
            runtime_state.set_platform_control("boss", "resume", "模型切换结束")
        MODEL_CONFIG_LOCK.release()


@app.post("/reload-resume", summary="重新加载简历")
async def reload_resume():
    cache.load()
    runtime_state.log("简历已重新加载")
    return resume_service.get_resume()


@app.get("/logs", summary="运行日志")
async def logs(
    limit: int = Query(100, ge=1, le=300),
    level: str = "",
    source: str = "",
    event_type: str = Query("", alias="type"),
):
    items = runtime_state.log_entries()
    if level:
        items = [item for item in items if item.get("level") == level]
    if source:
        items = [item for item in items if item.get("source") == source]
    if event_type:
        items = [item for item in items if item.get("type") == event_type]
    return {"logs": items[:limit]}


@app.post("/events", summary="记录执行事件")
async def create_event(payload: EventCreate):
    event = runtime_state.emit(
        payload.type,
        payload.message,
        source=payload.source,
        level=payload.level,
        detail=payload.detail,
    )
    return event


@app.get("/events", summary="读取执行事件")
async def events(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    return {"events": database.list_events(limit, offset)}


@app.post("/resume/upload-pdf", summary="上传 PDF 简历")
async def upload_resume_pdf(file: UploadFile = File(...)):
    content = await file.read()
    try:
        return resume_service.upload_pdf(file.filename or "resume.pdf", content)
    except Exception as exc:
        fail(str(exc))


@app.get("/resume", summary="读取简历")
async def get_resume():
    return resume_service.get_resume()


@app.put("/resume", summary="保存简历")
async def put_resume(payload: ResumeUpdate):
    return resume_service.save_resume(payload.markdown)


@app.post("/resume/profile/generate", summary="生成简历画像")
async def generate_resume_profile():
    try:
        profile = cache.generate_profile()
        return {
            **profile,
            "grounding_warnings": profile_grounding_warnings(cache.resume, profile.get("user_detail", "")),
        }
    except Exception as exc:
        runtime_state.set_task("idle")
        fail(str(exc))


@app.get("/resume/profile", summary="读取简历画像")
async def get_resume_profile():
    cache.load()
    return {
        "tags": cache.tags,
        "user_detail": cache.user_detail,
        "status": cache.cache_status(),
        "grounding_warnings": profile_grounding_warnings(cache.resume, cache.user_detail),
    }


@app.put("/resume/profile", summary="保存简历画像")
async def put_resume_profile(payload: ProfileUpdate):
    cache.load()
    tags = [str(tag).strip() for tag in payload.tags if str(tag).strip()]
    user_detail = str(payload.user_detail or "").strip()
    if not tags and not user_detail:
        fail("请至少提供岗位标签或用户详情")
    try:
        if tags:
            cache.save_tags("\n".join(tags))
        if user_detail:
            cache.save_user_detail(user_detail)
    except Exception as exc:
        fail(str(exc))
    return {
        "tags": cache.tags,
        "user_detail": cache.user_detail,
        "status": cache.cache_status(),
        "grounding_warnings": profile_grounding_warnings(cache.resume, cache.user_detail),
    }


@app.post("/greeting/generate", summary="生成打招呼草稿")
async def generate_greeting(payload: GreetingGenerateRequest):
    try:
        return greeting_service.generate_greeting(payload.style)
    except Exception as exc:
        runtime_state.set_task("idle")
        fail(str(exc))


@app.get("/greeting", summary="读取打招呼用语")
async def get_greeting():
    return greeting_service.get_greeting()


@app.put("/greeting", summary="保存打招呼用语")
async def put_greeting(payload: GreetingUpdate):
    try:
        greeting_service.save_greeting(payload.content, payload.name)
        return greeting_service.get_greeting()
    except Exception as exc:
        fail(str(exc))


@app.post("/greeting/variants", summary="生成多个打招呼变体")
async def greeting_variants():
    try:
        return greeting_service.generate_variants()
    except Exception as exc:
        runtime_state.set_task("idle")
        fail(str(exc))


@app.get("/setup/status", summary="首次配置状态")
async def setup_status():
    cache.load()
    greeting = greeting_service.get_greeting()
    cache_status = cache.cache_status()
    script = runtime_state.script_snapshot()
    detail = script.get("detail") or {}
    data_paths = (
        Config.resume_name,
        Config.profile_cache_name,
        Config.greeting_cache_name,
    )
    has_existing_data = any(Path(path).exists() for path in data_paths) or int(
        database.database_stats().get("job_count") or 0
    ) > 0
    tags = cache.tags
    return {
        "onboarding_completed": bool(Config.onboarding_completed),
        "has_existing_data": has_existing_data,
        "boss_enabled": bool(Config.boss_enabled),
        "resume_saved": bool(cache.resume.strip()),
        "resume_uploaded": bool(cache.status().get("uploaded")),
        "profile_generated": bool(cache_status.get("profile_generated")),
        "tags_count": len(tags),
        "tags": tags,
        "user_detail_saved": bool(cache.user_detail.strip()),
        "greeting_confirmed": bool(greeting.get("confirmed")),
        "greeting_mode": Config.greeting_mode,
        "model": model_target_payload(),
        "script": {
            "connected": bool(script.get("connected")),
            "stale": bool(script.get("stale")),
            "page": script.get("page") or "",
            "version": str(detail.get("version") or ""),
        },
        "boss_url": BOSS_SEARCH_URL,
        "userscript_url": f"{script_base_url()}/userscripts/boss.user.js",
        "setup_ready": bool(
            cache.resume.strip()
            and cache_status.get("profile_generated")
            and tags
            and (Config.greeting_mode == "boss_native" or bool(greeting.get("confirmed")))
        ),
    }


@app.post("/setup/backup", summary="重新配置前备份现有数据")
async def setup_backup():
    from cli_console import create_backup

    path = await asyncio.to_thread(create_backup)
    return {"path": str(path)}


@app.post("/setup/complete", summary="完成首次配置")
async def setup_complete(payload: SetupCompleteRequest):
    Config.save({"onboarding_completed": bool(payload.completed)})
    runtime_state.emit(
        "onboarding_completed",
        "首次配置已完成" if payload.completed else "首次配置已重置",
        source="config",
    )
    return {"config": Config.public_dict()}


@app.post("/script/heartbeat", summary="脚本心跳")
async def script_heartbeat(payload: ScriptHeartbeat):
    runtime_state.update_script(
        payload.page,
        payload.status,
        payload.current_action,
        payload.detail,
        platform=payload.platform,
        instance_id=payload.instance_id,
        page_kind=payload.page_kind,
    )
    if payload.status == "error":
        runtime_state.log(payload.current_action or "脚本上报错误", level="error", source="script")
    response = runtime_state.control_payload(payload.platform)
    expected_version = expected_userscript_version()
    reported_version = str(payload.detail.get("version") or "").strip()
    page_kind = str(payload.page_kind or payload.page or "").strip().lower()
    is_controller = page_kind in {"", "search", "search_standby"}
    # 详情页/聊天页由控制器页面派生，通常不上报 version；只有明确上报旧版本时才拦截。
    version_mismatch = bool(expected_version) and (
        reported_version != expected_version if is_controller
        else bool(reported_version and reported_version != expected_version)
    )
    if version_mismatch:
        # 旧脚本即使在后端运行中重新连接，也只收到暂停指令，避免执行过时逻辑。
        response.update(
            {
                "control": "paused",
                "should_start": False,
                "should_pause": True,
                "should_stop": False,
                "platform_control": "paused",
                "message": f"油猴脚本版本不匹配（{reported_version or '未上报'}），请更新到 {expected_version} 并刷新 BOSS 页面",
            }
        )
        warn_key = (payload.instance_id, reported_version)
        with VERSION_BLOCK_LOCK:
            should_warn = warn_key not in VERSION_BLOCK_WARNED
            if should_warn:
                VERSION_BLOCK_WARNED.add(warn_key)
        if should_warn:
            runtime_state.emit(
                "userscript_version_blocked",
                response["message"],
                source="script",
                level="warning",
                detail={
                    "reported_version": reported_version,
                    "expected_version": expected_version,
                    "instance_id": payload.instance_id,
                },
            )
    response.update(
        {
            "ok": True,
            "config": Config.public_dict(),
            "model_queue": {
                **MODEL_QUEUE.snapshot(),
                "execution_gate": model_execution_snapshot(),
            },
        }
    )
    return response


@app.post("/control", summary="开始/暂停/继续/停止")
async def control(payload: ControlUpdate):
    if payload.command == "start":
        platform = str(payload.platform or "boss")
        cache.load()
        if not bool(getattr(Config, f"{platform}_enabled", True)):
            raise HTTPException(status_code=409, detail=f"{platform} 通道未启用")
        version_issue = userscript_version_issue(platform)
        if version_issue:
            raise HTTPException(status_code=409, detail=version_issue)
        if not cache.user_detail.strip():
            raise HTTPException(status_code=409, detail="请先在 CLI 完成简历画像与用户详情配置")
        if platform == "boss":
            greeting = greeting_service.get_greeting()
            if not cache.tags:
                raise HTTPException(status_code=409, detail="BOSS 岗位标签为空，请先完成标签配置")
            if Config.greeting_mode != "boss_native" and not greeting.get("confirmed"):
                raise HTTPException(status_code=409, detail="BOSS 自定义打招呼话术尚未确认")
        if runtime_state.control != "running":
            loop = asyncio.get_running_loop()
            warmup = await loop.run_in_executor(MODEL_EXECUTOR, model_warmup_check)
            runtime_state.model_warmup.update(warmup)
            if warmup.get("status") != "ready":
                runtime_state.set_control(
                    "pause",
                    reason=f"model_unavailable: {warmup.get('error') or '模型检查失败'}",
                )
                raise HTTPException(
                    status_code=503,
                    detail=f"模型尚未就绪: {warmup.get('error') or '连接检查失败'}",
                )
            runtime_state.set_control(
                "resume",
                new_run=True,
                reason=payload.reason or "网页控制面板开始运行",
            )
        runtime_state.set_platform_control(
            platform,
            "resume",
            payload.reason or "网页控制面板开始运行",
        )
        return runtime_state.control_payload(platform)
    if payload.platform:
        runtime_state.set_platform_control(payload.platform, payload.command, payload.reason)
        if payload.command in {"pause", "stop"}:
            await MODEL_QUEUE.cancel_platform(payload.platform, payload.reason or f"{payload.platform} 已{payload.command}")
        return runtime_state.control_payload(payload.platform)
    runtime_state.set_control(payload.command, new_run=payload.new_run, reason=payload.reason)
    if payload.command in {"pause", "stop"}:
        await MODEL_QUEUE.cancel_all("全局任务已暂停或停止")
    return runtime_state.control_payload()


@app.post("/jobs/analyze", summary="结构化职位分析")
async def jobs_analyze(payload: JobAnalyzeRequest):
    cache.load()
    job = payload.model_dump()
    platform = str(job.get("platform") or "boss")
    platform_generation = runtime_state.platform_generation(platform)
    job["identity_key"] = database.normalize_job_identity(job.get("company", ""), job.get("title", ""))
    existing_job = database.get_job(job.get("url", ""))
    same_platform_job = database.get_job_by_identity(
        job.get("identity_key", ""),
        platform=platform,
    )
    same_platform_duplicate = bool(
        same_platform_job
        and str(same_platform_job.get("url") or "") != str(job.get("url") or "")
    )
    blocked_reason = blocked_by_history(job, existing_job, same_platform_job)
    final_action = "already_contacted" if job.get("talked") else ""
    if blocked_reason:
        analysis = {
            "total_score": 0,
            "skill_score": 0,
            "experience_score": 0,
            "industry_score": 0,
            "location_salary_score": 0,
            "education_score": 0,
            "other_score": 0,
            "risks": [blocked_reason],
            "recommendation": "skip",
            "greeting": "",
            "decision_source": "history_or_config",
            "match_reason": blocked_reason,
            "blocked_reason": blocked_reason,
        }
    elif runtime_state.platform_control(platform) != "running":
        analysis = missing_profile_analysis("平台当前处于暂停或停止状态")
        analysis["platform_action"] = "skip"
    elif not cache.user_detail.strip():
        analysis = missing_profile_analysis("请先生成并确认用户详情")
    else:
        greeting = greeting_service.get_greeting() if platform == "boss" else {}
        confirmed_greeting = greeting.get("active_content", "") if greeting.get("confirmed") else ""
        model_request_id = f"analysis-{uuid.uuid4().hex[:12]}"
        job["model_request_id"] = model_request_id
        runtime_state.emit(
            "model_queue_enqueued",
            f"岗位评分已进入模型队列: {platform} / {job.get('title', '')}",
            source="model",
            detail={
                "platform": platform,
                "model_request_id": model_request_id,
                "external_job_id": str(job.get("external_job_id") or ""),
                "job_title": str(job.get("title") or ""),
                "queue": MODEL_QUEUE.snapshot(),
            },
        )
        try:
            analysis = await MODEL_QUEUE.run(
                platform,
                MODEL_EXECUTOR,
                analyze_job,
                job,
                cache.user_detail,
                confirmed_greeting,
                cache.profile,
            )
            runtime_state.emit(
                "model_queue_completed",
                f"岗位评分已离开模型队列: {platform} / {job.get('title', '')}",
                source="model",
                detail={
                    "platform": platform,
                    "model_request_id": model_request_id,
                    "external_job_id": str(job.get("external_job_id") or ""),
                    "job_title": str(job.get("title") or ""),
                },
            )
        except ModelQueueCancelled as exc:
            runtime_state.emit(
                "model_queue_cancelled",
                f"岗位评分排队已取消: {platform} / {job.get('title', '')}",
                source="model",
                level="warning",
                detail={
                    "platform": platform,
                    "model_request_id": model_request_id,
                    "job_title": str(job.get("title") or ""),
                    "reason": str(exc),
                },
            )
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except RuntimeError as exc:
            if "cannot schedule new futures" in str(exc) or "shutdown" in str(exc).lower():
                runtime_state.log("服务正在关闭，跳过当前分析任务", source="model", level="warn")
                analysis = missing_profile_analysis("服务关闭中，分析被中断")
            else:
                raise
        model_globally_paused = update_model_score_failure_streak(analysis, job)
        if model_globally_paused:
            await MODEL_QUEUE.cancel_all("模型评分连续失败，已全局暂停")
        if analysis.get("total_score", 0) <= 0 and analysis.get("risks"):
            final_action = final_action or "model_failed_skip"
        if (
            runtime_state.platform_control(platform) != "running"
            or runtime_state.platform_generation(platform) != platform_generation
        ):
            analysis["platform_action"] = "skip"
            analysis["blocked_reason"] = "平台已暂停，评分结果已作废"
            analysis["match_reason"] = "平台已暂停，评分结果已作废"
        else:
            analysis["platform_action"] = (
                "greet" if analysis.get("recommendation") == "greet" else "skip"
            )
    if "platform_action" not in analysis:
        analysis["platform_action"] = "skip"
    analysis.setdefault("scoring_version", SCORING_VERSION)
    analysis.setdefault(
        "score_breakdown",
        {
            "education": int(analysis.get("education_score") or 0),
            "skill": int(analysis.get("skill_score") or 0),
            "experience": int(analysis.get("experience_score") or 0),
        },
    )
    analysis.setdefault("model_error_kind", "")
    if (
        not blocked_reason
        and not analysis.get("blocked_reason")
        and not final_action
        and analysis.get("platform_action") == "skip"
    ):
        final_action = "skipped"
    job["run_id"] = runtime_state.run_id
    reuse_same_platform_history = bool(
        blocked_reason
        and (
            (same_platform_duplicate and blocked_reason.startswith("同平台同公司同职位"))
            or (
                existing_job
                and str(existing_job.get("url") or "") == str(job.get("url") or "")
                and (existing_job.get("greeted") or recently_processed(existing_job))
            )
        )
    )
    if reuse_same_platform_history:
        saved_job = (
            same_platform_job
            if same_platform_duplicate
            else existing_job
        ) or {}
        runtime_state.emit(
            "same_platform_duplicate_skipped",
            f"同平台重复岗位已跳过: {platform} / {job.get('title', '')}",
            source="job",
            detail={
                "platform": platform,
                "external_job_id": str(job.get("external_job_id") or ""),
                "title": str(job.get("title") or ""),
                "company": str(job.get("company") or ""),
                "identity_key": str(job.get("identity_key") or ""),
                "reason": blocked_reason,
            },
        )
    else:
        saved_job = database.upsert_job(job, analysis, final_action=final_action)
    if job.get("talked"):
        saved_job = database.update_job_status(job.get("url", ""), final_action="already_contacted", greeted=True) or saved_job
    runtime_state.emit(
        "job_analyzed",
        f"职位已分析: {payload.company} {payload.title}",
        source="job",
        detail={
            "platform": platform,
            "job_id": str(
                job.get("external_job_id")
                or database.fallback_job_identity(platform, "", job.get("url", ""))
            ),
            "title": str(job.get("title") or ""),
            "company": str(job.get("company") or ""),
            "education_score": int(analysis.get("education_score") or 0),
            "skill_score": int(analysis.get("skill_score") or 0),
            "experience_score": int(analysis.get("experience_score") or 0),
            "total_score": int(analysis.get("total_score") or 0),
            "decision": analysis.get("platform_action", "skip"),
        },
    )
    return {"analysis": analysis, "job": saved_job}


@app.post("/actions", summary="创建待执行动作")
async def create_action(payload: ActionCreate):
    action_data = payload.model_dump()
    action_data["run_id"] = runtime_state.run_id
    if payload.job_url and not database.get_job(payload.job_url):
        database.upsert_job(
            {
                "url": payload.job_url,
                "title": payload.title,
                "company": payload.company,
                "platform": payload.platform,
                "external_job_id": payload.external_job_id,
                "run_id": runtime_state.run_id,
            }
        )
    action = database.create_action(action_data)
    if payload.action_type in {"greet", "send_greeting"} and payload.status in {"completed", "approved"}:
        database.update_job_status(payload.job_url, final_action="greeted", greeted=True)
    if payload.action_type == "already_contacted" and payload.status in {"completed", "approved"}:
        database.update_job_status(payload.job_url, final_action="already_contacted", greeted=True)
    runtime_state.log(f"动作已创建: {payload.action_type}", source="action")
    return action


@app.get("/actions/pending", summary="读取待确认动作")
async def pending_actions():
    return {"actions": database.list_pending_actions()}


@app.get("/actions/{action_id}", summary="读取动作")
async def get_action(action_id: int):
    action = database.get_action(action_id)
    if not action:
        fail("动作不存在", 404)
    return action


@app.post("/actions/{action_id}/approve", summary="批准动作")
async def approve_action(action_id: int, payload: ActionDecision):
    action = database.update_action(action_id, "approved", payload.note)
    runtime_state.log(f"动作已批准: {action_id}", source="action")
    return action


@app.post("/actions/{action_id}/reject", summary="拒绝动作")
async def reject_action(action_id: int, payload: ActionDecision):
    action = database.update_action(action_id, "rejected", payload.note)
    runtime_state.log(f"动作已拒绝: {action_id}", source="action")
    return action


@app.get("/history", summary="历史记录")
async def history(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    return database.list_history(limit, offset)


@app.get("/jobs/recent", summary="读取近期已处理职位")
async def recent_jobs(
    limit: int = Query(500, ge=1, le=1000),
    hours: int = Query(24, ge=1, le=168),
    platform: str = Query("", pattern="^$|^boss$"),
):
    return {
        "jobs": database.list_recent_processed_jobs(
            limit,
            hours,
            platform=platform,
        )
    }


@app.get("/tags", summary="获取职位标签")
async def get_tags():
    cache.load()
    return {"tags": cache.tags}


@app.get("/get-introduce", summary="获取已确认打招呼用语")
async def get_introduce():
    greeting = greeting_service.get_greeting()
    return {"introduce": greeting["active_content"] if greeting.get("confirmed") else ""}


def blocked_by_history(
    job: dict[str, Any],
    existing_job: dict[str, Any] | None,
    same_platform_job: dict[str, Any] | None = None,
) -> str:
    platform = str(job.get("platform") or "boss")
    if existing_job and existing_job.get("greeted"):
        return "同平台该职位已完成操作，跳过重复处理"
    if existing_job and recently_processed(existing_job):
        action = existing_job.get("final_action") or existing_job.get("recommendation") or "已处理"
        return f"同平台该职位近期已处理，跳过重复评分: {action}"
    identity_key = str(job.get("identity_key") or "")
    if same_platform_job is None and identity_key:
        same_platform_job = database.get_job_by_identity(identity_key, platform=platform)
    same_platform_is_other_url = bool(
        same_platform_job
        and str(same_platform_job.get("url") or "") != str(job.get("url") or "")
    )
    same_platform_terminal = bool(same_platform_job and same_platform_job.get("greeted"))
    if (
        same_platform_is_other_url
        and same_platform_job
        and (same_platform_terminal or recently_processed(same_platform_job))
    ):
        action = same_platform_job.get("final_action") or same_platform_job.get("recommendation") or "已处理"
        return f"同平台同公司同职位近期已处理，跳过重复操作: {action}"
    if not Config.skip_contacted_companies:
        return ""
    if job.get("talked"):
        return job.get("talked_reason") or "页面显示该职位已沟通，跳过重复联系"
    company = job.get("company", "")
    if company and database.count_greeted_company(company, platform="boss") >= int(Config.max_contacts_per_company):
        return f"公司已达到联系上限: {company}"
    return ""


def recently_processed(job: dict[str, Any], hours: int = 24) -> bool:
    updated_at = job.get("updated_at")
    if not updated_at:
        return False
    try:
        age_seconds = (datetime.now(timezone.utc) - datetime.fromisoformat(updated_at)).total_seconds()
    except (TypeError, ValueError):
        return False
    if age_seconds > hours * 3600:
        return False
    return bool(job.get("recommendation") or job.get("final_action") or job.get("error"))


def run_api_only() -> int:
    try:
        import uvicorn
    except ModuleNotFoundError:
        print("[错误] 缺少 Python 依赖 uvicorn，请先运行: pip install -r requirements.txt", file=sys.stderr)
        return 2
    Config.load()
    uvicorn.run(app, host=Config.server_host, port=int(Config.server_port), log_level="info")
    return 0


def print_usage() -> None:
    print(
        "\n".join(
            [
                "Job Seeker 本地求职辅助工具",
                "",
                "用法:",
                "  python main.py              启动人工 CLI",
                "  python main.py ui           启动 Web 控制台（推荐）",
                "  python main.py serve        只启动本地 API 服务",
                "  python main.py autorun      使用已保存配置自动运行",
                "  python main.py --help       显示本帮助",
                "",
                "推荐入口:",
                "  start_all.bat               启动 BOSS 通道并打开 Web 控制台",
                "  start_boss.bat              只启动 BOSS 并打开 Web 控制台",
            ]
        )
    )


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in {"-h", "--help", "help"}:
        print_usage()
        raise SystemExit(0)
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        raise SystemExit(run_api_only())
    if len(sys.argv) > 1 and sys.argv[1] in {"agent", "mcp"}:
        print(
            "[Job Seeker] 请使用 start_all.bat 或 start_boss.bat 启动，"
            "然后在网页面板控制运行。"
        )
        raise SystemExit(2)
    from cli_console import run_autorun, run_cli, run_ui

    if len(sys.argv) > 1 and sys.argv[1] == "ui":
        raise SystemExit(run_ui(app, shutdown_callback=shutdown_model_executor) or 0)
    if len(sys.argv) > 1 and sys.argv[1] == "autorun":
        raise SystemExit(run_autorun(app, shutdown_callback=shutdown_model_executor))
    if len(sys.argv) > 1:
        print(f"[Job Seeker] 未知命令: {sys.argv[1]}")
        print_usage()
        raise SystemExit(2)
    run_cli(app, shutdown_callback=shutdown_model_executor)
