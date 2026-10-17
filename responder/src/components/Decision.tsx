"use client";

import { MapPin, X } from "lucide-react";
import Stepper from "@/components/Stepper";
import { qtyText, total } from "@/lib/decisions";
import { compact, departBy, mins, pct } from "@/lib/format";
import type { Qty } from "@/lib/store";
import type { County, HourEvent, Priority } from "@/lib/types";
import { TIER_NAMES } from "@/lib/types";

type Avail = { line: number; shelter: number; outreach: number };

/** The decision for one county: what is happening, how long a crew takes, and how many you send. */
export default function Decision({
  county,
  index,
  latest,
  priority,
  qty,
  onQty,
  available,
  busy,
  onSend,
  onSkip,
  onClose,
}: {
  county: County;
  index: number;
  latest: HourEvent;
  priority: Priority | undefined;
  qty: Qty;
  onQty: (q: Qty) => void;
  available: Avail;
  busy?: boolean;
  onSend: () => void;
  onSkip?: () => void;
  onClose?: () => void;
}) {
  const row = latest.counties[index];
  const tier = TIER_NAMES[row[1]];
  const out = row[2];
  const severe = out >= county.severe_at;
  const alerts = latest.alerts?.by_fips[county.fips] ?? [];
  const now = latest.as_of ?? latest.t;
  const n = priority?.nearest;
  const leaveNow = priority?.depart_by_min === 0;
  const status = severe ? "power out" : tier;

  return (
    <article aria-label={`${county.name} County`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {status !== "clear" ? <span className={`chip ${status === "prepare" ? "chip-amber" : "chip-red"}`}>{status}</span> : <span className="chip">clear</span>}
            {alerts.map((a) => (
              <span key={a} className="chip chip-amber">
                {a}
              </span>
            ))}
          </div>
          <h2 className="display mt-2 text-[34px]">{county.name} County</h2>
        </div>
        {onClose && (
          <button className="btn btn-icon" onClick={onClose} aria-label="Close county details">
            <X />
          </button>
        )}
      </div>

      <p className="mt-2 text-[18px] leading-snug tracking-tight">
        {priority ? (
          n ? (
            <>
              {n.depot} crew is <b>{mins(n.eta_min)}</b> away. {leaveNow ? <span className="accent text-[22px]">Leave now.</span> : <span className="accent text-[22px]">Leave by {departBy(now, priority.depart_by_min)}.</span>}
            </>
          ) : (
            <>No line crew is free. <span className="accent text-[22px]">Recall one.</span></>
          )
        ) : (
          <span className="muted">Not on the priority list right now.</span>
        )}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Stepper bare label="Line crews" value={qty.line} max={available.line} onChange={(v) => onQty({ ...qty, line: v })} />
        <button className="btn btn-ink min-w-0 flex-1" onClick={onSend} disabled={busy || total(qty) === 0}>
          {total(qty) ? `Dispatch ${total(qty)}` : "Choose how many"}
        </button>
      </div>
      <p className="mono mt-2 text-[11.5px] text-ink3">
        {available.line} line crews ready{total(qty) ? ` · sends ${qtyText(qty)}` : ""}
      </p>

      <dl className="mt-5 grid grid-cols-3 border-y border-line py-3">
        <Fact label="Risk 24 h" value={pct(row[0], 0)} />
        <Fact label={latest.live ? "Out now" : "Customers out"} value={latest.live ? "no feed" : compact(out)} />
        <Fact label="Aged 65+" value={compact(county.pop65)} />
      </dl>

      {priority && priority.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-[14.5px] text-ink2">
          {priority.reasons.slice(0, 2).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="rows mt-4">
        <div className="py-3">
          <Stepper label="Shelter teams" value={qty.shelter} max={available.shelter} note={`${available.shelter} ready`} onChange={(v) => onQty({ ...qty, shelter: v })} />
        </div>
        <div className="py-3">
          <Stepper label="Outreach teams" value={qty.outreach} max={available.outreach} note={`${available.outreach} ready`} onChange={(v) => onQty({ ...qty, outreach: v })} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${county.lat},${county.lon}`} target="_blank" rel="noreferrer">
          <MapPin /> Open in Maps
        </a>
        {onSkip && (
          <button className="btn btn-sm" onClick={onSkip}>
            Skip for now
          </button>
        )}
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1 first:pl-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1.5 text-[26px]">{value}</dd>
    </div>
  );
}
