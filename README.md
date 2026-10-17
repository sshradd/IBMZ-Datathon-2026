# Uri Watch

IBM Z Datathon 2026 · Theme 1: Real-Time AI for Critical Decisions (Predictive Outage Early Warning + Emergency Resource Prioritization)

When the Texas grid is stressed, which counties lose power next, and who needs help first? Uri Watch scores all 254 Texas counties every hour and answers the four questions an emergency manager asks:

| Lens | Question | What you get |
|---|---|---|
| **Predict** | What happens next? | 6, 12 and 24 hour forecasts per county, expected severe outages, people and seniors exposed, a forecast scoreboard |
| **Prescribe** | What should we do? | Ranked recommended moves with timing, impact and track record, plus a resource planner for crews, warming or cooling centers and outreach calls |
| **Diagnose** | Why is it happening? | Signal-family drivers, a per-county drill-down, ERCOT demand versus its own forecast, what was behind the outages we warned about |
| **Describe** | What has happened? | Customers out, severe counties, peak, customer-hours lost, seniors without power, the hardest-hit counties |

The demo replays real storms from real data. The headline test is **Winter Storm Uri (Feb 2021), which the model never saw in training.**

## The responder console

The app is a Next.js + React PWA for the people who send crews during a Texas power outage. The forecast uses **weather and outage data only**, so it says **where and when** outages are likely. **How many crews and how much material to commit is the responder's call**, and the app never forecasts either. One tap sends, and everything has an undo.

| Tab | What it does |
|---|---|
| **Outages** (home) | A real county map (offline boundaries) with risk at 6, 12 and 24 hours, actual outages, and NWS alerts. Four numbers on top: out now, likely next 24 h, seniors in at-risk counties, crews ready. The top-priority county is always pinned as a **dispatch ticket**: how far the nearest free crew is, when to leave, and steppers where **you choose how many** line crews, shelter teams and outreach teams to send. One tap sends them. Tap any county for its numbers and a "send here" panel. |
| **Teams** | Priority counties ranked from the forecast, each with the nearest free crew and drive time (distance, a road factor and a winter slowdown). Set a count per county and send, or send to the top five. Units go out with shareable work orders and a navigation link; mark them arrived, done or recalled. **Staging advisor:** forward yards that cut the average drive to the top-priority counties. **Mutual aid:** you say how much help to ask for and the app writes the request. Editable roster by depot. |
| **Resources** | Your inventory by depot, and **targets you set** for each item. The page shows what is at or below your target and drafts a resupply request. For context it shows the forecast exposure (customers and seniors at risk) next to it, but it does not convert that into a material forecast. |
| **More** | One-tap **shift handoff brief** (copy, share, download), data source switch (live or a storm replay), Daylight theme and Glove mode, how far to trust the forecast, and a link to the analyst dashboard. |

Also: **undo** for every dispatch (10 seconds, no confirmation modal), an **offline queue** (actions taken without signal are sent when you reconnect, and the last forecast and plan stay on screen), 48 px touch targets (60 px in Glove mode), visible focus, reduced-motion support, and a county list as the accessible twin of the map.

Honest notes:
- **Crews, depots and inventory are sample data**, clearly labeled in the app. Responders edit every number. There are no default inventory targets.
- **Travel times are planning estimates**, not routing.
- **Offline use needs the service worker**, which this repo's preview pane blocks, so offline load was not verified here: check it in Chrome (open the app, go offline, reload).
- The analyst workbench (drivers, evidence, benchmark) is still available at `/analyst/`. It includes a what-if planner where you set the resource levels yourself.

Run it with `./run.sh` and open http://127.0.0.1:8000. For development: `cd responder && npm run dev` (calls the API on `NEXT_PUBLIC_API`, for example `NEXT_PUBLIC_API=http://127.0.0.1:8000 npm run dev`). The production build is a static export (`cd responder && npm run build`, output in `responder/out`), so the LinuxONE server needs no Node.

## Run it

```bash
./run.sh
```

Open http://127.0.0.1:8000, pick a storm, press play.

`run.sh` creates a Python virtualenv, installs three pinned packages, builds the web app if `web/dist` is missing and `npm` exists, then serves the API and dashboard on one port. Models and storm replays are committed, so nothing is trained or downloaded at run time.

Requirements: Python 3.10+ (3.12 tested). Node 20+ only for building the web app.

