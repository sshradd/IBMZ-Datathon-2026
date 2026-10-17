import { AlertTriangle, List, Map as MapIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CountyList from "../components/CountyList.jsx";
import CountyMap from "../components/CountyMap.jsx";
import Decision from "../components/Decision.jsx";
import Statewide from "../components/Statewide.jsx";
import Weather from "../components/Weather.jsx";
import { orderOf, qtyOf, total } from "../lib/decisions.js";
import { clock, compact, departBy, mins, pct } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";

const LAYERS = [
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
  const { latest, plan, counties, ops, tiers, selected, setSelected, qty, setQty, series } = s;
  const [layer, setLayer] = useState("p24");
  const [list, setList] = useState(false);
  const [skipped, setSkipped] = useState([]);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(0);

  // first open with nothing running: load the recorded outages so the map is never empty
  const autoStarted = useRef(false);
  const hasDemo = s.scenarios.some(x => x.key !== "live");
  useEffect(() => {
    // wait until the server has said whether a session is already running, so a second page never restarts it
    if (autoStarted.current || latest || !s.state || s.state.scenario || !hasDemo) return;
    autoStarted.current = true;
    s.startDemo();
  }, [latest, s, hasDemo]);

  const priorities = useMemo(() => (plan?.priorities ?? []).filter(p => !skipped.includes(p.fips)), [plan, skipped]);
  const top = priorities[0];
  const focusFips = selected ?? top?.fips ?? null;
  const idx = useMemo(() => new Map(counties.map((c, i) => [c.fips, i])), [counties]);
  const byFips = useMemo(() => new Map(counties.map(c => [c.fips, c])), [counties]);
  const focus = focusFips ? counties.find(c => c.fips === focusFips) : undefined;
  const focusPriority = focusFips ? plan?.priorities.find(p => p.fips === focusFips) : undefined;

  const links = useMemo(() => {
    const out = [];
    if (focusPriority?.nearest && focus) out.push({ id: `plan-${focus.fips}`, depot: focusPriority.nearest.depot, lat: focus.lat, lon: focus.lon, eta: focusPriority.nearest.eta_min });
    const depotById = new Map((ops?.depots ?? []).map(d => [d.id, d]));
    for (const u of ops?.units ?? []) {
      if (u.status !== "en_route" || !u.assignment) continue;
      const c = byFips.get(u.assignment.fips);
      const d = depotById.get(u.depot);
      if (c && d) out.push({ id: u.id, depot: d.name, lat: c.lat, lon: c.lon, planned: true });
    }
    return out;
  }, [focus, focusPriority, ops, byFips]);

  // drag the sheet handle: a tap cycles, a drag up or down moves one step
  const dragY = useRef(null);
  const grabDown = e => {
    dragY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const grabUp = e => {
    if (dragY.current == null) return;
    const dy = e.clientY - dragY.current;
    dragY.current = null;
    if (Math.abs(dy) < 8) setSnap(v => (v + 1) % SNAPS.length);
    else setSnap(v => Math.min(SNAPS.length - 1, Math.max(0, v + (dy < 0 ? 1 : -1))));
  };

  if (!latest) return <div className="start"><p className="muted">Loading the forecast…</p></div>;

  const now = latest.as_of ?? latest.t;
  const live = !!latest.live;
  const avail = {
    line: plan?.totals.line.available ?? 0,
    shelter: plan?.totals.shelter.available ?? 0,
    outreach: plan?.totals.outreach.available ?? 0,
  };
  const addToPlan = async fips => {
    setBusy(true);
    try {
      const orders = fips.map(f => plan?.priorities.find(p => p.fips === f)).filter(Boolean).map(p => orderOf(p, qty));
      const direct = fips.filter(f => !orders.some(o => o.fips === f)).map(f => ({ fips: f, ...qtyOf(qty, f) }));
      await s.dispatch([...orders, ...direct].filter(o => o.line + o.shelter + o.outreach > 0));
    } finally {
      setBusy(false);
    }
  };
  const statewide = latest.prescribe.moves.filter(m => m.kind === "statewide");
  const outUnits = ops?.units.filter(u => u.status === "en_route" || u.status === "on_site").length ?? 0;
  const nextUp = priorities.filter(p => p.fips !== focusFips);
  const [, watchN, prepareN, actN] = latest.tier_counts;
  const headline = actN > 0 ? `${actN} ${actN === 1 ? "county" : "counties"} rated act` : prepareN > 0 ? `${prepareN} ${prepareN === 1 ? "county" : "counties"} rated prepare` : watchN > 0 ? `${watchN} on watch` : "No county rated watch or higher";
  const sc = latest.describe.scorecard;

  const strip = (
    <dl className="kpis" aria-label="Statewide numbers">
      <Kpi label="Counties flagged" value={actN + prepareN + watchN}><b className="red">{actN} act</b> · {prepareN} prepare · {watchN} watch</Kpi>
      <Kpi label="Customers out" value={live ? "no feed" : compact(latest.out_total)}>{live ? "live has no county outage feed" : `${compact(latest.predict.customers_exposed)} more at risk`}</Kpi>
      <Kpi label="Seniors at risk" value={compact(latest.predict.seniors_exposed)}>aged 65+ in flagged counties</Kpi>
      <Kpi label="Crews free" value={avail.line}>{outUnits > 0 ? `${outUnits} in the plan` : "line crews, none in plan"}</Kpi>
    </dl>
  );

  const panel = (
    <div className="panel">
      {focus && idx.has(focus.fips) ? (
        <Decision
          county={focus}
          index={idx.get(focus.fips)}
          latest={latest}
          priority={focusPriority}
          qty={qtyOf(qty, focus.fips)}
          onQty={q => setQty(focus.fips, q)}
          available={avail}
          busy={busy}
          onSend={() => addToPlan([focus.fips])}
          onSkip={focusPriority && focus.fips === top?.fips ? () => { setSkipped(x => [...x, focus.fips]); setSelected(null); } : undefined}
          onClose={selected ? () => setSelected(null) : undefined}
        />
      ) : !plan ? (
        <p className="muted">Loading the plan…</p>
      ) : (
        <div>
          <span className="chip chip-green">all clear</span>
          <h2 className="dec-h">No county needs a <span className="accent">crew</span></h2>
          <p className="muted mt-s">
            Nothing is rated watch or higher right now. This list updates every time the forecast does.
            {live && " Live data is quiet, which is good news but a blank map."}
          </p>
        </div>
      )}

      {statewide.map(m => (
        <div key={m.id}>
          <p className="eyebrow red">Statewide</p>
          <p className="mt-xs"><b>{m.title}</b></p>
          <p className="muted sm mt-xs">{m.detail}</p>
        </div>
      ))}

      <div className="show-below-lg">{strip}</div>

      <div className="divide">
        <Statewide latest={latest} counties={counties} series={series} selected={selected} onSelect={setSelected} />
      </div>

      {nextUp.length > 0 && (
        <section aria-label="Next up">
          <h3 className="eyebrow">Next up · {nextUp.length}</h3>
          <ul className="rows mt-xs">
            {nextUp.slice(0, 6).map(p => {
              const q = qtyOf(qty, p.fips);
              return (
                <li key={p.fips} className="next-row">
                  <button className="next-main" onClick={() => setSelected(p.fips)}>
                    <b>{p.county}</b>
                    <small>
                      {p.status === "out" ? `${compact(p.out)} out` : `${pct(p.risk, 0)} ${p.status}`} · {p.nearest ? `${mins(p.nearest.eta_min)} from ${p.nearest.depot}` : "no crew free"} ·{" "}
                      {p.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, p.depart_by_min)}`}
                    </small>
                  </button>
                  <button className="btn" onClick={() => addToPlan([p.fips])} disabled={busy || total(q) === 0}>Add {total(q)}</button>
                </li>
              );
            })}
          </ul>
          {nextUp.length > 6 && <p className="faint sm mt-xs">and {nextUp.length - 6} more on the Teams tab</p>}
          <p className="faint xs mt-s">Each row adds what you set for that county to the plan, one line crew unless you open it and choose differently.</p>
        </section>
      )}

      <div className="divide"><Weather latest={latest} /></div>

      <p className="faint xs">
        Forecasts come from weather and outage data. The app recommends where and when. How many crews to commit, and the dispatch itself, are yours. Crews and depots are sample data until you edit them.
      </p>
    </div>
  );

  return (
    <div className="outages">
      <section className="status" aria-label="Statewide status">
        <div className="st-ic"><AlertTriangle size={22} /></div>
        <div className="st-t"><small>Statewide status</small><h2>{headline}</h2></div>
        <p>{live ? "Live weather and grid data. Live mode has no county outage feed." : `Peak window ${latest.predict.peak_window}. ${compact(latest.out_total)} customers out now.`}</p>
        <div className="st-r">
          {sc?.warned_pct != null && !live && <>Warned first <b>{Math.round(sc.warned_pct)}%</b><span className="sep" /></>}
          As of <b>{live && latest.as_of ? clock(latest.as_of) : clock(now)}</b>
        </div>
      </section>
      <div className="hide-below-lg strip-wrap">{strip}</div>

      <div className="stage">
        <section className="map-area" aria-label="Outage map">
          {list ? (
            <div className="list-pane"><CountyList counties={counties} latest={latest} selected={selected} onSelect={f => { setSelected(f); setList(false); }} /></div>
          ) : (
            <CountyMap
              latest={latest} counties={counties} layer={layer} tiers={tiers} selected={selected} onSelect={setSelected}
              depots={ops?.depots ?? []} lines={links} staging={plan?.staging.sites.slice(0, 1) ?? []} beacon={top ? [top.fips] : []}
              bottomPad={typeof window !== "undefined" && window.innerWidth < 1024 ? 300 : 60}
            />
          )}

          <div className="map-over">
            <div className="seg-wrap">
              <div className="seg">
                {LAYERS.filter(l => !(live && l.id === "out")).map(l => (
                  <button key={l.id} onClick={() => setLayer(l.id)} aria-pressed={layer === l.id}>{l.label}</button>
                ))}
              </div>
            </div>
            <div className="pills">
              <span className="pill">Out now <b>{live ? "no feed" : compact(latest.out_total)}</b></span>
              <span className="pill">Next 24 h <b>≈{Math.round(latest.predict.expected_onsets[2])}</b> counties</span>
              <span className="pill">Crews free <b>{avail.line}</b>{outUnits > 0 && <span className="faint">· {outUnits} in plan</span>}</span>
            </div>
          </div>

          <div className="map-bl">
            <button className="btn sm" onClick={() => setList(v => !v)} aria-pressed={list}>{list ? <MapIcon size={16} /> : <List size={16} />} {list ? "Map" : "List"}</button>
            <div className="hide-below-lg"><Legend layer={layer} /></div>
          </div>
        </section>

        <aside className="side" aria-label="Decision">{panel}</aside>

        <div className="sheet" style={{ height: SNAPS[snap] }} role="region" aria-label="Decision">
          <div className="grab-area" onPointerDown={grabDown} onPointerUp={grabUp}>
            <div className="grab" />
            <p className="sr-only">Drag or tap to resize</p>
          </div>
          <div className={`sheet-body ${snap === 0 ? "clip" : ""}`}>{panel}</div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, children }) {
  return (
    <div className="kpi">
      <dt className="eyebrow">{label}</dt>
      <dd>{value}</dd>
      <p>{children}</p>
    </div>
  );
}

function Legend({ layer }) {
  const items =
    layer === "out"
      ? [{ c: "var(--tier-3)", t: "severe outage" }, { c: "var(--tier-2)", t: "some customers out" }, { c: "var(--tier-0)", t: "power on" }]
      : layer === "nws"
        ? [{ c: "var(--tier-2)", t: "active NWS alert" }, { c: "var(--tier-0)", t: "none" }]
        : [{ c: "var(--tier-1)", t: "watch" }, { c: "var(--tier-2)", t: "prepare" }, { c: "var(--tier-3)", t: "act" }];
  return (
    <ul className="legend">
      {items.map(i => (
        <li key={i.t}><i style={{ background: i.c }} aria-hidden />{i.t}</li>
      ))}
    </ul>
  );
}
