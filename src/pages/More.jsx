import { useEffect, useState } from "react";
import { smsSummary } from "../lib/brief.js";
import { useSetting } from "../lib/settings.js";
import { api, useStore } from "../lib/store.jsx";

const EVENT = { uri: "Feb 2021 outages", elliott: "Dec 2022 outages", ice2023: "Feb 2023 outages", heat2023: "Aug 2023 outages" };

export default function More() {
  const s = useStore();
  const [glove, setGlove] = useSetting("glove", "off", "glove");
  const [detail, setDetail] = useSetting("detail", "off");
  const [model, setModel] = useState(null);

  useEffect(() => {
    api("GET", "/api/models").then(m => setModel(m.honest)).catch(() => {});
  }, []);

  const ts = model?.metrics.tier_stats;

  return (
    <div className="page narrow">
      <header className="page-h">
        <p className="eyebrow">More</p>
        <h1>Display and <span className="accent">trust</span></h1>
      </header>

      <div className="rows more-rows">
        <section aria-label="Briefing">
          <h2 className="eyebrow">When signal is poor</h2>
          <p className="muted mt-xs">A one-page paper brief, or the whole situation in one text.</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => window.print()}>Print the brief</button>
            <button className="btn" onClick={() => s.openDraft({ eyebrow: "Situation summary", title: "Text a summary", text: smsSummary(s), key: "summary" })} disabled={!s.latest}>Text a summary</button>
          </div>
        </section>

        <section aria-label="Display">
          <h2 className="eyebrow">Display</h2>
          <div className="rows">
            <Toggle label="Show extra detail" sub="Live feed, weather, trends, rewind, list order and more map layers" on={detail === "on"} onChange={v => setDetail(v ? "on" : "off")} />
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
