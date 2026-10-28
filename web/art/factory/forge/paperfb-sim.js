/* Omni Cardworks: Paper Football's deterministic sim (docs/paper-football.md, plan §4, §5, §8). The game's rules and
   physics, with no DOM: the shot for a seed and shot number, the input mapping (raw pointer samples to a kick), the
   launch, and the flight at fixed 1/480 s ticks. The browser game (paperfb.js) animates exactly these states, and the
   game server (web/api/games) replays a paid kick with the same code, so its verdict matches what the player saw.

   Deterministic across browsers and Node: fixed ticks, integer inputs, and only + - * / and Math.floor/min/max/abs/imul
   in the maths. No Math.random, exp, hypot, sqrt, sin, cos, tan or atan2 here: those can differ in the last bit
   between engines. The trig and the square root are our own (polynomials and Newton steps on plain arithmetic).

   Loaded as a classic script (sets globalThis.PaperFBSim, before paperfb.js) or from Node through paperfb-sim.mjs.
   Units: inches and seconds. A kick is { power 0..1, aim (radians), contact -1..1, sweetMin }. */
(function (root) {
  'use strict';
  const VERSION = 1;
  const HZ = 480, DT = 1 / HZ;

  // ---------- maths on plain arithmetic (identical bits in every engine)
  const PI = 3.141592653589793, TAU = 2 * PI, HALF_PI = PI / 2, INV_TAU = 1 / TAU;
  /** square root: scaled into [0.25, 4] by exact powers of 4, then fixed Newton steps */
  function sqrt(v) {
    if (!(v > 0)) return v === 0 ? 0 : NaN;
    if (v === Infinity) return v;
    let s = v, e = 1;
    while (s > 4) { s *= 0.25; e *= 2; }
    while (s < 0.25) { s *= 4; e *= 0.5; }
    let y = (1 + s) * 0.5;
    for (let i = 0; i < 7; i++) y = 0.5 * (y + s / y);
    return y * e;
  }
  const hypot = (a, b) => sqrt(a * a + b * b);
  /** sine: reduced to [-pi/2, pi/2], then its Taylor series to x^19 (error under 1e-13) */
  function sin(x) {
    let r = x - Math.floor(x * INV_TAU + 0.5) * TAU; // [-pi, pi]
    if (r > HALF_PI) r = PI - r; else if (r < -HALF_PI) r = -PI - r;
    const r2 = r * r;
    let p = -1 / 121645100408832000;
    p = p * r2 + 1 / 355687428096000; p = p * r2 - 1 / 1307674368000; p = p * r2 + 1 / 6227020800;
    p = p * r2 - 1 / 39916800; p = p * r2 + 1 / 362880; p = p * r2 - 1 / 5040; p = p * r2 + 1 / 120; p = p * r2 - 1 / 6;
    return r + r * r2 * p;
  }
  const cos = (x) => sin(x + HALF_PI);
  /** arctangent: folded into [0, 1], halved twice (to under tan(pi/16)), then its series to x^23 */
  function atan(x) {
    if (x !== x) return NaN;
    let sg = 1; if (x < 0) { x = -x; sg = -1; }
    let inv = false; if (x > 1) { x = 1 / x; inv = true; }
    x = x / (1 + sqrt(1 + x * x)); x = x / (1 + sqrt(1 + x * x));
    const x2 = x * x;
    let p = 0;
    for (let k = 23; k >= 3; k -= 2) p = (((k - 1) / 2) % 2 ? -1 : 1) / k + p * x2;
    let r = 4 * (x + x * x2 * p);
    if (inv) r = HALF_PI - r;
    return sg * r;
  }
  function atan2(y, x) {
    if (x > 0) return atan(y / x);
    if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
    return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- tuning (the owner's approved feel; the server always judges with DEFAULT_TUNING)
  const DEFAULT_TUNING = Object.freeze({
    slow: 0.45,        // flight time scale on screen (1 = real time; lower = slower to watch). View only.
    vMin: 45, vMax: 150, // launch speed (in/s) at power 0 and 1
    loft: 34,          // launch angle for a clean hit (degrees)
    loftHit: 24,       // loft gained per half-edge lower you hit (degrees): low pops it up, high flies flat
    sweetAt: -0.25,    // the clean spot: a little below the middle of the strike edge (share of half the edge)
    aimMax: 22,        // widest aim (degrees either side)
    flickFull: 2.6,    // flick speed (CSS px/ms) that gives full power (finger or mouse: one control everywhere)
    sweet: 0.22,       // the clean band around that spot (share of half the edge), at low power
    sweetPower: 0.5,   // how much the clean middle shrinks at full power (share)
    offPenalty: 0.3,   // speed lost at the very end of the edge (share)
    drift: 30,         // sideways drift of a mishit at full power (in/s² at the end of the edge)
    windK: 7,          // sideways push per mph (in/s²)
    ramp: 0.07,        // difficulty budget added per level (distance and movement share it)
    curve: 0.0035,     // ...plus this times level²: gentle early, steep late
    start: 0.12,       // difficulty budget at level 0 (1 = a 40 in kick, or a 3 in swing at 12 in)
  });

  // ---------- the world
  const G = 386;                       // gravity, in/s²
  // the goal: pencils sized like the finger goal, taller (full-length pencils) so a make reads at a glance
  const BAR = 2.5, POST_H = 7.5, PEN_R = 0.14, BLOCK_H = 0.9, PLANK_BACK = 4.5, PLANK_H = 6.8, PLANK_W = 2.2;
  const TEE_Z = 0, TEE_Y = 0.22, BALL_R = 0.2;
  // the bench's far end and the furnace behind it (MOUTH is the default door; the browser refits it to its painted plate)
  const TABLE_END = 44, FURN_Z = 46, FURN_W = 26, MOUTH = Object.freeze({ x: 6.5, y0: 1, y1: 9 });
  // the football: a right isosceles triangle flag-folded from a notebook strip. Long edge 1.6 in (toward the kicker,
  // nearly upright), short edges 1.13 in, the right angle at the front point. (z, y) about its centroid.
  const TRI = (() => {
    const L = 1.6, lean = 0.1;
    const b = [0, 0], t = [sin(lean) * L, cos(lean) * L];
    const m = [(b[0] + t[0]) / 2, (b[1] + t[1]) / 2], n = [cos(lean), -sin(lean)];
    const f = [m[0] + n[0] * L / 2, m[1] + n[1] * L / 2];
    const c = [(b[0] + t[0] + f[0]) / 3, (b[1] + t[1] + f[1]) / 3];
    return [b, t, f].map((p) => [p[0] - c[0], p[1] - c[1]]);
  })();
  const EDGE_MID = [(TRI[0][0] + TRI[1][0]) / 2, (TRI[0][1] + TRI[1][1]) / 2], EDGE_HALF = 0.8;
  const REST_Y = TEE_Y - TRI[0][1], YAW0 = 0.22, YAW_FLY = 0.45;
  // the camera (paperfb.js draws with it; the input mapping needs its scale at the strike edge)
  const CAM_DB = 4.0, TAN18 = 0.3249196962329063, TAN6 = 0.10510423526567646;

  // ---------- a small seeded random stream (mulberry32): a shot's conditions are a function of (seed, shot number)
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // the shot at a level (owner, Oct 27): difficulty is a trade between DISTANCE and MOVEMENT. A level's budget is spent
  // on the two together, so a short kick at a swinging goal is as hard as a long kick at a still one. A 40 in kick
  // counts the same as a 0.75 car (a 3 in swing): an average player makes each about half the time (measured with
  // the sim and a wobbly-thumb player model). The budget grows slowly, then faster: past 1 both have to rise, and the
  // last stretch is long kicks at fast, wide swings. Wind and a narrower gap come in late, as spice.
  const LEVEL_NAMES = Object.freeze({ 1: 'Over here: the goal moves off centre', 8: "Fan's on: wind", 12: 'Squeeze it: the gap closes' });
  const MOVE_PER_DIST = 0.75, MOVE_MAX = 1.5;
  function shotFor(seed, n, level, T) {
    T = T || DEFAULT_TUNING;
    const r = rng(seed * 7919 + n * 104729 + 13);
    const budget = T.start + level * T.ramp + T.curve * level * level;
    // how much of the budget goes to movement: anywhere the caps allow, chosen by the shot's seed
    const moveCap = Math.min(MOVE_MAX / MOVE_PER_DIST, 1 + 0.06 * level); // movement can outgrow distance late on
    const lo = Math.max(0, budget - 1), hi = Math.min(budget, moveCap);
    const uMove = lo >= hi ? hi : lo + (hi - lo) * r(), uDist = Math.min(1, budget - uMove);
    const car = uMove * MOVE_PER_DIST;
    const side = () => (r() < 0.5 ? -1 : 1);
    const spice = (from, per) => Math.min(1, Math.max(0, (level - from + 1) * per)) * (0.5 + 0.5 * r());
    const off = level >= 1 ? Math.min(0.6, 0.06 * level) * r() : 0, wind = level >= 8 ? spice(8, 0.07) : 0, gap = level >= 12 ? spice(12, 0.08) : 0;
    const dist = 12 + uDist * 28;                              // 12..40 in
    return {
      level, dist,
      wind: side() * wind * 9 || 0,                            // ±9 mph (|| 0: never -0)
      half: Math.max(1.2, 2.5 - gap * 1.1),                    // half the clear gap: 5.0 in .. 2.8 in
      offset: side() * off * TAN6 * (dist + 4) || 0,           // within a 6° turn of the head
      move: car > 0.02 ? { amp: car * 4, speed: 0.6 + car * 1.4, phase: r() * PI * 2 } : null,
      drift: side(),                                           // which way a mishit drifts this shot
      unlock: LEVEL_NAMES[level] || null,
    };
  }
  /** where Plank stands: 4.5 in behind the posts, tucked in front of the bench's far edge on the longest kicks */
  const plankZ = (s) => Math.min(TEE_Z + s.dist + PLANK_BACK, TABLE_END - 0.3);
  /** where the posts stand t seconds (game time) after the shot was shown */
  const postX = (s, t) => s.offset + (s.move ? sin(s.move.phase + t * s.move.speed * PI) * s.move.amp : 0);

  // ---------- the kick: launch velocity and spin from { power, aim, contact }
  function launch(k, T, s) {
    T = T || DEFAULT_TUNING;
    const p = clamp(+k.power || 0, 0, 1), c = clamp(+k.contact || 0, -1, 1);
    // the clean band sits a little below the middle (it gets the football up); it shrinks the harder you kick, but
    // never below the band the player could see (k.sweetMin, ~7 mm on screen)
    const sweet = Math.max(k.sweetMin || 0, T.sweet * (1 - T.sweetPower * p)), miss = Math.abs(c - T.sweetAt), clean = miss <= sweet;
    const off = clean ? 0 : Math.min(1, (miss - sweet) / (1 - sweet)); // 0 at the clean band's edge .. 1 at the end
    const v = (T.vMin + (T.vMax - T.vMin) * p) * (1 - T.offPenalty * off * off);
    const th = (T.loft - (c - T.sweetAt) * T.loftHit) * PI / 180; // below the middle pops it up; dead centre and higher fly flat
    const aimMax = T.aimMax * PI / 180, aim = clamp(+k.aim || 0, -aimMax, aimMax);
    const ct = cos(th);
    return {
      x: 0, y: REST_Y, z: TEE_Z,
      vx: v * ct * sin(aim), vy: v * sin(th), vz: v * ct * cos(aim),
      ax: ((s && s.drift) || 1) * off * T.drift * p * p,      // a mishit drifts, more the harder it's hit
      lift: c < T.sweetAt ? (T.sweetAt - c) * 60 : 0,         // a low hit's backspin floats it a little
      pitch: 0, pitchRate: -(10 + 14 * p) * (1 - 0.4 * off) * (c > T.sweetAt + sweet ? 0.5 : 1), // end over end; a high hit knuckles
      wob: off, roll: 0, yaw: YAW0, yawTo: (aim < 0 ? -1 : 1) * YAW_FLY, t: 0, clean,
    };
  }

  // ---------- the flight: the football hits the pencils, the bar, the block, Plank and the table; nothing passes through.
  // A flight is stepped one tick (1/480 s of game time) at a time. Each step returns what happened in it (for sounds
  // and sparks). Its time on the moving posts' clock is kickTick + ticks flown.
  const HOLD = { good: 1.4 * HZ, miss: 1.5 * HZ }; // ticks the result shows before the next shot (the browser's beat)
  function createFlight(shot, k, T, o) {
    T = T || DEFAULT_TUNING; o = o || {};
    const b = launch(k, T, shot);
    b.wobPhase = o.wobPhase == null ? 1 : o.wobPhase;
    const mouth = o.mouth || MOUTH, kickTick = Math.max(0, Math.floor(o.kickTick || 0));
    const D = TEE_Z + shot.dist, P = plankZ(shot), wind = shot.wind * T.windK;
    const f = { ball: b, tick: 0, kickTick, result: null, resultTick: -1, furnace: false, done: false, step };
    // bounce off a surface with outward normal (nx, ny, nz): keep the slide, lose most of the push
    function bounce(nx, ny, nz, e, fr) {
      if (e == null) e = 0.35; if (fr == null) fr = 0.7;
      const vn = b.vx * nx + b.vy * ny + b.vz * nz; if (vn >= 0) return false;
      b.vx = (b.vx - vn * nx) * fr - e * vn * nx; b.vy = (b.vy - vn * ny) * fr - e * vn * ny; b.vz = (b.vz - vn * nz) * fr - e * vn * nz;
      b.pitchRate *= -0.6; b.wob = Math.min(1, b.wob + 0.5); return true;
    }
    function settle(ev, r) { if (f.result) return; f.result = r; f.resultTick = f.tick; ev.push({ type: 'result', result: r }); }
    function step() {
      const ev = [];
      f.tick++;
      if (f.result && f.tick - f.resultTick >= (f.result === 'good' ? HOLD.good : HOLD.miss)) f.done = true;
      b.t = f.tick * DT;
      if (b.burning || b.gone) return ev;
      const dt = DT, z0 = b.z;
      b.vx += (b.ax + wind) * dt; b.vy -= (G - b.lift * Math.max(0, b.vy) / 100) * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.pitch += b.pitchRate * dt;
      b.yaw += (b.yawTo + sin(b.t * 6.5) * 0.9 * b.wob - b.yaw) * Math.min(1, dt / 0.06);
      b.roll = sin(b.t * 9 + b.wobPhase) * 0.8 * b.wob;
      const px = postX(shot, (kickTick + f.tick) * DT);
      // the pencils: upright cylinders standing in the block
      for (const s of [-1, 1]) {
        const cx = px + s * (shot.half + PEN_R), dx = b.x - cx, dz = b.z - D, d = hypot(dx, dz);
        if (d < PEN_R + BALL_R && b.y > BLOCK_H - BALL_R && b.y < POST_H + BALL_R) {
          const nx = dx / (d || 1), nz = dz / (d || 1); b.x = cx + nx * (PEN_R + BALL_R); b.z = D + nz * (PEN_R + BALL_R);
          if (bounce(nx, 0, nz, 0.45)) { b.doinked = true; ev.push({ type: 'doink' }); }
        }
      }
      // the crossbar: a pencil lying across between the uprights
      if (Math.abs(b.x - px) < shot.half + PEN_R) {
        const dy = b.y - BAR, dz = b.z - D, d = hypot(dy, dz);
        if (d < PEN_R + BALL_R) {
          const ny = dy / (d || 1), nz = dz / (d || 1); b.y = BAR + ny * (PEN_R + BALL_R); b.z = D + nz * (PEN_R + BALL_R);
          if (bounce(0, ny, nz, 0.4)) { b.doinked = true; ev.push({ type: 'doink' }); }
        }
      }
      // the oak block (or the RC car) the pencils stand in
      const bw = shot.half + PEN_R * 2 + 0.6;
      if (b.y - BALL_R < BLOCK_H && Math.abs(b.x - px) < bw && b.z + BALL_R > D - 0.45 && z0 + BALL_R <= D - 0.45) { b.z = D - 0.45 - BALL_R; bounce(0, 0, -1, 0.3); ev.push({ type: 'block' }); }
      // judged where the football's centre crosses the goal's plane: between the uprights and over the bar is good
      if (!f.result && z0 < D && b.z >= D) {
        const inside = Math.abs(b.x - px) < shot.half;
        settle(ev, inside && b.y >= BAR ? 'good' : inside ? 'under' : b.x < px ? 'wide-left' : 'wide-right');
      }
      // Plank, just behind the goal: a make bounces off his face
      const pc = shot.offset;
      if (!b.thunked && z0 < P && b.z >= P && Math.abs(b.x - pc) < PLANK_W && b.y < PLANK_H) {
        b.thunked = true; b.z = P; bounce(0, 0, -1, 0.32, 0.5); b.vy = Math.max(b.vy, 30); ev.push({ type: 'plank' });
      }
      if (!b.thunked && !b.passed && z0 < P && b.z >= P) { b.passed = true; ev.push({ type: 'pass', near: Math.abs(b.x - pc) < PLANK_W + 3 }); } // whizzing past or over him
      // the furnace: through the open door it burns; the iron front stops it
      if (z0 < FURN_Z && b.z >= FURN_Z) {
        if (Math.abs(b.x) < mouth.x && b.y > mouth.y0 && b.y < mouth.y1) { b.burning = true; b.z = FURN_Z + 1.2; f.furnace = true; ev.push({ type: 'furnace' }); return ev; }
        if (Math.abs(b.x) < FURN_W / 2 && b.y > -6) { b.z = FURN_Z; bounce(0, 0, -1, 0.3); ev.push({ type: 'front' }); }
      }
      if (b.y < -8) { b.gone = true; ev.push({ type: 'gone' }); return ev; } // off the end of the bench
      // the table
      if (b.y <= 0.05 && b.vy < 0 && b.z < TABLE_END) {
        if (!f.result && b.z < D) settle(ev, b.doinked ? 'doink' : 'short');
        b.y = 0.05; b.vy *= -0.25; b.vz *= 0.55; b.vx *= 0.55; b.pitchRate *= 0.5; b.wob *= 0.5; if (Math.abs(b.vy) < 8) b.vy = 0;
        if (!b.landed) { b.landed = true; ev.push({ type: 'land' }); }
      }
      if (!f.result && b.vz < 0 && b.z < D - 1) settle(ev, b.doinked ? 'doink' : 'short'); // knocked back off the goal
      return ev;
    }
    return f;
  }

  const MAX_TICKS = 30 * HZ;
  /** The whole kick, start to finish: steps until the result has had its beat (or the football burns or falls off the
   *  bench). opts: { kickTick (ticks since the shot was shown), frames (true or every-n-ticks), mouth, wobPhase }.
   *  Returns { result, doinked, thunked, furnace, resultTick, ticks, frames? }. */
  function simulate(shot, kick, T, opts) {
    opts = opts || {};
    const f = createFlight(shot, kick, T, opts), b = f.ball, every = opts.frames === true ? 1 : Math.max(0, opts.frames | 0);
    const frames = every ? [snap(f)] : null;
    while (!f.done && f.tick < MAX_TICKS) {
      f.step();
      if (frames && f.tick % every === 0) frames.push(snap(f));
      if (f.result && (b.burning || b.gone)) break;
    }
    const out = { result: f.result || 'short', doinked: !!b.doinked, thunked: !!b.thunked, furnace: f.furnace, resultTick: f.resultTick, ticks: f.tick };
    if (frames) out.frames = frames;
    return out;
  }
  const snap = (f) => { const b = f.ball; return { tick: f.tick, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, pitch: b.pitch, yaw: b.yaw, roll: b.roll, wob: b.wob }; };

  // ---------- input: raw pointer samples to a kick { power, aim, contact }. Phones and desktops both flick: the old
  // desktop pull-back (power from its length, aim held steady) was much easier than a flick, so it's gone.
  // An input is integers only: { kind: 'flick', stage: { w, h } (CSS px), edge: { x, y } (the strike edge's
  // middle on screen, 1/8 CSS px), start: [x, y, t] (the press), samples: [[x, y, t], ...] (the press's last points,
  // up to 48, ending with the release) }, x and y in 1/8 CSS px and t in 1/16 ms. Stage sizes match the canvas.
  const Q_XY = 8, Q_T = 16, MAX_SAMPLES = 64;
  const quantize = (x, y, t) => [Math.round(x * Q_XY), Math.round(y * Q_XY), Math.round(t * Q_T)];
  /** the stage's camera scale at the strike edge (CSS px per inch) and the edge's half length in px */
  function edgeScale(stage) {
    const W = Math.max(280, stage.w), H = Math.max(240, stage.h);
    const F = Math.min(0.85 * H, (W / 2 - 16) / TAN18);
    const s = F / Math.max(0.5, EDGE_MID[0] * cos(YAW0) - TEE_Z + CAM_DB);
    return { W, H, s, half: EDGE_HALF * s };
  }
  /** where the press counts as on the paper (the browser's own test, from the edge's screen point) */
  const onPaper = (sc, dx, dy) => Math.abs(dx) <= Math.max(44, sc.s * 0.45) && Math.abs(dy) <= sc.half * 1.15;
  // the swipe's speed over its last ~90 ms, by least squares (steadier than first-to-last), in px/ms
  function velocity(pts) {
    const end = pts[pts.length - 1][2] / Q_T, use = pts.filter((q) => end - q[2] / Q_T <= 90);
    if (use.length < 2) return null;
    let mt = 0, mx = 0, my = 0;
    for (const q of use) { mt += q[2] / Q_T; mx += q[0] / Q_XY; my += q[1] / Q_XY; }
    mt /= use.length; mx /= use.length; my /= use.length;
    let tt = 0, tx = 0, ty = 0; for (const q of use) { const d = q[2] / Q_T - mt; tt += d * d; tx += d * (q[0] / Q_XY - mx); ty += d * (q[1] / Q_XY - my); }
    if (tt < 1) return null;
    return { vx: tx / tt, vy: ty / tt };
  }
  /** raw input to a kick: { kick } or { none: why } (no kick: too slow, too short, or not on the paper) */
  function kickFromInput(input, T) {
    T = T || DEFAULT_TUNING;
    const sc = edgeScale(input.stage), st = input.start, pts = input.samples;
    const ex = input.edge.x / Q_XY, ey = input.edge.y / Q_XY, sx = st[0] / Q_XY, sy = st[1] / Q_XY;
    if (!onPaper(sc, sx - ex, sy - ey)) return { none: 'off-paper' };
    const contact = clamp((ey - sy) / sc.half, -1, 1), sweetMin = 22.5 / sc.half; // up the edge = +
    if (input.kind !== 'flick') return { none: 'kind' };
    // flick up: a fast snap kicks, a slow push does nothing; the slant is the aim
    const v = velocity(pts); if (!v || v.vy > -0.25) return { none: 'flick' };
    const power = Math.min(1, -v.vy / T.flickFull), aim = atan2(v.vx, -v.vy);
    return { kick: { power, aim, contact, sweetMin } };
  }
  const isInt = (v) => Number.isSafeInteger(v);
  const isPt = (p) => Array.isArray(p) && p.length === 3 && p.every(isInt);
  /** The server's sanity check of an input (shape and plausibility, not skill): null if fine, else why not. Lenient by
   *  design: a rejected kick isn't a miss, the player just kicks again. */
  function checkInput(input) {
    if (!input || typeof input !== 'object') return 'no input';
    if (input.kind !== 'flick') return 'kind';
    const sg = input.stage, e = input.edge, st = input.start, pts = input.samples;
    if (!sg || !isInt(sg.w) || !isInt(sg.h) || sg.w < 200 || sg.h < 200 || sg.w > 6000 || sg.h > 6000) return 'stage';
    if (!e || !isInt(e.x) || !isInt(e.y) || e.x < 0 || e.y < 0 || e.x > sg.w * Q_XY || e.y > sg.h * Q_XY) return 'edge';
    if (!isPt(st) || !Array.isArray(pts) || pts.length < 2 || pts.length > MAX_SAMPLES || !pts.every(isPt)) return 'samples';
    let t = st[2];
    for (const q of pts) { if (q[2] < t) return 'time order'; t = q[2]; }
    const dur = (pts[pts.length - 1][2] - st[2]) / Q_T;
    if (dur < 8) return 'too quick';
    if (dur > 10000) return 'too long';
    // nothing moves faster than a real finger or mouse (20 px/ms between samples is a teleport)
    let prev = st;
    for (const q of pts) {
      const dtm = (q[2] - prev[2]) / Q_T, d = hypot((q[0] - prev[0]) / Q_XY, (q[1] - prev[1]) / Q_XY);
      if (d > 20 * Math.max(dtm, 1)) return 'too fast';
      prev = q;
    }
    if (pts.length < 3) return 'samples';
    return null;
  }

  root.PaperFBSim = Object.freeze({
    VERSION, HZ, DT, DEFAULT_TUNING,
    math: Object.freeze({ PI, sqrt, hypot, sin, cos, atan, atan2, clamp }),
    world: Object.freeze({ G, BAR, POST_H, PEN_R, BLOCK_H, PLANK_BACK, PLANK_H, PLANK_W, TEE_Z, TEE_Y, BALL_R, TABLE_END, FURN_Z, FURN_W, MOUTH, TRI, EDGE_MID, EDGE_HALF, REST_Y, YAW0, YAW_FLY, CAM_DB, TAN18 }),
    LEVEL_NAMES, Q_XY, Q_T, MAX_SAMPLES,
    rng, shotFor, postX, plankZ, launch, createFlight, simulate,
    quantize, edgeScale, onPaper, velocity, kickFromInput, checkInput,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
