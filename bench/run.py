"""Latency and throughput benchmark. Run it on a laptop and on LinuxONE.

    python bench/run.py engine --n 100000 --procs 4
    python bench/run.py http --url http://127.0.0.1:8000 --n 5000 --concurrency 32

Results are saved to bench/results/<label>-<machine>-<mode>.json and shown on
the dashboard's Benchmark tab.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing as mp
import os
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from scamstopper.engine import Engine  # noqa: E402
from scamstopper.model import LogisticModel  # noqa: E402
from scamstopper.sim import Simulator  # noqa: E402

RESULTS = ROOT / "bench" / "results"


def pct(vals: list[float], q: float) -> float:
    return vals[min(len(vals) - 1, int(q * len(vals)))] if vals else 0.0


def summarize(lat_ms: list[float], elapsed: float, n: int) -> dict:
    lat = sorted(lat_ms)
    return {
        "n": n,
        "elapsed_s": round(elapsed, 3),
        "tps": round(n / elapsed, 1),
        "p50_ms": round(pct(lat, 0.50), 4),
        "p95_ms": round(pct(lat, 0.95), 4),
        "p99_ms": round(pct(lat, 0.99), 4),
        "max_ms": round(lat[-1], 4) if lat else 0.0,
    }


def _engine_worker(args: tuple[int, int]) -> tuple[list[float], float]:
    seed, n = args
    sim = Simulator(seed=seed)
    engine = Engine(LogisticModel.load())
    engine.warm(sim.warmup())
    txns = [sim.next() for _ in range(n)]
    lat = []
    t0 = time.perf_counter()
    for t in txns:
        s = time.perf_counter()
        engine.score(t)
        lat.append((time.perf_counter() - s) * 1000.0)
    return lat, time.perf_counter() - t0


def run_engine(n: int, procs: int) -> dict:
    per = n // procs
    if procs == 1:
        results = [_engine_worker((100, per))]
    else:
        with mp.get_context("spawn").Pool(procs) as pool:
            results = pool.map(_engine_worker, [(100 + i, per) for i in range(procs)])
    lat = [x for r, _ in results for x in r]
    # Workers run in parallel, so wall time is the slowest worker.
    return {**summarize(lat, max(e for _, e in results), per * procs), "procs": procs}


async def run_http(url: str, n: int, concurrency: int) -> dict:
    import httpx

    sim = Simulator(seed=200)
    payloads = [sim.next().model_dump() for _ in range(n)]
    lat: list[float] = []
    queue: asyncio.Queue = asyncio.Queue()
    for p in payloads:
        queue.put_nowait(p)

    async with httpx.AsyncClient(base_url=url, timeout=30) as client:
        async def worker() -> None:
            while not queue.empty():
                p = queue.get_nowait()
                s = time.perf_counter()
                r = await client.post("/api/score", json=p)
                r.raise_for_status()
                lat.append((time.perf_counter() - s) * 1000.0)

        t0 = time.perf_counter()
        await asyncio.gather(*(worker() for _ in range(concurrency)))
        elapsed = time.perf_counter() - t0
    return {**summarize(lat, elapsed, n), "concurrency": concurrency}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["engine", "http"])
    ap.add_argument("--n", type=int, default=50000)
    ap.add_argument("--procs", type=int, default=1, help="engine mode: parallel processes")
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--concurrency", type=int, default=16)
    ap.add_argument("--label", default=None, help="e.g. linuxone or laptop")
    args = ap.parse_args()

    if args.mode == "engine":
        res = run_engine(args.n, max(1, args.procs))
    else:
        res = asyncio.run(run_http(args.url, args.n, args.concurrency))

    machine = platform.machine()
    label = args.label or ("linuxone" if machine == "s390x" else "laptop")
    out = {
        "label": label,
        "mode": args.mode,
        "machine": machine,
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpus": os.cpu_count(),
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        **res,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    width = f"p{res['procs']}" if args.mode == "engine" else f"c{res['concurrency']}"
    path = RESULTS / f"{label}-{machine}-{args.mode}-{width}.json"
    path.write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    print(f"saved {path}")


if __name__ == "__main__":
    main()
