"""
Isolation Forest anomaly detection, implemented from scratch (stdlib only).

Reference: Liu, Ting & Zhou, "Isolation Forest" (ICDM 2008).

Why this algorithm for a bridge: drain attacks and probing bots do not look
like any *single* threshold violation — they look like combinations that are
merely unusual together (a large amount at an odd hour on a rare corridor,
placed seconds after the previous order). Isolation Forest needs no labelled
fraud data (we hopefully have none), no distributional assumptions, and it
scores in microseconds: anomalous points are isolated by fewer random splits,
so their expected path length across a forest of random trees is short.

The implementation is deliberately dependency-free (no numpy/sklearn) so the
risk engine's hot path has nothing to import but the standard library, and
deterministic given a seed so scores are reproducible across replicas.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

EULER_GAMMA = 0.5772156649015329


def _average_path_length(n: int) -> float:
    """c(n): average unsuccessful-search path length in a BST of n points.

    This is the normalization constant from the paper; it converts raw path
    lengths into the 0..1 anomaly score.
    """
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    harmonic = math.log(n - 1) + EULER_GAMMA
    return 2.0 * harmonic - 2.0 * (n - 1) / n


@dataclass
class _Node:
    feature: int = -1
    split: float = 0.0
    left: "_Node | None" = None
    right: "_Node | None" = None
    size: int = 0  # leaf: number of training points that landed here
    depth: int = 0


class IsolationTree:
    """A single isolation tree built on a subsample of the data."""

    def __init__(self, rng: random.Random, height_limit: int):
        self._rng = rng
        self._height_limit = height_limit
        self.root: _Node | None = None

    def fit(self, data: list[list[float]]) -> "IsolationTree":
        self.root = self._build(data, 0)
        return self

    def _build(self, data: list[list[float]], depth: int) -> _Node:
        n = len(data)
        if n <= 1 or depth >= self._height_limit:
            return _Node(size=n, depth=depth)

        # Pick a random feature that still varies within this partition;
        # constant features cannot isolate anything.
        n_features = len(data[0])
        candidates = list(range(n_features))
        self._rng.shuffle(candidates)
        for feature in candidates:
            lo = min(row[feature] for row in data)
            hi = max(row[feature] for row in data)
            if hi > lo:
                break
        else:
            # Every feature is constant: the points are duplicates.
            return _Node(size=n, depth=depth)

        split = self._rng.uniform(lo, hi)
        left_rows = [row for row in data if row[feature] < split]
        right_rows = [row for row in data if row[feature] >= split]
        if not left_rows or not right_rows:
            return _Node(size=n, depth=depth)

        return _Node(
            feature=feature,
            split=split,
            left=self._build(left_rows, depth + 1),
            right=self._build(right_rows, depth + 1),
            depth=depth,
        )

    def path_length(self, x: list[float]) -> float:
        node = self.root
        while node is not None and node.feature >= 0:
            node = node.left if x[node.feature] < node.split else node.right
        if node is None:
            return 0.0
        # Points sharing a leaf with many others get the estimated extra
        # depth c(size) — they are "deep", i.e. normal.
        return node.depth + _average_path_length(node.size)


@dataclass
class IsolationForest:
    """Forest of isolation trees. `fit` then `score` (higher = more anomalous).

    Scores follow the paper's convention:
        s(x) = 2 ^ ( -E[h(x)] / c(sample_size) )
    ~0.5 for ordinary points, approaching 1.0 for strong anomalies.
    """

    n_trees: int = 100
    sample_size: int = 256
    seed: int = 7
    _trees: list[IsolationTree] = field(default_factory=list, repr=False)
    _c_norm: float = 0.0

    def fit(self, data: list[list[float]]) -> "IsolationForest":
        if not data:
            raise ValueError("cannot fit an IsolationForest on empty data")
        widths = {len(row) for row in data}
        if len(widths) != 1:
            raise ValueError("all feature vectors must have the same length")

        rng = random.Random(self.seed)
        sample_n = min(self.sample_size, len(data))
        height_limit = max(1, math.ceil(math.log2(max(2, sample_n))))
        self._c_norm = _average_path_length(sample_n)

        self._trees = []
        for _ in range(self.n_trees):
            sample = rng.sample(data, sample_n) if len(data) > sample_n else list(data)
            self._trees.append(IsolationTree(rng, height_limit).fit(sample))
        return self

    def score_one(self, x: list[float]) -> float:
        if not self._trees:
            raise ValueError("fit() must be called before score_one()")
        if self._c_norm <= 0:
            return 0.5
        mean_path = sum(t.path_length(x) for t in self._trees) / len(self._trees)
        return 2.0 ** (-mean_path / self._c_norm)

    def score(self, xs: list[list[float]]) -> list[float]:
        return [self.score_one(x) for x in xs]


# ---------------------------------------------------------------------------
# Order-flow feature extraction
# ---------------------------------------------------------------------------

def order_features(
    amount: float,
    minutes_since_prev: float,
    hour_of_day: float,
    direction_frequency: float,
) -> list[float]:
    """Map one order to the feature vector the forest is trained on.

    - log1p(amount): value scale without letting whales dominate the range
    - log1p(minutes since previous order): burst spacing; drains cluster near 0
    - sin/cos hour-of-day: cyclic time so 23:00 and 01:00 are neighbours
    - log(direction frequency): how common this corridor is (rare corridors
      carry more risk); frequency is the corridor's share of recent orders
    """
    angle = 2.0 * math.pi * (hour_of_day % 24.0) / 24.0
    return [
        math.log1p(max(0.0, amount)),
        math.log1p(max(0.0, minutes_since_prev)),
        math.sin(angle),
        math.cos(angle),
        math.log(max(1e-6, direction_frequency)),
    ]
