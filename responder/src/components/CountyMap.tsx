"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, LngLatBoundsLike, Map as MLMap, Marker } from "maplibre-gl";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { pct } from "@/lib/format";
import type { Tiers } from "@/lib/store";
import type { County, Depot, HourEvent } from "@/lib/types";
import CountyMapSvg, { type Layer, type MapLink } from "./CountyMapSvg";

export type { Layer, MapLink };

// The alert tiers are set on the 24 h forecast. Shorter windows scale those lines down.
const SCALE = { p6: 0.33, p12: 0.57, p24: 1 } as const;
const TEXAS: LngLatBoundsLike = [
  [-106.9, 25.6],
  [-93.3, 36.7],
];
// Esri Canvas basemaps: roads, water and places, no key needed, kept quiet so the risk colors carry the screen
const FIT_PADDING = { top: 104, bottom: 24, left: 24, right: 72 };
const TILE = (set: string) => [`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${set}/MapServer/tile/{z}/{y}/{x}`];
const ATTRIBUTION = "Tiles © Esri — Esri, DeLorme, NAVTEQ";
// fill strength per tier: no risk stays clear so the real map shows through
const TIER_OPACITY = [0, 0.55, 0.72, 0.86];

interface Geo {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { fips: string; name: string }; geometry: { type: string; coordinates: unknown } }[];
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A gentle arc from a depot to a county so a route reads as a route and not a ruler line. */
function arc(a: [number, number], b: [number, number]): [number, number][] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * 0.12;
  const cy = my + dx * 0.12;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([(1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2]);
  }
  return pts;
}

function el(cls: string, html = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  return d;
}

