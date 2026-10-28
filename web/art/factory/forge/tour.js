/* Omni Cardworks (fun layer): the workshop tour and the first pack's hand.
   Tour: three stops on the scene (the furnace, the press, your desk), one line each, a ring that follows the scene
   (and the phone's camera), Skip any time. Shown once by itself (localStorage), and again from Help (Info), the
   menu or "New here?". It never blocks the page: only its own card takes taps.
   The first real pack (never a practice one): a small hand rides the tear line's dot, showing the drag. No words; it
   fades at the first touch and never shows again once that pack is torn. */
(() => {
  const { h, mem, reduced } = Fun;
  const SEEN = 'omni.tour', COACHED = 'omni.coached';
  const STOPS = [
    { x: 627, y: 900, r: 330, z: 1.35, t: 'The furnace', s: 'PLANK is the wood. It keeps this fire roaring, and the fire runs the press.' },
    { x: 2280, y: 600, r: 400, z: 1.3, t: 'The press', s: 'Every card is printed on PAPER. Packs come out sealed, and nobody knows what’s inside until you rip one.' },
    { x: 1880, y: 1400, r: 620, z: 1.1, t: 'Your desk', s: 'Rip your packs here. Case your keepers, grade your best, and burn the rest toward free packs.' },
  ];
  let T = null; // the running tour

  function start({ auto = false } = {}) {
    if (T || !window.Scene) return;
    mem(SEEN, 1);
    const ring = h('div', { class: 'ft-ring', 'aria-hidden': 'true' });
    const title = h('b', { class: 'ft-t' }), line = h('p', { class: 'ft-s' }), dots = h('span', { class: 'ft-dots', 'aria-hidden': 'true' }, STOPS.map(() => h('i')));
    const next = h('button', { type: 'button', class: 'btn primary small ft-next' }), skip = h('button', { type: 'button', class: 'btn small ft-skip', text: 'Skip' });
    const extra = h('button', { type: 'button', class: 'btn gold small ft-prac', text: 'Rip a practice pack', hidden: true });
    const card = h('div', { class: 'ft-card', role: 'dialog', 'aria-label': 'Workshop tour', 'aria-live': 'polite' }, h('div', { class: 'ft-text' }, title, line), dots, h('div', { class: 'ft-acts' }, skip, extra, next));
    const root = h('div', { class: 'fun-tour' + (reduced() ? ' still' : '') }, ring, card);
    document.body.append(root);
    document.body.classList.add('touring'); // the scene's overlays (gauges, tally, shelf, pills) fade back while the tour talks
    T = { root, ring, i: -1, raf: 0, auto, dodgeT: 0 };
    const end = () => { if (!T) return; cancelAnimationFrame(T.raf); clearTimeout(T.dodgeT); dispatchEvent(new CustomEvent('scene-fx', { detail: { look: { s: 0 } } })); window.Scene.home?.(); root.remove(); T = null; document.body.classList.remove('touring'); removeEventListener('keydown', key, true); removeEventListener('resize', dodgeSoon); };
    const key = (e) => { if (e.key === 'Escape' && !window.Sheet?.covering) { e.preventDefault(); end(); } };
    addEventListener('keydown', key, true);
    skip.onclick = end;
    extra.onclick = () => { end(); Fun.go('practice'); };
    // the end: packs waiting to open? the tour's last button opens them; otherwise Done, and the page's main button
    // gives a little pulse so the next step is plain
    const waiting = () => window.Stations?.openableCount?.() || 0;
    next.onclick = () => {
      if (T.i < STOPS.length - 1) return go(T.i + 1);
      const n = waiting(); end();
      if (n) return window.Stations?.open('open');
      pulseMain();
    };
    T.end = end;
    function go(i) {
      T.i = i; const s = STOPS[i], last = i === STOPS.length - 1, n = last ? waiting() : 0;
      title.textContent = s.t; line.textContent = s.s; next.textContent = !last ? 'Next' : n ? `Open your ${n === 1 ? 'pack' : `${n} packs`}` : 'Done';
      next.classList.toggle('gold', !!n); next.classList.toggle('primary', !n);
      extra.hidden = !last || !!n; dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
      dispatchEvent(new CustomEvent('scene-fx', { detail: { look: { x: s.x, y: s.y, z: s.z, s: 30 } } })); // phones: the camera goes there
      next.focus({ preventScroll: true });
      card.classList.remove('alt'); dodgeSoon();
    }
    // the card never sits on the stop it talks about: once the camera has settled, if the ring and the card meet, the
    // card moves to the other side (desktop: left; phones: under the scene or over the Buy bar; sideways: the left)
    const meets = (cx, cy, r) => { const b = card.getBoundingClientRect(), nx = Math.max(b.left, Math.min(cx, b.right)), ny = Math.max(b.top, Math.min(cy, b.bottom)); return Math.hypot(cx - nx, cy - ny) < r * 0.8; };
    function dodge() {
      if (!T) return;
      const s = STOPS[Math.max(0, T.i)], [x, y] = Scene.toScreen(s.x, s.y), [x2] = Scene.toScreen(s.x + s.r, s.y), r = Math.max(60, Math.abs(x2 - x));
      if (!meets(x, y, r)) return;
      card.classList.toggle('alt');
      if (meets(x, y, r)) card.classList.toggle('alt'); // both sides meet it: the usual place
    }
    function dodgeSoon() { clearTimeout(T?.dodgeT); if (T) T.dodgeT = setTimeout(dodge, reduced() ? 60 : 650); }
    addEventListener('resize', dodgeSoon);
    // the ring follows its stop every frame (the phone's camera moves): transform only, no layout reads
    const follow = () => {
      if (!T) return;
      if (window.Sheet?.covering) { end(); return; } // something else opened: the tour steps aside
      const s = STOPS[Math.max(0, T.i)], [x, y] = Scene.toScreen(s.x, s.y), [x2] = Scene.toScreen(s.x + s.r, s.y), r = Math.max(60, Math.abs(x2 - x));
      ring.style.transform = `translate(${(x - 100).toFixed(1)}px, ${(y - 100).toFixed(1)}px) scale(${(r / 100).toFixed(3)})`;
      T.raf = requestAnimationFrame(follow);
    };
    go(0); follow();
  }
  /** The page's one main button (Open packs, Buy a pack or See your cards) pulses twice. */
  function pulseMain() {
    const port = document.body.dataset.mode !== 'desk', buy = document.body.classList.contains('hero-buy');
    const b = buy ? document.querySelector(port ? '#buybar [data-buy]:not(.off)' : '#buybox [data-buy]:not(.off)') : document.querySelector(port ? '#openBtn' : '.pill.hero');
    if (!b || reduced()) return b?.focus({ preventScroll: true });
    b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge'); b.focus({ preventScroll: true });
    setTimeout(() => b.classList.remove('nudge'), 1600);
  }
  Fun.open.tour = () => { T?.end(); start(); };
  // once by itself: the first visit, after the page settles, when nothing else is open
  const params = new URLSearchParams(location.search);
  if (!mem(SEEN) && !params.has('show') && !params.has('go')) { // never over a shared link
    let tries = 0;
    const tryStart = () => { if (mem(SEEN) || T) return; if (window.Sheet?.covering || document.hidden || !window.Scene) { if (++tries < 40) setTimeout(tryStart, 1500); return; } start({ auto: true }); };
    setTimeout(tryStart, 1600);
  }

  // ---------- the first real pack: a hand showing the drag across the top (screens.css .pk-hand), no words
  const HAND = '<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M10.2 2.6c0-1.3 1-2.2 2.2-2.2s2.2.9 2.2 2.2v9.1l.3-.1c1.3-.3 2.4.4 2.6 1.4l.1.3c1.3-.4 2.5.3 2.7 1.4l.1.4c1.3-.2 2.3.6 2.3 1.8v4.6c0 4.6-3.4 8.1-7.9 8.1h-1.2c-2.6 0-4.6-1.1-6-3.2l-4.1-6.3c-.7-1.1-.4-2.4.6-3 1-.6 2.2-.3 2.9.6l1.9 2.5z" fill="#fffaf0" stroke="#2a1a05" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Fun.on('pack-shown', ({ el, practice }) => {
    if (practice || mem(COACHED)) return;
    if (!el || el.querySelector('.pk-hand')) return;
    const hand = h('i', { class: 'pk-hand', 'aria-hidden': 'true' }, h('b', { html: HAND }));
    el.append(hand);
    const fade = () => { hand.classList.add('gone'); setTimeout(() => hand.remove(), 400); };
    el.addEventListener('pointerdown', fade, { once: true }); el.addEventListener('keydown', fade, { once: true });
  });
  Fun.on('tear', ({ practice } = {}) => { document.querySelectorAll('.pk-hand').forEach((x) => x.remove()); if (!practice) mem(COACHED, 1); });
})();
