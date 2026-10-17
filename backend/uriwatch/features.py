"""Feature list shared by training and serving, plus plain-English reasons.

One county-hour is described by FEATURES, in this order. Everything here uses
only what was known at that hour: outages so far, weather so far, grid
telemetry so far. No future data, so a replayed storm is scored honestly.
"""

from __future__ import annotations

import math

FEATURES = [
    # outage momentum (what the utility map shows right now)
    "log_out_now",
    "out_trend_1h",
    "out_trend_3h",
    "log_out_max6h",
    # weather at the county's nearest station
    "temp_c",
    "apparent_c",
    "cold_deg",
    "heat_deg",
    "temp_drop_24h",
    "temp_change_3h",
    "wind_kmh",
    "precip_6h",
    "snow_6h",
    "ice_index",
    "humidity",
    # ERCOT grid telemetry (statewide)
    "grid_fc_err",
    "grid_demand_norm",
    "grid_gen_drop_24h",
    "grid_wind_share",
    # statewide storm footprint (known at this hour)
    "state_sev_frac",
    "state_sev_trend_3h",
    "state_cold_deg",
    # who lives there
    "log_pop",
    # time of day (local)
    "hour_sin",
    "hour_cos",
]
N_FEATURES = len(FEATURES)
IDX = {f: i for i, f in enumerate(FEATURES)}

# Features that describe the county's *own* state or weather (local) versus the
# statewide grid. The dashboard splits a score into "local" and "grid" parts.
GRID_FEATURES = {
    "grid_fc_err", "grid_demand_norm", "grid_gen_drop_24h", "grid_wind_share",
    "state_sev_frac", "state_sev_trend_3h", "state_cold_deg",
}

HORIZON_H = 24  # the headline label: a severe outage starts within the next 24 hours
HORIZONS = (6, 12, 24)  # one model head per horizon, so we can say not just whether but roughly when

# Where a score comes from, for the diagnostic views. Contributions are summed per group.
GROUPS = {
    "momentum": ("Outage momentum", ["log_out_now", "out_trend_1h", "out_trend_3h", "log_out_max6h"]),
    "weather": (
        "Local weather",
        ["temp_c", "apparent_c", "cold_deg", "heat_deg", "temp_drop_24h", "temp_change_3h",
         "wind_kmh", "precip_6h", "snow_6h", "ice_index", "humidity"],
    ),
    "grid": ("Grid stress", ["grid_fc_err", "grid_demand_norm", "grid_gen_drop_24h", "grid_wind_share"]),
    "spread": ("Statewide spread", ["state_sev_frac", "state_sev_trend_3h", "state_cold_deg"]),
    "profile": ("County profile", ["log_pop", "hour_sin", "hour_cos"]),
}
GROUP_ORDER = list(GROUPS)
FEATURE_GROUP = {f: g for g, (_, fs) in GROUPS.items() for f in fs}
SEVERE_MIN_CUSTOMERS = 2500
SEVERE_FRACTION = 0.10  # or 10% of the county's customers, whichever is larger
PEOPLE_PER_CUSTOMER = 2.6


def severe_threshold(pop: float) -> float:
    """Customers out at which an outage counts as severe for a county of this size."""
    return max(SEVERE_MIN_CUSTOMERS, SEVERE_FRACTION * pop / PEOPLE_PER_CUSTOMER)


def c_to_f(c: float) -> float:
    return c * 9.0 / 5.0 + 32.0


def reason_text(code: str, x: list[float]) -> str:
    """One plain-English sentence for a feature, from the raw feature vector."""
    g = lambda name: x[IDX[name]]  # noqa: E731
    if code == "log_out_now":
        return f"{math.expm1(g('log_out_now')):,.0f} customers already without power"
    if code in ("out_trend_1h", "out_trend_3h"):
        span = "hour" if code.endswith("1h") else "3 hours"
        return f"Outages are climbing: {math.expm1(g('log_out_now')):,.0f} out now, rising over the last {span}"
    if code == "log_out_max6h":
        return f"Up to {math.expm1(g('log_out_max6h')):,.0f} customers lost power in the last 6 hours"
    if code in ("temp_c", "cold_deg"):
        return f"Temperature is {c_to_f(g('temp_c')):.0f}°F, well below normal operating range"
    if code == "apparent_c":
        return f"Feels like {c_to_f(g('apparent_c')):.0f}°F"
    if code == "heat_deg":
        return f"Extreme heat: {c_to_f(g('temp_c')):.0f}°F is straining the system"
    if code == "temp_drop_24h":
        return f"Temperature changed {g('temp_drop_24h') * 1.8:+.0f}°F in 24 hours"
    if code == "temp_change_3h":
        return f"Temperature moved {g('temp_change_3h') * 1.8:+.0f}°F in the last 3 hours"
    if code == "wind_kmh":
        return f"Winds near {g('wind_kmh') * 0.621:.0f} mph"
    if code in ("precip_6h", "ice_index"):
        return f"{g('precip_6h'):.1f} mm of precipitation at or near freezing in 6 hours (ice risk)"
    if code == "snow_6h":
        return f"{g('snow_6h'):.1f} cm of snow in the last 6 hours"
    if code == "humidity":
        return f"Humidity {g('humidity'):.0f}%"
    if code == "grid_fc_err":
        return f"Grid demand is {g('grid_fc_err') * 100:+.0f}% versus ERCOT's own forecast"
    if code == "grid_demand_norm":
        return f"Statewide demand is {g('grid_demand_norm') * 100:+.0f}% versus its two-week norm"
    if code == "grid_gen_drop_24h":
        return f"Statewide generation is down {abs(g('grid_gen_drop_24h')) * 100:.0f}% from its 48-hour peak"
    if code == "grid_wind_share":
        return f"Wind is {g('grid_wind_share') * 100:.0f}% of generation"
    if code == "state_sev_frac":
        return f"{g('state_sev_frac') * 100:.0f}% of Texas counties already have severe outages"
    if code == "state_sev_trend_3h":
        return f"Severe outages spreading statewide: {g('state_sev_trend_3h') * 100:+.0f} points of Texas in 3 hours"
    if code == "state_cold_deg":
        return f"Statewide cold: stations average {g('state_cold_deg') * 1.8:.0f}°F below the freezing-risk line"
    if code == "log_pop":
        return f"Large population ({math.exp(g('log_pop')):,.0f} residents) raises the stakes"
    if code == "senior_share":
        return f"{g('senior_share') * 100:.0f}% of residents are 65 or older"
    if code in ("hour_sin", "hour_cos"):
        return "Time of day"
    return code
