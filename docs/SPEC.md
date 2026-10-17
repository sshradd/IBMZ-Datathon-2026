# Scam Stopper: Spec

IBM Z Datathon 2026, Theme 1: Real-Time AI for Critical Decisions.

**One-liner:** Scam victims, often seniors, are tricked into sending irreversible instant payments, and the money lands in mule accounts. Scam Stopper scores every transfer before it settles, from both the sender side and the receiver side, in milliseconds, and explains every decision. The core engine runs on IBM LinuxONE.

## 1. Platform decisions

**Rule that drives everything:** judges score "why IBM Z / LinuxONE". The scoring engine, API, state and benchmark must run on the LinuxONE box. Anything that moves the core to Google cloud weakens the pitch.

| Option | Verdict | Reason |
|---|---|---|
| React Native (Expo) | **No** | BizFalcon has no React Native, so no team familiarity gain. Device and build friction in 24h. Judges watch a laptop screen or a video. |
| PWA: Vite + React + TS + `vite-plugin-pwa` | **Yes** | Same pattern as BizFalcon `talon/frontend`. One codebase, mobile "Guardian" view plus desktop "Ops console", installable. |
| Next.js 16 (BizFalcon `monorepo/apps/web`) | **No** | Turbopack/SWC native binaries likely lack s390x builds, and the Serwist route-handler worker doesn't fit a static export. Vite builds to plain static files FastAPI can serve. |
| Python FastAPI (BizFalcon `apps/sandbox` pattern) | **Yes** | Same pinned FastAPI + pandas + scikit-learn + `python:3.12-slim` Dockerfile pattern. The official image is multi-arch and includes s390x. |
| Firebase Firestore / Auth / Functions | **No** | Puts data and logic on Google, not Z. |
| Firebase Hosting | Optional only | Static PWA backup. Use a **new throwaway project**, never `insightpilot-be256` (BizFalcon production). Skip unless time is left. |
| FCM push | Skip | Extra dependency. Use in-app Notification API over SSE for the "alert trusted contact" moment. |
| GCP / Cloud Run | **No** | Nothing in the core needs it. Same container runs on LinuxONE instead. |
| BizFalcon code | **Patterns only** | See section 8. Rules say all code is written during the event and commercial codebases can't be the core. |

## 2. Architecture

```
 [Simulator / replay (+ optional live BTC feed)]
              |  events (HTTP or in-process queue)
              v
 [FastAPI on LinuxONE (s390x)]
   - Ingest queue (asyncio)
   - Sender scorer   (features + model + rules)
   - Receiver scorer (graph features: fan-in, account age, cash-out speed)
   - Decision engine (allow / step-up / hold) + reasons
   - Store (SQLite; Postgres if time)
   - SSE stream /events  + REST
   - Static PWA served from same origin
              |
              v
 [PWA: Ops console + Guardian view]   [Benchmark runner (load test)]
```

- Same-origin serving avoids CORS and HTTPS mixed-content problems.
- Demo access: `ssh -L 8000:localhost:8000 user@<server>` then open `http://localhost:8000` on the laptop. Service workers and PWA install work on localhost.
- Containerize the backend (Docker or Podman, `python:3.x-slim` has s390x images). It gives "containers" screenshot evidence for judges.

## 3. Backend (Python)

- Python 3.12. FastAPI + uvicorn, pydantic. Pin exact versions, as BizFalcon `apps/sandbox/requirements.txt` does.
- **As built:** a transparent logistic regression written in pure Python (no numpy or scikit-learn), weights saved as JSON. No native wheels to find on s390x, no big-endian risk, and each decision splits into per-feature reasons.
- Receiver features from plain dicts and deques (pure Python).
- Pin versions in `requirements.txt`.

**Endpoints (as built, all under `/api`)**
- `POST /api/score`: one transaction in, decision out.
- `GET /api/events`: SSE stream of scored transactions and alerts.
- `GET /api/graph`: candidate mule rings (nodes, edges).
- `GET /api/stats`: money stopped, precision, recall, latency, throughput.
- `POST /api/sim/start` `{speed, fraud_rate}`, `/api/sim/stop`, `/api/sim/reset`.
- `GET /api/system`: machine, CPUs, byte order. `GET /api/bench`: saved benchmark runs. `GET /api/healthz`.

**Transaction schema:** `id, ts, sender_id, receiver_id, amount, channel (instant), memo, sender_age_band, receiver_account_age_days, is_new_payee`.

**Decision schema:** `risk (0-1), action (allow|step_up|hold), reasons[] (plain English, top 3), sender_score, receiver_score, latency_ms`.

## 4. Data and scenarios

Replay-first. Generate synthetic accounts and events with seeded randomness. Optionally blend a public dataset for model training (check license, record in `RESOURCES.md`).

Injected scenarios:
1. **Gift-card scam:** senior, repeated mid-size payments to a new payee, urgent memo.
2. **New payee plus large amount:** first-ever payment, 10x the sender's normal.
3. **Mule fan-in:** many unrelated senders pay one young account, then fast cash-out.
4. **Rapid repeats:** burst of transfers to the same payee within minutes.
5. **Normal traffic:** salary, rent, groceries, to keep false positives honest.

Report precision, recall and false-positive rate on a held-out replay.

**Stretch:** a live Bitcoin feed (e.g., mempool.space websocket) mapped into the same schema, shown as a "Live" badge on the dashboard. Match addresses against the public OFAC list for labels. Replay stays the main demo path.

## 5. Frontend (PWA)

