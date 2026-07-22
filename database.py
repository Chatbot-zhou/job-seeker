from __future__ import annotations

import json
import re
import shutil
import sqlite3
import threading
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from config import Config, ensure_data_dirs
from tools import now_iso, redact_sensitive_urls, sanitize_log_value


SCHEMA_VERSION = 6
_INITIALIZED_PATHS: set[str] = set()
_INIT_LOCK = threading.RLock()
_MIGRATION_RESULTS: dict[str, dict[str, Any]] = {}


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _ensure_column(conn: sqlite3.Connection, table: str, definition: str) -> None:
    name = definition.split()[0]
    if name not in _table_columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def _backup_before_migration(db_path: Path, old_version: int) -> Path | None:
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None
    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"{db_path.stem}-schema-v{old_version}-{stamp}{db_path.suffix}"
    try:
        with sqlite3.connect(str(db_path), timeout=10) as source, sqlite3.connect(str(backup_path)) as target:
            source.backup(target)
    except sqlite3.Error:
        shutil.copy2(db_path, backup_path)
    return backup_path


def _sanitize_legacy_event_rows(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        """
        SELECT id, message, detail_json
        FROM events
        WHERE message LIKE '%http%?%'
           OR detail_json LIKE '%http%?%'
           OR message LIKE '%securityId=%'
           OR detail_json LIKE '%securityId=%'
        """
    ).fetchall()
    updates: list[tuple[str, str | None, int]] = []
    for row in rows:
        message = redact_sensitive_urls(str(row["message"] or ""))
        raw_detail = row["detail_json"]
        detail = redact_sensitive_urls(str(raw_detail)) if raw_detail is not None else None
        if message != row["message"] or detail != raw_detail:
            updates.append((message, detail, int(row["id"])))
    if updates:
        conn.executemany("UPDATE events SET message = ?, detail_json = ? WHERE id = ?", updates)
    return len(updates)


