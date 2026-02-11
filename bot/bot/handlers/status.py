"""/status <order_id> handler -- show current order with emoji progress bar."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from bot.keyboards.inline import back_kb, order_detail_kb
from bot.services.api_client import APIError, api_client
from bot.utils.formatters import format_order_status

logger = logging.getLogger(__name__)
router = Router(name="status")


@router.message(Command("status"))
async def cmd_status(message: Message) -> None:
    args = (message.text or "").split(maxsplit=1)
    if len(args) < 2 or not args[1].strip():
        await message.answer(
            "\u2753 Usage: /status <code>ORDER_ID</code>",
            parse_mode="HTML",
        )
        return

    order_id = args[1].strip()
    await _show_order(message, order_id)


async def _show_order(target: Message, order_id: str) -> None:
    try:
        order = await api_client.get_order(order_id)
    except APIError as exc:
        if exc.status_code == 404:
            await target.answer(
                f"\u274c Order <code>{order_id}</code> not found.",
                parse_mode="HTML",
            )
        else:
            await target.answer(
                f"\u26a0\ufe0f Error fetching order: {exc.detail}",
                parse_mode="HTML",
            )
        return
    except Exception:
        logger.exception("Failed to fetch order %s", order_id)
        await target.answer(
            "\u26a0\ufe0f Could not reach the backend. Try again later.",
        )
        return

    text = format_order_status(order)
    await target.answer(
        text, reply_markup=order_detail_kb(order_id), parse_mode="HTML",
    )


# ---------------------------------------------------------------------------
# Callback: refresh an order
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("order_refresh:"))
async def cb_order_refresh(callback: CallbackQuery) -> None:
    order_id = callback.data.split(":")[1]
    try:
        order = await api_client.get_order(order_id)
    except Exception:
        await callback.answer("Could not refresh order.", show_alert=True)
        return

    text = format_order_status(order)
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=order_detail_kb(order_id), parse_mode="HTML",
        )
    await callback.answer("Refreshed!")


# ---------------------------------------------------------------------------
# Callback: cancel an order
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("order_cancel:"))
async def cb_order_cancel(callback: CallbackQuery) -> None:
    order_id = callback.data.split(":")[1]
    try:
        order = await api_client.cancel_order(order_id)
    except APIError as exc:
        await callback.answer(f"Cannot cancel: {exc.detail}", show_alert=True)
        return
    except Exception:
        await callback.answer("Error cancelling order.", show_alert=True)
        return

    text = format_order_status(order)
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=back_kb("menu:history"), parse_mode="HTML",
        )
    await callback.answer("Order cancelled.")
