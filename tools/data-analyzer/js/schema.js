/*
 * Port of analyzer.py's schema-inference section: _detect_column_roles,
 * _pick_metric_column, _pick_timeline_column, _pick_entity_column,
 * infer_schema, assess_data_quality.
 *
 * The Python original has two code paths per column: a fast path for columns
 * pandas already parsed as numeric/datetime dtype, and a fraction-based
 * fallback for everything else. Both paths apply the same thresholds for
 * numeric-vs-id-like and date-vs-not, so this port always takes the
 * fraction-based path (see classifyNumericIdLike below) — same end
 * classification, one code path instead of two.
 */

function classifyNumericIdLike(numericVals, uniqueRatio, looksIdLikeName) {
  const isIntLike = numericVals.filter((v) => Number.isInteger(v)).length / numericVals.length > 0.99;

  let isSequentialRamp = false;
  if (isIntLike && uniqueRatio >= 0.99) {
    const sortedUnique = Array.from(new Set(numericVals)).sort((a, b) => a - b);
    if (sortedUnique.length > 1) {
      isSequentialRamp = sortedUnique.every((v, i) => i === 0 || Math.abs(v - sortedUnique[i - 1] - 1) < 1e-9);
    }
  }

  const nameSuggestsId = looksIdLikeName && isIntLike && uniqueRatio >= 0.9;
  return isSequentialRamp || nameSuggestsId;
}

BookOfBusinessAnalyzer.prototype._columnNumericFraction = function (nonNullVals) {
  if (nonNullVals.length === 0) return 0;
  return nonNullVals.filter((v) => toNumber(v) !== null).length / nonNullVals.length;
};

BookOfBusinessAnalyzer.prototype._columnDateFraction = function (nonNullVals) {
  if (nonNullVals.length === 0) return 0;
  return nonNullVals.filter((v) => toDate(v) !== null).length / nonNullVals.length;
};

BookOfBusinessAnalyzer.prototype._detectColumnRoles = function () {
  const nRows = Math.max(1, this.rows.length);
  const numericCols = [];
  const dateCols = [];
  const idLikeCols = [];
  const categoricalCandidates = [];

  for (const col of this.columns) {
    const nonNullVals = this.rows.map((r) => r[col]).filter((v) => !isMissing(v));
    if (nonNullVals.length === 0) continue;

    const colLower = String(col).toLowerCase();
    const looksIdLikeName = ID_LIKE_EXCLUDE_HINTS.some((kw) => colLower.includes(kw));
    const uniqueRatio = countUnique(nonNullVals) / nonNullVals.length;

    // Numeric dtype columns are never date candidates — avoids pd.to_datetime
    // reinterpreting a numeric metric column as epoch timestamps.
    const numericVals = nonNullVals.map(toNumber);
    const isFullyNumeric = numericVals.every((v) => v !== null);

    if (isFullyNumeric) {
      if (classifyNumericIdLike(numericVals, uniqueRatio, looksIdLikeName)) idLikeCols.push(col);
      else numericCols.push(col);
      continue;
    }

    const dateFrac = this._columnDateFraction(nonNullVals);
    if (dateFrac >= 0.9) {
      dateCols.push(col);
      continue;
    }

    const numericFrac = this._columnNumericFraction(nonNullVals);
    if (numericFrac >= 0.9) {
      const coerced = nonNullVals.map(toNumber).filter((v) => v !== null);
      if (classifyNumericIdLike(coerced, uniqueRatio, looksIdLikeName)) idLikeCols.push(col);
      else numericCols.push(col);
      continue;
    }

    const uniqueCount = countUnique(nonNullVals);
    if (uniqueCount <= 1) continue;

    if (looksIdLikeName && uniqueRatio >= 0.9) {
      idLikeCols.push(col);
      continue;
    }

    if (uniqueCount >= 2 && uniqueCount <= Math.max(300, Math.floor(nRows * 0.5))) {
      categoricalCandidates.push(col);
    } else if (uniqueRatio >= 0.3) {
      idLikeCols.push(col);
    }
  }

  return { numericCols, dateCols, idLikeCols, categoricalCandidates };
};

