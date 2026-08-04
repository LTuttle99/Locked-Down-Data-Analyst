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

function columnNameTokens(column) {
  return String(column)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function columnNameMatches(column, hints) {
  const tokens = columnNameTokens(column);
  return hints.some((hint) => tokens.includes(hint));
}

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
    if (Number.isInteger(v) && v >= 19000101 && v <= 21991231) {
      const digits = String(v);
      return strictUTCDate(+digits.slice(0, 4), +digits.slice(4, 6), +digits.slice(6, 8));
    }
    if (v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400 * 1000);
      return dateOnlyUTC(new Date(ms));
    }
    return null;
  }

  if (typeof v !== "string") return null;

  const s = v.trim();
  if (s === "") return null;

  return parseStrictDateString(s);
}

const STRICT_MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

function strictMonthFromName(name) {
  const lower = String(name).toLowerCase().replace(/\.$/, "");
  const index = STRICT_MONTH_NAMES.findIndex((m) => m === lower || (lower.length >= 3 && m.startsWith(lower)));
  return index === -1 ? 0 : index + 1;
}

function strictTwoDigitYear(year) {
  return year + (year < 70 ? 2000 : 1900);
}

function strictUTCDate(year, month, day) {
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

function parseStrictDateString(s) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/);
  if (m) return strictUTCDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T ]|$)/);
  if (m) return strictUTCDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return strictUTCDate(+m[3], +m[1], +m[2]);

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return strictUTCDate(strictTwoDigitYear(+m[3]), +m[1], +m[2]);

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return strictUTCDate(+m[3], +m[1], +m[2]);

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) return strictUTCDate(strictTwoDigitYear(+m[3]), +m[1], +m[2]);

  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9}\.?)[ -](\d{4})$/);
  if (m) return strictUTCDate(+m[3], strictMonthFromName(m[2]), +m[1]);

  m = s.match(/^([A-Za-z]{3,9}\.?)[ -](\d{1,2}),?[ -](\d{4})$/);
  if (m) return strictUTCDate(+m[3], strictMonthFromName(m[1]), +m[2]);

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

function fmt0(v) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmt1(v) {
  return Number(v || 0).toFixed(1);
}

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

  const header = uniquifyHeaders(rows[0]);
  const dataRows = rows.slice(1).map((r) => {
    const obj = {};
    header.columns.forEach((h, idx) => {
      const raw = r[idx] !== undefined ? r[idx] : "";
      obj[h] = raw === "" ? null : raw;
    });
    return obj;
  });

  return { columns: header.columns, rows: dataRows, headerRenames: header.renames };
}

function uniquifyHeaders(columns) {
  const used = new Set();
  const renames = [];
  const out = [];

  (columns || []).forEach((column, index) => {
    const original = String(column === null || column === undefined ? "" : column).trim();
    const base = original === "" ? `column_${index + 1}` : original;

    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix++;
    }

    used.add(candidate);
    out.push(candidate);
    if (candidate !== original) renames.push({ index, from: original, to: candidate });
  });

  return { columns: out, renames };
}

function gridCellIsBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function gridFilledCount(row) {
  return (row || []).filter((c) => !gridCellIsBlank(c)).length;
}

function trimExcelGrid(grid) {
  const rows = (grid || []).filter((r) => gridFilledCount(r) > 0);
  if (rows.length === 0) return [];

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const keep = [];
  for (let c = 0; c < width; c++) {
    if (rows.some((r) => !gridCellIsBlank(r[c]))) keep.push(c);
  }

  return rows.map((r) => keep.map((c) => (r[c] === undefined ? null : r[c])));
}

function headerRowScore(grid, index) {
  const row = grid[index];
  const filled = gridFilledCount(row);
  if (filled === 0) return -1;

  const width = grid.reduce((max, r) => Math.max(max, gridFilledCount(r)), 0);
  if (width >= 2 && filled < 2) return -1;

  const values = (row || []).filter((c) => !gridCellIsBlank(c));
  const textual = values.filter((c) => typeof c === "string" && !/^[+-]?[\d.,$%]+$/.test(c.trim())).length;
  const distinct = new Set(values.map((c) => String(c).trim().toLowerCase())).size;

  const below = grid.slice(index + 1, index + 6);
  if (below.length === 0) return -1;
  const belowFill = below.reduce((s, r) => s + gridFilledCount(r), 0) / below.length / Math.max(1, width);
  if (belowFill < 0.5) return -1;

  return (filled / width) * 2 + (textual / values.length) * 2 + (distinct / values.length) - index * 0.01;
}

