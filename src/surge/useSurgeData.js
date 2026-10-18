import { useMemo } from "react";
import { coverage, inPlan } from "../lib/decisions.js";
import { clock } from "../lib/format.js";
import { ROSTER } from "../lib/roster.js";
import { useStore } from "../lib/store.jsx";

/**
 * A 0 to 100 risk index placed on the model's own alert lines, so it matches the map legend:
 * the watch line is 50, prepare is 65, act is 80, and a county that is already out is 100.
 */
export function riskIndex(p, tiers, severe) {
  if (severe) return 100;
  if (!tiers) return Math.min(100, Math.round(p * 1000));
  const { watch, prepare, act } = tiers;
  let v;
  if (p >= act) v = 80 + 20 * Math.min(1, (p - act) / act);
  else if (p >= prepare) v = 65 + (15 * (p - prepare)) / (act - prepare);
  else if (p >= watch) v = 50 + (15 * (p - watch)) / (prepare - watch);
  else v = (50 * p) / watch;
  return Math.round(v);
}

export const riskColor = r => (r >= 80 ? "#ff4d5e" : r >= 65 ? "#ff8a3d" : r >= 50 ? "#ffc233" : "#3ed1a8");

/** Everything the SURGE page shows, built from the live (or recorded) feed: same shapes the page was designed with. */
export function useSurgeData() {
  const s = useStore();
  const { latest, plan, counties, ops, tiers, history } = s;

  return useMemo(() => {
    if (!latest || !plan || !counties.length) return null;
    const idx = new Map(counties.map((c, i) => [c.fips, i]));
    const prev = history.length > 3 ? history[history.length - 4] : history[0];
    const now = latest.as_of ?? latest.t;

    const people = p => (p.status === "out" ? Math.round(p.out * 2.6) : Math.round(p.risk * p.pop));
    const list = plan.priorities.slice(0, 8).map(p => {
      const i = idx.get(p.fips);
      const c = counties[i];
      const nowIdx = riskIndex(p.risk, tiers, p.status === "out");
      let delta = 0;
      if (prev && prev !== history[history.length - 1] && c) {
        const row = prev.counties[i];
        if (row) delta = nowIdx - riskIndex(row[0], tiers, row[2] >= c.severe_at);
      }
      return { id: p.fips, fips: p.fips, name: p.county, risk: nowIdx, delta, exposure: people(p), seniors: p.seniors_exposed, eta: p.nearest?.eta_min ?? null, depot: p.nearest?.depot ?? null, status: p.status, out: p.out };
    });

    // a quiet day flags few counties; still show the eight highest-risk ones so the ranking never looks empty
    if (list.length < 8) {
      const have = new Set(list.map(c => c.fips));
      counties
        .map((c, i) => ({ c, row: latest.counties[i] }))
        .filter(({ c, row }) => row && !have.has(c.fips))
        .sort((a, b) => b.row[0] - a.row[0])
        .slice(0, 8 - list.length)
        .forEach(({ c, row }) => {
          let delta = 0;
          const old = prev?.counties[idx.get(c.fips)];
          if (old && prev !== history[history.length - 1]) delta = riskIndex(row[0], tiers, row[2] >= c.severe_at) - riskIndex(old[0], tiers, old[2] >= c.severe_at);
          list.push({ id: c.fips, fips: c.fips, name: c.name, risk: riskIndex(row[0], tiers, row[2] >= c.severe_at), delta, exposure: Math.round(row[0] * c.pop), seniors: Math.round(row[0] * c.pop65), eta: null, depot: null, status: "clear", out: row[2] });
        });
    }

    const actions = plan.priorities.slice(0, 6).map(p => ({
      id: p.fips, kind: "crew", fips: p.fips, county: p.county, status: p.status,
      title: p.nearest ? `Send ${p.nearest.depot} crew to ${p.county}` : `Free a crew for ${p.county}`,
      where: p.nearest ? `${p.nearest.depot} depot · ${p.nearest.eta_min} min ETA` : "No crew is free right now",
      people: people(p), seniors: p.seniors_exposed, eta: p.nearest?.eta_min ?? null, leave: p.depart_by_min,
    }));

    const [, watchN, prepareN, actN] = latest.tier_counts;
    const sc = latest.describe.scorecard;
    const units = ops?.units ?? [];
    const st = latest.diagnose.state;
    const nws = (latest.alerts?.events ?? []).filter(e => e.relevant).length;
    const summary = {
      status: actN > 0 ? `${actN} ${actN === 1 ? "county" : "counties"} rated act` : prepareN > 0 ? `${prepareN} rated prepare` : watchN > 0 ? `${watchN} on watch` : "No county rated watch or higher",
      note: latest.live ? "Live weather and grid data. Live mode has no county outage feed." : `Peak window ${latest.predict.peak_window}. ${Math.round(latest.out_total / 1000)}K customers out now.`,
      updated: clock(now),
      warned: !latest.live && sc?.warned_pct != null ? Math.round(sc.warned_pct) : null,
      peopleExposed: latest.predict.people_exposed,
      customersOut: latest.out_total,
      seniors: latest.predict.seniors_exposed,
      flagged: actN + prepareN + watchN, act: actN, elevated: prepareN + watchN,
      crewsTotal: plan.totals.line.total, crewsAvailable: plan.totals.line.available, crewsInPlan: units.filter(inPlan).length,
    };
    const weather = [
      { key: "temp", n: `${Math.round(st.temp_f_mean)}°F`, label: "Statewide temperature", sub: st.temp_f_mean <= 32 ? "At or below freezing" : "Above freezing" },
      { key: "demand", n: `${st.demand_norm >= 0 ? "+" : ""}${Math.round(st.demand_norm * 100)}%`, label: "Grid demand vs norm", sub: "against its two-week average" },
      { key: "shed", n: `${st.fc_err >= 0 ? "+" : ""}${Math.round(st.fc_err * 100)}%`, label: "Demand vs ERCOT forecast", sub: st.fc_err < -0.12 ? "Load is being shed" : "No load shedding signal" },
      { key: "nws", n: nws, label: "Weather service alerts", sub: nws ? "relevant to the grid" : "none relevant to the grid" },
    ];
    return { counties: list, actions, summary, weather, people: ROSTER, cov: coverage(plan.priorities, units), now, live: !!latest.live };
  }, [latest, plan, counties, ops, tiers, history]);
}
