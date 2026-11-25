from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _prepare_runtime(tmp_path: Path, monkeypatch):
    import config
    import database
    import main
    from cache import cache
    from config import Config

    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "app.db"))
    monkeypatch.setattr(Config, "resume_name", str(tmp_path / "resume" / "resume.md"))
    monkeypatch.setattr(Config, "extracted_resume_name", str(tmp_path / "resume" / "extracted.txt"))
    monkeypatch.setattr(Config, "original_resume_pdf_name", str(tmp_path / "resume" / "original.pdf"))
    monkeypatch.setattr(Config, "profile_cache_name", str(tmp_path / "cache" / "profile.json"))
    monkeypatch.setattr(Config, "user_detail_name", str(tmp_path / "cache" / "user_detail.md"))
    monkeypatch.setattr(Config, "tags_name", str(tmp_path / "cache" / "tags.txt"))
    monkeypatch.setattr(Config, "greeting_cache_name", str(tmp_path / "cache" / "greeting.json"))
    (tmp_path / "resume").mkdir(parents=True, exist_ok=True)
    (tmp_path / "cache").mkdir(parents=True, exist_ok=True)
    database._INITIALIZED_PATHS.clear()
    cache._resume = ""
    cache._profile = {}
    from runtime_state import runtime_state

    runtime_state.set_control("pause")
    return main


