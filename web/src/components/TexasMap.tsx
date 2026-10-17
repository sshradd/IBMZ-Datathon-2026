import { useMemo } from "react";
import type { County, HourEvent } from "../api";
import { pct } from "../api";

// Dot map: one dot per county at its centroid. With 254 dots the shape of Texas appears.
const LON0 = -106.7;
const LAT1 = 36.6;
const K = 56;
const COS = Math.cos((31 * Math.PI) / 180);
const W = 13.3 * COS * K;
const H = 10.9 * K;

export const TIER_COLOR = ["var(--t0)", "var(--t1)", "var(--t2)", "var(--t3)"]; // clear, watch, prepare, act

export type MapMode = "p6" | "p12" | "p24" | "actual";

// The alert tiers are set on the 24 h head. For shorter windows the same tier lines are
// scaled down in proportion to the window, so a 6 h view still highlights the counties
// that are most at risk soon.
const SCALE: Record<"p6" | "p12" | "p24", number> = { p6: 0.33, p12: 0.57, p24: 1 };

export default function TexasMap({
  counties,
  latest,
  mode,
  tiers,
  selected,
  onSelect,
}: {
  counties: County[];
  latest: HourEvent | null;
  mode: MapMode;
  tiers: { watch: number; prepare: number; act: number } | null;
  selected: string | null;
  onSelect: (fips: string) => void;
}) {
  const dots = useMemo(
    () =>
      counties.map((c) => ({
        c,
        x: (c.lon - LON0) * COS * K,
        y: (LAT1 - c.lat) * K,
        r: 3.2 + 8 * Math.sqrt(c.pop / 4_900_000),
      })),
    [counties],
  );

  const tierFor = (p: number, scale: number): number => {
    if (!tiers) return 0;
    if (p >= tiers.act * scale) return 3;
    if (p >= tiers.prepare * scale) return 2;
    if (p >= tiers.watch * scale) return 1;
    return 0;
  };

  return (
    <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} className="h-auto w-full" role="img" aria-label="Map of Texas counties colored by outage risk">
      {dots.map(({ c, x, y, r }, i) => {
        const row = latest?.counties[i];
        const out = row ? row[2] : 0;
        const severe = out >= c.severe_at;
        let fill = TIER_COLOR[0];
        let opacity = 0.9;
        let label = "";
        if (mode === "actual") {
          const frac = Math.min(1, (out * 2.6) / Math.max(c.pop, 1));
          if (severe) fill = "var(--t3)";
          else if (out > 0) {
            fill = "var(--t2)";
            opacity = 0.35 + 0.6 * Math.min(1, frac * 8);
          }
          label = `${out.toLocaleString()} customers out`;
        } else if (row) {
          const p = mode === "p6" ? row[3] : mode === "p12" ? row[4] : row[0];
          const tier = mode === "p24" ? row[1] : tierFor(p, SCALE[mode]);
          fill = TIER_COLOR[tier];
          label = `${pct(p, 1)} chance of a severe outage within ${mode.slice(1)} h`;
        }
        return (
          <g key={c.fips} onClick={() => onSelect(c.fips)} className="cursor-pointer">
            <title>{`${c.name} County · ${label}`}</title>
            <circle cx={x} cy={y} r={r} fill={fill} opacity={opacity} />
            {severe && mode !== "actual" && <circle cx={x} cy={y} r={r + 2.2} fill="none" stroke="var(--fg)" strokeWidth={1.6} />}
            {selected === c.fips && (
              <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--signal)" strokeWidth={1.6} strokeDasharray="3 2" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
