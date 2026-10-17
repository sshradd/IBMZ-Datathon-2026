# Uri Watch: Spec

IBM Z Datathon 2026, Theme 1: Real-Time AI for Critical Decisions.

**One-liner:** When the Texas grid is stressed, which counties lose power next, and who needs help first? Score every Texas county every hour from public data, warn before severe outages start, explain every score, and rank where crews and outreach go first.

## Problem

Winter Storm Uri left about four million Texas customers without power in February 2021, and many of the people who needed help most were reached last. Utilities and emergency managers need an early, explainable, county-level view that says where to pre-position crews, warming centers and medical-need outreach before power fails.

## Users

- A county emergency manager deciding where to open warming centers.
- A utility or co-op operations lead deciding where to pre-position crews.
- A charity or health agency deciding whom to call first. The ranking weights residents aged 65+.

## Scope

In scope: hourly scoring of all 254 Texas counties; replay of four real storms; plain-English reasons; a "who first" ranking; an honest out-of-sample scorecard; a benchmark on IBM LinuxONE.

Out of scope: live ERCOT or utility feeds, weather forecasts, individual customer data, any private medical-need registry.

## Data

Public, no login. EAGLE-I county outages (2019-2023, 15-minute), EIA-930 ERCOT grid data, Open-Meteo weather from 12 Texas stations, Census county locations and populations. See `RESOURCES.md`.

## Prediction

For each county-hour, the chance that outages cross a severe line (at least 10% of customers and at least 2,500 customers) within 24 hours. Counties already severe are excluded.

Features (25, all known at the time): outage level and momentum, local weather (temperature, cold, heat, ice, snow, wind, humidity), ERCOT demand versus forecast and generation drop, statewide storm footprint (share of Texas already in severe outage, spread rate, statewide cold), county size, time of day.

Model: logistic regression with one head per horizon (6, 12 and 24 hours), trained with scikit-learn on a laptop, exported to JSON and scored in pure Python. Inputs are clamped to the training range.

## Evaluation

- `honest` model: trained on data before Dec 2022, Feb 2021 removed. Tested on Uri, Elliott, the Feb 2023 ice storm and the Aug 2023 heat dome.
- Metrics: share of severe county outages with an alert first, lead time, false alert episodes, top-10 ranking lift, ROC AUC.
- Alert tiers are alert budgets (top 3% / 1% / 0.3% of training county-hours), never tuned on the storms.

## Product

Web app (React + TypeScript, installable as a PWA), organized around four kinds of analytics:
- **Situation brief:** one-sentence forecast, KPI cards, top recommended moves, risk map.
- **Predict:** 6/12/24 h forecasts per county, watchlist with trend, expected onsets, forecast scoreboard (issued 24 h ago vs what happened), per-window AUC.
- **Prescribe:** ranked moves with approve/dismiss, resource planner (crews, centers, call teams) with coverage versus a population-only split, deployment table, exportable action plan.
- **Diagnose:** signal-family drivers, county drill-down, ERCOT demand versus forecast and temperature, cause mix of warned outages.
- **Describe:** customers out, severe counties, peak, customer-hours lost, seniors without power, hardest-hit counties.
- **Evidence** and **On IBM Z:** out-of-sample results, tier track record, honest limits, benchmark.

## IBM LinuxONE

Pure-Python server and JSON model, so it runs on s390x with no native wheels except `pydantic-core`. Evidence to capture: `uname -m`, `lscpu`, the header badge, `/api/system` (big-endian), benchmark runs, the container build. Be honest that scoring is small; the Z argument is sustained throughput under surge, isolation and availability for utility data.

## Responder console

A Next.js PWA for people sending crews. The forecast uses weather and outage data only, so it ranks counties and times them; the responder decides how many crews and how much material to commit. Outages (map, pinned dispatch ticket with responder-set counts, one-tap dispatch with undo), Teams (priority counties with nearest crew and drive time, work orders, staging advisor, mutual-aid request the responder sizes, editable roster), Resources (inventory with targets the responder sets, resupply request), More (handoff brief, data source, display options). Crews, depots and inventory are labeled sample data that responders edit. Offline: the last forecast and plan stay on screen and actions queue until reconnect.

## Live mode

A second model trained on only the signals that exist in real time (weather, ERCOT grid telemetry, county profile) scores Texas every minute from three public APIs (Open-Meteo, ERCOT dashboard JSON, NWS). Exposed as a JSON API under `/api/live/*` and as a dashboard mode. No free live county outage feed exists, so live mode has no outage inputs and no ground truth; its short-horizon forecasts are weak and the 24 hour forecast is the one to use.

## Risks

- Alerts are broad (about a quarter of county-hours on watch during Uri).
- Heat-driven outages are caught poorly.
- Coarse weather. No forecasts.
