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


def test_normal_startup_opens_job_pages_without_userscript_install_pages(monkeypatch) -> None:
    import cli_console

    opened: list[str] = []
    monkeypatch.setattr(cli_console, "wait_for_api_ready", lambda: True)
    monkeypatch.setattr(cli_console, "startup_platform_enabled", lambda platform: True)
    monkeypatch.setattr(cli_console, "should_open_browser_page", lambda *args, **kwargs: True)
    monkeypatch.setattr(cli_console.Config, "zhaopin_job_urls", ["https://www.zhaopin.com/recommend"])
    monkeypatch.setattr(cli_console.webbrowser, "open", lambda url, **kwargs: opened.append(url) or True)
    monkeypatch.setattr("builtins.print", lambda *args, **kwargs: None)

    cli_console.maybe_open_startup_pages()

    assert cli_console.BOSS_SEARCH_URL in opened
    assert "https://www.zhaopin.com/recommend" in opened
    assert not any(url.endswith(".user.js") for url in opened)


def test_userscript_update_check_only_prompts_for_connected_stale_platform(monkeypatch) -> None:
    import cli_console

    prompted: list[tuple[str, str]] = []
    monkeypatch.setattr(cli_console, "CONFIG_WAS_MISSING", False)
    monkeypatch.setattr(
        cli_console,
        "script_install_urls",
        lambda: {
            "boss": "http://127.0.0.1:33333/userscripts/boss.user.js",
            "zhaopin": "http://127.0.0.1:33333/userscripts/zhaopin.user.js",
        },
    )
    monkeypatch.setattr(cli_console, "read_script_versions", lambda: ("2026.07.27.1", "2026.07.27.1"))
    monkeypatch.setattr(
        cli_console.runtime_state,
        "platform_snapshots",
        lambda: {
            "boss": {
                "connected": True,
                "stale": False,
                "detail": {"version": "2026.07.27.1"},
            },
            "zhaopin": {
                "connected": True,
                "stale": False,
                "detail": {"version": "2026.07.25.1"},
            },
        },
    )
    monkeypatch.setattr(
        cli_console,
        "open_userscript_install_page_once",
        lambda platform, reason: prompted.append((platform, reason)) or True,
    )

    cli_console.maybe_open_userscript_updates(wait_seconds=0)

    assert [platform for platform, _ in prompted] == ["zhaopin"]
    assert "2026.07.25.1" in prompted[0][1]


def test_first_configuration_prompts_each_enabled_userscript_once(monkeypatch) -> None:
    import cli_console

    prompted: list[str] = []
    monkeypatch.setattr(cli_console, "CONFIG_WAS_MISSING", True)
    monkeypatch.setattr(
        cli_console,
        "script_install_urls",
        lambda: {
            "boss": "http://127.0.0.1:33333/userscripts/boss.user.js",
            "zhaopin": "http://127.0.0.1:33333/userscripts/zhaopin.user.js",
        },
    )
    monkeypatch.setattr(
        cli_console,
        "open_userscript_install_page_once",
        lambda platform, reason: prompted.append(platform) or True,
    )

    cli_console.maybe_open_userscript_updates(wait_seconds=0)

    assert prompted == ["boss", "zhaopin"]


def test_powershell_launcher_does_not_open_userscript_install_pages() -> None:
    launcher = Path("scripts/start_job_seeker.ps1").read_text(encoding="utf-8")

    assert "/userscripts/" not in launcher
    assert "Start-Process $scriptUrl" not in launcher


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
