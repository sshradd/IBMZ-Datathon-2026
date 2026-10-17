"""Transparent logistic-regression scorer, pure Python.

Trained offline with scikit-learn (see train.py); served with nothing but the
standard library. Weights live in JSON, so the same file loads on x86 and on
big-endian s390x with no native wheels, and every score decomposes into
per-feature contributions we can show to an emergency manager.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from .features import FEATURES, GRID_FEATURES

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


@dataclass
class LogisticModel:
    name: str
    weights: list[float]
    bias: float
    mean: list[float]
    std: list[float]
    tiers: dict[str, float]  # risk thresholds for watch / prepare / act
    metrics: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Precompute w/std so scoring is one multiply-add per feature.
        self._scale = [w / s for w, s in zip(self.weights, self.std)]
        self._offset = self.bias - sum(w * m / s for w, m, s in zip(self.weights, self.mean, self.std))
        self._grid_idx = [i for i, f in enumerate(FEATURES) if f in GRID_FEATURES]

    def risk(self, x: list[float]) -> float:
        z = self._offset
        for k, v in zip(self._scale, x):
            z += k * v
        return _sigmoid(z)

    def contributions(self, x: list[float]) -> list[float]:
        """Per-feature push on the log-odds, relative to an average county-hour."""
        return [w * (v - m) / s for w, v, m, s in zip(self.weights, x, self.mean, self.std)]

    def grid_share(self, contribs: list[float]) -> float:
        """How much of the positive push comes from statewide grid telemetry (0-1)."""
        pos = [max(c, 0.0) for c in contribs]
        tot = sum(pos)
        return sum(pos[i] for i in self._grid_idx) / tot if tot > 1e-9 else 0.0

    def tier(self, risk: float) -> int:
        t = self.tiers
        if risk >= t["act"]:
            return 3
        if risk >= t["prepare"]:
            return 2
        if risk >= t["watch"]:
            return 1
        return 0

    # ---- persistence ---------------------------------------------------
    def save(self, path: Path | None = None) -> Path:
        path = path or MODELS_DIR / f"{self.name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "name": self.name,
                    "features": FEATURES,
                    "weights": self.weights,
                    "bias": self.bias,
                    "mean": self.mean,
                    "std": self.std,
                    "tiers": self.tiers,
                    "metrics": self.metrics,
                },
                indent=1,
            )
        )
        return path

    @classmethod
    def load(cls, name: str) -> "LogisticModel":
        d = json.loads((MODELS_DIR / f"{name}.json").read_text())
        if d["features"] != FEATURES:
            raise ValueError(f"{name}.json was trained on a different feature list; retrain")
        return cls(d["name"], d["weights"], d["bias"], d["mean"], d["std"], d["tiers"], d.get("metrics", {}))
