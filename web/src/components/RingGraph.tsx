import { money, usePoll, type GraphEdge, type GraphNode } from "../api";

const EDGE_COLOR = { allow: "var(--mut)", step_up: "var(--warn)", hold: "var(--loss)" } as const;
const W = 1000;
const COLS = 4;
const CELL_H = 230;
const R = 78;

/** Candidate mule rings: young accounts receiving money from many people. */
export default function RingGraph() {
  const data = usePoll<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/api/graph", 2000);
  const receivers = data?.nodes.filter((n) => n.kind === "receiver") ?? [];
  const seniors = new Set(data?.nodes.filter((n) => n.senior).map((n) => n.id));
  const rows = Math.max(1, Math.ceil(receivers.length / COLS));
  const cellW = W / COLS;

  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="eyebrow">Mule-ring radar</h2>
        <p className="text-[12px] text-mut">
          New accounts (&lt;90 days) receiving from 3+ people. Red lines = held, amber = sent to verify, gold ring = 65+.
        </p>
      </div>
      {!receivers.length ? (
        <p className="py-10 text-center text-mut">No suspicious fan-in yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${rows * CELL_H}`} className="w-full" role="img" aria-label="Candidate mule rings">
          {receivers.map((rcv, i) => {
            const cx = cellW * (i % COLS) + cellW / 2;
            const cy = CELL_H * Math.floor(i / COLS) + CELL_H / 2 - 10;
            const edges = data!.edges.filter((e) => e.target === rcv.id);
            return (
              <g key={rcv.id}>
                {edges.map((e, j) => {
                  const a = (2 * Math.PI * j) / edges.length - Math.PI / 2;
                  const x = cx + R * Math.cos(a);
                  const y = cy + R * Math.sin(a);
                  return (
                    <g key={e.source}>
                      <line x1={x} y1={y} x2={cx} y2={cy} stroke={EDGE_COLOR[e.action]} strokeWidth={1.5} opacity={0.75} />
                      <circle
                        cx={x}
                        cy={y}
                        r={6.5}
                        fill="var(--bg2)"
                        stroke={seniors.has(e.source) ? "var(--warn)" : "var(--mut)"}
                        strokeWidth={2}
                      >
                        <title>
                          {e.source}
                          {seniors.has(e.source) ? " (65+)" : ""}: {money(e.amount)} ({e.action})
                        </title>
                      </circle>
                    </g>
                  );
                })}
                <circle
                  cx={cx}
                  cy={cy}
                  r={16 + Math.min(rcv.fan_in ?? 0, 12)}
                  fill="color-mix(in srgb, var(--signal) 35%, var(--bg))"
                  stroke="var(--signal)"
                  strokeWidth={2}
                />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--fg)">
                  {rcv.fan_in}
                </text>
                <text x={cx} y={cy + R + 26} textAnchor="middle" fontSize={12} fill="var(--fg)" fontFamily="var(--font-mono)">
                  {rcv.id} · {rcv.age_days}d old
                </text>
                <text x={cx} y={cy + R + 42} textAnchor="middle" fontSize={11} fill="var(--mut)">
                  {money(rcv.total ?? 0)} in · {rcv.held} held
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}
