"""Train the two models and write models/*.json.

    python -m uriwatch.train            # from backend/, after uriwatch.build

honest  trained only on data before Dec 2022 and with Feb 2021 removed. It has
        never seen Winter Storm Uri, Elliott, the Feb 2023 ice storm or the
        Aug 2023 heat dome, so replaying them is a real out-of-sample test.
final   trained on everything, for forward-looking use.

Training uses scikit-learn on a laptop. The result is plain JSON weights that
the pure-Python server (and the s390x LinuxONE box) loads with no native code.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import StandardScaler

from .build import HOLDOUT, OUT, REPLAY_DIR, SCENARIOS, hidx
from .engine import Engine
from .features import FEATURES, HORIZON_H
from .model import LogisticModel

# Tiers are alert budgets, not probabilities: a county-hour is "watch" if its risk is in the
# top 3% of all Texas county-hours seen in training, "prepare" top 1%, "act" top 0.3%.
# Thresholds come from the training data only, never tuned on the storms.
TIER_QUANTILES = {"watch": 0.97, "prepare": 0.99, "act": 0.997}
TRAIN_END = "2022-12-01 00:00"
SEED = 0


def weighted_quantile(v: np.ndarray, w: np.ndarray, q: float) -> float:
    order = np.argsort(v)
    cum = np.cumsum(w[order])
    return float(v[order][np.searchsorted(cum, q * cum[-1])])


def fit(X: np.ndarray, y: np.ndarray, w: np.ndarray, name: str) -> LogisticModel:
    scaler = StandardScaler().fit(X)
    clf = LogisticRegression(C=0.5, max_iter=1000, solver="lbfgs")
    clf.fit(scaler.transform(X), y, sample_weight=w)
    p_train = clf.predict_proba(scaler.transform(X))[:, 1]
    tiers = {k: round(weighted_quantile(p_train, w, q), 5) for k, q in TIER_QUANTILES.items()}
    return LogisticModel(
        name=name,
        weights=[float(v) for v in clf.coef_[0]],
        bias=float(clf.intercept_[0]),
        mean=[float(v) for v in scaler.mean_],
        std=[float(max(v, 1e-6)) for v in scaler.scale_],
        tiers=tiers,
    )


def predict(model: LogisticModel, X: np.ndarray) -> np.ndarray:
    z = (X - np.array(model.mean, dtype=np.float32)) / np.array(model.std, dtype=np.float32)
    return 1.0 / (1.0 + np.exp(-(z @ np.array(model.weights, dtype=np.float32) + model.bias)))


def score_set(model: LogisticModel, X, y, w) -> dict:
    p = predict(model, X)
    bins = [0, 0.02, 0.05, 0.10, 0.20, 0.30, 0.60, 1.01]
    cal = []
    for a, b in zip(bins[:-1], bins[1:]):
        m = (p >= a) & (p < b)
        if m.any() and w[m].sum() > 0:
            cal.append(
                {
                    "bin": f"{a:.2f}-{min(b, 1):.2f}",
                    "predicted": round(float(np.average(p[m], weights=w[m])), 4),
                    "observed": round(float(np.average(y[m], weights=w[m])), 4),
                    "rows": int(m.sum()),
                }
            )
    watch = p >= model.tiers["watch"]
    tp = float((w * (watch & (y == 1))).sum())
    pos = float((w * (y == 1)).sum())
    return {
        "rows": int(len(y)),
        "positives": int((y == 1).sum()),
        "roc_auc": round(float(roc_auc_score(y, p, sample_weight=w)), 4),
        "avg_precision": round(float(average_precision_score(y, p, sample_weight=w)), 4),
        "watch_precision": round(tp / max(float((w * watch).sum()), 1e-9), 4),
        "watch_recall": round(tp / max(pos, 1e-9), 4),
        "base_rate": round(pos / float(w.sum()), 5),
        "calibration": cal,
    }


def replay_scorecards(model: LogisticModel) -> dict:
    out = {}
    for key in SCENARIOS:
        path = REPLAY_DIR / f"{key}.json.gz"
        if not path.exists():
            continue
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            bundle = json.load(fh)
        engine = Engine(model, bundle["counties"])
        for h, hour in enumerate(bundle["hours"]):
            res = engine.score_hour(h, hour)
        out[key] = res["scorecard"]
    return out


def ranking_lift(model: LogisticModel, k: int = 10) -> dict:
    """Each hour, rank counties not yet in severe outage by risk. Of the top k, how many
    were hit within the horizon, versus picking k counties at random?"""
    out = np.load(OUT / "outages.npy")
    res = {}
    for key, (title, a, b) in SCENARIOS.items():
        with gzip.open(REPLAY_DIR / f"{key}.json.gz", "rt", encoding="utf-8") as fh:
            bundle = json.load(fh)
        thr = np.array([c["severe_at"] for c in bundle["counties"]])
        ha = hidx(a)
        hits = tot = base = n = 0
        for i, hour in enumerate(bundle["hours"]):
            h = ha + i
            if h + HORIZON_H + 1 >= out.shape[1]:
                break
            risk = np.array([model.risk(x) for x in hour["x"]])
            elig = out[:, h] < thr
            if elig.sum() < k:
                continue
            fut = out[:, h + 1 : h + 1 + HORIZON_H].max(axis=1) >= thr
            top = np.argsort(-(risk * elig))[:k]
            hits += int(fut[top].sum()); tot += k; base += float(fut[elig].mean()); n += 1
        if tot:
            res[key] = {
                "top_k": k,
                "precision": round(hits / tot, 3),
                "random": round(base / n, 3),
                "lift": round((hits / tot) / max(base / n, 1e-9), 1),
            }
    return res


def main() -> None:
    d = np.load(OUT / "train.npz")
    X, y, w, h = d["X"], d["y"], d["w"], d["h"]
    print(f"rows {len(y):,}  positives {int(y.sum()):,}  features {len(FEATURES)}", flush=True)

    ho_a, ho_b = hidx(HOLDOUT[0]), hidx(HOLDOUT[1])
    in_holdout = (h >= ho_a) & (h <= ho_b)
    train_mask = (h < hidx(TRAIN_END)) & ~in_holdout
    honest = fit(X[train_mask], y[train_mask], w[train_mask], "honest")
    print(f"honest model: {int(train_mask.sum()):,} training rows", flush=True)

    metrics = {"train_rows": int(train_mask.sum()), "train_end": TRAIN_END, "holdout": HOLDOUT, "sets": {}}
    for key, (title, a, b) in SCENARIOS.items():
        m = (h >= hidx(a)) & (h <= hidx(b))
        if m.any() and y[m].sum() > 0:
            metrics["sets"][key] = score_set(honest, X[m], y[m], w[m])
    m = h >= hidx(TRAIN_END)
    metrics["sets"]["all_after_training"] = score_set(honest, X[m], y[m], w[m])
    metrics["scenarios"] = replay_scorecards(honest)
    metrics["ranking"] = ranking_lift(honest)
    metrics["horizon_h"] = HORIZON_H
    coef = sorted(zip(FEATURES, honest.weights), key=lambda fw: abs(fw[1]), reverse=True)
    metrics["top_weights"] = [{"feature": f, "weight": round(v, 3)} for f, v in coef[:10]]
    honest.metrics = metrics
    honest.save()

    final = fit(X, y, w, "final")
    final.metrics = {
        "train_rows": int(len(y)),
        "note": "trained on every year including Uri; use the honest model for out-of-sample claims",
    }
    final.metrics["scenarios"] = replay_scorecards(final)
    final.save()

    print(json.dumps({k: v for k, v in metrics.items() if k != "sets"}, indent=1))
    for k, v in metrics["sets"].items():
        print(k, {a: b for a, b in v.items() if a != "calibration"})
    print("done", flush=True)


if __name__ == "__main__":
    main()
