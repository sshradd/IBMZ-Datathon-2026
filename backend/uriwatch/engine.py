"""Scoring engine: one hour of every county in, four kinds of analytics out.

    describe   what has happened so far (outages, customer-hours, who was hit hardest)
    diagnose   why: which signals drive the risk, and what caused the outages we warned about
    predict    what happens next: 6, 12 and 24 hour forecasts, expected onsets, exposed people
    prescribe  what to do: a deployment plan and ranked, plain-English recommended moves

Everything the model uses is known at that hour. The only hindsight in here is the
forecast scoreboard, which compares a forecast issued 24 hours earlier with what
happened afterwards.
"""

from __future__ import annotations

import statistics
import time
from collections import deque

from .features import FEATURE_GROUP, FEATURES, GROUPS, GROUP_ORDER, HORIZON_H, IDX, PEOPLE_PER_CUSTOMER, reason_text
from .model import WINDOWS, LogisticModel
from .plan import DEFAULT_RESOURCES, Cand, build_plan

TIER_NAMES = ["clear", "watch", "prepare", "act"]
REASON_MIN = 0.25  # ignore features that push the log-odds by less than this
ALERT_TIER = 1     # a "warning" for the scorecard is any tier >= watch
CAUSE_GROUPS = [g for g in GROUP_ORDER if g != "profile"]


def explain_from(contribs: list[float], x: list[float], top: int = 3) -> list[dict]:
    ranked = sorted(range(len(contribs)), key=lambda i: contribs[i], reverse=True)
    out, seen = [], set()
    for i in ranked:
        if contribs[i] < REASON_MIN or len(out) >= top:
            break
        text = reason_text(FEATURES[i], x)
        if text in seen:
            continue
        seen.add(text)
        out.append({"code": FEATURES[i], "text": text, "weight": round(contribs[i], 2)})
    return out


