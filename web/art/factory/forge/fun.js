/* Omni Cardworks: the fun layer's loader and event bus (window.Fun). The fun modules (fx, gyro, terms, tour, practice,
   binder, badges, showcase, share, feed, sale, market and fun.css) load after the first paint, when the browser is
   idle, so they never slow the page down. The rest of the site only talks to them through tiny hooks:
     Fun.emit(name, detail)  something happened (tear, flip, opened, case, graded, bought, paid, burned, suggested);
                             events sent before the modules are in are kept (a few) and delivered once they load
     Fun.go(name, opts)      open one of the fun screens (binder, showcase, feed, tour, practice, badges...)
     Fun.<hook>?.(...)       a synchronous hook a module adds once loaded (packShare, slabPress...)
   Small shared helpers live here too (Fun.h, Fun.mem, Fun.who...). */
(() => {
  const MODS = ['fx', 'gyro', 'terms', 'tour', 'practice', 'binder', 'badges', 'showcase', 'share', 'feed', 'sale', 'market'];
  const handlers = {}, queue = [];
  let loaded = false, loading = null;
  const Fun = window.Fun = {
    open: {}, // name -> fn(opts): the screens the modules add
    on(name, fn) { (handlers[name] ||= []).push(fn); },
    emit(name, detail = {}) {
      if (!loaded) { if (queue.length < 40) queue.push([name, detail]); load(); return; }
      for (const fn of handlers[name] || []) { try { fn(detail); } catch (e) { console.error(e); } }
    },
    go(name, opts) { return load().then(() => (Fun.open[name] ? Fun.open[name](opts) : null)); },
    load,
    get loaded() { return loaded; },

    // ---------- shared helpers
    reduced: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    /** localStorage, never throwing (private windows, blocked storage): mem(k) reads JSON, mem(k, v) writes it. */
    mem(k, v) {
      try {
        if (v === undefined) { const s = localStorage.getItem(k); return s == null ? null : JSON.parse(s); }
        localStorage.setItem(k, JSON.stringify(v));
      } catch { /* not remembered */ }
      return v ?? null;
    },
    /** Whose things these are: the connected wallet (live), or the demo wallet; null when live and not connected. */
    who() {
      const w = Store.state.wallet;
      if (window.Live?.on) return w.connected && w.full ? w.full.toLowerCase() : null;
      return 'demo';
    },
    short: (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || ''),
    esc: (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    /** The chain's clock (live.js keeps the skew), seconds. */
    now: () => Date.now() / 1000 + (Store.clockSkew || 0),
    /** Replace an element's children, skipping null / false and flattening arrays. */
    put: (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false)),
    /** An element: h('div', { class, text, html, onclick, ...attrs }, ...children). */
    h(tag, props, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
      }
      for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
      return el;
    },
    /** Wallet names and avatars come from profile.js (window.Profiles) when it's loaded; else a short address and a
     *  plain round mark made from the address. */
    profileOf: (a) => (window.Profiles?.get ? window.Profiles.get(a).catch(() => null) : Promise.resolve(null)),
    label(a) { try { const x = window.Profiles?.label?.(a); if (typeof x === 'string' && x) return x; } catch { /* fall back */ } return Fun.short(a); },
    avatar(a, size = 28) {
      try { if (window.Profiles?.avatar) { const el = window.Profiles.avatar(a, size); if (el) return el; } } catch { /* fall back */ }
      const n = parseInt(String(a || '0').slice(2, 8), 16) || 0;
      return Fun.h('span', { class: 'fun-av', 'aria-hidden': 'true', style: `--s:${size}px;--h:${n % 360}` }, String(a || '?').slice(2, 3).toUpperCase());
    },
  };

  function load() {
    if (loading) return loading;
    loading = new Promise((done) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'fun.css'; document.head.append(css);
      let left = MODS.length;
      const one = () => { if (--left) return; loaded = true; done(); for (const [n, d] of queue.splice(0)) Fun.emit(n, d); };
      for (const m of MODS) { const s = document.createElement('script'); s.src = m + '.js'; s.async = false; s.onload = one; s.onerror = one; document.body.append(s); }
    });
    return loading;
  }
  // after the first paint: once the loading screen is gone and the browser has a moment
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 600));
  function whenPainted() {
    const l = document.getElementById('loading');
    if (!l || l.classList.contains('done')) return idle(load);
    new MutationObserver((_, o) => { if (l.classList.contains('done')) { o.disconnect(); idle(load); } }).observe(l, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', whenPainted, { once: true }); else whenPainted();
})();
