"""Operations layer: the forecast turned into a priority list, with logistics for whatever the responder decides.

The model only sees weather and outage data, so it says where and when outages are likely.
It does not say how many crews or how much material a storm needs: that is the responder's
call. This module therefore ranks counties, finds the nearest available crew and the travel
time, sends the units the responder chooses, and tracks inventory against targets the
responder sets.

Crews, depots and stock are SAMPLE data that responders edit, and are labeled sample in the
API and the app. Travel times are planning estimates (straight-line distance, a road factor
and a winter slowdown), not routing.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .plan import WINDOW_NAMES, Cand

STATE_PATH = Path(__file__).resolve().parents[2] / "data" / "ops.json"

# ---------------------------------------------------------------- sample data

# id, name, lat, lon, line crews, shelter teams, outreach teams
DEPOTS = [
    ("dal", "Dallas", 32.78, -96.80, 8, 3, 5),
    ("hou", "Houston", 29.76, -95.37, 8, 3, 5),
    ("aus", "Austin", 30.27, -97.74, 5, 2, 3),
    ("sat", "San Antonio", 29.42, -98.49, 5, 2, 3),
    ("ftw", "Fort Worth", 32.75, -97.33, 4, 1, 2),
    ("elp", "El Paso", 31.76, -106.49, 2, 1, 1),
    ("lbb", "Lubbock", 33.58, -101.86, 2, 1, 1),
    ("crp", "Corpus Christi", 27.80, -97.40, 2, 1, 2),
    ("tyl", "Tyler", 32.35, -95.30, 2, 1, 2),
    ("mid", "Midland", 31.99, -102.08, 2, 0, 1),
]
UNIT_TYPES = {
    "line": {"label": "Line crew", "size": 4},
    "shelter": {"label": "Shelter team", "size": 6},
    "outreach": {"label": "Outreach team", "size": 3},
}
STATUSES = ("available", "en_route", "on_site", "resting")

# Per depot stock, in the order of ITEMS below.
STOCK = {
    "dal": [40, 120, 30, 90, 14, 3000, 10, 900, 40],
    "hou": [45, 130, 34, 100, 16, 3500, 12, 1000, 45],
    "aus": [26, 70, 18, 55, 9, 1800, 6, 500, 25],
    "sat": [26, 70, 18, 55, 9, 1800, 6, 500, 25],
    "ftw": [20, 55, 14, 40, 6, 1200, 4, 350, 18],
    "elp": [10, 30, 8, 20, 3, 600, 3, 200, 10],
    "lbb": [10, 30, 8, 20, 3, 600, 3, 200, 10],
    "crp": [12, 32, 8, 22, 4, 700, 3, 200, 10],
    "tyl": [12, 34, 8, 24, 4, 700, 3, 220, 10],
    "mid": [8, 24, 6, 16, 2, 500, 2, 120, 8],
}
ITEMS = [
    ("transformers", "Distribution transformers", "each"),
    ("poles", "Wood poles", "each"),
    ("wire", "Conductor wire", "spools"),
    ("hardware", "Crossarm and hardware kits", "kits"),
    ("generators", "Portable generators", "each"),
    ("fuel", "Generator fuel", "gallons"),
    ("shelter_kits", "Shelter kits", "kits"),
    ("cots", "Cots and blankets", "sets"),
    ("water", "Water pallets", "pallets"),
]

ROAD_FACTOR = 1.3
SPEED_KMH = 75.0
COLD_SLOWDOWN = 1.6  # at or below 34 F


def stamp(t: str) -> str:
    """"2021-02-16T07:00Z" -> "Feb 16, 1:00 AM CST": the clock Texans lived these storms on."""
    try:
        d = datetime.strptime(t, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) - timedelta(hours=6)
        return d.strftime("%b %-d, %-I:%M %p CST")
    except ValueError:
        return t


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def eta_minutes(km: float, cold: bool) -> int:
    return round(km * ROAD_FACTOR / SPEED_KMH * 60 * (COLD_SLOWDOWN if cold else 1.0))


def _window_start_h(window: str) -> int:
    return {WINDOW_NAMES[0]: 0, WINDOW_NAMES[1]: 6, WINDOW_NAMES[2]: 12}.get(window, 0)


# ---------------------------------------------------------------------- state


def _unit(did: str, dname: str, t: str, k: int) -> dict:
    return {
        "id": f"{t[:2].upper()}-{did.upper()}-{k:02d}",
        "name": f"{dname} {UNIT_TYPES[t]['label'].split()[0]} {k}",
        "type": t,
        "depot": did,
        "size": UNIT_TYPES[t]["size"],
        "status": "available",
        "assignment": None,
    }


def _default_state() -> dict:
    units = []
    for did, name, lat, lon, line, shelter, outreach in DEPOTS:
        for t, n in (("line", line), ("shelter", shelter), ("outreach", outreach)):
            for k in range(1, n + 1):
                units.append(_unit(did, name, t, k))
    return {
        "units": units,
        "stock": {did: {it[0]: v for it, v in zip(ITEMS, vals)} for did, vals in STOCK.items()},
        "targets": {it[0]: None for it in ITEMS},  # set by the responder; no default
        "log": [],
    }


class OpsState:
    """Crews, inventory, targets and a decision log. Sample data until a responder edits it."""

    def __init__(self, path: Path = STATE_PATH) -> None:
        self.path = path
        try:
            self.data = json.loads(path.read_text())
            if "units" not in self.data:
                raise ValueError
            self.data.setdefault("targets", {it[0]: None for it in ITEMS})
            self.data.pop("ratios", None)  # older saves carried planning ratios; the app no longer forecasts need
        except (OSError, ValueError, json.JSONDecodeError):
            self.data = _default_state()

    def save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.data))
        except OSError:
            pass

    def reset(self) -> None:
        self.data = _default_state()
        self.save()

    # -- units
    def units(self, kind: str | None = None, status: str | None = None) -> list[dict]:
        return [u for u in self.data["units"] if (kind is None or u["type"] == kind) and (status is None or u["status"] == status)]

    def set_count(self, depot: str, kind: str, count: int) -> None:
        depots = {d[0]: d for d in DEPOTS}
        if depot not in depots or kind not in UNIT_TYPES:
            raise KeyError("unknown depot or unit type")
        mine = [u for u in self.data["units"] if u["depot"] == depot and u["type"] == kind]
        count = max(0, min(count, 60))
        if count > len(mine):
            nxt = max([int(u["id"].split("-")[-1]) for u in mine] or [0])
            for k in range(len(mine), count):
                self.data["units"].append(_unit(depot, depots[depot][1], kind, nxt + k - len(mine) + 1))
        elif count < len(mine):
            idle = [u for u in mine if u["status"] == "available"]
            for u in idle[: len(mine) - count]:
                self.data["units"].remove(u)
        self.save()

    def set_status(self, unit_id: str, status: str) -> dict:
        if status not in STATUSES:
            raise ValueError("bad status")
        for u in self.data["units"]:
            if u["id"] == unit_id:
                u["status"] = status
                if status in ("available", "resting"):
                    u["assignment"] = None
                self.save()
                return u
        raise KeyError(unit_id)

    # -- inventory
    def set_stock(self, depot: str, item: str, qty: int) -> None:
        if depot not in self.data["stock"] or item not in self.data["targets"]:
            raise KeyError("unknown depot or item")
        self.data["stock"][depot][item] = max(0, qty)
        self.save()

    def set_target(self, item: str, target: int | None) -> None:
        if item not in self.data["targets"]:
            raise KeyError(item)
        self.data["targets"][item] = None if target is None else max(0, target)
        self.save()

    def log(self, when: str, kind: str, text: str) -> None:
        self.data["log"].append({"t": when, "kind": kind, "text": text})
        self.data["log"] = self.data["log"][-200:]
        self.save()

    def snapshot(self) -> dict:
        depots = []
        for did, name, lat, lon, *_ in DEPOTS:
            mine = [u for u in self.data["units"] if u["depot"] == did]
            depots.append(
                {
                    "id": did,
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "units": {t: sum(1 for u in mine if u["type"] == t) for t in UNIT_TYPES},
                    "available": {t: sum(1 for u in mine if u["type"] == t and u["status"] == "available") for t in UNIT_TYPES},
                    "stock": self.data["stock"][did],
                }
            )
        return {
            "sample": True,
            "note": "Sample crews, depots and inventory. Edit any number; the lists recalculate.",
            "depots": depots,
            "units": self.data["units"],
            "unit_types": {k: {"label": v["label"], "size": v["size"]} for k, v in UNIT_TYPES.items()},
            "items": [{"id": i, "label": l, "unit": u, "target": self.data["targets"][i]} for i, l, u in ITEMS],
            "log": self.data["log"][-30:],
        }


# ------------------------------------------------------------------ priorities


def inventory(ops: OpsState, engine) -> dict:
    """Stock against the targets the responder set. The app does not guess what a storm will need."""
    r = engine.last_result or {}
    pred, desc = r.get("predict", {}), r.get("describe", {})
    rows = []
    for iid, label, unit in ITEMS:
        have = sum(ops.data["stock"][d][iid] for d in ops.data["stock"])
        target = ops.data["targets"][iid]
        status = None if target is None else "ok" if have >= target else "low" if have >= 0.6 * target else "short"
        rows.append({"id": iid, "label": label, "unit": unit, "have": have, "target": target, "status": status, "below_by": max(0, target - have) if target is not None else 0})
    return {
        "items": rows,
        "context": {
            "customers_out": desc.get("out_total", 0),
            "customers_at_risk": pred.get("customers_exposed", 0),
            "seniors_at_risk": pred.get("seniors_exposed", 0),
        },
        "below_target": [i["label"] for i in rows if i["status"] in ("low", "short")],
    }


def compute(engine, ops: OpsState) -> dict:
    """Counties ranked for response, with the nearest available crew and travel time for each."""
    cands: list[Cand] = engine._cands
    counties = {c["fips"]: c for c in engine.counties}
    avail = ops.units("line", "available")
    depot_by = {d[0]: d for d in DEPOTS}
    priorities = []
    for c in sorted((c for c in cands if c.severe or c.tier >= 1), key=lambda c: -c.crew_value)[:60]:
        cty = counties[c.fips]
        cold = c.temp_f <= 34.0
        nearest = None
        if avail:
            u = min(avail, key=lambda u: _km(depot_by[u["depot"]][2], depot_by[u["depot"]][3], cty["lat"], cty["lon"]))
            d = depot_by[u["depot"]]
            km = _km(d[2], d[3], cty["lat"], cty["lon"])
            nearest = {"depot": d[1], "distance_km": round(km), "eta_min": eta_minutes(km, cold)}
        now = c.severe
        start_h = 0 if now else _window_start_h(WINDOW_NAMES[c.window])
        priorities.append(
            {
                "fips": c.fips,
                "county": c.name,
                "status": "out" if c.severe else ("act", "prepare", "watch")[3 - c.tier] if c.tier else "watch",
                "risk": round(c.p24, 3),
                "p6": round(c.p6, 3),
                "p12": round(c.p12, 3),
                "window": "now" if now else WINDOW_NAMES[c.window],
                "out": c.out,
                "seniors_exposed": round(c.senior_exposure),
                "pop": c.pop,
                "temp_f": round(c.temp_f),
                "reasons": [r["text"] for r in c.reasons[:2]],
                "nearest": nearest,
                "depart_by_min": 0 if now or not nearest else max(0, start_h * 60 - nearest["eta_min"]),
                "urgency": "now" if now or start_h == 0 else "soon",
            }
        )
    totals = {
        t: {s: sum(1 for u in ops.units(t) if u["status"] == s) for s in STATUSES} | {"total": len(ops.units(t))}
        for t in UNIT_TYPES
    }
    return {
        "priorities": priorities,
        "totals": totals,
        "staging": staging(engine, cands),
        "inventory": inventory(ops, engine),
    }


def staging(engine, cands: list[Cand]) -> dict:
    """Where to add a forward staging yard: the sites that most cut average travel time to the
    counties that rank highest, compared with serving them from the existing depots alone."""
    weights = {c.fips: c.crew_value for c in cands if (c.severe or c.tier >= 1) and c.crew_value > 0}
    if not weights:
        return {"sites": [], "baseline_eta_min": None}
    counties = {c["fips"]: c for c in engine.counties}
    cold = {c.fips: c.temp_f <= 34.0 for c in cands}
    total = sum(weights.values())

    def eta(lat: float, lon: float, f: str) -> int:
        return eta_minutes(_km(lat, lon, counties[f]["lat"], counties[f]["lon"]), cold.get(f, False))

    current = {f: min(eta(d[2], d[3], f) for d in DEPOTS) for f in weights}
    baseline = sum(w * current[f] for f, w in weights.items()) / total

    sites = [{"name": d[1] + " depot", "kind": "depot", "lat": d[2], "lon": d[3]} for d in DEPOTS]
    top_pop = sorted(engine.counties, key=lambda c: -c["pop"])[:60]
    sites += [{"name": c["name"] + " County", "kind": "county", "lat": c["lat"], "lon": c["lon"]} for c in top_pop]
    picked = []
    for _ in range(3):
        best, best_avg = None, None
        for st in sites:
            if st in picked:
                continue
            avg = sum(w * min(current[f], eta(st["lat"], st["lon"], f)) for f, w in weights.items()) / total
            if best_avg is None or avg < best_avg:
                best, best_avg = st, avg
        if best is None:
            break
        before = sum(w * current[f] for f, w in weights.items()) / total
        for f in weights:
            current[f] = min(current[f], eta(best["lat"], best["lon"], f))
        picked.append({**best, "avg_eta_min": round(best_avg), "saves_min": round(before - best_avg)})
    return {"sites": picked, "baseline_eta_min": round(baseline)}


# -------------------------------------------------------------------- dispatch


def commit(engine, ops: OpsState, orders: list[dict]) -> dict:
    """Send the units the responder chose: the nearest available of each kind, per county.
    Returns work orders to share, and where fewer units were free than asked for."""
    cands = {c.fips: c for c in engine._cands}
    counties = {c["fips"]: c for c in engine.counties}
    depot_by = {d[0]: d for d in DEPOTS}
    when_raw = (engine.last_result or {}).get("t", "")
    sent, work_orders, short = 0, [], []
    for o in orders:
        fips = o["fips"]
        cty = counties.get(fips)
        if not cty:
            continue
        cand = cands.get(fips)
        cold = bool(cand and cand.temp_f <= 34.0)
        for kind in UNIT_TYPES:
            want = int(o.get(kind, 0) or 0)
            got = 0
            for _ in range(want):
                free = ops.units(kind, "available")
                if not free:
                    break
                u = min(free, key=lambda u: _km(depot_by[u["depot"]][2], depot_by[u["depot"]][3], cty["lat"], cty["lon"]))
                d = depot_by[u["depot"]]
                km = _km(d[2], d[3], cty["lat"], cty["lon"])
                eta = eta_minutes(km, cold)
                severe = bool(cand and cand.severe)
                start_h = 0 if severe or not cand else _window_start_h(WINDOW_NAMES[cand.window])
                a = {
                    "unit_id": u["id"], "unit_name": u["name"], "size": u["size"], "depot": d[1], "fips": fips,
                    "county": cty["name"], "lat": cty["lat"], "lon": cty["lon"], "distance_km": round(km), "eta_min": eta,
                    "depart_by_min": 0 if severe else max(0, start_h * 60 - eta),
                    "window": "now" if severe or not cand else WINDOW_NAMES[cand.window],
                    "urgency": "now" if severe or start_h == 0 else "soon",
                    "status": "out" if severe else "forecast", "risk": cand.p24 if cand else 0.0,
                }
                u["status"] = "en_route"
                u["assignment"] = {k: a[k] for k in ("fips", "county", "eta_min", "depart_by_min", "window", "urgency")}
                work_orders.append(work_order(a))
                got += 1
                sent += 1
            if got < want:
                short.append({"fips": fips, "county": cty["name"], "type": kind, "requested": want, "assigned": got})
    if sent:
        ops.log(when_raw, "dispatch", f"Sent {sent} units to {len({w['county'] for w in work_orders})} counties")
    ops.save()
    return {"dispatched": sent, "work_orders": work_orders, "short": short}


def work_order(a: dict) -> dict:
    depart = "leave now" if a["depart_by_min"] == 0 else f"leave within {a['depart_by_min'] // 60} h {a['depart_by_min'] % 60:02d} min"
    maps = f"https://www.google.com/maps/dir/?api=1&destination={a['lat']},{a['lon']}"
    why = "power already out" if a["status"] == "out" else f"outage risk {round(a['risk'] * 100)}% in 24 h"
    text = (
        f"WORK ORDER · {a['unit_name']} ({a['size']} workers)\n"
        f"Go to: {a['county']} County · about {a['distance_km']} km, travel {a['eta_min']} min\n"
        f"When: {depart} ({a['window']})\n"
        f"Why: {why}\n"
        f"Navigate: {maps}"
    )
    return {"unit_id": a["unit_id"], "unit_name": a["unit_name"], "county": a["county"], "text": text, "maps_url": maps}


def sitrep(engine, ops: OpsState, plan: dict) -> str:
    """One-page handoff brief for the next shift, as markdown."""
    r = engine.last_result or {}
    p, d = r.get("predict", {}), r.get("describe", {})
    grid = r.get("diagnose", {}).get("state", {})
    lines = [
        f"# Situation report · {stamp(r.get('t', ''))}",
        "",
        "## Where we stand",
        f"- Customers without power: {d.get('out_total', 0):,} in {d.get('severe_now', 0)} severe counties (peak {d.get('peak', {}).get('out', 0):,})",
        f"- Next 24 h: about {p.get('expected_onsets', [0, 0, 0])[2]:.0f} more counties likely to hit severe outages; "
        f"{p.get('customers_exposed', 0):,} customers and {p.get('seniors_exposed', 0):,} seniors in those counties; peak window {p.get('peak_window', '')}",
        f"- Statewide {grid.get('temp_f_mean', 0):.0f} F",
        "",
        "## Highest priority counties",
    ]
    for c in plan["priorities"][:6]:
        near = c["nearest"]
        lines.append(
            f"- {c['county']}: {'power out' if c['status'] == 'out' else str(round(c['risk'] * 100)) + '% risk, ' + c['window']}"
            + (f"; nearest crew {near['depot']}, travel {near['eta_min']} min" if near else "")
        )
    if not plan["priorities"]:
        lines.append("- None right now")
    lines += ["", "## Out in the field"]
    en = [u for u in ops.units() if u["status"] in ("en_route", "on_site") and u["assignment"]]
    lines += [f"- {u['name']} -> {u['assignment']['county']} County ({u['status'].replace('_', ' ')})" for u in en] or ["- No units out"]
    inv = plan["inventory"]
    lines += ["", "## Inventory", f"- Below the targets we set: {', '.join(inv['below_target']) if inv['below_target'] else 'none (or no targets set)'}"]
    st = plan["staging"]["sites"]
    if st:
        lines += ["", "## Staging", f"- Candidate forward yard: {st[0]['name']} (average travel falls from {plan['staging']['baseline_eta_min']} to {st[0]['avg_eta_min']} min)"]
    lines += ["", "## Decisions log"] + [f"- {stamp(x['t'])}: {x['text']}" for x in ops.data["log"][-8:]]
    lines += ["", "_Crew and inventory figures are sample data unless edited. Forecasts are model output from weather and outage data, not certainty. How many crews and how much material to commit is the responders' call._"]
    return "\n".join(lines)
