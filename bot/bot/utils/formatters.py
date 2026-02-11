"""Formatting helpers used across handlers."""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Emoji mapping for order statuses
# ---------------------------------------------------------------------------
STATUS_EMOJI: dict[str, str] = {
    "pending": "\u23f3",       # hourglass
    "awaiting_deposit": "\U0001f4e5",  # inbox tray
    "confirming": "\u26cf\ufe0f",       # pick (mining)
    "exchanging": "\U0001f504",        # arrows
    "sending": "\U0001f680",           # rocket
    "completed": "\u2705",             # check
    "failed": "\u274c",                # cross
    "refunded": "\U0001f519",          # back arrow
    "expired": "\u23f0",               # alarm clock
    "cancelled": "\U0001f6ab",         # prohibited
}

# Progress bar stages (ordered)
PROGRESS_STAGES = [
    "pending",
    "awaiting_deposit",
    "confirming",
    "exchanging",
    "sending",
    "completed",
]

CHAIN_LABELS: dict[str, str] = {
    "XMR": "Monero",
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "TON": "TON",
    "SOL": "Solana",
    "ARB": "Arbitrum",
    "BASE": "Base",
    "USDC": "USDC",
    "USDT": "USDT",
}

CHAIN_EMOJI: dict[str, str] = {
    "XMR": "\U0001f6e1\ufe0f",   # shield
    "BTC": "\U0001fa99",          # coin
    "ETH": "\U0001f4a0",          # diamond
    "TON": "\U0001f48e",          # gem
    "SOL": "\u2600\ufe0f",        # sun
    "ARB": "\U0001f309",          # bridge at night
    "BASE": "\U0001f535",         # blue circle
    "USDC": "\U0001f4b2",         # dollar
    "USDT": "\U0001f4b5",         # banknote
}


def format_order_status(order: dict[str, Any]) -> str:
    """Return a rich text summary of an order with emoji progress bar."""
    status = order.get("status", "pending")
    emoji = STATUS_EMOJI.get(status, "\u2753")

    # Build a progress bar
    try:
        idx = PROGRESS_STAGES.index(status)
    except ValueError:
        idx = -1
    bar_parts: list[str] = []
    for i, stage in enumerate(PROGRESS_STAGES):
        if i < idx:
            bar_parts.append("\u2705")
        elif i == idx:
            bar_parts.append("\U0001f7e2")  # green circle = current
        else:
            bar_parts.append("\u26aa")       # white circle
    progress = " ".join(bar_parts)

    from_sym = order.get("from_currency", "XMR")
    to_sym = order.get("to_currency", "???")
    amount_in = format_amount(order.get("amount_in"), from_sym)
    amount_out = format_amount(order.get("amount_out"), to_sym)

    lines = [
        f"{emoji} <b>Order</b>  <code>{order.get('id', 'N/A')}</code>",
        f"",
        f"{progress}",
        f"<b>Status:</b> {status.replace('_', ' ').title()}",
        f"<b>Send:</b>  {amount_in}",
        f"<b>Receive:</b> {amount_out}",
    ]

    if order.get("deposit_address"):
        lines.append(f"<b>Deposit to:</b> <code>{order['deposit_address']}</code>")
    if order.get("destination_address"):
        lines.append(
            f"<b>Destination:</b> <code>{truncate_address(order['destination_address'])}</code>"
        )
    if order.get("fee"):
        lines.append(f"<b>Fee:</b> {order['fee']}")
    if order.get("created_at"):
        lines.append(f"<b>Created:</b> {order['created_at']}")

    return "\n".join(lines)


def format_rate(direction: str, rate: float | str, change_24h: float | str | None = None) -> str:
    """Format a rate line, e.g. '1 XMR ~ 52.35 TON (+2.1%)'."""
    parts = direction.upper().split("_")
    from_sym = parts[0] if len(parts) >= 1 else "XMR"
    to_sym = parts[1] if len(parts) >= 2 else "???"
    from_emoji = CHAIN_EMOJI.get(from_sym, "")
    to_emoji = CHAIN_EMOJI.get(to_sym, "")

    rate_str = f"{float(rate):,.6f}" if rate else "N/A"
    line = f"{from_emoji} 1 {from_sym}  \u2248  {rate_str} {to_sym} {to_emoji}"
    if change_24h is not None:
        try:
            ch = float(change_24h)
            arrow = "\U0001f4c8" if ch >= 0 else "\U0001f4c9"
            line += f"  {arrow} {ch:+.2f}%"
        except (ValueError, TypeError):
            pass
    return line


def format_amount(amount: float | str | None, symbol: str) -> str:
    """Format an amount, e.g. '1.500000 XMR'."""
    if amount is None:
        return f"-- {symbol}"
    try:
        val = float(amount)
    except (ValueError, TypeError):
        return f"{amount} {symbol}"
    # Use 6 decimal places for crypto, 2 for stables
    decimals = 2 if symbol in ("USDC", "USDT") else 6
    return f"{val:,.{decimals}f} {symbol}"


def truncate_address(addr: str | None, prefix: int = 6, suffix: int = 4) -> str:
    """Truncate a blockchain address for display: '4Ab3...xyz9'."""
    if not addr:
        return "N/A"
    if len(addr) <= prefix + suffix + 3:
        return addr
    return f"{addr[:prefix]}...{addr[-suffix:]}"
