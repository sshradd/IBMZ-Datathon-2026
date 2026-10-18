import { useEffect, useState } from "react";
import { CloudOff, Ellipsis, Map as MapIcon, Package, Undo2, Users, Zap } from "lucide-react";
import { UNDO_MS, useStore } from "../lib/store.jsx";
import { clock } from "../lib/format.js";
import AssignSheet from "./AssignSheet.jsx";
import TextCrew from "./TextCrew.jsx";

export const TABS = [
  { path: "/", label: "Outages", icon: MapIcon },
  { path: "/teams", label: "Teams", icon: Users },
  { path: "/resources", label: "Resources", icon: Package },
  { path: "/more", label: "More", icon: Ellipsis },
];

export default function Shell({ path, children }) {
  const active = p => (p === "/" ? path === "/" : path.startsWith(p));
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
      <TextCrew />
      <AssignSheet />
    </div>
  );
}

/** What the data is right now: live or recorded, the statewide temperature, weather alerts, connection. No controls. */
function Playback() {
  const { latest, state, connected, online, queued } = useStore();
  const live = state?.scenario === "live";
  const temp = latest?.diagnose.state.temp_f_mean;
  const nws = latest?.alerts?.events.filter(e => e.relevant).length ?? 0;

  return (
    <div className="playback">
      <div className="pb-mid">
        {live ? (
          <p className="pb-live"><i className="live-dot" /> Live <span className="mono faint">{latest?.as_of ? clock(latest.as_of) : "waiting for first poll"}</span></p>
        ) : null}
      </div>
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
  const { pendingUndo, undo, assign } = useStore();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!pendingUndo) return;
    const tick = () => setLeft(Math.max(0, pendingUndo.until - Date.now()));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [pendingUndo]);
  if (!pendingUndo || assign) return null;
  return (
    <div className="card undo" role="status">
      <div className="undo-in">
        <div>
          <b>Assigned {pendingUndo.count} {pendingUndo.count === 1 ? "crew" : "crews"}</b>
          <p className="muted sm">This app only recommends.</p>
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
