const DASHBOARD_SPEC_VERSION = 1;

const DASHBOARD_VISUAL_KINDS = {
  kpi: { label: "KPI tile", needsDimension: false, needsGrain: false, needsSecondMeasure: false, defaultWidth: "quarter" },
  trend: { label: "Trend line", needsDimension: false, needsGrain: true, needsSecondMeasure: false, defaultWidth: "full" },
  column: { label: "Column chart", needsDimension: true, needsGrain: false, needsSecondMeasure: false, defaultWidth: "half" },
  bar: { label: "Bar chart", needsDimension: true, needsGrain: false, needsSecondMeasure: false, defaultWidth: "half" },
  donut: { label: "Donut chart", needsDimension: true, needsGrain: false, needsSecondMeasure: false, defaultWidth: "half" },
  table: { label: "Table", needsDimension: true, needsGrain: false, needsSecondMeasure: false, defaultWidth: "half" },
  scatter: { label: "Scatter plot", needsDimension: false, needsGrain: false, needsSecondMeasure: true, defaultWidth: "half" }
};

const DASHBOARD_AGGREGATIONS = ["sum", "average", "count", "min", "max", "distinct count"];

const DASHBOARD_GRAINS = ["day", "week", "month", "quarter", "year"];

const DASHBOARD_WIDTHS = ["quarter", "half", "full"];

const DASHBOARD_FILTER_OPERATORS = ["equals", "not equals", "greater than", "less than", "contains", "in list"];

const DASHBOARD_SLICER_TYPES = ["list", "dropdown", "range", "date range"];

const DASHBOARD_FORMATS = ["auto", "percent", "number", "currency"];

const DASHBOARD_PALETTES = {
  hub: ["#0062F1", "#00133C", "#DC6803", "#059669", "#7C3AED", "#DB2777", "#0891B2", "#CA8A04", "#65A30D", "#E11D48"],
  ocean: ["#0E7490", "#0369A1", "#1E3A8A", "#0D9488", "#155E75", "#3B82F6", "#14B8A6", "#1D4ED8", "#22D3EE", "#312E81"],
  forest: ["#15803D", "#166534", "#4D7C0F", "#065F46", "#84CC16", "#047857", "#3F6212", "#10B981", "#14532D", "#A3E635"],
  sunset: ["#EA580C", "#DC2626", "#D97706", "#BE123C", "#F59E0B", "#9A3412", "#F43F5E", "#B45309", "#FB923C", "#7F1D1D"],
  plum: ["#7C3AED", "#6D28D9", "#A21CAF", "#4C1D95", "#C026D3", "#8B5CF6", "#DB2777", "#581C87", "#E879F9", "#9D174D"],
  slate: ["#334155", "#0F172A", "#64748B", "#1E293B", "#94A3B8", "#475569", "#CBD5E1", "#0B1220", "#7C8CA1", "#E2E8F0"]
};

const DASHBOARD_PALETTE_NAMES = Object.keys(DASHBOARD_PALETTES);

function dashboardCleanColor(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : null;
}

function dashboardPaletteFor(spec) {
  const base = DASHBOARD_PALETTES[spec && spec.palette] || DASHBOARD_PALETTES.hub;
  const accent = spec ? dashboardCleanColor(spec.accent) : null;
  if (!accent) return base;
  return [accent].concat(base.filter((c) => c.toLowerCase() !== accent));
}

const DASHBOARD_TEXT_LIMIT = 160;

function dashboardCleanText(value, limit = DASHBOARD_TEXT_LIMIT) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function dashboardPickOption(value, allowed, fallback) {
  const cleaned = dashboardCleanText(value, 40).toLowerCase();
  return allowed.includes(cleaned) ? cleaned : fallback;
}

function dashboardCleanInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function dashboardNormalizeFilter(raw) {
  const field = dashboardCleanText(raw && raw.field, 60);
  if (field === "") return null;
  return {
    field,
    op: dashboardPickOption(raw && raw.op, DASHBOARD_FILTER_OPERATORS, "equals"),
    value: dashboardCleanText(raw && raw.value, 80)
  };
}

