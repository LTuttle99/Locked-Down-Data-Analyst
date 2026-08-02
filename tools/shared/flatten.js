function flattenValue(value, prefix, out) {
  if (value === null || value === undefined) {
    out[prefix] = "";
    return;
  }

  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) {
      out[prefix] = value.join("; ");
    } else {
      value.forEach((v, i) => flattenValue(v, `${prefix}[${i}]`, out));
    }
    return;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flattenValue(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }

  out[prefix] = value;
}

function flattenRecord(record) {
  const out = {};
  flattenValue(record, "", out);

  const keys = Object.keys(out);
  if (keys.length === 1 && keys[0] === "") return { value: out[""] };
  return out;
}

function unionColumns(rows) {
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}
