/* Spit-Wad Sniper (game 2, docs/spitwad-plan.md): Plank pops out from all over a cluttered card-factory floor and you
   spit wads at him through a paper straw. Hold to aim (the crosshair sits up and to the side of a thumb and moves 1:1
   with it), watch the breath ring, let go in its green notch: the breath sets how far the wad flies. A round is 60
   seconds with a goal; meet it and the next round is harder. Free play for now (competitive runs need the game
   server's round judging first).

   The scene is one painted plate (ui/spitwad/hall.webp) with the things Plank hides behind cut out of it
   (occ-*.webp) and drawn back over him, so he really is behind them. web/art/spitwad-src/cut_layers.py makes the
   files and ui/spitwad/scene.json (the spots: where he stands, how deep, how he shows), and its --check proves every
   bit of Plank you can see can be hit. Positions are plate pixels; depth is inches from the camera, which sets his
   size, the breath's sweet spot and the flight time.

   Mount: window.SpitWad.mount(host, { onEvent, mute, haptic }) -> { destroy, state, ... }. Hits are judged where you
   see them: as a wad passes each thing's depth, it is tested against what is drawn there (Plank's box, a critter, or
   a cut-out's own pixels, and only the cut-outs drawn over a Plank or critter right now). Everything is drawn far to
   near by depth, the wads and their splats too. */