function dashboardNormalizeDivideBy(raw) {
  if (!raw || typeof raw !== "object") return null;

  const measure = dashboardCleanText(raw.measure, 60);
  if (measure === "") return null;

  return {
    measure,
    aggregation: dashboardPickOption(raw.aggregation, DASHBOARD_AGGREGATIONS, "count"),
    filters: Array.isArray(raw.filters)
      ? raw.filters.map(dashboardNormalizeFilter).filter(Boolean).slice(0, 8)
      : []
  };
}

function dashboardNormalizeBinding(raw, kind) {
  const shape = DASHBOARD_VISUAL_KINDS[kind];
  const source = raw || {};

  const binding = {
    source: dashboardCleanText(source.source, 60) || "Not specified",
    measure: dashboardCleanText(source.measure, 60) || "Not specified",
    aggregation: dashboardPickOption(source.aggregation, DASHBOARD_AGGREGATIONS, "sum"),
    dimension: shape.needsDimension ? dashboardCleanText(source.dimension, 60) || "Not specified" : null,
    measure2: shape.needsSecondMeasure ? dashboardCleanText(source.measure2, 60) || "Not specified" : null,
    grain: shape.needsGrain ? dashboardPickOption(source.grain, DASHBOARD_GRAINS, "month") : null,
    limit: dashboardCleanInteger(source.limit, 3, 50, 10),
    filters: Array.isArray(source.filters)
      ? source.filters.map(dashboardNormalizeFilter).filter(Boolean).slice(0, 8)
      : [],
    divideBy: dashboardNormalizeDivideBy(source.divideBy),
    format: dashboardPickOption(source.format, DASHBOARD_FORMATS, "auto")
  };

  return binding;
}

function dashboardNormalizeVisual(raw, index) {
  const source = raw || {};
  const kind = Object.prototype.hasOwnProperty.call(DASHBOARD_VISUAL_KINDS, source.kind) ? source.kind : "column";
  const shape = DASHBOARD_VISUAL_KINDS[kind];

  return {
    id: dashboardCleanText(source.id, 24) || `v${index + 1}`,
    kind,
    title: dashboardCleanText(source.title, 80) || shape.label,
    width: dashboardPickOption(source.width, DASHBOARD_WIDTHS, shape.defaultWidth),
    notes: dashboardCleanText(source.notes, 240),
    binding: dashboardNormalizeBinding(source.binding, kind)
  };
}

function dashboardBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function dashboardNormalizeSlicer(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const field = dashboardCleanText(source.field, 60);
  if (field === "") return null;

  return {
    id: dashboardCleanText(source.id, 24) || `s${index + 1}`,
    field,
    type: dashboardPickOption(source.type, DASHBOARD_SLICER_TYPES, "dropdown"),
    label: dashboardCleanText(source.label, 60) || field,
    width: dashboardPickOption(source.width, DASHBOARD_WIDTHS, "quarter")
  };
}

function dashboardNormalizeSource(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.kind !== "googleSheet") return null;

  const url = dashboardCleanText(raw.url, 400);
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) return null;

  return { kind: "googleSheet", url };
}

function dashboardNormalizeSpec(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const visuals = Array.isArray(source.visuals) ? source.visuals.slice(0, 24) : [];
  const slicers = Array.isArray(source.slicers) ? source.slicers.slice(0, 8) : [];

  return {
    v: DASHBOARD_SPEC_VERSION,
    title: dashboardCleanText(source.title, 90) || "Untitled dashboard",
    subtitle: dashboardCleanText(source.subtitle, 200),
    requester: dashboardCleanText(source.requester, 80),
    audience: dashboardCleanText(source.audience, 80),
    refresh: dashboardPickOption(source.refresh, ["real time", "hourly", "daily", "weekly", "monthly"], "daily"),
    created: /^\d{4}-\d{2}-\d{2}$/.test(source.created) ? source.created : new Date().toISOString().slice(0, 10),
    source: dashboardNormalizeSource(source.source),
    showCaptions: dashboardBoolean(source.showCaptions, true),
    showDeltas: dashboardBoolean(source.showDeltas, true),
    showEditLink: dashboardBoolean(source.showEditLink, true),
    palette: dashboardPickOption(source.palette, DASHBOARD_PALETTE_NAMES, "hub"),
    accent: dashboardCleanColor(source.accent),
    slicers: slicers.map(dashboardNormalizeSlicer).filter(Boolean),
    visuals: visuals.map(dashboardNormalizeVisual)
  };
}

