// The SURGE overview page: the layout, sections and Assign panel from the team's front end, running on the live
// (or recorded) feed instead of typed-in numbers. Every number on it comes from the model or the ops state.
import { Activity, AlertTriangle, ArrowRight, ChevronRight, Clock, CloudSnow, Download, Eye, FileText, Filter, Map as MapIcon, Menu, Printer, Radio, RefreshCw, Thermometer, Truck, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AlertBanner from "../components/AlertBanner.jsx";
import AssignSheet from "../components/AssignSheet.jsx";
import DraftSheet from "../components/DraftSheet.jsx";
import { Toast, UndoBar } from "../components/Shell.jsx";
import TextCrew from "../components/TextCrew.jsx";
import Logo from "../components/Logo.jsx";
import { DEFAULT_QTY } from "../lib/decisions.js";
import { clock, dayClock } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";
import { buildBlurb, findCounty, makeAssignmentPdf, sendAssignment } from "./assign.js";
import { buildSms, downloadBriefPdf, sendSms } from "./briefing.js";
import SurgeMap from "./SurgeMap.jsx";
import { riskColor, riskIndex, useSurgeData } from "./useSurgeData.js";
import "./surge.css";

const fmt = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : n);
const tier = r => (r >= 80 ? ["Act now", "crit"] : r >= 65 ? ["Prepare", "warn"] : r >= 50 ? ["Monitor", "mod"] : ["Low", "ok"]);
const weatherIcons = { temp: Thermometer, demand: Zap, shed: Activity, nws: CloudSnow };