def _compact_duplicate_thinking_events(conn: sqlite3.Connection) -> dict[str, int]:
    groups = conn.execute(
        """
        SELECT COALESCE(run_id, '') AS run_id, message, COALESCE(detail_json, '') AS detail_json,
               COUNT(*) AS event_count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
        FROM events
        WHERE event_type = 'model_thinking_control_retry' AND level = 'info'
        GROUP BY COALESCE(run_id, ''), message, COALESCE(detail_json, '')
        HAVING COUNT(*) > 2
        """
    ).fetchall()
    deleted = 0
    summaries = 0
    for group in groups:
        ids = [
            int(row["id"])
            for row in conn.execute(
                """
                SELECT id FROM events
                WHERE event_type = 'model_thinking_control_retry'
                  AND level = 'info'
                  AND COALESCE(run_id, '') = ?
                  AND message = ?
                  AND COALESCE(detail_json, '') = ?
                ORDER BY id
                """,
                (group["run_id"], group["message"], group["detail_json"]),
            ).fetchall()
        ]
        middle_ids = ids[1:-1]
        if not middle_ids:
            continue
        conn.executemany("DELETE FROM events WHERE id = ?", [(event_id,) for event_id in middle_ids])
        deleted += len(middle_ids)
        summary_detail = {
            "compacted_event_type": "model_thinking_control_retry",
            "original_count": int(group["event_count"]),
            "retained_count": 2,
            "deleted_count": len(middle_ids),
            "first_at": group["first_at"],
            "last_at": group["last_at"],
        }
        conn.execute(
            """
            INSERT INTO events(event_type, level, source, message, detail_json, run_id, created_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (
                "event_compaction_summary",
                "info",
                "database",
                f"已压缩重复模型兼容事件 {len(middle_ids)} 条",
                json.dumps(summary_detail, ensure_ascii=False),
                group["run_id"],
                now_iso(),
            ),
        )
        summaries += 1
    return {"deleted": deleted, "summaries": summaries}


def _migrate_v5_event_hardening(conn: sqlite3.Connection) -> dict[str, Any]:
    sanitized = _sanitize_legacy_event_rows(conn)
    compacted = _compact_duplicate_thinking_events(conn)
    return {
        "from_version": 4,
        "to_version": 5,
        "sanitized_events": sanitized,
        "compacted_events": compacted["deleted"],
        "compaction_summaries": compacted["summaries"],
    }


def normalize_job_identity(company: Any, title: Any) -> str:
    def clean(value: Any) -> str:
        text = unicodedata.normalize("NFKC", str(value or "")).lower()
        return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", text)

    normalized_company = clean(company)
    normalized_title = clean(title)
    if not normalized_company or not normalized_title:
        return ""
    return f"{normalized_company}|{normalized_title}"


def fallback_job_identity(platform: Any, external_job_id: Any, url: Any) -> str:
    platform_name = str(platform or "boss").strip().lower() or "boss"
    job_id = str(external_job_id or "").strip()
    if job_id:
        return f"{platform_name}:id:{job_id}"
    raw_url = str(url or "").strip()
    if raw_url:
        try:
            parsed = urlsplit(raw_url)
            safe_url = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, "", ""))
        except ValueError:
            safe_url = raw_url.split("?", 1)[0].split("#", 1)[0]
        if safe_url:
            return f"{platform_name}:url:{safe_url}"
    return ""


def _migrate_v6_platform_jobs(conn: sqlite3.Connection) -> dict[str, Any]:
    rows = conn.execute("SELECT id, company, title, platform, external_job_id, url, identity_key FROM jobs").fetchall()
    backfilled = 0
    for row in rows:
        platform = str(row["platform"] or "boss")
        identity_key = (
            str(row["identity_key"] or "").strip()
            or normalize_job_identity(row["company"], row["title"])
            or fallback_job_identity(platform, row["external_job_id"], row["url"])
        )
        conn.execute(
            "UPDATE jobs SET platform = COALESCE(NULLIF(platform, ''), 'boss'), identity_key = ? WHERE id = ?",
            (identity_key, int(row["id"])),
        )
        backfilled += 1
    conn.execute("UPDATE actions SET platform = COALESCE(NULLIF(platform, ''), 'boss')")
    return {
        "to_version": 6,
        "platform_jobs_backfilled": backfilled,
    }


def last_migration_result() -> dict[str, Any]:
    return dict(_MIGRATION_RESULTS.get(str(Path(Config.app_db_name).resolve()), {}))


def connect() -> sqlite3.Connection:
    ensure_data_dirs()
    conn = sqlite3.connect(Config.app_db_name, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> None:
    ensure_data_dirs()
    db_path = Path(Config.app_db_name).resolve()
    db_key = str(db_path)
    if db_key in _INITIALIZED_PATHS:
        return
    db_path.parent.mkdir(parents=True, exist_ok=True)
    migration_result: dict[str, Any] = {}
    backup_path: Path | None = None
    with _INIT_LOCK:
        if db_key in _INITIALIZED_PATHS:
            return
        conn = connect()
        try:
            old_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            if old_version < SCHEMA_VERSION:
                conn.close()
                backup_path = _backup_before_migration(db_path, old_version)
                conn = connect()
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT UNIQUE,
                    title TEXT,
                    company TEXT,
                    salary TEXT,
                    city TEXT,
                    detail TEXT,
                    analysis_json TEXT,
                    recommendation TEXT,
                    final_action TEXT,
                    greeted INTEGER DEFAULT 0,
                    resume_sent INTEGER DEFAULT 0,
                    hr_replied INTEGER DEFAULT 0,
                    error TEXT,
                    platform TEXT DEFAULT 'boss',
                    external_job_id TEXT DEFAULT '',
                    identity_key TEXT DEFAULT '',
                    application_state TEXT DEFAULT '',
                    applied INTEGER DEFAULT 0,
                    run_id TEXT DEFAULT '',
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    job_url TEXT,
                    company TEXT,
                    title TEXT,
                    payload_json TEXT,
                    result_json TEXT,
                    note TEXT,
                    platform TEXT DEFAULT 'boss',
                    idempotency_key TEXT DEFAULT '',
                    run_id TEXT DEFAULT '',
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
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
            _ensure_column(conn, "jobs", "run_id TEXT DEFAULT ''")
            _ensure_column(conn, "jobs", "platform TEXT DEFAULT 'boss'")
            _ensure_column(conn, "jobs", "external_job_id TEXT DEFAULT ''")
            _ensure_column(conn, "jobs", "identity_key TEXT DEFAULT ''")
            _ensure_column(conn, "jobs", "application_state TEXT DEFAULT ''")
            _ensure_column(conn, "jobs", "applied INTEGER DEFAULT 0")
            _ensure_column(conn, "actions", "run_id TEXT DEFAULT ''")
            _ensure_column(conn, "actions", "platform TEXT DEFAULT 'boss'")
            _ensure_column(conn, "actions", "idempotency_key TEXT DEFAULT ''")
            _ensure_column(conn, "events", "run_id TEXT DEFAULT ''")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    status TEXT DEFAULT 'paused',
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    control TEXT DEFAULT 'paused',
                    summary_json TEXT DEFAULT '{}',
                    updated_at TEXT NOT NULL
                )
                """
            )
            _ensure_column(conn, "runs", "status TEXT DEFAULT 'paused'")
            _ensure_column(conn, "runs", "started_at TEXT DEFAULT ''")
            _ensure_column(conn, "runs", "ended_at TEXT")
            _ensure_column(conn, "runs", "control TEXT DEFAULT 'paused'")
            _ensure_column(conn, "runs", "summary_json TEXT DEFAULT '{}'")
            _ensure_column(conn, "runs", "updated_at TEXT DEFAULT ''")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_company_greeted ON jobs(company, greeted)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_platform_identity ON jobs(platform, identity_key)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_identity_key ON jobs(identity_key)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_platform_applied ON jobs(platform, applied)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_actions_status_created_at ON actions(status, created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_actions_run_id ON actions(run_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_actions_platform_status ON actions(platform, status)")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_idempotency "
                "ON actions(idempotency_key) WHERE idempotency_key != ''"
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id)")
            if old_version < 5:
                migration_result = _migrate_v5_event_hardening(conn)
            if old_version < 6:
                migration_result.update(_migrate_v6_platform_jobs(conn))
            if old_version < SCHEMA_VERSION:
                migration_result["from_version"] = old_version
                migration_result["backup_path"] = str(backup_path or "")
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            conn.commit()
        finally:
            conn.close()
        if migration_result.get("compacted_events"):
            with sqlite3.connect(str(db_path), timeout=30) as maintenance_conn:
                maintenance_conn.execute("PRAGMA busy_timeout=30000")
                maintenance_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                maintenance_conn.execute("VACUUM")
            migration_result["vacuumed"] = True
        if migration_result:
            migration_result["size_bytes_after"] = db_path.stat().st_size if db_path.exists() else 0
            _MIGRATION_RESULTS[db_key] = migration_result
        _INITIALIZED_PATHS.add(db_key)


def upsert_job(job: dict[str, Any], analysis: dict[str, Any] | None = None, final_action: str = "") -> dict[str, Any]:
    init_db()
    url = job.get("url") or f"{job.get('company', '')}|{job.get('title', '')}|{job.get('salary', '')}"
    platform = str(job.get("platform") or "boss")
    identity_key = str(job.get("identity_key") or "").strip() or normalize_job_identity(
        job.get("company", ""), job.get("title", "")
    ) or fallback_job_identity(platform, job.get("external_job_id", ""), url)
    current_time = now_iso()
    analysis_json = json.dumps(analysis or {}, ensure_ascii=False)
    with closing(connect()) as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                url, title, company, salary, city, detail, analysis_json,
                recommendation, final_action, platform, external_job_id, identity_key,
                application_state, applied, run_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                title=excluded.title,
                company=excluded.company,
                salary=excluded.salary,
                city=excluded.city,
                detail=excluded.detail,
                analysis_json=excluded.analysis_json,
                recommendation=excluded.recommendation,
                final_action=CASE WHEN excluded.final_action != '' THEN excluded.final_action ELSE jobs.final_action END,
                platform=excluded.platform,
                external_job_id=CASE WHEN excluded.external_job_id != '' THEN excluded.external_job_id ELSE jobs.external_job_id END,
                identity_key=CASE WHEN excluded.identity_key != '' THEN excluded.identity_key ELSE jobs.identity_key END,
                application_state=CASE WHEN excluded.application_state != '' THEN excluded.application_state ELSE jobs.application_state END,
                applied=CASE WHEN excluded.applied = 1 THEN 1 ELSE jobs.applied END,
                run_id=CASE WHEN excluded.run_id != '' THEN excluded.run_id ELSE jobs.run_id END,
                updated_at=excluded.updated_at
            """,
            (
                url,
                job.get("title", ""),
                job.get("company", ""),
                job.get("salary", ""),
                job.get("city", ""),
                job.get("detail", ""),
                analysis_json,
                (analysis or {}).get("recommendation", ""),
                final_action,
                platform,
                job.get("external_job_id", ""),
                identity_key,
                job.get("application_state", ""),
                1 if job.get("applied") else 0,
                job.get("run_id", ""),
                current_time,
                current_time,
            ),
        )
        conn.commit()
    return get_job(url) or {}


def get_job(url: str) -> dict[str, Any] | None:
    init_db()
    with closing(connect()) as conn:
        row = conn.execute("SELECT * FROM jobs WHERE url = ?", (url,)).fetchone()
    return row_to_dict(row) if row else None


def get_job_by_identity(identity_key: str, *, exclude_platform: str = "") -> dict[str, Any] | None:
    init_db()
    identity_key = str(identity_key or "").strip()
    if not identity_key:
        return None
    params: list[Any] = [identity_key]
    where = "identity_key = ?"
    if exclude_platform:
        where += " AND platform != ?"
        params.append(exclude_platform)
    with closing(connect()) as conn:
        row = conn.execute(
            f"SELECT * FROM jobs WHERE {where} ORDER BY applied DESC, greeted DESC, updated_at DESC LIMIT 1",
            tuple(params),
        ).fetchone()
    return row_to_dict(row) if row else None


def count_greeted_company(company: str, platform: str = "boss") -> int:
    init_db()
    if not company:
        return 0
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM jobs WHERE company = ? AND platform = ? AND greeted = 1",
            (company, platform),
        ).fetchone()
    return int(row["count"]) if row else 0


def update_job_status(
    url: str,
    *,
    final_action: str = "",
    greeted: bool | None = None,
    resume_sent: bool | None = None,
    hr_replied: bool | None = None,
    applied: bool | None = None,
    application_state: str = "",
    error: str = "",
) -> dict[str, Any] | None:
    init_db()
    if not url:
        return None
    updates: list[str] = ["updated_at = ?"]
    values: list[Any] = [now_iso()]
    if final_action:
        updates.append("final_action = ?")
        values.append(final_action)
    if greeted is not None:
        updates.append("greeted = ?")
        values.append(1 if greeted else 0)
    if resume_sent is not None:
        updates.append("resume_sent = ?")
        values.append(1 if resume_sent else 0)
    if hr_replied is not None:
        updates.append("hr_replied = ?")
        values.append(1 if hr_replied else 0)
    if applied is not None:
        updates.append("applied = ?")
        values.append(1 if applied else 0)
    if application_state:
        updates.append("application_state = ?")
        values.append(application_state)
    if error:
        updates.append("error = ?")
        values.append(error)
    values.append(url)
    with closing(connect()) as conn:
        conn.execute(
            f"UPDATE jobs SET {', '.join(updates)} WHERE url = ?",
            values,
        )
        conn.commit()
    return get_job(url)


def create_action(action: dict[str, Any]) -> dict[str, Any]:
    init_db()
    current_time = now_iso()
    with closing(connect()) as conn:
        idempotency_key = str(action.get("idempotency_key") or "").strip()
        existing_id = None
        existing_state = ""
        if idempotency_key:
            row = conn.execute(
                "SELECT id, status, payload_json FROM actions WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            existing_id = int(row["id"]) if row else None
            if row:
                try:
                    existing_payload = json.loads(row["payload_json"] or "{}")
                except (TypeError, json.JSONDecodeError):
                    existing_payload = {}
                existing_state = str(
                    existing_payload.get("transactionState")
                    or existing_payload.get("state")
                    or row["status"]
                    or ""
                )
        if existing_id is not None:
            incoming_payload = action.get("payload", {}) if isinstance(action.get("payload"), dict) else {}
            incoming_state = str(
                incoming_payload.get("transactionState")
                or incoming_payload.get("state")
                or action.get("status")
                or ""
            )
            if (
                (existing_state == "confirmed" and incoming_state != "confirmed")
                or (existing_state in {"clicked", "unknown"} and incoming_state == "prepared")
            ):
                return get_action(existing_id) or {}
            conn.execute(
                """
                UPDATE actions
                SET action_type = ?, status = ?, job_url = ?, company = ?, title = ?,
                    payload_json = ?, result_json = ?, note = ?, platform = ?, run_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    action.get("action_type", ""),
                    action.get("status", "pending"),
                    action.get("job_url", ""),
                    action.get("company", ""),
                    action.get("title", ""),
                    json.dumps(action.get("payload", {}), ensure_ascii=False),
                    json.dumps(action.get("result", {}), ensure_ascii=False),
                    action.get("note", ""),
                    action.get("platform", "boss"),
                    action.get("run_id", ""),
                    current_time,
                    existing_id,
                ),
            )
            conn.commit()
            return get_action(existing_id) or {}
        cursor = conn.execute(
            """
            INSERT INTO actions (
                action_type, status, job_url, company, title, payload_json,
                result_json, note, platform, idempotency_key, run_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                action.get("action_type", ""),
                action.get("status", "pending"),
                action.get("job_url", ""),
                action.get("company", ""),
                action.get("title", ""),
                json.dumps(action.get("payload", {}), ensure_ascii=False),
                json.dumps(action.get("result", {}), ensure_ascii=False),
                action.get("note", ""),
                action.get("platform", "boss"),
                idempotency_key,
                action.get("run_id", ""),
                current_time,
                current_time,
            ),
        )
        conn.commit()
        action_id = cursor.lastrowid
    return get_action(action_id) or {}


def update_action(action_id: int, status: str, note: str = "", result: dict[str, Any] | None = None) -> dict[str, Any]:
    init_db()
    current_time = now_iso()
    with closing(connect()) as conn:
        conn.execute(
            """
            UPDATE actions
            SET status = ?, note = ?, result_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                note,
                json.dumps(result or {}, ensure_ascii=False),
                current_time,
                action_id,
            ),
        )
        conn.commit()
    return get_action(action_id) or {}


