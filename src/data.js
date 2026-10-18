// Replace with fetch("/api/...") once backend is ready. Keep the same shapes.
// Backend: send the same fields per county. `fips` links each row to its real Texas county shape.
const base = [
  { fips: "48201", name: "Harris",  risk: 92, delta: 14, exposure: 48200, sites: 12, crewHours: 4 },
  { fips: "48113", name: "Dallas",  risk: 84, delta: 9,  exposure: 31800, sites: 8,  crewHours: 3 },
  { fips: "48029", name: "Bexar",   risk: 71, delta: 3,  exposure: 76400, sites: 15, crewHours: 7 },
  { fips: "48141", name: "El Paso", risk: 58, delta: -2, exposure: 22100, sites: 5,  crewHours: 3 },
  { fips: "48303", name: "Lubbock", risk: 41, delta: -6, exposure: 18900, sites: 3,  crewHours: 2 },
];
export const counties = base.map(c => ({ ...c, id: c.fips }));

export const summary = {
  status: "Severe cascade risk",
  note: "Compounding load and weather anomalies detected across 5 counties.",
  confidence: 87, updated: "2 min ago",
  peopleExposed: 197400, peopleDelta: 18200,
  hospitals: 7, careSites: 21, criticalFacilities: 43,
  crewsTotal: 12, crewsAvailable: 8,
};

// Candidate actions. harm = predicted people-harm prevented (model output). cost = crew-hours or staff-hours.
export const actions = [
  { id: 1, kind: "crew",   title: "Send Crew 07 to Harris",       where: "North Harris Substation · 18 min ETA", people: 18400, facilities: 3, cost: 4, crews: 1, harm: 18400 * 1.3 },
  { id: 2, kind: "center", title: "Open Northside Warming Center",  where: "Harris County · 240 available spaces", people: 8200,  facilities: 2, cost: 2, crews: 0, harm: 8200 * 1.1 },
  { id: 3, kind: "crew",   title: "Stage generator in Dallas",      where: "County Water Plant · Route 16 clear",    people: 11500, facilities: 2, cost: 3, crews: 1, harm: 11500 * 1.2 },
  { id: 4, kind: "crew",   title: "Inspect Bexar feeder line",  where: "Bexar Feeder 4 · 25 min ETA",        people: 9000,  facilities: 1, cost: 5, crews: 2, harm: 9000 },
  { id: 5, kind: "crew",   title: "Backup power check, El Paso care homes", where: "El Paso · 3 care sites",             people: 2100,  facilities: 3, cost: 3, crews: 1, harm: 2100 * 1.4 },
  { id: 6, kind: "crew",   title: "Patrol Lubbock transmission corridor", where: "Lubbock · low priority",                 people: 1500,  facilities: 0, cost: 4, crews: 1, harm: 1500 },
];

export const facilityStats = [
  { key: "hospitals", n: 7,  label: "Hospitals",        sub: "3 at critical risk" },
  { key: "care",      n: 21, label: "Care facilities",  sub: "860 vulnerable residents" },
  { key: "water",     n: 9,  label: "Water plants",     sub: "2 need backup power" },
  { key: "warming",   n: 6,  label: "Warming centers",  sub: "1,120 total spaces" },
];

// People who can receive an assignment. Backend: replace with your real roster.
export const people = [
  { id: "p1", name: "Maria Lopez",   role: "Crew 07 lead",        phone: "+1 555-0101" },
  { id: "p2", name: "James Carter",  role: "Crew 03 lead",        phone: "+1 555-0102" },
  { id: "p3", name: "Aisha Khan",    role: "Warming center coordinator", phone: "+1 555-0103" },
  { id: "p4", name: "Tom Nguyen",    role: "Generator team",      phone: "+1 555-0104" },
  { id: "p5", name: "Dana Whitfield", role: "County emergency manager", phone: "+1 555-0105" },
];