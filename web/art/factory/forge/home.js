/* Omni Cardworks: the Home button back to the doors (the landing with the Card Press and the Printing Press). Shown
   only when the doors are on: the build says so (<meta name="site-doors" content="on">, once "/" is the doors), or
   this visitor came through the doors or the Printing Press in this tab (they set sessionStorage omni.doors). Off,
   this does nothing, so Cardworks looks exactly as before. Loaded after ui.js. */
(() => {
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || '';
  let on = meta('site-doors') === 'on';
  try { on = on || sessionStorage.getItem('omni.doors') === '1'; } catch { /* private window */ }
  const bar = document.querySelector('.topbar');
  if (!on || !bar) return;
  const live = new URLSearchParams(location.search).get('live');
  const a = document.createElement('a');
  a.className = 'chip round home-btn';
  a.href = (meta('site-home') || '/doors/') + (live ? `?live=${encodeURIComponent(live)}` : '');
  a.setAttribute('aria-label', 'Home: the two doors');
  a.title = 'Home';
  a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10"/></svg>';
  bar.prepend(a);
  const css = document.createElement('style');
  css.textContent = '.home-btn{flex:none;text-decoration:none}body[data-mode=port] .home-btn{width:32px;min-height:32px}';
  document.head.append(css);
})();
