from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from config import BASE_DIR, Config, ensure_data_dirs
from core import generate_tags, generate_user_detail
from runtime_state import runtime_state


_PROFILE_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#._-]{1,30}")
_PROFILE_COMMON_WORDS = {
    "and", "the", "with", "for", "from", "using", "built", "data", "platform",
    "workflow", "years", "experience", "skills", "projects", "education",
    "location", "name", "role", "demo", "resume", "llm", "ai", "api", "http",
    "https", "www", "com", "cn", "job", "seeker", "ms", "kb", "mb", "gb",
}


def profile_grounding_warnings(resume: str, user_detail: str) -> list[str]:
    """Flag likely hallucinated facts in a generated profile.

    This is a lightweight, deterministic guard, not a full fact checker. It
    surfaces unsupported English tech tokens, years and education/project claims
    so the Web wizard can ask the user to review before saving.
    """
    resume_text = str(resume or "")
    detail = str(user_detail or "")
    if not detail.strip():
        return ["用户详情为空"]
    resume_lower = resume_text.lower()
    resume_compact = re.sub(r"\s+", "", resume_lower)
    warnings: list[str] = []
    unsupported: list[str] = []
    for token in _PROFILE_TOKEN_RE.findall(detail):
        normalized = token.lower().strip("._-")
        if len(normalized) < 2 or normalized in _PROFILE_COMMON_WORDS:
            continue
        if normalized in resume_lower:
            continue
        # 简历 PDF 提取常把 "Qwen3-VL" 这类长词按行拆开；去掉空白后仍应视为原文出现。
        if normalized.replace(" ", "") in resume_compact:
            continue
        # 项目成果里的 "6161 passed / 3 failed" 可能被提取成 "passed+3"；
        # 只要拆分后的每个词都能在简历中找到，就不算未提及的技术词。
        parts = [part for part in re.split(r"[+/]", normalized) if len(part) >= 2]
        if parts and all(part in resume_lower for part in parts):
            continue
        if token not in unsupported:
            unsupported.append(token)
    if unsupported:
        warnings.append("画像包含简历未提及的技术词：" + "、".join(unsupported[:8]))
    years = sorted(set(re.findall(r"20\d{2}", detail)))
    missing_years = [year for year in years if year not in resume_text]
    if missing_years:
        warnings.append("画像包含简历未提及的年份：" + "、".join(missing_years))
    education_line = next(
        (line for line in detail.splitlines() if line.strip().startswith("学历专业")),
        "",
    )
    education_terms = ("本科", "硕士", "博士", "大专", "学历", "大学", "学院", "学校", "教育")
    if (
        "未提及" not in education_line
        and not any(term in resume_text for term in education_terms)
        and any(term in education_line for term in education_terms)
    ):
        warnings.append("简历未提及学历，画像中的学历信息可能是模型补充")
    rank_terms = ("985", "211", "双一流", "普通院校", "QS前100", "QS前500", "海外普通")
    unsupported_rank = [
        term for term in rank_terms
        if term in education_line and term not in resume_text
    ]
    if unsupported_rank:
        warnings.append("画像包含简历未提及的院校层次：" + "、".join(unsupported_rank))
    stage_terms = ("本科", "硕士", "博士", "大专")
    unsupported_stage = [
        term for term in stage_terms
        if term in education_line and term not in resume_text
    ]
    if unsupported_stage:
        warnings.append("画像包含简历未提及的学历阶段：" + "、".join(unsupported_stage))
    project_indicators = ("项目", "做过", "经历", "平台", "project", "projects", "experience")
    if not any(term in resume_lower for term in project_indicators):
        project_line = detail.split("项目经验:", 1)[-1] if "项目经验:" in detail else ""
        if project_line.strip() and "未提及" not in project_line:
            warnings.append("简历未提及项目，画像中的项目经验可能是模型补充")
    return warnings


