import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePoll, type BenchResult, type SystemInfo } from "../api";

export default function Benchmark({ system }: { system: SystemInfo | null }) {
  const results = usePoll<BenchResult[]>("/api/bench", 10000) ?? [];
  const rows = results.map((r) => ({
    name: `${r.label} (${r.mode}${r.procs ? ` ×${r.procs}` : ""}${r.concurrency ? ` c${r.concurrency}` : ""})`,
    tps: r.tps,
    p99: r.p99_ms,
  }));

  return (
    <div className="space-y-4">
      <div className="card text-sm text-gray-300">
        <p>
          Run <code className="rounded bg-white/10 px-1">python bench/run.py engine --n 100000</code> on each machine
          (add <code className="rounded bg-white/10 px-1">--procs N</code> to use more cores). Results appear here.
        </p>
        {system && (
          <p className="mt-2 text-gray-400">
            This server: {system.machine} · {system.cpus} CPUs · {system.byteorder}-endian · Python {system.python}
          </p>
        )}
      </div>

      {!rows.length ? (
        <div className="card py-10 text-center text-sm text-gray-500">No benchmark results yet.</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Throughput (transactions/sec, higher is better)" data={rows} dataKey="tps" color="#22c55e" />
            <ChartCard title="p99 decision latency (ms, lower is better)" data={rows} dataKey="p99" color="#60a5fa" />
          </div>
          <div className="card overflow-auto">
            <table className="tabular w-full text-left text-xs">
              <thead className="text-gray-400">
                <tr>
                  <th className="py-1">Run</th>
                  <th>Machine</th>
                  <th>CPUs</th>
                  <th className="text-right">N</th>
                  <th className="text-right">TPS</th>
                  <th className="text-right">p50 ms</th>
                  <th className="text-right">p99 ms</th>
                  <th className="text-right">max ms</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-1">{rows[i].name}</td>
                    <td>{r.machine}</td>
                    <td>{r.cpus}</td>
                    <td className="text-right">{r.n.toLocaleString()}</td>
                    <td className="text-right">{r.tps.toLocaleString()}</td>
                    <td className="text-right">{r.p50_ms}</td>
                    <td className="text-right">{r.p99_ms}</td>
                    <td className="text-right">{r.max_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, data, dataKey, color }: {
  title: string;
  data: Record<string, string | number>[];
  dataKey: string;
  color: string;
}) {
  return (
    <div className="card">
      <h3 className="mb-2 text-sm text-gray-300">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid stroke="#ffffff14" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151" }} />
          <Legend />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
