from __future__ import annotations


def test_search_safety_limits_are_normalized() -> None:
    from config import Config

    original = Config.as_dict()
    try:
        Config.apply(
            {
                **original,
                "search_round_cooldown_minutes": 0,
                "tag_search_delay_seconds": 1,
                "tag_search_delay_max_seconds": 1,
                "max_search_submissions_per_hour": 9,
                "max_search_submissions_per_day": 3,
            }
        )
        assert Config.search_round_cooldown_minutes == 1
        assert Config.tag_search_delay_seconds == 3
        assert Config.tag_search_delay_max_seconds == 3
        assert Config.max_search_submissions_per_hour == 9
        assert Config.max_search_submissions_per_day == 9
    finally:
        Config.apply(original)


def test_search_safety_defaults_are_conservative() -> None:
    from config import DEFAULT_CONFIG

    assert DEFAULT_CONFIG["search_round_cooldown_minutes"] == 60
    assert DEFAULT_CONFIG["tag_search_delay_seconds"] == 20
    assert DEFAULT_CONFIG["tag_search_delay_max_seconds"] == 45
    assert DEFAULT_CONFIG["max_search_submissions_per_hour"] == 6
    assert DEFAULT_CONFIG["max_search_submissions_per_day"] == 30
    assert DEFAULT_CONFIG["search_result_scroll_rounds"] == 20
    assert DEFAULT_CONFIG["preferred_feed_max_jobs_per_tab"] == 0
    assert "session_greet_limit" not in DEFAULT_CONFIG
    assert "daily_greet_safe_limit" not in DEFAULT_CONFIG
