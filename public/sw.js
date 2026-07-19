/**
 * Offline support.
 *
 * Two deliberate choices:
 *
 * 1. Navigations are network-first. A cache-first HTML shell is how a static
 *    site ships an update that returning visitors never see — the old index.html
 *    keeps pointing at hashed asset filenames that no longer exist, and the app
 *    breaks in a way no amount of reloading fixes.
 *
 * 2. The DuckDB WASM binary is cached at runtime, not precached. It is ~35 MB;
 *    downloading it during install would tax every first visit, including the
 *    ones that never open a file. Once it has been fetched for real, it is kept
 *    and the tool works offline from then on.
 */

const VERSION = 'v1';
const SHELL_CACHE = `gridwell-shell-${VERSION}`;
const ASSET_CACHE = `gridwell-assets-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/', '/favicon.svg']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Hashed build assets (including the WASM binary and the DuckDB worker) are
  // immutable, so cache-first is both safe and the whole point.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    }),
  );
});
