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
