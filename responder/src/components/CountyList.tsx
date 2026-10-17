"use client";

import { compact, pct } from "@/lib/format";
import type { County, HourEvent } from "@/lib/types";
import { TIER_NAMES } from "@/lib/types";

/** The map's accessible twin: every county as a table, sorted by 24 h risk. */
export default function CountyList({
  counties,
  latest,
  selected,
  onSelect,
}: {
  counties: County[];
  latest: HourEvent;
  selected: string | null;
  onSelect: (f: string) => void;
}) {
  const rows = counties
    .map((c, i) => ({ c, r: latest.counties[i] }))
    .sort((a, b) => b.r[0] - a.r[0])
    .slice(0, 80);
  return (
    <div className="scroll-thin h-full overflow-auto">
      <table className="w-full text-[15px]">
        <thead className="sticky top-0 bg-card">
          <tr className="eyebrow text-left">
            <th className="py-2 pr-2 font-medium">County</th>
            <th className="py-2 pr-2 font-medium">Status</th>
            <th className="py-2 pr-2 text-right font-medium">24 h</th>
            <th className="py-2 text-right font-medium">{latest.live ? "65+" : "Out"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, r }) => (
            <tr key={c.fips} onClick={() => onSelect(c.fips)} className={`cursor-pointer border-t border-line hover:bg-card2 ${selected === c.fips ? "bg-card2" : ""}`}>
              <td className="py-3 pr-2 font-semibold">{c.name}</td>
              <td className="py-3 pr-2">{r[2] >= c.severe_at ? <span className="chip chip-red">out</span> : <span className="chip">{TIER_NAMES[r[1]]}</span>}</td>
              <td className="mono py-3 pr-2 text-right">{pct(r[0], 1)}</td>
              <td className="mono py-3 text-right">{compact(latest.live ? c.pop65 : r[2])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
