import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { compact, fmtTime, pct, postJSON, type Plan } from "../api";
import type { Ctx } from "../App";
import { Empty, Kpi, Lens, MoveCard, Panel, TierChip } from "./ui";

const LEVERS: { key: "crews" | "centers" | "callers"; name: string; sub: string; max: number }[] = [
  { key: "crews", name: "Line crews", sub: "restore where it is dark, pre-position where it is likely next", max: 120 },
  { key: "centers", name: "Warming or cooling centers", sub: "where it is freezing or scorching and seniors are exposed", max: 60 },
  { key: "callers", name: "Outreach call teams", sub: "senior and medical-need customers, county by county", max: 100 },
];

export default function Prescribe({ replay, decisions, decide }: Ctx) {
  const { latest } = replay;
  const base = latest?.prescribe ?? null;
  const [res, setRes] = useState({ crews: 40, centers: 15, callers: 25 });
  const [plan, setPlan] = useState<Plan | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // The hourly stream carries the default plan. Moving a lever re-runs the planner on the current hour.
  useEffect(() => {
    if (!latest) return;
    const isDefault = res.crews === 40 && res.centers === 15 && res.callers === 25;
    if (isDefault) {
      setPlan(null);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      postJSON<Plan>("/api/plan", res)
        .then(setPlan)
        .catch(() => {});
    }, 120);
    return () => window.clearTimeout(timer.current);
  }, [res, latest?.i]);

  const shown = plan ?? base;
  if (!latest || !shown) {
    return (
      <div className="space-y-5">
        <Header />
        <Empty>Start the storm replay to get live recommendations.</Empty>
      </div>
    );
  }

  const moves = shown.moves;
  const approved = moves.filter((m) => decisions[m.id] === "approved");

  const exportPlan = () => {
    const lines = [
      `# Uri Watch action plan · ${fmtTime(latest.t)}`,
      "",
      `Resources: ${shown.resources.crews} crews, ${shown.resources.centers} centers, ${shown.resources.callers} call teams.`,
      "",
      "## Approved moves",
      ...(approved.length ? approved.map((m, i) => `${i + 1}. **${m.title}** (${m.window}). ${m.detail}`) : ["None approved yet."]),
      "",
      "## Deployments",
      ...shown.deployments.map(
        (d) => `- ${d.name}: ${d.crews} crews, ${d.centers} ${d.center_kind} centers, ${d.callers} call teams (${d.status}, ${pct(d.risk, 1)} risk, ${d.window})`,
      ),
      "",
      "Suggestions from a forecast model. Review before acting.",
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "uri-watch-action-plan.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Header />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="panel-title">Ranked moves</h3>
            <button className="btn btn--ghost btn--sm" onClick={exportPlan}>
              <Download /> Export plan ({approved.length} approved)
            </button>
          </div>
          {moves.length === 0 ? (
            <Empty>No moves right now.</Empty>
          ) : (
            moves.map((m, i) => <MoveCard key={m.id} move={m} index={i} state={decisions[m.id]} onDecide={decide} />)
          )}
        </div>

        <div className="space-y-5">
          <Panel title="Resource planner" note="what-if levers">
            {LEVERS.map((l) => (
              <div className="lever" key={l.key}>
                <div className="l-head">
                  <span className="l-name">{l.name}</span>
                  <span className="l-val">{res[l.key]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={l.max}
                  value={res[l.key]}
                  style={{ ["--p" as string]: `${(res[l.key] / l.max) * 100}%` }}
                  onChange={(e) => setRes({ ...res, [l.key]: Number(e.target.value) })}
                  aria-label={l.name}
                />
                <p className="l-sub">{l.sub}</p>
                <div className="mt-2 flex items-center gap-3 text-[11.5px]">
                  <span className="mono text-mut">
                    plan covers <b className="text-fg">{pct(shown.coverage[l.key])}</b> of need
                  </span>
                  <span className="mono text-dim">vs {pct(shown.naive_coverage[l.key])} by population alone</span>
                </div>
              </div>
            ))}
            <p className="mt-2 text-[11.5px] leading-snug text-dim">{shown.objective}</p>
          </Panel>

          <Panel title="Diminishing returns on crews" note="coverage vs. crews">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={shown.curve} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                <XAxis dataKey="crews" tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
                <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: "var(--mut)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 }}
                  formatter={(v) => [pct(Number(v)), "need covered"]}
                  labelFormatter={(c) => `${c} crews`}
                />
                <Area dataKey="coverage" stroke="var(--signal)" fill="var(--signal)" fillOpacity={0.16} strokeWidth={2} isAnimationActive={false} />
                <ReferenceDot x={nearest(shown.curve, shown.resources.crews)} y={shown.coverage.crews} r={5} fill="var(--signal)" stroke="var(--card)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[11.5px] leading-snug text-dim">
              The first crews matter most. The curve flattens as coverage nears 100%, so beyond that point resources are better spent on centers and outreach.
            </p>
          </Panel>
        </div>
      </div>

      <Panel title="Where everything goes" note={`${shown.deployments.length} counties`}>
        <div className="overflow-x-auto scroll-thin">
          <table className="tbl">
            <thead>
              <tr>
                <th>County</th>
                <th>Status</th>
                <th className="num">Crews</th>
                <th className="num">Centers</th>
                <th className="num">Call teams</th>
                <th className="num">24 h risk</th>
                <th>Window</th>
                <th className="num">Seniors exposed</th>
              </tr>
            </thead>
            <tbody>
              {shown.deployments.map((d) => (
                <tr key={d.fips}>
                  <td>{d.name}</td>
                  <td>
                    <TierChip tier={d.status === "out" ? "out" : d.status} />
                  </td>
                  <td className="num text-fg">{d.crews || "·"}</td>
                  <td className="num text-fg">{d.centers ? `${d.centers} ${d.center_kind}` : "·"}</td>
                  <td className="num text-fg">{d.callers || "·"}</td>
                  <td className="num">{pct(d.risk, 1)}</td>
                  <td className="mono text-[11.5px]">{d.window}</td>
                  <td className="num">{compact(d.seniors_exposed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi label="Crew coverage" value={pct(shown.coverage.crews)} sub={`${pct(shown.naive_coverage.crews)} if spread by population`} tone="gain" />
        <Kpi label="Center coverage" value={pct(shown.coverage.centers)} sub={`${pct(shown.naive_coverage.centers)} if spread by population`} tone="gain" />
        <Kpi label="Outreach coverage" value={pct(shown.coverage.callers)} sub={`${pct(shown.naive_coverage.callers)} if spread by population`} tone="gain" />
      </div>
    </div>
  );
}

function nearest(curve: { crews: number }[], v: number): number {
  return curve.reduce((a, b) => (Math.abs(b.crews - v) < Math.abs(a.crews - v) ? b : a), curve[0]).crews;
}

function Header() {
  return (
    <div>
      <Lens n="03" name="Prescribe" question="what should we do about it?" />
      <h2 className="mt-2 text-[26px]">Recommended moves and where to send resources</h2>
      <p className="mt-2 max-w-3xl text-[14px] text-mut">
        The forecast says where outages are likely. This view turns it into moves. Resources go where the most vulnerable people are exposed, with seniors
        counted twice, and each move shows how often alerts like it came true in storms the model never saw. The planner suggests, you decide.
      </p>
    </div>
  );
}
