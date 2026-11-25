"""Run one controlled BOSS job-analysis round and record every node.

This script is intentionally API/DB based: it does not drive the browser.  The
Tampermonkey controller on the BOSS jobs page performs the real clicks, while
this script starts the round, records events, pauses after N analyzed jobs, and
writes an auditable JSON snapshot for prompt tuning.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:33333"
DB_PATH = ROOT / "data" / "app.db"
OUT_DIR = ROOT / "data" / "evals"
PROMPT_PATH = ROOT / "prompts.py"

CROSS_TRACK_HINTS = (
    "java", "spring", "springboot", "mybatis", "前端", "vue", "react",
    "angular", "测试工程师", "自动化测试", "运维", "devops", "kubernetes",
    "产品经理", "ui设计", "销售", "客服", "配送", "骑手",
)
AI_HINTS = (
    "ai", "大模型", "llm", "rag", "agent", "langchain", "langgraph",
    "prompt", "算法", "机器学习", "深度学习", "nlp", "智能体", "多模态",
)


def api(path: str, data: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    body = None
    headers: dict[str, str] = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        BASE + path,
        data=body,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_new_events(after_id: int, seen: set[int]) -> list[dict[str, Any]]:
    payload = api("/events?limit=200")
    fresh = []
    for event in reversed(payload.get("events") or []):
        event_id = int(event.get("id") or 0)
        if event_id <= after_id or event_id in seen:
            continue
        seen.add(event_id)
        fresh.append(event)
    return fresh


def db_rows(job_ids: list[int]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not job_ids:
        return [], []
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    marks = ",".join("?" for _ in job_ids)
    jobs = [dict(row) for row in con.execute(f"select * from jobs where id in ({marks}) order by id", job_ids)]
    actions = [
        dict(row)
        for row in con.execute(
            f"select * from actions where job_url in (select url from jobs where id in ({marks})) order by id",
            job_ids,
        )
    ]
    con.close()
    return jobs, actions


def prompt_sha() -> str:
    return hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest()


def evaluate(jobs: list[dict[str, Any]], threshold: int, profile_detail: str) -> dict[str, Any]:
    candidate_has_master = any(term in profile_detail for term in ("硕士", "研究生", "博士"))
    candidate_has_2027 = "2027" in profile_detail
    rows: list[dict[str, Any]] = []
    for job in jobs:
        analysis = {}
        try:
            analysis = json.loads(job.get("analysis_json") or "{}")
        except json.JSONDecodeError:
            pass
        detail = str(job.get("detail") or "")
        haystack = f"{job.get('title') or ''}\n{detail}".lower()
        cross_track = any(hint in haystack for hint in CROSS_TRACK_HINTS)
        ai_track = any(hint in haystack for hint in AI_HINTS)
        master_required = bool(re.search(r"(硕士|研究生|博士)\s*(及以上|以上|学历)", detail))
        campus_limited = bool(re.search(r"(20(?:2[7-9]|3\d)届|校招|仅限应届|只招应届)", detail))
        hard_mismatch = (
            (master_required and not candidate_has_master)
            or (campus_limited and not candidate_has_2027)
        )
        total = analysis.get("total_score")
        recommendation = str(analysis.get("recommendation") or job.get("recommendation") or "")
        scores = {
            "education": analysis.get("education_score"),
            "skill": analysis.get("skill_score"),
            "experience": analysis.get("experience_score"),
        }
        valid_scores = all(isinstance(value, int) and 0 <= value <= 100 for value in scores.values())
        weighted = (
            int(round(scores["skill"] * 0.5 + scores["experience"] * 0.35 + scores["education"] * 0.15))
            if valid_scores
            else None
        )
        rows.append(
            {
                "id": job.get("id"),
                "title": job.get("title"),
                "company": job.get("company"),
                "total_score": total,
                "scores": scores,
                "weighted": weighted,
                "recommendation": recommendation,
                "cross_track": cross_track,
                "ai_track": ai_track,
                "master_required": master_required,
                "campus_limited": campus_limited,
                "hard_mismatch": hard_mismatch,
                "valid_scores": valid_scores,
                "recommendation_consistent": (
                    recommendation == ("greet" if isinstance(total, int) and total >= threshold else "skip")
                ),
                "reason": analysis.get("match_reason") or "",
                "risks": analysis.get("risks") or [],
                "detail_chars": len(detail),
                "greeted": bool(job.get("greeted")),
                "error": job.get("error") or "",
            }
        )
    valid_count = sum(1 for row in rows if row["valid_scores"] and row["recommendation_consistent"])
    cross_false_positive = [
        row for row in rows
        if row["cross_track"] and not row["ai_track"] and (row["total_score"] or 0) >= threshold
    ]
    hard_constraint_false_positive = [
        row for row in rows if row["hard_mismatch"] and (row["total_score"] or 0) >= threshold
    ]
    distinct_scores = len({row["total_score"] for row in rows if isinstance(row["total_score"], int)})
    very_high = [row for row in rows if (row["total_score"] or 0) >= 95]
    errors = [row for row in rows if row["error"]]
    checks = {
        "all_five_valid": valid_count == 5 and len(rows) == 5,
        "no_cross_track_false_positive": not cross_false_positive,
        "no_hard_constraint_false_positive": not hard_constraint_false_positive,
        "score_spread": distinct_scores >= 3,
        "not_score_inflated": len(very_high) <= 2,
        "no_analysis_errors": not errors,
        "all_have_detail": all(row["detail_chars"] > 80 for row in rows),
    }
    score = int(round(100 * sum(1 for value in checks.values() if value) / len(checks)))
    return {
        "threshold": threshold,
        "candidate_has_master": candidate_has_master,
        "candidate_has_2027": candidate_has_2027,
        "rows": rows,
        "checks": checks,
        "score": score,
        "valid_count": valid_count,
        "distinct_scores": distinct_scores,
        "very_high_count": len(very_high),
        "cross_track_false_positive": [row["title"] for row in cross_false_positive],
        "hard_constraint_false_positive": [row["title"] for row in hard_constraint_false_positive],
        "errors": [row["title"] for row in errors],
        "passed": score >= 90 and all(checks.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    round_dir = OUT_DIR / f"jobs-round-{args.round}"
    round_dir.mkdir(parents=True, exist_ok=True)

    baseline_events = api("/events?limit=1").get("events") or []
    baseline_event_id = int(baseline_events[0]["id"]) if baseline_events else 0
    baseline_status = api("/status")
    baseline_job_max = 0
    con = sqlite3.connect(DB_PATH)
    baseline_job_max = con.execute("select coalesce(max(id),0) from jobs").fetchone()[0]
    con.close()

    started_at = datetime.now(timezone.utc).isoformat()
    start_payload = api(
        "/control",
        {"command": "start", "platform": "boss", "reason": f"e2e-round-{args.round}"},
    )
    run_id = start_payload.get("run_id") or ""
    print("STARTED", {"run_id": run_id, "baseline_event": baseline_event_id, "baseline_job": baseline_job_max})

    seen: set[int] = set()
    events: list[dict[str, Any]] = []
    analyzed = 0
    stop_reason = ""
    started = time.time()
    while time.time() - started < args.timeout:
        fresh = fetch_new_events(baseline_event_id, seen)
        for event in fresh:
            events.append(event)
            etype = event.get("event_type")
            message = str(event.get("message") or "")[:140]
            print("EVENT", event.get("id"), etype, "|", message)
            if etype == "job_analysis_finished":
                analyzed += 1
            if etype in {"loop_failed", "platform_limit", "greet_entry_rejected", "backend_unavailable_pause"}:
                stop_reason = etype
        if analyzed >= args.limit or stop_reason:
            break
        time.sleep(1)

    # Pause the platform first, then stop the global run so the next round gets a fresh run id.
    api("/control", {"command": "pause", "platform": "boss", "reason": "e2e_round_limit"})
    time.sleep(1.5)
    api("/control", {"command": "stop", "reason": "e2e_round_limit"})
    time.sleep(1)

    final_status = api("/status")
    profile = api("/resume/profile")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    job_ids = [
        int(row["id"])
        for row in con.execute("select id from jobs where id > ? order by id", (baseline_job_max,))
    ]
    con.close()
    jobs, actions = db_rows(job_ids)
    script_detail = (final_status.get("script") or {}).get("detail") or {}
    threshold = int(script_detail.get("threshold") or 70)
    eval_result = evaluate(jobs, threshold, profile.get("user_detail") or "")
    record = {
        "round": args.round,
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "baseline_event_id": baseline_event_id,
        "baseline_job_id": baseline_job_max,
        "analyzed_count": analyzed,
        "stop_reason": stop_reason or "limit_reached",
        "prompt_sha256": prompt_sha(),
        "model": (final_status.get("models") or {}),
        "profile": profile,
        "events": events,
        "jobs": jobs,
        "actions": actions,
        "evaluation": eval_result,
    }
    path = round_dir / f"round-{args.round}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", path)
    print("EVAL", json.dumps({k: eval_result[k] for k in ("score", "passed", "checks", "distinct_scores", "very_high_count", "cross_track_false_positive", "hard_constraint_false_positive")}, ensure_ascii=False))
    for row in eval_result["rows"]:
        print("JOB", row["total_score"], row["recommendation"], row["title"], "/", row["company"], row["scores"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
