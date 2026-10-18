"""Realtime outage-risk forecast from live weather -> frontend_data/live.json.

Per Texas county: pull the live Open-Meteo FORECAST (past 512h + next 96h hourly),
run the fine-tuned TTM, and emit predicted outage % for 6/24/96h plus harm, greedy
crew dispatch, and alerts (>= ALERT_PCT within ALERT_H hours). The frontend polls
live.json.

Honest limitations (no free realtime feeds for these):
  - outage history (the model's target channel) is held at BASELINE 0% out -- in calm
    periods that's accurate, and the live weather forecast is what drives a predicted
    spike. This is an early-warning-from-forecast tool, not a nowcast of current outages.
  - statewide grid demand is a constant proxy (training-period mean).
Unlike the Uri backtest, the weather here is a genuine forecast (not observed stand-in).
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import sys

PROJECT = Path.home() / "outage_project"
sys.path.insert(0, str(PROJECT / "stubs"))
from tsfm_public.models.tinytimemixer import TinyTimeMixerForPrediction
import torch

DATA = PROJECT / "data"
MODEL_DIR = PROJECT / "models" / "ttm_outage_v1"
OUT = PROJECT / "frontend_data"
OUT.mkdir(exist_ok=True)

CONTEXT_LEN, PRED_LEN = 512, 96
CONTROL_COLS = ["temp_c", "wind_ms", "gust_ms", "precip_mm", "snow_cm"]
CONDITIONAL_COLS = ["grid_demand_mwh"]
CHANNELS = ["y"] + CONTROL_COLS + CONDITIONAL_COLS
OM_VARS = ["temperature_2m", "wind_speed_10m", "wind_gusts_10m", "precipitation", "snowfall"]
ALERT_PCT, ALERT_H = 10.0, 24      # alert if predicted peak outage >= 10% within 24h
EVENT_PCT, CREW_BUDGET = 2.0, 40
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

scaling = json.loads((MODEL_DIR / "scaling.json").read_text())
stats, Y_MEAN, Y_STD = scaling["stats"], scaling["y_mean"], scaling["y_std"]
mean = {c: stats["mean"][c] for c in CHANNELS}
std = {c: (stats["std"][c] or 1.0) for c in CHANNELS}
NOW_HOUR = pd.Timestamp.now(tz="UTC").tz_localize(None).floor("h")   # current hour, UTC naive
Y_BASELINE = (0.0 - Y_MEAN) / Y_STD                 # log1p(0% out), scaled
DEMAND_PROXY = (mean["grid_demand_mwh"] - mean["grid_demand_mwh"]) / std["grid_demand_mwh"]  # = 0 (mean)

counties = pd.read_csv(DATA / "cache" / "counties_tx.csv", dtype={"fips": str})
cust = dict(zip(counties["fips"], counties["customers"]))
cname = dict(zip(counties["fips"], counties["name"]))
model = TinyTimeMixerForPrediction.from_pretrained(MODEL_DIR / "model").eval()


def fetch_windows(row):
    """Return (past (512,7), future (96,7)) scaled, or None on failure."""
    params = dict(latitude=row.lat, longitude=row.lon, hourly=",".join(OM_VARS),
                  wind_speed_unit="ms", timezone="UTC", past_days=23, forecast_days=5)
    for attempt in range(4):
        try:
            r = requests.get(FORECAST_URL, params=params, timeout=60)
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1)); continue
            r.raise_for_status()
            h = r.json()["hourly"]
            break
        except Exception:
            if attempt == 3:
                return None
            time.sleep(3 * (attempt + 1))
    times = pd.to_datetime(h["time"])
    now = NOW_HOUR
    idx = int(np.searchsorted(times.values, np.datetime64(now)))
    if idx < CONTEXT_LEN or idx + PRED_LEN > len(times):
        idx = min(max(idx, CONTEXT_LEN), len(times) - PRED_LEN)
    wx = {om: np.asarray(h[om], dtype=np.float32) for om in OM_VARS}

    def build(a, b):
        m = np.empty((b - a, len(CHANNELS)), dtype=np.float32)
        m[:, 0] = Y_BASELINE
        for j, (col, om) in enumerate(zip(CONTROL_COLS, OM_VARS), start=1):
            v = wx[om][a:b]
            v = np.nan_to_num(v, nan=mean[col])
            m[:, j] = (v - mean[col]) / std[col]
        m[:, 6] = DEMAND_PROXY
        return m

    return build(idx - CONTEXT_LEN, idx), build(idx, idx + PRED_LEN), now


@torch.no_grad()
def predict(windows):
    out = []
    for i in range(0, len(windows), 128):
        b = windows[i:i + 128]
        pv = torch.from_numpy(np.stack([w[0] for w in b]))
        fv = torch.from_numpy(np.stack([w[1] for w in b]))
        p = model(past_values=pv, future_values=fv).prediction_outputs[..., 0].cpu().numpy()
        out.append(np.clip(np.expm1(p * Y_STD + Y_MEAN), 0, 100))
    return np.concatenate(out, 0)


fips_order, wins, issue_time = [], [], None
for row in counties.itertuples():
    res = fetch_windows(row)
    if res is None:
        continue
    pv, fv, issue_time = res
    fips_order.append(row.fips); wins.append((pv, fv))
    time.sleep(0.25)
print(f"fetched {len(fips_order)}/{len(counties)} counties | issue {issue_time}")

pred = predict(wins)
p6 = pred[:, :6].max(1); p24 = pred[:, :24].max(1); p96 = pred[:, :96].max(1)
harm_raw = (p24 / 100.0) * np.array([cust[f] for f in fips_order])
eligible = p24 >= EVENT_PCT
crews = np.zeros(len(fips_order), int)
tot = harm_raw[eligible].sum()
if tot > 0:
    crews = np.floor(CREW_BUDGET * harm_raw / tot).astype(int); crews[~eligible] = 0
    left = CREW_BUDGET - crews.sum()
    for i in np.argsort(-harm_raw):
        if left <= 0: break
        if eligible[i]: crews[i] += 1; left -= 1
hmax = harm_raw.max() or 1.0
order = np.argsort(-harm_raw); rank = np.empty(len(fips_order), int); rank[order] = np.arange(1, len(fips_order) + 1)

rows = [dict(fips=fips_order[i], pred_pct_6h=round(float(p6[i]), 1),
             pred_pct_24h=round(float(p24[i]), 1), pred_pct_96h=round(float(p96[i]), 1),
             harm_score=round(float(harm_raw[i] / hmax), 3), rank=int(rank[i]),
             assigned_crews=int(crews[i])) for i in range(len(fips_order))]
alerts = sorted([dict(fips=r["fips"], name=cname[r["fips"]], pred_pct_24h=r["pred_pct_24h"],
                      pred_pct_96h=r["pred_pct_96h"], rank=r["rank"])
                 for r in rows if r["pred_pct_24h"] >= ALERT_PCT],
                key=lambda a: -a["pred_pct_24h"])

live = dict(generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            issue_time=issue_time.strftime("%Y-%m-%dT%H:%M"),
            source="Open-Meteo live forecast", alert_threshold_pct=ALERT_PCT, alert_horizon_h=ALERT_H,
            note="Outage history assumed baseline; statewide demand is a proxy. Weather is a live forecast.",
            counties=rows, alerts=alerts)
(OUT / "live.json").write_text(json.dumps(live))
print(f"live.json written | {len(alerts)} alerts >= {ALERT_PCT}% / {ALERT_H}h"
      + (": " + ", ".join(f"{a['name']} {a['pred_pct_24h']}%" for a in alerts[:5]) if alerts else ""))
