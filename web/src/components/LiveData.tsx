import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { Play } from "lucide-react";
import { compact, fmtClock, n0 } from "../api";
import type { Ctx } from "../App";
import { Kpi, Lens, Panel } from "./ui";

const TIP = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 };

const ENDPOINTS: { method: string; path: string; what: string }[] = [
  { method: "GET", path: "/api/live/forecast?min_tier=watch", what: "Every county's chance of a severe outage within 6, 12 and 24 hours, with reasons and active NWS alerts" },
  { method: "GET", path: "/api/live/grid", what: "Current ERCOT demand, generation and demand forecast, plus feed health" },
  { method: "GET", path: "/api/live/alerts", what: "Active National Weather Service warnings for Texas, grouped by event and county" },
  { method: "GET", path: "/api/live/plan?crews=40&centers=15&callers=25", what: "Recommended deployment and ranked moves for the current forecast" },
  { method: "GET", path: "/api/live/status", what: "Whether live mode is running and how each upstream feed is doing" },
  { method: "GET", path: "/api/events", what: "Server-Sent Events: one message per poll with the full predict, prescribe and diagnose blocks" },
];

export default function LiveData({ replay, scenario, model }: Ctx) {
  const { latest, state } = replay;
  const live = !!latest?.live;
  const running = state?.scenario === "live";
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-5">
      <div>
        <Lens n="08" name="Live data" question="what is the grid doing right now?" />
        <h2 className="mt-2 text-[26px]">Real-time feeds and the API behind them</h2>
        <p className="mt-2 max-w-3xl text-[14px] text-mut">
          Live mode polls three public APIs with no login: ERCOT's dashboard feed for demand, forecast and generation, the National Weather Service for storm
          alerts, and Open-Meteo for hourly weather. It rebuilds the same features the model was trained on and scores all 254 counties every minute.
        </p>
      </div>

      {!live ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-4">
            <button className="btn btn--primary" onClick={() => replay.start("live", model === "honest" || model === "final" ? null : model || null, 12)}>
              <Play /> {running ? "Waiting for the first poll…" : "Start live mode"}
            </button>
            <p className="max-w-xl text-[13px] text-mut">
              Live mode uses the model trained on signals that exist in real time. Scenario selected in the sidebar: <b className="text-fg">{scenario}</b>.
            </p>
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi
              label="ERCOT demand now"
              value={`${(latest.grid.demand / 1000).toFixed(1)} GW`}
              sub={`${(latest.grid.gen / 1000).toFixed(1)} GW generation · wind ${(((latest.grid_detail?.wind_share ?? 0)) * 100).toFixed(0)}%`}
              tone="signal"
            />
            <Kpi
              label="Statewide temperature"
              value={`${latest.diagnose.state.temp_f_mean.toFixed(0)}°F`}
              sub={(() => {
                const next = (latest.outlook?.temp_f_mean_next_24h ?? []).filter((v): v is number => v != null);
                return next.length ? `next 24 h: ${Math.min(...next).toFixed(0)}° to ${Math.max(...next).toFixed(0)}°` : "";
              })()}
              tone="data"
            />
            <Kpi
              label="Counties on alert"
              value={String(latest.tier_counts[1] + latest.tier_counts[2] + latest.tier_counts[3])}
              sub={`${compact(latest.predict.seniors_exposed)} seniors exposed`}
              tone={latest.tier_counts[1] + latest.tier_counts[2] + latest.tier_counts[3] > 0 ? "loss" : "gain"}
            />
            <Kpi label="NWS alerts" value={String(latest.alerts?.count ?? 0)} sub={`${latest.alerts?.events.filter((e) => e.relevant).length ?? 0} types that matter for the grid`} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Feed health" note={`polled ${latest.as_of ? fmtClock(latest.as_of) : ""}`}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th className="num">Age</th>
                    <th className="num">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {(latest.sources ?? []).map((s) => (
                    <tr key={s.name}>
                      <td>{LABEL[s.name] ?? s.name}</td>
                      <td>
                        <span className={clsx("chip", s.ok ? "chip--gain" : s.stale ? "chip--prepare" : "chip--act")}>
                          {s.ok ? "live" : s.stale ? "stale" : "down"}
                        </span>
                        {s.error && <span className="ml-2 text-[11.5px] text-dim">{s.error}</span>}
                      </td>
                      <td className="num">{s.age_s != null ? `${s.age_s}s` : "–"}</td>
                      <td className="num">{s.ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="callout mt-4">
                <span>
                  <b>What live mode cannot see.</b> No free live feed carries county outage counts, so the live model forecasts from weather, grid telemetry and
                  county profile only, and the Describe page has no ground truth to show.{" "}
                  {latest.grid_detail && !latest.grid_detail.has_forecast_for_now && (
                    <>
                      ERCOT only publishes forecasts for future hours, so the demand-versus-forecast signal stays neutral until the service has been running a while
                      ({latest.grid_detail.history_hours} hours of history so far).
                    </>
                  )}
                </span>
              </div>
            </Panel>

            <Panel title="Next 24 hours" note="statewide mean temperature, °F">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={(latest.outlook?.temp_f_mean_next_24h ?? []).map((v, i) => ({ h: `+${i + 1}h`, temp: v }))}
                  margin={{ left: -14, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                  <XAxis dataKey="h" tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} interval={3} />
                  <YAxis tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={["dataMin - 3", "dataMax + 3"]} />
                  <Tooltip contentStyle={TIP} formatter={(v) => [`${Number(v).toFixed(0)}°F`, "forecast"]} />
                  <Line dataKey="temp" stroke="var(--data)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[11.5px] leading-snug text-dim">
                Open-Meteo forecast. The live model scores what is happening now, not this forecast, so a cold front shows up in the risk as it arrives.
              </p>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="ERCOT's demand forecast" note="MW, next hours">
              {(latest.grid_detail?.upcoming_forecast ?? []).length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={(latest.grid_detail?.upcoming_forecast ?? []).map((r) => ({ h: r.hour.slice(11, 13) + "Z", mw: r.mw }))}
                    margin={{ left: -4, right: 8, top: 8, bottom: 0 }}
                  >
                    <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                    <XAxis dataKey="h" tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} interval={3} />
                    <YAxis tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v: number) => compact(v)} domain={["dataMin - 2000", "dataMax + 2000"]} />
                    <Tooltip contentStyle={TIP} formatter={(v) => [`${n0(Number(v))} MW`, "forecast demand"]} />
                    <Line dataKey="mw" stroke="var(--signal)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-[13px] text-mut">No forecast published yet.</p>
              )}
            </Panel>

            <Panel title="Active NWS alerts" note="Texas">
              {(latest.alerts?.events ?? []).length ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Severity</th>
                      <th className="num">Counties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.alerts!.events.slice(0, 8).map((e) => (
                      <tr key={e.event}>
                        <td>
                          {e.event} {e.relevant && <span className="chip chip--watch ml-1">grid-relevant</span>}
                        </td>
                        <td>{e.severity ?? "–"}</td>
                        <td className="num">{e.counties}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-8 text-center text-[13px] text-mut">No active alerts.</p>
              )}
            </Panel>
          </div>
        </>
      )}

      <Panel title="The API" note="same data, no dashboard needed">
        <p className="mb-3 text-[13px] text-mut">
          Everything above is served as plain JSON. Start live mode from here, or run the server with <code className="mono rounded-[3px] border border-line px-1.5 text-[12px] text-fg">URIWATCH_LIVE=1</code> to
          start polling at boot.
        </p>
        <div className="overflow-x-auto scroll-thin">
          <table className="tbl">
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>What it returns</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className="mono text-[11.5px]">{e.method}</td>
                  <td>
                    <a className="mono text-[12px] text-data underline decoration-dotted" href={`${origin}${e.path}`} target="_blank" rel="noreferrer">
                      {e.path}
                    </a>
                  </td>
                  <td>{e.what}</td>
                </tr>
              ))}
              <tr>
                <td className="mono text-[11.5px]">POST</td>
                <td className="mono text-[12px] text-fg">/api/replay/start {`{"scenario": "live"}`}</td>
                <td>Start live mode</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

const LABEL: Record<string, string> = {
  weather: "Open-Meteo weather (12 stations)",
  ercot: "ERCOT demand, forecast, generation",
  alerts: "National Weather Service alerts",
};
