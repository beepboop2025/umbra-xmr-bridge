"""/admin handler -- stats and pending orders (restricted to ADMIN_IDS)."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from bot.config import settings
from bot.keyboards.inline import back_kb
from bot.services.api_client import api_client
from bot.utils.formatters import STATUS_EMOJI, format_amount, truncate_address

logger = logging.getLogger(__name__)
router = Router(name="admin")


def _is_admin(user_id: int | None) -> bool:
    if user_id is None:
        return False
    return user_id in settings.ADMIN_IDS


async def _build_stats_text() -> str:
    try:
        stats = await api_client.get_stats()
    except Exception:
        logger.exception("Failed to fetch admin stats")
        return "\u26a0\ufe0f Could not fetch stats from backend."

    lines = [
        "\U0001f4ca <b>Admin Dashboard</b>\n",
        f"<b>Total orders:</b> {stats.get('total_orders', 'N/A')}",
        f"<b>Completed:</b> {stats.get('completed_orders', 'N/A')}",
        f"<b>Pending:</b> {stats.get('pending_orders', 'N/A')}",
        f"<b>Failed:</b> {stats.get('failed_orders', 'N/A')}",
        f"<b>Total volume:</b> {format_amount(stats.get('total_volume_xmr'), 'XMR')}",
        f"<b>Total fees:</b> {format_amount(stats.get('total_fees_xmr'), 'XMR')}",
        f"<b>Unique users:</b> {stats.get('unique_users', 'N/A')}",
    ]
    return "\n".join(lines)


async def _build_pending_text() -> str:
    try:
        orders = await api_client.get_pending_orders()
    except Exception:
        logger.exception("Failed to fetch pending orders")
        return "\u26a0\ufe0f Could not fetch pending orders."

    if not orders:
        return "\u2705 No pending orders."

    lines = [f"\u23f3 <b>Pending Orders ({len(orders)})</b>\n"]
    for order in orders[:20]:  # cap display at 20
        oid = order.get("id", "?")
        status = order.get("status", "?")
        emoji = STATUS_EMOJI.get(status, "\u2753")
        from_cur = order.get("from_currency", "XMR")
        to_cur = order.get("to_currency", "?")
        amount = order.get("amount_in")
        dest = truncate_address(order.get("destination_address"))
        lines.append(
            f"  {emoji} <code>{oid[:8]}</code> "
            f"{from_cur}\u2192{to_cur} {format_amount(amount, from_cur)} \u2192 {dest}"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# /admin command
# ---------------------------------------------------------------------------
@router.message(Command("admin"))
async def cmd_admin(message: Message) -> None:
    user_id = message.from_user.id if message.from_user else None
    if not _is_admin(user_id):
        await message.answer("\U0001f6ab You are not authorized to use this command.")
        return

    stats_text = await _build_stats_text()
    pending_text = await _build_pending_text()
    text = f"{stats_text}\n\n{'=' * 30}\n\n{pending_text}"
    await message.answer(text, reply_markup=back_kb("menu:start"), parse_mode="HTML")


# ---------------------------------------------------------------------------
# Callback (from a potential admin inline button)
# ---------------------------------------------------------------------------
@router.callback_query(F.data == "menu:admin")
async def cb_admin(callback: CallbackQuery) -> None:
    user_id = callback.from_user.id if callback.from_user else None
    if not _is_admin(user_id):
        await callback.answer("Unauthorized.", show_alert=True)
        return

    stats_text = await _build_stats_text()
    pending_text = await _build_pending_text()
    text = f"{stats_text}\n\n{'=' * 30}\n\n{pending_text}"
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=back_kb("menu:start"), parse_mode="HTML",
        )
    await callback.answer()