class CacheManager:
    def __init__(self) -> None:
        self._resume = ""
        self._profile: dict[str, Any] = {}
        self.load()

    @property
    def resume(self) -> str:
        if not self._resume:
            self.load()
        return self._resume

    @property
    def user_detail(self) -> str:
        return str(self._profile.get("user_detail", ""))

    @property
    def tags(self) -> list[str]:
        tags_path = Path(Config.tags_name)
        if tags_path.exists():
            tags = self.parse_tags(tags_path.read_text(encoding="utf-8"))
            if tags:
                return tags
        tags = self._profile.get("tags", [])
        return tags if isinstance(tags, list) else []

    @property
    def profile(self) -> dict[str, Any]:
        profile = self._normalize_profile(self._profile)
        profile["tags"] = self.tags
        return profile

    def _normalize_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        tags = profile.get("tags", [])
        if not isinstance(tags, list):
            tags = []
        return {
            "tags": [str(tag).strip() for tag in tags if str(tag).strip()],
            "user_detail": str(profile.get("user_detail", "")).strip(),
        }

    def parse_tags(self, content: str) -> list[str]:
        items = content.replace("，", "\n").replace(",", "\n").splitlines()
        tags: list[str] = []
        for item in items:
            for tag in str(item).split():
                tag = tag.strip()
                if tag and tag not in tags:
                    tags.append(tag)
        return tags

    def load(self) -> None:
        ensure_data_dirs()
        resume_path = Path(Config.resume_name)
        legacy_resume_path = BASE_DIR / "resume.md"
        if resume_path.exists():
            self._resume = resume_path.read_text(encoding="utf-8")
        elif legacy_resume_path.exists():
            self._resume = legacy_resume_path.read_text(encoding="utf-8")
        else:
            self._resume = ""

        profile_path = Path(Config.profile_cache_name)
        if profile_path.exists():
            try:
                data = json.loads(profile_path.read_text(encoding="utf-8"))
                self._profile = self._normalize_profile(data if isinstance(data, dict) else {})
                if data != self._profile:
                    profile_path.write_text(
                        json.dumps(self._profile, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
            except json.JSONDecodeError:
                self._profile = {}
        else:
            self._profile = {}

    def save_resume(self, markdown: str) -> None:
        ensure_data_dirs()
        Path(Config.resume_name).write_text(markdown, encoding="utf-8")
        self._resume = markdown
        runtime_state.log("简历已保存")

    def generate_profile(self) -> dict[str, Any]:
        if not self.resume.strip():
            raise ValueError("请先上传或保存简历")
        runtime_state.set_task("generating_resume_profile")
        try:
            profile = {
                "tags": generate_tags(self.resume),
                "user_detail": generate_user_detail(self.resume),
            }
            self._save_profile(profile)
            self.write_tags_file(profile["tags"])
            self.write_user_detail_file(profile["user_detail"])
            runtime_state.log("简历画像已生成")
            return self.profile
        finally:
            runtime_state.set_task("idle")

    def _save_profile(self, profile: dict[str, Any]) -> None:
        profile = self._normalize_profile(profile)
        Path(Config.profile_cache_name).write_text(
            json.dumps(profile, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._profile = profile
        self.write_tags_file(profile["tags"])

    def write_tags_file(self, tags: list[str] | None = None) -> Path:
        ensure_data_dirs()
        path = Path(Config.tags_name)
        values = tags if tags is not None else self.tags
        path.write_text("\n".join(values).strip() + "\n", encoding="utf-8")
        return path

    def save_tags(self, content: str) -> dict[str, Any]:
        tags = self.parse_tags(content)
        if not tags:
            raise ValueError("岗位标签不能为空")
        profile = self.profile
        profile["tags"] = tags
        self._save_profile(profile)
        self.write_tags_file(tags)
        runtime_state.log("岗位标签已保存")
        return self.profile

    def write_user_detail_file(self, content: str | None = None) -> Path:
        ensure_data_dirs()
        path = Path(Config.user_detail_name)
        path.write_text((content if content is not None else self.user_detail).strip() + "\n", encoding="utf-8")
        return path

    def save_user_detail(self, content: str) -> dict[str, Any]:
        content = content.strip()
        if not content:
            raise ValueError("用户详情不能为空")
        profile = self.profile
        profile["user_detail"] = content
        self._save_profile(profile)
        self.write_user_detail_file(content)
        runtime_state.log("用户详情已保存")
        return self.profile

    def status(self) -> dict[str, Any]:
        resume_path = Path(Config.resume_name)
        legacy_resume_path = BASE_DIR / "resume.md"
        active_path = resume_path if resume_path.exists() else legacy_resume_path
        return {
            "uploaded": Path(Config.original_resume_pdf_name).exists(),
            "saved": bool(self.resume.strip()),
            "path": str(active_path) if active_path.exists() else "",
            "last_updated": active_path.stat().st_mtime if active_path.exists() else None,
            "extracted": Path(Config.extracted_resume_name).exists(),
        }

    def cache_status(self) -> dict[str, Any]:
        return {
            "profile_generated": bool(self.tags and self.user_detail.strip()),
            "tags_generated": bool(self.tags),
            "user_detail_generated": bool(self.user_detail.strip()),
        }


cache = CacheManager()
