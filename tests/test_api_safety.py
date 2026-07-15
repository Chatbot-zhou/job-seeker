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
