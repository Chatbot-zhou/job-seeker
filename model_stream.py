from __future__ import annotations

import json
import queue
import threading
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import Config
from runtime_state import runtime_state


DEFAULT_MODEL_OPTIONS = {
    "temperature": 0.6,
    "num_ctx": 10240,
}


def message_content(response: Any) -> str:
    if hasattr(response, "message"):
        message = response.message
        if hasattr(message, "content"):
            return message.content or ""
        if isinstance(message, dict):
            return message.get("content", "")
    if isinstance(response, dict):
        return response.get("message", {}).get("content", "")
    return ""


def make_ollama_client() -> Any:
    try:
        from ollama import Client
    except ModuleNotFoundError as exc:
        raise RuntimeError("缺少 Python 依赖 ollama，请先运行: pip install -r requirements.txt") from exc
    return Client(host=Config.ollama_host)


def openai_chat_url() -> str:
    return Config.openai_api_base.rstrip("/") + "/chat/completions"


def openai_payload_options(options: dict[str, Any] | None) -> dict[str, Any]:
    options = options or {}
    payload: dict[str, Any] = {}
    if "temperature" in options:
        payload["temperature"] = options["temperature"]
    if "num_predict" in options:
        payload["max_tokens"] = options["num_predict"]
    if "max_tokens" in options:
        payload["max_tokens"] = options["max_tokens"]
    return payload


def iter_openai_chat_chunks(
    messages: list[dict[str, str]],
    model: str,
    options: dict[str, Any] | None = None,
) -> Any:
    if not Config.openai_api_key.strip():
        raise RuntimeError("外部模型 API Key 未配置")
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    payload.update(openai_payload_options(options))
    request = Request(
        openai_chat_url(),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {Config.openai_api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        reasoning_open = False
        with urlopen(request, timeout=60) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="ignore").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    if reasoning_open:
                        yield "</think>"
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                message = choices[0].get("message") or {}
                reasoning = (
                    delta.get("reasoning_content")
                    or delta.get("reasoning")
                    or delta.get("reasoning_text")
                    or message.get("reasoning_content")
                    or ""
                )
                content = delta.get("content") or message.get("content") or ""
                if reasoning:
                    if not reasoning_open:
                        yield "<think>"
                        reasoning_open = True
                    yield reasoning
                if content:
                    if reasoning_open:
                        yield "</think>"
                        reasoning_open = False
                    yield content
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"外部模型请求失败: HTTP {exc.code} {body[:500]}") from exc
    except URLError as exc:
        raise RuntimeError(f"外部模型连接失败: {exc}") from exc


def iter_model_chunks(
    messages: list[dict[str, str]],
    model: str,
    options: dict[str, Any] | None = None,
    format_schema: dict[str, Any] | None = None,
) -> Any:
    if Config.model_provider == "openai_compatible":
        yield from iter_openai_chat_chunks(messages, model, options)
        return
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": options or DEFAULT_MODEL_OPTIONS,
    }
    if format_schema is not None:
        kwargs["format"] = format_schema
    for chunk in make_ollama_client().chat(**kwargs):
        yield message_content(chunk)


class ModelChunkPrinter:
    def __init__(self, show_reasoning: bool = False) -> None:
        self._pending = ""
        self._show_reasoning = show_reasoning
        self._in_reasoning = False
        self._reasoning_notice_printed = False
        self._output_header_printed = False

    def feed(self, chunk: str) -> None:
        text = self._pending + chunk
        self._pending = ""
        out: list[str] = []
        index = 0
        markers = ("<think>", "</think>")
        while index < len(text):
            rest = text[index:]
            if rest.startswith("<think>"):
                self._in_reasoning = True
                if self._show_reasoning:
                    out.append("\n[模型思考]\n")
                elif not self._reasoning_notice_printed:
                    out.append("\n[模型] 正在推理，思考内容已隐藏...\n")
                    self._reasoning_notice_printed = True
                index += len("<think>")
                continue
            if rest.startswith("</think>"):
                self._in_reasoning = False
                if self._show_reasoning or not self._output_header_printed:
                    out.append("\n[模型输出]\n")
                    self._output_header_printed = True
                index += len("</think>")
                continue
            if text[index] == "<" and any(marker.startswith(rest) for marker in markers):
                self._pending = rest
                break
            if self._show_reasoning or not self._in_reasoning:
                out.append(text[index])
            index += 1
        if out:
            print("".join(out), end="", flush=True)

    def flush(self) -> None:
        if self._pending:
            print(self._pending, end="", flush=True)
            self._pending = ""


def stream_ollama_chat(
    label: str,
    messages: list[dict[str, str]],
    options: dict[str, Any] | None = None,
    model: str | None = None,
    format_schema: dict[str, Any] | None = None,
) -> str:
    result_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
    selected_model = model or Config.think_model

    def worker() -> None:
        try:
            for chunk in iter_model_chunks(messages, selected_model, options or DEFAULT_MODEL_OPTIONS, format_schema):
                result_queue.put(("chunk", chunk))
            result_queue.put(("done", None))
        except Exception as exc:
            result_queue.put(("error", exc))

    runtime_state.emit("model_started", f"{label} 开始", source="model")
    print(f"\n[模型] {label}", flush=True)
    print(f"[模型] provider={Config.model_provider} model={selected_model}", flush=True)
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    content = ""
    show_reasoning = bool(Config.show_model_reasoning) or Config.log_verbosity == "debug"
    printer = ModelChunkPrinter(show_reasoning=show_reasoning)
    started_at = time.monotonic()
    has_chunk = False
    next_wait_notice = 10

    while True:
        seconds = int(time.monotonic() - started_at)
        try:
            item_type, payload = result_queue.get(timeout=1)
        except queue.Empty:
            if seconds >= next_wait_notice:
                message = "等待模型响应" if not has_chunk else "模型仍在生成"
                print(f"\n[模型] {message}... {seconds}s", flush=True)
                next_wait_notice += 10
            continue

        if item_type == "chunk":
            chunk = str(payload or "")
            if not chunk:
                continue
            has_chunk = True
            content += chunk
            printer.feed(chunk)
            continue

        if item_type == "error":
            printer.flush()
            print("", flush=True)
            runtime_state.emit("model_failed", f"{label} 失败: {payload}", source="model", level="error")
            raise payload

        printer.flush()
        print("", flush=True)
        runtime_state.emit("model_finished", f"{label} 完成", source="model")
        return content
