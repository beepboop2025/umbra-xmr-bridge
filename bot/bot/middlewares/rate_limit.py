"""Per-user rate limiting middleware for aiogram 3.x.

Two independent limits:
  - 30 messages per minute  (all updates)
  - 3 order-creation actions per hour  (tracked via ``order_created`` flag in handler data)
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

from bot.config import settings

# ---------------------------------------------------------------------------
# Simple sliding-window counters keyed by user_id
# ---------------------------------------------------------------------------

_msg_buckets: dict[int, list[float]] = defaultdict(list)
_order_buckets: dict[int, list[float]] = defaultdict(list)

MSG_WINDOW = 60.0  # seconds
ORDER_WINDOW = 3600.0  # seconds


def _prune(bucket: list[float], window: float, now: float) -> list[float]:
    cutoff = now - window
    return [ts for ts in bucket if ts > cutoff]


class RateLimitMiddleware(BaseMiddleware):
    """Drop updates that exceed per-user rate limits."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user_id: int | None = None
        if isinstance(event, Message) and event.from_user:
            user_id = event.from_user.id
        elif isinstance(event, CallbackQuery) and event.from_user:
            user_id = event.from_user.id

        if user_id is None:
            return await handler(event, data)

        now = time.monotonic()

        # --- Message rate ---
        _msg_buckets[user_id] = _prune(_msg_buckets[user_id], MSG_WINDOW, now)
        if len(_msg_buckets[user_id]) >= settings.MAX_MESSAGES_PER_MINUTE:
            if isinstance(event, Message):
                await event.answer(
                    "\u26a0\ufe0f You are sending messages too fast. Please wait a moment.",
                )
            elif isinstance(event, CallbackQuery):
                await event.answer(
                    "Too many requests. Please slow down.", show_alert=True,
                )
            return  # drop the update
        _msg_buckets[user_id].append(now)

        # --- Order rate (checked *after* handler sets flag) ---
        # We inject a mutable dict so the handler can signal an order was created.
        order_flag: dict[str, bool] = {"created": False}
        data["order_flag"] = order_flag

        result = await handler(event, data)

        if order_flag["created"]:
            _order_buckets[user_id] = _prune(
                _order_buckets[user_id], ORDER_WINDOW, time.monotonic(),
            )
            if len(_order_buckets[user_id]) >= settings.MAX_ORDERS_PER_HOUR:
                # The order was already created -- we warn but don't block retroactively
                if isinstance(event, (Message, CallbackQuery)):
                    text = (
                        f"\u26a0\ufe0f You have reached the limit of "
                        f"{settings.MAX_ORDERS_PER_HOUR} orders per hour. "
                        f"Further orders will be rejected until the window resets."
                    )
                    if isinstance(event, Message):
                        await event.answer(text)
                    else:
                        await event.answer(text, show_alert=True)
            _order_buckets[user_id].append(time.monotonic())

        return result

    # ------------------------------------------------------------------
    # Helper -- called by bridge handler *before* creating the order
    # ------------------------------------------------------------------
    @staticmethod
    def can_create_order(user_id: int) -> bool:
        now = time.monotonic()
        _order_buckets[user_id] = _prune(_order_buckets[user_id], ORDER_WINDOW, now)
        return len(_order_buckets[user_id]) < settings.MAX_ORDERS_PER_HOUR