## Run it on LinuxONE (s390x)

1. `web/dist` is committed, so the server needs no Node. After UI changes, rebuild on a laptop (`cd web && npm run build`) and commit `web/dist`.
2. Get the code onto the server: `git clone <repo-url>` (or `rsync -av --exclude .venv --exclude web/node_modules --exclude data/raw ./ user@<server>:uri-watch/`).
3. On the server: `cd uri-watch && ./run.sh`
4. On the laptop: `ssh -L 8000:localhost:8000 user@<server>` and open http://localhost:8000.

The sidebar badge says **IBM LinuxONE** when it is.

**Why it ports cleanly:** training happens on a laptop with scikit-learn, but the server is pure Python. The model is a handful of numbers in JSON (no byte-order issues on big-endian Z) and the storm replays are gzip JSON. The only compiled dependency is `pydantic-core`.

### Container (optional)

```bash
docker build -t uri-watch .
docker run --rm -p 127.0.0.1:8000:8000 uri-watch
```

`python:3.12-slim` is multi-arch, so the same Dockerfile builds on s390x. Build `web/dist` first.

## Benchmark

```bash
.venv/bin/python bench/run.py engine --hours 408            # one core
.venv/bin/python bench/run.py engine --hours 408 --procs 8  # one copy per core
```

Each pass scores every county for every hour of the Uri replay (254 counties x 408 hours = 103,632 scores) through the full engine: three forecast heads, tiering, drivers, ranking and the deployment plan. Results land in `bench/results/` and appear on the **On IBM Z** page. Run the same commands on a laptop and on LinuxONE and compare. Latency percentiles are per-county averages over each hourly batch, not individually timed scores.

Laptop baseline (x86_64 MacBook, 8 cores, Python 3.12): about 33k county scores per second on one core and about 120k per second with 4 or 8 processes.

The honest framing for Z: scoring is a small job, so a laptop core is fast too. The argument for LinuxONE is sustained throughput under surge (a storm hits every county in the same hours), isolation, availability, and security for utility data, not raw speed on a tiny model.

## Live mode: real-time data API

Press play on **Live now** in the sidebar (or start the server with `URIWATCH_LIVE=1`) and Uri Watch stops replaying history and scores Texas right now. It polls three public APIs with no login, rebuilds the same features the model was trained on, and scores all 254 counties every minute.

| Source | What it gives | Used for |
|---|---|---|
| Open-Meteo forecast API | Hourly weather at the same 12 stations, past 72 h and next 24 h | Temperature, ice, snow, wind features and the 24 h outlook |
| ERCOT public dashboard JSON | 5-minute demand, hourly demand forecast, generation by fuel | Grid stress features |
| National Weather Service API | Active watches, warnings and advisories by county | Alerts banner and per-county context |

**No free live county outage feed exists** (DOE EAGLE-I live and PowerOutage.us both require access we do not have). So live mode runs a second model, trained by us on only the signals available in real time: weather, grid telemetry and county profile. The outage-based features are dropped, which costs accuracy, especially at short horizons:

| Live-feature model, out of sample | Severe county outages | Alert first | Median lead | AUC 24 h | AUC 12 h | AUC 6 h |
|---|---|---|---|---|---|---|
| Winter Storm Uri | 396 | 159 (40%) | 8 h | 0.79 | 0.74 | 0.60 |
| Winter Storm Elliott | 15 | 2 (13%) | 14 h | 0.81 | 0.75 | 0.52 |
| Feb 2023 ice storm | 36 | 11 (31%) | 22 h | 0.79 | 0.75 | 0.67 |
| Aug 2023 heat dome | 17 | 1 (6%) | 19 h | 0.70 | 0.73 | 0.79 |

It catches far fewer outages than the full model, its alerts are more precise (watch tier 27%, prepare 32%, act 34% hit rate against a 2% base rate) and arrive earlier. Lean on the 24 hour forecast: the 6 and 12 hour heads are weak without outage momentum. The outage feed is a pluggable slot: swap in a county outage source and the full model's features come back.

**Honest notes on the feeds.** The ERCOT endpoints are the JSON behind ERCOT's public dashboards, not an official documented API, so they can change. ERCOT publishes demand forecasts only for hours that have not started, so the demand-versus-forecast signal stays neutral until the service has been running long enough to compare (history is kept in `data/live/`, git-ignored). If a feed fails, the last good copy is served and marked stale. The model is scored on live data exactly as it was trained, using recent observed and analysis weather, so the forecast weather only feeds the outlook chart.

