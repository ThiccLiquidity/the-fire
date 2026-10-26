/* Omni Cardworks: Paper Football (prototype, free play). The lunch-table game: flick a folded notebook-paper triangle
   off a paperclip tee through pencil uprights on a workshop bench, seen with your chin on the table (docs/paper-football.md,
   plan: docs/paper-football-plan.md). The goal is the finger goal made of pencils: a bar where the thumbs touched, tall
   uprights and no top, so anything between the uprights and over the bar is good. The football really hits things:
   the pencils, the bar, the oak block and Plank (who stands just behind the goal, so every make bounces off his face).
   Where you touch the strike edge sets loft and spin (a little below the middle: clean, end over end, with lift;
   lower: pops up and floats; dead centre and higher: flat, and knuckling); the swipe's slant sends it sideways. Kicking harder costs accuracy.
   Levels unlock one factor at a time (distance, offset, wind, gap, then the RC car). Every condition is shown before
   the kick and comes from a seeded stream, so a kick can be replayed exactly.
   Units are inches and seconds. A kick is { power 0..1, aim (radians), contact -1..1 }.
   PaperFootball.mount(host, { art: { plank, backdrop }, onEvent }) returns { setTuning, tuning, stats, destroy, ... }. */
(() => {
  // ---------- tuning (the panel edits these; the owner sends the numbers back)
  const DEFAULT_TUNING = {
    slow: 0.45,        // flight time scale (1 = real time; lower = slower to watch)
    vMin: 45, vMax: 150, // launch speed (in/s) at power 0 and 1
    loft: 34,          // launch angle for a clean hit (degrees)
    loftHit: 24,       // loft gained per half-edge lower you hit (degrees): low pops it up, high flies flat
    sweetAt: -0.25,    // the clean spot: a little below the middle of the strike edge (share of half the edge)
    aimMax: 22,        // widest aim (degrees either side)
    flickFull: 2.6,    // phone: flick speed (CSS px/ms) that gives full power
    pullFull: 0.38,    // desktop: pull-back length (share of the field's height) that gives full power
    sweet: 0.22,       // the clean band around that spot (share of half the edge), at low power
    sweetPower: 0.5,   // how much the clean middle shrinks at full power (share)
    offPenalty: 0.3,   // speed lost at the very end of the edge (share)
    drift: 30,         // sideways drift of a mishit at full power (in/s² at the end of the edge)
    windK: 7,          // sideways push per mph (in/s²)
    ramp: 0.2,         // difficulty budget added per level (spread across the unlocked factors)
    start: 0.1,        // difficulty budget at level 0
  };
  const G = 386;                       // gravity, in/s²
  // the goal: pencils sized like the finger goal, taller (full-length pencils) so a make reads at a glance
  const BAR = 2.5, POST_H = 7.5, PEN_R = 0.14, BLOCK_H = 0.9, PLANK_BACK = 4.5, PLANK_H = 6.8, PLANK_W = 2.2;
  const TEE_Z = 0, TEE_Y = 0.22, BALL_R = 0.2;
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
    // the level's budget grows smoothly (a touch faster later on) and is shared by the unlocked factors, so a new factor
    // takes a share of the budget instead of adding to it: no sudden jump when the caps open up
    const budget = T.start + level * T.ramp + 0.004 * level * level;
    const keys = Object.keys(UNLOCK).filter((k) => level >= UNLOCK[k]);
    const w = keys.map(() => 0.15 + r());                      // how this shot spends its difficulty
    const sum = w.reduce((a, b) => a + b, 0);
    const x = {};
    keys.forEach((k, i) => {
      const cap = k === 'dist' ? 0.25 + 0.05 * level : 0.15 * (level - UNLOCK[k] + 1);
      x[k] = Math.min(1, cap, (w[i] / sum) * budget);
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
    // the clean band sits a little below the middle (it gets the football up); it shrinks the harder you kick, but
    // never below the band the player could see (k.sweetMin, ~7 mm on screen)
    const sweet = Math.max(k.sweetMin || 0, T.sweet * (1 - T.sweetPower * p)), miss = Math.abs(c - T.sweetAt), clean = miss <= sweet;
    const off = clean ? 0 : Math.min(1, (miss - sweet) / (1 - sweet)); // 0 at the clean band's edge .. 1 at the end
    const v = (T.vMin + (T.vMax - T.vMin) * p) * (1 - T.offPenalty * off * off);
    const th = (T.loft - (c - T.sweetAt) * T.loftHit) * Math.PI / 180; // below the middle pops it up; dead centre and higher fly flat
    const aimMax = T.aimMax * Math.PI / 180, aim = Math.max(-aimMax, Math.min(aimMax, k.aim));
    return {
      x: 0, y: REST_Y, z: TEE_Z,
      vx: v * Math.cos(th) * Math.sin(aim), vy: v * Math.sin(th), vz: v * Math.cos(th) * Math.cos(aim),
      ax: (s?.drift || 1) * off * T.drift * p * p,             // a mishit drifts, more the harder it's hit
      lift: c < T.sweetAt ? (T.sweetAt - c) * 60 : 0,         // a low hit's backspin floats it a little
      pitch: 0, pitchRate: -(10 + 14 * p) * (1 - 0.4 * off) * (c > T.sweetAt + sweet ? 0.5 : 1), // end over end; a high hit knuckles
      wob: off, roll: 0, yaw: YAW0, yawTo: (aim < 0 ? -1 : 1) * YAW_FLY, t: 0, clean,
    };
  }

  // ---------- 3D: the folded triangle. Its outline is sampled along each edge; the folds make it fattest in the middle
  // of an edge and thin to a point at each corner (the strike edge, folded the most, is fattest). Each outline point
  // has a left and a right vertex (x = -t/2 and +t/2); faces are the two outlines, the edges are strips between them.
  const OUT = (() => {
    const o = [], seg = [[0, 1, 12, 0.085], [1, 2, 8, 0.055], [2, 0, 8, 0.055]]; // from, to, samples, thickness mid-edge (in)
    for (const [i, j, N, tm] of seg) for (let k = 0; k < N; k++) {
      const u = k / N, z = TRI[i][0] + (TRI[j][0] - TRI[i][0]) * u, y = TRI[i][1] + (TRI[j][1] - TRI[i][1]) * u;
      o.push({ y, z, t: 0.008 + tm * Math.sin(Math.PI * u) ** 0.6, strike: i === 0 });
    }
    return o;
  })();
  const NO = OUT.length, CORNER = [0, 12, 20]; // outline indices of the bottom corner, the top of the long edge, the front point
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
    const A = { plank: img(art.plank), backdrop: img(art.backdrop), pack: img(art.pack), card: img(art.card), cardBack: img(art.cardBack), coinP: img(art.paperCoin), coinK: img(art.plankCoin) };
    const loaded = () => Object.values(A).map((i) => (i?.complete && i.naturalWidth ? 1 : 0)).join('');
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
      p.half = EDGE_HALF * p.s; p.sweet = Math.max(22.5, T.sweet * p.half); p.sweetY = p.y - T.sweetAt * p.half; // the clean band is never under ~7 mm
      return p;
    }
    cv.addEventListener('pointerdown', (e) => {
      if (press || ball || result || !alive || !e.isPrimary) return;
      const p = pos(e), b = ballScreen();
      if (Math.abs(p.x - b.x) > Math.max(44, b.s * 0.45) || Math.abs(p.y - b.y) > b.half * 1.15) return; // start on the paper
      const dy = b.y - p.y; // up the edge = +
      press = { id: e.pointerId, mouse: e.pointerType === 'mouse', start: p, pts: [p], contact: Math.max(-1, Math.min(1, dy / b.half)), sweetMin: 22.5 / b.half };
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
      kick({ power, aim, contact: pr.contact, sweetMin: pr.sweetMin });
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
      if (b.burning || b.gone) { b.t += dt; return; }
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
          if (bounce(b, nx, 0, nz, 0.45)) { b.doinked = true; sfx('doink'); shake = 3; burst('chips', b.x, b.y, b.z); emit('doink'); }
        }
      }
      // the crossbar: a pencil lying across between the uprights
      if (Math.abs(b.x - px) < shot.half + PEN_R) {
        const dy = b.y - BAR, dz = b.z - D, d = Math.hypot(dy, dz);
        if (d < PEN_R + BALL_R) {
          const ny = dy / (d || 1), nz = dz / (d || 1); b.y = BAR + ny * (PEN_R + BALL_R); b.z = D + nz * (PEN_R + BALL_R);
          if (bounce(b, 0, ny, nz, 0.4)) { b.doinked = true; sfx('doink'); shake = 3; burst('chips', b.x, b.y, b.z); emit('doink'); }
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
      // the furnace: through the open door it burns; the iron front stops it
      if (z0 < FURN_Z && b.z >= FURN_Z) {
        if (Math.abs(b.x) < MOUTH.x && b.y > MOUTH.y0 && b.y < MOUTH.y1) { b.burning = clock; b.z = FURN_Z + 1.2; burnFlash = 1; sfx('whoosh'); emit('furnace'); pop = { text: 'INTO THE FIRE!', at: clock }; return; }
        if (Math.abs(b.x) < FURN_W / 2 && b.y > -6) { b.z = FURN_Z; bounce(b, 0, 0, -1, 0.3); sfx('tick'); }
      }
      if (b.y < -8) { b.gone = true; return; } // off the end of the bench
      if (b.y <= 0.05 && b.vy < 0 && b.z < TABLE_END) {
        if (!result && b.z < D) settle(b.doinked ? 'doink' : 'short');
        b.y = 0.05; b.vy *= -0.25; b.vz *= 0.55; b.vx *= 0.55; b.pitchRate *= 0.5; b.wob *= 0.5; if (Math.abs(b.vy) < 8) b.vy = 0;
        if (!b.landed) { b.landed = true; sfx('tick'); burst('dust', b.x, 0.05, b.z); }
      }
      if (!result && b.vz < 0 && b.z < D - 1) settle(b.doinked ? 'doink' : 'short'); // knocked back off the goal
    }

    // ---------- drawing
    const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    // a polygon in the table's plane (y = 0) through the camera, e.g. a coffee ring or a scorch mark
    function tablePath(h, cx, cz, rx, rz, k = 28, wob = 0) {
      h.beginPath();
      for (let i = 0; i <= k; i++) { const a = (i / k) * Math.PI * 2, r = 1 + wob * (hash(i + cx * 7) - 0.5); const p = proj(cx + Math.cos(a) * rx * r, 0, cz + Math.sin(a) * rz * r); i ? h.lineTo(p.x, p.y) : h.moveTo(p.x, p.y); }
      h.closePath();
    }
    // ---------- props lying on the bench (drawn into the cached bench)
    // an image laid flat on the table at height y: a grid of small triangles, each an affine map, so it follows the
    // perspective; src = [sx, sy, sw, sh] in the image
    function tableImage(h, im, cx, cz, w, d, rot, y = 0.005, src) {
      if (!(im?.complete && im.naturalWidth)) return false;
      const [sx, sy, sw, sh] = src || [0, 0, im.naturalWidth, im.naturalHeight], N = 6, c = Math.cos(rot), s = Math.sin(rot);
      const at = (u, v) => { const lx = (u - 0.5) * w, lz = (0.5 - v) * d; return proj(cx + lx * c - lz * s, y, cz + lx * s + lz * c); };
      const tri = (s0, s1, s2, d0, d1, d2) => {
        const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]); if (!den) return;
        const a = ((d1.x - d0.x) * (s2[1] - s0[1]) - (d2.x - d0.x) * (s1[1] - s0[1])) / den, b = ((d1.y - d0.y) * (s2[1] - s0[1]) - (d2.y - d0.y) * (s1[1] - s0[1])) / den;
        const c2 = ((d2.x - d0.x) * (s1[0] - s0[0]) - (d1.x - d0.x) * (s2[0] - s0[0])) / den, d2_ = ((d2.y - d0.y) * (s1[0] - s0[0]) - (d1.y - d0.y) * (s2[0] - s0[0])) / den;
        const e = d0.x - a * s0[0] - c2 * s0[1], f = d0.y - b * s0[0] - d2_ * s0[1];
        const mx = (d0.x + d1.x + d2.x) / 3, my = (d0.y + d1.y + d2.y) / 3, grow = (p) => [p.x + (p.x - mx) * 0.04, p.y + (p.y - my) * 0.04];
        h.save(); h.beginPath(); h.moveTo(...grow(d0)); h.lineTo(...grow(d1)); h.lineTo(...grow(d2)); h.closePath(); h.clip();
        h.transform(a, b, c2, d2_, e, f); h.drawImage(im, 0, 0); h.restore();
      };
      // its soft shadow first
      h.save(); h.filter = 'blur(3px)'; h.fillStyle = 'rgba(12,5,1,.45)'; h.beginPath();
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => { const q = at(u + 0.03, v - 0.03); i ? h.lineTo(q.x, q.y + 2) : h.moveTo(q.x, q.y + 2); }); h.closePath(); h.fill(); h.restore();
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N, S = (u, v) => [sx + u * sw, sy + v * sh];
        tri(S(u0, v0), S(u1, v0), S(u1, v1), at(u0, v0), at(u1, v0), at(u1, v1));
        tri(S(u0, v0), S(u1, v1), S(u0, v1), at(u0, v0), at(u1, v1), at(u0, v1));
      }
      return true;
    }
    function coin(h, im, cx, cz, r, y0 = 0) { // a coin lying flat: its brass rim, then its face
      const rim = (y) => { h.beginPath(); for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2, q = proj(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y); } h.closePath(); };
      h.save(); h.filter = 'blur(2px)'; rim(0); h.fillStyle = 'rgba(12,5,1,.45)'; h.translate(2, 2); h.fill(); h.restore();
      rim(y0); h.fillStyle = '#6b4a14'; h.fill(); rim(y0 + 0.07); h.fillStyle = '#8a6420'; h.fill();
      tableImage(h, im, cx, cz, r * 2, r * 2, 0, y0 + 0.075);
    }
    function crumple(h, x, z, r) { // a crumpled notebook sheet: a lumpy ball with creases and a few blue rules
      const c = proj(x, r * 0.9, z), R = r * c.s;
      h.save(); h.filter = 'blur(3px)'; h.fillStyle = 'rgba(12,5,1,.45)'; h.beginPath(); h.ellipse(c.x + R * 0.2, proj(x, 0, z).y, R * 1.1, R * 0.28, 0, 0, Math.PI * 2); h.fill(); h.restore();
      h.beginPath(); for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2, rr = R * (0.86 + 0.18 * hash(i + x * 13)); i ? h.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr * 0.92) : h.moveTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr * 0.92); } h.closePath();
      const gr = h.createRadialGradient(c.x - R * 0.35, c.y - R * 0.4, R * 0.1, c.x, c.y, R * 1.1); gr.addColorStop(0, '#fbf6ea'); gr.addColorStop(0.6, '#d9d0bd'); gr.addColorStop(1, '#8f8572');
      h.fillStyle = gr; h.fill(); h.save(); h.clip();
      h.lineWidth = Math.max(0.6, R * 0.04);
      for (let k = 0; k < 9; k++) { h.strokeStyle = k < 3 ? 'rgba(80,130,215,.45)' : 'rgba(90,80,60,.4)'; h.beginPath(); let px = c.x + (hash(k + x) - 0.5) * R * 1.6, py = c.y + (hash(k + z) - 0.5) * R * 1.6; h.moveTo(px, py); for (let m = 0; m < 3; m++) { px += (hash(k * 7 + m) - 0.5) * R; py += (hash(k * 5 + m + 2) - 0.5) * R; h.lineTo(px, py); } h.stroke(); }
      h.restore();
    }
    function flatFootball(h, x, z, rot) { // a spare football lying flat: the folded triangle on the table, a thin edge
      const c = Math.cos(rot), s = Math.sin(rot), P = (lz, lx, y) => proj(x + lx * c - lz * s, y, z + lx * s + lz * c);
      const base = TRI.map(([tz, ty]) => P(tz, ty, 0)), top = TRI.map(([tz, ty]) => P(tz, ty, 0.07));
      h.save(); h.filter = 'blur(2px)'; h.fillStyle = 'rgba(12,5,1,.45)'; h.beginPath(); base.forEach((q, i) => (i ? h.lineTo(q.x + 2, q.y + 2) : h.moveTo(q.x + 2, q.y + 2))); h.closePath(); h.fill(); h.restore();
      h.fillStyle = '#cfc6b2'; h.beginPath(); base.forEach((q, i) => (i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y))); top.slice().reverse().forEach((q) => h.lineTo(q.x, q.y)); h.closePath(); h.fill();
      h.fillStyle = '#f6f0e2'; h.beginPath(); top.forEach((q, i) => (i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y))); h.closePath(); h.fill();
      h.save(); h.clip(); h.strokeStyle = 'rgba(70,120,210,.5)'; h.lineWidth = 1;
      for (let k = 1; k < 7; k++) { const t = k / 7, a = lerp(top[0], top[1], t), b = lerp(top[0], top[2], t); h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.stroke(); }
      h.strokeStyle = 'rgba(210,60,60,.6)'; const m1 = lerp(top[1], top[2], 0.25), m2 = lerp(top[0], top[1], 0.75); h.beginPath(); h.moveTo(m1.x, m1.y); h.lineTo(m2.x, m2.y); h.stroke(); h.restore();
      h.strokeStyle = 'rgba(110,95,70,.5)'; h.lineWidth = 0.8; h.beginPath(); top.forEach((q, i) => (i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y))); h.closePath(); h.stroke();
    }
    function lyingPencil(h, x0, z0, x1, z1) { // a #2 pencil lying on the bench: eraser at (x0, z0), point at (x1, z1)
      const r = PEN_R, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      const at = (t, side, y) => proj(x0 + ux * t - uz * side, y, z0 + uz * t + ux * side);
      const strip = (t0, t1, side0, side1, y0, y1, col) => { const a = at(t0, side0, y0), b = at(t1, side0, y0), c = at(t1, side1, y1), d = at(t0, side1, y1); h.fillStyle = col; h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.lineTo(c.x, c.y); h.lineTo(d.x, d.y); h.closePath(); h.fill(); };
      h.save(); h.filter = 'blur(2px)'; strip(0, L, r * 1.6, -r * 0.4, 0, 0, 'rgba(12,5,1,.45)'); h.restore();
      const body = L - 0.9;
      strip(0.5, body, -r, 0, r * 0.5, r * 2, '#f1b51c'); strip(0.5, body, 0, r, r * 2, r * 0.5, '#b9800f'); strip(0.5, body, -r * 0.3, r * 0.1, r * 2, r * 2, '#ffd864');
      strip(0.25, 0.5, -r, r, r * 0.5, r * 2, '#aeb3b9'); strip(0, 0.25, -r, r, r * 0.5, r * 2, '#e6869c');
      const a = at(body, -r, r), b = at(body, r, r), tip = at(L, 0, r * 0.4), g1 = at(L - 0.3, -r * 0.3, r * 0.8), g2 = at(L - 0.3, r * 0.3, r * 0.8);
      h.fillStyle = '#e2b98a'; h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.lineTo(tip.x, tip.y); h.closePath(); h.fill();
      h.fillStyle = '#3a3a40'; h.beginPath(); h.moveTo(g1.x, g1.y); h.lineTo(g2.x, g2.y); h.lineTo(tip.x, tip.y); h.closePath(); h.fill();
    }
    function standing(h, im, x, z, hgt, lean = 0, src) { // an image standing up on the bench (a pack, a card in a stand), lit like Plank
      if (!(im?.complete && im.naturalWidth)) return;
      const [sx, sy, sw, sh] = src || [0, 0, im.naturalWidth, im.naturalHeight], base = proj(x, 0, z), hh = hgt * base.s, ww = hh * sw / sh;
      h.save(); h.filter = 'blur(4px)'; h.fillStyle = 'rgba(12,5,1,.5)'; h.beginPath(); h.ellipse(base.x + ww * 0.15, base.y, ww * 0.62, ww * 0.1, 0, 0, Math.PI * 2); h.fill(); h.restore();
      const c = document.createElement('canvas'); c.width = Math.ceil(ww * dpr); c.height = Math.ceil(hh * dpr); const q = c.getContext('2d');
      q.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height); q.globalCompositeOperation = 'source-atop';
      const lg = q.createLinearGradient(0, 0, c.width, c.height * 0.3); lg.addColorStop(0, 'rgba(30,12,2,.45)'); lg.addColorStop(0.6, 'rgba(30,12,2,.1)'); lg.addColorStop(1, 'rgba(255,190,110,.12)'); q.fillStyle = lg; q.fillRect(0, 0, c.width, c.height);
      const bt = q.createLinearGradient(0, c.height * 0.55, 0, c.height); bt.addColorStop(0, 'rgba(20,8,2,0)'); bt.addColorStop(1, 'rgba(20,8,2,.4)'); q.fillStyle = bt; q.fillRect(0, 0, c.width, c.height);
      h.save(); h.translate(base.x, base.y); h.rotate(lean); h.drawImage(c, -ww / 2, -hh, ww, hh); h.restore();
    }
    // a box lying on the bench (an offcut, a chisel handle, a mallet head): its corners projected, the faces that turn
    // toward the eye drawn, the top lit. col = { top, side, end } (end = the short faces, end grain for wood)
    function box(h, x, z, w, d, ht, rot, col, y0 = 0, shadow = true) {
      const c = Math.cos(rot), s = Math.sin(rot), W2 = w / 2, D2 = d / 2;
      const P = (lx, y, lz) => ({ wx: x + lx * c - lz * s, wz: z + lx * s + lz * c, y });
      const foot = [P(-W2, y0, -D2), P(W2, y0, -D2), P(W2, y0, D2), P(-W2, y0, D2)], top = foot.map((p) => ({ ...p, y: y0 + ht }));
      const pj = (p) => proj(p.wx, p.y, p.wz), path = (ps) => { h.beginPath(); ps.forEach((p, i) => { const q = pj(p); i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y); }); h.closePath(); };
      if (shadow) { h.save(); h.filter = 'blur(3px)'; h.fillStyle = 'rgba(12,5,1,.5)'; path(foot.map((p) => ({ ...p, wx: p.wx + 0.12, wz: p.wz + 0.18, y: 0 }))); h.fill(); h.restore(); }
      const eye = { x: 0, z: TEE_Z - CAM_DB };
      const sides = [[0, 1, 0, -1, 'side'], [1, 2, 1, 0, 'end'], [2, 3, 0, 1, 'side'], [3, 0, -1, 0, 'end']].map(([i, j, nx, nz, kind]) => {
        const n = { x: nx * c - nz * s, z: nx * s + nz * c }, m = { x: (foot[i].wx + foot[j].wx) / 2, z: (foot[i].wz + foot[j].wz) / 2 };
        return { i, j, kind, vis: n.x * (eye.x - m.x) + n.z * (eye.z - m.z) > 0, lit: 0.6 + 0.4 * Math.max(0, -n.x * 0.6 - n.z * 0.4) };
      }).filter((f) => f.vis);
      for (const f of sides) {
        path([foot[f.i], foot[f.j], top[f.j], top[f.i]]); h.fillStyle = f.kind === 'end' ? col.end : col.side; h.fill();
        h.fillStyle = `rgba(0,0,0,${0.35 * (1 - f.lit)})`; h.fill();
        if (f.kind === 'end' && col.rings) { const a = pj(foot[f.i]), b = pj(top[f.j]); h.save(); h.clip(); h.strokeStyle = 'rgba(70,35,10,.35)'; h.lineWidth = 0.8; const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + Math.abs(b.y - a.y) * 0.8; for (let r = 3; r < Math.abs(b.x - a.x) * 2; r += 3) { h.beginPath(); h.arc(cx, cy, r, 0, Math.PI * 2); h.stroke(); } h.restore(); }
      }
      path(top); h.fillStyle = col.top; h.fill();
      if (col.grain) { h.save(); h.clip(); h.strokeStyle = 'rgba(90,50,15,.28)'; h.lineWidth = 0.7; for (let k = 1; k < 6; k++) { const f = k / 6 + (hash(k + x) - 0.5) * 0.08; const a = pj(P(-W2, y0 + ht, -D2 + d * f)), b = pj(P(W2, y0 + ht, -D2 + d * (f + (hash(k + z) - 0.5) * 0.1))); h.beginPath(); h.moveTo(a.x, a.y); h.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 1.5, b.x, b.y); h.stroke(); } h.restore(); }
      h.strokeStyle = 'rgba(255,230,190,.25)'; h.lineWidth = 0.8; path(top); h.stroke();
      return { at: (lx, ly, lz) => P(lx, y0 + ly, lz) };
    }
    const PINE = { top: '#d9a865', side: '#b98446', end: '#c0884a', grain: true, rings: true }, OAK = { top: '#b47a3e', side: '#8a5a2a', end: '#9c6630', grain: true, rings: true }, STEEL = { top: '#c9ced4', side: '#7b8188', end: '#5e636a' };
    function shaving(h, x, z, r, rot) { // a curl of wood shaving: a thin ribbon rolled into a loose spiral, standing on its edge
      const c = proj(x, r, z), R = r * c.s;
      h.save(); h.filter = 'blur(2px)'; h.fillStyle = 'rgba(12,5,1,.35)'; h.beginPath(); h.ellipse(c.x + R * 0.3, proj(x, 0, z).y, R * 1.3, R * 0.25, 0, 0, Math.PI * 2); h.fill(); h.restore();
      h.save(); h.translate(c.x, c.y); h.rotate(rot); h.lineCap = 'round';
      for (const [col, wd] of [['rgba(150,100,45,.7)', 0.32], ['rgba(244,214,160,.85)', 0.18]]) {
        h.strokeStyle = col; h.lineWidth = Math.max(0.8, R * wd); h.beginPath();
        for (let a = 0; a < Math.PI * 2.6; a += 0.12) { const rr = R * (1 - a / (Math.PI * 3.4)); const px = Math.cos(a) * rr * 1.6 + a * R * 0.18, py = Math.sin(a) * rr * 0.45; a ? h.lineTo(px, py) : h.moveTo(px, py); }
        h.stroke();
      }
      h.restore();
    }
    function sawdust(h, x, z, r) { const q = proj(x, 0, z); h.save(); h.translate(q.x, q.y); h.scale(1, 0.22); const gr = h.createRadialGradient(0, 0, 0, 0, 0, r * q.s); gr.addColorStop(0, 'rgba(236,198,140,.75)'); gr.addColorStop(0.6, 'rgba(220,178,120,.35)'); gr.addColorStop(1, 'rgba(220,178,120,0)'); h.fillStyle = gr; h.beginPath(); h.arc(0, -r * q.s * 0.4, r * q.s, 0, Math.PI * 2); h.fill(); h.restore(); }
    function nail(h, x, z, rot) { const c = Math.cos(rot), s = Math.sin(rot), a = proj(x, 0.05, z), b = proj(x + c * 1.2, 0.05, z + s * 1.2); h.strokeStyle = '#7f858c'; h.lineWidth = Math.max(1, 0.07 * a.s); h.lineCap = 'round'; h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.stroke(); h.fillStyle = '#a9afb6'; h.beginPath(); h.ellipse(a.x, a.y, Math.max(1.5, 0.12 * a.s), Math.max(1, 0.06 * a.s), rot, 0, Math.PI * 2); h.fill(); }
    function props(h) { // a working bench: offcuts, shavings and sawdust, tools put down mid-job, a few coins, an Omni pack
      // far to near, so nearer things overlap farther ones
      crumple(h, 9.5, 38, 0.9); crumple(h, -6.8, 33, 0.85);
      // the steel square, dropped at an angle
      box(h, 8.5, 31, 8, 0.8, 0.06, 0.35, STEEL); box(h, 5.2, 29.4, 0.8, 4.5, 0.06, 0.35, STEEL);
      // the mallet: a beech head on its side, the handle pointing away
      { const r = -0.5; box(h, -8.2, 27.5, 7, 0.7, 0.7, r + Math.PI / 2, OAK, 0.4, false); box(h, -9.6, 24.6, 2.6, 1.7, 1.7, r, { top: '#c9955a', side: '#a87440', end: '#b07a45', grain: true, rings: true }); }
      sawdust(h, -3.4, 22, 2.2); sawdust(h, 4.5, 15.5, 1.6);
      // the Omni pack, propped against an offcut
      standing(h, A.pack, 8.1, 22.6, 4.4, 0.2);
      box(h, 7.4, 21.2, 4.5, 1.5, 1.5, 0.15, PINE);
      shaving(h, 5.2, 19.5, 0.45, 0.4); shaving(h, -4.8, 19, 0.5, -0.8); shaving(h, -2.6, 21.5, 0.35, 1.9);
      // a long strip ripped off a board
      box(h, -5.6, 16.5, 9, 0.75, 0.5, -0.32, PINE);
      shaving(h, -6.2, 13.8, 0.55, 2.4); shaving(h, 6.6, 13, 0.4, -0.3);
      // the chisel, put down mid-cut: a wooden handle, a steel blade
      { const r = 1.15, c = Math.cos(r), s = Math.sin(r); box(h, -4.4, 10.5, 2.8, 0.45, 0.45, r, OAK); box(h, -4.4 + c * 2.3, 10.5 + s * 2.3, 1.9, 0.4, 0.07, r, STEEL, 0.05); }
      // the carpenter's pencil: flat, red
      box(h, 5.2, 9.5, 5.5, 0.45, 0.2, 2.6, { top: '#c8322a', side: '#8f1d16', end: '#e2b98a' });
      for (let k = 0; k < 5; k++) nail(h, 2.6 + hash(k + 20) * 2.2, 6 + hash(k + 21) * 2.5, hash(k + 22) * 6);
      coin(h, A.coinK, 3.6, 7.2, 0.45); coin(h, A.coinP, 2.3, 4.2, 0.45); coin(h, A.coinP, 2.45, 4.25, 0.45, 0.07);
      shaving(h, -2.9, 6.2, 0.35, 0.7);
    }
    let bench = null, benchKey = '', grain = null;
    const PAD = 0.2; // the cached bench is wider than the view, so the view can lean toward an off-centre goal
    function backdrop() { // the far wall and the workbench (planks, grain, kid-table marks), drawn once per size, cached
      const key = `${W}x${H}x${dpr}x${loaded()}`;
      if (!(bench && benchKey === key)) {
        const BW = W * (1 + 2 * PAD), c = document.createElement('canvas'); c.width = Math.round(BW * dpr); c.height = cv.height;
        const h = c.getContext('2d'); h.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cx0 = CX; CX = BW / 2;
        const edge = proj(0, 0, 160).y;
        const sky = h.createLinearGradient(0, 0, 0, edge); sky.addColorStop(0, '#120c08'); sky.addColorStop(1, '#2a1b10');
        h.fillStyle = sky; h.fillRect(0, 0, BW, edge + 1);
        const p = A.backdrop;
        if (p?.complete && p.naturalWidth) {
          h.save(); h.filter = 'blur(6px) brightness(.45) saturate(.85)'; const s = Math.max(BW / p.naturalWidth, (edge + 30) / p.naturalHeight) * 1.05;
          h.drawImage(p, (BW - p.naturalWidth * s) / 2, edge + 16 - p.naturalHeight * s, p.naturalWidth * s, p.naturalHeight * s); h.restore();
        }
        // the planks: 5.5 in oak boards running away from you, each its own shade, dark seams between
        const wood = h.createLinearGradient(0, proj(0, 0, TABLE_END).y, 0, H); wood.addColorStop(0, '#3e2410'); wood.addColorStop(0.3, '#7a4a22'); wood.addColorStop(1, '#b97a3c');
        const yFar = proj(0, 0, TABLE_END).y; h.fillStyle = wood; h.fillRect(0, yFar, BW, H - yFar);
        const NEAR = -3.3, FAR = TABLE_END;
        for (let i = -10; i < 10; i++) {
          const x0 = i * 5.5 + 2.75, x1 = x0 + 5.5, a = proj(x0, 0, NEAR), b = proj(x1, 0, NEAR), c2 = proj(x1, 0, FAR), d = proj(x0, 0, FAR);
          h.fillStyle = hash(i) < 0.5 ? `rgba(255,220,170,${0.03 + hash(i + 9) * 0.06})` : `rgba(40,18,4,${0.04 + hash(i + 9) * 0.08})`;
          h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.lineTo(c2.x, c2.y); h.lineTo(d.x, d.y); h.closePath(); h.fill();
          // grain: long wavy lines along each board, a knot or two
          for (let k = 0; k < (Math.abs(x0 + 2.75) < 20 ? 14 : 0); k++) { // grain only on the boards in view (far-side boards just streak)
            const f = hash(i * 31 + k), ph = hash(i * 17 + k) * 6, dark = hash(i * 5 + k) < 0.7;
            h.strokeStyle = dark ? `rgba(45,20,5,${0.07 + f * 0.1})` : `rgba(255,215,160,${0.04 + f * 0.05})`; h.lineWidth = 0.6 + f;
            h.beginPath();
            for (let z = NEAR; z <= Math.min(34, FAR); z += z < 6 ? 0.4 : 2) { const q = proj(x0 + 0.2 + f * 5.1 + Math.sin(z * 0.35 + ph) * 0.12 + Math.sin(z * 1.3 + ph) * 0.03, 0, z); z === NEAR ? h.moveTo(q.x, q.y) : h.lineTo(q.x, q.y); }
            h.stroke();
          }
          if (hash(i + 40) < 0.6) { const kz = 2 + hash(i + 41) * 30, kx = x0 + 1 + hash(i + 42) * 3.5; tablePath(h, kx, kz, 0.35, 0.22); h.fillStyle = 'rgba(50,22,6,.35)'; h.fill(); tablePath(h, kx, kz, 0.6, 0.4); h.strokeStyle = 'rgba(50,22,6,.18)'; h.lineWidth = 1; h.stroke(); }
          h.strokeStyle = 'rgba(25,10,2,.55)'; h.lineWidth = 1.5; h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(d.x, d.y); h.stroke();
          h.strokeStyle = 'rgba(255,210,150,.12)'; h.lineWidth = 1; const a2 = proj(x0 + 0.06, 0, NEAR), d2 = proj(x0 + 0.06, 0, FAR); h.beginPath(); h.moveTo(a2.x, a2.y); h.lineTo(d2.x, d2.y); h.stroke();
        }
        // kid-table marks: a coffee ring, pencil scribbles, a ballpoint tally box, masking tape, eraser crumbs, scorches
        tablePath(h, -7.5, 21, 1.6, 1.6, 48, 0.05); h.strokeStyle = 'rgba(70,32,8,.35)'; h.lineWidth = Math.max(1.5, 0.1 * proj(-7.5, 0, 21).s); h.stroke();
        tablePath(h, -7.4, 21.1, 1.45, 1.45, 48, 0.08); h.strokeStyle = 'rgba(70,32,8,.15)'; h.lineWidth = 1; h.stroke();
        h.strokeStyle = 'rgba(55,55,65,.4)'; h.lineWidth = 1.2; h.beginPath();
        for (let k = 0; k <= 30; k++) { const q = proj(-7.5 + k * 0.12 + Math.sin(k * 2.1) * 0.2, 0, 5 + Math.sin(k * 1.7) * 0.6 + (k % 2) * 0.5); k ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y); } h.stroke();
        h.strokeStyle = 'rgba(40,60,140,.35)'; h.lineWidth = 1;
        const box = [[5, 18], [8, 18], [8, 20], [5, 20], [5, 18]].map(([x, z]) => proj(x, 0, z)); h.beginPath(); box.forEach((q, k) => (k ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y))); h.stroke();
        for (let k = 0; k < 4; k++) { const a = proj(5.5 + k * 0.4, 0, 18.4), b = proj(5.5 + k * 0.4, 0, 19.6); h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.stroke(); }
        { const a = proj(5.3, 0, 18.6), b = proj(7.2, 0, 19.4); h.beginPath(); h.moveTo(a.x, a.y); h.lineTo(b.x, b.y); h.stroke(); }
        { const t = [[-9, 2.6], [-4.5, 2.4], [-4.4, 3.1], [-9.1, 3.3]].map(([x, z]) => proj(x, 0, z)); h.fillStyle = 'rgba(226,212,170,.75)'; h.beginPath(); t.forEach((q, k) => (k ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y))); h.closePath(); h.fill(); h.strokeStyle = 'rgba(120,100,60,.3)'; h.stroke(); }
        for (let k = 0; k < 7; k++) { tablePath(h, 2 + hash(k + 70) * 3, 1 + hash(k + 71) * 3, 0.05 + hash(k) * 0.04, 0.04, 8, 0.6); h.fillStyle = 'rgba(232,140,150,.8)'; h.fill(); }
        for (const [x, z, r] of [[-11, 26, 1.6], [11, 40, 2.2]]) { const q = proj(x, 0, z), gr = h.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * q.s); gr.addColorStop(0, 'rgba(20,8,2,.45)'); gr.addColorStop(1, 'rgba(20,8,2,0)'); h.fillStyle = gr; tablePath(h, x, z, r, r, 28, 0.4); h.fill(); }
        props(h);
        // a fine speckle of sawdust and wear
        const yEnd = proj(0, 0, TABLE_END).y;
        for (let k = 0; k < 900; k++) { const x = hash(k * 3) * BW, y = yEnd + hash(k * 3 + 1) ** 0.6 * (H - yEnd); h.fillStyle = hash(k * 3 + 2) < 0.5 ? 'rgba(255,225,180,.08)' : 'rgba(30,12,2,.1)'; h.fillRect(x, y, 1, 1); }
        CX = cx0; bench = c; benchKey = key;
        // the paper's grain, a small tile
        grain = document.createElement('canvas'); grain.width = grain.height = 48; const q = grain.getContext('2d');
        for (let k = 0; k < 500; k++) { q.fillStyle = hash(k + 500) < 0.5 ? 'rgba(120,100,70,.10)' : 'rgba(255,255,255,.12)'; q.fillRect(hash(k * 2 + 900) * 48, hash(k * 2 + 901) * 48, 1, 1); }
      }
      g.drawImage(bench, CX - W / 2 - PAD * W, 0, W * (1 + 2 * PAD), H);
    }
    // ---------- the furnace behind the bench, its door open: kick a football over Plank and into it and it burns
    const TABLE_END = 44, FURN_Z = 46, FURN_W = 26, MOUTH = { x: 6.5, y0: 1, y1: 9 };
    let burnFlash = 0;
    function furnace(real) {
      const yEdge = proj(0, 0, TABLE_END).y; // the bench's far edge: everything here is behind the bench
      g.save(); g.beginPath(); g.rect(0, 0, W, yEdge); g.clip();
      const L = proj(-FURN_W / 2, -6, FURN_Z), R = proj(FURN_W / 2, 30, FURN_Z), s = L.s;
      // the body: cast iron, riveted bands, a brick arch round the mouth
      const ig = g.createLinearGradient(L.x, 0, R.x, 0); ig.addColorStop(0, '#16110d'); ig.addColorStop(0.35, '#2e2620'); ig.addColorStop(0.7, '#241d18'); ig.addColorStop(1, '#0f0b08');
      g.fillStyle = ig; g.fillRect(L.x, R.y, R.x - L.x, L.y - R.y);
      g.fillStyle = 'rgba(255,170,90,.06)'; for (const yy of [12, 20]) { const b = proj(0, yy, FURN_Z); g.fillRect(L.x, b.y, R.x - L.x, 0.5 * s); }
      g.fillStyle = '#5a4a3a'; for (const yy of [12, 20]) for (let xx = -FURN_W / 2 + 1; xx < FURN_W / 2; xx += 2.2) { const r = proj(xx, yy + 0.25, FURN_Z); g.beginPath(); g.arc(r.x, r.y, Math.max(1, 0.15 * s), 0, Math.PI * 2); g.fill(); }
      const m0 = proj(-MOUTH.x, MOUTH.y0, FURN_Z), m1 = proj(MOUTH.x, MOUTH.y1, FURN_Z), mw = m1.x - m0.x, mh = m0.y - m1.y, arch = mw * 0.5;
      const flick = 0.85 + 0.15 * Math.sin(clock * 11) * Math.sin(clock * 5.3 + 2), heat = Math.min(1.6, flick + burnFlash);
      // the glow on the bench's far end and the iron around the mouth
      const glow = g.createRadialGradient((m0.x + m1.x) / 2, m0.y, 0, (m0.x + m1.x) / 2, m0.y, mw * 2.2 * heat);
      glow.addColorStop(0, `rgba(255,140,50,${0.35 * heat})`); glow.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = glow; g.fillRect(L.x - mw, R.y, R.x - L.x + 2 * mw, yEdge - R.y);
      const brick = (x, y, w, h) => { g.fillStyle = '#5b2a18'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(20,8,4,.7)'; g.lineWidth = 1; g.strokeRect(x, y, w, h); };
      for (let i = 0; i < 9; i++) { const a = Math.PI + (i / 8) * Math.PI, bx = (m0.x + m1.x) / 2 + Math.cos(a) * (mw / 2 + 0.6 * s), by = m1.y + arch * 0.6 + Math.sin(a) * (arch * 0.6 + 0.6 * s); brick(bx - 0.5 * s, by - 0.4 * s, 1 * s, 0.8 * s); }
      // inside: coal bed and flames
      g.save(); g.beginPath(); g.moveTo(m0.x, m0.y); g.lineTo(m0.x, m1.y + arch * 0.6); g.ellipse((m0.x + m1.x) / 2, m1.y + arch * 0.6, mw / 2, arch * 0.6, 0, Math.PI, 0); g.lineTo(m1.x, m0.y); g.closePath(); g.clip();
      const ins = g.createLinearGradient(0, m1.y, 0, m0.y); ins.addColorStop(0, '#2a0d03'); ins.addColorStop(0.6, `rgba(${Math.round(200 * heat)},70,10,1)`); ins.addColorStop(1, '#ffb347'); g.fillStyle = ins; g.fillRect(m0.x, m1.y, mw, mh + arch);
      for (let k = 0; k < 7; k++) { // flames: layered tongues, flickering
        const fx = m0.x + mw * (0.12 + k * 0.13), fh = mh * (0.55 + 0.3 * Math.sin(clock * (6 + k) + k * 1.7)) * heat, fw = mw * 0.13;
        const fg = g.createLinearGradient(0, m0.y, 0, m0.y - fh); fg.addColorStop(0, 'rgba(255,240,180,.95)'); fg.addColorStop(0.4, 'rgba(255,160,40,.85)'); fg.addColorStop(1, 'rgba(200,40,10,0)');
        g.fillStyle = fg; g.beginPath(); g.moveTo(fx - fw, m0.y); g.quadraticCurveTo(fx - fw * 0.6, m0.y - fh * 0.5, fx + Math.sin(clock * 9 + k) * fw * 0.6, m0.y - fh); g.quadraticCurveTo(fx + fw * 0.6, m0.y - fh * 0.5, fx + fw, m0.y); g.closePath(); g.fill();
      }
      for (let k = 0; k < 14; k++) { const cx = m0.x + mw * hash(k + 600), cy = m0.y - mh * 0.08 * hash(k + 601); g.fillStyle = `rgba(255,${Math.round(120 + 100 * hash(k + 602))},40,${0.6 + 0.4 * Math.sin(clock * 4 + k)})`; g.beginPath(); g.arc(cx, cy, mw * 0.05, 0, Math.PI * 2); g.fill(); }
      g.restore();
      // the open door, swung out to the left on its hinge, and the brass handle
      const dh0 = proj(-MOUTH.x - 0.3, MOUTH.y0 - 0.3, FURN_Z), dh1 = proj(-MOUTH.x - 0.3, MOUTH.y1 + 0.5, FURN_Z), dw = mw * 0.32;
      g.fillStyle = '#1d1712'; g.beginPath(); g.moveTo(dh0.x, dh0.y); g.lineTo(dh1.x, dh1.y - arch * 0.3); g.lineTo(dh1.x - dw, dh1.y - arch * 0.1); g.lineTo(dh0.x - dw, dh0.y + mh * 0.05); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,150,70,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(dh0.x, dh0.y); g.lineTo(dh1.x, dh1.y - arch * 0.3); g.stroke();
      g.fillStyle = '#c9963a'; g.fillRect(dh1.x - dw * 0.8, (dh0.y + dh1.y) / 2 - 2, dw * 0.35, 4);
      g.restore();
      // the bench's far edge catches the firelight
      g.fillStyle = `rgba(255,170,90,${0.25 * heat})`; g.fillRect(0, yEdge - 1, W, 1.5);
      burnFlash = Math.max(0, burnFlash - real * 1.2);
    }
    // the warm desk lamp over the goal, the forge's glow behind, dust drifting in the light (every frame)
    const motes = Array.from({ length: 26 }, (_, i) => ({ x: hash(i + 300), y: hash(i + 301), v: 0.004 + hash(i + 302) * 0.01, r: 0.6 + hash(i + 303) * 1.2, ph: hash(i + 304) * 6 }));
    function atmosphere(D, real) {
      const gp = proj(shot.offset, 0, D);
      const lamp = g.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, Math.max(W, H) * 0.75);
      lamp.addColorStop(0, `rgba(255,${Math.round(190 - burnFlash * 60)},${Math.round(110 - burnFlash * 60)},${0.2 + burnFlash * 0.25})`); lamp.addColorStop(0.45, 'rgba(255,170,90,.07)'); lamp.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = lamp; g.fillRect(0, 0, W, H);
      for (const m of motes) {
        m.x = (m.x + m.v * real) % 1; const x = m.x * W, y = H * 0.12 + m.y * H * 0.5 + Math.sin(clock * 0.7 + m.ph) * 6;
        g.fillStyle = `rgba(255,225,170,${0.18 + 0.15 * Math.sin(clock * 2 + m.ph)})`; g.beginPath(); g.arc(x, y, m.r, 0, Math.PI * 2); g.fill();
      }
    }
    function vignette() {
      const vig = g.createRadialGradient(W / 2, H * 0.55, H * 0.25, W / 2, H * 0.55, Math.max(W, H) * 0.8); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = vig; g.fillRect(0, 0, W, H);
    }
    function tape(D) { // the yellow tape measure out to the goal: inch ticks, numbers every 6
      const len = D - TEE_Z - 0.6, a = proj(-1.65, 0.01, TEE_Z + 0.6), b = proj(-1.65, 0.01, D - 0.6), a2 = proj(-1.05, 0.01, TEE_Z + 0.6), b2 = proj(-1.05, 0.01, D - 0.6);
      const gr = g.createLinearGradient(a.x, a.y, a2.x, a2.y); gr.addColorStop(0, '#c99a22'); gr.addColorStop(0.5, '#efc441'); gr.addColorStop(1, '#d9a92c');
      g.fillStyle = 'rgba(20,8,2,.3)'; g.beginPath(); g.moveTo(a.x + 2, a.y + 2); g.lineTo(b.x + 1, b.y + 1); g.lineTo(b2.x + 1, b2.y + 1); g.lineTo(a2.x + 2, a2.y + 2); g.closePath(); g.fill();
      g.fillStyle = gr; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b2.x, b2.y); g.lineTo(a2.x, a2.y); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,24,6,.75)'; g.lineWidth = 1; g.textAlign = 'center'; g.fillStyle = 'rgba(40,24,6,.85)';
      for (let z = 1; z < len; z++) {
        const p = proj(-1.65, 0.01, TEE_Z + z), q = proj(z % 6 ? -1.47 : -1.28, 0.01, TEE_Z + z); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
        if (z % 6 === 0 && p.s > 9) { const m = proj(-1.2, 0.01, TEE_Z + z); g.font = `700 ${Math.max(7, Math.min(13, p.s * 0.22))}px Nunito, system-ui, sans-serif`; g.fillText(String(z), m.x, m.y + 1); }
      }
    }
    let pc = null; // Plank, lit by the lamp, on his own small canvas
    function plank() {
      const k = A.plank, P = TEE_Z + shot.dist + PLANK_BACK, base = proj(shot.offset, 0, P), hh = PLANK_H * base.s;
      const sh = g.createRadialGradient(base.x, base.y, 0, base.x, base.y, 2.4 * base.s); sh.addColorStop(0, 'rgba(15,6,1,.5)'); sh.addColorStop(1, 'rgba(15,6,1,0)');
      g.fillStyle = sh; g.save(); g.translate(base.x, base.y); g.scale(1, 0.2); g.translate(-base.x, -base.y); g.beginPath(); g.arc(base.x, base.y, 2.4 * base.s, 0, Math.PI * 2); g.fill(); g.restore();
      if (!(k?.complete && k.naturalWidth)) { g.fillStyle = '#e8c860'; g.fillRect(base.x - 1.4 * base.s, base.y - hh, 2.8 * base.s, hh); return; }
      const ww = hh * k.naturalWidth / k.naturalHeight, pw = Math.ceil(ww * dpr), ph = Math.ceil(hh * dpr);
      if (!pc || pc.width !== pw || pc.height !== ph) { pc = document.createElement('canvas'); pc.width = pw; pc.height = ph; }
      const q = pc.getContext('2d'); q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, pw, ph); q.drawImage(k, 0, 0, pw, ph);
      q.globalCompositeOperation = 'source-atop'; const lg = q.createLinearGradient(0, 0, pw, ph * 0.3);
      lg.addColorStop(0, 'rgba(30,12,2,.42)'); lg.addColorStop(0.55, 'rgba(30,12,2,.08)'); lg.addColorStop(1, 'rgba(255,190,110,.16)'); q.fillStyle = lg; q.fillRect(0, 0, pw, ph);
      const bot = q.createLinearGradient(0, ph * 0.6, 0, ph); bot.addColorStop(0, 'rgba(20,8,2,0)'); bot.addColorStop(1, 'rgba(20,8,2,.35)'); q.fillStyle = bot; q.fillRect(0, 0, pw, ph);
      // a hit: he squashes and wobbles
      const age = ball?.thunkAt ? clock - ball.thunkAt : 9, kk = Math.max(0, 1 - age / 0.55), wob = Math.sin(age * 28) * kk;
      g.save(); g.translate(base.x, base.y); g.rotate(wob * 0.07); g.scale(1 + 0.1 * kk * Math.max(0, Math.cos(age * 28)), 1 - 0.12 * kk * Math.max(0, Math.cos(age * 28)));
      g.drawImage(pc, -ww / 2, -hh, ww, hh); g.restore();
    }
    // a sharpened #2 pencil standing eraser-up from y0 to y1 at (x, z): three faces of the hexagon, a shine, the ferrule
    function pencil(x, z, y0, y1) {
      const b = proj(x, y0, z), t = proj(x, y1, z), w = Math.max(2.5, PEN_R * 2 * b.s);
      const top = t.y + w * 1.3, er = w * 0.8, L = b.x - w / 2;
      g.fillStyle = 'rgba(15,6,1,.35)'; g.fillRect(L + w * 0.6, top + w, w * 0.7, b.y - top - w); // its shadow on the block's face
      g.fillStyle = '#ffd864'; g.fillRect(L, top, w * 0.28, b.y - top);
      g.fillStyle = '#f1b51c'; g.fillRect(L + w * 0.28, top, w * 0.42, b.y - top);
      g.fillStyle = '#b9800f'; g.fillRect(L + w * 0.7, top, w * 0.3, b.y - top);
      g.fillStyle = 'rgba(255,250,220,.75)'; g.fillRect(L + w * 0.2, top, Math.max(0.8, w * 0.08), b.y - top);
      g.fillStyle = 'rgba(255,200,130,.5)'; g.fillRect(L + w * 0.92, top, Math.max(0.6, w * 0.06), b.y - top); // the lamp's rim light
      const fg = g.createLinearGradient(L, 0, L + w, 0); fg.addColorStop(0, '#e6e9ec'); fg.addColorStop(0.45, '#aeb3b9'); fg.addColorStop(1, '#6e737a');
      g.fillStyle = fg; g.fillRect(L, t.y + er, w, w * 0.55);
      g.fillStyle = 'rgba(60,64,70,.55)'; for (let i = 1; i < 4; i++) g.fillRect(L, t.y + er + i * w * 0.13, w, Math.max(0.6, w * 0.035));
      const eg = g.createLinearGradient(L, 0, L + w, 0); eg.addColorStop(0, '#f6b0c0'); eg.addColorStop(0.6, '#e6869c'); eg.addColorStop(1, '#b45d72');
      g.fillStyle = eg; g.beginPath(); g.roundRect(L, t.y, w, er + 1, [w * 0.35, w * 0.35, 0, 0]); g.fill();
    }
    function posts(t) {
      const z = TEE_Z + shot.dist, px = postX(shot, t), hf = shot.half, lx = px - hf - PEN_R, rx = px + hf + PEN_R, bw = hf + PEN_R * 2 + 0.6;
      const zf = z - 0.45, zb = z + 0.45;
      // the oak block (or, on the move, the little red RC car) the pencils stand in; its top face shows from up here
      const fL = proj(px - bw, BLOCK_H, zf), fR = proj(px + bw, 0, zf), bL = proj(px - bw, BLOCK_H, zb), bR = proj(px + bw, BLOCK_H, zb), s = fL.s;
      const sh = g.createRadialGradient((fL.x + fR.x) / 2, fR.y, 0, (fL.x + fR.x) / 2, fR.y, (fR.x - fL.x) * 0.7);
      sh.addColorStop(0, 'rgba(15,6,1,.5)'); sh.addColorStop(1, 'rgba(15,6,1,0)'); g.fillStyle = sh;
      g.save(); g.translate(0, fR.y); g.scale(1, 0.18); g.beginPath(); g.arc((fL.x + fR.x) / 2, 0, (fR.x - fL.x) * 0.7, 0, Math.PI * 2); g.fill(); g.restore();
      if (shot.move) for (const wx of [px - bw + 0.5, px + bw - 0.5]) { const w = proj(wx, 0.3, zf); g.fillStyle = '#1d1a17'; g.beginPath(); g.arc(w.x, w.y, 0.3 * s, 0, Math.PI * 2); g.fill(); g.fillStyle = '#6b6f75'; g.beginPath(); g.arc(w.x, w.y, 0.12 * s, 0, Math.PI * 2); g.fill(); }
      const topY = fL.y, botY = shot.move ? proj(0, 0.4, zf).y : fR.y;
      g.fillStyle = shot.move ? '#d0574a' : '#c99a62'; g.beginPath(); g.moveTo(fL.x, topY); g.lineTo(bL.x, bL.y); g.lineTo(bR.x, bR.y); g.lineTo(fR.x, topY); g.closePath(); g.fill();
      const fg = g.createLinearGradient(0, topY, 0, botY); fg.addColorStop(0, shot.move ? '#b23a2a' : '#a8743e'); fg.addColorStop(1, shot.move ? '#7a2219' : '#6e4520');
      g.fillStyle = fg; g.beginPath(); g.roundRect(fL.x, topY, fR.x - fL.x, botY - topY, [0, 0, 0.1 * s, 0.1 * s]); g.fill();
      if (!shot.move) {
        g.strokeStyle = 'rgba(60,30,8,.35)'; g.lineWidth = 1;
        for (let i = 1; i < 6; i++) { const y = topY + (botY - topY) * i / 6; g.beginPath(); g.moveTo(fL.x + 2, y); g.bezierCurveTo(fL.x + (fR.x - fL.x) * 0.3, y + 1.5, fL.x + (fR.x - fL.x) * 0.6, y - 1.5, fR.x - 2, y + 0.5); g.stroke(); }
        const eg = g.createLinearGradient(fL.x, 0, fL.x + 0.25 * s, 0); eg.addColorStop(0, 'rgba(40,18,4,.45)'); eg.addColorStop(1, 'rgba(40,18,4,0)'); g.fillStyle = eg; g.fillRect(fL.x, topY, 0.25 * s, botY - topY);
      }
      g.fillStyle = 'rgba(255,220,170,.18)'; g.fillRect(fL.x, topY, fR.x - fL.x, 1.2);
      if (shot.move) { const a = proj(px + bw - 0.3, BLOCK_H, zf), b = proj(px + bw - 0.1, 3.6, zf); g.strokeStyle = '#c9ccd1'; g.lineWidth = Math.max(1, 0.06 * s); g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(b.x + 4, (a.y + b.y) / 2, b.x, b.y); g.stroke(); g.fillStyle = '#d33'; g.beginPath(); g.arc(b.x, b.y, Math.max(1.5, 0.1 * s), 0, Math.PI * 2); g.fill(); }
      pencil(lx, z, BLOCK_H, POST_H); pencil(rx, z, BLOCK_H, POST_H);
      // the crossbar: a pencil lashed level where the thumbs touched, with red rubber bands
      const a = proj(lx - PEN_R, BAR, z), b = proj(rx + PEN_R, BAR, z), w = Math.max(2.5, PEN_R * 2 * a.s), y0 = a.y - w / 2;
      g.fillStyle = 'rgba(15,6,1,.3)'; g.fillRect(a.x, y0 + w * 0.6, b.x - a.x, w * 0.6);
      g.fillStyle = '#ffd864'; g.fillRect(a.x, y0, b.x - a.x, w * 0.3); g.fillStyle = '#f1b51c'; g.fillRect(a.x, y0 + w * 0.3, b.x - a.x, w * 0.4); g.fillStyle = '#b9800f'; g.fillRect(a.x, y0 + w * 0.7, b.x - a.x, w * 0.3);
      g.fillStyle = 'rgba(255,250,220,.7)'; g.fillRect(a.x, y0 + w * 0.2, b.x - a.x, Math.max(0.8, w * 0.08));
      for (const xx of [proj(lx, BAR, z).x, proj(rx, BAR, z).x]) for (const o of [-0.75, 0.2]) {
        const bx = xx + o * w, bwid = w * 0.45;
        g.fillStyle = '#8f1d16'; g.beginPath(); g.roundRect(bx, a.y - w * 0.8, bwid, w * 1.6, bwid * 0.4); g.fill();
        g.fillStyle = '#d23a2e'; g.fillRect(bx + bwid * 0.15, a.y - w * 0.75, bwid * 0.45, w * 1.5);
        g.fillStyle = 'rgba(255,200,190,.6)'; g.fillRect(bx + bwid * 0.2, a.y - w * 0.7, Math.max(0.6, bwid * 0.12), w * 1.4);
      }
      // the wind streamer: a strip of notebook paper taped to the left pencil's top
      if (Math.abs(shot.wind) >= 0.5) {
        const tp = proj(lx, POST_H - 0.5, z), len = (0.6 + Math.abs(shot.wind) * 0.12) * tp.s, dir = Math.sign(shot.wind), wv = Math.sin(clock * 9) * 0.12 * tp.s;
        g.fillStyle = 'rgba(246,240,226,.95)'; g.beginPath(); g.moveTo(tp.x, tp.y - 0.12 * tp.s); g.quadraticCurveTo(tp.x + dir * len * 0.5, tp.y + wv, tp.x + dir * len, tp.y + wv * 2); g.lineTo(tp.x + dir * len, tp.y + wv * 2 + 0.2 * tp.s); g.quadraticCurveTo(tp.x + dir * len * 0.5, tp.y + 0.2 * tp.s + wv, tp.x, tp.y + 0.12 * tp.s); g.fill();
        g.strokeStyle = 'rgba(70,120,210,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tp.x, tp.y); g.quadraticCurveTo(tp.x + dir * len * 0.5, tp.y + 0.05 * tp.s + wv, tp.x + dir * len, tp.y + wv * 2 + 0.1 * tp.s); g.stroke();
      }
    }
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s });
    function paper(b) {
      // a soft bow across the sheet (it's paper, not a board), flexing as it wobbles in flight
      const flex = 0.05 + (b.t ? Math.sin(b.t * 22) * 0.05 * (0.3 + b.wob) : 0);
      const vert = (o, sx) => { const r2 = (o.y * o.y + o.z * o.z) / 0.7; return rotate([sx * o.t / 2 + flex * (1 - r2), o.y, o.z], b.pitch, b.yaw, b.roll); };
      const R = [...OUT.map((o) => vert(o, -1)), ...OUT.map((o) => vert(o, 1))]; // 0..NO-1 left, NO.. right
      if (b.z + Math.min(...R.map((v) => v[2])) - TEE_Z + CAM_DB < 0.6) return; // past the eye: off screen
      const pts = R.map(([x, y, z]) => proj(b.x + x, b.y + y, b.z + z));
      const light = [-0.4, 0.7, -0.6];
      const items = [{ idx: OUT.map((_, k) => k), kind: 'face', side: 0 }, { idx: OUT.map((_, k) => NO + NO - 1 - k), kind: 'face', side: 1 }];
      for (let k = 0; k < NO; k++) { const j = (k + 1) % NO; items.push({ idx: [k, j, NO + j, NO + k], kind: OUT[k].strike ? 'strike' : 'edge' }); }
      for (const it of items) it.depth = it.idx.reduce((s, k) => s + R[k][2], 0) / it.idx.length;
      items.sort((p, q) => q.depth - p.depth);
      for (const it of items) {
        const P = it.idx.map((k) => pts[k]);
        const area = P.reduce((s, p, j) => { const q = P[(j + 1) % P.length]; return s + (p.x * q.y - q.x * p.y); }, 0);
        if (it.kind === 'face' ? Math.abs(area) < 0.3 : Math.abs(area) < 0.02) continue;
        const v = it.kind === 'face' ? CORNER.map((c) => R[c + (it.side ? NO : 0)]) : it.idx.slice(0, 3).map((k) => R[k]);
        const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...nn) || 1;
        const lit = (0.72 + 0.28 * Math.abs(nn[0] * light[0] + nn[1] * light[1] + nn[2] * light[2]) / l) * (1 - 0.8 * (b.char || 0));
        g.beginPath(); P.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
        g.fillStyle = it.kind === 'face' ? `rgb(${Math.round(250 * lit)},${Math.round(245 * lit)},${Math.round(230 * lit)})` : `rgb(${Math.round(240 * lit)},${Math.round(233 * lit)},${Math.round(216 * lit)})`;
        if (it.kind !== 'face') { g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke(); } // close the hairline gaps between strips
        g.fill();
        if (it.kind === 'face') { // wide-ruled blue lines across the strip (parallel to a short edge); a red margin on one face
          const [B, Tp, Fp] = CORNER.map((c) => pts[c + (it.side ? NO : 0)]);
          g.save(); g.clip();
          if (grain) { g.fillStyle = g.createPattern(grain, 'repeat'); g.fill(); }
          g.strokeStyle = 'rgba(70,120,210,.5)'; g.lineWidth = Math.max(0.6, B.s * 0.011);
          for (let k = 1; k < 7; k++) { const t = k / 7; const a = lerp(B, Tp, t), c = lerp(B, Fp, t); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
          if (it.side === 0) { g.strokeStyle = 'rgba(210,60,60,.65)'; const m1 = lerp(Tp, Fp, 0.25), m2 = lerp(B, Tp, 0.75); g.beginPath(); g.moveTo(m1.x, m1.y); g.lineTo(m2.x, m2.y); g.stroke(); }
          g.restore();
          g.strokeStyle = 'rgba(120,100,75,.45)'; g.lineWidth = Math.max(0.6, B.s * 0.006); g.stroke();
        } else { // the folded layers: fine lines along the edge, meeting at the corners
          const [a0, a1, a2, a3] = P, n = it.kind === 'strike' ? [0.22, 0.45, 0.68] : [0.4, 0.7];
          g.strokeStyle = it.kind === 'strike' ? 'rgba(125,105,75,.5)' : 'rgba(125,105,75,.35)'; g.lineWidth = Math.max(0.5, a0.s * 0.005);
          for (const f of n) { const p = lerp(a0, a3, f), q = lerp(a1, a2, f); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
        }
      }
    }
    function shadow(b) { // soft, and fainter and wider the higher the football is
      const p = proj(b.x, 0, b.z), r = 0.6 * p.s * (1 + b.y / 10), al = 0.5 * Math.max(0.15, 1 - b.y / 8);
      g.save(); g.translate(p.x, p.y); g.scale(1, 0.24); const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(15,6,1,${al})`); gr.addColorStop(1, 'rgba(15,6,1,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
    }
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
      g.strokeStyle = 'rgba(111,207,122,.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, b.sweetY - b.sweet); g.lineTo(x, b.sweetY + b.sweet); g.stroke();
      if (press) { const cy = b.y - press.contact * b.half, ok = Math.abs(cy - b.sweetY) <= b.sweet; g.fillStyle = ok ? 'rgba(111,207,122,.95)' : 'rgba(255,107,90,.95)'; g.beginPath(); g.arc(x, cy, 6, 0, Math.PI * 2); g.fill(); }
    }
    // ---------- the HUD: brass-and-iron scoreboards with flip digits (the factory's look) and a wind dial
    const DISP = 'Russo One, "Arial Black", system-ui, sans-serif';
    function plate(x, y, w, h) { // an iron panel in a brass bezel, four rivets
      const r = 8;
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect(x + 2, y + 3, w, h, r); g.fill();
      const br = g.createLinearGradient(x, y, x, y + h); br.addColorStop(0, '#f0c56a'); br.addColorStop(0.45, '#b98632'); br.addColorStop(1, '#6e4a17');
      g.fillStyle = br; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
      const fe = g.createLinearGradient(x, y, x, y + h); fe.addColorStop(0, '#2a221b'); fe.addColorStop(1, '#120d09');
      g.fillStyle = fe; g.beginPath(); g.roundRect(x + 3, y + 3, w - 6, h - 6, r - 3); g.fill();
      g.strokeStyle = 'rgba(255,220,160,.12)'; g.lineWidth = 1; g.beginPath(); g.roundRect(x + 3.5, y + 3.5, w - 7, h - 7, r - 3); g.stroke();
      for (const [rx, ry] of [[x + 7, y + 7], [x + w - 7, y + 7], [x + 7, y + h - 7], [x + w - 7, y + h - 7]]) {
        const rv = g.createRadialGradient(rx - 0.6, ry - 0.6, 0, rx, ry, 2.4); rv.addColorStop(0, '#ffe2a0'); rv.addColorStop(1, '#6e4a17'); g.fillStyle = rv; g.beginPath(); g.arc(rx, ry, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
    const flips = {}; // per board: the shown text and when it last changed, for the flip
    function flipText(id, x, y, text, h, tileW) { // split-flap tiles; a changed tile flips over (~0.25 s)
      const f = flips[id] || (flips[id] = { text, old: text, at: -9 });
      if (f.text !== text) { f.old = f.text; f.text = text; f.at = clock; }
      const t = Math.min(1, (clock - f.at) / 0.25), chars = [...text], olds = [...f.old.padStart(chars.length)];
      chars.forEach((ch, i) => {
        const tx = x + i * (tileW + 3);
        const tg = g.createLinearGradient(0, y, 0, y + h); tg.addColorStop(0, '#1b1612'); tg.addColorStop(0.5, '#0c0907'); tg.addColorStop(0.5, '#15110d'); tg.addColorStop(1, '#0a0806');
        g.fillStyle = tg; g.beginPath(); g.roundRect(tx, y, tileW, h, 3); g.fill();
        g.font = `400 ${h * 0.78}px ${DISP}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const draw = (c, clipTop, sy) => { g.save(); g.beginPath(); g.rect(tx, clipTop ? y : y + h / 2, tileW, h / 2); g.clip(); g.translate(tx + tileW / 2, y + h / 2); g.scale(1, sy); g.fillStyle = '#f6e8cf'; g.fillText(c, 0, h * 0.04); g.restore(); };
        const changed = olds[i] !== ch && t < 1;
        if (!changed) { draw(ch, true, 1); draw(ch, false, 1); }
        else if (t < 0.5) { draw(ch, true, 1); draw(olds[i], false, 1); draw(olds[i], true, 1 - t * 2); }
        else { draw(ch, true, 1); draw(olds[i], false, 1); draw(ch, false, (t - 0.5) * 2); }
        g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(tx, y + h / 2 - 0.5, tileW, 1);
        g.fillStyle = '#6e4a17'; g.fillRect(tx - 1, y + h / 2 - 1.5, 2, 3); g.fillRect(tx + tileW - 1, y + h / 2 - 1.5, 2, 3);
      });
      g.textBaseline = 'alphabetic';
    }
    function label(text, x, y, size, align = 'center') { g.font = `400 ${size}px ${DISP}`; g.textAlign = align; g.fillStyle = '#d9b26a'; g.fillText(text, x, y); }
    function windDial(cx, cy, r) { // like a TV broadcast's wind meter: an arrow showing which way it blows, mph in the middle
      const w = shot.wind, mph = Math.round(Math.abs(w)), col = mph < 3 ? '#6fcf7a' : mph < 6 ? '#ffd27a' : '#ff6b5a';
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(cx + 2, cy + 3, r, 0, Math.PI * 2); g.fill();
      const br = g.createLinearGradient(0, cy - r, 0, cy + r); br.addColorStop(0, '#f0c56a'); br.addColorStop(0.5, '#b98632'); br.addColorStop(1, '#6e4a17');
      g.fillStyle = br; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      const fc = g.createRadialGradient(cx, cy - r * 0.3, 0, cx, cy, r); fc.addColorStop(0, '#2c241c'); fc.addColorStop(1, '#0e0a07');
      g.fillStyle = fc; g.beginPath(); g.arc(cx, cy, r - 3.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(217,178,106,.55)'; g.lineWidth = 1;
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, l = i % 6 ? 3 : 6; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5)); g.lineTo(cx + Math.cos(a) * (r - 5 - l), cy + Math.sin(a) * (r - 5 - l)); g.stroke(); }
      if (mph) { // the arrow, swaying a little as it gusts
        const dir = Math.sign(w), a = (dir > 0 ? 0 : Math.PI) + Math.sin(clock * 2.3) * 0.06, L = r - 9;
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r - 7, -0.5, 0.5); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = col; g.beginPath(); g.moveTo(L, 0); g.lineTo(L - 9, -6); g.lineTo(L - 9, -2.2); g.lineTo(-L + 4, -2.2); g.lineTo(-L + 4, 2.2); g.lineTo(L - 9, 2.2); g.lineTo(L - 9, 6); g.closePath();
        g.shadowColor = col; g.shadowBlur = 6; g.fill(); g.restore();
      }
      g.fillStyle = 'rgba(14,10,7,.85)'; g.beginPath(); g.arc(cx, cy, r * 0.42, 0, Math.PI * 2); g.fill();
      g.textAlign = 'center'; g.fillStyle = mph ? '#f6e8cf' : '#9a8a70'; g.font = `400 ${r * 0.5}px ${DISP}`; g.fillText(mph ? String(mph) : '0', cx, cy + r * 0.17);
      label('MPH', cx, cy + r * 0.62, Math.max(8, r * 0.2)); label('WIND', cx, cy + r + 13, 11);
    }
    function hud() {
      const top = 10;
      windDial(12 + 32, top + 32, 32);
      // the streak board, centre: STREAK in flip digits, BEST under it
      const bw = 132, bh = 66, bx = W / 2 - bw / 2;
      plate(bx, top, bw, bh); label(streak || !best ? 'STREAK' : 'STREAK', W / 2, top + 17, 10);
      flipText('streak', W / 2 - 25, top + 22, String(Math.min(99, streak)).padStart(2, '0'), 30, 23);
      label(`BEST ${best}  ·  LV ${shot.level}`, W / 2, top + bh - 5, 9);
      // the distance plate, right
      const dw = 86, dx = W - 12 - dw;
      plate(dx, top, dw, 54); label('DISTANCE', dx + dw / 2, top + 17, 10);
      flipText('dist', dx + 14, top + 22, String(Math.round(shot.dist)).padStart(2, '0'), 24, 17);
      label('IN', dx + dw - 16, top + 41, 11);
      g.textAlign = 'center';
      if (shot.move && !ball) { g.font = `400 ${Math.max(12, H * 0.024)}px ${DISP}`; g.fillStyle = '#ffb07a'; g.fillText('MOVING POSTS · TIME IT', W / 2, top + bh + 18); }
      if (note && clock - note.at < 3.5 && !ball) { const nw = Math.min(W - 40, 280); plate(W / 2 - nw / 2, H * 0.17, nw, 34); g.font = `400 ${Math.max(11, H * 0.022)}px ${DISP}`; g.fillStyle = '#ffd27a'; g.textAlign = 'center'; g.fillText(note.text.toUpperCase(), W / 2, H * 0.17 + 22); }
      if (hint && !ball && !press) { g.font = `800 ${Math.max(12, H * 0.03)}px Nunito, system-ui, sans-serif`; g.fillStyle = 'rgba(0,0,0,.5)'; const tx = matchMedia('(pointer: fine)').matches ? 'Press on the paper, pull back, let go' : 'Touch the paper and flick up'; g.fillText(tx, W / 2 + 1, H - 13); g.fillStyle = 'rgba(246,232,207,.95)'; g.fillText(tx, W / 2, H - 14); }
    }
    // ---------- juice: chips and dust that fly off a hit, confetti at the big streaks, a comic burst behind POW
    const parts = [], confetti = [];
    function burst(kind, x, y, z) {
      if (kind === 'flame') { for (let i = 0; i < 4; i++) { const ember = i === 3; parts.push({ x: x + (Math.random() - 0.5) * 1.5, y: y + (Math.random() - 0.5) * 0.8, z, vx: (Math.random() - 0.5) * (ember ? 14 : 4), vy: (ember ? 30 : 14) + Math.random() * 20, vz: 0, life: (ember ? 1.1 : 0.8) + Math.random() * 0.4, age: 0, flame: true, ember, size: ember ? 0.12 : 0.5 + Math.random() * 0.5, rot: 0 }); } return; }
      const N = kind === 'dust' ? 10 : 16;
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, sp = (kind === 'dust' ? 8 : 25) * (0.4 + Math.random());
        const col = kind === 'chips' ? (i % 3 ? '#f1b51c' : '#3a3a40') : kind === 'plank' ? (i % 2 ? '#e8c84a' : '#f5f0e2') : 'rgba(230,200,160,.7)';
        parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: (kind === 'dust' ? 6 : 20) + Math.random() * 25, vz: Math.sin(a) * sp * 0.6 - (kind === 'plank' ? 15 : 0), life: 0.6 + Math.random() * 0.5, age: 0, col, size: kind === 'dust' ? 0.06 : 0.05 + Math.random() * 0.06, rot: Math.random() * 6 });
      }
    }
    function particles(dt, flames) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; if (!!p.flame !== flames) continue; p.age += dt; if (p.age > p.life) { parts.splice(i, 1); continue; }
        if (p.flame) { // fire off the burning football: rising, glowing, yellow to red to smoke
          p.x += p.vx * dt; p.y += p.vy * dt; const q = proj(p.x, p.y, p.z), t = p.age / p.life, r = Math.max(2, p.size * q.s * (1 + t));
          const col = p.ember ? `rgba(255,${Math.round(200 - t * 120)},80,${1 - t})` : t < 0.5 ? `rgba(255,${Math.round(220 - t * 260)},60,${0.9 - t})` : `rgba(90,80,75,${0.45 * (1 - t)})`;
          g.save(); g.globalCompositeOperation = t < 0.5 ? 'lighter' : 'source-over'; const gr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill(); g.restore();
          continue;
        }
        p.vy -= 160 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += dt * 12;
        if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
        const q = proj(p.x, p.y, p.z), s = Math.max(1.5, p.size * q.s);
        g.save(); g.globalAlpha = 1 - p.age / p.life; g.translate(q.x, q.y); g.rotate(p.rot); g.fillStyle = p.col; g.fillRect(-s / 2, -s / 3, s, s * 0.66); g.restore();
      }
    }
    function confettiBurst() {
      const cols = ['#ffd27a', '#ff6b5a', '#6fcf7a', '#6aa8ff', '#f5f0e2', '#ef8fa6'];
      for (let i = 0; i < 70; i++) confetti.push({ x: W * (0.2 + Math.random() * 0.6), y: -10 - Math.random() * H * 0.3, vx: (Math.random() - 0.5) * 120, vy: 60 + Math.random() * 120, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, col: cols[i % cols.length], age: 0 });
    }
    function drawConfetti(dt) {
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i]; c.age += dt; c.vy += 80 * dt; c.x += (c.vx + Math.sin(c.age * 5 + i) * 40) * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
        if (c.y > H + 20 || c.age > 4) { confetti.splice(i, 1); continue; }
        g.save(); g.translate(c.x, c.y); g.rotate(c.rot); g.fillStyle = c.col; g.fillRect(-4, -2.5 * Math.abs(Math.cos(c.age * 6 + i)), 8, 5 * Math.abs(Math.cos(c.age * 6 + i)) + 0.5); g.restore();
      }
    }
    function starPath(r, k = 12) { g.beginPath(); for (let i = 0; i < k * 2; i++) { const a = (i / (k * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.62 : r * (0.92 + 0.08 * Math.sin(i * 7)); i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); }
    function banners() {
      if (pop && clock - pop.at < 0.95) {
        const t = (clock - pop.at) / 0.95, sc = 0.6 + Math.min(1, t * 5) * 0.55 - t * 0.12, fsz = Math.max(26, Math.min(44, H * 0.07));
        g.save(); g.translate(W / 2, H * 0.21); g.scale(sc, sc); g.rotate(-0.06); g.globalAlpha = 1 - Math.max(0, t - 0.72) / 0.28;
        g.font = `400 ${fsz}px "Russo One", system-ui, sans-serif`; g.textAlign = 'center';
        const tw = g.measureText(pop.text).width;
        g.save(); g.scale(Math.max(1, (tw + 40) / (fsz * 2.6)), 1); starPath(fsz * 1.3); g.fillStyle = '#ff8a3a'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(40,14,2,.9)'; g.stroke(); starPath(fsz * 1.0); g.fillStyle = '#ffd27a'; g.fill(); g.restore();
        g.lineWidth = 6; g.strokeStyle = 'rgba(40,14,2,.9)'; g.strokeText(pop.text, 0, fsz * 0.35); g.fillStyle = '#fff6e0'; g.fillText(pop.text, 0, fsz * 0.35); g.restore();
      }
      if (result && result !== 'good' && clock - resultAt < 1.2) {
        const word = { short: 'Short', under: 'Under the bar', 'wide-left': 'Wide left', 'wide-right': 'Wide right', doink: 'Doink!' }[result];
        g.font = `700 ${Math.max(26, H * 0.065)}px ${HAND}`; g.textAlign = 'center';
        g.save(); g.translate(W / 2, H * 0.3); g.rotate(-0.04);
        g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(word, 0, 0); g.fillStyle = '#ff6b5a'; g.fillText(word, 0, 0); g.restore();
      }
    }

    let freeze = 0, wasThunk = false, lastStreak = 0;
    function frame(now) {
      if (!alive) return;
      const real = Math.min(0.05, (now - last) / 1000); last = now;
      if (freeze > 0) freeze -= real; // the hit-stop on Plank: the world holds for a beat
      const dt = freeze > 0 ? 0 : real * (ball ? T.slow : 1); clock += dt;
      if (ball) {
        ball.trail = [{ x: ball.x, y: ball.y, z: ball.z, pitch: ball.pitch, yaw: ball.yaw, roll: ball.roll, t: ball.t, wob: ball.wob }, ...(ball.trail || [])].slice(0, 3);
        let t = dt; while (t > 0) { const s = Math.min(t, 1 / 480); step(s); t -= s; }
        if (ball.thunked && !ball.thunkAt) ball.thunkAt = clock;
        if (ball.thunked && !wasThunk) { freeze = 0.07; burst('plank', ball.x, ball.y, ball.z); }
        wasThunk = !!ball.thunked;
      } else wasThunk = false;
      if (streak !== lastStreak) { if ([5, 10, 15, 20, 25].includes(streak)) confettiBurst(); lastStreak = streak; }
      if (ball?.burning && !ball.gone) { const age = clock - ball.burning; ball.char = Math.min(1, age / 0.9); if (Math.random() < 0.7) burst('flame', ball.x, ball.y, ball.z); if (age > 1.1) ball.gone = true; }
      if (result && clock - resultAt > (result === 'good' ? 1.4 : 1.5) && !(ball?.burning && !ball.gone)) { result = null; ball = null; n++; nextShot(); }
      // the view leans a little toward an off-centre goal, between shots only (fixed during the kick)
      if (!ball) { const want = W / 2 - Math.max(-0.15 * W, Math.min(0.15 * W, 0.5 * (proj(shot.offset, 0, TEE_Z + shot.dist).x - CX))); CX += (want - CX) * Math.min(1, real * 6); }
      const sh = shake > 0 ? (shake -= real * 30, Math.max(0, shake)) : 0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      g.save(); if (sh) g.translate((Math.sin(clock * 90) * sh), (Math.cos(clock * 70) * sh));
      backdrop();
      const D = TEE_Z + shot.dist, Pz = D + PLANK_BACK, t = clock - shot.t0;
      furnace(real); if (ball?.burning && !ball.gone) paper(ball); particles(dt, true); atmosphere(D, real);
      tape(D);
      // far to near: Plank, the goal, the football (wherever it is between them), with a soft trail in flight
      const bz = ball ? ball.z : TEE_Z, drawBall = () => {
        if (!ball || ball.gone || ball.burning) return; shadow(ball);
        (ball.trail || []).slice(1).forEach((p, i) => { g.globalAlpha = i ? 0.08 : 0.16; paper(p); }); g.globalAlpha = 1;
        paper(ball);
      };
      if (bz > Pz) { drawBall(); plank(); posts(t); }
      else if (bz > D) { plank(); drawBall(); posts(t); }
      else { plank(); posts(t); drawBall(); }
      particles(dt, false);
      if (!ball) { tee(); const rest = { x: 0, y: REST_Y, z: TEE_Z, pitch: 0, yaw: YAW0, roll: 0 }; shadow({ x: 0, y: 0, z: TEE_Z }); paper(rest); sweetMark(); }
      vignette();
      g.restore();
      hud(); banners(); drawConfetti(real);
      requestAnimationFrame(frame);
    }
    size(); CX = W / 2; addEventListener('resize', size); requestAnimationFrame(frame);

    // ---------- sound: made here (WebAudio), no files
    let ac = null;
    function buzz(kind) {
      const pat = { flick: 12, doink: [10, 40, 10], thunk: 35, good: [15, 50, 25], miss: 60, whoosh: [20, 30, 20, 30, 60] }[kind]; if (!pat) return;
      try { (opts.haptic || ((p) => navigator.vibrate?.(p)))(pat); } catch {}
    }
    function sfx(kind) {
      buzz(kind);
      if (opts.mute?.()) return;
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      const t = ac.currentTime, out = ac.createGain(); out.connect(ac.destination);
      const tone = (f, f2, dur, type = 'sine', vol = 0.3) => { const o = ac.createOscillator(), e = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur); e.gain.setValueAtTime(vol, t); e.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(e).connect(out); o.start(t); o.stop(t + dur); };
      const noise = (dur, vol, hp = 1500) => { const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = ac.createBufferSource(), f = ac.createBiquadFilter(), e = ac.createGain(); f.type = 'highpass'; f.frequency.value = hp; e.gain.value = vol; s.buffer = b; s.connect(f).connect(e).connect(out); s.start(t); };
      if (kind === 'flick') noise(0.04, 0.55, 3000);                        // the fingernail "tk"
      if (kind === 'tick') noise(0.03, 0.25, 1200);
      if (kind === 'good') { tone(520, 1040, 0.18, 'triangle', 0.22); setTimeout(() => sfx('pop2'), 90); }
      if (kind === 'pop2') tone(780, 1560, 0.16, 'triangle', 0.18);
      if (kind === 'whoosh') { noise(0.6, 0.35, 300); tone(90, 50, 0.6, 'sine', 0.3); } // the paper going up
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
