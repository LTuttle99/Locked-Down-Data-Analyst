/*
 * Port of analyzer.py's entity-recurrence, trend-anomaly, dimension-driver,
 * and AI-insights sections: _classify_entity_recurrence,
 * _detect_trend_anomalies, compute_dimension_drivers, _generate_ai_insights.
 */

BookOfBusinessAnalyzer.prototype.classifyEntityRecurrence = function (workingRows, entityCol, entityFirstDates) {
  if (!entityCol) return workingRows.map((r) => ({ ...r, EntityStatus: "Unclassified" }));

  return workingRows.map((r) => {
    const key = String(r._entity);
    const firstDate = entityFirstDates.get(key);
    let status;
    if (firstDate !== undefined) {
      status = r._time && Math.abs(r._time - firstDate) <= 30 * 86400000 ? "New" : "Repeat";
    } else {
      status = "Repeat";
    }
    return { ...r, EntityStatus: status };
  });
};

BookOfBusinessAnalyzer.prototype.detectTrendAnomalies = function (workingRows, entityCol, targetSeries, dimensionCol, avgMonthlyScopeTotal) {
  const flags = [];
  if (!dimensionCol) return flags;

  const filtered = workingRows.filter((r) => !isMissing(r[dimensionCol]));
  if (filtered.length === 0) return flags;

  const groups = new Map();
  for (const r of filtered) {
    const dimVal = r[dimensionCol];
    const ord = toMonthOrdinal(r._time);
    if (!groups.has(dimVal)) groups.set(dimVal, new Map());
    const m = groups.get(dimVal);
    let g = m.get(ord);
    if (!g) {
      g = { sum: 0, entitySet: new Set(), count: 0 };
      m.set(ord, g);
    }
    g.sum += r._metric || 0;
    g.count += 1;
    if (entityCol) g.entitySet.add(r._entity);
  }

  for (const [dimVal, monthMap] of groups.entries()) {
    const ordinals = Array.from(monthMap.keys()).sort((a, b) => a - b);
    if (ordinals.length < 4) continue;

    const series = ordinals.map((ord) => {
      const g = monthMap.get(ord);
      return targetSeries === "value" ? g.sum : entityCol ? g.entitySet.size : g.count;
    });

    const history = series.slice(0, -1);
    const latestValue = series[series.length - 1];
    const meanVal = mean(history);
    const stdVal = std(history);

    if (meanVal <= 0) continue;
    if (avgMonthlyScopeTotal > 0 && meanVal / avgMonthlyScopeTotal < 0.03) continue;

    const deviationPct = ((latestValue - meanVal) / meanVal) * 100;
    let zScore;
    if (stdVal > 0) zScore = (latestValue - meanVal) / stdVal;
    else zScore = Math.abs(deviationPct) < 1 ? 0 : deviationPct > 0 ? 10 : -10;

    if (Math.abs(zScore) >= 2.0 && Math.abs(deviationPct) >= 15) {
      flags.push({
        dimension_column: dimensionCol,
        scope_value: String(dimVal),
        latest_period: formatMonthOrdinal(ordinals[ordinals.length - 1]),
        latest_value: latestValue,
        trailing_avg: meanVal,
        deviation_pct: deviationPct,
        z_score: zScore,
        direction: deviationPct > 0 ? "spike" : "drop"
      });
    }
  }

  return flags;
};

