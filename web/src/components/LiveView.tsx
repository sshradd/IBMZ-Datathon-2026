import { useEffect, useState } from "react";
import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import {
  fmtTime,
  getJSON,
  n0,
  pct,
  postJSON,
  TIER_NAMES,
  type County,
  type HourEvent,
  type ReplayState,
  type Scenario,
} from "../api";
import TexasMap, { TIER_COLOR } from "./TexasMap";
import Timeline from "./Timeline";
import type { HistoryPoint, Reason } from "../api";

type ReplayProps = {
  latest: HourEvent | null;
  history: HistoryPoint[];
  state: ReplayState | null;
  refreshState: () => void;
};

interface Explain {
  county: County;
  risk: number;
  reasons: Reason[];
}

const SPEEDS = [
  { label: "6 h/s", v: 6 },
  { label: "12 h/s", v: 12 },
  { label: "30 h/s", v: 30 },
  { label: "90 h/s", v: 90 },
];

export default function LiveView({ replay }: { replay: ReplayProps }) {
  const { latest, history, state, refreshState } = replay;
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState("uri");
  const [model, setModel] = useState<"" | "honest" | "final">("");
  const [speed, setSpeed] = useState(12);
  const [counties, setCounties] = useState<County[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [explain, setExplain] = useState<Explain | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getJSON<Scenario[]>("/api/scenarios").then(setScenarios).catch(() => {});
  }, []);
  useEffect(() => {
    getJSON<County[]>(`/api/counties?scenario=${scenario}`).then(setCounties).catch(() => {});
  }, [scenario]);
  useEffect(() => {
    if (state?.scenario) setScenario(state.scenario);
  }, [state?.scenario]);

  const hourKey = latest ? Math.floor(latest.i / 2) : -1;
  useEffect(() => {
    if (!selected || hourKey < 0) return;
    getJSON<Explain>(`/api/explain/${selected}`).then(setExplain).catch(() => {});
  }, [selected, hourKey]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      refreshState();
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    act(() => postJSON("/api/replay/start", { scenario, model: model || null, speed }));
  const pause = () => act(() => postJSON("/api/replay/pause"));
  const resume = () => act(() => postJSON("/api/replay/resume"));
  const changeSpeed = (v: number) => {
    setSpeed(v);
    if (state?.scenario) postJSON("/api/replay/speed", { speed: v }).catch(() => {});
  };

  const sc = latest?.scorecard;
  const finished = !!state && state.n > 0 && state.i >= state.n;
  const modelName = state?.model ?? (model || (scenarios.find((s) => s.key === scenario)?.default_model ?? "honest"));
  const honest = modelName === "honest";
  const selCounty = counties.find((c) => c.fips === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Storm</span>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {(scenarios.length ? scenarios : [{ key: "uri", title: "Winter Storm Uri (Feb 2021)" } as Scenario]).map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value as typeof model)}>
            <option value="">Honest (never saw the storm)</option>
            <option value="honest">Honest (explicit)</option>
            <option value="final">Final (trained on every storm)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Speed</span>
          <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            {state?.scenario ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {state?.scenario ? "Restart" : "Start replay"}
          </button>
          {state?.running ? (
            <button className="btn" onClick={pause} disabled={busy}>
              <Pause className="h-4 w-4" /> Pause
            </button>
          ) : (
            state?.scenario &&
            !finished && (
              <button className="btn" onClick={resume} disabled={busy}>
                <Play className="h-4 w-4" /> Resume
              </button>
            )
          )}
        </div>
        <div className="ml-auto text-right">
          <p className="mono text-[13px] tabular">{latest ? fmtTime(latest.t) : "ready"}</p>
          <p className={clsx("eyebrow mt-1", honest ? "text-gain" : "text-warn")}>
            {state?.scenario
              ? honest
                ? "Out of sample: model has never seen this storm"
                : "In sample: model trained on this storm"
              : "Pick a storm and press start"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="panel">
          <TexasMap counties={counties} latest={latest} selected={selected} onSelect={setSelected} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {TIER_NAMES.map((t, i) => (
              <span key={t} className="eyebrow flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[i] }} />
                {t}
                {latest ? ` ${latest.tier_counts[i]}` : ""}
              </span>
            ))}
            <span className="eyebrow flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: "var(--fg)" }} />
              severe outage now
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel">
            <h3 className="eyebrow mb-3">Scorecard so far</h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Severe outages" value={sc ? n0(sc.onsets) : "–"} sub="counties that hit the severe line" />
              <Stat
                label="Warned ahead"
                value={sc && sc.onsets ? `${sc.warned}/${sc.onsets}` : "–"}
                sub={sc?.warned_pct != null ? `${sc.warned_pct}% had an alert first` : "alert before the outage"}
                tone="gain"
              />
              <Stat
                label="Median lead"
                value={sc?.median_lead_h != null ? `${sc.median_lead_h} h` : "–"}
                sub={sc?.max_lead_h != null ? `best case ${sc.max_lead_h} h ahead` : "hours of warning"}
              />
              <Stat
                label="False alerts"
                value={sc ? n0(sc.false_alerts) : "–"}
                sub="alerts with no outage after"
                tone="warn"
              />
            </div>
            <p className="mt-3 text-[11.5px] leading-snug text-mut">
              The model sees only what was known at each hour: weather, ERCOT grid data and outages reported so far. It
              never sees the outage it is predicting.
            </p>
          </div>

          <div className="panel">
            <h3 className="eyebrow mb-2">{selCounty ? `${selCounty.name} County` : "Click a county"}</h3>
            {selCounty && explain && explain.county.fips === selCounty.fips ? (
              <div className="space-y-2 text-sm">
                <p className="tabular">
                  Risk of a severe outage within 24 h: <b>{pct(explain.risk, 1)}</b>
                  <span className="text-mut"> · {n0(selCounty.pop)} residents, {n0(selCounty.pop65)} aged 65+</span>
                </p>
                {explain.reasons.length ? (
                  <ul className="space-y-1">
                    {explain.reasons.map((r) => (
                      <li key={r.code} className="flex gap-2 text-[13px]">
                        <span className="mono text-info">+{r.weight.toFixed(1)}</span>
                        <span>{r.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-mut">Nothing is pushing this county above normal risk right now.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-mut">
                {selCounty ? "Start the replay to see why." : "Pick any dot to see why the model scored it that way."}
              </p>
            )}
          </div>
        </div>
      </div>

      <Timeline history={history} total={state?.n ?? scenarios.find((s) => s.key === scenario)?.hours ?? 0} />

      {latest && (
        <div className="grid gap-4 md:grid-cols-3">
          <Stat
            label="Grid demand vs forecast"
            value={`${n0(latest.grid.demand / 1000)} / ${n0(latest.grid.forecast / 1000)} GW`}
            sub={`${((latest.grid.demand / Math.max(latest.grid.forecast, 1) - 1) * 100).toFixed(0)}% against ERCOT's forecast`}
            panel
          />
          <Stat
            label="County scores per second"
            value={n0(latest.latency.scores_per_s)}
            sub={`p99 ${latest.latency.p99_ms} ms per county on this machine`}
            panel
          />
          <Stat
            label="Customers without power"
            value={n0(latest.out_total)}
            sub="reported by Texas utilities right now"
            tone="loss"
            panel
          />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  panel,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "gain" | "warn" | "loss";
  panel?: boolean;
}) {
  return (
    <div className={clsx(panel && "panel")}>
      <p className="eyebrow">{label}</p>
      <p
        className={clsx(
          "tabular mt-1 text-[26px] font-semibold leading-none tracking-tight",
          tone === "gain" && "text-gain",
          tone === "warn" && "text-warn",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11.5px] leading-snug text-mut">{sub}</p>
    </div>
  );
}
