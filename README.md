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
| Dashboard Builder | `tools/dashboard-builder/` | Capture a dashboard request (visuals, measures, breakdowns) and share it as a link that renders the requested layout |
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

`tools/shared/dashboard-spec.js` and `tools/shared/dashboard-render.js` are the
two halves of Dashboard Builder. The spec module owns the request format
(version 1), normalizes it, and encodes it to a URL-safe string; the render
module turns a spec into KPI tiles and Chart.js visuals. See "Dashboard
Builder" below for how the two fit together.

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

`index.html` is the request form with a live preview. `view.html` is the
read-only viewer. There is no server and nothing is saved anywhere: the entire
request is encoded into the URL fragment, so the link *is* the dashboard. A
five-visual request comes to roughly 1.8 KB of URL. Fragments are never sent to
the server, so nothing about the request reaches Azure.

Seven visual kinds are available (KPI tile, trend line, column, bar, donut,
table, scatter), each laid out at quarter, half, or full width on a twelve
column grid.

**The numbers are placeholders.** Every visual carries a `binding`
(`source`, `measure`, `aggregation`, `dimension`, `measure2`, `grain`, `limit`,
`filters`) describing the data it wants, and `dashboardResolveSample` invents
plausible figures for that shape. The figures are seeded from the visual's id
and title, so a given link always shows the same numbers and the layout can be
reviewed and signed off without anyone thinking the values are real. When a
data feed exists, `dashboardResolveSample` is the single function that gets
replaced; nothing else in the renderer changes.

Because a spec arrives from a URL that anyone can edit, `dashboardNormalizeSpec`
treats it as untrusted: every enum is clamped to a known value, text is length
capped, counts are bounded, unknown visual kinds fall back to a column chart,
and prototype keys like `__proto__` are rejected by an own-property check. The
renderer builds every node with `textContent`, so a spec carrying markup renders
as literal text rather than HTML. `dashboardDecodeSpec` returns `null` on junk
instead of throwing.

"Download HTML" produces a standalone file with both shared modules and the
spec inlined, for anyone who wants a copy that does not depend on the hub
staying up. It still loads Tailwind and Chart.js from their CDNs.

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
profiling behind Instant Dashboard, and the Dashboard Builder spec format
(round trips, clamping of untrusted specs, sample data shape). It loads the
exact files the tools load, so a failure here means a failure in every tool
that depends on that module (89 assertions).

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
