# Data and Analytics Hub

A static, backend-free home page for the team's data tools. `index.html` at
the repo root is the hub landing page; each tool lives in its own folder
under `tools/`. The hub is built to grow: add a new folder under `tools/`
and a card on the landing page, and it's a new tool.

## Tools

| Tool | Folder | What it does |
|---|---|---|
| Data Analyzer | `tools/data-analyzer/` | KPIs, forecasting, goal pacing, anomaly detection, AI insights on uploaded CSV/Excel data |
| File Diff | `tools/file-diff/` | Compares two files by a key column — added / removed / changed rows |
| Pivot & Chart Explorer | `tools/pivot-explorer/` | Ad-hoc pivot table + chart on any file, no fixed schema |
| Data Cleaner | `tools/data-cleaner/` | Detects and fixes duplicate rows, blanks, messy headers |
| Format Converter | `tools/converter/` | Converts between CSV, Excel, and JSON |
| JSON Formatter | `tools/json-formatter/` | Validates, pretty-prints, and minifies JSON |
| Timestamp Converter | `tools/timestamp-converter/` | Unix/date conversion across timezones, ISO 8601, relative time |
| Column Statistics | `tools/column-stats/` | Per-column min/max/mean/median/stddev/nulls — instant data profiling, no mapping step |
| Instant Dashboard | `tools/instant-dashboard/` | Profiles any file and builds a dashboard shaped around what it finds, with no column mapping or setup |
| Dashboard Builder | `tools/dashboard-builder/` | Build a dashboard from your own file (visuals, measures, breakdowns, slicers) and download it as a single self-contained HTML page |
| SQL Workbench | `tools/sql-workbench/` | Load CSV/Excel/JSON files as tables and query them with standard SQLite, including joins across files |
| Lookup & Merge | `tools/lookup-merge/` | Match two files on a shared key and pull columns across, reporting unmatched rows |
| Fuzzy Duplicate Finder | `tools/fuzzy-dupes/` | Finds near-duplicate values that exact deduplication misses, with an adjustable similarity threshold |
| Chart Builder | `tools/chart-builder/` | Two columns to a bar/line/pie/scatter chart, downloadable as PNG |
| Test Data Generator | `tools/data-generator/` | Builds realistic sample files from a column spec, with a seed for repeatable output |
| Code Helper | `tools/code-helper/` | Snippets for common data tasks in Python, R, SQL, JavaScript, and Java, using your own column names |
| JWT Decoder | `tools/jwt-decoder/` | Decodes a JSON Web Token's header, payload, and expiry (does not verify signatures) |
| Regex Tester | `tools/regex-tester/` | Live-highlighted pattern matches and capture groups against sample text |
| Text Diff | `tools/text-diff/` | Line-level diff between two pasted blocks of text |
| Color Tools | `tools/color-tools/` | Shade palette generator from a base color, plus a WCAG contrast ratio checker |
| Text Analyzer | `tools/text-analyzer/` | Word/character/sentence counts, reading time, most frequent words |
| QR Code Generator | `tools/qr-generator/` | Text/URL to a downloadable QR code PNG (via the `qrcode-generator` CDN library) |
| Markdown Previewer | `tools/markdown-preview/` | Live-rendered Markdown with copy/download HTML (via the `marked` CDN library) |
| Base64 / URL Encoder | `tools/encode-decode/` | UTF-8 safe Base64 and URL encode/decode, chainable |
| Unit Converter | `tools/unit-converter/` | Length, weight, and temperature conversion with a quick reference table |

`tools/shared/parse.js` holds the CSV/Excel parsing and CSV/Excel/JSON
download helpers reused by every file-based tool (File Diff, Pivot Explorer,
Data Cleaner, Format Converter, Column Statistics, SQL Workbench). Data
Analyzer keeps its own copy in `tools/data-analyzer/js/core.js` so it stays
fully self-contained.

Excel parsing does three things before handing rows to a tool, so the same
messy export behaves the same everywhere:

- **Sheet picking.** A workbook with more than one sheet opens a picker
  listing every sheet with its row/column count, plus a "Combine all sheets"
  option that stacks them into one table and adds a `source_sheet` column.
  Single-sheet workbooks load straight through with no prompt. Callers can
  skip the prompt by passing `{ sheetName }` or `{ combineSheets: true }` to
  `parseFileToRows`.