BookOfBusinessAnalyzer.prototype._pickMetricColumn = function (numericCols) {
  if (numericCols.length === 0) return null;

  for (const col of numericCols) {
    const colLower = col.toLowerCase();
    if (METRIC_NAME_HINTS.some((kw) => colLower.includes(kw))) return col;
  }

  let bestCol = null;
  let bestMagnitude = -1;
  for (const col of numericCols) {
    const magnitude = this.rows.reduce((acc, r) => acc + Math.abs(toNumber(r[col]) || 0), 0);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestCol = col;
    }
  }
  return bestCol || numericCols[0];
};

BookOfBusinessAnalyzer.prototype._pickTimelineColumn = function (dateCols) {
  if (dateCols.length === 0) return null;
  for (const col of dateCols) {
    const colLower = col.toLowerCase();
    if (TIMELINE_NAME_HINTS.some((kw) => colLower.includes(kw))) return col;
  }
  return dateCols[0];
};

BookOfBusinessAnalyzer.prototype._pickEntityColumn = function (idLikeCols, categoricalCandidates, exclude) {
  const pool = idLikeCols.concat(categoricalCandidates).filter((c) => !exclude.has(c));
  if (pool.length === 0) return null;

  const cardinalityAndRatio = (col) => {
    const nonNull = this.rows.map((r) => r[col]).filter((v) => !isMissing(v));
    if (nonNull.length === 0) return [0, 1.0];
    const card = countUnique(nonNull);
    return [card, card / nonNull.length];
  };

  const nameBonus = (col) => (ENTITY_NAME_HINTS.some((kw) => String(col).toLowerCase().includes(kw)) ? 1 : 0);

  const repeating = [];
  const uniqueOnly = [];

  for (const col of pool) {
    const [card, ratio] = cardinalityAndRatio(col);
    if (card < 2) continue;
    if (ratio <= 0.9) repeating.push([col, card]);
    else uniqueOnly.push([col, card]);
  }

  const pick = (list) => {
    list.sort((a, b) => nameBonus(b[0]) - nameBonus(a[0]) || b[1] - a[1]);
    return list[0][0];
  };

  if (repeating.length > 0) return pick(repeating);
  if (uniqueOnly.length > 0) return pick(uniqueOnly);
  return null;
};

BookOfBusinessAnalyzer.prototype.inferSchema = function () {
  const roles = this._detectColumnRoles();
  const metricColumn = this._pickMetricColumn(roles.numericCols);
  const timelineColumn = this._pickTimelineColumn(roles.dateCols);

  const exclude = new Set([metricColumn, timelineColumn].filter(Boolean));
  const entityColumn = this._pickEntityColumn(roles.idLikeCols, roles.categoricalCandidates, exclude);

  let dimensionCandidates = roles.categoricalCandidates.filter((c) => !exclude.has(c) && c !== entityColumn);
  dimensionCandidates = dimensionCandidates
    .map((c) => [c, countUnique(this.rows.map((r) => r[c]).filter((v) => !isMissing(v)))])
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_DIMENSION_CANDIDATES)
    .map((e) => e[0]);

  const defaultDimensions = dimensionCandidates.slice(0, DEFAULT_DIMENSION_COUNT);

  const mapping = {
    metric_column: metricColumn,
    timeline_column: timelineColumn,
    entity_column: entityColumn,
    dimension_columns: defaultDimensions
  };

  return {
    columns: this.columns,
    inferred_mapping: mapping,
    numeric_columns: roles.numericCols,
    date_columns: roles.dateCols,
    categorical_columns: dimensionCandidates,
    date_range: this.getDateRange(timelineColumn),
    baseline_date: formatDateISO(ANALYTICAL_BASELINE),
    data_quality: this.assessDataQuality(mapping)
  };
};

