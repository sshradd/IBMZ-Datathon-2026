"""HTTP API: scoring, live event stream (SSE), stats, simulator control.

    uvicorn scamstopper.api:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import random
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import Engine
from .model import MODEL_PATH, LogisticModel
from .models import Decision, Txn
from .sim import Simulator

ROOT = Path(__file__).resolve().parents[2]
WEB_DIST = ROOT / "web" / "dist"
BENCH_RESULTS = ROOT / "bench" / "results"


class SimConfig(BaseModel):
    speed: float = Field(default=10.0, gt=0, le=5000, description="Transactions per second")
    fraud_rate: float = Field(default=0.02, ge=0, le=0.5)


class Hub:
    """Fan-out of scored events to every connected dashboard."""

    def __init__(self) -> None:
        self.subscribers: set[asyncio.Queue] = set()

    def publish(self, msg: str) -> None:
        for q in list(self.subscribers):
            if q.full():
                q.get_nowait()
            q.put_nowait(msg)


class AppState:
    def __init__(self) -> None:
        if not MODEL_PATH.exists():
            raise RuntimeError("backend/model.json missing: run `python -m scamstopper.train` first")
        self.engine = Engine(LogisticModel.load())
        self.hub = Hub()
        self.config = SimConfig()
        self.sim_task: asyncio.Task | None = None
        self.sim = self._new_sim()

    def _new_sim(self) -> Simulator:
        sim = Simulator(seed=random.randrange(1_000_000), fraud_rate=self.config.fraud_rate)
        self.engine.warm(sim.warmup())
        return sim

    def reset(self) -> None:
        self.engine.reset()
        self.sim = self._new_sim()

    def handle(self, txn: Txn, decision: Decision) -> None:
        # Dashboards can't render thousands of rows a second: always send
        # flagged payments, sample the allowed ones at high speed.
        if decision.action == "allow" and self.config.speed > 30:
            if random.random() > 30 / self.config.speed:
                return
        self.hub.publish(json.dumps({"txn": txn.model_dump(), "decision": decision.model_dump()}))

    async def run_sim(self) -> None:
        tick, carry = 0.1, 0.0
        while True:
            carry += self.config.speed * tick
            n, carry = int(carry), carry - int(carry)
            self.sim.fraud_rate = self.config.fraud_rate
            for _ in range(n):
                txn = self.sim.next()
                self.handle(txn, self.engine.score(txn))
            await asyncio.sleep(tick)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.s = AppState()
    yield
    if app.state.s.sim_task:
        app.state.s.sim_task.cancel()


app = FastAPI(title="Scam Stopper", lifespan=lifespan)


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


# async on purpose: scoring runs on the event loop, same thread as the
# simulator, so the engine's state is never touched by two threads at once.
@app.post("/api/score", response_model=Decision)
async def score(txn: Txn, request: Request) -> Decision:
    s = _s(request)
    decision = s.engine.score(txn)
    s.handle(txn, decision)
    return decision


@app.get("/api/stats")
def stats(request: Request) -> dict:
    s = _s(request)
    return {
        **s.engine.stats.snapshot(),
        "running": bool(s.sim_task and not s.sim_task.done()),
        "config": s.config.model_dump(),
        "model": s.engine.model.metrics,
    }


@app.get("/api/graph")
def graph(request: Request) -> dict:
    return _s(request).engine.rings.snapshot()


@app.post("/api/sim/start")
async def sim_start(cfg: SimConfig, request: Request) -> dict:
    s = _s(request)
    s.config = cfg
    if not (s.sim_task and not s.sim_task.done()):
        s.sim_task = asyncio.create_task(s.run_sim())
    return {"running": True, "config": cfg.model_dump()}


@app.post("/api/sim/stop")
async def sim_stop(request: Request) -> dict:
    s = _s(request)
    if s.sim_task:
        s.sim_task.cancel()
        s.sim_task = None
    return {"running": False}


@app.post("/api/sim/reset")
async def sim_reset(request: Request) -> dict:
    await sim_stop(request)
    _s(request).reset()
    return {"reset": True}


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    hub = _s(request).hub
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
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
