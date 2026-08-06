"""/receipt and /trust handlers -- signed proof receipts and trust status.

Recorded order lifecycle events produce Ed25519-signed receipts served by the
backend proof layer (GET /v1/proof/receipt/{order_id}).  This handler shows a
human-readable summary and performs two local checks:

1. Hash-chain linkage: receipt[i].payload["prev_receipt_hash"] must equal
   receipt[i-1]["payload_hash"] (pure Python, no crypto needed).
2. Ed25519 signature verification over payload_canonical -- only when the
   optional ``cryptography`` package is importable; it is NOT a hard
   dependency of the bot.
"""

from __future__ import annotations

import asyncio
import html
import logging
from typing import Any

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from bot.config import settings
from bot.keyboards.inline import back_kb
from bot.services.api_client import APIError, api_client

logger = logging.getLogger(__name__)
router = Router(name="receipt")

# ---------------------------------------------------------------------------
# Optional Ed25519 verification (soft dependency)
# ---------------------------------------------------------------------------
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # type: ignore
        Ed25519PublicKey,
    )

    _CRYPTO_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on optional package
    Ed25519PublicKey = None  # type: ignore[assignment]
    _CRYPTO_AVAILABLE = False

GENESIS_HASH = "0" * 64

# Emoji mapping for receipt lifecycle events
EVENT_EMOJI: dict[str, str] = {
    "order_created": "\U0001f195",           # NEW
    "deposit_detected": "\U0001f4e5",        # inbox tray
    "deposit_confirmed": "\u26cf\ufe0f",      # pick (mining)
    "exchange_started": "\U0001f504",        # arrows
    "withdrawal_sent": "\U0001f680",         # rocket
    "order_completed": "\u2705",             # check
    "order_failed": "\u274c",                # cross
    "order_refunded": "\U0001f519",          # back arrow
    "order_expired": "\u23f0",               # alarm clock
    "order_cancelled": "\U0001f6ab",         # prohibited
}

# Keep long receipt chains within Telegram's 4096-char message limit
_MAX_EVENTS_SHOWN = 15


# ---------------------------------------------------------------------------
# Local verification helpers (pure functions, no I/O)
# ---------------------------------------------------------------------------
def check_hash_chain(receipts: list[dict[str, Any]]) -> bool:
    """Check that each receipt links to the previous one's payload hash."""
    for i in range(1, len(receipts)):
        prev_hash = (receipts[i].get("payload") or {}).get("prev_receipt_hash")
        if prev_hash != receipts[i - 1].get("payload_hash"):
            return False
    return True


def verify_signatures(receipts: list[dict[str, Any]]) -> tuple[int, int] | None:
    """Verify each Ed25519 signature over payload_canonical.

    Returns (verified, total), or None when ``cryptography`` is unavailable.
    """
    if not _CRYPTO_AVAILABLE:
        return None
    verified = 0
    for r in receipts:
        try:
            pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(r["public_key"]))
            pub.verify(
                bytes.fromhex(r["signature"]),
                r["payload_canonical"].encode(),
            )
            verified += 1
        except Exception:
            logger.warning(
                "Signature verification failed for receipt seq=%s",
                (r.get("payload") or {}).get("sequence"),
            )
    return verified, len(receipts)


def _verify_note(order_id: str) -> str:
    """Short note on how to verify independently."""
    if settings.WEBAPP_URL:
        where = f"{settings.WEBAPP_URL.rstrip('/')}/verify"
    else:
        where = "the bridge website's /verify page"
    return (
        f"\U0001f50e Verify independently at {where} or with the offline "
        f"verifier.\n"
        f"API: <code>GET /v1/proof/receipt/{html.escape(order_id)}</code>  \u00b7  "
        f"key: <code>GET /v1/proof/key</code>"
    )


def format_receipts(order_id: str, data: dict[str, Any]) -> str:
    """Return a rich text summary of an order's signed receipt chain."""
    receipts: list[dict[str, Any]] = data.get("receipts") or []
    count = data.get("count", len(receipts))

    lines = [
        f"\U0001f9fe <b>Signed Receipts</b>  <code>{html.escape(order_id)}</code>",
        "",
        f"<b>Receipts:</b> {count}",
    ]

    for i, r in enumerate(receipts[:_MAX_EVENTS_SHOWN]):
        payload = r.get("payload") or {}
        event = str(payload.get("event", "unknown"))
        emoji = EVENT_EMOJI.get(event, "\U0001f4c4")
        ts = payload.get("timestamp", "N/A")
        lines.append(
            f"  {i + 1}. {emoji} {html.escape(event.replace('_', ' '))} \u2014 "
            f"<i>{html.escape(str(ts))}</i>"
        )
    if len(receipts) > _MAX_EVENTS_SHOWN:
        lines.append(f"  \u2026 and {len(receipts) - _MAX_EVENTS_SHOWN} more")

    latest = receipts[-1]
    lines += [
        "",
        f"<b>Signing key:</b> <code>{html.escape(str(latest.get('key_id', 'N/A')))}</code>",
        f"<b>Latest hash:</b> <code>{html.escape(str(latest.get('payload_hash', 'N/A')))}</code>",
    ]

    # Local check 1: hash-chain linkage (no crypto required)
    if check_hash_chain(receipts):
        lines.append("<b>Hash chain:</b> \u2705 links up")
    else:
        lines.append("<b>Hash chain:</b> \u274c BROKEN \u2014 receipts do not link!")

    # Local check 2: Ed25519 signatures (optional cryptography package)
    sig_result = verify_signatures(receipts)
    if sig_result is None:
        lines.append(
            "<b>Signatures:</b> \u2139\ufe0f verification unavailable "
            "(install <code>cryptography</code> to verify locally)"
        )
    else:
        verified, total = sig_result
        if verified == total:
            lines.append(
                f"<b>Signatures:</b> \u2705 {verified}/{total} signatures verified"
            )
        else:
            lines.append(f"<b>Signatures:</b> \u274c only {verified}/{total} valid!")

    lines += ["", _verify_note(order_id)]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# /receipt <order_id>
