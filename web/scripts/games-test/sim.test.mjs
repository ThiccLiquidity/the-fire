// Paper football's deterministic sim (web/art/factory/forge/paperfb-sim.js): its maths, golden results, and the input
// mapping for the flick (phone and desktop alike). Run: npm run test:games (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import S from '../../art/factory/forge/paperfb-sim.mjs';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

test('own trig and sqrt track Math to ~1e-13', () => {
  const { sin, cos, atan2, sqrt } = S.math;
  for (let i = -2000; i <= 2000; i++) {
    const x = i * 0.0517;
    assert.ok(Math.abs(sin(x) - Math.sin(x)) < 1e-13, `sin ${x}`);
    assert.ok(Math.abs(cos(x) - Math.cos(x)) < 1e-13, `cos ${x}`);
    assert.ok(Math.abs(atan2(Math.sin(x), Math.cos(x) + 0.3) - Math.atan2(Math.sin(x), Math.cos(x) + 0.3)) < 1e-14, `atan2 ${x}`);
    const v = Math.exp(i / 100);
    assert.ok(Math.abs(sqrt(v) / Math.sqrt(v) - 1) < 1e-15, `sqrt ${v}`);
  }
  assert.equal(sqrt(0), 0);
  assert.equal(atan2(0, 0), 0);
});