def explain(model: LogisticModel, x: list[float], top: int = 3) -> list[dict]:
    return explain_from(model.contributions(x), x, top)


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

    def observe(self, h: int, c: int, tier: int, severe_now: bool) -> bool | None:
        """Returns True/False when this county just hit the severe line (warned or not), else None."""
        result = None
        if tier >= ALERT_TIER:
            self.alert_hours += 1
        if severe_now and not self.in_severe[c]:
            self.onsets += 1
            started = self.pending[c]
            result = started is not None and h > started
            if result:
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
        return result

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
        self.n = len(counties)
        self.scorecard = Scorecard(self.n)
        self.latency = LatencyStats()
        self.tier_stats = model.metrics.get("tier_stats") if model.metrics else None
        self.resources = dict(DEFAULT_RESOURCES)
        self.last_x: list[list[float]] = []
        self.last_risk: list[float] = []
        self._cands: list[Cand] = []
        self._state: dict = {}
        self.reset()

    def reset(self) -> None:
        self.scorecard.reset()
        self.latency.reset()
        n = self.n
        self.cum_customer_hours = [0.0] * n
        self.ever_severe = [False] * n
        self.prev_severe = [False] * n
        self.peak = {"out": 0, "i": 0, "t": None}
        self.customer_hours = 0.0
        self.cause_at_alert: list[str | None] = [None] * n
        self.cause_mix = {g: 0 for g in CAUSE_GROUPS}
        self.cause_unwarned = 0
        self.expected_hist: deque[float] = deque(maxlen=HORIZON_H + 1)  # forecast issued each hour
        self.onset_hist: deque[int] = deque(maxlen=HORIZON_H)
        self.p24_hist: list[deque] = [deque(maxlen=4) for _ in range(n)]
        self.last_x, self.last_risk = [], []

    # ----------------------------------------------------------------- helpers
    def _dominant_cause(self, contribs: list[float]) -> str:
        sums = self.model.group_contributions(contribs)
        return max(CAUSE_GROUPS, key=lambda g: sums[g])

    def _grid_state(self, x0: list[float], hour: dict, temp_f_mean: float) -> dict:
        fc_err = x0[IDX["grid_fc_err"]]
        norm = x0[IDX["grid_demand_norm"]]
        gen_drop = x0[IDX["grid_gen_drop_24h"]]
        sev = x0[IDX["state_sev_frac"]]
        stress_bits = []
        if norm > 0.2:
            stress_bits.append(f"statewide demand is {norm * 100:+.0f}% versus its two-week norm")
        if gen_drop < -0.15:
            stress_bits.append(f"generation is down {abs(gen_drop) * 100:.0f}% from its 48-hour peak")
        if fc_err > 0.08:
            stress_bits.append(f"demand is running {fc_err * 100:.0f}% above ERCOT's forecast")
        return {
            "fc_err": fc_err,
            "demand_norm": norm,
            "gen_drop": gen_drop,
            "severe_frac": sev,
            "temp_f_mean": temp_f_mean,
            "load_shed": fc_err < -0.12,
            "stress": bool(stress_bits),
            "stress_text": ("Grid stress: " + "; ".join(stress_bits) + ". Ask for voluntary conservation before it becomes forced cuts.")
            if stress_bits
            else "",
        }

    # ------------------------------------------------------------------ scoring
    def score_hour(self, h: int, hour: dict) -> dict:
        xs, outs = hour["x"], hour["out"]
        model, counties = self.model, self.counties
        n = self.n

        t0 = time.perf_counter()
        probs = [model.risks(x) for x in xs]
        self.latency.record((time.perf_counter() - t0) * 1000.0 / n, n)
        p24s = [p[2] for p in probs]
        self.last_x, self.last_risk = xs, p24s

        i_temp, i_cold, i_heat, i_ice = IDX["temp_c"], IDX["cold_deg"], IDX["heat_deg"], IDX["ice_index"]
        temp_mean_c = sum(x[i_temp] for x in xs) / n
        temp_f_mean = temp_mean_c * 9 / 5 + 32
        state = self._grid_state(xs[0], hour, temp_f_mean)

        rows, cands = [], []
        onsets_now = 0
        out_total = 0
        seniors_out = 0.0
        severe_now = 0
        exp = [0.0, 0.0, 0.0]
        eligible_p = []
        tier_counts = [0, 0, 0, 0]
        window_mass = [0.0, 0.0, 0.0]
        flagged_contribs: list[list[float]] = []
        for c in range(n):
            p6, p12, p24 = probs[c]
            out = outs[c]
            cty = counties[c]
            tier = model.tier(p24)
            tier_counts[tier] += 1
            severe = out >= cty["severe_at"]
            outcome = self.scorecard.observe(h, c, tier, severe)
            hist = self.p24_hist[c]
            hist.append(p24)

            out_total += out
            self.cum_customer_hours[c] += out
            if out > 0:
                seniors_out += min(1.0, out * PEOPLE_PER_CUSTOMER / max(cty["pop"], 1)) * cty["pop65"]
            if severe:
                severe_now += 1
                self.ever_severe[c] = True
            if severe and not self.prev_severe[c]:
                onsets_now += 1
            self.prev_severe[c] = severe

            window = model.window(p6, p12, p24)
            rows.append([round(p24, 3), tier, out, round(p6, 3), round(p12, 3)])

            contribs = None
            if tier >= 1 or severe:
                contribs = model.contributions(xs[c])
            # Cause attribution: remember what was driving the risk when the alert started.
            if tier >= ALERT_TIER and not severe and self.scorecard.pending[c] == h:
                self.cause_at_alert[c] = self._dominant_cause(contribs)
            if outcome is True and self.cause_at_alert[c]:
                self.cause_mix[self.cause_at_alert[c]] += 1
            elif outcome is False:
                self.cause_unwarned += 1

            if not severe:
                exp[0] += p6; exp[1] += p12; exp[2] += p24
                eligible_p.append(c)
                window_mass[0] += p6
                window_mass[1] += p12 - p6
                window_mass[2] += p24 - p12
            if tier >= 1 and not severe:
                flagged_contribs.append(contribs)
            if tier >= 1 or severe:
                x = xs[c]
                cands.append(
                    Cand(
                        i=c, fips=cty["fips"], name=cty["name"], pop=cty["pop"], pop65=cty["pop65"], tier=tier,
                        p6=p6, p12=p12, p24=p24, window=window, out=out, severe=severe,
                        temp_f=x[i_temp] * 9 / 5 + 32, cold=x[i_temp] <= 1.0, heat=x[i_heat] > 0.0,
                        ice=x[i_ice] > 0.1, grid_share=model.grid_share(contribs),
                        reasons=explain_from(contribs, x, 3),
                    )
                )

        if out_total > self.peak["out"]:
            self.peak = {"out": out_total, "i": h, "t": hour["t"]}
        self.customer_hours += out_total

        # ---- predict
        n_cust = lambda c: counties[c]["pop"] / PEOPLE_PER_CUSTOMER  # noqa: E731
        exposed_customers = sum(p24s[c] * n_cust(c) for c in eligible_p)
        seniors_exposed = sum(p24s[c] * counties[c]["pop65"] for c in eligible_p)
        people_exposed = sum(p24s[c] * counties[c]["pop"] for c in eligible_p)
        dens = (window_mass[0] / 6.0, window_mass[1] / 6.0, window_mass[2] / 12.0)
        peak_window = max(range(3), key=lambda i: dens[i])

        self.onset_hist.append(onsets_now)
        issued_24h_ago = self.expected_hist[0] if len(self.expected_hist) >= HORIZON_H else None
        self.expected_hist.append(exp[2])

        watch = sorted(
            (c for c in eligible_p if model.tier(p24s[c]) >= 1),
            key=lambda c: p24s[c] * (counties[c]["pop"] + counties[c]["pop65"]),
            reverse=True,
        )[:12]
        watchlist = []
        for c in watch:
            p6, p12, p24 = probs[c]
            hist = self.p24_hist[c]
            watchlist.append(
                {
                    "fips": counties[c]["fips"], "name": counties[c]["name"], "p6": round(p6, 3), "p12": round(p12, 3),
                    "p24": round(p24, 3), "tier": TIER_NAMES[model.tier(p24)],
                    "window": WINDOWS[model.window(p6, p12, p24)], "seniors_exposed": round(p24 * counties[c]["pop65"]),
                    "trend": round(p24 - hist[0], 3) if len(hist) > 1 else 0.0,
                }
            )

        # ---- diagnose
        drivers = {g: 0.0 for g in GROUP_ORDER}
        if flagged_contribs:
            for contribs in flagged_contribs:
                for g, v in model.group_contributions(contribs).items():
                    drivers[g] += v / len(flagged_contribs)
        pos = sum(max(v, 0.0) for v in drivers.values())
        top_drivers = [
            {"group": g, "label": GROUPS[g][0], "push": round(drivers[g], 3),
             "share": round(max(drivers[g], 0.0) / pos, 3) if pos > 1e-9 else 0.0}
            for g in GROUP_ORDER
        ]
        by_name = {c.i: c for c in cands}
        county_drivers = {}
        for c in watch[:6]:
            county_drivers[counties[c]["fips"]] = {
                g: round(v, 3) for g, v in model.group_contributions(model.contributions(xs[c])).items()
            }

        # ---- prescribe
        plan = build_plan(cands, self.resources, state, self.tier_stats)
        self._cands, self._state = cands, state

        # ---- describe
        league = sorted(range(n), key=lambda c: self.cum_customer_hours[c], reverse=True)[:8]
        counts = [0, 0, 0, 0]
        for t in range(4):
            counts[t] = tier_counts[t]

        return {
            "t": hour["t"],
            "counties": rows,
            "tier_counts": counts,
            "out_total": out_total,
            "grid": hour["grid"],
            "predict": {
                "expected_onsets": [round(e, 1) for e in exp],
                "customers_exposed": round(exposed_customers),
                "people_exposed": round(people_exposed),
                "seniors_exposed": round(seniors_exposed),
                "peak_window": WINDOWS[peak_window],
                "window_density": [round(d, 3) for d in dens],
                "watchlist": watchlist,
                "scoreboard": {
                    "issued_24h_ago": round(issued_24h_ago, 1) if issued_24h_ago is not None else None,
                    "actual_24h": sum(self.onset_hist) if len(self.onset_hist) >= HORIZON_H else None,
                },
            },
            "diagnose": {
                "drivers": top_drivers,
                "county_drivers": county_drivers,
                "cause_mix": {GROUPS[g][0]: v for g, v in self.cause_mix.items()},
                "cause_unwarned": self.cause_unwarned,
                "state": {
                    "temp_f_mean": round(temp_f_mean, 1),
                    "fc_err": round(state["fc_err"], 3),
                    "demand_norm": round(state["demand_norm"], 3),
                    "gen_drop": round(state["gen_drop"], 3),
                    "severe_frac": round(state["severe_frac"], 3),
                },
            },
            "describe": {
                "out_total": out_total,
                "severe_now": severe_now,
                "ever_severe": sum(self.ever_severe),
                "customer_hours": round(self.customer_hours),
                "seniors_out": round(seniors_out),
                "peak": self.peak,
                "scorecard": self.scorecard.snapshot(),
                "league": [
                    {"fips": counties[c]["fips"], "name": counties[c]["name"],
                     "customer_hours": round(self.cum_customer_hours[c]), "out": outs[c], "pop": counties[c]["pop"]}
                    for c in league
                ],
            },
            "prescribe": plan,
            "latency": self.latency.snapshot(),
        }

    def replan(self, resources: dict[str, int]) -> dict:
        """Re-run the planner on the last scored hour with different resource levels."""
        self.resources = {k: max(0, int(resources.get(k, v))) for k, v in DEFAULT_RESOURCES.items()}
        return build_plan(self._cands, self.resources, self._state, self.tier_stats)
