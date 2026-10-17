"""Turn raw live payloads into the same features the model was trained on.

Pure Python ports of the training-time transforms in uriwatch/build.py, so a live
county-hour and a historical county-hour mean the same thing.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..features import FEATURES, IDX
from . import config

CACHE_DIR = Path(__file__).resolve().parents[3] / "data" / "live"
KEEP_HOURS = 14 * 24


def _clip(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def current_index(times: list[str], now: datetime) -> int:
    """Index of the latest hourly value at or before `now` (Open-Meteo times are UTC, hour-stamped)."""
    key = now.strftime("%Y-%m-%dT%H:00")
    best = -1
    for i, t in enumerate(times):
        if t <= key:
            best = i
        else:
            break
    return best


def _v(series: list, i: int) -> float:
    if i < 0 or i >= len(series) or series[i] is None:
        return 0.0
    return float(series[i])


def station_features(hourly: dict, k: int) -> dict[str, float]:
    """The weather features at hour index k, from the station's recent hourly series."""
    temp = hourly["temperature_2m"]
    t = _v(temp, k)
    p6 = sum(_v(hourly["precipitation"], j) for j in range(max(0, k - 5), k + 1))
    s6 = sum(_v(hourly["snowfall"], j) for j in range(max(0, k - 5), k + 1))
    return {
        "temp_c": t,
        "apparent_c": _v(hourly["apparent_temperature"], k),
        "cold_deg": max(0.0, 4.0 - t),
        "heat_deg": max(0.0, t - 36.0),
        "temp_drop_24h": _clip(t - _v(temp, k - 24), -25, 25),
        "temp_change_3h": _clip(t - _v(temp, k - 3), -15, 15),
        "wind_kmh": _v(hourly["wind_speed_10m"], k),
        "precip_6h": p6,
        "snow_6h": s6,
        "ice_index": p6 if t <= 1.0 else 0.0,
        "humidity": _v(hourly["relative_humidity_2m"], k),
    }


def outlook(weather: dict[str, dict], k_by_station: dict[str, int], hours: int = 24) -> list[float]:
    """Statewide mean forecast temperature (degrees F) for the next `hours` hours."""
    out = []
    for step in range(1, hours + 1):
        vals = []
        for n, hr in weather.items():
            j = k_by_station[n] + step
            if j < len(hr["temperature_2m"]) and hr["temperature_2m"][j] is not None:
                vals.append(hr["temperature_2m"][j])
        out.append(round(sum(vals) / len(vals) * 9 / 5 + 32, 1) if vals else None)
    return out


# --------------------------------------------------------------------- ERCOT grid


