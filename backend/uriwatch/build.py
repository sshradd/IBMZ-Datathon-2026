"""Build the training set and storm replay bundles from the raw public data.

Training-time only (needs numpy + pandas, see requirements-dev.txt). The
runtime server never imports this: it ships with the model JSON and replay
bundles this script writes.

    python -m uriwatch.build            # from backend/, after scripts/fetch_data.py

Hour index: hour h is 2019-01-01 00:00 UTC + h hours. Weather, ERCOT grid
telemetry and EAGLE-I outage snapshots are all aligned to it.
"""

from __future__ import annotations

import csv
import glob
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .features import (
    FEATURES,
    HORIZON_H,
    N_FEATURES,
    PEOPLE_PER_CUSTOMER,
    severe_threshold,
)

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
REPLAY_DIR = ROOT / "data" / "replay"

T0 = pd.Timestamp("2019-01-01 00:00:00")
T_END = pd.Timestamp("2023-12-31 23:00:00")
N_HOURS = int((T_END - T0) / pd.Timedelta(hours=1)) + 1  # 43,824

# Windows kept in full (every county-hour) for honest evaluation and replay.
# Outside them negatives are subsampled and re-weighted.
SCENARIOS = {
    "uri": ("Winter Storm Uri", "2021-02-08 00:00", "2021-02-24 23:00"),
    "elliott": ("Winter Storm Elliott", "2022-12-20 00:00", "2022-12-28 23:00"),
    "ice2023": ("February 2023 ice storm", "2023-01-30 00:00", "2023-02-06 23:00"),
    "heat2023": ("August 2023 heat dome", "2023-08-18 00:00", "2023-08-31 23:00"),
}
HOLDOUT = ("2021-02-01 00:00", "2021-02-28 23:00")  # never trained on in the honest model
NEG_KEEP = 0.08


def hidx(ts: str | pd.Timestamp) -> int:
    return int((pd.Timestamp(ts) - T0) / pd.Timedelta(hours=1))


# ---------------------------------------------------------------- geography


def load_counties() -> pd.DataFrame:
    gaz = pd.read_csv(RAW / "gazetteer_counties_2023.txt", sep="\t", dtype={"GEOID": str})
    gaz.columns = [c.strip() for c in gaz.columns]
    gaz = gaz[gaz["USPS"] == "TX"][["GEOID", "NAME", "INTPTLAT", "INTPTLONG"]]
    gaz.columns = ["fips", "name", "lat", "lon"]
    gaz["name"] = gaz["name"].str.replace(" County", "", regex=False)
    cen = pd.read_csv(RAW / "census_tx_age_2023.csv", dtype={"COUNTY": str})
    cen = cen[cen["YEAR"] == 5]
    cen["fips"] = "48" + cen["COUNTY"].str.zfill(3)
    cen = cen[["fips", "POPESTIMATE", "AGE65PLUS_TOT"]]
    cen.columns = ["fips", "pop", "pop65"]
    df = gaz.merge(cen, on="fips", how="inner").sort_values("fips").reset_index(drop=True)
    df["senior_share"] = df["pop65"] / df["pop"]
    return df


