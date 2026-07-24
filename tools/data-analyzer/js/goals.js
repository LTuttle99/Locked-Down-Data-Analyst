/*
 * Port of analyzer.py's goals section: _reference_period_bounds,
 * _period_actual, _estimate_growth_rate, _round_target, compute_goals,
 * _build_goal_trend, suggest_goal_candidates.
 */

BookOfBusinessAnalyzer.prototype.referencePeriodBounds = function (period, anchor) {
  const [start, end] = periodBounds(period, anchor);
  return [addYears(start, -1), addYears(end, -1)];
};

BookOfBusinessAnalyzer.prototype.periodActual = function (rows, entityCol, projectionTarget, start, end) {
  if (!rows || rows.length === 0) return 0;
  const subset = rows.filter((r) => r._time && r._time >= start && r._time <= end);
  if (subset.length === 0) return 0;
  if (projectionTarget === "value") return subset.reduce((s, r) => s + (r._metric || 0), 0);
  return entityCol ? new Set(subset.map((r) => r._entity)).size : subset.length;
};

BookOfBusinessAnalyzer.prototype.estimateGrowthRate = function (rows, entityCol, projectionTarget, period, anchorDate) {
  const [refStart, refEnd] = this.referencePeriodBounds(period, anchorDate);
  const priorStart = addYears(refStart, -1);
  const priorEnd = addYears(refEnd, -1);

  const refActual = this.periodActual(rows, entityCol, projectionTarget, refStart, refEnd);
  const priorActual = this.periodActual(rows, entityCol, projectionTarget, priorStart, priorEnd);

  if (priorActual <= 0) return null;
  const growth = (refActual - priorActual) / priorActual;
  return clamp(growth, -0.6, 1.5);
};

BookOfBusinessAnalyzer.prototype.roundTarget = function (value) {
  if (value === null || value === undefined || value <= 0) return 0.0;
  const digits = String(Math.trunc(value)).length;
  const magnitude = Math.max(1, 10 ** Math.max(0, digits - 2));
  return Math.round(value / magnitude) * magnitude;
};

