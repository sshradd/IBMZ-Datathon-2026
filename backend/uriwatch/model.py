"""Transparent logistic-regression scorer, pure Python.

Trained offline with scikit-learn (see train.py); served with nothing but the
standard library. Weights live in JSON, so the same file loads on x86 and on
big-endian s390x with no native wheels, and every score decomposes into
per-feature contributions we can show to an emergency manager.

One model has one head per horizon (6, 12 and 24 hours). The heads share the
same standardised inputs, so scoring all three costs three dot products.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from .features import FEATURE_GROUP, FEATURES, GRID_FEATURES, GROUP_ORDER, HORIZON_H, HORIZONS, IDX

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

WINDOWS = ("0-6 h", "6-12 h", "12-24 h")


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


@dataclass
class LogisticModel:
    name: str
    mean: list[float]
    std: list[float]
    heads: dict[int, tuple[list[float], float]]  # horizon -> (weights, bias)
    tiers: dict[str, float]  # risk thresholds on the 24 h head: watch / prepare / act
    lo: list[float] = field(default_factory=list)  # per-feature training range; inputs are clamped to it
    hi: list[float] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    # Which of FEATURES this model uses. The live model drops the outage-based ones, which have
    # no free real-time feed; callers always pass the full feature vector.
    features: list[str] = field(default_factory=lambda: list(FEATURES))

    def __post_init__(self) -> None:
        # Fold standardisation into each head so scoring is one multiply-add per feature.
        self._fold = {}
        for h, (w, b) in self.heads.items():
            scale = [wi / s for wi, s in zip(w, self.std)]
            offset = b - sum(wi * m / s for wi, m, s in zip(w, self.mean, self.std))
            self._fold[h] = (scale, offset)
        self._sel = [IDX[f] for f in self.features]
        self._grid_idx = [i for i, f in enumerate(FEATURES) if f in GRID_FEATURES]
        self._group_idx = {g: [i for i, f in enumerate(FEATURES) if FEATURE_GROUP[f] == g] for g in GROUP_ORDER}
        self._lead = HORIZON_H
        if not self.lo:
            self.lo = [-1e18] * len(self.mean)
            self.hi = [1e18] * len(self.mean)
        self._bounds = list(zip(self.lo, self.hi))

    def clamp(self, x: list[float]) -> list[float]:
        """Pick this model's inputs out of the full vector and keep each inside the range seen
        in training, so a storm far bigger than any the model learned from cannot push the
        score off the chart by extrapolation."""
        return [lo if v < lo else hi if v > hi else v for v, (lo, hi) in zip((x[i] for i in self._sel), self._bounds)]

    # ---- scoring -------------------------------------------------------
    def _p(self, h: int, x: list[float]) -> float:
        scale, z = self._fold[h]
        for k, v in zip(scale, x):
            z += k * v
        return _sigmoid(z)

    def risk(self, x: list[float]) -> float:
        """Chance a severe outage starts within the headline horizon (24 h)."""
        return self._p(self._lead, self.clamp(x))

    def risks(self, x: list[float]) -> tuple[float, float, float]:
        """Chance of a severe outage within 6, 12 and 24 hours, kept non-decreasing."""
        x = self.clamp(x)
        p6 = self._p(6, x)
        p12 = max(self._p(12, x), p6)
        p24 = max(self._p(24, x), p12)
        return p6, p12, p24

    @staticmethod
    def window(p6: float, p12: float, p24: float) -> int:
        """Most likely window for the onset: 0 = 0-6 h, 1 = 6-12 h, 2 = 12-24 h (by hourly density)."""
        dens = (p6 / 6.0, (p12 - p6) / 6.0, (p24 - p12) / 12.0)
        return max(range(3), key=lambda i: dens[i])

    def contributions(self, x: list[float]) -> list[float]:
        """Per-feature push on the 24 h log-odds, relative to an average county-hour."""
        w = self.heads[self._lead][0]
        part = [wi * (v - m) / s for wi, v, m, s in zip(w, self.clamp(x), self.mean, self.std)]
        full = [0.0] * len(FEATURES)  # features this model does not use contribute nothing
        for j, i in enumerate(self._sel):
            full[i] = part[j]
        return full

    def group_contributions(self, contribs: list[float]) -> dict[str, float]:
        return {g: sum(contribs[i] for i in idx) for g, idx in self._group_idx.items()}

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
                    "features": self.features,
                    "mean": self.mean,
                    "std": self.std,
                    "heads": {str(h): {"weights": w, "bias": b} for h, (w, b) in self.heads.items()},
                    "tiers": self.tiers,
                    "lo": self.lo,
                    "hi": self.hi,
                    "metrics": self.metrics,
                },
                indent=1,
            )
        )
        return path

    @classmethod
    def load(cls, name: str) -> "LogisticModel":
        d = json.loads((MODELS_DIR / f"{name}.json").read_text())
        if not set(d["features"]) <= set(FEATURES):
            raise ValueError(f"{name}.json uses features this code does not know; retrain")
        heads = {int(h): (v["weights"], v["bias"]) for h, v in d["heads"].items()}
        if set(heads) != set(HORIZONS):
            raise ValueError(f"{name}.json has heads {sorted(heads)}; expected {list(HORIZONS)}")
        return cls(
            d["name"], d["mean"], d["std"], heads, d["tiers"],
            lo=d.get("lo", []), hi=d.get("hi", []), metrics=d.get("metrics", {}), features=d["features"],
        )
