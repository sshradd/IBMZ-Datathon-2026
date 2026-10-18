const LIVE_DATA_URL = import.meta.env.VITE_LIVE_DATA_URL ||
  "https://raw.githubusercontent.com/sshradd/IBMZ-Datathon-2026/live-data/live.json";
const COUNTY_SHAPES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";

const fallbackFields = {
  "48029": { exposure: 76400, sites: 15, crewHours: 7 },
  "48113": { exposure: 31800, sites: 8, crewHours: 3 },
  "48141": { exposure: 22100, sites: 5, crewHours: 3 },
  "48201": { exposure: 48200, sites: 12, crewHours: 4 },
  "48303": { exposure: 18900, sites: 3, crewHours: 2 },
};

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = value => Math.max(0, Math.min(100, value));
const placeholderForecast = fips => {
  const seed = [...String(fips)].reduce((total, digit) => total + Number(digit), 0);
  return (seed % 17) - 8;
};
let countyNamesPromise;

export async function loadLiveData() {
  const liveUrl = `${LIVE_DATA_URL}${LIVE_DATA_URL.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const response = await fetch(liveUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Live data request failed (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.counties)) throw new Error("Live data is missing its counties array.");
  countyNamesPromise ||= fetch(COUNTY_SHAPES_URL)
    .then(shapesResponse => {
      if (!shapesResponse.ok) throw new Error(`County names request failed (${shapesResponse.status}).`);
      return shapesResponse.json();
    })
    .then(shapes => Object.fromEntries(
      shapes.features
        .filter(feature => feature.properties.STATE === "48")
        .map(feature => [`48${feature.properties.COUNTY}`, feature.properties.NAME]),
    ));
  const names = await countyNamesPromise;

  const counties = data.counties.map(record => {
    const fips = String(record.fips).padStart(5, "0");
    const fallback = fallbackFields[fips] || {};
    const forecast = number(record.pred_pct_24h);
    return {
      id: fips,
      fips,
      name: names[fips] || `County ${fips}`,
      risk: Math.round(clamp(number(record.harm_score) * 100)),
      delta: forecast || placeholderForecast(fips),
      exposure: fallback.exposure || 0,
      sites: fallback.sites || 0,
      crewHours: fallback.crewHours || 0,
      assignedCrews: number(record.assigned_crews),
      rank: number(record.rank),
    };
  });

  return {
    counties,
    generatedAt: data.generated_at,
    fetchedAt: new Date().toISOString(),
    source: data.source,
    note: data.note,
  };
}
