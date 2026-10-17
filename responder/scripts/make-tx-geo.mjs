// Cut Texas out of the US Atlas county boundaries (public domain Census data, via the us-atlas package)
// and round the coordinates, so the map works offline from one small file.
import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";

const topo = JSON.parse(readFileSync("node_modules/us-atlas/counties-10m.json", "utf8"));
const all = feature(topo, topo.objects.counties);
const round = (c) => (typeof c[0] === "number" ? [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000] : c.map(round));
const features = all.features
  .filter((f) => String(f.id).startsWith("48"))
  .map((f) => ({
    type: "Feature",
    properties: { fips: String(f.id), name: f.properties.name },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  }));
writeFileSync("public/tx-counties.json", JSON.stringify({ type: "FeatureCollection", features }));
console.log(`${features.length} Texas counties`);
