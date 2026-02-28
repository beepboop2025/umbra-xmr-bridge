"""
Liquidity analysis — estimates available liquidity depth per chain.

Uses completed order history and current pending volume to infer
how much capacity is available for new withdrawals on each chain.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import asyncpg


class LiquidityAnalyzer:
    def __init__(self, settings):
        self.max_daily_volume = settings.max_daily_volume_usd

    async def compute(self, db: asyncpg.Pool) -> dict:
        """Return liquidity depth estimates across all active chains."""

        now = datetime.now(timezone.utc)
        day_ago = now - timedelta(hours=24)

        # 24h completed volume by destination chain
        completed_rows = await db.fetch(
            """
            SELECT dest_chain AS chain,
                   COALESCE(SUM(to_amount), 0) AS volume_24h,
                   COUNT(*) AS tx_count
              FROM bridge_orders
             WHERE status = 'completed'
               AND updated_at >= $1
             GROUP BY dest_chain
            """,
            day_ago,
        )

        # Pending outflows (signing + sending)
        pending_rows = await db.fetch(
            """
            SELECT dest_chain AS chain,
                   COALESCE(SUM(to_amount), 0) AS pending_outflow
              FROM bridge_orders
             WHERE status IN ('signing', 'sending')
             GROUP BY dest_chain
            """
        )

        # 7-day average daily volume for trend analysis
        week_ago = now - timedelta(days=7)
        avg_rows = await db.fetch(
            """
            SELECT dest_chain AS chain,
                   COALESCE(SUM(to_amount), 0) / 7.0 AS avg_daily
              FROM bridge_orders
             WHERE status = 'completed'
               AND updated_at >= $1
             GROUP BY dest_chain
            """,
            week_ago,
        )

        # Merge all data
        chains: dict[str, dict] = {}

        for row in completed_rows:
            chain = row["chain"]
            chains.setdefault(chain, {"volume_24h": 0, "pending_outflow": 0, "avg_daily": 0, "tx_count_24h": 0})
            chains[chain]["volume_24h"] = float(row["volume_24h"])
            chains[chain]["tx_count_24h"] = int(row["tx_count"])

        for row in pending_rows:
            chain = row["chain"]
            chains.setdefault(chain, {"volume_24h": 0, "pending_outflow": 0, "avg_daily": 0, "tx_count_24h": 0})
            chains[chain]["pending_outflow"] = float(row["pending_outflow"])

        for row in avg_rows:
            chain = row["chain"]
            chains.setdefault(chain, {"volume_24h": 0, "pending_outflow": 0, "avg_daily": 0, "tx_count_24h": 0})
            chains[chain]["avg_daily"] = float(row["avg_daily"])

        results = []
        for chain, vals in sorted(chains.items()):
            remaining_capacity = max(0, self.max_daily_volume - vals["volume_24h"] - vals["pending_outflow"])
            utilization_pct = (
                (vals["volume_24h"] + vals["pending_outflow"]) / self.max_daily_volume * 100
                if self.max_daily_volume > 0
                else 0
            )
            volume_trend = "increasing" if vals["volume_24h"] > vals["avg_daily"] * 1.2 else (
                "decreasing" if vals["volume_24h"] < vals["avg_daily"] * 0.8 else "stable"
            )

            results.append({
                "chain": chain,
                "volume_24h_usd": round(vals["volume_24h"], 2),
                "pending_outflow_usd": round(vals["pending_outflow"], 2),
                "remaining_capacity_usd": round(remaining_capacity, 2),
                "utilization_pct": round(utilization_pct, 2),
                "avg_daily_usd": round(vals["avg_daily"], 2),
                "tx_count_24h": vals["tx_count_24h"],
                "volume_trend": volume_trend,
            })

        return {
            "chains": results,
            "max_daily_volume_usd": self.max_daily_volume,
            "computed_at": now.isoformat(),
        }
