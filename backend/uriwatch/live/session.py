"""A live scoring session: poll the public APIs, build features, score every county.

It has the same surface as a replay Session (engine, step, key, i, n), so the API,
the event stream and the dashboard treat a live run like any other.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from ..engine import Engine
from ..replay import load_bundle, load_model
from . import config, providers
from .features import GridHistory, county_vectors, current_index, nearest_station, outlook, station_features, summarize_alerts


class Source:
    """One upstream feed: cached for its TTL, with a status record for the dashboard."""

    def __init__(self, name: str, fetch) -> None:
        self.name = name
        self.fetch = fetch
        self.data = None
        self.fetched_at = 0.0
        self.ok = False
        self.error: str | None = None
        self.updated: str | None = None
        self.ms = 0

    def get(self, force: bool = False):
        if not force and self.data is not None and time.time() - self.fetched_at < config.TTL[self.name]:
            return self.data, False
        t0 = time.time()
        try:
            self.data = self.fetch()
            self.fetched_at = time.time()
            self.ok, self.error = True, None
            self.updated = providers.now_iso()
        except Exception as e:  # keep serving the last good copy
            self.ok, self.error = False, str(e)[:160]
        self.ms = round((time.time() - t0) * 1000)
        return self.data, True

    def status(self) -> dict:
        return {
            "name": self.name,
            "ok": self.ok,
            "stale": self.data is not None and not self.ok,
            "updated": self.updated,
            "age_s": round(time.time() - self.fetched_at) if self.fetched_at else None,
            "error": self.error,
            "ms": self.ms,
        }


class LiveSession:
    key = "live"

    def __init__(self, model_name: str | None = None) -> None:
        self.model_name = model_name or "live_final"
        counties = [dict(c) for c in load_bundle("uri")["counties"]]  # copies: the replay cache stays untouched
        for c in counties:
            c["station"] = nearest_station(c["lat"], c["lon"])
        self.bundle = {"counties": counties, "hours": [], "title": "Live"}
        self.engine = Engine(load_model(self.model_name), counties)
        self.i = 0
        self.n = 0
        self.history = GridHistory()
        self.weather = Source("weather", providers.fetch_weather)
        self.ercot = Source("ercot", providers.fetch_ercot)
        self.alerts = Source("alerts", providers.fetch_alerts)
        self.latest: dict | None = None
        self.grid: dict | None = None
        self.alert_summary: dict | None = None

    @property
    def done(self) -> bool:
        return False

    def seek(self, i: int) -> None:  # a live feed cannot be rewound
        raise ValueError("live mode cannot seek")

    def step(self) -> dict:
        now = datetime.now(timezone.utc)
        weather, _ = self.weather.get()
        if weather is None:
            raise RuntimeError(f"no weather yet: {self.weather.error}")
        raw, fresh = self.ercot.get()
        if raw is not None and fresh and self.ercot.ok:
            self.grid = self.history.ingest(raw)
            self.history.save()
        grid = self.grid or {
            "demand": 0.0, "forecast": None, "gen": 0.0, "wind": 0.0, "grid_fc_err": 0.0, "grid_demand_norm": 0.0,
            "grid_gen_drop_24h": 0.0, "grid_wind_share": 0.0, "history_hours": 0, "has_forecast_for_now": False,
            "upcoming_forecast": [],
        }
        alerts_raw, fresh_a = self.alerts.get()
        if alerts_raw is not None and (fresh_a or self.alert_summary is None):
            self.alert_summary = summarize_alerts(alerts_raw)

        k_by = {n: current_index(h["time"], now) for n, h in weather.items()}
        sf = {n: station_features(weather[n], k_by[n]) for n in weather}
        hour_utc = int(now.timestamp() // 3600)
        xs = county_vectors(self.bundle["counties"], sf, grid, hour_utc)
        hour = {
            "t": now.strftime("%Y-%m-%dT%H:00Z"),
            "x": xs,
            "out": [0] * len(xs),  # no free live outage feed
            "grid": {"demand": round(grid["demand"]), "forecast": round(grid["forecast"] or grid["demand"]), "gen": round(grid["gen"])},
        }
        res = self.engine.score_hour(hour_utc, hour)
        self.i += 1
        res.update(
            {
                "type": "hour",
                "i": self.i - 1,
                "n": 0,
                "live": True,
                "as_of": providers.now_iso(),
                "sources": [self.weather.status(), self.ercot.status(), self.alerts.status()],
                "alerts": self.alert_summary,
                "outlook": {"temp_f_mean_next_24h": outlook(weather, k_by)},
                "grid_detail": {
                    "has_forecast_for_now": grid["has_forecast_for_now"],
                    "history_hours": grid["history_hours"],
                    "wind_share": round(grid["grid_wind_share"], 3),
                    "upcoming_forecast": grid["upcoming_forecast"][:24],
                },
            }
        )
        self.latest = res
        return res