- **Header row detection.** Exports that start with a title banner, a blank
  row, and a "generated on" stamp used to parse with those cells as the
  column names. `detectHeaderRowIndex` scans the first 15 rows and picks the
  one that actually looks like a header; everything above it is dropped, along
  with fully empty rows and columns. The result reports `skippedRows`.
- **Header uniquifying.** `uniquifyHeaders` guarantees every column name is
  distinct and non-empty. Two columns called `name` become `name` and
  `name_2`; a blank header becomes `column_3`. Previously the second column
  silently overwrote the first and its data disappeared.

`tools/shared/sql.js` wraps the SQLite engine (sql.js, compiled to
WebAssembly and loaded lazily from a CDN the first time a query runs). It
turns any set of parsed datasets into in-memory SQL tables. SQL Workbench
uses it directly; Data Analyzer has its own copy in
`tools/data-analyzer/js/sql-query.js` for the same self-containment reason.

Three more shared modules hold logic that used to be duplicated inside
individual tools, so it can be tested once rather than per tool:
`tools/shared/stats.js` (mean, median, standard deviation, percentiles,
histogram buckets), `tools/shared/match.js` (text normalization, business
suffix stripping, Levenshtein distance, similarity), and
`tools/shared/flatten.js` (nested JSON to flat rows).

`tools/shared/profile.js` holds the column profiling and dashboard planning
that Instant Dashboard runs on. It decides what each column actually is
(date, measure, category, identifier, free text) and which charts are worth
drawing for the shape it found.

Four modules make up Dashboard Builder. `tools/shared/dashboard-spec.js` owns
the dashboard format (version 1), normalizes it, encodes it to a URL-safe
string, and generates placeholder figures.
`tools/shared/dashboard-data.js` aggregates real rows against a binding and
applies filters and slicer selections. `tools/shared/dashboard-render.js` turns
a spec plus resolved data into slicer controls, KPI tiles and Chart.js visuals.
`tools/shared/dashboard-parse.js` turns typed instructions into visuals.
`tools/shared/sheet-connect.js` reads a Google Sheet from a pasted link and is
usable on its own by any tool that wants sheet input. See "Dashboard Builder"
below for how they fit together.

`tools/shared/sanitize.js` is an allowlist HTML sanitizer used by Markdown
Previewer. `marked` does not sanitize its output (the option was removed in
v5), so rendering a README from an untrusted source straight into `innerHTML`
would execute whatever script it carried, and Copy/Download HTML would pass it
on. `sanitizeHtml` parses into an inert `<template>`, keeps only known-good
tags and attributes, drops every event handler, and allows only `http`,
`https`, `mailto`, `tel`, `ftp`, relative, and anchor URLs (plus `data:` for
images only). Unknown tags are unwrapped so their text survives.

The purely text/paste-based tools (JSON Formatter, Timestamp Converter, Regex
Tester, Text Diff, Color Tools, Text Analyzer, Base64/URL Encoder, Unit
Converter, JWT Decoder) need no file parsing at all. Markdown Previewer is the
only text-based tool with an external dependency (`marked`), and it runs that
library's output through `tools/shared/sanitize.js` before rendering.

## Hub features

- **Search** — the search box on the landing page filters cards by name and
  description as you type; empty categories hide themselves automatically.
- **Command palette** — Ctrl+K (Cmd+K on Mac) opens a jump-to-tool box with
  arrow-key navigation. It only ever lists tools the current access code
  unlocks.
- **Recently used** — the last five tools opened appear as chips at the top of
  the hub, stored in `localStorage` under `hub_recent_tools` and filtered to
  the current code's tools. This is the one thing the hub remembers between
  visits; the access code itself is still never stored.
- **Categories** — tools are grouped into four sections by what you are trying
  to do: "Explore & Analyze", "Clean & Combine", "Generate & Encode", and
  "Text & Dev Utilities". Sections with no visible tools hide themselves.
- **Favicon** — every page (hub + all tools) shares the same navy/blue "H"
  favicon so browser tabs are recognizable.
