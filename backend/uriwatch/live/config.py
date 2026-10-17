"""Endpoints, cache lifetimes and the weather stations the model was trained on."""

from __future__ import annotations

UA = "uri-watch-datathon/0.1 (student project)"

# Same 12 stations as scripts/fetch_data.py, so live features match training features.
STATIONS: dict[str, tuple[float, float]] = {
    "dallas": (32.78, -96.80),
    "houston": (29.76, -95.37),
    "austin": (30.27, -97.74),
    "san_antonio": (29.42, -98.49),
    "el_paso": (31.76, -106.49),
    "lubbock": (33.58, -101.86),
    "amarillo": (35.22, -101.83),
    "corpus_christi": (27.80, -97.40),
    "midland": (31.99, -102.08),
    "tyler": (32.35, -95.30),
    "mcallen": (26.20, -98.23),
    "abilene": (32.45, -99.73),
}

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
WEATHER_VARS = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,snowfall,wind_speed_10m,cloud_cover"
ERCOT_SUPPLY_DEMAND = "https://www.ercot.com/api/1/services/read/dashboards/supply-demand.json"
ERCOT_FUEL_MIX = "https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json"
NWS_ALERTS = "https://api.weather.gov/alerts/active?area=TX"

# Seconds before each source is fetched again. The model only needs an hourly view.
TTL = {"weather": 600, "ercot": 150, "alerts": 300}
POLL_SECONDS = 60

# Fuels that add up to net generation (storage is net: negative while charging).
GEN_FUELS = ("Coal and Lignite", "Hydro", "Nuclear", "Other", "Solar", "Wind", "Natural Gas", "Power Storage")

# NWS events that matter for the grid, in rough order of importance.
RELEVANT = (
    "winter storm", "ice storm", "blizzard", "freeze", "hard freeze", "wind chill", "frost", "winter weather",
    "excessive heat", "heat advisory", "extreme heat", "hurricane", "tropical storm", "tornado",
    "severe thunderstorm", "high wind", "flood", "red flag",
)
