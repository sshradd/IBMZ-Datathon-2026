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
  if (!ops) return <div className="p-6 text-[14px] text-mute">Loading inventory…</div>;
  const inv = plan?.inventory;
  const rows = inv?.items ?? [];
  const below = rows.filter((i) => i.status === "short" || i.status === "low");

  const request =
    `RESUPPLY REQUEST · Texas power outage response${latest ? ` · ${dayClock(latest.as_of ?? latest.t)} CST` : ""}\n\n` +
    `Below our target:\n` +
    below.map((i) => `- ${i.label}: ${n0(i.below_by)} ${i.unit} (have ${n0(i.have)}, target ${n0(i.target ?? 0)})`).join("\n") +
    "\n\nPlease confirm quantities and delivery to our staging yard.";

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-5">
      <header className="mb-3">
        <p className="label">Resources</p>
        <h1 className="cond text-[44px] uppercase leading-[0.95]">What you have on hand</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-mute">
          The forecast only covers weather and outages, so it cannot tell you how much material a storm will use. Keep your inventory here, set the target you want for each item, and the page shows where you are below it.
          Stock numbers are sample data until you edit them.
        </p>
      </header>

      {inv && (
        <section className="panel p-4" aria-label="Forecast context">
          <p className="label">For context, from the forecast</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Ctx label="Out now" value={latest?.live ? "no feed" : compact(inv.context.customers_out)} sub="customers" />
            <Ctx label="At risk next 24 h" value={compact(inv.context.customers_at_risk)} sub="customers in counties likely to go severe" />
            <Ctx label="Seniors in those counties" value={compact(inv.context.seniors_at_risk)} sub="residents 65 and older" />
          </div>
        </section>
      )}

      {below.length > 0 && (
        <section className="mt-3 rounded-md border border-fault/60 bg-fault/10 p-4" aria-label="Below target">
          <p className="label !text-fault">Below your target</p>
          <p className="cond mt-1 text-[34px] uppercase leading-none">
            {below.length} {below.length === 1 ? "item" : "items"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn--go !text-[20px]" onClick={() => shareText("Resupply request", request, s.say)}>
              <Share2 /> Request resupply
            </button>
            <button className="btn" onClick={async () => s.say((await copyText(request)) ? "Request copied" : "Could not copy")}>
              <Copy /> Copy
            </button>
          </div>
        </section>
      )}

      <ul className="mt-3 grid gap-2.5 md:grid-cols-2">
        {rows.map((i) => (
          <ItemCard key={i.id} i={i} />
        ))}
      </ul>

      <section className="panel mt-3 p-4" aria-label="Stock by depot">
        <h2 className="label">Stock by depot</h2>
        <p className="mt-1 text-[13.5px] text-mute">Type a number and leave the field to save it.</p>
        <div className="mt-3 space-y-2">
          {ops.depots.map((d) => (
            <details key={d.id} className="rounded-md border border-rule bg-panel2">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3">
                <span className="cond text-[24px] uppercase">{d.name}</span>
                <ChevronDown className="ml-auto h-4 w-4 text-mute" aria-hidden />
              </summary>
              <div className="grid gap-x-4 gap-y-2 border-t border-rule/60 p-3 sm:grid-cols-2">
                {ops.items.map((it) => (
                  <label key={it.id} className="flex items-center gap-3 text-[14px]">
                    <span className="min-w-0 flex-1">
                      {it.label}
                      <span className="block text-[11.5px] text-mute">{it.unit}</span>
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
    <div>
      <p className="label">{label}</p>
      <p className="cond text-[34px] leading-none">{value}</p>
      <p className="mt-1 text-[12px] leading-tight text-mute">{sub}</p>
    </div>
  );
}

function ItemCard({ i }: { i: InventoryRow }) {
  const s = useStore();
  const tone = i.status === "short" ? "fault" : i.status === "low" ? "amber" : "mint";
  const cov = i.target ? Math.min(1, i.have / i.target) : 1;
  return (
    <li className="panel p-4">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold">{i.label}</h3>
        {i.status ? <span className={clsx("tag", `tag--${tone}`)}>{i.status === "ok" ? "at target" : i.status}</span> : <span className="tag">no target</span>}
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className={clsx("cond text-[44px] leading-[0.9] tnum", i.status === "short" && "text-fault", i.status === "low" && "text-amber")}>{compact(i.have)}</span>
        <span className="text-[14px] text-mute">{i.unit} on hand</span>
      </p>
      {i.target != null && (
        <div className="mt-2 h-2.5 overflow-hidden rounded-sm bg-frost/10" role="img" aria-label={`${Math.round(cov * 100)} percent of target`}>
          <div className="h-full rounded-sm" style={{ width: `${cov * 100}%`, background: `var(--${tone})` }} />
        </div>
      )}
      <label className="mt-3 flex items-center gap-3 text-[14px]">
        <span className="flex-1 text-mute">Your target</span>
        <Num value={i.target ?? null} placeholder="set one" onCommit={(v) => s.setTarget(i.id, v)} label={`${i.label} target`} />
      </label>
      {i.below_by > 0 && (
        <button
          className="btn btn--sm mt-3"
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
      className="mono min-h-11 w-28 rounded-md border border-rule bg-night px-2 text-right text-[15px] text-frost focus:border-lightning"
    />
  );
}
