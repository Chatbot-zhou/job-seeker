from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest


def _prepare_runtime(tmp_path, monkeypatch, db_name: str) -> None:
    import database
    import main
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / db_name))
    database._INITIALIZED_PATHS.clear()
    monkeypatch.setattr(main.cache, "load", lambda: None)
    monkeypatch.setattr(main.cache, "_profile", {"user_detail": "已确认的用户画像"})
    monkeypatch.setattr(main.runtime_state, "control", "running")
    for platform in ("boss", "zhaopin", "job51"):
        monkeypatch.setitem(main.runtime_state.platform_controls, platform, "running")


def test_job51_is_accepted_by_every_request_schema() -> None:
    from pydantic import ValidationError

    from schema import ActionCreate, ControlUpdate, JobAnalyzeRequest, ScriptHeartbeat

    assert ScriptHeartbeat(platform="job51").platform == "job51"
    assert ActionCreate(action_type="apply", platform="job51").platform == "job51"
    assert ControlUpdate(command="pause", platform="job51").platform == "job51"
    assert JobAnalyzeRequest(platform="job51", title="后端工程师", detail="岗位描述").platform == "job51"

    for model, payload in (
        (ActionCreate, {"action_type": "apply", "platform": "job52"}),
        (ControlUpdate, {"command": "pause", "platform": "job52"}),
        (JobAnalyzeRequest, {"platform": "job52", "title": "后端工程师", "detail": "岗位描述"}),
    ):
        with pytest.raises(ValidationError):
            model(**payload)


def test_job51_analysis_asks_for_apply_and_records_confirmed_application(tmp_path, monkeypatch) -> None:
    import database
    import main
    from schema import ActionCreate, JobAnalyzeRequest

    _prepare_runtime(tmp_path, monkeypatch, "job51-apply.db")

    async def fake_run(*args, **kwargs):
        return {
            "total_score": 88,
            "education_score": 80,
            "skill_score": 90,
            "experience_score": 85,
            "risks": [],
            "recommendation": "greet",
            "match_reason": "技术栈匹配",
            "greeting": "",
        }

    monkeypatch.setattr(main.MODEL_QUEUE, "run", fake_run)
    url = "https://we.51job.com/pc/job/123456"
    analyze = asyncio.run(
        main.jobs_analyze(
            JobAnalyzeRequest(
                platform="job51",
                external_job_id="123456",
                title="AI 应用工程师",
                company="示例云计算有限公司",
                salary="20-30K",
                city="杭州",
                detail="负责 Agent 与 RAG 应用开发",
                url=url,
            )
        )
    )
    assert analyze["analysis"]["platform_action"] == "apply"

    asyncio.run(
        main.create_action(
            ActionCreate(
                action_type="apply",
                status="completed",
                platform="job51",
                external_job_id="123456",
                job_url=url,
                company="示例云计算有限公司",
                title="AI 应用工程师",
                payload={"transactionState": "confirmed"},
            )
        )
    )

    saved = database.get_job(url)
    assert saved and saved["platform"] == "job51"
    assert saved["applied"] == 1
    assert saved["application_state"] == "confirmed"
    assert database.count_applications() == 1
    assert database.count_applications(run_id=str(saved["run_id"])) == 1


def test_job51_unknown_delivery_is_recorded_as_unknown(tmp_path, monkeypatch) -> None:
    import database
    import main
    from schema import ActionCreate

    _prepare_runtime(tmp_path, monkeypatch, "job51-unknown.db")
    url = "https://we.51job.com/pc/job/654321"
    database.upsert_job(
        {"url": url, "platform": "job51", "title": "数据工程师", "company": "示例数据有限公司"},
        {"recommendation": "greet"},
        final_action="applied",
    )

    asyncio.run(
        main.create_action(
            ActionCreate(
                action_type="apply_delivery_unknown",
                status="unknown",
                platform="job51",
                job_url=url,
                company="示例数据有限公司",
                title="数据工程师",
                payload={"transactionState": "unknown"},
            )
        )
    )

    saved = database.get_job(url)
    assert saved and saved["final_action"] == "apply_delivery_unknown"
    assert saved["application_state"] == "unknown"


def test_stale_job51_apply_is_reconciled_to_unknown(tmp_path, monkeypatch) -> None:
    import database
    from config import Config

    monkeypatch.setattr(Config, "app_db_name", str(tmp_path / "job51-reconcile.db"))
    database._INITIALIZED_PATHS.clear()
    url = "https://we.51job.com/pc/job/999999"
    database.upsert_job(
        {"url": url, "platform": "job51", "title": "服务端工程师", "company": "示例网络有限公司"},
        {"recommendation": "greet"},
        final_action="applied",
    )
    action = database.create_action(
        {
            "platform": "job51",
            "action_type": "apply",
            "status": "clicked",
            "run_id": "run-job51-reconcile",
            "job_url": url,
            "payload": {"transactionState": "clicked"},
        }
    )

    stale = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    with sqlite3.connect(tmp_path / "job51-reconcile.db") as conn:
        conn.execute(
            "UPDATE actions SET status = 'clicked', updated_at = ? WHERE id = ?",
            (stale, int(action["id"])),
        )
        conn.execute("UPDATE jobs SET application_state = 'clicked' WHERE url = ?", (url,))
        conn.commit()

    result = database.reconcile_stale_application_actions(stale_minutes=10)

    assert result["count"] == 1
    assert result["job_urls"] == [url]
    saved = database.get_job(url)
    assert saved and saved["application_state"] == "unknown"
    assert saved["final_action"] == "apply_delivery_unknown"


