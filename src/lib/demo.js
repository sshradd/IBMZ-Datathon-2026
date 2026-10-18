// Recorded-demo mode: when no Relit server is reachable (GitHub Pages, a phone with no signal, a teammate
// who has not started the backend), the app plays a recorded run of the demo outages from public/demo/uri.json
// and keeps crews, assignments and inventory in the browser. It answers the same calls the real API does, so
// none of the screens know the difference. Add ?demo=1 to the address to force it even when a server is up.
import { etaMinutes } from "./decisions.js";

const URL_DATA = `${import.meta.env.BASE_URL}demo/uri.json`;
const TICK_MS = 900; // one recorded hour per tick
const LOOP_TO = 90; // after the last hour, start again from the hour the first warnings go up
const TYPE_LABEL = { line: "Line", shelter: "Shelter", outreach: "Outreach" };
const TYPE_CODE = { line: "LI", shelter: "SH", outreach: "OU" };

let data = null;
let on = false;
let ops = null;
let targets = {};
const sim = { started: false, running: false, next: 0, cur: null, last: null, timer: 0 };
const sources = new Set();

export const isDemo = () => on;

export async function probeLive(api) {
  if (new URLSearchParams(location.search).has("demo")) return false;
  try {
    const r = await fetch(`${api}/api/state`, { signal: AbortSignal.timeout(4000) });
    return r.ok && (r.headers.get("content-type") ?? "").includes("json");
  } catch {
    return false;
  }
}

export async function enableDemo() {
  if (!data) data = await (await fetch(URL_DATA)).json();
  resetOps();
  on = true;
}

function resetOps() {
  ops = JSON.parse(JSON.stringify(data.ops));
  targets = {};
  recount();
}

const first = () => data.meta.from;
const last = () => data.meta.to;
const frame = h => data.hours[h - first()];

function recount() {
  for (const d of ops.depots) {
    for (const t of Object.keys(d.units)) d.available[t] = ops.units.filter(u => u.depot === d.id && u.type === t && u.status === "available").length;
  }
}

function status() {
  return { running: sim.running, scenario: sim.started ? data.meta.scenario : null, title: data.meta.title, model: "honest", i: sim.next, n: data.meta.n, speed: 1 };
}

function emit(msg) {
  const text = JSON.stringify(msg);
  for (const es of sources) es.onmessage?.({ data: text });
}

function showHour(h) {
  const ev = frame(h).event;
  sim.cur = h;
  sim.last = ev;
  sim.next = h + 1;
  emit(ev);
}

function tick() {
  sim.timer = 0;
  if (!sim.running) return;
  if (sim.next > last()) {
    // loop the demo: clear the crews and start over
    resetOps();
    sim.next = LOOP_TO;
    emit({ type: "reset", ...status() });
  }
  showHour(sim.next);
  sim.timer = window.setTimeout(tick, TICK_MS);
}

function schedule() {
  if (!sim.timer && sim.running) sim.timer = window.setTimeout(tick, 60);
}

/** Stands in for EventSource. */
export class DemoEventSource {
  constructor() {
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    sources.add(this);
    setTimeout(() => {
      this.onopen?.();
      if (sim.last) this.onmessage?.({ data: JSON.stringify(sim.last) });
    }, 0);
  }
  close() {
    sources.delete(this);
  }
}

class DemoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const plan = () => (sim.cur == null ? null : frame(sim.cur).plan);

function totals() {
  const out = {};
  for (const t of Object.keys(TYPE_LABEL)) {
    const us = ops.units.filter(u => u.type === t);
    out[t] = {
      available: us.filter(u => u.status === "available").length,
      en_route: us.filter(u => u.status === "en_route").length,
      on_site: us.filter(u => u.status === "on_site").length,
      resting: us.filter(u => u.status === "resting").length,
      total: us.length,
    };
  }
  return out;
}

function inventory(p) {
  const items = data.inventoryItems.map(i => {
    const have = ops.depots.reduce((n, d) => n + (d.stock[i.id] ?? 0), 0);
    const target = targets[i.id] ?? null;
    const status = target == null ? null : have >= target ? "ok" : have >= target * 0.5 ? "low" : "short";
    return { ...i, have, target, status, below_by: target != null && have < target ? target - have : 0 };
  });
  return { items, context: p.inventory.context, below_target: items.filter(i => i.below_by > 0).map(i => i.label) };
}

