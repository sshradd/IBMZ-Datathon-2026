import math

from uriwatch.engine import Engine, Scorecard, explain
from uriwatch.features import FEATURES, N_FEATURES, severe_threshold
from uriwatch.model import LogisticModel
from uriwatch.replay import Session, available, load_bundle, load_model


def test_models_match_feature_list():
    for name in ("honest", "final"):
        m = load_model(name)
        assert len(m.weights) == N_FEATURES == len(FEATURES)
        assert m.tiers["watch"] < m.tiers["prepare"] < m.tiers["act"]


def test_risk_is_a_probability_and_matches_contributions():
    m = load_model("honest")
    x = [0.0] * N_FEATURES
    r = m.risk(x)
    assert 0.0 < r < 1.0
    z = m.bias + sum(m.contributions(x))
    assert math.isclose(r, 1 / (1 + math.exp(-z)), rel_tol=1e-9)


def test_replays_exist_and_align():
    keys = available()
    assert {"uri", "elliott", "ice2023", "heat2023"} <= set(keys)
    b = load_bundle("uri")
    assert len(b["counties"]) == 254
    h = b["hours"][0]
    assert len(h["x"]) == len(h["out"]) == 254 and len(h["x"][0]) == N_FEATURES


def test_uri_is_warned_about_before_it_hits():
    """The honest model never trained on Uri; most severe counties should still get a watch first."""
    s = Session("uri", "honest")
    last = None
    while not s.done:
        last = s.step()
    sc = last["scorecard"]
    assert sc["onsets"] > 100
    assert sc["warned"] / sc["onsets"] > 0.5
    assert sc["median_lead_h"] >= 1


def test_top_list_only_has_counties_not_yet_out():
    s = Session("ice2023", "honest")
    for _ in range(100):
        res = s.step()
    for c in res["top"]:
        cty = next(x for x in s.bundle["counties"] if x["fips"] == c["fips"])
        assert c["out"] < cty["severe_at"]
        assert c["tier"] in ("watch", "prepare", "act")


def test_explain_gives_readable_reasons():
    s = Session("uri", "honest")
    for _ in range(200):
        s.step()
    x = s.engine.last_x[0]
    reasons = explain(s.engine.model, x)
    assert all(isinstance(r["text"], str) and r["text"] for r in reasons)


def test_severe_threshold_scales_with_population():
    assert severe_threshold(10_000) == 2500
    assert severe_threshold(4_000_000) > 100_000


def test_scorecard_counts_warned_and_missed():
    sc = Scorecard(2)
    # county 0: alert at hour 1, severe at hour 5 (warned, lead 4h)
    for h, (tier, sev) in enumerate([(0, False), (1, False), (1, False), (1, False), (1, False), (2, True)]):
        sc.observe(h, 0, tier, sev)
    # county 1: never alerted, severe at hour 3 (missed)
    for h in range(5):
        sc.observe(h, 1, 0, h >= 3)
    snap = sc.snapshot()
    assert snap["onsets"] == 2 and snap["warned"] == 1 and snap["median_lead_h"] == 4
