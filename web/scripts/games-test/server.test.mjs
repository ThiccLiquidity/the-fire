// The game server (web/api/games) against in-memory storage and a mocked chain: a full paid run, practice kicks,
// timing cheats, replayed and stale tokens, the kill switches, geo and 18+, resuming after a failure, and the board.
// Run: npm run test:games (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recoverTypedDataAddress } from 'viem';
import S from '../../art/factory/forge/paperfb-sim.mjs';
import { createGameServer } from '../../api/games/_lib/server.js';
import { memoryStore } from '../../api/games/_lib/store-memory.js';
import { runSigner, runDomain, RUN_TYPES } from '../../api/games/_lib/chain.js';
import { readConfig, LIMITS } from '../../api/games/_lib/config.js';
import { seedFor } from '../../api/games/_lib/token.js';

// a well-known test key (Anvil's first account): never a real one
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const GAMES_ADDR = '0x00000000000000000000000000000000000a11ce';
const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const PLAYER = '0x1111111111111111111111111111111111111111', OTHER = '0x2222222222222222222222222222222222222222';

function setup(over = {}) {
  const clock = { t: 1_800_000_000_000 };
  const signer = runSigner({ signerKey: TEST_KEY, chainId: 4663, gamesAddress: GAMES_ADDR });
  const txs = new Map();
  const chain = {
    signerAddress: signer.address, signRun: signer.signRun,
    st: { paused: false, open: true, series: 7, signer: signer.address },
    async state() { return { ...this.st }; },
    async runPaid(tx) { return txs.get(tx) || []; },
  };
  const pay = (runId, player = PLAYER, series = 7, gameId = 1) => { const tx = `0x${createHash('sha256').update(runId + player + series).digest('hex')}`; txs.set(tx, [{ gameId, runId, player, series }]); return tx; };
  const config = { ...readConfig({ GAMES_PAID_OPEN: '1', GAMES_JUDGING: '1', GAME_SEED_SECRET: SECRET }), ...over };
  const store = memoryStore(), logs = [];
  let n = 0;
  const server = createGameServer({ store, chain, config, now: () => clock.t, random: (k) => Buffer.alloc(k, ++n), log: (e, d) => logs.push([e, d]) });
  const call = async (action, body, { headers = { 'x-vercel-ip-country': 'US', 'x-vercel-ip-country-region': 'CA', 'x-forwarded-for': '1.2.3.4' }, method = 'POST', game = 'paperfb', qs = '' } = {}) => {
    const res = await server.handle(new Request(`https://omni.test/api/games/${game}/${action}${qs}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined }));
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return { clock, chain, pay, store, server, call, config, logs, signer };
}

/** a paid, confirmed run */
async function paidRun(env, wallet = PLAYER) {
  const c = await env.call('create', { wallet, adult: true });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const f = await env.call('confirm', { runId: c.body.runId, cap: c.body.cap, txHash: env.pay(c.body.runId, wallet) });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return c.body;
}

// ---------- kicks as a browser would send them: a straight flick, quantized
const stage = { w: 390, h: 700 }, edge = { x: 195 * 8, y: 600 * 8 };
function flickInput(power, aim, contact = -0.25) {
  const half = S.edgeScale(stage).half, vy = -power * 2.6, vx = -vy * Math.tan(aim), y0 = 600 - contact * half, samples = [];
  for (let t = 0; t <= 64; t += 8) samples.push(S.quantize(195 + vx * t, y0 + vy * t, t));
  return { kind: 'flick', stage, edge, start: samples[0], samples };
}
/** a kick input with the wanted verdict for this shot at this tick (searched the way a player learns it) */
function inputFor(shot, kickTick, want = 'good') {
  for (let p = 0.15; p <= 1; p += 0.01) for (let a = -0.3; a <= 0.3; a += 0.02) {
    const input = flickInput(p, a), m = S.kickFromInput(input);
    if (m.kick && S.simulate(shot, m.kick, S.DEFAULT_TUNING, { kickTick }).result === want) return input;
  }
  throw new Error(`no ${want} kick found`);
}
/** get a shot, ping it, and kick it E ms later with an honest release time */
async function playShot(env, run, { practice = false, want = 'good', after = 900, rtt = 40, claim } = {}) {
  const s = await env.call('shot', { runId: run.runId, cap: run.cap, practice });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  env.clock.t += rtt; await env.call('ping', { token: s.body.token });
  env.clock.t += after - rtt;
  const kickTick = claim ?? Math.round((after - rtt / 2 - LIMITS.displayLatencyMs) * S.HZ / 1000);
  const k = await env.call('kick', { token: s.body.token, cap: run.cap, input: inputFor(s.body.shot, kickTick, want), kickTick });
  env.clock.t += 2000;
  return { shot: s.body, kick: k };
}

test('a full paid run: create, approval, confirm, practice, makes, the first miss ends it, the board', async () => {
  const env = setup();
  const c = await env.call('create', { wallet: PLAYER, adult: true });
  assert.equal(c.status, 200);
  assert.match(c.body.runId, /^0x[0-9a-f]{64}$/);
  assert.equal(c.body.series, 7); assert.equal(c.body.gameId, 1);
  // the approval is FireGames' EIP-712 Run, signed by the server's key
  const who = await recoverTypedDataAddress({ domain: runDomain(4663, GAMES_ADDR), types: RUN_TYPES, primaryType: 'Run', message: { gameId: 1n, runId: c.body.runId, player: PLAYER, series: 7n, deadline: BigInt(c.body.deadline) }, signature: c.body.sig });
  assert.equal(who, env.signer.address);
  assert.equal(c.body.deadline, Math.floor(env.clock.t / 1000) + 600);
  // not playable before it's paid
  assert.equal((await env.call('shot', { runId: c.body.runId, cap: c.body.cap })).status, 409);
  // confirm: a payment for another run doesn't count; the right one starts it
  const other = await env.call('create', { wallet: PLAYER, adult: true });
  assert.equal((await env.call('confirm', { runId: c.body.runId, cap: c.body.cap, txHash: env.pay(other.body.runId) })).status, 409);
  const f = await env.call('confirm', { runId: c.body.runId, cap: c.body.cap, txHash: env.pay(c.body.runId) });
  assert.equal(f.status, 200); assert.equal(f.body.status, 'playing'); assert.equal(f.body.practiceLeft, 3);
  const run = c.body;
  // three practice kicks, then no more; they don't touch the streak
  for (let i = 0; i < 3; i++) {
    const { shot, kick } = await playShot(env, run, { practice: true, want: i === 1 ? 'short' : 'good' });
    assert.equal(shot.n, -(i + 1)); assert.equal(shot.level, [2, 4, 6][i]); assert.equal(shot.practice, true);
    assert.equal(kick.status, 200, JSON.stringify(kick.body)); assert.equal(kick.body.practice, true); assert.equal(kick.body.streak, 0);
    assert.equal(kick.body.result, i === 1 ? 'short' : 'good');
  }
  assert.equal((await env.call('shot', { runId: run.runId, cap: run.cap, practice: true })).status, 409);
  // scored kicks: three makes (each a level up), then a miss ends the run
  for (let i = 0; i < 3; i++) {
    const { shot, kick } = await playShot(env, run);
    assert.equal(shot.n, i); assert.equal(shot.level, i);
    assert.deepEqual([kick.status, kick.body.result, kick.body.streak, kick.body.over], [200, 'good', i + 1, false]);
  }
  const miss = await playShot(env, run, { want: 'short' });
  assert.deepEqual([miss.kick.body.result, miss.kick.body.over, miss.kick.body.streak], ['short', true, 3]);
  // the seed is revealed at the end and matches the commitment made at confirm, and it made every shot
  assert.equal(createHash('sha256').update(`${run.runId}:${miss.kick.body.seed}`).digest('hex'), f.body.seedCommit);
  assert.deepEqual(S.shotFor(miss.kick.body.seed, 3, 3), miss.shot.shot);
  // no more shots, and no practice after the scored kicks began
  const after = await env.call('shot', { runId: run.runId, cap: run.cap });
  assert.equal(after.body.over, true);
  // the board: one row for the wallet, its best streak
  const b = await env.call('board', null, { method: 'GET', qs: '?series=7' });
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.rows.map((r) => [r.rank, r.wallet, r.streak]), [[1, PLAYER, 3]]);
  assert.match(b.headers.get('cache-control'), /s-maxage=5/);
  // every kick is logged, with its raw input
  const kicks = await env.store.getKicks(run.runId);
  assert.equal(kicks.length, 7); assert.ok(kicks.every((k) => k.input?.samples?.length));
});

test('the board: best streak per wallet, ties to whoever got there first, cached 5 s', async () => {
  const env = setup(), s = { series: 7, gameId: 1 };
  await env.store.bumpBoard({ ...s, wallet: 'a', streak: 4, reachedAt: 300 });
  await env.store.bumpBoard({ ...s, wallet: 'b', streak: 4, reachedAt: 200 });
  await env.store.bumpBoard({ ...s, wallet: 'c', streak: 6, reachedAt: 900 });
  await env.store.bumpBoard({ ...s, wallet: 'b', streak: 3, reachedAt: 100 }); // lower: ignored
  await env.store.bumpBoard({ ...s, series: 8, wallet: 'z', streak: 9, reachedAt: 1 }); // another Series
  const b = await env.call('board', null, { method: 'GET', qs: '?series=7' });
  assert.deepEqual(b.body.rows.map((r) => [r.wallet, r.streak, r.reachedAt]), [['c', 6, 900], ['b', 4, 200], ['a', 4, 300]]);
  await env.store.bumpBoard({ ...s, wallet: 'd', streak: 10, reachedAt: 1000 });
  assert.equal((await env.call('board', null, { method: 'GET', qs: '?series=7' })).body.rows.length, 3); // cached
  env.clock.t += 5001;
  assert.equal((await env.call('board', null, { method: 'GET', qs: '?series=7' })).body.rows[0].wallet, 'd');
  assert.equal((await env.call('board', null, { method: 'GET', qs: '?series=7', game: '1' })).status, 200); // by FireGames id too
  const all = await env.call('board', null, { method: 'GET', qs: '?series=all' });
  assert.equal(all.status, 200); assert.equal(all.body.series, 'all'); assert.equal(all.body.rows[0].rank, 1);
  assert.equal((await env.call('board', null, { method: 'GET', qs: '?series=nope' })).status, 400);
});

test('a replayed or stale token gets no second verdict', async () => {
  const env = setup(), run = await paidRun(env);
  const s = await env.call('shot', { runId: run.runId, cap: run.cap });
  env.clock.t += 900;
  const kickTick = Math.round((900 - 125 - 50) * 0.48), body = { token: s.body.token, cap: run.cap, input: inputFor(s.body.shot, kickTick), kickTick };
  const first = await env.call('kick', body);
  assert.equal(first.status, 200); assert.equal(first.body.result, 'good');
  const again = await env.call('kick', body);
  assert.equal(again.status, 409); assert.equal(again.body.judged, true);
  assert.equal((await env.store.getRun(run.runId)).streak, 1);
  // a token for a shot that was issued again (resume) is stale
  const s2 = await env.call('shot', { runId: run.runId, cap: run.cap });
  env.clock.t += 4000;
  const s3 = await env.call('shot', { runId: run.runId, cap: run.cap }); // one fresh clock (a resume)
  env.clock.t += 4000;
  const s4 = await env.call('shot', { runId: run.runId, cap: run.cap });
  assert.notEqual(s3.body.t0, s2.body.t0); assert.equal(s4.body.t0, s3.body.t0, 'asking again and again never resets the clock');
  env.clock.t += 900;
  const stale = await env.call('kick', { ...body, token: s2.body.token });
  assert.equal(stale.status, 409); assert.equal(stale.body.stale, true);
  // a forged token
  const [b64, sig] = s2.body.token.split('.'), p = JSON.parse(Buffer.from(b64, 'base64url'));
  const forged = `${Buffer.from(JSON.stringify({ ...p, t0: p.t0 + 5000 })).toString('base64url')}.${sig}`;
  assert.equal((await env.call('kick', { ...body, token: forged })).status, 400);
  // someone else's run (run ids are public on chain): no capability, no play
  assert.equal((await env.call('shot', { runId: run.runId, cap: 'f'.repeat(40) })).status, 403);
  assert.equal((await env.call('kick', { ...body, cap: undefined })).status, 403);
});

/** a run whose next scored shot has moving posts (the RC car) */
async function movingShotRun(env) {
  const run = await paidRun(env), seed = seedFor(SECRET, 1, run.runId);
  let n = 6; while (!S.shotFor(seed, n, n).move) n++;
  await env.store.updateRun(run.runId, { streak: n, nextN: n, scoredStarted: true });
  return run;
}

test('timing cheat: with moving posts, the release must be when the server saw it', async () => {
  const env = setup(), run = await movingShotRun(env);
  const s = await env.call('shot', { runId: run.runId, cap: run.cap });
  assert.ok(s.body.shot.move);
  env.clock.t += 60; await env.call('ping', { token: s.body.token }); // RTT 60 ms
  env.clock.t += 2940; // the kick arrives 3 s after the shot was sent
  const honest = Math.round((3000 - 30 - 50) * 0.48);
  // claiming the release a second earlier (to pick where the posts were) is turned down: not a verdict, kick again
  const early = await env.call('kick', { token: s.body.token, cap: run.cap, input: flickInput(0.5, 0), kickTick: honest - 480 });
  assert.equal(early.status, 422); assert.equal(early.body.rejected, 'timing');
  const late = await env.call('kick', { token: s.body.token, cap: run.cap, input: flickInput(0.5, 0), kickTick: honest + 200 });
  assert.equal(late.body.rejected, 'timing');
  assert.equal((await env.store.getRun(run.runId)).status, 'playing');
  assert.equal(env.store.rejects.length, 2);
  env.clock.t += 1000; // the rate limit (2 a second)
  const now = Math.round((4000 - 30 - 50) * 0.48);
  const ok = await env.call('kick', { token: s.body.token, cap: run.cap, input: inputFor(s.body.shot, now), kickTick: now });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.result, 'good');
});

test('implausible input is turned down, not judged', async () => {
  const env = setup(), run = await paidRun(env);
  const s = await env.call('shot', { runId: run.runId, cap: run.cap });
  env.clock.t += 900;
  const input = flickInput(0.5, 0);
  const teleport = { ...input, samples: [...input.samples.slice(0, -1), [input.start[0], 0, input.samples.at(-1)[2]]] };
  const r = await env.call('kick', { token: s.body.token, cap: run.cap, input: teleport, kickTick: Math.round((900 - 30 - 50) * 0.48) }); // honest timing (a level-0 goal may sway)
  assert.equal(r.status, 422); assert.equal(r.body.rejected, 'too fast');
  env.clock.t += 1000;
  const slow = await env.call('kick', { token: s.body.token, cap: run.cap, input: flickInput(0.05, 0), kickTick: Math.round((1900 - 30 - 50) * 0.48) });
  assert.equal(slow.status, 422); assert.match(slow.body.rejected, /no kick/);
  assert.equal((await env.store.getRun(run.runId)).status, 'playing');
});

test('delay of game: a kick after the shot clock (and grace) is a miss', async () => {
  const env = setup(), run = await paidRun(env);
  const s = await env.call('shot', { runId: run.runId, cap: run.cap });
  env.clock.t += LIMITS.shotClockMs + LIMITS.graceMs + 1;
  const k = await env.call('kick', { token: s.body.token, cap: run.cap, input: flickInput(0.5, 0), kickTick: 100 });
  assert.equal(k.status, 200); assert.equal(k.body.result, 'delay'); assert.equal(k.body.over, true);
});

test('resume after a failure: the same run and the same shot, never a new run', async () => {
  const env = setup(), run = await paidRun(env);
  await playShot(env, run); // streak 1
  const s1 = await env.call('shot', { runId: run.runId, cap: run.cap });
  // ... the browser crashes, the server restarts. The player comes back with the run id and capability:
  const state = await env.call('run', { runId: run.runId, cap: run.cap });
  assert.deepEqual([state.status, state.body.status, state.body.streak, state.body.next], [200, 'playing', 1, 1]);
  env.clock.t += 60_000; // long after the shot clock: a fresh shot clock on the same conditions
  const s2 = await env.call('shot', { runId: run.runId, cap: run.cap });
  assert.equal(s2.body.n, s1.body.n); assert.deepEqual(s2.body.shot, s1.body.shot); assert.notEqual(s2.body.token, s1.body.token);
  env.clock.t += 900;
  const kt = Math.round((900 - 125 - 50) * 0.48);
  const k = await env.call('kick', { token: s2.body.token, cap: run.cap, input: inputFor(s2.body.shot, kt), kickTick: kt });
  assert.equal(k.body.result, 'good'); assert.equal(k.body.streak, 2);
  // confirming again is harmless (no second run, no reset)
  const again = await env.call('confirm', { runId: run.runId, cap: run.cap, txHash: env.pay(run.runId) });
  assert.equal(again.body.streak, 2);
});

test('kill switches: with the flags off, every paid endpoint answers closed', async () => {
  const run = await paidRun(setup());
  for (const over of [{ paidOpen: false, judging: false }, { judging: false }]) {
    const env = setup(over);
    for (const a of ['create', 'confirm', 'run', 'shot', 'ping', 'kick']) {
      const r = await env.call(a, { wallet: PLAYER, adult: true, runId: run.runId, cap: run.cap, token: 'x' });
      assert.equal(r.status, 503, `${a} ${JSON.stringify(over)}`); assert.equal(r.body.closed, true);
    }
    assert.equal((await env.call('board', null, { method: 'GET', qs: '?series=7' })).status, 200); // the board stays up
  }
  // paid entry off, judging on: no new runs, but runs already paid can finish
  const env = setup({ paidOpen: false }), live = setup();
  assert.equal((await env.call('create', { wallet: PLAYER, adult: true })).body.closed, true);
  const r2 = await paidRun(live);
  live.config.paidOpen = false;
  assert.equal((await live.call('shot', { runId: r2.runId, cap: r2.cap })).status, 200);
  // the on-chain switches close new runs too
  for (const st of [{ paused: true }, { open: false }, { series: 0 }]) {
    const e = setup(); Object.assign(e.chain.st, st);
    assert.equal((await e.call('create', { wallet: PLAYER, adult: true })).body.closed, true, JSON.stringify(st));
  }
  // and no secret configured: closed
  const bare = setup({ seedSecret: '' });
  assert.equal((await bare.call('create', { wallet: PLAYER, adult: true })).body.closed, true);
});

test('geo and 18+: blocked states, unknown location and no attestation get no approval', async () => {
  const env = setup();
  for (const region of ['AZ', 'AR', 'CT', 'DE', 'LA', 'MT', 'SC', 'SD', 'TN', 'IN', 'ME']) {
    const r = await env.call('create', { wallet: PLAYER, adult: true }, { headers: { 'x-vercel-ip-country': 'US', 'x-vercel-ip-country-region': region } });
    assert.equal(r.status, 451, region); assert.equal(r.body.blocked, true);
  }
  assert.equal((await env.call('create', { wallet: PLAYER, adult: true }, { headers: {} })).status, 451);
  assert.equal((await env.call('create', { wallet: PLAYER, adult: true }, { headers: { 'x-vercel-ip-country': 'GB' } })).status, 200);
  assert.equal((await env.call('create', { wallet: PLAYER, adult: true }, { headers: { 'x-vercel-ip-country': 'US', 'x-vercel-ip-country-region': 'NY' } })).status, 200);
  const minor = await env.call('create', { wallet: PLAYER });
  assert.equal(minor.status, 400); assert.equal(minor.body.needsAdult, true);
  assert.equal((await env.call('create', { wallet: 'nope', adult: true })).status, 400);
});

test('confirm checks the payer and Series; create is rate-limited per IP', async () => {
  const env = setup();
  const c = await env.call('create', { wallet: PLAYER, adult: true });
  assert.equal((await env.call('confirm', { runId: c.body.runId, cap: c.body.cap, txHash: env.pay(c.body.runId, OTHER) })).status, 409);
  assert.equal((await env.call('confirm', { runId: c.body.runId, cap: c.body.cap, txHash: env.pay(c.body.runId, PLAYER, 6) })).status, 409);
  assert.equal((await env.store.getRun(c.body.runId)).status, 'created');
  env.clock.t += LIMITS.claimMs + 1;
  assert.equal((await env.call('confirm', { runId: c.body.runId, cap: c.body.cap, txHash: env.pay(c.body.runId) })).status, 410);
  const e2 = setup();
  for (let i = 0; i < 20; i++) assert.equal((await e2.call('create', { wallet: PLAYER, adult: true })).status, 200);
  assert.equal((await e2.call('create', { wallet: PLAYER, adult: true })).status, 429);
  assert.equal((await e2.call('create', { wallet: PLAYER, adult: true }, { headers: { 'x-vercel-ip-country': 'GB', 'x-forwarded-for': '9.9.9.9' } })).status, 200);
});

test('routes: unknown game or action, wrong method', async () => {
  const env = setup();
  assert.equal((await env.call('create', {}, { game: 'chess' })).status, 404);
  assert.equal((await env.call('nope', {})).status, 404);
  assert.equal((await env.call('board', {}, { method: 'POST' })).status, 405);
});
