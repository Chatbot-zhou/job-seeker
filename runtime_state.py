from __future__ import annotations

import json
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from queue import Queue
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import Config
from tools import now_iso, sanitize_log_value


SCRIPT_STALE_SECONDS = 15
PLATFORM_NAMES = ("boss", "zhaopin")


def _seconds_since(iso_time: str) -> int | None:
    try:
        return max(0, int((datetime.now(timezone.utc) - datetime.fromisoformat(iso_time)).total_seconds()))
    except (TypeError, ValueError):
        return None


class RuntimeState:
    def __init__(self) -> None:
        self.started_at = now_iso()
        self.run_id = self._new_run_id()
        self.run_started_at = self.started_at
        self.current_task = "idle"
        self.control = "paused"
        self.last_error = ""
        self.platform_controls = {platform: "running" for platform in PLATFORM_NAMES}
        self.platform_pause_reasons = {platform: "" for platform in PLATFORM_NAMES}
        self.platform_generations = {platform: 0 for platform in PLATFORM_NAMES}
        self.platforms = {platform: self._blank_script(platform) for platform in PLATFORM_NAMES}
        # Backward-compatible alias.  Existing callers historically saw BOSS only.
        self.script = dict(self.platforms["boss"])
        self.model_warmup = {
            "status": "unknown",
            "provider": "",
            "model": "",
            "last_checked": "",
            "latency_seconds": None,
            "error": "",
        }
        self.autorun = {
            "blocked": False,
            "reason": "",
            "next_action": "",
            "updated_at": "",
        }
        self.logs: deque[dict[str, Any]] = deque(maxlen=300)
        self.events: deque[dict[str, Any]] = deque(maxlen=500)
        self._subscribers: list[Queue] = []
        self._lock = threading.RLock()
        self._last_persisted_script_status: dict[str, tuple[str, str]] = {}
        self._once_event_keys: set[tuple[str, str, str]] = set()

    def _new_run_id(self) -> str:
        return f"run-{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _blank_script(platform: str) -> dict[str, Any]:
        return {
            "platform": platform,
            "connected": False,
            "page": "unknown",
            "page_kind": "",
            "instance_id": "",
            "status": "offline",
            "current_action": "",
            "last_seen": "",
            "stale": False,
            "heartbeat_age_seconds": None,
            "detail": {},
        }

    @staticmethod
    def _platform_name(platform: str | None) -> str:
        return platform if platform in PLATFORM_NAMES else "boss"

    @staticmethod
    def _platform_enabled(platform: str) -> bool:
        return bool(getattr(Config, f"{platform}_enabled", True))

    def log(self, message: str, level: str = "info", source: str = "backend") -> dict[str, Any]:
        return self.emit("log", message, source=source, level=level)

    def emit(
        self,
        event_type: str,
        message: str,
        source: str = "backend",
        level: str = "info",
        detail: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        safe_message = str(sanitize_log_value(message) or "")
        safe_detail = sanitize_log_value(detail or {})
        item = {
            "time": now_iso(),
            "run_id": self.run_id,
            "level": level,
            "source": source,
            "type": event_type,
            "message": safe_message,
            "detail": safe_detail,
        }
        with self._lock:
            if event_type == "model_thinking_control_retry":
                model = str((safe_detail or {}).get("model", "")) if isinstance(safe_detail, dict) else ""
                once_key = (self.run_id, event_type, model)
                if once_key in self._once_event_keys:
                    return item
                self._once_event_keys.add(once_key)
            self.logs.appendleft(item)
            self.events.appendleft(item)
            if level == "error":
                self.last_error = safe_message
            subscribers = list(self._subscribers)
        failed_subscribers: list[Queue] = []
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(item)
            except Exception:
                failed_subscribers.append(subscriber)
        if failed_subscribers:
            with self._lock:
                self._subscribers = [
                    subscriber for subscriber in self._subscribers if subscriber not in failed_subscribers
                ]
        persist_event = True
        if event_type == "script_status":
            event_detail = safe_detail if isinstance(safe_detail, dict) else {}
            script_detail = event_detail.get("detail") or {}
            platform = str(event_detail.get("platform", "boss"))
            signature = (
                str(event_detail.get("page", "")),
                str(event_detail.get("status", "")),
            )
            with self._lock:
                persist_event = signature != self._last_persisted_script_status.get(platform)
                if persist_event:
                    self._last_persisted_script_status[platform] = signature
        try:
            import database

            if persist_event:
                database.create_event(item)
        except Exception:
            pass
        return item

    def subscribe(self) -> Queue:
        queue: Queue = Queue()
        with self._lock:
            self._subscribers.append(queue)
        return queue

    def set_task(self, task: str) -> None:
        with self._lock:
            self.current_task = task

    def update_script(
        self,
        page: str,
        status: str,
        current_action: str = "",
        detail: dict[str, Any] | None = None,
        *,
        platform: str = "boss",
        instance_id: str = "",
        page_kind: str = "",
    ) -> None:
        platform = self._platform_name(platform)
        detail = dict(detail or {})
        with self._lock:
            previous = dict(self.platforms[platform])
            detail.setdefault("backendRunId", self.run_id)
            detail.setdefault("platform", platform)
            script = {
                "platform": platform,
                "connected": True,
                "page": page,
                "page_kind": page_kind or page,
                "instance_id": instance_id,
                "status": status,
                "current_action": current_action,
                "last_seen": now_iso(),
                "stale": False,
                "heartbeat_age_seconds": 0,
                "detail": detail,
            }
            self.platforms[platform] = script
            if platform == "boss" or not self._platform_enabled("boss"):
                self.script = dict(script)
            changed = (
                previous.get("page") != page
                or previous.get("status") != status
                or previous.get("current_action") != current_action
            )
            script_detail = dict(script)
        if changed:
            self.emit(
                "script_status",
                f"脚本状态: {page} / {status} / {current_action or '空闲'}",
                source="script",
                detail=script_detail,
            )

    def script_snapshot(self, platform: str | None = None) -> dict[str, Any]:
        selected = self._platform_name(platform) if platform else (
            "boss" if self._platform_enabled("boss") else "zhaopin"
        )
        with self._lock:
            script = dict(self.platforms[selected])
        script["detail"] = dict(script.get("detail") or {})
        last_seen = script.get("last_seen")
        script["stale"] = False
        if not last_seen:
            script["heartbeat_age_seconds"] = None
            return script
        age_seconds = _seconds_since(last_seen)
        if age_seconds is None:
            script["heartbeat_age_seconds"] = None
            return script
        script["heartbeat_age_seconds"] = age_seconds
        if script.get("connected") and age_seconds > SCRIPT_STALE_SECONDS:
            script["connected"] = False
            script["stale"] = True
            script["status"] = "stale"
            script["current_action"] = f"脚本心跳超过 {age_seconds} 秒未更新"
        return script

    def platform_control(self, platform: str) -> str:
        platform = self._platform_name(platform)
        with self._lock:
            global_control = self.control
            local_control = self.platform_controls.get(platform, "running")
        if not self._platform_enabled(platform):
            return "disabled"
        if global_control != "running":
            return global_control
        return local_control

    def platform_generation(self, platform: str) -> int:
        platform = self._platform_name(platform)
        with self._lock:
            return int(self.platform_generations.get(platform, 0))

    def platform_snapshots(self) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for platform in PLATFORM_NAMES:
            snapshot = self.script_snapshot(platform)
            with self._lock:
                local_control = self.platform_controls.get(platform, "running")
                pause_reason = self.platform_pause_reasons.get(platform, "")
                generation = int(self.platform_generations.get(platform, 0))
            snapshot.update(
                {
                    "enabled": self._platform_enabled(platform),
                    "control": local_control,
                    "effective_control": self.platform_control(platform),
                    "pause_reason": pause_reason,
                    "generation": generation,
                }
            )
            result[platform] = snapshot
        return result

    def set_platform_control(self, platform: str, command: str, reason: str = "") -> None:
        platform = self._platform_name(platform)
        if command not in {"pause", "resume", "stop"}:
            raise ValueError(f"不支持的平台控制命令: {command}")
        with self._lock:
            self.platform_controls[platform] = {
                "pause": "paused",
                "resume": "running",
                "stop": "stopped",
            }[command]
            self.platform_pause_reasons[platform] = "" if command == "resume" else str(reason or "")
            if command in {"pause", "stop"}:
                self.platform_generations[platform] = int(self.platform_generations.get(platform, 0)) + 1
        self.emit(
            "platform_control",
            f"平台控制命令: {platform} / {command}",
            source="control",
            detail={"platform": platform, "command": command, "reason": reason},
        )

    def set_control(self, command: str, *, new_run: bool = False) -> None:
        previous_run_id = ""
        with self._lock:
            previous_run_id = self.run_id
            if command == "pause":
                self.control = "paused"
                self.current_task = "paused"
                for platform in PLATFORM_NAMES:
                    self.platform_generations[platform] = int(self.platform_generations.get(platform, 0)) + 1
            elif command == "resume":
                if new_run or self.control == "stopped" or not self.run_id:
                    self.run_id = self._new_run_id()
                    self.run_started_at = now_iso()
                self.clear_autorun_blocked()
                self.control = "running"
                self.current_task = "idle"
            elif command == "stop":
                self.control = "stopped"
                self.current_task = "stopped"
                for platform in PLATFORM_NAMES:
                    self.platform_generations[platform] = int(self.platform_generations.get(platform, 0)) + 1
            current_run_id = self.run_id
            current_control = self.control
            current_run_started_at = self.run_started_at
        try:
            import database

            if current_run_id != previous_run_id and previous_run_id:
                database.finish_run(previous_run_id, control="completed")
            database.upsert_run(current_run_id, control=current_control, started_at=current_run_started_at)
            if command == "stop":
                database.finish_run(current_run_id, control="stopped")
        except Exception:
            pass
        self.log(f"控制命令: {command}", source="control")

    def set_autorun_blocked(self, reason: str, next_action: str = "") -> None:
        with self._lock:
            self.autorun = {
                "blocked": True,
                "reason": reason,
                "next_action": next_action,
                "updated_at": now_iso(),
            }

    def clear_autorun_blocked(self) -> None:
        with self._lock:
            self.autorun = {
                "blocked": False,
                "reason": "",
                "next_action": "",
                "updated_at": now_iso(),
            }

    def control_payload(self, platform: str | None = None) -> dict[str, Any]:
        with self._lock:
            control = self.control
            run_id = self.run_id
            run_started_at = self.run_started_at
            current_task = self.current_task
        selected = self._platform_name(platform) if platform else None
        effective_control = self.platform_control(selected) if selected else control
        should_start = effective_control == "running"
        return {
            "control": control,
            "run_id": run_id,
            "run_started_at": run_started_at,
            "current_task": current_task,
            "script": self.script_snapshot(),
            "platform": selected,
            "platform_control": effective_control if selected else "",
            "platforms": self.platform_snapshots(),
            "should_start": should_start,
            "should_pause": effective_control == "paused",
            "should_stop": effective_control in {"stopped", "disabled"},
            "message": {
                "running": "CLI 已允许脚本开始或继续执行",
                "paused": "CLI 已暂停脚本执行",
                "stopped": "CLI 已停止脚本执行",
            }.get(control, "未知控制状态"),
        }

    def update_model_warmup(
        self,
        status: str,
        *,
        provider: str = "",
        model: str = "",
        latency_seconds: float | None = None,
        error: str = "",
    ) -> None:
        with self._lock:
            self.model_warmup = {
                "status": status,
                "provider": provider,
                "model": model,
                "last_checked": now_iso(),
                "latency_seconds": latency_seconds,
                "error": error,
            }

    def log_entries(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.logs)

    def ollama_status(self) -> dict[str, Any]:
        if Config.model_provider == "openai":
            return self.external_model_status()
        url = Config.ollama_host.rstrip("/") + "/api/tags"
        try:
            with urlopen(url, timeout=1.5) as response:
                data = response.read().decode("utf-8", errors="ignore")
            payload = json.loads(data)
            models = [
                item.get("name") or item.get("model")
                for item in payload.get("models", [])
                if isinstance(item, dict)
            ]
            return {
                "available": True,
                "provider": Config.model_provider,
                "host": Config.ollama_host,
                "model": Config.think_model,
                "models": models,
                "model_available": Config.think_model in models,
                "raw": data[:500],
            }
        except (json.JSONDecodeError, URLError, TimeoutError, OSError) as exc:
            return {
                "available": False,
                "provider": Config.model_provider,
                "host": Config.ollama_host,
                "model": Config.think_model,
                "error": str(exc),
            }

    def external_model_status(self) -> dict[str, Any]:
        result = {
            "available": False,
            "provider": Config.model_provider,
            "api_base": Config.openai_api_base,
            "api_key_configured": bool(str(Config.openai_api_key).strip()),
            "api_key_source": Config.public_dict().get("openai_api_key_source", ""),
            "model": Config.think_model,
        }
        if not result["api_key_configured"]:
            result["error"] = "OpenAI API Key 未配置"
            return result
        url = Config.openai_api_base.rstrip("/") + "/models"
        request = Request(
            url,
            headers={"Authorization": f"Bearer {Config.openai_api_key}"},
            method="GET",
        )
        try:
            with urlopen(request, timeout=3) as response:
                data = response.read().decode("utf-8", errors="ignore")
            result.update({"available": True, "raw": data[:500]})
            return result
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            result["error"] = f"HTTP {exc.code} {body[:300]}"
            return result
        except (URLError, TimeoutError, OSError) as exc:
            result["error"] = str(exc)
            return result

    def as_dict(self, resume_status: dict[str, Any], cache_status: dict[str, Any]) -> dict[str, Any]:
        model_thinking_disabled = bool(Config.disable_model_thinking)
        with self._lock:
            started_at = self.started_at
            run_started_at = self.run_started_at
            run_id = self.run_id
            current_task = self.current_task
            control = self.control
            last_error = self.last_error
            model_warmup = dict(self.model_warmup)
            autorun = dict(self.autorun)
        status = {
            "backend": {
                "running": True,
                "started_at": started_at,
                "service_started_at": started_at,
                "run_started_at": run_started_at,
                "run_id": run_id,
                "version": "2026.06-cli",
                "current_task": current_task,
                "control": control,
                "last_error": last_error,
            },
            "ollama": self.ollama_status(),
            "models": {
                "provider": Config.model_provider,
                "model": Config.think_model,
                "openai_api_base": Config.openai_api_base if Config.model_provider == "openai" else "",
                "openai_api_key_configured": bool(str(Config.openai_api_key).strip()),
                "openai_api_key_source": Config.public_dict().get("openai_api_key_source", ""),
                "disable_model_thinking": model_thinking_disabled,
                "show_model_reasoning": bool(Config.show_model_reasoning),
                "scoring_thinking": not model_thinking_disabled,
                "non_scoring_thinking": not model_thinking_disabled,
                "profile_tags_thinking": not model_thinking_disabled,
                "greeting_thinking": not model_thinking_disabled,
                "thinking_policy": {
                    "scoring": not model_thinking_disabled,
                    "profile_tags": not model_thinking_disabled,
                    "greeting": not model_thinking_disabled,
                },
                "external_model_profile": Config.external_model_profile if Config.model_provider == "openai" else "",
                "parameters": {
                    "temperature": Config.model_temperature,
                    "top_p": Config.model_top_p,
                    "repeat_penalty": Config.model_repeat_penalty,
                    "repeat_last_n": Config.model_repeat_last_n,
                    "frequency_penalty": Config.model_frequency_penalty,
                    "presence_penalty": Config.model_presence_penalty,
                },
                "warmup": model_warmup,
            },
            "resume": resume_status,
            "cache": cache_status,
            "limits": {
                "score_threshold": Config.score_threshold,
                "search_round_cooldown_min_minutes": Config.search_round_cooldown_min_minutes,
                "search_round_cooldown_minutes": Config.search_round_cooldown_minutes,
                "tag_search_delay_seconds": Config.tag_search_delay_seconds,
                "tag_search_delay_max_seconds": Config.tag_search_delay_max_seconds,
                "max_search_submissions_per_hour": Config.max_search_submissions_per_hour,
                "max_search_submissions_per_day": Config.max_search_submissions_per_day,
                "search_result_scroll_rounds": Config.search_result_scroll_rounds,
            },
            "script": self.script_snapshot(),
            "platforms": self.platform_snapshots(),
            "autorun_schedule": {
                "enabled": bool(getattr(Config, "auto_start_enabled", False)),
                "time": str(getattr(Config, "auto_start_time", "09:00")),
                "waiting": current_task == "waiting_schedule",
            },
            "autorun": autorun,
        }
        return status


runtime_state = RuntimeState()
