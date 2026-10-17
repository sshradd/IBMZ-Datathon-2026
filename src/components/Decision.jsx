import { MapPin, X } from "lucide-react";
import Stepper from "./Stepper.jsx";
import { qtyText, total } from "../lib/decisions.js";
import { compact, departBy, mins, pct, TIER_NAMES } from "../lib/format.js";

/** The decision for one county: what is happening, how long a crew takes, and how many crews you add to the plan. */
export default function Decision({ county, index, latest, priority, qty, onQty, available, busy, onSend, onSkip, onClose }) {
  const row = latest.counties[index];
  const tier = TIER_NAMES[row[1]];
  const out = row[2];
  const severe = out >= county.severe_at;
  const alerts = latest.alerts?.by_fips[county.fips] ?? [];
  const now = latest.as_of ?? latest.t;
  const n = priority?.nearest;
  const leaveNow = priority?.depart_by_min === 0;
  const status = severe ? "power out" : tier;
  return (
    <article aria-label={`${county.name} County`} className="decision">
      <div className="dec-top">
        <div>
          <div className="chips">
            {status !== "clear" ? <span className={`chip ${status === "prepare" ? "chip-red-soft" : "chip-red"}`}>{status}</span> : <span className="chip">clear</span>}
            {alerts.map(a => <span key={a} className="chip chip-amber">{a}</span>)}
          </div>
          <h2 className="dec-h">{county.name} County</h2>
        </div>
        {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close county details"><X size={20} /></button>}
      </div>

      <p className="dec-line">
        {priority ? (
          n ? (
            <>{n.depot} crew is <b>{mins(n.eta_min)}</b> away. <span className="accent">{leaveNow ? "Leave now." : `Leave by ${departBy(now, priority.depart_by_min)}.`}</span></>
          ) : (
            <>No line crew is free. <span className="accent">Free one up.</span></>
          )
        ) : (
          <span className="muted">Not on the priority list right now.</span>
        )}
      </p>

      <div className="dec-add">
        <Stepper bare label="Line crews" value={qty.line} max={available.line} onChange={v => onQty({ ...qty, line: v })} />
        <button className="btn primary grow" onClick={onSend} disabled={busy || total(qty) === 0}>
          {total(qty) ? `Add ${total(qty)} to plan` : "Choose how many"}
        </button>
      </div>
      <p className="mono faint sm mt-xs">{available.line} line crews free{total(qty) ? ` · adds ${qtyText(qty)}` : ""}</p>

      <dl className="facts">
        <Fact label="Risk 24 h" value={pct(row[0], 0)} />
        <Fact label={latest.live ? "Out now" : "Customers out"} value={latest.live ? "no feed" : compact(out)} />
        <Fact label="Aged 65+" value={compact(county.pop65)} />
      </dl>

      {priority && priority.reasons.length > 0 && (
        <ul className="reasons">{priority.reasons.slice(0, 2).map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      <div className="rows mt-s">
        <div className="row-pad"><Stepper label="Shelter teams" value={qty.shelter} max={available.shelter} note={`${available.shelter} free`} onChange={v => onQty({ ...qty, shelter: v })} /></div>
        <div className="row-pad"><Stepper label="Outreach teams" value={qty.outreach} max={available.outreach} note={`${available.outreach} free`} onChange={v => onQty({ ...qty, outreach: v })} /></div>
      </div>

      <div className="btn-row">
        <a className="btn sm" href={`https://www.google.com/maps/search/?api=1&query=${county.lat},${county.lon}`} target="_blank" rel="noreferrer"><MapPin size={16} /> Open in Maps</a>
        {onSkip && <button className="btn sm" onClick={onSkip}>Skip for now</button>}
      </div>
    </article>
  );
}

const Fact = ({ label, value }) => (
  <div><dt className="eyebrow">{label}</dt><dd>{value}</dd></div>
);