test('the sim source uses no engine-dependent maths', () => {
  const src = readFileSync(new URL('../../art/factory/forge/paperfb-sim.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const f of ['random', 'exp', 'hypot', 'sqrt', 'sin', 'cos', 'tan', 'atan', 'atan2', 'pow', 'log', 'cbrt']) assert.ok(!new RegExp(`Math\\.${f}\\b`).test(src), `Math.${f} in the sim`);
  assert.ok(!/\*\*/.test(src), 'no ** in the sim');
});

test('golden kicks give their recorded results', () => {
  assert.ok(golden.length >= 25);
  const seen = new Set();
  for (const g of golden) {
    const r = S.simulate(S.shotFor(g.seed, g.n, g.level), g.kick, S.DEFAULT_TUNING, { kickTick: g.kickTick });
    assert.deepEqual({ result: r.result, doinked: r.doinked, thunked: r.thunked, furnace: r.furnace, resultTick: r.resultTick },
      { result: g.result, doinked: g.doinked, thunked: g.thunked, furnace: g.furnace, resultTick: g.resultTick }, JSON.stringify(g));
    seen.add(g.result);
  }
  for (const r of ['good', 'wide-left', 'wide-right', 'short', 'under', 'doink']) assert.ok(seen.has(r), `golden covers ${r}`);
  assert.ok(golden.some((g) => g.furnace) && golden.some((g) => g.thunked) && golden.some((g) => g.result === 'good' && g.doinked));
});

test('simulate is repeatable and its frames are the flight', () => {
  const shot = S.shotFor(42, 3, 6), k = { power: 0.62, aim: 0.04, contact: -0.2, sweetMin: 0.1 };
  const a = S.simulate(shot, k, undefined, { kickTick: 777, frames: true }), b = S.simulate(shot, k, undefined, { kickTick: 777, frames: true });
  assert.deepEqual(a, b);
  assert.equal(a.frames.length, a.ticks + 1);
  assert.equal(a.frames[0].z, 0);
  // the stepper and simulate agree tick for tick
  const f = S.createFlight(shot, k, undefined, { kickTick: 777 });
  for (let i = 1; i <= 200; i++) { f.step(); assert.equal(f.ball.z, a.frames[i].z); assert.equal(f.ball.x, a.frames[i].x); }
});

test('shots are a pure function of (seed, n, level)', () => {
  assert.deepEqual(S.shotFor(9, 2, 7), S.shotFor(9, 2, 7));
  assert.notDeepEqual(S.shotFor(9, 2, 7), S.shotFor(9, 3, 7));
  const at = (lv, k = 200) => Array.from({ length: k }, (_, n) => S.shotFor(5, n, lv));
  for (const s of at(0)) assert.ok(s.dist >= 12 && s.dist <= 40 && s.wind === 0 && s.offset === 0 && s.half === 2.5 && !s.move, 'level 0: distance only');
  assert.ok(new Set(at(0).map((s) => Math.round(s.dist * 10))).size > 5, 'level 0 kicks are not all the same length');
  // the order things come in (owner, Oct 28): distance, then wind at level 2, then moving posts at level 6
  assert.ok(at(1).every((s) => s.wind === 0 && !s.move));
  assert.ok(at(2).some((s) => s.wind !== 0) && at(2).every((s) => !s.move), 'level 2: wind, no movement yet');
  assert.ok(at(5).every((s) => !s.move));
  assert.ok(at(6).some((s) => s.move), 'level 6: moving posts');
  assert.equal(S.LEVEL_NAMES[2], "Fan's on: wind"); assert.ok(S.LEVEL_NAMES[6]);
  assert.equal(S.shotFor(5, 0, 2).unlock, S.LEVEL_NAMES[2]);
  // every kick spends the level's budget (give or take 15%) unless every factor is at its cap
  const C = S.COSTS, T = S.DEFAULT_TUNING;
  const cost = (x) => (x.dist - 12) / C.DIST_PER + Math.abs(x.wind) / C.WIND_PER + (x.move ? x.move.amp / 4 / C.MOVE_PER : 0);
  for (const lv of [0, 3, 7, 10, 14]) {
    const b = T.start + lv * T.ramp + T.curve * lv * lv;
    for (const x of at(lv)) {
      const capped = x.dist >= 39.99 && (lv < C.WIND_FROM || Math.abs(x.wind) >= C.WIND_MAX - 1e-9) && (lv < C.MOVE_FROM || (x.move && x.move.amp >= C.MOVE_MAX * 4 - 1e-9));
      const c = cost(x); // (a wind under 0.5 mph is dropped: the 0.04 slack)
      assert.ok(capped || (c > 0.85 * b - 0.04 && c < 1.15 * b + 1e-9), `level ${lv}: cost ${c} vs budget ${b}`);
    }
  }
  // a random mix per kick, not everything harder at once: at level 10 some kicks lean on each factor
  const l10 = at(10);
  assert.ok(l10.some((x) => x.dist > 32 && Math.abs(x.wind) < 4), 'long, little wind');
  assert.ok(l10.some((x) => Math.abs(x.wind) >= 7 && x.dist < 26), 'windy, shorter');
  assert.ok(l10.some((x) => x.move && x.move.amp > 1.8 * 4 * 0.5 && x.dist < 26), 'swinging, shorter');
  // late on: near the caps, with wind and a narrower gap
  const late = at(20, 100);
  assert.ok(late.filter((x) => x.dist > 37).length > 70 && late.filter((x) => x.move && x.move.amp > 3).length > 80, 'level 20: mostly far and swinging');
  assert.ok(late.some((x) => x.wind !== 0) && late.some((x) => x.half < 2.5));
  // practice shots (n < 0) are their own stream
  assert.notDeepEqual(S.shotFor(9, -1, 3), S.shotFor(9, 1, 3));
});

test('the football touches a pencil within BALL_R of it (a 1.6 in triangle, not a dot)', () => {
  assert.ok(S.world.BALL_R >= 0.3);
  const shot = { level: 0, dist: 20, wind: 0, half: 2.5, offset: 0, move: null, drift: 1 };
  // aim so the football's centre passes ~0.25 in outside the right pencil's surface, chest high: it must doink
  const post = shot.half + S.world.PEN_R, gap = S.world.PEN_R + 0.25;
  let hit = 0;
  for (let a = -0.1; a <= 0.25; a += 0.0025) {
    const k = { power: 0.45, aim: a, contact: -0.25, sweetMin: 0.2 }, f = S.createFlight(shot, k);
    let x = null; for (let i = 0; i < 2000 && x === null; i++) { const z0 = f.ball.z; f.step(); if (z0 < shot.dist - 0.6 && f.ball.z >= shot.dist - 0.6) x = f.ball.x + (shot.dist - f.ball.z) * f.ball.vx / f.ball.vz; } // where it would cross the pencils' line
    if (x !== null && Math.abs(x - (post + gap)) < 0.03) { hit++; assert.ok(S.simulate(shot, k).doinked, `passes ${gap} from the pencil's axis: a doink`); }
  }
  assert.ok(hit > 0, 'found a grazing kick');
});

// ---------- input mapping
const stage = { w: 390, h: 700 }, sc = S.edgeScale(stage), Q = S.Q_XY, QT = S.Q_T;
const edge = { x: 195 * Q, y: 600 * Q };
const P = (x, y, t) => S.quantize(x, y, t);
/** a straight flick from (x0, y0): velocity (vx, vy) px/ms for ms milliseconds, a sample every 8 ms */
function flick(x0, y0, vx, vy, ms = 64) {
  const samples = [];
  for (let t = 0; t <= ms; t += 8) samples.push(P(x0 + vx * t, y0 + vy * t, t));
  return { kind: 'flick', stage, edge, start: samples[0], samples };
}
function pull(x0, y0, dx, dy, ms = 400) {
  const samples = [P(x0, y0, 0)];
  for (let i = 1; i <= 10; i++) samples.push(P(x0 + dx * i / 10, y0 + dy * i / 10, ms * i / 10));
  return { kind: 'pull', stage, edge, start: samples[0], samples };
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('flick: speed is power, slant is aim, where you touch is contact', () => {
  let m = S.kickFromInput(flick(195, 600, 0, -1.3));
  near(m.kick.power, 0.5, 1e-3); near(m.kick.aim, 0); near(m.kick.contact, 0);
  near(m.kick.sweetMin, 22.5 / sc.half);
  m = S.kickFromInput(flick(195, 600, 0, -5)); near(m.kick.power, 1); // capped
  m = S.kickFromInput(flick(195, 600, 0.13, -1.3)); near(m.kick.aim, Math.atan(0.1), 2e-3);
  m = S.kickFromInput(flick(195, 600, -0.13, -1.3)); near(m.kick.aim, -Math.atan(0.1), 2e-3);
  m = S.kickFromInput(flick(195, 600 - sc.half / 2, 0, -1.3)); near(m.kick.contact, 0.5, 1e-3); // touched half way up the edge
  m = S.kickFromInput(flick(195, 600 + sc.half * 3, 0, -1.3)); assert.equal(m.none, 'off-paper');
  assert.equal(S.kickFromInput(flick(195, 600, 0, -0.2)).none, 'flick'); // too slow: a push, not a flick
  assert.equal(S.kickFromInput(flick(195, 600, 0, 1.3)).none, 'flick');  // downward
});

test('the old desktop pull-back is gone: one control everywhere', () => {
  assert.equal(S.kickFromInput(pull(195, 600, 0, 0.19 * stage.h)).none, 'kind');
  assert.equal(S.checkInput(pull(195, 600, 0, 0.19 * stage.h)), 'kind');
});

test('checkInput: shape and plausibility', () => {
  assert.equal(S.checkInput(flick(195, 600, 0, -1.3)), null);
  const f = flick(195, 600, 0, -1.3);
  assert.equal(S.checkInput({ ...f, kind: 'tap' }), 'kind');
  assert.equal(S.checkInput({ ...f, stage: { w: 10, h: 10 } }), 'stage');
  assert.equal(S.checkInput({ ...f, samples: f.samples.map((q) => [q[0] + 0.5, q[1], q[2]]) }), 'samples');
  assert.equal(S.checkInput({ ...f, samples: [...f.samples].reverse() }), 'time order');
  assert.equal(S.checkInput({ ...f, samples: [f.samples[0], [f.samples[0][0], f.samples[0][1] - 400 * Q, 4 * QT]] }), 'too quick');
  assert.equal(S.checkInput({ ...f, samples: [...f.samples.slice(0, -1), [f.samples[0][0], 0, f.samples.at(-1)[2]]] }), 'too fast');
  assert.equal(S.checkInput({ ...f, samples: Array(65).fill(f.samples[0]) }), 'samples');
});
