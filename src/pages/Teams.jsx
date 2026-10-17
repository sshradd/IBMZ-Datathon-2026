import { Copy, MapPin, Plus, Share2, Undo2 } from "lucide-react";
import { useState } from "react";
import Stepper from "../components/Stepper.jsx";
import { orderOf, qtyOf, total } from "../lib/decisions.js";
import { compact, dayClock, departBy, mins, pct } from "../lib/format.js";
import { orderFor } from "../lib/orders.js";
import { copyText, shareText } from "../lib/share.js";
import { useStore } from "../lib/store.jsx";

const TYPE_LABEL = { line: "Line crews", shelter: "Shelter teams", outreach: "Outreach teams" };

export default function Teams() {
  const s = useStore();
  const { plan, ops, latest, qty, setQty } = s;
  const [busy, setBusy] = useState(false);
  const now = latest?.as_of ?? latest?.t ?? "";

  const addToPlan = async ps => {
    setBusy(true);
    try {
      await s.dispatch(ps.map(p => orderOf(p, qty)).filter(o => o.line + o.shelter + o.outreach > 0));
    } finally {
      setBusy(false);
    }
  };

  if (!ops) return <div className="page"><p className="muted">Loading crews…</p></div>;
  const out = ops.units.filter(u => u.status === "en_route" || u.status === "on_site");
  const tot = plan?.totals;
  const planText =
    `RECOMMENDED PLAN · Texas power outage response${latest ? ` · ${dayClock(latest.as_of ?? latest.t)} CST` : ""}\n\n` +
    out.map(u => orderFor(u, s.counties, ops.depots, now)?.text ?? "").filter(Boolean).join("\n\n") +
    "\n\nRecommendations only. Nothing was dispatched by this app.";
  const list = plan?.priorities.slice(0, 25) ?? [];

  return (
    <div className="page wide">
      <header className="page-h">
        <p className="eyebrow">Teams</p>
        <h1>The <span className="accent">plan</span></h1>
        <p className="lede">
          Counties are ranked from weather and outage data. For each one the app recommends the nearest free crew and shows the drive time. You choose how many crews to add to the plan, then copy or share it. This app recommends only: your own dispatch system sends the crews. Crews and depots are sample data.
        </p>
      </header>

      <dl className="trio">
        {["line", "shelter", "outreach"].map(t => (
          <div key={t}>
            <dt className="eyebrow">{TYPE_LABEL[t]}</dt>
            <dd>{tot ? tot[t].available : "—"}<span> free</span></dd>
            <p className="mono faint sm">{tot ? `${tot[t].en_route + tot[t].on_site} in plan · ${tot[t].total} in all` : "no forecast yet"}</p>
          </div>
        ))}
      </dl>

      <div className="two-col">
        <section aria-label="Priority counties">
          <div className="sec-h">
            <h2 className="eyebrow">Priority counties · {list.length}</h2>
            <button className="btn sm" onClick={() => addToPlan(list.slice(0, 5))} disabled={busy || !list.length} title="Adds what is set on each of the top five rows to the plan"><Plus size={16} /> Add top 5 to plan</button>
          </div>
          {!list.length && <p className="muted py">{latest ? "No county is rated watch or higher right now." : "Go live or load demo outages to see the ranking."}</p>}
          <ul className="rows">
            {list.map(p => {
              const q = qtyOf(qty, p.fips);
              return (
                <li key={p.fips} className="pri-row">
                  <div className="pri-main">
                    <p className="pri-name">
                      <b>{p.county}</b>
                      <span className={`chip ${p.status === "out" || p.status === "act" ? "chip-red" : p.status === "prepare" ? "chip-red-soft" : ""}`}>{p.status === "out" ? "power out" : p.status}</span>
                    </p>
                    <p className="muted sm">{p.status === "out" ? `${compact(p.out)} customers out` : `${pct(p.risk, 0)} risk, ${p.window}`} · {compact(p.seniors_exposed)} seniors</p>
                    <p className="faint sm">
                      {p.nearest ? `nearest ${p.nearest.depot}, drive ${mins(p.nearest.eta_min)}` : "no crew free"} · {p.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, p.depart_by_min)}`}
                    </p>
                  </div>
                  <div className="pri-act">
                    <Stepper bare label="Line crews" value={q.line} onChange={n => setQty(p.fips, { ...q, line: n })} max={tot?.line.available ?? 0} />
                    <button className="btn primary grow" onClick={() => addToPlan([p])} disabled={busy || total(q) === 0}>Add {total(q) || ""}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="stack">
          <section aria-label="Recommended plan">
            <div className="sec-h">
              <h2 className="eyebrow">Recommended plan · {out.length}</h2>
              {out.length > 0 && (
                <>
                  <button className="btn sm" onClick={async () => s.say((await copyText(planText)) ? "Plan copied" : "Could not copy")}><Copy size={16} /> Copy plan</button>
                  <button className="btn sm" onClick={() => shareText("Recommended plan", planText, s.say)}><Share2 size={16} /> Share</button>
                </>
              )}
            </div>
            {out.length === 0 ? (
              <p className="muted py">Nothing in the plan yet. Add crews from the list and they appear here as recommendations you can copy or share.</p>
            ) : (
              <ul className="rows">{out.map(u => <FieldRow key={u.id} u={u} now={now} />)}</ul>
            )}
          </section>

          {plan && plan.staging.sites.length > 0 && (
            <section aria-label="Staging advisor">
              <h2 className="eyebrow">Where to stage</h2>
              <p className="muted mt-xs">Forward yards that cut the average drive to the highest-priority counties, from {mins(plan.staging.baseline_eta_min ?? 0)} today.</p>
              <ol className="rows">
                {plan.staging.sites.map((st, i) => (
                  <li key={st.name} className="stage-row">
                    <span className="rank">{i + 1}</span>
                    <div><b>{st.name}</b><p className="muted sm">average drive {mins(st.avg_eta_min)}</p></div>
                    <span className="chip chip-green">−{st.saves_min} min</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

        </div>
      </div>

      <section className="sec-gap" aria-label="Roster">
        <h2 className="eyebrow">Roster by depot</h2>
        <p className="muted mt-xs">Tap + or − to change how many units a depot has. Units already in the plan stay in it.</p>
        <div className="depots">
          {ops.depots.map(d => (
            <div key={d.id} className="depot">
              <h3>{d.name}</h3>
              <div className="stack-s">
                {["line", "shelter", "outreach"].map(t => (
                  <Stepper key={t} label={TYPE_LABEL[t]} value={d.units[t]} note={`${d.available[t]} free`} onChange={n => s.setUnitCount(d.id, t, n)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FieldRow({ u, now }) {
  const s = useStore();
  const o = s.ops ? orderFor(u, s.counties, s.ops.depots, now) : null;
  const a = u.assignment;
  return (
    <li className="field-row">
      <div className="field-top">
        <p><b>{u.name}</b> <span className="faint">→ {a?.county}</span></p>
        <span className="chip">{a ? (a.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, a.depart_by_min)}`) : "planned"}</span>
      </div>
      <div className="btn-row">
        <button className="btn sm" onClick={() => s.setUnitStatus(u.id, "available")}><Undo2 size={16} /> Remove from plan</button>
        {o && (
          <>
            <button className="btn sm" onClick={async () => s.say((await copyText(o.text)) ? "Recommendation copied" : "Could not copy")}><Copy size={16} /> Copy</button>
            <button className="btn sm" onClick={() => shareText(`Recommendation ${u.name}`, o.text, s.say)}><Share2 size={16} /> Share</button>
            <a className="btn sm" href={o.maps} target="_blank" rel="noreferrer"><MapPin size={16} /> Navigate</a>
          </>
        )}
      </div>
    </li>
  );
}