def get_action(action_id: int) -> dict[str, Any] | None:
    init_db()
    with closing(connect()) as conn:
        row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
    return row_to_dict(row) if row else None


def list_pending_actions() -> list[dict[str, Any]]:
    init_db()
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at DESC"
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def list_history(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    init_db()
    with closing(connect()) as conn:
        jobs = conn.execute(
            "SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        actions = conn.execute(
            "SELECT * FROM actions ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return {
        "jobs": [row_to_dict(row) for row in jobs],
        "actions": [row_to_dict(row) for row in actions],
    }


def list_recent_processed_jobs(limit: int = 500, hours: int = 24) -> list[dict[str, Any]]:
    init_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max(1, hours))).isoformat()
    with closing(connect()) as conn:
        rows = conn.execute(
            """
            SELECT url, title, company, platform, external_job_id, identity_key,
                   recommendation, final_action, greeted, applied, application_state, updated_at, error
            FROM jobs
            WHERE url != '' AND updated_at >= ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (cutoff, limit),
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def count_applications(*, run_id: str = "", day: str = "") -> int:
    init_db()
    params: list[Any] = []
    where = "platform = 'zhaopin' AND applied = 1"
    if run_id:
        where += " AND run_id = ?"
        params.append(run_id)
    if day:
        where += " AND substr(updated_at, 1, 10) = ?"
        params.append(day)
    with closing(connect()) as conn:
        row = conn.execute(f"SELECT COUNT(*) AS count FROM jobs WHERE {where}", tuple(params)).fetchone()
    return int(row["count"]) if row else 0


def create_event(event: dict[str, Any]) -> dict[str, Any]:
    init_db()
    current_time = event.get("time") or now_iso()
    safe_message = str(sanitize_log_value(event.get("message", "")) or "")
    safe_detail = sanitize_log_value(event.get("detail", {}))
    with closing(connect()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO events (
                event_type, level, source, message, detail_json, run_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.get("type", "event"),
                event.get("level", "info"),
                event.get("source", "backend"),
                safe_message,
                json.dumps(safe_detail, ensure_ascii=False),
                event.get("run_id", ""),
                current_time,
            ),
        )
        conn.commit()
        event_id = cursor.lastrowid
    stored = dict(event)
    stored["message"] = safe_message
    stored["detail"] = safe_detail
    stored["id"] = event_id
    return stored


def list_events(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    init_db()
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM events ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def upsert_run(run_id: str, *, control: str = "paused", started_at: str = "") -> None:
    if not run_id:
        return
    init_db()
    current_time = now_iso()
    with closing(connect()) as conn:
        if "status" in _table_columns(conn, "runs"):
            conn.execute(
                """
                INSERT INTO runs (run_id, status, started_at, control, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    status=excluded.status,
                    control=excluded.control,
                    updated_at=excluded.updated_at
                """,
                (run_id, control, started_at or current_time, control, current_time),
            )
        else:
            conn.execute(
                """
                INSERT INTO runs (run_id, started_at, control, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    control=excluded.control,
                    updated_at=excluded.updated_at
                """,
                (run_id, started_at or current_time, control, current_time),
            )
        conn.commit()


def reconcile_stale_runs(*, stale_minutes: int = 10, exclude_run_id: str = "") -> dict[str, Any]:
    """Close abandoned run rows without deleting their event history."""
    init_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=max(1, int(stale_minutes)))).isoformat()
    current_time = now_iso()
    params: list[Any] = [cutoff]
    where = "ended_at IS NULL AND updated_at < ?"
    if exclude_run_id:
        where += " AND run_id != ?"
        params.append(exclude_run_id)
    with closing(connect()) as conn:
        rows = conn.execute(
            f"SELECT run_id, updated_at FROM runs WHERE {where} ORDER BY updated_at",
            tuple(params),
        ).fetchall()
        run_ids = [str(row["run_id"]) for row in rows]
        for row in rows:
            ended_at = str(row["updated_at"] or current_time)
            conn.execute(
                """
                UPDATE runs
                SET ended_at = ?, status = 'interrupted', control = 'interrupted', updated_at = ?
                WHERE run_id = ? AND ended_at IS NULL
                """,
                (ended_at, current_time, row["run_id"]),
            )
        conn.commit()
    return {"count": len(run_ids), "run_ids": run_ids, "cutoff": cutoff}


def finish_run(run_id: str, *, control: str = "stopped") -> dict[str, Any]:
    summary = summarize_run(run_id)
    if not run_id:
        return summary
    init_db()
    current_time = now_iso()
    with closing(connect()) as conn:
        if "status" in _table_columns(conn, "runs"):
            conn.execute(
                """
                UPDATE runs
                SET ended_at = ?, status = ?, control = ?, summary_json = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (current_time, control, control, json.dumps(summary, ensure_ascii=False), current_time, run_id),
            )
        else:
            conn.execute(
                """
                UPDATE runs
                SET ended_at = ?, control = ?, summary_json = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (current_time, control, json.dumps(summary, ensure_ascii=False), current_time, run_id),
            )
        conn.commit()
    return summary


def summarize_run(run_id: str) -> dict[str, Any]:
    if not run_id:
        return {}
    init_db()
    with closing(connect()) as conn:
        rows = conn.execute(
            """
            SELECT event_type, level, COUNT(*) AS count
            FROM events
            WHERE run_id = ?
            GROUP BY event_type, level
            """,
            (run_id,),
        ).fetchall()
    counts = {str(row["event_type"]): int(row["count"]) for row in rows}
    error_count = sum(int(row["count"]) for row in rows if row["level"] == "error")
    return {
        "run_id": run_id,
        "event_count": sum(int(row["count"]) for row in rows),
        "error_count": error_count,
        "searches": counts.get("search_started", 0),
        "jobs_analyzed": counts.get("job_analyzed", 0) + counts.get("job_analyze_completed", 0),
        "greet_success": counts.get("greet_success", 0) + counts.get("message_sent", 0),
        "greet_unknown": counts.get("greet_delivery_unknown", 0),
        "apply_success": counts.get("apply_confirmed", 0),
        "apply_unknown": counts.get("apply_delivery_unknown", 0),
        "paused": counts.get("manual_intervention_pause", 0) + counts.get("platform_limit_pause", 0),
        "event_types": counts,
    }


_SALARY_LIKE_RE = re.compile(
    r"(?:\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*以上|\d+(?:\.\d+)?\s*以下)\s*[kK千万]?|面议|薪资open",
    re.IGNORECASE,
)


def _plain_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_invalid_legacy_company_name(company: Any, title: Any = "", salary: Any = "") -> bool:
    """Detect old records where a job title/salary block was stored as company."""
    company_text = _plain_text(company)
    if not company_text:
        return False
    title_text = _plain_text(title)
    salary_text = _plain_text(salary)
    if title_text and salary_text and title_text in company_text and salary_text in company_text:
        return True
    if title_text and company_text == title_text and (_SALARY_LIKE_RE.search(company_text) or _SALARY_LIKE_RE.search(salary_text)):
        return True
    if title_text and title_text in company_text and _SALARY_LIKE_RE.search(company_text):
        return True
    return False


def repair_invalid_company_names(limit: int = 20000) -> dict[str, int]:
    """Clear polluted historical company fields without touching personal data."""
    init_db()
    checked = 0
    repaired = 0
    current_time = now_iso()
    with closing(connect()) as conn:
        rows = conn.execute(
            """
            SELECT id, title, company, salary
            FROM jobs
            WHERE company IS NOT NULL AND TRIM(company) != ''
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (max(1, int(limit)),),
        ).fetchall()
        checked = len(rows)
        bad_ids = [
            int(row["id"])
            for row in rows
            if is_invalid_legacy_company_name(row["company"], row["title"], row["salary"])
        ]
        if bad_ids:
            conn.executemany(
                "UPDATE jobs SET company = '', updated_at = ? WHERE id = ?",
                [(current_time, job_id) for job_id in bad_ids],
            )
            conn.commit()
            repaired = len(bad_ids)
    return {"checked": checked, "repaired": repaired}


def recent_event_counts(hours: int = 24, event_types: list[str] | tuple[str, ...] | None = None) -> dict[str, int]:
    init_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max(1, int(hours)))).isoformat()
    params: list[Any] = [cutoff]
    where = "created_at >= ?"
    if event_types:
        placeholders = ",".join("?" for _ in event_types)
        where += f" AND event_type IN ({placeholders})"
        params.extend(event_types)
    with closing(connect()) as conn:
        rows = conn.execute(
            f"""
            SELECT event_type, COUNT(*) AS count
            FROM events
            WHERE {where}
            GROUP BY event_type
            """,
            tuple(params),
        ).fetchall()
    return {str(row["event_type"]): int(row["count"]) for row in rows}


