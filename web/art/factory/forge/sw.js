/* Omni Cardworks as an app (scope /forge/): the installed app opens fast and still opens with a weak connection.
   - The page, code and styles: the network first (every visit gets the newest build), the saved copy when offline.
   - Pictures, fonts and sounds: the saved copy at once, refreshed in the background; at most MAX of them.
   - Never touched: other sites (RPCs, IPFS, wallets), /api/, anything but GET, and partial (range) requests.
   Nothing here holds wallet data: the chain is always read live. */
const SHELL = 'omni-shell-v1', MEDIA = 'omni-media-v1', MAX = 400;
const MEDIA_RE = /\.(webp|png|jpe?g|svg|woff2?|mp3|ogg)$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('omni-') && k !== SHELL && k !== MEDIA) await caches.delete(k);
    await self.clients.claim();
  })());
});

const put = (name, req, res) => { if (res.ok && res.type === 'basic') { const c = res.clone(); caches.open(name).then((s) => s.put(req, c)); } return res; };
async function trim() { // keep the media cache bounded: drop the oldest entries
  const s = await caches.open(MEDIA), keys = await s.keys();
  for (let i = 0; i < keys.length - MAX; i++) await s.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/forge/')) return;
  if (MEDIA_RE.test(url.pathname)) {
    // the saved copy at once, refreshed in the background (a picture redrawn under the same name shows next time)
    e.respondWith(caches.match(req, { cacheName: MEDIA }).then((hit) => {
      const fresh = fetch(req).then((r) => { put(MEDIA, req, r); trim(); return r; });
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh;
    }));
    return;
  }
  // the page, code, styles and data (holders lists, prizes): network first, saved copy offline
  e.respondWith(fetch(req).then((r) => put(SHELL, req, r)).catch(async () => (await caches.match(req, { cacheName: SHELL, ignoreSearch: req.mode === 'navigate' })) || Response.error()));
});