function detectHeaderRowIndex(grid, maxScan = 15) {
  if (!grid || grid.length === 0) return 0;

  const limit = Math.min(maxScan, Math.max(1, grid.length - 1));
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < limit; i++) {
    const score = headerRowScore(grid, i);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore <= 0 ? 0 : bestIndex;
}

function reshapeExcelGrid(grid) {
  const trimmed = trimExcelGrid(grid);
  if (trimmed.length === 0) return { grid: [], skippedRows: 0 };

  const headerRowIndex = detectHeaderRowIndex(trimmed);
  return { grid: trimmed.slice(headerRowIndex), skippedRows: headerRowIndex };
}

function excelGridToTable(grid) {
  if (!grid || grid.length === 0) return { columns: [], rows: [], headerRenames: [] };

  const header = uniquifyHeaders(grid[0] || []);
  const dataRows = grid.slice(1).map((r) => {
    const obj = {};
    header.columns.forEach((c, idx) => {
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

  return { columns: header.columns, rows: dataRows, headerRenames: header.renames };
}

function excelSheetToTable(workbook, name) {
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true });
  const reshaped = reshapeExcelGrid(grid);
  return { ...excelGridToTable(reshaped.grid), skippedRows: reshaped.skippedRows };
}

function combineExcelSheets(workbook, sheetNames) {
  const columns = ["source_sheet"];
  const rows = [];
  let skippedRows = 0;

  for (const name of sheetNames) {
    const table = excelSheetToTable(workbook, name);
    skippedRows += table.skippedRows;
    for (const column of table.columns) {
      if (!columns.includes(column)) columns.push(column);
    }
    for (const row of table.rows) rows.push({ ...row, source_sheet: name });
  }

  for (const row of rows) {
    for (const column of columns) {
      if (!(column in row)) row[column] = null;
    }
  }

  return { columns, rows, headerRenames: [], skippedRows };
}

function describeExcelSheet(workbook, name) {
  const ref = (workbook.Sheets[name] || {})["!ref"];
  if (!ref) return "empty";
  const range = XLSX.utils.decode_range(ref);
  const rows = Math.max(0, range.e.r - range.s.r);
  const cols = range.e.c - range.s.c + 1;
  return `${rows.toLocaleString()} row${rows === 1 ? "" : "s"}, ${cols} column${cols === 1 ? "" : "s"}`;
}

function buildSheetButton(title, subtitle, accent) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("style", `text-align:left;border:1px solid ${accent ? "#0062F1" : "#cbd5e1"};border-radius:0.5rem;padding:0.65rem 0.85rem;background:${accent ? "#eff6ff" : "#f8fafc"};cursor:pointer;display:block;width:100%;`);

  const heading = document.createElement("span");
  heading.setAttribute("style", `display:block;font-size:0.875rem;font-weight:600;color:${accent ? "#0062F1" : "#00133C"};`);
  heading.textContent = title;

  const detail = document.createElement("span");
  detail.setAttribute("style", "display:block;font-size:0.75rem;color:#64748b;margin-top:0.15rem;");
  detail.textContent = subtitle;

  button.appendChild(heading);
  button.appendChild(detail);

  if (!accent) {
    button.addEventListener("mouseenter", () => { button.style.borderColor = "#0062F1"; button.style.background = "#eff6ff"; });
    button.addEventListener("mouseleave", () => { button.style.borderColor = "#cbd5e1"; button.style.background = "#f8fafc"; });
  }

  return button;
}

function chooseExcelSheet(fileName, workbook) {
  const names = workbook.SheetNames;

  if (typeof document === "undefined") return Promise.resolve({ mode: "sheet", name: names[0] });

  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("style", "position:fixed;inset:0;z-index:9999;background:rgba(0,19,60,0.55);display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:ui-sans-serif,system-ui,sans-serif;");

    const card = document.createElement("div");
    card.setAttribute("style", "background:#ffffff;border:1px solid #e2e8f0;border-radius:0.75rem;max-width:30rem;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);");

    const head = document.createElement("div");
    head.setAttribute("style", "padding:1.25rem 1.25rem 0.75rem;");

    const title = document.createElement("h2");
    title.setAttribute("style", "font-family:Lora,Georgia,serif;font-size:1.125rem;font-weight:600;color:#00133C;margin:0 0 0.35rem;");
    title.textContent = "Choose a sheet";

    const blurb = document.createElement("p");
    blurb.setAttribute("style", "font-size:0.8125rem;color:#475569;margin:0;line-height:1.5;");
    const strong = document.createElement("strong");
    strong.setAttribute("style", "color:#00133C;");
    strong.textContent = fileName;
    blurb.appendChild(strong);
    blurb.appendChild(document.createTextNode(` has ${names.length} sheets. Only the sheet you pick is loaded.`));

    head.appendChild(title);
    head.appendChild(blurb);

    const list = document.createElement("div");
    list.setAttribute("style", "padding:0.25rem 1.25rem 1.25rem;display:flex;flex-direction:column;gap:0.5rem;");

    let settled = false;
    const onKey = (e) => {
      if (e.key === "Escape") close(reject, new Error("Sheet selection was cancelled."));
    };
    const close = (fn, value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      fn(value);
    };

    names.forEach((name, index) => {
      const button = buildSheetButton(name, describeExcelSheet(workbook, name), false);
      button.addEventListener("click", () => close(resolve, { mode: "sheet", name }));
      if (index === 0) setTimeout(() => button.focus(), 0);
      list.appendChild(button);
    });

    const combine = buildSheetButton(
      `Combine all ${names.length} sheets`,
      "Stacks every sheet into one table and adds a source_sheet column",
      true
    );
    combine.addEventListener("click", () => close(resolve, { mode: "combine" }));
    list.appendChild(combine);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.setAttribute("style", "margin-top:0.35rem;border:none;background:none;color:#64748b;font-size:0.8125rem;cursor:pointer;padding:0.35rem;");
    cancel.addEventListener("click", () => close(reject, new Error("Sheet selection was cancelled.")));
    list.appendChild(cancel);

    card.appendChild(head);
    card.appendChild(list);
    overlay.appendChild(card);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  });
}

