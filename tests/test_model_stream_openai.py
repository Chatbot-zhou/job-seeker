from __future__ import annotations

import io
import json
from urllib.error import HTTPError

import pytest


class _FakeStreamResponse:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = lines

    def __enter__(self) -> "_FakeStreamResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def __iter__(self):
        return iter(self._lines)


def _http_error(code: int, body: str) -> HTTPError:
    return HTTPError(
        "https://example.test/v1/chat/completions",
        code,
        "error",
        hdrs={},
        fp=io.BytesIO(body.encode("utf-8")),
    )


def test_openai_model_not_found_does_not_trigger_thinking_fallback(monkeypatch) -> None:
    import model_stream
    from config import Config

    original = Config.as_dict()
    events: list[tuple[str, str]] = []

    def fake_urlopen(request, timeout):
        body = json.dumps(
            {
                "error": {
                    "code": "InvalidEndpointOrModel.NotFound",
                    "message": "The model or endpoint doubao-seed-test does not exist or you do not have access to it.",
                }
            }
        )
        raise _http_error(404, body)

    try:
        model_stream.OPENAI_THINKING_CONTROL_UNSUPPORTED.clear()
        Config.apply(
            {
                **original,
                "model_provider": "openai",
                "openai_api_key": "test-key",
                "openai_api_base": "https://example.test/v1",
                "think_model": "doubao-seed-test",
                "external_model_profile": "doubao",
                "disable_model_thinking": True,
            }
        )
        monkeypatch.setattr(model_stream, "urlopen", fake_urlopen)
        monkeypatch.setattr(
            model_stream.runtime_state,
            "emit",
            lambda event_type, message, **kwargs: events.append((event_type, message)),
        )

        with pytest.raises(RuntimeError) as error:
            list(
                model_stream.iter_openai_chat_chunks(
                    [{"role": "user", "content": "hi"}],
                    "doubao-seed-test",
                    {"disable_thinking": True},
                )
            )

        assert "模型或 endpoint 不存在/无权限" in str(error.value)
        assert not any(event_type == "model_thinking_control_retry" for event_type, _ in events)
        assert not model_stream.is_openai_thinking_control_unsupported("doubao-seed-test")
    finally:
        Config.apply(original)
        model_stream.OPENAI_THINKING_CONTROL_UNSUPPORTED.clear()


def test_openai_thinking_parameter_error_falls_back_once(monkeypatch) -> None:
    import model_stream
    from config import Config

    original = Config.as_dict()
    calls: list[dict] = []
    events: list[tuple[str, str]] = []

    def fake_urlopen(request, timeout):
        payload = json.loads(request.data.decode("utf-8"))
        calls.append(payload)
        if len(calls) == 1:
            raise _http_error(400, '{"error":{"message":"Unknown parameter: thinking"}}')
        return _FakeStreamResponse(
            [
                b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
                b"data: [DONE]\n\n",
            ]
        )

    try:
        model_stream.OPENAI_THINKING_CONTROL_UNSUPPORTED.clear()
        Config.apply(
            {
                **original,
                "model_provider": "openai",
                "openai_api_key": "test-key",
                "openai_api_base": "https://example.test/v1",
                "think_model": "doubao-seed-test",
                "external_model_profile": "doubao",
                "disable_model_thinking": True,
            }
        )
        monkeypatch.setattr(model_stream, "urlopen", fake_urlopen)
        monkeypatch.setattr(
            model_stream.runtime_state,
            "emit",
            lambda event_type, message, **kwargs: events.append((event_type, message)),
        )

        chunks = list(
            model_stream.iter_openai_chat_chunks(
                [{"role": "user", "content": "hi"}],
                "doubao-seed-test",
                {"disable_thinking": True},
            )
        )

        assert "".join(chunks) == "ok"
        assert "thinking" in calls[0]
        assert "thinking" not in calls[1]
        assert calls[1]["messages"][0]["role"] == "system"
        assert "不要输出任何思考过程" in calls[1]["messages"][0]["content"]
        assert any(event_type == "model_thinking_control_retry" for event_type, _ in events)
        assert model_stream.is_openai_thinking_control_unsupported("doubao-seed-test")
    finally:
        Config.apply(original)
        model_stream.OPENAI_THINKING_CONTROL_UNSUPPORTED.clear()


