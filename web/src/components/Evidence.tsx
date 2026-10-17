import { n0, pct, type ModelInfo } from "../api";
import { STORM } from "./Predict";
import { Empty, Lens, Panel } from "./ui";

export default function Evidence({ models }: { models: Record<string, ModelInfo> | null }) {
  const m = models?.honest;
  if (!m) return <Empty>Loading the evidence…</Empty>;
  const x = m.metrics;
  const ts = x.tier_stats;

  return (
    <div className="space-y-5">
      <div>
        <Lens n="06" name="Evidence" question="should you trust it?" />
        <h2 className="mt-2 text-[26px]">Tested on storms the model never saw</h2>
        <p className="mt-2 max-w-3xl text-[14px] text-mut">
          A transparent logistic regression with three forecast heads (6, 12 and 24 hours), trained on {n0(x.train_rows ?? 0)} real Texas county-hours from 2019 to{" "}
          {x.train_end?.slice(0, 7)}, with February 2021 removed. Winter Storm Uri, Elliott, the February 2023 ice storm and the August 2023 heat dome are all
          out of sample. Inputs are public: DOE EAGLE-I outages, EIA ERCOT grid data, Open-Meteo weather and Census populations.
        </p>
      </div>

      <Panel title="Out-of-sample results by storm" note="honest model">
        <div className="overflow-x-auto scroll-thin">
          <table className="tbl">
            <thead>
              <tr>
                <th>Storm</th>
                <th className="num">Severe county outages</th>
                <th className="num">Alert first</th>
                <th className="num">Median lead</th>
                <th className="num">Best lead</th>
                <th className="num">False alerts</th>
                <th className="num">Top-10 lift</th>
                <th className="num">AUC 24 h</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(STORM).map((k) => {
                const s = x.scenarios?.[k];
                const r = x.ranking?.[k];
                const set = x.sets?.[k];
                if (!s) return null;
                return (
                  <tr key={k}>
                    <td>{STORM[k]}</td>
                    <td className="num">{s.onsets}</td>
                    <td className="num text-fg">
                      {s.warned} ({s.warned_pct}%)
                    </td>
                    <td className="num">{s.median_lead_h ?? "–"} h</td>
                    <td className="num">{s.max_lead_h ?? "–"} h</td>
                    <td className="num">{n0(s.false_alerts)}</td>
                    <td className="num">{r ? `${r.lift}x` : "–"}</td>
                    <td className="num">{set ? set.roc_auc.toFixed(2) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-4xl text-[11.5px] leading-snug text-dim">
          Alert first: the county had a watch-level alert before it crossed the severe line. False alerts: alert episodes with no severe outage in the
          next 24 hours. Top-10 lift: of the 10 highest-risk counties each hour, how many were hit versus picking 10 at random. Alert tiers are budgets
          set on training data only, never tuned on these storms.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {ts && (
          <Panel title="How often does an alert come true?" note="track record behind every recommendation">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Alert tier</th>
                  <th className="num">Went severe within 24 h</th>
                  <th className="num">Lift vs. typical</th>
                  <th className="num">Outages caught</th>
                </tr>
              </thead>
              <tbody>
                {(["watch", "prepare", "act"] as const).map((t) => (
                  <tr key={t}>
                    <td>{t}</td>
                    <td className="num text-fg">{pct(ts[t].precision, 1)}</td>
                    <td className="num">{ts[t].lift}x</td>
                    <td className="num">{pct(ts[t].recall, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11.5px] leading-snug text-dim">
              A typical county-hour in these storms had a {pct(ts.base_rate, 1)} chance of going severe within 24 hours. Alerts are about six times better than
              that, but most alerts still do not end in a severe outage. That is why the recommendations are ranked and labeled with their hit rate.
            </p>
          </Panel>
        )}

        <Panel title="Honest limits">
          <ul className="list-disc space-y-2 pl-4 text-[13px] text-mut">
            <li>Alerts are broad. A large share of county-hours are on watch during a statewide event, and many alerts do not end in a severe outage.</li>
            <li>The heat dome is the weak case. Heat-driven outages look different from winter storms and the model catches fewer than half of them.</li>
            <li>It under-sizes statewide events like Uri. It ranks which counties go first better than it counts the total.</li>
            <li>It does not forecast weather. A real system would add NWS forecasts and radar. Weather comes from 12 stations.</li>
            <li>Seniors are Census county counts. We have no access to medical-need registries.</li>
            <li>Resource counts in the planner are what-if levers, not any utility's actual fleet. Moves are rules over the forecast and are not validated by emergency managers.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
