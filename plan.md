# Tool Plan: Gridwell

## Overview
- **Name:** Gridwell
- **Repo name:** gridwell
- **Tagline:** Open, query and convert huge CSV files in your browser — nothing is ever uploaded.

## Problem It Solves
You export 4.2 million rows of transactions from your billing system and Excel refuses to open it — the grid caps at 1,048,576 rows, and even a 400 MB file that *fits* will chew 3 GB of RAM and lock up the machine. You don't want to learn pandas for a one-off question. You just need to see what's in there, filter to the rows that matter, and hand a colleague a 12,000-row CSV instead of a 400 MB one.

Every "free online CSV viewer" that shows up on the first page of Google wants you to upload the file. That file is a customer list, a payroll export, a patient extract, a bank statement. Uploading it to an ad-supported stranger is often the single worst thing you could do with it — and in a lot of workplaces it is a straightforward policy breach.

Gridwell runs a real analytical SQL engine (DuckDB, compiled to WebAssembly) inside the tab. The file is opened from your local disk, parsed and queried on your own CPU, and the answer comes back in milliseconds. The bytes never touch a network.

## Why This Must Be Client-Side
- **Sensitive data by definition.** The CSVs people can't open are exports — customers, payroll, transactions, patients. These are precisely the files that must not be uploaded, and the reason the incumbent tools are unusable at work.
- **Large-file handling.** Uploading 500 MB to run one `GROUP BY` is absurd; reading it from disk is instant. There is no upload progress bar because there is no upload.
- **No-account friction.** No signup wall between a person and a question about their own file.
- **Offline.** Once the tab has loaded, the engine is cached and the tool works on a plane or an air-gapped machine.

## Browser APIs / Libraries Used
| API / Library | What it does for us | Fallback if unsupported |
|---------------|---------------------|-------------------------|
| DuckDB-Wasm (`@duckdb/duckdb-wasm`) | Full analytical SQL engine in WASM — CSV/JSON/Parquet sniffing, typing, aggregation, export | Hard requirement; explicit unsupported-browser panel |
| WebAssembly (exception-handling bundle) | Runs the engine without cross-origin isolation, so it works on plain GitHub Pages | The `mvp` bundle is selected automatically on older engines |
| Web Worker (DuckDB's own worker) | The entire engine runs off the main thread; a 60 s scan never freezes the UI | None needed — the worker is mandatory in duckdb-wasm |
| Apache Arrow (`apache-arrow`, via duckdb-wasm) | Columnar zero-copy result sets — reading 100k rows out of a query costs no JSON parse | N/A |
| File API + `registerFileHandle` | DuckDB reads the `File` object directly in ranged chunks; the file is never fully buffered into JS memory | Falls back to a full `ArrayBuffer` register for small files |
| Streams (`Blob.stream`) | Export writes are streamed out of the WASM FS to a Blob | Buffered write |
| Clipboard API | Copy result cells, copy the generated SQL | Hidden if unsupported |
| Web Share API | Share the exported file on mobile | Download link |
| Service Worker (PWA) | Caches the ~35 MB engine so the second visit is instant and offline | Tool still works, just re-downloads |

## Workflow (input → process → output)
1. **Input** — drag a `.csv` / `.tsv` / `.json` / `.parquet` onto the drop zone (or tap to pick). Nothing is read until it lands.
2. **Process** — DuckDB registers the file handle, sniffs the dialect and column types, and reports row count + schema. The user then either clicks the quick controls (pick columns, add a filter, sort, limit) or writes SQL directly. Every quick-control change regenerates visible SQL, so the panel doubles as a way to *learn* the SQL.
3. **Output** — the result grid is virtualised (only the visible rows are in the DOM). Export the current result as CSV, JSON, Parquet or a `.sql` script; download, copy, or Web Share.

## Non-Goals
- No charting — this is a *get the data out* tool, not a BI dashboard.
- No multi-file joins in v1 (one file at a time keeps the mental model tight).
- No editing cells. Read, filter, export. It is not a spreadsheet.
- No cloud sync, no accounts, no saved workspaces on a server. Ever.

## Target Audience
Someone semi-technical with a file that has defeated their normal tools: an ops analyst, a finance person, a support engineer, a researcher. They know what a column is and can probably follow a `WHERE` clause, but they are not going to spin up a Jupyter notebook at 4pm to answer one question. Emotional context: mildly frustrated, on a work laptop, aware that uploading this particular file would be a bad idea, and slightly amazed when 4 million rows scan in under a second.

## Style Direction
**Tone:** technical but calm — confident, precise, no exclamation marks.
**Colour palette:** dark slate base with a single amber accent. Dark because this is a data tool viewed for long stretches and a dense grid of numbers reads better on dark; amber (rather than the usual blue) because it echoes DuckDB's own identity and keeps the tool from looking like every other developer utility.
**UI density:** compact — this is a grid tool, and rows-per-screen is a feature.
**Dark/light theme:** dark.
**Reference tools for feel:** DuckDB's own shell UI, Observable's data table, Datasette.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite. There is exactly one screen and one piece of state (the current query result); React would be pure overhead.
- **Key libraries:** `@duckdb/duckdb-wasm` (engine, vendored same-origin via `?url` imports — never the jsDelivr bundle, which would leak a request), `apache-arrow` (peer of the above, for typed result access).
- **Worker strategy:** DuckDB's own dedicated worker, instantiated from a same-origin `?url` asset. All query execution is off-main-thread by construction.
- **Storage:** `localStorage` for UI preferences only (row height, last export format). No user data is ever persisted — the DuckDB instance is in-memory and dies with the tab.

## Privacy & Trust Model
**Protected**
- File contents. DuckDB reads the `File` handle inside the tab's WASM sandbox; no bytes are sent anywhere.
- Column names, row counts, schemas, and every query you write — all local.
- Exports are generated in-tab and handed to the browser's download machinery directly.

**Not protected**
- The fact that you loaded the page (a page view is counted anonymously — see below).
- Nothing about the file is obscured *from you or from anyone with access to your device* — this is a local tool, not a vault. Exported files land in your Downloads folder unencrypted.
- If you paste data into the feedback form, that text is sent. Nothing else ever is.

**Trust surface**
- The static site bundle served by GitHub Pages, and the TLS chain to it.
- The vendored DuckDB WASM binary, which ships in that same bundle (not fetched from a CDN at runtime).
- A Cloudflare Web Analytics beacon recording anonymous page views.
- `feedback.benrichardson.dev`, only if you open the feedback form and press Send.

## UX Required Surfaces
- Drop zone with drag-drop, tap-to-pick, and accepted-format caption
- Determinate load progress with MB/s, then a per-query millisecond timer
- Virtualised result grid with sticky header and type-aware cell alignment
- Quick-query controls that write visible SQL, plus a raw SQL editor (Cmd/Ctrl+Enter runs)
- Event log drawer with in-drawer `×` and Escape-to-close
- How-It-Works modal, Privacy modal (threat model), About modal
- Export to CSV / JSON / Parquet with download + copy + Web Share
- Glossary tooltips for: WebAssembly, DuckDB, Parquet, columnar, schema, null
- Keyboard: Escape, Cmd/Ctrl+Enter (run), Cmd/Ctrl+V (paste CSV text)
- Sticky footer with benrichardson.dev + sites.benrichardson.dev attribution
- Feedback widget from `patterns/feedback.ts`
