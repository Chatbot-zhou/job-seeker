from __future__ import annotations

import subprocess
import sys
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
        "url": "https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=url-secret&jobId=job-1",
    }
    redacted = _redact_export_value(payload)
    text = str(redacted)
    assert "test-local-secret-value" not in text
    assert "13800138000" not in text
    assert "test@example.com" not in text
    assert "110105199001011234" not in text
    assert "url-secret" not in text
    assert "securityId" not in text
    assert "jobId=job-1" in text


def test_status_panel_does_not_trigger_model_warmup(monkeypatch) -> None:
    import cli_console
    from runtime_state import runtime_state

    printed: list[str] = []

    runtime_state.model_warmup.update({"status": "unknown", "error": ""})
    monkeypatch.setattr("builtins.print", lambda *args, **kwargs: printed.append(" ".join(map(str, args))))
    monkeypatch.setenv("JOB_SEEKER_SIMPLE_STATUS", "1")
    cli_console.print_status_panel()
    assert runtime_state.model_warmup["status"] == "unknown"
    "\n".join(printed).encode("gbk")


def test_main_help_does_not_start_cli() -> None:
    result = subprocess.run(
        [sys.executable, "main.py", "--help"],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0
    assert "python main.py serve" in result.stdout
    assert "Job Seeker CLI 启动" not in result.stdout


def test_autorun_openai_model_check_does_not_require_ollama(monkeypatch) -> None:
    import cli_console
    import model_stream
    from config import Config

    original = Config.as_dict()

    def fail_ollama_check() -> bool:
        raise AssertionError("OpenAI autorun should not require Ollama")

    try:
        Config.apply(
            {
                **original,
                "model_provider": "openai",
                "openai_api_key": "test-key",
                "think_model": "remote-model",
            }
        )
        monkeypatch.setattr(cli_console, "ensure_autorun_ollama_model", fail_ollama_check)
        monkeypatch.setattr(
            model_stream,
            "model_warmup_check",
            lambda: {
                "status": "ready",
                "provider": "openai",
                "model": "remote-model",
                "latency_seconds": 0.01,
                "error": "",
            },
        )
        monkeypatch.setattr("builtins.print", lambda *args, **kwargs: None)
        assert cli_console.model_ready_for_autorun() is True
    finally:
        Config.apply(original)
