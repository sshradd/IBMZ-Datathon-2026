// Greedy allocation: rank by harm prevented per crew-hour, take while capacity remains.
export function allocate(actions, { crewsAvailable, crewHourBudget = Infinity }) {
  const ranked = [...actions]
    .map(a => ({ ...a, score: a.harm / a.cost }))
    .sort((a, b) => b.score - a.score);

  let crewsLeft = crewsAvailable, hoursLeft = crewHourBudget;
  const plan = [], skipped = [];
  for (const a of ranked) {
    if (a.crews <= crewsLeft && a.cost <= hoursLeft) {
      crewsLeft -= a.crews; hoursLeft -= a.cost; plan.push(a);
    } else skipped.push(a);
  }
  return { plan, skipped, crewsCommitted: crewsAvailable - crewsLeft, crewsLeft };
}
export const slotLabel = i => (i === 0 ? "NOW" : `+${i * 15}M`);
