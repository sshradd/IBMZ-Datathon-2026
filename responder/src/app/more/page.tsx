"use client";

import clsx from "clsx";
import { Copy, Download, FileText, Radio, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { download, copyText, shareText } from "@/lib/share";
import { useSetting } from "@/lib/settings";
import { useStore } from "@/lib/store";

interface Model {
  tiers: Record<string, number>;
  metrics: {
    scenarios?: Record<string, { onsets: number; warned: number; warned_pct: number | null; median_lead_h: number | null }>;
    tier_stats?: { base_rate: number; watch: { precision: number; lift: number }; prepare: { precision: number; lift: number }; act: { precision: number; lift: number } };
  };
}

const EVENT: Record<string, string> = { uri: "Feb 2021 outages", elliott: "Dec 2022 outages", ice2023: "Feb 2023 outages", heat2023: "Aug 2023 outages" };

export default function More() {
  const s = useStore();
  const [theme, setTheme] = useSetting<"night" | "day">("theme", "day", "theme");
  const [glove, setGlove] = useSetting<"off" | "on">("glove", "off", "glove");
  const [brief, setBrief] = useState<string | null>(null);
  const [model, setModel] = useState<Model | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((m) => setModel(m.honest))
      .catch(() => {});
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
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <header>
        <p className="eyebrow">More</p>
        <h1 className="display mt-2 text-[clamp(34px,6vw,56px)]">
          Shift <span className="accent text-[1.1em]">tools</span>
        </h1>
      </header>

      <div className="rows mt-6 border-t border-line [&>section]:py-7">
        <section aria-label="Shift handoff">
          <h2 className="eyebrow">Shift handoff</h2>
          <p className="mt-2 text-[16px] muted">One page for the next shift: where things stand, what the plan recommends, what is short, where to stage.</p>
          <button className="btn btn-ink mt-4" onClick={makeBrief}>
            <FileText /> Write handoff brief
          </button>
          {brief && (
            <>
              <pre className="mono scroll-thin mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-card2 p-3 text-[12.5px] leading-relaxed">{brief}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn" onClick={() => shareText("Shift handoff", brief, s.say)}>
                  <Share2 /> Share
                </button>
                <button className="btn" onClick={async () => s.say((await copyText(brief)) ? "Brief copied" : "Could not copy")}>
                  <Copy /> Copy
                </button>
                <button className="btn" onClick={() => download("uri-watch-handoff.md", brief)}>
                  <Download /> Download
                </button>
              </div>
            </>
          )}
        </section>

        <section aria-label="Data source">
          <h2 className="eyebrow">Data source</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn" onClick={() => s.start("live")}>
              <Radio /> Live now
            </button>
            {s.scenarios.some((x) => x.key !== "live") && (
              <button className="btn" onClick={() => s.startDemo()}>
                Demo outages
              </button>
            )}
          </div>
          <p className="mt-3 text-[14.5px] muted">
            Demo outages are real recorded county outages, scored by a model that never saw them. Live mode has no county outage feed: it forecasts from weather and grid data, and its 6 and 12 hour forecasts are weak.
            {s.state?.scenario && (
              <>
                {" "}
                Now showing: <b className="text-ink">{s.state.scenario === "live" ? "live data" : "demo outages"}</b>.
              </>
            )}
          </p>
        </section>

        <section aria-label="Analyst dashboard">
          <h2 className="eyebrow">Analyst dashboard</h2>
          <p className="mt-2 text-[16px] muted">The full forecast workbench: drivers, county drill-down, grid and weather charts, out-of-sample evidence and the benchmark.</p>
          <a className="btn mt-4" href="/analyst/">
            Open the analyst dashboard
          </a>
        </section>

        <section aria-label="Display">
          <h2 className="eyebrow">Display</h2>
          <div className="rows mt-2">
            <Toggle label="Night theme" sub="Dark ground for the overnight shift" on={theme === "night"} onChange={(v) => setTheme(v ? "night" : "day")} />
            <Toggle label="Glove mode" sub="Bigger buttons for gloved hands" on={glove === "on"} onChange={(v) => setGlove(v ? "on" : "off")} />
          </div>
        </section>

        <section aria-label="How far to trust it">
          <h2 className="eyebrow">How far to trust it</h2>
          <p className="mt-2 text-[16px] muted">Tested on outage events the model never saw. Most alerts still do not end in a severe outage, so the plan is a ranking, not a promise.</p>
          {model?.metrics.scenarios && (
            <ul className="rows mt-3">
              {Object.entries(model.metrics.scenarios).map(([k, v]) => (
                <li key={k} className="flex items-baseline gap-3 py-3 text-[15px]">
                  <span className="min-w-0 flex-1">{EVENT[k] ?? k}</span>
                  <span className="mono text-[12.5px] text-ink3">
                    {v.warned}/{v.onsets} warned first
                  </span>
                  <span className="num w-14 text-right text-[22px]">{v.warned_pct != null ? `${v.warned_pct.toFixed(0)}%` : "–"}</span>
                </li>
              ))}
            </ul>
          )}
          {ts && (
            <p className="mt-3 text-[14.5px] muted">
              When the model says <b className="text-ink">act</b>, the county went severe within 24 hours {Math.round(ts.act.precision * 100)}% of the time, against {(ts.base_rate * 100).toFixed(1)}% for a typical county-hour ({ts.act.lift}x).
            </p>
          )}
          <p className="mt-3 text-[13px] text-ink3">Crews, depots and inventory are sample data. Senior counts are Census estimates, not medical-need records. Travel times are planning estimates, not routing.</p>
        </section>
      </div>
    </div>
  );
}

function Toggle({ label, sub, on, onChange }: { label: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex min-h-[68px] w-full items-center gap-3 py-2 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold tracking-tight">{label}</span>
        <span className="block text-[13.5px] muted">{sub}</span>
      </span>
      <span className={clsx("relative h-7 w-12 flex-none rounded-full border transition-colors", on ? "border-ink bg-ink" : "border-line2 bg-card")} aria-hidden>
        <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full transition-all", on ? "left-6 bg-bg" : "left-0.5 bg-ink3")} />
      </span>
    </button>
  );
}
