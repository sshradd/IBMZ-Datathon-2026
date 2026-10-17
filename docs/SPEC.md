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

Model: logistic regression (scikit-learn, laptop) exported to JSON and scored in pure Python.

## Evaluation

- `honest` model: trained on data before Dec 2022, Feb 2021 removed. Tested on Uri, Elliott, the Feb 2023 ice storm and the Aug 2023 heat dome.
- Metrics: share of severe county outages with an alert first, lead time, false alert episodes, top-10 ranking lift, ROC AUC.
- Alert tiers are alert budgets (top 3% / 1% / 0.3% of training county-hours), never tuned on the storms.

## Product

Web app (React + TypeScript, installable as a PWA):
- **Storm replay:** county dot map, scorecard, county explanation, statewide timeline, grid and throughput tiles.
- **Who first:** counties on alert but not yet out, ranked by risk times seniors, with reasons.
- **The model:** out-of-sample table, top weights, limits.
- **Benchmark:** county scores per second and latency, laptop versus LinuxONE.

## IBM LinuxONE

Pure-Python server and JSON model, so it runs on s390x with no native wheels except `pydantic-core`. Evidence to capture: `uname -m`, `lscpu`, the header badge, `/api/system` (big-endian), benchmark runs, the container build. Be honest that scoring is small; the Z argument is sustained throughput under surge, isolation and availability for utility data.

## Risks

- Alerts are broad (about a quarter of county-hours on watch during Uri).
- Heat-driven outages are caught poorly.
- Coarse weather. No forecasts.
