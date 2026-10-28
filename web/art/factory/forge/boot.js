/* Omni Cardworks: the first script, tiny and in the head. It marks a live page (<html class="live">) before anything
   paints, so the loading screen never shows the demo's line on the live site (the same rule as core.js / live.js:
   ?live=testnet|mainnet, ?live=off for the demo, else <meta name="forge-live">). Everything else loads deferred. */
(() => {
  const ok = (v) => (v === 'testnet' || v === 'mainnet' ? v : null), q = new URLSearchParams(location.search).get('live');
  const net = q === 'off' ? null : ok(q) ?? ok(document.querySelector('meta[name="forge-live"]')?.content ?? '');
  if (net) document.documentElement.classList.add('live', net);
})();
