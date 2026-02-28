"""
Risk scoring engine — evaluates bridge orders against multiple risk factors.

Factors:
    1. Amount size (vs daily limits)
    2. Chain concentration (exposure check)
    3. Velocity (how many orders from this user/IP recently)
    4. Address reputation (basic heuristics)
    5. Cross-chain pattern anomalies
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import asyncpg
import numpy as np


class RiskScorer:
    def __init__(self, settings):
        self.max_single_order = settings.max_single_order_usd
        self.max_daily_volume = settings.max_daily_volume_usd
        self.max_chain_pct = settings.max_chain_exposure_pct
        self.z_threshold = settings.anomaly_z_threshold

    async def score(self, db: asyncpg.Pool, order) -> dict:
        """Score a bridge order and return risk assessment."""
        flags: list[str] = []
        factor_scores: dict[str, float] = {}

        # ---- Factor 1: Amount size ----
        amount_usd = max(order.from_amount, order.to_amount)
        if amount_usd > self.max_single_order:
            flags.append(f"amount_exceeds_limit: ${amount_usd:.2f} > ${self.max_single_order:.2f}")
            factor_scores["amount"] = min(1.0, amount_usd / self.max_single_order)
        else:
            factor_scores["amount"] = amount_usd / self.max_single_order * 0.5

        # ---- Factor 2: Daily volume check ----
        day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        daily_vol = await db.fetchval(
            """
            SELECT COALESCE(SUM(from_amount), 0)
              FROM bridge_orders
             WHERE created_at >= $1
               AND status NOT IN ('failed', 'expired')
            """,
            day_ago,
        )
        daily_total = float(daily_vol) + amount_usd
        if daily_total > self.max_daily_volume:
            flags.append(f"daily_volume_exceeded: ${daily_total:.2f} > ${self.max_daily_volume:.2f}")
            factor_scores["daily_volume"] = min(1.0, daily_total / self.max_daily_volume)
        else:
            factor_scores["daily_volume"] = daily_total / self.max_daily_volume * 0.3

        # ---- Factor 3: User velocity ----
        velocity_score = 0.0
        if order.telegram_user_id:
            recent_count = await db.fetchval(
                """
                SELECT COUNT(*)
                  FROM bridge_orders
                 WHERE telegram_user_id = $1
                   AND created_at >= $2
                """,
                order.telegram_user_id,
                day_ago,
            )
            if recent_count > 10:
                flags.append(f"high_velocity: {recent_count} orders in 24h")
                velocity_score = min(1.0, recent_count / 20)
            else:
                velocity_score = recent_count / 20 * 0.3
        elif order.ip_address:
            ip_count = await db.fetchval(
                """
                SELECT COUNT(*)
                  FROM bridge_orders
                 WHERE ip_address = $1
                   AND created_at >= $2
                """,
                order.ip_address,
                day_ago,
            )
            if ip_count > 15:
                flags.append(f"ip_velocity: {ip_count} orders from same IP in 24h")
                velocity_score = min(1.0, ip_count / 30)
        factor_scores["velocity"] = velocity_score

        # ---- Factor 4: Chain concentration ----
        total_pending = await db.fetchval(
            """
            SELECT COALESCE(SUM(to_amount), 0)
              FROM bridge_orders
             WHERE status IN ('awaiting_deposit', 'deposit_detected', 'confirming', 'bridging', 'signing', 'sending')
            """
        )
        chain_pending = await db.fetchval(
            """
            SELECT COALESCE(SUM(to_amount), 0)
              FROM bridge_orders
             WHERE dest_chain = $1
               AND status IN ('awaiting_deposit', 'deposit_detected', 'confirming', 'bridging', 'signing', 'sending')
            """,
            order.dest_chain,
        )
        total_float = float(total_pending) + amount_usd
        chain_float = float(chain_pending) + amount_usd
        chain_pct = (chain_float / total_float * 100) if total_float > 0 else 0
        if chain_pct > self.max_chain_pct:
            flags.append(f"chain_concentration: {order.dest_chain} at {chain_pct:.1f}%")
            factor_scores["concentration"] = min(1.0, chain_pct / 100)
        else:
            factor_scores["concentration"] = chain_pct / 100 * 0.3

        # ---- Factor 5: Destination address newness ----
        addr_history = await db.fetchval(
            """
            SELECT COUNT(*)
              FROM bridge_orders
             WHERE dest_address = $1
               AND status = 'completed'
            """,
            order.dest_address,
        )
        if addr_history == 0:
            flags.append("new_destination_address")
            factor_scores["address_reputation"] = 0.4
        else:
            factor_scores["address_reputation"] = max(0.0, 0.3 - (addr_history / 50))

        # ---- Composite score ----
        weights = {
            "amount": 0.30,
            "daily_volume": 0.20,
            "velocity": 0.20,
            "concentration": 0.15,
            "address_reputation": 0.15,
        }
        risk_score = sum(
            factor_scores.get(k, 0) * w for k, w in weights.items()
        )
        risk_score = round(min(1.0, max(0.0, risk_score)), 4)

        # Determine level and recommendation
        if risk_score < 0.25:
            risk_level = "low"
            recommendation = "approve"
        elif risk_score < 0.50:
            risk_level = "medium"
            recommendation = "approve"
        elif risk_score < 0.75:
            risk_level = "high"
            recommendation = "review"
        else:
            risk_level = "critical"
            recommendation = "reject"

        return {
            "order_id": order.order_id,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "flags": flags,
            "recommendation": recommendation,
            "details": {
                "factor_scores": factor_scores,
                "weights": weights,
                "daily_volume_usd": round(daily_total, 2),
                "chain_concentration_pct": round(chain_pct, 2),
            },
        }

    async def detect_anomalies(
        self,
        db: asyncpg.Pool,
        window_hours: int = 24,
        chain: str | None = None,
    ) -> list[dict]:
        """Detect anomalous swap patterns in recent order history."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)

        query = """
            SELECT order_id, source_chain, dest_chain,
                   from_amount, to_amount, from_currency, to_currency,
                   created_at
              FROM bridge_orders
             WHERE created_at >= $1
               AND status NOT IN ('failed', 'expired')
        """
        params: list = [cutoff]
        if chain:
            query += " AND (source_chain = $2 OR dest_chain = $2)"
            params.append(chain)
        query += " ORDER BY created_at ASC"

        rows = await db.fetch(query, *params)
        if len(rows) < 5:
            return []

        # Compute statistics on order amounts
        amounts = np.array([float(r["from_amount"]) for r in rows])
        mean_amt = float(np.mean(amounts))
        std_amt = float(np.std(amounts))

        # Time deltas between consecutive orders (seconds)
        timestamps = [r["created_at"] for r in rows]
        deltas = [
            (timestamps[i + 1] - timestamps[i]).total_seconds()
            for i in range(len(timestamps) - 1)
        ]
        mean_delta = float(np.mean(deltas)) if deltas else 0
        std_delta = float(np.std(deltas)) if deltas else 0

        anomalies = []

        for i, row in enumerate(rows):
            flags = []
            amt = float(row["from_amount"])

            # Z-score on amount
            if std_amt > 0:
                z_amt = abs(amt - mean_amt) / std_amt
                if z_amt > self.z_threshold:
                    flags.append(f"amount_z_score={z_amt:.2f}")

            # Z-score on timing (rapid-fire)
            if i > 0 and std_delta > 0:
                delta = (timestamps[i] - timestamps[i - 1]).total_seconds()
                z_delta = abs(delta - mean_delta) / std_delta
                if z_delta > self.z_threshold and delta < mean_delta:
                    flags.append(f"timing_z_score={z_delta:.2f} (rapid)")

            # Unusual pair (source→dest appears < 2% of total)
            pair = f"{row['source_chain']}->{row['dest_chain']}"
            pair_count = sum(
                1 for r in rows
                if f"{r['source_chain']}->{r['dest_chain']}" == pair
            )
            pair_pct = pair_count / len(rows) * 100
            if pair_pct < 2.0 and len(rows) > 20:
                flags.append(f"rare_pair={pair} ({pair_pct:.1f}%)")

            if flags:
                anomalies.append({
                    "order_id": row["order_id"],
                    "source_chain": row["source_chain"],
                    "dest_chain": row["dest_chain"],
                    "amount": amt,
                    "created_at": row["created_at"].isoformat(),
                    "flags": flags,
                })

        return anomalies
