import type { County, Depot, Unit } from "./types";
import { departBy, mins } from "./format";

/** A shareable work order for a unit that is already out, built from what the server knows. */
export function orderFor(u: Unit, counties: County[], depots: Depot[], now: string): { text: string; maps: string } | null {
  const a = u.assignment;
  if (!a) return null;
  const c = counties.find((x) => x.fips === a.fips);
  const d = depots.find((x) => x.id === u.depot);
  if (!c) return null;
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}`;
  const when = a.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, a.depart_by_min)}`;
  const text =
    `WORK ORDER · ${u.name} (${u.size} workers)\n` +
    `From: ${d?.name ?? u.depot} depot\n` +
    `Go to: ${a.county} County · travel ${mins(a.eta_min)}\n` +
    `When: ${when}\n` +
    `Navigate: ${maps}`;
  return { text, maps };
}
