import math

from uriwatch.engine import Scorecard, explain
from uriwatch.features import FEATURES, HORIZONS, N_FEATURES, severe_threshold
from uriwatch.plan import DEFAULT_RESOURCES, Cand, build_plan
from uriwatch.replay import Session, available, load_bundle, load_model


def test_models_have_three_monotone_heads():
    for name in ("honest", "final"):
        m = load_model(name)
        assert sorted(m.heads) == sorted(HORIZONS)
        assert all(len(w) == N_FEATURES == len(FEATURES) for w, _ in m.heads.values())
        assert m.tiers["watch"] < m.tiers["prepare"] < m.tiers["act"]
        x = [0.0] * N_FEATURES
        p6, p12, p24 = m.risks(x)
        assert 0 < p6 <= p12 <= p24 < 1


def test_inputs_are_clamped_to_training_range():
    m = load_model("honest")
    huge = [1e9] * N_FEATURES
    assert max(m.clamp(huge)) < 1e8
    r = m.risks(huge)
    assert all(0 <= p <= 1 for p in r)


def test_contributions_reconstruct_the_risk():
    m = load_model("honest")
    x = [0.0] * N_FEATURES
    z = m.heads[24][1] + sum(m.contributions(x)) - 0.0
    # Folded and unfolded scoring must agree.
    assert math.isclose(m.risk(x), 1 / (1 + math.exp(-z)), rel_tol=1e-6, abs_tol=1e-9)


def test_replays_exist_and_align():
    assert {"uri", "elliott", "ice2023", "heat2023"} <= set(available())
    b = load_bundle("uri")
    assert len(b["counties"]) == 254
    h = b["hours"][0]
    assert len(h["x"]) == len(h["out"]) == 254 and len(h["x"][0]) == N_FEATURES


def test_hour_result_has_all_four_analytics_lenses():
    s = Session("uri", "honest")
    for _ in range(120):
        res = s.step()
    for key in ("predict", "diagnose", "describe", "prescribe"):
        assert key in res
    row = res["counties"][0]
    assert len(row) == 5 and row[3] <= row[4] <= row[0]  # p6 <= p12 <= p24
    assert len(res["predict"]["expected_onsets"]) == 3
    assert res["predict"]["expected_onsets"][0] <= res["predict"]["expected_onsets"][2]


def test_uri_is_warned_about_before_it_hits():
    """The honest model never trained on Uri; most severe counties should still get an alert first."""
    s = Session("uri", "honest")
    last = None
    while not s.done:
        last = s.step()
    sc = last["describe"]["scorecard"]
    assert sc["onsets"] > 100
    assert sc["warned"] / sc["onsets"] > 0.5
    assert sc["median_lead_h"] >= 1


def test_watchlist_only_has_counties_not_yet_out():
    s = Session("ice2023", "honest")
    for _ in range(100):
        res = s.step()
    sev = {c["fips"]: c["severe_at"] for c in s.bundle["counties"]}
    outs = {c["fips"]: o for c, o in zip(s.bundle["counties"], s.bundle["hours"][99]["out"])}
    for w in res["predict"]["watchlist"]:
        assert outs[w["fips"]] < sev[w["fips"]]
        assert w["tier"] in ("watch", "prepare", "act")
        assert w["p6"] <= w["p12"] <= w["p24"]


def test_explain_gives_readable_reasons():
    s = Session("uri", "honest")
    for _ in range(200):
        s.step()
    reasons = explain(s.engine.model, s.engine.last_x[0])
    assert all(isinstance(r["text"], str) and r["text"] for r in reasons)


def test_severe_threshold_scales_with_population():
    assert severe_threshold(10_000) == 2500
    assert severe_threshold(4_000_000) > 100_000


def test_scorecard_counts_warned_and_missed():
    sc = Scorecard(2)
    for h, (tier, sev) in enumerate([(0, False), (1, False), (1, False), (1, False), (1, False), (2, True)]):
        sc.observe(h, 0, tier, sev)
    for h in range(5):
        sc.observe(h, 1, 0, h >= 3)
    snap = sc.snapshot()
    assert snap["onsets"] == 2 and snap["warned"] == 1 and snap["median_lead_h"] == 4


def _cand(i, name, pop, pop65, p24, tier=2, out=0, severe=False, cold=True):
    return Cand(i=i, fips=f"48{i:03d}", name=name, pop=pop, pop65=pop65, tier=tier, p6=p24 / 3, p12=p24 / 2, p24=p24,
                window=0, out=out, severe=severe, temp_f=20.0, cold=cold, heat=False, ice=False, grid_share=0.1, reasons=[])


def test_planner_beats_population_split_and_respects_budgets():
    cands = [
        _cand(0, "Big", 4_000_000, 450_000, 0.02),
        _cand(1, "Risky", 300_000, 60_000, 0.30, tier=3),
        _cand(2, "Dark", 200_000, 40_000, 0.0, tier=3, out=40_000, severe=True),
        _cand(3, "Quiet", 900_000, 100_000, 0.001, tier=1),
    ]
    plan = build_plan(cands, dict(DEFAULT_RESOURCES), {"severe_frac": 0.0, "stress": False}, None)
    assert sum(d["crews"] for d in plan["deployments"]) <= DEFAULT_RESOURCES["crews"]
    assert sum(d["centers"] for d in plan["deployments"]) <= DEFAULT_RESOURCES["centers"]
    assert plan["coverage"]["crews"] >= plan["naive_coverage"]["crews"]
    dark = next(d for d in plan["deployments"] if d["name"] == "Dark")
    assert dark["status"] == "out" and dark["crews"] >= 1
    assert plan["moves"] and plan["moves"][0]["urgency"] == "act"


def test_more_crews_never_reduce_coverage():
    cands = [_cand(i, f"C{i}", 100_000 * (i + 1), 15_000 * (i + 1), 0.05 * (i + 1) / 3) for i in range(6)]
    state = {"severe_frac": 0.0, "stress": False}
    cov = [build_plan(cands, {"crews": k, "centers": 0, "callers": 0}, state, None)["coverage"]["crews"] for k in (0, 5, 20, 60)]
    assert cov == sorted(cov)
