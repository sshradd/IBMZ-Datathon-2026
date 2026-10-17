"""Latency and throughput benchmark. Run it on a laptop and on LinuxONE.

    python bench/run.py engine --hours 408 --procs 4

Scores every Texas county for every hour of the Winter Storm Uri replay
(254 counties x 408 hours = 103,632 scores per pass) through the full engine:
risk, tier, ranking and plain-English reasons. With --procs N it runs N
independent copies in parallel to show how throughput scales with cores.
Results are saved to bench/results/<label>-<machine>-engine-pN.json and shown
on the dashboard's Benchmark tab.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from uriwatch.engine import Engine  # noqa: E402
from uriwatch.replay import load_bundle, load_model  # noqa: E402

RESULTS = ROOT / "bench" / "results"
SCENARIO = "uri"


def pct(vals: list[float], q: float) -> float:
    return vals[min(len(vals) - 1, int(q * len(vals)))] if vals else 0.0


def summarize(lat_ms: list[float], elapsed: float, n: int) -> dict:
    lat = sorted(lat_ms)
    return {
        "n": n,
        "elapsed_s": round(elapsed, 3),
        "tps": round(n / elapsed, 1),
        "p50_ms": round(pct(lat, 0.50), 5),
        "p95_ms": round(pct(lat, 0.95), 5),
        "p99_ms": round(pct(lat, 0.99), 5),
        "max_ms": round(lat[-1], 5) if lat else 0.0,
    }


def _engine_worker(hours: int) -> tuple[list[float], float, int]:
    bundle = load_bundle(SCENARIO)
    engine = Engine(load_model("honest"), bundle["counties"])
    hrs = bundle["hours"][:hours]
    model = engine.model
    lat: list[float] = []
    n = 0
    t0 = time.perf_counter()
    for h, hour in enumerate(hrs):
        # Full path per hour: score all counties, tier, rank, explain the top ones.
        s = time.perf_counter()
        engine.score_hour(h, hour)
        dt = (time.perf_counter() - s) * 1000.0
        per = dt / len(hour["x"])  # per-county latency, averaged over the hour's batch
        lat.extend([per] * len(hour["x"]))
        n += len(hour["x"])
    return lat, time.perf_counter() - t0, n


def run_engine(args) -> dict:
    procs = args.procs
    if procs == 1:
        lat, elapsed, n = _engine_worker(args.hours)
    else:
        with mp.Pool(procs) as pool:
            parts = pool.map(_engine_worker, [args.hours] * procs)
        # Each worker times only its own scoring loop (bundle loading excluded);
        # workers run side by side, so the slowest one sets the wall time.
        elapsed = max(p[1] for p in parts)
        lat = [x for p in parts for x in p[0]]
        n = sum(p[2] for p in parts)
    return {"mode": "engine", "procs": procs, **summarize(lat, elapsed, n)}


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    e = sub.add_parser("engine")
    e.add_argument("--hours", type=int, default=408)
    e.add_argument("--procs", type=int, default=1)
    e.add_argument("--label", default=os.environ.get("BENCH_LABEL", "laptop"))
    args = ap.parse_args()

    result = run_engine(args)
    result.update(
        {
            "label": args.label,
            "machine": platform.machine(),
            "platform": platform.platform(),
            "python": platform.python_version(),
            "cpus": os.cpu_count(),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    )
    RESULTS.mkdir(parents=True, exist_ok=True)
    suffix = f"p{result['procs']}"
    out = RESULTS / f"{args.label}-{result['machine']}-engine-{suffix}.json"
    out.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
