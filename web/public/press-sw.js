/* The Morning Wood offline (scope /press): the page and its code are kept after a visit, and owned issues are kept by
   the page itself (src/press/issue.ts cacheIssue, cache "press-issues-v1"), so a paper you own opens without a
   connection. Nothing else on the site is touched: this worker controls only pages under /press. */
const SHELL = 'press-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('press-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // IPFS pictures and RPCs: the network as usual

  // the page: network first (always the latest build), the saved copy offline
  if (req.mode === 'navigate' && url.pathname.startsWith('/press')) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then((s) => s.put('/press/', c)); } return r; })
      .catch(async () => (await caches.match('/press/', { cacheName: SHELL })) || Response.error()));
    return;
  }
  // built code, styles and fonts (hashed names never change): saved copy first
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req, { cacheName: SHELL }).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const c = r.clone(); caches.open(SHELL).then((s) => s.put(req, c)); }
      return r;
    })));
    return;
  }
  // issues: network first; offline, an owned issue's saved copy
  if (url.pathname.startsWith('/press/issues/')) {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok && url.pathname.endsWith('/index.json')) { const c = r.clone(); caches.open(SHELL).then((s) => s.put(req, c)); }
      return r;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || Response.error()));
  }
});
