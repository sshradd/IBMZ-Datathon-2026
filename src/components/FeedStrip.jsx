import { useEffect, useState } from "react";
import { useStore } from "../lib/store.jsx";

/** Proof the data is moving: how fresh it is, how fast every county was scored, how much just changed. */
export default function FeedStrip() {
  const { latest, state, history, lastEventAt } = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!latest) return null;
  const live = !!latest.live;
  const running = !!state?.running;
  const age = Math.max(0, Math.round((Date.now() - lastEventAt) / 1000));
  const fresh = live ? age < 130 : running && age < 15;
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  const changed = a && b ? b.counties.reduce((n, r, i) => n + (r[1] !== a.counties[i]?.[1] ? 1 : 0), 0) : null;
  const ms = latest.latency?.p50_ms ? latest.latency.p50_ms * latest.counties.length : null;
  return (
    <div className="feed" role="status">
      <span className={`dot ${fresh ? "dot-green" : "dot-amber"}`} aria-hidden />
      <b>{live ? "Live" : running ? "Streaming" : "Paused"}</b>
      {(live || running) && <span>updated {age} s ago</span>}
      <span>{latest.counties.length} counties scored{ms != null ? ` in ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : ""}</span>
      {changed != null && <span className="hide-s">{changed} changed level this hour</span>}
    </div>
  );
}
