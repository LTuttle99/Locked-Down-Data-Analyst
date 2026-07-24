/*
 * Port of analyzer.py's forecasting section: _build_monthly_series,
 * _seasonal_trend_forecast, _compute_forecast_outlook (+ empty),
 * _compute_long_range_forecast (+ empty).
 */

BookOfBusinessAnalyzer.prototype.buildMonthlySeries = function (rows, entityCol) {
  if (!rows || rows.length === 0) return [];

  const groups = new Map();
  for (const r of rows) {
    if (!r._time) continue;
    const ord = toMonthOrdinal(r._time);
    let g = groups.get(ord);
    if (!g) {
      g = { valueSum: 0, entitySet: new Set(), size: 0 };
      groups.set(ord, g);
    }
    g.valueSum += r._metric || 0;
    g.size += 1;
    if (entityCol) g.entitySet.add(r._entity);
  }

  return Array.from(groups.keys())
    .sort((a, b) => a - b)
    .map((ord) => {
      const g = groups.get(ord);
      return { ord, value: g.valueSum, count: entityCol ? g.entitySet.size : g.size };
    });
};

BookOfBusinessAnalyzer.prototype.seasonalTrendForecast = function (monthly, targetSeries, periodsAhead) {
  const emptyDiag = { r_squared: 0, residual_std: 0, slope: 0, seasonal_index: {} };
  if (!monthly || monthly.length < 2 || periodsAhead <= 0) return { future: [], diagnostics: emptyDiag };

  const sorted = monthly.slice().sort((a, b) => a.ord - b.ord);
  const xs = sorted.map((_, i) => i);
  const ys = sorted.map((m) => (targetSeries === "value" ? m.value : m.count));
  const calMonths = sorted.map((m) => monthOf(m.ord));

  const reg = linearRegression(xs, ys);
  const trendFitted = xs.map((x) => reg.predict(x));
  const ratios = trendFitted.map((t, i) => (Math.abs(t) < 1e-9 ? null : ys[i] / t));

  const seasonalIndex = {};
  for (let m = 1; m <= 12; m++) {
    const vals = [];
    for (let i = 0; i < calMonths.length; i++) {
      if (calMonths[i] === m && ratios[i] !== null && Number.isFinite(ratios[i])) vals.push(ratios[i]);
    }
    seasonalIndex[m] = vals.length > 0 ? mean(vals) : 1.0;
  }

  const observedVals = Object.values(seasonalIndex).filter((v) => Number.isFinite(v));
  const meanIdx = observedVals.length > 0 ? mean(observedVals) : 1.0;
  if (meanIdx && Number.isFinite(meanIdx) && meanIdx !== 0) {
    for (const m of Object.keys(seasonalIndex)) seasonalIndex[m] = seasonalIndex[m] / meanIdx;
  }
  for (const m of Object.keys(seasonalIndex)) seasonalIndex[m] = clamp(seasonalIndex[m], 0.4, 2.5);

  const deseasonalizedFitted = trendFitted.map((t, i) => t * (seasonalIndex[calMonths[i]] ?? 1.0));
  const residuals = ys.map((y, i) => y - deseasonalizedFitted[i]);
  const residualStd = residuals.length > 1 ? std(residuals) : 0;

  const lastOrd = sorted[sorted.length - 1].ord;
  const future = [];

  for (let i = 0; i < periodsAhead; i++) {
    const monthsAhead = i + 1;
    const futureOrd = lastOrd + monthsAhead;
    const calMonth = monthOf(futureOrd);
    const basePred = reg.predict(sorted.length + i);
    const seasonalMult = seasonalIndex[calMonth] ?? 1.0;
    const expected = Math.max(0, basePred * seasonalMult);
    const bandWidth = residualStd * Math.sqrt(monthsAhead);

    future.push({
      period: formatMonthOrdinal(futureOrd),
      year: yearOf(futureOrd),
      month: calMonth,
      months_ahead: monthsAhead,
      expected_value: expected,
      conservative_value: Math.max(0, expected - bandWidth),
      aggressive_value: Math.max(0, expected + bandWidth)
    });
  }

  return { future, diagnostics: { r_squared: reg.r2, residual_std: residualStd, slope: reg.slope, seasonal_index: seasonalIndex } };
};

