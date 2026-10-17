export const n0 = n => Math.round(n).toLocaleString("en-US");
export const pct = (x, d = 0) => (x >= 0.995 ? ">99%" : `${(x * 100).toFixed(d)}%`);

export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

const CST = 6 * 3600 * 1000; // Texans lived these storms in central standard time

export function clock(iso) {
  const ct = new Date(new Date(iso).getTime() - CST);
  const hh = ct.getUTCHours();
  return `${hh % 12 || 12}:${String(ct.getUTCMinutes()).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}

export function dayClock(iso) {
  const ct = new Date(new Date(iso).getTime() - CST);
  const mo = ct.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${mo} ${ct.getUTCDate()} · ${clock(iso)}`;
}

/** 94 -> "1 h 34 min", 40 -> "40 min" */
export function mins(m) {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** The clock time to leave by, given the storm clock `t` and minutes from now. */
export function departBy(t, minutesFromNow) {
  return clock(new Date(new Date(t).getTime() + minutesFromNow * 60000).toISOString());
}

export const TIER_NAMES = ["clear", "watch", "prepare", "act"];
