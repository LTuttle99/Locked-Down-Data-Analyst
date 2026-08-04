const MEASURE_NAME_HINTS = [
  "revenue", "sales", "amount", "total", "price", "cost", "spend", "expense",
  "income", "profit", "margin", "quantity", "qty", "units", "volume", "count",
  "balance", "payment", "fee", "score", "rate", "hours", "duration", "value", "premium"
];

const IDENTIFIER_NAME_HINTS = ["id", "code", "key", "uuid", "guid", "sku", "ref", "number", "no", "isbn"];
const DATE_NAME_HINTS = ["date", "time", "created", "updated", "posted", "period", "timestamp", "day", "month", "year"];
const BOOLEAN_VALUES = new Set(["yes", "no", "true", "false", "y", "n", "0", "1"]);

function profileIsBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function profileToNumber(value) {
  if (profileIsBlank(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const s = String(value).trim().replace(/,/g, "");
  if (!/^[+-]?\$?(\d+\.?\d*|\.\d+)%?$/.test(s)) return null;
  const n = Number(s.replace(/[$%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function profileToDate(value) {
  if (profileIsBlank(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;

  const s = value.trim();
  if (s === "") return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/);
  if (m) return safeDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T ]|$)/);
  if (m) return safeDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return safeDate(+m[3], +m[1], +m[2]);

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return safeDate(twoDigitYear(+m[3]), +m[1], +m[2]);

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return safeDate(+m[3], +m[1], +m[2]);

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) return safeDate(twoDigitYear(+m[3]), +m[1], +m[2]);

  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9}\.?)[ -](\d{4})$/);
  if (m) return safeDate(+m[3], monthFromName(m[2]), +m[1]);

  m = s.match(/^([A-Za-z]{3,9}\.?)[ -](\d{1,2}),?[ -](\d{4})$/);
  if (m) return safeDate(+m[3], monthFromName(m[1]), +m[2]);

  return null;
}

const PROFILE_MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

function monthFromName(name) {
  const lower = String(name).toLowerCase().replace(/\.$/, "");
  const index = PROFILE_MONTH_NAMES.findIndex((m) => m === lower || (lower.length >= 3 && m.startsWith(lower)));
  return index === -1 ? 0 : index + 1;
}

function twoDigitYear(year) {
  return year + (year < 70 ? 2000 : 1900);
}

