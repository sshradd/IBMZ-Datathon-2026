"""Train the scorer on a simulated stream and evaluate on a different seed.

    python -m scamstopper.train            # writes backend/model.json
"""

from __future__ import annotations

import argparse
import platform
import time

from .engine import Engine
from .features import FEATURES, FeatureState
from .model import MODEL_PATH, LogisticModel, train
from .sim import Simulator


def build_dataset(seed: int, n: int, fraud_rate: float) -> tuple[list[list[float]], list[int]]:
    sim = Simulator(seed=seed, fraud_rate=fraud_rate)
    fs = FeatureState()
    for t in sim.warmup():
        fs.update(t)
    X, y = [], []
    for _ in range(n):
        t = sim.next()
        x, _ = fs.extract(t)
        X.append(x)
        y.append(1 if t.label_fraud else 0)
        fs.update(t)
    return X, y


def evaluate(model: LogisticModel, seed: int, n: int, fraud_rate: float) -> dict:
    sim = Simulator(seed=seed, fraud_rate=fraud_rate)
    engine = Engine(model)
    engine.warm(sim.warmup())
    by_scenario: dict[str, list[int]] = {}
    for _ in range(n):
        t = sim.next()
        d = engine.score(t)
        if t.scenario:
            hit = by_scenario.setdefault(t.scenario, [0, 0])
            hit[0] += d.action != "allow"
            hit[1] += 1
    s = engine.stats.snapshot()
    return {
        "eval_events": n,
        "precision": s["precision"],
        "recall": s["recall"],
        "false_positive_rate": s["false_positive_rate"],
        "actions": s["actions"],
        "recall_by_scenario": {k: round(v[0] / v[1], 3) for k, v in sorted(by_scenario.items())},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-events", type=int, default=40000)
    ap.add_argument("--eval-events", type=int, default=20000)
    ap.add_argument("--fraud-rate", type=float, default=0.02)
    args = ap.parse_args()

    t0 = time.perf_counter()
    X, y = build_dataset(1, args.train_events, args.fraud_rate)
    model = train(X, y)
    train_s = time.perf_counter() - t0
    model.metrics = evaluate(model, 2, args.eval_events, args.fraud_rate)
    model.metrics.update({
        "train_events": len(X),
        "train_fraud": sum(y),
        "train_seconds": round(train_s, 2),
        "trained_on": f"{platform.machine()} / Python {platform.python_version()}",
    })
    model.save()

    print(f"Saved {MODEL_PATH}")
    for f, w in sorted(zip(FEATURES, model.weights), key=lambda fw: -abs(fw[1])):
        print(f"  {f:24s} {w:+.3f}")
    for k, v in model.metrics.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