function emptyForecastOutlook(projectionTarget = "value") {
  return {
    metric_type: projectionTarget,
    current_year: null,
    previous_year: null,
    current_actual: 0.0,
    previous_year_actual: 0.0,
    projected_year_end: 0.0,
    conservative_year_end: 0.0,
    aggressive_year_end: 0.0,
    remaining_months: 0,
    growth_vs_previous_year_pct: 0.0,
    confidence_score: 0.0,
    confidence_label: "Insufficient Data",
    trend_direction: "Flat",
    monthly_forecast: [],
    seasonal_index: {},
    executive_summary: "Not enough data is available to produce a reliable year-end projection."
  };
}

BookOfBusinessAnalyzer.prototype.computeForecastOutlook = function (monthly, targetSeries, projectionTarget, metricLabel) {
  if (!monthly || monthly.length < 2) return emptyForecastOutlook(projectionTarget);

  const sorted = monthly.slice().sort((a, b) => a.ord - b.ord);
  const years = sorted.map((m) => yearOf(m.ord));
  const currentYear = Math.max(...years);
  const previousYear = currentYear - 1;

  const seriesVal = (m) => (targetSeries === "value" ? m.value : m.count);
  const currentYearRows = sorted.filter((m) => yearOf(m.ord) === currentYear);
  const previousYearRows = sorted.filter((m) => yearOf(m.ord) === previousYear);

  const currentActual = currentYearRows.reduce((s, m) => s + seriesVal(m), 0);
  const previousYearActual = previousYearRows.length ? previousYearRows.reduce((s, m) => s + seriesVal(m), 0) : 0;

  const lastOrd = sorted[sorted.length - 1].ord;
  const remainingMonths = Math.max(0, 12 - monthOf(lastOrd));

  const { future: futureMonthly, diagnostics } = this.seasonalTrendForecast(sorted, targetSeries, remainingMonths);
  const { r_squared: rSquared, residual_std: residualStd, slope } = diagnostics;

  const avgMonthly = sorted.length > 0 ? mean(sorted.map(seriesVal)) : 0;
  const volatilityRatio = avgMonthly !== 0 ? Math.abs(residualStd / avgMonthly) : 1.0;

  const expectedFutureTotal = futureMonthly.reduce((s, i) => s + i.expected_value, 0);
  const conservativeFutureTotal = futureMonthly.reduce((s, i) => s + i.conservative_value, 0);
  const aggressiveFutureTotal = futureMonthly.reduce((s, i) => s + i.aggressive_value, 0);

  const projectedYearEnd = currentActual + expectedFutureTotal;
  const conservativeYearEnd = currentActual + conservativeFutureTotal;
  const aggressiveYearEnd = currentActual + aggressiveFutureTotal;

  let growthVsPreviousYearPct = 0.0;
  if (previousYearActual > 0) growthVsPreviousYearPct = ((projectedYearEnd - previousYearActual) / previousYearActual) * 100;

  const trendDirection = slope > 0 ? "Increasing" : slope < 0 ? "Decreasing" : "Flat";

  const dataPoints = sorted.length;
  const historyScore = Math.min(1.0, dataPoints / 12);
  const fitScore = clamp(rSquared, 0, 1);
  const stabilityScore = clamp(1 - volatilityRatio, 0, 1);
  const confidenceScore = Math.round((historyScore * 0.35 + fitScore * 0.4 + stabilityScore * 0.25) * 1000) / 10;

  let confidenceLabel;
  if (dataPoints < 4) confidenceLabel = "Low";
  else if (confidenceScore >= 75) confidenceLabel = "High";
  else if (confidenceScore >= 50) confidenceLabel = "Moderate";
  else confidenceLabel = "Low";

  const growthPhrase = previousYearActual > 0 ? `${fmt1(growthVsPreviousYearPct)}% compared with the prior year` : "no prior-year comparison is available";

  const executiveSummary =
    `Based on current monthly performance and seasonal patterns, the selected data is projected to finish ` +
    `${currentYear} at approximately ${fmt0(projectedYearEnd)} in ${metricLabel}. ` +
    `This represents ${growthPhrase}. ` +
    `The forecast confidence is ${confidenceLabel.toLowerCase()} based on available history, trend fit, and volatility. ` +
    `See the Goals panel for goal-specific pacing and projections.`;

  return {
    metric_type: projectionTarget,
    current_year: currentYear,
    previous_year: previousYear,
    current_actual: currentActual,
    previous_year_actual: previousYearActual,
    projected_year_end: projectedYearEnd,
    conservative_year_end: conservativeYearEnd,
    aggressive_year_end: aggressiveYearEnd,
    remaining_months: remainingMonths,
    growth_vs_previous_year_pct: growthVsPreviousYearPct,
    confidence_score: confidenceScore,
    confidence_label: confidenceLabel,
    trend_direction: trendDirection,
    monthly_forecast: futureMonthly,
    seasonal_index: diagnostics.seasonal_index || {},
    executive_summary: executiveSummary
  };
};

