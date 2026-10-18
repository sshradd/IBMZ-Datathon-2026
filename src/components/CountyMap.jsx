import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Lower risk -> critical (App.jsx imports this for the popup number color)
export const riskColor = r => (r >= 80 ? "#e5584d" : r >= 65 ? "#f08a4b" : r >= 50 ? "#f2c14e" : "#8fd1bd");

// Mapbox uses [lng, lat]; centers are [lat, lng], so we flip.
const flip = ([lat, lng]) => [lng, lat];
const TX_BOUNDS = [[-106.7, 25.8], [-93.5, 36.6]]; // whole state
const FIT = { padding: 24, duration: 800 };

// All US county shapes (public GeoJSON on GitHub). We keep only Texas (state code 48) = 254 counties.
const SHAPES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";

export default function CountyMap(props) {
  const [tx, setTx] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(SHAPES_URL)
      .then(r => r.json())
      .then(d => setTx({
        features: d.features
          .filter(f => f.properties.STATE === "48")
          .map(f => ({ type: "Feature", geometry: f.geometry, properties: { fips: "48" + f.properties.COUNTY, name: f.properties.NAME } })),
      }))
      .catch(() => setFailed(true));
  }, []);
  const msg = { display: "grid", placeItems: "center", color: "#fff", fontWeight: 600 };
  if (failed) return <div className="map" style={msg}>Could not load Texas county shapes. Check your internet.</div>;
  if (!tx) return <div className="map" style={msg}>Loading Texas map…</div>;
  return <MapView {...props} tx={tx} />;
}

function MapView({ tx, counties, selected, onSelect, mode = "Risk" }) {
  // Center of a county = middle of its bounding box, as [lat, lng]
  const centers = useMemo(() => {
    const out = {};
    tx.features.forEach(f => {
      const pts = [];
      const walk = c => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
      walk(f.geometry.coordinates);
      const lngs = pts.map(p => p[0]), lats = pts.map(p => p[1]);
      out[f.properties.fips] = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
    });
    return out;
  }, [tx]);
  const box = useRef(null);
  const mapRef = useRef(null);
  const loaded = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const val = c =>
    mode === "Exposure" ? Math.min(100, c.exposure / 800) : mode === "Coverage" ? 100 - c.crewHours * 10 : c.risk;

  // All 254 counties drawn; only the ones in `counties` get risk colors.
  const countiesGeo = () => {
    const byFips = Object.fromEntries(counties.map(c => [c.fips, c]));
    return {
      type: "FeatureCollection",
      features: tx.features.map(f => {
        const c = byFips[f.properties.fips];
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: c
            ? { id: c.id, name: c.name, risk: c.risk, tracked: true, color: riskColor(val(c)), op: 0.4, lw: 2 }
            : { id: "", name: f.properties.name, risk: -1, tracked: false, color: "#ffffff", op: 0.05, lw: 0.5 },
        };
      }),
    };
  };

  // Demo route: 2nd-highest county -> highest. Backend should send real route coordinates.
  const routeCoords = () => {
    const top = [...counties].sort((a, b) => b.risk - a.risk);
    const a = flip(centers[top[1].fips]), b = flip(centers[top[0].fips]);
    return [a, [(a[0] + b[0]) / 2 - 0.6, (a[1] + b[1]) / 2 + 0.3], b];
  };

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: box.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      bounds: TX_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      try { map.setPaintProperty("satellite", "raster-brightness-max", 0.6); } catch {}

      map.addSource("counties", { type: "geojson", data: countiesGeo() });
      map.addLayer({ id: "county-fill", type: "fill", source: "counties",
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "op"] } });
      map.addLayer({ id: "county-line", type: "line", source: "counties",
        paint: { "line-color": ["get", "color"], "line-width": ["get", "lw"], "line-opacity": 0.9 } });

      const route = routeCoords();
      map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: route } } });
      map.addSource("route-done", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: route.slice(0, 2) } } });
      map.addLayer({ id: "route-dash", type: "line", source: "route",
        layout: { "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 4, "line-dasharray": [0.5, 2.5] } });
      map.addLayer({ id: "route-solid", type: "line", source: "route-done",
        layout: { "line-cap": "round" }, paint: { "line-color": "#f5a623", "line-width": 5 } });

      counties.forEach(c => {
        const el = document.createElement("div");
        el.style.cssText = "width:48px;height:48px;cursor:pointer";
        el.innerHTML = `<div class="pin ${c.risk >= 80 ? "hot" : ""}">⚡<span>${c.sites}</span></div>`;
        el.addEventListener("click", () => onSelectRef.current(c));
        new mapboxgl.Marker({ element: el }).setLngLat(flip(centers[c.fips])).addTo(map);
      });

      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "m-tip", offset: 10 });
      map.on("mousemove", "county-fill", e => {
        const p = e.features[0].properties;
        map.getCanvas().style.cursor = p.tracked ? "pointer" : "";
        tip.setLngLat(e.lngLat)
          .setHTML(p.tracked ? `<b>${p.name}</b><span>${p.risk}</span>` : `<b>${p.name} County</b>`)
          .addTo(map);
      });
      map.on("mouseleave", "county-fill", () => { map.getCanvas().style.cursor = ""; tip.remove(); });
      map.on("click", "county-fill", e => {
        const c = counties.find(x => x.id === e.features[0].properties.id);
        if (c) onSelectRef.current(c);
      });

      loaded.current = true;
    });

    return () => { loaded.current = false; map.remove(); };
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (loaded.current) mapRef.current.getSource("counties")?.setData(countiesGeo());
    // eslint-disable-next-line
  }, [counties, mode]);

  useEffect(() => {
    if (selected && mapRef.current) mapRef.current.flyTo({ center: flip(centers[selected.fips]), zoom: 7.2, duration: 900 });
  }, [selected]);

  return (
    <>
      <div ref={box} className="map" />
      <div className="ctrls">
        <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">−</button>
        <button onClick={() => mapRef.current?.fitBounds(TX_BOUNDS, FIT)} aria-label="Show all of Texas">◎</button>
      </div>
    </>
  );
}