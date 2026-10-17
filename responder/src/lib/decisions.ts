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
