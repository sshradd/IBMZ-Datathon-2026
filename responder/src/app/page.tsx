"use client";

import clsx from "clsx";
import { List, Map as MapIcon, Play, Radio, Send } from "lucide-react";
import { useMemo, useState } from "react";
import CountyList from "@/components/CountyList";
import CountyMap, { type Layer, type MapLink } from "@/components/CountyMap";
import CountySheet from "@/components/CountySheet";
import { QueueRow, Ticket } from "@/components/Ticket";
import Weather from "@/components/Weather";
import { orderOf, qtyOf, qtyText, total } from "@/lib/decisions";
import { compact, departBy, n0 } from "@/lib/format";
import { DEFAULT_QTY, useStore } from "@/lib/store";

const LAYERS: { id: Layer; label: string }[] = [
  { id: "p24", label: "Risk 24 h" },
  { id: "p12", label: "12 h" },
  { id: "p6", label: "6 h" },
  { id: "out", label: "Out now" },
  { id: "nws", label: "NWS" },
];

export default function Outages() {
  const s = useStore();
  const { latest, plan, counties, ops, tiers, selected, setSelected, qty, setQty } = s;
  const [layer, setLayer] = useState<Layer>("p24");
  const [list, setList] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const priorities = useMemo(() => (plan?.priorities ?? []).filter((p) => !skipped.includes(p.fips)), [plan, skipped]);
  const top = priorities[0];
  const idx = useMemo(() => new Map(counties.map((c, i) => [c.fips, i])), [counties]);
  const byFips = useMemo(() => new Map(counties.map((c) => [c.fips, c])), [counties]);

  const links: MapLink[] = useMemo(() => {
    const out: MapLink[] = [];
    const depotByName = new Map((ops?.depots ?? []).map((d) => [d.name, d]));
    if (top?.nearest) {
      const c = byFips.get(top.fips);
      if (c) out.push({ id: `plan-${top.fips}`, depot: top.nearest.depot, lat: c.lat, lon: c.lon });
    }
    const depotById = new Map((ops?.depots ?? []).map((d) => [d.id, d]));
    for (const u of ops?.units ?? []) {
      if (u.status !== "en_route" || !u.assignment) continue;
      const c = byFips.get(u.assignment.fips);
      const d = depotById.get(u.depot);
      if (c && d) out.push({ id: u.id, depot: d.name, lat: c.lat, lon: c.lon });
    }
    void depotByName;
    return out;
  }, [top, ops, byFips]);

  if (!latest) return <Empty />;

  const now = latest.as_of ?? latest.t;
  const live = !!latest.live;
  const avail = {
    line: plan?.totals.line.available ?? 0,
    shelter: plan?.totals.shelter.available ?? 0,
    outreach: plan?.totals.outreach.available ?? 0,
  };
  const send = async (fips: string[]) => {
    setBusy(true);
    try {
      const orders = fips
        .map((f) => priorities.find((p) => p.fips === f) ?? plan?.priorities.find((p) => p.fips === f))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => orderOf(p, qty))
        .filter((o) => o.line + o.shelter + o.outreach > 0);
      const direct = fips.filter((f) => !orders.some((o) => o.fips === f) && !plan?.priorities.some((p) => p.fips === f));
      for (const f of direct) orders.push({ fips: f, ...qtyOf(qty, f) });
      await s.dispatch(orders);
    } finally {
      setBusy(false);
    }
  };
  const sel = selected ? counties.find((c) => c.fips === selected) : undefined;
  const statewide = latest.prescribe.moves.filter((m) => m.kind === "statewide");
  const out = ops?.units.filter((u) => u.status === "en_route" || u.status === "on_site").length ?? 0;

  return (
    <div className="mx-auto max-w-7xl p-3 pb-44 md:p-5 lg:pb-5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label="Out now" value={live ? "—" : compact(latest.out_total)} sub={live ? "no live outage feed" : `${latest.describe.severe_now} counties severe`} tone={live ? undefined : "fault"} />
        <Stat label="Likely next 24 h" value={`≈${Math.round(latest.predict.expected_onsets[2])}`} sub={`${Math.round(latest.predict.expected_onsets[2]) === 1 ? "county goes" : "counties go"} severe`} tone="amber" />
        <Stat label="Seniors in at-risk counties" value={compact(latest.predict.seniors_exposed)} sub={`${compact(latest.predict.customers_exposed)} customers`} />
        <Stat label="Crews ready" value={String(avail.line)} sub={out ? `${out} units out in the field` : "none out yet"} tone="mint" />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* map */}
        <section className="panel relative min-w-0 overflow-hidden p-0" aria-label="Outage map">
          <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-70px)] flex-wrap gap-1.5">
            {LAYERS.filter((l) => !(live && l.id === "out")).map((l) => (
              <button
                key={l.id}
                onClick={() => setLayer(l.id)}
                aria-pressed={layer === l.id}
                className={clsx(
                  "min-h-11 rounded-md border px-3 text-[13px] font-semibold backdrop-blur",
                  layer === l.id ? "border-lightning bg-lightning text-[var(--lightning-ink)]" : "border-rule bg-panel/85 text-frost hover:border-frost",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="h-[40dvh] min-h-[280px] lg:h-[calc(100dvh-210px)] lg:min-h-[520px]">
            {list ? (
              <div className="h-full p-3 pt-16">
                <CountyList counties={counties} latest={latest} selected={selected} onSelect={setSelected} />
              </div>
            ) : (
              <CountyMap
                latest={latest}
                counties={counties}
                layer={layer}
                tiers={tiers}
                selected={selected}
                onSelect={setSelected}
                depots={ops?.depots ?? []}
                lines={links}
                staging={plan?.staging.sites.slice(0, 1) ?? []}
                beacon={top ? [top.fips] : []}
              />
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-rule px-3 py-2">
            <Legend layer={layer} />
            <button className="btn btn--sm ml-auto" onClick={() => setList((v) => !v)} aria-pressed={list}>
              {list ? <MapIcon /> : <List />} {list ? "Map" : "List"}
            </button>
          </div>
        </section>

        {/* decisions */}
        <div className="min-w-0 space-y-3">
          {sel && idx.has(sel.fips) && (
            <CountySheet
              county={sel}
              index={idx.get(sel.fips)!}
              latest={latest}
              priority={plan?.priorities.find((p) => p.fips === sel.fips)}
              qty={qtyOf(qty, sel.fips)}
              onQty={(q) => setQty(sel.fips, q)}
              available={avail}
              onClose={() => setSelected(null)}
              onSend={() => send([sel.fips])}
            />
          )}

          {statewide.map((m) => (
            <div key={m.id} className="rounded-md border border-fault/60 bg-fault/10 p-3 text-[14px]">
              <p className="label !text-fault">Statewide</p>
              <p className="mt-1 font-semibold">{m.title}</p>
              <p className="mt-1 text-mute">{m.detail}</p>
            </div>
          ))}

          {top ? (
            <Ticket
              p={top}
              now={now}
              busy={busy}
              qty={qtyOf(qty, top.fips)}
              onQty={(q) => setQty(top.fips, q)}
              available={avail}
              onSend={() => send([top.fips])}
              onSkip={() => setSkipped((x) => [...x, top.fips])}
              onOpen={() => setSelected(top.fips)}
            />
          ) : (
            <div className="panel p-5">
              <p className="label !text-mint">All clear</p>
              <p className="cond mt-1 text-[34px] uppercase">No county needs a crew</p>
              <p className="mt-1 text-[14px] text-mute">Nothing is rated watch or higher right now. This list updates every time the forecast does.</p>
            </div>
          )}

          {priorities.length > 1 && (
            <section className="panel p-4" aria-label="Next up">
              <h3 className="label mb-1">Next up · {priorities.length - 1}</h3>
              {priorities.slice(1, 6).map((p) => (
                <QueueRow key={p.fips} p={p} now={now} qty={qtyOf(qty, p.fips)} onSend={() => send([p.fips])} onOpen={() => setSelected(p.fips)} />
              ))}
              {priorities.length > 6 && <p className="mt-2 text-[12.5px] text-mute">and {priorities.length - 6} more on the Teams tab</p>}
              <p className="mt-2 text-[12px] text-dim">Each row sends one line crew unless you open the county and choose differently.</p>
            </section>
          )}

          <Weather latest={latest} />
        </div>
      </div>

      {top && (
        <div className="fixed inset-x-2 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 lg:hidden" role="region" aria-label="Next action">
          <div className="ticket flex items-center gap-3 border-lightning/50 !bg-panel2 p-2.5 pl-3.5 shadow-2xl">
            <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(top.fips)}>
              <p className="label !text-[11px]">{top.status === "out" ? "Power out" : `${top.status} · ${top.window}`}</p>
              <p className="cond truncate text-[28px] uppercase leading-none">{top.county}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-mute">
                {top.nearest ? `${qtyText(qtyOf(qty, top.fips))} from ${top.nearest.depot}` : "no crew free"} ·{" "}
                {top.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, top.depart_by_min)}`}
              </p>
            </button>
            <button className="btn btn--go !px-5" onClick={() => send([top.fips])} disabled={busy || total(qtyOf(qty, top.fips)) === 0}>
              <Send /> Dispatch
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-[12px] text-dim">
        Forecasts come from weather and outage data. How many crews to send is your call: the app suggests where and when. Crews and depots are sample data until you edit them.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "fault" | "amber" | "mint" }) {
  return (
    <div className="panel px-3.5 py-3">
      <p className="label">{label}</p>
      <p className={clsx("cond mt-1 text-[44px] leading-[0.9] tnum", tone === "fault" && "text-fault", tone === "amber" && "text-amber", tone === "mint" && "text-mint")}>{value}</p>
      <p className="mt-1 text-[12.5px] leading-tight text-mute">{sub}</p>
    </div>
  );
}

function Legend({ layer }: { layer: Layer }) {
  const items =
    layer === "out"
      ? [
          { c: "var(--tier-3)", t: "severe outage" },
          { c: "var(--tier-2)", t: "some customers out" },
          { c: "var(--tier-0)", t: "power on" },
        ]
      : layer === "nws"
        ? [
            { c: "var(--tier-2)", t: "active NWS alert" },
            { c: "var(--tier-0)", t: "none" },
          ]
        : [
            { c: "var(--tier-1)", t: "watch" },
            { c: "var(--tier-2)", t: "prepare" },
            { c: "var(--tier-3)", t: "act" },
          ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <li key={i.t} className="flex items-center gap-1.5 text-[12px] text-mute">
          <span className="h-3 w-3 rounded-sm" style={{ background: i.c }} aria-hidden />
          {i.t}
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  const { scenarios, start, state } = useStore();
  const storms = scenarios.filter((x) => x.key !== "live");
  return (
    <div className="mx-auto grid min-h-[70dvh] max-w-3xl place-items-center p-5">
      <div className="w-full">
        <p className="label">Texas power outage response</p>
        <h1 className="cond mt-2 text-[56px] uppercase leading-[0.9] md:text-[72px]">
          See where it goes dark <span className="text-lightning">next.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[16px] text-mute">
          The forecast ranks counties by outage risk from weather and outage data, and shows which crew is nearest and when to leave. You decide how many to send, and one tap sends them.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="btn btn--go justify-start gap-3 !py-4 text-left" onClick={() => start("live")}>
            <Radio /> Go live now
          </button>
          {storms.slice(0, 1).map((x) => (
            <button key={x.key} className="btn !min-h-[56px] justify-start gap-3" onClick={() => start(x.key)}>
              <Play /> Replay {x.title}
            </button>
          ))}
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-[14px] text-mute">Other storms</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {storms.slice(1).map((x) => (
              <button key={x.key} className="btn btn--sm" onClick={() => start(x.key)}>
                {x.title}
              </button>
            ))}
          </div>
        </details>
        {state?.scenario && <p className="mt-4 text-[13px] text-mute">Waiting for the first {n0(1)} update…</p>}
      </div>
    </div>
  );
}

void DEFAULT_QTY;
