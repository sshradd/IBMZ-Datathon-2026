"""Build the Texas county reference table: fips, name, centroid lat/lon, customers.

Sources:
  - Census 2020 gazetteer (county centroids INTPTLAT/INTPTLONG), filtered to TX.
  - EAGLE-I MCC.csv (modeled customers per county) -> denominator for pct_out.
Writes data/cache/counties_tx.csv.
"""
import io
import zipfile
from pathlib import Path

import pandas as pd

DATA = Path.home() / "outage_project" / "data"
CACHE = DATA / "cache"

# --- county centroids from the Census gazetteer zip (no unzip binary on the VM) ---
with zipfile.ZipFile(CACHE / "gaz_counties.zip") as z:
    name = [n for n in z.namelist() if n.endswith(".txt")][0]
    raw = z.read(name).decode("latin-1")
gaz = pd.read_csv(io.StringIO(raw), sep="\t", dtype={"GEOID": str})
gaz.columns = [c.strip() for c in gaz.columns]
tx = gaz[gaz["USPS"] == "TX"].copy()
tx["fips"] = tx["GEOID"].str.zfill(5)
tx = tx.rename(columns={"NAME": "name", "INTPTLAT": "lat", "INTPTLONG": "lon"})
tx["lat"] = tx["lat"].astype(float)
tx["lon"] = tx["lon"].astype(float)
tx = tx[["fips", "name", "lat", "lon"]].reset_index(drop=True)

# --- customers per county (denominator) from MCC.csv ---
mcc = pd.read_csv(DATA / "raw" / "MCC.csv", encoding="utf-8-sig")
mcc.columns = [c.strip() for c in mcc.columns]
mcc["fips"] = mcc["County_FIPS"].astype(str).str.zfill(5)
mcc = mcc[["fips", "Customers"]].rename(columns={"Customers": "customers"})

out = tx.merge(mcc, on="fips", how="left")
n_missing = int(out["customers"].isna().sum())
print(f"TX counties: {len(out)} | centroid range lat[{out.lat.min():.2f},{out.lat.max():.2f}] "
      f"lon[{out.lon.min():.2f},{out.lon.max():.2f}] | missing customers: {n_missing}")
if n_missing:
    print("  counties missing MCC customers:", out[out.customers.isna()].fips.tolist())
out.to_csv(CACHE / "counties_tx.csv", index=False)
print("wrote", CACHE / "counties_tx.csv")
print(out.head().to_string(index=False))
