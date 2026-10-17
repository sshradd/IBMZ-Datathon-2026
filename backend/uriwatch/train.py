"""Train the two models and write models/*.json.

    python -m uriwatch.train            # from backend/, after uriwatch.build

honest  trained only on data before Dec 2022 and with Feb 2021 removed. It has
        never seen Winter Storm Uri, Elliott, the Feb 2023 ice storm or the
        Aug 2023 heat dome, so replaying them is a real out-of-sample test.
final   trained on everything, for forward-looking use.

Each model has three heads (6, 12 and 24 hours). Training uses scikit-learn on a
laptop. The result is plain JSON weights that the pure-Python server (and the
s390x LinuxONE box) loads with no native code.
"""

from __future__ import annotations

import gzip
import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import StandardScaler

from .build import HOLDOUT, OUT, REPLAY_DIR, SCENARIOS, hidx
from .engine import Engine
from .features import FEATURES, HORIZON_H, HORIZONS, IDX
from .model import LogisticModel

# Tiers are alert budgets, not probabilities: a county-hour is "watch" if its risk is in the
# top 3% of all Texas county-hours seen in training, "prepare" top 1%, "act" top 0.3%.
# Thresholds come from the training data only, never tuned on the storms.
TIER_QUANTILES = {"watch": 0.97, "prepare": 0.99, "act": 0.997}
TRAIN_END = "2022-12-01 00:00"
TIER_NAMES = ("watch", "prepare", "act")


def weighted_quantile(v: np.ndarray, w: np.ndarray, q: float) -> float:
    order = np.argsort(v)
    cum = np.cumsum(w[order])
    return float(v[order][np.searchsorted(cum, q * cum[-1])])


# What exists in real time with no login: weather, ERCOT grid telemetry, county profile.
# Outage counts (and the statewide outage footprint built from them) have no free live feed.
LIVE_FEATURES = [
    "temp_c", "apparent_c", "cold_deg", "heat_deg", "temp_drop_24h", "temp_change_3h",
    "wind_kmh", "precip_6h", "snow_6h", "ice_index", "humidity",
    "grid_fc_err", "grid_demand_norm", "grid_gen_drop_24h", "grid_wind_share",
    "state_cold_deg", "log_pop", "hour_sin", "hour_cos",
]


def fit(d: dict[str, np.ndarray], mask: np.ndarray, name: str, features: list[str] | None = None) -> LogisticModel:
    features = features or list(FEATURES)
    cols = [IDX[f] for f in features]
    X, w = d["X"][mask][:, cols], d["w"][mask]
    # Clamp inputs to the training range (0.1th to 99.9th percentile) before anything else.
    lo = np.percentile(X, 0.1, axis=0)
    hi = np.percentile(X, 99.9, axis=0)
    X = np.clip(X, lo, hi)
    scaler = StandardScaler().fit(X)
    Z = scaler.transform(X)
    heads, p_lead = {}, None
    for hz in HORIZONS:
        clf = LogisticRegression(C=0.5, max_iter=1000, solver="lbfgs")
        clf.fit(Z, d[f"y{hz}"][mask], sample_weight=w)
        heads[hz] = ([float(v) for v in clf.coef_[0]], float(clf.intercept_[0]))
        if hz == HORIZON_H:
            p_lead = clf.predict_proba(Z)[:, 1]
    tiers = {k: round(weighted_quantile(p_lead, w, q), 5) for k, q in TIER_QUANTILES.items()}
    return LogisticModel(
        name=name,
        mean=[float(v) for v in scaler.mean_],
        std=[float(max(v, 1e-6)) for v in scaler.scale_],
        heads=heads,
        tiers=tiers,
        lo=[float(v) for v in lo],
        hi=[float(v) for v in hi],
        features=features,
    )


def predict(model: LogisticModel, X: np.ndarray, horizon: int = HORIZON_H) -> np.ndarray:
    w, b = model.heads[horizon]
    X = X[:, model._sel]
    X = np.clip(X, np.array(model.lo, dtype=np.float32), np.array(model.hi, dtype=np.float32))
    z = (X - np.array(model.mean, dtype=np.float32)) / np.array(model.std, dtype=np.float32)
    return 1.0 / (1.0 + np.exp(-(z @ np.array(w, dtype=np.float32) + b)))


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


def horizon_table(model: LogisticModel, d: dict, mask: np.ndarray) -> dict:
    """ROC AUC of each horizon head on a test slice."""
    out = {}
    for hz in HORIZONS:
        y = d[f"y{hz}"][mask]
        if y.sum() == 0:
            continue
        p = predict(model, d["X"][mask], hz)
        out[str(hz)] = round(float(roc_auc_score(y, p, sample_weight=d["w"][mask])), 3)
    return out


