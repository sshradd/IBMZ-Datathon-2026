import type { Order, Priority } from "./types";
import type { Qty } from "./store";
import { DEFAULT_QTY } from "./store";

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 line crews · 1 shelter team", for what the responder has chosen to include in the plan. */
export function qtyText(q: Qty): string {
  const parts = [];
  if (q.line) parts.push(plural(q.line, "line crew"));
  if (q.shelter) parts.push(plural(q.shelter, "shelter team"));
  if (q.outreach) parts.push(plural(q.outreach, "outreach team"));
  return parts.join(" · ") || "nothing";
}

export const qtyOf = (m: Record<string, Qty>, fips: string): Qty => m[fips] ?? DEFAULT_QTY;
export const orderOf = (p: Priority, m: Record<string, Qty>): Order => ({ fips: p.fips, ...qtyOf(m, p.fips) });
export const total = (q: Qty) => q.line + q.shelter + q.outreach;

/** What the responder wants the list ordered by. The forecast ranks counties; this chooses what counts first. */
export type Objective = "impact" | "seniors" | "fast";
export const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: "impact", label: "Most customers" },
  { id: "seniors", label: "Most seniors" },
  { id: "fast", label: "Closest crew" },
];

/** Reorder the priority list for an objective. "impact" keeps the planner's order; ties keep it too. */
export function rankBy(ps: Priority[], o: Objective): Priority[] {
  if (o === "impact") return ps;
  const idx = new Map(ps.map((p, i) => [p.fips, i]));
  const key = o === "seniors" ? (p: Priority) => -p.seniors_exposed : (p: Priority) => (p.nearest ? p.nearest.eta_min : Number.POSITIVE_INFINITY);
  return [...ps].sort((a, b) => key(a) - key(b) || idx.get(a.fips)! - idx.get(b.fips)!);
}
