'''
Description: 工具
Author: Chatbot-Zhou
OriginalAuthor: 嘎嘣脆的贝爷
Date: 2025-02-14 22:31:43
LastEditTime: 2025-02-16 01:12:05
LastEditors: Chatbot-Zhou
'''
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit, urlunsplit


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_llm_reply(content: str) -> str:
    """获取大模型的最终回复，剥离常见 think 标签。"""
    text = content or ""
    if "<think>" in text:
        close_index = text.rfind("</think>")
        if close_index >= 0:
            text = text[close_index + len("</think>"):]
        else:
            text = text.split("<think>", 1)[0]
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def getLLMReply(content: str) -> str:
    """Backward-compatible wrapper."""
    return extract_llm_reply(content)


def extract_match_score(text: str) -> int | None:
    """从文本直接获取匹配度数值"""
    text = extract_llm_reply(text or "").strip()

    def valid(value: str) -> int | None:
        try:
            score = int(value)
        except ValueError:
            return None
        return score if 0 <= score <= 100 else None

    if re.fullmatch(r"\d{1,3}\s*分?", text):
        return valid(re.search(r"\d{1,3}", text).group())

    patterns = (
        r"(?:匹配度|匹配|综合评分|评分|分数|score)\D{0,16}(\d{1,3})\s*分?",
        r"(\d{1,3})\s*分",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            score = valid(match.group(1))
            if score is not None:
                return score

    numbers = re.findall(r"(?<![\d.-])(\d{1,3})(?!\s*[-~到至]\s*\d)(?![\d.])", text)
    scores = [score for value in numbers if (score := valid(value)) is not None]
    if len(scores) == 1:
        return scores[0]
    return None


def getMatchScore(text: str) -> int | None:
    """Backward-compatible wrapper."""
    return extract_match_score(text)


def script_connect_hosts(base_url: str) -> list[str]:
    hosts = ["127.0.0.1", "localhost"]
    parsed_host = urlparse(base_url).hostname
    if parsed_host and parsed_host not in hosts:
        hosts.append(parsed_host)
    return hosts


SENSITIVE_QUERY_KEYS = {
    "securityid",
    "token",
    "access_token",
    "authorization",
    "secret",
    "api_key",
    "apikey",
    "sessionid",
}
URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)


def safe_url_for_logs(value: str) -> str:
    """Keep a useful endpoint/job identity without persisting session-like query data."""
    raw = str(value or "")
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            return raw
        allowed_query = [
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() == "jobid"
        ]
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(allowed_query), ""))
    except ValueError:
        return raw


def redact_sensitive_urls(text: str) -> str:
    """Redact URL query credentials while retaining enough path context for diagnostics."""
    value = str(text or "")

    def replace_url(match: re.Match[str]) -> str:
        raw = match.group(0)
        trailing = ""
        while raw and raw[-1] in "),.;，。；":
            trailing = raw[-1] + trailing
            raw = raw[:-1]
        return safe_url_for_logs(raw) + trailing

    value = URL_PATTERN.sub(replace_url, value)
    sensitive_names = "|".join(re.escape(key) for key in sorted(SENSITIVE_QUERY_KEYS, key=len, reverse=True))
    return re.sub(
        rf"([?&](?:{sensitive_names})=)[^&\s]+",
        r"\1[已隐藏]",
        value,
        flags=re.IGNORECASE,
    )


def sanitize_log_value(value: Any, depth: int = 0) -> Any:
    """Recursively sanitize telemetry before it reaches memory or SQLite."""
    if depth > 8 or value is None:
        return value
    if isinstance(value, str):
        return redact_sensitive_urls(value)
    if isinstance(value, list):
        return [sanitize_log_value(item, depth + 1) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_log_value(item, depth + 1) for item in value)
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if key_text in SENSITIVE_QUERY_KEYS or "securityid" in key_text:
                result[str(key)] = "[已隐藏]"
            else:
                result[str(key)] = sanitize_log_value(item, depth + 1)
        return result
    return value


PRIVACY_PATTERNS = {
    "phone": r"(?<!\d)(?:1[3-9]\d{9})(?!\d)",
    "email": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    "wechat": r"(?:微信|wechat|vx|VX|Vx)[:：\s]*[A-Za-z][-_A-Za-z0-9]{5,19}",
    "qq": r"(?:QQ|qq)[:：\s]*[1-9]\d{4,11}",
    "id_card": r"(?<![0-9A-Za-z])(?:[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?![0-9A-Za-z])",
}


def detect_privacy(text: str) -> list[dict[str, Any]]:
    """Detect privacy-sensitive fragments without returning excessive context."""
    findings: list[dict[str, Any]] = []
    for kind, pattern in PRIVACY_PATTERNS.items():
        for match in re.finditer(pattern, text or ""):
            value = match.group(0)
            findings.append({
                "kind": kind,
                "value": value,
                "start": match.start(),
                "end": match.end(),
            })
    return findings


def redact_privacy(text: str) -> str:
    result = text or ""
    for kind, pattern in PRIVACY_PATTERNS.items():
        result = re.sub(pattern, f"[已隐藏{kind}]", result)
    return result