BookOfBusinessAnalyzer.prototype.assessDataQuality = function (mapping) {
  const totalRows = this.rows.length;
  const warnings = [];

  const report = {
    total_rows: totalRows,
    duplicate_rows: totalRows > 0 ? countDuplicateRows(this.rows, this.columns) : 0,
    metric_column: null,
    timeline_column: null,
    dimension_columns: {},
    warnings
  };

  if (totalRows === 0) {
    warnings.push("The uploaded file has no data rows.");
    return report;
  }

  if (report.duplicate_rows > 0) {
    const dupPct = (report.duplicate_rows / totalRows) * 100;
    warnings.push(`${report.duplicate_rows.toLocaleString()} fully duplicate rows found (${dupPct.toFixed(1)}% of the file).`);
  }

  const metricCol = mapping.metric_column;
  if (metricCol && this.columns.includes(metricCol)) {
    const raw = this.rows.map((r) => r[metricCol]);
    const numeric = raw.map(toNumber);
    const missingPct = (numeric.filter((v) => v === null).length / raw.length) * 100;
    const nonPositivePct = (numeric.filter((v) => (v ?? 0) <= 0).length / raw.length) * 100;

    report.metric_column = {
      column: metricCol,
      missing_or_non_numeric_pct: Math.round(missingPct * 10) / 10,
      zero_or_negative_pct: Math.round(nonPositivePct * 10) / 10
    };

    if (missingPct >= 5) warnings.push(`'${metricCol}' has ${missingPct.toFixed(1)}% blank or non-numeric values.`);
    if (nonPositivePct >= 5) warnings.push(`'${metricCol}' has ${nonPositivePct.toFixed(1)}% zero or negative values.`);
  }

  const timeCol = mapping.timeline_column;
  if (timeCol && this.columns.includes(timeCol)) {
    const raw = this.rows.map((r) => r[timeCol]);
    const parsed = raw.map(toDate);
    const unparseablePct = (parsed.filter((v) => v === null).length / raw.length) * 100;

    const validParsed = parsed.filter((v) => v !== null);
    const beforeBaselinePct = validParsed.length
      ? (validParsed.filter((v) => v < ANALYTICAL_BASELINE).length / validParsed.length) * 100
      : 0;
    const today = dateOnlyUTC(new Date());
    const futurePct = validParsed.length ? (validParsed.filter((v) => v > today).length / validParsed.length) * 100 : 0;

    report.timeline_column = {
      column: timeCol,
      unparseable_pct: Math.round(unparseablePct * 10) / 10,
      before_baseline_pct: Math.round(beforeBaselinePct * 10) / 10,
      future_dated_pct: Math.round(futurePct * 10) / 10
    };

    if (unparseablePct >= 2) warnings.push(`'${timeCol}' has ${unparseablePct.toFixed(1)}% unparseable dates that will be excluded.`);
    if (beforeBaselinePct >= 5) {
      warnings.push(
        `'${timeCol}' has ${beforeBaselinePct.toFixed(1)}% of dates before ${formatDateISO(ANALYTICAL_BASELINE)} (outside the analytical baseline and excluded).`
      );
    }
    if (futurePct >= 5) warnings.push(`'${timeCol}' has ${futurePct.toFixed(1)}% future-dated records.`);
  }

  for (const col of mapping.dimension_columns || []) {
    if (!col || !this.columns.includes(col)) continue;
    const raw = this.rows.map((r) => r[col]);
    const missingPct = (raw.filter((v) => isMissing(v)).length / raw.length) * 100;
    report.dimension_columns[col] = { column: col, missing_pct: Math.round(missingPct * 10) / 10 };
    if (missingPct >= 10) warnings.push(`'${col}' is ${missingPct.toFixed(1)}% blank.`);
  }

  const entityCol = mapping.entity_column;
  if (entityCol && this.columns.includes(entityCol)) {
    const raw = this.rows.map((r) => r[entityCol]);
    const missingPct = (raw.filter((v) => isMissing(v)).length / raw.length) * 100;
    if (missingPct >= 10) warnings.push(`'${entityCol}' (entity column) is ${missingPct.toFixed(1)}% blank.`);
  }

  return report;
};