def test_ui_is_served_as_html() -> None:
    import main

    with TestClient(main.app) as client:
        response = client.get("/ui/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Job Seeker" in response.text
    assert "/ui/app.js" in response.text


def test_setup_status_shape(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    with TestClient(main.app) as client:
        response = client.get("/setup/status")
    assert response.status_code == 200
    body = response.json()
    assert {
        "onboarding_completed",
        "has_existing_data",
        "resume_saved",
        "profile_generated",
        "tags",
        "tags_count",
        "user_detail_saved",
        "greeting_confirmed",
        "greeting_mode",
        "model",
        "script",
        "boss_url",
        "userscript_url",
        "setup_ready",
    } <= set(body)
    assert body["greeting_mode"] in {"boss_native", "custom_only"}


def test_profile_endpoint_saves_tags_and_user_detail(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    from cache import cache

    cache.save_resume("# 我的简历\n\nPython 后端")
    cache.save_user_detail("旧画像")
    cache.save_tags("旧标签")
    with TestClient(main.app) as client:
        response = client.put(
            "/resume/profile",
            json={"tags": ["Python", "后端"], "user_detail": "新的用户详情"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["tags"] == ["Python", "后端"]
    assert body["user_detail"] == "新的用户详情"
    assert cache.tags == ["Python", "后端"]
    assert cache.user_detail == "新的用户详情"


def test_setup_complete_marks_onboarding_done(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    from config import Config

    original = Config.as_dict()
    try:
        with TestClient(main.app) as client:
            response = client.post("/setup/complete", json={"completed": True})
        assert response.status_code == 200
        assert response.json()["config"]["onboarding_completed"] is True
        assert Config.onboarding_completed is True
    finally:
        Config.apply(original)


def test_model_select_rolls_back_when_warmup_fails(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    from config import Config

    original = Config.as_dict()
    original_provider = Config.model_provider
    target = "openai" if original_provider == "ollama" else "ollama"
    try:
        monkeypatch.setattr(
            main,
            "model_warmup_check",
            lambda: {"status": "error", "error": "test failure", "provider": target, "model": "test-model"},
        )
        with TestClient(main.app) as client:
            response = client.post("/model/select", json={"provider": target, "pause_running": True})
        assert response.status_code == 503
        assert Config.model_provider == original_provider
    finally:
        Config.apply(original)


def test_model_select_switches_on_success(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    from config import Config

    original = Config.as_dict()
    original_provider = Config.model_provider
    target = "openai" if original_provider == "ollama" else "ollama"
    try:
        monkeypatch.setattr(
            main,
            "model_warmup_check",
            lambda: {"status": "ready", "provider": target, "model": "test-model", "latency_seconds": 0.01},
        )
        with TestClient(main.app) as client:
            response = client.post("/model/select", json={"provider": target, "pause_running": True})
        assert response.status_code == 200
        assert response.json()["switched"] is True
        assert Config.model_provider == target
    finally:
        Config.apply(original)


def test_model_test_does_not_persist_configuration(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    from config import Config

    original = Config.as_dict()
    try:
        monkeypatch.setattr(
            main,
            "model_warmup_check",
            lambda: {"status": "ready", "provider": "openai", "model": "candidate", "latency_seconds": 0.01},
        )
        with TestClient(main.app) as client:
            response = client.post(
                "/model/test",
                json={
                    "provider": "openai",
                    "config": {
                        "openai_api_base": "https://candidate.example/v1",
                        "cloud_model": "candidate-model",
                    },
                },
            )
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert Config.openai_api_base == original["openai_api_base"]
        assert Config.cloud_model == original["cloud_model"]
    finally:
        Config.apply(original)


def test_model_ollama_probe_uses_helper(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    monkeypatch.setattr(
        main,
        "probe_ollama_models",
        lambda host: {"available": True, "host": host, "models": ["qwen3:1.7b"], "raw": ""},
    )
    with TestClient(main.app) as client:
        response = client.get("/model/ollama/models")
    assert response.status_code == 200
    assert response.json()["models"] == ["qwen3:1.7b"]


def test_profile_grounding_guard_flags_hallucinated_facts() -> None:
    from cache import profile_grounding_warnings

    resume = "Python 后端工程师，5 年经验，熟悉 FastAPI、SQLite、Redis、Docker 和 LLM 工作流。\n学历：计算机科学本科。"
    grounded = (
        "学历专业: 计算机科学本科 未提及\n"
        "技术栈: Python; FastAPI; SQLite; Redis; Docker; LLM\n"
        "项目经验:\n"
        "未提及"
    )
    assert profile_grounding_warnings(resume, grounded) == []

    hallucinated = (
        "学历专业: 计算机科学本科 (普通院校) 2018.09-2023.06\n"
        "技术栈: Python; Java; SpringBoot; LangChain; Milvus\n"
        "项目经验:\n"
        "[LLM 平台] 多模态 | Qwen2, LangChain, Milvus | RAG | 200ms"
    )
    warnings = profile_grounding_warnings(resume, hallucinated)
    assert any("Java" in item for item in warnings)
    assert any("普通院校" in item for item in warnings)
    assert any("2018" in item for item in warnings)


def test_control_start_rejects_outdated_userscript(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    monkeypatch.setattr(
        main.runtime_state,
        "script_snapshot",
        lambda platform=None: {
            "connected": True,
            "detail": {"version": "2026.09.26.1"},
        },
    )
    with TestClient(main.app) as client:
        response = client.post("/control", json={"command": "start", "platform": "boss"})
    assert response.status_code == 409
    assert "旧版" in response.json()["detail"]


def test_userscript_version_issue_accepts_current_and_rejects_old(monkeypatch) -> None:
    import main

    monkeypatch.setattr(
        main.runtime_state,
        "script_snapshot",
        lambda platform=None: {
            "connected": True,
            "detail": {"version": main.expected_userscript_version()},
        },
    )
    assert main.userscript_version_issue("boss") == ""

    monkeypatch.setattr(
        main.runtime_state,
        "script_snapshot",
        lambda platform=None: {"connected": True, "detail": {"version": "2026.09.26.1"}},
    )
    issue = main.userscript_version_issue("boss")
    assert "旧版" in issue


def test_control_start_allows_current_userscript_when_ready(tmp_path, monkeypatch) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from fastapi.testclient import TestClient

    import main
    from cache import cache
    from config import Config
    from greeting_service import save_greeting
    from runtime_state import runtime_state

    _prepare_runtime(tmp_path, monkeypatch)
    original = Config.as_dict()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test-start")
    try:
        cache.save_resume("# 测试简历\n\nPython 后端")
        cache.save_user_detail("Python 后端，5 年经验")
        cache.save_tags("Python\n后端")
        save_greeting("您好，我想了解一下这个岗位。", "测试")
        monkeypatch.setattr(
            main.runtime_state,
            "script_snapshot",
            lambda platform=None: {
                "connected": True,
                "detail": {"version": main.expected_userscript_version()},
            },
        )
        monkeypatch.setattr(
            main,
            "model_warmup_check",
            lambda: {"status": "ready", "provider": "ollama", "model": "test", "latency_seconds": 0.01},
        )
        monkeypatch.setattr(main, "MODEL_EXECUTOR", executor)
        with TestClient(main.app) as client:
            response = client.post("/control", json={"command": "start", "platform": "boss"})
        assert response.status_code == 200, response.text
        assert response.json()["control"] == "running"
    finally:
        runtime_state.set_control("stop")
        Config.apply(original)
        executor.shutdown(wait=False)


def test_heartbeat_pauses_outdated_userscript(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    original = main.runtime_state.control
    try:
        main.runtime_state.set_control("resume")
        with TestClient(main.app) as client:
            response = client.post(
                "/script/heartbeat",
                json={
                    "platform": "boss",
                    "instance_id": "old-script",
                    "page_kind": "search",
                    "page": "search",
                    "status": "running",
                    "detail": {"version": "2026.09.26.1"},
                },
            )
        assert response.status_code == 200
        body = response.json()
        assert body["control"] == "paused"
        assert body["should_pause"] is True
        assert body["should_start"] is False
        assert "版本不匹配" in body["message"]
    finally:
        main.runtime_state.set_control("stop" if original == "stopped" else original)


def test_heartbeat_allows_detail_page_without_version(tmp_path, monkeypatch) -> None:
    main = _prepare_runtime(tmp_path, monkeypatch)
    original = main.runtime_state.control
    try:
        main.runtime_state.set_control("resume")
        with TestClient(main.app) as client:
            response = client.post(
                "/script/heartbeat",
                json={
                    "platform": "boss",
                    "instance_id": "detail-page",
                    "page_kind": "detail",
                    "page": "detail",
                    "status": "running",
                    "detail": {},
                },
            )
        assert response.status_code == 200
        body = response.json()
        assert body["control"] == "running"
        assert body["should_pause"] is False
    finally:
        main.runtime_state.set_control("stop" if original == "stopped" else original)