export default function SurgePage() {
  const s = useStore();
  const data = useSurgeData();
  const [mode, setMode] = useState("Risk");
  const [selected, setSelected] = useState(null);
  const [assigned, setAssigned] = useState({}); // actionId -> { personIds, note, fileName, mode }
  const [openId, setOpenId] = useState(null);
  const [sms, setSms] = useState(null);
  const [menu, setMenu] = useState(false);

  // first open with nothing running: load the recorded outages so the page is never empty
  const autoStarted = useRef(false);
  // with a server this is the live feed; with none, the recorded outages play so the page is never empty
  const hasLive = s.scenarios.some(x => x.key === "live");
  const hasRecorded = s.scenarios.some(x => x.key !== "live");
  useEffect(() => {
    if (autoStarted.current || s.latest || !s.state || s.state.scenario) return;
    if (!s.demo && hasLive) { autoStarted.current = true; s.start("live"); }
    else if (hasRecorded) { autoStarted.current = true; s.startDemo(); }
  }, [s.latest, s, hasLive, hasRecorded]);
  const title = s.state?.title?.match(/\(([^)]+)\)/)?.[1];
  const feedLabel = data_live => (data_live ? "LIVE" : title ? `${title} outages` : "LIVE");

  const sel = useMemo(() => {
    if (!data) return null;
    const hit = data.counties.find(c => c.fips === selected);
    if (hit || !selected) return hit ?? data.counties[0];
    // a county from the map that is not in the top eight
    const i = s.counties.findIndex(c => c.fips === selected);
    const row = s.latest?.counties[i];
    if (i < 0 || !row) return data.counties[0];
    const c = s.counties[i];
    return { id: c.fips, fips: c.fips, name: c.name, risk: riskIndex(row[0], s.tiers, row[2] >= c.severe_at), delta: 0, exposure: Math.round(row[0] * c.pop), seniors: Math.round(row[0] * c.pop65), eta: null };
  }, [data, selected, s.counties, s.latest, s.tiers]);

  const hello = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  if (!data || !sel) {
    return (
      <div className="sg">
        <Header onMenu={() => setMenu(v => !v)} menu={menu} label="LIVE" live briefing={null} />
        <main><p className="sub">Loading the forecast…</p></main>
      </div>
    );
  }

  const { counties, actions, summary, weather, people, cov } = data;
  const ranked = counties;
  const covered = new Set(cov.covered.map(p => p.fips));
  const pct = summary.crewsTotal ? Math.round((summary.crewsAvailable / summary.crewsTotal) * 100) : 0;
  const inPlan = summary.crewsInPlan;
  const leaveLabel = a => (a.leave === 0 ? "NOW" : `LEAVE IN ${a.leave} MIN`);

  const assignUncovered = () => s.openAssign(cov.uncovered.slice(0, Math.min(5, summary.crewsAvailable)).map(p => ({ fips: p.fips, ...DEFAULT_QTY })));

  return (
    <>
    <div className="sg">
      <Header onMenu={() => setMenu(v => !v)} menu={menu} live={data.live} label={feedLabel(data.live)} briefing={() => downloadBriefPdf(summary, ranked, actions)} />

      <section className="status">
        <div className="st-ic"><AlertTriangle /></div>
        <div><small>REGIONAL GRID STATUS</small><h2>{summary.status}</h2></div>
        <p>{summary.note}</p>
        <div className="st-r">
          <Clock size={16} /> Updated {summary.updated}
          {summary.warned != null && <><span className="sep" />Warned before the outage <b>{summary.warned}%</b></>}
        </div>
      </section>

      <main>
        <small className="eyebrow">OPERATIONS OVERVIEW</small>
        <h1>{hello}, Regional Ops</h1>
        <p className="sub">Prioritized actions as of {dayClock(data.now)} CST</p>

        <div className="kpis">
          <Kpi icon={<MapIcon />} tone="red" label="Counties at risk" value={summary.flagged}>
            <span><b className="red">{summary.act} critical</b> · {summary.elevated} elevated</span>
          </Kpi>
          <Kpi icon={<Users />} tone="amber" label="People exposed" value={fmt(summary.peopleExposed)}>
            {data.live ? <span>live mode has no county outage feed</span> : <span><b className="red">{fmt(summary.customersOut)}</b> customers out now</span>}
          </Kpi>
          <Kpi icon={<Users />} tone="blue" label="Seniors exposed" value={fmt(summary.seniors)}>
            <span>aged 65+ in counties likely to go severe</span>
          </Kpi>
          <Kpi icon={<Truck />} tone="green" label="Response capacity" value={`${summary.crewsAvailable} / ${summary.crewsTotal}`} ring={pct}>
            <span>Line crews available now</span>
          </Kpi>
        </div>

        <section className="card">
          <div className="card-h"><div><h3>County risk ranking</h3><p>Ranked by the model's 24 hour outage risk</p></div>
            <button className="btn ghost" onClick={() => setMode(mode === "Coverage" ? "Risk" : "Coverage")}><Filter size={16} /> {mode === "Coverage" ? "Show risk" : "Show coverage"}</button></div>
          <div className="risk-legend"><span>RISK LEVEL</span>
            {[["#3ed1a8", "Low · under 50"], ["#ffc233", "Moderate · 50–64"], ["#ff8a3d", "High · 65–79"], ["#ff4d5e", "Critical · 80+"]].map(([c, t]) => <em key={t}><i style={{ background: c }} />{t}</em>)}
          </div>
          <div className="split">
            <div className="map-wrap">
              <div className="seg">{["Risk", "Exposure", "Coverage"].map(m =>
                <button key={m} className={m === mode ? "on" : ""} onClick={() => setMode(m)}>{m}</button>)}</div>
              <SurgeMap mode={mode} selected={selected} onSelect={setSelected} cov={cov} />
              <div className="map-pop"><div><b>{sel.name} County</b><small>{sel.delta === 0 ? "Risk steady" : `Risk ${sel.delta > 0 ? "rose" : "fell"} ${sel.delta > 0 ? "+" : ""}${sel.delta} points`} in 3 h</small></div><strong style={{ color: riskColor(sel.risk) }}>{sel.risk}</strong></div>
            </div>
            <div className="table-x"><table>
              <thead><tr><th>RANK / COUNTY</th><th>RISK</th><th>EXPOSURE</th><th>ACTION</th></tr></thead>
              <tbody>{ranked.map((c, i) => { const [label, cls] = tier(c.risk); return (
                <tr key={c.id} className={c.id === sel.id ? "sel" : ""} onClick={() => setSelected(c.fips)}>
                  <td><span className="rank">{i + 1}</span><b>{c.name}</b><small>{c.eta != null ? `${c.depot} crew · ${c.eta} min` : "no crew free"}</small></td>
                  <td><b className={cls}>{c.risk}</b><small>{c.delta > 0 ? "+" : ""}{c.delta} pts</small></td>
                  <td><b>{fmt(c.exposure)}</b><small>{fmt(c.seniors)} aged 65+</small></td>
                  <td><span className={`pill ${cls}`}>{c.status === "out" ? "Power out" : label} <ChevronRight size={14} /></span></td>
                </tr>); })}</tbody>
            </table></div>
          </div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>Recommended assignments <span className="badge"><Activity size={13} /> RANKED BY RISK</span></h3>
            <p>{cov.need.length ? <>{cov.covered.length} of {cov.need.length} counties needing action have a crew{cov.uncovered.length > 0 && <> · <b className="red">{cov.uncovered.length} without</b></>}</> : "No county needs a crew right now"}</p></div>
            {cov.uncovered.length > 0 && summary.crewsAvailable > 0
              ? <button className="btn ghost" onClick={assignUncovered}>Assign the {Math.min(5, cov.uncovered.length, summary.crewsAvailable)} most urgent <ArrowRight size={16} /></button>
              : <a className="link" href="#/teams">View plan <ArrowRight size={16} /></a>}</div>
          {actions.map((a, i) => {
            const done = assigned[a.id];
            const has = covered.has(a.fips);
            const names = done ? done.personIds.map(id => people.find(p => p.id === id)?.name).filter(Boolean) : [];
            return (
              <div className="dispatch" key={a.id}>
                <span className={`num n${Math.min(i, 2)}`}>{i + 1}</span>
                <div><small className={a.leave === 0 ? "red" : ""}>{leaveLabel(a)}</small><h4>{a.title}</h4><p>{a.where}</p>
                  <div className="meta"><span><Users size={15} /> {a.people.toLocaleString()} people</span>
                    <span><Users size={15} /> {a.seniors.toLocaleString()} aged 65+</span>
                    <span><Clock size={15} /> {a.eta != null ? `${a.eta} min drive` : "no crew free"}</span></div>
                  {done && <p className="assigned-line">{done.mode === "sent" ? "Sent to" : "Drafted for"} <b>{names.slice(0, 2).join(", ")}</b>{names.length > 2 && ` +${names.length - 2} more`}{done.fileName && <> · <FileText size={13} /> PDF attached</>}{done.mode === "drafted" && " · press send in Messages"}</p>}
                </div>
                <button className={`btn ghost ${done || has ? "done" : ""}`}
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  {openId === a.id ? "Close" : done || has ? "Assigned ✓" : "Assign"}</button>
                {openId === a.id && (
                  <AssignPanel action={a} people={people} existing={done} counties={counties} summary={summary}
                    onCancel={() => setOpenId(null)}
                    onCommit={() => s.dispatch([{ fips: a.fips, ...DEFAULT_QTY }])}
                    onSent={info => { setAssigned({ ...assigned, [a.id]: info }); setOpenId(null); }} />
                )}
              </div>
            );
          })}
          <div className="cap"><div><small>CREW CAPACITY</small><b>{inPlan} crews in the plan · {summary.crewsAvailable} available</b></div>
            <div className="bar"><i style={{ width: `${inPlan + summary.crewsAvailable ? (inPlan / (inPlan + summary.crewsAvailable)) * 100 : 0}%` }} /></div></div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>Weather and grid</h3><p>Live from the same feed · {clock(data.now)}</p></div>
            <a className="link" href="#/more">How far to trust it <ArrowRight size={16} /></a></div>
          <div className="fac">{weather.map(f => { const I = weatherIcons[f.key]; return (
            <div key={f.key}><span className={`fi ${f.key}`}><I size={20} /></span><p><b>{f.n}</b> {f.label}</p><small>{f.sub}</small></div>); })}</div>
        </section>

        <section className="card offline">
          <div className="off-ic"><Radio size={40} /></div>
          <div><small className="eyebrow">BUILT FOR DEGRADED COMMS</small><h3>Briefings that work offline</h3>
            <p>Export a one-page field brief or send an SMS-length action summary.</p></div>
          <div className="off-btns">
            <button className="btn ghost" onClick={() => downloadBriefPdf(summary, ranked, actions)}><Printer size={18} /> Print brief</button>
            <button className="btn primary" onClick={() => setSms(buildSms(summary, ranked, actions))}><Radio size={18} /> SMS summary</button>
          </div>
        </section>
        {sms && <div className="sms"><p>{sms}</p><small>{sms.length} chars</small>
          <button className="btn ghost" onClick={() => navigator.clipboard.writeText(sms)}>Copy</button>
          <button className="btn primary" onClick={() => sendSms(sms)}>Open in Messages</button></div>}

        <p className="foot">Recommendations only. Crews, depots and the roster are sample data. <a href="#/classic">Classic view</a></p>
      </main>
    </div>
    <UndoBar />
    <Toast />
    <AlertBanner />
    <TextCrew />
    <AssignSheet />
    <DraftSheet />
    </>
  );
}

