import { useEffect, useState } from "react";
import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import { money, postJSON, type Action, type ScoredEvent, type Stats } from "../api";
import RingGraph from "./RingGraph";

const SPEEDS = [5, 20, 100, 1000];

export const ACTION_LABEL: Record<Action, string> = { allow: "Allow", step_up: "Verify", hold: "Hold" };

export function ActionChip({ action }: { action: Action }) {
  return <span className={clsx("chip", `chip-${action}`)}>{ACTION_LABEL[action]}</span>;
}

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
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3">
        <button onClick={() => (running ? stop() : start())} className={clsx("btn", !running && "btn-primary")}>
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "Pause stream" : "Start stream"}
        </button>
        <label className="flex items-center gap-2">
          <span className="eyebrow">Speed</span>
          <select
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
          <span className="eyebrow">Scam rate</span>
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
          <span className="mono tabular w-10 text-[12px]">{(fraudRate * 100).toFixed(1)}%</span>
        </label>
        <button onClick={reset} className="eyebrow ml-auto flex items-center gap-1.5 hover:text-fg">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <StatTiles stats={stats} />

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <h2 className="eyebrow mb-3">Live payments</h2>
          <div className="scroll-thin max-h-[420px] overflow-auto">
            <table className="tabular w-full text-left text-[13px]">
              <thead className="eyebrow sticky top-0 bg-card">
                <tr>
                  <th className="py-1.5 font-normal">From</th>
                  <th className="font-normal">To</th>
                  <th className="text-right font-normal">Amount</th>
                  <th className="text-right font-normal">Risk</th>
                  <th className="text-right font-normal">Decision</th>
                  <th className="text-right font-normal">ms</th>
                </tr>
              </thead>
              <tbody>
                {events.feed.map(({ txn, decision }) => (
                  <tr key={txn.id} className="border-t border-soft">
                    <td className="py-1.5">
                      {txn.sender_id}
                      {txn.sender_age_band === "65+" && <span className="mono ml-1.5 text-[10px] text-warn">65+</span>}
                    </td>
                    <td className="text-mut">{txn.receiver_id}</td>
                    <td className="text-right">{money(txn.amount)}</td>
                    <td className={clsx("text-right", decision.action !== "allow" && "text-loss")}>
                      {(decision.risk * 100).toFixed(0)}%
                    </td>
                    <td className="text-right">
                      <ActionChip action={decision.action} />
                    </td>
                    <td className="mono text-right text-[11px] text-mut">{decision.latency_ms.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.feed.length && <p className="py-10 text-center text-mut">Press Start stream to begin.</p>}
          </div>
        </section>

        <section className="panel lg:col-span-2">
          <h2 className="eyebrow mb-3">Alerts</h2>
          <div className="scroll-thin max-h-[420px] space-y-2 overflow-auto">
            {events.alerts.map(({ txn, decision }) => (
              <div key={txn.id} className="rounded-card border border-soft bg-bg2 p-3 text-[13px]">
                <div className="mb-1.5 flex items-center gap-2">
                  <ActionChip action={decision.action} />
                  <span className="tabular font-semibold">{money(txn.amount)}</span>
                  <span className="truncate text-mut">
                    {txn.sender_id} → {txn.receiver_id}
                  </span>
                  <span className="mono tabular ml-auto text-[12px] text-loss">{(decision.risk * 100).toFixed(0)}%</span>
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-fg/90">
                  {decision.reasons.map((r) => (
                    <li key={r.code}>{r.text}</li>
                  ))}
                </ul>
                {txn.scenario && <p className="eyebrow mt-2">simulated · {txn.scenario}</p>}
              </div>
            ))}
            {!events.alerts.length && <p className="py-10 text-center text-mut">No alerts yet.</p>}
          </div>
        </section>
      </div>

      <RingGraph />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gain" | "loss" }) {
  return (
    <div className="panel">
      <p className="eyebrow">{label}</p>
      <p
        className={clsx(
          "tabular mt-2 text-[26px] font-semibold leading-none tracking-tight",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-[12px] text-mut">{sub}</p>}
    </div>
  );
}

function StatTiles({ stats }: { stats: Stats | null }) {
  const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(0)}%`);
  if (!stats) return <div className="panel text-mut">Connecting to backend…</div>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Tile label="Payments scored" value={stats.processed.toLocaleString()} sub={`${stats.tps_5s} tx/s now`} />
      <Tile label="Held" value={stats.actions.hold.toLocaleString()} sub={`${stats.actions.step_up} sent to verify`} />
      <Tile label="Scam money stopped" value={money(stats.fraud_amount_stopped)} sub="held before settlement" tone="gain" />
      <Tile label="Precision" value={pct(stats.precision)} sub="flags that were real scams" />
      <Tile label="Recall" value={pct(stats.recall)} sub="scams caught" />
      <Tile
        label="Latency p99"
        value={`${stats.latency_ms.p99.toFixed(2)} ms`}
        sub={`p50 ${stats.latency_ms.p50.toFixed(3)} ms`}
      />
    </div>
  );
}
