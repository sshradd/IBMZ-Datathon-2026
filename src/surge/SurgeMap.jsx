import { useMemo } from "react";
import CountyMap from "../components/CountyMap.jsx";
import { useStore } from "../lib/store.jsx";

const LAYER = { Risk: "p24", Exposure: "out", Coverage: "coverage" };

/** The page's map: real county shapes colored by the model, on satellite imagery, with depots and the route to the selected county. */
export default function SurgeMap({ mode, selected, onSelect, cov }) {
  const { latest, counties, tiers, ops, plan } = useStore();
  const focusFips = selected ?? plan?.priorities[0]?.fips ?? null;
  const focus = counties.find(c => c.fips === focusFips);
  const pr = plan?.priorities.find(p => p.fips === focusFips);

  const lines = useMemo(() => {
    const out = [];
    if (pr?.nearest && focus) out.push({ id: `plan-${focus.fips}`, depot: pr.nearest.depot, lat: focus.lat, lon: focus.lon, eta: pr.nearest.eta_min });
    const depotById = new Map((ops?.depots ?? []).map(d => [d.id, d]));
    const byFips = new Map(counties.map(c => [c.fips, c]));
    for (const u of ops?.units ?? []) {
      if (u.status !== "en_route" || !u.assignment) continue;
      const c = byFips.get(u.assignment.fips);
      const d = depotById.get(u.depot);
      if (c && d) out.push({ id: u.id, depot: d.name, lat: c.lat, lon: c.lon, planned: true });
    }
    return out;
  }, [focus, pr, ops, counties]);

  const sets = useMemo(() => ({ covered: new Set(cov.covered.map(p => p.fips)), uncovered: new Set(cov.uncovered.map(p => p.fips)) }), [cov]);

  return (
    <CountyMap
      latest={latest} counties={counties} layer={LAYER[mode] ?? "p24"} tiers={tiers} selected={selected} onSelect={onSelect}
      depots={ops?.depots ?? []} lines={lines} staging={[]} beacon={plan?.priorities[0] ? [plan.priorities[0].fips] : []}
      bottomPad={60} coverageSets={sets}
    />
  );
}
