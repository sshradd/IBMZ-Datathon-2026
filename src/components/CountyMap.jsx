import { MapContainer, TileLayer, Pane, Polygon, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";

const ESRI = set => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${set}/MapServer/tile/{z}/{y}/{x}`;

// One red ramp, lowest risk to critical. The legend in App.jsx reads the same array.
export const ramp = ["#e2e0d7", "#f0cdc6", "#d4766b", "#a3241f"];
export const riskColor = r => (r >= 80 ? ramp[3] : r >= 65 ? ramp[2] : r >= 50 ? ramp[1] : ramp[0]);

const INK = "#111113";
const PAPER = "#ffffff";

function FlyTo({ county }) {
  const map = useMap();
  useEffect(() => { if (county) map.flyTo(county.center, 11, { duration: 0.8 }); }, [county, map]);
  return null;
}

export default function CountyMap({ counties, selected, highlightId, onSelect, mode = "Risk" }) {
  const val = c => (mode === "Exposure" ? Math.min(100, c.exposure / 800) : mode === "Coverage" ? 100 - c.crewHours * 10 : c.risk);
  const chosen = highlightId ?? selected?.id;
  // Frame every county on first paint, leaving room for the mode switch (top) and the detail card (bottom)
  return (
    <MapContainer bounds={counties.flatMap(c => c.polygon)} boundsOptions={{ paddingTopLeft: [16, 72], paddingBottomRight: [16, 108] }}
      zoomSnap={0.25} zoomControl={false} className="map">
      {/* Esri light-gray canvas, no key needed (CARTO now stamps "API key required" on its tiles).
          Base is warmed to the paper ground in CSS; place labels sit above the risk layer so they stay readable. */}
      <TileLayer url={ESRI("World_Light_Gray_Base")} maxNativeZoom={15} attribution="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ" />
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: "none" }}>
        <TileLayer url={ESRI("World_Light_Gray_Reference")} maxNativeZoom={15} />
      </Pane>
      {counties.map(c => {
        const on = c.id === chosen;
        return (
          <Polygon key={c.id} positions={c.polygon}
            pathOptions={{ color: on ? INK : PAPER, weight: on ? 3 : 1.5, fillColor: riskColor(val(c)), fillOpacity: 0.82 }}
            eventHandlers={{ click: () => onSelect(c) }}>
            <Tooltip sticky direction="top" className="ink-tip">
              <b>{c.name}</b><span>{c.risk}</span>
            </Tooltip>
          </Polygon>
        );
      })}
      {/* Hotspots: ink ring around a red dot. Ring and dot only, no glow. */}
      {counties.filter(c => c.risk >= 70).map(c => (
        <span key={c.id}>
          <CircleMarker center={c.center} radius={16} interactive={false}
            pathOptions={{ color: INK, weight: 1.5, fill: false, opacity: 0.85 }} />
          <CircleMarker center={c.center} radius={6} interactive={false}
            pathOptions={{ color: PAPER, weight: 2, fillColor: ramp[3], fillOpacity: 1 }} />
        </span>
      ))}
      <FlyTo county={selected} />
    </MapContainer>
  );
}
