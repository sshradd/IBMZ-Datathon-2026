"""Scoring engine: features -> model -> decision -> reasons, plus live stats."""

from __future__ import annotations

import time
from collections import deque

from .features import DAY, FEATURES, FeatureState
from .model import LogisticModel
from .models import Decision, Reason, Txn

# Tuned on a held-out simulated stream (seed 2): precision ~0.92, recall ~0.86,
# false-positive rate ~0.7%. Lower them to catch more scams at the cost of
# more false holds.
HOLD_AT = 0.93
STEP_UP_AT = 0.8
REASON_MIN = 0.15


def decide(risk: float, ctx: dict) -> str:
    if risk >= HOLD_AT:
        return "hold"
    if risk >= STEP_UP_AT:
        # Policy: customers 65+ get the stronger protection.
        return "hold" if ctx["senior"] else "step_up"
    return "allow"


def _reason_text(code: str, ctx: dict) -> str:
    if code == "amount_vs_usual":
        return f"${ctx['amount']:,.0f} is {ctx['ratio']:.0f}x this customer's usual ${ctx['avg']:,.0f}"
    if code == "new_payee":
        return "First payment ever to this recipient"
    if code == "senior_sender":
        return "Sender is 65+, the group most targeted by impersonation scams"
    if code == "urgent_memo":
        return f'Memo contains scam language: "{ctx["keyword"]}"'
    if code == "repeat_to_payee_10m":
        return f"{ctx['repeats']} payments to the same recipient within 10 minutes"
    if code == "spend_burst_1h":
        return f"${ctx['burst']:,.0f} sent in the last hour, {ctx['burst_ratio']:.0f}x usual"
    if code == "night_time":
        return "Sent between midnight and 5 AM"
    if code == "young_sender":
        return f"Sending account is only {ctx['sender_age_days']} days old"
    if code == "young_receiver":
        return f"Receiving account is only {ctx['receiver_age_days']} days old"
    if code == "established_receiver":
        return f"Recipient has little account history ({ctx['receiver_age_days']} days)"
    if code == "new_account_fan_in":
        return f"New receiving account got money from {ctx['fan_in']} different people in 24h"
    if code == "receiver_fast_cashout":
        return "Receiving account moves money out almost as fast as it comes in"
    return code


def explain(contribs: list[float], ctx: dict, top: int = 3) -> list[Reason]:
    ranked = sorted(zip(FEATURES, contribs), key=lambda fc: fc[1], reverse=True)
    return [
        Reason(code=f, text=_reason_text(f, ctx), weight=round(c, 3))
        for f, c in ranked[:top]
        if c > REASON_MIN
    ]


class RingTracker:
    """Young accounts receiving from many people: candidate mule rings."""

    def __init__(self, min_fan_in: int = 3, max_rings: int = 8) -> None:
        self.min_fan_in = min_fan_in
        self.max_rings = max_rings
        self.rings: dict[str, dict] = {}

    def observe(self, t: Txn, action: str) -> None:
        if t.receiver_account_age_days >= 90:
            return
        ring = self.rings.setdefault(
            t.receiver_id, {"senders": {}, "total": 0.0, "held": 0, "last_ts": t.ts,
                            "age_days": t.receiver_account_age_days},
        )
        ring["senders"][t.sender_id] = {"amount": t.amount, "action": action,
                                        "senior": t.sender_age_band == "65+"}
        ring["total"] += t.amount
        ring["held"] += action == "hold"
        ring["last_ts"] = t.ts
        if len(self.rings) > 500:
            cutoff = t.ts - DAY
            self.rings = {k: v for k, v in self.rings.items() if v["last_ts"] >= cutoff}

    def snapshot(self) -> dict:
        live = [(k, v) for k, v in self.rings.items() if len(v["senders"]) >= self.min_fan_in]
        live.sort(key=lambda kv: (len(kv[1]["senders"]), kv[1]["last_ts"]), reverse=True)
        nodes, edges = [], []
        for rid, ring in live[: self.max_rings]:
            nodes.append({"id": rid, "kind": "receiver", "age_days": ring["age_days"],
                          "total": round(ring["total"], 2), "fan_in": len(ring["senders"]),
                          "held": ring["held"]})
            for sid, info in ring["senders"].items():
                nodes.append({"id": sid, "kind": "sender", "senior": info["senior"]})
                edges.append({"source": sid, "target": rid, "amount": info["amount"],
                              "action": info["action"]})
        return {"nodes": nodes, "edges": edges}


def _pct(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    i = min(len(sorted_vals) - 1, int(q * len(sorted_vals)))
    return sorted_vals[i]


class Stats:
    def __init__(self) -> None:
        self.processed = 0
        self.actions = {"allow": 0, "step_up": 0, "hold": 0}
        self.amount_held = 0.0
        self.fraud_amount_stopped = 0.0
        self.tp = self.fp = self.fn = self.tn = 0
        self.latencies: deque = deque(maxlen=20000)
        self.wall: deque = deque(maxlen=50000)

    def record(self, t: Txn, action: str, latency_ms: float) -> None:
        self.processed += 1
        self.actions[action] += 1
        self.latencies.append(latency_ms)
        self.wall.append(time.monotonic())
        flagged = action != "allow"
        if action == "hold":
            self.amount_held += t.amount
        if t.label_fraud is None:
            return
        if t.label_fraud and flagged:
            self.tp += 1
            self.fraud_amount_stopped += t.amount if action == "hold" else 0.0
        elif t.label_fraud:
            self.fn += 1
        elif flagged:
            self.fp += 1
        else:
            self.tn += 1

    def snapshot(self) -> dict:
        lat = sorted(self.latencies)
        now = time.monotonic()
        recent = sum(1 for w in self.wall if now - w <= 5.0)
        labeled = self.tp + self.fp + self.fn + self.tn
        return {
            "processed": self.processed,
            "actions": self.actions,
            "amount_held": round(self.amount_held, 2),
            "fraud_amount_stopped": round(self.fraud_amount_stopped, 2),
            "precision": round(self.tp / (self.tp + self.fp), 3) if self.tp + self.fp else None,
            "recall": round(self.tp / (self.tp + self.fn), 3) if self.tp + self.fn else None,
            "false_positive_rate": round(self.fp / (self.fp + self.tn), 4) if self.fp + self.tn else None,
            "labeled": labeled,
            "latency_ms": {"p50": round(_pct(lat, 0.50), 4), "p95": round(_pct(lat, 0.95), 4),
                           "p99": round(_pct(lat, 0.99), 4), "max": round(lat[-1], 4) if lat else 0.0},
            "tps_5s": round(recent / 5.0, 1),
        }


class Engine:
    def __init__(self, model: LogisticModel) -> None:
        self.model = model
        self.reset()

    def reset(self) -> None:
        self.state = FeatureState()
        self.rings = RingTracker()
        self.stats = Stats()

    def warm(self, txns: list[Txn]) -> None:
        for t in txns:
            self.state.update(t)

    def score(self, t: Txn) -> Decision:
        t0 = time.perf_counter()
        x, ctx = self.state.extract(t)
        risk, contribs, s_score, r_score = self.model.predict(x)
        action = decide(risk, ctx)
        reasons = explain(contribs, ctx) if action != "allow" else []
        self.state.update(t)
        self.rings.observe(t, action)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        self.stats.record(t, action, latency_ms)
        return Decision(
            txn_id=t.id,
            risk=round(risk, 4),
            action=action,
            reasons=reasons,
            sender_score=round(s_score, 4),
            receiver_score=round(r_score, 4),
            latency_ms=round(latency_ms, 4),
        )
