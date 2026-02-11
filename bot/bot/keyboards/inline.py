"""All inline keyboard builders for the bridge bot."""

from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from bot.config import settings

# ---------------------------------------------------------------------------
# Supported destination chains / tokens (from XMR and to XMR)
# ---------------------------------------------------------------------------
DEST_CHAINS = ["BTC", "ETH", "TON", "SOL", "ARB", "BASE", "USDC", "USDT"]

CHAIN_EMOJI: dict[str, str] = {
    "XMR": "\U0001f6e1\ufe0f",
    "BTC": "\U0001fa99",
    "ETH": "\U0001f4a0",
    "TON": "\U0001f48e",
    "SOL": "\u2600\ufe0f",
    "ARB": "\U0001f309",
    "BASE": "\U0001f535",
    "USDC": "\U0001f4b2",
    "USDT": "\U0001f4b5",
}


# ---------------------------------------------------------------------------
# Main menu
# ---------------------------------------------------------------------------
def main_menu_kb() -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = [
        [
            InlineKeyboardButton(text="\U0001f309 Bridge", callback_data="menu:bridge"),
            InlineKeyboardButton(text="\U0001f4ca Rates", callback_data="menu:rates"),
        ],
        [
            InlineKeyboardButton(text="\U0001f4dc History", callback_data="menu:history"),
            InlineKeyboardButton(text="\u2699\ufe0f Settings", callback_data="menu:settings"),
        ],
        [
            InlineKeyboardButton(text="\u2753 Help", callback_data="menu:help"),
        ],
    ]
    # Add Mini App button only when WEBAPP_URL is configured
    if settings.WEBAPP_URL:
        rows.append([
            InlineKeyboardButton(
                text="\U0001f310 Open Mini App",
                web_app=WebAppInfo(url=settings.WEBAPP_URL),
            )
        ])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ---------------------------------------------------------------------------
# Direction selection: first pick "From XMR" or "To XMR"
# ---------------------------------------------------------------------------
def direction_type_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text=f"{CHAIN_EMOJI['XMR']} XMR \u2192 ...",
                callback_data="dir_type:from_xmr",
            ),
            InlineKeyboardButton(
                text=f"... \u2192 {CHAIN_EMOJI['XMR']} XMR",
                callback_data="dir_type:to_xmr",
            ),
        ],
        [back_button("menu:bridge_cancel")],
    ])


# ---------------------------------------------------------------------------
# Chain selection grids (2 columns)
# ---------------------------------------------------------------------------
def chain_select_kb(direction: str) -> InlineKeyboardMarkup:
    """Build a grid of destination chains.

    *direction* is either ``from_xmr`` or ``to_xmr``.
    Callback data: ``chain:<direction>:<SYMBOL>``
    """
    buttons: list[InlineKeyboardButton] = []
    for sym in DEST_CHAINS:
        emoji = CHAIN_EMOJI.get(sym, "")
        label = f"{emoji} {sym}"
        buttons.append(
            InlineKeyboardButton(text=label, callback_data=f"chain:{direction}:{sym}")
        )
    # arrange in 2-column rows
    rows: list[list[InlineKeyboardButton]] = [
        buttons[i : i + 2] for i in range(0, len(buttons), 2)
    ]
    rows.append([back_button("menu:bridge")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ---------------------------------------------------------------------------
# Amount presets
# ---------------------------------------------------------------------------
def amount_presets_kb(from_currency: str) -> InlineKeyboardMarkup:
    """Quick-pick amounts plus a 'custom' option."""
    presets = ["0.1", "0.5", "1.0", "5.0"]
    row1 = [
        InlineKeyboardButton(text=f"{p} {from_currency}", callback_data=f"amount:{p}")
        for p in presets
    ]
    return InlineKeyboardMarkup(inline_keyboard=[
        row1,
        [InlineKeyboardButton(text="\u270f\ufe0f Custom amount", callback_data="amount:custom")],
        [back_button("menu:bridge")],
    ])


# ---------------------------------------------------------------------------
# Confirm / Cancel
# ---------------------------------------------------------------------------
def confirm_cancel_kb(order_tag: str = "") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="\u2705 Confirm", callback_data=f"confirm:{order_tag}"),
            InlineKeyboardButton(text="\u274c Cancel", callback_data=f"cancel:{order_tag}"),
        ],
    ])


# ---------------------------------------------------------------------------
# Slippage selection for /settings
# ---------------------------------------------------------------------------
def slippage_kb(current: float = 0.5) -> InlineKeyboardMarkup:
    options = [0.1, 0.3, 0.5, 1.0, 2.0, 3.0]
    buttons: list[InlineKeyboardButton] = []
    for opt in options:
        marker = " \u2705" if abs(opt - current) < 0.01 else ""
        buttons.append(
            InlineKeyboardButton(
                text=f"{opt}%{marker}", callback_data=f"slippage:{opt}",
            )
        )
    rows = [buttons[i : i + 3] for i in range(0, len(buttons), 3)]
    rows.append([back_button("menu:start")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ---------------------------------------------------------------------------
# Generic back button
# ---------------------------------------------------------------------------
def back_button(callback_data: str = "menu:start") -> InlineKeyboardButton:
    return InlineKeyboardButton(text="\u2b05\ufe0f Back", callback_data=callback_data)


def back_kb(callback_data: str = "menu:start") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [back_button(callback_data)],
    ])


# ---------------------------------------------------------------------------
# Order detail inline (view after tapping history item)
# ---------------------------------------------------------------------------
def order_detail_kb(order_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="\U0001f504 Refresh", callback_data=f"order_refresh:{order_id}",
            ),
            InlineKeyboardButton(
                text="\u274c Cancel order", callback_data=f"order_cancel:{order_id}",
            ),
        ],
        [back_button("menu:history")],
    ])
