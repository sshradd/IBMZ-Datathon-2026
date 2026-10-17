import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";

// Same palette as the legend: lower risk -> critical
export const riskColor = r => (r >= 80 ? "#c9473f" : r >= 65 ? "#dc8a4f" : r >= 50 ? "#e2b865" : "#b4d1c7");

function FlyTo({ county }) {
  const map = useMap();
  useEffect(() => { if (county) map.flyTo(county.center, 11, { duration: 0.8 }); }, [county, map]);
  return null;
}

export default function CountyMap({ counties, selected, onSelect, mode = "Risk" }) {
  const val = c => (mode === "Exposure" ? Math.min(100, c.exposure / 800) : mode === "Coverage" ? 100 - c.crewHours * 10 : c.risk);
  return (
    <MapContainer center={[32.88, -96.78]} zoom={10} zoomControl={false} className="map">
      {/* Light CARTO "Positron" tiles = the pale grey look from your reference. No API key needed. */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />
      {counties.map(c => (
        <Polygon key={c.id} positions={c.polygon}
          pathOptions={{ color: "#fff", weight: 2, fillColor: riskColor(val(c)), fillOpacity: 0.78 }}
          eventHandlers={{ click: () => onSelect(c) }}>
          <Tooltip sticky direction="top" className="dark-tip">
            <b>{c.name}</b><span>{c.risk}</span>
          </Tooltip>
        </Polygon>
      ))}
      {/* Glowing hotspot markers like the reference (stacked circles) */}
      {counties.filter(c => c.risk >= 70).map(c => (
        <span key={c.id}>
          <CircleMarker center={c.center} radius={20} pathOptions={{ stroke: false, fillColor: "#f2a93b", fillOpacity: 0.28 }} />
          <CircleMarker center={c.center} radius={6} pathOptions={{ color: "#fff", weight: 2, fillColor: "#c9473f", fillOpacity: 1 }} />
        </span>
      ))}
      <FlyTo county={selected} />
    </MapContainer>
  );
}
