/* Omni Cardworks: the full-screen card viewer. Tap the big card (or its expand button) to see it as large as the screen
   allows: the live holo follows the finger or mouse (device tilt where it needs no permission), pinch or double-tap to zoom
   in and pan, swipe left and right through the list it came from, swipe down, tap outside, Esc, X or Back to close.
   Transform and opacity only, one requestAnimationFrame writer, no layout reads inside a frame. */
(() => {
  const RATIO = 1008 / 720, MAX = 4, TAP_ZOOM = 2.5, FILL = 0.94;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON = { x: SVG('M6 6l12 12M18 6L6 18'), prev: SVG('M15 5l-7 7 7 7'), next: SVG('M9 5l7 7-7 7'),
    expand: SVG('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5') };
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let V = null; // the open viewer

  /** Open the viewer. cards: the list (swipe moves through it), index: the one shown, face(c): its card element,
   *  name(c): what it's called, from(): the card on the page it grows out of and goes back to (or null),
   *  onNav(c): the viewer moved to another card. */
  function open({ cards, index = 0, face, name, from, onNav }) {
    if (V || !cards?.length) return;
    const d = el('dialog', 'zv');
    const bd = el('div', 'zv-bd'), stage = el('div', 'zv-stage'), card = el('div', 'zv-card');
    const x = el('button', 'zv-x', { type: 'button', 'aria-label': 'Close' }); x.innerHTML = ICON.x;
    const prev = el('button', 'zv-nav prev', { type: 'button', 'aria-label': 'Previous card' }); prev.innerHTML = ICON.prev;
    const next = el('button', 'zv-nav next', { type: 'button', 'aria-label': 'Next card' }); next.innerHTML = ICON.next;
    const said = el('p', 'zv-sr', { 'aria-live': 'polite' });
    stage.append(card); d.append(bd, stage, x, prev, next, said);
    const v = V = { d, bd, stage, card, prev, next, said, cards, i: clamp(index, 0, cards.length - 1), face, name, from, onNav,
      s: 1, x: 0, y: 0, ox: 0, oy: 0, W: 0, H: 0, cw: 0, ch: 0, f: null, src: null, raf: 0, anim: null, P: new Map(), g: null,
      lastTap: null, drawnScale: 1, ac: new AbortController(), pushed: false, closing: false, opener: document.activeElement };
    const sig = { signal: v.ac.signal };

    layout(v); show(v);
    document.body.append(d);
    d.showModal(); d.classList.add('on');
    x.focus({ preventScroll: true });
    // grows out of the card on the page (its rect read once), the backdrop fades in
    v.src = from?.() || null;
    const r = v.src?.isConnected ? v.src.getBoundingClientRect() : null;
    if (v.src) { v.src.style.visibility = 'hidden'; window.Holo?.hold(v.src, true); }
    if (r && r.width && !reduced()) {
      v.s = r.width / v.cw; v.x = r.left + r.width / 2 - v.W / 2; v.y = r.top + r.height / 2 - v.H / 2; v.fade = 1;
      tween(v, { s: 1, x: 0, y: 0, fade: 0 }, 260, () => settle(v));
    } else { v.fade = reduced() ? 0 : 1; tween(v, { fade: 0 }, 180, () => settle(v)); }
    render(v);

    // Back closes the viewer, not the page
    try { history.pushState({ ...(history.state || {}), zv: 1 }, ''); v.pushed = true; } catch { /* sandboxed: no history */ }
    addEventListener('popstate', () => { if (V === v && !v.closing) { v.pushed = false; close(v); } }, sig);
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(v); }, sig); // Esc
    d.addEventListener('close', () => { if (V === v) finish(v); }, sig);
    x.addEventListener('click', () => close(v), sig);
    prev.addEventListener('click', () => nav(v, -1), sig);
    next.addEventListener('click', () => nav(v, 1), sig);
    d.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); nav(v, -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nav(v, 1); }
      else if (e.key === '+' || e.key === '=') zoomTo(v, Math.min(MAX, v.s * 1.6), v.W / 2, v.H / 2);
      else if (e.key === '-' || e.key === '0') zoomTo(v, e.key === '0' ? 1 : Math.max(1, v.s / 1.6), v.W / 2, v.H / 2);
    }, sig);
    addEventListener('resize', () => { if (V !== v) return; v.s = 1; v.x = v.y = v.ox = v.oy = 0; layout(v); sized(v); render(v); }, sig);
    gestures(v, sig);
    tiltByDevice(v, sig);
    hint(d);
  }

  // the card's box at zoom 1: as wide as fits the short side (phone), as tall as fits (desktop); written outside frames
  function layout(v) {
    v.W = innerWidth; v.H = innerHeight;
    v.cw = Math.round(Math.min(v.W * FILL, v.H * FILL / RATIO)); v.ch = Math.round(v.cw * RATIO);
    Object.assign(v.card.style, { width: v.cw + 'px', height: v.ch + 'px', left: Math.round((v.W - v.cw) / 2) + 'px', top: Math.round((v.H - v.ch) / 2) + 'px' });
  }
  // put card i in the viewer
  function show(v) {
    const c = v.cards[v.i];
    v.f = v.face(c); v.card.replaceChildren(v.f);
    v.d.setAttribute('aria-label', v.name(c));
    // the saved image shows while it flies or slides in; the live card is drawn once it lands (settle)
    v.drawnScale = 0; window.Holo?.size(v.f, v.cw, 1); window.Holo?.defer(v.f, true);
    v.prev.hidden = v.next.hidden = v.cards.length < 2;
    v.prev.disabled = v.i === 0; v.next.disabled = v.i === v.cards.length - 1;
  }
  // while the card moves (open, close, swipes, pinch, pan) the holo holds still, so a frame is only a transform
  function moving(v, on) { v.card.classList.toggle('moving', on); if (on) { clearTimeout(v.sharp); window.Holo?.hold(v.f, true); } }
  // tell the live holo its size: zoomed in it holds the light still and draws once, sharp at that zoom
  // (zoomed in: a beat after it settles, so a quick next pinch or pan doesn't wait on the sharp redraw)
  function sized(v) {
    const H = window.Holo; if (!H || !v.f) return;
    clearTimeout(v.sharp);
    const sc = v.s > 1.02 ? Math.min(v.s, MAX) : 1;
    H.hold(v.f, sc > 1);
    if (sc === 1) { if (v.drawnScale !== 1) { v.drawnScale = 1; H.size(v.f, v.cw, 1); } return H.defer(v.f, false); }
    H.defer(v.f, false);
    if (sc !== v.drawnScale) v.sharp = setTimeout(() => { if (V === v && !v.P.size && !v.anim) { v.drawnScale = sc; H.size(v.f, v.cw, sc); } }, 150);
  }

  // ---------- the one frame writer
  function render(v) {
    const shrink = v.oy > 0 ? Math.min(v.oy / v.H, 1) * 0.18 : 0;
    const t = `translate3d(${(v.x + v.ox).toFixed(2)}px, ${(v.y + v.oy).toFixed(2)}px, 0) scale(${(v.s * (1 - shrink)).toFixed(4)})`;
    v.card.style.transform = t;
    const fade = Math.max(v.fade || 0, v.oy > 0 ? Math.min(1, v.oy / (v.H * 0.45)) * 0.85 : 0);
    v.bd.style.opacity = String(1 - fade);
    v.d.style.setProperty('--ui', String(v.s > 1.02 ? 0.35 : 1 - fade));
  }
  const frame = (v) => { if (!v.raf) v.raf = requestAnimationFrame((t) => { v.raf = 0; step(v, t); render(v); }); };
  // tweens and momentum: advanced in the frame, values only
  function step(v, t) {
    const a = v.anim; if (!a) return;
    if (a.kind === 'tween') {
      const k = a.ms ? clamp((t - (a.t0 ??= t)) / a.ms, 0, 1) : 1, e = easeOut(k);
      for (const key in a.to) v[key] = a.from[key] + (a.to[key] - a.from[key]) * e;
      if (k < 1) return frame(v);
    } else if (a.kind === 'momentum') { // momentum: glide, slowing, then ease back inside the edges
      const dt = Math.min(48, t - (a.t ?? t - 16)); a.t = t;
      v.x += a.vx * dt; v.y += a.vy * dt;
      const decay = Math.pow(0.994, dt); a.vx *= decay; a.vy *= decay;
      const b = bounds(v, v.s);
      if (v.x < -b.x || v.x > b.x) { a.vx *= 0.6; } if (v.y < -b.y || v.y > b.y) { a.vy *= 0.6; }
      if (Math.hypot(a.vx, a.vy) > 0.02) return frame(v);
      v.anim = null; return settle(v);
    } else return;
    const done = a.done; v.anim = null; done?.();
  }
  function tween(v, to, ms, done) {
    const from = {}; for (const k in to) from[k] = v[k] ?? 0;
    v.anim = { kind: 'tween', from, to, ms: reduced() ? 0 : ms, done }; moving(v, true); frame(v);
  }
  const stop = (v) => { v.anim = null; };
  const bounds = (v, s) => ({ x: Math.max(0, (v.cw * s - v.W) / 2), y: Math.max(0, (v.ch * s - v.H) / 2) });
  // back inside the zoom range and the edges, then a sharp redraw
  function settle(v) {
    const s = clamp(v.s, 1, MAX), b = bounds(v, s);
    const to = { s, x: clamp(v.x, -b.x, b.x), y: clamp(v.y, -b.y, b.y), ox: 0, oy: 0 };
    const off = Math.abs(to.s - v.s) + Math.abs(to.x - v.x) + Math.abs(to.y - v.y) + Math.abs(v.ox) + Math.abs(v.oy);
    const end = () => { if (s <= 1.02) { v.s = 1; v.x = v.y = 0; } moving(v, false); render(v); sized(v); };
    if (off > 0.5) tween(v, to, 240, end); else { Object.assign(v, to); end(); }
  }
  // zoom to s around the screen point (px, py), animated
  function zoomTo(v, s, px, py) {
    stop(v);
    const cx = px - v.W / 2, cy = py - v.H / 2, k = s / v.s, b = bounds(v, s);
    tween(v, { s, x: clamp(cx - (cx - v.x) * k, -b.x, b.x), y: clamp(cy - (cy - v.y) * k, -b.y, b.y), ox: 0, oy: 0 }, 280, () => settle(v));
  }

  // ---------- next / previous: the card slides off, the next slides in
  function nav(v, dir) {
    const j = v.i + dir;
    if (v.closing || j < 0 || j >= v.cards.length) { if (v.ox) tween(v, { ox: 0 }, 220, () => settle(v)); return; }
    const swap = () => {
      v.i = j; v.s = 1; v.x = v.y = v.oy = 0; v.ox = dir * v.W * 0.5; show(v);
      v.said.textContent = v.name(v.cards[j]);
      v.onNav?.(v.cards[j]);
      tween(v, { ox: 0 }, 220, () => settle(v));
      render(v);
    };
    if (reduced()) { swap(); v.ox = 0; render(v); return; }
    tween(v, { ox: -dir * v.W, s: Math.min(v.s, 1) }, 170, swap);
  }

  // ---------- close: back into the card on the page (or a fade), then gone
  function close(v) {
    if (v.closing) return; v.closing = true;
    stop(v); v.P.clear(); v.g = null;
    const src = v.from?.(); if (src && src !== v.src) { if (v.src) v.src.style.visibility = ''; v.src = src; src.style.visibility = 'hidden'; window.Holo?.hold(src, true); }
    const r = src?.isConnected ? src.getBoundingClientRect() : null;
    const end = () => { if (v.d.open) v.d.close(); else finish(v); };
    if (reduced()) return end();
    if (r && r.width) tween(v, { s: r.width / v.cw, x: r.left + r.width / 2 - v.W / 2, y: r.top + r.height / 2 - v.H / 2, ox: 0, oy: 0, fade: 1 }, 230, end);
    else tween(v, { s: v.s * 0.9, oy: v.oy + (v.oy > 0 ? v.H * 0.3 : 0), fade: 1 }, 200, end);
  }
  function finish(v) {
    if (V !== v) return; V = null;
    v.ac.abort(); cancelAnimationFrame(v.raf); clearTimeout(v.sharp);
    if (v.src) { v.src.style.visibility = ''; window.Holo?.hold(v.src, false); }
    v.d.remove();
    if (v.pushed && history.state?.zv) history.back();
    const back = (v.src?.isConnected && v.src.closest('.cwrap')?.querySelector('.zv-open')) || v.opener; // focus goes back to the expand button
    back?.focus?.({ preventScroll: true });
  }

  // ---------- gestures: pointer events, values only; the frame writes them
  function gestures(v, sig) {
    const { stage, P } = v;
    // times are the events' own (e.timeStamp): a busy frame doesn't make a quick flick look slow
    let T = 0; const now = () => T;
    const track = (g, px, py) => { const t = now(); g.tr.push({ t, x: px, y: py }); while (g.tr.length > 2 && t - g.tr[0].t > 100) g.tr.shift(); };
    const vel = (g) => { if (g.tr.length < 2) return { x: 0, y: 0 }; const a = g.tr[0], b = g.tr[g.tr.length - 1], dt = b.t - a.t; return dt > 8 && now() - b.t < 80 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 }; };
    // the light follows the finger or mouse over the card (its box at zoom 1, from layout: no reads)
    const aim = (px, py) => { if (v.s > 1.02 || !window.Holo) return;
      const l = (v.W - v.cw) / 2, t = (v.H - v.ch) / 2; window.Holo.aim(v.f, (px - l) / v.cw * 2 - 1, (py - t) / v.ch * 2 - 1); };
    const onCard = (px, py) => { const w = v.cw * v.s, h = v.ch * v.s, l = v.W / 2 + v.x - w / 2, t = v.H / 2 + v.y - h / 2; return px >= l && px <= l + w && py >= t && py <= t + h; };
    const mid = () => { const [a, b] = [...P.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    const startPinch = () => { const m = mid(); v.g = { kind: 'pinch', d0: m.d, s0: v.s, mx0: m.x, my0: m.y, x0: v.x, y0: v.y, tr: [] }; v.ox = v.oy = 0; moving(v, true); };
    const startPan = (p, fresh) => { v.g = { kind: 'pan', px: p.x, py: p.y, x0: v.x, y0: v.y, tr: [], t0: now(), tap: !!fresh, card: true }; moving(v, true); };
    const rubber = (val, lim) => (val > lim ? lim + (val - lim) * 0.35 : val < -lim ? -lim + (val + lim) * 0.35 : val);

    stage.addEventListener('pointerdown', (e) => {
      T = e.timeStamp;
      if (v.closing || (e.pointerType === 'mouse' && e.button !== 0)) return;
      stage.setPointerCapture?.(e.pointerId);
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (v.anim?.to && 'fade' in v.anim.to) return; // still opening or closing
      stop(v);
      if (P.size === 2) return startPinch();
      if (P.size > 2) return;
      if (v.s > 1.02) { stop(v); return startPan({ x: e.clientX, y: e.clientY }, true); }
      v.g = { kind: 'pending', px: e.clientX, py: e.clientY, t0: now(), type: e.pointerType, card: onCard(e.clientX, e.clientY), tr: [] };
      track(v.g, e.clientX, e.clientY);
      if (e.pointerType !== 'mouse') window.Holo?.hold(v.f, true); // a finger down: the light waits (the frame stays free) until it's a tilt
    }, sig);

    stage.addEventListener('pointermove', (e) => {
      T = e.timeStamp;
      if (!P.has(e.pointerId)) { if (e.pointerType === 'mouse' && !v.closing && !v.anim) aim(e.clientX, e.clientY); return; } // hover: the light follows
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = v.g; if (!g) return;
      if (g.kind === 'pinch') {
        if (P.size < 2) return;
        const m = mid(), s = g.s0 * m.d / g.d0, ns = s < 1 ? 1 - (1 - s) * 0.5 : s > MAX ? MAX + (s - MAX) * 0.3 : s;
        const cx = g.mx0 - v.W / 2, cy = g.my0 - v.H / 2, k = ns / g.s0;
        v.s = ns; v.x = (m.x - v.W / 2) - (cx - g.x0) * k; v.y = (m.y - v.H / 2) - (cy - g.y0) * k;
        track(g, m.x, m.y); return frame(v);
      }
      track(g, e.clientX, e.clientY);
      const dx = e.clientX - g.px, dy = e.clientY - g.py;
      if (g.kind === 'pan') {
        if (g.tap && Math.hypot(dx, dy) < 10) return; // still a tap (double tap zooms back out)
        g.tap = false;
        const b = bounds(v, v.s); v.x = rubber(g.x0 + dx, b.x); v.y = rubber(g.y0 + dy, b.y); return frame(v);
      }
      if (g.kind === 'pending') {
        if (Math.hypot(dx, dy) < 10) return;
        // a quick flick (or a mouse drag) is a swipe; a slow drag over the card tilts it under the light
        const speed = Math.hypot(dx, dy) / Math.max(1, now() - g.t0);
        if (g.type === 'mouse' || speed > 0.45 || !g.card) g.kind = Math.abs(dx) > Math.abs(dy) ? 'sx' : 'sy';
        else { g.kind = 'tilt'; window.Holo?.hold(v.f, false); }
        if (g.kind !== 'tilt') { stop(v); moving(v, true); g.px = e.clientX - Math.sign(dx) * 10 * (g.kind === 'sx'); g.py = e.clientY - Math.sign(dy) * 10 * (g.kind === 'sy'); }
      }
      if (g.kind === 'tilt') return aim(e.clientX, e.clientY);
      if (g.kind === 'sx') { const ddx = e.clientX - g.px, edge = (ddx > 0 && v.i === 0) || (ddx < 0 && v.i === v.cards.length - 1); v.ox = edge ? ddx * 0.3 : ddx; }
      else { const ddy = e.clientY - g.py; v.oy = ddy > 0 ? ddy * 0.85 : ddy * 0.2; } // follows the finger down, a little heavy
      frame(v);
    }, sig);

    const up = (e) => {
      T = e.timeStamp;
      if (!P.has(e.pointerId)) return;
      P.delete(e.pointerId);
      const g = v.g; if (!g || v.closing) return;
      if (g.kind === 'pinch') {
        if (P.size === 1) { const [p] = P.values(); return startPan(p); } // one finger stays: it pans on
        if (P.size) return;
        const vv = vel(g); v.g = null;
        if (v.s < 1.02) return settle(v);
        v.anim = { kind: 'momentum', vx: vv.x, vy: vv.y }; return frame(v);
      }
      if (P.size) return;
      v.g = null;
      const vv = vel(g);
      if (g.kind === 'pan') {
        if (g.tap && e.type === 'pointerup' && now() - g.t0 < 350) { settle(v); return tap(e.clientX, e.clientY, g); }
        if (reduced() || Math.hypot(vv.x, vv.y) < 0.05) return settle(v);
        v.anim = { kind: 'momentum', vx: vv.x, vy: vv.y }; return frame(v);
      }
      if (g.kind === 'sx') {
        const dir = v.ox < 0 ? 1 : -1;
        if (Math.abs(v.ox) > v.W * 0.2 || (Math.abs(vv.x) > 0.5 && Math.sign(vv.x) === -dir)) return nav(v, dir);
        return settle(v);
      }
      if (g.kind === 'sy') {
        if (v.oy > v.H * 0.16 || (vv.y > 0.6 && v.oy > 20)) return close(v);
        return settle(v);
      }
      if (g.kind === 'pending') {
        if (v.s <= 1.02) window.Holo?.hold(v.f, false);
        if (e.type === 'pointerup' && now() - g.t0 < 350) tap(e.clientX, e.clientY, g);
      }
    };
    stage.addEventListener('pointerup', up, sig);
    stage.addEventListener('pointercancel', up, sig);
    stage.addEventListener('lostpointercapture', up, sig);

    // a tap outside the card closes; a double tap zooms in there, or back out
    function tap(px, py, g) {
      const t = now(), last = v.lastTap;
      if (last && t - last.t < 320 && Math.hypot(px - last.x, py - last.y) < 40) {
        v.lastTap = null;
        return v.s > 1.02 ? zoomTo(v, 1, v.W / 2, v.H / 2) : zoomTo(v, TAP_ZOOM, px, py);
      }
      if (!g.card && v.s <= 1.02) return close(v);
      v.lastTap = { t, x: px, y: py };
    }
    // the mouse wheel (and a trackpad pinch) zooms around the pointer
    let wheelEnd = 0;
    stage.addEventListener('wheel', (e) => {
      e.preventDefault(); if (v.closing) return;
      stop(v);
      const s = clamp(v.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), 1, MAX), cx = e.clientX - v.W / 2, cy = e.clientY - v.H / 2, k = s / v.s, b = bounds(v, s);
      v.s = s; v.x = clamp(cx - (cx - v.x) * k, -b.x, b.x); v.y = clamp(cy - (cy - v.y) * k, -b.y, b.y);
      moving(v, true); frame(v);
      clearTimeout(wheelEnd); wheelEnd = setTimeout(() => settle(v), 160);
    }, { ...sig, passive: false });
  }

  // device tilt moves the light, where it asks no permission (iOS asks: skipped)
  function tiltByDevice(v, sig) {
    if (!window.DeviceOrientationEvent || typeof DeviceOrientationEvent.requestPermission === 'function') return;
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || v.P.size || v.s > 1.02 || v.closing || !window.Holo) return;
      window.Holo.aim(v.f, clamp(e.gamma / 30, -1, 1), clamp((e.beta - 45) / 30, -1, 1));
    }, sig);
  }

  // the first time only: a small "Pinch to zoom" (phones) or "Scroll to zoom" that fades
  function hint(d) {
    let seen = false; try { seen = localStorage.getItem('zv-hint') === '1'; localStorage.setItem('zv-hint', '1'); } catch { /* no storage */ }
    if (seen) return;
    const p = el('p', 'zv-hint', { 'aria-hidden': 'true' });
    p.textContent = matchMedia('(pointer: coarse)').matches ? 'Pinch to zoom' : 'Scroll to zoom';
    d.append(p);
  }

  /** The small expand button that sits on a card and opens the viewer. */
  const expandButton = (label, onclick) => { const b = el('button', 'zv-open', { type: 'button', 'aria-label': label }); b.innerHTML = ICON.expand; b.addEventListener('click', onclick); return b; };
  window.Zoom = { open, expandButton, get isOpen() { return !!V; } };
})();
