"""Roll EAGLE-I 15-minute Texas outages up to hourly pct_out.

Reads the pre-filtered data/cache/tx_outages_<year>.csv files, takes the peak
customers_out within each hour per county, and converts to a percentage using the
MCC customer counts. Writes data/cache/outages_hourly.csv (fips, timestamp, pct_out)
for the county-hours that have data; the full hourly grid is filled during assembly.
"""
from pathlib import Path

import pandas as pd

DATA = Path.home() / "outage_project" / "data"
CACHE = DATA / "cache"
YEARS = [2020, 2021]

cust = pd.read_csv(CACHE / "counties_tx.csv", dtype={"fips": str})[["fips", "customers"]]

frames = []
for y in YEARS:
    df = pd.read_csv(CACHE / f"tx_outages_{y}.csv",
                     usecols=["fips_code", "customers_out", "run_start_time"],
                     dtype={"fips_code": str})
    df["fips"] = df["fips_code"].str.zfill(5)
    df["timestamp"] = pd.to_datetime(df["run_start_time"]).dt.floor("h")
    df["customers_out"] = pd.to_numeric(df["customers_out"], errors="coerce").fillna(0)
    # peak outage within the hour per county
    hourly = df.groupby(["fips", "timestamp"], as_index=False)["customers_out"].max()
    frames.append(hourly)
    print(f"{y}: {len(df):,} 15-min rows -> {len(hourly):,} county-hours")

out = pd.concat(frames, ignore_index=True)
# if a county-hour appears in both years' edges, keep the max
out = out.groupby(["fips", "timestamp"], as_index=False)["customers_out"].max()
out = out.merge(cust, on="fips", how="left")
out["pct_out"] = (out["customers_out"] / out["customers"] * 100).clip(lower=0, upper=100)
out = out[["fips", "timestamp", "pct_out"]].sort_values(["fips", "timestamp"])

out.to_csv(CACHE / "outages_hourly.csv", index=False)
print(f"wrote outages_hourly.csv: {len(out):,} county-hours, "
      f"{out['fips'].nunique()} counties, {out['timestamp'].min()} -> {out['timestamp'].max()}")
print("pct_out describe:\n", out["pct_out"].describe().round(3).to_string())
# Uri sanity: biggest outages in Feb 2021
uri = out[(out.timestamp >= "2021-02-14") & (out.timestamp < "2021-02-20")]
print(f"\nUri window peak pct_out: {uri['pct_out'].max():.1f}% | "
      f"county-hours >2%: {(uri['pct_out'] > 2).sum():,}")
