import { useEffect, useMemo, useState } from "react";
import { getJSON, useReplay, usePoll, type ModelInfo, type SystemInfo } from "./api";
import Sidebar, { type ModelChoice, type View } from "./components/Sidebar";
import LiveData from "./components/LiveData";
import Transport from "./components/Transport";
import type { MoveState } from "./components/ui";
import Brief from "./components/Brief";
import Predict from "./components/Predict";
import Prescribe from "./components/Prescribe";
import Diagnose from "./components/Diagnose";
import Describe from "./components/Describe";
import Evidence from "./components/Evidence";
import Benchmark from "./components/Benchmark";

type Theme = "dark" | "light";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("uw-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

export default function App() {
  const [view, setView] = useState<View>("brief");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [scenario, setScenario] = useState("uri");
  const [model, setModel] = useState<ModelChoice>("");
  const [decisions, setDecisions] = useState<Record<string, MoveState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, ModelInfo> | null>(null);
  const replay = useReplay();
  const system = usePoll<SystemInfo>("/api/system", 30000);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("uw-theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    getJSON<Record<string, ModelInfo>>("/api/models").then(setModels).catch(() => {});
  }, []);
  useEffect(() => {
    if (replay.state?.scenario) setScenario(replay.state.scenario);
  }, [replay.state?.scenario]);
  // A new replay starts a new decision log.
  useEffect(() => {
    if (!replay.state?.scenario || replay.state.i === 0) setDecisions({});
  }, [replay.state?.scenario, replay.state?.i === 0]);

  const decide = (id: string, s: MoveState) => setDecisions((d) => ({ ...d, [id]: s }));
  const tiers = useMemo(() => {
    const t = models?.[replay.state?.model ?? "honest"]?.tiers ?? models?.honest?.tiers;
    return t ? { watch: t.watch, prepare: t.prepare, act: t.act } : null;
  }, [models, replay.state?.model]);

  const ctx = { replay, tiers, models, decisions, decide, selected, select: setSelected, go: setView, scenario, model };
  const pending = (replay.latest?.prescribe.moves ?? []).filter((m) => !decisions[m.id]).length;

  return (
    <div className="app">
      <Sidebar
        view={view}
        onView={setView}
        moves={pending}
        scenarios={replay.scenarios}
        scenario={scenario}
        onScenario={setScenario}
        model={model}
        onModel={setModel}
        system={system}
        theme={theme}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
      <div className="main">
        <Transport replay={replay} scenario={scenario} model={model || null} />
        <div className="main-in">
          {view === "brief" && <Brief {...ctx} />}
          {view === "predict" && <Predict {...ctx} />}
          {view === "prescribe" && <Prescribe {...ctx} />}
          {view === "diagnose" && <Diagnose {...ctx} />}
          {view === "describe" && <Describe {...ctx} />}
          {view === "live" && <LiveData {...ctx} />}
          {view === "evidence" && <Evidence models={models} />}
          {view === "bench" && <Benchmark system={system} />}
        </div>
      </div>
    </div>
  );
}

export type Ctx = {
  replay: ReturnType<typeof useReplay>;
  tiers: { watch: number; prepare: number; act: number } | null;
  models: Record<string, ModelInfo> | null;
  decisions: Record<string, MoveState>;
  decide: (id: string, s: MoveState) => void;
  selected: string | null;
  select: (fips: string | null) => void;
  go: (v: View) => void;
  scenario: string;
  model: ModelChoice;
};
