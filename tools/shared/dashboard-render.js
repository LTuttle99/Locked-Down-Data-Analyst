const DASHBOARD_PALETTE = ["#0062F1", "#00133C", "#DC6803", "#059669", "#7C3AED", "#DB2777", "#0891B2", "#CA8A04", "#65A30D", "#E11D48"];

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

function dashboardDrawKpi(host, visual, data) {
  const wrap = dashboardElement("div", "flex flex-col justify-center h-full");
  wrap.appendChild(dashboardElement("p", "text-3xl font-bold text-[#00133C] leading-tight",
    dashboardFormatValue(data.value, visual.binding.measure, visual.binding.aggregation)));

  const delta = data.delta;
  const tone = delta >= 0 ? "text-emerald-600" : "text-red-600";
  const arrow = delta >= 0 ? "▲" : "▼";
  wrap.appendChild(dashboardElement("p", `text-xs font-medium mt-1 ${tone}`,
    `${arrow} ${Math.abs(delta * 100).toFixed(1)}% vs prior period`));

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
      dashboardFormatValue(point.value, visual.binding.measure, visual.binding.aggregation)));
    tbody.appendChild(row);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  scroller.appendChild(table);
  host.appendChild(scroller);
}

function dashboardDrawChart(host, visual, data, charts) {
  const frame = dashboardElement("div", visual.width === "full" ? "h-72" : "h-56");
  const canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  host.appendChild(frame);

  if (typeof Chart === "undefined") return;

  const measure = visual.binding.measure;
  const aggregation = visual.binding.aggregation;
  const tick = (value) => dashboardFormatValue(value, measure, aggregation);

  if (visual.kind === "trend") {
    charts.push(new Chart(canvas, {
      type: "line",
      data: {
        labels: data.points.map((p) => p.label),
        datasets: [{
          data: data.points.map((p) => p.value),
          borderColor: DASHBOARD_PALETTE[0],
          backgroundColor: "rgba(0,98,241,0.12)",
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
          backgroundColor: data.points.map((_, i) => DASHBOARD_PALETTE[i % DASHBOARD_PALETTE.length]),
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
      data: { datasets: [{ data: data.points, backgroundColor: "rgba(0,98,241,0.45)", pointRadius: 3 }] },
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
      datasets: [{ data: data.points.map((p) => p.value), backgroundColor: DASHBOARD_PALETTE[0], borderRadius: 4 }]
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
  const card = dashboardElement("div", `bg-white border border-slate-200 rounded-xl p-4 col-span-12 ${DASHBOARD_WIDTH_CLASSES[visual.width] || DASHBOARD_WIDTH_CLASSES.half}`);

  const head = dashboardElement("div", "mb-3");
  head.appendChild(dashboardElement("h3", "text-sm font-semibold text-[#00133C] leading-snug", visual.title));
  head.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-0.5", dashboardBindingSummary(visual)));
  card.appendChild(head);

  const data = dashboardResolveSample(visual);

  if (visual.kind === "kpi") dashboardDrawKpi(card, visual, data);
  else if (visual.kind === "table") dashboardDrawTable(card, visual, data);
  else dashboardDrawChart(card, visual, data, charts);

  if (visual.notes && options.showNotes) {
    card.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100", visual.notes));
  }

  return card;
}

function dashboardRenderSpec(spec, container, options = {}) {
  const settings = Object.assign({ showNotes: true, showHeader: true, showFooter: true }, options);
  const charts = [];

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

  if (spec.visuals.length === 0) {
    container.appendChild(dashboardElement("div", "bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500",
      "No visuals yet. Add one to see the dashboard take shape."));
    return charts;
  }

  const grid = dashboardElement("div", "grid grid-cols-12 gap-4");
  for (const visual of spec.visuals) grid.appendChild(dashboardRenderVisual(visual, settings, charts));
  container.appendChild(grid);

  if (settings.showFooter) {
    container.appendChild(dashboardElement("p", "text-[11px] text-slate-500 mt-5 pt-4 border-t border-slate-200",
      "Figures shown are placeholder values generated from the requested shape, not real data. They are stable for a given link so the layout can be reviewed and signed off before the data feed is connected."));
  }

  return charts;
}
