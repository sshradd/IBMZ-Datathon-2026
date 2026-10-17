"use client";

import { geoConicEqualArea, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { Tiers } from "@/lib/store";
import type { County, Depot, HourEvent } from "@/lib/types";

export interface MapLink {
  id: string;
  depot: string;
  lat: number;
  lon: number;
}
import { pct } from "@/lib/format";

export type Layer = "p6" | "p12" | "p24" | "out" | "nws";

const W = 1000;
const H = 940;
// The alert tiers are set on the 24 h forecast. Shorter windows scale those lines down.
const SCALE = { p6: 0.33, p12: 0.57, p24: 1 } as const;
const TIER_FILL = ["var(--tier-0)", "var(--tier-1)", "var(--tier-2)", "var(--tier-3)"];

interface Geo {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { fips: string; name: string }; geometry: GeoPermissibleObjects }[];
}

export default function CountyMap({
  latest,
  counties,
  layer,
  tiers,
  selected,
  onSelect,
  depots = [],
  lines = [],
  staging = [],
  beacon = [],
  height = "100%",
}: {
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
  const [geo, setGeo] = useState<Geo | null>(null);
  useEffect(() => {
    fetch("/tx-counties.json")
      .then((r) => r.json())
      .then(setGeo)
      .catch(() => {});
  }, []);

  const { paths, project } = useMemo(() => {
    if (!geo) return { paths: [] as { fips: string; name: string; d: string }[], project: null as null | ((lon: number, lat: number) => [number, number]) };
    const proj = geoConicEqualArea().parallels([27.5, 35]).rotate([100, 0]).fitExtent(
      [
        [14, 14],
        [W - 14, H - 14],
      ],
      geo as unknown as GeoPermissibleObjects,
    );
    const path = geoPath(proj);
    return {
      paths: geo.features.map((f) => ({ fips: f.properties.fips, name: f.properties.name, d: path(f.geometry) ?? "" })),
      project: (lon: number, lat: number) => (proj([lon, lat]) ?? [0, 0]) as [number, number],
    };
  }, [geo]);

  const index = useMemo(() => new Map(counties.map((c, i) => [c.fips, i])), [counties]);
  const byFips = useMemo(() => new Map(counties.map((c) => [c.fips, c])), [counties]);

  // pan and zoom
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ d: number; k: number } | null>(null);
  const moved = useRef(0);

  const clampView = (v: { k: number; x: number; y: number }) => {
    const k = Math.min(8, Math.max(1, v.k));
    const minX = W - W * k;
    const minY = H - H * k;
    return { k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
  };
  const toSvg = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
  };
  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => {
      const k = Math.min(8, Math.max(1, v.k * factor));
      const f = k / v.k;
      return clampView({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      const target = gesture.current.k * (d / gesture.current.d);
      zoomAt(mid.x, mid.y, target / view.k);
      moved.current += 10;
    } else if (pointers.current.size === 1) {
      const r = svgRef.current!.getBoundingClientRect();
      const dx = ((cur.x - prev.x) / r.width) * W;
      const dy = ((cur.y - prev.y) / r.height) * H;
      moved.current += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      if (moved.current > 6) setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const fillFor = (fips: string): { fill: string; opacity: number } => {
    const i = index.get(fips);
    const row = i != null ? latest?.counties[i] : undefined;
    const c = byFips.get(fips);
    if (!row || !c) return { fill: TIER_FILL[0], opacity: 1 };
    if (layer === "out") {
      const out = row[2];
      if (out >= c.severe_at) return { fill: "var(--tier-3)", opacity: 1 };
      if (out > 0) return { fill: "var(--tier-2)", opacity: 0.35 + 0.6 * Math.min(1, ((out * 2.6) / Math.max(c.pop, 1)) * 8) };
      return { fill: TIER_FILL[0], opacity: 1 };
    }
    if (layer === "nws") {
      const n = latest?.alerts?.by_fips[fips]?.length ?? 0;
      return n ? { fill: "var(--tier-2)", opacity: 0.55 + Math.min(0.4, n * 0.15) } : { fill: TIER_FILL[0], opacity: 1 };
    }
    const p = layer === "p6" ? row[3] : layer === "p12" ? row[4] : row[0];
    let tier = 0;
    if (layer === "p24") tier = row[1];
    else if (tiers) {
      const s = SCALE[layer];
      tier = p >= tiers.act * s ? 3 : p >= tiers.prepare * s ? 2 : p >= tiers.watch * s ? 1 : 0;
    }
    return { fill: TIER_FILL[tier], opacity: 1 };
  };

  const label = (fips: string): string => {
    const i = index.get(fips);
    const row = i != null ? latest?.counties[i] : undefined;
    const c = byFips.get(fips);
    if (!row || !c) return "";
    if (layer === "out") return `${row[2].toLocaleString()} customers out`;
    if (layer === "nws") return (latest?.alerts?.by_fips[fips] ?? ["no active alerts"]).join(", ");
    const p = layer === "p6" ? row[3] : layer === "p12" ? row[4] : row[0];
    return `${pct(p, 1)} chance of a severe outage within ${layer.slice(1)} h`;
  };

  const sevOutline = (fips: string) => {
    const i = index.get(fips);
    const row = i != null ? latest?.counties[i] : undefined;
    const c = byFips.get(fips);
    return !!row && !!c && row[2] >= c.severe_at && layer !== "out";
  };

  const pt = (lon: number, lat: number): [number, number] | null => (project ? project(lon, lat) : null);

  return (
    <div className="relative" style={{ height, touchAction: "none" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full select-none"
        role="img"
        aria-label="Map of Texas counties colored by the selected layer. The county list view has the same data as a table."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {paths.map((p) => {
            const { fill, opacity } = fillFor(p.fips);
            return (
              <path
                key={p.fips}
                d={p.d}
                className="county"
                data-selected={selected === p.fips}
                fill={fill}
                fillOpacity={opacity}
                style={sevOutline(p.fips) ? { stroke: "var(--frost)", strokeWidth: 1.3 } : undefined}
                onClick={() => moved.current < 6 && onSelect(p.fips)}
              >
                <title>{`${p.name} County · ${label(p.fips)}`}</title>
              </path>
            );
          })}

          {/* dispatch lines: solid for units already sent, dashed for the plan */}
          {project &&
            lines.slice(0, 40).map((a) => {
              const d = depots.find((x) => x.name === a.depot);
              const from = d && pt(d.lon, d.lat);
              const to = pt(a.lon, a.lat);
              if (!from || !to) return null;
              return (
                <line
                  key={a.id}
                  x1={from[0]}
                  y1={from[1]}
                  x2={to[0]}
                  y2={to[1]}
                  stroke="var(--lightning)"
                  strokeWidth={1.4 / view.k}
                  strokeOpacity={0.55}
                  strokeDasharray={`${5 / view.k} ${4 / view.k}`}
                />
              );
            })}

          {beacon.map((f) => {
            const c = byFips.get(f);
            const q = c && pt(c.lon, c.lat);
            return q ? <circle key={f} className="beacon" cx={q[0]} cy={q[1]} r={5} /> : null;
          })}

          {depots.map((d) => {
            const q = pt(d.lon, d.lat);
            if (!q) return null;
            const s = 9 / Math.sqrt(view.k);
            return (
              <g key={d.id} transform={`translate(${q[0]} ${q[1]})`} pointerEvents="none">
                <rect x={-s} y={-s} width={s * 2} height={s * 2} fill="var(--night)" stroke="var(--frost)" strokeWidth={2 / view.k} transform="rotate(45)" />
                <text y={-s * 1.9} textAnchor="middle" fontSize={15 / Math.sqrt(view.k)} fontFamily="var(--font-mono)" fill="var(--frost)" fontWeight={500}>
                  {d.name.split(" ")[0].slice(0, 3).toUpperCase()}
                </text>
              </g>
            );
          })}

          {staging.map((s) => {
            const q = pt(s.lon, s.lat);
            if (!q) return null;
            const r = 12 / Math.sqrt(view.k);
            return (
              <g key={s.name} transform={`translate(${q[0]} ${q[1]})`} pointerEvents="none">
                <circle r={r} fill="none" stroke="var(--mint)" strokeWidth={3 / view.k} />
                <circle r={r * 0.35} fill="var(--mint)" />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        <MapButton label="Zoom in" onClick={() => zoomAt(W / 2, H / 2, 1.5)}>
          <Plus />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomAt(W / 2, H / 2, 1 / 1.5)}>
          <Minus />
        </MapButton>
        <MapButton label="Show all of Texas" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          <Maximize2 />
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="grid h-11 w-11 place-items-center rounded-md border border-rule bg-panel/90 text-frost backdrop-blur hover:border-frost [&>svg]:h-5 [&>svg]:w-5"
    >
      {children}
    </button>
  );
}
