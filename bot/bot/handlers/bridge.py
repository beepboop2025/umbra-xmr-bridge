"""Full bridge conversation flow.

Flow:
  1. /bridge  or  menu:bridge callback  ->  direction type (from XMR / to XMR)
  2. Pick destination chain/token
  3. Pick or enter amount
  4. Enter destination address
  5. Confirm with fee breakdown
  6. Create order via API -> show deposit address
  7. Poll status every 30s, notify on completion
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from aiogram import Bot, F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from bot.config import settings
from bot.keyboards.inline import (
    amount_presets_kb,
    back_kb,
    chain_select_kb,
    confirm_cancel_kb,
    direction_type_kb,
)
from bot.middlewares.rate_limit import RateLimitMiddleware
from bot.services.api_client import APIError, api_client
from bot.utils.formatters import (
    CHAIN_EMOJI,
    format_amount,
    format_order_status,
    truncate_address,
)

logger = logging.getLogger(__name__)
router = Router(name="bridge")


# ---------------------------------------------------------------------------
# FSM states
# ---------------------------------------------------------------------------
class BridgeStates(StatesGroup):
    choosing_direction = State()
    choosing_chain = State()
    entering_amount = State()
    entering_address = State()
    confirming = State()


# ---------------------------------------------------------------------------
# Step 1 -- direction type
# ---------------------------------------------------------------------------
@router.callback_query(F.data == "menu:bridge")
async def cb_bridge_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(BridgeStates.choosing_direction)
    text = (
        "\U0001f504 <b>Select bridge direction</b>\n\n"
        "Are you sending XMR or receiving XMR?"
    )
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=direction_type_kb(), parse_mode="HTML",
        )
    await callback.answer()


@router.callback_query(F.data == "menu:bridge_cancel")
async def cb_bridge_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    if callback.message:
        await callback.message.edit_text(
            "\u274c Bridge cancelled.",
            reply_markup=back_kb("menu:start"),
            parse_mode="HTML",
        )
    await callback.answer()


# ---------------------------------------------------------------------------
# Step 2 -- direction picked, now select chain
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("dir_type:"))
async def cb_direction_type(callback: CallbackQuery, state: FSMContext) -> None:
    direction = callback.data.split(":")[1]  # from_xmr | to_xmr
    await state.update_data(direction=direction)
    await state.set_state(BridgeStates.choosing_chain)

    if direction == "from_xmr":
        text = "\U0001f4e4 <b>XMR \u2192 ?</b>\nSelect the destination chain/token:"
    else:
        text = "\U0001f4e5 <b>? \u2192 XMR</b>\nSelect the source chain/token:"

    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=chain_select_kb(direction), parse_mode="HTML",
        )
    await callback.answer()


# ---------------------------------------------------------------------------
# Step 3 -- chain selected, enter amount
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("chain:"))
async def cb_chain_selected(callback: CallbackQuery, state: FSMContext) -> None:
    _, direction, chain = callback.data.split(":")
    if direction == "from_xmr":
        from_cur, to_cur = "XMR", chain
    else:
        from_cur, to_cur = chain, "XMR"

    await state.update_data(from_currency=from_cur, to_currency=to_cur)
    await state.set_state(BridgeStates.entering_amount)

    fe = CHAIN_EMOJI.get(from_cur, "")
    te = CHAIN_EMOJI.get(to_cur, "")

    # Try to fetch the current rate for context
    rate_text = ""
    try:
        rate_data = await api_client.fetch_rate(from_cur, to_cur)
        rate_val = rate_data.get("rate")
        if rate_val:
            rate_text = f"\n\U0001f4b1 Rate: 1 {from_cur} \u2248 {float(rate_val):,.6f} {to_cur}\n"
    except Exception:
        pass

    text = (
        f"{fe} <b>{from_cur} \u2192 {to_cur}</b> {te}\n"
        f"{rate_text}\n"
        f"Enter the amount of <b>{from_cur}</b> to send,\n"
        f"or pick a preset:"
    )
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=amount_presets_kb(from_cur), parse_mode="HTML",
        )
    await callback.answer()


# Amount from preset button
@router.callback_query(F.data.startswith("amount:"))
async def cb_amount_preset(callback: CallbackQuery, state: FSMContext) -> None:
    value = callback.data.split(":")[1]
    if value == "custom":
        if callback.message:
            await callback.message.edit_text(
                "\u270f\ufe0f Please type the amount:",
                reply_markup=back_kb("menu:bridge"),
                parse_mode="HTML",
            )
        await callback.answer()
        return

    try:
        amount = float(value)
    except ValueError:
        await callback.answer("Invalid amount", show_alert=True)
        return

    await _process_amount(callback, state, amount)
    await callback.answer()


# Amount from typed message
@router.message(BridgeStates.entering_amount)
async def msg_amount_input(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    try:
        amount = float(text)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer(
            "\u26a0\ufe0f Please enter a valid positive number.",
            parse_mode="HTML",
        )
        return
    # Use a fake CallbackQuery-like flow via helper
    await _process_amount_msg(message, state, amount)


async def _process_amount(callback: CallbackQuery, state: FSMContext, amount: float) -> None:
    """Shared logic after amount is known (callback path)."""
    await state.update_data(amount=amount)
    await state.set_state(BridgeStates.entering_address)
    data = await state.get_data()
    to_cur = data.get("to_currency", "???")

    text = (
        f"\U0001f4cd <b>Destination address</b>\n\n"
        f"Send your <b>{to_cur}</b> receiving address:"
    )
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=back_kb("menu:bridge"), parse_mode="HTML",
        )


async def _process_amount_msg(message: Message, state: FSMContext, amount: float) -> None:
    """Shared logic after amount is known (message path)."""
    await state.update_data(amount=amount)
    await state.set_state(BridgeStates.entering_address)
    data = await state.get_data()
    to_cur = data.get("to_currency", "???")

    text = (
        f"\U0001f4cd <b>Destination address</b>\n\n"
        f"Send your <b>{to_cur}</b> receiving address:"
    )
    await message.answer(text, reply_markup=back_kb("menu:bridge"), parse_mode="HTML")


# ---------------------------------------------------------------------------
# Step 4 -- address entered, show confirmation
# ---------------------------------------------------------------------------
@router.message(BridgeStates.entering_address)
async def msg_address_input(message: Message, state: FSMContext) -> None:
    address = (message.text or "").strip()
    if len(address) < 10:
        await message.answer(
            "\u26a0\ufe0f That doesn't look like a valid address. Please try again.",
        )
        return

    await state.update_data(destination_address=address)
    await state.set_state(BridgeStates.confirming)
    data = await state.get_data()

    from_cur = data.get("from_currency", "XMR")
    to_cur = data.get("to_currency", "???")
    amount = data.get("amount", 0)
    fe = CHAIN_EMOJI.get(from_cur, "")
    te = CHAIN_EMOJI.get(to_cur, "")

    # Fetch rate for fee breakdown
    rate_line = ""
    estimated_out = ""
    fee_line = ""
    try:
        rate_data = await api_client.fetch_rate(from_cur, to_cur)
        rate_val = float(rate_data.get("rate", 0))
        fee_pct = float(rate_data.get("fee_pct", 0.5))
        if rate_val > 0:
            gross = amount * rate_val
            fee = gross * fee_pct / 100
            net = gross - fee
            rate_line = f"\U0001f4b1 <b>Rate:</b> 1 {from_cur} = {rate_val:,.6f} {to_cur}\n"
            fee_line = f"\U0001f4b8 <b>Fee:</b> {fee_pct}% ({format_amount(fee, to_cur)})\n"
            estimated_out = f"\U0001f4e6 <b>You receive:</b> ~{format_amount(net, to_cur)}\n"
    except Exception:
        rate_line = "\u26a0\ufe0f Could not fetch live rate.\n"

    text = (
        f"\U0001f50d <b>Order Summary</b>\n\n"
        f"{fe} <b>Send:</b> {format_amount(amount, from_cur)}\n"
        f"{te} <b>To:</b> {truncate_address(address)}\n"
        f"{rate_line}"
        f"{fee_line}"
        f"{estimated_out}\n"
        f"Confirm to proceed?"
    )
    await message.answer(
        text, reply_markup=confirm_cancel_kb("bridge"), parse_mode="HTML",
    )


# ---------------------------------------------------------------------------
# Step 5 -- confirm or cancel
# ---------------------------------------------------------------------------
@router.callback_query(F.data == "confirm:bridge")
async def cb_confirm_order(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    user_id = callback.from_user.id

    # Rate-limit check
    if not RateLimitMiddleware.can_create_order(user_id):
        await callback.answer(
            f"You can only create {settings.MAX_ORDERS_PER_HOUR} orders per hour.",
            show_alert=True,
        )
        return

    from_cur = data.get("from_currency", "XMR")
    to_cur = data.get("to_currency", "???")
    amount = float(data.get("amount", 0))
    address = data.get("destination_address", "")
    slippage = float(data.get("slippage", 0.5))

    if callback.message:
        await callback.message.edit_text(
            "\u23f3 Creating your order...", parse_mode="HTML",
        )

    try:
        order = await api_client.create_order(
            tg_user_id=user_id,
            from_currency=from_cur,
            to_currency=to_cur,
            amount=amount,
            destination_address=address,
            slippage=slippage,
        )
    except APIError as exc:
        if callback.message:
            await callback.message.edit_text(
                f"\u274c Order failed: {exc.detail}",
                reply_markup=back_kb("menu:bridge"),
                parse_mode="HTML",
            )
        await callback.answer()
        await state.clear()
        return
    except Exception as exc:
        logger.exception("Order creation failed")
        if callback.message:
            await callback.message.edit_text(
                "\u274c Unexpected error. Please try again later.",
                reply_markup=back_kb("menu:start"),
                parse_mode="HTML",
            )
        await callback.answer()
        await state.clear()
        return

    # Signal to rate-limit middleware
    order_flag: dict[str, bool] | None = callback.__dict__.get("order_flag")
    # The flag is injected via middleware data, access it properly:
    # (it's in the handler's **data kwargs -- we passed it through)

    await state.clear()

    order_id = order.get("id", "???")
    deposit_addr = order.get("deposit_address", "N/A")

    text = (
        f"\u2705 <b>Order Created!</b>\n\n"
        f"\U0001f194 <code>{order_id}</code>\n\n"
        f"\U0001f4e5 <b>Deposit {format_amount(amount, from_cur)} to:</b>\n"
        f"<code>{deposit_addr}</code>\n\n"
        f"\u23f3 The bot will notify you when the swap completes.\n"
        f"Use /status {order_id} to check manually."
    )
    if callback.message:
        await callback.message.edit_text(text, reply_markup=back_kb("menu:start"), parse_mode="HTML")
    await callback.answer()

    # Start background polling for this order
    asyncio.create_task(_poll_order_status(bot, user_id, order_id))


@router.callback_query(F.data == "cancel:bridge")
async def cb_cancel_order(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    if callback.message:
        await callback.message.edit_text(
            "\u274c Bridge order cancelled.",
            reply_markup=back_kb("menu:start"),
            parse_mode="HTML",
        )
    await callback.answer()


# ---------------------------------------------------------------------------
# Background status poller
# ---------------------------------------------------------------------------
TERMINAL_STATUSES = {"completed", "failed", "refunded", "expired", "cancelled"}


async def _poll_order_status(bot: Bot, chat_id: int, order_id: str) -> None:
    """Poll the backend every N seconds and notify the user on status change."""
    previous_status: str | None = None
    max_polls = 360  # 360 * 30s = 3 hours max

    for _ in range(max_polls):
        await asyncio.sleep(settings.STATUS_POLL_INTERVAL)
        try:
            order = await api_client.get_order(order_id)
        except Exception:
            logger.warning("Poll failed for order %s", order_id)
            continue

        status = order.get("status", "")
        if status == previous_status:
            continue
        previous_status = status

        # Notify on meaningful transitions
        text = format_order_status(order)
        try:
            await bot.send_message(chat_id, text, parse_mode="HTML")
        except Exception:
            logger.warning("Failed to send status update to %s", chat_id)

        if status in TERMINAL_STATUSES:
            return

    # Timed out polling
    try:
        await bot.send_message(
            chat_id,
            f"\u23f0 Status polling timed out for order <code>{order_id}</code>. "
            f"Use /status {order_id} to check manually.",
            parse_mode="HTML",
        )
    except Exception:
        pass
