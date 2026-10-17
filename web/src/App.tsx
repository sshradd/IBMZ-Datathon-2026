import { useState } from "react";
import clsx from "clsx";
import { Cpu, ShieldCheck } from "lucide-react";
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

export default function App() {
  const [tab, setTab] = useState<Tab>("ops");
  const events = useEvents();
  const stats = usePoll<Stats>("/api/stats", 1000);
  const system = usePoll<SystemInfo>("/api/system", 30000);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-green-500" />
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Scam Stopper</h1>
          <p className="text-xs text-gray-400">
            Stops instant-payment scams from both ends, before the money settles.
          </p>
        </div>
        {system && (
          <span
            className={clsx(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
              system.is_ibm_z ? "bg-blue-500/20 text-blue-300" : "bg-white/10 text-gray-300",
            )}
            title={system.platform}
          >
            <Cpu className="h-3.5 w-3.5" />
            {system.is_ibm_z ? "Running on IBM LinuxONE" : "Running on"} · {system.machine} ·{" "}
            {system.cpus} CPUs
          </span>
        )}
        <span
          className={clsx(
            "h-2.5 w-2.5 rounded-full",
            events.connected ? "bg-green-500" : "bg-red-500",
          )}
          title={events.connected ? "Live stream connected" : "Stream disconnected"}
        />
      </header>

      <nav className="mb-4 flex gap-1 rounded-lg bg-white/5 p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex-1 rounded-md px-3 py-1.5",
              tab === t.id ? "bg-white/15 text-white" : "text-gray-400 hover:text-white",
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
