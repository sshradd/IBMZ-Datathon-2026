"""Extract statewide hourly demand (grid_demand_mwh) from ERCOT native load archives.

The ERCOT column is total system load (MWh). 'Hour Ending' is Central prevailing
time; EAGLE-I outages and Open-Meteo weather are UTC, so convert Central -> UTC.
Writes data/cache/demand_hourly.csv (timestamp, grid_demand_mwh).
"""
import io
import zipfile
from pathlib import Path

import openpyxl
import pandas as pd

RAW = Path.home() / "outage_project" / "data" / "raw"
CACHE = Path.home() / "outage_project" / "data" / "cache"

frames = []
for y in (2020, 2021):
    with zipfile.ZipFile(RAW / f"Native_Load_{y}.zip") as z:
        inner = [n for n in z.namelist() if n.lower().endswith(".xlsx")][0]
        data = z.read(inner)
    ws = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True).active
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    ei = header.index("ERCOT")
    recs = [(r[0], r[ei]) for r in rows if r[0] not in (None, "")]
    frames.append(pd.DataFrame(recs, columns=["hour_ending", "grid_demand_mwh"]))
    print(f"{y}: {len(recs):,} hourly rows")

d = pd.concat(frames, ignore_index=True)
s = d["hour_ending"].astype(str).str.strip()
ts = pd.to_datetime(s, format="%m/%d/%Y %H:%M", errors="coerce")
# ERCOT sometimes writes hour-ending 24:00 -> roll to 00:00 next day
bad = ts.isna()
if bad.any():
    fixed = pd.to_datetime(s[bad].str.replace(" 24:00", " 00:00"),
                           format="%m/%d/%Y %H:%M", errors="coerce") + pd.Timedelta(days=1)
    ts.loc[bad] = fixed
print("unparsed hour_ending rows:", int(ts.isna().sum()))

# hour-ending -> hour-start, then Central -> UTC (tz-naive)
local_start = (ts - pd.Timedelta(hours=1)).dt.tz_localize(
    "US/Central", ambiguous=True, nonexistent="shift_forward")
d["timestamp"] = local_start.dt.tz_convert("UTC").dt.tz_localize(None)
d["grid_demand_mwh"] = pd.to_numeric(d["grid_demand_mwh"], errors="coerce")

out = (d[["timestamp", "grid_demand_mwh"]].dropna()
       .drop_duplicates("timestamp").sort_values("timestamp").reset_index(drop=True))
out.to_csv(CACHE / "demand_hourly.csv", index=False)
print(f"wrote demand_hourly.csv: {len(out):,} hours, {out.timestamp.min()} -> {out.timestamp.max()}")
print(out["grid_demand_mwh"].describe().round(0).to_string())
# Uri sanity: demand should spike then crash during the storm
uri = out[(out.timestamp >= "2021-02-14") & (out.timestamp < "2021-02-20")]
print(f"Uri window demand min/max: {uri.grid_demand_mwh.min():.0f} / {uri.grid_demand_mwh.max():.0f} MWh")
