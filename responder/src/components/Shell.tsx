"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CloudOff, Ellipsis, Map as MapIcon, Package, Pause, Play, RotateCcw, Undo2, Users, Zap } from "lucide-react";
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
    <div className="min-h-dvh md:grid md:grid-cols-[92px_minmax(0,1fr)]">
      <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-night/95 backdrop-blur md:static md:z-auto md:border-r md:border-t-0">
        <nav className="safe-bottom mx-auto flex max-w-xl justify-around md:sticky md:top-0 md:h-dvh md:max-w-none md:flex-col md:justify-start md:gap-1 md:px-2 md:py-4" aria-label="Main">
          <div className="hidden px-2 pb-4 md:block">
            <Zap className="h-7 w-7 text-lightning" aria-hidden />
            <p className="cond mt-2 text-[17px] uppercase">Uri Watch</p>
          </div>
          {TABS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={clsx(
                "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-2 py-1 text-[12px] font-semibold tracking-wide transition-colors md:flex-none md:py-3",
                active(href) ? "text-lightning" : "text-mute hover:text-frost",
              )}
            >
              <Icon className="h-6 w-6" aria-hidden />
              {label}
              {active(href) && <span className="absolute left-3 right-3 top-0 h-[3px] rounded-b bg-lightning md:inset-y-3 md:left-0 md:right-auto md:h-auto md:w-[3px] md:rounded-b-none md:rounded-r" />}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 pb-24 md:pb-0">
        <Ribbon />
        <main>{children}</main>
      </div>
      <UndoBar />
      <Toast />
    </div>
  );
}

function Ribbon() {
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
    <header className="sticky top-0 z-30 border-b border-rule bg-night/92 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 md:px-5">
        <button className="btn !min-h-11 !w-11 !px-0 border-lightning/50 text-lightning" onClick={toggle} aria-label={state?.running ? "Pause" : "Play"}>
          {state?.running ? <Pause /> : <Play />}
        </button>
        {state?.scenario && !live && (
          <button className="btn hidden !min-h-11 !w-11 !px-0 sm:inline-flex" onClick={() => start(state.scenario!, state.model)} aria-label="Restart replay">
            <RotateCcw />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {live ? (
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <span className="relative flex h-2.5 w-2.5">
                <span className={clsx("absolute inline-flex h-full w-full rounded-full bg-fault opacity-60", state?.running && "animate-ping")} />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-fault" />
              </span>
              LIVE
              <span className="mono font-normal text-mute">{latest?.as_of ? clock(latest.as_of) : "waiting for first poll"}</span>
            </p>
          ) : state?.scenario ? (
            <>
              <input
                type="range"
                min={0}
                max={Math.max(n - 1, 1)}
                value={shown}
                style={{ ["--p" as string]: `${n > 1 ? (shown / (n - 1)) * 100 : 0}%` }}
                onChange={(e) => setDrag(Number(e.target.value))}
                onPointerUp={() => drag != null && seek(drag)}
                onKeyUp={() => drag != null && seek(drag)}
                className="uw-range w-full"
                aria-label="Position in the storm"
              />
            </>
          ) : (
            <p className="text-[14px] text-mute">Press play to start a storm replay</p>
          )}
        </div>

        {!live && latest && <p className="mono hidden text-[13px] text-frost sm:block">{dayClock(latest.t)}</p>}
        {typeof temp === "number" && (
          <p className="cond text-[22px]" title="Statewide mean temperature">
            {temp.toFixed(0)}°F
          </p>
        )}
        {nws > 0 && <span className="tag tag--amber hidden sm:inline-flex">NWS {nws}</span>}
        {(!online || queued > 0) && (
          <span className="tag tag--amber" title="Actions made offline are sent when you reconnect">
            <CloudOff className="h-3.5 w-3.5" aria-hidden />
            {online ? `${queued} queued` : "offline"}
          </span>
        )}
        <span className={clsx("h-2.5 w-2.5 rounded-full", connected ? "bg-mint" : "bg-fault")} title={connected ? "Connected" : "Not connected"} aria-label={connected ? "Connected" : "Not connected"} />
      </div>
    </header>
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
    <div className="fixed inset-x-3 bottom-[170px] z-50 mx-auto max-w-md overflow-hidden rounded-md border border-lightning/60 bg-panel shadow-2xl lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0" role="status">
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="cond text-[22px] uppercase leading-none">Dispatched {pendingUndo.count} units</p>
          <p className="mt-1 text-[13px] text-mute">Work orders are ready on the Teams tab.</p>
        </div>
        <button className="btn !min-h-12 border-frost" onClick={undo}>
          <Undo2 /> Undo
        </button>
      </div>
      <div className="h-1 origin-left bg-lightning" style={{ transform: `scaleX(${left / UNDO_MS})`, transition: "transform 0.2s linear" }} />
    </div>
  );
}

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div className="fixed inset-x-3 top-16 z-50 mx-auto max-w-md rounded-md border border-rule bg-panel2 px-4 py-3 text-[14px] shadow-2xl" role="status">
      {toast}
    </div>
  );
}
