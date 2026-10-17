import { useMemo, useState } from "react";
import { Zap, Download, Menu, AlertTriangle, Clock, Map as MapIcon, Users, Hospital, Truck,
  Building2, Droplets, ShieldCheck, Radio, Printer, ChevronRight, ArrowRight, Filter, Activity } from "lucide-react";
import CountyMap, { riskColor, ramp } from "./components/CountyMap.jsx";
import { counties, summary, actions, facilityStats } from "./data.js";
import { allocate, slotLabel } from "./lib/dispatch.js";
import { buildSms, sendSms, downloadBriefPdf } from "./lib/briefing.js";

const fmt = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : n);
const tier = r => (r >= 80 ? ["Act now", "crit"] : r >= 50 ? ["Prepare", "warn"] : ["Monitor", "ok"]);
const facIcons = { hospitals: Hospital, care: Building2, water: Droplets, warming: ShieldCheck };

export default function App() {
  const [mode, setMode] = useState("Risk");
  const [selected, setSelected] = useState(null);
  const [assigned, setAssigned] = useState(new Set());
  const [sms, setSms] = useState(null);

  const ranked = useMemo(() => [...counties].sort((a, b) => b.risk - a.risk), []);
  const { plan, crewsCommitted, crewsLeft } = useMemo(
    () => allocate(actions, { crewsAvailable: summary.crewsAvailable }), []);
  const pct = Math.round((summary.crewsAvailable / summary.crewsTotal) * 100);
  const sel = selected || ranked[0];

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><div className="logo"><Zap size={20} /></div><b>CATCH</b><span>Grid Resilience Command</span></div>
        <div className="top-r">
          <span className="live"><i /> Live</span>
          <button className="icon-btn" aria-label="Menu"><Menu size={20} /></button>
          <button className="btn primary" aria-label="Generate briefing" onClick={() => downloadBriefPdf(summary, ranked, plan)}><Download size={18} /> <span className="lbl">Generate briefing</span></button>
        </div>
      </header>

      <section className="status">
        <div className="st-ic"><AlertTriangle size={22} /></div>
        <div className="st-t"><small>Regional grid status</small><h2>{summary.status}</h2></div>
        <p>{summary.note}</p>
        <div className="st-r"><Clock size={16} /> Updated {summary.updated}<span className="sep" />Model confidence <b>{summary.confidence}%</b></div>
      </section>

      <main>
        <small className="eyebrow">Operations overview</small>
        <h1>Good afternoon, <span className="accent">Regional Ops</span></h1>
        <p className="sub">Prioritized actions for {new Date().toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>

        <div className="kpis">
          <Kpi icon={<MapIcon />} tone="red" label="Counties at risk" value={ranked.length}>
            <span><b className="red">{ranked.filter(c => c.risk >= 80).length} critical</b> · {ranked.filter(c => c.risk < 80).length} elevated</span>
          </Kpi>
          <Kpi icon={<Users />} tone="amber" label="People exposed" value={fmt(summary.peopleExposed)}>
            <span><b className="red">+{fmt(summary.peopleDelta)}</b> since last hour</span>
          </Kpi>
          <Kpi icon={<Hospital />} tone="blue" label="Critical facilities" value={summary.criticalFacilities}>
            <span>{summary.hospitals} hospitals · {summary.careSites} care sites</span>
          </Kpi>
          <Kpi icon={<Truck />} tone="green" label="Response capacity" value={`${summary.crewsAvailable} / ${summary.crewsTotal}`}
            ring={pct}><span>Crews available now</span></Kpi>
        </div>

        <section className="card">
          <div className="card-h"><div><h3>County risk ranking</h3><p>Prioritized by predicted harm per crew-hour</p></div>
            <button className="btn ghost"><Filter size={16} /> Filter</button></div>
          <div className="split">
            <div className="map-wrap">
              <div className="seg">{["Risk", "Exposure", "Coverage"].map(m =>
                <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>{m}</button>)}</div>
              <CountyMap counties={counties} selected={selected} highlightId={sel.id} onSelect={setSelected} mode={mode} />
              <div className="map-pop"><div><b>{sel.name} County</b><small>Risk {sel.delta >= 0 ? "increased" : "fell"} {sel.delta > 0 ? "+" : ""}{sel.delta}% in 90 min</small></div><strong style={{ color: riskColor(sel.risk) === ramp[0] ? "var(--ink)" : riskColor(sel.risk) }}>{sel.risk}</strong></div>
              <div className="legend">Lower {ramp.map(c => <i key={c} style={{ background: c }} />)} Critical</div>
            </div>
            <table>
              <thead><tr><th>Rank / county</th><th>Risk</th><th>Exposure</th><th>Action</th></tr></thead>
              <tbody>{ranked.map((c, i) => { const [label, cls] = tier(c.risk); return (
                <tr key={c.id} className={c.id === sel.id ? "sel" : ""} tabIndex={0} aria-selected={c.id === sel.id}
                  onClick={() => setSelected(c)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(c); } }}>
                  <td><span className="rank">{i + 1}</span><b>{c.name}</b><small>{c.crewHours} crew-hours</small></td>
                  <td><b className={cls}>{c.risk}</b><small>{c.delta > 0 ? "+" : ""}{c.delta}%</small></td>
                  <td><b>{fmt(c.exposure)}</b><small>{c.sites} sites</small></td>
                  <td><span className={`pill ${cls}`}>{label} <ChevronRight size={14} /></span></td>
                </tr>); })}</tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>Recommended dispatch <span className="badge"><Activity size={13} /> Optimized</span></h3>
            <p>Ordered by harm prevented per crew-hour</p></div><a className="link">View plan <ArrowRight size={16} /></a></div>
          {plan.map((a, i) => (
            <div className="dispatch" key={a.id}>
              <span className={`num n${Math.min(i, 2)}`}>{i + 1}</span>
              <div><small className={i < 2 ? "red" : ""}>{slotLabel(i)}</small><h4>{a.title}</h4><p>{a.where}</p>
                <div className="meta"><span><Users size={15} /> {a.people.toLocaleString()} people</span>
                  <span><Building2 size={15} /> {a.facilities} facilities</span>
                  <span><Clock size={15} /> {a.cost} {a.kind === "crew" ? "crew-hrs" : "staff-hrs"}</span></div></div>
              <button className={`btn ghost ${assigned.has(a.id) ? "done" : ""}`}
                onClick={() => setAssigned(new Set(assigned).add(a.id))}>{assigned.has(a.id) ? "Assigned ✓" : "Assign"}</button>
            </div>))}
          <div className="cap"><div><small>Crew capacity after plan</small><b>{crewsCommitted} crews committed · {crewsLeft} available</b></div>
            <div className="bar"><i style={{ width: `${(crewsCommitted / summary.crewsAvailable) * 100}%` }} /></div></div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>Critical-facility exposure</h3><p>Public aggregate data · verified 13:45</p></div>
            <a className="link">Explore facilities <ArrowRight size={16} /></a></div>
          <div className="fac">{facilityStats.map(f => { const I = facIcons[f.key]; return (
            <div key={f.key}><span className={`fi ${f.key}`}><I size={20} /></span><p><b>{f.n}</b> {f.label}</p><small>{f.sub}</small></div>); })}</div>
        </section>

        <section className="card offline">
          <div className="off-ic"><Radio size={40} /></div>
          <div><small className="eyebrow">Built for degraded comms</small><h3>Briefings that work <span className="accent">offline</span></h3>
            <p>Export a one-page field brief or send an SMS-length action summary.</p></div>
          <div className="off-btns">
            <button className="btn ghost" onClick={() => downloadBriefPdf(summary, ranked, plan)}><Printer size={18} /> Print brief</button>
            <button className="btn primary" onClick={() => setSms(buildSms(summary, ranked, plan))}><Radio size={18} /> SMS summary</button>
          </div>
        </section>
        {sms && <div className="sms"><p>{sms}</p><small>{sms.length} chars</small>
          <button className="btn ghost" onClick={() => navigator.clipboard.writeText(sms)}>Copy</button>
          <button className="btn primary" onClick={() => sendSms(sms)}>Open in Messages</button></div>}
      </main>
    </div>
  );
}

function Kpi({ icon, tone, label, value, children, ring }) {
  return (<div className="kpi"><span className={`ki ${tone}`}>{icon}</span>
    <div><p>{label}</p><b>{value}</b>{children}</div>
    {ring != null && <div className="ring" style={{ "--p": ring }}><span>{ring}%</span></div>}</div>);
}
