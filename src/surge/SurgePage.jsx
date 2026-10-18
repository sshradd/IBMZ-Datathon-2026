// The SURGE overview page: the layout, sections and Assign panel from the team's front end, running on the live
// (or recorded) feed instead of typed-in numbers. Every number on it comes from the model or the ops state.
import { Volume2, Activity, AlertTriangle, ArrowRight, ChevronRight, Clock, CloudLightning, CloudSnow, Download, Eye, FileText, Map as MapIcon, Menu, PersonStanding, Printer, Radar, Radio, RefreshCw, ShieldAlert, Thermometer, Truck, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AlertBanner from "../components/AlertBanner.jsx";
import AssignSheet from "../components/AssignSheet.jsx";
import Decision from "../components/Decision.jsx";
import FeedStrip from "../components/FeedStrip.jsx";
import Statewide from "../components/Statewide.jsx";
import DraftSheet from "../components/DraftSheet.jsx";
import { Toast, UndoBar } from "../components/Shell.jsx";
import TextCrew from "../components/TextCrew.jsx";
import Logo from "../components/Logo.jsx";
import { DEFAULT_QTY, orderOf, qtyOf } from "../lib/decisions.js";
import { clock, dayClock, departBy } from "../lib/format.js";
import { api, useStore } from "../lib/store.jsx";
import { buildBlurb, findCounty, makeAssignmentPdf, sendAssignment } from "./assign.js";
import { buildSms, downloadBriefPdf, sendSms } from "./briefing.js";
import SurgeMap from "./SurgeMap.jsx";
import { riskColor, riskIndex, useSurgeData } from "./useSurgeData.js";
import "./surge.css";

const fmt = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : n);
const tier = r => (r >= 80 ? ["Act now", "crit"] : r >= 65 ? ["Prepare", "warn"] : r >= 50 ? ["Monitor", "mod"] : ["Low", "ok"]);
const MODES = [
  ["risk", "Risk", ShieldAlert],
  ["exposure", "Customers out", Users],
  ["coverage", "Crew coverage", Radar],
  ["nws", "Weather alerts", CloudLightning],
  ["seniors", "Aged 65+", PersonStanding],
];
const HORIZONS = [["p24", "24 h"], ["p12", "12 h"], ["p6", "6 h"]];
const EVENT = { uri: "Feb 2021", elliott: "Dec 2022", ice2023: "Feb 2023", heat2023: "Aug 2023" };
const weatherIcons = { temp: Thermometer, demand: Zap, shed: Activity, nws: CloudSnow };

export default function SurgePage() {
  const s = useStore();
  const data = useSurgeData();
  const [mode, setMode] = useState("risk");
  const [hz, setHz] = useState("p24");
  const [model, setModel] = useState(null);
  const ready = !!s.latest; // the store decides live or recorded before the first forecast arrives
  useEffect(() => { if (ready) api("GET", "/api/models").then(m => setModel(m.honest)).catch(() => {}); }, [ready]);
  const layer = mode === "risk" ? hz : mode === "exposure" ? "out" : mode;
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
  const idx = s.counties.findIndex(c => c.fips === sel.fips);
  const focusCounty = s.counties[idx];
  const focusPriority = s.plan?.priorities.find(p => p.fips === sel.fips);
  const avail = { line: s.plan?.totals.line.available ?? 0, shelter: s.plan?.totals.shelter.available ?? 0, outreach: s.plan?.totals.outreach.available ?? 0 };
  const assignOne = () => {
    const o = focusPriority ? orderOf(focusPriority, s.qty) : { fips: sel.fips, ...qtyOf(s.qty, sel.fips) };
    if (o.line + o.shelter + o.outreach > 0) s.openAssign([o]);
  };
  const speak = () => {
    if (!("speechSynthesis" in window)) return s.say("Reading aloud is not available on this device");
    window.speechSynthesis.cancel();
    const line = p => `${p.county} County. ${p.status === "out" ? "Power is out." : `${p.status} level.`} ` + (p.nearest ? `${p.nearest.depot} crew is ${p.nearest.eta_min} minutes away. ${p.depart_by_min === 0 ? "Leave now." : `Leave by ${departBy(data.now, p.depart_by_min)}.`}` : "No crew is free.");
    const pr = s.plan?.priorities ?? [];
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(pr.length ? pr.slice(0, 3).map(line).join(" Next. ") : "No county needs a crew right now."));
  };
  const modeList = data.live ? MODES.filter(([id]) => id !== "exposure") : MODES;
  const ts = model?.metrics?.tier_stats;
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
        <div className="titlerow"><h1>Operations overview</h1><span>As of {dayClock(data.now)} CST</span></div>

        <div className="kpis">
          <Kpi icon={<MapIcon size={15} />} label="Counties at risk" value={summary.flagged}>
            <span><b className="red">{summary.act} critical</b> · {summary.elevated} elevated</span>
          </Kpi>
          <Kpi icon={<Users size={15} />} label="People exposed" value={fmt(summary.peopleExposed)}>
            {data.live ? <span>live mode has no county outage feed</span> : <span><b className="red">{fmt(summary.customersOut)}</b> customers out now</span>}
          </Kpi>
          <Kpi icon={<PersonStanding size={15} />} label="Seniors exposed" value={fmt(summary.seniors)}>
            <span>aged 65+ in counties likely to go severe</span>
          </Kpi>
          <Kpi icon={<Truck size={15} />} label="Response capacity" value={`${summary.crewsAvailable} / ${summary.crewsTotal}`} ring={pct}>
            <span>line crews available now</span>
          </Kpi>
        </div>

        <section className="card">
          <div className="card-h"><div><h3>County risk ranking</h3><p>Ranked by the model's 24 hour outage risk</p></div>
            <button className="btn ghost" onClick={speak}><Volume2 size={16} /> Read top three</button></div>
          <div className="risk-legend"><span>RISK LEVEL</span>
            {[["#3ed1a8", "Low · under 50"], ["#ffc233", "Moderate · 50–64"], ["#ff8a3d", "High · 65–79"], ["#ff4d5e", "Critical · 80+"]].map(([c, t]) => <em key={t}><i style={{ background: c }} />{t}</em>)}
          </div>
          <div className="split">
            <div className="map-wrap">
              {mode === "risk" && <div className="hz" role="group" aria-label="Forecast window">{HORIZONS.map(([id, t]) =>
                <button key={id} className={hz === id ? "on" : ""} onClick={() => setHz(id)} aria-pressed={hz === id}>{t}</button>)}</div>}
              <SurgeMap layer={layer} selected={selected} onSelect={setSelected} cov={cov} />
              <div className="modes" role="group" aria-label="Map layer">{modeList.map(([id, t, I]) =>
                <button key={id} className={mode === id ? "on" : ""} onClick={() => setMode(id)} aria-pressed={mode === id} aria-label={t} title={t}><I size={20} /></button>)}</div>
