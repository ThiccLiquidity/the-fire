// Paper football's deterministic sim (web/art/factory/forge/paperfb-sim.js): its maths, golden results, and the input
// mapping for the phone flick and the desktop pull. Run: npm run test:games (from web/).
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
  const s = S.shotFor(123, 0, 0);
  assert.ok(s.dist >= 12 && s.dist <= 40 && s.wind === 0 && s.offset === 0 && s.half === 2.5, 'level 0: no wind, no offset, the full gap');
  assert.ok(!s.move || s.move.amp < 1, 'level 0: at most a slight sway');
  // distance and movement share the budget: a still goal is far, a swinging one is near (owner, Oct 27)
  const lvl5 = Array.from({ length: 200 }, (_, n) => S.shotFor(5, n, 5));
  const uOf = (x) => (x.dist - 12) / 28 + (x.move ? x.move.amp / 4 / 0.75 : 0);
  for (const x of lvl5) assert.ok(Math.abs(uOf(x) - lvl5.map(uOf).reduce((a, b) => a + b) / lvl5.length) < 0.04, 'every level-5 shot costs the same');
  assert.ok(lvl5.some((x) => !x.move && x.dist > 25) && lvl5.some((x) => x.move && x.dist < 16), 'long and still, or short and moving');
  assert.ok(lvl5.every((x) => x.wind === 0 && x.half === 2.5), 'no wind or narrow gap yet');
  // late on, both: long and moving, plus wind and a narrower gap
  const late = Array.from({ length: 100 }, (_, n) => S.shotFor(5, n, 20));
  assert.ok(late.every((x) => x.move && x.move.amp > 3 && x.dist > 37), 'level 20: far and swinging');
  assert.ok(late.some((x) => x.wind !== 0) && late.some((x) => x.half < 2.5));
  const car = Array.from({ length: 40 }, (_, n) => S.shotFor(5, n, 9)).find((x) => x.move);
  assert.ok(car && car.move.amp > 0, 'level 9 has moving posts');
  // practice shots (n < 0) are their own stream
  assert.notDeepEqual(S.shotFor(9, -1, 3), S.shotFor(9, 1, 3));
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

test('pull: length is power, the opposite of the pull is aim', () => {
  const H = stage.h, dy = 0.19 * H; // half of pullFull
  let m = S.kickFromInput(pull(195, 600, 0, dy));
  near(m.kick.power, 0.5, 1e-3); near(m.kick.aim, 0); near(m.kick.contact, 0);
  m = S.kickFromInput(pull(195, 600, -dy * 0.1, dy)); near(m.kick.aim, Math.atan(0.1), 1e-3); // pulled left: aims right
  m = S.kickFromInput(pull(195, 600, 0, H)); near(m.kick.power, 1);
  assert.equal(S.kickFromInput(pull(195, 600, 0, 7)).none, 'pull');
});

test('flick and pull make the same kick for the same intent', () => {
  const f = S.kickFromInput(flick(195, 590, 0.208, -2.08)).kick, p = S.kickFromInput(pull(195, 590, -0.0304 * stage.h, 0.304 * stage.h)).kick;
  near(f.power, p.power, 2e-3); near(f.aim, p.aim, 2e-3); near(f.contact, p.contact, 1e-9);
});

test('checkInput: shape and plausibility', () => {
  assert.equal(S.checkInput(flick(195, 600, 0, -1.3)), null);
  assert.equal(S.checkInput(pull(195, 600, 0, 120)), null);
  const f = flick(195, 600, 0, -1.3);
  assert.equal(S.checkInput({ ...f, kind: 'tap' }), 'kind');
  assert.equal(S.checkInput({ ...f, stage: { w: 10, h: 10 } }), 'stage');
  assert.equal(S.checkInput({ ...f, samples: f.samples.map((q) => [q[0] + 0.5, q[1], q[2]]) }), 'samples');
  assert.equal(S.checkInput({ ...f, samples: [...f.samples].reverse() }), 'time order');
  assert.equal(S.checkInput({ ...f, samples: [f.samples[0], [f.samples[0][0], f.samples[0][1] - 400 * Q, 4 * QT]] }), 'too quick');
  assert.equal(S.checkInput({ ...f, samples: [...f.samples.slice(0, -1), [f.samples[0][0], 0, f.samples.at(-1)[2]]] }), 'too fast');
  assert.equal(S.checkInput({ ...f, samples: Array(65).fill(f.samples[0]) }), 'samples');
});
