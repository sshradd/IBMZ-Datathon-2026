# Scam Stopper

IBM Z Datathon 2026 · Theme 1: Real-Time AI for Critical Decisions

Scam victims, often seniors, are tricked into sending irreversible instant payments, and the money lands in mule accounts. Scam Stopper scores every payment **before it settles**, from both ends (the sender's behavior and the receiver's mule-ring signals), in well under a millisecond, and explains every hold in plain English. It runs on IBM LinuxONE.

## Run it

```bash
./run.sh
```

Open http://127.0.0.1:8000 and press **Start stream**.

`run.sh` creates a Python virtualenv, installs three pinned packages, trains the model if `backend/model.json` is missing, builds the PWA if `web/dist` is missing and `npm` exists, then serves the API and dashboard on one port.

Requirements: Python 3.10+ (3.12 tested). Node 20+ only for building the PWA.

## Run it on LinuxONE (s390x)

1. `web/dist` (the built PWA) is committed, so the server needs no Node. After UI changes, rebuild on a laptop (`cd web && npm run build`) and commit `web/dist`.
2. Get the code onto the server: `git clone <repo-url>`, or `rsync -av --exclude .venv --exclude web/node_modules ./ user@<server>:scam-stopper/`
3. On the server: `cd scam-stopper && ./run.sh`
4. On the laptop: `ssh -L 8000:localhost:8000 user@<server>` and open http://localhost:8000.

The header badge says **Running on IBM LinuxONE · s390x** when it is.

The server binds to `127.0.0.1` by default. Use the SSH tunnel rather than opening the port. Set `HOST=0.0.0.0` only if you mean to expose it.

**Why it is easy to port:** the scorer is pure Python (no numpy or scikit-learn), and model weights are stored as JSON, so there are no native wheels to find for s390x and no big-endian surprises. The only compiled dependency is `pydantic-core`.

### Container (optional)

```bash
docker build -t scam-stopper .
docker run --rm -p 127.0.0.1:8000:8000 scam-stopper
```

`python:3.12-slim` is multi-arch, so the same Dockerfile builds on s390x. Build `web/dist` first.

## Benchmark

```bash
.venv/bin/python bench/run.py engine --n 100000            # one core
.venv/bin/python bench/run.py engine --n 400000 --procs 4  # four cores
.venv/bin/python bench/run.py http --n 5000 --concurrency 32   # through the API (server running)
```

Results land in `bench/results/` and appear on the dashboard's **Benchmark** tab. Run the same commands on a laptop and on LinuxONE and compare.

Laptop baseline (x86_64 MacBook, Python 3.12): about 17k payments/sec on one process with p99 latency 0.31 ms, and about 67k/sec on four processes.

## How it works

| Piece | File |
|---|---|
| Synthetic payment stream with injected scams (gift card, large new payee, rapid repeats, mule fan-in, cash-out) | `backend/scamstopper/sim.py` |
| Streaming features from what the bank knew *before* each payment | `backend/scamstopper/features.py` |
| Transparent logistic regression, pure Python, JSON weights | `backend/scamstopper/model.py` |
| Decision (allow / verify / hold), plain-English reasons, mule-ring tracker, live stats | `backend/scamstopper/engine.py` |
| API + Server-Sent Events stream | `backend/scamstopper/api.py` |
| Training and held-out evaluation | `backend/scamstopper/train.py` |
| PWA: Ops console, Guardian (senior's phone view), Benchmark | `web/src/` |

**Policy:** customers 65+ get stronger protection. Medium-risk payments are held for them, not just sent to verification.

**Model quality** (held-out simulated stream, different seed): precision ≈ 0.92, recall ≈ 0.86, false-positive rate ≈ 0.7%. Run `python -m scamstopper.train` in `backend/` to reproduce. Thresholds are in `engine.py`.

**Honest limits:** all data is synthetic, so real-world accuracy would be lower. Cash-outs from mule accounts are the weakest scenario (recall ≈ 0.44).

## API

| Method | Path | What |
|---|---|---|
| POST | `/api/score` | Score one payment, returns decision + reasons |
| GET | `/api/events` | SSE stream of scored payments |
| GET | `/api/stats` | Counts, money stopped, precision, recall, latency, TPS |
| GET | `/api/graph` | Candidate mule rings |
| GET | `/api/system` | Machine, CPU count, byte order (evidence for judges) |
| POST | `/api/sim/start` | `{"speed": 20, "fraud_rate": 0.02}` |
| POST | `/api/sim/stop`, `/api/sim/reset` | |
| GET | `/api/bench` | Saved benchmark results |

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q
```

## Dev mode

Run `./run.sh` for the API, then `cd web && npm run dev` for hot reload at http://localhost:5173 (it proxies `/api`).

After rebuilding the PWA, reload twice or hard-refresh: the service worker serves the previous build once, then updates.