# ---------------------------------------------------------------------------
@router.message(Command("receipt"))
async def cmd_receipt(message: Message) -> None:
    args = (message.text or "").split(maxsplit=1)
    if len(args) < 2 or not args[1].strip():
        await message.answer(
            "\u2753 Usage: /receipt <code>ORDER_ID</code>",
            parse_mode="HTML",
        )
        return

    order_id = args[1].strip()
    try:
        data = await api_client.get_receipts(order_id)
    except APIError as exc:
        if exc.status_code == 404:
            await message.answer(
                f"\u274c No receipts found for order <code>{html.escape(order_id)}</code>.",
                parse_mode="HTML",
            )
        else:
            await message.answer(
                f"\u26a0\ufe0f Error fetching receipts: {html.escape(str(exc.detail))}",
                parse_mode="HTML",
            )
        return
    except Exception:
        logger.exception("Failed to fetch receipts for %s", order_id)
        await message.answer(
            "\u26a0\ufe0f Could not reach the backend. Try again later.",
        )
        return

    if not data.get("receipts"):
        await message.answer(
            f"\U0001f9fe No receipts recorded yet for <code>{html.escape(order_id)}</code>.",
            parse_mode="HTML",
        )
        return

    text = format_receipts(order_id, data)
    await message.answer(text, reply_markup=back_kb("menu:start"), parse_mode="HTML")


# ---------------------------------------------------------------------------
# /trust -- sentinel status + warrant canary + transparency log
# ---------------------------------------------------------------------------
def format_trust(status: dict[str, Any] | None, canary: dict[str, Any] | None) -> str:
    """Return a rich text summary of the bridge's public trust signals."""
    lines = ["\U0001f6e1\ufe0f <b>Bridge Proof Status</b>", ""]

    if status is None:
        lines.append("\u26a0\ufe0f Sentinel status unavailable.")
    elif status.get("accepting_orders"):
        lines.append("\U0001f7e2 <b>Accepting orders:</b> Yes")
    else:
        lines.append("\U0001f534 <b>Accepting orders:</b> No \u2014 PAUSED")
        paused = status.get("paused") or {}
        if paused.get("reason"):
            lines.append(f"<b>Reason:</b> {html.escape(str(paused['reason']))}")
        if paused.get("check"):
            lines.append(f"<b>Tripped check:</b> <code>{html.escape(str(paused['check']))}</code>")
        if paused.get("tripped_at"):
            lines.append(f"<b>Since:</b> {html.escape(str(paused['tripped_at']))}")

    lines.append("")
    if canary is None:
        lines.append("\u26a0\ufe0f Canary unavailable.")
    else:
        statement = str(canary.get("statement", ""))
        snippet = statement if len(statement) <= 200 else statement[:200] + "\u2026"
        lines += [
            "\U0001f424 <b>Warrant Canary</b>",
            f"<b>Issued:</b> {html.escape(str(canary.get('issued_at', 'N/A')))}",
            f"<i>\u201c{html.escape(snippet)}\u201d</i>",
            "",
            f"\U0001f333 <b>Transparency log:</b> "
            f"{canary.get('latest_tree_size', 'N/A')} entries",
        ]

    lines += [
        "",
        "API: <code>GET /v1/proof/status</code>  \u00b7  "
        "<code>GET /v1/proof/canary</code>",
    ]
    return "\n".join(lines)


@router.message(Command("trust"))
async def cmd_trust(message: Message) -> None:
    status_res, canary_res = await asyncio.gather(
        api_client.get_proof_status(),
        api_client.get_proof_canary(),
        return_exceptions=True,
    )
    status = status_res if isinstance(status_res, dict) else None
    canary = canary_res if isinstance(canary_res, dict) else None
    if status is None and canary is None:
        logger.warning("Trust endpoints unreachable: %s / %s", status_res, canary_res)
        await message.answer(
            "\u26a0\ufe0f Could not reach the backend. Try again later.",
        )
        return

    text = format_trust(status, canary)
    await message.answer(text, reply_markup=back_kb("menu:start"), parse_mode="HTML")