function safeDate(year, month, day) {
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nameMatches(column, hints) {
  const tokens = String(column)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return hints.some((h) => tokens.includes(h));
}

function profileColumn(rows, column) {
  const values = rows.map((r) => r[column]);
  const present = values.filter((v) => !profileIsBlank(v));
  const blankCount = values.length - present.length;
  const blankRate = values.length === 0 ? 1 : blankCount / values.length;

  const distinct = new Set(present.map((v) => (v instanceof Date ? v.getTime() : String(v))));
  const distinctCount = distinct.size;
  const uniqueRatio = present.length === 0 ? 0 : distinctCount / present.length;

  const base = {
    name: column,
    total: values.length,
    present: present.length,
    blankCount,
    blankRate,
    distinctCount,
    uniqueRatio,
    type: "text",
    score: 0
  };

  if (present.length === 0) return { ...base, type: "empty" };
  if (distinctCount === 1) return { ...base, type: "constant", sample: String(present[0]) };

  const looksIdName = nameMatches(column, IDENTIFIER_NAME_HINTS);

  const dates = present.map(profileToDate);
  const dateRatio = dates.filter((d) => d !== null).length / present.length;
  if (dateRatio >= 0.9) {
    const valid = dates.filter((d) => d !== null).sort((a, b) => a - b);
    return {
      ...base,
      type: "date",
      min: valid[0],
      max: valid[valid.length - 1],
      monthsSpanned: new Set(valid.map(monthKey)).size,
      score: (nameMatches(column, DATE_NAME_HINTS) ? 2 : 0) + dateRatio
    };
  }

  const numbers = present.map(profileToNumber);
  const numericRatio = numbers.filter((n) => n !== null).length / present.length;
  if (numericRatio >= 0.95) {
    const nums = numbers.filter((n) => n !== null).sort((a, b) => a - b);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
    const spread = mean === 0 ? 0 : Math.sqrt(variance) / Math.abs(mean);
    const allIntegers = nums.every((n) => Number.isInteger(n));
    const sequential = allIntegers && uniqueRatio > 0.99 && nums[nums.length - 1] - nums[0] === nums.length - 1;
    const measureNamed = nameMatches(column, MEASURE_NAME_HINTS);

    if (!measureNamed && (sequential || (looksIdName && uniqueRatio > 0.9))) {
      return { ...base, type: "identifier", values: nums.length };
    }

    let score = 1;
    if (measureNamed) score += 3;
    if (looksIdName) score -= 2;
    if (spread > 0.1) score += 1;
    if (nums.some((n) => n < 0)) score -= 0.25;

    return {
      ...base,
      type: "number",
      min: nums[0],
      max: nums[nums.length - 1],
      mean,
      sum: nums.reduce((a, b) => a + b, 0),
      sorted: nums,
      spread,
      summable: nums.every((n) => n >= 0) || nameMatches(column, MEASURE_NAME_HINTS),
      score
    };
  }

  const lowered = Array.from(distinct).map((v) => String(v).toLowerCase());
  if (distinctCount === 2 && lowered.every((v) => BOOLEAN_VALUES.has(v))) {
    return { ...base, type: "boolean", score: 1 };
  }

  const avgLength = present.reduce((s, v) => s + String(v).length, 0) / present.length;
  const avgWords = present.reduce((s, v) => s + String(v).trim().split(/\s+/).length, 0) / present.length;
  const looksLikeProse = avgWords >= 3 && avgLength >= 20;

  if (looksLikeProse && uniqueRatio > 0.5) return { ...base, type: "text" };
  if (looksIdName && uniqueRatio > 0.8) return { ...base, type: "identifier" };
  if (uniqueRatio > 0.85 && distinctCount > 40) return { ...base, type: "identifier" };

  if (distinctCount <= Math.max(40, Math.floor(rows.length * 0.3))) {
    let score = 2;
    if (distinctCount <= 8) score += 2;
    else if (distinctCount <= 20) score += 1;
    if (blankRate > 0.2) score -= 1;
    return { ...base, type: "category", score };
  }

  return { ...base, type: "text" };
}

function profileDataset(columns, rows) {
  return columns
    .filter((c) => String(c).trim() !== "")
    .map((c) => profileColumn(rows, c));
}

function pickBest(profiles, type) {
  const candidates = profiles.filter((p) => p.type === type);
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => b.score - a.score)[0];
}

function planDashboard(profiles, rows) {
  const dateCol = pickBest(profiles, "date");
  const measures = profiles.filter((p) => p.type === "number").sort((a, b) => b.score - a.score);
  const measure = measures[0] || null;
  const dimensions = profiles
    .filter((p) => p.type === "category" || p.type === "boolean")
    .sort((a, b) => b.score - a.score);

  const blocks = [];

  if (dateCol && measure && dateCol.monthsSpanned >= 2) {
    blocks.push({ kind: "trend", date: dateCol.name, measure: measure.name, hero: true });
  } else if (dateCol && dateCol.monthsSpanned >= 2) {
    blocks.push({ kind: "volume", date: dateCol.name, hero: true });
  } else if (measure) {
    blocks.push({ kind: "distribution", measure: measure.name, hero: true });
  } else if (dimensions.length > 0) {
    blocks.push({ kind: "breakdown", dimension: dimensions[0].name, measure: null, hero: true });
  }

  const used = new Set(blocks.map((b) => b.dimension).filter(Boolean));

  for (const dim of dimensions) {
    if (blocks.length >= 5) break;
    if (used.has(dim.name)) continue;
    used.add(dim.name);

    if (dim.distinctCount <= 6) {
      blocks.push({ kind: "composition", dimension: dim.name, measure: measure ? measure.name : null });
    } else {
      blocks.push({ kind: "breakdown", dimension: dim.name, measure: measure ? measure.name : null });
    }
  }

  if (measure && !blocks.some((b) => b.kind === "distribution") && blocks.length < 6) {
    blocks.push({ kind: "distribution", measure: measure.name });
  }

  if (measures.length >= 2 && blocks.length < 6) {
    blocks.push({ kind: "compare", measures: measures.slice(0, 2).map((m) => m.name) });
  }

  const issues = [];
  for (const p of profiles) {
    if (p.type === "empty") issues.push(`"${p.name}" is completely empty.`);
    else if (p.type === "constant") issues.push(`"${p.name}" is the same value in every row.`);
    else if (p.blankRate >= 0.25) issues.push(`"${p.name}" is ${Math.round(p.blankRate * 100)}% blank.`);
  }

  return {
    date: dateCol ? dateCol.name : null,
    measure: measure ? measure.name : null,
    dimensions: dimensions.map((d) => d.name),
    blocks,
    issues,
    rowCount: rows.length
  };
}

