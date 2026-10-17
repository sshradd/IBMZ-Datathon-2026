"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { County, HourEvent, Order, OpsPlan, OpsState, ReplayState, Scenario, Unit, WorkOrder } from "./types";

export interface Tiers {
  watch: number;
  prepare: number;
  act: number;
}

const API = process.env.NEXT_PUBLIC_API ?? "";
const QUEUE_KEY = "uw-queue";
const LAST_KEY = "uw-last";
// Winter Storm Uri, 2021-02-08 + 90 h: the first warnings are up and crews still have time to move
const DEMO = { scenario: "uri", hour: 90 };
export const UNDO_MS = 10000;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, msg);
  }
  return r.json();
}

interface Queued {
  method: string;
  path: string;
  body?: unknown;
  label: string;
}

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
  }
}

/** How many of each unit the responder wants to include in the plan for one county. */
export interface Qty {
  line: number;
  shelter: number;
  outreach: number;
}
export const DEFAULT_QTY: Qty = { line: 1, shelter: 0, outreach: 0 };

export interface PendingUndo {
  count: number;
  fips: string[] | null;
  until: number;
}

export interface Store {
  latest: HourEvent | null;
  state: ReplayState | null;
  counties: County[];
  scenarios: Scenario[];
  connected: boolean;
  online: boolean;
  queued: number;
  plan: OpsPlan | null;
  ops: OpsState | null;
  tiers: Tiers | null;
  selected: string | null;
  setSelected: (f: string | null) => void;
  pendingUndo: PendingUndo | null;
  toast: string | null;
  say: (msg: string) => void;
  series: { i: number; out: number; flagged: number }[];
  start: (scenario: string, model?: string | null) => Promise<void>;
  /** the demo outages, opened at the hour the first warnings go up */
  startDemo: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (i: number) => Promise<void>;
  setSpeed: (s: number) => Promise<void>;
  qty: Record<string, Qty>;
  setQty: (fips: string, q: Qty) => void;
  dispatch: (orders: Order[]) => Promise<WorkOrder[]>;
  undo: () => Promise<void>;
  setUnitCount: (depot: string, type: string, count: number) => Promise<void>;
  setStock: (depot: string, item: string, qty: number) => Promise<void>;
  setTarget: (item: string, target: number | null) => Promise<void>;
  setUnitStatus: (id: string, status: Unit["status"]) => Promise<void>;
  sitrep: () => Promise<string>;
  refreshPlan: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = (): Store => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<HourEvent | null>(null);
  const [state, setState] = useState<ReplayState | null>(null);
  const [counties, setCounties] = useState<County[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [plan, setPlan] = useState<OpsPlan | null>(null);
  const [ops, setOps] = useState<OpsState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, { tiers: Tiers }> | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [qty, setQtyState] = useState<Record<string, Qty>>({});
  const [series, setSeries] = useState<{ i: number; out: number; flagged: number }[]>([]);
  const pending = useRef<HourEvent[]>([]);
  const lastPlanAt = useRef(0);
  const planTimer = useRef<number | undefined>(undefined);
  const undoTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ---- data fetching ----
  const refreshState = useCallback(() => call<ReplayState>("GET", "/api/state").then(setState).catch(() => {}), []);
  const refreshOps = useCallback(() => call<OpsState>("GET", "/api/ops/state").then(setOps).catch(() => {}), []);
  const refreshPlan = useCallback(async () => {
    lastPlanAt.current = Date.now();
    try {
      const p = await call<OpsPlan>("GET", "/api/ops/plan");
      setPlan(p);
      try {
        localStorage.setItem(`${LAST_KEY}-plan`, JSON.stringify(p));
      } catch {
        /* storage unavailable */
      }
    } catch {
      /* no forecast yet, or offline: keep the last plan */
    }
  }, []);

  const schedulePlan = useCallback(() => {
    if (Date.now() - lastPlanAt.current > 2500) {
      void refreshPlan();
    } else if (!planTimer.current) {
      planTimer.current = window.setTimeout(() => {
        planTimer.current = undefined;
        void refreshPlan();
      }, 2500);
    }
  }, [refreshPlan]);

  // ---- offline action queue ----
  const flush = useCallback(async () => {
    let q = readQueue();
    while (q.length) {
      const [head, ...rest] = q;
      try {
        await call(head.method, head.path, head.body);
        q = rest;
        writeQueue(q);
        setQueued(q.length);
      } catch (e) {
        if (e instanceof ApiError) {
          q = rest; // the server refused it: drop it rather than retry forever
          writeQueue(q);
          setQueued(q.length);
        } else {
          return;
        }
      }
    }
    void refreshOps();
    void refreshPlan();
  }, [refreshOps, refreshPlan]);

  /** Save a change. Offline, it joins the queue and syncs when the connection returns. */
  const mutate = useCallback(
    async <T,>(method: string, path: string, body: unknown | undefined, label: string): Promise<T | null> => {
      if (!navigator.onLine) {
        writeQueue([...readQueue(), { method, path, body, label }]);
        setQueued(readQueue().length);
        say(`Offline: "${label}" is saved and will sync when you reconnect`);
        return null;
      }
      try {
        return await call<T>(method, path, body);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        writeQueue([...readQueue(), { method, path, body, label }]);
        setQueued(readQueue().length);
        say(`No connection: "${label}" is queued`);
        return null;
      }
    },
    [say],
  );

  // ---- boot: stream + restore ----
  useEffect(() => {
    setOnline(navigator.onLine);
    setQueued(readQueue().length);
    try {
      const last = localStorage.getItem(LAST_KEY);
      if (last) setLatest(JSON.parse(last));
      const lp = localStorage.getItem(`${LAST_KEY}-plan`);
      if (lp) setPlan(JSON.parse(lp));
    } catch {
      /* nothing cached yet */
    }
    void refreshState();
    void refreshOps();
    call<Scenario[]>("GET", "/api/scenarios").then(setScenarios).catch(() => {});
    call<County[]>("GET", "/api/counties?scenario=uri").then(setCounties).catch(() => {});
    call<Record<string, { tiers: Tiers }>>("GET", "/api/models").then(setModels).catch(() => {});
    void refreshPlan();

    const es = new EventSource(`${API}/api/events`);
    let timer = 0;
    const flushEvents = () => {
      window.clearTimeout(timer);
      timer = 0;
      const batch = pending.current;
      pending.current = [];
      if (!batch.length) return;
      const last = batch[batch.length - 1];
      setLatest(last);
      setState((s) => (s ? { ...s, running: true, i: last.i + 1 } : s));
      setSeries((prev) => {
        const next = prev.length && prev[prev.length - 1].i >= batch[0].i ? [] : prev.slice(-300);
        for (const e of batch) next.push({ i: e.i, out: e.out_total, flagged: e.tier_counts[1] + e.tier_counts[2] + e.tier_counts[3] });
        return next;
      });
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(last));
      } catch {
        /* storage unavailable */
      }
      schedulePlan();
    };
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hour") {
        pending.current.push(msg as HourEvent);
        if (!timer) timer = window.setTimeout(flushEvents, 120);
      } else if (msg.type === "reset") {
        pending.current = [];
        setLatest(null);
        setSeries([]);
        setPlan(null);
        setState(msg as ReplayState);
      } else if (msg.type === "end") {
        setState(msg as ReplayState);
      }
    };

    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    if (navigator.onLine) void flush();
    return () => {
      es.close();
      window.clearTimeout(timer);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [refreshState, refreshOps, refreshPlan, schedulePlan, flush]);

  // ---- actions ----
  const start = useCallback(
    async (scenario: string, model?: string | null) => {
      await call("POST", "/api/replay/start", { scenario, model: model || null, speed: 12 });
      void refreshState();
      void refreshOps();
    },
    [refreshState, refreshOps],
  );
  const startDemo = useCallback(async () => {
    await start(DEMO.scenario);
    await call("POST", "/api/replay/seek", { i: DEMO.hour });
    void refreshState();
  }, [start, refreshState]);
  const pause = useCallback(async () => {
    await call("POST", "/api/replay/pause");
    void refreshState();
  }, [refreshState]);
  const resume = useCallback(async () => {
    await call("POST", "/api/replay/resume");
    void refreshState();
  }, [refreshState]);
  const seek = useCallback(
    async (i: number) => {
      await call("POST", "/api/replay/seek", { i });
      void refreshState();
    },
    [refreshState],
  );
  const setSpeed = useCallback(async (speed: number) => {
    await call("POST", "/api/replay/speed", { speed });
    setState((s) => (s ? { ...s, speed } : s));
  }, []);

  const setQty = useCallback((fips: string, q: Qty) => setQtyState((m) => ({ ...m, [fips]: q })), []);

  const dispatch = useCallback(
    async (orders: Order[]) => {
      const r = await mutate<{ dispatched: number; work_orders: WorkOrder[]; short: { county: string; type: string; requested: number; assigned: number }[] }>(
        "POST",
        "/api/ops/dispatch",
        { orders },
        "Add to plan",
      );
      if (!r) return [];
      await Promise.all([refreshOps(), refreshPlan()]);
      if (r.dispatched > 0) {
        window.clearTimeout(undoTimer.current);
        setPendingUndo({ count: r.dispatched, fips: orders.map((o) => o.fips), until: Date.now() + UNDO_MS });
        undoTimer.current = window.setTimeout(() => setPendingUndo(null), UNDO_MS);
        if (r.short.length) say(`Only ${r.dispatched} units were free for the plan: ${r.short.map((x) => `${x.county} got ${x.assigned} of ${x.requested} ${x.type}`).join(", ")}`);
      } else {
        say("No units are free to add to the plan");
      }
      return r.work_orders;
    },
    [mutate, refreshOps, refreshPlan, say],
  );

  const undo = useCallback(async () => {
    const p = pendingUndo;
    window.clearTimeout(undoTimer.current);
    setPendingUndo(null);
    const r = await mutate<{ recalled: number }>("POST", "/api/ops/undo", { fips: p?.fips ?? null }, "Undo add to plan");
    if (r) say(`Removed ${r.recalled} units from the plan`);
    await Promise.all([refreshOps(), refreshPlan()]);
  }, [pendingUndo, mutate, refreshOps, refreshPlan, say]);

  const after = useCallback(async () => {
    await Promise.all([refreshOps(), refreshPlan()]);
  }, [refreshOps, refreshPlan]);

  const setUnitCount = useCallback(
    async (depot: string, type: string, count: number) => {
      await mutate("PUT", "/api/ops/units", { depot, type, count }, "Change crews");
      await after();
    },
    [mutate, after],
  );
  const setStock = useCallback(
    async (depot: string, item: string, qty: number) => {
      await mutate("PUT", "/api/ops/inventory", { depot, item, qty }, "Change stock");
      await after();
    },
    [mutate, after],
  );
  const setTarget = useCallback(
    async (item: string, target: number | null) => {
      await mutate("PUT", "/api/ops/targets", { item, target }, "Change inventory target");
      await after();
    },
    [mutate, after],
  );
  const setUnitStatus = useCallback(
    async (id: string, status: Unit["status"]) => {
      await mutate("POST", `/api/ops/units/${id}/status`, { status }, "Update crew status");
      await after();
    },
    [mutate, after],
  );
  const sitrep = useCallback(async () => (await call<{ markdown: string }>("GET", "/api/ops/sitrep")).markdown, []);

  const tiers = models?.[state?.model ?? "honest"]?.tiers ?? models?.honest?.tiers ?? null;

  const value = useMemo<Store>(
    () => ({
      latest, state, counties, scenarios, connected, online, queued, plan, ops, tiers, selected, setSelected, pendingUndo, toast, say, series,
      qty, setQty, start, startDemo, pause, resume, seek, setSpeed, dispatch, undo, setUnitCount, setStock, setTarget, setUnitStatus, sitrep, refreshPlan,
    }),
    [latest, state, counties, scenarios, connected, online, queued, plan, ops, tiers, selected, pendingUndo, toast, say, series,
      qty, setQty, start, startDemo, pause, resume, seek, setSpeed, dispatch, undo, setUnitCount, setStock, setTarget, setUnitStatus, sitrep, refreshPlan],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
