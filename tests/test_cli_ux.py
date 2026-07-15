from __future__ import annotations

from pathlib import Path


def test_gitignore_does_not_ignore_pytest_sources() -> None:
    lines = {
        line.strip()
        for line in Path(".gitignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }
    assert "test.*" not in lines


def test_diagnostic_redaction_hides_sensitive_text() -> None:
    from cli_console import _redact_export_value

    payload = {
        "openai_api_key": "test-local-secret-value",
        "resume": "电话 13800138000，邮箱 test@example.com",
        "detail": "身份证 110105199001011234",
    }
    redacted = _redact_export_value(payload)
    text = str(redacted)
    assert "test-local-secret-value" not in text
    assert "13800138000" not in text
    assert "test@example.com" not in text
    assert "110105199001011234" not in text


def test_status_panel_does_not_trigger_model_warmup(monkeypatch) -> None:
    import cli_console
    from runtime_state import runtime_state

    runtime_state.model_warmup.update({"status": "unknown", "error": ""})
    monkeypatch.setattr("builtins.print", lambda *args, **kwargs: None)
    monkeypatch.setenv("JOB_SEEKER_SIMPLE_STATUS", "1")
    cli_console.print_status_panel()
    assert runtime_state.model_warmup["status"] == "unknown"
