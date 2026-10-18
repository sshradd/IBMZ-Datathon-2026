import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_QTY } from "../lib/decisions.js";
import { mins } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";

/**
 * Says so the moment a county changes while you are looking: it just went to act, or it just lost power.
 * One tap opens Assign for it. Seeking, restarting or the first data after loading never raise one.
 */
export default function AlertBanner() {
  const s = useStore();
  const prev = useRef(null);
  const timer = useRef(0);
  const [items, setItems] = useState([]);

  useEffect(() => {
    const cur = s.latest;
    const p = prev.current;
    prev.current = cur;
    if (!cur || cur.live || !p || cur.i < p.i || cur.i - p.i > 3) return;
    const found = [];
    s.counties.forEach((c, idx) => {
      const a = p.counties[idx];
      const b = cur.counties[idx];
      if (!a || !b) return;
      const sevB = b[2] >= c.severe_at;
      const sevA = a[2] >= c.severe_at;
      if (sevB && !sevA) found.push({ fips: c.fips, name: c.name, kind: "lost power" });
      else if (b[1] === 3 && a[1] < 3 && !sevB) found.push({ fips: c.fips, name: c.name, kind: "went to act" });
    });
    if (!found.length) return;
    const order = new Map((s.plan?.priorities ?? []).map((q, i) => [q.fips, i]));
    found.sort((x, y) => (order.get(x.fips) ?? 999) - (order.get(y.fips) ?? 999));
    setItems(found);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setItems([]), 25000);
  }, [s.latest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!items.length || s.assign) return null;

  const first = items[0];
  const p = s.plan?.priorities.find(x => x.fips === first.fips);
  const many = items.length > 1;
  const assign = () => {
    s.openAssign(items.slice(0, 3).map(i => ({ fips: i.fips, ...DEFAULT_QTY })));
    setItems([]);
  };
  return (
    <div className="card alert" role="alert">
      <div className="alert-in">
        <span className="dot" aria-hidden />
        <div className="grow">
          <b>{many ? `${items.length} counties just changed` : `${first.name} just ${first.kind}`}</b>
          <p className="muted sm">
            {many
              ? items.slice(0, 3).map(i => `${i.name} (${i.kind === "lost power" ? "out" : "act"})`).join(", ") + (items.length > 3 ? "…" : "")
              : p?.nearest ? `${p.nearest.depot} crew is ${mins(p.nearest.eta_min)} away` : "No crew is free"}
          </p>
        </div>
        <button className="btn primary sm" onClick={assign}>{many ? `Assign ${Math.min(3, items.length)}` : "Assign"}</button>
        <button className="icon-btn" onClick={() => setItems([])} aria-label="Dismiss"><X size={18} /></button>
      </div>
    </div>
  );
}
