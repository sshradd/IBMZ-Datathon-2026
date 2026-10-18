# SURGE: Grid Resilience Command

SURGE is an operations dashboard for monitoring county-level grid resilience risk and prioritizing field response. It combines an interactive Texas county map, live model output, exposure and facility indicators, recommended dispatch actions, PDF briefing generation, and optional SMS assignment delivery.

The project was built for the IBM Z Datathon. The forecasting workflow uses an IBM Time Series Transformer (IBM TTM) model trained and served through an IBM LinuxONE backend. This repository contains the web dashboard and the optional Node.js assignment API; the model-training service publishes county predictions through the live-data JSON contract described below.

More about model info is located in the model/ttm branch

## Features

- Interactive Mapbox satellite map of Texas counties
- County risk ranking with:
  - Current risk score
  - 24-hour forecast change
  - People exposed
  - Critical sites
  - Crew-hour requirements
- Risk, exposure, and coverage map modes
- Live county data refresh with fallback demo data
- Dispatch recommendations ranked by predicted harm prevented per crew-hour
- Generated field briefing PDFs
- Assignment PDFs and optional Twilio SMS delivery
- Vercel-ready Vite production build

## Technology

- React 18
- Vite
- Mapbox GL JS
- IBM TTM time-series forecasting
- IBM LinuxONE backend infrastructure
- Node.js HTTP API
- Twilio SMS API
- jsPDF
- Lucide React
- Motion

## Project structure

```text
.
├── server/
│   └── index.js              Optional assignment/SMS API
├── src/
│   ├── components/
│   │   ├── CountyMap.jsx     Mapbox county map
│   │   └── AppDock.jsx       Map mode controls
│   ├── lib/
│   │   ├── assign.js         Assignment API and PDF helpers
│   │   ├── briefing.js       Briefing PDF generation
│   │   ├── dispatch.js       Dispatch allocation logic
│   │   └── liveData.js       Live-data loader and normalization
│   ├── App.jsx               Main dashboard
│   ├── App.css               Dashboard styles
│   └── data.js               Fallback demo data
├── index.html
├── package.json
├── vercel.json
└── .env.example
```

## Requirements

- Node.js 20 or newer
- npm
- A Mapbox public access token for the map

## Getting started

1. Clone the repository:

   ```bash
   git clone https://github.com/sshradd/IBMZ-Datathon-2026.git
   cd IBMZ-Datathon-2026
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, use:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Set at least `VITE_MAPBOX_TOKEN` in `.env`.

5. Start the frontend:

   ```bash
   npm run dev
   ```

   Open the URL printed by Vite, normally `http://localhost:5173`.

## Environment variables

### Frontend

Variables prefixed with `VITE_` are exposed to the browser. Do not put private credentials in these variables.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | Yes | Public Mapbox access token used by the county map |
| `VITE_LIVE_DATA_URL` | No | URL for the live county prediction JSON feed |
| `VITE_LIVE_REFRESH_MS` | No | Refresh interval in milliseconds; defaults to `300000` |
| `VITE_API_URL` | No | Base URL of the assignment API; empty uses the current origin |

If `VITE_LIVE_DATA_URL` is not set, the dashboard reads the default live-data feed from the `live-data` branch of this repository. If the feed is unavailable, the UI displays its bundled fallback data.

### Assignment API

The optional API sends assignment messages through Twilio and stores temporary PDF files in memory.

| Variable | Required | Description |
| --- | --- | --- |
| `API_PORT` | No | API port; defaults to `8787` |
| `ALLOWED_ORIGIN` | No | Allowed frontend origin for CORS |
| `TWILIO_ACCOUNT_SID` | Yes for SMS | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Yes for token auth | Twilio auth token |
| `TWILIO_API_KEY_SID` | Alternative | Twilio API key SID |
| `TWILIO_API_KEY_SECRET` | Alternative | Twilio API key secret |
| `TWILIO_FROM` | Yes for SMS | Twilio sender phone number |
| `PUBLIC_BASE_URL` | Required for PDF SMS | Public API URL used for temporary PDF links |
| `TWILIO_TRIAL_TEMPLATE` | Optional | Template name for Twilio trial-account testing |

Use either `TWILIO_AUTH_TOKEN`, or both `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET`. Keep all Twilio credentials server-side and never prefix them with `VITE_`.

## Running the assignment API

The API is optional. Start it separately from the Vite development server:

```bash
npm run api
```

By default it listens on `http://localhost:8787`.

The available endpoints are:

```text
POST /api/assignments
GET  /files/:id.pdf
```

The frontend can call the API by setting:

```text
VITE_API_URL=http://localhost:8787
```

For local PDF links to work on a recipient's phone, `PUBLIC_BASE_URL` must point to a publicly reachable API URL. PDF files are held in memory and expire after 24 hours.

## Live-data contract

The live-data URL should return JSON with a `counties` array:

```json
{
  "generated_at": "2026-10-18T14:30:00Z",
  "source": "IBM TTM on IBM LinuxONE",
  "note": "Forecast generated by the resilience pipeline.",
  "counties": [
    {
      "fips": "48113",
      "harm_score": 0.43,
      "pred_pct_24h": 5,
      "assigned_crews": 0,
      "rank": 1
    }
  ]
}
```

The frontend converts `harm_score` to a 0–100 risk score. `pred_pct_24h` is displayed as the expected 24-hour percentage change. If the live feed does not provide a usable forecast value, the frontend uses a deterministic placeholder for the demo experience.

Exposure, critical-site, and crew-hour values currently come from the frontend's county fallback metadata. These fields can be replaced with backend-provided values when the production data pipeline exposes them.

## IBM LinuxONE and IBM TTM workflow

The intended data flow is:

```text
Grid and community data
          |
          v
IBM TTM forecasting pipeline on IBM LinuxONE
          |
          v
County prediction JSON feed
          |
          v
SURGE React dashboard
          |
          v
Risk ranking, dispatch recommendations, and field briefings
```

IBM LinuxONE provides the secure backend environment for the forecasting workflow. IBM TTM produces time-series predictions that are normalized into county risk scores and 24-hour forecast changes for the dashboard.

## Production build

Build the frontend with:

```bash
npm run build
```

The compiled site is written to `dist/`.

The repository includes [vercel.json](./vercel.json), which configures Vercel to use:

```text
Framework: Vite
Build command: npm run build
Output directory: dist
```

For a Vercel deployment:

1. Import the GitHub repository into Vercel.
2. Set `VITE_MAPBOX_TOKEN` in the project environment variables.
3. Add `VITE_LIVE_DATA_URL` if using a different model-data endpoint.
4. Deploy the branch connected to the Vercel project.

The optional Node.js assignment API should be deployed separately or hosted in an environment that supports a long-running Node process. Configure its Twilio and CORS variables independently from the frontend.

## Validation

Run the production build locally before pushing changes:

```bash
npm run build
```

The build may report a large JavaScript chunk warning because Mapbox, PDF generation, and related browser libraries are bundled together. This is a warning, not a build failure.

## Security notes

- Never commit `.env` or Twilio credentials.
- Only expose public browser-safe values through `VITE_` variables.
- Restrict `ALLOWED_ORIGIN` in production instead of using `*`.
- Use HTTPS for the deployed frontend, API, and `PUBLIC_BASE_URL`.
- Treat live model output as decision support and validate operational actions before dispatch.
