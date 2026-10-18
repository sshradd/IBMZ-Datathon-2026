import { coverage, inPlan, leaveInMin, needsAction } from "./decisions.js";
import { clock, mins } from "./format.js";

/** A text-sized summary (320 characters at most) for places where only an SMS gets through. */
export function smsSummary(s) {
  const { latest, plan, ops, assignedAt } = s;
  if (!latest || !plan) return "";
  const now = latest.as_of ?? latest.t;
  const act = plan.priorities.filter(needsAction);
  const top = plan.priorities.slice(0, 3).map(p => p.county).join(", ");
  const units = (ops?.units ?? []).filter(inPlan);
  const { uncovered } = coverage(plan.priorities, ops?.units ?? []);
  const nowMs = Date.parse(now);
  const waits = units.map(u => leaveInMin(u, assignedAt, nowMs)).filter(v => v != null);
  const next = waits.length ? Math.min(...waits) : null;
  const text =
    `Relit ${clock(now)}: ${act.length} ${act.length === 1 ? "county needs" : "counties need"} action. Top: ${top || "none"}. ` +
    `${units.length} ${units.length === 1 ? "crew" : "crews"} assigned${uncovered.length ? `, ${uncovered.length} ${uncovered.length === 1 ? "county" : "counties"} without one` : ""}.` +
    (next != null ? ` Next crew ${next === 0 ? "leaves now" : `leaves in ${mins(next)}`}.` : "") +
    " Recommendations only.";
  return text.slice(0, 320);
}
