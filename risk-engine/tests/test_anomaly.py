"""Unit tests for services.anomaly — pure statistical detectors.

These tests import only services.anomaly (stdlib-only), so they run even when
the FastAPI / asyncpg stack is not installed.
"""

import math

from services.anomaly import (
    AnomalyResult,
    drain_pattern_score,
    round_amount_ratio,
    zscore_anomaly,
)


# ---------------------------------------------------------------------------
# zscore_anomaly
# ---------------------------------------------------------------------------

class TestZscoreAnomaly:
    def test_typical_value_not_anomalous(self):
        history = [10.0, 11.0, 9.5, 10.2, 10.8, 9.9, 10.1, 10.5]
        result = zscore_anomaly(history, 10.3)
        assert isinstance(result, AnomalyResult)
        assert not result.is_anomaly
        assert abs(result.robust_z) < 3.5

    def test_extreme_value_is_anomalous(self):
        history = [10.0, 11.0, 9.5, 10.2, 10.8, 9.9, 10.1, 10.5]
        result = zscore_anomaly(history, 500.0)
        assert result.is_anomaly
        assert result.robust_z > 3.5

    def test_robust_to_poisoned_history(self):
        # One giant historical outlier must not mask a real anomaly
        # (mean/stddev would be inflated; median/MAD stay put).
        history = [10.0] * 20 + [10.5, 9.5, 10.2, 9.8] + [100_000.0]
        result = zscore_anomaly(history, 5_000.0)
        assert result.is_anomaly

    def test_empty_history_is_not_anomalous(self):
        result = zscore_anomaly([], 42.0)
        assert not result.is_anomaly
        assert result.robust_z == 0.0

    def test_constant_history_zero_mad(self):
        # MAD == 0: matching value is fine, any deviation is flagged,
        # and the z-score stays finite.
        same = zscore_anomaly([5.0, 5.0, 5.0, 5.0], 5.0)
        assert not same.is_anomaly

        deviant = zscore_anomaly([5.0, 5.0, 5.0, 5.0], 6.0)
        assert deviant.is_anomaly
        assert math.isfinite(deviant.robust_z)

    def test_non_finite_inputs_handled(self):
        result = zscore_anomaly([float("nan"), float("inf")], 10.0)
        assert not result.is_anomaly
        result = zscore_anomaly([10.0, 10.5, 9.5], float("nan"))
        assert not result.is_anomaly

    def test_custom_threshold(self):
        history = [10.0, 11.0, 9.5, 10.2, 10.8, 9.9, 10.1, 10.5]
        loose = zscore_anomaly(history, 13.0, threshold=100.0)
        strict = zscore_anomaly(history, 13.0, threshold=1.0)
        assert not loose.is_anomaly
        assert strict.is_anomaly


# ---------------------------------------------------------------------------
# drain_pattern_score
# ---------------------------------------------------------------------------

class TestDrainPatternScore:
    def test_quiet_traffic_scores_low(self):
        # A handful of modest withdrawals spread over 12 hours.
        score = drain_pattern_score([10.0, 12.0, 9.0, 11.0], window_minutes=720.0)
        assert 0.0 <= score < 0.2

    def test_drain_burst_scores_high(self):
        # Six near-max withdrawals within five minutes.
        score = drain_pattern_score(
            [5000.0, 4800.0, 5200.0, 4900.0, 5100.0, 5000.0],
            window_minutes=5.0,
        )
        assert score > 0.6

    def test_burst_scores_higher_than_quiet(self):
        quiet = drain_pattern_score([10.0, 12.0, 9.0], window_minutes=600.0)
        burst = drain_pattern_score([9000.0] * 10, window_minutes=2.0)
        assert burst > quiet

    def test_single_giant_withdrawal_scores_moderate(self):
        # One dominant transaction: concentration kicks in.
        score = drain_pattern_score([100_000.0], window_minutes=10.0)
        assert 0.3 < score <= 1.0

    def test_empty_input_scores_zero(self):
        assert drain_pattern_score([], window_minutes=60.0) == 0.0

    def test_degenerate_window_scores_zero(self):
        assert drain_pattern_score([100.0], window_minutes=0.0) == 0.0
        assert drain_pattern_score([100.0], window_minutes=-5.0) == 0.0

    def test_non_finite_amounts_ignored(self):
        assert drain_pattern_score([float("nan"), float("inf")], 60.0) == 0.0

    def test_score_bounded(self):
        score = drain_pattern_score([1e12] * 100, window_minutes=0.001)
        assert 0.0 <= score <= 1.0


# ---------------------------------------------------------------------------
# round_amount_ratio
# ---------------------------------------------------------------------------

class TestRoundAmountRatio:
    def test_detects_round_amounts(self):
        # 100, 5000 and 0.5 are round (1 significant figure);
        # 123 and 4821.33 are not.
        ratio = round_amount_ratio([100.0, 5000.0, 0.5, 123.0, 4821.33])
        assert ratio == 3 / 5

    def test_all_round(self):
        assert round_amount_ratio([1.0, 20.0, 300.0, 0.004]) == 1.0

    def test_none_round(self):
        assert round_amount_ratio([123.45, 67.8, 9.99, 3.14159]) == 0.0

    def test_empty_input(self):
        assert round_amount_ratio([]) == 0.0

    def test_zero_counts_as_round(self):
        assert round_amount_ratio([0.0]) == 1.0

    def test_non_finite_ignored(self):
        assert round_amount_ratio([float("nan"), float("inf")]) == 0.0
        assert round_amount_ratio([float("nan"), 100.0]) == 1.0
