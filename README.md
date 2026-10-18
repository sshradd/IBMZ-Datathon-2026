# Uri Watch

**Early-warning and dispatch tool for first responders during power-outage emergencies.**
Uri Watch forecasts which Texas counties will suffer serious power outages over the next
hours-to-days and ranks where to send crews and warming centers first, weighting vulnerable
residents. It is backtested on Winter Storm Uri (February 2021).

Built for the IBM Z Datathon 2026. The forecasting model is a fine-tuned IBM Granite
TinyTimeMixer, trained and evaluated on an IBM LinuxONE (s390x) instance.

## What it does

- **Forecast** per-county outage percentage 96 hours ahead from weather + grid signals.
- **Rank** counties by predicted harm (outage severity weighted by vulnerable population and
  critical facilities) to drive a greedy dispatch recommender.
- **Work with comms down** — produces a printable one-page PDF / SMS-length briefing.

## Model

- **Backbone:** `ibm-granite/granite-timeseries-ttm-r2` (TinyTimeMixer, Apache 2.0),
  fine-tuned via `granite-tsfm` (`tsfm_public`).
- **Setup:** 512 h context → 96 h forecast, exogenous weather (known ahead) + statewide grid
  demand (past only), `decoder_mode="mix_channel"`, frozen backbone (few-shot).
- **Target:** `log1p(pct_out)`. **Chronological split:** train < 2021-01-15, validate through
  2021-02-01, test = February 2021 (Uri), so the storm month is never used for any choice.
- **Baseline:** persistence ("nothing changes").

## Results — held-out Uri month, all 254 Texas counties

A "serious outage" is ≥ 2% of a county's customers out within the window. AUC measures how well
the forecast separates event windows from quiet ones (0.5 = chance); it is the metric the
dispatcher relies on for ranking.

| Horizon | Model | AUC | hit-rate | MAE % |
|--:|--|--:|--:|--:|
| 6 h  | **TTM** | **0.959** | 0.855 | 1.73 |
| 6 h  | persistence | 0.947 | 0.860 | 1.10 |
| 24 h | **TTM** | **0.877** | 0.707 | 2.83 |
| 24 h | persistence | 0.849 | 0.709 | 2.32 |
| 96 h | **TTM** | **0.752** | **0.638** | **3.97** |
| 96 h | persistence | 0.714 | 0.608 | 5.45 |

TTM beats persistence on AUC at every horizon, and the lead widens with lead time — the
practical value being longer, more actionable warning. (See `notebooks/ttm_full_out.ipynb`.)

## Data (`data/county_hourly.csv`, one row per county per hour)

`fips, timestamp, pct_out, temp_c, wind_ms, gust_ms, precip_mm, snow_cm, grid_demand_mwh`

Built by the scripts in `scripts/` (range 2020-01-01 → 2021-02-28, UTC):

- **Outages:** EAGLE-I (ORNL), 15-min county outages, rolled to hourly and converted to a
  percentage using modeled customers per county (`MCC.csv`).
- **Weather:** Open-Meteo ERA5 archive per county centroid.
- **Grid demand:** ERCOT public hourly native load (statewide).
- **County centroids:** US Census 2020 gazetteer.

```
python scripts/prep_counties.py      # TX county list + centroids + customer denominators
python scripts/process_eaglei.py     # EAGLE-I 15-min -> hourly pct_out
python scripts/process_ercot.py      # ERCOT statewide hourly demand (Central -> UTC)
python scripts/fetch_weather.py      # Open-Meteo ERA5 per centroid (cached, resumable)
python scripts/build_table.py        # assemble data/county_hourly.csv
```

Then run `ttm_finetune_outages.ipynb` top to bottom (set `USE_SYNTHETIC = False`).

## Running on IBM LinuxONE (s390x)

This runs on s390x, where numpy/pandas/scipy/scikit-learn have no prebuilt wheels and were
compiled from source; torch is the `2.8.0+cpu` s390x wheel. HuggingFace `datasets` (which needs
pyarrow, unbuildable here) is replaced by a tiny stub in `stubs/datasets/` — `tsfm_public` only
needs its `Dataset` type, never used on the DataFrame path. The notebook puts `stubs/` on
`sys.path` automatically.

## Limitations (stated honestly)

- Historical **observed** weather stands in for a forecast; real responders would have less
  accurate forecasts.
- The grid-demand signal is **statewide**, not local.
- Winter Storm Uri is **out-of-distribution** — an extreme the model never saw in training.
- Vulnerability and facility data are **aggregate** county-level counts.

## Data licenses / citations

- EAGLE-I power outage data — Oak Ridge National Laboratory (figshare 24237376).
- Open-Meteo ERA5 archive — CC BY 4.0.
- ERCOT hourly load archives — public.
- US Census 2020 county gazetteer — public domain.
