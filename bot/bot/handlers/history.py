"""/history handler -- show last 10 orders as an inline list."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from bot.keyboards.inline import back_kb, order_detail_kb
from bot.services.api_client import api_client
from bot.utils.formatters import (
    CHAIN_EMOJI,
    STATUS_EMOJI,
    format_amount,
    format_order_status,
)

logger = logging.getLogger(__name__)
router = Router(name="history")


def _build_history_text_and_kb(
    orders: list[dict],
) -> tuple[str, InlineKeyboardMarkup]:
    if not orders:
        return (
            "\U0001f4dc <b>Order History</b>\n\nYou have no orders yet.",
            back_kb("menu:start"),
        )

    lines = ["\U0001f4dc <b>Order History</b> (last 10)\n"]
    buttons: list[list[InlineKeyboardButton]] = []

    for order in orders:
        oid = order.get("id", "?")
        status = order.get("status", "pending")
        from_cur = order.get("from_currency", "XMR")
        to_cur = order.get("to_currency", "?")
        amount = order.get("amount_in")
        emoji = STATUS_EMOJI.get(status, "\u2753")
        fe = CHAIN_EMOJI.get(from_cur, "")
        te = CHAIN_EMOJI.get(to_cur, "")

        short_id = oid[:8] if len(oid) > 8 else oid
        lines.append(
            f"  {emoji} <code>{short_id}</code> "
            f"{fe}{from_cur}\u2192{to_cur}{te} "
            f"{format_amount(amount, from_cur)}"
        )
        buttons.append([
            InlineKeyboardButton(
                text=f"{emoji} {short_id} - {status}",
                callback_data=f"history_detail:{oid}",
            )
        ])

    buttons.append([
        InlineKeyboardButton(text="\u2b05\ufe0f Back", callback_data="menu:start"),
    ])

    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=buttons)


async def _send_history(target: Message | CallbackQuery, user_id: int) -> str | None:
    """Fetch and format history. Returns the text or None on error."""
    try:
        orders = await api_client.list_orders(user_id, limit=10)
    except Exception:
        logger.exception("Failed to fetch orders for user %s", user_id)
        return None
    text, kb = _build_history_text_and_kb(orders)

    if isinstance(target, Message):
        await target.answer(text, reply_markup=kb, parse_mode="HTML")
    elif isinstance(target, CallbackQuery) and target.message:
        await target.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    return text


@router.message(Command("history"))
async def cmd_history(message: Message) -> None:
    user_id = message.from_user.id if message.from_user else 0
    result = await _send_history(message, user_id)
    if result is None:
        await message.answer("\u26a0\ufe0f Could not load your order history.")


@router.callback_query(F.data == "menu:history")
async def cb_history(callback: CallbackQuery) -> None:
    user_id = callback.from_user.id if callback.from_user else 0
    result = await _send_history(callback, user_id)
    if result is None and callback.message:
        await callback.message.edit_text(
            "\u26a0\ufe0f Could not load your order history.",
            reply_markup=back_kb("menu:start"),
            parse_mode="HTML",
        )
    await callback.answer()


# ---------------------------------------------------------------------------
# History detail -- tap on an order in the list
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("history_detail:"))
async def cb_history_detail(callback: CallbackQuery) -> None:
    order_id = callback.data.split(":")[1]
    try:
        order = await api_client.get_order(order_id)
    except Exception:
        await callback.answer("Could not load order.", show_alert=True)
        return

    text = format_order_status(order)
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=order_detail_kb(order_id), parse_mode="HTML",
        )
    await callback.answer()
