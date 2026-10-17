import { compact, pct, TIER_NAMES } from "../lib/format.js";

/** The map's accessible twin: every county as a table, sorted by 24 h risk. */
export default function CountyList({ counties, latest, selected, onSelect }) {
  const rows = counties
    .map((c, i) => ({ c, r: latest.counties[i] }))
    .sort((a, b) => b.r[0] - a.r[0])
    .slice(0, 80);
  return (
    <div className="county-list">
      <table>
        <thead>
          <tr><th>County</th><th>Status</th><th className="r">24 h</th><th className="r">{latest.live ? "65+" : "Out"}</th></tr>
        </thead>
        <tbody>
          {rows.map(({ c, r }) => (
            <tr key={c.fips} tabIndex={0} className={selected === c.fips ? "sel" : ""} aria-selected={selected === c.fips}
              onClick={() => onSelect(c.fips)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(c.fips); } }}>
              <td><b>{c.name}</b></td>
              <td>{r[2] >= c.severe_at ? <span className="chip chip-red">out</span> : <span className="chip">{TIER_NAMES[r[1]]}</span>}</td>
              <td className="r mono">{pct(r[0], 1)}</td>
              <td className="r mono">{compact(latest.live ? c.pop65 : r[2])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
