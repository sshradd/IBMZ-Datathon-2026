import { useEffect, useState } from "react";
import clsx from "clsx";
import { Cpu, Moon, Sun } from "lucide-react";
import { useEvents, usePoll, type Stats, type SystemInfo } from "./api";
import OpsConsole from "./components/OpsConsole";
import Guardian from "./components/Guardian";
import Benchmark from "./components/Benchmark";

type Tab = "ops" | "guardian" | "bench";
const TABS: { id: Tab; label: string }[] = [
  { id: "ops", label: "Ops console" },
  { id: "guardian", label: "Guardian" },
  { id: "bench", label: "Benchmark" },
];

type Theme = "dark" | "light";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("ss-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("ops");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const events = useEvents();
  const stats = usePoll<Stats>("/api/stats", 1000);
  const system = usePoll<SystemInfo>("/api/system", 30000);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ss-theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-5">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Mark />
        <div className="mr-auto">
          <h1 className="text-[17px] font-semibold tracking-tight">Scam Stopper</h1>
          <p className="eyebrow mt-0.5">Decide before the money settles</p>
        </div>
        {system && (
          <span
            className={clsx(
              "mono flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px]",
              system.is_ibm_z ? "border-info text-info" : "border-line text-mut",
            )}
            title={system.platform}
          >
            <Cpu className="h-3.5 w-3.5" />
            {system.is_ibm_z ? "IBM LinuxONE" : "host"} · {system.machine} · {system.cpus} cpu
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className={clsx("h-2 w-2 rounded-full", events.connected ? "bg-gain" : "bg-loss")}
            aria-hidden
          />
          <span className="eyebrow">{events.connected ? "live" : "offline"}</span>
        </span>
        <button
          className="btn px-2.5 py-1.5"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <nav className="mb-5 flex gap-6 border-b border-line" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={clsx(
              "eyebrow -mb-px border-b-2 pb-2.5 pt-1 transition-colors",
              tab === t.id ? "border-signal text-fg" : "border-transparent hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "ops" && <OpsConsole events={events} stats={stats} />}
      {tab === "guardian" && <Guardian alerts={events.alerts} />}
      {tab === "bench" && <Benchmark system={system} />}
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
      <path d="M16 3 27 7.5V16c0 6.2-4.3 10.6-11 13C9.3 26.6 5 22.200 5 16V7.5z" fill="var(--signal)" />
      <path d="M11.500 16h9" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
