"""Fetch the public Texas grid, outage and weather data used by Uri Watch.

Everything is streamed and filtered to Texas / ERCOT while downloading, so only
small files land in data/raw/. Safe to re-run: finished files are skipped.

Sources (all public, no login; see RESOURCES.md):
  EAGLE-I outages   https://figshare.com/articles/dataset/24237376   (CC BY 4.0)
  EIA grid monitor  https://www.eia.gov/electricity/gridmonitor/
  Open-Meteo        https://open-meteo.com/en/docs/historical-weather-api

Usage:  python scripts/fetch_data.py [eaglei|eia|weather|all]
"""

from __future__ import annotations

import concurrent.futures as cf
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
YEARS = [2019, 2020, 2021, 2022, 2023]
UA = {"User-Agent": "uri-watch-datathon/0.1 (student project)"}

EAGLEI = {  # figshare file ids, article 24237376
    2019: 42547885,
    2020: 42547894,
    2021: 42547891,
    2022: 42547897,
    2023: 44574907,
}
EAGLEI_SMALL = {"DQI.csv": 42547705, "MCC.csv": 42547708, "coverage_history.csv": 42547714}

# Texas weather stations, one per major region (lat, lon).
STATIONS = {
    "dallas": (32.78, -96.80),
    "houston": (29.76, -95.37),
    "austin": (30.27, -97.74),
    "san_antonio": (29.42, -98.49),
    "el_paso": (31.76, -106.49),
    "lubbock": (33.58, -101.86),
    "amarillo": (35.22, -101.83),
    "corpus_christi": (27.80, -97.40),
    "midland": (31.99, -102.08),
    "tyler": (32.35, -95.30),
    "mcallen": (26.20, -98.23),
    "abilene": (32.45, -99.73),
}


def _open(url: str, retries: int = 6):
    for attempt in range(retries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} for {url[:90]}: {e}", flush=True)
            # Open-Meteo's free tier rate-limits per minute, so wait a full minute on 429.
            wait = 65 if isinstance(e, urllib.error.HTTPError) and e.code == 429 else 3 * (attempt + 1)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def fetch_eaglei_year(year: int) -> str:
    out = RAW / f"eaglei_tx_{year}.csv"
    if out.exists() and out.stat().st_size > 1000:
        return f"{year}: have {out.stat().st_size / 1e6:.1f} MB"
    url = f"https://ndownloader.figshare.com/files/{EAGLEI[year]}"
    tmp = out.with_suffix(".part")
    kept = total = 0
    t0 = time.time()
    with _open(url) as resp, open(tmp, "w", newline="") as fh:
        text = io.TextIOWrapper(resp, encoding="utf-8", newline="")
        header = text.readline()
        fh.write(header)
        for line in text:
            total += 1
            if ",Texas," in line:
                fh.write(line)
                kept += 1
    tmp.replace(out)
    return f"{year}: kept {kept:,} of {total:,} rows in {time.time() - t0:.0f}s"


def fetch_eaglei() -> None:
    for name, fid in EAGLEI_SMALL.items():
        dst = RAW / name
        if not dst.exists():
            with _open(f"https://ndownloader.figshare.com/files/{fid}") as r:
                dst.write_bytes(r.read())
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        for msg in ex.map(fetch_eaglei_year, YEARS):
            print(msg, flush=True)


def fetch_eia_file(kind: str, year: int, half: str) -> str:
    out = RAW / f"eia930_{kind.lower()}_erco_{year}_{half}.csv"
    if out.exists() and out.stat().st_size > 1000:
        return f"{out.name}: have"
    url = f"https://www.eia.gov/electricity/gridmonitor/sixMonthFiles/EIA930_{kind}_{year}_{half}.csv"
    tmp = out.with_suffix(".part")
    kept = 0
    with _open(url) as resp, open(tmp, "w", newline="") as fh:
        text = io.TextIOWrapper(resp, encoding="utf-8-sig", newline="")
        fh.write(text.readline())
        for line in text:
            if line.startswith('"ERCO"') or line.startswith("ERCO,"):
                fh.write(line)
                kept += 1
    tmp.replace(out)
    return f"{out.name}: kept {kept:,} ERCOT rows"


def fetch_eia() -> None:
    jobs = [(k, y, h) for k in ("BALANCE", "SUBREGION") for y in YEARS for h in ("Jan_Jun", "Jul_Dec")]
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        for msg in ex.map(lambda a: fetch_eia_file(*a), jobs):
            print(msg, flush=True)


def fetch_weather() -> None:
    hourly = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,snowfall,wind_speed_10m,cloud_cover"
    for name, (lat, lon) in STATIONS.items():
        out = RAW / f"weather_{name}.json"
        if out.exists() and out.stat().st_size > 1000:
            print(f"weather {name}: have", flush=True)
            continue
        q = urllib.parse.urlencode(
            {
                "latitude": lat,
                "longitude": lon,
                "start_date": f"{YEARS[0]}-01-01",
                "end_date": f"{YEARS[-1]}-12-31",
                "hourly": hourly,
                "timezone": "UTC",
            }
        )
        with _open(f"https://archive-api.open-meteo.com/v1/archive?{q}") as r:
            data = json.load(r)
        out.write_text(json.dumps(data))
        print(f"weather {name}: {len(data['hourly']['time']):,} hours", flush=True)
        time.sleep(2)


GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip"
AGE_CSV = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/counties/asrh/cc-est2023-agesex-all.csv"


def fetch_census() -> None:
    """County centroids (map + weather matching) and 65+ population (vulnerability weighting)."""
    import zipfile

    gz = RAW / "gazetteer_counties_2023.txt"
    if not gz.exists():
        with _open(GAZETTEER) as r:
            blob = r.read()
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = next(n for n in z.namelist() if n.endswith(".txt"))
            gz.write_bytes(z.read(name))
        print(f"gazetteer: {gz.stat().st_size / 1e3:.0f} KB", flush=True)


def fetch_age() -> None:
    """Census population estimates by county; keep Texas rows (STATE == 48). Needs approval."""
    out = RAW / "census_tx_age_2023.csv"
    if out.exists():
        return
    with _open(AGE_CSV) as resp, open(out, "w", newline="") as fh:
        text = io.TextIOWrapper(resp, encoding="latin-1", newline="")
        fh.write(text.readline())
        kept = 0
        for line in text:
            if line.split(",", 2)[1] in ("48", "048"):
                fh.write(line)
                kept += 1
    print(f"census age: kept {kept} Texas county-year rows", flush=True)


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("census", "all"):
        fetch_census()
    if what == "age":
        fetch_age()
    if what in ("weather", "all"):
        fetch_weather()
    if what in ("eia", "all"):
        fetch_eia()
    if what in ("eaglei", "all"):
        fetch_eaglei()
    print("done", flush=True)


if __name__ == "__main__":
    main()
