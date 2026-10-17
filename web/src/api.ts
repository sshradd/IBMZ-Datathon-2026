import { useCallback, useEffect, useRef, useState } from "react";

export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ["clear", "watch", "prepare", "act"] as const;
export type TierName = (typeof TIER_NAMES)[number];

export interface County {
  fips: string;
  name: string;
  lat: number;
  lon: number;
  pop: number;
  pop65: number;
  severe_at: number;
}

export interface Reason {
  code: string;
  text: string;
  weight: number;
}

export interface Confidence {
  tier: string;
  precision: number;
  lift: number;
  base_rate: number | null;
}

export interface Move {
  id: string;
  kind: "crews" | "centers" | "callers" | "statewide";
  urgency: "act" | "prepare" | "watch";
  title: string;
  detail: string;
  counties: string[];
  window: string;
  why: string[];
  impact: { people: number; seniors: number; share: number | null } | null;
  confidence: Confidence | null;
}

export interface Deployment {
  fips: string;
  name: string;
  status: "out" | "act" | "prepare" | "watch";
  crews: number;
  centers: number;
  center_kind: "warming" | "cooling";
  callers: number;
  risk: number;
  window: string;
  seniors_exposed: number;
  out: number;
}

export interface Plan {
  resources: { crews: number; centers: number; callers: number };
  deployments: Deployment[];
  coverage: { crews: number; centers: number; callers: number };
  naive_coverage: { crews: number; centers: number; callers: number };
  curve: { crews: number; coverage: number }[];
  objective: string;
  moves: Move[];
}

export interface Scorecard {
  onsets: number;
  warned: number;
  warned_pct: number | null;
  median_lead_h: number | null;
  max_lead_h: number | null;
  false_alerts: number;
  alert_hours: number;
}

export interface WatchItem {
  fips: string;
  name: string;
  p6: number;
  p12: number;
  p24: number;
  tier: TierName;
  window: string;
  seniors_exposed: number;
  trend: number;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  stale: boolean;
  updated: string | null;
  age_s: number | null;
  error: string | null;
  ms: number;
}

export interface AlertEvent {
  event: string;
  severity: string | null;
  relevant: boolean;
  counties: number;
  fips: string[];
  headline: string | null;
}

export interface AlertSummary {
  count: number;
  updated: string | null;
  events: AlertEvent[];
  by_fips: Record<string, string[]>;
}

export interface HourEvent {
  type: "hour";
  i: number;
  n: number;
  t: string;
  /** present only in live mode */
  live?: boolean;
  as_of?: string;
  sources?: SourceStatus[];
  alerts?: AlertSummary | null;
  outlook?: { temp_f_mean_next_24h: (number | null)[] };
  grid_detail?: {
    has_forecast_for_now: boolean;
    history_hours: number;
    wind_share: number;
    upcoming_forecast: { hour: string; mw: number }[];
  };
  /** [p24, tier, customers out, p6, p12] per county, same order as the county list */
  counties: [number, Tier, number, number, number][];
  tier_counts: [number, number, number, number];
  out_total: number;
  grid: { demand: number; forecast: number; gen: number };
  predict: {
    expected_onsets: [number, number, number];
    customers_exposed: number;
    people_exposed: number;
    seniors_exposed: number;
    peak_window: string;
    window_density: [number, number, number];
    watchlist: WatchItem[];
    scoreboard: { issued_24h_ago: number | null; actual_24h: number | null };
  };
  diagnose: {
    drivers: { group: string; label: string; push: number; share: number }[];
    county_drivers: Record<string, Record<string, number>>;
    cause_mix: Record<string, number>;
    cause_unwarned: number;
    state: { temp_f_mean: number; fc_err: number; demand_norm: number; gen_drop: number; severe_frac: number };
  };
  describe: {
    out_total: number;
    severe_now: number;
    ever_severe: number;
    customer_hours: number;
    seniors_out: number;
    peak: { out: number; i: number; t: string | null };
    scorecard: Scorecard;
    league: { fips: string; name: string; customer_hours: number; out: number; pop: number }[];
  };
  prescribe: Plan;
  latency: { scored: number; p50_ms: number; p99_ms: number; scores_per_s: number };
}

