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
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import explain
from .features import FEATURES
from .replay import DEFAULT_MODEL, Session, available, load_bundle, load_model

ROOT = Path(__file__).resolve().parents[2]
WEB_DIST = ROOT / "web" / "dist"
BENCH_RESULTS = ROOT / "bench" / "results"

SCENARIO_TITLES = {
    "uri": "Winter Storm Uri (Feb 2021)",
    "elliott": "Winter Storm Elliott (Dec 2022)",
    "ice2023": "February 2023 ice storm",
    "heat2023": "August 2023 heat dome",
}


class StartConfig(BaseModel):
    scenario: str = "uri"
    model: str | None = Field(default=None, description="honest or final; default is the honest model")
    speed: float = Field(default=12.0, gt=0, le=240, description="Replay hours per second")


class SpeedConfig(BaseModel):
    speed: float = Field(gt=0, le=240)


class SeekConfig(BaseModel):
    i: int = Field(ge=0)


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
        self.session: Session | None = None
        self.speed = 12.0
        self.task: asyncio.Task | None = None

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

    async def run(self) -> None:
        tick, carry = 0.1, 0.0
        while self.session and not self.session.done:
            carry += self.speed * tick
            n, carry = int(carry), carry - int(carry)
            for _ in range(n):
                res = self.session.step()
                if res is None:
                    break
                self.hub.publish(json.dumps(res, separators=(",", ":")))
            await asyncio.sleep(tick)
        self.hub.publish(json.dumps({"type": "end", **{**self.status(), "running": False}}))

    def stop(self) -> None:
        if self.task:
            self.task.cancel()
            self.task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.s = AppState()
    yield
    app.state.s.stop()


app = FastAPI(title="Uri Watch", lifespan=lifespan)


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
    out = []
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
    for name in ("honest", "final"):
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
    try:
        s.session = Session(cfg.scenario, cfg.model)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, "unknown scenario or model")
    s.speed = cfg.speed
    s.task = asyncio.create_task(s.run())
    s.hub.publish(json.dumps({"type": "reset", **s.status()}))
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
    was = s.running
    s.stop()
    s.session.seek(cfg.i)
    s.hub.publish(json.dumps({"type": "reset", **s.status()}))
    if was and not s.session.done:
        s.task = asyncio.create_task(s.run())
    return s.status()


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
            return {
                "county": cty,
                "risk": round(eng.last_risk[c], 4),
                "reasons": explain(eng.model, x, top=5),
                "contributions": {f: round(v, 3) for f, v in zip(FEATURES, contribs)},
            }
    raise HTTPException(404, "unknown county")


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    hub = _s(request).hub
    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    hub.subscribers.add(q)

    async def stream():
        try:
            yield "retry: 2000\n\n"
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


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
