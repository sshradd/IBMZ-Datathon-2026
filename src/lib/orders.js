import { departBy, mins } from "./format.js";

/** A shareable recommendation for a unit that is in the plan, built from what the server knows. */
export function orderFor(u, counties, depots, now) {
  const a = u.assignment;
  if (!a) return null;
  const c = counties.find(x => x.fips === a.fips);
  const d = depots.find(x => x.id === u.depot);
  if (!c) return null;
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}`;
  const when = a.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, a.depart_by_min)}`;
  const text =
    `RECOMMENDATION · ${u.name} (${u.size} workers)\n` +
    `From: ${d?.name ?? u.depot} depot\n` +
    `Suggested: ${a.county} County · travel ${mins(a.eta_min)}\n` +
    `When: ${when}\n` +
    `Navigate: ${maps}`;
  return { text, maps };
}
