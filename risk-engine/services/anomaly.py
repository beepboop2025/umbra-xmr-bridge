"""
Pure statistical anomaly detectors for withdrawal patterns.

Dependency-light by design: standard library only — no FastAPI, asyncpg or
numpy imports — so this module stays importable (and unit-testable) even when
the web framework stack is not installed.

Detectors:
    zscore_anomaly       — robust z-score (median / MAD) outlier test
    drain_pattern_score  — 0..1 score for "liquidity drain" withdrawal bursts
    round_amount_ratio   — fraction of suspiciously round amounts
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median

# Scale factor that makes the MAD a consistent estimator of the standard
# deviation under a normal distribution (1 / Phi^-1(0.75)).
MAD_CONSISTENCY = 0.6745

# Cap for the robust z-score when the MAD is zero (any deviation from a
# perfectly constant history is "infinitely" surprising, but infinities do
# not serialize to JSON and break downstream arithmetic).
_Z_CAP = 1e6


@dataclass
class AnomalyResult:
    """Outcome of a robust z-score test."""

    is_anomaly: bool
    robust_z: float
    median: float
    mad: float
    threshold: float


def _finite(values: list[float]) -> list[float]:
    """Drop NaN / inf values that would poison the statistics."""
    return [float(v) for v in values if isinstance(v, (int, float)) and math.isfinite(v)]


def zscore_anomaly(
    values: list[float],
    current: float,
    threshold: float = 3.5,
) -> AnomalyResult:
    """Test whether *current* is an outlier relative to *values*.

    Uses the robust z-score based on the median and the median absolute
    deviation (MAD) rather than mean / standard deviation: a single extreme
    historical value inflates the mean and stddev enough to mask a real
    outlier (masking effect), while the median and MAD have a 50% breakdown
    point and stay stable even when the history itself is partly poisoned by
    attacker traffic.  The conventional cutoff for |robust z| is 3.5
    (Iglewicz & Hoaglin).

    Degenerate inputs are handled gracefully:
      * empty / all-non-finite history -> never anomalous (nothing to compare)
      * MAD == 0 (constant history)    -> any deviation is flagged, with the
        z-score capped at a large finite value instead of infinity
    """
    vals = _finite(values)
    if not vals or not math.isfinite(current):
        return AnomalyResult(
            is_anomaly=False, robust_z=0.0, median=0.0, mad=0.0, threshold=threshold,
        )

    med = median(vals)
    mad = median(abs(v - med) for v in vals)

    if mad == 0:
        # Constant history: either current matches exactly, or it is an
        # arbitrarily large surprise. Cap instead of returning infinity.
        robust_z = 0.0 if math.isclose(current, med, rel_tol=1e-9, abs_tol=1e-12) else _Z_CAP
    else:
        robust_z = MAD_CONSISTENCY * (current - med) / mad

    return AnomalyResult(
        is_anomaly=abs(robust_z) > threshold,
        robust_z=robust_z,
        median=med,
        mad=mad,
        threshold=threshold,
    )


def drain_pattern_score(
    withdrawal_amounts: list[float],
    window_minutes: float,
) -> float:
    """Score (0..1) how much a window of withdrawals looks like a drain.

    A bridge drain looks like many large withdrawals compressed into a short
    window — either one giant transaction or a rapid burst of near-max-size
    ones. Three signals are combined:

      1. Count rate: withdrawals per minute, squashed to 0..1 with r/(r+1)
         (1 withdrawal/minute maps to 0.5).
      2. Value velocity: total value leaving per minute measured in units of
         the window's median withdrawal size — i.e. "how many typical-sized
         withdrawals leave every minute". This is what makes bursts of
         *large* withdrawals score higher than the same count of dust.
      3. Amount concentration: a Herfindahl-style index sum((a/total)^2),
         normalized so 0 = value evenly spread across the withdrawals and
         1 = a single withdrawal carries all the value. A drain via one or
         two dominant transactions concentrates value.

    Rate and velocity are combined with a noisy-OR (either alone can signal a
    drain); concentration only amplifies at half weight, because evenly-sized
    bursts are still drains. Quiet traffic (a handful of modest withdrawals
    over hours) scores near 0; a burst of large withdrawals within minutes
    scores well above 0.5.

    Degenerate inputs (empty list, non-positive window, non-finite or
    non-positive amounts) score 0.0.
    """
    amounts = [a for a in _finite(withdrawal_amounts) if a > 0]
    if not amounts or window_minutes <= 0 or not math.isfinite(window_minutes):
        return 0.0

    n = len(amounts)
    total = sum(amounts)
    med = median(amounts)

    # 1. Count rate (withdrawals per minute)
    count_rate = n / window_minutes
    rate_score = count_rate / (count_rate + 1.0)

    # 2. Value velocity (median-sized withdrawals leaving per minute)
    velocity = (total / window_minutes) / med if med > 0 else 0.0
    velocity_score = velocity / (velocity + 1.0)

    # 3. Herfindahl-style amount concentration, normalized to 0..1
    herfindahl = sum((a / total) ** 2 for a in amounts)
    concentration = (herfindahl - 1.0 / n) / (1.0 - 1.0 / n) if n > 1 else 1.0

    score = 1.0 - (
        (1.0 - rate_score) * (1.0 - velocity_score) * (1.0 - 0.5 * concentration)
    )
    return max(0.0, min(1.0, score))


def _round_to_one_sig_fig(value: float) -> float:
    """Round *value* to a single significant figure (0 stays 0)."""
    if value == 0:
        return 0.0
    exponent = math.floor(math.log10(abs(value)))
    return round(value, -exponent)


def round_amount_ratio(amounts: list[float]) -> float:
    """Fraction (0..1) of amounts that are suspiciously round numbers.

    Attackers probing a bridge (or laundering through it) overwhelmingly use
    round test amounts — 100, 5000, 0.5 — while organic swap amounts are
    quote-driven and carry many significant digits (e.g. 4821.33). An amount
    counts as "round" when it equals its own value rounded to one significant
    figure, compared with a small relative tolerance to absorb float noise.

    Empty or all-non-finite input returns 0.0.
    """
    vals = _finite(amounts)
    if not vals:
        return 0.0

    round_count = sum(
        1
        for a in vals
        if math.isclose(a, _round_to_one_sig_fig(a), rel_tol=1e-9, abs_tol=1e-12)
    )
    return round_count / len(vals)