### Live API

Start live mode with `POST /api/replay/start {"scenario": "live"}` or run `URIWATCH_LIVE=1 ./run.sh`, then:

| Method | Path | What |
|---|---|---|
| GET | `/api/live/forecast?min_tier=watch` | Every county's chance of a severe outage within 6, 12 and 24 h, tier, likely window, reasons, active NWS alerts |
| GET | `/api/live/grid` | Current ERCOT demand, generation, forecast, feed health |
| GET | `/api/live/alerts` | Active NWS alerts for Texas, grouped by event and county |
| GET | `/api/live/plan?crews=40&centers=15&callers=25` | Recommended deployment and moves for the current forecast |
| GET | `/api/live/status` | Whether live mode is running, polls so far, per-feed status |
| GET | `/api/events` | Server-Sent Events, one message per poll with the full predict, prescribe and diagnose blocks |

```bash
curl -s "http://127.0.0.1:8000/api/live/forecast?min_tier=watch" | python3 -m json.tool | head -40
```

## The data

All public, no logins. Fetched by `scripts/fetch_data.py` (about 605 MB of Texas rows kept; EAGLE-I is streamed and filtered while downloading).

| Source | Used for |
|---|---|
| DOE EAGLE-I recorded outages, 2019-2023, 15-minute, per county | What actually happened (labels) and outages so far (features) |
| EIA-930 hourly ERCOT grid data | Demand, ERCOT's own demand forecast, generation, wind |
| Open-Meteo historical weather, 12 Texas stations | Temperature, ice and snow, wind |
| Census gazetteer and population estimates | County locations, population, residents 65+ |

About 11 million Texas county-hours; the training set keeps every severe-outage hour and a weighted sample of the rest (1.18 million rows, 41,412 positive at 24 h).

## How it works

| Piece | File |
|---|---|
| Fetch and filter the public data | `scripts/fetch_data.py` |
| Align everything to one hourly clock, build features and 6/12/24 h labels, write storm replays | `backend/uriwatch/build.py` |
| Feature list, signal families, plain-English reasons | `backend/uriwatch/features.py` |
| Train two models with three heads each (laptop only) | `backend/uriwatch/train.py` |
| Pure-Python scorer, JSON weights, inputs clamped to the training range | `backend/uriwatch/model.py` |
| Predict, diagnose and describe, live scorecard | `backend/uriwatch/engine.py` |
| Prescribe: resource planner and ranked moves | `backend/uriwatch/plan.py` |
| Replay sessions | `backend/uriwatch/replay.py` |
| Live mode: provider clients, live feature builder, live session | `backend/uriwatch/live/` |
| API + Server-Sent Events | `backend/uriwatch/api.py` |
| Operations: priorities, nearest crew and drive time, responder-chosen dispatch, staging, inventory targets, handoff brief | `backend/uriwatch/ops.py` |
| Responder console (Next.js PWA) | `responder/` |
| Analyst dashboard: brief, predict, prescribe, diagnose, describe, evidence, benchmark | `web/src/` (served at `/analyst/`) |

**The prediction:** will this county cross a severe line (at least 10% of its customers and at least 2,500 customers without power) within 6, 12 or 24 hours, given what is known right now? The model only predicts onset: counties already in severe outage are excluded from the score. Each input is clamped to the range seen in training, so a storm far bigger than any it learned from cannot push scores off the chart.

**The prescription:** rules over the forecast, not a second model. The planner puts crews where the most vulnerable people are already dark or likely to be next (seniors count twice), centers where it is freezing or scorching and seniors are exposed, and call teams on senior counts, using a diminishing-returns allocation. It reports how much of the need the plan covers versus spreading the same resources by population alone. Resource counts are what-if levers, not any utility's fleet. Each move shows the out-of-sample hit rate of alerts at its tier.

**Two models.** `honest` trains only on data before Dec 2022 with Feb 2021 removed, so Winter Storm Uri, Elliott, the Feb 2023 ice storm and the Aug 2023 heat dome are all out-of-sample. `final` trains on everything. The dashboard defaults to honest and says so on screen.

**Alert tiers** are budgets set from training data only: watch = top 3% of county-hours by 24 h risk, prepare = top 1%, act = top 0.3%. They are not tuned on the storms.

