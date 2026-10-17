"use client";

import { MapPin, Send, X } from "lucide-react";
import Stepper from "@/components/Stepper";
import { qtyText, total } from "@/lib/decisions";
import { compact, departBy, mins, pct } from "@/lib/format";
import type { Qty } from "@/lib/store";
import type { County, HourEvent, Priority } from "@/lib/types";
import { TIER_NAMES } from "@/lib/types";

export default function CountySheet({
  county,
  index,
  latest,
  priority,
  qty,
  onQty,
  available,
  onClose,
  onSend,
}: {
  county: County;
  index: number;
  latest: HourEvent;
  priority: Priority | undefined;
  qty: Qty;
  onQty: (q: Qty) => void;
  available: { line: number; shelter: number; outreach: number };
  onClose: () => void;
  onSend: () => void;
}) {
  const row = latest.counties[index];
  const tier = TIER_NAMES[row[1]];
  const out = row[2];
  const severe = out >= county.severe_at;
  const alerts = latest.alerts?.by_fips[county.fips] ?? [];
  const now = latest.as_of ?? latest.t;
  return (
    <section className="panel p-4" aria-label={`${county.name} County`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="label">County</p>
          <h3 className="cond text-[40px] uppercase leading-[0.95]">{county.name}</h3>
        </div>
        <button className="btn !min-h-11 !w-11 !px-0" onClick={onClose} aria-label="Close county details">
          <X />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {severe ? <span className="tag tag--fault">power out</span> : tier !== "clear" ? <span className={`tag tag--${tier === "act" ? "fault" : tier === "prepare" ? "amber" : "ice"}`}>{tier}</span> : <span className="tag">clear</span>}
        {alerts.map((a) => (
          <span key={a} className="tag tag--amber">
            {a}
          </span>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Fact label="6 h" value={pct(row[3], 1)} />
        <Fact label="12 h" value={pct(row[4], 1)} />
        <Fact label="24 h" value={pct(row[0], 1)} />
        <Fact label="Customers out" value={latest.live ? "no feed" : compact(out)} />
        <Fact label="Residents" value={compact(county.pop)} />
        <Fact label="Aged 65+" value={compact(county.pop65)} />
      </dl>

      {priority?.nearest && (
        <p className="mt-3 text-[14px] text-mute">
          Nearest crew: <b className="text-frost">{priority.nearest.depot}</b>, travel {mins(priority.nearest.eta_min)} ·{" "}
          {priority.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, priority.depart_by_min)}`}
        </p>
      )}

      <div className="mt-3 space-y-1.5 rounded-md border border-rule bg-panel2 p-3">
        <p className="label">Send here</p>
        <Stepper label="Line crews" value={qty.line} max={available.line} note={`${available.line} ready`} onChange={(n) => onQty({ ...qty, line: n })} />
        <Stepper label="Shelter teams" value={qty.shelter} max={available.shelter} note={`${available.shelter} ready`} onChange={(n) => onQty({ ...qty, shelter: n })} />
        <Stepper label="Outreach teams" value={qty.outreach} max={available.outreach} note={`${available.outreach} ready`} onChange={(n) => onQty({ ...qty, outreach: n })} />
        <button className="btn btn--go mt-2 w-full" onClick={onSend} disabled={total(qty) === 0}>
          <Send /> {total(qty) ? `Dispatch ${qtyText(qty)}` : "Choose how many"}
        </button>
      </div>

      <a className="btn mt-3 w-full" href={`https://www.google.com/maps/search/?api=1&query=${county.lat},${county.lon}`} target="_blank" rel="noreferrer">
        <MapPin /> Open in Maps
      </a>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="cond text-[28px]">{value}</dd>
    </div>
  );
}
