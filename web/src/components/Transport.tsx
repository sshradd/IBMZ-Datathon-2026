import { useEffect, useState } from "react";
import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import { fmtTime, type Replay } from "../api";

const SPEEDS = [6, 12, 30, 90];

/** Sticky playback bar: play, restart, scrub through the storm, change speed. */
export default function Transport({
  replay,
  scenario,
  model,
}: {
  replay: Replay;
  scenario: string;
  model: string | null;
}) {
  const { state, latest, start, pause, resume, setSpeed, seek } = replay;
  const active = !!state?.scenario;
  const n = state?.n ?? replay.scenarios.find((s) => s.key === scenario)?.hours ?? 0;
  const i = latest ? latest.i : 0;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? i;
  useEffect(() => setDrag(null), [i]);

  const finished = active && state!.i >= state!.n;
  const honest = (state?.model ?? model ?? "honest") !== "final" && (state?.model ?? "honest") === "honest";

  const toggle = () => {
    if (!active || finished) return start(scenario, model || null, state?.speed ?? 12);
    return state!.running ? pause() : resume();
  };

  return (
    <div className="topbar">
      <div className="topbar-in">
        <button className={clsx("tbtn", "tbtn--primary")} onClick={toggle} aria-label={state?.running ? "Pause" : "Play"}>
          {state?.running ? <Pause /> : <Play />}
        </button>
        <button className="tbtn" onClick={() => start(scenario, model || null, state?.speed ?? 12)} aria-label="Restart replay">
          <RotateCcw />
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(n - 1, 1)}
            value={shown}
            disabled={!active}
            style={{ ["--p" as string]: `${n > 1 ? (shown / (n - 1)) * 100 : 0}%` }}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={() => drag != null && seek(drag)}
            onKeyUp={() => drag != null && seek(drag)}
            aria-label="Position in the storm"
          />
        </div>
        <div className="hidden w-[168px] text-right sm:block">
          <p className="mono text-[12.5px] tnum">{latest ? fmtTime(latest.t) : active ? "starting…" : "press play"}</p>
          <p className="eyebrow justify-end" style={{ fontSize: 9, marginTop: 2 }}>
            hour {Math.min(shown + 1, n)} / {n}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={(state?.speed ?? 12) === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        {active && (
          <span className={clsx("chip hidden md:inline-flex", honest ? "chip--gain" : "chip--prepare")} title={honest ? "The model never saw this storm in training" : "The model was trained on this storm"}>
            {honest ? "out of sample" : "in sample"}
          </span>
        )}
      </div>
    </div>
  );
}
