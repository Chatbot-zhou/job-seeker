"""Run and score five generation candidates for the onboarding flow.

Records every raw output, latency, grounding warning and deterministic quality
metric under data/evals/.  This is the repeatable companion to the manual UI
flow test.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:33333"
OUT_DIR = ROOT / "data" / "evals"

INTENT_HINTS = ("ai应用", "大模型", "agent", "rag", "llm", "算法")
GREETING_GREETINGS = ("您好", "你好", "hi", "hello")
GREETING_CLOSINGS = ("期待", "希望", "谢谢", "感谢")


def api(path: str, data: dict[str, Any] | None = None, timeout: int = 180) -> dict[str, Any]:
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


def score_tags(tags: list[str], resume: str) -> dict[str, Any]:
    resume_lower = resume.lower()
    grounded = [tag for tag in tags if tag.lower() in resume_lower]
    intent = [tag for tag in tags if any(hint in tag.lower() for hint in INTENT_HINTS)]
    checks = {
        "count_1_to_5": 1 <= len(tags) <= 5,
        "all_grounded": len(grounded) == len(tags),
        "has_job_intent": bool(intent),
        "no_duplicates": len(set(tags)) == len(tags),
    }
    return {"checks": checks, "score": round(100 * sum(checks.values()) / len(checks)), "grounded": grounded}


def score_profile(result: dict[str, Any], resume: str) -> dict[str, Any]:
    detail = str(result.get("user_detail") or "")
    warnings = result.get("grounding_warnings") or []
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    stack_line = next((line for line in lines if line.startswith("技术栈")), "")
    stack = [item.strip() for item in stack_line.split(":", 1)[-1].split(";") if item.strip()]
    project_section = detail.split("项目经验:", 1)[-1] if "项目经验:" in detail else ""
    project_count = len(re.findall(r"^\[[^\]]+\]", project_section, flags=re.MULTILINE))
    privacy = re.search(r"1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.\w+|微信|年龄[:：]", detail)
    checks = {
        "no_grounding_warnings": not warnings,
        "required_sections": all(key in detail for key in ("学历专业:", "技术栈:", "项目经验:")),
        "stack_compact": 0 < len(stack) <= 24,
        "projects_1_to_3": 1 <= project_count <= 3,
        "no_privacy": not privacy,
    }
    return {
        "checks": checks,
        "score": round(100 * sum(checks.values()) / len(checks)),
        "warnings": warnings,
        "stack_count": len(stack),
        "project_count": project_count,
    }


def score_greeting(content: str, profile_detail: str) -> dict[str, Any]:
    text = str(content or "").strip()
    profile_lower = profile_detail.lower()
    tech_terms = re.findall(r"[A-Za-z][A-Za-z0-9.+-]{2,}", text)
    grounded_terms = [term for term in tech_terms if term.lower() in profile_lower]
    checks = {
        "length_60_to_80": 60 <= len(text) <= 80,
        "single_line": "\n" not in text,
        "has_greeting": any(mark in text.lower() for mark in GREETING_GREETINGS),
        "has_education": "本科" in text or "硕士" in text or "计算机" in text,
        "has_project_or_tech": any(term.lower() in profile_lower for term in tech_terms) or "项目" in text,
        "has_closing": any(mark in text for mark in GREETING_CLOSINGS),
        "tech_terms_grounded": bool(tech_terms) and len(grounded_terms) == len(tech_terms),
    }
    return {"checks": checks, "score": round(100 * sum(checks.values()) / len(checks)), "chars": len(text)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="manual")
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    resume = api("/resume")["markdown"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT_DIR / f"generation-{args.label}-{stamp}.jsonl"

    profile_runs: list[dict[str, Any]] = []
    for index in range(1, args.runs + 1):
        started = time.time()
        result = api("/resume/profile/generate", {})
        metric = score_profile(result, resume)
        record = {
            "stage": "profile",
            "run": index,
            "latency": round(time.time() - started, 2),
            "tags": result.get("tags") or [],
            "user_detail": result.get("user_detail") or "",
            "warnings": result.get("grounding_warnings") or [],
            "metric": metric,
            "tag_metric": score_tags(result.get("tags") or [], resume),
        }
        profile_runs.append(record)
        print("PROFILE", index, metric["score"], metric["checks"], record["tag_metric"]["score"])

    latest_profile = profile_runs[-1]["user_detail"]
    greeting_runs: list[dict[str, Any]] = []
    for index in range(1, args.runs + 1):
        started = time.time()
        result = api("/greeting/generate", {"style": "default"})
        content = result.get("content") or ""
        metric = score_greeting(content, latest_profile)
        record = {
            "stage": "greeting",
            "run": index,
            "latency": round(time.time() - started, 2),
            "content": content,
            "privacy": result.get("privacy_findings") or [],
            "metric": metric,
        }
        greeting_runs.append(record)
        print("GREETING", index, metric["score"], metric["checks"], metric["chars"])

    with path.open("w", encoding="utf-8") as handle:
        for record in profile_runs + greeting_runs:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    summary = {
        "label": args.label,
        "runs": args.runs,
        "profile_scores": [item["metric"]["score"] for item in profile_runs],
        "greeting_scores": [item["metric"]["score"] for item in greeting_runs],
        "profile_warnings": [item["warnings"] for item in profile_runs],
        "greeting_chars": [item["metric"]["chars"] for item in greeting_runs],
        "latest_profile_passed": all(profile_runs[-1]["metric"]["checks"].values()),
        "latest_greeting_passed": all(greeting_runs[-1]["metric"]["checks"].values()),
        "path": str(path),
    }
    summary_path = path.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY", json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