function dispatch(orders) {
  const p = plan();
  const out = { dispatched: 0, work_orders: [], short: [] };
  for (const o of orders) {
    const c = data.counties.find(x => x.fips === o.fips);
    if (!c) continue;
    const pr = p?.priorities.find(x => x.fips === o.fips);
    for (const kind of Object.keys(TYPE_LABEL)) {
      const want = o[kind] ?? 0;
      let got = 0;
      for (let k = 0; k < want; k++) {
        const free = ops.units.filter(u => u.type === kind && u.status === "available");
        if (!free.length) break;
        let best = null;
        for (const u of free) {
          const d = ops.depots.find(x => x.id === u.depot);
          const eta = etaMinutes(d, c, (pr?.temp_f ?? 60) <= 34);
          if (!best || eta < best.eta) best = { u, d, eta };
        }
        const windowStart = pr ? pr.depart_by_min + (pr.nearest?.eta_min ?? best.eta) : 0;
        best.u.status = "en_route";
        best.u.assignment = { fips: o.fips, county: c.name, eta_min: best.eta, depart_by_min: pr ? Math.max(0, windowStart - best.eta) : 0, window: pr?.window ?? "now", urgency: pr?.urgency ?? "now" };
        const maps = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}`;
        out.work_orders.push({
          unit_id: best.u.id, unit_name: best.u.name, county: c.name, maps_url: maps,
          text: `RECOMMENDATION · ${best.u.name} (${best.u.size} workers)\nSuggested: ${c.name} County, travel ${best.eta} min\nNavigate: ${maps}`,
        });
        out.dispatched++;
        got++;
      }
      if (got < want) out.short.push({ fips: o.fips, county: c.name, type: kind, requested: want, assigned: got });
    }
  }
  recount();
  return out;
}

function addUnit(depot, type) {
  const n = ops.units.filter(u => u.depot === depot.id && u.type === type).length + 1;
  const proto = ops.units.find(u => u.type === type);
  ops.units.push({ id: `${TYPE_CODE[type]}-${depot.id.toUpperCase()}-${String(n).padStart(2, "0")}`, name: `${depot.name} ${TYPE_LABEL[type]} ${n}`, type, depot: depot.id, size: proto?.size ?? 4, status: "available", assignment: null });
}

/** Stands in for the API: same paths, same answers. */
export async function demoCall(method, path, body) {
  const [route, query] = path.split("?");
  const key = `${method} ${route}`;
  if (key === "GET /api/state") return status();
  if (key === "GET /api/scenarios") return data.scenarios;
  if (key === "GET /api/counties") return data.counties;
  if (key === "GET /api/models") return data.models;
  if (key === "GET /api/ops/state") return JSON.parse(JSON.stringify({ ...ops, items: ops.items.map(i => ({ ...i, target: targets[i.id] ?? null })) }));
  if (key === "GET /api/ops/plan") {
    const p = plan();
    if (!p) throw new DemoError(409, "no forecast yet");
    return { priorities: p.priorities, totals: totals(), staging: p.staging, inventory: inventory(p) };
  }
  if (key === "GET /api/ops/sitrep") return { markdown: "# Situation report\n\nRecorded demo. Crews and inventory are sample data." };
  if (key === "POST /api/replay/start") {
    sim.started = true;
    sim.running = true;
    resetOps();
    sim.cur = null;
    sim.last = null;
    sim.next = first();
    emit({ type: "reset", ...status() });
    schedule();
    return status();
  }
  if (key === "POST /api/replay/seek") {
    const h = Math.min(last(), Math.max(first(), Number(body?.i ?? first())));
    sim.next = h;
    emit({ type: "reset", ...status() });
    showHour(h);
    if (sim.running) {
      window.clearTimeout(sim.timer);
      sim.timer = window.setTimeout(tick, TICK_MS);
    }
    return status();
  }
  if (key === "POST /api/replay/pause") {
    sim.running = false;
    window.clearTimeout(sim.timer);
    sim.timer = 0;
    emit({ type: "end", ...status() });
    return status();
  }
  if (key === "POST /api/replay/resume") {
    sim.running = true;
    schedule();
    return status();
  }
  if (key === "POST /api/replay/speed") return status();
  if (key === "POST /api/ops/dispatch") return dispatch(body?.orders ?? []);
  if (key === "POST /api/ops/undo") {
    let n = 0;
    for (const u of ops.units) {
      if (u.status === "en_route" && u.assignment && (!body?.fips || body.fips.includes(u.assignment.fips))) {
        u.status = "available";
        u.assignment = null;
        n++;
      }
    }
    recount();
    return { recalled: n };
  }
  if (key === "POST /api/ops/reset") {
    resetOps();
    return { sample: true };
  }
  if (key === "PUT /api/ops/units") {
    const d = ops.depots.find(x => x.id === body.depot);
    if (!d) throw new DemoError(404, "no such depot");
    const have = ops.units.filter(u => u.depot === d.id && u.type === body.type);
    if (body.count > have.length) for (let k = have.length; k < body.count; k++) addUnit(d, body.type);
    else for (const u of have.filter(x => x.status === "available").slice(0, have.length - body.count)) ops.units.splice(ops.units.indexOf(u), 1);
    d.units[body.type] = ops.units.filter(u => u.depot === d.id && u.type === body.type).length;
    recount();
    return { ok: true };
  }
  if (key === "PUT /api/ops/inventory") {
    const d = ops.depots.find(x => x.id === body.depot);
    if (d) d.stock[body.item] = body.qty;
    return { ok: true };
  }
  if (key === "PUT /api/ops/targets") {
    if (body.target == null) delete targets[body.item];
    else targets[body.item] = body.target;
    return { ok: true };
  }
  const m = route.match(/^\/api\/ops\/units\/(.+)\/status$/);
  if (method === "POST" && m) {
    const u = ops.units.find(x => x.id === decodeURIComponent(m[1]));
    if (u) {
      u.status = body.status;
      if (body.status === "available") u.assignment = null;
    }
    recount();
    return { ok: true };
  }
  void query;
  throw new DemoError(404, `demo has no ${key}`);
}
