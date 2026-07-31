const SQL_JS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const SQL_MAX_DISPLAY_ROWS = 500;

let SQL_ENGINE = null;
let SQL_DATABASE = null;
let SQL_TABLE_MAP = [];
let SQL_LAST_RESULT = null;

function loadScriptOnce(src) {
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
  if (SQL_ENGINE) return SQL_ENGINE;

  await loadScriptOnce(`${SQL_JS_BASE}sql-wasm.js`);
  if (typeof initSqlJs === "undefined") {
    throw new Error("The SQL engine failed to load. Check your network connection and try again.");
  }

  SQL_ENGINE = await initSqlJs({ locateFile: (file) => SQL_JS_BASE + file });
  return SQL_ENGINE;
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
    if (isMissing(value)) continue;
    if (value instanceof Date) return false;
    if (toNumber(value) === null) return false;
    seen++;
  }
  return seen > 0;
}

function sqlValueFor(value, numeric) {
  if (isMissing(value)) return null;
  if (value instanceof Date) return formatDateISO(value);
  if (numeric) return toNumber(value);
  return String(value);
}

async function buildSqlDatabase() {
  const SQL = await ensureSqlEngine();

  if (SQL_DATABASE) {
    SQL_DATABASE.close();
    SQL_DATABASE = null;
  }

  const db = new SQL.Database();
  const used = new Set();
  const map = [];

  for (const [fileId, analyzer] of FILES.entries()) {
    const columns = analyzer.columns.filter((c) => String(c).trim() !== "");
    if (columns.length === 0) continue;

    const tableName = sqlTableNameFor(analyzer.fileName, used);
    const numericFlags = columns.map((c) => sqlColumnIsNumeric(analyzer.rows, c));
    const definitions = columns.map((c, i) => `${quoteSqlIdentifier(c)} ${numericFlags[i] ? "REAL" : "TEXT"}`);

    db.run(`CREATE TABLE ${quoteSqlIdentifier(tableName)} (${definitions.join(", ")})`);

    const placeholders = columns.map(() => "?").join(", ");
    db.run("BEGIN TRANSACTION");
    const statement = db.prepare(`INSERT INTO ${quoteSqlIdentifier(tableName)} VALUES (${placeholders})`);

    for (const row of analyzer.rows) {
      statement.run(columns.map((c, i) => sqlValueFor(row[c], numericFlags[i])));
    }

    statement.free();
    db.run("COMMIT");

    map.push({
      table: tableName,
      fileId,
      fileName: analyzer.fileName,
      columns,
      numericFlags,
      rowCount: analyzer.rows.length
    });
  }

  SQL_DATABASE = db;
  SQL_TABLE_MAP = map;
  return map;
}

function runSqlStatement(sqlText) {
  if (!SQL_DATABASE) throw new Error("No datasets are prepared for querying yet.");

  const trimmed = String(sqlText || "").trim();
  if (trimmed === "") throw new Error("Enter a query first.");

  const started = performance.now();
  const results = SQL_DATABASE.exec(trimmed);
  const elapsedMs = performance.now() - started;
  const last = results.length > 0 ? results[results.length - 1] : null;

  return {
    columns: last ? last.columns : [],
    rows: last ? last.values : [],
    elapsedMs,
    statementCount: results.length
  };
}

function sqlResultToCSV(result) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };

  const lines = [result.columns.map(escapeCell).join(",")];
  for (const row of result.rows) lines.push(row.map(escapeCell).join(","));
  return lines.join("\n");
}
