from __future__ import annotations

import asyncio
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest


def test_platform_config_and_model_concurrency_profile_are_normalized() -> None:
    from config import Config, model_concurrency_fingerprint

    original = Config.as_dict()
    try:
        changed = {
            **original,
            "zhaopin_job_urls": [
                "https://www.zhaopin.com/recommend?city=489#top",
                "https://evil.example/jobs",
            ],
            "zhaopin_apply_delay_min_seconds": 1,
            "zhaopin_apply_delay_max_seconds": 2,
            "model_max_concurrency": 2,
            "model_concurrency_profile": "stale-profile",
        }
        Config.apply(changed)
        assert Config.zhaopin_job_urls == ["https://www.zhaopin.com/recommend?city=489"]
        assert Config.zhaopin_apply_delay_min_seconds == 3
        assert Config.zhaopin_apply_delay_max_seconds == 3
        assert Config.model_max_concurrency == 1

        changed["model_concurrency_profile"] = model_concurrency_fingerprint(changed)
        Config.apply(changed)
        assert Config.model_max_concurrency == 2

        changed["think_model"] = f"{changed['think_model']}-changed"
        Config.apply(changed)
        assert Config.model_max_concurrency == 1
    finally:
        Config.apply(original)


def test_runtime_platform_pause_is_isolated_and_global_pause_wins(tmp_path, monkeypatch) -> None:
    import database
    from config import Config
    from runtime_state import RuntimeState

    original = Config.as_dict()
    try:
        monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "runtime-control.db"))
        database._INITIALIZED_PATHS.clear()
        Config.apply({**original, "boss_enabled": True, "zhaopin_enabled": True})
        state = RuntimeState()
        monkeypatch.setattr(state, "emit", lambda *args, **kwargs: {})
        state.set_control("resume")
        original_generation = state.platform_generation("zhaopin")
        state.set_platform_control("zhaopin", "pause", "需要人工验证")
        assert state.platform_control("boss") == "running"
        assert state.platform_control("zhaopin") == "paused"
        assert state.platform_snapshots()["zhaopin"]["pause_reason"] == "需要人工验证"
        assert state.platform_generation("zhaopin") == original_generation + 1

        state.set_control("pause")
        assert state.platform_control("boss") == "paused"
        assert state.platform_control("zhaopin") == "paused"
        state.set_control("resume")
        assert state.platform_control("boss") == "running"
        assert state.platform_control("zhaopin") == "paused"
        state.set_platform_control("zhaopin", "resume")
        assert state.platform_control("zhaopin") == "running"
        assert state.platform_generation("zhaopin") > original_generation
    finally:
        Config.apply(original)


def test_model_queue_fifo_limit_and_platform_cancellation() -> None:
    from model_queue import FairModelQueue, ModelQueueCancelled

    async def scenario() -> None:
        queue = FairModelQueue(lambda: 1)
        executor = ThreadPoolExecutor(max_workers=2)
        release_first = threading.Event()
        order: list[str] = []

        def first() -> str:
            order.append("boss")
            release_first.wait(2)
            return "first"

        first_task = asyncio.create_task(queue.run("boss", executor, first))
        await asyncio.sleep(0.05)
        second_task = asyncio.create_task(queue.acquire("zhaopin"))
        await asyncio.sleep(0.05)
        assert queue.snapshot()["active"] == 1
        assert queue.snapshot()["queued_by_platform"] == {"zhaopin": 1}
        assert await queue.cancel_platform("zhaopin", "智联暂停") == 1
        with pytest.raises(ModelQueueCancelled, match="智联暂停"):
            await second_task
        release_first.set()
        assert await first_task == "first"
        assert order == ["boss"]
        executor.shutdown(wait=True)

    asyncio.run(scenario())