</div>
            <div className="rank-col">
              <div className="table-x"><table>
                <thead><tr><th>RANK / COUNTY</th><th>RISK</th><th>ACTION</th></tr></thead>
                <tbody>{ranked.map((c, i) => { const [label, cls] = tier(c.risk); return (
                  <tr key={c.id} className={c.id === sel.id ? "sel" : ""} onClick={() => setSelected(c.fips)}>
                    <td><span className="rank">{i + 1}</span><b>{c.name}</b><small>{fmt(c.exposure)} exposed · {c.eta != null ? `${c.eta} min away` : "no crew free"}</small></td>
                    <td><b className={cls}>{c.risk}</b><small>{c.delta > 0 ? "+" : ""}{c.delta} pts</small></td>
                    <td><span className={`pill ${cls}`}>{c.status === "out" ? "Power out" : label} <ChevronRight size={14} /></span></td>
                  </tr>); })}</tbody>
              </table></div>
              {focusCounty && s.latest && (
                <div className="detail">
                  <Decision county={focusCounty} index={idx} latest={s.latest} priority={focusPriority}
                    qty={qtyOf(s.qty, sel.fips)} onQty={q => s.setQty({ ...s.qty, [sel.fips]: q })} available={avail}
                    busy={false} onSend={assignOne} />
                </div>
              )}
            </div>
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

        <div className="pair">
          <section className="card" aria-label="Statewide">
            <div className="card-h"><div><h3>Statewide</h3><p>Where it is heading and where it is worst</p></div></div>
            <Statewide latest={s.latest} counties={s.counties} series={s.series} onSelect={setSelected} selected={selected} />
          </section>
          <section className="card" aria-label="How far to trust it">
            <div className="card-h"><div><h3>How far to trust it</h3><p>Tested on outages the model never saw</p></div><a className="link" href="#/more">Details <ArrowRight size={16} /></a></div>
            {model?.metrics.scenarios && (
              <ul className="trust">{Object.entries(model.metrics.scenarios).map(([k, v]) => (
                <li key={k}><span>{EVENT[k] ?? k} outages</span><span className="mono">{v.warned}/{v.onsets} warned first</span><b>{v.warned_pct != null ? `${v.warned_pct.toFixed(0)}%` : "–"}</b></li>))}</ul>
            )}
            {ts && <p className="trust-note">When the model says <b>act</b>, the county went severe within 24 hours {Math.round(ts.act.precision * 100)}% of the time, against {(ts.base_rate * 100).toFixed(1)}% for a typical county-hour ({ts.act.lift}x). Most alerts still do not end in a severe outage, so the plan is a ranking, not a promise.</p>}
            {!model && <p className="trust-note">Model results load when a server is connected.</p>}
          </section>
        </div>

        <section className="card">
          <div className="card-h"><div><h3>Weather and grid</h3><p>From the same feed · {clock(data.now)}</p></div></div>
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

        <FeedStrip />

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

function Kpi({ icon, label, value, children, ring }) {
  return (<div className="kpi">
    <p>{icon}{label}</p><b>{value}</b>{children}
    {ring != null && <i className="kbar"><i style={{ width: `${ring}%` }} /></i>}</div>);
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
