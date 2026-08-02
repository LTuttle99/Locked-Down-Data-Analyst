const BUSINESS_SUFFIXES = new Set([
  "corp", "corporation", "inc", "incorporated", "ltd", "limited", "llc", "llp",
  "plc", "co", "company", "gmbh", "sa", "nv", "bv", "ag", "pty", "group", "holdings"
]);

function normalizeForMatch(value, stripSuffixes) {
  if (value === null || value === undefined) return "";

  let s = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (stripSuffixes) {
    const tokens = s.split(" ");
    while (tokens.length > 1 && BUSINESS_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
    s = tokens.join(" ");
  }

  return s;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Uint32Array(b.length + 1);
  let curr = new Uint32Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[b.length];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}