async function parseExcelFile(file, options = {}) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetNames = (wb.SheetNames || []).slice();

  if (sheetNames.length === 0) return { columns: [], rows: [], headerRenames: [], sheetName: null, sheetNames };

  let choice = { mode: "sheet", name: sheetNames[0] };
  if (sheetNames.length > 1) {
    if (options.combineSheets) choice = { mode: "combine" };
    else if (sheetNames.includes(options.sheetName)) choice = { mode: "sheet", name: options.sheetName };
    else choice = await chooseExcelSheet(file.name || "Workbook", wb);
  }

  if (choice.mode === "combine") {
    return { ...combineExcelSheets(wb, sheetNames), sheetName: null, sheetNames, combined: true };
  }

  return { ...excelSheetToTable(wb, choice.name), sheetName: choice.name, sheetNames, combined: false };
}

async function parseFileToRows(file, options = {}) {
  const nameLower = (file.name || "").toLowerCase();

  if (nameLower.endsWith(".csv")) {
    return parseCSVText(await file.text());
  }
  if (nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls") || nameLower.endsWith(".xlsm")) {
    return parseExcelFile(file, options);
  }

  try {
    const result = parseCSVText(await file.text());
    if (result.columns.length > 0) return result;
  } catch (e) {
  }
  return parseExcelFile(file, options);
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
    const times = parsed.map((d) => d.getTime());
    let minTime = times[0];
    let maxTime = times[0];
    for (const t of times) {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    const minD = new Date(minTime);
    const maxD = new Date(maxTime);
    return { min_date: formatDateISO(minD), max_date: formatDateISO(maxD) };
  }

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
