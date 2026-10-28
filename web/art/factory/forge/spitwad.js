/* Spit-Wad Sniper (game 2, docs/spitwad-plan.md): Plank pops out from all over a cluttered card-factory floor and you
   spit wads at him through a paper straw. Hold to aim (the crosshair sits up and left of a thumb and moves 1:1 with
   it), watch the breath ring, let go in its green notch: the breath sets how far the wad flies. A round is 60 seconds
   with a goal; meet it and the next round is harder. Free play for now (competitive runs need the game server's
   round judging first).

   The scene is one painted plate (ui/spitwad/hall.webp) with the things Plank hides behind cut out of it
   (occ-*.webp) and drawn back over him, so he really is behind them. web/art/spitwad-src/cut_layers.py makes the
   files and ui/spitwad/scene.json (the spots: where he stands, how deep, how he shows). Positions are plate pixels;
   depth is inches from the camera, which sets his size, the breath's sweet spot and the flight time.

   Mount: window.SpitWad.mount(host, { onEvent, mute, haptic }) -> { destroy, state }. Hits are judged where you see
   them: as the wad passes each thing's depth, it is tested against what is drawn there (an occluder's own pixels,
   Plank's box). */
(() => {
  const BASE = 'ui/spitwad/';
  const PL = 16, G = 193, ALPHA = 3 * Math.PI / 180, SPAN = 1440, PITCH = -10 * Math.PI / 180, CAM_Y = 4 * PL;
  const PW = 1024, PH = 1536, VIEW_H = 1250;           // the plate, and how much of it the game shows (the top 81%)
  const BACK = 560;                                    // the far wall's depth (inches)
  const ROUND = 60;
  const goalFor = (r) => (r <= 3 ? [65, 70, 85][r - 1] : 5 * Math.round((50 + 14 * r + r * r) / 5));
  const TAUNTS = ['Nyah!', 'Too slow!', 'Missed me!', 'Ha!', 'Over here!', 'Nope!'];
  const PRAISE = { 3: 'HAT TRICK!', 5: 'ON FIRE!', 8: 'UNSTOPPABLE!', 12: 'PLANK PANIC!' };

  let scene = null, loading = null;
  const img = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = BASE + src; });
  /** the scene, its images, each occluder's alpha (for hits) and Plank's faces tinted to the room's warm light */
  function load() {
    return (loading ??= (async () => {
      const s = await fetch(BASE + 'scene.json').then((r) => r.json());
      const plate = await img(s.plate.src);
      const occ = {};
      await Promise.all(Object.entries(s.occluders).map(async ([k, o]) => {
        const im = await img(`occ-${k}.webp`); if (!im) return;
        const c = document.createElement('canvas'); c.width = o.w; c.height = o.h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
        const a = x.getImageData(0, 0, o.w, o.h).data, alpha = new Uint8Array(o.w * o.h); for (let i = 0; i < alpha.length; i++) alpha[i] = a[i * 4 + 3];
        occ[k] = { ...o, im, alpha };
      }));
      const faces = {};
      await Promise.all(Object.entries(s.faces).map(async ([k, f]) => {
        const im = await img(f); if (!im) return;
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        x.globalCompositeOperation = 'multiply'; x.fillStyle = 'rgb(255,222,170)'; x.fillRect(0, 0, c.width, c.height); // warm room light
        x.globalCompositeOperation = 'destination-in'; x.drawImage(im, 0, 0);
        faces[k] = c;
      }));
      // an occluder sits just in front of the nearest spot that uses it
      const occZ = {};
      for (const sp of s.spots) for (const o of sp.occ) occZ[o] = Math.min(occZ[o] ?? 1e9, sp.z - 8);
      scene = { ...s, cam: s.plate, plate, occ, faces, occZ }; // cam: the plate's camera numbers; plate: its image
      return scene;
    })());
  }

  function mount(host, opts = {}) {
    host.classList.add('sw-stage'); // a taller stage than Fold and Flick's (ui.css)
    const cv = document.createElement('canvas'); cv.className = 'pf-canvas sw-canvas'; cv.setAttribute('aria-label', 'Spit-Wad Sniper'); host.append(cv);
    const g = cv.getContext('2d');
    let W = 400, H = 500, dpr = 1, k = 0.4, ox = 0, oy = 0, alive = true;
    function size() {
      const r = host.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(200, r.width); H = Math.max(200, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      k = Math.min(W / PW, H / VIEW_H); ox = (W - PW * k) / 2; oy = 0; // fit the shown part; wide screens get side wings
    }
    addEventListener('resize', size); size();
    // the scope: while you hold, the view zooms in on what you aim at (ZMAX). Plate point P sits at screen point S;
    // dragging moves P (the world pans under a still crosshair), so a thumb never covers it.
    const ZMAX = 2.2, SCOPE_Z = 320; // the scope zoom, and how far (inches) a Plank must be for it
    const near = (a, q) => { const r = rectOf(a); return Math.hypot(q.x - (r.x + r.w / 2), q.y - (r.y + r.h / 2)) < 70; };
    let zoom = 1, K = k, vx = 0, vy = 0, P = { x: PW / 2, y: 600 }, S = { x: 0, y: 0 };
    const baseX = (px) => ox + px * k, baseY = (py) => oy + py * k;
    function view() {
      K = k * zoom; const f = (zoom - 1) / (ZMAX - 1); vx = baseX(P.x) + (S.x - baseX(P.x)) * f; vy = baseY(P.y) + (S.y - baseY(P.y)) * f;
      if (zoom > 1) { // never show past the plate's edges while zoomed (the crosshair moves instead)
        const L = sx(0), R = sx(PW), T = sy(0), B = sy(VIEW_H);
        if (PW * K >= W) { if (L > 0) vx -= L; else if (R < W) vx += W - R; }
        if (VIEW_H * K >= H) { if (T > 0) vy -= T; else if (B < H) vy += H - B; }
      }
    }
    const sx = (px) => vx + (px - P.x) * K, sy = (py) => vy + (py - P.y) * K;   // plate -> screen
    const clampP = (q) => ({ x: Math.min(PW - 4, Math.max(4, q.x)), y: Math.min(VIEW_H - 20, Math.max(4, q.y)) });

    // ---------- the camera (plate pixels): the same one the layout guide and the spots were made with
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const F = () => scene.cam.F;
    function proj(x, y, z) { const yc = y - CAM_Y, y2 = yc * cp - z * sp, z2 = yc * sp + z * cp, s = F() / Math.max(1, z2); return { x: PW / 2 + x * s, y: PH / 2 - y2 * s, s, z: z2 }; }
    function ray(px, py) { const xc = (px - PW / 2) / F(), yc = -(py - PH / 2) / F(), y = yc * cp + sp, z = -yc * sp + cp, l = Math.hypot(xc, y, z); return [xc / l, y / l, z / l]; }
    const pStar = (z) => 0.3 + (z - 48) / SPAN;

    // ---------- a seeded dealer (the same round for the same seed; the server will deal from its own)
    let seed = (Math.random() * 2 ** 31) | 0;
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

    // ---------- state
    let now = 0, round = 1, clock = ROUND, score = 0, total = 0, hits = 0, shots = 0, streak = 0, best = 0, apps = [], nextAt = 0.8, phase = 'intro';
    let pops = [], splats = [], drops = [], puffs = [], sparks = [], critters = [], banner = null, hitstop = 0, shakeT = 0, shake = { x: 0, y: 0 }, recent = [];
    let press = null, wad = null, kick = -9, tip = { x: 0, y: 0, dx: 0 }, leftThumb = false;
    try { leftThumb = localStorage.getItem('omni.sw.leftThumb') === '1'; } catch { /* private window */ }
    const goal = () => goalFor(round);

    function startRound(r) {
      round = r; clock = ROUND; score = 0; apps = []; nextAt = now + 1.2; phase = 'play'; recent = [];
      banner = { t: now, text: `ROUND ${r}`, sub: `goal ${goal()}` };
      critters = [
        { kind: 'roach', z: 170, y: 0, x: -120, vx: 38, every: 11, at: 6, w: 4, h: 1.6 },
        { kind: 'roach', z: 300, y: 0, x: 120, vx: -28, every: 15, at: 19, w: 3.5, h: 1.4 },
        { kind: 'cat', z: 398, y: 50, x: 140, vx: -20, every: 22, at: 12, w: 15, h: 9 },
      ].map((c) => ({ ...c, live: false, gag: 0, x0: c.x }));
      emit('round', { round: r, goal: goal() });
    }
    function reset() { total = 0; hits = 0; shots = 0; streak = 0; splats = []; startRound(1); }
    function emit(type, d = {}) { try { opts.onEvent?.(type, d); } catch { /* the host's problem */ } }

    // ---------- the dealer: Planks from all over, several at once, a spot never twice in a row
    function deal() {
      const live = apps.filter((a) => !a.gone).length, maxLive = Math.min(4, 2 + Math.floor((round - 1) / 2) + (clock < 30 ? 1 : 0));
      if (live >= maxLive) { nextAt = now + 0.25; return; }
      const free = scene.spots.filter((s) => !apps.some((a) => a.s === s) && !recent.includes(s.id));
      if (!free.length) { nextAt = now + 0.25; return; }
      const s = free[Math.floor(rnd() * free.length)];
      recent.push(s.id); if (recent.length > 5) recent.shift();
      const far = (s.z - 90) / 450, win = Math.max(1.3, (2.2 + 1.2 * far) - (ROUND - clock) * 0.01 - (round - 1) * 0.12);
      const moving = s.look === 'ride' || s.look === 'walk', dir = rnd() < 0.5 ? 1 : -1;
      apps.push({ s, t0: now, win: moving ? win + 1.2 : win, hit: false, rise: 0, x: moving ? (dir > 0 ? s.x0 : s.x1) : s.cx, dir, face: 'idle', blinkAt: now + 0.8 + rnd() * 2 });
      nextAt = now + Math.max(0.35, 0.9 - round * 0.05) + rnd() * 0.7;
    }
    const pointsOf = (s) => Math.round((4 + (s.z - 90) / 12) * (s.look === 'ride' || s.look === 'walk' ? 1.25 : 1) * (s.look === 'clip' ? 1.3 : 1));

    /** where Plank is drawn now (plate px): the same rules as cut_layers.py plank_rect */
    function rectOf(a) {
      const s = a.s, h = s.h, w = s.w, r = a.rise;
      if (s.look === 'lean') return { x: s.cx - w / 2 + s.side * w * 0.75 * r, y: s.bottom - h, w, h, flip: false, tilt: s.side * 10 * r };
      if (s.look === 'drop') return { x: s.cx - w / 2, y: s.bottom - h + h * 0.8 * r, w, h, flip: true, tilt: 0 };
      const cx = s.look === 'ride' || s.look === 'walk' ? a.x : s.cx;
      return { x: cx - w / 2, y: s.bottom - h * r, w, h, flip: false, tilt: 0 };
    }

    // ---------- input
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function down(e) {
      if (press || !e.isPrimary) return;
      if (phase === 'over' || phase === 'intro') { reset(); return; }
      const p = pos(e), touch = e.pointerType !== 'mouse', offX = touch ? 55 * (leftThumb ? 1 : -1) : 0, offY = touch ? 95 : 0;
      if (zoom <= 1.02) { // a fresh aim: the point under the crosshair (still zoomed from the last shot: keep aiming from there)
        P = clampP({ x: (p.x + offX - ox) / k, y: (p.y - offY - oy) / k }); S = { x: baseX(P.x), y: baseY(P.y) };
      }
      press = { id: e.pointerId, t0: now, x0: p.x, y0: p.y, P0: { ...P }, last: p };
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
      e.preventDefault(); sound('in');
    }
    function move(e) { if (press && e.pointerId === press.id) press.last = pos(e); }
    function up(e) {
      if (!press || e.pointerId !== press.id) return;
      const held = now - press.t0; press = null;
      if (held < 0.12 || wad || phase !== 'play') return; // a tap cancels
      fire(held);
    }
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { press = null; });

    // ---------- the breath (real time: 3 s, 0 -> 1 -> 0) and the sway
    function breath(t) {
      const u = ((t % 3) + 3) % 3 / 1.5, tri = u <= 1 ? u : 2 - u, c = 0.08;
      if (tri < c) return c * (1 - Math.cos(Math.PI / 2 * tri / c)) * 0.64;
      if (tri > 1 - c) { const v = (1 - tri) / c; return 1 - c * (1 - Math.cos(Math.PI / 2 * v)) * 0.64; }
      return tri;
    }
    /** where the shot goes (plate px): the scope's point plus the sway */
    function aim() {
      if (!press) return { x: P.x, y: P.y };
      const t = now - press.t0, p = breath(t), Ax = 0.25 + 0.03 * (round - 1), Ay = 0.6 * Ax;
      let x = Ax * Math.cos(2 * Math.PI * t / 3), y = Ay * (2 * p - 1); if (t < 0.5) y += -1.2 * (1 - t / 0.5) ** 2 * Math.cos(8 * Math.PI * t);
      const d = F() * Math.PI / 180; return { x: P.x + x * d, y: P.y + y * d };
    }

    function fire(held) {
      const p = breath(held), a = aim(), d = ray(a.x, a.y);
      const r = [d[2], 0, -d[0]], rl = Math.hypot(r[0], r[2]) || 1; r[0] /= rl; r[2] /= rl;
      const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
      const ca = Math.cos(ALPHA), sa = Math.sin(ALPHA); let dir = [d[0] * ca - u[0] * sa, d[1] * ca - u[1] * sa, d[2] * ca - u[2] * sa];
      if (dir[1] < d[1]) dir = [d[0] * ca + u[0] * sa, d[1] * ca + u[1] * sa, d[2] * ca + u[2] * sa];
      const Z = Math.max(12, 48 + SPAN * (p - 0.3)), v = Math.sqrt(G * Z / Math.sin(2 * ALPHA));
      wad = { x: 0, y: CAM_Y, z: 0, vx: dir[0] * v, vy: dir[1] * v, vz: dir[2] * v, t: 0, done: false, trail: [] };
      shots++; kick = now; sound('puff'); buzz(10);
      for (let i = 0; i < 7; i++) { const an = -Math.PI / 2 + (rnd() - 0.5) * 1.4, s = 120 + rnd() * 180; drops.push({ x: tip.x, y: tip.y, vx: Math.cos(an) * s + tip.dx * 200, vy: Math.sin(an) * s, t: now, r: 1 + rnd() * 1.8 }); }
      emit('kick', {});
    }

    // ---------- hits: as the wad passes each thing's depth, test what is drawn there
    function cards() {
      const out = [];
      for (const a of apps) if (!a.hit && a.rise > 0.15) out.push({ kind: 'plank', z: a.s.z, a });
      for (const c of critters) if (c.live) out.push({ kind: 'critter', z: c.z, c });
      for (const [name, z] of Object.entries(scene.occZ)) out.push({ kind: 'occ', z, name });
      return out.sort((p, q) => p.z - q.z);
    }
    /** the edge a Plank shows past: up from behind it (pop, and riding or walking along it), or down from a beam (drop) */
    const edgeOf = (s) => (s.look === 'drop' ? { below: true } : s.look === 'pop' || s.look === 'ride' || s.look === 'walk' ? { below: false } : null);
    function hitTest(c, p) {
      if (c.kind === 'occ') { const o = scene.occ[c.name]; if (!o) return false; const ix = Math.floor(p.x - o.x), iy = Math.floor(p.y - o.y); return ix >= 0 && iy >= 0 && ix < o.w && iy < o.h && o.alpha[iy * o.w + ix] > 128; }
      if (c.kind === 'critter') { const q = proj(c.c.x, c.c.y + c.c.h / 2, c.c.z), r = Math.max(4, c.c.w / 2 * q.s); return Math.abs(p.x - q.x) < r && Math.abs(p.y - q.y) < Math.max(4, c.c.h / 2 * q.s) + 2; }
      const r = rectOf(c.a), m = 2;
      if (c.a.s.clip) { const [x0, y0, x1, y1] = c.a.s.clip; if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return false; }
      const edge = edgeOf(c.a.s); if (edge && (edge.below ? p.y < c.a.s.bottom : p.y > c.a.s.bottom)) return false; // the hidden part
      if (r.tilt) { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, an = -r.tilt * Math.PI / 180, dx = p.x - cx, dy = p.y - cy; const qx = dx * Math.cos(an) - dy * Math.sin(an), qy = dx * Math.sin(an) + dy * Math.cos(an); return Math.abs(qx) <= r.w / 2 + m && Math.abs(qy) <= r.h / 2 + m; }
      return p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m;
    }
    function stepWad(dt) {
      if (!wad || wad.done) return;
      let t = dt; const list = cards();
      while (t > 0 && !wad.done) {
        const h = Math.min(t, 1 / 480); t -= h; const z0 = wad.z;
        wad.vy -= G * h; wad.x += wad.vx * h; wad.y += wad.vy * h; wad.z += wad.vz * h; wad.t += h;
        for (const c of list) {
          if (!(z0 < c.z && wad.z >= c.z)) continue;
          const p = proj(wad.x, wad.y, wad.z);
          if (!hitTest(c, p)) continue;
          wad.done = true;
          if (c.kind === 'plank') hitPlank(c.a, p);
          else if (c.kind === 'critter') { c.c.gag = now + 1.2; pop(p.x, p.y - 10, c.c.kind === 'cat' ? 'MREOW!' : 'eek!', '#9fd3ff'); sound('gag'); splats.push({ x: p.x, y: p.y, r: Math.max(3, 1.4 * p.s), t: now }); }
          else { sound('tap'); splats.push({ x: p.x, y: p.y, r: Math.max(2.5, 1.4 * p.s), t: now }); }
          break;
        }
        if (!wad.done && (wad.y < 0 || wad.z > BACK)) { wad.done = true; const p = proj(wad.x, Math.max(0, wad.y), Math.min(wad.z, BACK)); sound('tap'); splats.push({ x: p.x, y: p.y, r: Math.max(2.5, 1.4 * p.s), t: now }); }
      }
      if (wad.done) { const w = wad; setTimeout(() => { if (wad === w) wad = null; }, 90); }
    }
    function hitPlank(a, p) {
      a.hit = true; a.hitAt = now; a.face = 'splat'; hits++; streak++; best = Math.max(best, streak);
      const pts = pointsOf(a.s); score += pts; total += pts;
      pop(p.x, p.y - 12, 'SPLAT!', '#fffaf0', true); pop(p.x, p.y + 6, `+${pts}`, '#ffd27a');
      if (PRAISE[streak]) banner = { t: now, text: PRAISE[streak], sub: `${streak} in a row` };
      hitstop = 0.07; shakeT = 0.28; sound('splat'); buzz([20, 40, 30]);
      for (let i = 0; i < 10; i++) { const an = rnd() * 6.28, s = 40 + rnd() * 90; sparks.push({ x: p.x, y: p.y, vx: Math.cos(an) * s, vy: Math.sin(an) * s - 40, t: now, col: '#fffaf0' }); }
      emit('make', { streak: total, score: total, round });
    }
    const pop = (x, y, text, col, big) => pops.push({ x, y, text, col, big, t: now });

    // ---------- the world
    function step(dt) {
      if (rnd() < dt * 2.5) puffs.push({ x: 995 + rnd() * 10, y: 230, t: now, r: 10 });
      if (rnd() < dt * 0.5) for (let i = 0; i < 6; i++) sparks.push({ x: 600 + rnd() * 240, y: 770, vx: (rnd() - 0.5) * 120, vy: -60 - rnd() * 80, t: now, col: '#ffb347' });
      puffs = puffs.filter((p) => now - p.t < 2.6); sparks = sparks.filter((p) => now - p.t < 0.8);
      for (const p of sparks) { p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      if (press) {
        // unzoomed the crosshair moves 1:1 with the thumb; in the scope the world pans under it, a little faster than
        // the thumb so it still reaches the edges
        const g2 = press.scope ? 1.25 : 1;
        const t = clampP({ x: press.P0.x + (press.last.x - press.x0) / (k * g2), y: press.P0.y + (press.last.y - press.y0) / (k * g2) }), q = 1 - Math.exp(-30 * dt);
        P = { x: P.x + (t.x - P.x) * q, y: P.y + (t.y - P.y) * q };
        // the scope: only for long shots, once the crosshair rests near a far Plank (it stays on until you let go)
        if (!press.scope && now - press.t0 > 0.12 && apps.some((a) => !a.hit && a.rise > 0.3 && a.s.z >= SCOPE_Z && near(a, P))) {
          press.scope = true; S = { x: sx(P.x), y: sy(P.y) }; press.P0 = { ...P }; press.x0 = press.last.x; press.y0 = press.last.y;
        }
      }
      const zt = press?.scope ? ZMAX : wad && !wad.done ? zoom : 1; // stay in while the wad flies, then ease out
      zoom += (zt - zoom) * (1 - Math.exp(-(zt > zoom ? 10 : 5) * dt)); if (Math.abs(zoom - 1) < 0.002) zoom = 1;
      stepWad(dt);
      if (phase !== 'play') return;
      clock = Math.max(0, clock - dt);
      if (clock <= 0) return endRound();
      if (now >= nextAt) deal();
      for (const a of apps) {
        const age = now - a.t0, s = a.s;
        if ((s.look === 'ride' || s.look === 'walk') && !a.hit) { a.x += a.dir * (s.look === 'ride' ? 90 : 60) * (scene.cam.F / s.z / 6.5) * dt; if (a.x < s.x0 || a.x > s.x1) { a.dir *= -1; a.x = Math.min(s.x1, Math.max(s.x0, a.x)); } }
        a.rise = a.hit ? Math.max(0, a.rise - dt / 0.45) : age < 0.15 ? age / 0.15 : age < 0.15 + a.win ? 1 : Math.max(0, 1 - (age - 0.15 - a.win) / 0.2);
        if (a.hit && now - a.hitAt > 0.3) a.face = 'dizzy';
        if (!a.hit && !a.taunted && age > 0.15 + a.win) {
          a.taunted = true; a.face = 'taunt'; streak = 0; const r = rectOf({ ...a, rise: 1 });
          pop(r.x + r.w / 2, r.y - 6, TAUNTS[Math.floor(rnd() * TAUNTS.length)], '#ff8a6a'); sound('taunt');
        }
        if (!a.hit && !a.taunted) { // blink now and then; flinch when a wad comes close
          if (now > a.blinkAt) { a.face = 'blink'; if (now > a.blinkAt + 0.14) { a.face = 'idle'; a.blinkAt = now + 1.5 + rnd() * 2.5; } }
          if (wad && !wad.done && wad.z > a.s.z - 120 && wad.z < a.s.z) a.face = 'duck';
          else if (a.face === 'duck') a.face = 'idle';
        }
        if ((a.hit && a.rise <= 0) || age > a.win + 0.45) a.gone = true;
      }
      apps = apps.filter((a) => !a.gone);
      for (const c of critters) {
        if (!c.live && ROUND - clock >= c.at) { c.live = true; c.x = c.x0; c.at += c.every; }
        if (c.live) { c.x += c.vx * dt * (c.gag > now ? 3 : 1); if (Math.abs(c.x) > Math.abs(c.x0) + 5) c.live = false; }
      }
    }
    function endRound() {
      apps = []; wad = null; press = null;
      if (score >= goal()) { phase = 'between'; banner = { t: now, text: 'GOAL MET!', sub: `${score} points · round ${round + 1} next`, stay: true }; sound('win'); emit('round-won', { round, score }); setTimeout(() => alive && phase === 'between' && startRound(round + 1), 2200); }
      else { phase = 'over'; banner = { t: now, text: 'TIME', sub: `${total} points · round ${round} · tap to play again`, stay: true }; sound('tap'); emit('over', { round, score: total, hits, shots }); }
    }

    // ---------- drawing
    function drawPlate() {
      g.fillStyle = '#120c08'; g.fillRect(0, 0, W, H);
      if (ox > 1) { // side wings: the plate's edges, mirrored, blurred and dark
        g.save(); g.globalAlpha = 0.5; g.filter = 'blur(10px) brightness(0.45)';
        g.translate(ox, 0); g.scale(-1, 1); g.drawImage(scene.plate, 0, 0, PW * 0.3, VIEW_H, 0, oy, PW * 0.3 * k, VIEW_H * k); g.restore();
        g.save(); g.globalAlpha = 0.5; g.filter = 'blur(10px) brightness(0.45)';
        g.translate(ox + PW * k, 0); g.scale(-1, 1); g.drawImage(scene.plate, PW * 0.7, 0, PW * 0.3, VIEW_H, -PW * 0.3 * k, oy, PW * 0.3 * k, VIEW_H * k); g.restore();
      }
      g.drawImage(scene.plate, 0, 0, PW, PH, sx(0), sy(0), PW * K, PH * K);
      // the lamp breathes a little
      const f = 0.06 + 0.04 * Math.sin(now * 7) * Math.sin(now * 2.3), gl = g.createRadialGradient(sx(190), sy(80), 2, sx(190), sy(80), 260 * K);
      gl.addColorStop(0, `rgba(255,190,110,${f})`); gl.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gl; g.fillRect(sx(0), sy(0), PW * K, 400 * K);
    }
    function drawPlank(a) {
      const r = rectOf(a), im = scene.faces[a.face] || scene.faces.idle; if (!im || a.rise <= 0) return;
      g.save();
      if (a.s.clip) { const [x0, y0, x1, y1] = a.s.clip; g.beginPath(); g.rect(sx(x0), sy(y0), (x1 - x0) * K, (y1 - y0) * K); g.clip(); }
      const edge = edgeOf(a.s); // he comes up from behind an edge (or hangs down from a beam): nothing of him past it
      if (edge) { g.beginPath(); if (edge.below) g.rect(sx(r.x - r.w), sy(a.s.bottom), r.w * 3 * K, r.h * 2 * K); else g.rect(sx(r.x - r.w), sy(a.s.bottom - r.h * 2), r.w * 3 * K, r.h * 2 * K); g.clip(); }
      if (a.s.id === 'arch') g.filter = 'brightness(0.25)'; // a silhouette against the lit doorway
      const cx = sx(r.x + r.w / 2), cy = sy(r.y + r.h / 2); g.translate(cx, cy); if (r.tilt) g.rotate(r.tilt * Math.PI / 180); if (r.flip) g.scale(1, -1);
      const haze = Math.max(0, (a.s.z - 200) / 700); g.globalAlpha = 1;
      g.shadowColor = 'rgba(20,10,4,.45)'; g.shadowBlur = 16 * K; g.shadowOffsetX = -3; g.shadowOffsetY = 3;
      g.drawImage(im, -r.w * K / 2, -r.h * K / 2, r.w * K, r.h * K);
      g.shadowColor = 'transparent';
      if (haze > 0) { g.globalAlpha = haze; g.fillStyle = 'rgb(120,80,45)'; g.globalCompositeOperation = 'source-atop'; g.fillRect(-r.w * K / 2, -r.h * K / 2, r.w * K, r.h * K); }
      g.restore();
      if (a.hit && a.rise > 0.1) { // dizzy stars
        g.fillStyle = '#ffe680'; for (let i = 0; i < 3; i++) { const an = now * 8 + i * 2.1; g.beginPath(); g.arc(sx(r.x + r.w / 2) + Math.cos(an) * r.w * K * 0.55, sy(r.y) - 4 + Math.sin(an) * 4, Math.max(1.5, 3 * K), 0, 7); g.fill(); }
      }
      if (!a.hit && !a.taunted && a.rise > 0.6) { // the points tag and his time left
        const left = Math.max(0, 1 - (now - a.t0) / (a.win + 0.15)), tx = sx(r.x + r.w / 2), ty = Math.max(12, sy(r.y) - 8);
        g.fillStyle = 'rgba(18,12,8,.82)'; g.fillRect(tx - 17, ty - 15, 34, 15); g.fillStyle = '#ffd27a'; g.font = '800 10px system-ui'; g.textAlign = 'center'; g.fillText(`+${pointsOf(a.s)}`, tx, ty - 4);
        g.fillStyle = left > 0.35 ? '#6fcf7a' : '#ff6b5a'; g.fillRect(tx - 17, ty, 34 * left, 2.5);
      }
    }
    function drawOcc(name) { const o = scene.occ[name]; if (o?.im) g.drawImage(o.im, sx(o.x), sy(o.y), o.w * K, o.h * K); }
    function drawCritter(c) {
      const p = proj(c.x, c.y + c.h / 2, c.z), x = sx(p.x), y = sy(p.y), s = p.s * K, dir = Math.sign(c.vx);
      g.save(); g.translate(x, y); g.scale(dir, 1);
      if (c.kind === 'cat') {
        g.fillStyle = '#231e1a'; g.beginPath(); g.ellipse(0, 0, c.w / 2 * s, c.h / 2.6 * s, 0, 0, 7); g.fill();
        g.beginPath(); g.arc(c.w / 2 * s, -c.h / 3 * s, c.h / 3 * s, 0, 7); g.fill();
        g.beginPath(); g.moveTo(c.w / 2 * s - 2 * s, -c.h / 1.6 * s); g.lineTo(c.w / 2 * s - 0.5 * s, -c.h * 0.95 * s); g.lineTo(c.w / 2 * s + 1.5 * s, -c.h / 1.6 * s); g.fill();
        g.strokeStyle = '#231e1a'; g.lineWidth = Math.max(1, 1.2 * s); g.beginPath(); g.moveTo(-c.w / 2 * s, 0); g.quadraticCurveTo(-c.w * 0.8 * s, -c.h * s * (0.6 + 0.2 * Math.sin(now * 3)), -c.w * 0.7 * s, -c.h * s); g.stroke();
        g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(c.w / 2 * s + 1.2 * s, -c.h / 2.6 * s, Math.max(0.8, 0.6 * s), 0, 7); g.fill();
      } else {
        g.fillStyle = '#3a2214'; g.beginPath(); g.ellipse(0, 0, c.w / 2 * s, c.h / 2 * s, 0, 0, 7); g.fill();
        g.strokeStyle = '#2a170c'; g.lineWidth = Math.max(0.6, 0.25 * s); const leg = Math.sin(now * 30) * 0.4 * s;
        for (const lx of [-1, 0, 1]) { g.beginPath(); g.moveTo(lx * s, 0); g.lineTo(lx * s + leg, c.h * 0.9 * s); g.moveTo(lx * s, 0); g.lineTo(lx * s - leg, -c.h * 0.9 * s); g.stroke(); }
        g.beginPath(); g.moveTo(c.w / 2 * s, 0); g.lineTo(c.w * 0.9 * s, -0.8 * s); g.moveTo(c.w / 2 * s, 0); g.lineTo(c.w * 0.9 * s, 0.8 * s); g.stroke();
      }
      g.restore();
    }
    /** the straw, first person: it comes out of your mouth just below the bottom centre, big and close, and runs
     *  away from you to a small open tip low in the middle of the view; it only leans a little toward the aim, and
     *  kicks back a touch when you spit. Returns its tip (where the wad comes out). */
    function drawStraw(a, kick) {
      const m = Math.min(W, H * 0.75), bx = W / 2, by = H + m * 0.1;                 // the mouth end, below the view
      const tx = W / 2 + (a.x - W / 2) * 0.16, ty = H - m * (0.46 - 0.03 * kick) + (a.y - H / 2) * 0.05; // the far tip
      const r0 = m * 0.075, r1 = m * 0.024;                                             // radius at the mouth and at the tip
      const ang = Math.atan2(ty - by, tx - bx), nx = -Math.sin(ang), ny = Math.cos(ang);
      g.save();
      // the tube: a tapered body, lit from the upper left
      g.beginPath(); g.moveTo(bx + nx * r0, by + ny * r0); g.lineTo(tx + nx * r1, ty + ny * r1); g.lineTo(tx - nx * r1, ty - ny * r1); g.lineTo(bx - nx * r0, by - ny * r0); g.closePath();
      const sg = g.createLinearGradient(bx - nx * r0, by - ny * r0, bx + nx * r0, by + ny * r0);
      sg.addColorStop(0, '#fbf6ea'); sg.addColorStop(0.35, '#fffdf6'); sg.addColorStop(0.75, '#d9d0bf'); sg.addColorStop(1, '#a89e8c');
      g.fillStyle = sg; g.fill(); g.save(); g.clip();
      // the stripes: two thin red spirals, wound tighter as the straw goes away (perspective)
      g.strokeStyle = '#d23a2e';
      for (let i = -1; i < 16; i++) {
        const at = (v) => 1 - Math.pow(1 - Math.min(1, Math.max(0, v)), 1.7), u0 = at(i / 14), u1 = at((i + 1.6) / 14), r = r0 + (r1 - r0) * u0;
        const p0x = bx + (tx - bx) * u0, p0y = by + (ty - by) * u0, p1x = bx + (tx - bx) * u1, p1y = by + (ty - by) * u1;
        g.lineWidth = Math.max(1.2, r * 0.22); g.beginPath(); g.moveTo(p0x + nx * r * 1.1, p0y + ny * r * 1.1); g.lineTo(p1x - nx * r * 1.1, p1y - ny * r * 1.1); g.stroke();
      }
      g.restore();
      // the open end, seen almost head on: a cream rim around a dark hole
      g.fillStyle = '#efe7d6'; g.beginPath(); g.ellipse(tx, ty, r1 * 1.05, r1 * 0.75, ang + Math.PI / 2, 0, 7); g.fill();
      g.fillStyle = '#2a1c12'; g.beginPath(); g.ellipse(tx, ty, r1 * 0.7, r1 * 0.48, ang + Math.PI / 2, 0, 7); g.fill();
      // a soft edge line so it reads against bright floor
      g.strokeStyle = 'rgba(60,40,25,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx + nx * r0, by + ny * r0); g.lineTo(tx + nx * r1, ty + ny * r1); g.moveTo(bx - nx * r0, by - ny * r0); g.lineTo(tx - nx * r1, ty - ny * r1); g.stroke();
      g.restore();
      return { x: tx, y: ty, dx: (tx - bx) / Math.hypot(tx - bx, ty - by), r: r1 };
    }
    function wadBall(x, y, r, spin) {
      g.save(); g.translate(x, y); g.rotate(spin); g.beginPath();
      for (let i = 0; i < 9; i++) { const an = i / 9 * Math.PI * 2, rr = r * (0.82 + 0.18 * Math.sin(i * 2.7 + 1.3)); i ? g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : g.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      g.closePath(); const gr = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r); gr.addColorStop(0, '#fbf7ee'); gr.addColorStop(0.7, '#ddd5c4'); gr.addColorStop(1, '#a99f8c'); g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(110,98,80,.55)'; g.lineWidth = Math.max(0.6, r * 0.12); g.beginPath(); g.moveTo(-r * 0.5, -r * 0.1); g.lineTo(r * 0.1, r * 0.2); g.lineTo(r * 0.45, -r * 0.25); g.stroke();
      g.restore(); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.4, Math.max(0.8, r * 0.18), 0, 7); g.fill();
    }
    function splat(s) {
      const age = now - s.t; if (age > 2.5) return; const x = sx(s.x), y = sy(s.y), r = s.r * K * 1.6, fade = age > 2 ? 1 - (age - 2) / 0.5 : 1;
      g.globalAlpha = fade; g.fillStyle = 'rgba(70,60,50,.35)'; g.beginPath(); g.ellipse(x, y, r * 1.5, r * 1.2, 0, 0, 7); g.fill();
      g.fillStyle = '#e9e2d3'; g.beginPath(); for (let i = 0; i < 11; i++) { const an = i / 11 * Math.PI * 2, rr = r * (0.75 + 0.35 * Math.abs(Math.sin(i * 1.9 + s.t))); i ? g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.85) : g.moveTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.85); } g.closePath(); g.fill();
      const dl = r * 1.4 * Math.min(1, age / 0.8); g.strokeStyle = 'rgba(225,235,240,.75)'; g.lineWidth = Math.max(1, r * 0.25); g.lineCap = 'round'; g.beginPath(); g.moveTo(x + r * 0.2, y + r * 0.5); g.lineTo(x + r * 0.2, y + r * 0.5 + dl); g.stroke();
      g.globalAlpha = 1;
    }
    function draw() {
      view(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.translate(shake.x, shake.y);
      drawPlate();
      // far to near: Planks, critters and the cut-outs in front of them, by depth
      const items = [];
      for (const a of apps) items.push({ z: a.s.z, d: () => drawPlank(a) });
      for (const c of critters) if (c.live) items.push({ z: c.z, d: () => drawCritter(c) });
      // a cut-out goes back over him when it's his spot's, or anything nearer that he overlaps (the flywheel's spokes in front of the far crates)
      const overlaps = (o, r) => o && r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
      for (const [name, z] of Object.entries(scene.occZ)) if (apps.some((a) => a.rise > 0 && (a.s.occ.includes(name) || (z < a.s.z && overlaps(scene.occ[name], rectOf(a)))))) items.push({ z, d: () => drawOcc(name) });
      items.sort((p, q) => q.z - p.z).forEach((i) => i.d());
      for (const p of puffs) { const q = (now - p.t) / 2.6; g.fillStyle = `rgba(230,225,215,${0.22 * (1 - q)})`; g.beginPath(); g.arc(sx(p.x + q * 30), sy(p.y - q * 120), (p.r + q * 40) * K, 0, 7); g.fill(); }
      for (const s of splats) splat(s); splats = splats.filter((s) => now - s.t < 2.5);
      for (const p of sparks) { g.fillStyle = p.col; g.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2, 2); }
      // the straw (decoration), the puff and spit at its tip, then the wad tumbling out
      const ap = aim(), a = { x: sx(ap.x), y: sy(ap.y) }, kk = Math.max(0, 1 - (now - kick) / 0.18);
      tip = drawStraw(a, kk);
      if (kk > 0) { g.fillStyle = `rgba(240,235,225,${0.45 * kk})`; g.beginPath(); g.arc(tip.x, tip.y, 6 + 14 * (1 - kk), 0, 7); g.fill(); }
      for (const d of drops) { const q = now - d.t; if (q > 0.35) continue; g.fillStyle = `rgba(215,235,245,${0.8 * (1 - q / 0.35)})`; g.beginPath(); g.arc(d.x + d.vx * q, d.y + d.vy * q + 300 * q * q, d.r, 0, 7); g.fill(); }
      drops = drops.filter((d) => now - d.t < 0.35);
      if (wad) {
        const q = proj(wad.x, wad.y, wad.z), e = Math.min(1, wad.t / 0.1), ease = 1 - (1 - e) ** 2;
        const x = tip.x + (sx(q.x) - tip.x) * ease, y = tip.y + (sy(q.y) - tip.y) * ease, rf = Math.max(2.5, 0.6 * q.s * K), r = rf + ((tip.r || rf) * 0.85 - rf) * (1 - ease); // the size of the straw's opening as it leaves, then its true size
        wad.trail.push({ x, y, r }); if (wad.trail.length > 5) wad.trail.shift();
        wad.trail.forEach((t, i) => { g.fillStyle = `rgba(215,235,245,${0.08 * i})`; g.beginPath(); g.arc(t.x, t.y, t.r * 0.35, 0, 7); g.fill(); });
        wadBall(x, y, r, wad.t * 18);
      }
      for (const t of pops) { const q = (now - t.t) / 1; if (q > 1) continue; g.globalAlpha = 1 - q * q; g.fillStyle = t.col; g.font = `900 ${t.big ? 20 + 8 * (1 - q) : 14}px system-ui`; g.textAlign = 'center'; g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 3; g.strokeText(t.text, sx(t.x), sy(t.y) - 30 * q); g.fillText(t.text, sx(t.x), sy(t.y) - 30 * q); g.globalAlpha = 1; }
      pops = pops.filter((t) => now - t.t < 1);
      // the crosshair and the breath ring, with the notch for the nearest Plank
      if (press) {
        const t = now - press.t0, p = breath(t), R = 28;
        g.strokeStyle = 'rgba(255,240,210,.95)'; g.lineWidth = 2; g.beginPath(); g.arc(a.x, a.y, 9, 0, 7); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { g.moveTo(a.x + dx * 6, a.y + dy * 6); g.lineTo(a.x + dx * 18, a.y + dy * 18); } g.stroke();
        const A0 = Math.PI * 0.75, A1 = A0 + Math.PI * 1.5, an2 = (v) => A0 + (A1 - A0) * v;
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(a.x, a.y, R, A0, A1); g.stroke();
        let near = null, nd = 1e9; for (const ap of apps) { if (ap.hit || ap.rise < 0.2) continue; const r = rectOf(ap), d = Math.hypot(sx(r.x + r.w / 2) - a.x, sy(r.y + r.h / 2) - a.y); if (d < nd) { nd = d; near = ap; } }
        if (near) { const ps = pStar(near.s.z), dp = 7 / (2 * 75.4); g.strokeStyle = 'rgba(111,207,122,.95)'; g.beginPath(); g.arc(a.x, a.y, R, an2(Math.max(0, ps - dp)), an2(Math.min(1, ps + dp))); g.stroke(); }
        g.lineWidth = 4; g.strokeStyle = '#ffb347'; g.beginPath(); g.arc(a.x, a.y, R, A0, an2(p)); g.stroke();
        const an = an2(p); g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(a.x + Math.cos(an) * R, a.y + Math.sin(an) * R, 4, 0, 7); g.fill();
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // the top bar: round score / goal, clock, streak
      g.fillStyle = 'rgba(18,12,8,.82)'; g.fillRect(0, 0, W, 38);
      g.font = '800 14px system-ui'; g.textAlign = 'left'; g.fillStyle = score >= goal() ? '#6fcf7a' : '#ffd27a'; g.fillText(`R${round} · ${score} / ${goal()}`, 10, 24);
      g.textAlign = 'center'; g.fillStyle = clock < 10 && phase === 'play' ? (Math.floor(now * 4) % 2 ? '#ffb07a' : '#ff6b5a') : '#f6e8cf'; g.fillText(`0:${String(Math.ceil(clock)).padStart(2, '0')}`, W / 2, 24);
      g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(W * 0.32, 32, W * 0.36, 3); g.fillStyle = clock < 10 ? '#ff8a6a' : '#e9b45a'; g.fillRect(W * 0.32, 32, W * 0.36 * clock / ROUND, 3);
      g.textAlign = 'right'; g.fillStyle = streak >= 3 ? '#ffb347' : '#b9a385'; g.fillText(streak ? `🔥 ${streak}` : `${hits}/${shots}`, W - 10, 24);
      if (phase === 'intro') {
        g.fillStyle = 'rgba(10,6,3,.55)'; g.fillRect(0, 38, W, H - 38); g.textAlign = 'center'; g.fillStyle = '#ffd27a'; g.font = '900 26px system-ui'; g.fillText('SPIT-WAD SNIPER', W / 2, H * 0.36);
        g.fillStyle = '#f6e8cf'; g.font = '700 14px system-ui';
        const lines = [matchMedia('(pointer: fine)').matches ? 'Click and hold to aim. Let go to spit.' : 'Hold to aim. Let go to spit.', 'Let go when the ring hits the green notch.', `Hit Plank before he ducks. Goal ${goal()} in 60 s.`, 'Tap to start'];
        lines.forEach((t, i) => g.fillText(t, W / 2, H * 0.36 + 34 + i * 22));
      }
      if (banner && (banner.stay || now - banner.t < 1.4)) {
        const q = Math.min(1, (now - banner.t) / 0.15); g.save(); g.translate(W / 2, H * 0.3); g.scale(0.6 + 0.4 * q, 0.6 + 0.4 * q); g.textAlign = 'center';
        g.font = '900 32px system-ui'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(banner.text, 0, 0); g.fillStyle = '#ffd27a'; g.fillText(banner.text, 0, 0);
        g.font = '700 13px system-ui'; g.strokeText(banner.sub, 0, 24); g.fillStyle = '#f6e8cf'; g.fillText(banner.sub, 0, 24); g.restore();
      }
    }

    // ---------- the loop (a frame never throws the game away)
    let last = performance.now();
    function frame(t) {
      if (!alive) return;
      let dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (document.hidden && phase === 'play') dt = 0; // free play pauses while the tab is hidden
      if (hitstop > 0) { hitstop -= dt; dt = 0; }
      if (shakeT > 0) { shakeT -= Math.max(dt, 1 / 60); const m = 7 * Math.max(0, shakeT / 0.28); shake = { x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * m }; } else shake = { x: 0, y: 0 };
      now += dt;
      try { if (scene) { step(dt); draw(); } } catch (e) { console.warn('spitwad frame', e); }
      requestAnimationFrame(frame);
    }
    load().then(() => { if (alive) { size(); requestAnimationFrame(frame); } }, (e) => console.warn('spitwad: the scene did not load', e));

    // ---------- sounds (placeholders until the sound set comes in) and haptics
    let ac = null;
    function sound(kind) {
      if (opts.mute?.()) return; try { ac = ac || new AudioContext(); } catch { return; }
      const t = ac.currentTime, o = ac.createOscillator(), e = ac.createGain(); o.connect(e).connect(ac.destination);
      const set = { in: [300, 260, 0.05, 0.05], puff: [180, 90, 0.08, 0.2], splat: [140, 50, 0.2, 0.4], tap: [600, 500, 0.05, 0.1], taunt: [520, 760, 0.12, 0.07], gag: [900, 1400, 0.1, 0.08], win: [400, 900, 0.4, 0.2] }[kind]; if (!set) return;
      o.type = kind === 'taunt' ? 'square' : 'sine'; o.frequency.setValueAtTime(set[0], t); o.frequency.exponentialRampToValueAtTime(set[1], t + set[2]);
      e.gain.setValueAtTime(set[3], t); e.gain.exponentialRampToValueAtTime(0.001, t + set[2] + 0.05); o.start(t); o.stop(t + set[2] + 0.06);
    }
    const buzz = (p) => { try { opts.haptic?.(p); } catch { /* no vibration */ } };

    return {
      canvas: cv,
      /** tests: the state, and a shot fired from code at plate point (x, y) with breath p */
      state: () => ({ wad: wad && { x: wad.x, y: wad.y, z: wad.z, t: wad.t, vz: wad.vz }, phase, round, clock, score, total, hits, shots, streak, best, apps: apps.map((a) => ({ id: a.s.id, dir: a.dir, rise: a.rise, hit: a.hit, face: a.face, rect: rectOf(a), z: a.s.z })) }),
      start: () => { if (phase !== 'play') reset(); },
      /** tests: Plank held still in one spot (fully out, or `rise` of the way), nothing else moving */
      pose(id, rise = 1, x) {
        const sp = scene.spots.find((q) => q.id === id); if (!sp) return false;
        phase = 'pose'; apps = [{ s: sp, t0: now, win: 1e9, hit: false, rise, x: x ?? sp.cx, dir: 1, face: 'idle', blinkAt: 1e9 }]; return true;
      },
      fireAt(x, y, p) { if (wad) return false; P = { x, y }; const b = press; press = null; fireP(p); press = b; return true; },
      setLeftThumb(v) { leftThumb = !!v; try { localStorage.setItem('omni.sw.leftThumb', v ? '1' : '0'); } catch { /* private window */ } },
      destroy() { alive = false; removeEventListener('resize', size); host.classList.remove('sw-stage'); cv.remove(); try { ac?.close(); } catch { /* fine */ } },
    };
    function fireP(p) { // fire with a given breath (tests): the same as a release at that breath
      let held = 0; for (let i = 0; i <= 150; i++) { const t = i / 100; if (Math.abs(breath(t) - p) < Math.abs(breath(held) - p)) held = t; }
      fire(held);
    }
  }

  window.SpitWad = { mount, load };
})();
