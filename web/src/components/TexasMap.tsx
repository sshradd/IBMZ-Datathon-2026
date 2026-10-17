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

export default function TexasMap({
  counties,
  latest,
  selected,
  onSelect,
}: {
  counties: County[];
  latest: HourEvent | null;
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

  return (
    <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} className="h-auto w-full" role="img" aria-label="Map of Texas counties colored by outage risk">
      {dots.map(({ c, x, y, r }, i) => {
        const row = latest?.counties[i];
        const tier = row ? row[1] : 0;
        const risk = row ? row[0] : 0;
        const out = row ? row[2] : 0;
        const severe = out >= c.severe_at;
        return (
          <g key={c.fips} onClick={() => onSelect(c.fips)} className="cursor-pointer">
            <title>
              {`${c.name} County · risk ${pct(risk, 1)} · ${out.toLocaleString()} customers out`}
            </title>
            <circle
              cx={x}
              cy={y}
              r={r}
              fill={TIER_COLOR[tier]}
              opacity={tier ? 0.95 : 0.8}
              style={tier >= 2 ? { filter: `drop-shadow(var(--glow) ${TIER_COLOR[tier]})` } : undefined}
            />
            {severe && <circle cx={x} cy={y} r={r + 2.4} fill="none" stroke="var(--fg)" strokeWidth={1.8} />}
            {selected === c.fips && (
              <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--info)" strokeWidth={1.5} strokeDasharray="3 2" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
