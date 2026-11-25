from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from cache import cache
from config import Config, ensure_data_dirs
from model_stream import stream_ollama_chat
from prompts import GREETING
from runtime_state import runtime_state
from tools import detect_privacy, extract_llm_reply, now_iso, redact_privacy


def _path() -> Path:
    ensure_data_dirs()
    return Path(Config.greeting_cache_name)


def _load() -> dict[str, Any]:
    path = _path()
    if not path.exists():
        return {"active": None, "variants": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("active", None)
            data.setdefault("variants", [])
            return data
    except json.JSONDecodeError:
        pass
    return {"active": None, "variants": []}


def _save(data: dict[str, Any]) -> dict[str, Any]:
    _path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def get_greeting() -> dict[str, Any]:
    data = _load()
    active = data.get("active")
    return {
        "active": active,
        "active_content": active.get("content") if isinstance(active, dict) else "",
        "confirmed": isinstance(active, dict) and bool(active.get("content")),
        "variants": data.get("variants", []),
    }


def save_greeting(content: str, name: str = "默认话术") -> dict[str, Any]:
    if not content.strip():
        raise ValueError("打招呼用语不能为空")
    findings = detect_privacy(content)
    if findings:
        raise ValueError("打招呼用语包含隐私信息，请修改后保存")
    data = _load()
    active = {
        "id": f"greeting-{int(datetime.now().timestamp())}",
        "name": name,
        "content": content.strip(),
        "updated_at": now_iso(),
    }
    data["active"] = active
    variants = data.setdefault("variants", [])
    variants.insert(0, active)
    data["variants"] = variants[:20]
    runtime_state.log("打招呼用语已保存")
    return _save(data)


def _generate_greeting_raw(
    style: str,
    prompt: str,
    options: dict[str, Any],
    attempt: int,
    system_prompt: str = GREETING,
) -> str:
    """单次打招呼生成，返回提取后的文本。"""
    label = f"生成打招呼草稿: {style}" if attempt == 1 else f"生成打招呼草稿: {style} (重试{attempt})"
    raw = stream_ollama_chat(
        label,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        model=Config.think_model,
        options=options,
    )
    return extract_llm_reply(raw).replace("\n", " ").strip()


GREETING_MAX_CHARS = 80


def _fit_greeting_length(
    style: str,
    content: str,
    prompt: str,
    options: dict[str, Any],
) -> str:
    """Enforce the 80-character limit with one strict rewrite, then a safe trim."""
    if not content or len(content) <= GREETING_MAX_CHARS:
        return content
    strict_system = (
        GREETING
        + "\n\n# 长度修正（最高优先级）\n"
        + f"上一条输出为 {len(content)} 字，超过 80 字硬限制。请只输出一条 60-80 字的全新消息，"
        + "只保留一个项目和一个最关键成果，不要解释，不要换行。"
    )
    retry = _generate_greeting_raw(
        style,
        prompt,
        {**options, "temperature": 0.2, "top_p": 0.3},
        4,
        system_prompt=strict_system,
    )
    if retry and len(retry) <= GREETING_MAX_CHARS:
        return retry
    cut = content[:GREETING_MAX_CHARS]
    boundary = max(
        cut.rfind(mark) for mark in ("。", "！", "？", "；", "，")
    )
    return cut[: boundary + 1].strip() if boundary >= 30 else cut.strip()


def generate_greeting(style: str = "default") -> dict[str, Any]:
    cache.load()
    if not cache.user_detail.strip():
        raise ValueError("请先生成并确认用户详情")
    runtime_state.set_task("generating_greeting")
    prompt = f"""
风格: {style}

# 用户详情
{redact_privacy(cache.user_detail)}
""".strip()

    base_options: dict[str, Any] = {
        "temperature": 0.4,
        "num_ctx": 10240,
        "num_predict": -1,  # 不限制令牌数，让模型自由输出
        "think": not bool(Config.disable_model_thinking),
    }

    try:
        # 第 1 次：遵循当前全局思考策略。
        content = _generate_greeting_raw(style, prompt, base_options, 1)
        if content:
            content = _fit_greeting_length(style, content, prompt, base_options)
            runtime_state.log(f"已生成打招呼草稿: {style}")
            return {
                "style": style,
                "content": content,
                "privacy_findings": detect_privacy(content),
                "confirmed": False,
            }

        # 第 2 次：仍遵循当前思考策略，只调高温度。
        runtime_state.log(f"打招呼第1次无输出，第2次重试（调高温度）…", source="model")
        options_2 = dict(base_options, temperature=0.6)
        content = _generate_greeting_raw(style, prompt, options_2, 2)
        if content:
            content = _fit_greeting_length(style, content, prompt, options_2)
            runtime_state.log(f"已生成打招呼草稿: {style}")
            return {
                "style": style,
                "content": content,
                "privacy_findings": detect_privacy(content),
                "confirmed": False,
            }

        # 第 3 次：如果全局关闭思考，最后一次开启思考兜底。
        if Config.disable_model_thinking:
            runtime_state.log("打招呼第2次仍无输出，第3次重试（开启思考兜底）…", source="model")
            options_3 = dict(base_options, temperature=0.6, top_p=0.9, think=True)
        else:
            runtime_state.log("打招呼第2次仍无输出，第3次重试（调高温度+top_p）…", source="model")
            options_3 = dict(base_options, temperature=0.7, top_p=0.9)
        content = _generate_greeting_raw(style, prompt, options_3, 3)
        if content:
            content = _fit_greeting_length(style, content, prompt, options_3)
        runtime_state.log(f"已生成打招呼草稿: {style}")
        return {
            "style": style,
            "content": content,
            "privacy_findings": detect_privacy(content),
            "confirmed": False,
        }
    finally:
        runtime_state.set_task("idle")


def generate_variants() -> dict[str, Any]:
    styles = ["简洁版", "热情版", "技术突出版", "业务匹配版"]
    variants = [generate_greeting(style) for style in styles]
    data = _load()
    stored = [
        {
            "id": f"draft-{idx}-{int(datetime.now().timestamp())}",
            "name": item["style"],
            "content": item["content"],
            "updated_at": now_iso(),
            "draft": True,
        }
        for idx, item in enumerate(variants)
    ]
    data["variants"] = stored + data.get("variants", [])
    data["variants"] = data["variants"][:20]
    _save(data)
    return {"variants": variants}
