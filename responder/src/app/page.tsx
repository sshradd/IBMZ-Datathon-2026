"use client";

import clsx from "clsx";
import { List, Map as MapIcon, Play, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CountyList from "@/components/CountyList";
import CountyMap, { type Layer, type MapLink } from "@/components/CountyMap";
import Decision from "@/components/Decision";
import Weather from "@/components/Weather";
import { orderOf, qtyOf, total } from "@/lib/decisions";
import { compact, departBy, mins, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Priority } from "@/lib/types";

const LAYERS: { id: Layer; label: string }[] = [
  { id: "p24", label: "24 h" },
  { id: "p12", label: "12 h" },
  { id: "p6", label: "6 h" },
  { id: "out", label: "Out now" },
  { id: "nws", label: "NWS" },
];

// bottom sheet heights on a phone: peek shows the decision, half shows the facts, full shows everything
const SNAPS = ["258px", "58%", "calc(100% - 12px)"];

export default function Outages() {
  const s = useStore();
  const { latest, plan, counties, ops, tiers, selected, setSelected, qty, setQty } = s;
  const [layer, setLayer] = useState<Layer>("p24");
  const [list, setList] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(0);
  // the header's start button links to /#start: show the start screen again, then drop the hash
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    const check = () => setPicker(location.hash === "#start");
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  // first open: load the demo outages so the map is never empty. Live stays a choice.
  const autoStarted = useRef(false);
  const hasDemo = s.scenarios.some((x) => x.key !== "live");
  useEffect(() => {
    if (autoStarted.current || latest || s.state?.scenario || !hasDemo || location.hash === "#start") return;
    autoStarted.current = true;
    s.startDemo();
  }, [latest, s, hasDemo]);
  const closePicker = () => {
    history.replaceState(null, "", location.pathname + location.search);
    setPicker(false);
  };

  const priorities = useMemo(() => (plan?.priorities ?? []).filter((p) => !skipped.includes(p.fips)), [plan, skipped]);
  const top = priorities[0];
  const focusFips = selected ?? top?.fips ?? null;
  const idx = useMemo(() => new Map(counties.map((c, i) => [c.fips, i])), [counties]);
  const byFips = useMemo(() => new Map(counties.map((c) => [c.fips, c])), [counties]);
  const focus = focusFips ? counties.find((c) => c.fips === focusFips) : undefined;
  const focusPriority = focusFips ? plan?.priorities.find((p) => p.fips === focusFips) : undefined;

  const links: MapLink[] = useMemo(() => {
    const out: MapLink[] = [];
    if (focusPriority?.nearest && focus) out.push({ id: `plan-${focus.fips}`, depot: focusPriority.nearest.depot, lat: focus.lat, lon: focus.lon, eta: focusPriority.nearest.eta_min });
    const depotById = new Map((ops?.depots ?? []).map((d) => [d.id, d]));
    for (const u of ops?.units ?? []) {
      if (u.status !== "en_route" || !u.assignment) continue;
      const c = byFips.get(u.assignment.fips);
      const d = depotById.get(u.depot);
      if (c && d) out.push({ id: u.id, depot: d.name, lat: c.lat, lon: c.lon, sent: true });
    }
    return out;
  }, [focus, focusPriority, ops, byFips]);

  // drag the sheet handle: a tap cycles, a drag up or down moves one step
  const dragY = useRef<number | null>(null);
  const grabDown = (e: React.PointerEvent) => {
    dragY.current = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const grabUp = (e: React.PointerEvent) => {
    if (dragY.current == null) return;
    const dy = e.clientY - dragY.current;
    dragY.current = null;
    if (Math.abs(dy) < 8) setSnap((v) => (v + 1) % SNAPS.length);
    else setSnap((v) => Math.min(SNAPS.length - 1, Math.max(0, v + (dy < 0 ? 1 : -1))));
  };

  if (!latest || picker) return <Empty onBack={latest ? closePicker : undefined} />;

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
        .map((f) => plan?.priorities.find((p) => p.fips === f))
        .filter((p): p is Priority => !!p)
        .map((p) => orderOf(p, qty));
      const direct = fips.filter((f) => !orders.some((o) => o.fips === f)).map((f) => ({ fips: f, ...qtyOf(qty, f) }));
      await s.dispatch([...orders, ...direct].filter((o) => o.line + o.shelter + o.outreach > 0));
    } finally {
      setBusy(false);
    }
  };
  const statewide = latest.prescribe.moves.filter((m) => m.kind === "statewide");
  const outUnits = ops?.units.filter((u) => u.status === "en_route" || u.status === "on_site").length ?? 0;
  const nextUp = priorities.filter((p) => p.fips !== focusFips);

  const panel = (
    <div className="space-y-6">
      {focus && idx.has(focus.fips) ? (
        <Decision
          county={focus}
          index={idx.get(focus.fips)!}
          latest={latest}
          priority={focusPriority}
          qty={qtyOf(qty, focus.fips)}
          onQty={(q) => setQty(focus.fips, q)}
          available={avail}
          busy={busy}
          onSend={() => send([focus.fips])}
          onSkip={focusPriority && focus.fips === top?.fips ? () => { setSkipped((x) => [...x, focus.fips]); setSelected(null); } : undefined}
          onClose={selected ? () => setSelected(null) : undefined}
        />
      ) : (
        <div>
          <span className="chip chip-green">all clear</span>
          <h2 className="display mt-2 text-[30px]">
            No county needs a <span className="accent text-[36px]">crew</span>
          </h2>
          <p className="mt-2 muted">
            Nothing is rated watch or higher right now. This list updates every time the forecast does.
            {live && " Live data is quiet, which is good news but a blank map. Load the demo outages to see the console with an active event."}
          </p>
          {live && hasDemo && (
            <button className="btn btn-ink mt-4" onClick={() => s.startDemo()}>
              <Play /> Load demo outages
            </button>
          )}
        </div>
      )}

      {statewide.map((m) => (
        <div key={m.id}>
          <p className="eyebrow !text-red">Statewide</p>
          <p className="mt-1 font-semibold">{m.title}</p>
          <p className="mt-1 text-[15px] muted">{m.detail}</p>
        </div>
      ))}

      {nextUp.length > 0 && (
        <section aria-label="Next up">
          <h3 className="eyebrow">Next up · {nextUp.length}</h3>
          <ul className="rows mt-1">
            {nextUp.slice(0, 6).map((p) => {
              const q = qtyOf(qty, p.fips);
              return (
                <li key={p.fips} className="flex items-center gap-3 py-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(p.fips)}>
                    <p className="truncate text-[18px] font-semibold tracking-tight">{p.county}</p>
                    <p className="truncate text-[13.5px] muted">
                      {p.status === "out" ? `${compact(p.out)} out` : `${pct(p.risk, 0)} ${p.status}`} · {p.nearest ? `${mins(p.nearest.eta_min)} from ${p.nearest.depot}` : "no crew free"} ·{" "}
                      {p.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, p.depart_by_min)}`}
                    </p>
                  </button>
                  <button className="btn btn-sm" onClick={() => send([p.fips])} disabled={busy || total(q) === 0}>
                    Send {total(q)}
                  </button>
                </li>
              );
            })}
          </ul>
          {nextUp.length > 6 && <p className="mt-1 text-[13px] text-ink3">and {nextUp.length - 6} more on the Teams tab</p>}
          <p className="mt-2 text-[12.5px] text-ink3">Each row sends what you set for that county, one line crew unless you open it and choose differently.</p>
        </section>
      )}

      <div className="border-t border-line pt-5">
        <Weather latest={latest} />
      </div>

      <p className="text-[12.5px] text-ink3">
        Forecasts come from weather and outage data. How many crews to send is your call: the app suggests where and when. Crews and depots are sample data until you edit them.
      </p>
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom))] md:h-[calc(100dvh-56px)] lg:grid lg:grid-cols-[minmax(0,1fr)_440px]">
      {/* map */}
      <section className="relative h-[calc(100%-250px)] min-w-0 overflow-hidden lg:h-full" aria-label="Outage map">
        {list ? (
          <div className="h-full bg-card p-4 pt-[116px]">
            <CountyList counties={counties} latest={latest} selected={selected} onSelect={(f) => { setSelected(f); setList(false); }} />
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

        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-2 pr-16">
          <div className="seg pointer-events-auto max-w-full overflow-x-auto">
            {LAYERS.filter((l) => !(live && l.id === "out")).map((l) => (
              <button key={l.id} onClick={() => setLayer(l.id)} aria-pressed={layer === l.id} className="whitespace-nowrap">
                {l.label}
              </button>
            ))}
          </div>
          <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto pb-1">
            <span className="pill whitespace-nowrap shadow-sm">
              Out now <b className="num text-[16px] text-ink">{live ? "no feed" : compact(latest.out_total)}</b>
            </span>
            <span className="pill whitespace-nowrap shadow-sm">
              Next 24 h <b className="num text-[16px] text-ink">≈{Math.round(latest.predict.expected_onsets[2])}</b> counties
            </span>
            <span className="pill whitespace-nowrap shadow-sm">
              Crews ready <b className="num text-[16px] text-ink">{avail.line}</b>
              {outUnits > 0 && <span className="text-ink3">· {outUnits} out</span>}
            </span>
          </div>
        </div>

        <div className="absolute bottom-3 left-3 hidden items-center gap-3 lg:flex">
          <Legend layer={layer} />
        </div>
        <button className="btn btn-sm absolute right-3 top-[168px] hidden lg:inline-flex" onClick={() => setList((v) => !v)} aria-pressed={list}>
          {list ? <MapIcon /> : <List />} {list ? "Map" : "List"}
        </button>
      </section>

      {/* desktop panel */}
      <aside className="scroll-thin hidden h-full overflow-y-auto border-l border-line bg-card p-5 lg:block" aria-label="Decision">
        {panel}
      </aside>

      {/* phone bottom sheet */}
      <div className="sheet absolute inset-x-0 bottom-0 z-20 flex flex-col lg:hidden" style={{ height: SNAPS[snap] }} role="region" aria-label="Decision">
        <div className="flex-none touch-none px-4 pb-1 pt-2" onPointerDown={grabDown} onPointerUp={grabUp}>
          <div className="grab mx-auto" />
          <p className="sr-only">Drag or tap to resize</p>
        </div>
        <div className={clsx("min-h-0 flex-1 px-4 pb-4", snap === 0 ? "overflow-hidden" : "scroll-thin overflow-y-auto")}>{panel}</div>
      </div>
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
    <ul className="pill gap-3 shadow-sm">
      {items.map((i) => (
        <li key={i.t} className="flex items-center gap-1.5 text-[13px]">
          <span className="h-3 w-3 rounded-sm border border-line2" style={{ background: i.c }} aria-hidden />
          {i.t}
        </li>
      ))}
    </ul>
  );
}

function Empty({ onBack }: { onBack?: () => void }) {
  const { scenarios, start: startRaw, startDemo, state } = useStore();
  const start = (k: string) => {
    startRaw(k);
    onBack?.();
  };
  const demo = scenarios.some((x) => x.key !== "live");
  return (
    <div className="mx-auto grid min-h-[calc(100dvh-56px-64px)] max-w-4xl place-items-center px-5 py-10">
      <div className="w-full">
        <p className="eyebrow flex items-center gap-2">
          <span className="dot" /> Texas power outage response
        </p>
        <h1 className="display mt-4 text-[clamp(44px,9vw,92px)]">
          See where it goes dark <span className="accent text-[1.1em]">next.</span>
        </h1>
        <p className="mt-5 max-w-xl text-[19px] leading-snug text-ink2">
          Counties ranked by outage risk, the nearest crew, and when to leave. You decide how many to send, and one tap sends them. Demo outages are recorded events. Live shows today's weather and grid, and is usually quiet.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          {demo && (
            <button className="btn btn-ink" onClick={() => { void startDemo(); onBack?.(); }}>
              <Play /> Load demo outages
            </button>
          )}
          <button className="btn !min-h-[var(--tap)] !text-[17px]" onClick={() => start("live")}>
            <Radio /> Go live
          </button>
        </div>
        {onBack && (
          <button className="btn mt-3" onClick={onBack}>
            <MapIcon /> Back to the map
          </button>
        )}
        {state?.scenario && <p className="mt-4 text-[14px] muted">Waiting for the first update…</p>}
      </div>
    </div>
  );
}
