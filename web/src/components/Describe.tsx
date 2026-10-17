import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartDomain, compact, fmtDay, fmtTime, n0, timeAt } from "../api";
import type { Ctx } from "../App";
import TexasMap from "./TexasMap";
import { Empty, Kpi, Legend, Lens, Panel } from "./ui";

const TIP = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 };

export default function Describe({ replay, tiers, selected, select }: Ctx) {
  const { latest, history, counties } = replay;

  return (
    <div className="space-y-5">
      <div>
        <Lens n="05" name="Describe" question="what has happened?" />
        <h2 className="mt-2 text-[26px]">The storm so far</h2>
        <p className="mt-2 max-w-3xl text-[14px] text-mut">
          Facts from utility outage reports, hour by hour. No model involved here: this is the ground truth the forecasts are checked against.
        </p>
      </div>

      {!latest ? (
        <Empty>Start the storm replay to watch it unfold.</Empty>
      ) : latest.live ? (
        <Panel title="No ground truth in live mode">
          <p className="max-w-2xl text-[13.5px] text-mut">
            This page reports what utilities actually measured. No free live feed carries county outage counts, so live mode shows forecasts only. Run a storm
            replay to see the ground truth the forecasts are checked against, or plug a county outage feed in and Describe lights up.
          </p>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Kpi label="Customers without power" value={compact(latest.out_total)} sub="reported right now" tone="loss" />
            <Kpi label="Counties in severe outage" value={String(latest.describe.severe_now)} sub={`${latest.describe.ever_severe} so far in this storm`} />
            <Kpi
              label="Peak outage"
              value={compact(latest.describe.peak.out)}
              sub={latest.describe.peak.t ? fmtTime(latest.describe.peak.t) : undefined}
            />
            <Kpi label="Customer-hours lost" value={compact(latest.describe.customer_hours)} sub="customers out, summed over hours" />
            <Kpi
              label="Seniors without power"
              value={compact(latest.describe.seniors_out)}
              sub="estimate from county age counts"
              tone="signal"
            />
          </div>

          <Panel title="Outages over time" note="customers out (area) · counties in severe outage (line)">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={history} margin={{ left: -6, right: 6, top: 6, bottom: 0 }}>
                <XAxis
                  dataKey="i"
                  type="number"
                  domain={chartDomain(replay.state?.n)}
                  tickFormatter={(i: number) => fmtDay(timeAt(history, i))}
                  tick={{ fill: "var(--mut)", fontSize: 10 }}
                  tickCount={8}
                  axisLine={{ stroke: "var(--line)" }}
                  tickLine={false}
                />
                <YAxis yAxisId="out" tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v: number) => compact(v)} />
                <YAxis yAxisId="c" orientation="right" domain={[0, 254]} hide />
                <Tooltip
                  contentStyle={TIP}
                  labelFormatter={(i) => fmtTime(timeAt(history, Number(i)))}
                  formatter={(v, name) => [n0(Number(v)), name === "out" ? "customers out" : "counties in severe outage"]}
                />
                <Area yAxisId="out" dataKey="out" stroke="var(--t3)" fill="var(--t3)" fillOpacity={0.18} strokeWidth={1.6} isAnimationActive={false} />
                <Line yAxisId="c" dataKey="severe" stroke="var(--signal)" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-2">
              <Legend
                items={[
                  { color: "var(--t3)", label: "customers out" },
                  { color: "var(--signal)", label: "counties in severe outage" },
                ]}
              />
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel title="Where the power is out" note="actual">
              <TexasMap counties={counties} latest={latest} mode="actual" tiers={tiers} selected={selected} onSelect={select} />
              <div className="mt-3">
                <Legend
                  items={[
                    { color: "var(--t3)", label: "severe outage" },
                    { color: "var(--t2)", label: "some customers out" },
                    { color: "var(--t0)", label: "power on" },
                  ]}
                />
              </div>
            </Panel>

            <Panel title="Hardest hit so far" note="customer-hours without power">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>County</th>
                    <th className="num">Out now</th>
                    <th className="num">Customer-hours</th>
                    <th className="num">Population</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.describe.league.map((c) => (
                    <tr key={c.fips} data-row aria-selected={selected === c.fips} onClick={() => select(c.fips)}>
                      <td>{c.name}</td>
                      <td className="num text-fg">{compact(c.out)}</td>
                      <td className="num">{compact(c.customer_hours)}</td>
                      <td className="num">{compact(c.pop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="callout mt-4">
                <span>
                  <b>Did we warn them?</b> {latest.describe.scorecard.onsets} counties hit the severe line;{" "}
                  <b>{latest.describe.scorecard.warned}</b> had an alert first
                  {latest.describe.scorecard.median_lead_h != null && <> with a median lead of <b>{latest.describe.scorecard.median_lead_h} h</b></>}.{" "}
                  {latest.describe.scorecard.false_alerts} alert episodes ended with no severe outage.
                </span>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