function buildKpis(profiles, plan, rows) {
  const kpis = [{ label: "Rows", value: rows.length.toLocaleString(), tone: "navy" }];

  const measure = profiles.find((p) => p.name === plan.measure);
  if (measure) {
    if (measure.summable) {
      kpis.push({ label: `Total ${measure.name}`, value: formatCompact(measure.sum), tone: "blue" });
    }
    kpis.push({ label: `Average ${measure.name}`, value: formatCompact(measure.mean), tone: "slate" });
  }

  const firstDim = profiles.find((p) => p.name === plan.dimensions[0]);
  if (firstDim) {
    kpis.push({ label: `Distinct ${firstDim.name}`, value: firstDim.distinctCount.toLocaleString(), tone: "amber" });
  }

  const dateProfile = profiles.find((p) => p.name === plan.date);
  if (dateProfile && dateProfile.monthsSpanned) {
    kpis.push({ label: "Months covered", value: String(dateProfile.monthsSpanned), tone: "emerald" });
  }

  const worst = profiles.slice().sort((a, b) => b.blankRate - a.blankRate)[0];
  if (worst && worst.blankRate > 0) {
    kpis.push({ label: "Most blank column", value: `${Math.round(worst.blankRate * 100)}%`, tone: "red" });
  }

  return kpis.slice(0, 6);
}

function formatCompact(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  if (abs >= 10) return n.toFixed(0);
  return n.toFixed(2);
}

function aggregateBy(rows, dimension, measure, limit = 12) {
  const groups = new Map();

  for (const row of rows) {
    const raw = row[dimension];
    const key = profileIsBlank(raw) ? "(blank)" : String(raw);
    const entry = groups.get(key) || { total: 0, count: 0 };
    if (measure) {
      const n = profileToNumber(row[measure]);
      if (n !== null) entry.total += n;
    }
    entry.count += 1;
    groups.set(key, entry);
  }

  const list = Array.from(groups.entries()).map(([label, v]) => ({
    label,
    value: measure ? v.total : v.count
  }));

  list.sort((a, b) => b.value - a.value);
  if (list.length <= limit) return list;

  const top = list.slice(0, limit - 1);
  const rest = list.slice(limit - 1).reduce((s, r) => s + r.value, 0);
  top.push({ label: `Other (${list.length - limit + 1})`, value: rest });
  return top;
}

function aggregateByMonth(rows, dateColumn, measure) {
  const groups = new Map();

  for (const row of rows) {
    const d = profileToDate(row[dateColumn]);
    if (!d) continue;
    const key = monthKey(d);
    const entry = groups.get(key) || { total: 0, count: 0 };
    if (measure) {
      const n = profileToNumber(row[measure]);
      if (n !== null) entry.total += n;
    }
    entry.count += 1;
    groups.set(key, entry);
  }

  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, v]) => ({ label, value: measure ? v.total : v.count }));
}
