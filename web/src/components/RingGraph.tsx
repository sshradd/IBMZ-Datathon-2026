import { money, usePoll, type GraphEdge, type GraphNode } from "../api";

const EDGE_COLOR = { allow: "#6b7280", step_up: "#f59e0b", hold: "#ef4444" } as const;
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
    <section className="card">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="text-sm font-semibold text-gray-300">Mule-ring radar</h2>
        <p className="text-xs text-gray-500">
          New accounts (&lt;90 days) receiving from 3+ people. Red lines = held payments, amber = sent to verify.
        </p>
      </div>
      {!receivers.length ? (
        <p className="py-8 text-center text-sm text-gray-500">No suspicious fan-in yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${rows * CELL_H}`} className="w-full">
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
                      <line x1={x} y1={y} x2={cx} y2={cy} stroke={EDGE_COLOR[e.action]} strokeWidth={2} opacity={0.8} />
                      <circle cx={x} cy={y} r={7} fill="#1f2937" stroke={seniors.has(e.source) ? "#fbbf24" : "#9ca3af"} strokeWidth={2}>
                        <title>
                          {e.source}
                          {seniors.has(e.source) ? " (65+)" : ""}: {money(e.amount)} ({e.action})
                        </title>
                      </circle>
                    </g>
                  );
                })}
                <circle cx={cx} cy={cy} r={16 + Math.min(rcv.fan_in ?? 0, 12)} fill="#7f1d1d" stroke="#ef4444" strokeWidth={2} />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#fff">
                  {rcv.fan_in}
                </text>
                <text x={cx} y={cy + R + 26} textAnchor="middle" fontSize={12} fill="#d1d5db">
                  {rcv.id} · {rcv.age_days}d old
                </text>
                <text x={cx} y={cy + R + 42} textAnchor="middle" fontSize={11} fill="#9ca3af">
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
