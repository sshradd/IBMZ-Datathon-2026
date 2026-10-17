import { CloudSnow } from "lucide-react";

/** Weather and grid, in the two sentences a responder needs. Amber is for these alerts only. */
export default function Weather({ latest }) {
  const st = latest.diagnose.state;
  const shed = st.fc_err < -0.12;
  const alerts = (latest.alerts?.events ?? []).filter(e => e.relevant).slice(0, 4);
  const next = (latest.outlook?.temp_f_mean_next_24h ?? []).filter(v => v != null);
  const lo = next.length ? Math.min(...next) : 0;
  const hi = next.length ? Math.max(...next) : 1;
  const pts = next.map((v, i) => `${(i / Math.max(next.length - 1, 1)) * 100},${34 - ((v - lo) / Math.max(hi - lo, 1)) * 30}`).join(" ");
  return (
    <section aria-label="Weather and grid" className="blk">
      <div className="blk-h"><h3 className="eyebrow">Weather and grid</h3><span className="big-n sm">{st.temp_f_mean.toFixed(0)}°F</span></div>
      {shed ? (
        <p className="mt-s"><b>Load is being shed.</b> <span className="muted">ERCOT demand is {Math.abs(st.fc_err * 100).toFixed(0)}% under its own forecast.</span></p>
      ) : (
        <p className="mt-s muted">Grid demand is {st.demand_norm >= 0 ? "+" : ""}{(st.demand_norm * 100).toFixed(0)}% against its two-week norm.</p>
      )}
      {next.length > 0 && (
        <div className="mt-s">
          <p className="eyebrow">Next 24 h, statewide</p>
          <svg viewBox="0 0 100 38" className="spark short" preserveAspectRatio="none" aria-label={`Temperature outlook from ${lo.toFixed(0)} to ${hi.toFixed(0)} degrees`}>
            <polyline points={pts} fill="none" stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <p className="mono faint sm">{lo.toFixed(0)}° to {hi.toFixed(0)}°F</p>
        </div>
      )}
      {alerts.length > 0 ? (
        <ul className="rows mt-s">
          {alerts.map(a => (
            <li key={a.event} className="alert-row">
              <CloudSnow size={16} className="amber" aria-hidden />
              <span>{a.event}</span>
              <span className="mono faint sm">{a.counties} counties</span>
            </li>
          ))}
        </ul>
      ) : latest.live ? (
        <p className="mt-s muted">No grid-relevant National Weather Service alerts.</p>
      ) : null}
    </section>
  );
}
