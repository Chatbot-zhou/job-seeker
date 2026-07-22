from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request


def _request(path: str = "/jobs/analyze") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("127.0.0.1", 33333),
        }
    )


def test_expensive_endpoint_rate_limit(monkeypatch) -> None:
    import main

    main.RATE_LIMIT_BUCKETS.clear()
    monkeypatch.setitem(main.RATE_LIMIT_RULES, "/jobs/analyze", 2)
    monkeypatch.setattr(main.runtime_state, "emit", lambda *args, **kwargs: {})

    request = _request()
    main.check_rate_limit(request)
    main.check_rate_limit(request)
    with pytest.raises(HTTPException) as error:
        main.check_rate_limit(request)
    assert error.value.status_code == 429
    main.RATE_LIMIT_BUCKETS.clear()


def test_testclient_is_treated_as_loopback() -> None:
    import main

    assert main.is_loopback_client("testclient") is True


def test_userscript_is_served_as_utf8(tmp_path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    import database
    import main
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "api-test.db"))
    database._INITIALIZED_PATHS.clear()

    with TestClient(main.app) as client:
        response = client.get("/web_script.user.js")

    assert response.status_code == 200
    assert "charset=utf-8" in response.headers["content-type"].lower()
    assert "@description  Job Seeker 篡改猴插件" in response.text


def test_platform_heartbeat_and_control_are_isolated(tmp_path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    import database
    import main
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "platform-api.db"))
    monkeypatch.setattr(Config, "boss_enabled", True)
    monkeypatch.setattr(Config, "zhaopin_enabled", True)
    database._INITIALIZED_PATHS.clear()
    main.runtime_state.platform_controls.update({"boss": "running", "zhaopin": "running"})
    main.runtime_state.platform_pause_reasons.update({"boss": "", "zhaopin": ""})
    main.runtime_state.set_control("resume")

    with TestClient(main.app) as client:
        for platform in ("boss", "zhaopin"):
            response = client.post(
                "/script/heartbeat",
                json={
                    "platform": platform,
                    "instance_id": f"{platform}-instance",
                    "page_kind": "list",
                    "page": "search" if platform == "boss" else "list",
                    "status": "running",
                    "current_action": "读取岗位列表",
                    "detail": {"scrollMode": "document"},
                },
            )
            assert response.status_code == 200
            assert response.json()["platform"] == platform

        paused = client.post("/control", json={"command": "pause", "platform": "zhaopin", "reason": "验证码"})
        assert paused.status_code == 200
        body = paused.json()
        assert body["platforms"]["boss"]["effective_control"] == "running"
        assert body["platforms"]["zhaopin"]["effective_control"] == "paused"
        assert body["platforms"]["zhaopin"]["pause_reason"] == "验证码"

        status = client.get("/status").json()
        assert status["platforms"]["boss"]["instance_id"] == "boss-instance"
        assert status["platforms"]["zhaopin"]["instance_id"] == "zhaopin-instance"
        assert status["model_queue"]["limit"] in {1, 2}

        resumed = client.post("/control", json={"command": "resume", "platform": "zhaopin"}).json()
        assert resumed["platforms"]["zhaopin"]["effective_control"] == "running"
