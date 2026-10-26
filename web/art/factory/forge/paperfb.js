/* Omni Cardworks: Paper Football (prototype, free play). The lunch-table game: flick a folded notebook-paper triangle
   off a paperclip tee through pencil uprights on a workshop bench, seen with your chin on the table (docs/paper-football.md,
   plan: docs/paper-football-plan.md). The goal is the finger goal made of pencils: a bar where the thumbs touched, tall
   uprights and no top, so anything between the uprights and over the bar is good. The football really hits things:
   the pencils, the bar, the oak block and Plank (who stands just behind the goal, so every make bounces off his face).
   Where you touch the strike edge sets loft and spin (centre: clean end over end; high: pops up and floats; low: flat
   and knuckling); the swipe's slant sends it sideways. Kicking harder costs accuracy.
   Levels unlock one factor at a time (distance, offset, wind, gap, then the RC car). Every condition is shown before
   the kick and comes from a seeded stream, so a kick can be replayed exactly.
   Units are inches and seconds. A kick is { power 0..1, aim (radians), contact -1..1 }.
   PaperFootball.mount(host, { art: { plank, backdrop }, onEvent }) returns { setTuning, tuning, stats, destroy, ... }. */
(() => {
  // ---------- tuning (the panel edits these; the owner sends the numbers back)
  const DEFAULT_TUNING = {
    slow: 0.55,        // flight time scale (1 = real time; lower = slower to watch)
    vMin: 45, vMax: 150, // launch speed (in/s) at power 0 and 1
    loft: 34,          // launch angle for a clean hit (degrees)
    loftHit: 14,       // extra (high hit) or less (low hit) loft at the end of the edge (degrees)
    aimMax: 22,        // widest aim (degrees either side)
    flickFull: 2.6,    // phone: flick speed (CSS px/ms) that gives full power
    pullFull: 0.38,    // desktop: pull-back length (share of the field's height) that gives full power
    sweet: 0.3,        // the clean middle of the strike edge (share of half the edge), at low power
    sweetPower: 0.5,   // how much the clean middle shrinks at full power (share)
    offPenalty: 0.3,   // speed lost at the very end of the edge (share)
    drift: 30,         // sideways drift of a mishit at full power (in/s² at the end of the edge)
    windK: 7,          // sideways push per mph (in/s²)
    ramp: 0.07,        // difficulty added per level (0..1 scale)
    start: 0.04,       // difficulty at level 0
  };
  const G = 386;                       // gravity, in/s²
  // the goal: pencils sized like the finger goal, taller (full-length pencils) so a make reads at a glance
  const BAR = 2.5, POST_H = 7.5, PEN_R = 0.14, BLOCK_H = 0.9, PLANK_BACK = 4.5, PLANK_H = 8, PLANK_W = 2.2;
  const TEE_Z = 0, TEE_Y = 0.22, BALL_R = 0.2, THICK = 0.09;
  // the football: a right isosceles triangle flag-folded from a notebook strip. Long edge 1.6 in (toward the kicker,
  // nearly upright), short edges 1.13 in, the right angle at the front point. (z, y) about its centroid.
  const TRI = (() => {
    const L = 1.6, lean = 0.1;                                  // the long edge leans a little forward at the top
    const b = [0, 0], t = [Math.sin(lean) * L, Math.cos(lean) * L]; // bottom corner, top of the long edge
    const m = [(b[0] + t[0]) / 2, (b[1] + t[1]) / 2], n = [Math.cos(lean), -Math.sin(lean)]; // normal toward the goal
    const f = [m[0] + n[0] * L / 2, m[1] + n[1] * L / 2];       // front point
    const c = [(b[0] + t[0] + f[0]) / 3, (b[1] + t[1] + f[1]) / 3];
    return [b, t, f].map((p) => [p[0] - c[0], p[1] - c[1]]);
  })();
  const EDGE_MID = [(TRI[0][0] + TRI[1][0]) / 2, (TRI[0][1] + TRI[1][1]) / 2], EDGE_HALF = 0.8;
  const REST_Y = TEE_Y - TRI[0][1], YAW0 = 0.22, YAW_FLY = 0.45; // standing on its bottom corner; a sliver of the face shows

  // ---------- a small seeded random stream (mulberry32): a shot's conditions are a function of (seed, shot number)
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // the shot at a level: factors unlock one at a time, in the order kids made the game harder
  const UNLOCK = { dist: 0, offset: 1, wind: 2, gap: 3, car: 4 };
  const LEVEL_NAMES = { 1: 'Over here: the goal moves off centre', 2: "Fan's on: wind", 3: 'Squeeze it: the gap closes', 4: 'Hands on the move: the RC car' };
  function shotFor(seed, n, level, T) {
    const r = rng(seed * 7919 + n * 104729 + 13);
    const d = T.start + level * T.ramp;
    const keys = Object.keys(UNLOCK).filter((k) => level >= UNLOCK[k]);
    const w = keys.map(() => 0.15 + r());                      // how this shot spends its difficulty
    const sum = w.reduce((a, b) => a + b, 0);
    const x = {};
    keys.forEach((k, i) => {
      const cap = k === 'dist' ? 0.25 + 0.05 * level : 0.15 * (level - UNLOCK[k] + 1);
      x[k] = Math.min(1, cap, (w[i] / sum) * d * keys.length * 1.4);
    });
    const side = () => (r() < 0.5 ? -1 : 1);
    const dist = 12 + (x.dist || 0) * 26;                      // 12..38 in
    return {
      level, dist,
      wind: side() * (x.wind || 0) * 9,                        // ±9 mph
      half: Math.max(1.2, 2.5 - (x.gap || 0) * 1.1),            // half the clear gap: 5.0 in .. 2.8 in
      offset: side() * (x.offset || 0) * Math.tan(6 * Math.PI / 180) * (dist + 4), // within a 6° turn of the head
      move: x.car ? { amp: x.car * 4, speed: 0.6 + x.car * 1.4, phase: r() * Math.PI * 2 } : null,
      drift: side(),                                           // which way a mishit drifts this shot
      unlock: Object.keys(UNLOCK).find((k) => UNLOCK[k] === level && level > 0) ? LEVEL_NAMES[level] : null,
    };
  }
  const postX = (s, t) => s.offset + (s.move ? Math.sin(s.phase0 + t * s.move.speed * Math.PI) * s.move.amp : 0);

  // ---------- the kick: launch velocity and spin from { power, aim, contact }
  function launch(k, T, s) {
    const p = Math.max(0, Math.min(1, k.power)), c = Math.max(-1, Math.min(1, k.contact));
    const sweet = T.sweet * (1 - T.sweetPower * p), clean = Math.abs(c) <= sweet;
    const off = clean ? 0 : (Math.abs(c) - sweet) / (1 - sweet); // 0 at the clean middle's edge .. 1 at the end
    const v = (T.vMin + (T.vMax - T.vMin) * p) * (1 - T.offPenalty * off * off);
    const th = (T.loft + c * T.loftHit) * Math.PI / 180;      // high on the edge pops it up, low flies flat
    const aimMax = T.aimMax * Math.PI / 180, aim = Math.max(-aimMax, Math.min(aimMax, k.aim));
    return {
      x: 0, y: REST_Y, z: TEE_Z,
      vx: v * Math.cos(th) * Math.sin(aim), vy: v * Math.sin(th), vz: v * Math.cos(th) * Math.cos(aim),
      ax: (s?.drift || 1) * off * T.drift * p * p,             // a mishit drifts, more the harder it's hit
      lift: c > 0 ? c * 60 : 0,                                // a high hit's backspin floats it a little
      pitch: 0, pitchRate: -(10 + 14 * p) * (1 - 0.4 * off) * (c < -sweet ? 0.5 : 1), // end over end; a low hit knuckles
      wob: off, roll: 0, yaw: YAW0, yawTo: (aim < 0 ? -1 : 1) * YAW_FLY, t: 0, clean,
    };
  }

  // ---------- 3D: the folded triangle as a thin prism (triangle in the y-z plane, thickness along x)
  const LOCAL = (() => {
    const v = [];
    for (const sx of [-1, 1]) for (const [z, y] of TRI) v.push([sx * THICK / 2, y, z]);
    return v; // 0-2 left face, 3-5 right face
  })();
  const FACES = [[0, 1, 2, 'face'], [5, 4, 3, 'face'], [0, 3, 4, 1, 'strike'], [0, 2, 5, 3, 'edge'], [1, 4, 5, 2, 'edge']];
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
    cv.style.touchAction = 'none';
    host.append(cv);
    const g = cv.getContext('2d');
    // the camera: chin on the table, 4 in behind the football and just over its top; level, fixed during the kick
    const CAM_DB = 4.0, CAM_H = 1.9;
    let W = 600, H = 420, dpr = 1, EYE = 0, F = 0, CX = 300;
    function size() {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(280, r.width); H = Math.max(240, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      F = Math.min(0.85 * H, (W / 2 - 16) / Math.tan(18 * Math.PI / 180));
      EYE = 0.93 * H - CAM_H * F / (CAM_DB - 0.26);           // the tee's table contact sits at 0.93H
    }
    const proj = (x, y, z) => { const s = F / Math.max(0.5, z - TEE_Z + CAM_DB); return { x: CX + x * s, y: EYE + (CAM_H - y) * s, s }; };

    // ---------- state
    const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
    let n = 0, streak = 0, best = 0, makes = 0, kicks = 0;
    let shot = null, ball = null, result = null, resultAt = 0, clock = 0, last = performance.now(), alive = true, pop = null, note = null;
    let press = null, hint = true, lastKick = null, shake = 0;
    const levelStats = {}; // level -> [makes, tries]
    function nextShot() {
      shot = shotFor(seed, n, streak, T); shot.phase0 = shot.move ? shot.move.phase : 0; shot.t0 = clock;
      if (shot.unlock && !(levelStats[streak]?.[1])) note = { text: shot.unlock, at: clock };
    }
    nextShot();
    const emit = (type, detail = {}) => opts.onEvent?.(type, { ...detail, streak, best, makes, kicks });

    // ---------- input: phone flick (touch) and desktop pull-back (mouse); both produce { power, aim, contact }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp || performance.now() }; };
    function ballScreen() {
      const [x, y, z] = rotate([0, EDGE_MID[1], EDGE_MID[0]], 0, YAW0, 0), p = proj(x, REST_Y + y, TEE_Z + z);
      p.half = EDGE_HALF * p.s; p.sweet = Math.max(22.5, T.sweet * p.half); // the clean band is never under ~7 mm
      return p;
    }
    cv.addEventListener('pointerdown', (e) => {
      if (press || ball || result || !alive || !e.isPrimary) return;
      const p = pos(e), b = ballScreen();
      if (Math.abs(p.x - b.x) > Math.max(44, b.s * 0.45) || Math.abs(p.y - b.y) > b.half * 1.15) return; // start on the paper
      const dy = b.y - p.y; // up the edge = +
      const contact = Math.abs(dy) <= b.sweet ? (dy / b.sweet) * T.sweet : Math.sign(dy) * (T.sweet + (1 - T.sweet) * Math.min(1, (Math.abs(dy) - b.sweet) / Math.max(1, b.half - b.sweet)));
      press = { id: e.pointerId, mouse: e.pointerType === 'mouse', start: p, pts: [p], contact };
      cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return; const p = pos(e); press.pts.push(p); if (press.pts.length > 48) press.pts.shift();
    });
    // the swipe's speed over its last ~90 ms, by least squares (steadier than first-to-last)
    function velocity(pts) {
      const end = pts[pts.length - 1].t, use = pts.filter((q) => end - q.t <= 90);
      if (use.length < 2) return null;
      const mt = use.reduce((a, q) => a + q.t, 0) / use.length, mx = use.reduce((a, q) => a + q.x, 0) / use.length, my = use.reduce((a, q) => a + q.y, 0) / use.length;
      let tt = 0, tx = 0, ty = 0; for (const q of use) { const d = q.t - mt; tt += d * d; tx += d * (q.x - mx); ty += d * (q.y - my); }
      if (tt < 1) return null;
      return { vx: tx / tt, vy: ty / tt };
    }
    const endPress = (e) => {
      if (!press || e.pointerId !== press.id) return; const pr = press; press = null;
      const p = pos(e); pr.pts.push(p);
      let power, aim;
      if (pr.mouse) { // pull back (down) and release: length is power, the opposite of the pull's slant is the aim
        const dx = p.x - pr.start.x, dy = p.y - pr.start.y; if (dy < 8) return;
        power = Math.min(1, (dy / H) / T.pullFull); aim = Math.atan2(-dx, dy);
      } else { // flick up: a fast snap kicks, a slow push does nothing; the slant is the aim
        const v = velocity(pr.pts); if (!v || v.vy > -0.25) return;
        power = Math.min(1, -v.vy / T.flickFull); aim = Math.atan2(v.vx, -v.vy);
      }
      kick({ power, aim, contact: pr.contact });
    };
    cv.addEventListener('pointerup', endPress);
    cv.addEventListener('pointercancel', (e) => { if (press && e.pointerId === press.id) press = null; });

    function kick(k) {
      ball = launch(k, T, shot); ball.t0 = clock; hint = false; kicks++; lastKick = { ...k, clean: ball.clean };
      ball.wobPhase = (shot.drift > 0 ? 1 : 4) + n * 0.7;
      sfx('flick'); emit('kick', { kick: k });
    }

    // ---------- flight: the football hits the pencils, the bar, the block, Plank and the table; nothing passes through
    function settle(r) {
      if (result) return;
      result = r; resultAt = clock;
      const lv = levelStats[shot.level] || (levelStats[shot.level] = [0, 0]); lv[1]++;
      if (r === 'good') {
        lv[0]++; streak++; makes++; if (streak > best) best = streak;
        pop = { text: ball.doinked ? 'DOINK… GOOD!' : [3, 5, 10, 15, 20].includes(streak) ? { 3: 'Hat trick!', 5: 'Five!', 10: 'Ten straight!', 15: 'Lunch-table legend!', 20: 'Gold pencil!' }[streak] : ['POW!', 'Nice kick!', 'Splits it!', 'Money!'][n % 4], at: clock };
        sfx('good'); emit('make');
      } else { emit('miss', { why: r }); streak = 0; sfx('miss'); }
      lastKick && (lastKick.result = r);
    }
    // bounce off a surface with outward normal (nx, ny, nz): keep the slide, lose most of the push
    function bounce(b, nx, ny, nz, e = 0.35, f = 0.7) {
      const vn = b.vx * nx + b.vy * ny + b.vz * nz; if (vn >= 0) return false;
      b.vx = (b.vx - vn * nx) * f - e * vn * nx; b.vy = (b.vy - vn * ny) * f - e * vn * ny; b.vz = (b.vz - vn * nz) * f - e * vn * nz;
      b.pitchRate *= -0.6; b.wob = Math.min(1, b.wob + 0.5); return true;
    }
    function step(dt) {
      const b = ball; if (!b) return;
      const z0 = b.z;
      b.vx += (b.ax + shot.wind * T.windK) * dt; b.vy -= (G - b.lift * Math.max(0, b.vy) / 100) * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.t += dt;
      b.pitch += b.pitchRate * dt;
      b.yaw += (b.yawTo + Math.sin(b.t * 6.5) * 0.9 * b.wob - b.yaw) * Math.min(1, dt / 0.06);
      b.roll = Math.sin(b.t * 9 + b.wobPhase) * 0.8 * b.wob;
      const D = TEE_Z + shot.dist, P = D + PLANK_BACK, px = postX(shot, clock - shot.t0);
      // the pencils: upright cylinders standing in the block
      for (const s of [-1, 1]) {
        const cx = px + s * (shot.half + PEN_R), dx = b.x - cx, dz = b.z - D, d = Math.hypot(dx, dz);
        if (d < PEN_R + BALL_R && b.y > BLOCK_H - BALL_R && b.y < POST_H + BALL_R) {
          const nx = dx / (d || 1), nz = dz / (d || 1); b.x = cx + nx * (PEN_R + BALL_R); b.z = D + nz * (PEN_R + BALL_R);
          if (bounce(b, nx, 0, nz, 0.45)) { b.doinked = true; sfx('doink'); shake = 3; emit('doink'); }
        }
      }
      // the crossbar: a pencil lying across between the uprights
      if (Math.abs(b.x - px) < shot.half + PEN_R) {
        const dy = b.y - BAR, dz = b.z - D, d = Math.hypot(dy, dz);
        if (d < PEN_R + BALL_R) {
          const ny = dy / (d || 1), nz = dz / (d || 1); b.y = BAR + ny * (PEN_R + BALL_R); b.z = D + nz * (PEN_R + BALL_R);
          if (bounce(b, 0, ny, nz, 0.4)) { b.doinked = true; sfx('doink'); shake = 3; emit('doink'); }
        }
      }
      // the oak block (or the RC car) the pencils stand in
      const bw = shot.half + PEN_R * 2 + 0.6;
      if (b.y - BALL_R < BLOCK_H && Math.abs(b.x - px) < bw && b.z + BALL_R > D - 0.45 && z0 + BALL_R <= D - 0.45) { b.z = D - 0.45 - BALL_R; bounce(b, 0, 0, -1, 0.3); sfx('tick'); }
      // judged where the football's centre crosses the goal's plane: between the uprights and over the bar is good
      if (!result && z0 < D && b.z >= D) {
        const inside = Math.abs(b.x - px) < shot.half;
        settle(inside && b.y >= BAR ? 'good' : inside ? 'under' : b.x < px ? 'wide-left' : 'wide-right');
      }
      // Plank, just behind the goal: a make bounces off his face
      const pc = shot.offset;
      if (!b.thunked && z0 < P && b.z >= P && Math.abs(b.x - pc) < PLANK_W && b.y < PLANK_H) {
        b.thunked = true; b.z = P; bounce(b, 0, 0, -1, 0.32, 0.5); b.vy = Math.max(b.vy, 30); sfx('thunk'); shake = 6; emit('plank');
      }
      // the table
      if (b.y <= 0.05 && b.vy < 0) {
        if (!result && b.z < D) settle(b.doinked ? 'doink' : 'short');
        b.y = 0.05; b.vy *= -0.25; b.vz *= 0.55; b.vx *= 0.55; b.pitchRate *= 0.5; b.wob *= 0.5; if (Math.abs(b.vy) < 8) b.vy = 0;
        if (!b.landed) { b.landed = true; sfx('tick'); }
      }
      if (!result && b.vz < 0 && b.z < D - 1) settle(b.doinked ? 'doink' : 'short'); // knocked back off the goal
    }

    // ---------- drawing
    let bench = null, benchKey = '';
    function backdrop() { // the far wall and the bench, drawn once per size and cached
      const key = `${W}x${H}x${dpr}x${A.backdrop?.complete ? 1 : 0}`;
      if (bench && benchKey === key) { g.drawImage(bench, 0, 0, W, H); return; }
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const h = c.getContext('2d'); h.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx0 = CX; CX = W / 2;
      const edge = proj(0, 0, 160).y;
      const sky = h.createLinearGradient(0, 0, 0, edge); sky.addColorStop(0, '#120c08'); sky.addColorStop(1, '#2a1b10');
      h.fillStyle = sky; h.fillRect(0, 0, W, edge + 1);
      const p = A.backdrop;
      if (p?.complete && p.naturalWidth) {
        h.save(); h.filter = 'blur(6px) brightness(.5) saturate(.85)'; const s = Math.max(W / p.naturalWidth, (edge + 30) / p.naturalHeight) * 1.1;
        h.drawImage(p, (W - p.naturalWidth * s) / 2, edge + 16 - p.naturalHeight * s, p.naturalWidth * s, p.naturalHeight * s); h.restore();
      }
      const wood = h.createLinearGradient(0, edge, 0, H); wood.addColorStop(0, '#4a2c14'); wood.addColorStop(0.35, '#8a5426'); wood.addColorStop(1, '#c68340');
      h.fillStyle = wood; h.fillRect(0, edge, W, H - edge);
      h.strokeStyle = 'rgba(55,28,8,.25)'; h.lineWidth = 1;
      for (let x = -40; x <= 40; x += 5.5) { const a = proj(x, 0, -3.5), b = proj(x, 0, 160); h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.stroke(); }
      h.strokeStyle = 'rgba(40,20,6,.12)';
      for (let x = -40; x <= 40; x += 0.9) { const a = proj(x + Math.sin(x * 3) * 0.3, 0, -3.5), b = proj(x, 0, 60); h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.stroke(); }
      const lamp = h.createRadialGradient(W * 0.42, H * 0.62, 10, W * 0.42, H * 0.62, W * 0.75); lamp.addColorStop(0, 'rgba(255,196,120,.2)'); lamp.addColorStop(1, 'rgba(255,196,120,0)');
      h.fillStyle = lamp; h.fillRect(0, edge, W, H - edge);
      const vig = h.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, W * 0.85); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.45)');
      h.fillStyle = vig; h.fillRect(0, 0, W, H);
      CX = cx0; bench = c; benchKey = key; g.drawImage(bench, 0, 0, W, H);
    }
    function tape(D) { // the yellow tape measure out to the goal, inch ticks
      const a = proj(-1.6, 0.01, TEE_Z + 0.6), b = proj(-1.6, 0.01, D - 0.6), a2 = proj(-1.1, 0.01, TEE_Z + 0.6), b2 = proj(-1.1, 0.01, D - 0.6);
      g.fillStyle = 'rgba(232,190,60,.85)'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b2.x, b2.y); g.lineTo(a2.x, a2.y); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,24,6,.7)'; g.lineWidth = 1;
      for (let z = 1; z < D - TEE_Z - 0.6; z++) { const p = proj(-1.6, 0.01, TEE_Z + z), q = proj(z % 6 ? -1.45 : -1.25, 0.01, TEE_Z + z); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
    }
    function plank(px) {
      const k = A.plank, P = TEE_Z + shot.dist + PLANK_BACK, base = proj(shot.offset, 0, P);
      const hh = PLANK_H * base.s;
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(base.x, base.y, 2.4 * base.s, 0.45 * base.s, 0, 0, Math.PI * 2); g.fill();
      const hit = ball?.thunked ? Math.max(0, 1 - (clock - ball.thunkAt) / 0.3) : 0;
      if (k?.complete && k.naturalWidth) { const ww = hh * k.naturalWidth / k.naturalHeight; g.drawImage(k, base.x - ww / 2, base.y - hh, ww, hh); }
      else { g.fillStyle = '#e8c860'; g.fillRect(base.x - 1.6 * base.s, base.y - hh, 3.2 * base.s, hh); }
      void px; void hit;
    }
    // a hexagonal pencil (two faces show) from y0 to y1, standing at (x, z): eraser up
    function pencil(x, z, y0, y1) {
      const b = proj(x, y0, z), t = proj(x, y1, z), w = Math.max(2, PEN_R * 2 * b.s);
      const top = t.y + w * 1.25, er = w * 0.75;
      g.fillStyle = '#f2b81d'; g.fillRect(b.x - w / 2, top, w, b.y - top);
      g.fillStyle = '#ffd863'; g.fillRect(b.x - w / 2, top, w * 0.3, b.y - top);
      g.fillStyle = 'rgba(120,70,0,.28)'; g.fillRect(b.x + w * 0.18, top, w * 0.32, b.y - top);
      g.fillStyle = '#bfc3c8'; g.fillRect(b.x - w / 2, t.y + er, w, w * 0.5);
      g.fillStyle = 'rgba(80,84,90,.5)'; for (let i = 1; i < 3; i++) g.fillRect(b.x - w / 2, t.y + er + i * w * 0.16, w, Math.max(0.6, w * 0.04));
      g.fillStyle = '#ef8fa6'; g.beginPath(); g.roundRect(b.x - w / 2, t.y, w, er, [w * 0.3, w * 0.3, 0, 0]); g.fill();
    }
    function posts(t) {
      const z = TEE_Z + shot.dist, px = postX(shot, t), hf = shot.half, lx = px - hf - PEN_R, rx = px + hf + PEN_R, bw = hf + PEN_R * 2 + 0.6;
      // the oak block (or, on the move, the little red RC car) the pencils stand in
      const L = proj(px - bw, BLOCK_H, z - 0.45), R = proj(px + bw, 0, z - 0.45), s = L.s;
      g.fillStyle = 'rgba(0,0,0,.32)'; g.beginPath(); g.ellipse((L.x + R.x) / 2, R.y + 1, (R.x - L.x) / 2 + 4, 0.35 * s, 0, 0, Math.PI * 2); g.fill();
      if (shot.move) for (const wx of [px - bw + 0.5, px + bw - 0.5]) { const w = proj(wx, 0.3, z - 0.45); g.fillStyle = '#1d1a17'; g.beginPath(); g.arc(w.x, w.y, 0.3 * s, 0, Math.PI * 2); g.fill(); g.fillStyle = '#6b6f75'; g.beginPath(); g.arc(w.x, w.y, 0.12 * s, 0, Math.PI * 2); g.fill(); }
      const top = L.y, bot = shot.move ? proj(0, 0.4, z - 0.45).y : R.y;
      g.fillStyle = shot.move ? '#b23a2a' : '#9a6a3a'; g.beginPath(); g.roundRect(L.x, top, R.x - L.x, bot - top, 0.12 * s); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(L.x, top, R.x - L.x, (bot - top) * 0.25);
      if (!shot.move) { g.strokeStyle = 'rgba(70,40,15,.35)'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { const y = top + (bot - top) * i / 4; g.beginPath(); g.moveTo(L.x + 2, y); g.lineTo(R.x - 2, y + 1); g.stroke(); } }
      if (shot.move) { const a = proj(px + bw - 0.3, BLOCK_H, z - 0.45), b = proj(px + bw - 0.1, 3.6, z - 0.45); g.strokeStyle = '#c9ccd1'; g.lineWidth = Math.max(1, 0.06 * s); g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(b.x + 4, (a.y + b.y) / 2, b.x, b.y); g.stroke(); g.fillStyle = '#d33'; g.beginPath(); g.arc(b.x, b.y, Math.max(1.5, 0.1 * s), 0, Math.PI * 2); g.fill(); }
      pencil(lx, z, BLOCK_H, POST_H); pencil(rx, z, BLOCK_H, POST_H);
      // the crossbar: a pencil lashed level where the thumbs touched, with red rubber bands
      const a = proj(lx - PEN_R, BAR, z), b = proj(rx + PEN_R, BAR, z), w = Math.max(2, PEN_R * 2 * a.s);
      g.fillStyle = '#f2b81d'; g.fillRect(a.x, a.y - w / 2, b.x - a.x, w);
      g.fillStyle = '#ffd863'; g.fillRect(a.x, a.y - w / 2, b.x - a.x, w * 0.3);
      g.fillStyle = 'rgba(120,70,0,.28)'; g.fillRect(a.x, a.y + w * 0.18, b.x - a.x, w * 0.3);
      for (const xx of [proj(lx, BAR, z).x, proj(rx, BAR, z).x]) { g.fillStyle = '#c8322a'; g.fillRect(xx - w * 0.75, a.y - w * 0.7, w * 0.5, w * 1.4); g.fillRect(xx + w * 0.25, a.y - w * 0.7, w * 0.5, w * 1.4); }
      // the wind streamer: a strip of notebook paper taped to the left pencil's top
      if (Math.abs(shot.wind) >= 0.5) {
        const tp = proj(lx, POST_H - 0.5, z), len = (0.6 + Math.abs(shot.wind) * 0.12) * tp.s, dir = Math.sign(shot.wind), wv = Math.sin(clock * 9) * 0.12 * tp.s;
        g.fillStyle = 'rgba(246,240,226,.95)'; g.beginPath(); g.moveTo(tp.x, tp.y - 0.12 * tp.s); g.quadraticCurveTo(tp.x + dir * len * 0.5, tp.y + wv, tp.x + dir * len, tp.y + wv * 2); g.lineTo(tp.x + dir * len, tp.y + wv * 2 + 0.2 * tp.s); g.quadraticCurveTo(tp.x + dir * len * 0.5, tp.y + 0.2 * tp.s + wv, tp.x, tp.y + 0.12 * tp.s); g.fill();
        g.strokeStyle = 'rgba(70,120,210,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tp.x, tp.y); g.quadraticCurveTo(tp.x + dir * len * 0.5, tp.y + 0.05 * tp.s + wv, tp.x + dir * len, tp.y + wv * 2 + 0.1 * tp.s); g.stroke();
      }
    }
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s });
    function paper(b) {
      const R = LOCAL.map((v) => rotate(v, b.pitch, b.yaw, b.roll));
      if (b.z + Math.min(...R.map((v) => v[2])) - TEE_Z + CAM_DB < 0.6) return; // past the eye: off screen
      const pts = R.map(([x, y, z]) => proj(b.x + x, b.y + y, b.z + z));
      const light = [-0.4, 0.7, -0.6];
      const order = FACES.map((f, i) => ({ f, i, depth: f.slice(0, -1).reduce((s, k) => s + R[k][2], 0) / (f.length - 1) })).sort((p, q) => q.depth - p.depth);
      for (const { f, i } of order) {
        const idx = f.slice(0, -1), kind = f[f.length - 1], P = idx.map((k) => pts[k]);
        const area = P.reduce((s, p, j) => { const q = P[(j + 1) % P.length]; return s + (p.x * q.y - q.x * p.y); }, 0);
        if (Math.abs(area) < 0.3) continue;
        const v = idx.map((k) => R[k]);
        const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...nn) || 1;
        const lit = 0.74 + 0.26 * Math.abs(nn[0] * light[0] + nn[1] * light[1] + nn[2] * light[2]) / l;
        g.beginPath(); P.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
        g.fillStyle = kind === 'face' ? `rgb(${Math.round(248 * lit)},${Math.round(244 * lit)},${Math.round(232 * lit)})` : `rgb(${Math.round(236 * lit)},${Math.round(229 * lit)},${Math.round(212 * lit)})`;
        g.fill();
        g.save(); g.clip();
        if (kind === 'face') { // wide-ruled blue lines across the strip (parallel to a short edge); a red margin on one face
          g.strokeStyle = 'rgba(70,120,210,.55)'; g.lineWidth = Math.max(0.6, P[0].s * 0.012);
          for (let k = 1; k < 7; k++) { const t = k / 7; const a = lerp(P[0], P[1], t), c = lerp(P[0], P[2], t); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
          if (i === 0) { g.strokeStyle = 'rgba(210,60,60,.7)'; const m1 = lerp(P[1], P[2], 0.25), m2 = lerp(P[0], P[1], 0.75); g.beginPath(); g.moveTo(m1.x, m1.y); g.lineTo(m2.x, m2.y); g.stroke(); }
          if (i === 1) { // a ballpoint Plank doodle: ring eyes and a smile
            const c = { x: (P[0].x + P[1].x + P[2].x) / 3, y: (P[0].y + P[1].y + P[2].y) / 3 }, r = Math.max(1, Math.abs(area) ** 0.5 * 0.05);
            g.strokeStyle = 'rgba(30,50,140,.6)'; g.lineWidth = Math.max(0.6, r * 0.35);
            g.beginPath(); g.arc(c.x - r * 1.6, c.y - r, r, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(c.x + r * 1.6, c.y - r, r, 0, Math.PI * 2); g.stroke();
            g.beginPath(); g.arc(c.x, c.y + r * 0.6, r * 1.8, 0.2, Math.PI - 0.2); g.stroke();
          }
        } else if (kind === 'strike') { // the strike edge: stacked, rounded crease loops (folds, not cut sheets)
          const L = 7;
          for (let k = 0; k < L; k++) {
            const t0 = k / L, t1 = (k + 1) / L, a0 = lerp(P[0], P[1], t0), a1 = lerp(P[3], P[2], t0), c0 = lerp(P[0], P[1], t1), c1 = lerp(P[3], P[2], t1);
            const gr = g.createLinearGradient(a0.x, a0.y, c0.x, c0.y);
            gr.addColorStop(0, 'rgba(120,100,70,.35)'); gr.addColorStop(0.35, 'rgba(255,252,240,.25)'); gr.addColorStop(1, 'rgba(110,90,60,.3)');
            g.fillStyle = gr; g.beginPath(); g.moveTo(a0.x, a0.y); g.lineTo(a1.x, a1.y); g.lineTo(c1.x, c1.y); g.lineTo(c0.x, c0.y); g.closePath(); g.fill();
          }
          g.strokeStyle = 'rgba(110,95,70,.4)'; g.lineWidth = Math.max(0.5, P[0].s * 0.006);
          for (const t of [0.33, 0.66]) { const a = lerp(P[0], P[3], t), c = lerp(P[1], P[2], t); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
        } else { // the other two edges: a few raw layer lines
          g.strokeStyle = 'rgba(120,105,80,.4)'; g.lineWidth = Math.max(0.5, P[0].s * 0.006);
          for (let k = 1; k < 4; k++) { const t = k / 4; const a = lerp(P[0], P[3], t), c = lerp(P[1], P[2], t); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
        }
        g.restore();
        g.strokeStyle = 'rgba(90,75,55,.5)'; g.lineWidth = Math.max(0.7, P[0].s * 0.008); g.beginPath(); P.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
      }
    }
    function shadow(b) { const p = proj(b.x, 0, b.z), r = 0.55 * p.s * Math.max(0.3, 1 - b.y / 12); g.fillStyle = `rgba(30,14,4,${0.42 * Math.max(0.25, 1 - b.y / 10)})`; g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.25, 0, 0, Math.PI * 2); g.fill(); }
    function tee() { // a bent paperclip holding the paper up
      const a = proj(-0.2, 0.01, TEE_Z - 0.22), b = proj(0.2, 0.01, TEE_Z - 0.14), c = proj(0, TEE_Y + 0.05, TEE_Z - 0.22), s = c.s;
      g.strokeStyle = '#c3c7cc'; g.lineWidth = Math.max(1.2, 0.033 * s); g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.bezierCurveTo(a.x, c.y, b.x, c.y, b.x, b.y); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(0.6, 0.012 * s); g.beginPath(); g.moveTo(a.x + 1, a.y - 1); g.bezierCurveTo(a.x + 1, c.y, b.x - 1, c.y, b.x - 1, b.y - 1); g.stroke();
    }
    function sweetMark() { // a dashed guide beside the strike edge, its clean middle in green: touch level with it
      const b = ballScreen(), x = b.x - Math.max(24, b.s * 0.3);
      g.strokeStyle = 'rgba(255,210,122,.55)'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(x, b.y - b.half); g.lineTo(x, b.y + b.half); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(111,207,122,.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, b.y - b.sweet); g.lineTo(x, b.y + b.sweet); g.stroke();
      if (press) { const cy = b.y - (Math.abs(press.contact) <= T.sweet ? press.contact / T.sweet * b.sweet : Math.sign(press.contact) * (b.sweet + (Math.abs(press.contact) - T.sweet) / (1 - T.sweet) * (b.half - b.sweet))); g.fillStyle = Math.abs(press.contact) <= T.sweet ? 'rgba(111,207,122,.95)' : 'rgba(255,107,90,.95)'; g.beginPath(); g.arc(x, cy, 6, 0, Math.PI * 2); g.fill(); }
    }
    function hudBox(x, y, top, big, right) {
      const fs = Math.max(11, H * 0.026), fb = Math.max(15, H * 0.04);
      g.font = `400 ${fs}px "Russo One", system-ui, sans-serif`; const w1 = g.measureText(top).width; g.font = `400 ${fb}px "Russo One", system-ui, sans-serif`; const w2 = g.measureText(big).width;
      const w = Math.max(w1, w2) + 20, bx = right ? x - w : x, h = fs + fb + 18;
      g.fillStyle = 'rgba(10,8,6,.78)'; g.beginPath(); g.roundRect(bx, y, w, h, 8); g.fill();
      g.fillStyle = '#b9a385'; g.textAlign = 'left'; g.font = `400 ${fs}px "Russo One", system-ui, sans-serif`; g.fillText(top, bx + 10, y + fs + 4);
      g.fillStyle = '#f6e8cf'; g.font = `400 ${fb}px "Russo One", system-ui, sans-serif`; g.fillText(big, bx + 10, y + fs + fb + 8);
    }
    function tally(x, y) { // the streak in pencil tally marks
      g.strokeStyle = 'rgba(246,232,207,.9)'; g.lineWidth = 2; g.lineCap = 'round';
      for (let i = 0; i < Math.min(streak, 25); i++) {
        const grp = Math.floor(i / 5), k = i % 5, gx = x + grp * 30;
        g.beginPath();
        if (k < 4) { g.moveTo(gx + k * 6, y); g.lineTo(gx + k * 6 + 1, y + 16); } else { g.moveTo(gx - 3, y + 13); g.lineTo(gx + 22, y + 3); }
        g.stroke();
      }
    }
    function hud() {
      const w = shot.wind, mph = Math.round(Math.abs(w)), arrow = mph === 0 ? '' : w > 0 ? '  →' : '  ←';
      hudBox(12, 12, 'WIND', `${mph} MPH${arrow}`); hudBox(W - 12, 12, 'DISTANCE', `${Math.round(shot.dist)} IN.`, true);
      g.textAlign = 'center'; g.font = `400 ${Math.max(13, H * 0.032)}px "Russo One", system-ui, sans-serif`; g.fillStyle = '#ffd27a';
      g.fillText(streak ? `STREAK ${streak}` : best ? `BEST ${best}` : 'LEVEL 0', W / 2, 30);
      if (streak) tally(W / 2 - Math.min(5, Math.ceil(streak / 5)) * 15, 38);
      if (shot.move && !ball) { g.font = `800 ${Math.max(11, H * 0.026)}px Nunito, system-ui, sans-serif`; g.fillStyle = '#ff9a6a'; g.fillText('MOVING POSTS: time it', W / 2, 74); }
      if (note && clock - note.at < 3.5 && !ball) { g.font = `700 ${Math.max(13, H * 0.03)}px Kalam, "Comic Sans MS", cursive`; const tw = g.measureText(note.text).width + 24; g.fillStyle = 'rgba(248,244,232,.95)'; g.save(); g.translate(W / 2, H * 0.17); g.rotate(-0.03); g.fillRect(-tw / 2, -18, tw, 30); g.fillStyle = '#23324f'; g.fillText(note.text, 0, 2); g.restore(); }
      if (hint && !ball && !press) { g.font = `800 ${Math.max(12, H * 0.03)}px Nunito, system-ui, sans-serif`; g.fillStyle = 'rgba(246,232,207,.92)'; g.fillText(matchMedia('(pointer: fine)').matches ? 'Press on the paper, pull back, let go' : 'Touch the paper and flick up', W / 2, H - 14); }
    }
    function banners() {
      if (pop && clock - pop.at < 0.9) {
        const t = (clock - pop.at) / 0.9, sc = 0.7 + Math.min(1, t * 4) * 0.5 - t * 0.15;
        g.save(); g.translate(W / 2, H * 0.3); g.scale(sc, sc); g.globalAlpha = 1 - Math.max(0, t - 0.7) / 0.3;
        g.font = `400 ${Math.max(26, H * 0.075)}px "Russo One", system-ui, sans-serif`; g.textAlign = 'center';
        g.lineWidth = 6; g.strokeStyle = 'rgba(30,14,4,.85)'; g.strokeText(pop.text, 0, 0); g.fillStyle = '#ffd27a'; g.fillText(pop.text, 0, 0); g.restore();
      }
      if (result && result !== 'good' && clock - resultAt < 1.2) {
        const word = { short: 'Short', under: 'Under the bar', 'wide-left': 'Wide left', 'wide-right': 'Wide right', doink: 'Doink!' }[result];
        g.font = `700 ${Math.max(24, H * 0.065)}px Kalam, "Comic Sans MS", cursive`; g.textAlign = 'center';
        g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(word, W / 2, H * 0.3); g.fillStyle = '#ff6b5a'; g.fillText(word, W / 2, H * 0.3);
      }
    }

    function frame(now) {
      if (!alive) return;
      const real = Math.min(0.05, (now - last) / 1000); last = now;
      const dt = real * (ball ? T.slow : 1); clock += dt;
      if (ball) { let t = dt; while (t > 0) { const s = Math.min(t, 1 / 480); step(s); t -= s; } if (ball.thunked && !ball.thunkAt) ball.thunkAt = clock; }
      if (result && clock - resultAt > (result === 'good' ? 1.4 : 1.5)) { result = null; ball = null; n++; nextShot(); }
      // the view leans a little toward an off-centre goal, between shots only (fixed during the kick)
      if (!ball) { const want = W / 2 - Math.max(-0.15 * W, Math.min(0.15 * W, 0.5 * (proj(shot.offset, 0, TEE_Z + shot.dist).x - CX))); CX += (want - CX) * Math.min(1, real * 6); }
      const sh = shake > 0 ? (shake -= real * 30, Math.max(0, shake)) : 0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); backdrop();
      g.save(); if (sh) g.translate((Math.sin(clock * 90) * sh), (Math.cos(clock * 70) * sh));
      const D = TEE_Z + shot.dist, Pz = D + PLANK_BACK, t = clock - shot.t0;
      tape(D);
      // far to near: Plank, the goal, the football (wherever it is between them)
      const bz = ball ? ball.z : TEE_Z, drawBall = () => { if (ball) { shadow(ball); paper(ball); } };
      if (bz > Pz) { drawBall(); plank(); posts(t); }
      else if (bz > D) { plank(); drawBall(); posts(t); }
      else { plank(); posts(t); drawBall(); }
      if (!ball) { tee(); const rest = { x: 0, y: REST_Y, z: TEE_Z, pitch: 0, yaw: YAW0, roll: 0 }; shadow({ x: 0, y: 0, z: TEE_Z }); paper(rest); sweetMark(); }
      g.restore();
      hud(); banners();
      requestAnimationFrame(frame);
    }
    size(); CX = W / 2; addEventListener('resize', size); requestAnimationFrame(frame);

    // ---------- sound: made here (WebAudio), no files
    let ac = null;
    function sfx(kind) {
      if (opts.mute?.()) return;
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      const t = ac.currentTime, out = ac.createGain(); out.connect(ac.destination);
      const tone = (f, f2, dur, type = 'sine', vol = 0.3) => { const o = ac.createOscillator(), e = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur); e.gain.setValueAtTime(vol, t); e.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(e).connect(out); o.start(t); o.stop(t + dur); };
      const noise = (dur, vol, hp = 1500) => { const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = ac.createBufferSource(), f = ac.createBiquadFilter(), e = ac.createGain(); f.type = 'highpass'; f.frequency.value = hp; e.gain.value = vol; s.buffer = b; s.connect(f).connect(e).connect(out); s.start(t); };
      if (kind === 'flick') noise(0.04, 0.55, 3000);                        // the fingernail "tk"
      if (kind === 'tick') noise(0.03, 0.25, 1200);
      if (kind === 'good') { tone(520, 1040, 0.18, 'triangle', 0.22); setTimeout(() => sfx('pop2'), 90); }
      if (kind === 'pop2') tone(780, 1560, 0.16, 'triangle', 0.18);
      if (kind === 'thunk') { tone(170, 70, 0.22, 'sine', 0.55); noise(0.06, 0.25, 600); } // off Plank's face
      if (kind === 'doink') { tone(900, 700, 0.12, 'triangle', 0.3); noise(0.03, 0.3, 2000); } // woody "tok" on a pencil
      if (kind === 'miss') tone(220, 140, 0.25, 'sawtooth', 0.06);
    }

    return {
      canvas: cv,
      tuning: () => ({ ...T }),
      setTuning(p) { Object.assign(T, p); nextShot(); },
      stats: () => ({ streak, best, makes, kicks, levels: JSON.parse(JSON.stringify(levelStats)), lastKick, shot: { ...shot } }),
      /** tests and replays: a kick from code */
      kick: (k) => { if (!ball && !result) kick(k); },
      destroy() { alive = false; removeEventListener('resize', size); cv.remove(); },
    };
  }

  window.PaperFootball = { mount, DEFAULT_TUNING, shotFor, launch };
})();
