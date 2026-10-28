// Fold and Flick: the player model that calibrates shotFor's difficulty costs (docs/paper-football.md, decision 31).
// Not a test (npm run test:games skips it). Run from web/:  node scripts/games-test/difficulty.mjs [calibrate|levels]
//
// The model is a wobbly-thumb player: it reads the shot, works out the kick that splits the uprights a little over the
// bar (aim, power, the clean contact spot, and for moving posts the release moment), then misses each by a random
// amount: power ±8%, aim ±1.9°, contact ±0.5 of the half edge (mishits), release ±0.2 s, and it reads the wind only roughly
// (it allows for 75% of it, give or take 35%). `calibrate` prints the make rate of each factor alone so the costs in
// paperfb-sim.js (WIND_PER, MOVE_PER) keep a unit of any factor about as hard as a unit of distance; `levels`
// prints the make rate per level.
import S from '../../art/factory/forge/paperfb-sim.mjs';

const T = S.DEFAULT_TUNING, { BAR } = S.world;
const NOISE = { power: 0.08, aim: 1.9 * Math.PI / 180, contact: 0.5, timing: 0.2, windRead: 0.35, windAllow: 0.75, ...JSON.parse(process.env.NOISE || "{}") };
const gauss = (r) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / Math.sqrt(0.5); }; // ~N(0, 1)

/** where the football crosses the goal's plane for a kick (posts out of the way), and when */
function cross(shot, k) {
  const open = { ...shot, half: 100, move: null, offset: 0 };
  const f = S.createFlight(open, k, T, {}), D = shot.dist;
  let prev = { ...f.ball };
  for (let i = 0; i < 4000; i++) {
    f.step(); const b = f.ball;
    if (b.z >= D) { const u = (D - prev.z) / (b.z - prev.z || 1); return { x: prev.x + (b.x - prev.x) * u, y: prev.y + (b.y - prev.y) * u, ticks: f.tick }; }
    if (b.y < 0.06 && b.vy <= 0 && i > 5) return { x: b.x, y: -1, ticks: f.tick };
    prev = { ...b };
  }
  return { x: 0, y: -1, ticks: 4000 };
}
/** the kick that crosses at (x*, y*): bisection on power for the height, then on aim for the side */
function ideal(shot, kickTick, windSeen) {
  const seen = { ...shot, wind: windSeen };
  const c = T.sweetAt, target = BAR + 1.6;
  let k = { power: 0.5, aim: 0, contact: c, sweetMin: 0.1 };
  for (let pass = 0; pass < 3; pass++) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; (cross(seen, { ...k, power: m }).y < target ? (lo = m) : (hi = m)); }
    k.power = (lo + hi) / 2;
    const at = cross(seen, k), goalX = S.postX(shot, (kickTick + at.ticks) * S.DT);
    let a0 = -0.38, a1 = 0.38;
    for (let i = 0; i < 22; i++) { const m = (a0 + a1) / 2; (cross(seen, { ...k, aim: m }).x < goalX ? (a0 = m) : (a1 = m)); }
    k.aim = (a0 + a1) / 2;
  }
  return k;
}
/** the model's make rate on a shot (trials kicks) */
export function makeRate(shot, trials = 200, seed = 1) {
  const r = S.rng(seed); let made = 0;
  for (let i = 0; i < trials; i++) {
    const k0 = Math.floor(r() * 4 * S.HZ), windSeen = shot.wind * (NOISE.windAllow + NOISE.windRead * gauss(r));
    const k = ideal(shot, k0, windSeen);
    const kick = { power: Math.min(1, Math.max(0, k.power * (1 + NOISE.power * gauss(r)))), aim: k.aim + NOISE.aim * gauss(r), contact: k.contact + NOISE.contact * gauss(r), sweetMin: 0.1 };
    const kt = Math.max(0, Math.round(k0 + NOISE.timing * S.HZ * gauss(r)));
    if (S.simulate(shot, kick, T, { kickTick: kt }).result === 'good') made++;
  }
  return made / trials;
}
const base = (o) => ({ level: 0, dist: 12, wind: 0, half: 2.5, offset: 0, move: null, drift: 1, ...o });
const car = (c) => ({ amp: c * 4, speed: 0.6 + c * 1.4, phase: 1.3 });

if (process.argv[2] === 'calibrate') {
  const N = +process.argv[3] || 300;
  console.log('distance (in) -> make');
  for (const d of [12, 19, 26, 33, 40]) console.log(d, makeRate(base({ dist: d }), N).toFixed(3));
  console.log('wind (mph) at 26 in -> make');
  for (const w of [0, 2, 4, 6, 8, 10, 12, 15]) console.log(w, makeRate(base({ dist: 26, wind: w }), N).toFixed(3));
  console.log('car at 12 in -> make');
  for (const c of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]) console.log(c, makeRate(base({ move: car(c) }), N).toFixed(3));
}
if (process.argv[2] === 'levels') {
  const N = +process.argv[3] || 60, shots = +process.argv[4] || 40;
  for (const lv of [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]) {
    let sum = 0; for (let n = 0; n < shots; n++) sum += makeRate(S.shotFor(1000 + n, n, lv), N, n + 1);
    console.log(`L${lv}`, (sum / shots).toFixed(3));
  }
}
