"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CloudOff, Ellipsis, Map as MapIcon, Package, Pause, Play, Radio, RotateCcw, Undo2, Users, Zap } from "lucide-react";
import { UNDO_MS, useStore } from "@/lib/store";
import { clock, dayClock } from "@/lib/format";

const TABS = [
  { href: "/", label: "Outages", icon: MapIcon },
  { href: "/teams/", label: "Teams", icon: Users },
  { href: "/resources/", label: "Resources", icon: Package },
  { href: "/more/", label: "More", icon: Ellipsis },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 h-14 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-3 px-3 md:gap-6 md:px-5">
          <Link href="/" className="flex flex-none items-center gap-2" aria-label="Uri Watch, home">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-bg">
              <Zap className="h-4 w-4" aria-hidden />
            </span>
            <span className="hidden text-[18px] font-bold tracking-tight sm:block">Uri Watch</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {TABS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={clsx("relative rounded-lg px-4 py-2 text-[16px] font-medium transition-colors", active(href) ? "bg-ink text-bg" : "text-ink2 hover:text-ink")}
              >
                {label}
                {active(href) && <span className="absolute inset-x-4 bottom-0.5 h-[2px] rounded bg-red" />}
              </Link>
            ))}
          </nav>

          <Playback />
        </div>
      </header>

      <main className="pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">{children}</main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="mx-auto flex max-w-xl">
          {TABS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={clsx("relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold", active(href) ? "text-ink" : "text-ink3")}
            >
              <Icon className="h-6 w-6" aria-hidden />
              {label}
              {active(href) && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b bg-red" />}
            </Link>
          ))}
        </div>
      </nav>

      <UndoBar />
      <Toast />
    </div>
  );
}

function Playback() {
  const { latest, state, connected, online, queued, pause, resume, start, seek, scenarios } = useStore();
  const live = state?.scenario === "live";
  const n = state?.n ?? 0;
  const i = latest?.i ?? 0;
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setDrag(null), [i]);
  const shown = drag ?? i;
  const temp = latest?.diagnose.state.temp_f_mean;
  const nws = latest?.alerts?.events.filter((e) => e.relevant).length ?? 0;

  const toggle = () => {
    if (!state?.scenario) return start(scenarios[1]?.key ?? "uri");
    return state.running ? pause() : resume();
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
      <button className="btn btn-icon flex-none" onClick={toggle} aria-label={state?.running ? "Pause" : "Play"}>
        {state?.running ? <Pause /> : <Play />}
      </button>
      <Link href="/#start" className="btn btn-icon flex-none" aria-label="Back to the start screen: live or demo data" title="Start screen: live or demo data">
        <Radio />
      </Link>
      {state?.scenario && !live && (
        <button className="btn btn-icon hidden flex-none sm:inline-flex" onClick={() => start(state.scenario!, state.model)} aria-label="Restart demo">
          <RotateCcw />
        </button>
      )}

      <div className="min-w-0 flex-1">
        {live ? (
          <p className="flex items-center gap-2 text-[14px] font-semibold">
            <span className="dot" />
            Live
            <span className="mono truncate font-normal text-ink3">{latest?.as_of ? clock(latest.as_of) : "waiting for first poll"}</span>
          </p>
        ) : state?.scenario ? (
          <input
            type="range"
            min={0}
            max={Math.max(n - 1, 1)}
            value={shown}
            style={{ ["--p" as string]: `${n > 1 ? (shown / (n - 1)) * 100 : 0}%` }}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={() => drag != null && seek(drag)}
            onKeyUp={() => drag != null && seek(drag)}
            className="scrub"
            aria-label="Position in the demo data"
          />
        ) : (
          <p className="truncate text-[14px] muted">Press play to load demo outages</p>
        )}
      </div>

      {!live && latest && <p className="mono hidden flex-none text-[12.5px] text-ink2 lg:block">{dayClock(latest.t)}</p>}
      {typeof temp === "number" && (
        <p className="num flex-none text-[20px]" title="Statewide mean temperature">
          {temp.toFixed(0)}°F
        </p>
      )}
      {nws > 0 && <span className="chip chip-amber hidden flex-none sm:inline-flex">NWS {nws}</span>}
      {(!online || queued > 0) && (
        <span className="chip chip-amber flex-none" title="Actions made offline are sent when you reconnect">
          <CloudOff className="h-3.5 w-3.5" aria-hidden />
          {online ? `${queued} queued` : "offline"}
        </span>
      )}
      <span className={clsx("dot flex-none", connected ? "dot-green" : "")} title={connected ? "Connected" : "Not connected"} aria-label={connected ? "Connected" : "Not connected"} />
    </div>
  );
}

function UndoBar() {
  const { pendingUndo, undo } = useStore();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!pendingUndo) return;
    const tick = () => setLeft(Math.max(0, pendingUndo.until - Date.now()));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [pendingUndo]);
  if (!pendingUndo) return null;
  return (
    <div className="card fixed inset-x-3 top-[68px] z-50 mx-auto max-w-md overflow-hidden md:bottom-6 md:left-auto md:right-6 md:top-auto md:mx-0" role="status">
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold tracking-tight">Dispatched {pendingUndo.count} {pendingUndo.count === 1 ? "unit" : "units"}</p>
          <p className="text-[13px] muted">Work orders are ready on the Teams tab.</p>
        </div>
        <button className="btn" onClick={undo}>
          <Undo2 /> Undo
        </button>
      </div>
      <div className="h-1 origin-left bg-ink" style={{ transform: `scaleX(${left / UNDO_MS})`, transition: "transform 0.2s linear" }} />
    </div>
  );
}

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div className="card fixed inset-x-3 top-16 z-50 mx-auto max-w-md px-4 py-3 text-[15px]" role="status">
      {toast}
    </div>
  );
}
