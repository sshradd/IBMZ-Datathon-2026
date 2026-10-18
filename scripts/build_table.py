"""Assemble the county-by-hour model table: data/county_hourly.csv.

Joins the three cached sources onto a complete (county x hour) grid so every
county has every hour (the notebook's data contract):
  - outages_hourly.csv  -> pct_out      (missing county-hours = 0 outage)
  - cached weather JSON  -> temp_c, wind_ms, gust_ms, precip_mm, snow_cm
  - demand_hourly.csv    -> grid_demand_mwh (statewide, broadcast to all counties)
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path.home() / "outage_project" / "data"
CACHE = DATA / "cache"
WX = CACHE / "weather"

START, END_EXCL = "2020-01-01", "2021-03-01"   # hourly, UTC, [START, END_EXCL)
hours = pd.date_range(START, END_EXCL, freq="h", inclusive="left")
counties = pd.read_csv(CACHE / "counties_tx.csv", dtype={"fips": str})
fips_list = counties["fips"].tolist()
print(f"grid: {len(fips_list)} counties x {len(hours)} hours = {len(fips_list) * len(hours):,} rows")

# --- weather: one cached JSON per county -> long frame ---
wx_frames = []
missing_wx = []
for fips in fips_list:
    p = WX / f"{fips}.json"
    if not p.exists():
        missing_wx.append(fips)
        continue
    h = json.loads(p.read_text())["hourly"]
    wx_frames.append(pd.DataFrame({
        "fips": fips,
        "timestamp": pd.to_datetime(h["time"]),
        "temp_c": h["temperature_2m"],
        "wind_ms": h["wind_speed_10m"],
        "gust_ms": h["wind_gusts_10m"],
        "precip_mm": h["precipitation"],
        "snow_cm": h["snowfall"],
    }))
if missing_wx:
    raise SystemExit(f"weather missing for {len(missing_wx)} counties: {missing_wx[:10]}... "
                     f"wait for fetch_weather.py to finish.")
weather = pd.concat(wx_frames, ignore_index=True)
print(f"weather rows: {len(weather):,}")

# --- full grid, then merge each source ---
grid = pd.MultiIndex.from_product([fips_list, hours], names=["fips", "timestamp"]).to_frame(index=False)

outages = pd.read_csv(CACHE / "outages_hourly.csv", dtype={"fips": str}, parse_dates=["timestamp"])
demand = pd.read_csv(CACHE / "demand_hourly.csv", parse_dates=["timestamp"])

df = (grid
      .merge(weather, on=["fips", "timestamp"], how="left")
      .merge(outages, on=["fips", "timestamp"], how="left")
      .merge(demand, on="timestamp", how="left"))

# fills: no outage record => 0% out; demand gaps (e.g. first UTC hours) => nearest
df["pct_out"] = df["pct_out"].fillna(0.0)
df["grid_demand_mwh"] = df["grid_demand_mwh"].ffill().bfill()
wx_cols = ["temp_c", "wind_ms", "gust_ms", "precip_mm", "snow_cm"]
df[wx_cols] = df.groupby("fips")[wx_cols].transform(lambda s: s.ffill().bfill())

cols = ["fips", "timestamp", "pct_out", "temp_c", "wind_ms", "gust_ms", "precip_mm", "snow_cm", "grid_demand_mwh"]
df = df[cols].sort_values(["fips", "timestamp"]).reset_index(drop=True)

na = df.isna().sum()
print("remaining NaNs per column:\n", na[na > 0].to_string() if na.any() else "  none")
df.to_csv(DATA / "county_hourly.csv", index=False)
print(f"\nwrote county_hourly.csv: {len(df):,} rows, {df.fips.nunique()} counties, "
      f"{df.timestamp.min()} -> {df.timestamp.max()}")
print("pct_out:", df.pct_out.describe().round(3).to_dict())
uri = df[(df.timestamp >= "2021-02-14") & (df.timestamp < "2021-02-20")]
print(f"Uri window: peak pct_out {uri.pct_out.max():.1f}%, "
      f"min temp {uri.temp_c.min():.1f}C, county-hours >2% = {(uri.pct_out > 2).sum():,}")