BookOfBusinessAnalyzer.prototype.computeGoals = function (workingRows, entityCol, projectionTarget, goals, anchorDate) {
  const targetSeries = projectionTarget === "value" ? "value" : "count";
  const results = [];
  if (!goals || goals.length === 0) return results;
  if (!anchorDate) anchorDate = dateOnlyUTC(new Date());

  goals.forEach((g, idx) => {
    const goalId = g.id || `goal_${idx + 1}`;
    const label = g.label || "Goal";
    const period = ["annual", "quarterly", "monthly"].includes(g.period) ? g.period : "annual";
    const scopeType = g.scope_type === "dimension" ? "dimension" : "overall";
    const scopeColumn = scopeType === "dimension" ? g.scope_column : null;
    const scopeValue = scopeType === "dimension" ? g.scope_value : null;
    const targetValue = Number(g.target_value) || 0;

    const [start, end] = periodBounds(period, anchorDate);
    const daysTotal = daysBetweenInclusive(start, end);

    const baseResult = {
      id: goalId,
      label,
      period,
      scope_type: scopeType,
      scope_column: scopeColumn,
      scope_value: scopeValue,
      metric_type: projectionTarget,
      period_start: formatDateISO(start),
      period_end: formatDateISO(end),
      days_total: daysTotal
    };

    const scopedRows = scopeType === "dimension" ? this.applyDimensionScope(workingRows, scopeColumn, scopeValue) : workingRows;

    if (targetValue <= 0) {
      results.push({
        ...baseResult,
        target: 0.0,
        actual: 0.0,
        achievement_pct: 0.0,
        expected_pct: 0.0,
        gap_to_goal: 0.0,
        projected_period_end: 0.0,
        projected_period_end_low: null,
        projected_period_end_high: null,
        days_elapsed: 0,
        status: "no_goal_set",
        trend: []
      });
      return;
    }

    const effectiveEndForActual = anchorDate < end ? anchorDate : end;
    const inPeriod = scopedRows.filter((r) => r._time && r._time >= start && r._time <= effectiveEndForActual);

    const actual =
      projectionTarget === "value"
        ? inPeriod.reduce((s, r) => s + (r._metric || 0), 0)
        : entityCol
        ? new Set(inPeriod.map((r) => r._entity)).size
        : inPeriod.length;

    const daysTotalSafe = Math.max(1, daysTotal);
    const daysElapsed = effectiveEndForActual >= start ? Math.max(0, daysBetweenInclusive(start, effectiveEndForActual)) : 0;

    const expectedPct = Math.min(100.0, (daysElapsed / daysTotalSafe) * 100);
    const achievementPct = (actual / targetValue) * 100;
    const gapToGoal = actual - targetValue;

    let projectedPeriodEnd = daysElapsed > 0 ? (actual / daysElapsed) * daysTotal : 0.0;
    let projectedLow = null;
    let projectedHigh = null;

    const anchorOrd = toMonthOrdinal(anchorDate);
    const endOrd = toMonthOrdinal(end);

    if (anchorOrd < endOrd) {
      const remainingMonths = endOrd - anchorOrd;
      const monthlySeries = this.buildMonthlySeries(scopedRows, entityCol);

      if (monthlySeries.length >= 2) {
        const { future } = this.seasonalTrendForecast(monthlySeries, targetSeries, remainingMonths);
        const remainingForecast = future.reduce((s, i) => s + i.expected_value, 0);
        const remainingConservative = future.reduce((s, i) => s + i.conservative_value, 0);
        const remainingAggressive = future.reduce((s, i) => s + i.aggressive_value, 0);

        projectedPeriodEnd = actual + remainingForecast;
        projectedLow = actual + remainingConservative;
        projectedHigh = actual + remainingAggressive;
      }
    }

    let status;
    if (expectedPct <= 0) status = "no_time_elapsed";
    else {
      const paceRatio = achievementPct / expectedPct;
      status = paceRatio >= 1.0 ? "ahead" : paceRatio >= 0.8 ? "on_pace" : "behind";
    }

    const trend = this.buildGoalTrend(scopedRows, projectionTarget, entityCol, start, effectiveEndForActual, daysTotal);

    results.push({
      ...baseResult,
      target: targetValue,
      actual,
      achievement_pct: achievementPct,
      expected_pct: expectedPct,
      gap_to_goal: gapToGoal,
      projected_period_end: projectedPeriodEnd,
      projected_period_end_low: projectedLow,
      projected_period_end_high: projectedHigh,
      days_elapsed: daysElapsed,
      status,
      trend
    });
  });

  return results;
};

BookOfBusinessAnalyzer.prototype.buildGoalTrend = function (scopedRows, projectionTarget, entityCol, start, anchor, daysTotal, maxPoints = 10) {
  if (!scopedRows || scopedRows.length === 0 || anchor < start) return [];

  const subset = scopedRows.filter((r) => r._time && r._time >= start && r._time <= anchor);
  if (subset.length === 0) return [];

  const dayMap = new Map();

  if (projectionTarget === "value") {
    for (const r of subset) {
      const key = formatDateISO(r._time);
      dayMap.set(key, (dayMap.get(key) || 0) + (r._metric || 0));
    }
  } else if (entityCol) {
    const firstSeen = new Map();
    for (const r of subset) {
      const cur = firstSeen.get(r._entity);
      if (!cur || r._time < cur) firstSeen.set(r._entity, r._time);
    }
    for (const d of firstSeen.values()) {
      const key = formatDateISO(d);
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
    }
  } else {
    for (const r of subset) {
      const key = formatDateISO(r._time);
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
    }
  }

  if (dayMap.size === 0) return [];

  const sortedDays = Array.from(dayMap.keys()).sort();
  let running = 0;
  const cumValues = sortedDays.map((d) => {
    running += dayMap.get(d);
    return running;
  });

  const totalPoints = sortedDays.length;
  const nPoints = Math.min(maxPoints, totalPoints);
  let samplePositions;
  if (nPoints <= 1) samplePositions = [totalPoints - 1];
  else {
    const set = new Set();
    for (let i = 0; i < nPoints; i++) set.add(Math.round((i * (totalPoints - 1)) / (nPoints - 1)));
    samplePositions = Array.from(set).sort((a, b) => a - b);
  }

  const trend = [];
  for (const pos of samplePositions) {
    const dateStr = sortedDays[pos];
    const dateObj = new Date(`${dateStr}T00:00:00Z`);
    const elapsedDays = daysBetweenInclusive(start, dateObj);
    const expectedPct = Math.min(100.0, (elapsedDays / Math.max(1, daysTotal)) * 100);
    trend.push({ date: dateStr, cumulative_actual: cumValues[pos], expected_pct_at_date: expectedPct });
  }
  return trend;
};

