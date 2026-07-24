/*
 * Client-side port of analyzer.py's BookOfBusinessAnalyzer — constants, generic
 * coercion/math helpers, CSV/Excel parsing, and the class shell.
 *
 * Design notes vs. the Python original:
 * - Rows are plain JS objects (array-of-objects instead of a DataFrame).
 * - Column dtype is never pre-inferred; every value is coerced on demand via
 *   toNumber()/toDate(), which is behaviorally equivalent to the Python code's
 *   fraction-based fallback path (see _detectColumnRoles below) for every
 *   column that matters, without needing to replicate pandas' CSV dtype
 *   inference.
 * - "Working rows" (the JS analog of working_df) carry canonical fields
 *   `_time` (Date), `_metric` (number), `_entity` (raw value or "Unknown"),
 *   plus each mapped dimension column normalized to a string under its own
 *   original column name — mirroring working_df's in-place column overwrites.
 * - Date parsing is best-effort (ISO / MM-DD-YYYY / native Date fallback),
 *   not a full port of dateutil — good enough for typical exports.
 */

const ANALYTICAL_BASELINE = new Date(Date.UTC(2020, 0, 1));

const METRIC_NAME_HINTS = [
  "revenue", "sales", "amount", "total", "price", "cost", "premium", "value",
  "spend", "expense", "income", "profit", "quantity", "qty", "units", "volume",
  "balance", "payment", "charge", "fee", "gwp"
];

const TIMELINE_NAME_HINTS = [
  "date", "time", "effective", "created", "order", "transaction", "posted",
  "period", "timestamp", "inception", "renewal"
];

const ENTITY_NAME_HINTS = [
  "id", "code", "key", "customer", "client", "account", "member", "employee",
  "order", "ref", "number", "no", "sku", "user", "patient", "student", "policy"
];

const ID_LIKE_EXCLUDE_HINTS = ["id", "code", "key", "no", "number", "ref", "sku", "uuid", "guid"];

const MAX_DIMENSION_CANDIDATES = 15;
const DEFAULT_DIMENSION_COUNT = 5;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// --------------------------------------------------------------------------- //
// Generic coercion / math helpers
// --------------------------------------------------------------------------- //

function isMissing(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

function toNumber(v) {
  if (isMissing(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (isMissing(v)) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dateOnlyUTC(v);

  if (typeof v === "number") {
    // Excel serial date fallback (epoch 1899-12-30), only for a plausible range.
    if (v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400 * 1000);
      return dateOnlyUTC(new Date(ms));
    }
    return null;
  }

  const s = String(v).trim();
  if (s === "") return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return new Date(Date.UTC(year, +m[1] - 1, +m[2]));
  }

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return new Date(Date.UTC(year, +m[1] - 1, +m[2]));
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

  return null;
}

function dateOnlyUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateISO(d) {
  return d.toISOString().slice(0, 10);
}

function normalizeCategoricalValue(x) {
  if (typeof x === "number" && !Number.isNaN(x) && Number.isInteger(x)) return String(x);
  if (isMissing(x)) return "nan";
  return String(x).trim();
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (!arr || arr.length === 0) return 0;
  const m = mean(arr);
  const variance = mean(arr.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function countUnique(arr) {
  return new Set(arr.map((v) => (v instanceof Date ? v.getTime() : v))).size;
}

function linearRegression(xs, ys) {
  const n = xs.length;
  const meanX = mean(xs);
  const meanY = mean(ys);
  let num = 0;
  let den = 0;

  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const predictions = xs.map((x) => slope * x + intercept);

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - predictions[i]) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;

  return { slope, intercept, r2, predict: (x) => slope * x + intercept };
}

// --------------------------------------------------------------------------- //
// Month-ordinal helpers (JS analog of pandas Period[M] arithmetic)
// --------------------------------------------------------------------------- //

function toMonthOrdinal(date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function monthOf(ord) {
  return (((ord % 12) + 12) % 12) + 1;
}

function yearOf(ord) {
  return Math.floor(ord / 12);
}

function formatMonthOrdinal(ord) {
  return `${yearOf(ord)}-${String(monthOf(ord)).padStart(2, "0")}`;
}

function addYears(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear() + n, date.getUTCMonth(), date.getUTCDate()));
}

function periodBounds(period, anchor) {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  let start;
  let end;

  if (period === "monthly") {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 0));
  } else if (period === "quarterly") {
    const qStartMonth = Math.floor(m / 3) * 3;
    start = new Date(Date.UTC(y, qStartMonth, 1));
    end = new Date(Date.UTC(y, qStartMonth + 3, 0));
  } else {
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y, 11, 31));
  }

  return [start, end];
}

function daysBetweenInclusive(start, end) {
  return Math.round((end - start) / 86400000) + 1;
}

// --------------------------------------------------------------------------- //
// Formatting helpers used by the AI-insights text templates
// --------------------------------------------------------------------------- //

