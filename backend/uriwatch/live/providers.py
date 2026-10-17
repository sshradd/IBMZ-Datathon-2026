"""Thin, defensive HTTP clients for the three public sources."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from . import config


def get_json(url: str, timeout: float = 25.0, retries: int = 2):
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": config.UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{url.split('?')[0]}: {last}")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def fetch_weather() -> dict[str, dict]:
    """One request for all stations. Returns {station: {"time": [...], "<var>": [...]}}."""
    names = list(config.STATIONS)
    q = urllib.parse.urlencode(
        {
            "latitude": ",".join(str(config.STATIONS[n][0]) for n in names),
            "longitude": ",".join(str(config.STATIONS[n][1]) for n in names),
            "hourly": config.WEATHER_VARS,
            "past_hours": 72,
            "forecast_hours": 24,
            "timezone": "UTC",
        }
    )
    data = get_json(f"{config.OPEN_METEO}?{q}")
    if isinstance(data, dict):
        data = [data]
    if len(data) != len(names):
        raise RuntimeError(f"open-meteo returned {len(data)} locations, expected {len(names)}")
    return {n: d["hourly"] for n, d in zip(names, data)}


def fetch_ercot() -> dict:
    return {
        "supply_demand": get_json(config.ERCOT_SUPPLY_DEMAND),
        "fuel_mix": get_json(config.ERCOT_FUEL_MIX),
    }


def fetch_alerts() -> dict:
    return get_json(config.NWS_ALERTS)
