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


def test_hard_gate_caps_fresh_graduate_role_for_experienced_candidate() -> None:
    from core import _apply_hard_gates

    profile = "学历专业: 本科 计算机科学与技术 (未提及) 未提及\n工作经历:\n[某公司] Agent开发工程师 | 2025.12-至今 | RAG开发"
    gated, reason = _apply_hard_gates(
        "基本条件：本科或硕士应届毕业生，负责AI应用开发",
        "AI应用工程师（应届生）",
        profile,
        {"学历专业": 85, "技术栈": 95, "项目经验": 95},
    )
    total = round(gated["技术栈"] * 0.5 + gated["项目经验"] * 0.35 + gated["学历专业"] * 0.15)
    assert total < 70
    assert "应届" in reason


def test_hard_gate_caps_master_requirement_for_bachelor() -> None:
    from core import _apply_hard_gates

    profile = "学历专业: 本科 计算机科学与技术 (未提及) 未提及\n工作经历:\n[某公司] 开发工程师 | 2025.12-至今 | 后端"
    gated, reason = _apply_hard_gates(
        "任职要求：硕士研究生及以上学历，负责大模型应用",
        "AI应用工程师",
        profile,
        {"学历专业": 85, "技术栈": 95, "项目经验": 95},
    )
    assert gated["学历专业"] <= 30
    assert "硕士" in reason


def test_hard_gate_caps_internship_for_experienced_candidate() -> None:
    from core import _apply_hard_gates

    profile = "学历专业: 本科 计算机科学与技术 (未提及) 未提及\n工作经历:\n[某公司] 开发工程师 | 2025.12-至今 | 后端"
    gated, reason = _apply_hard_gates(
        "算法工程实习生，负责模型训练",
        "算法工程实习生",
        profile,
        {"学历专业": 85, "技术栈": 95, "项目经验": 95},
    )
    assert gated["技术栈"] <= 55
    assert "实习" in reason


def test_hard_gate_leaves_normal_role_unchanged() -> None:
    from core import _apply_hard_gates

    profile = "学历专业: 本科 计算机科学与技术 (未提及) 未提及\n工作经历:\n[某公司] 开发工程师 | 2025.12-至今 | 后端"
    original = {"学历专业": 85, "技术栈": 92, "项目经验": 90}
    gated, reason = _apply_hard_gates(
        "负责AI应用开发，要求本科及以上，1-3年经验",
        "AI应用开发工程师",
        profile,
        original,
    )
    assert gated == original
    assert reason == ""


def test_hard_gate_caps_three_year_requirement_for_junior_profile() -> None:
    from core import _apply_hard_gates

    profile = "学历专业: 本科 计算机科学与技术 (未提及) 未提及\n工作经历:\n[某公司] Agent开发工程师 | 2025.12-2026.06 | RAG开发\n[另一公司] Agent开发工程师 | 2026.10-至今 | Agent开发"
    gated, reason = _apply_hard_gates(
        "任职要求：拥有3年及以上Python后端开发实战经验，具备AI项目经验",
        "后端Python工程师",
        profile,
        {"学历专业": 85, "技术栈": 92, "项目经验": 90},
    )
    total = round(gated["技术栈"] * 0.5 + gated["项目经验"] * 0.35 + gated["学历专业"] * 0.15)
    assert total < 70
    assert "3年" in reason


def test_hard_gate_allows_one_to_three_year_range_for_junior_profile() -> None:
    from core import _apply_hard_gates

    profile = "学历专业: 本科 计算机科学与技术 (未提及) 未提及\n工作经历:\n[某公司] Agent开发工程师 | 2025.12-至今 | RAG开发"
    original = {"学历专业": 85, "技术栈": 92, "项目经验": 90}
    gated, reason = _apply_hard_gates(
        "任职要求：1-3年AI应用开发经验，熟悉RAG",
        "AI应用开发工程师",
        profile,
        original,
    )
    assert gated == original
    assert reason == ""