### Out-of-sample results (honest model)

| Storm | Severe county outages | Alert first | Median lead | Best lead | False alerts | Top-10 lift | AUC 6 h / 12 h / 24 h |
|---|---|---|---|---|---|---|---|
| Winter Storm Uri (Feb 2021) | 396 | 323 (81.6%) | 6 h | 25 h | 664 | 2.1x | 0.94 / 0.91 / 0.84 |
| Winter Storm Elliott (Dec 2022) | 15 | 11 (73.3%) | 8 h | 19 h | 60 | 1.1x | 0.92 / 0.91 / 0.87 |
| Feb 2023 ice storm | 36 | 34 (94.4%) | 11 h | 24 h | 293 | 8.4x | 0.90 / 0.87 / 0.85 |
| Aug 2023 heat dome | 17 | 6 (35.3%) | 2.5 h | 16 h | 223 | 1.7x | 0.83 / 0.76 / 0.72 |

**How often an alert comes true** (pooled over those four storms, within 24 h; a typical county-hour is 2.1%):

| Tier | Went severe | Lift | Outages caught |
|---|---|---|---|
| Watch | 18.9% | 8.8x | 40% |
| Prepare | 27.2% | 12.7x | 27% |
| Act | 35.6% | 16.6x | 20% |

Reproduce: `cd backend && python -m uriwatch.train` (needs `requirements-train.txt` and the data).

**Honest limits:**
- Most alerts still do not end in a severe outage, even at the top tier. This is a ranking and triage tool, not a replacement for an emergency manager.
- It under-sizes statewide events like Uri: the forecast scoreboard on the Predict page shows the gap. It ranks which counties go first better than it counts the total.
- The heat dome is the weak case: heat-driven outages look different from winter storms and the model catches about a third of them. On Elliott the top-10 ranking is barely better than random.
- Median lead on Uri is 6 hours because most Texas counties lost power within hours of ERCOT's load shed. Ice storms give longer warning.
- The models score observed weather, not a weather forecast. Live mode pulls the forecast for the outlook chart, but forecast weather is not a model input, because training used observed weather. A real system would train on archived forecasts. Weather comes from 12 stations, so a county can be far from its station.
- Senior counts come from Census population estimates. We have no access to medical-need registries.
- The recommended moves are rules written by us and have not been validated by emergency managers.
- EAGLE-I counts only outages utilities reported to the public map, and the 2023 file renames the count column (handled in `build.py`).

## API

| Method | Path | What |
|---|---|---|
| GET | `/api/scenarios`, `/api/counties?scenario=` | Storm list, county list |
| POST | `/api/replay/start` | `{"scenario": "uri", "model": "honest", "speed": 12}` (hours per second) |
| POST | `/api/replay/pause`, `/resume`, `/speed`, `/seek` | Control the replay |
| GET | `/api/events` | SSE stream: each hour carries the predict, prescribe, diagnose and describe blocks |
| POST | `/api/plan` | What-if: `{"crews": 40, "centers": 15, "callers": 25}` re-runs the planner on the current hour |
| GET | `/api/explain/{fips}` | Why the current forecast for one county |
| GET | `/api/ops/state`, `/api/ops/plan`, `/api/ops/sitrep` | Crews, depots and inventory; the priority counties with nearest crew, drive time and leave-by, staging sites, and inventory against your targets; the handoff brief |
| POST | `/api/ops/dispatch`, `/api/ops/undo` | Send the units you choose to the counties you choose and get work orders; take it back |
| PUT | `/api/ops/units`, `/api/ops/inventory`, `/api/ops/targets` | Edit the roster, stock and the targets you set |
| GET | `/api/live/*` | Real-time forecast, grid, alerts, plan and status (see above) |
| GET | `/api/models` | Tiers and out-of-sample metrics for the full and live-feature models |
| GET | `/api/system` | Machine, CPU count, byte order (evidence for judges) |
| GET | `/api/bench` | Saved benchmark results |

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q tests
```

## Rebuild the data and models (laptop)

```bash
pip install -r backend/requirements-train.txt
python scripts/fetch_data.py all && python scripts/fetch_data.py age
cd backend && python -m uriwatch.build && python -m uriwatch.train
```

After rebuilding the web app, hard-refresh once: the service worker serves the previous build first.
