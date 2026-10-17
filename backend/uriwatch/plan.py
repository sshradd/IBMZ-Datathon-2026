"""Prescriptive layer: turn the forecast into a deployment plan and recommended moves.

Pure Python, no learned parts. The objective is explicit and shown in the UI:
put crews, warming or cooling centers and outreach calls where the most
vulnerable people are exposed, with seniors counted twice, and report how much
of the statewide exposure the plan covers versus the naive plan of spreading
resources by population alone.

Resource counts are what-if levers, not facts about any utility's fleet.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass

from .features import PEOPLE_PER_CUSTOMER

DEFAULT_RESOURCES = {"crews": 40, "centers": 15, "callers": 25}
MAX_PER_COUNTY = {"crews": 6, "centers": 4, "callers": 4}
WINDOW_NAMES = ("0-6 h", "6-12 h", "12-24 h")


@dataclass
class Cand:
    """One county as the planner sees it right now."""

    i: int
    fips: str
    name: str
    pop: int
    pop65: int
    tier: int
    p6: float
    p12: float
    p24: float
    window: int
    out: int
    severe: bool
    temp_f: float
    cold: bool
    heat: bool
    ice: bool
    grid_share: float
    reasons: list[dict]

    @property
    def senior_share(self) -> float:
        return self.pop65 / max(self.pop, 1)

    @property
    def people_out(self) -> float:
        return self.out * PEOPLE_PER_CUSTOMER

    # Exposure in "vulnerability-weighted people": seniors count twice.
    @property
    def crew_value(self) -> float:
        if self.severe:
            return self.people_out * (1 + self.senior_share)  # restore first where it is already dark
        return self.p24 * self.pop * (1 + self.senior_share)  # pre-position where it is likely next

    @property
    def senior_exposure(self) -> float:
        if self.severe:
            return min(1.0, self.people_out / max(self.pop, 1)) * self.pop65
        return self.p24 * self.pop65

    @property
    def center_eligible(self) -> bool:
        return (self.cold or self.heat) and (self.severe or self.tier >= 2)

    @property
    def caller_eligible(self) -> bool:
        return self.severe or self.tier >= 1


def _greedy(values: dict[int, float], units: int, cap: int) -> dict[int, int]:
    """Give `units` one at a time to the county with the best marginal gain value/(n+1)."""
    alloc: dict[int, int] = {}
    heap = [(-v, i) for i, v in values.items() if v > 0]
    heapq.heapify(heap)
    for _ in range(units):
        if not heap:
            break
        _, i = heapq.heappop(heap)
        alloc[i] = alloc.get(i, 0) + 1
        if alloc[i] < cap:
            heapq.heappush(heap, (-values[i] / (alloc[i] + 1), i))
    return alloc


def _coverage(values: dict[int, float], alloc: dict[int, int]) -> float:
    tot = sum(values.values())
    return sum(v for i, v in values.items() if alloc.get(i)) / tot if tot > 0 else 0.0


def _naive(cands: list[Cand], values: dict[int, float], units: int, cap: int) -> dict[int, int]:
    """Spread the same units by population alone, ignoring risk and age."""
    by_pop = {c.i: float(c.pop) for c in cands if c.i in values}
    return _greedy(by_pop, units, cap)


def _confidence(tier_stats: dict | None, tier: int) -> dict | None:
    if not tier_stats or tier < 1:
        return None
    t = ("watch", "prepare", "act")[tier - 1]
    s = tier_stats.get(t)
    if not s:
        return None
    return {
        "tier": t,
        "precision": s["precision"],
        "lift": s["lift"],
        "base_rate": tier_stats.get("base_rate"),
    }


def _fmt(n: float) -> str:
    return f"{round(n):,}"


def build_plan(
    cands: list[Cand],
    resources: dict[str, int],
    state: dict,
    tier_stats: dict | None,
    max_rows: int = 14,
) -> dict:
    crews, centers, callers = resources["crews"], resources["centers"], resources["callers"]
    live = [c for c in cands if c.severe or c.tier >= 1]

    crew_vals = {c.i: c.crew_value for c in live}
    center_vals = {c.i: c.senior_exposure for c in live if c.center_eligible}
    call_vals = {c.i: c.senior_exposure for c in live if c.caller_eligible}

    crew_alloc = _greedy(crew_vals, crews, MAX_PER_COUNTY["crews"])
    center_alloc = _greedy(center_vals, centers, MAX_PER_COUNTY["centers"])
    call_alloc = _greedy(call_vals, callers, MAX_PER_COUNTY["callers"])

    cov = {
        "crews": _coverage(crew_vals, crew_alloc),
        "centers": _coverage(center_vals, center_alloc),
        "callers": _coverage(call_vals, call_alloc),
    }
    naive = {
        "crews": _coverage(crew_vals, _naive(live, crew_vals, crews, MAX_PER_COUNTY["crews"])),
        "centers": _coverage(center_vals, _naive(live, center_vals, centers, MAX_PER_COUNTY["centers"])),
        "callers": _coverage(call_vals, _naive(live, call_vals, callers, MAX_PER_COUNTY["callers"])),
    }

    # How much each extra crew would add: the marginal-return curve for the slider.
    curve = []
    for k in (0, 5, 10, 20, 30, 40, 60, 80):
        curve.append({"crews": k, "coverage": round(_coverage(crew_vals, _greedy(crew_vals, k, MAX_PER_COUNTY["crews"])), 3)})

    by_i = {c.i: c for c in live}
    touched = sorted(set(crew_alloc) | set(center_alloc) | set(call_alloc), key=lambda i: -crew_vals.get(i, 0) - center_vals.get(i, 0))
    deployments = []
    for i in touched:
        c = by_i[i]
        deployments.append(
            {
                "fips": c.fips,
                "name": c.name,
                "status": "out" if c.severe else ("act" if c.tier == 3 else "prepare" if c.tier == 2 else "watch"),
                "crews": crew_alloc.get(i, 0),
                "centers": center_alloc.get(i, 0),
                "center_kind": "cooling" if c.heat and not c.cold else "warming",
                "callers": call_alloc.get(i, 0),
                "risk": round(c.p24, 3),
                "window": WINDOW_NAMES[c.window],
                "seniors_exposed": round(c.senior_exposure),
                "out": c.out,
            }
        )

    plan = {
        "resources": {"crews": crews, "centers": centers, "callers": callers},
        "deployments": deployments[:max_rows],
        "coverage": {k: round(v, 3) for k, v in cov.items()},
        "naive_coverage": {k: round(v, 3) for k, v in naive.items()},
        "curve": curve,
        "objective": "Seniors count twice. Crews go where the most vulnerable people are already dark or likely to be next; "
        "centers go where it is cold or hot and seniors are exposed.",
    }
    plan["moves"] = build_moves(live, crew_alloc, center_alloc, call_alloc, cov, state, tier_stats, crew_vals)
    return plan


def build_moves(
    live: list[Cand],
    crew_alloc: dict[int, int],
    center_alloc: dict[int, int],
    call_alloc: dict[int, int],
    cov: dict[str, float],
    state: dict,
    tier_stats: dict | None,
    crew_vals: dict[int, float],
) -> list[dict]:
    """Ranked, plain-English recommendations. Each one carries its timing, projected impact and
    the out-of-sample track record of alerts at that tier."""
    by_i = {c.i: c for c in live}
    total_crew_value = sum(crew_vals.values()) or 1.0
    moves: list[dict] = []

    # Statewide: grid-level steps first, because they change everything below.
    g = state
    if g.get("severe_frac", 0) >= 0.15 and g.get("load_shed"):
        moves.append(
            {
                "id": "state-loadshed",
                "kind": "statewide",
                "urgency": "act",
                "title": "Protect critical circuits while the grid sheds load",
                "detail": f"Demand is {abs(g['fc_err']) * 100:.0f}% below ERCOT's own forecast, which means load is being cut. "
                "Ask the grid operator to keep hospitals, dialysis centers, water plants and care facilities off rotating outages.",
                "counties": [],
                "window": "now",
                "why": [f"{g['severe_frac'] * 100:.0f}% of Texas counties already in severe outage"],
                "impact": None,
                "confidence": None,
            }
        )
    elif g.get("stress"):
        moves.append(
            {
                "id": "state-stress",
                "kind": "statewide",
                "urgency": "prepare",
                "title": "Issue a statewide conservation appeal",
                "detail": g["stress_text"],
                "counties": [],
                "window": "0-12 h",
                "why": [g["stress_text"]],
                "impact": None,
                "confidence": None,
            }
        )

    # Restore first where it is already dark.
    dark = sorted((c for c in live if c.severe and crew_alloc.get(c.i)), key=lambda c: -crew_vals[c.i])
    for c in dark[:2]:
        n = crew_alloc[c.i]
        moves.append(
            {
                "id": f"restore-{c.fips}",
                "kind": "crews",
                "urgency": "act",
                "title": f"Send {n} crew{'s' if n > 1 else ''} to {c.name} County to restore power",
                "detail": f"{_fmt(c.out)} customers are out, about {_fmt(c.people_out)} people, of whom roughly "
                f"{_fmt(c.senior_exposure)} are 65 or older.",
                "counties": [c.name],
                "window": "now",
                "why": [f"{_fmt(c.out)} customers already without power"],
                "impact": {"people": round(c.people_out), "seniors": round(c.senior_exposure), "share": round(crew_vals[c.i] / total_crew_value, 3)},
                "confidence": None,
            }
        )

    # Pre-position where it is likely next.
    nxt = sorted((c for c in live if not c.severe and crew_alloc.get(c.i)), key=lambda c: -crew_vals[c.i])
    for c in nxt[:4]:
        n = crew_alloc[c.i]
        moves.append(
            {
                "id": f"preposition-{c.fips}",
                "kind": "crews",
                "urgency": "act" if c.tier == 3 else "prepare",
                "title": f"Pre-position {n} crew{'s' if n > 1 else ''} in {c.name} County",
                "detail": f"{c.p24 * 100:.0f}% chance of a severe outage in 24 h, most likely in the {WINDOW_NAMES[c.window]} window. "
                f"About {_fmt(c.senior_exposure)} seniors exposed.",
                "counties": [c.name],
                "window": WINDOW_NAMES[c.window],
                "why": [r["text"] for r in c.reasons[:2]],
                "impact": {"people": round(c.p24 * c.pop), "seniors": round(c.senior_exposure), "share": round(crew_vals[c.i] / total_crew_value, 3)},
                "confidence": _confidence(tier_stats, c.tier),
            }
        )

    # Warming or cooling centers.
    cen = sorted((c for c in live if center_alloc.get(c.i)), key=lambda c: -c.senior_exposure)
    for c in cen[:3]:
        n = center_alloc[c.i]
        kind = "cooling" if c.heat and not c.cold else "warming"
        moves.append(
            {
                "id": f"center-{c.fips}",
                "kind": "centers",
                "urgency": "act" if c.severe or c.tier == 3 else "prepare",
                "title": f"Open {n} {kind} center{'s' if n > 1 else ''} in {c.name} County",
                "detail": f"{c.temp_f:.0f}°F and "
                + ("power is already out. " if c.severe else f"{c.p24 * 100:.0f}% chance of losing power. ")
                + f"About {_fmt(c.senior_exposure)} seniors exposed.",
                "counties": [c.name],
                "window": "now" if c.severe else WINDOW_NAMES[c.window],
                "why": [f"{c.temp_f:.0f}°F"] + [r["text"] for r in c.reasons[:1]],
                "impact": {"people": round(c.senior_exposure), "seniors": round(c.senior_exposure), "share": None},
                "confidence": _confidence(tier_stats, c.tier),
            }
        )

    # Outreach to medical-need and senior customers.
    callers = sorted((c for c in live if call_alloc.get(c.i)), key=lambda c: -c.senior_exposure)[:4]
    if callers:
        seniors = sum(c.senior_exposure for c in callers)
        moves.append(
            {
                "id": "outreach",
                "kind": "callers",
                "urgency": "prepare",
                "title": "Call medical-need and senior customers first in " + ", ".join(c.name for c in callers[:3]),
                "detail": f"About {_fmt(seniors)} seniors are exposed across the top {len(callers)} counties. "
                "Use the utility's own medical-need list; we only know county-level age counts.",
                "counties": [c.name for c in callers],
                "window": "0-12 h",
                "why": [f"{_fmt(c.senior_exposure)} seniors exposed in {c.name}" for c in callers[:2]],
                "impact": {"people": round(seniors), "seniors": round(seniors), "share": None},
                "confidence": _confidence(tier_stats, max(c.tier for c in callers)),
            }
        )

    order = {"act": 0, "prepare": 1, "watch": 2}
    moves.sort(key=lambda m: order[m["urgency"]])
    return moves[:9]
