// Replace with fetch("/api/...") once backend is ready. Keep the same shapes.
export const counties = [
  { id: "franklin", name: "Franklin", risk: 92, delta: 14, exposure: 48200, sites: 12, crewHours: 4, center: [33.02, -96.78],
    polygon: [[33.12,-96.9],[33.12,-96.7],[32.98,-96.68],[32.95,-96.85]] },
  { id: "monroe", name: "Monroe", risk: 84, delta: 9, exposure: 31800, sites: 8, crewHours: 3, center: [32.85, -96.8],
    polygon: [[32.95,-96.85],[32.98,-96.68],[32.84,-96.66],[32.72,-96.8]] },
  { id: "jefferson", name: "Jefferson", risk: 71, delta: 3, exposure: 76400, sites: 15, crewHours: 7, center: [33.0, -96.58],
    polygon: [[33.12,-96.7],[33.1,-96.5],[32.9,-96.52],[32.98,-96.68]] },
  { id: "adams", name: "Adams", risk: 58, delta: -2, exposure: 22100, sites: 5, crewHours: 3, center: [32.93, -97.0],
    polygon: [[33.0,-97.1],[32.95,-96.85],[32.8,-96.9],[32.82,-97.08]] },
  { id: "clay", name: "Clay", risk: 41, delta: -6, exposure: 18900, sites: 3, crewHours: 2, center: [32.65, -96.7],
    polygon: [[32.72,-96.8],[32.84,-96.66],[32.6,-96.6],[32.58,-96.78]] },
];

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
  { id: 1, kind: "crew",   title: "Send Crew 07 to Franklin",       where: "North Franklin Substation · 18 min ETA", people: 18400, facilities: 3, cost: 4, crews: 1, harm: 18400 * 1.3 },
  { id: 2, kind: "center", title: "Open Northside Warming Center",  where: "Franklin County · 240 available spaces", people: 8200,  facilities: 2, cost: 2, crews: 0, harm: 8200 * 1.1 },
  { id: 3, kind: "crew",   title: "Stage generator in Monroe",      where: "County Water Plant · Route 16 clear",    people: 11500, facilities: 2, cost: 3, crews: 1, harm: 11500 * 1.2 },
  { id: 4, kind: "crew",   title: "Inspect Jefferson feeder line",  where: "Jefferson Feeder 4 · 25 min ETA",        people: 9000,  facilities: 1, cost: 5, crews: 2, harm: 9000 },
  { id: 5, kind: "crew",   title: "Backup power check, Adams care homes", where: "Adams · 3 care sites",             people: 2100,  facilities: 3, cost: 3, crews: 1, harm: 2100 * 1.4 },
  { id: 6, kind: "crew",   title: "Patrol Clay transmission corridor", where: "Clay · low priority",                 people: 1500,  facilities: 0, cost: 4, crews: 1, harm: 1500 },
];

export const facilityStats = [
  { key: "hospitals", n: 7,  label: "Hospitals",        sub: "3 at critical risk" },
  { key: "care",      n: 21, label: "Care facilities",  sub: "860 vulnerable residents" },
  { key: "water",     n: 9,  label: "Water plants",     sub: "2 need backup power" },
  { key: "warming",   n: 6,  label: "Warming centers",  sub: "1,120 total spaces" },
];
