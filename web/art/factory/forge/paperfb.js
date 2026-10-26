/* Omni Cardworks: Paper Football (prototype, free play). The tabletop game: flick a folded paper triangle off a
   paperclip tee through pencil uprights on a workshop table, low at table height. A centred strike tumbles clean end
   over end; an off-centre one wobbles, curves and falls short. Every make raises the next shot's difficulty, spent at
   random across distance, wind, post width, post offset and (later) moving posts on an RC car, all shown before the
   kick. Plank stands behind the posts: a make bounces off his face.
   Units are inches and seconds. A kick is { power 0..1, aim (radians), contact -1..1 } and the shot's conditions come
   from a seeded random stream, so a kick can be replayed exactly (for a checked leaderboard later).
   PaperFootball.mount(host, { art: { plank, backdrop }, onEvent }) returns { setTuning, tuning, stats, destroy, ... }. */
(() => {
  // ---------- tuning (the panel edits these; the owner sends the numbers back)
  const DEFAULT_TUNING = {
    slow: 0.55,        // flight time scale (1 = real time; lower = slower to watch)
    vMin: 45, vMax: 150, // launch speed (in/s) at power 0 and 1
    loft: 38,          // launch angle (degrees)
    aimMax: 22,        // widest aim (degrees either side)
    flickFull: 2.6,    // phone: flick speed (px/ms, at a 400 px-tall field) that gives full power
    pullFull: 0.38,    // desktop: pull-back length (share of the field's height) that gives full power
    contactZone: 1.3,  // how much of the long edge's height you can touch (1 = the edge itself), centre to end
    sweet: 0.3,        // contact within this share of it counts as clean
    offPenalty: 0.32,  // speed lost at the very edge of the zone (share)
    curve: 38,         // sideways curve from an off-centre strike (in/s² at the edge)
    windK: 7,          // sideways push per mph (in/s²)
    ramp: 0.075,       // difficulty added per make (0..1 scale; 1 ≈ the hardest mix)
    start: 0.08,       // difficulty of the first shot
    moveFrom: 4,       // moving posts can appear from this streak on
  };
  const G = 386;                      // gravity, in/s²
  const BAR = 3, POST_H = 5.2, THICK = 0.05, TEE_Z = 2.5, TEE_Y = 0.28;
  // the football: a thin sheet folded into a flat, oblong triangle, standing on its bottom corner with its long edge
  // toward the kicker. From behind it's that thin edge; its broad side shows only as it turns. (z, y), about its centre
  const TRI = [[-0.26, -0.48], [-0.12, 0.52], [0.38, -0.04]]; // bottom corner, top of the long edge, front point
  const EDGE_MID = [(TRI[0][0] + TRI[1][0]) / 2, (TRI[0][1] + TRI[1][1]) / 2], EDGE_HALF = Math.hypot(TRI[1][0] - TRI[0][0], TRI[1][1] - TRI[0][1]) / 2;
  const REST_Y = TEE_Y - TRI[0][1], YAW0 = 0.22; // resting on its bottom corner; turned a little so a sliver of the face shows

  // ---------- a small seeded random stream (mulberry32): a shot's conditions are a function of (seed, shot number)
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // the shot: difficulty d (0..~1.3) spent across the factors at random, each capped, all shown in the HUD before the kick
  function shotFor(seed, n, d, T) {
    const r = rng(seed * 7919 + n * 104729 + 13);
    const canMove = n >= T.moveFrom;
    const parts = [r(), r(), r(), r(), canMove ? r() : 0]; // distance, wind, width, offset, motion
    const sum = parts.reduce((a, b) => a + b, 0) || 1;
    const share = parts.map((p) => Math.min(1, (p / sum) * d * 2.2));
    const side = () => (r() < 0.5 ? -1 : 1);
    return {
      dist: 12 + share[0] * 26,                          // 12..38 in
      wind: side() * share[1] * 9,                        // ±9 mph
      half: 3.2 - share[2] * 1.5,                         // post half-gap 3.2..1.7 in
      offset: side() * share[3] * 5,                      // posts left/right of centre, ±5 in
      move: canMove ? { amp: share[4] * 4, speed: 0.6 + share[4] * 1.1, phase: r() * Math.PI * 2 } : null,
      d,
    };
  }
  const postX = (s, t) => s.offset + (s.move ? Math.sin(s.phase0 + t * s.move.speed * Math.PI) * s.move.amp : 0);

  // ---------- the kick: launch velocity and spin from { power, aim, contact }
  function launch(k, T) {
    const c = Math.max(-1, Math.min(1, k.contact)), clean = Math.abs(c) <= T.sweet;
    const off = clean ? 0 : (Math.abs(c) - T.sweet) / (1 - T.sweet); // 0 at the sweet spot's edge .. 1 at the zone's edge
    const v = (T.vMin + (T.vMax - T.vMin) * Math.max(0, Math.min(1, k.power))) * (1 - T.offPenalty * off * off);
    // hit high on the edge: it pops up; low: it flies flat
    const th = (T.loft + c * off * 9) * Math.PI / 180, aim = Math.max(-1, Math.min(1, k.aim / (T.aimMax * Math.PI / 180))) * T.aimMax * Math.PI / 180;
    return {
      z: TEE_Z,
      vx: v * Math.cos(th) * Math.sin(aim), vy: v * Math.sin(th), vz: v * Math.cos(th) * Math.cos(aim),
      ax: Math.sign(c) * off * T.curve * 0.4,            // an off-centre strike wobbles off line
      pitch: 0, pitchRate: -(16 - 7 * off),              // end over end (forward)
      x: 0, y: REST_Y, wob: off, roll: 0, yaw: YAW0, t: 0, clean,
    };
  }

  // ---------- 3D: the folded triangle as a prism (triangle in the y-z plane, thickness along x)
  const LOCAL = (() => {
    const v = [];
    for (const sx of [-1, 1]) for (const [z, y] of TRI) v.push([sx * THICK / 2, y, z]);
    return v; // 0-2 left face, 3-5 right face
  })();
  const FACES = [[0, 1, 2, 'face'], [5, 4, 3, 'face'], [0, 2, 5, 3, 'edge'], [0, 3, 4, 1, 'edge'], [1, 4, 5, 2, 'edge']];
  function rotate([x, y, z], pitch, yaw, roll) {
    let c = Math.cos(pitch), s = Math.sin(pitch); [y, z] = [y * c - z * s, y * s + z * c];   // about x: end over end
    c = Math.cos(yaw); s = Math.sin(yaw); [x, z] = [x * c + z * s, -x * s + z * c];          // about y
    c = Math.cos(roll); s = Math.sin(roll); [x, y] = [x * c - y * s, x * s + y * c];         // about z
    return [x, y, z];
  }

  function mount(host, opts = {}) {
    const T = { ...DEFAULT_TUNING, ...(opts.tuning || {}) };
    const art = opts.art || {};
    const img = (src) => { if (!src) return null; const i = new Image(); i.src = src; return i; };
    const A = { plank: img(art.plank), backdrop: img(art.backdrop) };
    const cv = document.createElement('canvas'); cv.className = 'pf-canvas'; cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Paper football: flick the folded paper through the pencil uprights');
    host.append(cv);
    const g = cv.getContext('2d');
    let W = 600, H = 420, dpr = 1, EYE = 0, F = 0;
    const CAM_H = 1.0, CAM_Z = 4.3;
    function size() {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(280, r.width); H = Math.max(240, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // the scale fits the narrower side (a tall phone field would push the posts off the edges), and the eye line
      // sits so the tee is near the bottom whatever the shape
      F = Math.min(H * 1.72, W * 1.2); EYE = H * 0.8 - (CAM_H - TEE_Y) * F / (TEE_Z + CAM_Z) - 4;
    }
    const proj = (x, y, z) => { const s = F / (z + CAM_Z); return { x: W / 2 + x * s, y: EYE + (CAM_H - y) * s, s }; };

    // ---------- state
    const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
    let n = 0, streak = 0, best = 0, makes = 0, kicks = 0, diff = T.start;
    let shot = null, ball = null, result = null, resultAt = 0, clock = 0, last = performance.now(), alive = true, pop = null;
    let press = null, aimLine = null, hint = true, lastKick = null;
    const levelStats = {}; // streak level -> [makes, tries]
    function nextShot() { shot = shotFor(seed, n, diff, T); shot.phase0 = shot.move ? shot.move.phase : 0; shot.t0 = clock; }
    nextShot();
    const emit = (type, detail = {}) => opts.onEvent?.(type, { ...detail, streak, best, makes, kicks });

    // ---------- input: phone flick (touch) and desktop pull-back (mouse); both produce { power, aim, contact }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }; };
    function ballScreen() { const [x, y, z] = rotate([0, EDGE_MID[1], EDGE_MID[0]], 0, YAW0, 0); const p = proj(x, REST_Y + y, TEE_Z + z); p.half = EDGE_HALF * p.s; return p; }
    cv.addEventListener('pointerdown', (e) => {
      if (ball || result || !alive) return;
      const p = pos(e), b = ballScreen(), zone = T.contactZone * b.half;
      if (Math.abs(p.x - b.x) > b.s * 0.9 || Math.abs(p.y - b.y) > zone * 1.25) return; // start on the paper's edge
      press = { mouse: e.pointerType === 'mouse', start: p, pts: [p], contact: (b.y - p.y) / zone }; // up the edge = +
      cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!press) return; const p = pos(e); press.pts.push(p); if (press.pts.length > 40) press.pts.shift();
      if (press.mouse) aimLine = { from: press.start, to: p };
    });
    const endPress = (e) => {
      if (!press) return; const pr = press; press = null; aimLine = null;
      const p = pos(e); pr.pts.push(p);
      let power, aim;
      const k = 400 / H; // feel the same on any field size
      if (pr.mouse) { // pull back (down) and release: length is power, the opposite of the pull's angle is the aim
        const dx = p.x - pr.start.x, dy = p.y - pr.start.y; if (dy < 8) return;
        power = Math.min(1, (dy / H) / T.pullFull); aim = Math.atan2(-dx, dy);
      } else { // flick up: the last ~90 ms of the swipe; its speed is power, its slant the aim
        const from = pr.pts.find((q) => p.t - q.t <= 90) || pr.pts[0], dt = Math.max(12, p.t - from.t);
        const vy = (p.y - from.y) / dt * k, vx = (p.x - from.x) / dt * k; if (vy > -0.25) return;
        power = Math.min(1, -vy / T.flickFull); aim = Math.atan2(vx, -vy);
      }
      kick({ power, aim, contact: pr.contact });
    };
    cv.addEventListener('pointerup', endPress);
    cv.addEventListener('pointercancel', () => { press = null; aimLine = null; });

    function kick(k) {
      ball = launch(k, T); ball.t0 = clock; hint = false; kicks++; lastKick = { ...k, clean: ball.clean };
      ball.spin = { wobPhase: Math.random() * 6 };
      sfx('flick'); emit('kick', { kick: k });
    }

    // ---------- flight
    function settle(r, at) {
      result = r; resultAt = clock;
      const lv = levelStats[streak] || (levelStats[streak] = [0, 0]); lv[1]++;
      if (r === 'good') {
        lv[0]++; streak++; makes++; if (streak > best) best = streak; diff = T.start + streak * T.ramp;
        pop = { text: ['POW!', 'Nice kick!', 'Splits it!', 'Money!'][Math.floor(Math.random() * 4)], at: clock };
        sfx('good'); emit('make');
      } else { emit('miss', { why: r }); streak = 0; diff = T.start; sfx(r === 'doink' ? 'doink' : 'miss'); }
      lastKick && (lastKick.result = r);
      if (at) ball.after = at;
    }
    function step(dt) {
      const b = ball; if (!b) return;
      const z0 = b.z, y0 = b.y, x0 = b.x;
      b.vx += (b.ax + shot.wind * T.windK) * dt; b.vy -= G * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.t += dt;
      b.pitch += b.pitchRate * dt;
      b.roll = Math.sin(b.t * 9 + b.spin.wobPhase) * 0.7 * b.wob; b.yaw = YAW0 + Math.sin(b.t * 6.5) * 0.9 * b.wob;
      const D = TEE_Z + shot.dist, P = D + 16; // posts' plane, Plank's plane
      if (!result && z0 < D && b.z >= D) { // crossing the posts' plane: judged exactly there
        const f = (D - z0) / (b.z - z0), x = x0 + (b.x - x0) * f, y = y0 + (b.y - y0) * f, px = postX(shot, clock - shot.t0);
        const dl = Math.abs(x - (px - shot.half)), dr = Math.abs(x - (px + shot.half));
        if (y < POST_H + 0.3 && Math.min(dl, dr) < 0.28 && y > 0.4) { settle('doink'); b.vz *= -0.35; b.vx += (x < px ? -1 : 1) * 20; return; }
        if (y < 0.9) { settle('short'); b.vz *= -0.25; return; } // into the RC car's base
        settle(Math.abs(x - px) < shot.half && y >= BAR ? 'good' : y < BAR && Math.abs(x - px) < shot.half ? 'under' : x < px ? 'wide-left' : 'wide-right');
      }
      if (result === 'good' && !b.thunked && z0 < P && b.z >= P && Math.abs(b.x - shot.offset) < 1.6 && b.y < 6.5) { // off Plank's face
        b.thunked = true; b.vz *= -0.32; b.vx *= 0.4; b.vy = Math.max(b.vy, 40); sfx('thunk'); emit('plank');
      }
      if (b.y <= 0 && b.vy < 0) {
        if (!result) settle('short');
        b.y = 0; b.vy *= -0.25; b.vz *= 0.55; b.vx *= 0.55; b.pitchRate *= 0.5; if (Math.abs(b.vy) < 8) b.vy = 0;
      }
    }

    // ---------- drawing
    function backdrop() {
      const edge = proj(0, 0, 90).y;
      const sky = g.createLinearGradient(0, 0, 0, edge); sky.addColorStop(0, '#120c08'); sky.addColorStop(1, '#2a1b10');
      g.fillStyle = sky; g.fillRect(0, 0, W, edge + 1);
      const p = A.backdrop;
      if (p?.complete && p.naturalWidth) {
        g.save(); g.filter = 'blur(5px) brightness(.5) saturate(.85)'; const s = Math.max(W / p.naturalWidth, (edge + 30) / p.naturalHeight) * 1.1;
        g.drawImage(p, (W - p.naturalWidth * s) / 2, edge + 16 - p.naturalHeight * s, p.naturalWidth * s, p.naturalHeight * s); g.restore();
      }
      const wood = g.createLinearGradient(0, edge, 0, H); wood.addColorStop(0, '#5a3618'); wood.addColorStop(0.45, '#9a5f2a'); wood.addColorStop(1, '#c68340');
      g.fillStyle = wood; g.fillRect(0, edge, W, H - edge);
      g.strokeStyle = 'rgba(55,28,8,.22)'; g.lineWidth = 1;
      for (let x = -60; x <= 60; x += 3.2) { const a = proj(x, 0, 0.5), b = proj(x * 0.98, 0, 90); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      const lamp = g.createRadialGradient(W * 0.5, H * 0.6, 10, W * 0.5, H * 0.6, W * 0.7); lamp.addColorStop(0, 'rgba(255,196,120,.2)'); lamp.addColorStop(1, 'rgba(255,196,120,0)');
      g.fillStyle = lamp; g.fillRect(0, edge, W, H - edge);
      const vig = g.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, W * 0.85); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.45)');
      g.fillStyle = vig; g.fillRect(0, 0, W, H);
    }
    function plank(D) {
      const k = A.plank, P = TEE_Z + D + 16, base = proj(shot.offset, 0, P);
      const hh = 6.5 * base.s;
      if (k?.complete && k.naturalWidth) { const ww = hh * k.naturalWidth / k.naturalHeight; g.drawImage(k, base.x - ww / 2, base.y - hh, ww, hh); }
      else { g.fillStyle = '#e8c860'; g.fillRect(base.x - 2 * base.s, base.y - hh, 4 * base.s, hh); }
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(base.x, base.y, 2.6 * base.s, 0.5 * base.s, 0, 0, Math.PI * 2); g.fill();
    }
    function pencil(x, z, bottom) {
      const b = proj(x, bottom, z), t = proj(x, POST_H, z), w = Math.max(2, 0.36 * b.s);
      g.fillStyle = '#f2b81d'; g.fillRect(b.x - w / 2, t.y + w * 1.2, w, b.y - t.y - w * 1.2);
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(b.x + w * 0.12, t.y + w * 1.2, w * 0.36, b.y - t.y - w * 1.2);
      g.fillStyle = '#bfc3c8'; g.fillRect(b.x - w / 2, t.y + w * 0.65, w, w * 0.6);
      g.fillStyle = '#ef8fa6'; g.beginPath(); g.roundRect(b.x - w / 2, t.y, w, w * 0.72, [w * 0.3, w * 0.3, 0, 0]); g.fill();
    }
    function posts(t) {
      const z = TEE_Z + shot.dist, px = postX(shot, t), hf = shot.half;
      // the RC car the posts ride on: a small box on four wheels, a wire antenna
      const L = proj(px - hf - 0.8, 0.9, z), R = proj(px + hf + 0.8, 0, z), s = L.s;
      g.fillStyle = 'rgba(0,0,0,.32)'; g.beginPath(); g.ellipse((L.x + R.x) / 2, R.y + 1, (R.x - L.x) / 2 + 4, 0.35 * s, 0, 0, Math.PI * 2); g.fill();
      for (const wx of [px - hf - 0.3, px + hf + 0.3]) { const w = proj(wx, 0.32, z); g.fillStyle = '#1d1a17'; g.beginPath(); g.arc(w.x, w.y, 0.32 * s, 0, Math.PI * 2); g.fill(); g.fillStyle = '#6b6f75'; g.beginPath(); g.arc(w.x, w.y, 0.13 * s, 0, Math.PI * 2); g.fill(); }
      const top = proj(0, 0.9, z).y, bot = proj(0, 0.45, z).y;
      g.fillStyle = shot.move ? '#b23a2a' : '#8a5a2e'; g.beginPath(); g.roundRect(L.x, top, R.x - L.x, bot - top, 0.15 * s); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(L.x, top, R.x - L.x, (bot - top) * 0.3);
      if (shot.move) { const a = proj(px + hf + 0.4, 0.9, z), b = proj(px + hf + 0.9, 3.4, z); g.strokeStyle = '#c9ccd1'; g.lineWidth = Math.max(1, 0.06 * s); g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(b.x + 4, (a.y + b.y) / 2, b.x, b.y); g.stroke(); }
      const a = proj(px - hf, BAR, z), b = proj(px + hf, BAR, z);
      g.strokeStyle = '#d9a441'; g.lineWidth = Math.max(2, 0.2 * s); g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      pencil(px - hf, z, 0.9); pencil(px + hf, z, 0.9);
    }
    function paper(b) {
      const pts = LOCAL.map((v) => { const [x, y, z] = rotate(v, b.pitch, b.yaw, b.roll); return proj(b.x + x, b.y + y, b.z + z); });
      const light = [-0.4, 0.7, -0.6];
      const shade = (i) => { // the face's normal (in screen space, roughly) against a key light from above left
        const f = FACES[i], v = f.slice(0, -1).map((k) => rotate(LOCAL[k], b.pitch, b.yaw, b.roll));
        const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
        return 0.78 + 0.22 * Math.max(0, -(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / l);
      };
      const order = FACES.map((f, i) => ({ f, i, depth: f.slice(0, -1).reduce((s, k) => s + rotate(LOCAL[k], b.pitch, b.yaw, b.roll)[2], 0) / (f.length - 1) })).sort((p, q) => q.depth - p.depth);
      for (const { f, i } of order) {
        const idx = f.slice(0, -1), kind = f[f.length - 1], P = idx.map((k) => pts[k]);
        const area = P.reduce((s, p, j) => { const q = P[(j + 1) % P.length]; return s + (p.x * q.y - q.x * p.y); }, 0);
        if (Math.abs(area) < 0.5) continue;
        const lit = shade(i);
        g.beginPath(); P.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
        g.fillStyle = kind === 'face' ? `rgb(${Math.round(247 * lit)},${Math.round(243 * lit)},${Math.round(233 * lit)})` : `rgb(${Math.round(232 * lit)},${Math.round(225 * lit)},${Math.round(208 * lit)})`;
        g.fill();
        g.save(); g.clip();
        if (kind === 'face') { // notebook rules and the red margin, in the face's own plane
          g.strokeStyle = 'rgba(70,120,210,.5)'; g.lineWidth = Math.max(0.6, P[0].s * 0.012);
          for (let k = 1; k < 6; k++) { const t = k / 6; const a = lerp(P[0], P[2], t), c = lerp(P[1], P[2], t); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
          g.strokeStyle = 'rgba(210,60,60,.65)'; const m1 = lerp(P[0], P[1], 0.32), m2 = lerp(P[0], P[2], 0.6); g.beginPath(); g.moveTo(m1.x, m1.y); g.lineTo(m2.x, m2.y); g.stroke();
        } else { // the folded edge: layers of paper
          g.strokeStyle = 'rgba(120,105,80,.45)'; g.lineWidth = Math.max(0.6, P[0].s * 0.01);
          for (let k = 1; k < 5; k++) { const t = k / 5; const a = lerp(P[0], P[1], t), c = lerp(P[3], P[2], t); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
        }
        g.restore();
        g.strokeStyle = 'rgba(90,75,55,.55)'; g.lineWidth = Math.max(0.8, P[0].s * 0.012); g.beginPath(); P.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
      }
    }
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s });
    function shadow(b) { const p = proj(b.x, 0, b.z), r = 0.3 * p.s * Math.max(0.3, 1 - b.y / 12); g.fillStyle = 'rgba(30,14,4,.4)'; g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.22, 0, 0, Math.PI * 2); g.fill(); }
    function tee() { // a bent paperclip holding the paper up
      const a = proj(-0.16, 0.02, TEE_Z - 0.26), b = proj(0.16, 0.02, TEE_Z - 0.2), c = proj(0, TEE_Y, TEE_Z - 0.26), s = c.s;
      g.strokeStyle = '#c3c7cc'; g.lineWidth = Math.max(1.2, 0.05 * s); g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.bezierCurveTo(a.x, c.y, b.x, c.y, b.x, b.y); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = Math.max(0.6, 0.02 * s); g.beginPath(); g.moveTo(a.x + 1, a.y - 1); g.bezierCurveTo(a.x + 1, c.y, b.x - 1, c.y, b.x - 1, b.y - 1); g.stroke();
    }
    function sweetMark() { // the strike edge's centre: a faint notch to aim the touch at
      // a dashed guide beside the long edge, its clean middle in green: touch level with it
      const b = ballScreen(), z = T.contactZone * b.half, x = b.x - Math.max(16, b.s * 0.35);
      g.strokeStyle = 'rgba(255,210,122,.5)'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(x, b.y - z); g.lineTo(x, b.y + z); g.stroke(); g.setLineDash([]);
      const sw = T.sweet * z; g.strokeStyle = 'rgba(111,207,122,.85)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, b.y - sw); g.lineTo(x, b.y + sw); g.stroke();
      if (press) { const cy = b.y - press.contact * z; g.fillStyle = Math.abs(press.contact) <= T.sweet ? 'rgba(111,207,122,.95)' : 'rgba(255,107,90,.95)'; g.beginPath(); g.arc(x, cy, 6, 0, Math.PI * 2); g.fill(); }
    }
    function hudBox(x, y, top, big, right) {
      const fs = Math.max(11, H * 0.03), fb = Math.max(15, H * 0.046);
      g.font = `400 ${fs}px "Russo One", system-ui, sans-serif`; const w1 = g.measureText(top).width; g.font = `400 ${fb}px "Russo One", system-ui, sans-serif`; const w2 = g.measureText(big).width;
      const w = Math.max(w1, w2) + 20, bx = right ? x - w : x, h = fs + fb + 18;
      g.fillStyle = 'rgba(10,8,6,.78)'; g.beginPath(); g.roundRect(bx, y, w, h, 8); g.fill();
      g.fillStyle = '#b9a385'; g.textAlign = 'left'; g.font = `400 ${fs}px "Russo One", system-ui, sans-serif`; g.fillText(top, bx + 10, y + fs + 4);
      g.fillStyle = '#f6e8cf'; g.font = `400 ${fb}px "Russo One", system-ui, sans-serif`; g.fillText(big, bx + 10, y + fs + fb + 8);
    }
    function hud() {
      const w = shot.wind, mph = Math.round(Math.abs(w)), arrow = mph === 0 ? '' : w > 0 ? '  →' : '  ←';
      hudBox(12, 12, 'WIND', `${mph} MPH${arrow}`); hudBox(W - 12, 12, 'DISTANCE', `${Math.round(shot.dist)} IN.`, true);
      g.textAlign = 'center'; g.font = `400 ${Math.max(13, H * 0.036)}px "Russo One", system-ui, sans-serif`; g.fillStyle = '#ffd27a';
      g.fillText(streak ? `STREAK ${streak}` : best ? `BEST ${best}` : '', W / 2, 30);
      if (shot.move && !ball) { g.font = `800 ${Math.max(11, H * 0.03)}px Nunito, system-ui, sans-serif`; g.fillStyle = '#ff9a6a'; g.fillText('MOVING POSTS: time it', W / 2, 30 + Math.max(16, H * 0.042)); }
      if (hint && !ball && !press) { g.font = `800 ${Math.max(12, H * 0.034)}px Nunito, system-ui, sans-serif`; g.fillStyle = 'rgba(246,232,207,.92)'; g.fillText(matchMedia('(pointer: fine)').matches ? 'Press on the paper, pull back, let go' : 'Touch the paper and flick up', W / 2, H - 14); }
    }
    function banners() {
      if (pop && clock - pop.at < 0.65) {
        const t = (clock - pop.at) / 0.65, sc = 0.7 + Math.min(1, t * 4) * 0.5 - t * 0.15;
        g.save(); g.translate(W / 2, H * 0.36); g.scale(sc, sc); g.globalAlpha = 1 - Math.max(0, t - 0.7) / 0.3;
        g.font = `400 ${Math.max(28, H * 0.1)}px "Russo One", system-ui, sans-serif`; g.textAlign = 'center';
        g.lineWidth = 6; g.strokeStyle = 'rgba(30,14,4,.85)'; g.strokeText(pop.text, 0, 0); g.fillStyle = '#ffd27a'; g.fillText(pop.text, 0, 0); g.restore();
      }
      if (result && result !== 'good' && clock - resultAt < 1.2) {
        const word = { short: 'Short', under: 'Under the bar', 'wide-left': 'Wide left', 'wide-right': 'Wide right', doink: 'DOINK!' }[result];
        g.font = `400 ${Math.max(22, H * 0.065)}px "Russo One", system-ui, sans-serif`; g.textAlign = 'center';
        g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(word, W / 2, H * 0.36); g.fillStyle = '#ff6b5a'; g.fillText(word, W / 2, H * 0.36);
      }
    }
    function aimGuide() { if (!aimLine) return; g.strokeStyle = 'rgba(246,232,207,.5)'; g.setLineDash([4, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(aimLine.from.x, aimLine.from.y); g.lineTo(aimLine.to.x, aimLine.to.y); g.stroke(); g.setLineDash([]); }

    function frame(now) {
      if (!alive) return;
      const real = Math.min(0.05, (now - last) / 1000); last = now;
      const dt = real * (ball ? T.slow : 1); clock += dt;
      if (ball) { let t = dt; while (t > 0) { const s = Math.min(t, 1 / 480); step(s); t -= s; } }
      if (result && clock - resultAt > (result === 'good' ? 1.0 : 1.35)) { result = null; ball = null; n++; nextShot(); }
      g.clearRect(0, 0, W, H); backdrop();
      const D = shot.dist, Pz = TEE_Z + D + 16, Dz = TEE_Z + D;
      const bz = ball ? ball.z : TEE_Z;
      if (bz > Pz) { if (ball) { shadow(ball); paper(ball); } plank(D); posts(clock - shot.t0); }
      else { plank(D); if (bz > Dz && ball) { shadow(ball); paper(ball); posts(clock - shot.t0); } else { posts(clock - shot.t0); if (ball) { shadow(ball); paper(ball); } } }
      if (!ball) { tee(); const rest = { x: 0, y: REST_Y, z: TEE_Z, pitch: 0, yaw: YAW0, roll: 0 }; shadow({ x: 0, y: 0, z: TEE_Z }); paper(rest); sweetMark(); }
      aimGuide(); hud(); banners();
      requestAnimationFrame(frame);
    }
    size(); addEventListener('resize', size); requestAnimationFrame(frame);

    // ---------- sound: made here (WebAudio), no files
    let ac = null;
    function sfx(kind) {
      if (opts.mute?.()) return;
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      const t = ac.currentTime, out = ac.createGain(); out.connect(ac.destination);
      const tone = (f, f2, dur, type = 'sine', vol = 0.3) => { const o = ac.createOscillator(), e = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur); e.gain.setValueAtTime(vol, t); e.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(e).connect(out); o.start(t); o.stop(t + dur); };
      const noise = (dur, vol, hp = 1500) => { const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = ac.createBufferSource(), f = ac.createBiquadFilter(), e = ac.createGain(); f.type = 'highpass'; f.frequency.value = hp; e.gain.value = vol; s.buffer = b; s.connect(f).connect(e).connect(out); s.start(t); };
      if (kind === 'flick') noise(0.05, 0.5, 2500);
      if (kind === 'good') { tone(520, 1040, 0.18, 'triangle', 0.22); setTimeout(() => sfx('pop2'), 90); }
      if (kind === 'pop2') tone(780, 1560, 0.16, 'triangle', 0.18);
      if (kind === 'thunk') { tone(170, 70, 0.22, 'sine', 0.55); noise(0.06, 0.25, 600); }
      if (kind === 'doink') { tone(1180, 1100, 0.35, 'sine', 0.25); tone(1770, 1650, 0.25, 'sine', 0.12); }
      if (kind === 'miss') tone(220, 140, 0.25, 'sawtooth', 0.06);
    }

    return {
      canvas: cv,
      tuning: () => ({ ...T }),
      setTuning(p) { Object.assign(T, p); diff = T.start + streak * T.ramp; nextShot(); },
      stats: () => ({ streak, best, makes, kicks, levels: JSON.parse(JSON.stringify(levelStats)), lastKick, shot: { ...shot } }),
      /** tests and replays: a kick from code */
      kick: (k) => { if (!ball && !result) kick(k); },
      destroy() { alive = false; removeEventListener('resize', size); cv.remove(); },
    };
  }

  window.PaperFootball = { mount, DEFAULT_TUNING, shotFor, launch };
})();
