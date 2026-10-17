import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtTime, n0, type HistoryPoint } from "../api";

export default function Timeline({ history, total }: { history: HistoryPoint[]; total: number }) {
  // Hour i of the replay happened at start + i hours; work the start out from any point.
  const first = history[0];
  const timeAt = (i: number) =>
    first ? new Date(new Date(first.t).getTime() + (i - first.i) * 3600 * 1000).toISOString() : "";
  return (
    <div className="panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="eyebrow">Texas customers without power (area) and counties on alert (line)</h3>
        <span className="eyebrow">hour {history.length ? history[history.length - 1].i + 1 : 0} of {total}</span>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={history} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, Math.max(total - 1, 1)]}
            tickFormatter={(i: number) => (first ? fmtTime(timeAt(i)).split(",")[0] : "")}
            tick={{ fill: "var(--mut)", fontSize: 10 }}
            tickCount={8}
            axisLine={{ stroke: "var(--line)" }}
            tickLine={false}
          />
          <YAxis yAxisId="out" hide domain={[0, "auto"]} />
          <YAxis yAxisId="al" orientation="right" hide domain={[0, 254]} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", fontSize: 12 }}
            labelFormatter={(i) => (first ? fmtTime(timeAt(Number(i))) : "")}
            formatter={(v, name) => [n0(Number(v)), name === "out" ? "customers out" : name === "flagged" ? "counties on alert" : "counties at act"]}
          />
          <Area yAxisId="out" dataKey="out" stroke="var(--loss)" fill="var(--loss)" fillOpacity={0.28} strokeWidth={1.5} isAnimationActive={false} />
          <Line yAxisId="al" dataKey="flagged" stroke="var(--t2)" dot={false} strokeWidth={1.6} isAnimationActive={false} />
          <Line yAxisId="al" dataKey="act" stroke="var(--t1)" dot={false} strokeWidth={1.2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
