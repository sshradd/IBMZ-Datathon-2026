import { Copy, Download, FileText, Radio, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText, download, shareText } from "../lib/share.js";
import { useSetting } from "../lib/settings.js";
import { useStore } from "../lib/store.jsx";

const EVENT = { uri: "Feb 2021 outages", elliott: "Dec 2022 outages", ice2023: "Feb 2023 outages", heat2023: "Aug 2023 outages" };

export default function More() {
  const s = useStore();
  const [theme, setTheme] = useSetting("theme", "day", "theme");
  const [glove, setGlove] = useSetting("glove", "off", "glove");
  const [brief, setBrief] = useState(null);
  const [model, setModel] = useState(null);

  useEffect(() => {
    fetch("/api/models").then(r => r.json()).then(m => setModel(m.honest)).catch(() => {});
  }, []);

  const makeBrief = async () => {
    try {
      setBrief(await s.sitrep());
    } catch {
      s.say("Go live or load demo outages first: there is no forecast to brief on");
    }
  };

  const ts = model?.metrics.tier_stats;

  return (
    <div className="page narrow">
      <header className="page-h">
        <p className="eyebrow">More</p>
        <h1>Shift <span className="accent">tools</span></h1>
      </header>

      <div className="rows more-rows">
        <section aria-label="Shift handoff">
          <h2 className="eyebrow">Shift handoff</h2>
          <p className="muted mt-xs">One page for the next shift: where things stand, what the plan recommends, what is short, where to stage.</p>
          <button className="btn primary mt-s" onClick={makeBrief}><FileText size={18} /> Write handoff brief</button>
          {brief && (
            <>
              <pre className="pre tall">{brief}</pre>
              <div className="btn-row">
                <button className="btn" onClick={() => shareText("Shift handoff", brief, s.say)}><Share2 size={18} /> Share</button>
                <button className="btn" onClick={async () => s.say((await copyText(brief)) ? "Brief copied" : "Could not copy")}><Copy size={18} /> Copy</button>
                <button className="btn" onClick={() => download("catch-handoff.md", brief)}><Download size={18} /> Download</button>
              </div>
            </>
          )}
        </section>

        <section aria-label="Data source">
          <h2 className="eyebrow">Data source</h2>
          <div className="btn-row">
            <button className="btn" onClick={() => s.start("live")}><Radio size={18} /> Live now</button>
            {s.scenarios.some(x => x.key !== "live") && <button className="btn" onClick={() => s.startDemo()}>Demo outages</button>}
          </div>
          <p className="muted sm mt-s">
            Demo outages are real recorded county outages, scored by a model that never saw them. Live mode has no county outage feed: it forecasts from weather and grid data, and its 6 and 12 hour forecasts are weak.
            {s.state?.scenario && <> Now showing: <b>{s.state.scenario === "live" ? "live data" : "demo outages"}</b>.</>}
          </p>
        </section>

        <section aria-label="Analyst dashboard">
          <h2 className="eyebrow">Analyst dashboard</h2>
          <p className="muted mt-xs">The full forecast workbench: drivers, county drill-down, grid and weather charts, out-of-sample evidence and the benchmark.</p>
          <a className="btn mt-s" href="/analyst/">Open the analyst dashboard</a>
        </section>

        <section aria-label="Display">
          <h2 className="eyebrow">Display</h2>
          <div className="rows">
            <Toggle label="Glove mode" sub="Bigger buttons for gloved hands" on={glove === "on"} onChange={v => setGlove(v ? "on" : "off")} />
          </div>
        </section>

        <section aria-label="How far to trust it">
          <h2 className="eyebrow">How far to trust it</h2>
          <p className="muted mt-xs">Tested on outage events the model never saw. Most alerts still do not end in a severe outage, so the plan is a ranking, not a promise.</p>
          {model?.metrics.scenarios && (
            <ul className="rows mt-s">
              {Object.entries(model.metrics.scenarios).map(([k, v]) => (
                <li key={k} className="trust-row">
                  <span>{EVENT[k] ?? k}</span>
                  <span className="mono faint sm">{v.warned}/{v.onsets} warned first</span>
                  <b>{v.warned_pct != null ? `${v.warned_pct.toFixed(0)}%` : "–"}</b>
                </li>
              ))}
            </ul>
          )}
          {ts && (
            <p className="muted sm mt-s">
              When the model says <b>act</b>, the county went severe within 24 hours {Math.round(ts.act.precision * 100)}% of the time, against {(ts.base_rate * 100).toFixed(1)}% for a typical county-hour ({ts.act.lift}x).
            </p>
          )}
          <p className="faint xs mt-s">Crews, depots and inventory are sample data. Senior counts are Census estimates, not medical-need records. Travel times are planning estimates, not routing.</p>
        </section>
      </div>
    </div>
  );
}

function Toggle({ label, sub, on, onChange }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="toggle">
      <span><b>{label}</b><small>{sub}</small></span>
      <span className={`sw ${on ? "on" : ""}`} aria-hidden><span /></span>
    </button>
  );
}