- **"What's New in Data"** — a static card near the top linking out to
  [TLDR Data](https://tldr.tech). It's a plain link, not a live feed:
  newsletter platforms don't allow fetching their RSS/Atom feeds from browser
  JavaScript (no CORS support), and routing around that with a third-party
  proxy would mean this hub — which otherwise makes zero external network
  calls — pings a proxy server on every page load. Update the headline/blurb
  and `href` directly in the root `index.html` whenever you want to change
  what it points to.
- **Access code gate** — every visit (and every refresh) opens on a
  full-screen black keypad ("Enter Access Code") that covers the whole hub;
  nothing behind it is reachable until a valid numeric code is entered.
  Wrong codes shake and clear; there's no "skip" or "show all" control.
  Each code unlocks only the tools assigned to it — the `VIEW_CODES` object
  in the `<script>` at the bottom of the root `index.html` maps each code to
  a label and a list of `data-tool` ids (visible as a `data-tool="..."`
  attribute on every card in the HTML). Current codes:

  | Code | View | Tools |
  |---|---|---|
  | `1159` | Data Analyst | all 25 tools |
  | `7284` | Leadership | Data Analyzer, Instant Dashboard, Dashboard Builder, Pivot & Chart Explorer, Chart Builder |
  | `5931` | Marketing | QR Generator, Color Tools, Markdown Previewer, Text Analyzer, Chart Builder, Instant Dashboard, Dashboard Builder |
  | `4067` | IT / Dev | JSON Formatter, Regex Tester, Base64/URL Encoder, Timestamp Converter, Text Diff, File Diff, SQL Workbench, Code Helper, JWT Decoder, Test Data Generator, Instant Dashboard, Dashboard Builder |
  | `8412` | HR / Operations | Data Cleaner, Format Converter, Column Statistics, Timestamp Converter, Lookup & Merge, Fuzzy Duplicate Finder, Instant Dashboard, Dashboard Builder |
  | `2650` | Finance | Data Analyzer, Column Statistics, Pivot & Chart Explorer, File Diff, SQL Workbench, Lookup & Merge, Chart Builder, Instant Dashboard, Dashboard Builder |

  Dashboard Builder is on every code on the assumption that anyone might want to
  request a dashboard. Trim it out of any view where that is not true.

  A code is not remembered anywhere (no `localStorage`, no URL param), so it
  has to be re-entered on every fresh load by design, and there's no way to
  switch views without refreshing and re-entering a (possibly different)
  code.

  **This is a convenience filter, not access control.** It only covers the
  landing page — anyone who knows or guesses a tool's direct URL (e.g.
  `tools/data-analyzer/index.html`) can open it directly, bypassing the
  gate entirely, since there's no backend to actually check credentials
  against. Real per-person restriction would need a server with
  authentication, which is a different architecture than this static site.

## Dashboard Builder (`tools/dashboard-builder/`)

Somebody wants a dashboard. Rather than describing it over email, they pick the
visuals here, say what each one measures and how it breaks down, and send a
link. Whoever builds the real thing sees the exact layout that was asked for.

`index.html` is the builder with a live preview. `view.html` is the viewer.
The built dashboard is the deliverable: this is not a request form that
something else gets built from.

Display options live under "More details", all on by default so older links are
unaffected: `showCaptions` prints what each visual measures under its title
(`sum of Revenue by Region`), `showDeltas` prints the change against the prior
period on KPI tiles, and `showEditLink` puts an "Edit this dashboard" link on
the built file. Turn them off for a cleaner board when the audience already
knows what they are looking at. They travel in the link and in the downloaded
file like any other setting.

Colours are set the same way. `palette` picks one of six named palettes and
`accent` overrides the main colour with any hex value, applied consistently to
KPI text, bars, lines, area fills and donut slices. A custom accent moves to the
front of the palette rather than replacing it, so donut slices keep enough
distinct colours. Hex is validated on the way in, since a spec arrives from a
URL and the value ends up in CSS.

### Keeping hold of the data

The builder remembers the loaded file in `sessionStorage`, so refreshing the
page keeps your real numbers instead of silently dropping back to placeholders.
When there genuinely is no data, an amber banner says so in as many words,
because invented figures that look real are worse than no figures at all.

Arriving from an "Edit this dashboard" link always wins over that remembered
file, so editing a dashboard never shows you data from whatever you happened to
be working on before.

### Editing a dashboard after it is out

A dashboard is never a dead end. A share link opens straight back into the
builder, and a **downloaded or pushed HTML file carries an "Edit this
dashboard" link** that reopens it in the builder with every visual, slicer,
filter, ratio and colour intact. When the built dashboard is served from the
same site as the builder, the rows it carries are handed across too, so you land
in the builder with real numbers rather than placeholders. Edit, download again,
and replace the file. A Google Sheet dashboard simply reconnects to its sheet.