(() => {
  const BASE = 'ui/spitwad/';
  const PL = 16, G = 193, ALPHA = 3 * Math.PI / 180, SPAN = 1440, PITCH = -10 * Math.PI / 180, CAM_Y = 4 * PL;
  const PW = 1024, PH = 1536, VIEW_H = 1250;           // the plate, and how much of it the game shows (the top 81%)
  const WING = 0.3;                                    // the side wings: the plate's outer 30% mirrored past each edge
  const BACK = 560;                                    // the far wall's depth (inches)
  const ROUND = 60;
  const BAR = 38;                                      // the top bar: the plate is shown below it
  // the round's goal: points are 6 (near) to 26 (far and small), so no single far hit makes much of it
  const goalFor = (r) => (r <= 3 ? [60, 70, 85][r - 1] : 5 * Math.round((40 + 12 * r + 0.6 * r * r) / 5));
  // how deep the dealer may go: near spots in round 1, the middle distance in round 2, everything after; a few far
  // shots mixed in early (owner, Oct 29): about 1 Plank in 5 in rounds 1 and 2 may come from anywhere
  const zMaxFor = (r) => (r <= 1 ? 200 : r === 2 ? 340 : Infinity);
  const FAR_MIX = 0.2;
  const TAUNTS = ['Nyah!', 'Too slow!', 'Missed me!', 'Ha!', 'Over here!', 'Nope!'];
  const PRAISE = { 3: 'HAT TRICK!', 5: 'ON FIRE!', 8: 'UNSTOPPABLE!', 12: 'PLANK PANIC!' };
  const NOTCH = 7 / (2 * 75.4);                        // half the green notch, in breath
  const pStar = (z) => 0.3 + (z - 48) / SPAN;           // the breath that sends a wad to depth z

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

  /** Plank's face as drawn at a spot, made once and kept: the haze toward the far wall, the soft drop shadow, and in
   *  the lit doorway (arch) a dark figure rim-lit from behind. Shadows and filters every frame were the slow part. */
  const artCache = new Map();
  function plankArt(face, s) {
    const im = scene.faces[face] || scene.faces.idle; if (!im) return null;
    const arch = s.id === 'arch', haze = arch ? 0 : Math.round(Math.max(0, (s.z - 200) / 700) * 20) / 20, key = `${face}|${haze}|${arch}`;
    let c = artCache.get(key); if (c) return c;
    const w = im.width, h = im.height, pad = Math.round(h * 0.1);
    const a = document.createElement('canvas'); a.width = w; a.height = h; const x = a.getContext('2d');
    if (arch) x.filter = 'brightness(0.55)';
    x.drawImage(im, 0, 0); x.filter = 'none';
    if (haze > 0) { x.globalCompositeOperation = 'source-atop'; x.globalAlpha = haze; x.fillStyle = 'rgb(120,80,45)'; x.fillRect(0, 0, w, h); }
    c = document.createElement('canvas'); c.width = w + 2 * pad; c.height = h + 2 * pad; const y = c.getContext('2d');
    if (arch) { // backlit: a warm glow around his edges from the bright doorway behind him
      y.shadowColor = 'rgba(255,200,120,.9)'; y.shadowBlur = h * 0.045; y.drawImage(a, pad, pad);
      y.shadowBlur = h * 0.015; y.shadowColor = 'rgba(255,226,170,1)'; y.drawImage(a, pad, pad);
    } else { y.shadowColor = 'rgba(20,10,4,.45)'; y.shadowBlur = h * 0.06; y.shadowOffsetX = -h * 0.012; y.shadowOffsetY = h * 0.012; y.drawImage(a, pad, pad); }
    c.pad = pad; c.iw = w; artCache.set(key, c); return c;
  }

  function mount(host, opts = {}) {
    host.classList.add('sw-stage'); // a taller stage than Fold and Flick's (ui.css)
    const cv = document.createElement('canvas'); cv.className = 'pf-canvas sw-canvas'; cv.setAttribute('aria-label', 'Spit-Wad Sniper'); host.append(cv);
    const g = cv.getContext('2d');
    let W = 400, H = 500, dpr = 1, k = 0.4, ox = 0, oy = 0, alive = true, wings = null;
    function size() {
      const r = host.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(200, r.width); H = Math.max(200, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // fit the shown part under the top bar; wide screens get side wings. A sideways phone is too short to give up the
      // bar's height: there the scene fills the height and only slides down as far as the room allows
      if (H < 500) { k = Math.min(W / PW, H / VIEW_H); oy = Math.max(0, Math.min(BAR, H - VIEW_H * k)); }
      else { k = Math.min(W / PW, (H - BAR) / VIEW_H); oy = BAR; }
      ox = (W - PW * k) / 2;
      makeWings();
    }
    /** the side wings, softly blurred and a little darker, made once per size (a blur filter every frame was most of
     *  the frame time). They mirror the plate at its edge and darken only away from it, so there is no hard seam and
     *  a Plank at the edge stays easy to see in the scope. */
    function makeWings() {
      wings = null; if (!scene?.plate) return;
      const s = k * dpr, M = 20, wpl = PW * WING + M, cw = Math.max(1, Math.ceil(wpl * s)), hh = Math.max(1, Math.ceil(PH * s));
      // each wing runs M plate px over the plate's own edge (that part unmirrored, fading out), so the blur has no edge
      // at the seam and the soft wing melts into the sharp plate
      const mk = (left) => {
        const t = document.createElement('canvas'); t.width = cw; t.height = hh; const y = t.getContext('2d'); y.scale(s, s);
        if (left) { y.translate(PW * WING, 0); y.drawImage(scene.plate, 0, 0, M, PH, 0, 0, M, PH); y.scale(-1, 1); y.drawImage(scene.plate, 0, 0, PW * WING, PH, 0, 0, PW * WING, PH); }
        else { y.translate(M - PW, 0); y.drawImage(scene.plate, PW - M, 0, M, PH, PW - M, 0, M, PH); y.translate(2 * PW, 0); y.scale(-1, 1); y.drawImage(scene.plate, PW * (1 - WING), 0, PW * WING, PH, PW * (1 - WING), 0, PW * WING, PH); }
        const c = document.createElement('canvas'); c.width = cw; c.height = hh; const x = c.getContext('2d');
        x.fillStyle = '#120c08'; x.fillRect(0, 0, cw, hh); x.filter = `blur(${4 * dpr}px) brightness(0.8)`; x.drawImage(t, 0, 0); x.filter = 'none';
        const seam = (left ? PW * WING : M) * s, out = left ? 0 : cw, gr = x.createLinearGradient(seam, 0, out, 0); // darker only away from the plate
        gr.addColorStop(0, 'rgba(18,12,8,0)'); gr.addColorStop(0.35, 'rgba(18,12,8,.12)'); gr.addColorStop(1, 'rgba(18,12,8,.6)');
        x.fillStyle = gr; x.fillRect(0, 0, cw, hh);
        const fe = x.createLinearGradient(seam, 0, left ? cw : 0, 0); fe.addColorStop(0, 'rgba(0,0,0,0)'); fe.addColorStop(1, 'rgba(0,0,0,1)');
        x.globalCompositeOperation = 'destination-out'; x.fillStyle = fe; if (left) x.fillRect(seam, 0, cw - seam, hh); else x.fillRect(0, 0, seam, hh);
        c.x0 = left ? -PW * WING : PW - M; c.wpl = wpl; return c;
      };
      wings = { L: mk(true), R: mk(false) };
    }
    addEventListener('resize', size); size();
    // the scope: while you hold, the view zooms in on what you aim at (ZMAX). Plate point P sits at screen point S;
    // dragging moves P (the world pans under a still crosshair), so a thumb never covers it. Once the scope is on, S
    // eases toward the middle of the view, so a Plank at the edge comes to the middle (the view may run into the wings).
    const ZMAX = 2.2, ZFAR = 3, FAR_Z = 500, SCOPE_Z = 320; // the scope zoom (more for the back wall), and how far (inches) a Plank must be for it
    let zTop = ZMAX;
    const near = (a, q) => { const r = rectOf(a); return Math.hypot(q.x - (r.x + r.w / 2), q.y - (r.y + r.h / 2)) < 70; };
    let zoom = 1, K = k, vx = 0, vy = 0, P = { x: PW / 2, y: 600 }, S = { x: 0, y: 0 };
    const baseX = (px) => ox + px * k, baseY = (py) => oy + py * k;
    const zf = () => (zoom - 1) / (zTop - 1);
    function view() {
      K = k * zoom; const f = zf(); vx = baseX(P.x) + (S.x - baseX(P.x)) * f; vy = baseY(P.y) + (S.y - baseY(P.y)) * f;
      if (zoom > 1) { // never past the wings' outer edges, or the plate's top and bottom
        const L = sx(-WING * PW), R = sx(PW * (1 + WING)), T = sy(0), B = sy(PH);
        if (R - L <= W) vx += (W - L - R) / 2; else if (L > 0) vx -= L; else if (R < W) vx += W - R;
        if (B - T <= H) vy -= T; else if (T > 0) vy -= T; else if (B < H) vy += H - B;
      }
    }
    const sx = (px) => vx + (px - P.x) * K, sy = (py) => vy + (py - P.y) * K;   // plate -> screen
    const clampP = (q) => ({ x: Math.min(PW - 4, Math.max(4, q.x)), y: Math.min(VIEW_H - 20, Math.max(4, q.y)) });

    // ---------- the camera (plate pixels): the same one the layout guide and the spots were made with
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const F = () => scene.cam.F;
    function proj(x, y, z) { const yc = y - CAM_Y, y2 = yc * cp - z * sp, z2 = yc * sp + z * cp, s = F() / Math.max(1, z2); return { x: PW / 2 + x * s, y: PH / 2 - y2 * s, s, z: z2 }; }
    function ray(px, py) { const xc = (px - PW / 2) / F(), yc = -(py - PH / 2) / F(), y = yc * cp + sp, z = -yc * sp + cp, l = Math.hypot(xc, y, z); return [xc / l, y / l, z / l]; }
    /** the launch for a shot at plate point (ax, ay) that should reach depth Z: 3 degrees over the aim ray, at the
     *  speed whose arc comes back down onto that ray exactly at depth Z (so a notch shot lands on the crosshair) */
    function launch(ax, ay, Z) {
      const d = ray(ax, ay);
      const r = [d[2], 0, -d[0]], rl = Math.hypot(r[0], r[2]) || 1; r[0] /= rl; r[2] /= rl;
      let u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]]; // up, square to the ray
      if (u[1] < 0) u = u.map((v) => -v);
      const ca = Math.cos(ALPHA), sa = Math.sin(ALPHA), dir = [d[0] * ca + u[0] * sa, d[1] * ca + u[1] * sa, d[2] * ca + u[2] * sa];
      // along the ray the wad is back on it after t = 2 v sa / (g uy); that point is s = Z / dz down the ray
      const s = Z / d[2], v = Math.sqrt(s * G * u[1] * u[1] / (2 * sa * (ca * u[1] - d[1] * sa)));
      return { vx: dir[0] * v, vy: dir[1] * v, vz: dir[2] * v };
    }

    // ---------- a seeded dealer (the same round for the same seed; the server will deal from its own)
    let seed = (Math.random() * 2 ** 31) | 0;
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

    // ---------- state
    let lastTick = 0;
    let now = 0, round = 1, clock = ROUND, score = 0, total = 0, hits = 0, shots = 0, streak = 0, best = 0, apps = [], nextAt = 0.8, phase = 'intro';
    let pops = [], splats = [], drops = [], puffs = [], sparks = [], critters = [], banner = null, hitstop = 0, shakeT = 0, shake = { x: 0, y: 0 }, recent = [];
    let press = null, wads = [], kick = -9, tip = { x: 0, y: 0, dx: 0 }, leftThumb = false, lastShot = null, drawOrder = [];
    try { leftThumb = localStorage.getItem('omni.sw.leftThumb') === '1'; } catch { /* private window */ }
    const coarse = matchMedia('(pointer: coarse)').matches;
    const goal = () => goalFor(round);

    function startRound(r) {
      round = r; clock = ROUND; score = 0; apps = []; nextAt = now + 1.2; phase = 'play'; recent = []; lastTick = 0; sound('whistle');
      banner = { t: now, text: `ROUND ${r}`, sub: `goal ${goal()}` };
      // the critters: two roaches on the floor, and a cat along the catwalk behind its rail (x0 -> x1, inches)
      critters = [
        { kind: 'roach', z: 170, y: 0, x0: -120, x1: 120, v: 38, every: 11, at: 6, w: 4, h: 1.6 },
        { kind: 'roach', z: 300, y: 0, x0: 120, x1: -120, v: 28, every: 15, at: 19, w: 3.5, h: 1.4 },
        { kind: 'cat', z: 398, y: 61, x0: 26, x1: -116, v: 20, every: 22, at: 12, w: 15, h: 9 },
      ].map((c) => ({ ...c, live: false, gag: 0, x: c.x0, vx: Math.sign(c.x1 - c.x0) * c.v }));
      emit('round', { round: r, goal: goal() });
    }
    function reset() { total = 0; hits = 0; shots = 0; streak = 0; splats = []; startRound(1); }
    function emit(type, d = {}) { try { opts.onEvent?.(type, d); } catch { /* the host's problem */ } }

    // ---------- the dealer: Planks from all over, several at once, a spot never twice in a row
    const moving = (s) => s.look === 'ride' || s.look === 'walk';
    /** the least time a Plank at depth z must stay out: rise, aim, breathe to the notch and fly there */
    const flightT = (z) => z / (Math.sqrt(G * z / Math.sin(2 * ALPHA)) * Math.cos(ALPHA));
    const minWin = (z) => 0.15 + 0.8 + 1.5 * pStar(z) + flightT(z);
    function deal() {
      const live = apps.filter((a) => !a.gone).length, maxLive = Math.min(4, 2 + Math.floor((round - 1) / 2) + (clock < 30 ? 1 : 0));
      if (live >= maxLive) { nextAt = now + 0.25; return; }
      const zMax = round <= 2 && rnd() < FAR_MIX ? Infinity : zMaxFor(round);
      const free = scene.spots.filter((s) => s.z <= zMax && !apps.some((a) => a.s === s) && !recent.includes(s.id));
      if (!free.length) { nextAt = now + 0.25; return; }
      const s = free[Math.floor(rnd() * free.length)];
      recent.push(s.id); if (recent.length > 5) recent.shift();
      const far = (s.z - 90) / 450, win = Math.max(minWin(s.z), (2.2 + 1.2 * far) - (ROUND - clock) * 0.01 - (round - 1) * 0.12);
      const dir = rnd() < 0.5 ? 1 : -1;
      sound('spy');
      apps.push({ s, t0: now, win: moving(s) ? win + 1.2 : win, hit: false, rise: 0, x: moving(s) ? (dir > 0 ? s.x0 : s.x1) : s.cx, dir, face: 'idle', blinkAt: now + 0.8 + rnd() * 2, splats: [] });
      nextAt = now + Math.max(0.35, 0.9 - round * 0.05) + rnd() * 0.7;
    }
    /** a hit's points: 6 near to 20 at the back wall, more for a moving or a peeking Plank (26 at most) */
    const pointsOf = (s) => Math.round((5 + (s.z - 90) / 30) * (moving(s) ? 1.25 : 1) * (s.look === 'clip' ? 1.3 : 1));

    /** where Plank is drawn now (plate px): the same rules as cut_layers.py plank_rect */
    function rectOf(a) {
      const s = a.s, h = s.h, w = s.w, r = a.rise;
      if (s.look === 'lean') return { x: s.cx - w / 2 + s.side * w * 0.75 * r, y: s.bottom - h, w, h, flip: false, tilt: s.side * 10 * r };
      if (s.look === 'drop') return { x: s.cx - w / 2, y: s.bottom - h + h * 0.8 * r, w, h, flip: true, tilt: 0 };
      const cx = moving(s) ? a.x : s.cx;
      return { x: cx - w / 2, y: s.bottom - h * r, w, h, flip: false, tilt: 0 };
    }
    /** a critter's box (plate px) */
    function critterRect(c) { const q = proj(c.x, c.y + c.h / 2, c.z), hw = Math.max(4, c.w / 2 * q.s) * 1.2, hh = Math.max(4, c.h / 2 * q.s) * 1.3; return { x: q.x - hw, y: q.y - hh * 1.4, w: 2 * hw, h: hh * 2.4 }; }
    const overlaps = (o, r) => o && r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
    /** the cut-outs drawn now: a Plank's own, or a nearer one over a Plank or a critter (only these stop a wad) */
    function liveOcc() {
      const t = [];
      for (const a of apps) if (a.rise > 0) t.push({ z: a.s.z, own: a.s.occ, r: rectOf(a) });
      for (const c of critters) if (c.live) t.push({ z: c.z, own: [], r: critterRect(c) });
      const out = [];
      for (const [name, z] of Object.entries(scene.occZ)) if (t.some((x) => x.own.includes(name) || (z < x.z && overlaps(scene.occ[name], x.r)))) out.push(name);
      return out;
    }

    // ---------- input
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const thumbBtn = () => ({ x: 10, y: H - 36, w: 74, h: 26 });
    const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    function setLeftThumb(v) { leftThumb = !!v; try { localStorage.setItem('omni.sw.leftThumb', v ? '1' : '0'); } catch { /* private window */ } }
    function down(e) {
      if (press || !e.isPrimary) return;
      const p = pos(e), touch = e.pointerType !== 'mouse';
      if (coarse && inBox(p, thumbBtn())) { setLeftThumb(!leftThumb); e.preventDefault(); return; } // which thumb you play with
      if (phase === 'over' || phase === 'intro') { reset(); return; }
      // the crosshair sits 55 px off the thumb (away from the hand) and above it (95 px, 60 on a short landscape
      // screen), less near the screen's edge on that side and near the bottom, so the edges stay in reach
      const side = leftThumb ? 1 : -1, edge = leftThumb ? p.x : W - p.x, off = 55 * Math.min(1, Math.max(0.15, edge / 60));
      const up = H < 500 ? 60 : 95, offY = up * Math.min(1, Math.max(0.15, (H - p.y) / (1.5 * up)));
      const q = { x: p.x + (touch ? side * off : 0), y: p.y - (touch ? offY : 0) };
      if (zoom <= 1.02) { // a fresh aim: the point under the crosshair
        P = clampP({ x: (q.x - ox) / k, y: (q.y - oy) / k }); S = { x: baseX(P.x), y: baseY(P.y) };
      } else { // still zoomed from the last shot: aim at what's under the crosshair now, and keep the view where it is
        const Pn = clampP({ x: P.x + (q.x - vx) / K, y: P.y + (q.y - vy) / K }), keep = { x: vx + (Pn.x - P.x) * K, y: vy + (Pn.y - P.y) * K }, f = Math.max(0.05, zf());
        S = { x: baseX(Pn.x) + (keep.x - baseX(Pn.x)) / f, y: baseY(Pn.y) + (keep.y - baseY(Pn.y)) / f }; P = Pn;
      }
      press = { id: e.pointerId, t0: now, x0: p.x, y0: p.y, P0: { ...P }, last: p };
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
      e.preventDefault(); sound('in');
    }
    function move(e) { if (press && e.pointerId === press.id) press.last = pos(e); }
    function up(e) {
      if (!press || e.pointerId !== press.id) return;
      const held = now - press.t0, a = aim(); press = null; // the shot goes where the crosshair is, sway and all
      if (held < 0.12 || (phase !== 'play' && phase !== 'pose')) return; // a tap cancels (pose: tests)
      fire(held, a); // another wad may still be flying: they fly together
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
    /** the live Plank nearest the crosshair (plate px), if any is close */
    function nearestPlank(a, within = 1e9) {
      let best = null, bd = within;
      for (const ap of apps) { if (ap.hit || ap.rise < 0.2) continue; const r = rectOf(ap), d = Math.hypot(r.x + r.w / 2 - a.x, r.y + r.h / 2 - a.y) - Math.max(r.w, r.h) / 2; if (d < bd) { bd = d; best = ap; } }
      return best;
    }

    function fire(held, a) {
      const p = breath(held), Z = Math.max(12, 48 + SPAN * (p - 0.3)), v = launch(a.x, a.y, Z);
      const rel = new Map(); // the moving Planks near the aim, and where they were at the release
      for (const ap of apps) { if (!moving(ap.s) || ap.hit) continue; const r = rectOf(ap); if (Math.hypot(r.x + r.w / 2 - a.x, r.y + r.h / 2 - a.y) - Math.max(r.w, r.h) / 2 < 60) rel.set(ap, ap.x); }
      wads.push({ x: 0, y: CAM_Y, z: 0, ...v, t: 0, done: false, trail: [], Z, target: nearestPlank(a, 60), rel });
      lastShot = { aim: { ...a }, P: { ...P }, held, Z };
      shots++; kick = now; sound('puff'); buzz(10);
      for (let i = 0; i < 7; i++) { const an = -Math.PI / 2 + (rnd() - 0.5) * 1.4, s = 120 + rnd() * 180; drops.push({ x: tip.x, y: tip.y, vx: Math.cos(an) * s + tip.dx * 200, vy: Math.sin(an) * s, t: now, r: 1 + rnd() * 1.8 }); }
      emit('kick', {});
    }

    // ---------- hits: as a wad passes each thing's depth, test what is drawn there
    function cards() {
      const out = [];
      for (const a of apps) if (!a.hit && a.rise > 0.15) out.push({ kind: 'plank', z: a.s.z, a });
      for (const c of critters) if (c.live) out.push({ kind: 'critter', z: c.z, c });
      for (const name of liveOcc()) out.push({ kind: 'occ', z: scene.occZ[name], name });
      return out.sort((p, q) => p.z - q.z);
    }
    /** the edge a Plank shows past: up from behind it (pop, and riding or walking along it), or down from a beam (drop) */
    const edgeOf = (s) => (s.look === 'drop' ? { below: true } : s.look === 'pop' || moving(s) ? { below: false } : null);
    const occAt = (o, p) => { const ix = Math.floor(p.x - o.x), iy = Math.floor(p.y - o.y); return ix >= 0 && iy >= 0 && ix < o.w && iy < o.h ? o.alpha[iy * o.w + ix] : 0; };
    function hitTest(c, p) {
      if (c.kind === 'occ') { const o = scene.occ[c.name]; return !!o && occAt(o, p) > 128; }
      if (c.kind === 'critter') { const q = proj(c.c.x, c.c.y + c.c.h / 2, c.c.z), r = Math.max(4, c.c.w / 2 * q.s); return Math.abs(p.x - q.x) < r && Math.abs(p.y - q.y) < Math.max(4, c.c.h / 2 * q.s) + 2; }
      return inPlank(c.a, p, 2);
    }
    function inPlank(a, p, m) {
      const r = rectOf(a), s = a.s;
      if (s.clip) { const [x0, y0, x1, y1] = s.clip; if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return false; }
      const edge = edgeOf(s); if (edge && (edge.below ? p.y < s.bottom : p.y > s.bottom)) return false; // the hidden part
      if (r.tilt) { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, an = -r.tilt * Math.PI / 180, dx = p.x - cx, dy = p.y - cy; const qx = dx * Math.cos(an) - dy * Math.sin(an), qy = dx * Math.sin(an) + dy * Math.cos(an); return Math.abs(qx) <= r.w / 2 + m && Math.abs(qy) <= r.h / 2 + m; }
      return p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m;
    }
    function stepWads(dt) {
      if (!wads.length) return;
      const list = cards();
      for (const w of wads) {
        let t = dt;
        while (t > 0 && !w.done) {
          const h = Math.min(t, 1 / 480); t -= h; const z0 = w.z;
          w.vy -= G * h; w.x += w.vx * h; w.y += w.vy * h; w.z += w.vz * h; w.t += h;
          for (const c of list) {
            if (!(z0 < c.z && w.z >= c.z)) continue;
            const p = proj(w.x, w.y, w.z);
            if (c.kind === 'plank' && c.a.hit) continue;
            if (!hitTest(c, p) && !(c.kind === 'plank' && w.rel.has(c.a) && inPlank({ ...c.a, x: w.rel.get(c.a) }, p, 2))) continue;
            w.done = true;
            if (c.kind === 'plank') hitPlank(c.a, p, w);
            else if (c.kind === 'critter') { c.c.gag = now + 1.2; pop(p.x, p.y - 10, c.c.kind === 'cat' ? 'MREOW!' : 'eek!', '#9fd3ff'); sound(c.c.kind === 'cat' ? 'cat' : 'squeak'); addSplat(p, c.z - 0.01); missed(w); }
            else { sound('tap'); addSplat(p, c.z - 0.01, scene.occ[c.name]); missed(w); }
            break;
          }
          if (!w.done && (w.y < 0 || w.z > BACK)) { w.done = true; const p = proj(w.x, Math.max(0, w.y), Math.min(w.z, BACK)); sound('tap'); addSplat(p, Math.min(w.z, BACK)); missed(w); }
        }
        if (w.done && w.doneAt == null) w.doneAt = now;
      }
      wads = wads.filter((w) => !w.done || now - w.doneAt < 0.09);
    }
    /** a miss at a Plank you were aiming at: say whether the breath sent it too far or not far enough */
    function missed(w) {
      const a = w.target; if (!a || a.hit || a.gone) return;
      const tol = NOTCH * SPAN * 0.5, r = rectOf(a);
      if (w.Z > a.s.z + tol) pop(r.x + r.w / 2, r.y - 4, 'OVER', '#ffd27a');
      else if (w.Z < a.s.z - tol) pop(r.x + r.w / 2, r.y - 4, 'SHORT', '#ffd27a');
    }
    function addSplat(p, z, o) {
      const s = { x: p.x, y: p.y, r: Math.max(2.5, 1.4 * p.s) * 1.6, t: now, z };
      if (o?.im) s.mask = maskedSplat(s, o); // on a cut-out: only on its own pixels
      splats.push(s);
    }
    function hitPlank(a, p, w) {
      a.hit = true; a.hitAt = now; a.face = 'splat'; hits++; streak++; best = Math.max(best, streak);
      const r = rectOf(a); a.splats.push({ dx: p.x - (r.x + r.w / 2), dy: p.y - (r.y + r.h / 2), r: Math.max(2.5, 1.4 * p.s) * 1.6, t: now });
      const pts = pointsOf(a.s); score += pts; total += pts;
      pop(p.x, p.y - 12, 'SPLAT!', '#fffaf0', true); pop(p.x, p.y + 6, `+${pts}`, '#ffd27a');
      if (PRAISE[streak]) { banner = { t: now, text: PRAISE[streak], sub: `${streak} in a row` }; sound('streak'); }
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
        const t = clampP({ x: press.P0.x + (press.last.x - press.x0) * g2 / k, y: press.P0.y + (press.last.y - press.y0) * g2 / k }), q = 1 - Math.exp(-30 * dt);
        P = { x: P.x + (t.x - P.x) * q, y: P.y + (t.y - P.y) * q };
        // the scope: only for long shots, once the crosshair rests near a far Plank (it stays on until you let go)
        const far = !press.scope && now - press.t0 > 0.12 && apps.find((a) => !a.hit && a.rise > 0.3 && a.s.z >= SCOPE_Z && near(a, P));
        if (far) {
          press.scope = true; if (zoom <= 1.02) zTop = far.s.z >= FAR_Z ? ZFAR : ZMAX; S = { x: sx(P.x), y: sy(P.y) }; press.P0 = { ...P }; press.x0 = press.last.x; press.y0 = press.last.y;
        }
        if (press.scope) { const e = 1 - Math.exp(-3 * dt); S = { x: S.x + (W / 2 - S.x) * e, y: S.y + (H * 0.46 - S.y) * e }; } // bring it to the middle
      }
      const flying = wads.some((w) => !w.done);
      const zt = press?.scope ? zTop : flying ? zoom : 1; // stay in while a wad flies, then ease out
      zoom += (zt - zoom) * (1 - Math.exp(-(zt > zoom ? 10 : 5) * dt)); if (Math.abs(zoom - 1) < 0.002) zoom = 1;
      stepWads(dt);
      if (phase === 'pose') for (const a of apps) if (a.posedMoving) movePlank(a, dt);
      if (phase !== 'play') return;
      clock = Math.max(0, clock - dt);
      if (clock <= 0) return endRound();
      const sec = Math.ceil(clock); if (sec <= 10 && sec !== lastTick) { lastTick = sec; sound('tick', sec <= 3); }
      if (now >= nextAt) deal();
      for (const a of apps) {
        const age = now - a.t0, s = a.s;
        movePlank(a, dt);
        a.rise = a.hit ? Math.max(0, a.rise - dt / 0.45) : age < 0.15 ? age / 0.15 : age < 0.15 + a.win ? 1 : Math.max(0, 1 - (age - 0.15 - a.win) / 0.2);
        if (a.hit && now - a.hitAt > 0.3) a.face = 'dizzy';
        if (!a.hit && !a.taunted && age > 0.15 + a.win) {
          a.taunted = true; a.face = 'taunt'; streak = 0; const r = rectOf({ ...a, rise: 1 });
          pop(r.x + r.w / 2, r.y - 6, TAUNTS[Math.floor(rnd() * TAUNTS.length)], '#ff8a6a'); sound('taunt');
        }
        if (!a.hit && !a.taunted) { // blink now and then; flinch when a wad comes close
          if (now > a.blinkAt) { a.face = 'blink'; if (now > a.blinkAt + 0.14) { a.face = 'idle'; a.blinkAt = now + 1.5 + rnd() * 2.5; } }
          if (wads.some((w) => !w.done && w.z > a.s.z - 120 && w.z < a.s.z)) a.face = 'duck';
          else if (a.face === 'duck') a.face = 'idle';
        }
        if ((a.hit && a.rise <= 0) || age > a.win + 0.45) a.gone = true;
      }
      apps = apps.filter((a) => !a.gone);
      for (const c of critters) {
        if (!c.live && ROUND - clock >= c.at) { c.live = true; c.x = c.x0; c.at += c.every; }
        if (c.live) { c.x += c.vx * dt * (c.gag > now ? 3 : 1); if ((c.x - c.x1) * Math.sign(c.vx) > 0) c.live = false; }
      }
    }
    /** a riding or walking Plank moves along, but stops dead (and ducks) while a wad aimed at him is on its way: he
     *  moved further during a flight than half his width, so a dead-centre shot used to miss him */
    function movePlank(a, dt) {
      const s = a.s; if (!moving(s) || a.hit) return;
      if (wads.some((w) => !w.done && w.z < s.z && w.rel.has(a))) return;
      a.x += a.dir * (s.look === 'ride' ? 80 : 60) * (scene.cam.F / s.z / 6.5) * dt;
      if (a.x < s.x0 || a.x > s.x1) { a.dir *= -1; a.x = Math.min(s.x1, Math.max(s.x0, a.x)); }
    }
    function endRound() {
      apps = []; wads = []; press = null;
      if (score >= goal()) { phase = 'between'; banner = { t: now, text: 'GOAL MET!', sub: `${score} points · round ${round + 1} next`, stay: true }; sound('win'); emit('round-won', { round, score }); setTimeout(() => alive && phase === 'between' && startRound(round + 1), 2200); }
      else { phase = 'over'; banner = { t: now, text: 'TIME', sub: `${total} points · round ${round} · tap to play again`, stay: true }; sound('over'); emit('over', { round, score: total, hits, shots }); }
    }

    // ---------- drawing
    function drawPlate() {
      g.fillStyle = '#120c08'; g.fillRect(0, 0, W, H);
      g.drawImage(scene.plate, 0, 0, PW, PH, sx(0), sy(0), PW * K, PH * K);
      if (wings && (sx(0) > 0.5 || sx(PW) < W - 0.5)) { // the side wings (made once per size), panned and zoomed with the plate
        for (const w of [wings.L, wings.R]) g.drawImage(w, sx(w.x0), sy(0), w.wpl * K, PH * K);
      }
      // the lamp breathes a little
      const f = 0.06 + 0.04 * Math.sin(now * 7) * Math.sin(now * 2.3), gl = g.createRadialGradient(sx(190), sy(80), 2, sx(190), sy(80), 260 * K);
      gl.addColorStop(0, `rgba(255,190,110,${f})`); gl.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gl; g.fillRect(sx(0), sy(0), PW * K, 400 * K);
    }
    function drawPlank(a) {
      const r = rectOf(a), art = plankArt(a.face, a.s); if (!art || a.rise <= 0) return;
      g.save();
      if (a.s.clip) { const [x0, y0, x1, y1] = a.s.clip; g.beginPath(); g.rect(sx(x0), sy(y0), (x1 - x0) * K, (y1 - y0) * K); g.clip(); }
      const edge = edgeOf(a.s); // he comes up from behind an edge (or hangs down from a beam): nothing of him past it
      if (edge) { g.beginPath(); if (edge.below) g.rect(sx(r.x - r.w), sy(a.s.bottom), r.w * 3 * K, r.h * 2 * K); else g.rect(sx(r.x - r.w), sy(a.s.bottom - r.h * 2), r.w * 3 * K, r.h * 2 * K); g.clip(); }
      const cx = sx(r.x + r.w / 2), cy = sy(r.y + r.h / 2); g.translate(cx, cy); if (r.tilt) g.rotate(r.tilt * Math.PI / 180);
      const sc = r.w * K / art.iw, pw = art.width * sc, ph = art.height * sc;
      g.save(); if (r.flip) g.scale(1, -1); g.drawImage(art, -pw / 2, -ph / 2, pw, ph); g.restore();
      if (a.splats.length) { // the wads that got him stay on him (and go down with him)
        g.beginPath(); g.rect(-r.w * K / 2, -r.h * K / 2, r.w * K, r.h * K); g.clip();
        for (const s of a.splats) splatShape(g, s.dx * K, s.dy * K, s.r * K, s.t, Math.min(1, (now - s.t) / 0.8));
      }
      g.restore();
      if (a.hit && a.rise > 0.1) { // dizzy stars
        g.fillStyle = '#ffe680'; for (let i = 0; i < 3; i++) { const an = now * 8 + i * 2.1; g.beginPath(); g.arc(sx(r.x + r.w / 2) + Math.cos(an) * r.w * K * 0.55, sy(r.y) - 4 + Math.sin(an) * 4, Math.max(1.5, 3 * K), 0, 7); g.fill(); }
      }
    }
    function drawTag(a, ring) { // the points tag and his time left (kept clear of the top bar and the breath ring)
      if (a.hit || a.taunted || a.rise <= 0.6) return;
      const r = rectOf(a), left = Math.max(0, 1 - (now - a.t0) / (a.win + 0.15));
      let tx = sx(r.x + r.w / 2), ty = sy(r.y) - 8;
      if (ring && Math.abs(tx - ring.x) < ring.R + 20 && ty > ring.y - ring.R - 22 && ty - 15 < ring.y + ring.R) ty = ring.y - ring.R - 8; // over the breath ring, not under it
      if (ty < BAR + 16) { // no room above him: beside him instead (and outside the breath ring)
        tx = sx(r.x + r.w) + 22; ty = Math.max(BAR + 16, sy(r.y) + 14);
        if (ring && Math.abs(ty - ring.y) < ring.R + 8 && tx - 17 < ring.x + ring.R + 4) tx = ring.x + ring.R + 22;
      }
      tx = Math.min(W - 20, Math.max(20, tx));
      g.fillStyle = 'rgba(18,12,8,.82)'; g.fillRect(tx - 17, ty - 15, 34, 15); g.fillStyle = '#ffd27a'; g.font = '800 10px system-ui'; g.textAlign = 'center'; g.fillText(`+${pointsOf(a.s)}`, tx, ty - 4);
      g.fillStyle = left > 0.35 ? '#6fcf7a' : '#ff6b5a'; g.fillRect(tx - 17, ty, 34 * left, 2.5);
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
        for (const lx of [-0.3, 0.3]) { g.beginPath(); g.moveTo(lx * c.w * s, 0); g.lineTo(lx * c.w * s + Math.sin(now * 9 + lx * 9) * 0.8 * s, c.h / 2 * s); g.stroke(); } // legs
        g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(c.w / 2 * s + 1.2 * s, -c.h / 2.6 * s, Math.max(0.8, 0.6 * s), 0, 7); g.fill();
      } else {
        g.fillStyle = '#3a2214'; g.beginPath(); g.ellipse(0, 0, c.w / 2 * s, c.h / 2 * s, 0, 0, 7); g.fill();
        g.strokeStyle = '#2a170c'; g.lineWidth = Math.max(0.6, 0.25 * s); const leg = Math.sin(now * 30) * 0.4 * s;
        for (const lx of [-1, 0, 1]) { g.beginPath(); g.moveTo(lx * s, 0); g.lineTo(lx * s + leg, c.h * 0.9 * s); g.moveTo(lx * s, 0); g.lineTo(lx * s - leg, -c.h * 0.9 * s); g.stroke(); }
        g.beginPath(); g.moveTo(c.w / 2 * s, 0); g.lineTo(c.w * 0.9 * s, -0.8 * s); g.moveTo(c.w / 2 * s, 0); g.lineTo(c.w * 0.9 * s, 0.8 * s); g.stroke();
      }
      g.restore();
    }
    /** The straw, first person: a striped paper straw from just under your mouth, about 5.5 in long (3.8 on a phone),
     *  seen in true perspective (a cylinder: its width falls off only with distance). It points most of the way toward
     *  the crosshair, kicks back a touch when you spit, and fades while you aim low (so it never hides the target).
     *  Returns its far end (where the wad comes out). */
    const STRAW = { len: 7.2, rad: 0.105, mouth: [0.25, -2.6, 2.4], stripes: 3, band: 0.2, pitch: 1.7 };
    function drawStraw(a, kick) {
      const f = F() * k, c0x = baseX(PW / 2), c0y = baseY(PH / 2), len = W < 600 ? 3.8 : 5.5;
      const M = [STRAW.mouth[0], STRAW.mouth[1], STRAW.mouth[2] - 0.6 * kick];
      // the way it points: from straight ahead (a little up) 85% of the way toward the crosshair's ray, 40 in out
      let T = [(a.x - c0x) / f, -(a.y - c0y) / f, 1]; const tl = Math.hypot(...T); T = T.map((v) => v / tl * 40);
      const toT = [T[0] - M[0], T[1] - M[1], T[2] - M[2]], tn = Math.hypot(...toT), fw = [0, 0.04, 1];
      let D = fw.map((v, i) => v + (toT[i] / tn - v) * 0.85); D[1] = Math.max(0.06, D[1]); // never down out of view
      const dl = Math.hypot(...D); D = D.map((v) => v / dl);
      const N = 48, pts = [];
      for (let i = 0; i <= N; i++) {
        const u = 0.12 + 0.88 * i / N, L = u * len, x = M[0] + D[0] * L, y = M[1] + D[1] * L, z = M[2] + D[2] * L, s = f / z;
        pts.push({ x: c0x + x * s, y: c0y - y * s, r: STRAW.rad * s, L });
      }
      const p0 = pts[0], p1 = pts[N], ax = p1.x - p0.x, ay = p1.y - p0.y, al = Math.hypot(ax, ay) || 1, nx = -ay / al, ny = ax / al; // across the straw
      const at = (q, off) => [q.x + nx * off, q.y + ny * off];
      const low = Math.min(1, Math.max(0, (a.y - H * 0.5) / (H * 0.22)));
      g.save(); g.globalAlpha = 1 - 0.55 * low;
      // the tube
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(...at(q, q.r)) : g.moveTo(...at(q, q.r)))); for (let i = N; i >= 0; i--) g.lineTo(...at(pts[i], -pts[i].r)); g.closePath();
      g.fillStyle = '#f6f1e6'; g.fill(); g.save(); g.clip();
      /** a band around the tube between angles lo..hi (0 faces you), following the helix when twist is set */
      const band = (lo, hi, twist) => {
        g.beginPath();
        for (let i = 0; i < N; i++) {
          const q = pts[i], q2 = pts[i + 1], t1 = twist ? q.L / STRAW.pitch * Math.PI * 2 : 0, t2 = twist ? q2.L / STRAW.pitch * Math.PI * 2 : 0;
          const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v)), c = (v) => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, v));
          const m1 = wrap(lo + t1 + (hi - lo) / 2), m2 = wrap(lo + t2 + (hi - lo) / 2), hw = (hi - lo) / 2;
          if (Math.abs(m1) - hw > Math.PI / 2 && Math.abs(m2) - hw > Math.PI / 2) continue; // round the back
          if (Math.abs(m1 - m2) > Math.PI) continue;                                      // wrapping past the back
          const a1 = c(m1 - hw), b1 = c(m1 + hw), a2 = c(m2 - hw), b2 = c(m2 + hw);
          if (a1 >= b1 && a2 >= b2) continue;
          g.moveTo(...at(q, Math.sin(a1) * q.r)); g.lineTo(...at(q2, Math.sin(a2) * q2.r)); g.lineTo(...at(q2, Math.sin(b2) * q2.r)); g.lineTo(...at(q, Math.sin(b1) * q.r)); g.closePath();
        }
        g.fill();
      };
      g.fillStyle = '#d4392d';
      for (let j = 0; j < STRAW.stripes; j++) { const c = j * Math.PI * 2 / STRAW.stripes; band(c - STRAW.band * Math.PI / 2, c + STRAW.band * Math.PI / 2, true); }
      // round: lit from the upper left, shaded down the far side, a paper seam's faint sheen
      g.fillStyle = 'rgba(255,255,255,.55)'; band(-0.95, -0.55, false);
      g.fillStyle = 'rgba(70,40,25,.18)'; band(0.35, 1.2, false);
      g.fillStyle = 'rgba(50,25,15,.28)'; band(1.05, 1.57, false);
      g.fillStyle = 'rgba(50,25,15,.18)'; band(-1.57, -1.3, false);
      g.restore();
      // its far end, seen from behind (you're at the mouth end): the opening faces away from you, so you never see into
      // it, only the tube's outside ending in a rounded rim. That rim is the end circle in perspective: as wide as the
      // tube, and as deep as the angle between your line of sight and the straw (looking straight down it, a full
      // round end; side on, a flat cut). Only its far half shows; the near half is behind the tube.
      const ang = Math.atan2(ay, ax), rr = p1.r, Lt = 0.12 * len + 0.88 * len;
      const E = [M[0] + D[0] * Lt, M[1] + D[1] * Lt, M[2] + D[2] * Lt], el = Math.hypot(...E) || 1;
      const deep = rr * Math.max(0.08, Math.abs((E[0] * D[0] + E[1] * D[1] + E[2] * D[2]) / el));
      g.save(); g.translate(p1.x, p1.y); g.rotate(ang);
      g.beginPath(); g.ellipse(0, 0, deep, rr, 0, -Math.PI / 2, Math.PI / 2); g.closePath();
      g.fillStyle = '#ece4d3'; g.fill();
      g.strokeStyle = 'rgba(60,40,25,.45)'; g.lineWidth = Math.max(0.8, rr * 0.12);
      g.beginPath(); g.ellipse(0, 0, deep, rr, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(60,40,25,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(...at(p0, p0.r)); g.lineTo(...at(p1, p1.r)); g.moveTo(...at(p0, -p0.r)); g.lineTo(...at(p1, -p1.r)); g.stroke();
      g.restore();
      return { x: p1.x, y: p1.y, dx: ax / al, r: rr };
    }
    function wadBall(x, y, r, spin) {
      g.save(); g.translate(x, y); g.rotate(spin); g.beginPath();
      for (let i = 0; i < 9; i++) { const an = i / 9 * Math.PI * 2, rr = r * (0.82 + 0.18 * Math.sin(i * 2.7 + 1.3)); i ? g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : g.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      g.closePath(); const gr = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r); gr.addColorStop(0, '#fbf7ee'); gr.addColorStop(0.7, '#ddd5c4'); gr.addColorStop(1, '#a99f8c'); g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(110,98,80,.55)'; g.lineWidth = Math.max(0.6, r * 0.12); g.beginPath(); g.moveTo(-r * 0.5, -r * 0.1); g.lineTo(r * 0.1, r * 0.2); g.lineTo(r * 0.45, -r * 0.25); g.stroke();
      g.restore(); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.4, Math.max(0.8, r * 0.18), 0, 7); g.fill();
    }
    /** where a wad is drawn: from the straw's tip for its first 0.1 s, then where it really is */
    function wadScreen(w) {
      const q = proj(w.x, w.y, w.z), e = Math.min(1, w.t / 0.1), ease = 1 - (1 - e) ** 2;
      const rf = Math.max(2.5, 0.6 * q.s * K);
      return { x: tip.x + (sx(q.x) - tip.x) * ease, y: tip.y + (sy(q.y) - tip.y) * ease, r: rf + ((tip.r || rf) * 0.85 - rf) * (1 - ease), leaving: e < 1 };
    }
    function drawWad(w) {
      const s = wadScreen(w);
      w.trail.push({ x: s.x, y: s.y, r: s.r }); if (w.trail.length > 5) w.trail.shift();
      w.trail.forEach((t, i) => { g.fillStyle = `rgba(215,235,245,${0.08 * i})`; g.beginPath(); g.arc(t.x, t.y, t.r * 0.35, 0, 7); g.fill(); });
      wadBall(s.x, s.y, s.r, w.t * 18);
    }
    /** a splat's shape (any context, its own units): the wet shadow, the cream blob, a drip growing as it runs (0..1) */
    function splatShape(c, x, y, r, seedT, drip) {
      c.fillStyle = 'rgba(70,60,50,.35)'; c.beginPath(); c.ellipse(x, y, r * 1.5, r * 1.2, 0, 0, 7); c.fill();
      c.fillStyle = '#e9e2d3'; c.beginPath(); for (let i = 0; i < 11; i++) { const an = i / 11 * Math.PI * 2, rr = r * (0.75 + 0.35 * Math.abs(Math.sin(i * 1.9 + seedT))); i ? c.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.85) : c.moveTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.85); } c.closePath(); c.fill();
      const dl = r * 1.4 * drip; if (dl > 0.5) { c.strokeStyle = 'rgba(225,235,240,.75)'; c.lineWidth = Math.max(1, r * 0.25); c.lineCap = 'round'; c.beginPath(); c.moveTo(x + r * 0.2, y + r * 0.5); c.lineTo(x + r * 0.2, y + r * 0.5 + dl); c.stroke(); }
    }
    /** a splat on a cut-out, made once (plate px, twice the detail) and kept only on the cut-out's own pixels */
    function maskedSplat(s, o) {
      const R = Math.ceil(s.r * 2.4), sc = 2, c = document.createElement('canvas'); c.width = c.height = 2 * R * sc; const q = c.getContext('2d');
      q.scale(sc, sc); splatShape(q, R, R, s.r, s.t, 1);
      q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'destination-in';
      q.drawImage(o.im, (o.x - (s.x - R)) * sc, (o.y - (s.y - R)) * sc, o.w * sc, o.h * sc);
      return { c, x0: s.x - R, y0: s.y - R, size: 2 * R };
    }
    function drawSplat(s) {
      const age = now - s.t; if (age > 2.5) return; const fade = age > 2 ? 1 - (age - 2) / 0.5 : 1;
      g.globalAlpha = fade;
      if (s.mask) g.drawImage(s.mask.c, sx(s.mask.x0), sy(s.mask.y0), s.mask.size * K, s.mask.size * K);
      else splatShape(g, sx(s.x), sy(s.y), s.r * K, s.t, Math.min(1, age / 0.8));
      g.globalAlpha = 1;
    }
    /** the reticle's size (screen px): an open middle wider than the Plank nearest the aim, the breath ring outside it */
    function reticle(ap, a) {
      const nr = nearestPlank(ap), on = nearestPlank(ap, 30), r = on && rectOf(on), gap = Math.min(30, Math.max(7, r ? r.w * K * 0.5 + 4 : 7));
      return { x: a.x, y: a.y, nr, gap, R: gap + 19 };
    }
    function draw() {
      view(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.translate(shake.x, shake.y);
      drawPlate();
      // far to near: Planks, critters, the cut-outs drawn over them, the wads in flight and the splats where they hit
      const items = [];
      for (const a of apps) items.push({ z: a.s.z, kind: 'plank', d: () => drawPlank(a) });
      for (const c of critters) if (c.live) items.push({ z: c.z, kind: 'critter', d: () => drawCritter(c) });
      for (const name of liveOcc()) items.push({ z: scene.occZ[name], kind: 'occ:' + name, d: () => drawOcc(name) });
      for (const s of splats) items.push({ z: s.z, kind: 'splat', d: () => drawSplat(s) });
      const late = []; // a wad still leaving the straw is drawn over it
      for (const w of wads) (wadScreen(w).leaving ? late : items).push({ z: w.z, kind: 'wad', d: () => drawWad(w) });
      items.sort((p, q) => q.z - p.z).forEach((i) => i.d());
      drawOrder = items.map((i) => ({ kind: i.kind, z: i.z }));
      splats = splats.filter((s) => now - s.t < 2.5);
      for (const p of puffs) { const q = (now - p.t) / 2.6; g.fillStyle = `rgba(230,225,215,${0.22 * (1 - q)})`; g.beginPath(); g.arc(sx(p.x + q * 30), sy(p.y - q * 120), (p.r + q * 40) * K, 0, 7); g.fill(); }
      for (const p of sparks) { g.fillStyle = p.col; g.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2, 2); }
      const ap = aim(), a = { x: sx(ap.x), y: sy(ap.y) }, ring = press && reticle(ap, a);
      for (const q of apps) drawTag(q, ring);
      // the straw (decoration), the puff and spit at its tip, then a wad tumbling out
      const kk = Math.max(0, 1 - (now - kick) / 0.18);
      tip = drawStraw(a, kk);
      if (kk > 0) { g.fillStyle = `rgba(240,235,225,${0.45 * kk})`; g.beginPath(); g.arc(tip.x, tip.y, 6 + 14 * (1 - kk), 0, 7); g.fill(); }
      for (const d of drops) { const q = now - d.t; if (q > 0.35) continue; g.fillStyle = `rgba(215,235,245,${0.8 * (1 - q / 0.35)})`; g.beginPath(); g.arc(d.x + d.vx * q, d.y + d.vy * q + 300 * q * q, d.r, 0, 7); g.fill(); }
      drops = drops.filter((d) => now - d.t < 0.35);
      late.forEach((i) => i.d());
      for (const t of pops) { const q = (now - t.t) / 1; if (q > 1) continue; g.globalAlpha = 1 - q * q; g.fillStyle = t.col; g.font = `900 ${t.big ? 20 + 8 * (1 - q) : 14}px system-ui`; g.textAlign = 'center'; g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 3; const x = Math.min(W - 30, Math.max(30, sx(t.x))), y = Math.max(56, sy(t.y)) - 30 * q; g.strokeText(t.text, x, y); g.fillText(t.text, x, y); g.globalAlpha = 1; }
      pops = pops.filter((t) => now - t.t < 1);
      // the crosshair and the breath ring, with the notch for the nearest Plank
      if (press) {
        // ticks only, with an open middle wider than the Plank you aim at (so he is never under the reticle), a tiny dot
        // at the exact aim, and the breath ring outside the ticks
        const t = now - press.t0, p = breath(t), { nr, gap, R } = ring;
        g.lineCap = 'round'; g.beginPath(); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { g.moveTo(a.x + dx * gap, a.y + dy * gap); g.lineTo(a.x + dx * (gap + 9), a.y + dy * (gap + 9)); }
        g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; g.stroke(); g.strokeStyle = 'rgba(255,240,210,.95)'; g.lineWidth = 2; g.stroke(); g.lineCap = 'butt';
        g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(a.x, a.y, 1.9, 0, 7); g.fill(); g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(a.x, a.y, 1.1, 0, 7); g.fill();
        const A0 = Math.PI * 0.75, A1 = A0 + Math.PI * 1.5, an2 = (v) => A0 + (A1 - A0) * v;
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(a.x, a.y, R, A0, A1); g.stroke();
        if (nr) { const ps = pStar(nr.s.z); g.strokeStyle = 'rgba(111,207,122,.95)'; g.beginPath(); g.arc(a.x, a.y, R, an2(Math.max(0, ps - NOTCH)), an2(Math.min(1, ps + NOTCH))); g.stroke(); }
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
      if (coarse) { // which thumb: the crosshair sits on the other side of it
        const b = thumbBtn(); g.fillStyle = 'rgba(18,12,8,.7)'; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 13); g.fill();
        g.strokeStyle = 'rgba(255,210,122,.45)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#f6e8cf'; g.font = '700 11px system-ui'; g.textAlign = 'center'; g.fillText(leftThumb ? 'Left thumb' : 'Right thumb', b.x + b.w / 2, b.y + 17);
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

    // ---------- sounds and haptics. All made here with WebAudio (no files): short noise and tone shapes, cartoon
    // style. Decoration only: none of it carries timing (the ring does). Mute follows the site's sound switch.
    let ac = null, out = null, noiseBuf = null;
    function actx() {
      if (opts.mute?.()) return null;
      try {
        if (!ac) {
          ac = new AudioContext();
          const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
          out = ac.createGain(); out.gain.value = 0.8; out.connect(comp).connect(ac.destination);
          noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ac.state === 'suspended') ac.resume();
      } catch { return null; }
      return ac;
    }
    /** a tone: type, pitch from f0 to f1 over dur, peak gain, start offset, optional vibrato [rate, depth] and lowpass */
    function tone(a, { type = 'sine', f0, f1 = f0, dur, gain, at = 0, attack = 0.005, vib, lp }) {
      const t = a.currentTime + at, o = a.createOscillator(), e = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      if (vib) { const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
      let node = o; if (lp) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + attack); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      node.connect(e).connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
    /** a noise burst through a filter whose frequency moves from f0 to f1 */
    function noise(a, { type = 'bandpass', f0, f1 = f0, q = 1, dur, gain, at = 0, attack = 0.004 }) {
      const t = a.currentTime + at, src = a.createBufferSource(), f = a.createBiquadFilter(), e = a.createGain();
      src.buffer = noiseBuf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + attack); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(e).connect(out); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }
    const SOUNDS = {
      // a soft breath in as you start to aim
      in: (a) => noise(a, { f0: 900, f1: 1400, q: 0.8, dur: 0.22, gain: 0.05, attack: 0.12 }),
      // the spit: a "pft", a little thump, then the wad whistling away
      puff: (a) => { noise(a, { f0: 1900, f1: 650, q: 1.4, dur: 0.1, gain: 0.32 }); tone(a, { f0: 130, f1: 60, dur: 0.08, gain: 0.25 }); noise(a, { f0: 3200, f1: 1100, q: 7, dur: 0.32, gain: 0.05, at: 0.04, attack: 0.05 }); },
      // a hit on Plank: a wet splat and a cartoon boing
      splat: (a) => { noise(a, { type: 'lowpass', f0: 1100, f1: 220, q: 0.7, dur: 0.24, gain: 0.5 }); tone(a, { f0: 170, f1: 55, dur: 0.2, gain: 0.35 }); tone(a, { f0: 190, f1: 280, dur: 0.38, gain: 0.12, at: 0.07, vib: [15, 35] }); },
      // a miss that hits the scenery: a dull wooden tok
      tap: (a) => { tone(a, { f0: 780, f1: 520, dur: 0.06, gain: 0.22 }); noise(a, { type: 'highpass', f0: 2200, dur: 0.025, gain: 0.1 }); },
      // Plank pops up somewhere
      spy: (a) => { tone(a, { f0: 320, f1: 900, dur: 0.07, gain: 0.1 }); noise(a, { f0: 2500, q: 2, dur: 0.03, gain: 0.05 }); },
      // he got away: "nyah-nyah"
      taunt: (a) => { tone(a, { type: 'square', f0: 540, dur: 0.12, gain: 0.05, lp: 1800, vib: [9, 12] }); tone(a, { type: 'square', f0: 450, dur: 0.2, gain: 0.05, at: 0.13, lp: 1800, vib: [9, 12] }); },
      // a critter got hit: the cat's "mreow", or a mouse's squeak
      cat: (a) => { tone(a, { type: 'sawtooth', f0: 620, f1: 980, dur: 0.18, gain: 0.07, lp: 2200 }); tone(a, { type: 'sawtooth', f0: 980, f1: 520, dur: 0.3, gain: 0.07, at: 0.16, lp: 1800 }); },
      squeak: (a) => { tone(a, { f0: 2300, f1: 3300, dur: 0.07, gain: 0.06 }); tone(a, { f0: 2500, f1: 3600, dur: 0.08, gain: 0.06, at: 0.1 }); },
      // a streak: a quick sparkle
      streak: (a) => [1320, 1760, 2093, 2637].forEach((f, i) => tone(a, { type: 'triangle', f0: f, dur: 0.22, gain: 0.06, at: i * 0.05 })),
      // the last ten seconds: a woodblock tick (higher for the last three)
      tick: (a, hi) => tone(a, { f0: hi ? 1900 : 1450, f1: hi ? 1700 : 1300, dur: 0.04, gain: hi ? 0.1 : 0.06 }),
      // a round starts: the foreman's whistle
      whistle: (a) => tone(a, { f0: 2150, dur: 0.4, gain: 0.06, attack: 0.02, vib: [28, 110] }),
      // goal met: a little bell run
      win: (a) => [523, 659, 784, 1047].forEach((f, i) => { tone(a, { type: 'triangle', f0: f, dur: 0.55, gain: 0.12, at: i * 0.09 }); tone(a, { f0: f * 2, dur: 0.3, gain: 0.03, at: i * 0.09 }); }),
      // time's up without the goal: a sad trombone "wah-wah"
      over: (a) => [[233, 220], [220, 207], [207, 175]].forEach(([f0, f1], i) => tone(a, { type: 'sawtooth', f0, f1, dur: i === 2 ? 0.6 : 0.28, gain: 0.07, at: i * 0.3, lp: 900, vib: i === 2 ? [6, 5] : undefined })),
    };
    function sound(kind, arg) { const a = actx(); if (!a) return; try { SOUNDS[kind]?.(a, arg); } catch { /* no sound */ } }
    const buzz = (p) => { try { opts.haptic?.(p); } catch { /* no vibration */ } };

    return {
      canvas: cv,
      /** tests: the state, and a shot fired from code at plate point (x, y) with breath p */
      state: () => ({ wad: wads[0] && { x: wads[0].x, y: wads[0].y, z: wads[0].z, t: wads[0].t, vz: wads[0].vz }, wads: wads.length, phase, round, clock, score, total, hits, shots, streak, best, zoom, P: { ...P }, lastShot, drawOrder, apps: apps.map((a) => ({ id: a.s.id, dir: a.dir, rise: a.rise, hit: a.hit, face: a.face, rect: rectOf(a), z: a.s.z })) }),
      start: () => { if (phase !== 'play') reset(); },
      /** tests: Plank held still in one spot (fully out, or `rise` of the way), nothing else moving (move: a riding or
       *  walking Plank keeps moving, as in play) */
      pose(id, rise = 1, x, move = false) {
        const sp = scene.spots.find((q) => q.id === id); if (!sp) return false;
        phase = 'pose'; critters.forEach((c) => { c.live = false; });
        apps = [{ s: sp, t0: now, win: 1e9, hit: false, rise, x: x ?? sp.cx, dir: 1, face: 'idle', blinkAt: 1e9, splats: [], posedMoving: move }]; return true;
      },
      /** tests: the critters out where they walk (t: 0..1 along the way) */
      critters(t = 0.5) { if (!critters.length) startRound(1); phase = 'pose'; apps = []; for (const c of critters) { c.live = true; c.x = c.x0 + (c.x1 - c.x0) * t; } return true; },
      fireAt(x, y, p) { const b = press; press = null; fireP(p, { x, y }); press = b; return true; },
      /** tests: would a wad aimed at plate (x, y) with the notch breath for the posed Plank hit him? (the game's own flight) */
      probe(x, y) {
        const a = apps[0]; if (!a) return null;
        const v = launch(x, y, a.s.z), w = { x: 0, y: CAM_Y, z: 0, ...v }, list = cards();
        for (let i = 0; i < 480 * 5; i++) {
          const h = 1 / 480, z0 = w.z; w.vy -= G * h; w.x += w.vx * h; w.y += w.vy * h; w.z += w.vz * h;
          for (const c of list) { if (!(z0 < c.z && w.z >= c.z)) continue; const q = proj(w.x, w.y, w.z); if (hitTest(c, q)) return c.kind === 'plank' ? 'hit' : c.kind === 'occ' ? 'occ:' + c.name : c.kind; }
          if (w.y < 0 || w.z > BACK) return 'floor';
        }
        return 'none';
      },
      /** tests: is the posed Plank drawn at plate (x, y), and not under a cut-out drawn over him? */
      visibleAt(x, y) {
        const a = apps[0]; if (!a || !inPlank(a, { x, y }, 0)) return false;
        return !liveOcc().some((n) => occAt(scene.occ[n], { x, y }) > 40);
      },
      setLeftThumb,
      destroy() { alive = false; removeEventListener('resize', size); host.classList.remove('sw-stage'); cv.remove(); try { ac?.close(); } catch { /* fine */ } },
    };
    function fireP(p, a) { // fire with a given breath (tests): the same as a release at that breath
      let held = 0; for (let i = 0; i <= 150; i++) { const t = i / 100; if (Math.abs(breath(t) - p) < Math.abs(breath(held) - p)) held = t; }
      fire(held, a);
    }
  }

  window.SpitWad = { mount, load };
})();
