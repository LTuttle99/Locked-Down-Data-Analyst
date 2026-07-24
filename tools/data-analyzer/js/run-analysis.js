/*
 * Port of analyzer.py's main pipeline: run_analysis. Ties together every
 * other section into the single result object the dashboard renders.
 */

BookOfBusinessAnalyzer.prototype.runAnalysis = function (opts) {
  const mapping = opts.mapping || {};
  const dimensionFilters = opts.dimension_filters || {};
  const projectionTarget = opts.projection_target === "count" ? "count" : "value";
  let primaryDimension = opts.primary_dimension || null;
  const startDate = opts.start_date || null;
  const endDate = opts.end_date || null;
  const includeFutureDates = !!opts.include_future_dates;
  const goalValue = Number(opts.goal_value) || 0;
  const goals = opts.goals || [];
  const forecastHorizonMonths = Number(opts.forecast_horizon_months) || 24;
  const entityView = opts.entity_view || "all";

  const metricCol = mapping.metric_column;
  const timeCol = mapping.timeline_column;
  let entityCol = mapping.entity_column;
  let dimensionCols = mapping.dimension_columns || [];

  if (!metricCol || !timeCol) throw new Error("A Metric column and a Timeline column are required fields.");
  if (!this.columns.includes(metricCol) || !this.columns.includes(timeCol)) {
    throw new Error(
      "The mapped Metric or Timeline column was not found in the uploaded file. This can happen if the mapping is left over from a different file — re-upload the file and confirm the schema mapping again."
    );
  }

  entityCol = entityCol && this.columns.includes(entityCol) ? entityCol : null;
  dimensionCols = dimensionCols.filter((c) => this.columns.includes(c));

  if (primaryDimension && !dimensionCols.includes(primaryDimension)) primaryDimension = null;
  if (!primaryDimension && dimensionCols.length) primaryDimension = dimensionCols[0];

  let workingRows = this.buildWorkingRows(metricCol, timeCol, entityCol, dimensionCols);

  let futureRecordsRemoved = 0;
  let futureMetricAmount = 0.0;

  if (!includeFutureDates) {
    const today = dateOnlyUTC(new Date());
    const futureRows = workingRows.filter((r) => r._time > today);
    futureRecordsRemoved = futureRows.length;
    futureMetricAmount = futureRows.reduce((s, r) => s + (r._metric || 0), 0);
    workingRows = workingRows.filter((r) => r._time <= today);
  }

  let effectiveStart = null;
  let effectiveEnd = null;

  if (startDate) {
    const startDt = toDate(startDate);
    if (startDt) {
      workingRows = workingRows.filter((r) => r._time >= startDt);
      effectiveStart = startDt;
    }
  }
  if (endDate) {
    const endDt = toDate(endDate);
    if (endDt) {
      const endCapped = new Date(endDt.getTime() + (23 * 3600 + 59 * 60 + 59) * 1000);
      workingRows = workingRows.filter((r) => r._time <= endCapped);
      effectiveEnd = endDt;
    }
  }

  if (effectiveStart === null && workingRows.length) effectiveStart = workingRows.reduce((m, r) => (r._time < m ? r._time : m), workingRows[0]._time);
  if (effectiveEnd === null && workingRows.length) effectiveEnd = workingRows.reduce((m, r) => (r._time > m ? r._time : m), workingRows[0]._time);

  let filtersApplied = 0;
  for (const [col, allowedValues] of Object.entries(dimensionFilters)) {
    if (!dimensionCols.includes(col) || !allowedValues || !allowedValues.length) continue;
    const normalizedAllowed = new Set(allowedValues.map(normalizeCategoricalValue));
    workingRows = workingRows.filter((r) => normalizedAllowed.has(r[col]));
    filtersApplied += 1;
  }

  const entityFirstDates = entityCol ? this.computeEntityFirstDates(entityCol, timeCol) : new Map();
  workingRows = this.classifyEntityRecurrence(workingRows, entityCol, entityFirstDates);

  const newDf = workingRows.filter((r) => r.EntityStatus === "New");
  const repeatDf = workingRows.filter((r) => r.EntityStatus === "Repeat");
  const recurrenceClassified = !!entityCol;

  const entitySplit = {
    new_value: newDf.reduce((s, r) => s + (r._metric || 0), 0),
    repeat_value: repeatDf.reduce((s, r) => s + (r._metric || 0), 0),
    new_count: entityCol ? new Set(newDf.map((r) => r._entity)).size : newDf.length,
    repeat_count: entityCol ? new Set(repeatDf.map((r) => r._entity)).size : repeatDf.length,
    classification_method: recurrenceClassified ? "derived" : "unavailable"
  };

  if (entityView === "new") workingRows = workingRows.filter((r) => r.EntityStatus === "New");
  else if (entityView === "repeat") workingRows = workingRows.filter((r) => r.EntityStatus === "Repeat");

  const effectiveGoals = goals.length ? goals : goalValue > 0 ? [{
    id: "primary", label: "Overall Goal", period: "annual", scope_type: "overall",
    scope_column: null, scope_value: null, target_value: goalValue
  }] : [];

  const metricLabel = projectionTarget === "value" ? metricCol.replace(/_/g, " ") : `${(entityCol || "record").replace(/_/g, " ")} count`;

  if (workingRows.length === 0) {
    const emptyGoalProgress = this.computeGoals(workingRows, entityCol, projectionTarget, effectiveGoals, effectiveEnd);
    return {
      kpis: { total_metric_value: 0, unique_entity_count: 0, avg_entity_value: 0, repeat_rate: 0, hhi_index: 0, pareto_ratio: 0 },
      historical_timeline: { labels: [], values: [], rolling_avg: [], mom_growth: [], new_values: [], repeat_values: [] },
      dimension_distribution: {},
      primary_dimension: primaryDimension,
      seasonality: {},
      projections: [],
      forecast_outlook: emptyForecastOutlook(projectionTarget),
      long_range_forecast: emptyLongRangeForecast(projectionTarget, forecastHorizonMonths),
      ai_insights: emptyAiInsights(),
      anomalies: [],
      trend_anomalies: [],
      dimension_drivers: { dimension_column: null, prior_period: null, current_period: null, total_change: 0.0, drivers: [] },
      goal_progress: emptyGoalProgress,
      entity_split: entitySplit,
      diagnostics: {
        future_records_removed: futureRecordsRemoved, future_metric_amount: futureMetricAmount,
        include_future_dates: includeFutureDates, filters_applied: filtersApplied,
        recurrence_classified: recurrenceClassified, entity_view: entityView
      }
    };
  }

  const totalMetricValue = workingRows.reduce((s, r) => s + (r._metric || 0), 0);
  const uniqueEntityCount = entityCol ? new Set(workingRows.map((r) => r._entity)).size : workingRows.length;
  const avgEntityValue = uniqueEntityCount > 0 ? totalMetricValue / uniqueEntityCount : 0;

  let hhiIndex = 0.0;
  if (primaryDimension && totalMetricValue > 0) {
    const shares = new Map();
    for (const r of workingRows) shares.set(r[primaryDimension], (shares.get(r[primaryDimension]) || 0) + (r._metric || 0));
    hhiIndex = Array.from(shares.values()).reduce((s, v) => s + ((v / totalMetricValue) * 100) ** 2, 0);
  }

  const yearsPresent = Array.from(new Set(workingRows.map((r) => r._time.getUTCFullYear()))).sort((a, b) => a - b);
  let repeatRate = 100.0;
  if (yearsPresent.length >= 2 && entityCol) {
    const prevYear = yearsPresent[yearsPresent.length - 2];
    const currYear = yearsPresent[yearsPresent.length - 1];
    const prevYearEntities = new Set(workingRows.filter((r) => r._time.getUTCFullYear() === prevYear).map((r) => r._entity));
    const currYearEntities = new Set(workingRows.filter((r) => r._time.getUTCFullYear() === currYear).map((r) => r._entity));
    if (prevYearEntities.size > 0) {
      let retained = 0;
      for (const e of prevYearEntities) if (currYearEntities.has(e)) retained++;
      repeatRate = (retained / prevYearEntities.size) * 100;
    }
  }

  let paretoRatio = 20.0;
  if (entityCol && totalMetricValue > 0) {
    const entitySums = new Map();
    for (const r of workingRows) entitySums.set(r._entity, (entitySums.get(r._entity) || 0) + (r._metric || 0));
    const sorted = Array.from(entitySums.values()).sort((a, b) => b - a);
    const cutoff = totalMetricValue * 0.8;
    let cumulative = 0;
    let countAtOrBelowCutoff = 0;
    for (const v of sorted) {
      cumulative += v;
      if (cumulative <= cutoff) countAtOrBelowCutoff++;
    }
    const topEntitiesCount = countAtOrBelowCutoff + 1;
    paretoRatio = sorted.length > 0 ? (topEntitiesCount / sorted.length) * 100 : 20.0;
  }

  const monthlyRaw = this.buildMonthlySeries(workingRows, entityCol);
  const targetSeries = projectionTarget === "value" ? "value" : "count";
  const seriesVal = (m) => (targetSeries === "value" ? m.value : m.count);

  const values = monthlyRaw.map(seriesVal);
  const rollingAvg = values.map((_, i) => mean(values.slice(Math.max(0, i - 2), i + 1)));
  const momGrowth = values.map((v, i) => {
    if (i === 0) return 0;
    const prev = values[i - 1];
    if (!prev) return 0;
    const pct = ((v - prev) / prev) * 100;
    return Number.isFinite(pct) ? pct : 0;
  });

  // New/Repeat monthly series aligned to workingRows (post entity-view filter),
  // matching run_analysis's variable reuse: new_df/repeat_df above feed
  // entity_split only; these lines re-derive from the (possibly entity-view
  // filtered) workingRows, so the chart lines reflect the current view.
  const newMonthly = this.buildMonthlySeries(workingRows.filter((r) => r.EntityStatus === "New"), entityCol);
  const repeatMonthly = this.buildMonthlySeries(workingRows.filter((r) => r.EntityStatus === "Repeat"), entityCol);
  const newByOrd = new Map(newMonthly.map((m) => [m.ord, seriesVal(m)]));
  const repeatByOrd = new Map(repeatMonthly.map((m) => [m.ord, seriesVal(m)]));
  const newValues = monthlyRaw.map((m) => newByOrd.get(m.ord) || 0);
  const repeatValues = monthlyRaw.map((m) => repeatByOrd.get(m.ord) || 0);

  // Mirrors analyzer.py: value mode sums the metric per dimension value; count
  // mode counts distinct entities per dimension value, falling back to
  // distinct metric values when there's no entity column (same quirky
  // fallback the Python original has via dim_metric_col).
  let dimensionData = {};
  if (primaryDimension) {
    const dimAggIsSum = projectionTarget === "value";
    const groups = new Map();
    for (const r of workingRows) {
      const key = r[primaryDimension];
      if (!groups.has(key)) groups.set(key, dimAggIsSum ? { sum: 0 } : { set: new Set() });
      const g = groups.get(key);
      if (dimAggIsSum) g.sum += r._metric || 0;
      else g.set.add(entityCol ? r._entity : r._metric);
    }
    const entries = Array.from(groups.entries()).map(([k, g]) => [k, dimAggIsSum ? g.sum : g.set.size]);
    entries.sort((a, b) => b[1] - a[1]);
    dimensionData = Object.fromEntries(entries.slice(0, 20).map(([k, v]) => [String(k), v]));
  }

  const seasonAggIsSum = projectionTarget === "value";
  const seasonGroups = new Map();
  for (const r of workingRows) {
    const monthName = MONTH_NAMES[r._time.getUTCMonth()];
    if (!seasonGroups.has(monthName)) seasonGroups.set(monthName, seasonAggIsSum ? { sum: 0 } : { set: new Set() });
    const g = seasonGroups.get(monthName);
    if (seasonAggIsSum) g.sum += r._metric || 0;
    else g.set.add(entityCol ? r._entity : r._metric);
  }
  const seasonality = {};
  for (const [k, g] of seasonGroups.entries()) seasonality[k] = seasonAggIsSum ? g.sum : g.set.size;

  let projections = [];
  if (monthlyRaw.length > 1) {
    const xs = monthlyRaw.map((_, i) => i);
    const reg = linearRegression(xs, values);
    const lastOrd = monthlyRaw[monthlyRaw.length - 1].ord;
    for (let i = 0; i < 12; i++) {
      const pred = reg.predict(monthlyRaw.length + i);
      projections.push({ period: formatMonthOrdinal(lastOrd + i + 1), projected_value: Math.max(0, pred) });
    }
  }

  const forecastOutlook = this.computeForecastOutlook(monthlyRaw, targetSeries, projectionTarget, metricLabel);
  const longRangeForecast = this.computeLongRangeForecast(monthlyRaw, targetSeries, projectionTarget, forecastHorizonMonths, metricLabel);
  const goalProgress = this.computeGoals(workingRows, entityCol, projectionTarget, effectiveGoals, effectiveEnd);
  const primaryGoal = goalProgress.length ? goalProgress[0] : null;

  const anomalies = [];
  if (entityCol) {
    const entitySums = new Map();
    for (const r of workingRows) entitySums.set(r._entity, (entitySums.get(r._entity) || 0) + (r._metric || 0));
    const topEntities = Array.from(entitySums.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [entId, entVol] of topEntities) {
      if (totalMetricValue > 0 && entVol / totalMetricValue > 0.03) {
        anomalies.push({
          identifier: String(entId), value: entVol,
          reason: `High Concentration Outlier (${Math.round((entVol / totalMetricValue) * 1000) / 10}% of total selected scope)`
        });
      }
    }
  }

  let trendAnomalies = [];
  const avgMonthlyScopeTotal = monthlyRaw.length ? mean(values) : 0;
  for (const col of dimensionCols) {
    trendAnomalies = trendAnomalies.concat(this.detectTrendAnomalies(workingRows, entityCol, targetSeries, col, avgMonthlyScopeTotal));
  }
  trendAnomalies.sort((a, b) => Math.abs(b.deviation_pct) - Math.abs(a.deviation_pct));
  trendAnomalies = trendAnomalies.slice(0, 10);

  const dimensionDrivers = primaryDimension
    ? this.computeDimensionDrivers(workingRows, entityCol, targetSeries, primaryDimension)
    : { dimension_column: null, prior_period: null, current_period: null, total_change: 0.0, drivers: [] };

  const aiInsights = this.generateAiInsights({
    totalMetricValue, uniqueEntityCount, avgEntityValue, repeatRate, hhiIndex, paretoRatio,
    entitySplit, forecastOutlook, primaryGoal, dimensionData, anomalies, metricLabel
  });

  return {
    kpis: {
      total_metric_value: totalMetricValue, unique_entity_count: uniqueEntityCount, avg_entity_value: avgEntityValue,
      repeat_rate: repeatRate, hhi_index: hhiIndex, pareto_ratio: paretoRatio
    },
    historical_timeline: {
      labels: monthlyRaw.map((m) => formatMonthOrdinal(m.ord)), values, rolling_avg: rollingAvg, mom_growth: momGrowth,
      new_values: newValues, repeat_values: repeatValues
    },
    dimension_distribution: dimensionData,
    primary_dimension: primaryDimension,
    seasonality,
    projections,
    forecast_outlook: forecastOutlook,
    ai_insights: aiInsights,
    anomalies,
    trend_anomalies: trendAnomalies,
    dimension_drivers: dimensionDrivers,
    long_range_forecast: longRangeForecast,
    goal_progress: goalProgress,
    entity_split: entitySplit,
    diagnostics: {
      future_records_removed: futureRecordsRemoved, future_metric_amount: futureMetricAmount,
      include_future_dates: includeFutureDates, filters_applied: filtersApplied,
      recurrence_classified: recurrenceClassified, entity_view: entityView
    }
  };
};