BookOfBusinessAnalyzer.prototype.computeDimensionDrivers = function (workingRows, entityCol, targetSeries, dimensionCol, topN = 8) {
  const empty = { dimension_column: dimensionCol, prior_period: null, current_period: null, total_change: 0.0, drivers: [] };
  if (!dimensionCol) return empty;

  const filtered = workingRows.filter((r) => !isMissing(r[dimensionCol]));
  if (filtered.length === 0) return empty;

  const monthsSet = new Set(filtered.map((r) => toMonthOrdinal(r._time)));
  const availableMonths = Array.from(monthsSet).sort((a, b) => a - b);
  if (availableMonths.length < 2) return empty;

  const currentMonth = availableMonths[availableMonths.length - 1];
  const priorMonth = availableMonths[availableMonths.length - 2];

  const pivot = new Map();
  for (const r of filtered) {
    const dimVal = r[dimensionCol];
    const ord = toMonthOrdinal(r._time);
    if (!pivot.has(dimVal)) pivot.set(dimVal, new Map());
    const m = pivot.get(dimVal);
    let g = m.get(ord);
    if (!g) {
      g = { sum: 0, entitySet: new Set(), count: 0 };
      m.set(ord, g);
    }
    g.sum += r._metric || 0;
    g.count += 1;
    if (entityCol) g.entitySet.add(r._entity);
  }

  const valueAt = (g) => {
    if (!g) return 0;
    return targetSeries === "value" ? g.sum : entityCol ? g.entitySet.size : g.count;
  };

  let totalCurrent = 0;
  let totalPrior = 0;
  const drivers = [];

  for (const [dimVal, monthMap] of pivot.entries()) {
    const priorV = valueAt(monthMap.get(priorMonth));
    const currentV = valueAt(monthMap.get(currentMonth));
    totalCurrent += currentV;
    totalPrior += priorV;

    const change = currentV - priorV;
    if (Math.abs(change) < 1e-9) continue;
    drivers.push({ value: String(dimVal), prior_value: priorV, current_value: currentV, change, direction: change > 0 ? "up" : "down" });
  }

  const totalChange = totalCurrent - totalPrior;
  drivers.forEach((d) => {
    d.pct_of_total_change = totalChange !== 0 ? (d.change / totalChange) * 100 : 0;
  });
  drivers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    dimension_column: dimensionCol,
    prior_period: formatMonthOrdinal(priorMonth),
    current_period: formatMonthOrdinal(currentMonth),
    total_change: totalChange,
    drivers: drivers.slice(0, topN)
  };
};

function emptyAiInsights() {
  return {
    portfolio_health_score: 0.0,
    portfolio_health_label: "Insufficient Data",
    portfolio_health_status: "neutral",
    executive_summary: "Not enough data is available to generate insights.",
    insights: [],
    recommended_actions: ["Upload or select a broader dataset to generate insights."]
  };
}