export interface HistoryPoint {
  i: number;
  t: string;
  out: number;
  severe: number;
  flagged: number;
  act: number;
  expected24: number;
  issued: number | null;
  actual: number | null;
  seniorsExposed: number;
  demand: number;
  forecast: number;
  gen: number;
  tempF: number;
}

export interface ReplayState {
  running: boolean;
  scenario: string | null;
  title: string | null;
  model: string | null;
  i: number;
  n: number;
  speed: number;
}

export interface Scenario {
  key: string;
  title: string;
  hours: number;
  start: string;
  end: string;
  default_model: string;
}

export interface SystemInfo {
  machine: string;
  platform: string;
  byteorder: string;
  python: string;
  cpus: number;
  hostname: string;
  is_ibm_z: boolean;
}

export interface TierStat {
  precision: number;
  recall: number;
  lift: number;
  share_of_county_hours: number;
}

export interface ModelInfo {
  tiers: Record<string, number>;
  metrics: {
    train_rows?: number;
    train_end?: string;
    horizon_h?: number;
    horizons?: number[];
    note?: string;
    sets?: Record<string, { rows: number; positives: number; roc_auc: number; avg_precision: number; base_rate: number }>;
    horizon_auc?: Record<string, Record<string, number>>;
    tier_stats?: { base_rate: number; watch: TierStat; prepare: TierStat; act: TierStat };
    scenarios?: Record<string, Scorecard>;
    ranking?: Record<string, { top_k: number; precision: number; random: number; lift: number }>;
    top_weights?: { feature: string; weight: number }[];
  };
}

export interface Explain {
  county: County;
  risk: number;
  p6: number;
  p12: number;
  p24: number;
  window: string;
  tier: TierName;
  reasons: Reason[];
  groups: Record<string, { label: string; push: number }>;
  contributions: Record<string, number>;
}

export interface BenchResult {
  label: string;
  mode: string;
  machine: string;
  platform: string;
  cpus: number;
  n: number;
  tps: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  procs?: number;
  ts: string;
}

export async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** Poll an endpoint every `ms`. Returns the latest value (or null). */
export function usePoll<T>(path: string, ms: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      getJSON<T>(path)
        .then((d) => alive && setData(d))
        .catch(() => {});
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, ms]);
  return data;
}

