"""
Exposure tracking — monitors concentration risk across chains.

Computes how much capital is outstanding (in-flight or pending) per chain
and flags any chain that exceeds the configured concentration threshold.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg


@dataclass
class ChainExposure:
    chain: str
    pending_usd: float
    in_flight_usd: float
    total_usd: float
    pct_of_total: float
    is_over_limit: bool


class ExposureTracker:
    def __init__(self, settings):
        self.max_chain_pct = settings.max_chain_exposure_pct

    async def compute(self, db: asyncpg.Pool) -> dict:
        """Compute current exposure per source and destination chain."""

        # Pending deposits (awaiting_deposit, deposit_detected)
        pending_rows = await db.fetch(
            """
            SELECT source_chain AS chain,
                   COALESCE(SUM(from_amount), 0) AS total_amount,
                   COUNT(*) AS order_count
              FROM bridge_orders
             WHERE status IN ('awaiting_deposit', 'deposit_detected')
             GROUP BY source_chain
            """
        )

        # In-flight (confirming, bridging, signing, sending)
        inflight_rows = await db.fetch(
            """
            SELECT dest_chain AS chain,
                   COALESCE(SUM(to_amount), 0) AS total_amount,
                   COUNT(*) AS order_count
              FROM bridge_orders
             WHERE status IN ('confirming', 'bridging', 'signing', 'sending')
             GROUP BY dest_chain
            """
        )

        # Merge into a combined view.
        chains: dict[str, dict] = {}

        for row in pending_rows:
            chain = row["chain"]
            chains.setdefault(chain, {"pending_usd": 0, "in_flight_usd": 0})
            chains[chain]["pending_usd"] += float(row["total_amount"])

        for row in inflight_rows:
            chain = row["chain"]
            chains.setdefault(chain, {"pending_usd": 0, "in_flight_usd": 0})
            chains[chain]["in_flight_usd"] += float(row["total_amount"])

        grand_total = sum(
            v["pending_usd"] + v["in_flight_usd"] for v in chains.values()
        )

        exposures: list[dict] = []
        for chain, vals in sorted(chains.items()):
            total = vals["pending_usd"] + vals["in_flight_usd"]
            pct = (total / grand_total * 100) if grand_total > 0 else 0
            exposures.append(
                {
                    "chain": chain,
                    "pending_usd": round(vals["pending_usd"], 2),
                    "in_flight_usd": round(vals["in_flight_usd"], 2),
                    "total_usd": round(total, 2),
                    "pct_of_total": round(pct, 2),
                    "is_over_limit": pct > self.max_chain_pct,
                }
            )

        return {
            "exposures": exposures,
            "grand_total_usd": round(grand_total, 2),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
