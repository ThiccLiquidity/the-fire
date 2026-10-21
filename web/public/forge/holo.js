/* Omni Cardworks (demo mode): the live holo. The Card Studio draws holo into every saved card image at one angle
   (studio/src/holoFx.ts); on the site a raw holo card moves: the same rainbow foil, sparkles and glare, redrawn at the
   tilt of the mouse or finger, between the card's plain picture + frame (cards/<id>/<material>-plain.webp) and its
   print (name, text, seal: <material>-print.webp), so the holo never covers the text. Gold: gold leaf and gold holo
   on the picture, a band of light across the frame. Full Art: holo all over. Same numbers as holoFx.ts. */
(() => {
  const BASE = 750; // the effects were tuned on a 750 px wide card; sizes scale from that
  const ART = { x: 64, y: 148, w: 622, h: 622 }, RADIUS = 46.5, INSET = 4;
  const STILL = { tx: -0.4, ty: -0.4, o: 1 };
  const rng = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  function makeSpecks(seed, n) { const r = rng(seed), out = [];
    for (let i = 0; i < n; i++) { const k = r(); out.push({ x: r(), y: r(), ax: r() * 2 - 1, ay: r() * 2 - 1, j: r(), star: k < 0.09, size: k < 0.09 ? 5 + r() * 9 : 0.8 + r() * 1.6 }); }
    return out; }
  const SPECKS = makeSpecks(11, 650), FRAME_SPECKS = makeSpecks(23, 900);
  const RAINBOW = ['#c0306a', '#c08a2a', '#b8b430', '#2fb86a', '#2aa6c0', '#5a4ac0'];
  const GOLD = { c: ['#5c3a08', '#c48a1c', '#ffd862', '#fff4c8'], h: 44, s: 100, l: 62 };
  function glitterTile(gold) { const c = mk(180, 180), g = c.getContext('2d'), r = rng(7);
    for (let i = 0; i < 420; i++) { const a = 0.3 + r() * 0.7, z = r() < 0.85 ? 1 : 2;
      g.fillStyle = gold ? `hsla(${GOLD.h + (r() - 0.5) * 14},100%,${62 + r() * 30}%,${a})` : `hsla(${Math.floor(r() * 360)},100%,${70 + r() * 30}%,${a})`;
      g.fillRect(Math.floor(r() * 180), Math.floor(r() * 180), z, z); }
    return c; }
  let T = null; // tiles, made on first use
  const tiles = () => T || (T = { rainbow: glitterTile(false), gold: glitterTile(true), scan: (() => { const c = mk(4, 3); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 1); return c; })() });
  function bands(g, b, a, period, phase, stops) { const t = a * Math.PI / 180, dx = Math.sin(t), dy = -Math.cos(t), cx = b.x + b.w / 2, cy = b.y + b.h / 2, n = 8;
    const sx = cx - dx * period * (n / 2 - phase % 1), sy = cy - dy * period * (n / 2 - phase % 1);
    const gr = g.createLinearGradient(sx, sy, sx + dx * period * n, sy + dy * period * n);
    for (let r = 0; r < n; r++) for (const [o, c] of stops) gr.addColorStop(Math.min(1, (r + o) / n), c);
    return gr; }
  const phaseOf = (tl) => (tl.tx + 1) * 0.9 + (tl.ty + 1) * 0.45;
  function pat(g, tile, tl, k) { const p = g.createPattern(tile, 'repeat'); if (p && p.setTransform) p.setTransform(new DOMMatrix().translate(-tl.tx * 60 * k, -tl.ty * 60 * k).scale(k)); return p; }
  function specks(g, list, b, tl, k, strength, gold, S) {
    for (const s of list) { const L = Math.exp(-((s.ax - tl.tx) ** 2 + (s.ay - tl.ty) ** 2) * (s.star ? 3 : 4)) * strength; if (L < 0.03) continue;
      const x = b.x + s.x * b.w, y = b.y + s.y * b.h, z = s.size * k, a = Math.min(1, L);
      const hue = gold ? GOLD.h + (s.j - 0.5) * 12 + (tl.tx + tl.ty) * 5 : (s.x * 520 + s.y * 190 + (tl.tx + tl.ty) * 160 + s.j * 90) % 360;
      const sat = gold ? GOLD.s : 100, lt = gold ? Math.min(96, GOLD.l + L * 18) : 62 + L * 10, c = `hsla(${hue},${sat}%,${lt}%,${a})`;
      g.fillStyle = c; g.strokeStyle = c;
      if (s.star) { g.lineWidth = Math.max(0.7 * S, z * 0.13); g.beginPath(); g.moveTo(x - z, y); g.lineTo(x + z, y); g.moveTo(x, y - z); g.lineTo(x, y + z);
        g.moveTo(x - z * 0.4, y - z * 0.4); g.lineTo(x + z * 0.4, y + z * 0.4); g.moveTo(x + z * 0.4, y - z * 0.4); g.lineTo(x - z * 0.4, y + z * 0.4); g.stroke();
        const rg = g.createRadialGradient(x, y, 0, x, y, z * 0.55); rg.addColorStop(0, `hsla(${hue + (gold ? 0 : 40)},${sat}%,90%,${a})`); rg.addColorStop(1, `hsla(${hue},${sat}%,60%,0)`);
        g.fillStyle = rg; g.fillRect(x - z, y - z, z * 2, z * 2); }
      else g.fillRect(x - z / 2, y - z / 2, Math.max(S, z), Math.max(S, z)); } }
  function foil(g, b, tl, list, gold, S, { k = 1, per = 0.9, sp = 1 } = {}) { const t = tiles(), [d, m, br, h] = GOLD.c;
    g.save(); g.globalCompositeOperation = 'color-dodge'; g.globalAlpha = (0.32 + tl.o * 0.4) * k;
    g.fillStyle = bands(g, b, 110, Math.hypot(b.w, b.h) * per, phaseOf(tl), gold
      ? [[0, '#000'], [0.21, '#000'], [0.28, d], [0.36, m], [0.43, br], [0.48, h], [0.52, br], [0.6, m], [0.67, d], [0.75, '#000'], [1, '#000']]
      : [[0, '#000'], [0.18, '#000'], [0.27, RAINBOW[0]], [0.345, RAINBOW[1]], [0.42, RAINBOW[2]], [0.495, RAINBOW[3]], [0.57, RAINBOW[4]], [0.645, RAINBOW[5]], [0.75, '#000'], [1, '#000']]);
    g.fillRect(b.x, b.y, b.w, b.h);
    g.globalAlpha = 0.035; g.fillStyle = pat(g, t.scan, { tx: 0, ty: 0 }, S); g.fillRect(b.x, b.y, b.w, b.h);
    g.globalAlpha = 0.1 + tl.o * 0.3; g.fillStyle = pat(g, gold ? t.gold : t.rainbow, tl, S); g.fillRect(b.x, b.y, b.w, b.h);
    g.globalAlpha = 1; g.globalCompositeOperation = 'screen'; specks(g, list, b, tl, b.w / 300 * 0.55 * sp, (0.6 + tl.o * 0.6) * sp, gold, S);
    g.restore(); }
  function glare(g, b, tl, warm, W, H) { g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.3 + tl.o * 0.45;
    const mx = W * (tl.tx + 1) / 2, my = H * (tl.ty + 1) / 2, rg = g.createRadialGradient(mx, my, 0, mx, my, Math.hypot(W, H) * 0.75);
    rg.addColorStop(0, warm ? 'rgba(255,250,230,.6)' : 'rgba(255,255,255,.6)'); rg.addColorStop(0.22, warm ? 'rgba(255,240,200,.18)' : 'rgba(255,255,255,.18)'); rg.addColorStop(0.9, 'rgba(0,0,0,.25)');
    g.fillStyle = rg; g.fillRect(b.x, b.y, b.w, b.h); g.restore(); }
  const leafCache = new Map();
  function leaf(w, h) { const key = `${Math.round(w)}x${Math.round(h)}`; if (leafCache.has(key)) return leafCache.get(key);
    const c = mk(w, h), q = c.getContext('2d'), r = rng(99); q.fillStyle = '#000';
    for (let f = 0; f < 320; f++) { const cx = r() * w, cy = r() * h, R = (r() < 0.08 ? 9 + r() * 9 : 1.5 + r() * 5.5) * (w / 597), k = 7 + Math.floor(r() * 6), rot = r() * 6.3;
      q.beginPath(); for (let v = 0; v < k; v++) { const a = rot + v / k * 6.283, rr = R * (0.45 + r() * 0.75); q[v ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr); } q.closePath(); q.fill(); }
    leafCache.set(key, c); return c; }
  function cardPath(g, W, H, S) { const x = INSET * S, y = INSET * S, w = W - 2 * x, h = H - 2 * y, r = RADIUS * S;
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // run fx on a copy of the canvas so far and keep it only where `keep` paints
  let scratch = null;
  function within(g, fx, keep) { const W = g.canvas.width, H = g.canvas.height;
    if (!scratch || scratch.width !== W || scratch.height !== H) scratch = mk(W, H);
    const q = scratch.getContext('2d'); q.save(); q.globalCompositeOperation = 'copy'; q.drawImage(g.canvas, 0, 0); q.restore();
    fx(q); q.save(); q.globalCompositeOperation = 'destination-in'; q.globalAlpha = 1; keep(q); q.restore();
    g.drawImage(scratch, 0, 0); }
  /** Draw one raw card at a tilt: plain (picture + frame), holo, print. look: none | frame | picture | full. */
  function render(g, plain, print, material, look, tl) {
    const W = g.canvas.width, H = g.canvas.height, S = W / BASE, art = { x: ART.x * S, y: ART.y * S, w: ART.w * S, h: ART.h * S }, whole = { x: 0, y: 0, w: W, h: H };
    const gold = material === 'gold', full = material === 'fullart', pic = gold || full || look === 'picture' || look === 'full', frm = full || look === 'frame' || look === 'full';
    g.clearRect(0, 0, W, H); g.drawImage(plain, 0, 0, W, H);
    const keepArt = (q) => { q.fillStyle = '#000'; q.fillRect(art.x, art.y, art.w, art.h); };
    const keepCard = (q) => { q.fillStyle = '#000'; cardPath(q, W, H, S); q.fill(); };
    const keepFrame = (q) => { keepCard(q); q.globalCompositeOperation = 'destination-out'; q.fillRect(art.x, art.y, art.w, art.h); };
    if (full) within(g, (q) => { foil(q, whole, tl, FRAME_SPECKS, false, S); glare(q, whole, tl, false, W, H); }, keepCard);
    else if (gold) {
      within(g, (q) => { const [d, m, br, h] = GOLD.c, lf = leaf(art.w, art.h), f = mk(art.w, art.h), fq = f.getContext('2d');
        fq.fillStyle = bands(fq, { x: 0, y: 0, w: art.w, h: art.h }, 115, art.w * 0.9, phaseOf(tl), [[0, d], [0.25, m], [0.42, br], [0.5, h], [0.58, br], [0.75, m], [1, d]]);
        fq.fillRect(0, 0, art.w, art.h); fq.globalCompositeOperation = 'destination-in'; fq.drawImage(lf, 0, 0);
        q.save(); q.shadowColor = 'rgba(60,35,5,.8)'; q.shadowBlur = S; q.drawImage(f, art.x, art.y); q.restore();
        foil(q, art, tl, SPECKS, true, S); glare(q, art, tl, true, W, H); }, keepArt);
      within(g, (q) => { q.save(); q.globalCompositeOperation = 'soft-light'; q.globalAlpha = 0.5 + tl.o * 0.5;
        q.fillStyle = bands(q, whole, 115, Math.hypot(W, H) * 1.6, (tl.tx + 1) * 0.55 + (tl.ty + 1) * 0.25, [[0, 'rgba(255,236,170,0)'], [0.38, 'rgba(255,236,170,0)'], [0.48, 'rgba(255,240,190,.95)'], [0.5, 'rgba(255,250,225,1)'], [0.52, 'rgba(255,240,190,.95)'], [0.62, 'rgba(255,236,170,0)'], [1, 'rgba(255,236,170,0)']]);
        q.fillRect(0, 0, W, H); q.restore(); }, keepFrame);
    } else {
      if (pic) within(g, (q) => { foil(q, art, tl, SPECKS, false, S); glare(q, art, tl, false, W, H); }, keepArt);
      if (frm) within(g, (q) => { foil(q, whole, tl, FRAME_SPECKS, false, S, { per: 0.45, sp: 1.35 }); glare(q, whole, tl, false, W, H); }, keepFrame);
    }
    g.drawImage(print, 0, 0, W, H);
  }

  // ---------- live cards on the page
  const PARTS = window.Store && Store.cardParts ? Store.cardParts : null;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const imgCache = new Map();
  const loadImg = (src) => { if (!imgCache.has(src)) imgCache.set(src, new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = no; i.src = src; })); return imgCache.get(src); };
  const live = new Set();
  // sway: the card drifts on its own when nobody is touching it (the big card, the pack reveal); otherwise it holds the
  // saved image's angle and moves only while the mouse or a finger is on it (grids and lists)
  const moving = (L, t) => L.active && t - L.last < 2500;
  function draw(el, t) {
    const L = el._holo; if (!L || !L.plain) return;
    const box = el.getBoundingClientRect(); if (!box.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.min(900, Math.round(box.width * dpr)), H = Math.round(W * 1008 / 720);
    if (L.canvas.width !== W || L.canvas.height !== H) { L.canvas.width = W; L.canvas.height = H; }
    let tl = STILL;
    if (moving(L, t)) tl = L.tilt;
    else if (L.sway && !still.matches) { const a = t / 2400 + L.phase; tl = { tx: Math.sin(a) * 0.64, ty: Math.cos(a * 0.8) * 0.48, o: 0.55 }; }
    // the card itself tips toward the light a little while it's being moved
    el.style.transform = moving(L, t) && !still.matches ? `perspective(800px) rotateY(${(tl.tx * 10).toFixed(2)}deg) rotateX(${(-tl.ty * 10).toFixed(2)}deg)` : '';
    render(L.canvas.getContext('2d'), L.plain, L.print, L.material, L.look, tl);
    L.drawnStill = tl === STILL;
  }
  let raf = 0;
  function loop(t) {
    raf = 0; let again = false;
    for (const el of live) {
      if (!el.isConnected) { live.delete(el); continue; }
      const L = el._holo; if (!L.visible) continue;
      const busy = moving(L, t) || (L.sway && !still.matches);
      if (busy || !L.drawnStill) draw(el, t);
      if (busy) again = true;
    }
    if (again) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf && live.size) raf = requestAnimationFrame(loop); };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) if (e.target._holo) e.target._holo.visible = e.isIntersecting; kick(); }) : null;
  /** Make a card face live: a raw holo card (or Gold / Full Art) with its parts on hand; sway: drift when untouched.
   *  Does nothing for any other card. */
  function attach(face, c, sway = false) {
    if (!PARTS) return;
    const parts = PARTS(c); if (!parts) return;
    const canvas = document.createElement('canvas'); canvas.className = 'cholo'; canvas.setAttribute('aria-hidden', 'true');
    face.append(canvas); face.classList.add('live');
    const L = face._holo = { canvas, material: c.material, look: parts.look, sway, plain: null, print: null, tilt: STILL, active: false, last: -1e9, visible: true, drawnStill: false, phase: Math.random() * 6 };
    Promise.all([loadImg(parts.plain), loadImg(parts.print)]).then(([p, q]) => { L.plain = p; L.print = q; face.classList.add('ready'); live.add(face); if (io) io.observe(face); draw(face, performance.now()); kick(); })
      .catch(() => { canvas.remove(); face.classList.remove('live'); });
    const point = (e) => { const b = face.getBoundingClientRect(); L.active = true; L.last = performance.now();
      L.tilt = { tx: Math.max(-1, Math.min(1, (e.clientX - b.left) / b.width * 2 - 1)), ty: Math.max(-1, Math.min(1, (e.clientY - b.top) / b.height * 2 - 1)), o: 1 };
      kick(); };
    face.addEventListener('pointermove', point); face.addEventListener('pointerdown', point);
    face.addEventListener('pointerleave', () => { L.active = false; L.last = -1e9; kick(); });
  }
  window.Holo = { render, attach, STILL };
})();