function fmt0(v) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmt1(v) {
  return Number(v || 0).toFixed(1);
}

// --------------------------------------------------------------------------- //
// CSV / Excel parsing -> {columns, rows}
// --------------------------------------------------------------------------- //

function parseCSVText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  if (rows.length === 0) return { columns: [], rows: [] };

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      const raw = r[idx] !== undefined ? r[idx] : "";
      obj[h] = raw === "" ? null : raw;
    });
    return obj;
  });

  return { columns: header, rows: dataRows };
}

async function parseExcelFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  if (!grid || grid.length === 0) return { columns: [], rows: [] };

  const columns = (grid[0] || []).map((h) => String(h ?? "").trim());
  const dataRows = grid.slice(1).map((r) => {
    const obj = {};
    columns.forEach((c, idx) => {
      let v = r[idx];
      if (v === undefined) v = null;
      if (typeof v === "string") {
        v = v.trim();
        if (v === "") v = null;
      }
      obj[c] = v;
    });
    return obj;
  });

  return { columns, rows: dataRows };
}

async function parseFileToRows(file) {
  const nameLower = (file.name || "").toLowerCase();

  if (nameLower.endsWith(".csv")) {
    return parseCSVText(await file.text());
  }
  if (nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls") || nameLower.endsWith(".xlsm")) {
    return parseExcelFile(file);
  }

  try {
    const result = parseCSVText(await file.text());
    if (result.columns.length > 0) return result;
  } catch (e) {
    /* fall through to Excel */
  }
  return parseExcelFile(file);
}

function countDuplicateRows(rows, columns) {
  const seen = new Set();
  let dupCount = 0;
  for (const r of rows) {
    const key = columns.map((c) => (r[c] instanceof Date ? r[c].toISOString() : String(r[c]))).join("");
    if (seen.has(key)) dupCount++;
    else seen.add(key);
  }
  return dupCount;
}

// --------------------------------------------------------------------------- //
// The analyzer class shell — constructor + the handful of simple methods that
// don't belong to any one section of the original file. Every other method is
// attached to BookOfBusinessAnalyzer.prototype from the other js/*.js files,
// which must be loaded after this one.
// --------------------------------------------------------------------------- //

class BookOfBusinessAnalyzer {
  constructor(rows, columns, fileName) {
    this.fileName = fileName;
    this.rows = rows;
    this.columns = columns;
  }

  getUniqueColumnValues(col, limit = 500) {
    if (!col || !this.columns.includes(col)) return [];
    const raw = this.rows.map((r) => r[col]).filter((v) => !isMissing(v));
    let cleaned = raw.map((v) => normalizeCategoricalValue(v));
    cleaned = cleaned.filter((v) => v && v.toLowerCase() !== "nan");
    return Array.from(new Set(cleaned)).sort().slice(0, limit);
  }

  getDateRange(timeCol) {
    if (!timeCol || !this.columns.includes(timeCol)) return { min_date: null, max_date: null };
    const parsed = this.rows.map((r) => toDate(r[timeCol])).filter((d) => d !== null && d >= ANALYTICAL_BASELINE);
    if (parsed.length === 0) return { min_date: null, max_date: null };
    const minD = new Date(Math.min(...parsed.map((d) => d.getTime())));
    const maxD = new Date(Math.max(...parsed.map((d) => d.getTime())));
    return { min_date: formatDateISO(minD), max_date: formatDateISO(maxD) };
  }

  // JS analog of the working_df construction shared by run_analysis and
  // suggest_goal_candidates: coerce time/metric, drop null time, filter to
  // the analytical baseline, normalize dimension columns, fill missing entity.
  buildWorkingRows(metricCol, timeCol, entityCol, dimensionCols) {
    const out = [];
    for (const r of this.rows) {
      const time = toDate(r[timeCol]);
      if (!time || time < ANALYTICAL_BASELINE) continue;

      const metric = metricCol ? toNumber(r[metricCol]) ?? 0 : 0;
      const entity = entityCol ? (isMissing(r[entityCol]) ? "Unknown" : r[entityCol]) : null;

      const wr = { _time: time, _metric: metric, _entity: entity };
      for (const col of dimensionCols) wr[col] = normalizeCategoricalValue(r[col]);
      out.push(wr);
    }
    return out;
  }

  applyDimensionScope(rows, scopeColumn, scopeValue) {
    if (!scopeColumn) return rows;
    const normalized = normalizeCategoricalValue(scopeValue);
    return rows.filter((r) => normalizeCategoricalValue(r[scopeColumn]) === normalized);
  }

  computeEntityFirstDates(entityCol, timeCol) {
    const map = new Map();
    for (const r of this.rows) {
      const t = toDate(r[timeCol]);
      if (!t) continue;
      const entity = r[entityCol];
      if (isMissing(entity)) continue;
      const key = String(entity);
      const cur = map.get(key);
      if (!cur || t < cur) map.set(key, t);
    }
    return map;
  }
}
