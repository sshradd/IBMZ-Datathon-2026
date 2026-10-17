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

All training labels and features come from these files. Storm replays in `data/replay/` are derived from them.

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

## Platform

- IBM LinuxONE (s390x), provided by the IBM Z Datathon
- Docker official image `python:3.12-slim` (multi-arch, includes s390x): https://hub.docker.com/_/python

## Patterns borrowed (no code)

- Vite + React + `vite-plugin-pwa` setup and pinned `requirements.txt` / non-root `python:3.12-slim` Dockerfile conventions the team already knew. All code in this repo was written during the event.
- **Visual style** (storm-night navy, frosted panels, lightning yellow, electric cyan and hot pink, mono uppercase labels, hairline borders, two themes) is original to this project. Every stylesheet and component in `web/src` was written during the event.

## AI assistance

- Claude Code (Anthropic) was used to help write code and docs during the event.
