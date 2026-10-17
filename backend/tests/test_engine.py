from scamstopper.engine import Engine
from scamstopper.model import LogisticModel
from scamstopper.models import Txn
from scamstopper.sim import Simulator


def make_engine():
    sim = Simulator(seed=11)
    engine = Engine(LogisticModel.load())
    engine.warm(sim.warmup())
    return sim, engine


def test_regular_payment_is_allowed():
    sim, engine = make_engine()
    u = sim.users[0]
    d = engine.score(Txn(id="a", ts=sim.ts, sender_id=u.id, receiver_id=u.payees[0],
                         amount=round(u.typical, 2), sender_age_band=u.age_band,
                         sender_account_age_days=u.account_age_days,
                         receiver_account_age_days=sim.account_age[u.payees[0]]))
    assert d.action == "allow"
    assert d.reasons == []


def test_senior_gift_card_scam_is_held_with_reasons():
    sim, engine = make_engine()
    v = sim.seniors[0]
    d = None
    for i in range(3):
        d = engine.score(Txn(id=f"g{i}", ts=sim.ts + i * 120, sender_id=v.id, receiver_id="x999",
                             amount=400.0, memo="gift cards for IRS", sender_age_band="65+",
                             sender_account_age_days=v.account_age_days,
                             receiver_account_age_days=5))
    assert d.action == "hold"
    codes = {r.code for r in d.reasons}
    assert codes & {"young_receiver", "repeat_to_payee_10m", "amount_vs_usual", "new_payee"}
    assert all(r.text for r in d.reasons)


def test_mule_fan_in_raises_receiver_score():
    sim, engine = make_engine()
    first = last = None
    for i, u in enumerate(sim.users[:8]):
        d = engine.score(Txn(id=f"f{i}", ts=sim.ts + i * 60, sender_id=u.id, receiver_id="x998",
                             amount=300.0, sender_age_band=u.age_band,
                             sender_account_age_days=u.account_age_days,
                             receiver_account_age_days=7))
        first = first or d
        last = d
    assert last.receiver_score > first.receiver_score
    ring = engine.rings.snapshot()
    assert any(n["id"] == "x998" and n["fan_in"] == 8 for n in ring["nodes"])


def test_simulated_stream_quality():
    sim = Simulator(seed=5)
    engine = Engine(LogisticModel.load())
    engine.warm(sim.warmup())
    for _ in range(5000):
        engine.score(sim.next())
    s = engine.stats.snapshot()
    assert s["recall"] > 0.6
    assert s["false_positive_rate"] < 0.03
    assert s["latency_ms"]["p99"] < 5
