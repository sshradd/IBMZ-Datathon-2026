import { useEffect, useState } from "react";
import { CloudOff, Ellipsis, Map as MapIcon, Package, Pause, Play, Radio, RotateCcw, Undo2, Users, Zap } from "lucide-react";
import { UNDO_MS, useStore } from "../lib/store.jsx";
import { clock, dayClock } from "../lib/format.js";

export const TABS = [
  { path: "/", label: "Outages", icon: MapIcon },
  { path: "/teams", label: "Teams", icon: Users },
  { path: "/resources", label: "Resources", icon: Package },
  { path: "/more", label: "More", icon: Ellipsis },
];

export default function Shell({ path, children }) {
  const active = p => (p === "/" ? path === "/" || path === "/start" : path.startsWith(p));
  return (
    <div className="shell">
      <header className="top">
        <a href="#/" className="brand" aria-label="CATCH, home">
          <span className="logo"><Zap size={20} aria-hidden /></span>
          <b>CATCH</b>
          <span className="tag">Grid Resilience Command</span>
        </a>
        <nav className="tabs" aria-label="Main">
          {TABS.map(({ path: p, label }) => (
            <a key={p} href={`#${p}`} aria-current={active(p) ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <Playback />
      </header>

      <main>{children}</main>

      <nav className="bottom-nav" aria-label="Main">
        {TABS.map(({ path: p, label, icon: Icon }) => (
          <a key={p} href={`#${p}`} aria-current={active(p) ? "page" : undefined}>
            <Icon size={24} aria-hidden />
            {label}
          </a>
        ))}
      </nav>

      <UndoBar />
      <Toast />
    </div>
  );
}

function Playback() {
  const { latest, state, connected, online, queued, pause, resume, start, startDemo, seek } = useStore();
  const live = state?.scenario === "live";
  const n = state?.n ?? 0;
  const i = latest?.i ?? 0;
  const [drag, setDrag] = useState(null);
  useEffect(() => setDrag(null), [i]);
  const shown = drag ?? i;
  const temp = latest?.diagnose.state.temp_f_mean;
  const nws = latest?.alerts?.events.filter(e => e.relevant).length ?? 0;

  const toggle = () => {
    if (!state?.scenario) return startDemo();
    return state.running ? pause() : resume();
  };

  return (
    <div className="playback">
      <button className="icon-btn" onClick={toggle} aria-label={state?.running ? "Pause" : "Play"}>{state?.running ? <Pause size={20} /> : <Play size={20} />}</button>
      <a href="#/start" className="icon-btn" aria-label="Back to the start screen: live or demo data" title="Start screen: live or demo data"><Radio size={20} /></a>
      {state?.scenario && !live && (
        <button className="icon-btn hide-s" onClick={() => start(state.scenario, state.model)} aria-label="Restart demo"><RotateCcw size={20} /></button>
      )}
      <div className="pb-mid">
        {live ? (
          <p className="pb-live"><i className="live-dot" /> Live <span className="mono faint">{latest?.as_of ? clock(latest.as_of) : "waiting for first poll"}</span></p>
        ) : state?.scenario ? (
          <input
            type="range" min={0} max={Math.max(n - 1, 1)} value={shown}
            style={{ "--p": `${n > 1 ? (shown / (n - 1)) * 100 : 0}%` }}
            onChange={e => setDrag(Number(e.target.value))}
            onPointerUp={() => drag != null && seek(drag)}
            onKeyUp={() => drag != null && seek(drag)}
            className="scrub" aria-label="Position in the demo data"
          />
        ) : (
          <p className="muted trunc">Press play to load demo outages</p>
        )}
      </div>
      {!live && latest && <p className="mono pb-clock">{dayClock(latest.t)}</p>}
      {typeof temp === "number" && <p className="pb-temp" title="Statewide mean temperature">{temp.toFixed(0)}°F</p>}
      {nws > 0 && <span className="chip chip-amber hide-s">NWS {nws}</span>}
      {(!online || queued > 0) && (
        <span className="chip chip-amber" title="Changes made offline sync when you reconnect"><CloudOff size={14} aria-hidden />{online ? `${queued} queued` : "offline"}</span>
      )}
      <span className={`dot ${connected ? "dot-green" : ""}`} title={connected ? "Connected" : "Not connected"} aria-label={connected ? "Connected" : "Not connected"} />
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
    <div className="card undo" role="status">
      <div className="undo-in">
        <div>
          <b>Added {pendingUndo.count} {pendingUndo.count === 1 ? "unit" : "units"} to the plan</b>
          <p className="muted sm">Copy or share the plan from the Teams tab. This app does not dispatch.</p>
        </div>
        <button className="btn" onClick={undo}><Undo2 size={18} /> Undo</button>
      </div>
      <div className="undo-bar" style={{ transform: `scaleX(${left / UNDO_MS})` }} />
    </div>
  );
}

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return <div className="card toast" role="status">{toast}</div>;
}
