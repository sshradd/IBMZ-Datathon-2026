import { useEffect, useRef, useState } from "react";

export type Action = "allow" | "step_up" | "hold";

export interface Txn {
  id: string;
  ts: number;
  sender_id: string;
  receiver_id: string;
  amount: number;
  memo: string;
  sender_age_band: "18-34" | "35-64" | "65+";
  sender_account_age_days: number;
  receiver_account_age_days: number;
  label_fraud: boolean | null;
  scenario: string | null;
}

export interface Reason {
  code: string;
  text: string;
  weight: number;
}

export interface Decision {
  txn_id: string;
  risk: number;
  action: Action;
  reasons: Reason[];
  sender_score: number;
  receiver_score: number;
  latency_ms: number;
}

export interface ScoredEvent {
  txn: Txn;
  decision: Decision;
}

export interface Stats {
  processed: number;
  actions: Record<Action, number>;
  amount_held: number;
  fraud_amount_stopped: number;
  precision: number | null;
  recall: number | null;
  false_positive_rate: number | null;
  latency_ms: { p50: number; p95: number; p99: number; max: number };
  tps_5s: number;
  running: boolean;
  config: { speed: number; fraud_rate: number };
  model: Record<string, unknown>;
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

export interface GraphNode {
  id: string;
  kind: "sender" | "receiver";
  senior?: boolean;
  age_days?: number;
  total?: number;
  fan_in?: number;
  held?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  amount: number;
  action: Action;
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

/** Live scored events over SSE, batched into one render per animation frame. */
export function useEvents(maxFeed = 60, maxAlerts = 40) {
  const [feed, setFeed] = useState<ScoredEvent[]>([]);
  const [alerts, setAlerts] = useState<ScoredEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const buffer = useRef<ScoredEvent[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = buffer.current.reverse();
      buffer.current = [];
      setFeed((prev) => [...batch, ...prev].slice(0, maxFeed));
      const flagged = batch.filter((e) => e.decision.action !== "allow");
      if (flagged.length) setAlerts((prev) => [...flagged, ...prev].slice(0, maxAlerts));
    };
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      buffer.current.push(JSON.parse(m.data));
      if (!frame) frame = requestAnimationFrame(flush);
    };
    return () => {
      es.close();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [maxFeed, maxAlerts]);

  const clear = () => {
    setFeed([]);
    setAlerts([]);
  };
  return { feed, alerts, connected, clear };
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
