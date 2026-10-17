"""Scoring engine: one county-hour in, risk + tier + plain-English reasons out.

Also keeps the running scorecard shown to judges: how many severe outages the
model warned about, how many hours ahead, and how many false alarms.
"""

from __future__ import annotations

import statistics
import time
from collections import deque

from .features import FEATURES, HORIZON_H, reason_text
from .model import LogisticModel

TIER_NAMES = ["clear", "watch", "prepare", "act"]
REASON_MIN = 0.25  # ignore features that push the log-odds by less than this
ALERT_TIER = 1     # a "warning" for the scorecard is any tier >= watch


def explain(model: LogisticModel, x: list[float], top: int = 3) -> list[dict]:
    contribs = model.contributions(x)
    ranked = sorted(range(len(contribs)), key=lambda i: contribs[i], reverse=True)
    out, seen_text = [], set()
    for i in ranked:
        if contribs[i] < REASON_MIN or len(out) >= top:
            break
        text = reason_text(FEATURES[i], x)
        if text in seen_text:
            continue
        seen_text.add(text)
        out.append({"code": FEATURES[i], "text": text, "weight": round(contribs[i], 2)})
    return out


class Scorecard:
    """Online tally of warnings versus what actually happened."""

    def __init__(self, n_counties: int) -> None:
        self.n = n_counties
        self.reset()

    def reset(self) -> None:
        self.pending: list[int | None] = [None] * self.n  # hour the current warning started
        self.in_severe = [False] * self.n
        self.leads: list[int] = []
        self.onsets = 0
        self.warned = 0
        self.false_alerts = 0
        self.alert_hours = 0

    def observe(self, h: int, c: int, tier: int, severe_now: bool) -> None:
        if tier >= ALERT_TIER:
            self.alert_hours += 1
        if severe_now and not self.in_severe[c]:
            self.onsets += 1
            started = self.pending[c]
            if started is not None and h > started:
                self.warned += 1
                self.leads.append(h - started)
            self.pending[c] = None
        elif not severe_now:
            started = self.pending[c]
            if started is None and tier >= ALERT_TIER:
                self.pending[c] = h
            elif started is not None and h - started > HORIZON_H:
                self.false_alerts += 1
                self.pending[c] = h if tier >= ALERT_TIER else None
        self.in_severe[c] = severe_now

    def snapshot(self) -> dict:
        leads = sorted(self.leads)
        return {
            "onsets": self.onsets,
            "warned": self.warned,
            "warned_pct": round(100 * self.warned / self.onsets, 1) if self.onsets else None,
            "median_lead_h": statistics.median(leads) if leads else None,
            "max_lead_h": leads[-1] if leads else None,
            "false_alerts": self.false_alerts,
            "alert_hours": self.alert_hours,
        }


class LatencyStats:
    def __init__(self) -> None:
        self.samples: deque[float] = deque(maxlen=20000)
        self.scored = 0
        self.t_first = time.perf_counter()

    def reset(self) -> None:
        self.samples.clear()
        self.scored = 0
        self.t_first = time.perf_counter()

    def record(self, ms_per_county: float, n: int) -> None:
        self.samples.append(ms_per_county)
        self.scored += n

    def snapshot(self) -> dict:
        s = sorted(self.samples)
        pick = lambda q: s[min(len(s) - 1, int(q * len(s)))] if s else 0.0  # noqa: E731
        elapsed = max(time.perf_counter() - self.t_first, 1e-9)
        return {
            "scored": self.scored,
            "p50_ms": round(pick(0.5), 4),
            "p99_ms": round(pick(0.99), 4),
            "scores_per_s": round(self.scored / elapsed),
        }


class Engine:
    def __init__(self, model: LogisticModel, counties: list[dict]) -> None:
        self.model = model
        self.counties = counties
        self.scorecard = Scorecard(len(counties))
        self.latency = LatencyStats()
        self.last_x: list[list[float]] = []
        self.last_risk: list[float] = []

    def reset(self) -> None:
        self.scorecard.reset()
        self.latency.reset()

    def score_hour(self, h: int, hour: dict) -> dict:
        """Score every county for one hour of the replay."""
        xs, outs = hour["x"], hour["out"]
        model = self.model
        t0 = time.perf_counter()
        risks = [model.risk(x) for x in xs]
        dt = (time.perf_counter() - t0) * 1000.0
        self.latency.record(dt / len(xs), len(xs))
        self.last_x, self.last_risk = xs, risks

        rows, flagged = [], []
        for c, (risk, out) in enumerate(zip(risks, outs)):
            tier = model.tier(risk)
            severe = out >= self.counties[c]["severe_at"]
            self.scorecard.observe(h, c, tier, severe)
            rows.append([round(risk, 3), tier, out])
            if tier >= 1 and not severe:
                flagged.append(c)

        # Who needs help first: risk times the seniors living there.
        flagged.sort(key=lambda c: risks[c] * self.counties[c]["pop65"], reverse=True)
        top = []
        for c in flagged[:8]:
            cty = self.counties[c]
            contribs = model.contributions(xs[c])
            top.append(
                {
                    "fips": cty["fips"],
                    "name": cty["name"],
                    "risk": round(risks[c], 3),
                    "tier": TIER_NAMES[model.tier(risks[c])],
                    "seniors_at_risk": round(risks[c] * cty["pop65"]),
                    "people_at_risk": round(risks[c] * cty["pop"]),
                    "out": outs[c],
                    "grid_share": round(model.grid_share(contribs), 2),
                    "reasons": explain(model, xs[c]),
                }
            )
        counts = [0, 0, 0, 0]
        for _, tier, _ in rows:
            counts[tier] += 1
        return {
            "t": hour["t"],
            "grid": hour["grid"],
            "counties": rows,
            "tier_counts": counts,
            "out_total": sum(outs),
            "top": top,
            "scorecard": self.scorecard.snapshot(),
            "latency": self.latency.snapshot(),
        }
