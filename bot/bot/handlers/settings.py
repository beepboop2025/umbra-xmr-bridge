"""/settings handler -- slippage tolerance selection."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.keyboards.inline import back_kb, slippage_kb

logger = logging.getLogger(__name__)
router = Router(name="settings")


async def _get_slippage(state: FSMContext) -> float:
    data = await state.get_data()
    return float(data.get("slippage", 0.5))


@router.message(Command("settings"))
async def cmd_settings(message: Message, state: FSMContext) -> None:
    current = await _get_slippage(state)
    text = (
        "\u2699\ufe0f <b>Settings</b>\n\n"
        f"<b>Slippage tolerance:</b> {current}%\n\n"
        "Select your preferred slippage:"
    )
    await message.answer(text, reply_markup=slippage_kb(current), parse_mode="HTML")


@router.callback_query(F.data == "menu:settings")
async def cb_settings(callback: CallbackQuery, state: FSMContext) -> None:
    current = await _get_slippage(state)
    text = (
        "\u2699\ufe0f <b>Settings</b>\n\n"
        f"<b>Slippage tolerance:</b> {current}%\n\n"
        "Select your preferred slippage:"
    )
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=slippage_kb(current), parse_mode="HTML",
        )
    await callback.answer()


@router.callback_query(F.data.startswith("slippage:"))
async def cb_slippage_set(callback: CallbackQuery, state: FSMContext) -> None:
    try:
        value = float(callback.data.split(":")[1])
    except (ValueError, IndexError):
        await callback.answer("Invalid value", show_alert=True)
        return

    await state.update_data(slippage=value)
    text = (
        "\u2699\ufe0f <b>Settings</b>\n\n"
        f"<b>Slippage tolerance:</b> {value}% \u2705\n\n"
        "Select your preferred slippage:"
    )
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=slippage_kb(value), parse_mode="HTML",
        )
    await callback.answer(f"Slippage set to {value}%")
