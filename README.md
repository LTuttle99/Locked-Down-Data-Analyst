# Team Analytics Hub

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
Data Cleaner, Format Converter, Column Statistics). Data Analyzer keeps its
own copy in `tools/data-analyzer/js/core.js` so it stays fully
self-contained. The purely text/paste-based tools (JSON Formatter,
Timestamp Converter, Regex Tester, Text Diff, Color Tools, Text Analyzer,
Base64/URL Encoder, Unit Converter) need no file parsing at all. Markdown
Previewer is the only text-based tool with an external dependency (`marked`).

## Hub features

- **Search** — the search box on the landing page filters cards by name and
  description as you type; empty categories hide themselves automatically.
- **Categories** — tools are grouped into "Data & Files" (upload-a-file tools)
  and "Text & Dev Utilities" (paste/type tools).
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
- **Access codes** — the landing page shows no tools at all until someone
  enters a valid code in the "Enter your code" box; each code unlocks only
  the tools listed for it, and there's no "show all" control to see the
  rest. Edit the `VIEW_CODES` object in the `<script>` at the bottom of the
  root `index.html` to add, rename, or change codes — each entry maps a
  code to a label and a list of `data-tool` ids (visible as a
  `data-tool="..."` attribute on every card in the HTML). The code is not
  remembered — every fresh visit or page refresh resets to locked (no
  tools shown) and the code has to be re-entered.

  **This is a convenience filter, not access control.** It only hides cards
  on the landing page — anyone who knows or guesses a tool's direct URL
  (e.g. `tools/data-analyzer/index.html`) can open it regardless of any
  code, since there's no backend to actually check credentials against.
  Real per-person restriction would need a server with authentication,
  which is a different architecture than this static site.

## Data Analyzer (`tools/data-analyzer/`)

A fully static, backend-free version of the original FastAPI Data Analyzer.
Every bit of analysis that used to run in `app.py`/`analyzer.py` on a server
now runs client-side in the browser (`tools/data-analyzer/js/*.js`).

Nothing is uploaded anywhere. Files you pick are parsed and analyzed entirely
in your own browser tab; there's no server to send data to — which is also
what keeps this safe to share as a team hub with no login and no backend.

## Preview it locally before publishing

```bash
./serve.sh
```

Then open http://localhost:8020 for the hub, or
http://localhost:8020/tools/data-analyzer/ to go straight to the analyzer.
(Just double-clicking `index.html` also mostly works, but some browsers
restrict local script loading over the `file://` protocol — `serve.sh`
avoids that entirely.)

## Publish to GitHub Pages

1. Create a new GitHub repository (public, so Pages is free) — either on
   github.com or with `gh repo create`.
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Static data analyzer"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. On GitHub: repo → **Settings → Pages** → under "Build and deployment",
   set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`.
   Save.
4. Wait ~1 minute, then your app is live at
   `https://<your-username>.github.io/<your-repo>/`.

## Updating it later

Edit the files, commit, and push — GitHub Pages redeploys automatically on
every push to `main`. No server to restart, nothing to redeploy manually.

## Renaming the hub

The landing page title, header text, and tagline are plain text/HTML at the
top of the root `index.html` — edit `Team Analytics Hub` and the intro
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

### Known limitations vs. the Python version

- Date parsing is a best-effort port (ISO / `MM/DD/YYYY` / native `Date`
  fallback), not a full port of Python's `dateutil` — very unusual date
  formats may not parse.
- State lives only in the current tab (by design, since there's no server) —
  refreshing the page clears loaded files, same as closing any browser tab
  with unsaved in-memory state.
- Very large files (hundreds of thousands of rows) will run slower here than
  on a pandas backend, since the aggregation logic isn't vectorized in C —
  fine for typical exports, worth knowing for huge ones.
