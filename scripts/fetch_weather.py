"""Fetch Open-Meteo ERA5 archive hourly weather for each Texas county centroid.

Open-Meteo archive API (ERA5), CC BY 4.0. One call per county, cached to
data/cache/weather/<fips>.json so the job is resumable. Units chosen to match the
data contract: temp_c (C), wind_ms / gust_ms (m/s), precip_mm (mm), snow_cm (cm).
"""
import json
import time
from pathlib import Path

import pandas as pd
import requests

DATA = Path.home() / "outage_project" / "data"
CACHE = DATA / "cache"
WX = CACHE / "weather"
WX.mkdir(parents=True, exist_ok=True)

START, END = "2020-01-01", "2021-02-28"
HOURLY = "temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,snowfall"
URL = "https://archive-api.open-meteo.com/v1/archive"

counties = pd.read_csv(CACHE / "counties_tx.csv", dtype={"fips": str})
print(f"{len(counties)} counties; range {START}..{END}")

done = fail = skip = 0
for i, row in counties.iterrows():
    fips = row["fips"]
    out = WX / f"{fips}.json"
    if out.exists() and out.stat().st_size > 1000:
        skip += 1
        continue
    params = dict(latitude=row["lat"], longitude=row["lon"], start_date=START,
                  end_date=END, hourly=HOURLY, wind_speed_unit="ms", timezone="UTC")
    for attempt in range(5):
        try:
            r = requests.get(URL, params=params, timeout=90)
            if r.status_code == 429:           # rate limited: back off
                time.sleep(15 * (attempt + 1))
                continue
            r.raise_for_status()
            j = r.json()
            assert "hourly" in j and "time" in j["hourly"], "no hourly data"
            out.write_text(json.dumps(j))
            done += 1
            break
        except Exception as e:
            if attempt == 4:
                fail += 1
                print(f"FAIL {fips} ({row['name']}): {e}")
            else:
                time.sleep(5 * (attempt + 1))
    time.sleep(0.5)                            # be polite to the free API
    if (done + fail) % 25 == 0 and (done + fail) > 0:
        print(f"  progress: fetched={done} failed={fail} cached={skip} / {len(counties)}")

print(f"DONE weather: fetched={done} failed={fail} already_cached={skip} total={len(counties)}")
