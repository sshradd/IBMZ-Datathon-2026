import { useCallback, useEffect, useRef, useState } from "react";

export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ["clear", "watch", "prepare", "act"] as const;

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

export interface TopCounty {
  fips: string;
  name: string;
  risk: number;
  tier: (typeof TIER_NAMES)[number];
  seniors_at_risk: number;
  people_at_risk: number;
  out: number;
  grid_share: number;
  reasons: Reason[];
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

export interface HourEvent {
  type: "hour";
  i: number;
  n: number;
  t: string;
  grid: { demand: number; forecast: number; gen: number };
  /** [risk, tier, customers out] per county, same order as the county list */
  counties: [number, Tier, number][];
  tier_counts: [number, number, number, number];
  out_total: number;
  top: TopCounty[];
  scorecard: Scorecard;
  latency: { scored: number; p50_ms: number; p99_ms: number; scores_per_s: number };
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

export interface ModelInfo {
  tiers: Record<string, number>;
  metrics: {
    train_rows?: number;
    train_end?: string;
    horizon_h?: number;
    note?: string;
    sets?: Record<string, { rows: number; positives: number; roc_auc: number; avg_precision: number; base_rate: number }>;
    scenarios?: Record<string, Scorecard>;
    ranking?: Record<string, { top_k: number; precision: number; random: number; lift: number }>;
    top_weights?: { feature: string; weight: number }[];
  };
}

export interface BenchResult {
  label: string;
  mode: "engine" | "http";
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
  concurrency?: number;
  ts: string;
}

export interface HistoryPoint {
  i: number;
  t: string;
  out: number;
  flagged: number;
  act: number;
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

/**
 * The live replay over SSE. Keeps only the latest hour plus a compact
 * statewide history for the timeline, rendering at most once per frame.
 */
export function useReplay() {
  const [latest, setLatest] = useState<HourEvent | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [state, setState] = useState<ReplayState | null>(null);
  const [connected, setConnected] = useState(false);
  const pending = useRef<HourEvent[]>([]);

  const refreshState = useCallback(() => {
    getJSON<ReplayState>("/api/state")
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshState();
    const es = new EventSource("/api/events");
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending.current;
      pending.current = [];
      if (!batch.length) return;
      setLatest(batch[batch.length - 1]);
      setHistory((prev) => {
        const next = prev.slice();
        for (const e of batch) {
          const pt = {
            i: e.i,
            t: e.t,
            out: e.out_total,
            flagged: e.tier_counts[1] + e.tier_counts[2] + e.tier_counts[3],
            act: e.tier_counts[3],
          };
          if (next.length && next[next.length - 1].i >= pt.i) next.length = 0;
          next.push(pt);
        }
        return next;
      });
      setState((s) => (s ? { ...s, running: true, i: batch[batch.length - 1].i + 1 } : s));
    };
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hour") {
        pending.current.push(msg as HourEvent);
        if (!frame) frame = requestAnimationFrame(flush);
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
    };
  }, [refreshState]);

  return { latest, history, state, connected, refreshState };
}

export const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export function fmtTime(iso: string): string {
  // "2021-02-15T07:00Z" shown in Central Time (CST, UTC-6) since that's how Texans lived it
  const d = new Date(iso);
  const ct = new Date(d.getTime() - 6 * 3600 * 1000);
  const mo = ct.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = ct.getUTCHours();
  const ap = hh >= 12 ? "PM" : "AM";
  return `${mo} ${ct.getUTCDate()}, ${hh % 12 || 12}:00 ${ap} CST`;
}
