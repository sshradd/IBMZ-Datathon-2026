export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ["clear", "watch", "prepare", "act"] as const;
export type UnitType = "line" | "shelter" | "outage" | "outreach";

export interface County {
  fips: string;
  name: string;
  lat: number;
  lon: number;
  pop: number;
  pop65: number;
  severe_at: number;
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
  confidence: { tier: string; precision: number; lift: number; base_rate: number | null } | null;
}

export interface WatchItem {
  fips: string;
  name: string;
  p6: number;
  p12: number;
  p24: number;
  tier: (typeof TIER_NAMES)[number];
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

export interface AlertSummary {
  count: number;
  events: { event: string; severity: string | null; relevant: boolean; counties: number; fips: string[]; headline: string | null }[];
  by_fips: Record<string, string[]>;
}

export interface HourEvent {
  type: "hour";
  i: number;
  n: number;
  t: string;
  live?: boolean;
  as_of?: string;
  sources?: SourceStatus[];
  alerts?: AlertSummary | null;
  outlook?: { temp_f_mean_next_24h: (number | null)[] };
  /** [p24, tier, customers out, p6, p12] per county */
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
    watchlist: WatchItem[];
  };
  diagnose: {
    state: { temp_f_mean: number; fc_err: number; demand_norm: number; gen_drop: number; severe_frac: number };
  };
  describe: {
    out_total: number;
    severe_now: number;
    ever_severe: number;
    customer_hours: number;
    seniors_out: number;
    peak: { out: number; i: number; t: string | null };
    scorecard: { onsets: number; warned: number; warned_pct: number | null; median_lead_h: number | null };
  };
  prescribe: { moves: Move[]; coverage: { crews: number; centers: number; callers: number } };
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
}

// ------------------------------------------------------------------ operations

export interface Unit {
  id: string;
  name: string;
  type: "line" | "shelter" | "outreach";
  depot: string;
  size: number;
  status: "available" | "en_route" | "on_site" | "resting";
  assignment: { fips: string; county: string; eta_min: number; depart_by_min: number; window: string; urgency: string } | null;
}

export interface Depot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  units: Record<string, number>;
  available: Record<string, number>;
  stock: Record<string, number>;
}

export interface OpsState {
  sample: boolean;
  note: string;
  depots: Depot[];
  units: Unit[];
  unit_types: Record<string, { label: string; size: number }>;
  items: { id: string; label: string; unit: string; target: number | null }[];
  log: { t: string; kind: string; text: string }[];
}

export interface Priority {
  fips: string;
  county: string;
  status: "out" | "act" | "prepare" | "watch";
  risk: number;
  p6: number;
  p12: number;
  window: string;
  out: number;
  seniors_exposed: number;
  pop: number;
  temp_f: number;
  reasons: string[];
  nearest: { depot: string; distance_km: number; eta_min: number } | null;
  depart_by_min: number;
  urgency: "now" | "soon";
}

export interface InventoryRow {
  id: string;
  label: string;
  unit: string;
  have: number;
  target: number | null;
  status: "ok" | "low" | "short" | null;
  below_by: number;
}

export interface OpsPlan {
  priorities: Priority[];
  totals: Record<"line" | "shelter" | "outreach", { available: number; en_route: number; on_site: number; resting: number; total: number }>;
  staging: { sites: { name: string; kind: string; lat: number; lon: number; avg_eta_min: number; saves_min: number }[]; baseline_eta_min: number | null };
  inventory: {
    items: InventoryRow[];
    context: { customers_out: number; customers_at_risk: number; seniors_at_risk: number };
    below_target: string[];
  };
}

export interface Order {
  fips: string;
  line: number;
  shelter: number;
  outreach: number;
}

export interface WorkOrder {
  unit_id: string;
  unit_name: string;
  county: string;
  text: string;
  maps_url: string;
}