def test_job51_control_pauses_only_the_job51_channel(tmp_path, monkeypatch) -> None:
    import main
    from schema import ControlUpdate

    _prepare_runtime(tmp_path, monkeypatch, "job51-control.db")
    main.runtime_state.set_control("resume")

    body = asyncio.run(
        main.control(ControlUpdate(command="pause", platform="job51", reason="验证码"))
    )

    assert body["platforms"]["job51"]["effective_control"] == "paused"
    assert body["platforms"]["job51"]["pause_reason"] == "验证码"
    assert body["platforms"]["boss"]["effective_control"] == "running"
    assert body["platforms"]["zhaopin"]["effective_control"] == "running"

    resumed = asyncio.run(main.control(ControlUpdate(command="resume", platform="job51")))
    assert resumed["platforms"]["job51"]["effective_control"] == "running"


def test_job51_session_walks_the_whole_userscript_path(tmp_path, monkeypatch) -> None:
    """模拟前程无忧脚本的真实调用顺序：装脚本 → 心跳 → 读配置 → 读近期职位。"""
    from fastapi.testclient import TestClient

    import database
    import main
    from config import Config

    _prepare_runtime(tmp_path, monkeypatch, "job51-session.db")
    url = "https://we.51job.com/pc/job/246810"
    database.upsert_job(
        {"url": url, "platform": "job51", "title": "算法工程师", "company": "示例智能有限公司"},
        {"recommendation": "greet"},
        final_action="applied",
    )
    database.upsert_job(
        {"url": "https://www.zhipin.com/job_detail/111", "platform": "boss", "title": "后端工程师"},
        {"recommendation": "greet"},
        final_action="greeted",
    )

    with TestClient(main.app) as client:
        script = client.get("/userscripts/job51.user.js")
        assert script.status_code == 200
        assert "charset=utf-8" in script.headers["content-type"].lower()
        assert "@description  Job Seeker 前程无忧通道" in script.text
        assert "@match        https://we.51job.com/*" in script.text
        assert "@connect      127.0.0.1" in script.text
        assert "@updateURL    http://127.0.0.1:33333/userscripts/job51.user.js" in script.text

        before = client.get("/status").json()["platforms"]
        heartbeat = client.post(
            "/script/heartbeat",
            json={
                "platform": "job51",
                "page_kind": "list",
                "page": "search",
                "status": "running",
                "current_action": "等待岗位列表",
                "detail": {"pageNumber": 2, "pageTurnCount": 1, "pageJobCountBefore": 30},
            },
        )
        assert heartbeat.status_code == 200
        body = heartbeat.json()
        assert body["ok"] is True
        assert body["platform"] == "job51"
        assert body["platform_control"] == "running"
        assert body["should_start"] is True
        assert "job51_enabled" in body["config"]

        status = client.get("/status").json()
        job51_script = status["platforms"]["job51"]
        assert job51_script["connected"] is True
        assert job51_script["page_kind"] == "list"
        assert job51_script["detail"]["pageNumber"] == 2
        assert job51_script["detail"]["platform"] == "job51"
        # 前程无忧的心跳不能污染其它平台的脚本状态（runtime_state 是进程级单例，
        # 其它测试可能已让 BOSS 在线，所以比对心跳前后不变，而不是断言离线；
        # last_seen 是写入的固定时间戳，只有该平台真的收到心跳才会动）。
        identity_keys = ("page", "page_kind", "instance_id", "last_seen")
        for platform in ("boss", "zhaopin"):
            after = status["platforms"][platform]
            assert {key: after[key] for key in identity_keys} == {
                key: before[platform][key] for key in identity_keys
            }
        # 多平台同开时旧的顶层 script 字段仍代表 BOSS，平台数据一律看 platforms。
        assert status["script"]["platform"] == "boss"

        config = client.get("/config").json()["config"]
        assert "job51_job_urls" in config
        assert "job51_resume_name" in config

        recent = client.get("/jobs/recent", params={"platform": "job51"}).json()["jobs"]
        assert [job["url"] for job in recent] == [url]

    # 只开前程无忧时，顶层 script 字段要跟随前程无忧，否则单独跑 51job 会看到空的脚本状态。
    # Config.load() 在 lifespan 里会重刷配置，所以要在启动之后再改开关。
    with TestClient(main.app) as client:
        monkeypatch.setattr(Config, "boss_enabled", False)
        monkeypatch.setattr(Config, "zhaopin_enabled", False)
        client.post(
            "/script/heartbeat",
            json={"platform": "job51", "page_kind": "list", "page": "search", "status": "running"},
        )
        solo = client.get("/status").json()

    assert solo["script"]["platform"] == "job51"
    assert solo["script"]["connected"] is True
