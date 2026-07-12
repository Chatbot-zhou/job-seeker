from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def check_dependencies() -> None:
    required = {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "pydantic": "pydantic",
        "ollama": "ollama",
        "pypdf": "pypdf",
        "python-multipart": "multipart",
    }
    missing = [package for package, module in required.items() if importlib.util.find_spec(module) is None]
    assert not missing, "missing dependencies: " + ", ".join(missing)


def check_config_normalization() -> None:
    from config import Config

    original = Config.as_dict()
    try:
        Config.apply({
            **original,
            "daily_greet_safe_limit": 999,
            "search_round_cooldown_minutes": 999,
            "tag_search_delay_seconds": 1,
            "search_result_scroll_rounds": 9,
            "auto_start_time": "9:00",
        })
        assert Config.daily_greet_safe_limit == 150
        assert Config.search_round_cooldown_minutes == 240
        assert Config.tag_search_delay_seconds == 3
        assert Config.search_result_scroll_rounds == 2
        assert Config.auto_start_time == "09:00"
    finally:
        Config.apply(original)


def check_schema_defaults() -> None:
    from schema import ActionCreate, EventCreate, ScriptHeartbeat

    heartbeat_a = ScriptHeartbeat()
    heartbeat_b = ScriptHeartbeat()
    heartbeat_a.detail["x"] = 1
    assert heartbeat_b.detail == {}

    action_a = ActionCreate(action_type="greet_suggestion")
    action_b = ActionCreate(action_type="greet_suggestion")
    action_a.payload["x"] = 1
    assert action_b.payload == {}

    event_a = EventCreate(message="ok")
    event_b = EventCreate(message="ok")
    event_a.detail["x"] = 1
    assert event_b.detail == {}


def check_privacy_detection() -> None:
    from tools import detect_privacy, redact_privacy

    text = "电话 13800138000 邮箱 test@example.com 身份证 110105199001011234"
    kinds = {item["kind"] for item in detect_privacy(text)}
    assert {"phone", "email", "id_card"} <= kinds
    redacted = redact_privacy(text)
    assert "13800138000" not in redacted
    assert "test@example.com" not in redacted
    assert "110105199001011234" not in redacted


def check_job_score_parser() -> None:
    from model_stream import parse_job_score_block

    json_score = '{"学历专业": 85, "技术栈": 76, "项目经验": 70}'
    assert parse_job_score_block(json_score) == "学历专业: 85\n技术栈: 76\n项目经验: 70"

    line_score = "学历专业: 90\n技术栈: 80\n项目经验: 75"
    assert parse_job_score_block(line_score) == line_score

    thinking_only = "<think>这里只是推理，没有最终评分"
    assert parse_job_score_block(thinking_only) is None


def main() -> int:
    checks = [
        check_dependencies,
        check_config_normalization,
        check_schema_defaults,
        check_privacy_detection,
        check_job_score_parser,
    ]
    for check in checks:
        check()
        print(f"OK {check.__name__}")
    print("self_check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
