"use client";

import clsx from "clsx";
import { ChevronDown, Copy, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { compact, dayClock, n0 } from "@/lib/format";
import { copyText, shareText } from "@/lib/share";
import { useStore } from "@/lib/store";
import type { InventoryRow } from "@/lib/types";

export default function Resources() {
  const s = useStore();
  const { plan, ops, latest } = s;
  if (!ops) return <div className="p-6 text-[15px] muted">Loading inventory…</div>;
  const inv = plan?.inventory;
  const rows = inv?.items ?? [];
  const below = rows.filter((i) => i.status === "short" || i.status === "low");

  const request =
    `RESUPPLY REQUEST · Texas power outage response${latest ? ` · ${dayClock(latest.as_of ?? latest.t)} CST` : ""}\n\n` +
    `Below our target:\n` +
    below.map((i) => `- ${i.label}: ${n0(i.below_by)} ${i.unit} (have ${n0(i.have)}, target ${n0(i.target ?? 0)})`).join("\n") +
    "\n\nPlease confirm quantities and delivery to our staging yard.";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <header>
        <p className="eyebrow">Resources</p>
        <h1 className="display mt-2 text-[clamp(34px,6vw,56px)]">
          What you have <span className="accent text-[1.1em]">on hand</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-snug text-ink2">
          The forecast only covers weather and outages, so it cannot tell you how much material a storm will use. Keep your inventory here, set the target you want for each item, and the page shows where you are below it. Stock numbers are sample data until you edit them.
        </p>
      </header>

      {inv && (
        <dl className="mt-6 grid grid-cols-3 divide-x divide-line border-y border-line" aria-label="Forecast context">
          <Ctx label="Out now" value={latest?.live ? "no feed" : compact(inv.context.customers_out)} sub="customers" />
          <Ctx label="At risk, next 24 h" value={compact(inv.context.customers_at_risk)} sub="customers in counties likely to go severe" />
          <Ctx label="Seniors at risk" value={compact(inv.context.seniors_at_risk)} sub="residents 65 and older in those counties" />
        </dl>
      )}

      {below.length > 0 && (
        <section className="card mt-6 flex flex-wrap items-center gap-4 p-4" aria-label="Below target">
          <div className="min-w-0 flex-1">
            <p className="eyebrow !text-red">Below your target</p>
            <p className="display mt-1 text-[30px]">
              {below.length} {below.length === 1 ? "item" : "items"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ink" onClick={() => shareText("Resupply request", request, s.say)}>
              <Share2 /> Request resupply
            </button>
            <button className="btn" onClick={async () => s.say((await copyText(request)) ? "Request copied" : "Could not copy")}>
              <Copy /> Copy
            </button>
          </div>
        </section>
      )}

      <ul className="mt-8 grid gap-x-10 md:grid-cols-2">
        {rows.map((i) => (
          <ItemRow key={i.id} i={i} />
        ))}
      </ul>

      <section className="mt-12" aria-label="Stock by depot">
        <h2 className="eyebrow">Stock by depot</h2>
        <p className="mt-2 text-[15px] muted">Type a number and leave the field to save it.</p>
        <div className="rows mt-3 border-y border-line">
          {ops.depots.map((d) => (
            <details key={d.id}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3">
                <span className="text-[19px] font-bold tracking-tight">{d.name}</span>
                <ChevronDown className="ml-auto h-4 w-4 text-ink3" aria-hidden />
              </summary>
              <div className="grid gap-x-8 gap-y-3 pb-4 sm:grid-cols-2">
                {ops.items.map((it) => (
                  <label key={it.id} className="flex items-center gap-3 text-[15px]">
                    <span className="min-w-0 flex-1">
                      {it.label}
                      <span className="mono block text-[11.5px] text-ink3">{it.unit}</span>
                    </span>
                    <Num value={d.stock[it.id] ?? 0} onCommit={(v) => s.setStock(d.id, it.id, v ?? 0)} label={`${d.name} ${it.label}`} />
                  </label>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function Ctx({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-4 py-4 first:pl-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-2 text-[34px]">{value}</dd>
      <p className="mt-1 text-[12.5px] leading-tight text-ink3">{sub}</p>
    </div>
  );
}

function ItemRow({ i }: { i: InventoryRow }) {
  const s = useStore();
  const tone = i.status === "short" ? "red" : i.status === "low" ? "amber" : "green";
  const cov = i.target ? Math.min(1, i.have / i.target) : 1;
  return (
    <li className="border-t border-line py-5">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[17px] font-semibold tracking-tight">{i.label}</h3>
        {i.status ? <span className={clsx("chip", i.status === "short" && "chip-red", i.status === "low" && "chip-amber", i.status === "ok" && "chip-green")}>{i.status === "ok" ? "at target" : i.status}</span> : <span className="chip">no target</span>}
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className={clsx("num text-[44px]", i.status === "short" && "text-red", i.status === "low" && "text-amber")}>{compact(i.have)}</span>
        <span className="text-[15px] muted">{i.unit} on hand</span>
      </p>
      {i.target != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${Math.round(cov * 100)} percent of target`}>
          <div className="h-full rounded-full" style={{ width: `${cov * 100}%`, background: `var(--${tone})` }} />
        </div>
      )}
      <label className="mt-3 flex items-center gap-3 text-[15px]">
        <span className="flex-1 muted">Your target</span>
        <Num value={i.target ?? null} placeholder="set one" onCommit={(v) => s.setTarget(i.id, v)} label={`${i.label} target`} />
      </label>
      {i.below_by > 0 && (
        <button
          className="btn btn-sm mt-3"
          onClick={() => shareText(`Order ${i.label}`, `RESUPPLY REQUEST · ${i.label}: ${n0(i.below_by)} ${i.unit} (have ${n0(i.have)}, target ${n0(i.target ?? 0)}). Please confirm quantity and delivery.`, s.say)}
        >
          <Share2 /> Order {n0(i.below_by)}
        </button>
      )}
    </li>
  );
}

/** A number field that saves when you leave it, so typing 1,000 does not fire three updates. Empty clears it. */
function Num({ value, onCommit, label, placeholder }: { value: number | null; onCommit: (v: number | null) => void; label: string; placeholder?: string }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  const commit = () => {
    if (v === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
    else setV(value == null ? "" : String(value));
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="field w-28"
    />
  );
}
