/* Omni Cardworks (fun layer): the workshop tour and the first-open coach marks.
   Tour: three stops on the scene (the furnace, the press, your desk), one line each, a ring that follows the scene
   (and the phone's camera), Skip any time. Shown once by itself (localStorage), and again from Help (Info), the
   menu or "New here?". It never blocks the page: only its own card takes taps.
   Coach marks: your first real pack (never a practice one) gets a few pointers: tear it, turn the card, the pull, then
   "keep them safe: case". Once. */
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
    T = { root, ring, i: -1, raf: 0, auto };
    const end = () => { if (!T) return; cancelAnimationFrame(T.raf); dispatchEvent(new CustomEvent('scene-fx', { detail: { look: { s: 0 } } })); window.Scene.home?.(); root.remove(); T = null; removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape' && !window.Sheet?.covering) { e.preventDefault(); end(); } };
    addEventListener('keydown', key, true);
    skip.onclick = end;
    extra.onclick = () => { end(); Fun.go('practice'); };
    next.onclick = () => (T.i < STOPS.length - 1 ? go(T.i + 1) : end());
    T.end = end;
    function go(i) {
      T.i = i; const s = STOPS[i], last = i === STOPS.length - 1;
      title.textContent = s.t; line.textContent = s.s; next.textContent = last ? 'Done' : 'Next';
      extra.hidden = !last; dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
      dispatchEvent(new CustomEvent('scene-fx', { detail: { look: { x: s.x, y: s.y, z: s.z, s: 30 } } })); // phones: the camera goes there
      next.focus({ preventScroll: true });
    }
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
  Fun.open.tour = () => { T?.end(); start(); };
  // once by itself: the first visit, after the page settles, when nothing else is open
  const params = new URLSearchParams(location.search);
  if (!mem(SEEN) && !params.has('show')) {
    let tries = 0;
    const tryStart = () => { if (mem(SEEN) || T) return; if (window.Sheet?.covering || document.hidden || !window.Scene) { if (++tries < 40) setTimeout(tryStart, 1500); return; } start({ auto: true }); };
    setTimeout(tryStart, 1600);
  }

  // ---------- coach marks: the first real open
  let C = null; // { step, el }
  const coached = () => !!mem(COACHED);
  function mark(target, text, { done, place = 'below' } = {}) {
    unmark();
    const host = target?.closest('dialog'); if (!host) return;
    const el = h('div', { class: 'fun-coach ' + place, role: 'note' }, h('span', { text })); // never takes taps: it points, the page works under it
    if (done) setTimeout(() => { if (C?.el === el) unmark(); done(); }, 7000);
    host.append(el); C = { el, target, host };
    const put = () => {
      if (!C || C.el !== el || !target.isConnected) return;
      const r = target.getBoundingClientRect(), hr = host.getBoundingClientRect(), w = el.offsetWidth;
      const x = Math.max(8, Math.min(hr.width - w - 8, r.left - hr.left + r.width / 2 - w / 2));
      const y = place === 'above' ? r.top - hr.top - el.offsetHeight - 10 : r.bottom - hr.top + 10;
      el.style.transform = `translate(${x.toFixed(0)}px, ${Math.max(8, y).toFixed(0)}px)`;
    };
    put(); setTimeout(put, 600); // after the card settles in
  }
  function unmark() { C?.el.remove(); C = null; }
  Fun.on('pack-shown', ({ el, practice }) => { if (practice || coached()) return; mark(el, 'Your first pack! Drag across the top to tear it.'); });
  Fun.on('tear', () => unmark());
  Fun.on('card-ready', ({ el, i, practice }) => { if (practice || coached() || i !== 0) return; mark(el, 'Tap the card to turn it over.'); });
  Fun.on('flip', ({ el, tier, last, practice }) => {
    if (practice || coached()) return;
    unmark();
    if (tier) mark(el, 'That glow means a rare pull!');
    else if (last) mark(el, 'Rarest card comes last. Swipe on.');
  });
  Fun.on('opened', ({ host, practice }) => {
    if (practice || coached()) return;
    unmark();
    setTimeout(() => { const t = host?.querySelector('.cel-protect') || host?.querySelector('.wz-steps li:nth-child(2)') || host?.querySelector('.wz-steps'); if (t) mark(t, 'Keep them safe: a case stops wear.', { done: () => mem(COACHED, 1) }); mem(COACHED, 1); }, 500);
  });
})();
