"""Bot entry point -- polling or webhook depending on config."""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
from typing import Any

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

from bot.config import settings
from bot.handlers import admin, bridge, help as help_, history, rates, settings as settings_, start, status
from bot.middlewares.logging import LoggingMiddleware
from bot.middlewares.rate_limit import RateLimitMiddleware
from bot.services.api_client import api_client

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("bot")

# ---------------------------------------------------------------------------
# Bot & Dispatcher
# ---------------------------------------------------------------------------
bot = Bot(
    token=settings.BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)

storage = MemoryStorage()
dp = Dispatcher(storage=storage)

# ---------------------------------------------------------------------------
# Register routers (order matters for FSM state handling in bridge)
# ---------------------------------------------------------------------------
dp.include_routers(
    start.router,
    bridge.router,
    status.router,
    history.router,
    rates.router,
    settings_.router,
    help_.router,
    admin.router,
)

# ---------------------------------------------------------------------------
# Register middlewares on both message and callback_query
# ---------------------------------------------------------------------------
dp.message.middleware(LoggingMiddleware())
dp.message.middleware(RateLimitMiddleware())
dp.callback_query.middleware(LoggingMiddleware())
dp.callback_query.middleware(RateLimitMiddleware())

# ---------------------------------------------------------------------------
# Bot commands for Telegram menu
# ---------------------------------------------------------------------------
BOT_COMMANDS = [
    BotCommand(command="start", description="Main menu"),
    BotCommand(command="bridge", description="Start a new swap"),
    BotCommand(command="rate", description="Current exchange rates"),
    BotCommand(command="status", description="Check order status"),
    BotCommand(command="history", description="Your order history"),
    BotCommand(command="settings", description="Adjust slippage"),
    BotCommand(command="help", description="Help & FAQ"),
]


async def on_startup(bot_instance: Bot) -> None:
    """Called once when the bot starts."""
    await bot_instance.set_my_commands(BOT_COMMANDS)
    logger.info("Bot commands registered")

    if settings.is_webhook_mode:
        await bot_instance.set_webhook(
            settings.full_webhook_url,
            drop_pending_updates=True,
        )
        logger.info("Webhook set: %s", settings.full_webhook_url)
    else:
        await bot_instance.delete_webhook(drop_pending_updates=True)
        logger.info("Polling mode -- webhook removed")


async def on_shutdown(bot_instance: Bot) -> None:
    """Called once when the bot shuts down."""
    logger.info("Shutting down...")
    await api_client.close()
    await bot_instance.session.close()


dp.startup.register(on_startup)
dp.shutdown.register(on_shutdown)


# ---------------------------------------------------------------------------
# /bridge as a slash-command (redirects to the callback flow)
# ---------------------------------------------------------------------------
from aiogram.filters import Command  # noqa: E402
from aiogram.types import Message  # noqa: E402
from bot.keyboards.inline import direction_type_kb  # noqa: E402


@dp.message(Command("bridge"))
async def cmd_bridge(message: Message) -> None:
    text = (
        "\U0001f504 <b>Select bridge direction</b>\n\n"
        "Are you sending XMR or receiving XMR?"
    )
    await message.answer(text, reply_markup=direction_type_kb(), parse_mode="HTML")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def run_polling() -> None:
    """Start the bot in long-polling mode (default)."""

    async def _main() -> None:
        logger.info("Starting bot in polling mode...")
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())

    asyncio.run(_main())


def run_webhook() -> None:
    """Start the bot behind an aiohttp webhook server."""
    from aiohttp import web

    app = web.Application()
    handler = SimpleRequestHandler(dispatcher=dp, bot=bot)
    handler.register(app, path=settings.WEBHOOK_PATH)
    setup_application(app, dp, bot=bot)

    logger.info("Starting webhook server on 0.0.0.0:8081%s", settings.WEBHOOK_PATH)
    web.run_app(app, host="0.0.0.0", port=8081)


def main() -> None:
    if settings.is_webhook_mode:
        run_webhook()
    else:
        run_polling()


if __name__ == "__main__":
    main()
