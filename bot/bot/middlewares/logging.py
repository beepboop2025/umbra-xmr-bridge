"""Logging middleware -- records every incoming command / callback."""

from __future__ import annotations

import logging
import time
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

logger = logging.getLogger("bot.audit")


class LoggingMiddleware(BaseMiddleware):
    """Log user_id, update type, and command text for every handled event."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        start = time.perf_counter()
        user_id: int | None = None
        description = ""

        if isinstance(event, Message):
            user_id = event.from_user.id if event.from_user else None
            description = (event.text or "")[:80]
        elif isinstance(event, CallbackQuery):
            user_id = event.from_user.id if event.from_user else None
            description = f"callback:{event.data or ''}"

        logger.info(
            "incoming | user=%s | %s",
            user_id,
            description,
        )

        try:
            result = await handler(event, data)
        except Exception:
            elapsed = (time.perf_counter() - start) * 1000
            logger.exception(
                "error    | user=%s | %s | %.1fms",
                user_id, description, elapsed,
            )
            raise

        elapsed = (time.perf_counter() - start) * 1000
        logger.info(
            "handled  | user=%s | %s | %.1fms",
            user_id, description, elapsed,
        )
        return result
