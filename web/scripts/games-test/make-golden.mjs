// Rebuilds golden.json after a sim VERSION bump: the same recorded kicks, replayed with the new rules, plus random
// kicks until every result kind is covered. Not a test. Run from web/:  node scripts/games-test/make-golden.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import S from '../../art/factory/forge/paperfb-sim.mjs';

const file = new URL('./golden.json', import.meta.url);
const old = JSON.parse(readFileSync(file, 'utf8'));
const run = (g) => { const r = S.simulate(S.shotFor(g.seed, g.n, g.level), g.kick, S.DEFAULT_TUNING, { kickTick: g.kickTick }); return { seed: g.seed, n: g.n, level: g.level, kick: g.kick, kickTick: g.kickTick, result: r.result, doinked: r.doinked, thunked: r.thunked, furnace: r.furnace, resultTick: r.resultTick }; };
const out = old.map(run);
const need = () => {
  const has = (p) => out.some(p), miss = [];
  for (const k of ['good', 'wide-left', 'wide-right', 'short', 'under', 'doink']) if (!has((g) => g.result === k)) miss.push((g) => g.result === k);
  if (!has((g) => g.furnace)) miss.push((g) => g.furnace);
  if (!has((g) => g.thunked)) miss.push((g) => g.thunked);
  if (!has((g) => g.result === 'good' && g.doinked)) miss.push((g) => g.result === 'good' && g.doinked);
  if (!has((g) => g.level >= S.COSTS.WIND_FROM && g.result === 'good' && S.shotFor(g.seed, g.n, g.level).wind)) miss.push((g) => g.result === 'good' && S.shotFor(g.seed, g.n, g.level).wind);
  if (!has((g) => g.result === 'good' && S.shotFor(g.seed, g.n, g.level).move)) miss.push((g) => g.result === 'good' && S.shotFor(g.seed, g.n, g.level).move);
  return miss;
};
const r = S.rng(20261028), q = (v) => Math.round(v * 1000) / 1000;
for (let i = 0; i < 200000 && need().length; i++) {
  const g = run({ seed: Math.floor(r() * 2 ** 31), n: Math.floor(r() * 20), level: Math.floor(r() * 16), kick: { power: q(r()), aim: q((r() - 0.5) * 0.6), contact: q((r() - 0.5) * 1.8), sweetMin: 0.1 }, kickTick: Math.floor(r() * 3000) });
  if (need().some((p) => p(g))) out.push(g);
}
if (need().length) throw new Error('could not cover every result');
writeFileSync(file, '[' + out.map((g) => JSON.stringify(g)).join(',\n') + ']\n');
console.log(`${out.length} golden kicks (${old.length} replayed), results:`, [...new Set(out.map((g) => g.result))].join(' '));