function emptyLongRangeForecast(projectionTarget = "value", horizonMonths = 24) {
  return {
    metric_type: projectionTarget,
    horizon_months: horizonMonths,
    trend_direction: "Flat",
    confidence_label: "Insufficient Data",
    monthly: [],
    annual_rollup: [],
    executive_summary: "Not enough monthly history is available to build a multi-year projection."
  };
}

BookOfBusinessAnalyzer.prototype.computeLongRangeForecast = function (monthly, targetSeries, projectionTarget, horizonMonths, metricLabel) {
  horizonMonths = clamp(Math.round(horizonMonths), 1, 60);

  if (!monthly || monthly.length < 3) return emptyLongRangeForecast(projectionTarget, horizonMonths);

  const { future: futureMonthly, diagnostics } = this.seasonalTrendForecast(monthly, targetSeries, horizonMonths);
  if (!futureMonthly.length) return emptyLongRangeForecast(projectionTarget, horizonMonths);

  const annual = new Map();
  for (const item of futureMonthly) {
    let bucket = annual.get(item.year);
    if (!bucket) {
      bucket = { expected_total: 0, conservative_total: 0, aggressive_total: 0, months_included: 0 };
      annual.set(item.year, bucket);
    }
    bucket.expected_total += item.expected_value;
    bucket.conservative_total += item.conservative_value;
    bucket.aggressive_total += item.aggressive_value;
    bucket.months_included += 1;
  }

  const annualRollup = Array.from(annual.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, vals]) => ({
      year,
      projected_total: vals.expected_total,
      conservative_total: vals.conservative_total,
      aggressive_total: vals.aggressive_total,
      months_included: vals.months_included,
      is_partial_year: vals.months_included < 12
    }));

  const slope = diagnostics.slope || 0;
  const trendDirection = slope > 0 ? "Increasing" : slope < 0 ? "Decreasing" : "Flat";

  const dataPoints = monthly.length;
  const rSquared = diagnostics.r_squared || 0;
  let confidenceLabel;
  if (dataPoints < 6) confidenceLabel = "Low";
  else if (rSquared >= 0.5 && dataPoints >= 18) confidenceLabel = "Moderate";
  else confidenceLabel = "Low";

  const farYear = annualRollup.length ? annualRollup[annualRollup.length - 1].year : null;

  const executiveSummary =
    `Projecting ${horizonMonths} months forward from the latest available data, the trend is ` +
    `${trendDirection.toLowerCase()} in ${metricLabel}. ` +
    `Confidence in the ${farYear} figures is necessarily lower than near-term months — ` +
    `the projected range widens the further out the estimate reaches, since a trend fit on ` +
    `${dataPoints} months of history compounds its own uncertainty over a multi-year horizon. ` +
    `Treat years beyond the first 12 months as directional planning input rather than a firm commitment.`;

  return {
    metric_type: projectionTarget,
    horizon_months: horizonMonths,
    trend_direction: trendDirection,
    confidence_label: confidenceLabel,
    monthly: futureMonthly,
    annual_rollup: annualRollup,
    executive_summary: executiveSummary
  };
};
