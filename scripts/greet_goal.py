"""Long-running, guarded BOSS greeting goal runner.

Target: N successful BOSS-native greetings in the current local day.
The runner starts the BOSS channel, records every event, evaluates every five
analyzed jobs, and pauses immediately on quality/platform anomalies.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from job_round import api, evaluate, fetch_new_events  # noqa: E402

DB_PATH = ROOT / "data" / "app.db"
OUT_DIR = ROOT / "data" / "evals" / "goal-100"

CRITICAL_EVENTS = {
    "manual_intervention",
    "platform_limit",
    "greet_entry_rejected",
    "backend_unavailable_pause",
    "loop_failed",
    "page_failure",
    "userscript_version_blocked",
    "greet_failed",
    "greet_unavailable",
}
STOP_EVENTS = {"session_end", "script_stopped"}


def local_day_start_utc() -> str:
    now = datetime.now().astimezone()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()


def count_today_greets() -> int:
    con = sqlite3.connect(DB_PATH)
    row = con.execute(
        """
        select count(*) from actions
        where action_type='greet'
          and created_at >= ?
          and json_extract(payload_json, '$.mode') = 'boss_native'
        """,
        (local_day_start_utc(),),
    ).fetchone()
    con.close()
    return int(row[0] or 0)


def latest_job_rows(after_id: int) -> list[dict[str, Any]]:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = [
        dict(row)
        for row in con.execute("select * from jobs where id > ? order by id", (after_id,))
    ]
    con.close()
    return rows


def pause_and_stop(reason: str) -> None:
    try:
        api("/control", {"command": "pause", "platform": "boss", "reason": reason})
        time.sleep(1)
        api("/control", {"command": "stop", "reason": reason})
    except Exception as exc:
        print("STOP_ERROR", exc)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=100)
    parser.add_argument("--batch", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=10800)
    parser.add_argument("--stall-seconds", type=int, default=240)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S")
    event_path = OUT_DIR / f"events-{stamp}.jsonl"
    summary_path = OUT_DIR / f"summary-{stamp}.json"
    batch_dir = OUT_DIR / f"batches-{stamp}"
    batch_dir.mkdir(parents=True, exist_ok=True)

    starting_today = count_today_greets()
    target = args.target
    if starting_today >= target:
        print("ALREADY_DONE", starting_today)
        return 0

    baseline_events = api("/events?limit=1").get("events") or []
    baseline_event_id = int(baseline_events[0]["id"]) if baseline_events else 0
    con = sqlite3.connect(DB_PATH)
    baseline_job_id = con.execute("select coalesce(max(id),0) from jobs").fetchone()[0]
    con.close()

    start_payload = api(
        "/control",
        {"command": "start", "platform": "boss", "reason": "daily-100-greets"},
    )
    run_id = start_payload.get("run_id") or ""
    print("START", json.dumps({"run_id": run_id, "today": starting_today, "target": target, "event": baseline_event_id}, ensure_ascii=False))

    seen: set[int] = set()
    all_events: list[dict[str, Any]] = []
    batch_index = 0
    last_analyzed_total = 0
    last_event_at = time.time()
    started = time.time()
    exit_reason = ""
    exit_code = 0

    def write_event(event: dict[str, Any]) -> None:
        with event_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    try:
        while time.time() - started < args.timeout:
            fresh = fetch_new_events(baseline_event_id, seen)
            for event in fresh:
                all_events.append(event)
                write_event(event)
                last_event_at = time.time()
                etype = event.get("event_type")
                message = str(event.get("message") or "")[:180]
                print("EVENT", event.get("id"), etype, "|", message)

                if etype in CRITICAL_EVENTS:
                    # A single rejected greet may be a one-off; repeated entry rejections are not.
                    if etype == "greet_failed" and "greet_delivery_unknown" not in message:
                        continue
                    exit_reason = f"critical_event:{etype}:{message}"
                    exit_code = 3
                    break
                if etype in STOP_EVENTS:
                    exit_reason = f"script_stopped:{etype}"
                    exit_code = 4
                    break
                if "quota_reminder" in str(etype) and "detected" in str(etype):
                    exit_reason = f"quota_event:{message}"
                    exit_code = 3
                    break

            if exit_reason:
                break

            # Periodically re-read the authoritative daily action count.
            today_count = count_today_greets()
            if today_count >= target:
                exit_reason = f"target_reached:{today_count}"
                exit_code = 0
                break

            jobs = latest_job_rows(baseline_job_id)
            analyzed_total = len(jobs)
            if analyzed_total >= last_analyzed_total + args.batch:
                last_analyzed_total = analyzed_total
                batch_index += 1
                batch_jobs = jobs[-args.batch:]
                profile = api("/resume/profile")
                evaluation = evaluate(batch_jobs, 70, profile.get("user_detail") or "")
                batch_record = {
                    "batch": batch_index,
                    "at": datetime.now(timezone.utc).isoformat(),
                    "today_greets": today_count,
                    "analysis": evaluation,
                    "jobs": [
                        {key: job.get(key) for key in ("id", "title", "company", "recommendation", "greeted", "final_action", "error")}
                        for job in batch_jobs
                    ],
                }
                batch_path = batch_dir / f"batch-{batch_index:02d}.json"
                batch_path.write_text(json.dumps(batch_record, ensure_ascii=False, indent=2), encoding="utf-8")
                print("BATCH", batch_index, json.dumps({k: evaluation[k] for k in ("score", "passed", "checks", "hard_constraint_false_positive")}, ensure_ascii=False))
                critical_checks = (
                    evaluation["checks"]["all_five_valid"],
                    evaluation["checks"]["no_cross_track_false_positive"],
                    evaluation["checks"]["no_hard_constraint_false_positive"],
                    evaluation["checks"]["no_analysis_errors"],
                )
                if not all(critical_checks):
                    exit_reason = f"quality_gate_batch_{batch_index}"
                    exit_code = 2
                    break
                if evaluation["very_high_count"] >= 5:
                    exit_reason = f"score_inflation_batch_{batch_index}"
                    exit_code = 2
                    break

            if time.time() - last_event_at > args.stall_seconds:
                status = api("/status")
                script = status.get("script") or {}
                exit_reason = f"stalled:{script.get('status')}:{script.get('current_action')}"
                exit_code = 4
                break

            time.sleep(1)
        else:
            exit_reason = "timeout"
            exit_code = 4
    finally:
        pause_and_stop(exit_reason or "goal_runner_end")

    final_today = count_today_greets()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    recent_actions = [
        dict(row)
        for row in con.execute(
            "select id,action_type,status,title,company,run_id,payload_json,created_at from actions where action_type='greet' and created_at >= ? order by id",
            (local_day_start_utc(),),
        )
    ]
    con.close()
    summary = {
        "target": target,
        "starting_today": starting_today,
        "final_today": final_today,
        "run_id": run_id,
        "exit_reason": exit_reason,
        "exit_code": exit_code,
        "batches": batch_index,
        "event_count": len(all_events),
        "today_actions": recent_actions,
        "event_path": str(event_path),
        "batch_dir": str(batch_dir),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY", json.dumps({k: summary[k] for k in ("starting_today", "final_today", "target", "exit_reason", "batches")}, ensure_ascii=False))
    print("WROTE", summary_path)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
