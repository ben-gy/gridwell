# gridwell

**Open, query and convert huge CSV files in your browser — nothing is ever uploaded.**

Live: https://gridwell.benrichardson.dev

---

## what it is

Excel stops at 1,048,576 rows, and it will struggle long before that — a 400 MB CSV can take 3 GB of RAM and lock up the machine. The usual advice is "learn pandas" or "use an online CSV viewer". The first is a lot to ask of someone with one question and an afternoon; the second means uploading the file.

That matters more than it sounds. The CSVs people can't open are almost always exports: customer lists, payroll runs, transaction histories, patient extracts. Handing one to an ad-supported "free online tool" is often the worst available option, and in a lot of workplaces it is a straightforward policy breach.

Gridwell runs [DuckDB](https://duckdb.org) — a real analytical SQL engine — compiled to WebAssembly, inside the browser tab. You drop a file, it reads it off your disk, and you filter it with clicks or with SQL. 120,000 rows scan in well under a second. Nothing is uploaded, because there is no server to upload to.

It is for the ops analyst, finance person, support engineer or researcher who is comfortable with a spreadsheet, can follow a `WHERE` clause, and does not want to stand up a notebook to answer one question.

## how it works

```
File (on your disk)
  │   registerFileHandle(BROWSER_FILEREADER)
  ▼
DuckDB-Wasm ──────────── runs in a Web Worker
  │   CREATE VIEW data AS SELECT * FROM read_csv_auto(…, sample_size=-1)
  │   DESCRIBE data          → column names + types
  │   SELECT COUNT(*)        → true row count
  ▼
Query  ── builder writes SQL, or you write it yourself
  │   wrapped: SELECT * FROM ( <your query> ) LIMIT 20000
  ▼
Apache Arrow result ──── read column-at-a-time, zero-copy
  ▼
Windowed grid ────────── only the ~30 visible rows exist in the DOM
  │
  └── Export: COPY ( <your query> ) TO 'out.x' → bytes → Blob → download
```

Three details worth calling out:

**The file is never buffered into JS memory.** `BROWSER_FILEREADER` lets DuckDB issue ranged reads against the `File` handle as each query needs them. That is what makes a multi-gigabyte file open at all.

**CSV types are inferred from the whole file** (`sample_size=-1`), not a leading sample. Sampling is faster, but it is also how a column gets typed `INTEGER` from the first 20,000 rows and then throws on row 800,000 — the single most common and most baffling CSV failure there is.

**Only the visible rows are rendered.** A 20,000 × 30 result is 600,000 cells; building those as elements costs seconds and hundreds of megabytes, and you can see forty of them. The grid renders about thirty and repositions on scroll, so it stays flat regardless of result size.

Queries are restricted to read-only statements. `ATTACH`, `COPY`, `INSTALL`, `LOAD` and any `https://` / `s3://` path are rejected before they reach the engine — not because there is a server to protect, but because a query pasted from a forum post should not be able to quietly pull a remote file into a tool whose whole promise is that nothing leaves the device.

## browser APIs used

- **WebAssembly** — the DuckDB engine itself; the `eh` (exception-handling) build, which needs no cross-origin isolation and so works on plain static hosting
- **Web Workers** — DuckDB's own worker; every query runs off the main thread
- **File API + `registerFileHandle`** — ranged reads straight off disk, no upload, no full buffer
- **Apache Arrow** — columnar, zero-copy result sets
- **Clipboard API** — copy a cell, copy the generated SQL, paste CSV text straight in
- **Web Share API** — share an export from mobile
- **Service Worker** — caches the engine so the second visit is instant and offline

## security / privacy model

**Protected**

- The contents of your file. There is no upload endpoint in this application.
- Your column names, row counts and schema — never transmitted, never logged.
- Every query you write. The SQL runs locally.
- Your exports, generated in memory and handed to the browser's download machinery.
- Nothing survives the tab. The database is in-memory; `localStorage` holds interface preferences only.

**Not protected**

- That you visited (an anonymous page view is counted — see below).
- Anything on your own machine. Exports land in Downloads unencrypted.
- Shoulder surfing and screen sharing — your data is on screen.
- Browser extensions with permission to read pages can read this one, as they can any other.

**Trust model**

- This site's bundle, served over TLS by GitHub Pages — including the DuckDB WASM binary, which ships *inside* the bundle rather than being fetched from jsDelivr at runtime. The documented quick-start uses the CDN; that would put a third party in a position to observe every person who opens the tool, and would break offline use.
- Your browser and its WebAssembly sandbox.
- A Cloudflare Web Analytics beacon — anonymous page views, no cookies, no fingerprinting.
- `feedback.benrichardson.dev`, only if you open the feedback form and press Send.

You do not have to take this on faith: open devtools, watch the Network tab, and load a file. No request carries your data, because there is none.

## stack

- Vite 6 + vanilla TypeScript
- [`@duckdb/duckdb-wasm`](https://github.com/duckdb/duckdb-wasm) — the engine
- [`apache-arrow`](https://arrow.apache.org/docs/js/) — result sets
- Vitest for unit tests (184 covering SQL construction, type mapping, formatting and layout maths)
- GitHub Pages for hosting, deployed via GitHub Actions

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via Cloudflare Web Analytics — no personal data, no cross-site tracking.

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs tests, builds, and deploys `dist/` to GitHub Pages. The custom domain is set via `public/CNAME` — point a `CNAME` DNS record for `gridwell.benrichardson.dev` at `ben-gy.github.io`.

## license

MIT — see [LICENSE](./LICENSE).
