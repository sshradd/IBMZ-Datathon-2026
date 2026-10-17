"use client";

import { CloudSnow } from "lucide-react";
import type { HourEvent } from "@/lib/types";

/** Weather and grid, in the two sentences a responder needs. */
export default function Weather({ latest }: { latest: HourEvent }) {
  const st = latest.diagnose.state;
  const shed = st.fc_err < -0.12;
  const alerts = (latest.alerts?.events ?? []).filter((e) => e.relevant).slice(0, 4);
  const next = (latest.outlook?.temp_f_mean_next_24h ?? []).filter((v): v is number => v != null);
  const lo = next.length ? Math.min(...next) : 0;
  const hi = next.length ? Math.max(...next) : 1;
  const pts = next.map((v, i) => `${(i / Math.max(next.length - 1, 1)) * 100},${34 - ((v - lo) / Math.max(hi - lo, 1)) * 30}`).join(" ");

  return (
    <section aria-label="Weather and grid">
      <div className="flex items-baseline justify-between">
        <h3 className="eyebrow">Weather and grid</h3>
        <span className="num text-[28px]">{st.temp_f_mean.toFixed(0)}°F</span>
      </div>
      {shed ? (
        <p className="mt-2 text-[15px]">
          <b>Load is being shed.</b> <span className="muted">ERCOT demand is {Math.abs(st.fc_err * 100).toFixed(0)}% under its own forecast.</span>
        </p>
      ) : (
        <p className="mt-2 text-[15px] muted">
          Grid demand is {st.demand_norm >= 0 ? "+" : ""}
          {(st.demand_norm * 100).toFixed(0)}% against its two-week norm.
        </p>
      )}
      {next.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow">Next 24 h, statewide</p>
          <svg viewBox="0 0 100 38" className="mt-1 h-12 w-full" preserveAspectRatio="none" aria-label={`Temperature outlook from ${lo.toFixed(0)} to ${hi.toFixed(0)} degrees`}>
            <polyline points={pts} fill="none" stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <p className="mono text-[12px] text-ink3">
            {lo.toFixed(0)}° to {hi.toFixed(0)}°F
          </p>
        </div>
      )}
      {alerts.length > 0 ? (
        <ul className="rows mt-3">
          {alerts.map((a) => (
            <li key={a.event} className="flex items-center gap-2 py-2 text-[15px]">
              <CloudSnow className="h-4 w-4 flex-none text-amber" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.event}</span>
              <span className="mono text-[12px] text-ink3">{a.counties} counties</span>
            </li>
          ))}
        </ul>
      ) : latest.live ? (
        <p className="mt-3 text-[14px] muted">No grid-relevant National Weather Service alerts.</p>
      ) : null}
    </section>
  );
}
