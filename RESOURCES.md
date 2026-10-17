# Open-source resources used

Required by the submission rules: every library, dataset and API used, with links.

## Data

All public, no login. Fetched by `scripts/fetch_data.py`.

| Source | License / terms | Link |
|---|---|---|
| DOE EAGLE-I recorded electricity outages 2014-2025 (we use 2019-2023, Texas rows) | CC BY 4.0 | https://figshare.com/articles/dataset/24237376 |
| EIA-930 Hourly Electric Grid Monitor, ERCOT (balancing authority ERCO) | US government public data | https://www.eia.gov/electricity/gridmonitor/ |
| Open-Meteo Historical Weather API (12 Texas stations) | CC BY 4.0, free for non-commercial use | https://open-meteo.com/en/docs/historical-weather-api |
| US Census Bureau 2023 Gazetteer, counties (centroids) | US government public data | https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html |
| US Census Bureau county population estimates by age (`cc-est2023-agesex-all.csv`) | US government public data | https://www.census.gov/data/datasets/time-series/demo/popest/2020s-counties-detail.html |

### Live APIs (real-time mode, no login)

| API | Used for | Terms |
|---|---|---|
| Open-Meteo Forecast API `api.open-meteo.com/v1/forecast` | Hourly weather, past 72 h and next 24 h | CC BY 4.0, free for non-commercial use |
| ERCOT public dashboard JSON `ercot.com/api/1/services/read/dashboards/supply-demand.json` and `fuel-mix.json` | 5-minute demand, hourly demand forecast, generation by fuel | Public ERCOT dashboard data; not an official documented API |
| National Weather Service API `api.weather.gov/alerts/active?area=TX` | Active watches, warnings and advisories | US government public data |

All training labels and features come from the historical files above.

Downloaded but not used by any model: the EIA ERCOT zone-level (subregion) demand files and the Open-Meteo cloud-cover field. Probed but never downloaded or used: NOAA Storm Events, FEMA OpenFEMA and DART transit data. Storm replays in `data/replay/` are derived from them.

## Backend (Python)

| Library | Version | License | Link |
|---|---|---|---|
| FastAPI | 0.115.5 | MIT | https://github.com/fastapi/fastapi |
| Uvicorn | 0.32.1 | BSD-3-Clause | https://github.com/encode/uvicorn |
| Pydantic | 2.9.2 | MIT | https://github.com/pydantic/pydantic |
| HTTPX (bench, tests) | 0.27.2 | BSD-3-Clause | https://github.com/encode/httpx |
| pytest (tests) | 8.3.3 | MIT | https://github.com/pytest-dev/pytest |

The scorer is written from scratch in `model.py` (pure Python, JSON weights).

### Training only (laptop, not needed on the server)

| Library | Version tested | License | Link |
|---|---|---|---|
| NumPy | 2.1 | BSD-3-Clause | https://github.com/numpy/numpy |
| pandas | 2.2 | BSD-3-Clause | https://github.com/pandas-dev/pandas |
| scikit-learn (LogisticRegression, StandardScaler) | 1.6 | BSD-3-Clause | https://github.com/scikit-learn/scikit-learn |

## Frontend

| Library | License | Link |
|---|---|---|
| React, React DOM | MIT | https://github.com/facebook/react |
| Vite | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | MIT | https://github.com/vitejs/vite-plugin-react |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Tailwind CSS, @tailwindcss/vite | MIT | https://github.com/tailwindlabs/tailwindcss |
| vite-plugin-pwa (Workbox) | MIT | https://github.com/vite-pwa/vite-plugin-pwa |
| Recharts | MIT | https://github.com/recharts/recharts |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| clsx | MIT | https://github.com/lukeed/clsx |
| Hanken Grotesk (via @fontsource-variable/hanken-grotesk, self-hosted) | OFL-1.1 | https://github.com/fontsource/font-files |
| JetBrains Mono (via @fontsource/jetbrains-mono, self-hosted) | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |

Exact versions: `web/package-lock.json`.

## Responder console (responder/)

| Library | License | Link |
|---|---|---|
| Next.js | MIT | https://github.com/vercel/next.js |
| React, React DOM | MIT | https://github.com/facebook/react |
| Tailwind CSS, @tailwindcss/postcss | MIT | https://github.com/tailwindlabs/tailwindcss |
| d3-geo (map projection, used by the offline fallback map) | ISC | https://github.com/d3/d3-geo |
| MapLibre GL JS 4 (the interactive map) | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js |
| Esri Canvas Light Gray and Dark Gray basemap tiles (roads, water, places; loaded live, no key, credited on the map and cached by the service worker for offline use) | Esri terms of use | https://www.arcgis.com/home/item.html?id=8b3d38c0819547faa83f7b7aca80bd76 |
| OpenStreetMap contributors (data inside the Esri basemap) | ODbL | https://www.openstreetmap.org/copyright |
| topojson-client | ISC | https://github.com/topojson/topojson-client |
| us-atlas (county boundaries, derived from US Census data) | ISC | https://github.com/topojson/us-atlas |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| clsx | MIT | https://github.com/lukeed/clsx |
| Inter Tight (via @fontsource, self-hosted) | OFL-1.1 | https://github.com/rsms/inter |
| JetBrains Mono (via @fontsource, self-hosted) | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |
| Instrument Serif italic (via @fontsource, self-hosted) | OFL-1.1 | https://github.com/Instrument/instrument-serif |
| Pillow (one-off, to draw the PWA icons) | HPND | https://github.com/python-pillow/Pillow |

Crews, depots and inventory are our own sample data, labeled as such in the app.

## Platform

- IBM LinuxONE (s390x), provided by the IBM Z Datathon
- Docker official image `python:3.12-slim` (multi-arch, includes s390x): https://hub.docker.com/_/python

## Patterns borrowed (no code)

- Vite + React + `vite-plugin-pwa` setup and pinned `requirements.txt` / non-root `python:3.12-slim` Dockerfile conventions the team already knew. All code in this repo was written during the event.
- **Design reference.** The layout and information hierarchy (a one-sentence situation brief, KPI cards, numbered recommendations with the action, projected impact and confidence, "it suggests, you decide") follow the team's earlier product dashboards. Design ideas only: no stylesheet, component or other file was copied from any earlier project. Every line of CSS and TSX in `web/src` was written during the event, including the palette (storm-night navy, lightning yellow, ice blue, hot pink).

- **Responder console look.** Paper-white ground with dot texture, near-black primary buttons, white outlined secondary buttons, mono small labels and one italic serif word per headline follow the team's own BizFalcon site. Only the visual language and typeface choices carry over; the CSS and components were written fresh for this app.

## AI assistance

- Claude Code (Anthropic) was used to help write code and docs during the event, including its UI/UX and front-end design guidance skills for the responder console.