The builder opens empty and is worked through in three numbered steps: load a
file, add visuals, add slicers. Visuals are listed one per line showing their
title and what they measure, and only the one being edited expands. An expanded
visual shows four fields; width, chart type, notes and filters sit behind "More
options", and the dashboard description, owner, audience and refresh sit behind
"More details". Adding a visual names it and points it at sensible columns
automatically, so a usable dashboard is a few clicks with no typing.

Eight visual kinds are available (KPI tile, trend line, column, bar, donut,
table, detail rows, scatter), each laid out at quarter, half, or full width on a
twelve column grid, plus **slicers**: dropdown, chip list, numeric range, and
date range controls that filter every visual at once for whoever is looking at
it. Range and date range slicers have a handle at each end, so both bounds move.

**Detail rows** is the odd one out: it lists rows as they are, with no
aggregation, showing whichever columns you tick and sorted by whichever column
you choose. It reports the true match count when it shows fewer rows than
matched, so a capped table never reads as the whole story.

### Where the data comes from

Every visual carries a `binding` (`source`, `measure`, `aggregation`,
`dimension`, `measure2`, `grain`, `limit`, `filters`) describing the data it
wants. Several resolvers can satisfy it, and `dashboardResolveVisual` picks in
this order:

1. **Real rows.** A CSV or Excel file, or a connected Google Sheet.
   `dashboardResolveFromRows` aggregates for real: sum, average, count, min,
   max and distinct count, grouped by a dimension or by day, week, month,
   quarter or year. `profileDataset` decides which columns are offered as
   measures and which as dimensions, so identifier columns stay out of the
   measure list. Count and distinct count are offered on **every** column, not
   just numeric ones, since counting names is a normal thing to want.
2. **Baked results.** A downloaded dashboard carries its own precomputed data.
3. **Placeholders.** With no data at all, `dashboardResolveSample` invents
   plausible figures seeded from the visual's id, so a given dashboard always
   shows the same numbers and the layout can be reviewed before real data is
   attached. The footer says plainly that the numbers are not real.

### Named measures

`spec.measures` holds reusable calculations, the Power BI measure idea: a name,
a column, an aggregation, its own filters, an optional divisor and a format. A
visual sets `binding.measureRef` to use one instead of defining its own number.
`dashboardEffectiveBinding` folds the named measure into the visual's binding at
render and bake time, so nothing downstream needs to know measures exist. The
visual keeps its own dimension, grain and limit, so one "Win Rate" measure
serves a KPI tile and a breakdown by region at once. Edit the measure and every
visual using it changes together; a dangling reference quietly falls back to
the visual's own binding.

**Measures compose.** A divisor can point at another measure rather than a raw
column, so "Won Deals over Closed Deals" is two named measures divided, and
editing either one updates everything built on it. The denominator may itself
be a ratio, which `dashboardRawValue` evaluates recursively. Two guards keep
that safe: resolution tracks which measure ids it has already followed, so a
measure dividing by itself (or two measures dividing by each other) terminates
instead of hanging, and both resolution and evaluation stop at a depth of four.

### Rates and percentages

A binding can divide one aggregate by another, which is how you get anything
the six aggregations cannot express on their own. `binding.divideBy` holds a
second `{measure, aggregation, filters}`, and `binding.format` decides whether
the result reads as a percentage or a plain ratio.

The rule that makes rates work: **the visual's own filters narrow the top
number only, and the bottom number has its own filters.** So a close rate over
everything is "count of Deal ID where Stage equals Won" over "count of Deal ID",
while a win rate on closed business filters the bottom number to Won or Lost and
leaves Open deals out of both halves. Margin is sum of Cost over sum of Revenue
as a percentage; average deal size is sum of Revenue over count of Deal ID as a
plain ratio.

Ratios work on KPI tiles, breakdowns and trends alike, so close rate by region
and close rate over time both work. Slicers re-scope the numerator and the
denominator together, which is the part a naive implementation gets wrong.
Two details fall out of this: a category with no wins still appears at 0 rather
than vanishing, and a ratio breakdown never rolls its tail into an "Other"
bucket, because summing percentages is meaningless.

### How multiple filters combine

Filters on the **same column** are combined with "or", filters on **different
columns** with "and". So two filters saying Region equals North and Region
equals South give you both regions rather than nothing. This matches how
slicers behave in every BI tool. Exclusions are the exception and stay "and",
so Region not equals North plus Region not equals South excludes both, and
numeric comparisons stay "and" so greater than and less than form a range.

### Google Sheets

