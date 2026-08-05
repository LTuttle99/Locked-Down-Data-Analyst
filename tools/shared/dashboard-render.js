const DASHBOARD_WIDTH_CLASSES = {
  quarter: "md:col-span-3",
  half: "md:col-span-6",
  full: "md:col-span-12"
};

function dashboardElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function dashboardChartOptions(extra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: "#475569", font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#475569", font: { size: 10 } }, grid: { color: "#e2e8f0" }, beginAtZero: true }
    }
  }, extra || {});
}

function dashboardFade(hex, alpha) {
  const clean = /^#[0-9a-fA-F]{6}$/.test(String(hex)) ? String(hex) : "#0062F1";
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function dashboardDrawKpi(host, visual, data, showDelta, palette) {
  const wrap = dashboardElement("div", "flex-1 flex flex-col justify-center min-h-[4rem]");

  const text = dashboardFormatValue(data.value, visual.binding.measure, visual.binding.aggregation, dashboardBindingFormat(visual.binding));
  const size = text.length > 12 ? "text-xl" : text.length > 8 ? "text-2xl" : "text-3xl";

  const big = dashboardElement("p", `${size} font-bold leading-tight break-words`, text);
  big.style.color = palette[0];
  wrap.appendChild(big);

  if (showDelta) {
    const delta = data.delta;
    const tone = delta >= 0 ? "text-emerald-600" : "text-red-600";
    const arrow = delta >= 0 ? "▲" : "▼";
    wrap.appendChild(dashboardElement("p", `text-xs font-medium mt-1 ${tone}`,
      `${arrow} ${Math.abs(delta * 100).toFixed(1)}% vs prior period`));
  }

  host.appendChild(wrap);
}

function dashboardDrawTable(host, visual, data) {
  const scroller = dashboardElement("div", "overflow-x-auto");
  const table = dashboardElement("table", "w-full text-left text-xs");

  const thead = dashboardElement("thead");
  const headRow = dashboardElement("tr", "border-b border-slate-200 text-slate-600 uppercase");
  headRow.appendChild(dashboardElement("th", "py-2 pr-3 font-semibold", visual.binding.dimension));
  headRow.appendChild(dashboardElement("th", "py-2 pl-3 font-semibold text-right", visual.binding.measure));
  thead.appendChild(headRow);

  const tbody = dashboardElement("tbody", "divide-y divide-slate-100");
  for (const point of data.points) {
    const row = dashboardElement("tr");
    row.appendChild(dashboardElement("td", "py-2 pr-3 text-slate-700", point.label));
    row.appendChild(dashboardElement("td", "py-2 pl-3 text-right text-slate-900 font-medium",
      dashboardFormatValue(point.value, visual.binding.measure, visual.binding.aggregation, dashboardBindingFormat(visual.binding))));
    tbody.appendChild(row);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  scroller.appendChild(table);
  host.appendChild(scroller);
}

function dashboardDrawDetails(host, visual, data) {
  const scroller = dashboardElement("div", "overflow-auto max-h-80 flex-1");
  const table = dashboardElement("table", "w-full text-left text-xs");

  const thead = dashboardElement("thead", "sticky top-0 bg-white");
  const headRow = dashboardElement("tr", "border-b border-slate-200 text-slate-600 uppercase");
  for (const column of data.columns) {
    headRow.appendChild(dashboardElement("th", "py-2 pr-3 font-semibold whitespace-nowrap", column));
  }
  thead.appendChild(headRow);

  const tbody = dashboardElement("tbody", "divide-y divide-slate-100");
  for (const row of data.rows) {
    const tr = dashboardElement("tr");
    for (const column of data.columns) {
      const raw = row[column];
      const value = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw;
      tr.appendChild(dashboardElement("td", "py-1.5 pr-3 text-slate-700 whitespace-nowrap",
        value === null || value === undefined || value === "" ? "" : String(value)));
    }
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  scroller.appendChild(table);
  host.appendChild(scroller);

  if (data.total > data.rows.length) {
    host.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-2 shrink-0",
      `Showing ${data.rows.length.toLocaleString()} of ${data.total.toLocaleString()} rows.`));
  }
}

function dashboardDrawChart(host, visual, data, charts, palette) {
  const frame = dashboardElement("div", visual.width === "full" ? "h-72" : "h-56");
  const canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  host.appendChild(frame);

  if (typeof Chart === "undefined") return;

  const measure = visual.binding.measure;
  const aggregation = visual.binding.aggregation;
  const format = dashboardBindingFormat(visual.binding);
  const tick = (value) => dashboardFormatValue(value, measure, aggregation, format);

  if (visual.kind === "trend") {
    charts.push(new Chart(canvas, {
      type: "line",
      data: {
        labels: data.points.map((p) => p.label),
        datasets: [{
          data: data.points.map((p) => p.value),
          borderColor: palette[0],
          backgroundColor: dashboardFade(palette[0], 0.12),
          fill: true,
          tension: 0.3,
          pointRadius: data.points.length > 20 ? 0 : 3
        }]
      },
      options: dashboardChartOptions({
        scales: {
          x: { ticks: { color: "#475569", font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { ticks: { color: "#475569", font: { size: 10 }, callback: tick }, grid: { color: "#e2e8f0" }, beginAtZero: true }
        }
      })
    }));
    return;
  }

  if (visual.kind === "donut") {
    charts.push(new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: data.points.map((p) => p.label),
        datasets: [{
          data: data.points.map((p) => p.value),
          backgroundColor: data.points.map((_, i) => palette[i % palette.length]),
          borderColor: "#ffffff",
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: { legend: { display: true, position: "right", labels: { boxWidth: 12, font: { size: 10 } } } }
      }
    }));
    return;
  }

  if (visual.kind === "scatter") {
    charts.push(new Chart(canvas, {
      type: "scatter",
      data: { datasets: [{ data: data.points, backgroundColor: dashboardFade(palette[0], 0.45), pointRadius: 3 }] },
      options: dashboardChartOptions({
        scales: {
          x: { title: { display: true, text: visual.binding.measure, font: { size: 10 } }, ticks: { color: "#475569", font: { size: 10 } }, grid: { color: "#f1f5f9" } },
          y: { title: { display: true, text: visual.binding.measure2, font: { size: 10 } }, ticks: { color: "#475569", font: { size: 10 } }, grid: { color: "#e2e8f0" } }
        }
      })
    }));
    return;
  }

  const horizontal = visual.kind === "bar";
  charts.push(new Chart(canvas, {
    type: "bar",
    data: {
      labels: data.points.map((p) => p.label),
      datasets: [{ data: data.points.map((p) => p.value), backgroundColor: palette[0], borderRadius: 4 }]
    },
    options: dashboardChartOptions({
      indexAxis: horizontal ? "y" : "x",
      scales: horizontal
        ? {
            x: { ticks: { color: "#475569", font: { size: 10 }, callback: tick }, grid: { color: "#e2e8f0" }, beginAtZero: true },
            y: { ticks: { color: "#475569", font: { size: 10 } }, grid: { display: false } }
          }
        : {
            x: { ticks: { color: "#475569", font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: "#475569", font: { size: 10 }, callback: tick }, grid: { color: "#e2e8f0" }, beginAtZero: true }
          }
    })
  }));
}

function dashboardRenderVisual(visual, options, charts) {
  const card = dashboardElement("div", `bg-white border border-slate-200 rounded-xl p-4 col-span-12 flex flex-col overflow-hidden ${DASHBOARD_WIDTH_CLASSES[visual.width] || DASHBOARD_WIDTH_CLASSES.half}`);

  const head = dashboardElement("div", "mb-3 shrink-0");
  const heading = dashboardElement("h3", "text-sm font-semibold text-[#00133C] leading-snug break-words", visual.title);
  heading.title = visual.title;
  head.appendChild(heading);
  if (options.showCaptions) {
    head.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-0.5", dashboardBindingSummary(visual)));
  }
  card.appendChild(head);

  const data = typeof dashboardResolveVisual === "function"
    ? dashboardResolveVisual(visual, options.dataset)
    : dashboardResolveSample(visual);

  if (data.empty) {
    card.appendChild(dashboardElement("div", "text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center", data.empty));
  } else if (visual.kind === "kpi") {
    dashboardDrawKpi(card, visual, data, options.showDeltas, options.palette);
  } else if (visual.kind === "table") {
    dashboardDrawTable(card, visual, data);
  } else if (visual.kind === "details") {
    dashboardDrawDetails(card, visual, data);
  } else {
    dashboardDrawChart(card, visual, data, charts, options.palette);
  }

  if (visual.notes && options.showNotes) {
    card.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100", visual.notes));
  }

  return card;
}

function dashboardSlicerControl(slicer, dataset, onChange) {
  const wrap = dashboardElement("div", `col-span-12 ${DASHBOARD_WIDTH_CLASSES[slicer.width] || DASHBOARD_WIDTH_CLASSES.quarter}`);
  wrap.appendChild(dashboardElement("label", "block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1", slicer.label));

  const rows = (dataset && dataset.rows) || [];
  const options = typeof dashboardSlicerOptions === "function" && rows.length
    ? dashboardSlicerOptions(rows, slicer)
    : { values: [], empty: true };
  const selections = dataset.selections || {};

  if (options.empty) {
    wrap.appendChild(dashboardElement("p", "text-[11px] text-slate-400 italic", "No values available"));
    return wrap;
  }

  if (slicer.type === "range" || slicer.type === "date range") {
    const isDate = slicer.type === "date range";
    const current = selections[slicer.id] || { min: options.min, max: options.max };
    const step = isDate ? 86400000 : Math.max(1, (options.max - options.min) / 100);

    const describe = (v) => (isDate
      ? new Date(v).toISOString().slice(0, 10)
      : dashboardFormatValue(v, slicer.field, "sum"));

    const readout = dashboardElement("p", "text-[11px] text-slate-600 mt-1", "");

    const makeHandle = (value) => {
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(options.min);
      input.max = String(options.max);
      input.step = String(step);
      input.value = String(value);
      input.className = "w-full accent-[#0062F1]";
      return input;
    };

    const lower = makeHandle(Math.max(options.min, Math.min(current.min, options.max)));
    const upper = makeHandle(Math.min(options.max, Math.max(current.max, options.min)));

    const bounds = () => {
      const a = Number(lower.value);
      const b = Number(upper.value);
      return { min: Math.min(a, b), max: Math.max(a, b) };
    };

    const paint = () => {
      const { min, max } = bounds();
      readout.textContent = `${describe(min)} to ${describe(max)}`;
    };

    const commit = () => {
      const { min, max } = bounds();
      const whole = min <= options.min && max >= options.max;
      onChange(slicer.id, whole ? "" : { min, max });
    };

    for (const handle of [lower, upper]) {
      handle.addEventListener("input", paint);
      handle.addEventListener("change", commit);
    }

    paint();

    const stack = dashboardElement("div", "flex flex-col gap-0.5");
    const fromRow = dashboardElement("div", "flex items-center gap-2");
    fromRow.appendChild(dashboardElement("span", "text-[10px] text-slate-400 w-8 shrink-0", "From"));
    fromRow.appendChild(lower);
    const toRow = dashboardElement("div", "flex items-center gap-2");
    toRow.appendChild(dashboardElement("span", "text-[10px] text-slate-400 w-8 shrink-0", "To"));
    toRow.appendChild(upper);

    stack.appendChild(fromRow);
    stack.appendChild(toRow);
    wrap.appendChild(stack);
    wrap.appendChild(readout);
    return wrap;
  }

  if (slicer.type === "list") {
    const list = dashboardElement("div", "flex flex-wrap gap-1.5 max-h-28 overflow-y-auto");
    const chosen = new Set(Array.isArray(selections[slicer.id]) ? selections[slicer.id] : []);

    for (const value of options.values) {
      const active = chosen.has(value);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = value;
      chip.className = `text-[11px] rounded-full px-2.5 py-1 border transition-colors ${active
        ? "bg-[#0062F1] border-[#0062F1] text-white"
        : "bg-white border-slate-300 text-slate-600 hover:border-[#0062F1]"}`;
      chip.addEventListener("click", () => {
        if (active) chosen.delete(value);
        else chosen.add(value);
        onChange(slicer.id, Array.from(chosen));
      });
      list.appendChild(chip);
    }

    wrap.appendChild(list);
    return wrap;
  }

  const select = document.createElement("select");
  select.className = "w-full bg-white border border-slate-300 rounded-lg text-xs p-2 text-slate-900";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All";
  select.appendChild(all);

  for (const value of options.values) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if (selections[slicer.id] === value) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => onChange(slicer.id, select.value));
  wrap.appendChild(select);
  return wrap;
}

function dashboardRenderSlicers(spec, container, dataset, rerender) {
  if (spec.slicers.length === 0) return;

  const bar = dashboardElement("div", "bg-white border border-slate-200 rounded-xl p-4 mb-4");
  const grid = dashboardElement("div", "grid grid-cols-12 gap-4");

  const onChange = (id, value) => {
    dataset.selections = Object.assign({}, dataset.selections, { [id]: value });
    rerender();
  };

  for (const slicer of spec.slicers) grid.appendChild(dashboardSlicerControl(slicer, dataset, onChange));

  bar.appendChild(grid);

  const hasSelection = Object.values(dataset.selections || {}).some((v) => v !== "" && v !== null && v !== undefined && (!Array.isArray(v) || v.length > 0));
  if (hasSelection) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Clear all";
    reset.className = "text-[11px] text-slate-500 hover:text-[#0062F1] font-medium mt-3";
    reset.addEventListener("click", () => {
      dataset.selections = {};
      rerender();
    });
    bar.appendChild(reset);
  }

  container.appendChild(bar);
}

