const PARSE_AGGREGATIONS = [
  { words: ["distinct count", "unique count", "count of distinct", "number of unique", "how many unique", "how many different"], value: "distinct count" },
  { words: ["average", "avg", "mean"], value: "average" },
  { words: ["count", "number of", "how many", "tally"], value: "count" },
  { words: ["minimum", "min", "lowest", "smallest"], value: "min" },
  { words: ["maximum", "max", "highest", "largest", "biggest"], value: "max" },
  { words: ["total", "sum", "sum of"], value: "sum" }
];

const PARSE_KINDS = [
  { words: ["scatter", "against", " vs ", "versus", "correlation", "compared with"], value: "scatter" },
  { words: ["donut", "doughnut", "pie", "share of", "share by", "split of", "split by", "proportion", "percentage of", "make up"], value: "donut" },
  { words: ["table", "list of", "listing", "grid"], value: "table" },
  { words: ["trend", "over time", "by month", "by week", "by day", "by quarter", "by year", "monthly", "weekly", "daily", "quarterly", "yearly", "line chart", "time series", "history"], value: "trend" },
  { words: ["bar chart", "horizontal bar", "ranked", "ranking", "leaderboard"], value: "bar" },
  { words: ["kpi", "tile", "headline", "single number", "big number", "card"], value: "kpi" },
  { words: ["column chart", "bar", "column", "breakdown", "broken down", "chart"], value: "column" }
];

const PARSE_GRAINS = [
  { words: ["by day", "daily", "per day"], value: "day" },
  { words: ["by week", "weekly", "per week"], value: "week" },
  { words: ["by quarter", "quarterly", "per quarter"], value: "quarter" },
  { words: ["by year", "yearly", "annually", "per year"], value: "year" },
  { words: ["by month", "monthly", "per month"], value: "month" }
];

const PARSE_SLICER_WORDS = ["slicer", "slice by", "filter by", "filter on", "let me filter", "able to filter", "control for", "selector"];

const PARSE_STOP_WORDS = new Set([
  "a", "an", "the", "of", "for", "with", "show", "me", "add", "want", "please", "and",
  "chart", "graph", "visual", "tile", "card", "plot", "each", "every", "all", "give", "i",
  "see", "view", "display", "put", "make", "create", "build", "then", "also", "my", "our"
]);

