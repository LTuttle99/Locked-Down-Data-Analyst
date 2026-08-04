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

    if (candidate !== original) {
      renames.push({
        index,
        from: original,
        to: candidate,
        reason: original === "" ? "blank" : "duplicate"
      });
    }
  });

  return { columns: out, renames };
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
  let rows = (grid || []).filter((r) => gridFilledCount(r) > 0);
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
  if (trimmed.length === 0) return { grid: [], headerRowIndex: 0, skippedRows: 0 };

  const headerRowIndex = detectHeaderRowIndex(trimmed);
  return { grid: trimmed.slice(headerRowIndex), headerRowIndex, skippedRows: headerRowIndex };
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

  if (nameLower.endsWith(".csv")) return parseCSVText(await file.text());
  if (nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls") || nameLower.endsWith(".xlsm")) return parseExcelFile(file, options);
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
  }
  return parseExcelFile(file, options);
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