def test_ollama_think_parameter_unsupported_is_cached(monkeypatch) -> None:
    import model_stream
    from config import Config

    original = Config.as_dict()
    calls: list[dict] = []
    events: list[tuple[str, str]] = []

    def fake_raw_chunks(payload):
        calls.append(dict(payload))
        if len(calls) == 1:
            raise RuntimeError('Ollama 请求失败: HTTP 400 {"error":"unknown field \\"think\\""}')
        yield {"message": {"content": "ok"}, "done": True}

    try:
        model_stream.OLLAMA_THINK_PARAMETER_UNSUPPORTED.clear()
        Config.apply(
            {
                **original,
                "model_provider": "ollama",
                "ollama_host": "http://127.0.0.1:11434",
                "think_model": "legacy-model",
                "disable_model_thinking": True,
            }
        )
        monkeypatch.setattr(model_stream, "iter_ollama_http_raw_chunks", fake_raw_chunks)
        monkeypatch.setattr(
            model_stream.runtime_state,
            "emit",
            lambda event_type, message, **kwargs: events.append((event_type, message)),
        )

        first = list(
            model_stream.iter_ollama_chat_chunks(
                [{"role": "user", "content": "hi"}],
                "legacy-model",
                {"think": False, "disable_thinking": True},
            )
        )
        second = list(
            model_stream.iter_ollama_chat_chunks(
                [{"role": "user", "content": "hi"}],
                "legacy-model",
                {"think": False, "disable_thinking": True},
            )
        )

        assert "".join(first) == "ok"
        assert "".join(second) == "ok"
        assert calls[0]["think"] is False
        assert "think" not in calls[1]
        assert "think" not in calls[2]
        assert calls[2]["messages"][0]["role"] == "system"
        assert "不要输出任何思考过程" in calls[2]["messages"][0]["content"]
        assert model_stream.is_ollama_think_parameter_unsupported("legacy-model")
        assert any(event_type == "model_thinking_control_retry" for event_type, _ in events)
    finally:
        Config.apply(original)
        model_stream.OLLAMA_THINK_PARAMETER_UNSUPPORTED.clear()


def test_job_score_stops_retrying_on_model_config_error(monkeypatch) -> None:
    import core

    calls: list[str] = []
    logs: list[str] = []

    def fail_stream(*args, **kwargs):
        calls.append(str(kwargs.get("model", "")))
        raise RuntimeError("OpenAI 模型或 endpoint 不存在/无权限: HTTP 404 model missing")

    monkeypatch.setattr(core, "_stream_messages", fail_stream)
    monkeypatch.setattr(core.runtime_state, "log", lambda message, **kwargs: logs.append(message))

    scores, reply = core.calculate_job_score("岗位", "用户画像")

    assert scores is None
    assert "模型调用失败" in reply
    assert len(calls) == 1
    assert any("本岗位停止评分重试" in message for message in logs)


def test_job_score_stops_retrying_on_connection_refused(monkeypatch) -> None:
    import core

    calls: list[str] = []
    logs: list[str] = []

    def fail_stream(*args, **kwargs):
        calls.append(str(kwargs.get("model", "")))
        raise RuntimeError("OpenAI 连接失败: <urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>")

    monkeypatch.setattr(core, "_stream_messages", fail_stream)
    monkeypatch.setattr(core.runtime_state, "log", lambda message, **kwargs: logs.append(message))

    scores, reply = core.calculate_job_score("岗位", "用户画像")

    assert scores is None
    assert "模型调用失败" in reply
    assert len(calls) == 1
    assert any("评分模型当前不可用" in message for message in logs)
