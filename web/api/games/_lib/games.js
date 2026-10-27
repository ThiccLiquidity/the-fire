// The game room's games, as the server judges them. Each game: { gameId (FireGames id), slug, practiceLevels,
// shot(seed, n, level), timed(shot), judge(shot, input, kickTick) }. Paper football is game 1 and uses the shared sim.
import Sim from '../../../art/factory/forge/paperfb-sim.mjs';

const paperfb = {
  gameId: 1,
  slug: 'paperfb',
  name: 'Fold and Flick',
  version: Sim.VERSION,
  practiceLevels: [3, 5, 7],
  /** shot n's conditions at a level (n < 0: practice) */
  shot: (seed, n, level) => Sim.shotFor(seed, n, level, Sim.DEFAULT_TUNING),
  /** the release time matters only when the posts move */
  timed: (shot) => !!shot.move,
  maxKickTick: (ms) => Math.ceil((ms / 1000) * Sim.HZ),
  tickMs: 1000 / Sim.HZ,
  /** a raw input to a verdict: { rejected } (not a kick: try again), { broken } (the server disagrees with itself), or
   *  { result, made, kick, detail } */
  judge(shot, input, kickTick) {
    const bad = Sim.checkInput(input);
    if (bad) return { rejected: bad };
    const m = Sim.kickFromInput(input, Sim.DEFAULT_TUNING);
    if (!m.kick) return { rejected: `no kick (${m.none})` };
    const a = Sim.simulate(shot, m.kick, Sim.DEFAULT_TUNING, { kickTick });
    const b = Sim.simulate(shot, { ...m.kick }, Sim.DEFAULT_TUNING, { kickTick }); // a second replay: it must agree
    if (JSON.stringify(a) !== JSON.stringify(b)) return { broken: true };
    return { result: a.result, made: a.result === 'good', kick: m.kick, detail: { doinked: a.doinked, thunked: a.thunked, furnace: a.furnace } };
  },
};

export const GAMES = [paperfb];
/** a game by its slug ('paperfb') or its FireGames id ('1') */
export const findGame = (key) => GAMES.find((g) => g.slug === key || String(g.gameId) === String(key)) || null;
