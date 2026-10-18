// Records a run of the demo outages from a running Uri Watch backend into public/demo/uri.json, so the
// front end can play it with no server (GitHub Pages, a phone with no signal, a teammate without the backend).
//
//   cd backend && ../.venv/bin/uvicorn uriwatch.api:app --host 127.0.0.1 --port 8010
//   node scripts/record-demo.mjs            # from this folder; takes a few minutes
import { writeFileSync } from "node:fs";

const API = process.env.API ?? "http://127.0.0.1:8010";
const FROM = Number(process.env.FROM ?? 80);
const TO = Number(process.env.TO ?? 200);
const SCENARIO = "uri";

const post = (p, body) => fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(r => r.json());
const get = p => fetch(API + p).then(r => r.json());

const events = new Map();
(async () => {
  const res = await fetch(API + "/api/events");
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let k;
    while ((k = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, k);
      buf = buf.slice(k + 2);
      const line = frame.split("\n").find(l => l.startsWith("data: "));
      if (!line) continue;
      const m = JSON.parse(line.slice(6));
      if (m.type === "hour") events.set(m.i, m);
    }
  }
})().catch(() => {});

await post("/api/ops/reset");
await post("/api/replay/start", { scenario: SCENARIO, speed: 1 });
await post("/api/replay/pause");

const hours = [];
for (let i = FROM; i <= TO; i++) {
  events.delete(i);
  await post("/api/replay/seek", { i: i + 1 }); // the server shows the hour it lands on: event index i
  for (let t = 0; t < 100 && !events.has(i); t++) await new Promise(r => setTimeout(r, 100));
  const ev = events.get(i);
  if (!ev) throw new Error(`no event for hour ${i}`);
  const plan = await get("/api/ops/plan");
  const priorities = plan.priorities.slice(0, 30);
  hours.push({ event: ev, plan: { priorities, staging: plan.staging, inventory: { context: plan.inventory.context, below_target: plan.inventory.below_target ?? [] } } });
  if ((i - FROM) % 10 === 0) console.log(`hour ${i} of ${TO}`);
}

const state = await get("/api/state");
const models = await get("/api/models");
const out = {
  meta: { scenario: SCENARIO, title: state.title, n: state.n, from: FROM, to: TO, recorded: new Date().toISOString() },
  scenarios: (await get("/api/scenarios")).filter(s => s.key === SCENARIO),
  counties: await get(`/api/counties?scenario=${SCENARIO}`),
  models: { honest: { tiers: models.honest.tiers, metrics: { scenarios: models.honest.metrics.scenarios, tier_stats: models.honest.metrics.tier_stats } } },
  ops: await get("/api/ops/state"),
  inventoryItems: (await get("/api/ops/plan")).inventory.items,
  hours,
};
writeFileSync("public/demo/uri.json", JSON.stringify(out));
console.log(`wrote public/demo/uri.json with ${hours.length} hours`);
process.exit(0);
