"""Live mode, tested offline: the public APIs are replaced with fixtures."""

import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from uriwatch.api import app
from uriwatch.features import FEATURES, IDX
from uriwatch.live import config, features as lf, providers
from uriwatch.live.session import LiveSession

NOW = datetime.now(timezone.utc)


def weather_payload(temp_c=20.0, precip=0.0):
    times, series = [], {k: [] for k in ("temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation", "snowfall", "wind_speed_10m", "cloud_cover")}
    start = NOW.replace(minute=0, second=0, microsecond=0) - timedelta(hours=72)
    for h in range(97):
        times.append((start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00"))
        series["temperature_2m"].append(temp_c)
        series["apparent_temperature"].append(temp_c - 3)
        series["relative_humidity_2m"].append(70)
        series["precipitation"].append(precip)
        series["snowfall"].append(0.0)
        series["wind_speed_10m"].append(12.0)
        series["cloud_cover"].append(50)
    return {n: {"time": times, **series} for n in config.STATIONS}


def ts(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S+0000")


def ercot_payload(demand=47000.0, gen=47500.0, wind=4000.0):
    base = NOW.replace(second=0, microsecond=0, minute=(NOW.minute // 5) * 5)
    rows, fuel = [], {}
    for k in range(60):
        t = base - timedelta(minutes=5 * k)
        rows.append({"demand": demand, "forecast": 0, "timestamp": ts(t)})
        fuel.setdefault(t.strftime("%Y-%m-%d"), {})[ts(t)] = {
            "Natural Gas": {"gen": gen - wind - 6000}, "Wind": {"gen": wind}, "Nuclear": {"gen": 5000}, "Solar": {"gen": 1000},
        }
    # ERCOT lists hour-ending forecasts for hours that have not started, never the current one.
    nxt = NOW.replace(minute=0, second=0, microsecond=0) + timedelta(hours=2)
    fc = [{"timestamp": ts(nxt + timedelta(hours=j)), "forecastedDemand": 46000 + 100 * j} for j in range(24)]
    return {"supply_demand": {"data": rows, "forecast": fc}, "fuel_mix": {"data": fuel}}


def alerts_payload():
    return {
        "updated": "now",
        "features": [
            {"properties": {"event": "Winter Storm Warning", "severity": "Severe", "headline": "h", "geocode": {"SAME": ["048113", "048201", "012001"]}}},
            {"properties": {"event": "Rip Current Statement", "severity": "Moderate", "headline": "x", "geocode": {"SAME": ["048007"]}}},
        ],
    }


@pytest.fixture()
def feeds(monkeypatch, tmp_path):
    state = {"temp": 20.0, "precip": 0.0}
    monkeypatch.setattr(providers, "fetch_weather", lambda: weather_payload(state["temp"], state["precip"]))
    monkeypatch.setattr(providers, "fetch_ercot", lambda: ercot_payload())
    monkeypatch.setattr(providers, "fetch_alerts", alerts_payload)
    monkeypatch.setattr(lf, "CACHE_DIR", tmp_path)
    return state


def test_station_features_follow_the_training_definitions():
    w = weather_payload(temp_c=-5.0, precip=1.0)["dallas"]
    k = lf.current_index(w["time"], NOW)
    f = lf.station_features(w, k)
    assert f["cold_deg"] == pytest.approx(9.0) and f["heat_deg"] == 0.0
    assert f["precip_6h"] == pytest.approx(6.0)  # six hours of 1 mm
    assert f["ice_index"] == pytest.approx(6.0)  # at or below freezing
    assert f["temp_drop_24h"] == 0.0


def test_alert_summary_maps_same_codes_to_texas_counties():
    s = lf.summarize_alerts(alerts_payload())
    assert s["count"] == 2
    assert s["by_fips"]["48113"] == ["Winter Storm Warning"]
    assert "48007" not in s["by_fips"]  # rip current is not grid-relevant
    assert "12001" not in s["by_fips"]  # not Texas


def test_grid_history_builds_features_from_the_ercot_payload(feeds):
    g = lf.GridHistory().ingest(ercot_payload())
    assert g["demand"] == pytest.approx(47000.0)
    assert 0 < g["grid_wind_share"] < 0.2
    assert g["grid_gen_drop_24h"] <= 0.0
    assert g["grid_fc_err"] == 0.0 and not g["has_forecast_for_now"]  # ERCOT only publishes future hours
    assert g["upcoming_forecast"]


def test_live_step_scores_every_county_with_no_outage_inputs(feeds):
    s = LiveSession()
    res = s.step()
    assert res["live"] and len(res["counties"]) == 254
    assert all(c[2] == 0 for c in res["counties"])  # no outage feed
    assert [x["ok"] for x in res["sources"]] == [True, True, True]
    assert res["alerts"]["by_fips"]["48113"] == ["Winter Storm Warning"]
    # the live model never reads the outage features
    assert all(v == 0.0 for v in s.engine.last_x[0][: IDX["log_out_max6h"] + 1])


def test_live_forecast_reacts_to_a_hard_freeze(feeds):
    calm = LiveSession().step()
    feeds["temp"], feeds["precip"] = -14.0, 2.5
    storm = LiveSession().step()
    assert storm["predict"]["expected_onsets"][2] > calm["predict"]["expected_onsets"][2]
    assert storm["tier_counts"][1] + storm["tier_counts"][2] + storm["tier_counts"][3] > 0


def test_one_failing_feed_keeps_serving_the_last_good_copy(feeds, monkeypatch):
    s = LiveSession()
    s.step()
    s.ercot.fetch = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
    s.ercot.fetched_at = 0  # force a refetch
    res = s.step()
    ercot = next(x for x in res["sources"] if x["name"] == "ercot")
    assert not ercot["ok"] and ercot["stale"] and "boom" in ercot["error"]


def test_live_api_endpoints(feeds):
    with TestClient(app) as c:
        assert c.get("/api/live/forecast").status_code == 409  # not started yet
        assert c.post("/api/replay/start", json={"scenario": "live"}).status_code == 200
        for _ in range(50):
            if c.get("/api/live/status").json()["polls"] >= 1:
                break
            time.sleep(0.1)
        st = c.get("/api/live/status").json()
        assert st["running"] and st["polls"] >= 1 and st["outage_feed"] is False
        fc = c.get("/api/live/forecast").json()
        assert len(fc["counties"]) == 254 and {"p6", "p12", "p24", "tier", "window"} <= set(fc["counties"][0])
        assert c.get("/api/live/forecast?min_tier=bogus").status_code == 422
        assert c.get("/api/live/grid").json()["grid"]["demand"] > 0
        assert c.get("/api/live/alerts").json()["count"] == 2
        assert "deployments" in c.get("/api/live/plan?crews=5").json()
        assert c.post("/api/replay/seek", json={"i": 3}).status_code == 409  # a live feed cannot be rewound
        # a what-if must not change the defaults
        assert c.get("/api/live/plan?crews=5").json()["resources"]["crews"] == 5
        assert c.get("/api/live/plan").json()["resources"]["crews"] == 40
        c.post("/api/replay/pause")