BookOfBusinessAnalyzer.prototype.generateAiInsights = function (params) {
  const {
    totalMetricValue, uniqueEntityCount, avgEntityValue, repeatRate, hhiIndex, paretoRatio,
    entitySplit, forecastOutlook, primaryGoal, dimensionData, anomalies, metricLabel
  } = params;

  const insights = [];
  const actionItems = [];

  const projectedYearEnd = Number(forecastOutlook.projected_year_end || 0);
  const growthPct = Number(forecastOutlook.growth_vs_previous_year_pct || 0);
  const confidenceLabel = forecastOutlook.confidence_label || "Insufficient Data";
  const trendDirection = forecastOutlook.trend_direction || "Flat";

  let goalStatus = "No Goal Set";
  let projectedGapToGoal = 0.0;
  if (primaryGoal && Number(primaryGoal.target || 0) > 0) {
    projectedGapToGoal = Number(primaryGoal.projected_period_end || 0) - Number(primaryGoal.target || 0);
    goalStatus = projectedGapToGoal >= 0 ? "Projected Above Goal" : "Projected Below Goal";
  }

  const newValue = Number(entitySplit.new_value || 0);
  const repeatValue = Number(entitySplit.repeat_value || 0);
  const newCount = Number(entitySplit.new_count || 0);
  const repeatCount = Number(entitySplit.repeat_count || 0);
  const recurrenceAvailable = entitySplit.classification_method === "derived";

  const totalSplitValue = newValue + repeatValue;
  const totalSplitCount = newCount + repeatCount;
  const newValueShare = totalSplitValue > 0 ? (newValue / totalSplitValue) * 100 : 0;
  const repeatValueShare = totalSplitValue > 0 ? (repeatValue / totalSplitValue) * 100 : 0;
  const newCountShare = totalSplitCount > 0 ? (newCount / totalSplitCount) * 100 : 0;
  const repeatCountShare = totalSplitCount > 0 ? (repeatCount / totalSplitCount) * 100 : 0;

  let topDimensionName = null;
  let topDimensionShare = 0.0;
  if (dimensionData && Object.keys(dimensionData).length > 0) {
    const entries = Object.entries(dimensionData);
    topDimensionName = entries.reduce((best, e) => (e[1] > best[1] ? e : best), entries[0])[0];
    const dimensionTotal = entries.reduce((s, e) => s + (Number(e[1]) || 0), 0);
    if (dimensionTotal > 0) topDimensionShare = (Number(dimensionData[topDimensionName]) || 0) / dimensionTotal * 100;
  }

  const anomalyCount = anomalies ? anomalies.length : 0;

  const concentrationLevel = hhiIndex >= 2500 ? "High" : hhiIndex >= 1500 ? "Moderate" : "Low";
  const retentionLevel = repeatRate >= 90 ? "Strong" : repeatRate >= 75 ? "Watch" : "At Risk";
  const growthLevel = growthPct >= 10 ? "Accelerating" : growthPct >= 3 ? "Growing" : growthPct <= -5 ? "Declining" : "Flat";

  if (projectedYearEnd > 0) {
    insights.push({
      category: "Forecast", icon: "\u{1F52E}", severity: growthPct >= 0 ? "positive" : "warning", title: "Year-End Projection",
      message: `Based on current monthly performance, the selected data is projected to finish at approximately ${fmt0(projectedYearEnd)} in ${metricLabel}. Forecast confidence is ${confidenceLabel.toLowerCase()}.`
    });
  } else {
    insights.push({
      category: "Forecast", icon: "\u{1F52E}", severity: "neutral", title: "Forecast Availability",
      message: "There is not enough monthly history available to produce a reliable year-end forecast."
    });
  }

  if (growthLevel === "Accelerating") {
    insights.push({
      category: "Growth", icon: "\u{1F4C8}", severity: "positive", title: "Growth Momentum Is Strong",
      message: `The forecast indicates accelerating growth of approximately ${fmt1(growthPct)}% versus the prior year. Current trend direction is ${trendDirection.toLowerCase()}.`
    });
    actionItems.push("Review the highest-performing dimensions to identify where growth is coming from and whether it can be replicated.");
  } else if (growthLevel === "Growing") {
    insights.push({
      category: "Growth", icon: "\u{1F4C8}", severity: "positive", title: "Growth Trend Is Positive",
      message: `The data is projected to grow by approximately ${fmt1(growthPct)}% versus the prior year, suggesting positive but controlled expansion.`
    });
  } else if (growthLevel === "Declining") {
    insights.push({
      category: "Growth", icon: "\u{1F4C8}", severity: "risk", title: "Growth Trend Is Declining",
      message: `The forecast indicates a decline of approximately ${fmt1(Math.abs(growthPct))}% versus the prior year. This may warrant review of where volume is being lost.`
    });
    actionItems.push("Investigate whether the decline is concentrated in specific dimensions (regions, categories, channels, etc.).");
  } else {
    insights.push({
      category: "Growth", icon: "\u{1F4C8}", severity: "neutral", title: "Growth Trend Is Relatively Flat",
      message: `The current forecast shows limited movement versus the prior year at approximately ${fmt1(growthPct)}%.`
    });
  }

  if (goalStatus === "Projected Above Goal") {
    insights.push({
      category: "Goal", icon: "\u{1F3C1}", severity: "positive", title: "Projected Above Goal",
      message: `Current trends suggest the selected scope may finish above goal by approximately ${fmt0(Math.abs(projectedGapToGoal))}.`
    });
  } else if (goalStatus === "Projected Below Goal") {
    insights.push({
      category: "Goal", icon: "\u{1F3C1}", severity: "risk", title: "Projected Below Goal",
      message: `Current trends suggest the selected scope may finish below goal by approximately ${fmt0(Math.abs(projectedGapToGoal))}.`
    });
    actionItems.push("Compare the required pace to recent performance to determine whether the gap is realistically recoverable.");
  } else {
    insights.push({
      category: "Goal", icon: "\u{1F3C1}", severity: "neutral", title: "No Goal Applied",
      message: "No goal is currently applied, so goal-based variance is not being evaluated."
    });
  }

  if (recurrenceAvailable) {
    if (retentionLevel === "Strong") {
      insights.push({
        category: "Retention", icon: "✅", severity: "positive", title: "Repeat Rate Is Strong",
        message: `The repeat rate is currently ${fmt1(repeatRate)}%, indicating healthy persistency across the selected data.`
      });
    } else if (retentionLevel === "Watch") {
      insights.push({
        category: "Retention", icon: "✅", severity: "warning", title: "Repeat Rate Should Be Watched",
        message: `The repeat rate is currently ${fmt1(repeatRate)}%. This is not critical, but it may deserve monitoring.`
      });
      actionItems.push("Look at repeat entities by dimension to identify where retention is softening.");
    } else {
      insights.push({
        category: "Retention", icon: "✅", severity: "risk", title: "Retention Risk Detected",
        message: `The repeat rate is currently ${fmt1(repeatRate)}%, which may indicate elevated attrition risk.`
      });
      actionItems.push("Prioritize reviewing entities that were active in the prior year but are not appearing in the current year.");
    }
  }

  if (concentrationLevel === "High") {
    insights.push({
      category: "Risk", icon: "⚠️", severity: "risk", title: "High Concentration Risk",
      message: `The HHI concentration index is ${fmt0(hhiIndex)}, which suggests elevated concentration exposure. ${anomalyCount} concentration outlier(s) were detected.`
    });
    actionItems.push("Review the largest entities and determine whether the selected scope is overly dependent on a small number of high-value relationships.");
  } else if (concentrationLevel === "Moderate") {
    insights.push({
      category: "Risk", icon: "⚠️", severity: "warning", title: "Moderate Concentration Risk",
      message: `The HHI concentration index is ${fmt0(hhiIndex)}, suggesting moderate concentration. This is manageable, but still worth monitoring.`
    });
  } else {
    insights.push({
      category: "Risk", icon: "⚠️", severity: "positive", title: "Concentration Appears Controlled",
      message: `The HHI concentration index is ${fmt0(hhiIndex)}, suggesting the selected data is not overly concentrated.`
    });
  }

  if (recurrenceAvailable && totalSplitValue > 0) {
    if (newValueShare >= 35) {
      insights.push({
        category: "Mix", icon: "\u{1F9ED}", severity: "positive", title: "New Entity Contribution Is Strong",
        message: `New entities represent approximately ${fmt1(newValueShare)}% of ${metricLabel}, indicating strong contribution from new activity.`
      });
    } else if (newValueShare >= 15) {
      insights.push({
        category: "Mix", icon: "\u{1F9ED}", severity: "neutral", title: "Mix Is Repeat-Led With Meaningful New Activity",
        message: `Repeat entities represent approximately ${fmt1(repeatValueShare)}% of ${metricLabel}, while new entities contribute ${fmt1(newValueShare)}%.`
      });
    } else {
      insights.push({
        category: "Mix", icon: "\u{1F9ED}", severity: "warning", title: "Heavily Repeat-Dependent",
        message: `New entities represent only ${fmt1(newValueShare)}% of ${metricLabel}. The selected data appears highly dependent on repeat activity.`
      });
      actionItems.push("Review whether new-entity activity is sufficient to offset future attrition.");
    }
  } else if (recurrenceAvailable && totalSplitCount > 0) {
    insights.push({
      category: "Mix", icon: "\u{1F9ED}", severity: "neutral", title: "Mix Available By Entity Count",
      message: `New entities represent approximately ${fmt1(newCountShare)}% of records, while repeat entities represent ${fmt1(repeatCountShare)}%.`
    });
  }

  if (topDimensionName) {
    insights.push({
      category: "Opportunity", icon: "\u{1F3AF}", severity: topDimensionShare >= 20 ? "positive" : "neutral", title: "Largest Segment Opportunity",
      message: `${topDimensionName} is the largest visible group in the selected scope, representing approximately ${fmt1(topDimensionShare)}% of measured volume. This may be useful for deeper opportunity review.`
    });
    if (topDimensionShare >= 35) {
      actionItems.push(`Evaluate whether ${topDimensionName} concentration is strategic strength or a dependency risk.`);
    }
  }

  if (paretoRatio <= 10) {
    insights.push({
      category: "Risk", icon: "⚠️", severity: "risk", title: "Pareto Dependency Is Elevated",
      message: `Approximately ${fmt1(paretoRatio)}% of entities appear to drive 80% of selected ${metricLabel}, which suggests a concentrated dependency profile.`
    });
  } else if (paretoRatio <= 25) {
    insights.push({
      category: "Risk", icon: "⚠️", severity: "warning", title: "Pareto Distribution Is Moderately Concentrated",
      message: `Approximately ${fmt1(paretoRatio)}% of entities appear to drive 80% of selected ${metricLabel}.`
    });
  }

  let score = 100.0;
  if (growthLevel === "Declining") score -= 20;
  else if (growthLevel === "Flat") score -= 8;

  if (recurrenceAvailable) {
    if (retentionLevel === "Watch") score -= 10;
    else if (retentionLevel === "At Risk") score -= 25;
  }

  if (concentrationLevel === "Moderate") score -= 10;
  else if (concentrationLevel === "High") score -= 22;

  if (goalStatus === "Projected Below Goal") score -= 15;
  if (confidenceLabel === "Low") score -= 8;

  score = clamp(score, 0, 100);

  let healthLabel;
  let healthStatus;
  if (score >= 85) { healthLabel = "Excellent"; healthStatus = "positive"; }
  else if (score >= 70) { healthLabel = "Healthy"; healthStatus = "positive"; }
  else if (score >= 55) { healthLabel = "Watch"; healthStatus = "warning"; }
  else { healthLabel = "At Risk"; healthStatus = "risk"; }

  const overviewParts = [`The selected data is currently rated ${healthLabel} with a health score of ${fmt1(score)}/100.`];
  if (projectedYearEnd > 0) overviewParts.push(`The forecasted year-end position is approximately ${fmt0(projectedYearEnd)} in ${metricLabel}.`);
  if (recurrenceAvailable) overviewParts.push(`Repeat rate is ${fmt1(repeatRate)}% and concentration risk is classified as ${concentrationLevel.toLowerCase()}.`);
  else overviewParts.push(`Concentration risk is classified as ${concentrationLevel.toLowerCase()}.`);
  if (goalStatus !== "No Goal Set") overviewParts.push(`Goal status is currently ${goalStatus.toLowerCase()}.`);

  const executiveSummary = overviewParts.join(" ");

  if (actionItems.length === 0) actionItems.push("Continue monitoring forecast, concentration, and mix as additional monthly data becomes available.");

  return {
    portfolio_health_score: score,
    portfolio_health_label: healthLabel,
    portfolio_health_status: healthStatus,
    executive_summary: executiveSummary,
    insights,
    recommended_actions: actionItems.slice(0, 5)
  };
};
