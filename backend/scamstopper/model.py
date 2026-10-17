"""Transparent logistic-regression scorer.

Pure Python on purpose: no native wheels to hunt for on s390x, weights stored
as JSON (byte-order independent), and every decision decomposes into
per-feature contributions we can show to a customer.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path

from .features import FEATURES, RECEIVER_FEATURES, SENDER_FEATURES

MODEL_PATH = Path(__file__).resolve().parent.parent / "model.json"


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


@dataclass
class LogisticModel:
    weights: list[float]
    bias: float
    mean: list[float]
    std: list[float]
    metrics: dict = field(default_factory=dict)

    def contributions(self, x: list[float]) -> list[float]:
        return [w * (v - m) / s for w, v, m, s in zip(self.weights, x, self.mean, self.std)]

    def predict(self, x: list[float]) -> tuple[float, list[float], float, float]:
        """Return (risk, contributions, sender_score, receiver_score)."""
        c = self.contributions(x)
        sender = sum(ci for ci, f in zip(c, FEATURES) if f in SENDER_FEATURES)
        receiver = sum(ci for ci, f in zip(c, FEATURES) if f in RECEIVER_FEATURES)
        risk = _sigmoid(self.bias + sender + receiver)
        return risk, c, _sigmoid(self.bias + sender), _sigmoid(self.bias + receiver)

    # ---- persistence ---------------------------------------------------
    def save(self, path: Path = MODEL_PATH) -> None:
        path.write_text(
            json.dumps(
                {
                    "features": FEATURES,
                    "weights": self.weights,
                    "bias": self.bias,
                    "mean": self.mean,
                    "std": self.std,
                    "metrics": self.metrics,
                },
                indent=2,
            )
        )

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "LogisticModel":
        d = json.loads(path.read_text())
        if d["features"] != FEATURES:
            raise ValueError("model.json was trained on a different feature list; retrain")
        return cls(d["weights"], d["bias"], d["mean"], d["std"], d.get("metrics", {}))


def train(
    X: list[list[float]],
    y: list[int],
    epochs: int = 6,
    lr: float = 0.05,
    l2: float = 1e-4,
    seed: int = 0,
) -> LogisticModel:
    """Class-weighted SGD on standardized features."""
    n, d = len(X), len(X[0])
    mean = [sum(row[j] for row in X) / n for j in range(d)]
    std = [
        max(math.sqrt(sum((row[j] - mean[j]) ** 2 for row in X) / n), 1e-6) for j in range(d)
    ]
    Z = [[(row[j] - mean[j]) / std[j] for j in range(d)] for row in X]
    pos = sum(y)
    pos_weight = min((n - pos) / max(pos, 1), 10.0)

    w = [0.0] * d
    b = 0.0
    rng = random.Random(seed)
    order = list(range(n))
    for epoch in range(epochs):
        rng.shuffle(order)
        step = lr / (1 + epoch)
        for i in order:
            z = Z[i]
            p = _sigmoid(b + sum(wj * zj for wj, zj in zip(w, z)))
            g = (p - y[i]) * (pos_weight if y[i] else 1.0)
            for j in range(d):
                w[j] -= step * (g * z[j] + l2 * w[j])
            b -= step * g
    return LogisticModel(w, b, mean, std)
