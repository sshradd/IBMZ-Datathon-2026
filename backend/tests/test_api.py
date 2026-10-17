import time

import pytest
from fastapi.testclient import TestClient

from uriwatch.api import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_health_and_system(client):
    assert client.get("/api/healthz").json() == {"ok": True}
    s = client.get("/api/system").json()
    assert {"machine", "byteorder", "is_ibm_z"} <= set(s)


def test_scenarios_and_counties(client):
    sc = client.get("/api/scenarios").json()
    assert {s["key"] for s in sc} >= {"uri", "elliott"}
    cs = client.get("/api/counties?scenario=uri").json()
    assert len(cs) == 254 and {"fips", "lat", "lon", "pop65", "severe_at"} <= set(cs[0])
    assert client.get("/api/counties?scenario=nope").status_code == 404


def test_models_endpoint_has_honest_metrics(client):
    m = client.get("/api/models").json()
    assert m["honest"]["metrics"]["scenarios"]["uri"]["onsets"] > 100


def test_replay_start_seek_explain(client):
    r = client.post("/api/replay/start", json={"scenario": "uri", "speed": 5})
    assert r.status_code == 200 and r.json()["model"] == "honest"
    client.post("/api/replay/pause")
    st = client.post("/api/replay/seek", json={"i": 150}).json()
    assert st["i"] == 150
    e = client.get("/api/explain/48201")  # Harris County
    assert e.status_code == 200 and 0 <= e.json()["risk"] <= 1
    assert e.json()["p6"] <= e.json()["p12"] <= e.json()["p24"]
    pl = client.post("/api/plan", json={"crews": 10, "centers": 3, "callers": 5})
    assert pl.status_code == 200 and pl.json()["resources"]["crews"] == 10
    assert sum(d["crews"] for d in pl.json()["deployments"]) <= 10
    assert client.post("/api/replay/start", json={"scenario": "nope"}).status_code == 404
