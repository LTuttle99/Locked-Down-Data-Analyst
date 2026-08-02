const SQL_JS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";

let sqlEngine = null;

function sqlLoadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      }
      return;
    }

    const el = document.createElement("script");
    el.src = src;
    el.dataset.src = src;
    el.addEventListener("load", () => {
      el.dataset.loaded = "true";
      resolve();
    });
    el.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(el);
  });
}

async function ensureSqlEngine() {
  if (sqlEngine) return sqlEngine;

  await sqlLoadScriptOnce(`${SQL_JS_BASE}sql-wasm.js`);
  if (typeof initSqlJs === "undefined") {
    throw new Error("The SQL engine failed to load. Check your network connection and try again.");
  }

  sqlEngine = await initSqlJs({ locateFile: (file) => SQL_JS_BASE + file });
  return sqlEngine;
}

function sqlIsBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function sqlToNumber(value) {
  if (sqlIsBlank(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const s = String(value).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function sqlDateToISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sqlTableNameFor(fileName, used) {
  let base = String(fileName || "dataset")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!base) base = "dataset";
  if (/^[0-9]/.test(base)) base = `t_${base}`;

  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix}`;
    suffix++;
  }

  used.add(name);
  return name;
}

function quoteSqlIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function sqlColumnIsNumeric(rows, column) {
  let seen = 0;
  for (const row of rows) {
    const value = row[column];
    if (sqlIsBlank(value)) continue;
    if (value instanceof Date) return false;
    if (sqlToNumber(value) === null) return false;
    seen++;
  }
  return seen > 0;
}

function sqlValueFor(value, numeric) {
  if (sqlIsBlank(value)) return null;
  if (value instanceof Date) return sqlDateToISO(value);
  if (numeric) return sqlToNumber(value);
  return String(value);
}

async function buildSqlDatabaseFrom(datasets) {
  const SQL = await ensureSqlEngine();
  const db = new SQL.Database();
  const used = new Set();
  const tables = [];

  for (const dataset of datasets) {
    const columns = (dataset.columns || []).filter((c) => String(c).trim() !== "");
    if (columns.length === 0) continue;

    const rows = dataset.rows || [];
    const tableName = sqlTableNameFor(dataset.name, used);
    const numericFlags = columns.map((c) => sqlColumnIsNumeric(rows, c));
    const definitions = columns.map((c, i) => `${quoteSqlIdentifier(c)} ${numericFlags[i] ? "REAL" : "TEXT"}`);

    db.run(`CREATE TABLE ${quoteSqlIdentifier(tableName)} (${definitions.join(", ")})`);

    const placeholders = columns.map(() => "?").join(", ");
    db.run("BEGIN TRANSACTION");
    const statement = db.prepare(`INSERT INTO ${quoteSqlIdentifier(tableName)} VALUES (${placeholders})`);

    for (const row of rows) {
      statement.run(columns.map((c, i) => sqlValueFor(row[c], numericFlags[i])));
    }

    statement.free();
    db.run("COMMIT");

    tables.push({ table: tableName, name: dataset.name, columns, numericFlags, rowCount: rows.length });
  }

  return { db, tables };
}

function runSqlOn(db, sqlText) {
  if (!db) throw new Error("Load at least one file before running a query.");

  const trimmed = String(sqlText || "").trim();
  if (trimmed === "") throw new Error("Enter a query first.");

  const started = performance.now();
  const results = db.exec(trimmed);
  const elapsedMs = performance.now() - started;
  const last = results.length > 0 ? results[results.length - 1] : null;

  return {
    columns: last ? last.columns : [],
    rows: last ? last.values : [],
    elapsedMs,
    statementCount: results.length
  };
}

function sqlResultToObjects(result) {
  return result.rows.map((row) => {
    const obj = {};
    result.columns.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });
}
