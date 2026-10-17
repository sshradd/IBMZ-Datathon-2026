"""HTTP API: storm replay control, live event stream (SSE), model facts.

    uvicorn uriwatch.api:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import TIER_NAMES, explain
from .features import FEATURES, GROUPS
from .model import WINDOWS
from . import ops as opsmod
from .live import config as live_config
from .live.session import LiveSession
from .replay import DEFAULT_MODEL, Session, available, load_bundle, load_model

ROOT = Path(__file__).resolve().parents[2]
# The responder console (Next.js static export) when built, otherwise the analyst dashboard.
WEB_DIST = ROOT / "responder" / "out" if (ROOT / "responder" / "out").exists() else ROOT / "web" / "dist"
BENCH_RESULTS = ROOT / "bench" / "results"

MODEL_NAMES = ("honest", "final", "live_honest", "live_final")

SCENARIO_TITLES = {
    "live": "Live now (ERCOT, NWS, Open-Meteo)",
    "uri": "Winter Storm Uri (Feb 2021)",
    "elliott": "Winter Storm Elliott (Dec 2022)",
    "ice2023": "February 2023 ice storm",
    "heat2023": "August 2023 heat dome",
}


class StartConfig(BaseModel):
    scenario: str = "uri"
    model: str | None = Field(default=None, description="honest, final, live_honest or live_final; default depends on the scenario")
    speed: float = Field(default=12.0, gt=0, le=240, description="Replay hours per second")


class SpeedConfig(BaseModel):
    speed: float = Field(gt=0, le=240)


class SeekConfig(BaseModel):
    i: int = Field(ge=0)


class PlanConfig(BaseModel):
    crews: int = Field(default=40, ge=0, le=200)
    centers: int = Field(default=15, ge=0, le=100)
    callers: int = Field(default=25, ge=0, le=200)


class Hub:
    """Fan-out of scored hours to every connected dashboard."""

    def __init__(self) -> None:
        self.subscribers: set[asyncio.Queue] = set()

    def publish(self, msg: str) -> None:
        for q in list(self.subscribers):
            if q.full():
                q.get_nowait()
            q.put_nowait(msg)


class AppState:
    def __init__(self) -> None:
        self.hub = Hub()
        self.session: Session | LiveSession | None = None
        self.speed = 12.0
        self.task: asyncio.Task | None = None
        self.last_msg: str | None = None  # sent to dashboards that connect mid-run
        self.last_hour: str | None = None  # the latest forecast hour, kept even when a status message follows it
        self.ops = opsmod.OpsState()

    def publish(self, msg: str, remember: bool = True, hour: bool = False, reset: bool = False) -> None:
        """`hour` marks a forecast hour (kept for pages that connect while paused); `reset` starts a new session."""
        self.last_msg = msg if remember else None
        if reset:
            self.last_hour = None
        elif hour:
            self.last_hour = msg
        self.hub.publish(msg)

    @property
    def is_live(self) -> bool:
        return isinstance(self.session, LiveSession)

    @property
    def running(self) -> bool:
        return bool(self.task and not self.task.done())

    def status(self) -> dict:
        s = self.session
        return {
            "running": self.running,
            "scenario": s.key if s else None,
            "title": SCENARIO_TITLES.get(s.key, s.key) if s else None,
            "model": s.model_name if s else None,
            "i": s.i if s else 0,
            "n": s.n if s else 0,
            "speed": self.speed,
        }

    async def run_live(self) -> None:
        """Poll the public APIs and score every county, forever. The network call runs in a thread
        so the event loop (and the dashboard stream) never blocks on it."""
        loop = asyncio.get_running_loop()
        while isinstance(self.session, LiveSession):
            try:
                res = await loop.run_in_executor(None, self.session.step)
                self.publish(json.dumps(res, separators=(",", ":")), hour=True)
            except Exception as e:  # a failed poll must not kill the loop
                self.hub.publish(json.dumps({"type": "error", "message": str(e)[:200]}))
            await asyncio.sleep(live_config.POLL_SECONDS)

    async def run(self) -> None:
        if self.is_live:
            await self.run_live()
            return
        tick, carry = 0.1, 0.0
        while self.session and not self.session.done:
            carry += self.speed * tick
            n, carry = int(carry), carry - int(carry)
            for _ in range(n):
                res = self.session.step()
                if res is None:
                    break
                self.publish(json.dumps(res, separators=(",", ":")), hour=True)
            await asyncio.sleep(tick)
        self.publish(json.dumps({"type": "end", **{**self.status(), "running": False}}), remember=False)

    def stop(self) -> None:
        if self.task:
            self.task.cancel()
            self.task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.s = AppState()
    if os.environ.get("URIWATCH_LIVE") == "1":  # serve live data with no dashboard open
        st = app.state.s
        st.session = LiveSession()
        st.task = asyncio.create_task(st.run())
    yield
    app.state.s.stop()


app = FastAPI(title="Uri Watch", lifespan=lifespan)
# `next dev` runs on :3000 and calls this server on another port.
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["*"], allow_headers=["*"])


def _s(request: Request) -> AppState:
    return request.app.state.s


@app.get("/api/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/api/system")
def system() -> dict:
    """Where this is running. Screenshot this on LinuxONE as evidence."""
    return {
        "machine": platform.machine(),
        "platform": platform.platform(),
        "byteorder": sys.byteorder,
        "python": platform.python_version(),
        "cpus": os.cpu_count(),
        "hostname": socket.gethostname(),
        "is_ibm_z": platform.machine() == "s390x",
    }


@app.get("/api/scenarios")
def scenarios() -> list[dict]:
    out = [
        {
            "key": "live",
            "title": SCENARIO_TITLES["live"],
            "hours": 0,
            "start": "",
            "end": "",
            "default_model": "live_final",
        }
    ]
    for key in available():
        b = load_bundle(key)
        out.append(
            {
                "key": key,
                "title": SCENARIO_TITLES.get(key, b["title"]),
                "hours": len(b["hours"]),
                "start": b["hours"][0]["t"],
                "end": b["hours"][-1]["t"],
                "default_model": DEFAULT_MODEL.get(key, "honest"),
            }
        )
    return out


@app.get("/api/counties")
def counties(scenario: str = "uri") -> list[dict]:
    try:
        return load_bundle(scenario)["counties"]
    except KeyError:
        raise HTTPException(404, "unknown scenario")


@app.get("/api/models")
def models() -> dict:
    out = {}
    for name in MODEL_NAMES:
        try:
            m = load_model(name)
        except FileNotFoundError:
            continue
        out[name] = {"tiers": m.tiers, "metrics": m.metrics}
    return out


@app.get("/api/state")
def state(request: Request) -> dict:
    return _s(request).status()


@app.post("/api/replay/start")
async def replay_start(cfg: StartConfig, request: Request) -> dict:
    s = _s(request)
    s.stop()
    if cfg.model is not None and cfg.model not in MODEL_NAMES:
        raise HTTPException(404, "unknown model")
    try:
        s.session = LiveSession(cfg.model) if cfg.scenario == "live" else Session(cfg.scenario, cfg.model)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, "unknown scenario or model")
    s.speed = cfg.speed
    s.task = asyncio.create_task(s.run())
    s.publish(json.dumps({"type": "reset", **s.status()}), remember=False, reset=True)
    return s.status()


@app.post("/api/replay/pause")
async def replay_pause(request: Request) -> dict:
    s = _s(request)
    s.stop()
    return s.status()


@app.post("/api/replay/resume")
async def replay_resume(request: Request) -> dict:
    s = _s(request)
    if s.session and not s.session.done and not s.running:
        s.task = asyncio.create_task(s.run())
    return s.status()


@app.post("/api/replay/speed")
async def replay_speed(cfg: SpeedConfig, request: Request) -> dict:
    s = _s(request)
    s.speed = cfg.speed
    return s.status()


@app.post("/api/replay/seek")
async def replay_seek(cfg: SeekConfig, request: Request) -> dict:
    s = _s(request)
    if not s.session:
        raise HTTPException(409, "no replay running")
    if s.is_live:
        raise HTTPException(409, "live mode cannot seek")
    was = s.running
    s.stop()
    s.session.seek(max(cfg.i - 1, 0))
    s.publish(json.dumps({"type": "reset", **s.status()}), remember=False, reset=True)
    res = s.session.step()  # show the hour you landed on, also while paused
    if res is not None:
        s.publish(json.dumps(res, separators=(",", ":")), hour=True)
    if was and not s.session.done:
        s.task = asyncio.create_task(s.run())
    return s.status()


@app.post("/api/plan")
def plan(cfg: PlanConfig, request: Request) -> dict:
    """What-if: re-run the deployment planner on the current hour with different resource levels."""
    s = _s(request)
    if not s.session or not s.session.engine.last_x:
        raise HTTPException(409, "no replay running")
    return s.session.engine.replan(cfg.model_dump())


@app.get("/api/explain/{fips}")
def explain_county(fips: str, request: Request) -> dict:
    """Why the current score for one county, from the last scored hour."""
    s = _s(request)
    if not s.session or not s.session.engine.last_x:
        raise HTTPException(409, "no replay running")
    eng = s.session.engine
    for c, cty in enumerate(eng.counties):
        if cty["fips"] == fips:
            x = eng.last_x[c]
            contribs = eng.model.contributions(x)
            p6, p12, p24 = eng.model.risks(x)
            return {
                "county": cty,
                "risk": round(p24, 4),
                "p6": round(p6, 4),
                "p12": round(p12, 4),
                "p24": round(p24, 4),
                "window": WINDOWS[eng.model.window(p6, p12, p24)],
                "tier": TIER_NAMES[eng.model.tier(p24)],
                "reasons": explain(eng.model, x, top=5),
                "groups": {
                    g: {"label": GROUPS[g][0], "push": round(v, 3)}
                    for g, v in eng.model.group_contributions(contribs).items()
                },
                "contributions": {f: round(v, 3) for f, v in zip(FEATURES, contribs)},
            }
    raise HTTPException(404, "unknown county")


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    hub = _s(request).hub
    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    hub.subscribers.add(q)

    first = _s(request).last_hour
    status = _s(request).last_msg if _s(request).last_msg is not first else None

    async def stream():
        try:
            yield "retry: 2000\n\n"
            if first:  # a dashboard that connects mid-run starts from the latest hour, even if the replay is paused
                yield f"data: {first}\n\n"
            if status:
                yield f"data: {status}\n\n"
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=10)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            hub.subscribers.discard(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/bench")
def bench_results() -> list[dict]:
    if not BENCH_RESULTS.exists():
        return []
    out = []
    for f in sorted(BENCH_RESULTS.glob("*.json")):
        try:
            out.append(json.loads(f.read_text()))
        except json.JSONDecodeError:
            continue
    return out




# ------------------------------------------------------------------ operations API
# Crews, depots and inventory (sample data until edited) and the dispatch plan built on the forecast.


class UnitCount(BaseModel):
    depot: str
    type: str
    count: int = Field(ge=0, le=60)


class StockEdit(BaseModel):
    depot: str
    item: str
    qty: int = Field(ge=0)


class TargetEdit(BaseModel):
    item: str
    target: int | None = Field(default=None, ge=0, description="How many the responder wants on hand; null clears it")


class StatusEdit(BaseModel):
    status: str


class Order(BaseModel):
    fips: str
    line: int = Field(default=0, ge=0, le=60)
    shelter: int = Field(default=0, ge=0, le=60)
    outreach: int = Field(default=0, ge=0, le=60)


class DispatchRequest(BaseModel):
    orders: list[Order] = Field(description="How many of each unit to send to which county: the responder's call")


class UndoRequest(BaseModel):
    fips: list[str] | None = Field(default=None, description="Only these counties; omit to recall everything en route")


def _engine(request: Request):
    s = _s(request)
    if not s.session or not s.session.engine.last_result:
        raise HTTPException(409, "no forecast yet: start a storm replay or live mode first")
    return s.session.engine


@app.get("/api/ops/state")
def ops_state(request: Request) -> dict:
    return _s(request).ops.snapshot()


@app.put("/api/ops/units")
def ops_units(cfg: UnitCount, request: Request) -> dict:
    try:
        _s(request).ops.set_count(cfg.depot, cfg.type, cfg.count)
    except KeyError as e:
        raise HTTPException(404, str(e))
    return _s(request).ops.snapshot()


@app.post("/api/ops/units/{unit_id}/status")
def ops_unit_status(unit_id: str, cfg: StatusEdit, request: Request) -> dict:
    try:
        return _s(request).ops.set_status(unit_id, cfg.status)
    except KeyError:
        raise HTTPException(404, "unknown unit")
    except ValueError:
        raise HTTPException(422, f"status must be one of {list(opsmod.STATUSES)}")


@app.put("/api/ops/inventory")
def ops_inventory(cfg: StockEdit, request: Request) -> dict:
    try:
        _s(request).ops.set_stock(cfg.depot, cfg.item, cfg.qty)
    except KeyError as e:
        raise HTTPException(404, str(e))
    return _s(request).ops.snapshot()


@app.put("/api/ops/targets")
def ops_targets(cfg: TargetEdit, request: Request) -> dict:
    try:
        _s(request).ops.set_target(cfg.item, cfg.target)
    except KeyError:
        raise HTTPException(404, "unknown item")
    return _s(request).ops.snapshot()


@app.post("/api/ops/reset")
def ops_reset(request: Request) -> dict:
    _s(request).ops.reset()
    return _s(request).ops.snapshot()


@app.get("/api/ops/plan")
def ops_plan(request: Request) -> dict:
    """Counties ranked for response with the nearest crew and travel time, staging sites, and inventory against your targets."""
    return opsmod.compute(_engine(request), _s(request).ops)


@app.post("/api/ops/dispatch")
def ops_dispatch(cfg: DispatchRequest, request: Request) -> dict:
    """Send the units the responder chose to the counties they chose; returns shareable work orders."""
    return opsmod.commit(_engine(request), _s(request).ops, [o.model_dump() for o in cfg.orders])


@app.post("/api/ops/undo")
def ops_undo(cfg: UndoRequest, request: Request) -> dict:
    """Take back a dispatch: units go back to available."""
    ops = _s(request).ops
    n = 0
    for u in ops.units():
        a = u["assignment"]
        if u["status"] == "en_route" and a and (cfg.fips is None or a["fips"] in cfg.fips):
            u["status"], u["assignment"] = "available", None
            n += 1
    if n:
        ops.log((_engine(request).last_result or {}).get("t", ""), "undo", f"Recalled {n} units")
    ops.save()
    return {"recalled": n}


@app.get("/api/ops/sitrep")
def ops_sitrep(request: Request) -> dict:
    eng, ops = _engine(request), _s(request).ops
    return {"markdown": opsmod.sitrep(eng, ops, opsmod.compute(eng, ops))}


# ------------------------------------------------------------------ live data API
# Real-time data and forecasts as a plain JSON API, for the dashboard or anything else.
# Start it with POST /api/replay/start {"scenario": "live"}, or run the server with URIWATCH_LIVE=1.


def _live(request: Request) -> LiveSession:
    s = _s(request)
    if not s.is_live or s.session.latest is None:
        raise HTTPException(
            409,
            'live mode is not running yet: POST /api/replay/start {"scenario": "live"} (or start the server with URIWATCH_LIVE=1)',
        )
    return s.session


@app.get("/api/live/status")
def live_status(request: Request) -> dict:
    s = _s(request)
    live = s.session if s.is_live else None
    return {
        "running": bool(live and s.running),
        "model": live.model_name if live else None,
        "polls": live.i if live else 0,
        "as_of": live.latest["as_of"] if live and live.latest else None,
        "poll_seconds": live_config.POLL_SECONDS,
        "sources": live.latest["sources"] if live and live.latest else [],
        "outage_feed": False,
        "note": "No free live county outage feed exists, so the live model forecasts from weather, grid telemetry and county profile.",
    }


@app.get("/api/live/forecast")
def live_forecast(request: Request, min_tier: str = "clear") -> dict:
    """Outage-risk forecast for every Texas county: chance of a severe outage within 6, 12 and 24 hours."""
    live = _live(request)
    res, eng = live.latest, live.engine
    order = ["clear", "watch", "prepare", "act"]
    if min_tier not in order:
        raise HTTPException(422, f"min_tier must be one of {order}")
    alerts = (res["alerts"] or {}).get("by_fips", {})
    out = []
    for c, cty in enumerate(eng.counties):
        p24, tier, _, p6, p12 = res["counties"][c]
        if tier < order.index(min_tier):
            continue
        out.append(
            {
                "fips": cty["fips"],
                "name": cty["name"],
                "p6": p6,
                "p12": p12,
                "p24": p24,
                "tier": order[tier],
                "window": WINDOWS[eng.model.window(p6, p12, p24)],
                "population": cty["pop"],
                "seniors": cty["pop65"],
                "reasons": [r["text"] for r in explain(eng.model, eng.last_x[c], 3)] if tier else [],
                "nws_alerts": alerts.get(cty["fips"], []),
            }
        )
    out.sort(key=lambda r: -r["p24"])
    return {
        "as_of": res["as_of"],
        "model": live.model_name,
        "definition": "severe outage = at least 10% of a county's customers and at least 2,500 customers without power",
        "tiers": eng.model.tiers,
        "counties": out,
    }


@app.get("/api/live/grid")
def live_grid(request: Request) -> dict:
    """Current ERCOT demand, generation and demand forecast, and how the feeds are doing."""
    live = _live(request)
    r = live.latest
    return {"as_of": r["as_of"], "grid": r["grid"], "detail": r["grid_detail"], "state": r["diagnose"]["state"], "sources": r["sources"]}


@app.get("/api/live/alerts")
def live_alerts(request: Request) -> dict:
    """Active National Weather Service watches, warnings and advisories for Texas."""
    live = _live(request)
    return live.latest["alerts"] or {"count": 0, "events": [], "by_fips": {}}


@app.get("/api/live/plan")
def live_plan(request: Request, crews: int = 40, centers: int = 15, callers: int = 25) -> dict:
    """Recommended deployment and moves for the current live forecast."""
    live = _live(request)
    return live.engine.replan({"crews": crews, "centers": centers, "callers": callers})


# Keep this last: the static mount catches every path that no route above claimed.
ANALYST_DIST = ROOT / "web" / "dist"
if WEB_DIST != ANALYST_DIST and ANALYST_DIST.exists():  # the analyst dashboard: diagnostics, evidence, replays
    app.mount("/analyst", StaticFiles(directory=ANALYST_DIST, html=True), name="analyst")
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