def haversine(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = (
        np.sin((lat2 - lat1) * p / 2) ** 2
        + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    )
    return 2 * 6371 * np.arcsin(np.sqrt(a))


# ------------------------------------------------------------------- weather


def load_weather(counties: pd.DataFrame):
    stations = {}
    for f in sorted(glob.glob(str(RAW / "weather_*.json"))):
        name = Path(f).stem.replace("weather_", "")
        d = json.loads(Path(f).read_text())
        h = d["hourly"]
        assert len(h["time"]) == N_HOURS, (name, len(h["time"]))
        stations[name] = {
            "lat": d["latitude"],
            "lon": d["longitude"],
            **{k: np.array(h[k], dtype=np.float32) for k in h if k != "time"},
        }
    names = sorted(stations)
    lat = np.array([stations[n]["lat"] for n in names])
    lon = np.array([stations[n]["lon"] for n in names])
    near = np.array(
        [
            int(np.argmin(haversine(r.lat, r.lon, lat, lon)))
            for r in counties.itertuples()
        ]
    )
    return names, stations, near


def _fill(a: np.ndarray) -> np.ndarray:
    s = pd.Series(a).interpolate(limit_direction="both")
    return s.fillna(0).to_numpy(dtype=np.float32)


def shift(a: np.ndarray, k: int) -> np.ndarray:
    out = np.empty_like(a)
    out[:k] = a[0]
    out[k:] = a[:-k]
    return out


def rolling(a: np.ndarray, w: int, how: str) -> np.ndarray:
    r = pd.Series(a).rolling(w, min_periods=1)
    return getattr(r, how)().to_numpy(dtype=np.float32)


def station_features(st: dict) -> dict[str, np.ndarray]:
    t = _fill(st["temperature_2m"])
    app = _fill(st["apparent_temperature"])
    precip = _fill(st["precipitation"])
    snow = _fill(st["snowfall"])
    p6 = rolling(precip, 6, "sum")
    return {
        "temp_c": t,
        "apparent_c": app,
        "cold_deg": np.clip(4.0 - t, 0, None),
        "heat_deg": np.clip(t - 36.0, 0, None),
        "temp_drop_24h": np.clip(t - shift(t, 24), -25, 25),
        "temp_change_3h": np.clip(t - shift(t, 3), -15, 15),
        "wind_kmh": _fill(st["wind_speed_10m"]),
        "precip_6h": p6,
        "snow_6h": rolling(snow, 6, "sum"),
        "ice_index": p6 * (t <= 1.0),
        "humidity": _fill(st["relative_humidity_2m"]),
    }


# ----------------------------------------------------------------- ERCOT grid


def _sum_cols(df: pd.DataFrame, prefix: str) -> pd.Series:
    cols = [
        c
        for c in df.columns
        if c.startswith(prefix) and "Imputed" not in c and "Adjusted" not in c
    ]
    if not cols:
        return pd.Series(0.0, index=df.index)
    return df[cols].apply(pd.to_numeric, errors="coerce").sum(axis=1, min_count=1)


def load_grid() -> dict[str, np.ndarray]:
    frames = []
    for f in sorted(glob.glob(str(RAW / "eia930_balance_erco_*.csv"))):
        frames.append(pd.read_csv(f, encoding="utf-8-sig", low_memory=False))
    df = pd.concat(frames, ignore_index=True)
    ts = pd.to_datetime(df["UTC Time at End of Hour"], format="%m/%d/%Y %I:%M:%S %p")
    df["h"] = ((ts - T0) / pd.Timedelta(hours=1)).round().astype(int)
    df = df[(df["h"] >= 0) & (df["h"] < N_HOURS)].drop_duplicates("h").set_index("h")
    full = pd.DataFrame(index=range(N_HOURS))
    full["demand"] = pd.to_numeric(df["Demand (MW)"], errors="coerce")
    full["forecast"] = pd.to_numeric(df["Demand Forecast (MW)"], errors="coerce")
    full["gen"] = pd.to_numeric(df["Net Generation (MW)"], errors="coerce")
    full["wind"] = _sum_cols(df, "Net Generation (MW) from Wind")
    full = full.interpolate(limit_direction="both").fillna(0)
    demand, fc, gen, wind = (full[c].to_numpy(dtype=np.float32) for c in ("demand", "forecast", "gen", "wind"))
    norm = rolling(demand, 336, "mean")
    return {
        "demand": demand,
        "forecast": fc,
        "gen": gen,
        "grid_fc_err": np.clip((demand - fc) / np.maximum(fc, 1.0), -0.6, 0.6),
        "grid_demand_norm": np.clip(demand / np.maximum(norm, 1.0) - 1.0, -0.6, 0.6),
        "grid_gen_drop_24h": np.clip(gen / np.maximum(rolling(gen, 48, "max"), 1.0) - 1.0, -0.8, 0.0),
        "grid_wind_share": np.clip(wind / np.maximum(gen, 1.0), 0.0, 1.0),
    }


# -------------------------------------------------------------------- outages


def load_outages(counties: pd.DataFrame) -> np.ndarray:
    """Hourly peak customers out per county, shape [counties, hours]. Missing = 0."""
    fips_to_i = {f: i for i, f in enumerate(counties["fips"])}
    out = np.zeros((len(counties), N_HOURS), dtype=np.float32)
    for f in sorted(glob.glob(str(RAW / "eaglei_tx_*.csv"))):
        # The 2023 file names the count column "sum" instead of "customers_out".
        df = pd.read_csv(
            f,
            dtype={"fips_code": str},
            usecols=lambda c: c in ("fips_code", "customers_out", "sum", "run_start_time"),
        ).rename(columns={"sum": "customers_out"})
        ts = pd.to_datetime(df["run_start_time"]).dt.floor("h")
        h = ((ts - T0) / pd.Timedelta(hours=1)).astype(int).to_numpy()
        ci = df["fips_code"].map(fips_to_i)
        keep = ci.notna().to_numpy() & (h >= 0) & (h < N_HOURS)
        ci = ci.to_numpy()[keep].astype(int)
        h = h[keep]
        v = pd.to_numeric(df["customers_out"], errors="coerce").fillna(0).to_numpy(dtype=np.float32)[keep]
        np.maximum.at(out, (ci, h), v)
        print(f"  outages {Path(f).name}: {len(df):,} rows", flush=True)
    return out


# ------------------------------------------------------------------- features


def county_feature_matrix(c: int, counties: pd.DataFrame, out: np.ndarray, st_feats, near, grid, state) -> np.ndarray:
    """Feature matrix [hours, FEATURES] for one county. Float32."""
    o = out[c]
    lo = np.log1p(o)
    sf = st_feats[near[c]]
    row = counties.iloc[c]
    hour_local = (np.arange(N_HOURS) - 6) % 24
    cols = {
        "log_out_now": lo,
        "out_trend_1h": lo - shift(lo, 1),
        "out_trend_3h": lo - shift(lo, 3),
        "log_out_max6h": rolling(lo, 6, "max"),
        **{k: sf[k] for k in sf},
        **{k: grid[k] for k in grid if k.startswith("grid_")},
        **state,
        "log_pop": np.full(N_HOURS, math.log(row["pop"]), dtype=np.float32),
        "senior_share": np.full(N_HOURS, row["senior_share"], dtype=np.float32),
        "hour_sin": np.sin(2 * np.pi * hour_local / 24).astype(np.float32),
        "hour_cos": np.cos(2 * np.pi * hour_local / 24).astype(np.float32),
    }
    return np.stack([cols[f] for f in FEATURES], axis=1).astype(np.float32)


def state_features(counties: pd.DataFrame, out: np.ndarray, st_feats) -> dict[str, np.ndarray]:
    """Statewide footprint of the storm: what fraction of Texas is already in severe outage."""
    thr = np.array([severe_threshold(p) for p in counties["pop"]], dtype=np.float32)[:, None]
    frac = (out >= thr).mean(axis=0).astype(np.float32)
    cold = np.mean([sf["cold_deg"] for sf in st_feats], axis=0).astype(np.float32)
    return {
        "state_sev_frac": frac,
        "state_sev_trend_3h": np.clip(frac - shift(frac, 3), -1, 1),
        "state_cold_deg": cold,
    }


def onset_labels(o: np.ndarray, thr: float):
    """y[h] = 1 if customers out first reaches `thr` within HORIZON_H hours.
    eligible[h] = not already severe at h (we predict onset, not persistence)."""
    n = len(o)
    ahead = pd.Series(o[::-1]).rolling(HORIZON_H, min_periods=1).max().to_numpy()[::-1]
    fut = np.empty(n, dtype=np.float32)
    fut[:-1] = ahead[1:]
    fut[-1] = 0
    eligible = (o < thr)
    eligible[:48] = False
    eligible[-HORIZON_H - 1 :] = False
    y = (fut >= thr) & eligible
    return y.astype(np.uint8), eligible


def build_training(counties, out, st_feats, near, grid, state, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    full_mask = np.zeros(N_HOURS, dtype=bool)
    for _, a, b in SCENARIOS.values():
        full_mask[hidx(a) : hidx(b) + 1] = True
    Xs, ys, ws, cs, hs = [], [], [], [], []
    for c in range(len(counties)):
        X = county_feature_matrix(c, counties, out, st_feats, near, grid, state)
        thr = severe_threshold(counties.loc[c, "pop"])
        y, elig = onset_labels(out[c], thr)
        keep = elig & (full_mask | (y == 1) | (rng.random(N_HOURS) < NEG_KEEP))
        idx = np.nonzero(keep)[0]
        w = np.where(full_mask[idx] | (y[idx] == 1), 1.0, 1.0 / NEG_KEEP).astype(np.float32)
        Xs.append(X[idx]); ys.append(y[idx]); ws.append(w)
        cs.append(np.full(len(idx), c, dtype=np.int16)); hs.append(idx.astype(np.int32))
        if c % 50 == 0:
            print(f"  features county {c}/{len(counties)}", flush=True)
    return {
        "X": np.concatenate(Xs), "y": np.concatenate(ys), "w": np.concatenate(ws),
        "c": np.concatenate(cs), "h": np.concatenate(hs),
    }


# ------------------------------------------------------------ replay bundles


def build_replays(counties, out, st_feats, near, grid, state) -> None:
    REPLAY_DIR.mkdir(parents=True, exist_ok=True)
    mats = [county_feature_matrix(c, counties, out, st_feats, near, grid, state) for c in range(len(counties))]
    thr = [severe_threshold(p) for p in counties["pop"]]
    cj = [
        {
            "fips": r.fips, "name": r.name, "lat": round(r.lat, 3), "lon": round(r.lon, 3),
            "pop": int(r.pop), "pop65": int(r.pop65), "severe_at": int(round(severe_threshold(r.pop))),
        }
        for r in counties.itertuples()
    ]
    for key, (title, a, b) in SCENARIOS.items():
        ha, hb = hidx(a), hidx(b)
        hours = []
        for h in range(ha, hb + 1):
            hours.append(
                {
                    "t": (T0 + pd.Timedelta(hours=h)).strftime("%Y-%m-%dT%H:00Z"),
                    "x": [[round(float(v), 3) for v in m[h]] for m in mats],
                    "out": [int(out[c, h]) for c in range(len(counties))],
                    "grid": {
                        "demand": round(float(grid["demand"][h])),
                        "forecast": round(float(grid["forecast"][h])),
                        "gen": round(float(grid["gen"][h])),
                    },
                }
            )
        blob = {"key": key, "title": title, "counties": cj, "hours": hours}
        path = REPLAY_DIR / f"{key}.json.gz"
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as fh:
            json.dump(blob, fh, separators=(",", ":"))
        print(f"  replay {key}: {len(hours)} h, {path.stat().st_size / 1e6:.1f} MB", flush=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("counties + census", flush=True)
    counties = load_counties()
    print(f"  {len(counties)} Texas counties", flush=True)
    names, stations, near = load_weather(counties)
    st_feats = [station_features(stations[n]) for n in names]
    print(f"weather: {len(names)} stations", flush=True)
    grid = load_grid()
    print("ERCOT grid telemetry loaded", flush=True)
    out = load_outages(counties)
    np.save(OUT / "outages.npy", out)
    counties.to_csv(OUT / "counties.csv", index=False)
    print(f"outage matrix {out.shape}, nonzero {(out > 0).mean() * 100:.1f}%", flush=True)
    state = state_features(counties, out, st_feats)
    if "--replays-only" not in sys.argv:
        data = build_training(counties, out, st_feats, near, grid, state)
        np.savez_compressed(OUT / "train.npz", **data)
        print(f"training rows {len(data['y']):,}, positives {int(data['y'].sum()):,}", flush=True)
    build_replays(counties, out, st_feats, near, grid, state)
    print("done", flush=True)


if __name__ == "__main__":
    main()