def prune_old_events(*, normal_days: int = 7, important_days: int = 30) -> dict[str, int]:
    init_db()
    now = datetime.now(timezone.utc)
    normal_cutoff = (now - timedelta(days=max(1, normal_days))).isoformat()
    important_cutoff = (now - timedelta(days=max(normal_days, important_days))).isoformat()
    important_patterns = ("greet%", "manual%", "platform%", "model%", "quota%", "autorun%")
    with closing(connect()) as conn:
        before = int(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0])
        conn.execute("DELETE FROM events WHERE created_at < ?", (important_cutoff,))
        placeholders = " OR ".join("event_type LIKE ?" for _ in important_patterns)
        conn.execute(
            f"""
            DELETE FROM events
            WHERE created_at < ?
              AND level NOT IN ('warning', 'error')
              AND NOT ({placeholders})
            """,
            (normal_cutoff, *important_patterns),
        )
        after = int(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0])
        conn.commit()
    return {"before": before, "after": after, "deleted": before - after}


def database_stats() -> dict[str, Any]:
    init_db()
    db_path = Path(Config.app_db_name)
    with closing(connect()) as conn:
        schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        event_count = int(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0])
        job_count = int(conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0])
        action_count = int(conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0])
        open_run_count = int(conn.execute("SELECT COUNT(*) FROM runs WHERE ended_at IS NULL").fetchone()[0])
        interrupted_run_count = int(conn.execute("SELECT COUNT(*) FROM runs WHERE status = 'interrupted'").fetchone()[0])
        applied_count = int(conn.execute("SELECT COUNT(*) FROM jobs WHERE applied = 1").fetchone()[0])
    return {
        "path": str(db_path),
        "size_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "size_mb": (db_path.stat().st_size / 1024 / 1024) if db_path.exists() else 0.0,
        "schema_version": schema_version,
        "event_count": event_count,
        "job_count": job_count,
        "action_count": action_count,
        "applied_count": applied_count,
        "open_run_count": open_run_count,
        "interrupted_run_count": interrupted_run_count,
    }


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    for key in ("analysis_json", "payload_json", "result_json", "detail_json"):
        if key in data:
            try:
                data[key.replace("_json", "")] = json.loads(data[key] or "{}")
            except json.JSONDecodeError:
                data[key.replace("_json", "")] = {}
            del data[key]
    return data
