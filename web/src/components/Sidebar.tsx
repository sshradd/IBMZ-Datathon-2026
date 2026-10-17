import clsx from "clsx";
import { Activity, BarChart3, Cpu, ListChecks, Microscope, Moon, Radar, ShieldCheck, Sun, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { Scenario, SystemInfo } from "../api";

export type View = "brief" | "predict" | "prescribe" | "diagnose" | "describe" | "live" | "evidence" | "bench";
export type ModelChoice = "" | "honest" | "final" | "live_honest" | "live_final";

const LENSES: { id: View; title: string; sub: string; icon: ReactNode }[] = [
  { id: "brief", title: "Situation brief", sub: "Predict and prescribe at a glance", icon: <Zap /> },
  { id: "predict", title: "Predict", sub: "What happens next", icon: <Radar /> },
  { id: "prescribe", title: "Prescribe", sub: "What to do about it", icon: <ListChecks /> },
  { id: "diagnose", title: "Diagnose", sub: "Why it is happening", icon: <Microscope /> },
  { id: "describe", title: "Describe", sub: "What has happened", icon: <BarChart3 /> },
];

export default function Sidebar({
  view,
  onView,
  moves,
  scenarios,
  scenario,
  onScenario,
  model,
  onModel,
  system,
  theme,
  onTheme,
}: {
  view: View;
  onView: (v: View) => void;
  moves: number;
  scenarios: Scenario[];
  scenario: string;
  onScenario: (s: string) => void;
  model: ModelChoice;
  onModel: (m: ModelChoice) => void;
  system: SystemInfo | null;
  theme: "dark" | "light";
  onTheme: () => void;
}) {
  const item = (id: View, title: string, sub: string, icon: ReactNode, badge?: number) => (
    <button key={id} className="nav-item" aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
      {icon}
      <span>
        <span className="n-title">{title}</span>
        <span className="n-sub">{sub}</span>
      </span>
      {badge ? <span className="nav-badge">{badge}</span> : <span />}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
          <rect width="32" height="32" rx="8" fill="var(--card2)" stroke="var(--line)" />
          <path d="M18 5 9 18.200h6.200L13.600 27 23 13.600h-6.200z" fill="var(--signal)" />
        </svg>
        <div>
          <p className="brand-name">Uri Watch</p>
          <p className="eyebrow" style={{ fontSize: 9 }}>
            Texas grid · early warning
          </p>
        </div>
      </div>

      <div className="space-y-2.5 px-1">
        <p className="nav-label">Storm replay</p>
        <select value={scenario} onChange={(e) => onScenario(e.target.value)} aria-label="Storm">
          {(scenarios.length ? scenarios : [{ key: "uri", title: "Winter Storm Uri (Feb 2021)" } as Scenario]).map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => onModel(e.target.value as ModelChoice)} aria-label="Model">
          {scenario === "live" ? (
            <>
              <option value="">Live model (trained on all storms)</option>
              <option value="live_honest">Live model (backtest version)</option>
            </>
          ) : (
            <>
              <option value="">Full model, honest (never saw it)</option>
              <option value="final">Full model, trained on it</option>
              <option value="live_honest">Live-feature model, honest</option>
            </>
          )}
        </select>
      </div>

      <nav className="nav" aria-label="Analytics lenses">
        <p className="nav-label mb-1.5">Analytics</p>
        {LENSES.map((l) => item(l.id, l.title, l.sub, l.icon, l.id === "prescribe" ? moves : undefined))}
        <p className="nav-label mb-1.5 mt-4">Data and proof</p>
        {item("live", "Live data", "Real-time feeds and API", <Activity />)}
        {item("evidence", "Evidence", "Out-of-sample backtests", <ShieldCheck />)}
        {item("bench", "On IBM Z", "Throughput and latency", <Cpu />)}
      </nav>

      <div className="side-foot">
        {system && (
          <div className={clsx("callout", system.is_ibm_z && "border-data")} style={{ padding: "10px 12px", fontSize: 11.5 }} title={system.platform}>
            <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>{system.is_ibm_z ? "IBM LinuxONE" : "Dev machine"}</b>
              <br />
              {system.machine} · {system.cpus} cpu · {system.byteorder}-endian
            </span>
          </div>
        )}
        <button className="btn btn--ghost btn--sm self-start" onClick={onTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Daylight" : "Night"}
        </button>
      </div>
    </aside>
  );
}
