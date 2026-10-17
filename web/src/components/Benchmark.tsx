import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { n0, usePoll, type BenchResult, type SystemInfo } from "../api";
import { Empty, Lens, Panel } from "./ui";

const TIP = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 };

export default function Benchmark({ system }: { system: SystemInfo | null }) {
  const results = usePoll<BenchResult[]>("/api/bench", 10000) ?? [];
  const rows = results.map((r) => ({
    name: `${r.label} ${r.machine}${r.procs && r.procs > 1 ? ` ×${r.procs}` : ""}`,
    tps: r.tps,
    p99: r.p99_ms,
  }));

  return (
    <div className="space-y-5">
      <div>
        <Lens n="07" name="On IBM Z" question="does it hold up under surge?" />
        <h2 className="mt-2 text-[26px]">Throughput and latency</h2>
        <p className="mt-2 max-w-3xl text-[14px] text-mut">
          A storm hits every county in the same hours, so the scoring service has to stay fast while the whole state spikes at once. Each pass scores every Texas
          county for every hour of the Uri replay through the full engine: three forecasts, tiering, drivers, ranking and the deployment plan.
        </p>
      </div>

      <Panel title="Run it" note="on each machine">
        <div className="space-y-2 text-[13px] text-mut">
          <p>
            <code className="mono rounded-[3px] border border-line px-1.5 text-[12px] text-fg">python bench/run.py engine --hours 408</code> for one core, add{" "}
            <code className="mono rounded-[3px] border border-line px-1.5 text-[12px] text-fg">--procs N</code> to use N cores. Results appear below.
          </p>
          {system && (
            <p>
              This server: {system.machine} · {system.cpus} CPUs · {system.byteorder}-endian · Python {system.python}
              {system.is_ibm_z ? " · IBM LinuxONE" : ""}
            </p>
          )}
        </div>
      </Panel>

      {!rows.length ? (
        <Empty>No benchmark results yet.</Empty>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Chart title="County scores per second (higher is better)" data={rows} dataKey="tps" color="var(--gain)" />
            <Chart title="p99 latency per county score, ms (lower is better)" data={rows} dataKey="p99" color="var(--data)" />
          </div>
          <Panel title="All runs">
            <div className="overflow-x-auto scroll-thin">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Machine</th>
                    <th className="num">CPUs</th>
                    <th className="num">Scores</th>
                    <th className="num">Scores/s</th>
                    <th className="num">p50 ms</th>
                    <th className="num">p99 ms</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td>{rows[i].name}</td>
                      <td>{r.machine}</td>
                      <td className="num">{r.cpus}</td>
                      <td className="num">{n0(r.n)}</td>
                      <td className="num text-fg">{n0(r.tps)}</td>
                      <td className="num">{r.p50_ms}</td>
                      <td className="num">{r.p99_ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11.5px] leading-snug text-dim">
              Latency percentiles are per-county averages over each hourly batch, not individually timed scores. Scoring is a small job, so a laptop core is fast
              too. The case for LinuxONE is sustained throughput under surge, isolation and availability for utility data, not raw speed on a small model.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

function Chart({ title, data, dataKey, color }: { title: string; data: Record<string, string | number>[]; dataKey: string; color: string }) {
  return (
    <Panel title={title}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ left: -8, right: 6 }}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "var(--mut)", fontSize: 11 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
          <YAxis tick={{ fill: "var(--mut)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TIP} cursor={{ fill: "var(--line-soft)" }} />
          <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
