import { useEffect, useState } from "react";
import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import { money, postJSON, type ScoredEvent, type Stats } from "../api";
import RingGraph from "./RingGraph";

const SPEEDS = [5, 20, 100, 1000];

export const ACTION_STYLE = {
  allow: "bg-green-500/15 text-green-300",
  step_up: "bg-amber-500/20 text-amber-300",
  hold: "bg-red-500/20 text-red-300",
} as const;

export const ACTION_LABEL = { allow: "Allow", step_up: "Verify", hold: "Hold" } as const;

interface Props {
  events: { feed: ScoredEvent[]; alerts: ScoredEvent[]; clear: () => void };
  stats: Stats | null;
}

export default function OpsConsole({ events, stats }: Props) {
  const [speed, setSpeed] = useState(20);
  const [fraudRate, setFraudRate] = useState(0.02);
  const running = stats?.running ?? false;

  // Reflect the server's speed if another tab or the API changed it.
  const serverSpeed = stats?.config.speed;
  useEffect(() => {
    if (running && serverSpeed) setSpeed(serverSpeed);
  }, [running, serverSpeed]);

  const start = (s = speed, f = fraudRate) =>
    postJSON("/api/sim/start", { speed: s, fraud_rate: f }).catch(console.error);
  const stop = () => postJSON("/api/sim/stop").catch(console.error);
  const reset = async () => {
    await postJSON("/api/sim/reset").catch(console.error);
    events.clear();
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-4 text-sm">
        <button
          onClick={() => (running ? stop() : start())}
          className={clsx(
            "flex items-center gap-2 rounded-lg px-4 py-2 font-medium",
            running ? "bg-white/10" : "bg-green-600 text-white",
          )}
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "Pause stream" : "Start stream"}
        </button>
        <label className="flex items-center gap-2">
          Speed
          <select
            className="rounded bg-white/10 px-2 py-1"
            value={speed}
            onChange={(e) => {
              const s = Number(e.target.value);
              setSpeed(s);
              if (running) start(s);
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} tx/s
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Scam rate
          <input
            type="range"
            min={0}
            max={0.1}
            step={0.005}
            value={fraudRate}
            onChange={(e) => setFraudRate(Number(e.target.value))}
            onMouseUp={() => running && start()}
            onTouchEnd={() => running && start()}
          />
          <span className="tabular w-10">{(fraudRate * 100).toFixed(1)}%</span>
        </label>
        <button onClick={reset} className="ml-auto flex items-center gap-1 text-gray-400 hover:text-white">
          <RotateCcw className="h-4 w-4" /> Reset
        </button>
      </div>

      <StatTiles stats={stats} />

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-300">Live payments</h2>
          <div className="max-h-[420px] overflow-auto">
            <table className="tabular w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#0f141d] text-gray-400">
                <tr>
                  <th className="py-1">From</th>
                  <th>To</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Risk</th>
                  <th className="text-right">Decision</th>
                  <th className="text-right">ms</th>
                </tr>
              </thead>
              <tbody>
                {events.feed.map(({ txn, decision }) => (
                  <tr key={txn.id} className="border-t border-white/5">
                    <td className="py-1">
                      {txn.sender_id}
                      {txn.sender_age_band === "65+" && <span className="ml-1 text-amber-400">65+</span>}
                    </td>
                    <td>{txn.receiver_id}</td>
                    <td className="text-right">{money(txn.amount)}</td>
                    <td className="text-right">{(decision.risk * 100).toFixed(0)}%</td>
                    <td className="text-right">
                      <span className={clsx("rounded px-1.5 py-0.5", ACTION_STYLE[decision.action])}>
                        {ACTION_LABEL[decision.action]}
                      </span>
                    </td>
                    <td className="text-right text-gray-500">{decision.latency_ms.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.feed.length && (
              <p className="py-8 text-center text-sm text-gray-500">Press Start stream to begin.</p>
            )}
          </div>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-gray-300">Alerts</h2>
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {events.alerts.map(({ txn, decision }) => (
              <div key={txn.id} className="rounded-lg bg-white/5 p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <span className={clsx("rounded px-1.5 py-0.5", ACTION_STYLE[decision.action])}>
                    {ACTION_LABEL[decision.action]}
                  </span>
                  <span className="tabular font-medium">{money(txn.amount)}</span>
                  <span className="text-gray-400">
                    {txn.sender_id} → {txn.receiver_id}
                  </span>
                  <span className="tabular ml-auto text-gray-400">{(decision.risk * 100).toFixed(0)}%</span>
                </div>
                <ul className="list-disc pl-4 text-gray-300">
                  {decision.reasons.map((r) => (
                    <li key={r.code}>{r.text}</li>
                  ))}
                </ul>
                {txn.scenario && (
                  <p className="mt-1 text-[10px] text-gray-500">Simulated scenario: {txn.scenario}</p>
                )}
              </div>
            ))}
            {!events.alerts.length && <p className="py-8 text-center text-sm text-gray-500">No alerts yet.</p>}
          </div>
        </section>
      </div>

      <RingGraph />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function StatTiles({ stats }: { stats: Stats | null }) {
  const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(0)}%`);
  if (!stats) return <div className="card text-sm text-gray-500">Connecting to backend…</div>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Tile label="Payments scored" value={stats.processed.toLocaleString()} sub={`${stats.tps_5s} tx/s now`} />
      <Tile label="Held" value={stats.actions.hold.toLocaleString()} sub={`${stats.actions.step_up} sent to verify`} />
      <Tile label="Scam money stopped" value={money(stats.fraud_amount_stopped)} sub="held before settlement" />
      <Tile label="Precision" value={pct(stats.precision)} sub="flags that were real scams" />
      <Tile label="Recall" value={pct(stats.recall)} sub="scams caught" />
      <Tile
        label="Decision latency p99"
        value={`${stats.latency_ms.p99.toFixed(2)} ms`}
        sub={`p50 ${stats.latency_ms.p50.toFixed(3)} ms`}
      />
    </div>
  );
}
