import { useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import { compact, fmtClock, fmtTime, n0, pct } from "../api";
import type { Ctx } from "../App";
import TexasMap, { TIER_COLOR, type MapMode } from "./TexasMap";
import { DriverBar, Empty, Kpi, Legend, MoveCard, Panel } from "./ui";

export default function Brief({ replay, tiers, decisions, decide, selected, select, go, scenario, model }: Ctx) {
  const { latest, state, counties, scenarios } = replay;
  const [mode, setMode] = useState<MapMode>("p24");

  if (!latest) {
    const sc = scenarios.find((s) => s.key === scenario);
    return (
      <div className="space-y-5">
        <section className="brief">
          <p className="eyebrow dash">Situation brief</p>
          <h1 className="mt-4">
            Which Texas counties lose power <em>next</em>, and who needs help <em>first</em>?
          </h1>
          <p className="sub">
            Replay a real storm hour by hour. The model has <b>never seen it in training</b>. It scores all 254 counties every hour,
            forecasts the next 6, 12 and 24 hours, and recommends where crews, warming centers and outreach calls should go.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className="btn btn--primary" onClick={() => replay.start(scenario, model || null, 12)}>
              <Play /> Replay {sc?.title ?? "Winter Storm Uri (Feb 2021)"}
            </button>
            <button className="btn btn--ghost" onClick={() => go("evidence")}>
              See the out-of-sample evidence <ArrowRight />
            </button>
          </div>
        </section>
        <Empty>
          {state?.scenario ? "Waiting for the first hour…" : "Press play, or pick a storm in the left panel first."}
        </Empty>
      </div>
    );
  }

  const p = latest.predict;
  const plan = latest.prescribe;
  const exp = p.expected_onsets;
  const top = p.watchlist.slice(0, 3).map((w) => w.name);
  const state0 = latest.diagnose.state;
  const visible = plan.moves.filter((m) => decisions[m.id] !== "dismissed").slice(0, 4);
  const approved = Object.values(decisions).filter((v) => v === "approved").length;
  const live = !!latest.live;
  const nws = (latest.alerts?.events ?? []).filter((e) => e.relevant);

  const headline =
    exp[2] >= 0.5 ? (
      <>
        Next 24 hours: about <em>{Math.round(exp[2])} more {Math.round(exp[2]) === 1 ? "county" : "counties"}</em>{" "}
        {Math.round(exp[2]) === 1 ? "is" : "are"} likely to lose power, exposing <em>{compact(p.customers_exposed)} customers</em>, {compact(p.seniors_exposed)} of them seniors.
      </>
    ) : (
      <>
        Next 24 hours: <em>no county</em> is likely to cross the severe-outage line. Keep watching.
      </>
    );

  return (
    <div className="space-y-5">
      <section className="brief">
        <p className="eyebrow dash">
          {live ? `Live brief · as of ${fmtClock(latest.as_of ?? latest.t)}` : `Situation brief · ${fmtTime(latest.t)}`}
        </p>
        <h1 className="mt-4">{headline}</h1>
        <p className="sub">
          {top.length > 0 && (
            <>
              Start with <b>{top.join(", ")}</b>.{" "}
            </>
          )}
          Peak risk window is <b>{p.peak_window}</b>. Statewide it is <b>{state0.temp_f_mean.toFixed(0)}°F</b>
          {Math.abs(state0.demand_norm) > 0.05 && (
            <>
              , demand is <b>{state0.demand_norm >= 0 ? "+" : ""}{(state0.demand_norm * 100).toFixed(0)}%</b> against its two-week norm
            </>
          )}
          {live ? (
            nws.length > 0 ? (
              <>
                . The National Weather Service has <b>{nws.length}</b> grid-relevant alert {nws.length === 1 ? "type" : "types"} active:{" "}
                {nws.slice(0, 3).map((e) => e.event).join(", ")}.
              </>
            ) : (
              <>. No grid-relevant National Weather Service alerts are active.</>
            )
          ) : (
            <>
              , and <b>{latest.describe.severe_now}</b> {latest.describe.severe_now === 1 ? "county has" : "counties have"} already lost power.
            </>
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn btn--primary" onClick={() => go("prescribe")}>
            Review {plan.moves.length} recommended moves <ArrowRight />
          </button>
          <button className="btn btn--ghost" onClick={() => go("diagnose")}>
            Why is this happening?
          </button>
          {approved > 0 && <span className="chip chip--gain">{approved} approved</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Expected severe outages · 24 h"
          value={exp[2].toFixed(1)}
          sub="counties the model expects to cross the severe line"
          foot={
            <>
              <span>
                6 h <b>{exp[0].toFixed(1)}</b>
              </span>
              <span>
                12 h <b>{exp[1].toFixed(1)}</b>
              </span>
            </>
          }
          tone="signal"
        />
        <Kpi
          label="Customers exposed"
          value={compact(p.customers_exposed)}
          sub={`${compact(p.people_exposed)} people in counties likely to lose power`}
          foot={
            <>
              <span>{live ? "forecast, not reported" : <>out now <b>{compact(latest.out_total)}</b></>}</span>
            </>
          }
        />
        <Kpi
          label="Seniors exposed"
          value={compact(p.seniors_exposed)}
          sub="residents aged 65+ weighted by each county's risk"
          foot={
            <>
              <span>
                {live ? (
                  "no live outage feed"
                ) : (
                  <>
                    already out <b>{compact(latest.describe.seniors_out)}</b>
                  </>
                )}
              </span>
            </>
          }
          tone="loss"
        />
        <Kpi
          label="Plan coverage"
          value={plan.deployments.length ? pct(plan.coverage.crews) : "–"}
          sub={plan.deployments.length ? `of the crew need is covered by ${plan.resources.crews} crews` : "nothing to deploy against right now"}
          foot={
            <>
              <span>
                by population alone <b>{pct(plan.naive_coverage.crews)}</b>
              </span>
            </>
          }
          tone="gain"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="eyebrow dash">Prescribe</p>
              <h2 className="mt-2 text-[21px]">Recommended moves</h2>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => go("prescribe")}>
              All moves and resource planner <ArrowRight />
            </button>
          </div>
          {visible.length === 0 ? (
            <Empty>No moves right now. The grid and the counties are quiet.</Empty>
          ) : (
            visible.map((m, i) => <MoveCard key={m.id} move={m} index={i} state={decisions[m.id]} onDecide={decide} />)
          )}
          <p className="text-[11.5px] leading-snug text-dim">
            Moves are rules over the forecast, not predictions of their own. They suggest and you decide. Resource counts are what-if levers.
          </p>
        </div>

        <div className="space-y-5">
          <Panel
            title="Where risk is highest"
            note="predicted"
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
                  { color: TIER_COLOR[0], label: "clear" },
                  { color: TIER_COLOR[1], label: `watch ${latest.tier_counts[1]}` },
                  { color: TIER_COLOR[2], label: `prepare ${latest.tier_counts[2]}` },
                  { color: TIER_COLOR[3], label: `act ${latest.tier_counts[3]}` },
                  { color: "var(--fg)", label: "already out", ring: true },
                ]}
              />
            </div>
          </Panel>
          <Panel title="Why the risk is where it is" note="diagnose">
            {latest.diagnose.drivers
              .filter((d) => d.group !== "profile")
              .map((d) => (
                <DriverBar key={d.group} label={d.label} share={d.share} push={d.push} />
              ))}
            <p className="mt-2 text-[11.5px] leading-snug text-dim">
              Average push on the risk of counties currently on alert, by signal family. Higher means more of the alert comes from it.
            </p>
          </Panel>
        </div>
      </div>

      {live ? (
        <Panel title="Live data" note="describe">
          <div className="callout">
            <span>
              <b>No outage feed in live mode.</b> The live model forecasts from weather, ERCOT grid telemetry and county profile. Open <b>Live data</b> in the
              sidebar for feed health, NWS alerts and the API.
            </span>
          </div>
        </Panel>
      ) : (
      <Panel title="What has happened so far" note="describe">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <MiniStat label="Customers without power" value={n0(latest.out_total)} />
          <MiniStat label="Counties in severe outage" value={`${latest.describe.severe_now} now · ${latest.describe.ever_severe} ever`} />
          <MiniStat label="Peak outage" value={compact(latest.describe.peak.out)} sub={latest.describe.peak.t ? fmtTime(latest.describe.peak.t) : undefined} />
          <MiniStat
            label="Warned before they hit"
            value={latest.describe.scorecard.onsets ? `${latest.describe.scorecard.warned} of ${latest.describe.scorecard.onsets}` : "–"}
            sub={latest.describe.scorecard.median_lead_h != null ? `median lead ${latest.describe.scorecard.median_lead_h} h` : undefined}
          />
        </div>
      </Panel>
      )}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="eyebrow" style={{ fontSize: 9.5 }}>
        {label}
      </p>
      <p className="mt-1.5 text-[19px] font-semibold tracking-tight tnum">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-mut">{sub}</p>}
    </div>
  );
}
