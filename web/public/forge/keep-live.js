/* Omni Cardworks: keep ?live= on the site's own links (the page, Help, Terms), so going to Terms and back stays on the
   same network instead of dropping to the demo. Does nothing without ?live=. Loaded by index.html, help.html and
   terms.html (a file, not inline: the CSP allows scripts from the site only). */
(() => {
  const v = new URLSearchParams(location.search).get('live');
  if (!v) return;
  const own = /^(\.\/|index\.html|help\.html|terms\.html)([?#].*)?$/;
  const fix = (a) => {
    const h = a.getAttribute('href');
    if (!h || !own.test(h)) return;
    const u = new URL(h, location.href); u.searchParams.set('live', v);
    a.setAttribute('href', u.pathname.split('/').pop() === '' ? './' + u.search + u.hash : u.pathname.split('/').pop() + u.search + u.hash);
  };
  // links drawn later (menus, info sheets) are fixed as they're used
  for (const t of ['click', 'auxclick']) addEventListener(t, (e) => { const a = e.target.closest?.('a[href]'); if (a) fix(a); }, true);
  const all = () => document.querySelectorAll('a[href]').forEach(fix);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', all); else all();
})();
