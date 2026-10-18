import { coverage, orderOf, rebalance } from "../lib/decisions.js";
import { mins } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";

/** Who needs a crew and has none, with one tap to assign them, and a move when a crew is no longer needed where it is. */
export default function Coverage() {
  const s = useStore();
  const { plan, ops, counties, qty } = s;
  if (!plan || !ops) return null;
  const { need, covered, uncovered } = coverage(plan.priorities, ops.units);
  if (!need.length) return null;
  const free = plan.totals.line.available;
  const move = rebalance(plan.priorities, ops.units, ops.depots, counties);
  const batch = uncovered.slice(0, Math.min(5, Math.max(free, 0)));
  const pctCovered = Math.round((covered.length / need.length) * 100);

  const assignUncovered = () => s.openAssign(batch.map(p => orderOf(p, qty)).filter(o => o.line + o.shelter + o.outreach > 0));
  const review = async () => {
    await s.setUnitStatus(move.unit.id, "available");
    s.openAssign([{ fips: move.to.fips, line: 1, shelter: 0, outreach: 0 }]);
  };

  return (
    <section aria-label="Crew coverage" className="cover">
      <p className="cover-line">
        <b>{covered.length}</b> of {need.length} counties needing action have a crew
        {uncovered.length > 0 && <> · <b className="red">{uncovered.length} without</b></>}
      </p>
      {uncovered.length > 0 && (
        free > 0 ? (
          <button className="btn primary block-btn" onClick={assignUncovered}>Assign the {batch.length} most urgent</button>
        ) : (
          <p className="muted sm mt-s">No line crews are free. Remove a crew from a lower-priority county, or ask for mutual aid.</p>
        )
      )}
      {move && (
        <div className="rebal">
          <p className="sm">
            Move <b>{move.unit.name}</b> from {move.from} ({move.fromStatus}) to <b>{move.to.county}</b> ({move.to.status}, no crew) · about {mins(move.eta)}
          </p>
          <button className="btn sm" onClick={review}>Review move</button>
        </div>
      )}
    </section>
  );
}
