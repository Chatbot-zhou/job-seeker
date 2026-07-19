from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone


def _iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def test_schema_migration_backup_and_event_retention(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    db_path = tmp_path / "app.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                level TEXT NOT NULL,
                source TEXT NOT NULL,
                message TEXT NOT NULL,
                detail_json TEXT,
                created_at TEXT
            )
            """
        )
        conn.executemany(
            "INSERT INTO events(event_type, level, source, message, detail_json, created_at) VALUES(?,?,?,?,?,?)",
            [
                ("script_status", "info", "script", "old normal", "{}", _iso_days_ago(8)),
                ("greet_delivery_unknown", "error", "script", "important", "{}", _iso_days_ago(8)),
                ("platform_limit_pause", "error", "script", "too old", "{}", _iso_days_ago(31)),
            ],
        )
        conn.execute("PRAGMA user_version=2")
        conn.commit()

    monkeypatch.setattr(Config, "app_db_name", str(db_path))
    database._INITIALIZED_PATHS.clear()
    database.init_db()

    stats = database.database_stats()
    assert stats["schema_version"] == database.SCHEMA_VERSION
    assert list((tmp_path / "backups").glob("app-schema-v2-*.db"))

    cleanup = database.prune_old_events(normal_days=7, important_days=30)
    assert cleanup["deleted"] == 2
    remaining = database.list_events(10)
    assert [event["event_type"] for event in remaining] == ["greet_delivery_unknown"]


def test_run_summary_uses_run_id(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "run.db"))
    database._INITIALIZED_PATHS.clear()
    database.init_db()
    database.upsert_run("run-test", control="running")
    database.create_event(
        {
            "type": "greet_delivery_unknown",
            "level": "error",
            "source": "script",
            "message": "unknown",
            "detail": {},
            "run_id": "run-test",
        }
    )
    summary = database.finish_run("run-test", control="paused")
    assert summary["event_count"] == 1
    assert summary["error_count"] == 1
    assert summary["greet_unknown"] == 1


def test_v3_runs_table_with_status_is_migrated_and_writable(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    db_path = tmp_path / "legacy-runs.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE runs (
                run_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                summary_json TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("PRAGMA user_version=3")
        conn.commit()

    monkeypatch.setattr(Config, "app_db_name", str(db_path))
    database._INITIALIZED_PATHS.clear()
    database.init_db()
    database.upsert_run("run-legacy", control="running")

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
        row = conn.execute("SELECT status, control FROM runs WHERE run_id = ?", ("run-legacy",)).fetchone()
        version = conn.execute("PRAGMA user_version").fetchone()[0]

    assert "control" in columns
    assert row == ("running", "running")
    assert version == database.SCHEMA_VERSION
    assert list((tmp_path / "backups").glob("legacy-runs-schema-v3-*.db"))


def test_repair_invalid_company_names_clears_title_salary_pollution(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "company.db"))
    database._INITIALIZED_PATHS.clear()
    database.init_db()
    database.upsert_job(
        {
            "url": "https://example.test/job/1",
            "title": "AI研发工程师",
            "company": "AI研发工程师\n15-25K",
            "salary": "15-25K",
            "detail": "test",
        }
    )
    database.upsert_job(
        {
            "url": "https://example.test/job/2",
            "title": "AI研发工程师",
            "company": "杭州示例科技有限公司",
            "salary": "15-25K",
            "detail": "test",
        }
    )

    result = database.repair_invalid_company_names()

    assert result["repaired"] == 1
    assert database.get_job("https://example.test/job/1")["company"] == ""
    assert database.get_job("https://example.test/job/2")["company"] == "杭州示例科技有限公司"


def test_v5_compacts_duplicate_model_events_and_redacts_urls(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    db_path = tmp_path / "events-v4.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                level TEXT NOT NULL,
                source TEXT NOT NULL,
                message TEXT NOT NULL,
                detail_json TEXT,
                run_id TEXT DEFAULT '',
                created_at TEXT
            )
            """
        )
        duplicate = (
            "model_thinking_control_retry",
            "info",
            "model",
            "OpenAI 模型不支持当前思考控制参数，已移除后重试",
            "{}",
            "run-duplicate",
        )
        for index in range(8):
            conn.execute(
                "INSERT INTO events(event_type,level,source,message,detail_json,run_id,created_at) VALUES(?,?,?,?,?,?,?)",
                (*duplicate, (datetime.now(timezone.utc) + timedelta(seconds=index)).isoformat()),
            )
        conn.execute(
            "INSERT INTO events(event_type,level,source,message,detail_json,run_id,created_at) VALUES(?,?,?,?,?,?,?)",
            (
                "job_detail_failed",
                "error",
                "script",
                "失败 https://www.zhipin.com/job_detail/abc.html?securityId=secret-value&lid=1",
                '{"url":"https://www.zhipin.com/job_detail/abc.html?securityId=secret-value&lid=1"}',
                "run-duplicate",
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.execute("PRAGMA user_version=4")
        conn.commit()

    monkeypatch.setattr(Config, "app_db_name", str(db_path))
    database._INITIALIZED_PATHS.clear()
    database._MIGRATION_RESULTS.clear()
    database.init_db()

    events = database.list_events(30)
    retry_events = [item for item in events if item["event_type"] == "model_thinking_control_retry"]
    summaries = [item for item in events if item["event_type"] == "event_compaction_summary"]
    errors = [item for item in events if item["event_type"] == "job_detail_failed"]
    assert len(retry_events) == 2
    assert len(summaries) == 1
    assert len(errors) == 1
    assert "securityId" not in errors[0]["message"]
    assert "secret-value" not in str(errors[0])
    result = database.last_migration_result()
    assert result["compacted_events"] == 6
    assert result["sanitized_events"] == 1
    assert result["vacuumed"] is True
    assert list((tmp_path / "backups").glob("events-v4-schema-v4-*.db"))

    database._INITIALIZED_PATHS.clear()
    database.init_db()
    assert len([item for item in database.list_events(30) if item["event_type"] == "event_compaction_summary"]) == 1


def test_reconcile_stale_runs_marks_only_abandoned_rows(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    db_path = tmp_path / "stale-runs.db"
    monkeypatch.setattr(Config, "app_db_name", str(db_path))
    database._INITIALIZED_PATHS.clear()
    database.init_db()
    database.upsert_run("run-stale", control="running")
    database.upsert_run("run-current", control="running")
    stale_time = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE runs SET updated_at = ? WHERE run_id = 'run-stale'", (stale_time,))
        conn.commit()

    result = database.reconcile_stale_runs(stale_minutes=10, exclude_run_id="run-current")

    with sqlite3.connect(db_path) as conn:
        stale = conn.execute("SELECT status, control, ended_at FROM runs WHERE run_id = 'run-stale'").fetchone()
        current = conn.execute("SELECT status, control, ended_at FROM runs WHERE run_id = 'run-current'").fetchone()
    assert result["run_ids"] == ["run-stale"]
    assert stale == ("interrupted", "interrupted", stale_time)
    assert current == ("running", "running", None)


def test_new_run_gets_its_own_start_time(monkeypatch) -> None:
    import database
    from runtime_state import RuntimeState

    captured: dict[str, str] = {}
    monkeypatch.setattr(database, "finish_run", lambda *args, **kwargs: {})
    monkeypatch.setattr(database, "create_event", lambda event: event)
    monkeypatch.setattr(
        database,
        "upsert_run",
        lambda run_id, *, control, started_at: captured.update({"run_id": run_id, "started_at": started_at}),
    )
    state = RuntimeState()
    state.run_started_at = "2000-01-01T00:00:00+00:00"
    old_run_id = state.run_id

    state.set_control("resume", new_run=True)

    assert state.run_id != old_run_id
    assert state.run_started_at != "2000-01-01T00:00:00+00:00"
    assert captured == {"run_id": state.run_id, "started_at": state.run_started_at}


def test_thinking_control_retry_is_recorded_once_per_model_and_run(monkeypatch) -> None:
    import database
    from runtime_state import RuntimeState

    stored: list[dict] = []
    monkeypatch.setattr(database, "create_event", lambda event: stored.append(event) or event)
    state = RuntimeState()

    state.emit(
        "model_thinking_control_retry",
        "第一次参数降级",
        source="model",
        detail={"model": "test-model"},
    )
    state.emit(
        "model_thinking_control_retry",
        "同一模型的另一种提示文本",
        source="model",
        detail={"model": "test-model"},
    )

    assert len(stored) == 1


def test_script_status_persists_page_state_without_action_text_churn(monkeypatch) -> None:
    import database
    from runtime_state import RuntimeState

    stored: list[dict] = []
    monkeypatch.setattr(database, "create_event", lambda event: stored.append(event) or event)
    state = RuntimeState()

    state.update_script("search", "running", "读取第一个岗位")
    state.update_script("search", "running", "读取第二个岗位")
    state.update_script("detail", "running", "读取第二个岗位详情")

    assert [item["detail"]["page"] for item in stored] == ["search", "detail"]
