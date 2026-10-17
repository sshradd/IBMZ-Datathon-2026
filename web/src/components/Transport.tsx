import { useEffect, useState } from "react";
import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import { fmtClock, fmtTime, type Replay } from "../api";

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

  const live = state?.scenario === "live";
  const finished = active && !live && state!.i >= state!.n;
  const mname = state?.model ?? model ?? "honest";
  const honest = mname === "honest" || mname === "live_honest";

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
        {live ? (
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              <span className="relative flex h-2.5 w-2.5">
                <span className={clsx("absolute inline-flex h-full w-full rounded-full bg-loss opacity-60", state?.running && "animate-ping")} />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-loss" />
              </span>
              Live
              <span className="font-normal text-mut">
                ERCOT, NWS and Open-Meteo · scored every minute
                {latest?.as_of ? ` · as of ${fmtClock(latest.as_of)}` : ""}
              </span>
            </p>
          </div>
        ) : (
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
        )}
        {!live && (
          <div className="hidden w-[168px] text-right sm:block">
            <p className="mono text-[12.5px] tnum">{latest ? fmtTime(latest.t) : active ? "starting…" : "press play"}</p>
            <p className="eyebrow justify-end" style={{ fontSize: 9, marginTop: 2 }}>
              hour {Math.min(shown + 1, n)} / {n}
            </p>
          </div>
        )}
        {!live && (
          <div className="seg" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={(state?.speed ?? 12) === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        )}
        {active && !live && (
          <span className={clsx("chip hidden md:inline-flex", honest ? "chip--gain" : "chip--prepare")} title={honest ? "The model never saw this storm in training" : "The model was trained on this storm"}>
            {honest ? "out of sample" : "in sample"}
          </span>
        )}
      </div>
    </div>
  );
}
