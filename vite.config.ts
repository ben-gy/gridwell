// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'favicon-16.png',
        'apple-touch-icon.png',
        'robots.txt',
        'samples/demo.csv',
      ],
      manifest: {
        name: 'Gridwell — query huge CSV files',
        short_name: 'Gridwell',
        description:
          'Open, query and convert huge CSV files in your browser — nothing is ever uploaded.',
        id: '/',
        start_url: '/',
        scope: '/',
        theme_color: '#0d1017',
        background_color: '#0d1017',
        display: 'standalone',
        orientation: 'any',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache the app shell, icons and the demo CSV. The DuckDB WASM binary
        // is ~35 MB and vendored — it is cached at runtime on first real use,
        // never precached, so it stays out of these glob patterns.
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,csv}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
