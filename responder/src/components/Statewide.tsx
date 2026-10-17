"use client";

import { compact, pct } from "@/lib/format";
import type { County, HourEvent } from "@/lib/types";

interface Point {
  i: number;
  out: number;
  flagged: number;
}

/** Statewide picture in three glances: how many are out, which way it is heading, and where it is worst. */
export default function Statewide({
  latest,
  counties,
  series,
  onSelect,
  selected,
}: {
  latest: HourEvent;
  counties: County[];
  series: Point[];
  onSelect: (fips: string) => void;
  selected: string | null;
}) {
  const live = !!latest.live;
  const pts = series.slice(-96);
  const max = Math.max(1, ...pts.map((p) => p.out));
  const w = 100;
  const h = 40;
  const xy = pts.map((p, k) => [pts.length > 1 ? (k / (pts.length - 1)) * w : w, h - 3 - (p.out / max) * (h - 8)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = pts[0]?.out ?? 0;
  const now = pts[pts.length - 1]?.out ?? 0;
  const prev = pts[Math.max(0, pts.length - 7)]?.out ?? 0; // about six hours back
  const delta = now - prev;
  const trend = delta === 0 ? "steady" : delta > 0 ? `up ${compact(delta)} in 6 h` : `down ${compact(-delta)} in 6 h`;

  // the worst-hit counties: by customers out, or by risk when there is no outage feed
  const rows = counties
    .map((c, i) => ({ c, r: latest.counties[i] }))
    .map(({ c, r }) => ({ c, v: live ? r[0] : r[2], share: live ? r[0] : r[2] / Math.max(c.pop * 0.4, 1) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  const top = Math.max(1, ...rows.map((r) => r.v));

  const sc = latest.describe.scorecard;
  return (
    <section aria-label="Statewide">
      {!live && sc.onsets > 0 && sc.warned_pct != null && (
        <div className="mb-5">
          <h3 className="eyebrow">Warned before the outage</h3>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="num text-[34px]">{Math.round(sc.warned_pct)}%</span>
            <span className="text-[15px] muted">
              of {sc.onsets} county outages{sc.median_lead_h != null ? `, median ${sc.median_lead_h} h ahead` : ""}
            </span>
          </p>
        </div>
      )}
      {!live && pts.length > 1 && (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="eyebrow">Customers out, statewide</h3>
            <span className="mono text-[12px] text-ink3">{trend}</span>
          </div>
          <p className="num mt-1 text-[34px]">{compact(latest.out_total)}</p>
          <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-14 w-full" preserveAspectRatio="none" role="img" aria-label={`Customers out over time, from ${compact(first)} to ${compact(now)}, peak ${compact(max)}`}>
            <polygon points={`0,${h} ${line} ${w},${h}`} fill="var(--red)" fillOpacity="0.12" />
            <polyline points={line} fill="none" stroke="var(--red)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          <p className="mono flex justify-between text-[11px] text-ink3">
            <span>earlier</span>
            <span>peak {compact(max)}</span>
            <span>now</span>
          </p>
        </div>
      )}

      <div className={live || pts.length <= 1 ? "" : "mt-5"}>
        <h3 className="eyebrow">{live ? "Highest risk, next 24 h" : "Hardest hit"}</h3>
        <ul className="mt-1">
          {rows.map(({ c, v }) => (
            <li key={c.fips}>
              <button className={`flex w-full items-center gap-3 py-2 text-left ${selected === c.fips ? "font-semibold" : ""}`} onClick={() => onSelect(c.fips)}>
                <span className="w-24 flex-none truncate text-[15px]">{c.name}</span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-red" style={{ width: `${Math.max(3, (v / top) * 100)}%` }} />
                </span>
                <span className="num w-14 flex-none text-right text-[17px]">{live ? pct(v, 0) : compact(v)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
