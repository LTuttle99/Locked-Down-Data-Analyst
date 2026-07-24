/*
 * Shared file-parsing and download helpers, reused across the hub's tools.
 * Same CSV/Excel parsing behavior as tools/data-analyzer/js/core.js, kept as
 * a separate copy there intentionally (that tool stays fully self-contained).
 */

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

  if (nameLower.endsWith(".csv")) return parseCSVText(await file.text());
  if (nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls") || nameLower.endsWith(".xlsm")) return parseExcelFile(file);
  if (nameLower.endsWith(".json")) {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : [data];
    const columns = Array.from(arr.reduce((set, r) => { Object.keys(r || {}).forEach((k) => set.add(k)); return set; }, new Set()));
    return { columns, rows: arr };
  }

  try {
    const result = parseCSVText(await file.text());
    if (result.columns.length > 0) return result;
  } catch (e) {
    /* fall through to Excel */
  }
  return parseExcelFile(file);
}

function rowsToCSV(columns, rows) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(escapeCell).join(",")];
  for (const r of rows) lines.push(columns.map((c) => escapeCell(r[c])).join(","));
  return lines.join("\n");
}

function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCSV(filename, columns, rows) {
  downloadTextFile(filename, rowsToCSV(columns, rows), "text/csv;charset=utf-8;");
}

function downloadExcel(filename, columns, rows, sheetName = "Sheet1") {
  const wb = XLSX.utils.book_new();
  const aoa = [columns, ...rows.map((r) => columns.map((c) => r[c]))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  XLSX.writeFile(wb, filename);
}

function downloadJSON(filename, data) {
  downloadTextFile(filename, JSON.stringify(data, null, 2), "application/json;charset=utf-8;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