def tier_stats(model: LogisticModel, d: dict, mask: np.ndarray) -> dict:
    """How often counties at or above each tier really went severe within 24 h, pooled over the
    out-of-sample storms. This is the confidence figure shown next to every recommendation."""
    y, w = d["y"][mask], d["w"][mask]
    p = predict(model, d["X"][mask])
    base = float((w * y).sum() / w.sum())
    pos = float((w * y).sum())
    out = {"base_rate": round(base, 5)}
    for t in TIER_NAMES:
        sel = p >= model.tiers[t]
        hit = float((w * (sel & (y == 1))).sum())
        n = float((w * sel).sum())
        prec = hit / max(n, 1e-9)
        out[t] = {
            "precision": round(prec, 4),
            "recall": round(hit / max(pos, 1e-9), 4),
            "lift": round(prec / max(base, 1e-9), 1),
            "share_of_county_hours": round(n / float(w.sum()), 4),
        }
    return out


def replay_scorecards(model: LogisticModel) -> dict:
    out = {}
    for key in SCENARIOS:
        path = REPLAY_DIR / f"{key}.json.gz"
        if not path.exists():
            continue
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            bundle = json.load(fh)
        engine = Engine(model, bundle["counties"])
        res = None
        for h, hour in enumerate(bundle["hours"]):
            res = engine.score_hour(h, hour)
        out[key] = res["describe"]["scorecard"]
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


def evaluate(model: LogisticModel, d: dict, train_mask: np.ndarray) -> dict:
    """Out-of-sample report card for a model trained on `train_mask` only."""
    h = d["h"]
    test_all = np.zeros(len(h), dtype=bool)
    metrics = {
        "train_rows": int(train_mask.sum()),
        "train_end": TRAIN_END,
        "holdout": HOLDOUT,
        "horizons": list(HORIZONS),
        "horizon_h": HORIZON_H,
        "features": model.features,
        "sets": {},
        "horizon_auc": {},
    }
    for key, (title, a, b) in SCENARIOS.items():
        m = (h >= hidx(a)) & (h <= hidx(b))
        test_all |= m
        if m.any() and d["y"][m].sum() > 0:
            metrics["sets"][key] = score_set(model, d["X"][m], d["y"][m], d["w"][m])
            metrics["horizon_auc"][key] = horizon_table(model, d, m)
    m = h >= hidx(TRAIN_END)
    metrics["sets"]["all_after_training"] = score_set(model, d["X"][m], d["y"][m], d["w"][m])
    metrics["tier_stats"] = tier_stats(model, d, test_all)
    metrics["scenarios"] = replay_scorecards(model)
    metrics["ranking"] = ranking_lift(model)
    cols = [IDX[f] for f in model.features]
    coef = sorted(zip(model.features, model.heads[HORIZON_H][0]), key=lambda fw: abs(fw[1]), reverse=True)
    metrics["top_weights"] = [{"feature": f, "weight": round(v, 3)} for f, v in coef[:10]]
    return metrics


def main() -> None:
    d = dict(np.load(OUT / "train.npz"))
    h = d["h"]
    print(f"rows {len(d['y']):,}  positives {int(d['y'].sum()):,}  features {len(FEATURES)}", flush=True)

    in_holdout = (h >= hidx(HOLDOUT[0])) & (h <= hidx(HOLDOUT[1]))
    train_mask = (h < hidx(TRAIN_END)) & ~in_holdout
    everything = np.ones(len(h), dtype=bool)

    for prefix, feats in (("", None), ("live_", LIVE_FEATURES)):
        honest = fit(d, train_mask, f"{prefix}honest", feats)
        print(f"{honest.name}: {int(train_mask.sum()):,} rows, tiers {honest.tiers}", flush=True)
        honest.metrics = evaluate(honest, d, train_mask)
        honest.save()

        final = fit(d, everything, f"{prefix}final" if prefix else "final", feats)
        final.metrics = {
            "train_rows": int(len(h)),
            "horizons": list(HORIZONS),
            "horizon_h": HORIZON_H,
            "features": final.features,
            "note": "trained on every year including Uri; use the honest model for out-of-sample claims",
        }
        final.metrics["scenarios"] = replay_scorecards(final)
        final.save()
        m = honest.metrics
        print(" ", {k: (v["onsets"], v["warned_pct"], v["median_lead_h"], v["false_alerts"]) for k, v in m["scenarios"].items()})
        print(" ", {t: (m["tier_stats"][t]["precision"], m["tier_stats"][t]["lift"]) for t in TIER_NAMES}, {k: v["24"] for k, v in m["horizon_auc"].items()})
    print("done", flush=True)


if __name__ == "__main__":
    main()
