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

const STORM: Record<string, string> = { uri: "Winter Storm Uri", elliott: "Winter Storm Elliott", ice2023: "Feb 2023 ice storm", heat2023: "Aug 2023 heat dome" };

export default function More() {
  const s = useStore();
  const [theme, setTheme] = useSetting<"night" | "day">("theme", "night", "theme");
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
      s.say("Start a storm replay or go live first: there is no forecast to brief on");
    }
  };

  const ts = model?.metrics.tier_stats;

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 md:p-5">
      <header>
        <p className="label">More</p>
        <h1 className="cond text-[44px] uppercase leading-[0.95]">Shift tools</h1>
      </header>

      <section className="panel p-4" aria-label="Shift handoff">
        <h2 className="label">Shift handoff</h2>
        <p className="mt-1 text-[14px] text-mute">One page for the next shift: where things stand, what was sent, what is short, where to stage.</p>
        <button className="btn btn--go mt-3 !text-[20px]" onClick={makeBrief}>
          <FileText /> Write handoff brief
        </button>
        {brief && (
          <>
            <pre className="mono scroll-thin mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-night p-3 text-[12.5px] leading-relaxed">{brief}</pre>
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

      <section className="panel p-4" aria-label="Data source">
        <h2 className="label">Data source</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button className="btn !justify-start" onClick={() => s.start("live")}>
            <Radio /> Live now: ERCOT, NWS, Open-Meteo
          </button>
          {s.scenarios
            .filter((x) => x.key !== "live")
            .map((x) => (
              <button key={x.key} className="btn !justify-start" onClick={() => s.start(x.key)}>
                Replay {x.title}
              </button>
            ))}
        </div>
        <p className="mt-3 text-[13px] text-mute">
          Replays are real storms scored by a model that never saw them. Live mode has no county outage feed: it forecasts from weather and grid data, and its 6 and 12 hour forecasts are weak.
          {s.state?.scenario && <> Now showing: <b className="text-frost">{s.state.title}</b>.</>}
        </p>
      </section>

      <section className="panel p-4" aria-label="Analyst dashboard">
        <h2 className="label">Analyst dashboard</h2>
        <p className="mt-1 text-[14px] text-mute">The full forecast workbench: drivers, county drill-down, grid and weather charts, out-of-sample evidence and the benchmark.</p>
        <a className="btn mt-3" href="/analyst/">
          Open the analyst dashboard
        </a>
      </section>

      <section className="panel p-4" aria-label="Display">
        <h2 className="label">Display</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Toggle label="Daylight theme" sub="Higher contrast for a truck cab at noon" on={theme === "day"} onChange={(v) => setTheme(v ? "day" : "night")} />
          <Toggle label="Glove mode" sub="Bigger buttons for gloved hands" on={glove === "on"} onChange={(v) => setGlove(v ? "on" : "off")} />
        </div>
      </section>

      <section className="panel p-4" aria-label="How far to trust it">
        <h2 className="label">How far to trust it</h2>
        <p className="mt-1 text-[14px] text-mute">Tested on storms the model never saw. Most alerts still do not end in a severe outage, so the plan is a ranking, not a promise.</p>
        {model?.metrics.scenarios && (
          <ul className="mt-3 divide-y divide-rule/60">
            {Object.entries(model.metrics.scenarios).map(([k, v]) => (
              <li key={k} className="flex items-baseline gap-3 py-2 text-[14px]">
                <span className="min-w-0 flex-1">{STORM[k] ?? k}</span>
                <span className="mono text-[13px] text-mute">
                  {v.warned}/{v.onsets} warned first
                </span>
                <span className="cond w-14 text-right text-[22px]">{v.warned_pct != null ? `${v.warned_pct.toFixed(0)}%` : "–"}</span>
              </li>
            ))}
          </ul>
        )}
        {ts && (
          <p className="mt-3 text-[13px] text-mute">
            When the model says <b className="text-frost">act</b>, the county went severe within 24 hours {Math.round(ts.act.precision * 100)}% of the time, against {(ts.base_rate * 100).toFixed(1)}% for a
            typical county-hour ({ts.act.lift}x).
          </p>
        )}
        <p className="mt-3 text-[12.5px] text-dim">
          Crews, depots and inventory are sample data. Senior counts are Census estimates, not medical-need records. Travel times are planning estimates, not routing.
        </p>
      </section>
    </div>
  );
}

function Toggle({ label, sub, on, onChange }: { label: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx("flex min-h-[64px] items-center gap-3 rounded-md border p-3 text-left", on ? "border-lightning bg-lightning/10" : "border-rule")}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        <span className="block text-[12.5px] text-mute">{sub}</span>
      </span>
      <span className={clsx("relative h-7 w-12 rounded-full border", on ? "border-lightning bg-lightning" : "border-rule bg-night")} aria-hidden>
        <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full transition-all", on ? "left-6 bg-[var(--lightning-ink)]" : "left-0.5 bg-frost")} />
      </span>
    </button>
  );
}
