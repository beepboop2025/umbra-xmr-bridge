"""/rate handler -- show current rates for all supported pairs."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from bot.keyboards.inline import DEST_CHAINS, back_kb
from bot.services.api_client import api_client
from bot.utils.formatters import format_rate

logger = logging.getLogger(__name__)
router = Router(name="rates")


async def _build_rates_text() -> str:
    lines = ["\U0001f4ca <b>Current Exchange Rates</b>\n"]

    try:
        all_rates = await api_client.fetch_all_rates()
        if isinstance(all_rates, list):
            for entry in all_rates:
                direction = f"{entry.get('from_currency', '?')}_{entry.get('to_currency', '?')}"
                rate = entry.get("rate", 0)
                change = entry.get("change_24h")
                lines.append(format_rate(direction, rate, change))
        else:
            # Fallback: fetch individual pairs
            raise ValueError("unexpected format")
    except Exception:
        logger.debug("Bulk rates failed, fetching individually")
        for chain in DEST_CHAINS:
            try:
                data = await api_client.fetch_rate("XMR", chain)
                rate = data.get("rate", 0)
                change = data.get("change_24h")
                lines.append(format_rate(f"XMR_{chain}", rate, change))
            except Exception:
                lines.append(f"  \u26a0\ufe0f XMR/{chain}: unavailable")

    lines.append("\n\U0001f552 Rates refresh automatically.")
    return "\n".join(lines)


@router.message(Command("rate", "rates"))
async def cmd_rates(message: Message) -> None:
    text = await _build_rates_text()
    await message.answer(text, reply_markup=back_kb("menu:start"), parse_mode="HTML")


@router.callback_query(F.data == "menu:rates")
async def cb_rates(callback: CallbackQuery) -> None:
    text = await _build_rates_text()
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=back_kb("menu:start"), parse_mode="HTML",
        )
    await callback.answer()
