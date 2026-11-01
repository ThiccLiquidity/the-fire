/* Omni Cardworks: the Village button, back to the landing page (<meta name="site-home">, the village). Shown when
   <meta name="site-doors" content="on">, or this visitor came through a landing page in this tab (sessionStorage
   omni.doors). The logo goes there too. Loaded after ui.js. */
(() => {
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || '';
  let on = meta('site-doors') === 'on';
  try { on = on || sessionStorage.getItem('omni.doors') === '1'; } catch { /* private window */ }
  const bar = document.querySelector('.topbar');
  if (!on || !bar) return;
  const live = new URLSearchParams(location.search).get('live');
  const a = document.createElement('a');
  a.className = 'chip home-btn';
  a.href = (meta('site-home') || '/doors/') + (live ? `?live=${encodeURIComponent(live)}` : '');
  a.setAttribute('aria-label', 'Back to the village');
  a.title = 'Village';
  a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10"/></svg><span>Village</span>';
  bar.prepend(a);
  const brand = bar.querySelector('.brand'); if (brand) brand.href = a.href;
  const css = document.createElement('style');
  css.textContent = '.home-btn{flex:none;text-decoration:none}body[data-mode=port] .home-btn span{display:none}body[data-mode=port] .home-btn{min-height:32px;padding:0 8px}';
  document.head.append(css);
})();
