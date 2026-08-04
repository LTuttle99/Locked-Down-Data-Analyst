function dashboardCellIsBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function dashboardCellNumber(value) {
  if (dashboardCellIsBlank(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const s = String(value).trim().replace(/,/g, "");
  if (!/^[+-]?\$?(\d+\.?\d*|\.\d+)%?$/.test(s)) return null;
  const n = Number(s.replace(/[$%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function dashboardCellText(value) {
  if (dashboardCellIsBlank(value)) return "(blank)";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function dashboardCellDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof profileToDate === "function") return profileToDate(value);
  return null;
}

function dashboardMatchesFilter(row, filter) {
  const raw = row[filter.field];
  const text = dashboardCellText(raw).toLowerCase();
  const target = String(filter.value == null ? "" : filter.value).trim().toLowerCase();
  const num = dashboardCellNumber(raw);
  const targetNum = Number(String(filter.value).replace(/[$,%\s]/g, ""));

  if (filter.op === "equals") return text === target;
  if (filter.op === "not equals") return text !== target;
  if (filter.op === "contains") return text.includes(target);
  if (filter.op === "in list") {
    return target.split(/[,;|]/).map((v) => v.trim()).filter(Boolean).includes(text);
  }
  if (filter.op === "greater than") return num !== null && Number.isFinite(targetNum) && num > targetNum;
  if (filter.op === "less than") return num !== null && Number.isFinite(targetNum) && num < targetNum;
  return true;
}

function dashboardApplyFilters(rows, filters) {
  if (!filters || filters.length === 0) return rows;
  const usable = filters.filter((f) => f && f.field);
  if (usable.length === 0) return rows;
  return rows.filter((row) => usable.every((f) => dashboardMatchesFilter(row, f)));
}

function dashboardAggregate(rows, measure, aggregation) {
  if (aggregation === "count") return rows.length;

  if (aggregation === "distinct count") {
    const seen = new Set();
    for (const row of rows) {
      if (!dashboardCellIsBlank(row[measure])) seen.add(dashboardCellText(row[measure]));
    }
    return seen.size;
  }

  const numbers = [];
  for (const row of rows) {
    const n = dashboardCellNumber(row[measure]);
    if (n !== null) numbers.push(n);
  }

  if (numbers.length === 0) return 0;
  if (aggregation === "average") return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((a, b) => a + b, 0);
}

function dashboardPeriodKey(date, grain) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();

  if (grain === "year") return String(y);
  if (grain === "quarter") return `${y} Q${Math.floor(m / 3) + 1}`;
  if (grain === "month") return `${y}-${String(m + 1).padStart(2, "0")}`;
  if (grain === "week") {
    const start = new Date(Date.UTC(y, m, date.getUTCDate() - date.getUTCDay()));
    return start.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function dashboardFindDateColumn(rows, columns) {
  for (const column of columns) {
    let parsed = 0;
    let present = 0;
    for (const row of rows.slice(0, 200)) {
      if (dashboardCellIsBlank(row[column])) continue;
      present++;
      if (dashboardCellDate(row[column])) parsed++;
    }
    if (present > 0 && parsed / present >= 0.9) return column;
  }
  return null;
}

function dashboardGroupSeries(rows, dimension, measure, aggregation, limit) {
  const groups = new Map();

  for (const row of rows) {
    const key = dashboardCellText(row[dimension]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const series = Array.from(groups.entries())
    .map(([label, groupRows]) => ({ label, value: dashboardAggregate(groupRows, measure, aggregation) }))
    .sort((a, b) => b.value - a.value);

  if (series.length <= limit) return series;

  const top = series.slice(0, limit - 1);
  const restRows = series.slice(limit - 1);
  const rest = restRows.reduce((s, r) => s + r.value, 0);
  top.push({ label: `Other (${restRows.length})`, value: rest });
  return top;
}

function dashboardTimeSeries(rows, dateColumn, measure, aggregation, grain) {
  const groups = new Map();

  for (const row of rows) {
    const date = dashboardCellDate(row[dateColumn]);
    if (!date) continue;
    const key = dashboardPeriodKey(date, grain);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, groupRows]) => ({ label, value: dashboardAggregate(groupRows, measure, aggregation) }));
}

function dashboardSlicerOptions(rows, slicer) {
  if (slicer.type === "range" || slicer.type === "date range") {
    const values = [];
    for (const row of rows) {
      const v = slicer.type === "range" ? dashboardCellNumber(row[slicer.field]) : dashboardCellDate(row[slicer.field]);
      if (v !== null) values.push(slicer.type === "range" ? v : v.getTime());
    }
    if (values.length === 0) return { min: 0, max: 0, empty: true };
    return { min: Math.min(...values), max: Math.max(...values), empty: false };
  }

  const seen = new Set();
  for (const row of rows) {
    if (!dashboardCellIsBlank(row[slicer.field])) seen.add(dashboardCellText(row[slicer.field]));
    if (seen.size > 200) break;
  }
  return { values: Array.from(seen).sort(), empty: seen.size === 0 };
}

function dashboardApplySlicers(rows, slicers, selections) {
  if (!slicers || slicers.length === 0 || !selections) return rows;

  let out = rows;
  for (const slicer of slicers) {
    const chosen = selections[slicer.id];
    if (chosen === undefined || chosen === null || chosen === "") continue;

    if (slicer.type === "range") {
      out = out.filter((row) => {
        const n = dashboardCellNumber(row[slicer.field]);
        return n !== null && n >= chosen.min && n <= chosen.max;
      });
    } else if (slicer.type === "date range") {
      out = out.filter((row) => {
        const d = dashboardCellDate(row[slicer.field]);
        if (!d) return false;
        const t = d.getTime();
        return t >= chosen.min && t <= chosen.max;
      });
    } else if (Array.isArray(chosen)) {
      if (chosen.length === 0) continue;
      const wanted = new Set(chosen);
      out = out.filter((row) => wanted.has(dashboardCellText(row[slicer.field])));
    } else {
      out = out.filter((row) => dashboardCellText(row[slicer.field]) === chosen);
    }
  }

  return out;
}

function dashboardResolveFromRows(visual, dataset) {
  const binding = visual.binding;
  const columns = dataset.columns || [];
  const sliced = dashboardApplySlicers(dataset.rows || [], dataset.slicers, dataset.selections);
  const rows = dashboardApplyFilters(sliced, binding.filters);

  if (visual.kind === "kpi") {
    const value = dashboardAggregate(rows, binding.measure, binding.aggregation);
    const dateColumn = dataset.dateColumn || dashboardFindDateColumn(rows, columns);
    let delta = 0;

    if (dateColumn) {
      const series = dashboardTimeSeries(rows, dateColumn, binding.measure, binding.aggregation, "month");
      if (series.length >= 2) {
        const last = series[series.length - 1].value;
        const prior = series[series.length - 2].value;
        if (prior !== 0) delta = (last - prior) / Math.abs(prior);
      }
    }

    return { kind: "kpi", value, delta };
  }

  if (visual.kind === "trend") {
    const dateColumn = dataset.dateColumn || dashboardFindDateColumn(rows, columns);
    if (!dateColumn) return { kind: "series", points: [], empty: "No date column was found in this file." };
    const points = dashboardTimeSeries(rows, dateColumn, binding.measure, binding.aggregation, binding.grain);
    return { kind: "series", points, empty: points.length === 0 ? "No rows had a readable date." : null };
  }

  if (visual.kind === "scatter") {
    const points = [];
    for (const row of rows) {
      const x = dashboardCellNumber(row[binding.measure]);
      const y = dashboardCellNumber(row[binding.measure2]);
      if (x !== null && y !== null) points.push({ x, y });
      if (points.length >= 3000) break;
    }
    return { kind: "points", points, empty: points.length === 0 ? "No rows had numbers in both columns." : null };
  }

  if (!columns.includes(binding.dimension)) {
    return { kind: "series", points: [], empty: `Column "${binding.dimension}" is not in this file.` };
  }

  const limit = visual.kind === "donut" ? Math.min(binding.limit, 6) : binding.limit;
  const points = dashboardGroupSeries(rows, binding.dimension, binding.measure, binding.aggregation, limit);
  return { kind: "series", points, empty: points.length === 0 ? "No rows matched the filters." : null };
}

function dashboardResolveVisual(visual, dataset) {
  if (!dataset) return dashboardResolveSample(visual);
  if (Array.isArray(dataset.rows) && dataset.rows.length > 0) return dashboardResolveFromRows(visual, dataset);
  if (dataset.baked && dataset.baked[visual.id]) return dataset.baked[visual.id];
  return dashboardResolveSample(visual);
}

function dashboardSpecColumns(spec, dataset) {
  const wanted = new Set();

  for (const slicer of spec.slicers) wanted.add(slicer.field);
  for (const visual of spec.visuals) {
    wanted.add(visual.binding.measure);
    if (visual.binding.dimension) wanted.add(visual.binding.dimension);
    if (visual.binding.measure2) wanted.add(visual.binding.measure2);
    for (const filter of visual.binding.filters) wanted.add(filter.field);
  }
  if (dataset && dataset.dateColumn) wanted.add(dataset.dateColumn);

  const columns = (dataset && dataset.columns) || [];
  return columns.filter((c) => wanted.has(c));
}

function dashboardBakeDataset(spec, dataset, maxRows = 50000) {
  const base = {
    source: dataset.source || "",
    rowCount: (dataset.rows || []).length,
    bakedAt: new Date().toISOString().slice(0, 10)
  };

  if (spec.slicers.length === 0) {
    const baked = {};
    for (const visual of spec.visuals) baked[visual.id] = dashboardResolveFromRows(visual, dataset);
    return Object.assign(base, { baked, interactive: false });
  }

  const columns = dashboardSpecColumns(spec, dataset);
  const rows = (dataset.rows || []).slice(0, maxRows).map((row) => {
    const out = {};
    for (const column of columns) out[column] = row[column] === undefined ? null : row[column];
    return out;
  });

  return Object.assign(base, {
    interactive: true,
    columns,
    rows,
    dateColumn: dataset.dateColumn,
    truncated: (dataset.rows || []).length > maxRows
  });
}
