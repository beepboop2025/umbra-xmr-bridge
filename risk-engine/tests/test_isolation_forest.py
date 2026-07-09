"""Tests for the from-scratch Isolation Forest."""

import math
import random

import pytest

from services.isolation_forest import (
    IsolationForest,
    _average_path_length,
    order_features,
)


def _cluster(rng: random.Random, n: int) -> list[list[float]]:
    """Typical order flow: modest amounts, spaced-out, daytime, common corridor."""
    return [
        order_features(
            amount=rng.uniform(0.5, 5.0),
            minutes_since_prev=rng.uniform(20, 240),
            hour_of_day=rng.uniform(8, 22),
            direction_frequency=rng.uniform(0.2, 0.5),
        )
        for _ in range(n)
    ]


class TestAveragePathLength:
    def test_degenerate_sizes(self):
        assert _average_path_length(0) == 0.0
        assert _average_path_length(1) == 0.0
        assert _average_path_length(2) == 1.0

    def test_grows_logarithmically(self):
        assert _average_path_length(256) > _average_path_length(64)
        # c(n) ≈ 2 ln(n-1) + 2γ - 2 → around 10.24 for n=256
        assert 9.5 < _average_path_length(256) < 11.0


class TestIsolationForest:
    def test_planted_outlier_scores_higher_than_inliers(self):
        rng = random.Random(1)
        data = _cluster(rng, 400)
        forest = IsolationForest(n_trees=100, sample_size=128, seed=42).fit(data)

        inlier_scores = forest.score(data[:50])
        # A drain signature: huge amount, seconds after the previous order,
        # 4 AM, on a corridor almost nobody uses.
        outlier = order_features(
            amount=450.0, minutes_since_prev=0.05, hour_of_day=4.2,
            direction_frequency=0.001,
        )
        outlier_score = forest.score_one(outlier)

        assert outlier_score > max(inlier_scores), (
            f"outlier {outlier_score:.3f} should beat every inlier "
            f"(max {max(inlier_scores):.3f})"
        )
        assert outlier_score > 0.6  # strong anomaly per the paper's convention

    def test_inliers_score_moderate(self):
        rng = random.Random(2)
        data = _cluster(rng, 400)
        forest = IsolationForest(seed=7).fit(data)
        scores = forest.score(data)
        assert sum(scores) / len(scores) < 0.55  # bulk of data is unexciting

    def test_scores_bounded(self):
        rng = random.Random(3)
        data = _cluster(rng, 100)
        forest = IsolationForest(seed=7).fit(data)
        for x in data + [order_features(1e9, 0.0, 0.0, 1e-6)]:
            assert 0.0 < forest.score_one(x) <= 1.0

    def test_deterministic_given_seed(self):
        rng = random.Random(4)
        data = _cluster(rng, 200)
        probe = order_features(100.0, 1.0, 3.0, 0.01)
        a = IsolationForest(seed=99).fit(data).score_one(probe)
        b = IsolationForest(seed=99).fit(data).score_one(probe)
        assert a == b

    def test_constant_data_is_handled(self):
        data = [[1.0, 2.0, 3.0]] * 50
        forest = IsolationForest(seed=1).fit(data)
        # Nothing can be isolated in identical points; score must be finite.
        s = forest.score_one([1.0, 2.0, 3.0])
        assert math.isfinite(s)

    def test_empty_fit_rejected(self):
        with pytest.raises(ValueError):
            IsolationForest().fit([])

    def test_ragged_rows_rejected(self):
        with pytest.raises(ValueError):
            IsolationForest().fit([[1.0, 2.0], [1.0]])

    def test_score_before_fit_rejected(self):
        with pytest.raises(ValueError):
            IsolationForest().score_one([1.0])


class TestOrderFeatures:
    def test_hour_is_cyclic(self):
        late = order_features(1.0, 60.0, 23.5, 0.3)
        early = order_features(1.0, 60.0, 0.5, 0.3)
        noon = order_features(1.0, 60.0, 12.0, 0.3)
        # 23:30 and 00:30 must be near-neighbours in (sin, cos) space.
        d_wrap = math.dist(late[2:4], early[2:4])
        d_noon = math.dist(late[2:4], noon[2:4])
        assert d_wrap < 0.6 < d_noon

    def test_defensive_ranges(self):
        v = order_features(-5.0, -1.0, 30.0, 0.0)
        assert all(math.isfinite(f) for f in v)
