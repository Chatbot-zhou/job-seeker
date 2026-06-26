"""
Application configuration.

The class keeps the old ``Config.think_model`` style access so existing code can
continue to import it, while the values now live in ``data/config.json``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RESUME_DIR = DATA_DIR / "resume"
CACHE_DIR = DATA_DIR / "cache"
CONFIG_PATH = DATA_DIR / "config.json"
CONFIG_WAS_MISSING = not CONFIG_PATH.exists()


DEFAULT_CONFIG: dict[str, Any] = {
    "server_host": "127.0.0.1",
    "server_port": 33333,
    "model_provider": "ollama",
    "ollama_host": "http://127.0.0.1:11434",
    "openai_api_base": "https://api.openai.com/v1",
    "openai_api_key": "",
    "think_model": "qwen3:4b",
    "score_threshold": 70,
    "daily_greet_limit": 50,
    "max_contacts_per_company": 1,
    "automation_mode": "auto",
    "skip_contacted_companies": True,
    "job_detail_max_chars": 1600,
    "log_verbosity": "compact",
    "show_model_reasoning": False,
    "blacklist_companies": [],
    "blacklist_keywords": [],
    "target_cities": [],
    "job_keywords": [],
}


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    RESUME_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on", "是", "显示"}
    return bool(value)


class Config:
    resume_name = str(RESUME_DIR / "resume.md")
    extracted_resume_name = str(RESUME_DIR / "extracted.txt")
    original_resume_pdf_name = str(RESUME_DIR / "original.pdf")
    profile_cache_name = str(CACHE_DIR / "profile.json")
    user_detail_name = str(CACHE_DIR / "user_detail.md")
    greeting_cache_name = str(CACHE_DIR / "greeting.json")
    app_db_name = str(DATA_DIR / "app.db")

    server_host = DEFAULT_CONFIG["server_host"]
    server_port = DEFAULT_CONFIG["server_port"]
    model_provider = DEFAULT_CONFIG["model_provider"]
    ollama_host = DEFAULT_CONFIG["ollama_host"]
    openai_api_base = DEFAULT_CONFIG["openai_api_base"]
    openai_api_key = DEFAULT_CONFIG["openai_api_key"]
    think_model = DEFAULT_CONFIG["think_model"]
    score_threshold = DEFAULT_CONFIG["score_threshold"]
    daily_greet_limit = DEFAULT_CONFIG["daily_greet_limit"]
    max_contacts_per_company = DEFAULT_CONFIG["max_contacts_per_company"]
    automation_mode = DEFAULT_CONFIG["automation_mode"]
    skip_contacted_companies = DEFAULT_CONFIG["skip_contacted_companies"]
    job_detail_max_chars = DEFAULT_CONFIG["job_detail_max_chars"]
    log_verbosity = DEFAULT_CONFIG["log_verbosity"]
    show_model_reasoning = DEFAULT_CONFIG["show_model_reasoning"]
    blacklist_companies = DEFAULT_CONFIG["blacklist_companies"]
    blacklist_keywords = DEFAULT_CONFIG["blacklist_keywords"]
    target_cities = DEFAULT_CONFIG["target_cities"]
    job_keywords = DEFAULT_CONFIG["job_keywords"]

    @classmethod
    def load(cls) -> dict[str, Any]:
        ensure_data_dirs()
        data = dict(DEFAULT_CONFIG)
        should_rewrite = False
        if CONFIG_PATH.exists():
            try:
                saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    if not saved.get("think_model") and saved.get("chat_model"):
                        saved["think_model"] = saved.get("chat_model")
                        should_rewrite = True
                    if any(key not in DEFAULT_CONFIG for key in saved):
                        should_rewrite = True
                    if any(key not in saved for key in DEFAULT_CONFIG):
                        should_rewrite = True
                    data.update({k: v for k, v in saved.items() if k in DEFAULT_CONFIG})
            except json.JSONDecodeError:
                pass
        cls.apply(data)
        if not CONFIG_PATH.exists() or should_rewrite:
            cls.save(data)
        return cls.as_dict()

    @classmethod
    def apply(cls, data: dict[str, Any]) -> None:
        data = dict(data)
        if data.get("model_provider") not in {"ollama", "openai_compatible"}:
            data["model_provider"] = DEFAULT_CONFIG["model_provider"]
        if data.get("log_verbosity") not in {"compact", "normal", "debug"}:
            data["log_verbosity"] = DEFAULT_CONFIG["log_verbosity"]
        data["show_model_reasoning"] = _as_bool(data.get("show_model_reasoning"))
        for key in DEFAULT_CONFIG:
            setattr(cls, key, data.get(key, DEFAULT_CONFIG[key]))

    @classmethod
    def as_dict(cls) -> dict[str, Any]:
        return {key: getattr(cls, key) for key in DEFAULT_CONFIG}

    @classmethod
    def public_dict(cls) -> dict[str, Any]:
        data = cls.as_dict()
        key = str(data.get("openai_api_key", ""))
        if key:
            data["openai_api_key"] = f"已配置(...{key[-4:]})" if len(key) > 4 else "已配置"
        else:
            data["openai_api_key"] = ""
        data["openai_api_key_configured"] = bool(key)
        return data

    @classmethod
    def save(cls, updates: dict[str, Any]) -> dict[str, Any]:
        ensure_data_dirs()
        current = cls.as_dict()
        current.update({k: v for k, v in updates.items() if k in DEFAULT_CONFIG})
        cls.apply(current)
        current = cls.as_dict()
        CONFIG_PATH.write_text(
            json.dumps(current, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return cls.as_dict()


Config.load()
