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
    try:
        raw = stream_ollama_chat(
            f"生成打招呼草稿: {style}",
            [
                {"role": "system", "content": GREETING},
                {"role": "user", "content": prompt},
            ],
            model=Config.think_model,
            options={"temperature": 0.4, "num_ctx": 10240},
        )
    finally:
        runtime_state.set_task("idle")
    content = extract_llm_reply(raw).replace("\n", " ").strip()
    runtime_state.log(f"已生成打招呼草稿: {style}")
    return {
        "style": style,
        "content": content,
        "privacy_findings": detect_privacy(content),
        "confirmed": False,
    }


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