def test_v6_jobs_and_apply_actions_are_idempotent(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    db_path = tmp_path / "dual-platform.db"
    monkeypatch.setattr(Config, "app_db_name", str(db_path))
    database._INITIALIZED_PATHS.clear()
    database.init_db()

    with sqlite3.connect(db_path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 6
        job_columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
        action_columns = {row[1] for row in conn.execute("PRAGMA table_info(actions)")}
    assert {"platform", "external_job_id", "identity_key", "application_state", "applied"} <= job_columns
    assert {"platform", "idempotency_key"} <= action_columns

    job_url = "https://www.zhaopin.com/jobdetail/CC123.htm"
    job = database.upsert_job(
        {
            "url": job_url,
            "title": "Python 开发工程师",
            "company": "示例科技有限公司",
            "platform": "zhaopin",
            "external_job_id": "CC123",
            "run_id": "run-zhaopin",
        }
    )
    assert job["platform"] == "zhaopin"
    assert database.get_job_by_identity(job["identity_key"], exclude_platform="boss")["url"] == job_url

    prepared = database.create_action(
        {
            "action_type": "apply",
            "status": "pending",
            "job_url": job_url,
            "platform": "zhaopin",
            "idempotency_key": "zhaopin:CC123:apply",
            "payload": {"transactionState": "prepared"},
        }
    )
    confirmed = database.create_action(
        {
            "action_type": "apply",
            "status": "completed",
            "job_url": job_url,
            "platform": "zhaopin",
            "idempotency_key": "zhaopin:CC123:apply",
            "payload": {"transactionState": "confirmed"},
        }
    )
    assert confirmed["id"] == prepared["id"]
    regressed = database.create_action(
        {
            "action_type": "apply",
            "status": "prepared",
            "job_url": job_url,
            "platform": "zhaopin",
            "idempotency_key": "zhaopin:CC123:apply",
            "payload": {"transactionState": "prepared"},
        }
    )
    assert regressed["status"] == "completed"
    assert regressed["payload"]["transactionState"] == "confirmed"
    database.update_job_status(job_url, applied=True, application_state="confirmed", final_action="apply_success")
    saved = database.get_job(job_url)
    assert saved and saved["applied"] == 1 and saved["application_state"] == "confirmed"
    assert database.count_applications(run_id="run-zhaopin") == 1


def test_cross_platform_same_company_title_is_deduplicated(tmp_path, monkeypatch) -> None:
    import database
    import main
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "cross-platform.db"))
    monkeypatch.setattr(Config, "skip_contacted_companies", True)
    database._INITIALIZED_PATHS.clear()
    database.upsert_job(
        {
            "url": "https://www.zhipin.com/job_detail/boss-1.html",
            "title": "算法工程师",
            "company": "示例科技",
            "platform": "boss",
        },
        {"recommendation": "skip", "total_score": 70},
        final_action="score_below_threshold",
    )
    incoming = {
        "url": "https://www.zhaopin.com/jobdetail/zl-1.htm",
        "title": "算法工程师",
        "company": "示例科技",
        "platform": "zhaopin",
        "identity_key": database.normalize_job_identity("示例科技", "算法工程师"),
    }
    assert "其他平台" in main.blocked_by_history(incoming, None)


def test_unknown_application_blocks_reclick_even_when_general_history_skip_is_disabled(tmp_path, monkeypatch) -> None:
    import database
    import main
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "unknown-application.db"))
    monkeypatch.setattr(Config, "skip_contacted_companies", False)
    database._INITIALIZED_PATHS.clear()
    url = "https://www.zhaopin.com/jobdetail/unknown.htm"
    database.upsert_job({"url": url, "title": "测试", "company": "示例", "platform": "zhaopin"})
    database.update_job_status(url, application_state="unknown", final_action="apply_delivery_unknown")
    existing = database.get_job(url)
    assert "禁止重复点击" in main.blocked_by_history({"url": url, "platform": "zhaopin"}, existing)


def test_already_applied_action_creates_job_history(tmp_path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    import database
    import main
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "already-applied.db"))
    database._INITIALIZED_PATHS.clear()
    url = "https://www.zhaopin.com/jobdetail/already.htm"
    with TestClient(main.app) as client:
        response = client.post(
            "/actions",
            json={
                "action_type": "already_applied",
                "status": "confirmed",
                "platform": "zhaopin",
                "idempotency_key": "zhaopin:already:apply",
                "external_job_id": "already",
                "job_url": url,
                "company": "示例科技",
                "title": "平台工程师",
                "payload": {"transactionState": "confirmed"},
            },
        )
    assert response.status_code == 200
    saved = database.get_job(url)
    assert saved and saved["applied"] == 1
    assert saved["external_job_id"] == "already"