function parseNormalizeText(text) {
  return ` ${String(text || "").toLowerCase().replace(/[^a-z0-9%$_ -]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function parseSplitClauses(text) {
  return String(text || "")
    .split(/[\n;]+|,(?=\s*(?:and\s+)?[a-z])|\band then\b|\balso\b/i)
    .map((c) => c.replace(/^\s*(?:and|then|also|plus)\s+/i, "").trim())
    .filter((c) => c.length > 1);
}

function parseMatchFirst(haystack, table) {
  let best = null;
  let bestIndex = Infinity;

  for (const entry of table) {
    for (const word of entry.words) {
      const index = haystack.indexOf(word.trim().length === word.length ? ` ${word} ` : word);
      const found = index === -1 ? haystack.indexOf(word) : index;
      if (found !== -1 && found < bestIndex) {
        bestIndex = found;
        best = entry.value;
      }
    }
  }

  return best;
}

function parseColumnScore(phrase, column) {
  const target = String(column).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (target === "") return 0;
  if (phrase.includes(` ${target} `)) return 1 + target.length / 100;

  const compact = target.replace(/\s+/g, "");
  if (compact.length > 3 && phrase.replace(/\s+/g, "").includes(compact)) return 0.95;

  const tokens = target.split(" ").filter((t) => t.length > 2);
  if (tokens.length > 0 && tokens.every((t) => phrase.includes(` ${t} `))) return 0.9;

  if (typeof similarity === "function") {
    const words = phrase.trim().split(" ").filter((w) => w.length > 2 && !PARSE_STOP_WORDS.has(w));
    let best = 0;
    for (const word of words) {
      const score = similarity(word, target);
      if (score > best) best = score;
    }
    if (best >= 0.82) return best * 0.85;
  }

  return 0;
}

function parseFindColumn(phrase, columns, exclude) {
  let best = null;
  let bestScore = 0;

  for (const column of columns) {
    if (exclude && exclude.includes(column)) continue;
    const score = parseColumnScore(phrase, column);
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }

  return bestScore >= 0.6 ? best : null;
}

function parseAfterKeyword(phrase, keywords) {
  for (const keyword of keywords) {
    const index = phrase.indexOf(` ${keyword} `);
    if (index !== -1) return phrase.slice(index + keyword.length + 1);
  }
  return "";
}

function parseLimit(phrase) {
  const match = phrase.match(/\b(?:top|first|best|bottom)\s+(\d{1,2})\b/);
  return match ? Math.min(50, Math.max(3, Number(match[1]))) : null;
}

function parseClauseToVisual(clause, catalogue, index) {
  const phrase = parseNormalizeText(clause);
  const measures = catalogue.measureColumns.length ? catalogue.measureColumns : catalogue.columns;
  const dimensions = catalogue.dimensionColumns.length ? catalogue.dimensionColumns : catalogue.columns;

  const ranked = phrase.match(/\b(?:top|bottom|first|best)\s+\d{1,2}\s+(.+?)\s+by\s+(.+)/);

  let dimension;
  let measure;

  if (ranked) {
    dimension = parseFindColumn(` ${ranked[1]} `, dimensions) || parseFindColumn(` ${ranked[1]} `, catalogue.columns);
    measure = parseFindColumn(` ${ranked[2]} `, measures, dimension ? [dimension] : null)
      || parseFindColumn(` ${ranked[2]} `, catalogue.columns, dimension ? [dimension] : null);
  } else {
    const dimensionPhrase = parseAfterKeyword(phrase, ["by", "per", "across", "split by", "grouped by"]);
    dimension = dimensionPhrase ? parseFindColumn(` ${dimensionPhrase} `, dimensions) : null;
    measure = parseFindColumn(phrase, measures, dimension ? [dimension] : null)
      || parseFindColumn(phrase, catalogue.columns, dimension ? [dimension] : null);
  }

  let kind = parseMatchFirst(phrase, PARSE_KINDS);
  const aggregation = parseMatchFirst(phrase, PARSE_AGGREGATIONS) || "sum";
  const grain = parseMatchFirst(phrase, PARSE_GRAINS);

  if (!kind) {
    if (grain) kind = "trend";
    else if (dimension) kind = "column";
    else if (measure) kind = "kpi";
  }

  if (kind === "trend") dimension = null;
  if (kind === "kpi" && dimension && !parseMatchFirst(phrase, [{ words: ["kpi", "tile", "total", "single"], value: "kpi" }])) {
    kind = "column";
  }

  if (!measure && !dimension) return null;

  const resolvedMeasure = measure || catalogue.columns[0];
  const resolvedDimension = dimension || dimensions[0] || catalogue.columns[0];
  const limit = parseLimit(phrase);

  const second = kind === "scatter"
    ? parseFindColumn(parseAfterKeyword(phrase, ["against", "vs", "versus", "compared with"]) || phrase, measures, [resolvedMeasure])
    : null;

  return {
    id: `v${index + 1}`,
    kind: kind || "column",
    title: "",
    width: DASHBOARD_VISUAL_KINDS[kind || "column"].defaultWidth,
    binding: {
      source: catalogue.source || "",
      measure: resolvedMeasure,
      aggregation: kind === "count" ? "count" : aggregation,
      dimension: resolvedDimension,
      measure2: second || measures[1] || resolvedMeasure,
      grain: grain || "month",
      limit: limit || 8,
      filters: []
    }
  };
}

function parseClauseToSlicer(clause, catalogue, index) {
  const phrase = parseNormalizeText(clause);
  const after = parseAfterKeyword(phrase, ["by", "on", "for"]);
  const field = parseFindColumn(after ? ` ${after} ` : phrase, catalogue.columns);
  if (!field) return null;

  const numeric = catalogue.measureColumns.includes(field);
  const isDate = catalogue.dateColumn === field;

  return {
    id: `s${index + 1}`,
    field,
    label: field,
    type: isDate ? "date range" : numeric ? "range" : "dropdown",
    width: "quarter"
  };
}

function parseVisualTitle(visual) {
  const b = visual.binding;
  const measure = b.measure;

  if (visual.kind === "kpi") {
    if (b.aggregation === "count") return `Number of ${measure}`;
    if (b.aggregation === "distinct count") return `Distinct ${measure}`;
    if (b.aggregation === "average") return `Average ${measure}`;
    return `Total ${measure}`;
  }
  if (visual.kind === "trend") return `${measure} over time`;
  if (visual.kind === "scatter") return `${measure} against ${b.measure2}`;
  if (visual.kind === "donut") return `Share of ${measure} by ${b.dimension}`;
  return `${measure} by ${b.dimension}`;
}

function parseDashboardInstructions(text, catalogue) {
  const source = catalogue && catalogue.columns && catalogue.columns.length
    ? catalogue
    : { columns: [], measureColumns: [], dimensionColumns: [], dateColumn: null };

  const clauses = parseSplitClauses(text);
  const visuals = [];
  const slicers = [];
  const unmatched = [];

  for (const clause of clauses) {
    const phrase = parseNormalizeText(clause);
    const isSlicer = PARSE_SLICER_WORDS.some((w) => phrase.includes(w));

    if (isSlicer) {
      const slicer = parseClauseToSlicer(clause, source, slicers.length);
      if (slicer) slicers.push(slicer);
      else unmatched.push(clause);
      continue;
    }

    const visual = parseClauseToVisual(clause, source, visuals.length);
    if (visual) {
      visual.title = parseVisualTitle(visual);
      visuals.push(visual);
    } else {
      unmatched.push(clause);
    }
  }

  return { visuals, slicers, unmatched, clauseCount: clauses.length };
}
