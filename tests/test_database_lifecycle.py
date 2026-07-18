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
