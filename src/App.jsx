import { useEffect, useMemo, useState } from "react";
import { Zap, Download, Clock, Map as MapIcon, Users, Hospital, Truck,
  Building2, Droplets, ShieldCheck, ChevronRight, Activity, FileText, Eye } from "lucide-react";
import CountyMap, { riskColor } from "./components/CountyMap.jsx";
import ModeDock from "./components/AppDock.jsx";
import { counties, summary, actions, facilityStats, people } from "./data.js";
import { allocate, slotLabel } from "./lib/dispatch.js";
import { downloadBriefPdf } from "./lib/briefing.js";
import { sendAssignment, findCounty, buildBlurb, makeAssignmentPdf } from "./lib/assign.js";
import { loadLiveData } from "./lib/liveData.js";

const fmt = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : n);
const liveRefreshMs = Math.max(60000, Number(import.meta.env.VITE_LIVE_REFRESH_MS || 300000));
const tier = r => (r >= 80 ? ["Act now", "crit"] : r >= 50 ? ["Prepare", "warn"] : ["Monitor", "ok"]);
const facIcons = { hospitals: Hospital, care: Building2, water: Droplets, warming: ShieldCheck };

export default function App() {
  const [mode, setMode] = useState("Risk");
  const [selected, setSelected] = useState(null);
  const [assigned, setAssigned] = useState({}); // actionId -> { personIds, note, fileName }
  const [openId, setOpenId] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [liveError, setLiveError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => loadLiveData()
      .then(data => {
        if (active) {
          setLiveData(data);
          setLiveError("");
        }
      })
      .catch(error => {
        if (active) setLiveError(error.message);
      });
    refresh();
    const timer = window.setInterval(refresh, liveRefreshMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const liveCounties = liveData?.counties || counties;
  const liveSummary = useMemo(() => {
    if (!liveData) return summary;
    const critical = liveCounties.filter(c => c.risk >= 80).length;
    const totalAssigned = liveCounties.reduce((total, county) => total + county.assignedCrews, 0);
    return {
      ...summary,
      status: critical ? "Severe cascade risk" : "Elevated grid risk",
      note: liveData.note || summary.note,
      updated: liveData.generatedAt ? new Date(liveData.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : summary.updated,
      crewsAvailable: Math.max(0, summary.crewsAvailable - totalAssigned),
    };
  }, [liveData, liveCounties]);
  const ranked = useMemo(() => [...liveCounties].sort((a, b) => b.risk - a.risk), [liveCounties]);
  const { plan, crewsCommitted, crewsLeft } = useMemo(
    () => allocate(actions, { crewsAvailable: liveSummary.crewsAvailable }), [liveSummary.crewsAvailable]);
  const pct = Math.round((liveSummary.crewsAvailable / liveSummary.crewsTotal) * 100);
  const sel = selected || ranked[0];

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><div className="logo"><Zap size={22} /></div><b>SURGE</b><span>Grid Resilience Command</span></div>
        <div className="top-r">
          <span className="live"><i /> LIVE</span>
          <button className="btn primary" onClick={() => downloadBriefPdf(liveSummary, ranked, plan)}><Download size={18} /> Generate briefing</button>
        </div>
      </header>

      <main>
        <small className="eyebrow">OPERATIONS OVERVIEW</small>
        <h1>Good afternoon, Regional Ops</h1>
        <p className="sub">Prioritized actions for {new Date().toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        {liveData && <p className="live-source">Live data: {liveData.source} · generated {liveSummary.updated} · fetched {new Date(liveData.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · refreshes every {Math.round(liveRefreshMs / 60000)} min</p>}
        {liveError && <p className="live-source error">Live data unavailable; showing fallback data. {liveError}</p>}

        <div className="kpis">
          <Kpi icon={<MapIcon />} tone="red" label="Counties at risk" value={ranked.length}>
            <span><b className="red">{ranked.filter(c => c.risk >= 80).length} critical</b> · {ranked.filter(c => c.risk < 80).length} elevated</span>
          </Kpi>
          <Kpi icon={<Users />} tone="amber" label="People exposed" value={fmt(liveSummary.peopleExposed)}>
            <span><b className="red">+{fmt(liveSummary.peopleDelta)}</b> since last hour</span>
          </Kpi>
          <Kpi icon={<Hospital />} tone="blue" label="Critical facilities" value={liveSummary.criticalFacilities}>
            <span>{liveSummary.hospitals} hospitals · {liveSummary.careSites} care sites</span>
          </Kpi>
          <Kpi icon={<Truck />} tone="green" label="Response capacity" value={`${liveSummary.crewsAvailable} / ${liveSummary.crewsTotal}`}
            ring={pct}><span>Crews available now</span></Kpi>
        </div>

        <section className="card">
          <div className="card-h"><div><h3>County risk ranking</h3><p>Prioritized by predicted harm per crew-hour</p></div></div>
          <div className="map-bar">
            <div className="key">
              <span className="key-title">{mode} level</span>
              {[["#5fd3b0", "Low · under 50"], ["#ffc247", "Moderate · 50–64"], ["#ff8a3d", "High · 65–79"], ["#ff4d4d", "Critical · 80+"]].map(([c, l]) =>
                <span key={l} className="key-item"><i style={{ background: c }} />{l}</span>)}
            </div>
          </div>
          <div className="split">
            <div className="map-wrap">
              <CountyMap counties={counties} selected={selected} onSelect={setSelected} mode={mode} />
              <ModeDock mode={mode} setMode={setMode} />
              <div className="map-pop"><div><b>{sel.name} County</b><small>Risk {sel.delta >= 0 ? "increased" : "fell"} {sel.delta > 0 ? "+" : ""}{sel.delta}% in 90 min</small></div><strong style={{ color: riskColor(sel.risk) }}>{sel.risk}</strong></div>
            </div>
            <table>
              <thead><tr><th>RANK / COUNTY</th><th>RISK</th><th>EXPOSURE</th><th>ACTION</th></tr></thead>
              <tbody>{ranked.map((c, i) => { const [label, cls] = tier(c.risk); return (
                <tr key={c.id} className={c.id === sel.id ? "sel" : ""} onClick={() => setSelected(c)}>
                  <td><span className="rank">{i + 1}</span><b>{c.name}</b><small>{c.crewHours} crew-hours</small></td>
                  <td><b className={cls}>{c.risk}</b><small>24h forecast: {c.delta > 0 ? "+" : ""}{c.delta}%</small></td>
                  <td><b>{fmt(c.exposure)}</b><small>{c.sites} sites</small></td>
                  <td><span className={`pill ${cls}`}>{label} <ChevronRight size={14} /></span></td>
                </tr>); })}</tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>Recommended dispatch <span className="badge"><Activity size={13} /> OPTIMIZED</span></h3>
            <p>Ordered by harm prevented per crew-hour</p></div></div>
          {plan.map((a, i) => {
            const done = assigned[a.id];
            const names = done ? done.personIds.map(id => people.find(p => p.id === id)?.name).filter(Boolean) : [];
            return (
              <div className="dispatch" key={a.id}>
                <span className={`num n${Math.min(i, 2)}`}>{i + 1}</span>
                <div><small className={i < 2 ? "red" : ""}>{slotLabel(i)}</small><h4>{a.title}</h4><p>{a.where}</p>
                  <div className="meta"><span><Users size={15} /> {a.people.toLocaleString()} people</span>
                    <span><Building2 size={15} /> {a.facilities} facilities</span>
                    <span><Clock size={15} /> {a.cost} {a.kind === "crew" ? "crew-hrs" : "staff-hrs"}</span></div>
                  {done && <p className="assigned-line">Sent to <b>{names.slice(0, 2).join(", ")}</b>{names.length > 2 && ` +${names.length - 2} more`}{done.fileName && <> · <FileText size={13} /> PDF attached</>}</p>}
                </div>
                <button className={`btn ghost ${done ? "done" : ""}`}
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  {openId === a.id ? "Close" : done ? "Assigned ✓" : "Assign"}</button>
                {openId === a.id && (
                  <AssignPanel action={a} people={people} summary={liveSummary} existing={done}
                    onCancel={() => setOpenId(null)}
                    onSent={info => { setAssigned({ ...assigned, [a.id]: info }); setOpenId(null); }} />
                )}
              </div>
            );
          })}
          <div className="cap"><div><small>CREW CAPACITY AFTER PLAN</small><b>{crewsCommitted} crews committed · {crewsLeft} available</b></div>
            <div className="bar"><i style={{ width: `${(crewsCommitted / liveSummary.crewsAvailable) * 100}%` }} /></div></div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>Critical-facility exposure</h3><p>Public aggregate data · verified 13:45</p></div></div>
          <div className="fac">{facilityStats.map(f => { const I = facIcons[f.key]; return (
            <div key={f.key}><span className={`fi ${f.key}`}><I size={20} /></span><p><b>{f.n}</b> {f.label}</p><small>{f.sub}</small></div>); })}</div>
        </section>

      </main>
    </div>
  );
}

function Kpi({ icon, tone, label, value, children, ring }) {
  return (<div className="kpi"><span className={`ki ${tone}`}>{icon}</span>
    <div><p>{label}</p><b>{value}</b>{children}</div>
    {ring != null && <div className="ring" style={{ "--p": ring }}><span>{ring}%</span></div>}</div>);
}

function AssignPanel({ action, people, summary, existing, onCancel, onSent }) {
  const county = findCounty(action, counties);
  const [ids, setIds] = useState(existing?.personIds || []);
  const [phoneNumbers, setPhoneNumbers] = useState(
    Object.fromEntries(people.map(person => [person.id, person.phone || ""])));
  const [note, setNote] = useState(existing?.note || buildBlurb({ action, county, summary }));
  const [withPdf, setWithPdf] = useState(existing ? !!existing.fileName : true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const chosen = people.filter(p => ids.includes(p.id));
  const toggle = id => setIds(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const updatePhone = (id, phone) => setPhoneNumbers({ ...phoneNumbers, [id]: phone });
  const buildPdf = () => makeAssignmentPdf({ action, county, summary, note, people: chosen });
  const preview = () => window.open(buildPdf().doc.output("bloburl"), "_blank");

  const send = async () => {
    if (!chosen.length) return setError("Choose at least one person.");
    if (!note.trim() && !withPdf) return setError("Add a description or include the PDF.");
    setSending(true); setError("");
    try {
      const file = withPdf ? buildPdf().file : null;
      const recipients = chosen.map(person => ({ ...person, phone: phoneNumbers[person.id].trim() }));
      if (recipients.some(person => !/^\+?[1-9]\d{7,14}$/.test(person.phone.replace(/[\s().-]/g, "").replace(/^00/, "+")))) {
        throw new Error("Enter a valid international phone number, such as +14155550123.");
      }
      await sendAssignment({ action, people: recipients, note, file });
      onSent({ personIds: ids, note, fileName: file?.name });
    } catch (sendError) {
      setError(sendError.message || "Could not send. Check your connection and try again.");
      setSending(false);
    }
  };

  return (
    <div className="assign-panel">
      <div className="ap-head">
        <span>Assign to ({ids.length} selected)</span>
        <button type="button" className="linkbtn" onClick={() => setIds(ids.length === people.length ? [] : people.map(p => p.id))}>
          {ids.length === people.length ? "Clear all" : "Select all"}</button>
      </div>
      <div className="people-list">
        {people.map(p => (
          <label key={p.id} className={`person ${ids.includes(p.id) ? "on" : ""}`}>
            <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} />
            <span><b>{p.name}</b><small>{p.role}</small>
              {ids.includes(p.id) && <input className="phone-input" type="tel" value={phoneNumbers[p.id]}
                onChange={e => updatePhone(p.id, e.target.value)} placeholder="+14155550123"
                aria-label={`${p.name} phone number`} />}
            </span>
          </label>
        ))}
      </div>

      <div className="ap-head">
        <span>Description</span>
      </div>
      <textarea rows={7} value={note} onChange={e => setNote(e.target.value)} placeholder="What should they do, and where?" />

      <div className="pdf-row">
        <label className="person pdf">
          <input type="checkbox" checked={withPdf} onChange={e => setWithPdf(e.target.checked)} />
          <span><b><FileText size={14} /> Attach auto-generated PDF</b><small>One-page assignment order, includes the description and recipients</small></span>
        </label>
        <button type="button" className="btn ghost" onClick={preview}><Eye size={16} /> Preview PDF</button>
      </div>

      {error && <p className="assign-err">{error}</p>}
      <div className="assign-actions">
        <button className="btn ghost" onClick={onCancel} disabled={sending}>Cancel</button>
        <button className="btn primary" onClick={send} disabled={sending}>{sending ? "Sending…" : `Send to ${ids.length || ""} ${ids.length === 1 ? "person" : "people"}`}</button>
      </div>
    </div>
  );
}