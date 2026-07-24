/*
 * In-browser replacement for app.py's session state + /api/* endpoints.
 * Same JSON contracts as the FastAPI backend, so index.html's existing UI
 * code barely has to change — it just calls these instead of fetch().
 * All state lives in plain JS variables for the lifetime of the tab; there's
 * no server, so there's nothing to persist across a reload by design.
 */

const FILES = new Map(); // file_id -> BookOfBusinessAnalyzer
let ACTIVE_FILE_ID = null;
let COMPARE_ANALYZER = null;

function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return `f${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}

function serializeFileList() {
  return Array.from(FILES.entries()).map(([file_id, analyzer]) => ({
    file_id,
    filename: analyzer.fileName,
    row_count: analyzer.rows.length,
    is_active: file_id === ACTIVE_FILE_ID
  }));
}

function getActiveAnalyzer(target = "primary") {
  if (target === "compare") {
    if (!COMPARE_ANALYZER) throw new Error("No active comparison data file found for this session. Upload a file first.");
    return COMPARE_ANALYZER;
  }
  const analyzer = ACTIVE_FILE_ID ? FILES.get(ACTIVE_FILE_ID) : null;
  if (!analyzer) throw new Error("No active primary data file found for this session. Upload a file first.");
  return analyzer;
}

async function apiUpload(file) {
  if (!file || file.size === 0) throw new Error("The uploaded file is empty.");

  const { columns, rows } = await parseFileToRows(file);
  const analyzer = new BookOfBusinessAnalyzer(rows, columns, file.name);
  const schema = analyzer.inferSchema();

  const fileId = genId();
  FILES.set(fileId, analyzer);
  ACTIVE_FILE_ID = fileId;

  // A fresh upload invalidates any prior comparison snapshot, same as the backend.
  COMPARE_ANALYZER = null;

  return { ...schema, file_id: fileId, loaded_files: serializeFileList() };
}

async function apiSelectFile(fileId) {
  const analyzer = FILES.get(fileId);
  if (!analyzer) throw new Error("That file is no longer available in this session. Upload it again.");
  ACTIVE_FILE_ID = fileId;
  return { ...analyzer.inferSchema(), file_id: fileId, loaded_files: serializeFileList() };
}

async function apiRemoveFile(fileId) {
  if (!FILES.has(fileId)) throw new Error("That file is no longer available in this session.");

  const wasActive = ACTIVE_FILE_ID === fileId;
  FILES.delete(fileId);

  let newActiveId = null;
  if (wasActive) {
    const remaining = Array.from(FILES.keys());
    if (remaining.length > 0) {
      newActiveId = remaining[remaining.length - 1];
      ACTIVE_FILE_ID = newActiveId;
    } else {
      ACTIVE_FILE_ID = null;
    }
  }

  const result = { active_file_id: ACTIVE_FILE_ID, loaded_files: serializeFileList() };
  if (newActiveId) {
    Object.assign(result, FILES.get(newActiveId).inferSchema());
    result.file_id = newActiveId;
  }
  return result;
}

async function apiCompareUpload(file) {
  if (!file || file.size === 0) throw new Error("The uploaded comparison file is empty.");
  const { columns, rows } = await parseFileToRows(file);
  COMPARE_ANALYZER = new BookOfBusinessAnalyzer(rows, columns, file.name);
  return COMPARE_ANALYZER.inferSchema();
}

function apiColumnValues(column) {
  return { values: getActiveAnalyzer("primary").getUniqueColumnValues(column) };
}

function apiDateRange(timelineColumn) {
  return getActiveAnalyzer("primary").getDateRange(timelineColumn);
}

function apiAnalyze(body) {
  const target = body.target === "compare" ? "compare" : "primary";
  const analyzer = getActiveAnalyzer(target);
  return analyzer.runAnalysis(body);
}

function apiSuggestGoals(body) {
  const analyzer = getActiveAnalyzer("primary");
  const suggestions = analyzer.suggestGoalCandidates(body.mapping, body.projection_target, body.period, body.top_n);
  return { suggestions };
}

function apiHealth() {
  return {
    status: "ok",
    service: "Intelligent Data Analyzer (static)",
    primary_active: ACTIVE_FILE_ID !== null,
    loaded_file_count: FILES.size,
    compare_active: COMPARE_ANALYZER !== null
  };
}
