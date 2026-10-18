export const DEFAULT_QTY = { line: 1, shelter: 0, outreach: 0 };

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 line crews · 1 shelter team", for what the responder has chosen to include in the plan. */
export function qtyText(q) {
  const parts = [];
  if (q.line) parts.push(plural(q.line, "line crew"));
  if (q.shelter) parts.push(plural(q.shelter, "shelter team"));
  if (q.outreach) parts.push(plural(q.outreach, "outreach team"));
  return parts.join(" · ") || "nothing";
}

export const qtyOf = (m, fips) => m[fips] ?? DEFAULT_QTY;
export const orderOf = (p, m) => ({ fips: p.fips, ...qtyOf(m, p.fips) });
export const total = q => q.line + q.shelter + q.outreach;

/** What the responder wants the list ordered by. The forecast ranks counties; this chooses what counts first. */
export const OBJECTIVES = [
  { id: "impact", label: "Most customers" },
  { id: "seniors", label: "Most seniors" },
  { id: "fast", label: "Closest crew" },
];

/** Reorder the priority list for an objective. "impact" keeps the planner's order; ties keep it too. */
export function rankBy(ps, objective) {
  if (objective === "impact") return ps;
  const idx = new Map(ps.map((p, i) => [p.fips, i]));
  const key = objective === "seniors" ? p => -p.seniors_exposed : p => (p.nearest ? p.nearest.eta_min : Number.POSITIVE_INFINITY);
  return [...ps].sort((a, b) => key(a) - key(b) || idx.get(a.fips) - idx.get(b.fips));
}

// ---------------------------------------------------------------- coverage and timing

export const needsAction = p => p.status === "out" || p.status === "act";
export const inPlan = u => !!u.assignment && (u.status === "en_route" || u.status === "on_site");

/** Counties that need action (power out or rated act), split by whether a crew in the plan is assigned to them. */
export function coverage(priorities, units) {
  const need = priorities.filter(needsAction);
  const has = new Set(units.filter(inPlan).map(u => u.assignment.fips));
  return { need, covered: need.filter(p => has.has(p.fips)), uncovered: need.filter(p => !has.has(p.fips)) };
}

const rad = d => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
/** Planning drive time, the same estimate the server uses: distance, a road factor, slower in the cold. */
export const etaMinutes = (depot, county, cold) => Math.round(((km(depot, county) * 1.3) / 75) * 60 * (cold ? 1.6 : 1));

/**
 * One suggested move: a line crew assigned to a county that no longer needs action, sent instead to the most
 * urgent county that has no crew. Null when there is nothing to move or no one to move.
 */
export function rebalance(priorities, units, depots, counties) {
  const { uncovered } = coverage(priorities, units);
  if (!uncovered.length) return null;
  const to = uncovered[0];
  const tc = counties.find(c => c.fips === to.fips);
  if (!tc) return null;
  const byFips = new Map(priorities.map(p => [p.fips, p]));
  let best = null;
  for (const u of units) {
    if (!inPlan(u) || u.type !== "line") continue;
    const from = byFips.get(u.assignment.fips);
    if (from && needsAction(from)) continue; // that county still needs the crew
    const d = depots.find(x => x.id === u.depot);
    if (!d) continue;
    const eta = etaMinutes(d, tc, to.temp_f <= 34);
    if (!best || eta < best.eta) best = { unit: u, from: u.assignment.county, fromStatus: from?.status ?? "clear", to, eta };
  }
  return best;
}

/** Minutes until a crew in the plan should leave, counted on the data's own clock. 0 means leave now. */
export function leaveInMin(u, assignedAt, nowMs) {
  const a = u.assignment;
  if (!a) return null;
  if (a.depart_by_min === 0) return 0;
  const t0 = assignedAt[u.id];
  if (t0 == null) return a.depart_by_min;
  return Math.max(0, Math.round((t0 + a.depart_by_min * 60000 - nowMs) / 60000));
}
