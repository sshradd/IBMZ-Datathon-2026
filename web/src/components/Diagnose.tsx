import { useEffect, useState } from "react";
import clsx from "clsx";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartDomain, fmtDay, fmtTime, getJSON, pct, timeAt, type Explain } from "../api";
import type { Ctx } from "../App";
import { DriverBar, Empty, Legend, Lens, Panel, TierChip } from "./ui";

const TIP = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 };

export default function Diagnose({ replay, selected, select }: Ctx) {
  const { latest, history } = replay;
  const [exp, setExp] = useState<Explain | null>(null);
  const wl = latest?.predict.watchlist ?? [];
  const target = selected ?? wl[0]?.fips ?? null;
  const hourKey = latest ? Math.floor(latest.i / 2) : -1;

  useEffect(() => {
    if (!target || hourKey < 0) return;
    getJSON<Explain>(`/api/explain/${target}`)
      .then(setExp)
      .catch(() => {});
  }, [target, hourKey]);

  if (!latest) {
    return (
      <div className="space-y-5">
        <Header />
        <Empty>Start the storm replay to diagnose it live.</Empty>
      </div>
    );
  }

  const d = latest.diagnose;
  const totalCause = Object.values(d.cause_mix).reduce((a, b) => a + b, 0) + d.cause_unwarned;
  const hist = history.map((h) => ({ ...h, demandGW: h.demand / 1000, forecastGW: h.forecast / 1000, genGW: h.gen / 1000 }));
  const shed = d.state.fc_err < -0.12;

  return (
    <div className="space-y-5">
      <Header />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="What is pushing risk up right now" note="counties on alert, by signal family">
          {d.drivers
            .filter((x) => x.group !== "profile")
            .map((x) => (
              <DriverBar key={x.group} label={x.label} share={x.share} push={x.push} />
            ))}
          <p className="mt-3 text-[11.5px] leading-snug text-dim">
            Each bar is the average push, in log-odds, that the signal family adds to the risk of counties currently on alert. These are model
            attributions, not proof of cause.
          </p>
        </Panel>

        <Panel title="One county, opened up" note={exp ? `${exp.county.name} County` : "pick a county"}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {wl.slice(0, 8).map((w) => (
              <button
                key={w.fips}
                onClick={() => select(w.fips)}
                className={clsx("chip", target === w.fips && "chip--out")}
                aria-pressed={target === w.fips}
              >
                {w.name}
              </button>
            ))}
            {wl.length === 0 && <span className="text-[12.5px] text-mut">No county is on alert. Pick one on the Predict map.</span>}
          </div>
          {exp ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <span className="text-[26px] font-semibold tracking-tight tnum">{pct(exp.p24, 1)}</span>
                <span className="text-[12.5px] text-mut">
                  6 h {pct(exp.p6, 1)} · 12 h {pct(exp.p12, 1)} · window {exp.window}
                </span>
                <TierChip tier={exp.tier} />
              </div>
              <div>
                {Object.entries(exp.groups)
                  .filter(([g]) => g !== "profile")
                  .map(([g, v]) => {
                    const mx = Math.max(...Object.values(exp.groups).map((x) => Math.abs(x.push)), 0.5);
                    return <DriverBar key={g} label={v.label} share={Math.abs(v.push) / mx} push={v.push} />;
                  })}
              </div>
              <ul className="space-y-1.5 border-t border-soft pt-3">
                {exp.reasons.length ? (
                  exp.reasons.map((r) => (
                    <li key={r.code} className="flex gap-3 text-[13px]">
                      <span className="mono w-9 shrink-0 text-data">+{r.weight.toFixed(1)}</span>
                      <span>{r.text}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[13px] text-mut">Nothing is pushing this county above a typical county-hour.</li>
                )}
              </ul>
            </div>
          ) : (
            <p className="py-6 text-[13px] text-mut">Select a county to see what drives its forecast.</p>
          )}
        </Panel>
      </div>

      <Panel title="Grid and weather" note="ERCOT demand vs. its own forecast, and statewide temperature">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={hist} margin={{ left: -8, right: 6, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
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
            <YAxis yAxisId="gw" tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${v}`} />
            <YAxis yAxisId="f" orientation="right" tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${v}°`} />
            <Tooltip
              contentStyle={TIP}
              labelFormatter={(i) => fmtTime(timeAt(history, Number(i)))}
              formatter={(v, name) => {
                const label: Record<string, string> = {
                  demandGW: "demand (GW)",
                  forecastGW: "ERCOT forecast (GW)",
                  genGW: "generation (GW)",
                  tempF: "statewide temperature (°F)",
                };
                return [Number(v).toFixed(1), label[String(name)] ?? String(name)];
              }}
            />
            <Line yAxisId="gw" dataKey="forecastGW" stroke="var(--mut)" strokeDasharray="4 3" dot={false} strokeWidth={1.4} isAnimationActive={false} />
            <Line yAxisId="gw" dataKey="demandGW" stroke="var(--signal)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="gw" dataKey="genGW" stroke="var(--gain)" dot={false} strokeWidth={1.4} isAnimationActive={false} />
            <Line yAxisId="f" dataKey="tempF" stroke="var(--data)" dot={false} strokeWidth={1.6} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="mt-2">
          <Legend
            items={[
              { color: "var(--signal)", label: "demand" },
              { color: "var(--mut)", label: "ERCOT's forecast" },
              { color: "var(--gain)", label: "generation" },
              { color: "var(--data)", label: "temperature °F" },
            ]}
          />
        </div>
        <div className={clsx("callout mt-3", shed && "border-loss")}>
          {shed ? (
            <span>
              <b>Load is being shed right now.</b> Demand is {Math.abs(d.state.fc_err * 100).toFixed(0)}% below ERCOT's own forecast, which only happens when
              the operator cuts customers to protect the grid.
            </span>
          ) : (
            <span>
              Demand is {d.state.fc_err >= 0 ? "+" : ""}
              {(d.state.fc_err * 100).toFixed(0)}% against ERCOT's forecast and {d.state.demand_norm >= 0 ? "+" : ""}
              {(d.state.demand_norm * 100).toFixed(0)}% against its two-week norm. A demand line falling far under the forecast means rotating outages.
            </span>
          )}
        </div>
      </Panel>

      <Panel title="What was behind the outages we warned about" note="model attribution at the time the alert started">
        {totalCause === 0 ? (
          <p className="py-6 text-[13px] text-mut">No county has hit the severe line yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-10 gap-y-1 md:grid-cols-2">
            {Object.entries(d.cause_mix).map(([label, v]) => (
              <div key={label} className="grid grid-cols-[132px_1fr_40px] items-center gap-3 py-1.5">
                <span className="text-[12.5px] text-mut">{label}</span>
                <div className="hbar">
                  <i style={{ width: `${(v / totalCause) * 100}%` }} />
                </div>
                <span className="mono text-right text-[11.5px] text-mut">{v}</span>
              </div>
            ))}
            <div className="grid grid-cols-[132px_1fr_40px] items-center gap-3 py-1.5">
              <span className="text-[12.5px] text-mut">No warning first</span>
              <div className="hbar loss">
                <i style={{ width: `${(d.cause_unwarned / totalCause) * 100}%` }} />
              </div>
              <span className="mono text-right text-[11.5px] text-mut">{d.cause_unwarned}</span>
            </div>
          </div>
        )}
        <p className="mt-3 text-[11.5px] leading-snug text-dim">
          For every severe outage we warned about, the largest signal family behind the alert when it first fired. In a statewide event, outages spreading
          from neighboring counties tend to dominate.
        </p>
      </Panel>
    </div>
  );
}

function Header() {
  return (
    <div>
      <Lens n="04" name="Diagnose" question="why is it happening?" />
      <h2 className="mt-2 text-[26px]">What is driving the risk</h2>
      <p className="mt-2 max-w-3xl text-[14px] text-mut">
        Every forecast comes with its reasons. Open any county to see which signals push it up: outages already spreading, local weather, stress on the
        ERCOT grid, or how far the storm has already reached across Texas.
      </p>
    </div>
  );
}
