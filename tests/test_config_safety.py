from __future__ import annotations


def test_search_safety_limits_are_normalized() -> None:
    from config import Config

    original = Config.as_dict()
    try:
        Config.apply(
            {
                **original,
                "search_round_cooldown_min_minutes": 0,
                "search_round_cooldown_minutes": 0,
                "tag_search_delay_seconds": 1,
                "tag_search_delay_max_seconds": 1,
                "max_search_submissions_per_hour": 9,
                "max_search_submissions_per_day": 3,
            }
        )
        assert Config.search_round_cooldown_min_minutes == 1
        assert Config.search_round_cooldown_minutes == 1
        assert Config.tag_search_delay_seconds == 3
        assert Config.tag_search_delay_max_seconds == 3
        assert Config.max_search_submissions_per_hour == 9
        assert Config.max_search_submissions_per_day == 9
    finally:
        Config.apply(original)


def test_search_safety_defaults_are_conservative() -> None:
    from config import DEFAULT_CONFIG

    assert DEFAULT_CONFIG["search_round_cooldown_min_minutes"] == 1
    assert DEFAULT_CONFIG["search_round_cooldown_minutes"] == 5
    assert DEFAULT_CONFIG["tag_search_delay_seconds"] == 20
    assert DEFAULT_CONFIG["tag_search_delay_max_seconds"] == 45
    assert DEFAULT_CONFIG["max_search_submissions_per_hour"] == 6
    assert DEFAULT_CONFIG["max_search_submissions_per_day"] == 30
    assert DEFAULT_CONFIG["search_result_scroll_rounds"] == 20
    assert DEFAULT_CONFIG["preferred_feed_max_jobs_per_tab"] == 0
    assert "session_greet_limit" not in DEFAULT_CONFIG
    assert "daily_greet_safe_limit" not in DEFAULT_CONFIG


def test_volcengine_deepseek_model_overrides_saved_doubao_profile() -> None:
    from config import Config

    original = Config.as_dict()
    try:
        Config.apply(
            {
                **original,
                "model_provider": "openai",
                "openai_api_base": "https://ark.cn-beijing.volces.com/api/v3",
                "think_model": "deepseek-v3-2-251201",
                "external_model_profile": "doubao",
            }
        )
        assert Config.external_model_profile == "deepseek"
    finally:
        Config.apply(original)


def test_volcengine_model_error_hint_mentions_coding_plan_pair() -> None:
    from config import openai_compatible_config_hint

    hint = openai_compatible_config_hint(
        "https://ark.cn-beijing.volces.com/api/v3",
        "deepseek-v3-2-251201",
    )

    assert "api/coding/v3" in hint
    assert "deepseek-v3.2" in hint


def test_sou_zhaopin_search_url_is_kept_instead_of_defaulted() -> None:
    """智联新版搜索域名必须保留，否则会被悄悄换成默认 /recommend 并导致页面反复重载。"""
    from config import DEFAULT_CONFIG, _as_zhaopin_urls

    default = list(DEFAULT_CONFIG["zhaopin_job_urls"])
    assert _as_zhaopin_urls(["https://sou.zhaopin.com/?kw=算法工程师"]) == [
        "https://sou.zhaopin.com/?kw=算法工程师"
    ]
    # 多个来源按顺序保留，www 域名保留路径
    assert _as_zhaopin_urls([
        "https://sou.zhaopin.com/?kw=算法工程师",
        "https://www.zhaopin.com/jobs",
    ]) == ["https://sou.zhaopin.com/?kw=算法工程师", "https://www.zhaopin.com/jobs"]
    # 顶级域名归一化到 www
    assert _as_zhaopin_urls(["https://zhaopin.com/recommend"]) == ["https://www.zhaopin.com/recommend"]
    # 无法识别的地址回退到默认，避免有空列表
    assert _as_zhaopin_urls(["http://sou.zhaopin.com/?kw=x"]) == default
    assert _as_zhaopin_urls(["https://example.com/jobs"]) == default


def test_rejected_job_urls_are_reported_instead_of_silently_replaced(capsys) -> None:
    from config import Config

    messages = Config.warn_rejected_job_urls(
        {
            "zhaopin_job_urls": ["https://example.com/jobs"],
            "job51_job_urls": ["http://we.51job.com/pc/search"],
        }
    )
    output = capsys.readouterr().err
    assert len(messages) == 2
    assert any("智联" in message and "example.com" in message for message in messages)
    assert any("前程无忧" in message and "we.51job.com" in message for message in messages)
    assert "已忽略" in output

    # 合法配置不应该产生任何提示
    assert Config.warn_rejected_job_urls(
        {
            "zhaopin_job_urls": ["https://sou.zhaopin.com/?kw=算法工程师"],
            "job51_job_urls": ["https://we.51job.com/pc/search?keyword=算法工程师"],
        }
    ) == []
