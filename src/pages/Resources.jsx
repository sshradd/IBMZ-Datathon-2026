import { useEffect, useState } from "react";
import { compact, dayClock } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";

export default function Resources() {
  const s = useStore();
  const { plan, ops, latest } = s;
  if (!ops) return <div className="page"><p className="muted">Loading inventory…</p></div>;
  const inv = plan?.inventory;
  const rows = inv?.items ?? [];
  const below = rows.filter(i => i.status === "short" || i.status === "low");

  return (
    <div className="page wide">
      <header className="page-h">
        <p className="eyebrow">Resources</p>
        <h1>What you have <span className="accent">on hand</span></h1>
        <p className="lede">
          The forecast only covers weather and outages, so it cannot tell you how much material an outage will use. Set the target you want for each item and the page shows where you are below it. Stock numbers are sample data.
        </p>
      </header>

      {inv && (
        <dl className="trio" aria-label="Forecast context">
          <Ctx label="Out now" value={latest?.live ? "no feed" : compact(inv.context.customers_out)} sub="customers" />
          <Ctx label="At risk, next 24 h" value={compact(inv.context.customers_at_risk)} sub="customers in counties likely to go severe" />
          <Ctx label="Seniors at risk" value={compact(inv.context.seniors_at_risk)} sub="residents 65 and older in those counties" />
        </dl>
      )}

      {below.length > 0 && (
        <section className="card below" aria-label="Below target">
          <div>
            <p className="eyebrow red">Below your target</p>
            <p className="below-n">{below.length} {below.length === 1 ? "item" : "items"}</p>
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => s.openDraft({
              eyebrow: "Resupply", title: "Request resupply", key: "resupply",
              text: `Surge resupply request${latest ? ` ${dayClock(latest.as_of ?? latest.t)} CST` : ""}. Below target: ${below.map(i => `${i.label} short ${compact(i.below_by)} ${i.unit}`).join("; ")}. Please confirm quantities and delivery.`,
            })}>Request resupply</button>
          </div>
        </section>
      )}

      <ul className="items">{rows.map(i => <ItemRow key={i.id} i={i} />)}</ul>
    </div>
  );
}

const Ctx = ({ label, value, sub }) => (
  <div><dt className="eyebrow">{label}</dt><dd>{value}</dd><p className="faint sm">{sub}</p></div>
);

function ItemRow({ i }) {
  const s = useStore();
  const tone = i.status === "short" ? "red" : "ink";
  const cov = i.target ? Math.min(1, i.have / i.target) : 1;
  return (
    <li className="item">
      <div className="item-h">
        <h3>{i.label}</h3>
        {i.status ? <span className={`chip ${i.status === "short" ? "chip-red" : i.status === "low" ? "chip-red-soft" : "chip-green"}`}>{i.status === "ok" ? "at target" : i.status}</span> : <span className="chip">no target</span>}
      </div>
      <p className="item-n">
        <span className={i.status === "short" ? "red" : ""}>{compact(i.have)}</span>
        <small>{i.unit} on hand</small>
      </p>
      {i.target != null && (
        <div className="cov" role="img" aria-label={`${Math.round(cov * 100)} percent of target`}>
          <div style={{ width: `${cov * 100}%`, background: tone === "red" ? "var(--red)" : "var(--ink)" }} />
        </div>
      )}
      <label className="target">
        <span className="muted">Your target</span>
        <Num value={i.target ?? null} placeholder="set one" onCommit={v => s.setTarget(i.id, v)} label={`${i.label} target`} />
      </label>
      {i.below_by > 0 && (
        <button className="btn sm" onClick={() => s.openDraft({ eyebrow: "Resupply", title: `Order ${i.label}`, key: "resupply", text: `Surge resupply: ${i.label}, need ${compact(i.below_by)} ${i.unit} (have ${compact(i.have)}, target ${compact(i.target ?? 0)}). Please confirm quantity and delivery.` })}>Order {compact(i.below_by)}</button>
      )}
    </li>
  );
}

/** A number field that saves when you leave it, so typing 1,000 does not fire three updates. Empty clears it. */
function Num({ value, onCommit, label, placeholder }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  const commit = () => {
    if (v === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
    else setV(value == null ? "" : String(value));
  };
  return (
    <input
      aria-label={label} inputMode="numeric" placeholder={placeholder} value={v} className="field"
      onChange={e => setV(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={e => e.key === "Enter" && e.target.blur()}
    />
  );
}
