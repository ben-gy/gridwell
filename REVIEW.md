# Gridwell — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **Custom domain:** https://gridwell.benrichardson.dev
- **GitHub Pages:** https://ben-gy.github.io/gridwell/ *(redirects to the custom domain)*

## Deployment status

Done automatically by the factory run — no manual steps outstanding:

- [x] Repo created and pushed
- [x] GitHub Pages enabled (`build_type=workflow`)
- [x] Cloudflare DNS `CNAME gridwell → ben-gy.github.io` created (DNS only, grey cloud)
- [x] Pages CNAME set to `gridwell.benrichardson.dev` and cycled to trigger cert issuance
- [x] Deploy workflow completed successfully

If HTTPS ever shows as not enforced, re-cycle the cert:

```bash
gh api repos/ben-gy/gridwell/pages -X PUT -f cname=""
sleep 3
gh api repos/ben-gy/gridwell/pages -X PUT -f cname="gridwell.benrichardson.dev"
```

## What was verified before shipping

Tested against the real production build (`vite preview`), driving the actual UI:

- 120,000-row / 6.2 MB CSV opened; types inferred correctly (`Int64`, `Utf8`, `Float64`, `Date32`, `Bool`)
- Builder-generated SQL, filter + sort, 20,000 rows returned in ~700 ms
- Export verified for all three formats — Parquet checked for real `PAR1` magic at both ends and confirmed 5× smaller than the CSV
- Windowing holds at ~31 DOM rows against a 560,000 px canvas, through top/middle/end scrolling
- Horizontal header sync verified with a 26-column result
- Read-only SQL guard rejects `DROP` / remote paths; bad-column errors surface to the user
- Mobile (375 px): no horizontal overflow, all three modals fit and close on Escape, event-log drawer closes via its own `×` and via Escape
- No console errors

### Bugs found and fixed during verification

1. **Opening query was a silent no-op** — `openFile` held a `busy` flag that `runQuery` refuses to start under, so the grid came up empty on load.
2. **Dates rendered as epoch integers** (`1,771,113,600,000`) — Arrow returns temporal columns as milliseconds, not `Date` objects.
3. **Virtualisation defeated on desktop** — `ResultGrid` added `.grid` to the same element carrying `.grid-host`, so `height: 100%` overrode the fixed `52vh`; the viewport grew to content height and all 20,000 rows rendered. Only reproduced above 620 px, because the mobile media query re-asserts the height later in source order.
4. **Inconsistent number formatting within one column** — thousands separators were applied per value, so a `Float64` column showed `164,400` next to `164394.52`.
5. **Export could shadow the source file** — exporting CSV from a CSV produced the original filename exactly, dropping a filtered subset into Downloads under the same name.

## Notes

- The DuckDB WASM binary is **vendored into the bundle**, not fetched from jsDelivr. The documented quick-start uses the CDN; that would let a third party observe every visitor and would break offline use.
- Only the `eh` build ships. The `mvp` fallback was dropped — a browser without WASM exception handling cannot run the ES2022 bundle either, so it was 39 MB of deploy weight serving nobody.

---

🤖 Built autonomously by gh-tool-factory
