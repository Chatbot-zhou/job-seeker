from cache import profile_grounding_warnings
from greeting_service import GREETING_MAX_CHARS, _fit_greeting_length


def test_profile_grounding_accepts_line_wrapped_model_name() -> None:
    resume = "项目技术栈：Qwen3-\nVL、Qwen3-Embedding、Milvus"
    detail = "技术栈: Qwen3-VL; Qwen3-Embedding; Milvus"
    assert profile_grounding_warnings(resume, detail) == []


def test_profile_grounding_accepts_passed_plus_count() -> None:
    resume = "全量回归 6161 passed / 3 failed"
    detail = "项目成果: 全量回归 6161 passed+3 failed"
    assert profile_grounding_warnings(resume, detail) == []


def test_profile_grounding_still_flags_unknown_rank() -> None:
    resume = "西安理工大学高科学院 本科 计算机科学与技术"
    detail = "学历专业: 本科 计算机科学与技术 (普通院校) 未提及"
    warnings = profile_grounding_warnings(resume, detail)
    assert any("院校层次" in warning for warning in warnings)


def test_greeting_length_guard_uses_strict_rewrite(monkeypatch) -> None:
    calls = []

    def fake_generate(style, prompt, options, attempt, system_prompt=""):
        calls.append((style, attempt, system_prompt))
        return "您好！我是本科计算机专业求职者，做过RAG项目，期待进一步沟通，谢谢！"

    monkeypatch.setattr("greeting_service._generate_greeting_raw", fake_generate)
    fitted = _fit_greeting_length("default", "您好" + "很长的描述" * 30, "profile", {})
    assert len(fitted) <= GREETING_MAX_CHARS
    assert calls and calls[0][1] == 4
    assert "长度修正" in calls[0][2]


def test_greeting_length_guard_trims_when_rewrite_is_still_long(monkeypatch) -> None:
    long_text = "您好！我是本科计算机专业求职者，" + "负责RAG检索链路优化，" * 20 + "谢谢！"
    monkeypatch.setattr(
        "greeting_service._generate_greeting_raw",
        lambda *args, **kwargs: long_text,
    )
    fitted = _fit_greeting_length("default", long_text, "profile", {})
    assert len(fitted) <= GREETING_MAX_CHARS
    assert fitted
