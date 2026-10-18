import { coverage, inPlan, leaveInMin, needsAction } from "../lib/decisions.js";
import { smsSummary } from "../lib/brief.js";
import { clock, compact, dayClock, mins, pct } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";

/** A one-page paper brief for when nothing else works. Hidden on screen, shown only when printing. */
export default function PrintBrief() {
  const s = useStore();
  const { latest, plan, ops, assignedAt } = s;
  if (!latest || !plan) return null;
  const now = latest.as_of ?? latest.t;
  const nowMs = Date.parse(now);
  const units = (ops?.units ?? []).filter(inPlan);
  const { need, uncovered } = coverage(plan.priorities, ops?.units ?? []);
  const short = (plan.inventory?.items ?? []).filter(i => i.status === "short" || i.status === "low");
  const leave = p => (p.depart_by_min === 0 ? "leave now" : `leave in ${mins(p.depart_by_min)}`);
  return (
    <section className="print-brief" aria-hidden>
      <h1>Surge field brief</h1>
      <p>{dayClock(now)} CST · {need.length} counties need action · {latest.live ? "live data" : `${compact(latest.out_total)} customers out`} · recommendations only, nothing was dispatched.</p>

      <h2>Priority counties</h2>
      <table>
        <thead><tr><th>County</th><th>Level</th><th>Now</th><th>Crew</th><th>Drive</th><th>When</th></tr></thead>
        <tbody>
          {plan.priorities.slice(0, 10).map(p => (
            <tr key={p.fips}>
              <td>{p.county}</td>
              <td>{p.status}</td>
              <td>{p.status === "out" ? `${compact(p.out)} out` : pct(p.risk, 0)}</td>
              <td>{p.nearest?.depot ?? "none free"}</td>
              <td>{p.nearest ? mins(p.nearest.eta_min) : ""}</td>
              <td>{leave(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Crews in the plan ({units.length})</h2>
      {units.length ? (
        <ul>
          {units.map(u => {
            const left = leaveInMin(u, assignedAt, nowMs);
            return <li key={u.id}>{u.name} to {u.assignment.county} County, travel {mins(u.assignment.eta_min)}, {left === 0 ? "leave now" : `leaves in ${mins(left)}`}</li>;
          })}
        </ul>
      ) : <p>None yet.</p>}

      {uncovered.length > 0 && (<><h2>Counties needing action with no crew ({uncovered.length})</h2><p>{uncovered.map(p => p.county).join(", ")}</p></>)}
      {short.length > 0 && (<><h2>Inventory below target</h2><ul>{short.map(i => <li key={i.id}>{i.label}: have {compact(i.have)}, short by {compact(i.below_by)} {i.unit}</li>)}</ul></>)}

      <h2>Text version</h2>
      <p className="mono">{smsSummary(s)}</p>
      <p className="foot">Printed {clock(now)} on the data clock. Crews, depots and inventory are sample data unless edited. Travel times are planning estimates, not routing.</p>
    </section>
  );
}