`tools/shared/sheet-connect.js` reads a sheet straight from a pasted link, with
no API key, no sign-in and no backend. `googleSheetRefFromUrl` pulls the
spreadsheet id and tab out of whichever URL shape you paste, and
`googleSheetCsvUrls` builds the CSV export candidates, which
`fetchGoogleSheet` tries in turn until one returns something that is not a
sign-in page. Only `docs.google.com/spreadsheets` URLs are ever accepted, both
when connecting and when a spec is decoded from a link.

The sheet has to be readable without signing in ("Anyone with the link", or
published to the web), because the browser fetches it directly with no
credentials. When a sheet is connected, the URL is stored on the spec, so a
downloaded dashboard **re-reads the sheet every time it is opened** and stays
current. It renders its baked snapshot first and swaps in live data when the
fetch returns, so it still works if the sheet later becomes unreachable.

### Building from typed instructions

`tools/shared/dashboard-parse.js` turns plain words into visuals. Typing
`revenue by region, total orders, revenue over time, let me filter by segment`
produces three visuals and a slicer, bound to real columns. It is deterministic
with no AI and no network: it splits on commas and newlines, matches
aggregation and chart-shape keywords, and resolves column names by exact match,
token match, or fuzzy match through `similarity` from `match.js`, so `regoin`
still finds `Region`. It handles ranking phrasing (`top 5 sales rep by revenue`)
where "by" introduces the measure rather than the dimension. Anything it cannot
work out is handed back verbatim and reported, rather than guessed at.

### Two ways to hand it over

**Download HTML** produces a single self-contained file, and what gets embedded
depends on whether the dashboard is interactive:

- *No slicers:* only the computed series per visual. A 50 MB export collapses to
  a few KB, and no raw records ride along.
- *With slicers:* the rows themselves, since the viewer needs to re-filter them,
  capped at 50,000 rows with the file reporting when it truncated. **Every**
  column travels, not just the ones the spec references, so clicking "Edit this
  dashboard" hands the builder the whole table back. Turning the edit link off
  projects down to referenced columns instead, trading editability for size.

**Share link** encodes the spec (not the data) into the URL fragment, so the
recipient attaches their own copy of the file. The viewer tells them which
columns it expects. Fragments are never sent to the server, so nothing reaches
Azure either way.

Because a spec arrives from a URL that anyone can edit, `dashboardNormalizeSpec`
treats it as untrusted: every enum is clamped to a known value, text is length
capped, counts are bounded, unknown visual kinds fall back to a column chart,
and prototype keys like `__proto__` are rejected by an own-property check. The
renderer builds every node with `textContent`, so a spec carrying markup renders
as literal text rather than HTML. `dashboardDecodeSpec` returns `null` on junk
instead of throwing.

Downloaded dashboards inline the shared modules, so they do not depend on the
hub staying up. They still load Tailwind and Chart.js from their CDNs.

## Data Analyzer (`tools/data-analyzer/`)

A fully static, backend-free version of the original FastAPI Data Analyzer.
Every bit of analysis that used to run in `app.py`/`analyzer.py` on a server
now runs client-side in the browser (`tools/data-analyzer/js/*.js`).

Nothing is uploaded anywhere. Files you pick are parsed and analyzed entirely
in your own browser tab; there's no server to send data to — which is also
what keeps this safe to share as a team hub with no login and no backend.

## Testing

There are two in-browser suites, both dependency-free. Open either via
`./serve.sh` or by double-clicking it, and re-run them after touching the
code they cover.

`tests/shared.test.html` covers `tools/shared/`: CSV parsing and export,
HTML escaping and sanitizing, header uniquifying, Excel grid reshaping and
header row detection, SQL table-name sanitizing and type inference, summary
statistics and percentiles, fuzzy matching, JSON flattening, the column
profiling behind Instant Dashboard, and Dashboard Builder (spec round trips,
clamping of untrusted specs, every aggregation and filter operator, slicer
stacking, time grain grouping, and what each bake mode embeds). It loads the
exact files the tools load, so a failure here means a failure in every tool
that depends on that module (108 assertions).

`tests/data-analyzer.test.html` is a small, self-contained in-browser test
suite for the Data Analyzer's engine — regression math, seasonal forecasting,
goal pacing status, the New/Repeat 30-day classification rule, HHI/KPI
calculations, month-over-month anomaly detection, schema inference, data
quality warnings, strict date parsing, column-name matching, and CSV parsing.
It loads the exact same
`tools/data-analyzer/js/*.js` files the real tool uses, runs 26 assertions
against hand-verified fixtures, and renders pass/fail results on the page
(also logged to the console). No build step or dependencies — open it via
`./serve.sh` (`http://localhost:8020/tests/data-analyzer.test.html`) or by
double-clicking the file, and re-run it any time after touching the engine
files to catch a regression before it reaches the dashboard.

