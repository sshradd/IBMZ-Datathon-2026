import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_QTY } from "./decisions.js";
import { DemoEventSource, demoCall, enableDemo, isDemo, probeLive } from "./demo.js";

const API = import.meta.env.VITE_API ?? "";
const QUEUE_KEY = "uw-queue";
const LAST_KEY = "uw-last";
// Winter Storm Uri, 2021-02-08 + 90 h: the first warnings are up and crews still have time to move
const DEMO = { scenario: "uri", hour: 90 };
export const UNDO_MS = 10000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body) {
  if (isDemo()) return demoCall(method, path, body);
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

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
  }
}

/** The same call the store makes, for pages that need one directly. */
export const api = (method, path, body) => call(method, path, body);

const Ctx = createContext(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

export function StoreProvider({ children }) {
  const [latest, setLatest] = useState(null);
  const [demo, setDemo] = useState(false); // true when playing the recorded demo because no server answered
  const [state, setState] = useState(null);
  const [counties, setCounties] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [plan, setPlan] = useState(null);
  const [ops, setOps] = useState(null);
  const [selected, setSelected] = useState(null);
  const [models, setModels] = useState(null);
  const [pendingUndo, setPendingUndo] = useState(null);
  const [assign, setAssign] = useState(null); // the orders being reviewed in the assign popup
  const openAssign = useCallback(orders => setAssign(orders.length ? orders : null), []);
  const closeAssign = useCallback(() => setAssign(null), []);
  const [composer, setComposer] = useState(null); // the text-a-crew sheet: { unitId } while open
  const openComposer = useCallback((unitId = null) => setComposer({ unitId }), []);
  const closeComposer = useCallback(() => setComposer(null), []);
  const [history, setHistory] = useState([]); // the last hours, small, so the map can be scrubbed back
  const [lastEventAt, setLastEventAt] = useState(0); // wall-clock time of the latest forecast hour, for the feed strip
  const [assignedAt, setAssignedAt] = useState({}); // unit id -> the data clock when it joined the plan, for countdowns
  const [draft, setDraft] = useState(null); // a generic text draft: { title, eyebrow, text, key }
  const openDraft = useCallback(d => setDraft(d), []);
  const closeDraft = useCallback(() => setDraft(null), []);
  const [toast, setToast] = useState(null);
  const [qty, setQtyState] = useState({});
  const [series, setSeries] = useState([]);
  const pending = useRef([]);
  const lastPlanAt = useRef(0);
  const planTimer = useRef(undefined);
  const undoTimer = useRef(undefined);
  const toastTimer = useRef(undefined);

  const say = useCallback(msg => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ---- data fetching ----
  const refreshState = useCallback(() => call("GET", "/api/state").then(setState).catch(() => {}), []);
  const refreshOps = useCallback(() => call("GET", "/api/ops/state").then(setOps).catch(() => {}), []);
  const refreshPlan = useCallback(async () => {
    lastPlanAt.current = Date.now();
    try {
      const p = await call("GET", "/api/ops/plan");
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
    async (method, path, body, label) => {
      if (!navigator.onLine) {
        writeQueue([...readQueue(), { method, path, body, label }]);
        setQueued(readQueue().length);
        say(`Offline: "${label}" is saved and will sync when you reconnect`);
        return null;
      }
      try {
        return await call(method, path, body);
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
    let cancelled = false;
    let stop = () => {};
    const boot = () => {
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
    call("GET", "/api/scenarios").then(setScenarios).catch(() => {});
    call("GET", "/api/counties?scenario=uri").then(setCounties).catch(() => {});
    call("GET", "/api/models").then(setModels).catch(() => {});
    void refreshPlan();

    const es = isDemo() ? new DemoEventSource() : new EventSource(`${API}/api/events`);
    let timer = 0;
    const flushEvents = () => {
      window.clearTimeout(timer);
      timer = 0;
      const batch = pending.current;
      pending.current = [];
      if (!batch.length) return;
      const last = batch[batch.length - 1];
      setLatest(last);
      setLastEventAt(Date.now());
      setState(s => (s ? { ...s, running: true, i: last.i + 1 } : s));
      setSeries(prev => {
        const next = prev.length && prev[prev.length - 1].i >= batch[0].i ? [] : prev.slice(-300);
        for (const e of batch) next.push({ i: e.i, out: e.out_total, flagged: e.tier_counts[1] + e.tier_counts[2] + e.tier_counts[3] });
        return next;
      });
      setHistory(prev => {
        const next = prev.length && prev[prev.length - 1].i >= batch[0].i ? [] : prev.slice(-71);
        for (const e of batch) next.push({ i: e.i, t: e.t, counties: e.counties, out_total: e.out_total });
        return next.slice(-72);
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
    es.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hour") {
        pending.current.push(msg);
        if (!timer) timer = window.setTimeout(flushEvents, 120);
      } else if (msg.type === "reset") {
        pending.current = [];
        setLatest(null);
        setSeries([]);
        setHistory([]);
        setAssignedAt({});
        setPlan(null);
        setState(msg);
      } else if (msg.type === "end") {
        setState(msg);
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
    };
    (async () => {
      if (!(await probeLive(API))) {
        await enableDemo();
        if (cancelled) return;
        setDemo(true);
      }
      if (!cancelled) stop = boot();
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [refreshState, refreshOps, refreshPlan, schedulePlan, flush]);

  // ---- actions ----
  const start = useCallback(
    async (scenario, model) => {
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
    async i => {
      await call("POST", "/api/replay/seek", { i });
      void refreshState();
    },
    [refreshState],
  );

  const setQty = useCallback((fips, q) => setQtyState(m => ({ ...m, [fips]: q })), []);

  const dispatch = useCallback(
    async orders => {
      const r = await mutate("POST", "/api/ops/dispatch", { orders }, "Add to plan");
      if (!r) return [];
      await Promise.all([refreshOps(), refreshPlan()]);
      if (r.dispatched > 0) {
        window.clearTimeout(undoTimer.current);
        setPendingUndo({ count: r.dispatched, fips: orders.map(o => o.fips), units: r.work_orders.map(w => w.unit_id), until: Date.now() + UNDO_MS });
        undoTimer.current = window.setTimeout(() => setPendingUndo(null), UNDO_MS);
        if (r.short.length) say(`Only ${r.dispatched} units were free for the plan: ${r.short.map(x => `${x.county} got ${x.assigned} of ${x.requested} ${x.type}`).join(", ")}`);
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
    const r = await mutate("POST", "/api/ops/undo", { fips: p?.fips ?? null }, "Undo add to plan");
    if (r) say(`Removed ${r.recalled} units from the plan`);
    await Promise.all([refreshOps(), refreshPlan()]);
  }, [pendingUndo, mutate, refreshOps, refreshPlan, say]);

  const after = useCallback(async () => {
    await Promise.all([refreshOps(), refreshPlan()]);
  }, [refreshOps, refreshPlan]);

  const setUnitCount = useCallback(
    async (depot, type, count) => {
      await mutate("PUT", "/api/ops/units", { depot, type, count }, "Change crews");
      await after();
    },
    [mutate, after],
  );
  const setStock = useCallback(
    async (depot, item, q) => {
      await mutate("PUT", "/api/ops/inventory", { depot, item, qty: q }, "Change stock");
      await after();
    },
    [mutate, after],
  );
  const setTarget = useCallback(
    async (item, target) => {
      await mutate("PUT", "/api/ops/targets", { item, target }, "Change inventory target");
      await after();
    },
    [mutate, after],
  );
  const setUnitStatus = useCallback(
    async (id, status) => {
      await mutate("POST", `/api/ops/units/${id}/status`, { status }, "Update crew status");
      await after();
    },
    [mutate, after],
  );
  const sitrep = useCallback(async () => (await call("GET", "/api/ops/sitrep")).markdown, []);

  // note when each crew joined the plan, on the data's own clock, so a countdown to leaving can keep running
  useEffect(() => {
    if (!ops) return;
    const t = latest ? Date.parse(latest.as_of ?? latest.t) : NaN;
    setAssignedAt(prev => {
      const next = {};
      let changed = false;
      for (const u of ops.units) {
        if (!u.assignment || !(u.status === "en_route" || u.status === "on_site")) continue;
        if (prev[u.id] != null) next[u.id] = prev[u.id];
        else if (!Number.isNaN(t)) {
          next[u.id] = t;
          changed = true;
        }
      }
      return !changed && Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [ops, latest]);

  const tiers = models?.[state?.model ?? "honest"]?.tiers ?? models?.honest?.tiers ?? null;

  const value = useMemo(
    () => ({
      latest, state, counties, scenarios, connected, online, queued, plan, ops, tiers, selected, setSelected, pendingUndo, assign, openAssign, closeAssign, composer, openComposer, closeComposer, demo, toast, say, series, history, lastEventAt, assignedAt, draft, openDraft, closeDraft,
      qty, setQty, start, startDemo, pause, resume, seek, dispatch, undo, setUnitCount, setStock, setTarget, setUnitStatus, sitrep, refreshPlan,
    }),
    [latest, state, counties, scenarios, connected, online, queued, plan, ops, tiers, selected, pendingUndo, assign, openAssign, closeAssign, composer, openComposer, closeComposer, demo, toast, say, series, history, lastEventAt, assignedAt, draft, openDraft, closeDraft,
      qty, setQty, start, startDemo, pause, resume, seek, dispatch, undo, setUnitCount, setStock, setTarget, setUnitStatus, sitrep, refreshPlan],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { DEFAULT_QTY };
