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
