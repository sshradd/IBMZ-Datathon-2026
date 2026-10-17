import { getJSON, n0, type ModelInfo } from "../api";
import { useEffect, useState } from "react";

const STORMS: Record<string, string> = {
  uri: "Winter Storm Uri (Feb 2021)",
  elliott: "Winter Storm Elliott (Dec 2022)",
  ice2023: "Feb 2023 ice storm",
  heat2023: "Aug 2023 heat dome",
};

export default function ModelFacts() {
  const [models, setModels] = useState<Record<string, ModelInfo> | null>(null);
  useEffect(() => {
    getJSON<Record<string, ModelInfo>>("/api/models").then(setModels).catch(() => {});
  }, []);
  const m = models?.honest;
  if (!m) return <div className="panel py-10 text-center text-sm text-mut">Loading model facts…</div>;
  const x = m.metrics;
  return (
    <div className="space-y-4">
      <div className="panel space-y-2 text-sm">
        <h2 className="text-lg font-semibold tracking-tight">What it learned from, and what it never saw</h2>
        <p className="max-w-4xl">
          A transparent logistic regression, trained on {n0(x.train_rows ?? 0)} county-hours of real Texas data
          (2019 to {x.train_end?.slice(0, 7)}), excluding February 2021. Inputs are public: county outage counts from DOE
          EAGLE-I, ERCOT grid telemetry from EIA, hourly weather from Open-Meteo and Census populations. Every score
          breaks down into plain-English reasons. The "honest" model has never seen Uri, Elliott, the February 2023
          ice storm or the August 2023 heat dome, so replaying them is a real out-of-sample test.
        </p>
        <p className="max-w-4xl text-mut">
          It predicts whether a county will cross a severe line (at least 10% of its customers and at least 2,500
          customers without power) within {x.horizon_h} hours. It does not forecast the weather: it reacts to cold,
          ice, grid stress and outages already spreading.
        </p>
      </div>

      <div className="panel overflow-auto">
        <h3 className="eyebrow mb-2">Out-of-sample results by storm (honest model)</h3>
        <table className="tabular w-full text-left text-[13px]">
          <thead className="eyebrow">
            <tr>
              <th className="py-1.5 font-normal">Storm</th>
              <th className="text-right">Severe outages</th>
              <th className="text-right">Warned first</th>
              <th className="text-right">Median lead</th>
              <th className="text-right">Best lead</th>
              <th className="text-right">False alerts</th>
              <th className="text-right">Top-10 lift</th>
              <th className="text-right">AUC</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(STORMS).map((k) => {
              const s = x.scenarios?.[k];
              const r = x.ranking?.[k];
              const set = x.sets?.[k];
              if (!s) return null;
              return (
                <tr key={k} className="border-t border-soft">
                  <td className="py-1.5">{STORMS[k]}</td>
                  <td className="text-right">{s.onsets}</td>
                  <td className="text-right">
                    {s.warned} ({s.warned_pct}%)
                  </td>
                  <td className="text-right">{s.median_lead_h ?? "–"} h</td>
                  <td className="text-right">{s.max_lead_h ?? "–"} h</td>
                  <td className="text-right">{n0(s.false_alerts)}</td>
                  <td className="text-right">{r ? `${r.lift}x` : "–"}</td>
                  <td className="text-right">{set ? set.roc_auc.toFixed(2) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 max-w-4xl text-[12px] leading-snug text-mut">
          Warned first: the county had a watch-level alert before it crossed the severe line. False alerts: alert
          episodes with no severe outage in the following {x.horizon_h} hours. Top-10 lift: of the 10 highest-risk
          counties each hour, how many were hit versus picking 10 at random. Alert tiers are budgets set on training
          data only (watch is the top 3% of county-hours, prepare 1%, act 0.3%), never tuned on these storms.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel">
          <h3 className="eyebrow mb-2">What pushes risk up most</h3>
          <ul className="tabular space-y-1 text-[13px]">
            {x.top_weights?.map((w) => (
              <li key={w.feature} className="flex justify-between gap-3">
                <span className="mono text-[12px]">{w.feature}</span>
                <span className={w.weight >= 0 ? "text-loss" : "text-gain"}>{w.weight >= 0 ? "+" : ""}{w.weight}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel text-[13px]">
          <h3 className="eyebrow mb-2">Honest limits</h3>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>Weather comes from 12 stations, so a county can be far from its station. A real system would add NWS forecasts and radar.</li>
            <li>The heat dome is the hard case: heat-driven outages look different from winter storms, and the model catches few of them.</li>
            <li>Many warnings are false alarms. The model is built to rank where to look first, not to replace an emergency manager.</li>
            <li>Senior counts are Census population estimates. We have no access to medical-need registries.</li>
            <li>County outage data counts only what utilities reported to the public map. Very small outages are missing.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
