from __future__ import annotations

import asyncio
import threading
import uuid
from collections import Counter, deque
from dataclasses import dataclass
from typing import Any, Callable


class ModelQueueCancelled(RuntimeError):
    """Raised when a queued model request is cancelled before it starts."""


@dataclass
class _Ticket:
    ticket_id: str
    platform: str
    future: asyncio.Future[None]


class FairModelQueue:
    """Small FIFO gate in front of the model executor.

    The underlying executor keeps two workers so a diagnosed-capable device can
    use both.  This gate decides whether one or two jobs are allowed to enter it
    and keeps BOSS/Zhaopin requests ordered by arrival time.
    """

    def __init__(self, limit_getter: Callable[[], int]) -> None:
        self._limit_getter = limit_getter
        self._waiters: deque[_Ticket] = deque()
        self._active = 0
        self._active_by_platform: Counter[str] = Counter()
        self._guard: asyncio.Lock | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stats_lock = threading.RLock()

    def limit(self) -> int:
        try:
            value = int(self._limit_getter())
        except (TypeError, ValueError):
            value = 1
        return max(1, min(2, value))

    def _ensure_guard(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            with self._stats_lock:
                if self._active or self._waiters:
                    raise RuntimeError("模型队列正在另一个事件循环中运行")
                self._loop = loop
                self._guard = asyncio.Lock()
        assert self._guard is not None
        return self._guard

    def _wake_locked(self) -> None:
        with self._stats_lock:
            limit = self.limit()
            while self._waiters and self._active < limit:
                ticket = self._waiters.popleft()
                if ticket.future.cancelled() or ticket.future.done():
                    continue
                self._active += 1
                self._active_by_platform[ticket.platform] += 1
                ticket.future.set_result(None)

    async def acquire(self, platform: str) -> str:
        platform = platform if platform in {"boss", "zhaopin"} else "boss"
        guard = self._ensure_guard()
        loop = asyncio.get_running_loop()
        ticket = _Ticket(
            ticket_id=f"model-{uuid.uuid4().hex[:12]}",
            platform=platform,
            future=loop.create_future(),
        )
        async with guard:
            with self._stats_lock:
                self._waiters.append(ticket)
            self._wake_locked()
        try:
            await ticket.future
            return ticket.ticket_id
        except asyncio.CancelledError:
            async with guard:
                with self._stats_lock:
                    self._waiters = deque(item for item in self._waiters if item.ticket_id != ticket.ticket_id)
                self._wake_locked()
            raise

    async def release(self, platform: str) -> None:
        guard = self._ensure_guard()
        async with guard:
            with self._stats_lock:
                self._active = max(0, self._active - 1)
                if self._active_by_platform.get(platform, 0) > 1:
                    self._active_by_platform[platform] -= 1
                else:
                    self._active_by_platform.pop(platform, None)
            self._wake_locked()

    async def run(
        self,
        platform: str,
        executor: Any,
        func: Callable[..., Any],
        *args: Any,
    ) -> Any:
        await self.acquire(platform)
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(executor, func, *args)
        finally:
            await self.release(platform)

    async def cancel_platform(self, platform: str, reason: str = "平台已暂停") -> int:
        guard = self._ensure_guard()
        cancelled = 0
        async with guard:
            remaining: deque[_Ticket] = deque()
            with self._stats_lock:
                while self._waiters:
                    ticket = self._waiters.popleft()
                    if ticket.platform == platform and not ticket.future.done():
                        ticket.future.set_exception(ModelQueueCancelled(reason))
                        cancelled += 1
                    else:
                        remaining.append(ticket)
                self._waiters = remaining
            self._wake_locked()
        return cancelled

    async def cancel_all(self, reason: str = "全局任务已暂停") -> int:
        guard = self._ensure_guard()
        cancelled = 0
        async with guard:
            with self._stats_lock:
                while self._waiters:
                    ticket = self._waiters.popleft()
                    if not ticket.future.done():
                        ticket.future.set_exception(ModelQueueCancelled(reason))
                        cancelled += 1
            self._wake_locked()
        return cancelled

    def snapshot(self) -> dict[str, Any]:
        with self._stats_lock:
            queued_by_platform = Counter(ticket.platform for ticket in self._waiters if not ticket.future.done())
            return {
                "limit": self.limit(),
                "active": self._active,
                "queued": sum(queued_by_platform.values()),
                "active_by_platform": dict(self._active_by_platform),
                "queued_by_platform": dict(queued_by_platform),
            }
