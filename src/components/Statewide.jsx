import { compact, pct } from "../lib/format.js";

/** Statewide picture in three glances: how many are out, which way it is heading, and where it is worst. */
export default function Statewide({ latest, counties, series, onSelect, selected }) {
  const live = !!latest.live;
  const pts = series.slice(-96);
  const max = Math.max(1, ...pts.map(p => p.out));
  const w = 100;
  const h = 40;
  const xy = pts.map((p, k) => [pts.length > 1 ? (k / (pts.length - 1)) * w : w, h - 3 - (p.out / max) * (h - 8)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = pts[0]?.out ?? 0;
  const now = pts[pts.length - 1]?.out ?? 0;
  const prev = pts[Math.max(0, pts.length - 7)]?.out ?? 0; // about six hours back
  const delta = now - prev;
  const trend = delta === 0 ? "steady" : delta > 0 ? `up ${compact(delta)} in 6 h` : `down ${compact(-delta)} in 6 h`;

  // the worst-hit counties: by customers out, or by risk when there is no outage feed
  const rows = counties
    .map((c, i) => ({ c, r: latest.counties[i] }))
    .map(({ c, r }) => ({ c, v: live ? r[0] : r[2] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  const top = Math.max(1, ...rows.map(r => r.v));

  return (
    <section aria-label="Statewide" className="blk">
      {!live && pts.length > 1 && (
        <div>
          <div className="blk-h"><h3 className="eyebrow">Customers out, statewide</h3><span className="mono faint">{trend}</span></div>
          <p className="big-n">{compact(latest.out_total)}</p>
          <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" role="img" aria-label={`Customers out over time, from ${compact(first)} to ${compact(now)}, peak ${compact(max)}`}>
            <polygon points={`0,${h} ${line} ${w},${h}`} fill="var(--red)" fillOpacity="0.12" />
            <polyline points={line} fill="none" stroke="var(--red)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          <p className="mono spark-l"><span>earlier</span><span>peak {compact(max)}</span><span>now</span></p>
        </div>
      )}
      <div className={live || pts.length <= 1 ? "" : "gap-t"}>
        <h3 className="eyebrow">{live ? "Highest risk, next 24 h" : "Hardest hit"}</h3>
        <ul className="hit-list">
          {rows.map(({ c, v }) => (
            <li key={c.fips}>
              <button className={selected === c.fips ? "on" : ""} onClick={() => onSelect(c.fips)}>
                <span className="hit-name">{c.name}</span>
                <span className="hit-bar"><span style={{ width: `${Math.max(3, (v / top) * 100)}%` }} /></span>
                <span className="hit-v">{live ? pct(v, 0) : compact(v)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