def _parse_ts(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S%z").astimezone(timezone.utc)


def _hour_start(dt: datetime) -> int:
    return int(dt.timestamp() // 3600)


class GridHistory:
    """Hourly demand, generation and ERCOT's own demand forecast, kept on disk across restarts.
    The public feed has no archive, so features that need history (demand versus the forecast
    issued earlier, demand versus the two-week norm) get better as the service keeps running."""

    def __init__(self) -> None:
        self.path = CACHE_DIR / "grid_history.json"
        self.demand: dict[int, float] = {}
        self.gen: dict[int, float] = {}
        self.forecast: dict[int, float] = {}
        try:
            d = json.loads(self.path.read_text())
            self.demand = {int(k): v for k, v in d.get("demand", {}).items()}
            self.gen = {int(k): v for k, v in d.get("gen", {}).items()}
            self.forecast = {int(k): v for k, v in d.get("forecast", {}).items()}
        except (OSError, json.JSONDecodeError):
            pass

    def save(self) -> None:
        cut = _hour_start(datetime.now(timezone.utc)) - KEEP_HOURS
        for dct in (self.demand, self.gen, self.forecast):
            for k in [k for k in dct if k < cut]:
                del dct[k]
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({"demand": self.demand, "gen": self.gen, "forecast": self.forecast}))
        except OSError:
            pass

    def ingest(self, payload: dict) -> dict:
        """Fold a fresh ERCOT payload in and return the current grid state."""
        now_h = _hour_start(datetime.now(timezone.utc))

        # Actual 5-minute demand.
        by_hour: dict[int, list[float]] = {}
        recent: list[float] = []
        for r in payload["supply_demand"]["data"]:
            if r.get("forecast"):
                continue
            h = _hour_start(_parse_ts(r["timestamp"]))
            by_hour.setdefault(h, []).append(r["demand"])
            recent.append(r["demand"])
        for h, vals in by_hour.items():
            if h < now_h:
                self.demand[h] = sum(vals) / len(vals)
        demand_now = sum(recent[-12:]) / max(len(recent[-12:]), 1) if recent else 0.0

        # ERCOT's hourly forecast: timestamps are hour-ending, so store against the hour start.
        for r in payload["supply_demand"].get("forecast", []):
            h = _hour_start(_parse_ts(r["timestamp"])) - 1
            self.forecast[h] = r["forecastedDemand"]
        forecast_now = self.forecast.get(now_h)

        # Generation by fuel.
        gen_by_hour: dict[int, list[float]] = {}
        gen_recent: list[float] = []
        wind_recent: list[float] = []
        for day in payload["fuel_mix"]["data"].values():
            for ts in sorted(day):
                fuels = day[ts]
                total = sum(fuels.get(f, {}).get("gen", 0.0) for f in config.GEN_FUELS)
                gen_by_hour.setdefault(_hour_start(_parse_ts(ts)), []).append(total)
                gen_recent.append(total)
                wind_recent.append(fuels.get("Wind", {}).get("gen", 0.0))
        for h, vals in gen_by_hour.items():
            if h < now_h:
                self.gen[h] = sum(vals) / len(vals)
        gen_now = sum(gen_recent[-12:]) / max(len(gen_recent[-12:]), 1) if gen_recent else 0.0
        wind_now = sum(wind_recent[-12:]) / max(len(wind_recent[-12:]), 1) if wind_recent else 0.0

        hist_dem = list(self.demand.values()) + [demand_now]
        norm = sum(hist_dem) / len(hist_dem)
        recent_gen = [v for h, v in self.gen.items() if h >= now_h - 48] + [gen_now]
        gen_max = max(recent_gen) if recent_gen else gen_now

        have_fc = forecast_now is not None and forecast_now > 0
        return {
            "demand": demand_now,
            "forecast": forecast_now if have_fc else None,
            "gen": gen_now,
            "wind": wind_now,
            "grid_fc_err": _clip((demand_now - forecast_now) / max(forecast_now, 1.0), -0.6, 0.6) if have_fc else 0.0,
            "grid_demand_norm": _clip(demand_now / max(norm, 1.0) - 1.0, -0.6, 0.6),
            "grid_gen_drop_24h": _clip(gen_now / max(gen_max, 1.0) - 1.0, -0.8, 0.0),
            "grid_wind_share": _clip(wind_now / max(gen_now, 1.0), 0.0, 1.0),
            "history_hours": len(self.demand),
            "has_forecast_for_now": have_fc,
            "upcoming_forecast": [
                {"hour": datetime.fromtimestamp(h * 3600, timezone.utc).strftime("%Y-%m-%dT%H:00Z"), "mw": mw}
                for h, mw in sorted(self.forecast.items())
                if h >= now_h
            ][:48],
        }


# ------------------------------------------------------------------- NWS alerts


def summarize_alerts(payload: dict) -> dict:
    """Active NWS alerts grouped by event, plus which counties each one covers."""
    events: dict[str, dict] = {}
    by_fips: dict[str, list[str]] = {}
    for f in payload.get("features", []):
        p = f["properties"]
        name = p.get("event", "")
        relevant = any(k in name.lower() for k in config.RELEVANT)
        e = events.setdefault(
            name, {"event": name, "severity": p.get("severity"), "relevant": relevant, "fips": set(), "headline": p.get("headline")}
        )
        for code in p.get("geocode", {}).get("SAME", []):
            if code.startswith("048"):
                fips = code[1:]
                e["fips"].add(fips)
                if relevant:
                    by_fips.setdefault(fips, [])
                    if name not in by_fips[fips]:
                        by_fips[fips].append(name)
    order = {"Extreme": 0, "Severe": 1, "Moderate": 2, "Minor": 3, "Unknown": 4, None: 4}
    ev = sorted(events.values(), key=lambda e: (not e["relevant"], order.get(e["severity"], 4), -len(e["fips"])))
    return {
        "count": sum(1 for f in payload.get("features", [])),
        "updated": payload.get("updated"),
        "events": [
            {"event": e["event"], "severity": e["severity"], "relevant": e["relevant"], "counties": len(e["fips"]),
             "fips": sorted(e["fips"]) if e["relevant"] else [], "headline": e["headline"]}
            for e in ev[:14]
        ],
        "by_fips": by_fips,
    }


# -------------------------------------------------------------- county vectors


def nearest_station(lat: float, lon: float) -> str:
    def d(n: str) -> float:
        la, lo = config.STATIONS[n]
        p = math.pi / 180
        a = math.sin((la - lat) * p / 2) ** 2 + math.cos(lat * p) * math.cos(la * p) * math.sin((lo - lon) * p / 2) ** 2
        return a

    return min(config.STATIONS, key=d)


def county_vectors(
    counties: list[dict], station_feats: dict[str, dict[str, float]], grid: dict, hour_utc: int
) -> list[list[float]]:
    """One FEATURES-length vector per county. Outage features are left at zero: the live model
    does not use them, and no free live feed carries them."""
    state_cold = sum(sf["cold_deg"] for sf in station_feats.values()) / len(station_feats)
    hour_local = (hour_utc - 6) % 24
    shared = {
        "grid_fc_err": grid["grid_fc_err"],
        "grid_demand_norm": grid["grid_demand_norm"],
        "grid_gen_drop_24h": grid["grid_gen_drop_24h"],
        "grid_wind_share": grid["grid_wind_share"],
        "state_cold_deg": state_cold,
        "hour_sin": math.sin(2 * math.pi * hour_local / 24),
        "hour_cos": math.cos(2 * math.pi * hour_local / 24),
    }
    out = []
    for c in counties:
        v = [0.0] * len(FEATURES)
        for k, val in station_feats[c["station"]].items():
            v[IDX[k]] = val
        for k, val in shared.items():
            v[IDX[k]] = val
        v[IDX["log_pop"]] = math.log(max(c["pop"], 1))
        out.append(v)
    return out
