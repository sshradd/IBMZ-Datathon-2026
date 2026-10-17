import { useState } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import { compact, fmtDay, fmtTime, n0, pct, timeAt } from "../api";
import type { Ctx } from "../App";
import TexasMap, { TIER_COLOR, type MapMode } from "./TexasMap";
import { Empty, Kpi, Legend, Lens, MiniBars, Panel, TierChip } from "./ui";

const TIP = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 };

export default function Predict({ replay, tiers, models, selected, select }: Ctx) {
  const { latest, history, counties } = replay;
  const [mode, setMode] = useState<MapMode>("p24");
  const honest = models?.honest;

  return (
    <div className="space-y-5">
      <div>
        <Lens n="02" name="Predict" question="what happens next?" />
        <h2 className="mt-2 text-[26px]">Forecast for the next 6, 12 and 24 hours</h2>
        <p className="mt-2 max-w-3xl text-[14px] text-mut">
          Every county gets three probabilities: a severe outage (at least 10% of customers and at least 2,500 customers) starting within
          6, 12 or 24 hours. The model only sees what was known at that hour, never the outage it is forecasting.
        </p>
      </div>

      {!latest ? (
        <Empty>Start the storm replay to see live forecasts.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Expected onsets · 6 h" value={latest.predict.expected_onsets[0].toFixed(1)} sub="counties" />
            <Kpi label="Expected onsets · 12 h" value={latest.predict.expected_onsets[1].toFixed(1)} sub="counties" />
            <Kpi label="Expected onsets · 24 h" value={latest.predict.expected_onsets[2].toFixed(1)} sub="counties" tone="signal" />
            <Kpi
              label="Most likely window"
              value={latest.predict.peak_window}
              sub="where the forecast onsets cluster"
              tone="data"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Panel
              title="Predicted risk by county"
              action={
                <div className="seg" role="group" aria-label="Forecast window">
                  {(["p6", "p12", "p24"] as const).map((m) => (
                    <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                      {m.slice(1)} h
                    </button>
                  ))}
                </div>
              }
            >
              <TexasMap counties={counties} latest={latest} mode={mode} tiers={tiers} selected={selected} onSelect={select} />
              <div className="mt-3">
                <Legend
                  items={[
                    { color: TIER_COLOR[1], label: "watch" },
                    { color: TIER_COLOR[2], label: "prepare" },
                    { color: TIER_COLOR[3], label: "act" },
                    { color: "var(--fg)", label: "already out", ring: true },
                  ]}
                />
              </div>
              <p className="mt-3 text-[11.5px] leading-snug text-dim">
                Tiers are alert budgets from training data: watch is the top 3% of county-hours by 24 h risk, prepare 1%, act 0.3%. The 6 h and
                12 h views scale those lines to the shorter window.
              </p>
            </Panel>

            <Panel title="Watchlist: counties most likely to be hit next" note="not yet out">
              {latest.predict.watchlist.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-mut">No county is on alert.</p>
              ) : (
                <div className="overflow-x-auto scroll-thin">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>County</th>
                        <th>6 / 12 / 24 h</th>
                        <th className="num">24 h</th>
                        <th>Window</th>
                        <th className="num">Trend</th>
                        <th className="num">Seniors</th>
                        <th>Tier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.predict.watchlist.map((w) => (
                        <tr key={w.fips} data-row aria-selected={selected === w.fips} onClick={() => select(w.fips)}>
                          <td>{w.name}</td>
                          <td>
                            <MiniBars p6={w.p6} p12={w.p12} p24={w.p24} max={Math.max(0.12, w.p24)} />
                          </td>
                          <td className="num text-fg">{pct(w.p24, 1)}</td>
                          <td className="mono text-[11.5px]">{w.window}</td>
                          <td className="num">
                            {Math.abs(w.trend) < 0.002 ? (
                              <span className="text-dim">flat</span>
                            ) : w.trend > 0 ? (
                              <span className="inline-flex items-center text-loss">
                                <ArrowUp className="h-3 w-3" />
                                {(w.trend * 100).toFixed(1)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-gain">
                                <ArrowDown className="h-3 w-3" />
                                {Math.abs(w.trend * 100).toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td className="num">{compact(w.seniors_exposed)}</td>
                          <td>
                            <TierChip tier={w.tier} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Forecast scoreboard" note="issued 24 h ago vs. what happened">
              <p className="mb-3 text-[13px] text-mut">
                Each hour we compare the number of counties the model expected to cross the severe line, as forecast 24 hours earlier, with how many
                actually did in the 24 hours since.
                {latest.predict.scoreboard.issued_24h_ago != null && latest.predict.scoreboard.actual_24h != null && (
                  <>
                    {" "}
                    Right now: forecast <b className="text-fg">{latest.predict.scoreboard.issued_24h_ago.toFixed(1)}</b>, actual{" "}
                    <b className="text-fg">{latest.predict.scoreboard.actual_24h}</b>.
                  </>
                )}
              </p>
              <ResponsiveContainer width="100%" height={210}>
                <ComposedChart data={history} margin={{ left: -18, right: 6, top: 6, bottom: 0 }}>
                  <XAxis
                    dataKey="i"
                    type="number"
                    domain={[0, Math.max(replay.state?.n ?? 1, 2) - 1]}
                    tickFormatter={(i: number) => fmtDay(timeAt(history, i))}
                    tick={{ fill: "var(--mut)", fontSize: 10 }}
                    tickCount={7}
                    axisLine={{ stroke: "var(--line)" }}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    contentStyle={TIP}
                    labelFormatter={(i) => fmtTime(timeAt(history, Number(i)))}
                    formatter={(v, name) => [Number(v).toFixed(1), name === "issued" ? "forecast issued 24 h earlier" : "actual severe onsets since"]}
                  />
                  <Area dataKey="actual" stroke="var(--t3)" fill="var(--t3)" fillOpacity={0.18} strokeWidth={1.6} isAnimationActive={false} connectNulls />
                  <Line dataKey="issued" stroke="var(--signal)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
              <Legend
                items={[
                  { color: "var(--signal)", label: "forecast issued 24 h earlier" },
                  { color: "var(--t3)", label: "actual onsets in the 24 h since" },
                ]}
              />
              <p className="mt-2 text-[11.5px] leading-snug text-dim">
                Honest read: the model usually under-forecasts the size of a statewide event like Uri, because nothing like it was in its training data.
                It ranks which counties go first better than it sizes the total.
              </p>
            </Panel>

            <Panel title="Seniors exposed over time" note="vulnerable people at risk">
              <ResponsiveContainer width="100%" height={210}>
                <ComposedChart data={history} margin={{ left: -6, right: 6, top: 6, bottom: 0 }}>
                  <XAxis
                    dataKey="i"
                    type="number"
                    domain={[0, Math.max(replay.state?.n ?? 1, 2) - 1]}
                    tickFormatter={(i: number) => fmtDay(timeAt(history, i))}
                    tick={{ fill: "var(--mut)", fontSize: 10 }}
                    tickCount={7}
                    axisLine={{ stroke: "var(--line)" }}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v: number) => compact(v)} />
                  <Tooltip contentStyle={TIP} labelFormatter={(i) => fmtTime(timeAt(history, Number(i)))} formatter={(v) => [n0(Number(v)), "seniors exposed"]} />
                  <Area dataKey="seniorsExposed" stroke="var(--data)" fill="var(--data)" fillOpacity={0.2} strokeWidth={1.8} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {honest?.metrics.horizon_auc && (
            <Panel title="How good is each forecast window?" note="out-of-sample ROC AUC">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Storm (never trained on)</th>
                    <th className="num">6 h</th>
                    <th className="num">12 h</th>
                    <th className="num">24 h</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(honest.metrics.horizon_auc).map(([k, v]) => (
                    <tr key={k}>
                      <td>{STORM[k] ?? k}</td>
                      <td className="num">{v["6"]?.toFixed(2) ?? "–"}</td>
                      <td className="num">{v["12"]?.toFixed(2) ?? "–"}</td>
                      <td className="num">{v["24"]?.toFixed(2) ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11.5px] leading-snug text-dim">
                Shorter windows are easier to call. 0.5 is a coin flip and 1.0 is perfect. The heat dome is the weak case.
              </p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

export const STORM: Record<string, string> = {
  uri: "Winter Storm Uri (Feb 2021)",
  elliott: "Winter Storm Elliott (Dec 2022)",
  ice2023: "Feb 2023 ice storm",
  heat2023: "Aug 2023 heat dome",
};
