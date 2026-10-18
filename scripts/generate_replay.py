"""Generate the frontend JSON: counties.json, replay.json, briefing.json.

Loads the fine-tuned TTM, runs 96h forecasts at 6-hourly issue-times across the
Winter Storm Uri window for all 254 Texas counties, then derives a harm score and
a greedy crew-dispatch allocation. All inference is manual sliding-window (we
control the fips/timestamp mapping), using the exact channel order and scaling
stats the model was trained with (from scaling.json).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch

PROJECT = Path.home() / "outage_project"
sys.path.insert(0, str(PROJECT / "stubs"))  # datasets stub (s390x, no pyarrow)
from tsfm_public.models.tinytimemixer import TinyTimeMixerForPrediction

DATA = PROJECT / "data"
MODEL_DIR = PROJECT / "models" / "ttm_outage_v1"
OUT = PROJECT / "frontend_data"
OUT.mkdir(exist_ok=True)

CONTEXT_LEN, PRED_LEN = 512, 96
ID_COL, TIME_COL, TARGET = "fips", "timestamp", "pct_out"
CONTROL_COLS = ["temp_c", "wind_ms", "gust_ms", "precip_mm", "snow_cm"]
CONDITIONAL_COLS = ["grid_demand_mwh"]
CHANNELS = ["y"] + CONTROL_COLS + CONDITIONAL_COLS       # channel order 0..6 (y is target, idx 0)

EVENT_PCT = 2.0            # "serious outage" threshold
CREW_BUDGET = 40          # statewide crews to allocate per issue-time
ISSUE_START, ISSUE_END, ISSUE_EVERY_H = "2021-02-11 00:00", "2021-02-18 00:00", 6

# --- scaling stats saved at training time (identical transform) ---
scaling = json.loads((MODEL_DIR / "scaling.json").read_text())
stats = scaling["stats"]          # {"mean": {col: v}, "std": {col: v}}
Y_MEAN, Y_STD = scaling["y_mean"], scaling["y_std"]
mean = {c: stats["mean"][c] for c in CHANNELS}
std = {c: (stats["std"][c] or 1.0) for c in CHANNELS}

# --- counties + model ---
counties = pd.read_csv(DATA / "cache" / "counties_tx.csv", dtype={"fips": str})
cust = dict(zip(counties["fips"], counties["customers"]))
name = dict(zip(counties["fips"], counties["name"]))
counties_json = [dict(fips=r.fips, name=r.name, lat=round(float(r.lat), 4),
                      lon=round(float(r.lon), 4), customers=int(r.customers))
                 for r in counties.itertuples()]
(OUT / "counties.json").write_text(json.dumps(counties_json))
print(f"counties.json: {len(counties_json)} counties")

model = TinyTimeMixerForPrediction.from_pretrained(MODEL_DIR / "model")
model.eval()

# --- load table, build per-county scaled channel matrices ---
df = pd.read_csv(DATA / "county_hourly.csv", dtype={ID_COL: str}, parse_dates=[TIME_COL])
df = df.sort_values([ID_COL, TIME_COL]).reset_index(drop=True)
df["y"] = np.log1p(df[TARGET].clip(lower=0))
ts_index = np.sort(df[TIME_COL].unique())
pos = {pd.Timestamp(t): i for i, t in enumerate(ts_index)}

scaled = {}      # fips -> (T, 7) float32 scaled channels
raw_pct = {}     # fips -> (T,) real pct_out (for truth, not needed downstream)
for fips, g in df.groupby(ID_COL):
    g = g.set_index(TIME_COL).reindex(ts_index)
    mat = np.empty((len(ts_index), len(CHANNELS)), dtype=np.float32)
    for j, c in enumerate(CHANNELS):
        mat[:, j] = ((g[c].to_numpy() - mean[c]) / std[c]).astype(np.float32)
    scaled[fips] = mat
    raw_pct[fips] = g[TARGET].to_numpy()

issue_times = pd.date_range(ISSUE_START, ISSUE_END, freq=f"{ISSUE_EVERY_H}h")
issue_times = [t for t in issue_times if t in pos and pos[t] >= CONTEXT_LEN
               and pos[t] + PRED_LEN <= len(ts_index)]
fips_order = counties["fips"].tolist()
print(f"forecasting {len(issue_times)} issue-times x {len(fips_order)} counties "
      f"= {len(issue_times) * len(fips_order)} windows")


@torch.no_grad()
def forecast_pct(windows):
    """windows: list of (past (512,7), future (96,7)) -> array (n,96) predicted pct_out."""
    out = []
    B = 128
    for i in range(0, len(windows), B):
        batch = windows[i:i + B]
        pv = torch.from_numpy(np.stack([w[0] for w in batch]))
        fv = torch.from_numpy(np.stack([w[1] for w in batch]))
        pred = model(past_values=pv, future_values=fv).prediction_outputs  # (b,96,n_targets)
        p = pred[..., 0].cpu().numpy()
        out.append(np.clip(np.expm1(p * Y_STD + Y_MEAN), 0, 100))
    return np.concatenate(out, axis=0)


frames = {}
for t in issue_times:
    k = pos[t]
    wins = [(scaled[f][k - CONTEXT_LEN:k], scaled[f][k:k + PRED_LEN]) for f in fips_order]
    pred = forecast_pct(wins)                                   # (n_counties, 96)
    p6 = pred[:, :6].max(1); p24 = pred[:, :24].max(1); p96 = pred[:, :96].max(1)
    harm_raw = (p24 / 100.0) * np.array([cust[f] for f in fips_order])   # predicted customers out
    # greedy dispatch: crews ~ harm share, only to counties above the event threshold
    eligible = p24 >= EVENT_PCT
    crews = np.zeros(len(fips_order), dtype=int)
    tot = harm_raw[eligible].sum()
    if tot > 0:
        alloc = np.floor(CREW_BUDGET * harm_raw / tot).astype(int)
        alloc[~eligible] = 0
        left = CREW_BUDGET - alloc.sum()
        for idx in np.argsort(-harm_raw):             # hand out the remainder by harm
            if left <= 0:
                break
            if eligible[idx]:
                alloc[idx] += 1; left -= 1
        crews = alloc
    hmax = harm_raw.max() or 1.0
    order = np.argsort(-harm_raw)
    rank = np.empty(len(fips_order), dtype=int); rank[order] = np.arange(1, len(fips_order) + 1)
    frames[t.strftime("%Y-%m-%dT%H:%M")] = [
        dict(fips=fips_order[i], pred_pct_6h=round(float(p6[i]), 1),
             pred_pct_24h=round(float(p24[i]), 1), pred_pct_96h=round(float(p96[i]), 1),
             harm_score=round(float(harm_raw[i] / hmax), 3), rank=int(rank[i]),
             assigned_crews=int(crews[i]))
        for i in range(len(fips_order))]

replay = {"timestamps": [t.strftime("%Y-%m-%dT%H:%M") for t in issue_times], "frames": frames}
(OUT / "replay.json").write_text(json.dumps(replay))
print(f"replay.json: {len(frames)} frames")

# --- briefing text per issue-time (rule-based; Granite Nano can replace later) ---
briefing = {}
for ts, rows in frames.items():
    rows_sorted = sorted(rows, key=lambda r: r["rank"])
    serious = [r for r in rows_sorted if r["pred_pct_24h"] >= EVENT_PCT]
    top = rows_sorted[:3]
    total_out = int(sum((r["pred_pct_24h"] / 100.0) * cust[r["fips"]] for r in serious))
    total_crews = sum(r["assigned_crews"] for r in rows)
    date = pd.Timestamp(ts)
    top_txt = ", ".join(
        f"{name[r['fips']]} ({r['pred_pct_24h']:.1f}%, ~{int((r['pred_pct_24h'] / 100) * cust[r['fips']]):,} out)"
        for r in top)
    briefing[ts] = (
        f"URI WATCH {date:%b %d %H:%M}Z: {len(serious)} TX counties forecast over "
        f"{EVENT_PCT:.0f}% outages in next 24h. Worst: {top_txt}. "
        f"~{total_out:,} customers at risk; {total_crews} crews prioritized to top-ranked counties.")
(OUT / "briefing.json").write_text(json.dumps(briefing))
print(f"briefing.json: {len(briefing)} briefings")
print("\nsample briefing:\n ", list(briefing.values())[len(briefing) // 2])
