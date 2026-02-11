"""/help handler -- command list and FAQ."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from bot.keyboards.inline import back_kb

router = Router(name="help")

HELP_TEXT = (
    "\u2753 <b>XMR Multi-Chain Bridge - Help</b>\n"
    "\n"
    "<b>Commands:</b>\n"
    "/start  \u2014  Main menu\n"
    "/bridge  \u2014  Start a new swap (also via menu)\n"
    "/rate  \u2014  View current exchange rates\n"
    "/status <code>ORDER_ID</code>  \u2014  Check order status\n"
    "/history  \u2014  Your last 10 orders\n"
    "/settings  \u2014  Adjust slippage tolerance\n"
    "/help  \u2014  This help message\n"
    "\n"
    "<b>Supported Pairs:</b>\n"
    "XMR \u2194 BTC, ETH, TON, SOL, ARB, BASE, USDC, USDT\n"
    "\n"
    "<b>FAQ:</b>\n"
    "\n"
    "<b>Q: How long does a swap take?</b>\n"
    "A: Usually 10\u201340 minutes depending on network confirmations.\n"
    "\n"
    "<b>Q: What are the fees?</b>\n"
    "A: A small percentage fee is applied. The exact fee is shown\n"
    "   before you confirm each order.\n"
    "\n"
    "<b>Q: Is it safe?</b>\n"
    "A: The bridge uses atomic or hash-locked swaps when possible.\n"
    "   Funds are never held in a custodial wallet for longer than\n"
    "   necessary to complete the exchange.\n"
    "\n"
    "<b>Q: Can I cancel an order?</b>\n"
    "A: Only before your deposit is confirmed on-chain. Use\n"
    "   /status to check, then tap Cancel if available.\n"
    "\n"
    "<b>Q: My order is stuck. What do I do?</b>\n"
    "A: Wait at least 1 hour. If still pending, contact support\n"
    "   with your order ID.\n"
    "\n"
    "<b>Q: What is slippage?</b>\n"
    "A: The maximum price movement you accept between quote and\n"
    "   execution. Adjust it in /settings.\n"
)


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(HELP_TEXT, reply_markup=back_kb("menu:start"), parse_mode="HTML")


@router.callback_query(F.data == "menu:help")
async def cb_help(callback: CallbackQuery) -> None:
    if callback.message:
        await callback.message.edit_text(
            HELP_TEXT, reply_markup=back_kb("menu:start"), parse_mode="HTML",
        )
    await callback.answer()