export interface Replay {
  latest: HourEvent | null;
  history: HistoryPoint[];
  state: ReplayState | null;
  counties: County[];
  scenarios: Scenario[];
  connected: boolean;
  start: (scenario: string, model: string | null, speed: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  seek: (i: number) => Promise<void>;
}

/**
 * The live replay over SSE. Keeps the latest hour plus a compact hourly history
 * for charts, rendering at most once per animation frame.
 */
export function useReplay(): Replay {
  const [latest, setLatest] = useState<HourEvent | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [state, setState] = useState<ReplayState | null>(null);
  const [counties, setCounties] = useState<County[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [connected, setConnected] = useState(false);
  const pending = useRef<HourEvent[]>([]);

  const refresh = useCallback(() => {
    getJSON<ReplayState>("/api/state")
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    getJSON<Scenario[]>("/api/scenarios").then(setScenarios).catch(() => {});
    getJSON<County[]>("/api/counties?scenario=uri").then(setCounties).catch(() => {});
    const es = new EventSource("/api/events");
    let frame = 0;
    let timer = 0;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      frame = 0;
      timer = 0;
      const batch = pending.current;
      pending.current = [];
      if (!batch.length) return;
      const last = batch[batch.length - 1];
      setLatest(last);
      setHistory((prev) => {
        const next = prev.slice();
        for (const e of batch) {
          const pt: HistoryPoint = {
            i: e.i,
            t: e.t,
            out: e.out_total,
            severe: e.describe.severe_now,
            flagged: e.tier_counts[1] + e.tier_counts[2] + e.tier_counts[3],
            act: e.tier_counts[3],
            expected24: e.predict.expected_onsets[2],
            issued: e.predict.scoreboard.issued_24h_ago,
            actual: e.predict.scoreboard.actual_24h,
            seniorsExposed: e.predict.seniors_exposed,
            demand: e.grid.demand,
            forecast: e.grid.forecast,
            gen: e.grid.gen,
            tempF: e.diagnose.state.temp_f_mean,
          };
          if (next.length && next[next.length - 1].i >= pt.i) next.length = 0;
          next.push(pt);
        }
        return next;
      });
      setState((s) => (s ? { ...s, running: true, i: last.i + 1 } : s));
    };
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hour") {
        pending.current.push(msg as HourEvent);
        // rAF pauses in background tabs, so a timer backs it up.
        if (!frame) frame = requestAnimationFrame(flush);
        if (!timer) timer = window.setTimeout(flush, 150);
      } else if (msg.type === "reset") {
        pending.current = [];
        setLatest(null);
        setHistory([]);
        setState(msg as ReplayState);
      } else if (msg.type === "end") {
        setState(msg as ReplayState);
      }
    };
    return () => {
      es.close();
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const start = useCallback(
    async (scenario: string, model: string | null, speed: number) => {
      await postJSON("/api/replay/start", { scenario, model, speed });
      refresh();
    },
    [refresh],
  );
  const pause = useCallback(async () => {
    await postJSON("/api/replay/pause");
    refresh();
  }, [refresh]);
  const resume = useCallback(async () => {
    await postJSON("/api/replay/resume");
    refresh();
  }, [refresh]);
  const setSpeed = useCallback(async (speed: number) => {
    await postJSON("/api/replay/speed", { speed });
    setState((s) => (s ? { ...s, speed } : s));
  }, []);
  const seek = useCallback(
    async (i: number) => {
      await postJSON("/api/replay/seek", { i });
      refresh();
    },
    [refresh],
  );

  return { latest, history, state, counties, scenarios, connected, start, pause, resume, setSpeed, seek };
}

// ---------------------------------------------------------------- formatting

export const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
export const pct = (x: number, d = 0) => (x >= 0.995 ? ">99%" : `${(x * 100).toFixed(d)}%`);

/** 12,400 -> "12.4K", 3,200,000 -> "3.2M" */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

const CST = 6 * 3600 * 1000; // central standard time, which is how Texans lived these storms

export function fmtTime(iso: string): string {
  const ct = new Date(new Date(iso).getTime() - CST);
  const mo = ct.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = ct.getUTCHours();
  return `${mo} ${ct.getUTCDate()}, ${hh % 12 || 12}:00 ${hh >= 12 ? "PM" : "AM"} CST`;
}

export function fmtDay(iso: string): string {
  const ct = new Date(new Date(iso).getTime() - CST);
  return `${ct.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${ct.getUTCDate()}`;
}

export function timeAt(history: HistoryPoint[], i: number): string {
  const first = history[0];
  if (!first) return "";
  const hit = history.find((h) => h.i === i);
  if (hit) return hit.t; // live ticks are not hourly, so trust the recorded time
  return new Date(new Date(first.t).getTime() + (i - first.i) * 3600 * 1000).toISOString();
}

/** Chart x-domain: the whole storm for a replay, whatever has arrived so far for live. */
export function chartDomain(n: number | undefined): [number | string, number | string] {
  return n ? [0, n - 1] : ["dataMin", "dataMax"];
}

export function fmtClock(iso: string): string {
  const ct = new Date(new Date(iso).getTime() - CST);
  const hh = ct.getUTCHours();
  const mm = ct.getUTCMinutes();
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"} CST`;
}