export default function CountyMap(props: {
  latest: HourEvent | null;
  counties: County[];
  layer: Layer;
  tiers: Tiers | null;
  selected: string | null;
  onSelect: (fips: string) => void;
  depots?: Depot[];
  lines?: MapLink[];
  staging?: { name: string; lat: number; lon: number }[];
  beacon?: string[];
  height?: string;
}) {
  const { latest, counties, layer, tiers, selected, onSelect, depots = [], lines = [], staging = [], beacon = [], height = "100%" } = props;
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const me = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState("day");
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  const index = useMemo(() => new Map(counties.map((c, i) => [c.fips, i])), [counties]);
  const byFips = useMemo(() => new Map(counties.map((c) => [c.fips, c])), [counties]);

  // follow the app theme
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme ?? "day");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // build the map once
  useEffect(() => {
    let dead = false;
    let map: MLMap | null = null;
    (async () => {
      try {
        const [mod, geo] = await Promise.all([import("maplibre-gl"), fetch("/tx-counties.json").then((r) => r.json() as Promise<Geo>)]);
        const ml = ((mod as unknown as { default?: typeof import("maplibre-gl") }).default ?? mod) as typeof import("maplibre-gl");
        if (dead || !host.current) return;
        mlRef.current = ml;
        map = new ml.Map({
          container: host.current,
          bounds: TEXAS,
          fitBoundsOptions: { padding: FIT_PADDING },
          maxBounds: [
            [-114, 21],
            [-86, 40],
          ],
          minZoom: 3.8,
          maxZoom: 12,
          preserveDrawingBuffer: true, // lets the browser capture the map for screenshots and printing
          dragRotate: false,
          pitchWithRotate: false,
          attributionControl: { compact: true },
          style: {
            version: 8,
            sources: {
              base: { type: "raster", tiles: TILE("World_Light_Gray_Base"), tileSize: 256, maxzoom: 15, attribution: ATTRIBUTION },
              labels: { type: "raster", tiles: TILE("World_Light_Gray_Reference"), tileSize: 256, maxzoom: 15 },
              baseDark: { type: "raster", tiles: TILE("World_Dark_Gray_Base"), tileSize: 256, maxzoom: 15, attribution: ATTRIBUTION },
              labelsDark: { type: "raster", tiles: TILE("World_Dark_Gray_Reference"), tileSize: 256, maxzoom: 15 },
              counties: { type: "geojson", data: geo as never, promoteId: "fips" },
              routes: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            },
            layers: [
              { id: "bg", type: "background", paint: { "background-color": "#e7e5dd" } },
              { id: "base", type: "raster", source: "base", paint: { "raster-fade-duration": 150 } },
              { id: "baseDark", type: "raster", source: "baseDark", layout: { visibility: "none" } },
              { id: "county-fill", type: "fill", source: "counties", paint: { "fill-color": ["coalesce", ["feature-state", "c"], "#a3241f"], "fill-opacity": ["coalesce", ["feature-state", "o"], 0] } },
              { id: "county-line", type: "line", source: "counties", paint: { "line-color": "#7c7a72", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 1.2] } },
              { id: "county-sev", type: "line", source: "counties", paint: { "line-color": "#111", "line-opacity": 0.5, "line-width": ["case", ["boolean", ["feature-state", "sev"], false], 0.9, 0] } },
              { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.95 } },
              { id: "labelsDark", type: "raster", source: "labelsDark", layout: { visibility: "none" } },
              { id: "county-sel", type: "line", source: "counties", paint: { "line-color": "#111", "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 3, 0] } },
              { id: "county-hit", type: "fill", source: "counties", paint: { "fill-color": "#000", "fill-opacity": 0.001 } },
              { id: "route-plan", type: "line", source: "routes", filter: ["==", ["get", "planned"], 0], layout: { "line-cap": "round" }, paint: { "line-color": "#111", "line-width": 3, "line-dasharray": [1.4, 1.6] } },
              { id: "route-done", type: "line", source: "routes", filter: ["==", ["get", "planned"], 1], layout: { "line-cap": "round" }, paint: { "line-color": "#111", "line-width": 3.5 } },
            ],
          },
        });
        mapRef.current = map;
        map.touchZoomRotate.disableRotation();
        map.on("load", () => {
          if (dead) return;
          // the container can still be settling its size when the map is created: measure again and frame Texas
          map!.resize();
          map!.fitBounds(TEXAS, { padding: FIT_PADDING, duration: 0 });
          setReady(true);
          requestAnimationFrame(() => map!.triggerRepaint());
        });
        // until the person moves the map themselves, keep Texas framed when the layout changes (rotate, resize, panel)
        let touched = false;
        map.on("dragstart", () => (touched = true));
        map.on("zoomstart", (e) => {
          if ((e as { originalEvent?: unknown }).originalEvent) touched = true;
        });
        new ResizeObserver(() => {
          if (!touched) map!.fitBounds(TEXAS, { padding: FIT_PADDING, duration: 0 });
        }).observe(host.current);
        const zoomClass = () => host.current?.classList.toggle("zoomed-out", map!.getZoom() < 5.6);
        map.on("zoom", zoomClass);
        zoomClass();
        map.on("click", "county-hit", (e) => {
          const f = e.features?.[0];
          if (f) select.current(String(f.id ?? f.properties?.fips));
        });
        map.on("mousemove", "county-hit", (e) => {
          const f = e.features?.[0];
          map!.getCanvas().style.cursor = "pointer";
          if (f) setHover({ x: e.point.x, y: e.point.y, text: String(f.properties?.fips ?? f.id) });
        });
        map.on("mouseleave", "county-hit", () => {
          map!.getCanvas().style.cursor = "";
          setHover(null);
        });
        map.on("error", (e) => {
          console.warn("map:", (e.error as { message?: string } | undefined)?.message);
          // a missing tile (offline) is normal; only a dead WebGL context is fatal
          if (String((e.error as { message?: string } | undefined)?.message ?? "").includes("WebGL")) setFailed(true);
        });
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      me.current?.remove();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // theme: swap base tiles and line colors
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const night = theme === "night";
    const vis = (id: string, on: boolean) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("base", !night);
    vis("labels", !night);
    vis("baseDark", night);
    vis("labelsDark", night);
    map.setPaintProperty("bg", "background-color", night ? "#1c1d20" : "#e7e5dd");
    map.setPaintProperty("county-line", "line-color", night ? "#9a9ca3" : "#7c7a72");
    const ink = css("--ink") || "#111";
    for (const id of ["county-sev", "county-sel", "route-plan", "route-done"]) map.setPaintProperty(id, "line-color", ink);
  }, [theme, ready]);

  // paint the counties
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const tierColor = [css("--tier-0"), css("--tier-1"), css("--tier-2"), css("--tier-3")];
    for (const c of counties) {
      const i = index.get(c.fips)!;
      const row = latest?.counties[i];
      let tier = 0;
      let op = 0;
      let sev = false;
      if (row) {
        if (layer === "out") {
          const out = row[2];
          if (out >= c.severe_at) {
            tier = 3;
            op = TIER_OPACITY[3];
          } else if (out > 0) {
            tier = 2;
            op = 0.3 + 0.5 * Math.min(1, ((out * 2.6) / Math.max(c.pop, 1)) * 8);
          }
        } else if (layer === "nws") {
          const n = latest?.alerts?.by_fips[c.fips]?.length ?? 0;
          if (n) {
            tier = 2;
            op = 0.5 + Math.min(0.3, n * 0.12);
          }
        } else {
          if (layer === "p24") tier = row[1];
          else if (tiers) {
            const p = layer === "p6" ? row[3] : row[4];
            const s = SCALE[layer];
            tier = p >= tiers.act * s ? 3 : p >= tiers.prepare * s ? 2 : p >= tiers.watch * s ? 1 : 0;
          }
          op = TIER_OPACITY[tier];
        }
        sev = row[2] >= c.severe_at && layer !== "out";
      }
      map.setFeatureState({ source: "counties", id: c.fips }, { c: tierColor[tier], o: op, sev, sel: selected === c.fips });
    }
  }, [latest, layer, tiers, selected, counties, index, ready, theme]);

  // selecting a county brings it into view, with its route if it has one
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sel = selected;
    if (sel === prevSel.current) return;
    prevSel.current = sel;
    const c = sel ? byFips.get(sel) : undefined;
    if (!c) return;
    const link = lines.find((l) => l.id === `plan-${c.fips}`);
    const d = link && depots.find((x) => x.name === link.depot);
    const padding = { top: 130, bottom: window.innerWidth < 1024 ? 300 : 60, left: 50, right: 80 };
    if (d) map.fitBounds([[Math.min(d.lon, c.lon), Math.min(d.lat, c.lat)], [Math.max(d.lon, c.lon), Math.max(d.lat, c.lat)]], { padding, maxZoom: 8, duration: 700 });
    else map.easeTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 6.4), padding, duration: 700 });
  }, [selected, ready, byFips, lines, depots]);

  // hover text
  const hoverText = useMemo(() => {
    if (!hover) return null;
    const c = byFips.get(hover.text);
    const i = index.get(hover.text);
    const row = i != null ? latest?.counties[i] : undefined;
    if (!c || !row) return null;
    const what = layer === "out" ? `${row[2].toLocaleString()} customers out` : layer === "nws" ? (latest?.alerts?.by_fips[c.fips] ?? ["no active alerts"]).join(", ") : `${pct(layer === "p6" ? row[3] : layer === "p12" ? row[4] : row[0], 1)} risk within ${layer.slice(1)} h`;
    return { x: hover.x, y: hover.y, name: `${c.name} County`, what };
  }, [hover, byFips, index, latest, layer]);

  // routes, depots, ETA badges, beacon, staging. Rebuilt only when what they show changes, not on every forecast tick.
  const sig = JSON.stringify([lines, staging, beacon, depots.map((d) => d.id)]);
  const latestProps = useRef({ lines, staging, beacon, depots });
  latestProps.current = { lines, staging, beacon, depots };
  useEffect(() => {
    const { lines, staging, beacon, depots } = latestProps.current;
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const add = (node: HTMLElement, lon: number, lat: number, anchor: "center" | "bottom" = "center") => {
      markers.current.push(new ml.Marker({ element: node, anchor }).setLngLat([lon, lat]).addTo(map));
    };

    const feats: GeoJSON.Feature[] = [];
    for (const a of lines.slice(0, 40)) {
      const d = depots.find((x) => x.name === a.depot);
      if (!d) continue;
      const path = arc([d.lon, d.lat], [a.lon, a.lat]);
      feats.push({ type: "Feature", properties: { planned: a.planned ? 1 : 0 }, geometry: { type: "LineString", coordinates: path } });
      if (a.eta != null) {
        const mid = path[12];
        add(el("map-eta", `<b>${a.eta}</b> min`), mid[0], mid[1]);
      }
    }
    (map.getSource("routes") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });

    for (const d of depots) add(el("map-depot", `<i></i><span>${d.name.split(" ")[0]}</span>`), d.lon, d.lat);
    for (const f of beacon) {
      const c = byFips.get(f);
      if (c) add(el("map-beacon", "<i></i>"), c.lon, c.lat);
    }
    for (const s of staging) add(el("map-stage", `<i></i><span>Stage here</span>`), s.lon, s.lat);
  }, [sig, byFips, ready]);

  const locate = () => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        me.current?.remove();
        me.current = new ml.Marker({ element: el("map-me", "<i></i>") }).setLngLat([p.coords.longitude, p.coords.latitude]).addTo(map);
        map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.getZoom(), 7.5) });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  if (failed) return <CountyMapSvg {...props} />;

  return (
    <div className="relative" style={{ height }}>
      <div ref={host} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} role="application" aria-label="Map of Texas counties colored by the selected layer. The county list view has the same data as a table." />
      {hoverText && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] shadow-md" style={{ left: Math.min(hoverText.x + 14, 9999), top: hoverText.y + 14 }}>
          <b className="font-semibold">{hoverText.name}</b>
          <span className="muted"> · {hoverText.what}</span>
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
        <MapButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <Minus />
        </MapButton>
        <MapButton label="Show all of Texas" onClick={() => mapRef.current?.fitBounds(TEXAS, { padding: FIT_PADDING })}>
          <Maximize2 />
        </MapButton>
        <MapButton label="Show my location" onClick={locate}>
          <Crosshair />
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick} className="map-btn">
      {children}
    </button>
  );
}