function Header({ onMenu, menu, live, label, briefing }) {
  return (
    <header className="top">
      <a className="brand" href="#/" aria-label="Surge, home"><Logo size={30} /><b>SURGE</b><span>Grid Resilience Command</span></a>
      <div className="top-r">
        <span className="live"><i /> {label}</span>
        <div className="menu-wrap">
          <button className="icon-btn" onClick={onMenu} aria-label="Menu" aria-expanded={menu}><Menu size={18} /></button>
          {menu && (
            <nav className="menu" aria-label="More pages">
              <a href="#/teams">Teams and the plan</a>
              <a href="#/resources">Resources and inventory</a>
              <a href="#/more">How far to trust it</a>
              <a href="#/classic">Classic view</a>
            </nav>
          )}
        </div>
        <button className="btn primary" onClick={briefing ?? undefined} disabled={!briefing}><Download size={18} /> Generate briefing</button>
      </div>
    </header>
  );
}

function Kpi({ icon, tone, label, value, children, ring }) {
  return (<div className="kpi"><span className={`ki ${tone}`}>{icon}</span>
    <div><p>{label}</p><b>{value}</b>{children}</div>
    {ring != null && <div className="ring" style={{ "--p": ring }}><span>{ring}%</span></div>}</div>);
}

function AssignPanel({ action, people, existing, counties, summary, onCancel, onCommit, onSent }) {
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
      void onCommit();
      const result = await sendAssignment({ action, people: recipients, note, file });
      onSent({ personIds: ids, note, fileName: file?.name, mode: result.mode });
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
        <button type="button" className="linkbtn" onClick={() => setNote(buildBlurb({ action, county, summary }))}><RefreshCw size={13} /> Regenerate</button>
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
        <button className="btn primary" onClick={send} disabled={sending}>{sending ? "Sending…" : `Assign and send to ${ids.length || ""} ${ids.length === 1 ? "person" : "people"}`}</button>
      </div>
    </div>
  );
}
