"""/start command handler."""

from __future__ import annotations

import logging

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import CallbackQuery, Message

from bot.keyboards.inline import main_menu_kb
from bot.services.api_client import api_client
from bot.utils.formatters import format_amount

logger = logging.getLogger(__name__)
router = Router(name="start")

WELCOME_TEXT = (
    "\U0001f309 <b>XMR Multi-Chain Bridge</b>\n"
    "\n"
    "Swap Monero (XMR) to and from:\n"
    "BTC \u00b7 ETH \u00b7 TON \u00b7 SOL \u00b7 ARB \u00b7 BASE \u00b7 USDC \u00b7 USDT\n"
    "\n"
    "Fast, private, non-custodial.\n"
)


async def _build_welcome(tg_user_id: int) -> str:
    """Append user stats when available."""
    text = WELCOME_TEXT
    try:
        orders = await api_client.list_orders(tg_user_id, limit=100)
        if orders:
            completed = [o for o in orders if o.get("status") == "completed"]
            total_xmr = sum(float(o.get("amount_in", 0)) for o in completed)
            text += (
                f"\n\U0001f4ca <b>Your stats:</b>\n"
                f"  Orders: {len(orders)} total, {len(completed)} completed\n"
                f"  Volume: {format_amount(total_xmr, 'XMR')}\n"
            )
    except Exception:
        logger.debug("Could not fetch user stats for %s", tg_user_id)
    return text


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    user_id = message.from_user.id if message.from_user else 0
    text = await _build_welcome(user_id)
    await message.answer(text, reply_markup=main_menu_kb(), parse_mode="HTML")


@router.callback_query(lambda cb: cb.data == "menu:start")
async def cb_start(callback: CallbackQuery) -> None:
    user_id = callback.from_user.id if callback.from_user else 0
    text = await _build_welcome(user_id)
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=main_menu_kb(), parse_mode="HTML",
        )
    await callback.answer()
