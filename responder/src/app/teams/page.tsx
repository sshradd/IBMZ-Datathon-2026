"use client";

import clsx from "clsx";
import { Copy, MapPin, Plus, Share2, Undo2 } from "lucide-react";
import { useState } from "react";
import Stepper from "@/components/Stepper";
import { orderOf, qtyOf, total } from "@/lib/decisions";
import { clock, compact, dayClock, departBy, mins, pct } from "@/lib/format";
import { orderFor } from "@/lib/orders";
import { copyText, shareText } from "@/lib/share";
import { useStore } from "@/lib/store";
import type { Priority, Unit } from "@/lib/types";

const TYPE_LABEL = { line: "Line crews", shelter: "Shelter teams", outreach: "Outreach teams" } as const;

export default function Teams() {
  const s = useStore();
  const { plan, ops, latest, qty, setQty } = s;
  const [busy, setBusy] = useState(false);
  const now = latest?.as_of ?? latest?.t ?? "";

  const addToPlan = async (ps: Priority[]) => {
    setBusy(true);
    try {
      await s.dispatch(ps.map((p) => orderOf(p, qty)).filter((o) => o.line + o.shelter + o.outreach > 0));
    } finally {
      setBusy(false);
    }
  };

  if (!ops) return <div className="p-6 text-[15px] muted">Loading crews…</div>;
  const out = ops.units.filter((u) => u.status === "en_route" || u.status === "on_site");
  const tot = plan?.totals;
  const planText =
    `RECOMMENDED PLAN · Texas power outage response${latest ? ` · ${dayClock(latest.as_of ?? latest.t)} CST` : ""}\n\n` +
    out.map((u) => orderFor(u, s.counties, ops.depots, now)?.text ?? "").filter(Boolean).join("\n\n") +
    "\n\nRecommendations only. Nothing was dispatched by this app.";
  const list = plan?.priorities.slice(0, 25) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <header>
        <p className="eyebrow">Teams</p>
        <h1 className="display mt-2 text-[clamp(34px,6vw,56px)]">
          The <span className="accent text-[1.1em]">plan</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-snug text-ink2">
          Counties are ranked from weather and outage data. For each one the app recommends the nearest free crew and shows the drive time. You choose how many crews to add to the plan, then copy or share it. This app recommends only: your own dispatch system sends the crews. Crews and depots are sample data.
        </p>
      </header>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-line border-y border-line">
        {(["line", "shelter", "outreach"] as const).map((t) => (
          <div key={t} className="px-4 py-4 first:pl-0">
            <dt className="eyebrow">{TYPE_LABEL[t]}</dt>
            <dd className="num mt-2 text-[44px]">
              {tot ? tot[t].available : "—"}
              <span className="ml-1.5 text-[16px] font-medium tracking-normal text-ink3">free</span>
            </dd>
            <p className="mono mt-1 text-[11.5px] text-ink3">{tot ? `${tot[t].en_route + tot[t].on_site} in plan · ${tot[t].total} in all` : "no forecast yet"}</p>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-label="Priority counties">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow flex-1">Priority counties · {list.length}</h2>
            <button className="btn btn-sm" onClick={() => addToPlan(list.slice(0, 5))} disabled={busy || !list.length} title="Adds what is set on each of the top five rows to the plan">
              <Plus /> Add top 5 to plan
            </button>
          </div>
          {!list.length && <p className="py-6 text-[15px] muted">{latest ? "No county is rated watch or higher right now." : "Go live or load demo outages to see the ranking."}</p>}
          <ul className="rows mt-1">
            {list.map((p) => {
              const q = qtyOf(qty, p.fips);
              return (
                <li key={p.fips} className="py-4">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-[24px] font-bold leading-none tracking-tight">{p.county}</span>
                        <span className={clsx("chip", p.status === "out" || p.status === "act" ? "chip-red" : p.status === "prepare" ? "chip-amber" : "")}>{p.status === "out" ? "power out" : p.status}</span>
                      </p>
                      <p className="mt-1.5 text-[14.5px] muted">
                        {p.status === "out" ? `${compact(p.out)} customers out` : `${pct(p.risk, 0)} risk, ${p.window}`} · {compact(p.seniors_exposed)} seniors
                      </p>
                      <p className="text-[14px] text-ink3">
                        {p.nearest ? `nearest ${p.nearest.depot}, drive ${mins(p.nearest.eta_min)}` : "no crew free"} · {p.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, p.depart_by_min)}`}
                      </p>
                    </div>
                    <div className="flex w-full items-center gap-3 sm:w-auto">
                      <Stepper bare label="Line crews" value={q.line} onChange={(n) => setQty(p.fips, { ...q, line: n })} max={tot?.line.available ?? 0} />
                      <button className="btn btn-ink !min-h-12 flex-1 sm:flex-none" onClick={() => addToPlan([p])} disabled={busy || total(q) === 0}>
                        Add {total(q) || ""}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-10">
          <section aria-label="Recommended plan">
            <div className="flex items-center gap-2">
              <h2 className="eyebrow flex-1">Recommended plan · {out.length}</h2>
              {out.length > 0 && (
                <>
                  <button className="btn btn-sm" onClick={async () => s.say((await copyText(planText)) ? "Plan copied" : "Could not copy")}>
                    <Copy /> Copy plan
                  </button>
                  <button className="btn btn-sm" onClick={() => shareText("Recommended plan", planText, s.say)}>
                    <Share2 /> Share
                  </button>
                </>
              )}
            </div>
            {out.length === 0 ? (
              <p className="py-3 text-[15px] muted">Nothing in the plan yet. Add crews from the list and they appear here as recommendations you can copy or share.</p>
            ) : (
              <ul className="rows mt-1">
                {out.map((u) => (
                  <FieldRow key={u.id} u={u} now={now} />
                ))}
              </ul>
            )}
          </section>

          {plan && plan.staging.sites.length > 0 && (
            <section aria-label="Staging advisor">
              <h2 className="eyebrow">Where to stage</h2>
              <p className="mt-2 text-[15px] muted">Forward yards that cut the average drive to the highest-priority counties, from {mins(plan.staging.baseline_eta_min ?? 0)} today.</p>
              <ol className="rows mt-1">
                {plan.staging.sites.map((st, i) => (
                  <li key={st.name} className="flex items-center gap-3 py-3">
                    <span className="mono grid h-8 w-8 flex-none place-items-center rounded-full border border-line2 text-[13px]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{st.name}</p>
                      <p className="text-[13.5px] muted">average drive {mins(st.avg_eta_min)}</p>
                    </div>
                    <span className="chip chip-green">−{st.saves_min} min</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <MutualAid />
        </div>
      </div>

      <section className="mt-12" aria-label="Roster">
        <h2 className="eyebrow">Roster by depot</h2>
        <p className="mt-2 text-[15px] muted">Tap + or − to change how many units a depot has. Units already in the plan stay in it.</p>
        <div className="mt-3 grid gap-x-10 md:grid-cols-2 xl:grid-cols-3">
          {ops.depots.map((d) => (
            <div key={d.id} className="border-t border-line py-4">
              <p className="text-[20px] font-bold tracking-tight">{d.name}</p>
              <div className="mt-3 space-y-3">
                {(["line", "shelter", "outreach"] as const).map((t) => (
                  <Stepper key={t} label={TYPE_LABEL[t]} value={d.units[t]} note={`${d.available[t]} free`} onChange={(n) => s.setUnitCount(d.id, t, n)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FieldRow({ u, now }: { u: Unit; now: string }) {
  const s = useStore();
  const o = s.ops ? orderFor(u, s.counties, s.ops.depots, now) : null;
  const a = u.assignment;
  return (
    <li className="py-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{u.name}</span> <span className="text-ink3">→ {a?.county}</span>
        </p>
        <span className="chip">{a ? (a.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, a.depart_by_min)}`) : "planned"}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => s.setUnitStatus(u.id, "available")}>
          <Undo2 /> Remove from plan
        </button>
        {o && (
          <>
            <button className="btn btn-sm" onClick={async () => s.say((await copyText(o.text)) ? "Recommendation copied" : "Could not copy")}>
              <Copy /> Copy
            </button>
            <button className="btn btn-sm" onClick={() => shareText(`Recommendation ${u.name}`, o.text, s.say)}>
              <Share2 /> Share
            </button>
            <a className="btn btn-sm" href={o.maps} target="_blank" rel="noreferrer">
              <MapPin /> Navigate
            </a>
          </>
        )}
      </div>
    </li>
  );
}

/** A request you write yourself: you say how much help you want, the app fills in the rest. */
function MutualAid() {
  const s = useStore();
  const [want, setWant] = useState({ line: 0, shelter: 0, outreach: 0 });
  const top = (s.plan?.priorities ?? []).slice(0, 6);
  const asked = [
    want.line && `${want.line} line crew${want.line === 1 ? "" : "s"}`,
    want.shelter && `${want.shelter} shelter team${want.shelter === 1 ? "" : "s"}`,
    want.outreach && `${want.outreach} outreach team${want.outreach === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const when = s.latest ? dayClock(s.latest.as_of ?? s.latest.t) : "";
  const text =
    `MUTUAL AID REQUEST · Texas power outage response${when ? ` · ${when} CST` : ""}\n\n` +
    `We are requesting: ${asked.length ? asked.join(", ") : "[set how much help you need]"}.\n\n` +
    (top.length ? `Highest priority counties: ${top.map((p) => p.county).join(", ")}.\n` : "") +
    (s.latest ? `Customers out now: ${s.latest.live ? "no live feed" : s.latest.out_total.toLocaleString()}.\n` : "") +
    "Staging and contact details to follow. Please confirm availability and arrival time.";
  return (
    <section aria-label="Ask for help">
      <h2 className="eyebrow">Ask for mutual aid</h2>
      <p className="mt-2 text-[15px] muted">You say how much help to ask for. The app writes the request.</p>
      <div className="mt-3 space-y-3">
        <Stepper label="Line crews" value={want.line} onChange={(n) => setWant({ ...want, line: n })} />
        <Stepper label="Shelter teams" value={want.shelter} onChange={(n) => setWant({ ...want, shelter: n })} />
        <Stepper label="Outreach teams" value={want.outreach} onChange={(n) => setWant({ ...want, outreach: n })} />
      </div>
      <pre className="mono scroll-thin mt-4 max-h-36 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-card2 p-3 text-[12.5px]">{text}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-ink" disabled={!asked.length} onClick={() => shareText("Mutual aid request", text, s.say)}>
          <Share2 /> Send request
        </button>
        <button className="btn" onClick={async () => s.say((await copyText(text)) ? "Request copied" : "Could not copy")}>
          <Copy /> Copy
        </button>
      </div>
    </section>
  );
}

void clock;
