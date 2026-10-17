import pytest
from fastapi.testclient import TestClient

from uriwatch import ops
from uriwatch.api import app
from uriwatch.replay import Session


@pytest.fixture()
def state(tmp_path):
    s = Session("uri", "honest")
    for _ in range(180):
        s.step()
    return s.engine, ops.OpsState(path=tmp_path / "ops.json")


def test_sample_roster_and_no_default_targets(state):
    _, o = state
    assert len(o.units("line")) == 40 and len(o.units("shelter")) == 15 and len(o.units("outreach")) == 25
    assert all(u["status"] == "available" for u in o.units())
    assert all(v is None for v in o.data["targets"].values())  # the app never guesses what you need


def test_priorities_are_ranked_and_carry_the_nearest_crew(state):
    eng, o = state
    pl = ops.compute(eng, o)
    assert pl["priorities"] and len(pl["priorities"]) <= 60
    top = pl["priorities"][0]
    assert top["nearest"] and top["nearest"]["eta_min"] >= 0
    assert all(p["depart_by_min"] >= 0 for p in pl["priorities"])
    # there is no resource forecast anywhere in the plan
    assert "needed" not in str(pl["totals"]) and "shortfalls" not in pl and "mutual_aid" not in pl


def test_nearest_depot_serves_a_county_first(state):
    eng, o = state
    pl = ops.compute(eng, o)
    dallas = next(p for p in pl["priorities"] if p["county"] == "Dallas")
    assert dallas["nearest"]["depot"] in ("Dallas", "Fort Worth")


def test_dispatch_sends_exactly_what_the_responder_asks_for(state):
    eng, o = state
    pl = ops.compute(eng, o)
    fips = pl["priorities"][0]["fips"]
    out = ops.commit(eng, o, [{"fips": fips, "line": 2, "shelter": 1, "outreach": 0}])
    assert out["dispatched"] == 3 and not out["short"]
    assert len(o.units("line", "en_route")) == 2 and len(o.units("shelter", "en_route")) == 1
    assert "WORK ORDER" in out["work_orders"][0]["text"] and "maps/dir" in out["work_orders"][0]["maps_url"]
    assert o.log and "Sent 3 units" in o.data["log"][-1]["text"]


def test_dispatch_reports_when_fewer_units_are_free_than_asked(state):
    eng, o = state
    fips = ops.compute(eng, o)["priorities"][0]["fips"]
    out = ops.commit(eng, o, [{"fips": fips, "line": 100}])
    assert out["dispatched"] == 40 and out["short"][0]["requested"] == 100 and out["short"][0]["assigned"] == 40
    assert not o.units("line", "available")


def test_inventory_status_uses_only_the_targets_you_set(state):
    eng, o = state
    inv = {i["id"]: i for i in ops.compute(eng, o)["inventory"]["items"]}
    assert inv["transformers"]["status"] is None and inv["transformers"]["have"] == 209
    o.set_target("transformers", 1000)
    inv = {i["id"]: i for i in ops.compute(eng, o)["inventory"]["items"]}
    assert inv["transformers"]["status"] == "short" and inv["transformers"]["below_by"] == 791
    o.set_target("transformers", 100)
    assert {i["id"]: i for i in ops.compute(eng, o)["inventory"]["items"]}["transformers"]["status"] == "ok"
    o.set_target("transformers", None)
    assert o.data["targets"]["transformers"] is None


def test_staging_picks_sites_that_cut_travel_time(state):
    eng, o = state
    st = ops.compute(eng, o)["staging"]
    assert st["sites"] and all(s["saves_min"] >= 0 for s in st["sites"])
    assert st["sites"][0]["avg_eta_min"] <= st["baseline_eta_min"]


def test_sitrep_is_markdown_and_says_the_decisions_are_the_responders(state):
    eng, o = state
    ops.commit(eng, o, [{"fips": ops.compute(eng, o)["priorities"][0]["fips"], "line": 1}])
    md = ops.sitrep(eng, o, ops.compute(eng, o))
    assert md.startswith("# Situation report") and "## Out in the field" in md and "responders' call" in md


def test_ops_api_round_trip(tmp_path):
    with TestClient(app) as c:
        app.state.s.ops = ops.OpsState(path=tmp_path / "ops.json")
        assert c.get("/api/ops/plan").status_code == 409  # no forecast yet
        assert c.get("/api/ops/state").json()["sample"] is True
        c.post("/api/replay/start", json={"scenario": "uri", "speed": 240})
        c.post("/api/replay/pause")
        c.post("/api/replay/seek", json={"i": 150})
        plan = c.get("/api/ops/plan").json()
        assert plan["priorities"] and plan["totals"]["line"]["available"] == 40
        fips = plan["priorities"][0]["fips"]
        d = c.post("/api/ops/dispatch", json={"orders": [{"fips": fips, "line": 2}]}).json()
        assert d["dispatched"] == 2 and d["work_orders"]
        assert c.post("/api/ops/undo", json={}).json()["recalled"] == 2
        assert c.put("/api/ops/units", json={"depot": "dal", "type": "line", "count": 3}).status_code == 200
        assert c.put("/api/ops/units", json={"depot": "nope", "type": "line", "count": 3}).status_code == 404
        assert c.put("/api/ops/inventory", json={"depot": "dal", "item": "poles", "qty": 5}).status_code == 200
        assert c.put("/api/ops/targets", json={"item": "poles", "target": 500}).status_code == 200
        assert c.put("/api/ops/targets", json={"item": "nope", "target": 5}).status_code == 404
        assert c.put("/api/ops/ratios", json={"item": "poles", "value": 3}).status_code in (404, 405)  # planning ratios are gone
        assert "Situation report" in c.get("/api/ops/sitrep").json()["markdown"]
        uid = plan["priorities"] and ops.OpsState(path=tmp_path / "ops.json").units("line")[0]["id"]
        assert c.post(f"/api/ops/units/{uid}/status", json={"status": "on_site"}).json()["status"] == "on_site"
        assert c.post(f"/api/ops/units/{uid}/status", json={"status": "bogus"}).status_code == 422