## Preview it locally before publishing

```bash
./serve.sh
```

Then open http://localhost:8020 for the hub, or
http://localhost:8020/tools/data-analyzer/ to go straight to the analyzer.
(Just double-clicking `index.html` also mostly works, but some browsers
restrict local script loading over the `file://` protocol — `serve.sh`
avoids that entirely.)

## Publishing

The hub is hosted on **Azure Static Web Apps**, deployed from the GitHub repo
by the workflow in `.github/workflows/`. Edit the files, commit, and push:
the Action rebuilds and redeploys on every push to `main`. There is no build
step, no server to restart, and nothing to redeploy manually.

The site is static end to end, so a deploy is just a file copy. If a change
looks right at `http://localhost:8020` via `./serve.sh`, it will look the same
once deployed.

Two things to know if a backend is ever added (the Dashboard Builder data feed
is the likely first case):

- Static Web Apps includes managed Azure Functions on the free tier, but the
  workflow ships with `api_location: ""`. It has to point at an `api` folder
  before any function will deploy.
- Static Web Apps does not include a database. Persisting anything means
  adding a separate resource such as Table Storage or Cosmos DB.

## Renaming the hub

The landing page title, header text, and tagline are plain text/HTML at the
top of the root `index.html` — edit `Data and Analytics Hub` and the intro
paragraph to your team's actual name. No build step, just save and push.

## Adding another tool

1. Create `tools/<your-tool-name>/` and put its static files there
   (self-contained, same pattern as `tools/data-analyzer/`).
2. Copy one of the `<a href="tools/data-analyzer/index.html">...</a>` card
   blocks in the root `index.html`, point the `href` at your new tool, and
   update its icon/title/description.
3. Commit and push.

## What changed vs. the FastAPI version (Data Analyzer)

- `analyzer.py` → `js/core.js`, `js/schema.js`, `js/forecast.js`,
  `js/goals.js`, `js/insights.js`, `js/run-analysis.js` (the analysis engine,
  ported function-for-function).
- `app.py`'s session/`/api/*` endpoints → `js/session.js` (an in-memory
  browser-side equivalent — `FILES`/`ACTIVE_FILE_ID`/`COMPARE_ANALYZER`
  instead of server-side session dicts).
- `index.html` — same UI and chart-rendering code as before; only the ~10
  `fetch('/api/...')` call sites were swapped for direct local function calls.
- CSV parsing is hand-rolled; Excel parsing uses the SheetJS (`xlsx.js`)
  library already loaded on the page.

Column identification (`js/schema.js`) matches name hints on whole tokens, not
bare substrings, so `Paid Amount` and `Provider` are no longer treated as ID
columns because they happen to contain the letters "id". A column whose name
looks like a date is checked for date-ness before it is checked for
numeric-ness, so Excel serials and `YYYYMMDD` integers become the timeline
rather than the metric. The metric column is chosen by score (name hints,
fractional values, spread, ID/timeline penalties) rather than by taking the
leftmost column whose name contains a hint.

### Known limitations vs. the Python version

- Date parsing is a strict allowlist of formats, not a port of Python's
  `dateutil`. It accepts ISO (with or without a time), `YYYY/MM/DD`,
  `MM/DD/YYYY`, `MM-DD-YYYY`, two-digit-year variants of both, `15-Mar-2024`,
  `Mar 15, 2024`, Excel serial numbers, and `YYYYMMDD` integers. Anything else
  is treated as "not a date" on purpose: the old `new Date(string)` fallback
  turned `CUST-0042` into January 1st 2042 and `ABC-123` into the year 123,
  which quietly reclassified ID columns as date columns and broke every entity
  metric downstream. Very unusual date formats will need to be added to
  `parseStrictDateString` in `js/core.js` (and to `profileToDate` in
  `tools/shared/profile.js`, which mirrors it) rather than guessed at.
- State lives only in the current tab (by design, since there's no server) —
  refreshing the page clears loaded files, same as closing any browser tab
  with unsaved in-memory state.
- Very large files (hundreds of thousands of rows) will run slower here than
  on a pandas backend, since the aggregation logic isn't vectorized in C —
  fine for typical exports, worth knowing for huge ones.
