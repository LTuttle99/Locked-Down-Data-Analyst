function statsIsBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function statsToNumber(v) {
  if (statsIsBlank(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statsMean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function statsMedian(sorted) {
  if (!sorted || sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function statsStdDev(arr, m) {
  if (!arr || arr.length < 2) return 0;
  const avg = m === undefined ? statsMean(arr) : m;
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function statsPercentile(sorted, p) {
  if (!sorted || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];

  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function statsHistogram(sorted, buckets = 12) {
  if (!sorted || sorted.length === 0) return [];

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return [sorted.length];

  const counts = new Array(buckets).fill(0);
  const width = (max - min) / buckets;

  for (const v of sorted) {
    let idx = Math.floor((v - min) / width);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }

  return counts;
}