BookOfBusinessAnalyzer.prototype.suggestGoalCandidates = function (mapping, projectionTarget = "value", period = "annual", topN = 3) {
  const metricCol = mapping.metric_column;
  const timeCol = mapping.timeline_column;
  let entityCol = mapping.entity_column;
  const dimensionCols = (mapping.dimension_columns || []).filter((c) => this.columns.includes(c));

  if (!metricCol || !timeCol || !this.columns.includes(metricCol) || !this.columns.includes(timeCol)) {
    throw new Error("Metric and Timeline columns must be mapped and present to suggest goals.");
  }
  entityCol = entityCol && this.columns.includes(entityCol) ? entityCol : null;

  const workingRows = this.buildWorkingRows(metricCol, timeCol, entityCol, dimensionCols);
  if (workingRows.length === 0) return [];

  const anchorDate = workingRows.reduce((m, r) => (r._time > m ? r._time : m), workingRows[0]._time);
  const overallGrowth = this.estimateGrowthRate(workingRows, entityCol, projectionTarget, period, anchorDate);

  const scopeCandidates = [["overall", null, null, "Overall"]];

  const topValues = (col) => {
    const sums = new Map();
    for (const r of workingRows) sums.set(r[col], (sums.get(r[col]) || 0) + (r._metric || 0));
    return Array.from(sums.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map((e) => e[0]);
  };

  for (const col of dimensionCols) {
    for (const val of topValues(col)) scopeCandidates.push(["dimension", col, val, `${col}: ${val}`]);
  }

  const suggestions = [];

  for (const [scopeType, scopeColumn, scopeValue, scopeLabel] of scopeCandidates) {
    const scopedRows = scopeType === "dimension" ? this.applyDimensionScope(workingRows, scopeColumn, scopeValue) : workingRows;

    const [refStart, refEnd] = this.referencePeriodBounds(period, anchorDate);
    const [curStart, curEnd] = periodBounds(period, anchorDate);

    const referenceActual = this.periodActual(scopedRows, entityCol, projectionTarget, refStart, refEnd);
    if (referenceActual <= 0) continue;

    let growth = this.estimateGrowthRate(scopedRows, entityCol, projectionTarget, period, anchorDate);
    const dataSufficient = growth !== null;
    if (growth === null) growth = overallGrowth !== null ? overallGrowth : 0;

    suggestions.push({
      scope_type: scopeType,
      scope_column: scopeColumn,
      scope_value: scopeValue,
      scope_label: scopeLabel,
      period,
      period_start: formatDateISO(curStart),
      period_end: formatDateISO(curEnd),
      reference_period_start: formatDateISO(refStart),
      reference_period_end: formatDateISO(refEnd),
      reference_actual: referenceActual,
      growth_rate_pct: growth * 100,
      data_sufficient: dataSufficient,
      metric_type: projectionTarget,
      suggestions: {
        maintain: this.roundTarget(referenceActual),
        grow: this.roundTarget(referenceActual * (1 + growth)),
        stretch: this.roundTarget(referenceActual * (1 + growth + 0.05))
      }
    });
  }

  return suggestions;
};
