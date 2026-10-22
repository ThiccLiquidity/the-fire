/* Omni Cardworks (fun layer): feel. Haptics on the tear, a rare pull, a case snapping shut and a grade stamp (Android;
   iPhones ignore vibrate), with an on/off setting next to Sound. The workshop reacts: a rare or better pull, or a PDA
   10, makes the furnace flare in that card's colour once the sheet closes, and after a buy, case or grade the
   furnace eats a few sheets of PAPER (animation only). And the slab press: a grade's slab presses down before its
   grade shows. Effects are drawn on one overlay canvas over the scene (transform-free: only while something plays),
   the scene itself is nudged through its 'scene-fx' event (scene.js). Reduced motion: short glows, no sparks. */
(() => {
  const { h, mem, reduced } = Fun;

  // ---------- haptics
  const HKEY = 'omni.haptics';
  let hOn = mem(HKEY) !== false;
  const can = () => 'vibrate' in navigator;
  const buzz = (p) => { if (hOn && can()) try { navigator.vibrate(p); } catch { /* not allowed now */ } };
  const PAT = { tear: 18, case: 22, stamp: [14, 40, 70], rare: [30, 40, 30], epic: [40, 50, 40, 50, 60], legendary: [60, 40, 60, 40, 220], g10: [60, 40, 60, 40, 220] };
  Fun.haptics = { get on() { return hOn; }, get supported() { return can(); }, set(on) { hOn = !!on; mem(HKEY, hOn); if (hOn) buzz(20); return hOn; } };
  Fun.on('tear', () => buzz(PAT.tear));
  Fun.on('flip', ({ tier }) => { if (tier) buzz(PAT[tier]); });
  Fun.on('case', () => buzz(PAT.case));
  Fun.on('graded', ({ grade }) => buzz(grade === 10 ? PAT.g10 : PAT.stamp));

  // ---------- the slab press: the press comes down on the slab before its grade shows (screens.js awaits it)
  Fun.slabPress = (tile) => {
    const wrap = tile?.querySelector('.cwrap'); if (!wrap || reduced()) return Promise.resolve();
    const plate = h('i', { class: 'fun-plate', 'aria-hidden': 'true' }); wrap.append(plate);
    const T = 560;
    plate.animate([{ transform: 'translateY(-115%)', opacity: 0 }, { transform: 'translateY(-115%)', opacity: 1, offset: 0.12 }, { transform: 'translateY(0)', opacity: 1, offset: 0.42 },
      { transform: 'translateY(0)', opacity: 1, offset: 0.7 }, { transform: 'translateY(-115%)', opacity: 0 }], { duration: T, easing: 'cubic-bezier(.5,0,.3,1)' });
    const face = wrap.querySelector('.cface') || wrap;
    face.animate([{ transform: 'none' }, { transform: 'none', offset: 0.4 }, { transform: 'translateY(3%) scale(.95)', offset: 0.5 }, { transform: 'translateY(3%) scale(.95)', offset: 0.7 }, { transform: 'none' }],
      { duration: T, easing: 'ease-out' });
    return new Promise((ok) => setTimeout(() => { plate.remove(); ok(); }, T));
  };

  // ---------- the workshop reacts: an overlay canvas over the scene, drawn only while an effect runs
  const COL = { paper: ['#fff6dc', '#ffe7a8'], wood: ['#ffd08a', '#ff9f2e'], fire: ['#ff9a3c', '#ff3a12'], charcoal: ['#ffb070', '#e0260c'], diamond: ['#d8f0ff', '#9fd8ff'],
    gold: ['#ffe08a', '#ffb81c'], fullart: ['#ff8ae0', '#8affd0', '#8ad8ff', '#ffe98a'], g10: ['#fff6d6', '#ffc23a'] };
  const FURNACE = [627, 930], MOUTH = [627, 965];
  let cv = null, g = null, raf = 0;
  const fx = []; // running effects: { kind, t0, dur, ... }
  const paperImg = new Image(); paperImg.src = 'a/s-paper0.webp';
  function canvas() {
    if (cv) return cv;
    cv = h('canvas', { class: 'fun-fx', 'aria-hidden': 'true' }); document.body.append(cv); g = cv.getContext('2d');
    return cv;
  }
  const sceneOn = () => !document.hidden && !window.Sheet?.covering && !window.Zoom?.isOpen && !!window.Scene;
  const pt = (x, y) => window.Scene.toScreen(x, y);
  const span = (d) => { const [a] = pt(FURNACE[0], FURNACE[1]), [b] = pt(FURNACE[0] + d, FURNACE[1]); return Math.abs(b - a); };
  function tick(t) {
    raf = 0; if (!cv) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!sceneOn()) { if (fx.length) raf = requestAnimationFrame(tick); return; } // paused under a sheet
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i]; e.t0 ??= t; const u = (t - e.t0) / e.dur;
      if (u >= 1) { fx.splice(i, 1); continue; }
      if (u < 0) continue;
      if (e.kind === 'glow') drawGlow(e, u); else if (e.kind === 'paper') drawPaper(e, u, t);
    }
    if (fx.length) raf = requestAnimationFrame(tick); else g.clearRect(0, 0, W, H);
  }
  const kick = () => { canvas(); if (!raf) raf = requestAnimationFrame(tick); };
  function drawGlow(e, u) {
    const [x, y] = pt(...FURNACE), r = span(e.r || 640), a = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (e.a || 0.55);
    g.save(); g.globalCompositeOperation = 'lighter';
    const cols = e.cols, c0 = cols.length > 2 ? cols[Math.floor(u * 10) % cols.length] : cols[0];
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, hexA(c0, a)); gr.addColorStop(0.35, hexA(cols[1], a * 0.45)); gr.addColorStop(1, hexA(cols[1], 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    if (e.sparks) for (const p of e.sparks) { // sparks in the card's colours, out of the furnace mouth
      const k = u * e.dur / 1000, px = x + p.vx * k * r, py = y + (p.vy * k + 0.9 * k * k) * r; if (k > p.life) continue;
      g.globalAlpha = 1 - k / p.life; g.fillStyle = p.c; g.beginPath(); g.arc(px, py, p.s, 0, 7); g.fill();
    }
    g.restore();
  }
  function drawPaper(e, u, t) { // a sheet flutters down into the furnace mouth, curls, darkens and goes
    if (!paperImg.complete || !paperImg.naturalWidth) return;
    const [mx, my] = pt(...MOUTH), k = span(100) / 100, e2 = u * u;
    const x = mx + (e.dx * (1 - e2) + Math.sin(u * 7 + e.ph) * 14 * (1 - u)) * k, y = my - (420 - 420 * e2) * k;
    const w = 150 * k * (1 - 0.5 * u), hh = w * paperImg.naturalHeight / paperImg.naturalWidth;
    g.save(); g.translate(x, y); g.rotate(e.rot + u * e.spin); g.scale(Math.cos(u * 9 + e.ph) * 0.8 + 0.2, 1);
    g.globalAlpha = Math.min(1, u * 5) * (1 - Math.max(0, (u - 0.8) / 0.2));
    g.filter = `brightness(${1 - u * 0.55}) sepia(${u})`;
    g.drawImage(paperImg, -w / 2, -hh / 2, w, hh); g.restore();
    if (!e.lit && u > 0.86) { e.lit = true; scene({ flare: 0.35, sparks: 6, x: FURNACE[0] + e.dx * 0.4, y: 985, power: 0.5 }); }
  }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, a).toFixed(3)})`; };
  const scene = (d) => dispatchEvent(new CustomEvent('scene-fx', { detail: d }));
  // phones (the follow camera): look at the furnace while it plays
  const look = (s) => { if (document.body.dataset.mode === 'port') scene({ look: { x: 640, y: 860, z: 1.45, s } }); };

  // effects wait until the scene shows again (the sheet that caused them is closed)
  const waiting = [];
  function later(fn) { waiting.push(fn); pump(); }
  let pumpT = 0;
  function pump() { clearTimeout(pumpT); if (!waiting.length) return; if (!sceneOn()) { pumpT = setTimeout(pump, 400); return; } pumpT = setTimeout(() => { if (!sceneOn()) return pump(); while (waiting.length) waiting.shift()(); }, 450); }

  /** The furnace flares in a card's colour (kind: material, or 'g10'); big: Epic and up / PDA 10. */
  function flareFor(kind, big) {
    const cols = COL[kind] || COL.fire, rm = reduced();
    look(3);
    setTimeout(() => {
      scene({ flare: big ? 2.2 : 1.2, sparks: rm ? 0 : big ? 50 : 22, power: big ? 1.3 : 0.9, shake: big ? 0.5 : 0 });
      const sparks = rm ? null : Array.from({ length: big ? 70 : 30 }, (_, i) => { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 0.35 + Math.random() * 0.9;
        return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7 + Math.random() * 1.1, s: 1.2 + Math.random() * 2.4, c: cols[i % cols.length] }; });
      fx.push({ kind: 'glow', dur: rm ? 1400 : big ? 2800 : 2000, cols, a: big ? 0.75 : 0.5, r: big ? 760 : 560, sparks }); kick();
    }, document.body.dataset.mode === 'port' ? 650 : 0);
  }
  Fun.flare = flareFor;
  /** The furnace eats n sheets of PAPER. */
  function eat(n = 3) {
    look(2.6);
    for (let i = 0; i < n; i++) fx.push({ kind: 'paper', t0: performance.now() + 250 + i * 260, dur: 1300, dx: -70 + Math.random() * 140, ph: Math.random() * 6, rot: (Math.random() - 0.5) * 0.6, spin: (Math.random() - 0.5) * 2 });
    kick();
  }
  Fun.eat = eat;
  // your pulls: the best of the pack sets the flare (Rare and up); a PDA 10 in gold
  const RANK = { rare: 1, epic: 2, legendary: 3 };
  Fun.on('opened', ({ cards = [], practice }) => {
    if (practice) return;
    const best = cards.map((c) => ({ r: RANK[Store.trueOdds(c).tier] || 0, kind: c.material })).sort((a, b) => b.r - a.r)[0];
    if (best?.r) later(() => flareFor(best.kind, best.r >= 2));
  });
  Fun.on('graded', ({ grade }) => { if (grade === 10) later(() => flareFor('g10', true)); });
  // the burn you can watch: a buy, a case or a grade feeds the furnace a little PAPER
  Fun.on('bought', ({ n = 1 }) => later(() => eat(Math.min(4, 1 + n))));
  Fun.on('paid', () => later(() => eat(3)));
  // someone else's big pull (the feed): a small flare, at most one every 20 s
  let lastOther = 0;
  Fun.on('others-pull', ({ material }) => { if (performance.now() - lastOther < 20000 || !sceneOn()) return; lastOther = performance.now(); flareFor(material, false); });
})();
