"use client";

import clsx from "clsx";
import { ArrowRight, Send } from "lucide-react";
import Stepper from "@/components/Stepper";
import { qtyText, total } from "@/lib/decisions";
import { compact, departBy, mins, pct } from "@/lib/format";
import type { Qty } from "@/lib/store";
import type { Priority } from "@/lib/types";

function statusLine(p: Priority): string {
  return p.status === "out" ? `${compact(p.out)} customers out` : `${pct(p.risk, 0)} risk · ${p.window}`;
}

/** A dispatch ticket: the county that needs a decision next. The responder sets how many to send. */
export function Ticket({
  p,
  now,
  qty,
  onQty,
  available,
  onSend,
  onSkip,
  onOpen,
  busy,
}: {
  p: Priority;
  now: string;
  qty: Qty;
  onQty: (q: Qty) => void;
  available: { line: number; shelter: number; outreach: number };
  onSend: () => void;
  onSkip?: () => void;
  onOpen?: () => void;
  busy?: boolean;
}) {
  const leaveNow = p.depart_by_min === 0;
  return (
    <article className="ticket overflow-hidden" data-urgency={p.urgency}>
      <div className="p-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx("tag", p.status === "out" || p.status === "act" ? "tag--fault" : p.status === "prepare" ? "tag--amber" : "tag--ice")}>
            {p.status === "out" ? "Power out" : p.status}
          </span>
          <span className="label">{statusLine(p)}</span>
        </div>
        <button onClick={onOpen} className="mt-2 block text-left">
          <h2 className="cond text-[44px] uppercase leading-[0.92] md:text-[52px]">{p.county} County</h2>
        </button>
        <p className="mt-1 text-[13px] text-mute">
          {compact(p.seniors_exposed)} seniors in the county · {p.temp_f}°F
        </p>

        {p.nearest ? (
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="label">Nearest crew · {p.nearest.depot}</dt>
              <dd className="cond text-[34px]">{mins(p.nearest.eta_min)}</dd>
            </div>
            <div>
              <dt className="label">{leaveNow ? "Leave" : "Leave by"}</dt>
              <dd className={clsx("cond text-[34px]", leaveNow && "text-fault")}>{leaveNow ? "NOW" : departBy(now, p.depart_by_min)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-[14px] text-fault">No line crew is free. Recall one from the Teams tab.</p>
        )}

        {p.reasons.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13.5px] text-mute">
            {p.reasons.slice(0, 2).map((w, i) => (
              <li key={i} className="flex gap-2">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-none text-ice" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-1.5 rounded-md border border-rule bg-panel2 p-3">
          <p className="label">You decide how many</p>
          <Stepper label="Line crews" value={qty.line} max={available.line} note={`${available.line} ready`} onChange={(n) => onQty({ ...qty, line: n })} />
          <Stepper label="Shelter teams" value={qty.shelter} max={available.shelter} note={`${available.shelter} ready`} onChange={(n) => onQty({ ...qty, shelter: n })} />
          <Stepper label="Outreach teams" value={qty.outreach} max={available.outreach} note={`${available.outreach} ready`} onChange={(n) => onQty({ ...qty, outreach: n })} />
        </div>
      </div>
      <div className="perf" />
      <div className="flex items-center gap-3 p-3">
        <button className="btn btn--go flex-1" onClick={onSend} disabled={busy || total(qty) === 0}>
          <Send /> {total(qty) ? `Dispatch ${total(qty)}` : "Choose how many"}
        </button>
        {onSkip && (
          <button className="btn" onClick={onSkip}>
            Skip
          </button>
        )}
      </div>
      {total(qty) > 0 && <p className="px-4 pb-3 text-[12.5px] text-mute">Sends {qtyText(qty)} from the nearest depots.</p>}
    </article>
  );
}

export function QueueRow({ p, now, onSend, onOpen, qty }: { p: Priority; now: string; onSend: () => void; onOpen: () => void; qty: Qty }) {
  return (
    <div className="flex items-center gap-3 border-t border-rule/60 py-2.5 first:border-t-0">
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className="cond truncate text-[24px] uppercase leading-none">{p.county}</p>
        <p className="mt-1 truncate text-[12.5px] text-mute">
          {statusLine(p)} · {p.nearest ? `${mins(p.nearest.eta_min)} from ${p.nearest.depot}` : "no crew free"} ·{" "}
          {p.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, p.depart_by_min)}`}
        </p>
      </button>
      <button className="btn btn--sm" onClick={onSend} disabled={total(qty) === 0}>
        <Send /> Send {total(qty)}
      </button>
    </div>
  );
}
