import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    // The DuckDB WASM binary is ~35 MB uncompressed. Warning about it on every
    // build is noise — it is vendored deliberately so that no CDN sees a request.
    chunkSizeWarningLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // duckdb-wasm ships its worker entrypoints as separate assets that must not
    // be pre-bundled, or the `?url` imports resolve to a stale optimised copy.
    exclude: ['@duckdb/duckdb-wasm'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