function dashboardEncodeSpec(spec) {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function dashboardDecodeSpec(encoded) {
  const cleaned = String(encoded || "").replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (cleaned === "") return null;

  try {
    const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return dashboardNormalizeSpec(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    return null;
  }
}

function dashboardSeedFrom(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dashboardRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dashboardGrainLabels(grain, count) {
  const labels = [];
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  for (let i = count - 1; i >= 0; i--) {
    if (grain === "year") {
      labels.push(String(year - i));
    } else if (grain === "quarter") {
      const total = year * 4 + Math.floor(month / 3) - i;
      labels.push(`${Math.floor(total / 4)} Q${(((total % 4) + 4) % 4) + 1}`);
    } else if (grain === "month") {
      const total = year * 12 + month - i;
      labels.push(`${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, "0")}`);
    } else {
      const step = grain === "week" ? 7 : 1;
      const d = new Date(Date.UTC(year, month, now.getUTCDate() - i * step));
      labels.push(d.toISOString().slice(0, 10));
    }
  }

  return labels;
}

function dashboardCategoryLabels(dimension, count, rand) {
  const known = {
    region: ["North", "South", "East", "West", "Central"],
    territory: ["North", "South", "East", "West", "Central"],
    segment: ["Enterprise", "Mid Market", "SMB", "Public Sector"],
    channel: ["Direct", "Partner", "Online", "Retail"],
    product: ["Standard", "Premium", "Enterprise", "Trial", "Legacy"],
    status: ["Open", "In Progress", "Closed", "On Hold"],
    department: ["Finance", "Operations", "IT", "HR", "Marketing", "Sales"],
    category: ["Category A", "Category B", "Category C", "Category D"]
  };

  const key = String(dimension || "").toLowerCase();
  const match = Object.keys(known).find((k) => key.includes(k));
  const base = match ? known[match] : null;

  const labels = [];
  for (let i = 0; i < count; i++) {
    if (base && i < base.length) labels.push(base[i]);
    else labels.push(`${dashboardCleanText(dimension, 24) || "Value"} ${i + 1}`);
  }

  return labels;
}

function dashboardMeasureScale(measure, aggregation, binding) {
  const name = String(measure || "").toLowerCase();
  if (binding && dashboardBindingFormat(binding) === "percent") return 60;
  if (aggregation === "count" || aggregation === "distinct count") return 400;
  if (/rate|percent|margin|share|ratio/.test(name)) return 40;
  if (/revenue|sales|amount|spend|cost|value|premium|gwp|balance/.test(name)) return 250000;
  if (/quantity|qty|units|volume|orders|tickets/.test(name)) return 1800;
  return 5000;
}

function dashboardResolveSample(visual) {
  const binding = visual.binding;
  const rand = dashboardRandom(dashboardSeedFrom(`${visual.id}|${visual.title}|${binding.measure}`));
  const scale = dashboardMeasureScale(binding.measure, binding.aggregation, binding);
  const jitter = () => 0.7 + rand() * 0.6;

  if (visual.kind === "kpi") {
    const value = scale * jitter() * (binding.aggregation === "average" ? 0.02 : 1);
    return { kind: "kpi", value, delta: (rand() - 0.4) * 0.3 };
  }

  if (visual.kind === "trend") {
    const counts = { day: 30, week: 26, month: 12, quarter: 8, year: 5 };
    const count = counts[binding.grain] || 12;
    const labels = dashboardGrainLabels(binding.grain, count);
    const drift = 0.6 + rand() * 0.8;
    const points = labels.map((label, i) => {
      const trend = 1 + (i / Math.max(1, count - 1)) * drift;
      const season = 1 + Math.sin((i / count) * Math.PI * 2) * 0.12;
      return { label, value: (scale / count) * trend * season * jitter() };
    });
    return { kind: "series", points };
  }

  if (visual.kind === "scatter") {
    const scale2 = dashboardMeasureScale(binding.measure2, binding.aggregation);
    const points = [];
    for (let i = 0; i < 80; i++) {
      const x = scale * (0.1 + rand() * 0.9) * 0.02;
      points.push({ x, y: (x / (scale * 0.02)) * scale2 * 0.02 * (0.6 + rand() * 0.8) });
    }
    return { kind: "points", points };
  }

  const count = Math.min(binding.limit, visual.kind === "donut" ? 6 : binding.limit);
  const labels = dashboardCategoryLabels(binding.dimension, count, rand);
  const points = labels
    .map((label) => ({ label, value: scale * (0.15 + rand()) }))
    .sort((a, b) => b.value - a.value);

  return { kind: "series", points };
}

function dashboardFormatValue(value, measure, aggregation, format) {
  const name = String(measure || "").toLowerCase();
  const n = Number(value) || 0;
  const abs = Math.abs(n);

  if (format === "percent") return `${n.toFixed(1)}%`;

  if (format !== "number" && format !== "currency") {
    if (aggregation === "count" || aggregation === "distinct count") {
      return Math.round(n).toLocaleString("en-US");
    }
    if (/rate|percent|margin|share|ratio/.test(name)) return `${n.toFixed(1)}%`;
  }

  const currency = format === "currency" || (format !== "number"
    && /revenue|sales|amount|spend|cost|value|premium|gwp|balance|price|fee/.test(name)
    && aggregation !== "count" && aggregation !== "distinct count");
  const prefix = currency ? "$" : "";

  if (abs >= 1e9) return `${prefix}${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${prefix}${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${prefix}${(n / 1e3).toFixed(1)}K`;
  return `${prefix}${n.toFixed(abs < 10 ? 1 : 0)}`;
}

function dashboardBindingFormat(binding) {
  if (binding.format && binding.format !== "auto") return binding.format;
  return binding.divideBy ? "percent" : "auto";
}

function dashboardBindingSummary(visual) {
  const b = visual.binding;
  const parts = [`${b.aggregation} of ${b.measure}`];

  if (b.filters.length > 0 && b.divideBy) {
    parts.push(`where ${b.filters.map((f) => `${f.field} ${f.op} ${f.value}`).join(" or ")}`);
  }

  if (b.divideBy) {
    parts.push(`divided by ${b.divideBy.aggregation} of ${b.divideBy.measure}`);
    if (dashboardBindingFormat(b) === "percent") parts.push("as a percentage");
  }

  if (b.dimension) parts.push(`by ${b.dimension}`);
  if (b.measure2) parts.push(`against ${b.measure2}`);
  if (b.grain) parts.push(`per ${b.grain}`);
  if (b.filters.length > 0 && !b.divideBy) {
    parts.push(`filtered on ${Array.from(new Set(b.filters.map((f) => f.field))).join(", ")}`);
  }

  return parts.join(" ");
}

function dashboardStarterSpec() {
  return dashboardNormalizeSpec({
    title: "Sales Performance",
    subtitle: "Monthly revenue trend and breakdown by region, for the leadership review.",
    requester: "",
    audience: "Leadership",
    refresh: "daily",
    visuals: [
      { id: "v1", kind: "kpi", title: "Total Revenue", width: "quarter", binding: { source: "Sales", measure: "Revenue", aggregation: "sum" } },
      { id: "v2", kind: "kpi", title: "Orders", width: "quarter", binding: { source: "Sales", measure: "Order ID", aggregation: "distinct count" } },
      { id: "v3", kind: "trend", title: "Revenue over time", width: "full", binding: { source: "Sales", measure: "Revenue", aggregation: "sum", grain: "month" } },
      { id: "v4", kind: "column", title: "Revenue by region", width: "half", binding: { source: "Sales", measure: "Revenue", aggregation: "sum", dimension: "Region", limit: 6 } },
      { id: "v5", kind: "donut", title: "Share by segment", width: "half", binding: { source: "Sales", measure: "Revenue", aggregation: "sum", dimension: "Segment", limit: 4 } }
    ]
  });
}