- React + Vite + TypeScript, `vite-plugin-pwa` (`registerType: "autoUpdate"`), Tailwind, `lucide-react` icons, `clsx`, zod for API types. Same libraries the team knows from `talon/frontend`.
- Charts: Recharts. Graph: `react-force-graph` or Cytoscape.
- Live data over `EventSource` (SSE).
- **Build on a laptop** (`npm run build`), copy `dist/` to the server, FastAPI serves it. No Node build needed on s390x.

**Ops console (desktop)**
- Live transaction feed with colored risk.
- Alert panel with reasons.
- Mule-ring graph that highlights a flagged cluster.
- Counters: money saved, holds, latency p99, TPS.
- Scenario buttons and speed slider.

**Guardian view (mobile-first)**
- A senior's "Hold: this payment looks like a scam" card with a plain-English reason.
- "Call my trusted contact" button, and a trusted-contact notification via the Notification API.

**Benchmark page**
- Latency histogram, p50 and p99, TPS at 1x / 10x / 100x, and a laptop vs LinuxONE comparison if both are available.

## 6. Benchmark and IBM Z evidence

- Load test script (`bench/run.py`, async client) pushing N transactions/sec to `/score`; record p50, p95, p99 and max sustained TPS.
- Run on the LinuxONE box and on a laptop for comparison.
- **Capture screenshots as you go:** `uname -m`, `lscpu`, `docker ps`, benchmark output, resource use. Judges look for this evidence.
- Do not claim on-chip AI acceleration unless `lscpu` and IBM docs confirm it on this box. Frame Z's value around what you measure: latency under load, isolation and security, reliability.

## 7. Repo layout

```
scam-stopper/
  README.md
  RESOURCES.md          # every library, dataset, API, with links and licenses
  SCREENSHOTS.md        # checklist of LinuxONE evidence to capture
  backend/
    app/ (main.py, scoring.py, graph.py, decide.py, sim.py, store.py)
    tests/
    requirements.txt
    Dockerfile
  web/                  # PWA
  bench/
  docs/ (architecture.png, video-script.md)
```

One-command run: `make dev` (or `./run.sh`) starts the backend and serves the built PWA.

## 8. BizFalcon stack: how to reuse it

BizFalcon stack (read 2026-10-17): pnpm + Turborepo monorepo; Next.js 16 + React 19 + Tailwind 4 + Serwist PWA (`apps/web`); legacy Vite + React 18 + `vite-plugin-pwa` (`talon/frontend`); Firebase Auth, Firestore, Functions on Node 22; Python FastAPI sandbox on Cloud Run (`apps/sandbox`); DUSK design system (`packages/ui`).

**Reuse (patterns and know-how):**
- Vite + React + TS + Tailwind + Recharts + `vite-plugin-pwa` setup, written fresh.
- Pinned `requirements.txt` and the non-root `python:3.12-slim` Dockerfile pattern, written fresh.
- zod for request/response types.

**Do not reuse:**
- Any code, components, or the DUSK design system. The event requires all code written during the window, and commercial codebases can't be the core.
- BizFalcon Firebase projects, keys, or `.firebaserc`. Keep the datathon fully separate from production.
- The monorepo, Turborepo, pnpm workspaces, Next.js. Too heavy for 24h and risky on s390x.

Record borrowed patterns (not code) in `RESOURCES.md`.

## 9. Build order and roles (4 people)

| Phase | Hours | Work |
|---|---|---|
| 0 | 0-1 | SSH into box, check arch and Python, endianness test, repo skeleton, pick team name |
| 1 | 1-4 | Simulator + schema + `/score` with rules only (end-to-end skeleton) |
| 2 | 4-9 | Sender model, receiver graph features, reasons |
| 3 | 4-12 | PWA: feed, alerts, graph, Guardian view (parallel) |
| 4 | 12-16 | Integrate, scenarios tuned, false-positive check |
| 5 | 16-19 | Benchmark on LinuxONE, screenshots, containerize |
| 6 | 19-22 | Demo video (max 3 min), deck PDF, README, RESOURCES |
| 7 | 22-24 | Submit early. Buffer. |

Roles: A data and model, B backend and stream, C PWA, D benchmark, evidence, video, deck.

**Cut order if late:** live feed, receiver graph (keep sender side), Guardian notification, Postgres, containers.

## 10. Deliverables checklist (from the slide)

- [ ] Demo video, 3 minutes or less: problem, data, solution, how it uses IBM Z (tech stack, LinuxONE instance, model)
- [ ] GitHub/GitLab link or zip link
- [ ] Pitch deck PDF named `[Team Name]_IBM Z Datathon 2026 Project`
- [ ] Links to all open-source resources used
- [ ] LinuxONE screenshots (instance, containers, security, compute)
- [ ] Optional: architecture diagram, working prototype
- [ ] Submit early. Closing ceremony Oct 18, 10:30 AM CST.

## 11. Risks

| Risk | Mitigation |
|---|---|
| s390x wheel or endianness issues | Test on day 1, prefer pure-Python or sklearn, keep a fallback rules engine |
| LinuxONE unreachable during demo | Recorded video, laptop-hosted fallback with the same code |
| Scope too big | Cut order in section 9 |
| Crowded fraud theme | Both-ends angle, benchmark, plain-English explanations |
| Reuse rule violation | Fresh code only, document resources |

## 12. Open questions

1. LinuxONE access: OS, Python version, RAM, can the box reach the internet?
2. Does any teammate know React and TypeScript well enough to own the PWA?
3. Synthetic-only, or add the live Bitcoin feed as a stretch?