function dashboardRenderSpec(spec, container, options = {}) {
  const settings = Object.assign(
    { showNotes: true, showHeader: true, showFooter: true },
    { showCaptions: spec.showCaptions !== false, showDeltas: spec.showDeltas !== false },
    { palette: dashboardPaletteFor(spec) },
    options
  );
  const charts = [];

  if (settings.dataset) settings.dataset.slicers = spec.slicers;

  const visuals = typeof dashboardEffectiveBinding === "function"
    ? spec.visuals.map((v) => Object.assign({}, v, { binding: dashboardEffectiveBinding(v, spec) }))
    : spec.visuals;

  container.textContent = "";

  if (settings.showHeader) {
    const header = dashboardElement("div", "mb-5");
    header.appendChild(dashboardElement("h1", "text-2xl font-semibold text-[#00133C]", spec.title));
    if (spec.subtitle) header.appendChild(dashboardElement("p", "text-sm text-slate-600 mt-1 max-w-3xl", spec.subtitle));

    const meta = dashboardElement("div", "flex flex-wrap gap-2 mt-3");
    const chips = [];
    if (spec.requester) chips.push(`Requested by ${spec.requester}`);
    if (spec.audience) chips.push(`For ${spec.audience}`);
    chips.push(`Refresh ${spec.refresh}`);
    chips.push(`Drafted ${spec.created}`);
    for (const chip of chips) {
      meta.appendChild(dashboardElement("span", "text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1", chip));
    }
    header.appendChild(meta);
    container.appendChild(header);
  }

  if (settings.dataset && spec.slicers.length > 0) {
    dashboardRenderSlicers(spec, container, settings.dataset, () => {
      for (const chart of charts) chart.destroy();
      dashboardRenderSpec(spec, container, settings);
    });
  }

  if (visuals.length === 0) {
    container.appendChild(dashboardElement("div", "bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500",
      "No visuals yet. Add one to see the dashboard take shape."));
    return charts;
  }

  const grid = dashboardElement("div", "grid grid-cols-12 gap-4");
  for (const visual of visuals) grid.appendChild(dashboardRenderVisual(visual, settings, charts));
  container.appendChild(grid);

  if (settings.showFooter) {
    const dataset = settings.dataset;
    const note = dataset && (dataset.baked || (dataset.rows && dataset.rows.length))
      ? `Built from ${dataset.source || "an uploaded file"}${dataset.rowCount ? `, ${dataset.rowCount.toLocaleString()} rows` : ""}${dataset.bakedAt ? `, as at ${dataset.bakedAt}` : ""}.`
      : "Figures shown are placeholder values generated from the requested shape, not real data. They are stable for a given link, so the layout can be reviewed before real data is attached.";
    container.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-5 pt-4 border-t border-slate-200", note));
  }

  return charts;
}
