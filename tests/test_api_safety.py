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


def test_userscript_is_served_as_utf8() -> None:
    from fastapi.testclient import TestClient

    import main

    with TestClient(main.app) as client:
        response = client.get("/web_script.user.js")

    assert response.status_code == 200
    assert "charset=utf-8" in response.headers["content-type"].lower()
    assert "@description  Job Seeker 篡改猴插件" in response.text
