// The game server: paid runs for the game room (docs/game-server.md). Routes are /api/games/<game>/<action>, where
// <game> is a slug ('paperfb') or a FireGames id ('1'). Built from injected parts, so tests run it with in-memory
// storage and a mocked chain:
//   createGameServer({ store, chain, config, now, random, log }).handle(Request) -> Response
//
// A run: create (geo, 18+, switches; returns the run id and the approval for FireGames.payRun) -> the player pays on
// chain -> confirm (RunPaid in the receipt) -> up to 3 practice kicks -> shot / kick, shot / kick ... until the first
// miss. The server derives every kick from its raw input and replays it with the game's sim: its verdict is final.
import { createHash, randomBytes } from 'node:crypto';
import { encodeAbiParameters, getAddress, isAddress, isHash, keccak256 } from 'viem';
import { LIMITS } from './config.js';
import { findGame } from './games.js';
import { capFor, capOk, seedFor, signToken, verifyToken } from './token.js';

const NO_STORE = { 'cache-control': 'no-store' };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers } });
const closed = (why) => json(503, { closed: true, error: 'Competitive play is closed right now.', why });
const bad = (status, error, extra = {}) => json(status, { error, ...extra });
const isRunId = (v) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);

export function createGameServer({ store, chain, config, now = Date.now, random = randomBytes, log = defaultLog }) {
  const L = LIMITS;
  const secret = config.seedSecret;
  const configured = () => !!(secret && secret.length >= 32 && store && chain);
  /** judging is on: the env switch, and the server hasn't switched itself off (a replay that disagreed with itself) */
  const judging = async () => config.judging && configured() && (await store.getFlag('judging')) !== 'off';
  const boardCache = new Map();

  async function body(req) {
    const text = await req.text();
    if (text.length > L.bodyBytes) throw Object.assign(new Error('too big'), { status: 413 });
    try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
  }
  const ipOf = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';

  /** the run named in a request, if the caller holds its capability */
  async function ownRun(b, game) {
    if (!isRunId(b.runId)) return { err: bad(400, 'Bad run id.') };
    if (!capOk(secret, b.runId, b.cap)) return { err: bad(403, 'Not your run.') };
    const run = await store.getRun(b.runId);
    if (!run || run.gameId !== game.gameId) return { err: bad(404, 'No such run.') };
    return { run };
  }
  const runView = (run) => ({
    runId: run.runId, gameId: run.gameId, series: run.series, status: run.status, streak: run.streak, next: run.nextN,
    practiceLeft: run.scoredStarted ? 0 : Math.max(0, L.practice - run.practiceUsed), over: run.status === 'over',
  });
  const seedReveal = (run) => ({ seed: seedFor(secret, run.gameId, run.runId) });

  // ---------------------------------------------------------------- create: geo, 18+, switches -> run id + approval
  async function create(req, game) {
    if (!config.paidOpen || !(await judging())) return closed('switch');
    const country = (req.headers.get('x-vercel-ip-country') || '').toUpperCase(), region = (req.headers.get('x-vercel-ip-country-region') || '').toUpperCase();
    if (!country && !config.allowNoGeo) return bad(451, "We can't tell where you are, so competitive play isn't available.", { blocked: true });
    if (country === 'US' && config.blocked.includes(region)) return bad(451, "Competitive play isn't available in your state.", { blocked: true });
    const b = await body(req);
    if (b.adult !== true) return bad(400, 'Competitive play is 18+ only.', { needsAdult: true });
    if (!isAddress(b.wallet || '')) return bad(400, 'Bad wallet.');
    const wallet = getAddress(b.wallet), t = now();
    if (!(await store.rateHit(`create:${ipOf(req)}`, L.createPerIp[1], L.createPerIp[0], t))) return bad(429, 'Too many tries. Wait a few minutes.');
    let st;
    try { st = await chain.state(game.gameId); } catch (e) { log('chain-state-failed', { message: e.message }); return closed('chain'); }
    if (st.paused || !st.open || !st.series) return closed('chain');
    if (st.signer && chain.signerAddress && st.signer.toLowerCase() !== chain.signerAddress.toLowerCase()) { log('signer-mismatch', {}); return closed('signer'); }
    if (b.series != null && Number(b.series) !== st.series) return bad(409, 'The Series has moved on. Reload.', { series: st.series });
    const runId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bytes16' }], [wallet, BigInt(st.series), `0x${random(16).toString('hex')}`]));
    const deadline = Math.floor(t / 1000) + L.payWindowS;
    const sig = await chain.signRun({ gameId: game.gameId, runId, player: wallet, series: st.series, deadline });
    await store.createRun({ runId, gameId: game.gameId, wallet: wallet.toLowerCase(), series: st.series, status: 'created', streak: 0, nextN: 0, practiceUsed: 0, scoredStarted: false, createdAt: t, ip: ipOf(req) });
    return json(200, { runId, cap: capFor(secret, runId), gameId: game.gameId, series: st.series, deadline, sig, player: wallet });
  }

  // ---------------------------------------------------------------- confirm: RunPaid in the receipt starts the run
  async function confirm(req, game) {
    if (!(await judging())) return closed('switch');
    const b = await body(req), { run, err } = await ownRun(b, game); if (err) return err;
    const commit = createHash('sha256').update(`${run.runId}:${seedFor(secret, run.gameId, run.runId)}`).digest('hex');
    if (run.status !== 'created') return json(200, { ...runView(run), seedCommit: commit });
    if (now() - run.createdAt > L.claimMs) return bad(410, 'This run is too old to start. Ask for help if you paid for it.');
    if (!isHash(b.txHash || '')) return bad(400, 'Bad transaction hash.');
    const txHash = b.txHash.toLowerCase();
    let paid;
    try { paid = await chain.runPaid(txHash); } catch (e) { log('receipt-failed', { message: e.message }); return bad(409, "We can't see that payment yet. Try again in a moment.", { retry: true }); }
    const hit = paid.find((p) => p.runId.toLowerCase() === run.runId && p.gameId === run.gameId);
    if (!hit) return bad(409, "That transaction didn't pay for this run.", { retry: true });
    if (hit.player.toLowerCase() !== run.wallet || hit.series !== run.series) return bad(409, "That payment is for another wallet or Series.");
    const ok = await store.updateRun(run.runId, { status: 'playing', paidAt: now(), txHash }, { status: 'created' });
    const fresh = await store.getRun(run.runId);
    if (!ok && fresh.status === 'created') return bad(409, 'Try again.', { retry: true });
    return json(200, { ...runView(fresh), seedCommit: commit });
  }

  // ---------------------------------------------------------------- run: where a run stands (to resume after a failure)
  async function runState(req, game) {
    if (!(await judging())) return closed('switch');
    const b = await body(req), { run, err } = await ownRun(b, game); if (err) return err;
    return json(200, { ...runView(run), ...(run.status === 'over' ? seedReveal(run) : {}) });
  }

  // ---------------------------------------------------------------- shot: the next shot's conditions and its token
  async function shot(req, game) {
    if (!(await judging())) return closed('switch');
    const b = await body(req), { run, err } = await ownRun(b, game); if (err) return err;
    if (run.status === 'created') return bad(409, 'This run is not paid yet.');
    if (run.status === 'over') return json(200, { ...runView(run), ...seedReveal(run) });
    let n, level, practice = false;
    if (b.practice) {
      if (run.scoredStarted || run.practiceUsed >= L.practice) return bad(409, 'No practice kicks left.', runView(run));
      practice = true; n = -(run.practiceUsed + 1); level = game.practiceLevels[run.practiceUsed] ?? 0;
    } else {
      n = run.nextN; level = run.streak;
      if (!run.scoredStarted) await store.updateRun(run.runId, { scoredStarted: true });
    }
    const conditions = game.shot(seedFor(secret, run.gameId, run.runId), n, level);
    const t0 = now(), nonce = random(8).toString('hex');
    await store.issueShot({ runId: run.runId, n, level, practice, t0, nonce, shot: conditions });
    const token = signToken(secret, { v: 1, g: game.gameId, r: run.runId, n, t0, nonce });
    return json(200, { n, practice, level, shot: conditions, token, t0, shotClockMs: L.shotClockMs, streak: run.streak });
  }

  // ---------------------------------------------------------------- ping: right after a shot arrives (measures RTT)
  async function ping(req, game) {
    if (!(await judging())) return closed('switch');
    const b = await body(req), p = verifyToken(secret, b.token);
    if (!p || p.g !== game.gameId) return bad(400, 'Bad token.');
    await store.pingShot(p.r, p.n, p.nonce, now());
    return json(200, { ok: true });
  }

  // ---------------------------------------------------------------- kick: raw input in, the final verdict out
  async function kick(req, game) {
    if (!(await judging())) return closed('switch');
    const at = now(), b = await body(req), p = verifyToken(secret, b.token);
    if (!p || p.g !== game.gameId) return bad(400, 'Bad token.');
    if (!capOk(secret, p.r, b.cap)) return bad(403, 'Not your run.');
    const run = await store.getRun(p.r);
    if (!run || run.status !== 'playing') return bad(409, run?.status === 'over' ? 'This run is over.' : 'This run is not in play.', run ? runView(run) : {});
    const sh = await store.getShot(p.r, p.n);
    if (!sh || sh.nonce !== p.nonce || sh.t0 !== p.t0) return bad(409, 'That shot was replaced. Get the shot again.', { stale: true });
    if ((await store.getKicks(p.r)).some((k) => k.n === p.n)) return bad(409, 'That shot was already judged.', { judged: true });
    if (!(await store.rateHit(`kick:${p.r}`, L.kicksPerRun[1], L.kicksPerRun[0], at))) return bad(429, 'Too fast.');
    const practice = p.n < 0;
    if (!practice && p.n !== run.nextN) return bad(409, 'That shot was already judged.', { judged: true });
    const elapsed = at - sh.t0, rtt = sh.pingAt != null ? Math.max(0, Math.min(L.maxRttMs, sh.pingAt - sh.t0)) : L.defaultRttMs;
    const reject = async (reason, status = 422) => {
      await store.logReject({ runId: p.r, n: p.n, at, reason, input: { input: b.input, kickTick: b.kickTick, elapsed, rtt } });
      log('kick-rejected', { runId: p.r, n: p.n, reason });
      return bad(status, "That kick didn't count. Kick again.", { rejected: reason });
    };
    let verdict;
    if (elapsed > L.shotClockMs + L.graceMs) verdict = { result: 'delay', made: false, detail: { delay: true } };
    else {
      const kickTick = b.kickTick;
      if (!Number.isSafeInteger(kickTick) || kickTick < 0 || kickTick > game.maxKickTick(L.shotClockMs + L.graceMs)) return reject('kick tick');
      if (game.timed(sh.shot)) { // moving posts: the release must be when the server says it was
        const claimed = kickTick * game.tickMs, estimate = elapsed - rtt / 2 - L.displayLatencyMs;
        if (Math.abs(claimed - estimate) > L.releaseTolMs) return reject('timing');
        if (elapsed - claimed > rtt + L.arrivalSlackMs) return reject('late');
      }
      verdict = game.judge(sh.shot, b.input, kickTick);
      if (verdict.rejected) return reject(verdict.rejected);
      if (verdict.broken) {
        await store.setFlag('judging', 'off', at);
        log('ALERT judging switched off: the replay disagreed with itself', { runId: p.r, n: p.n });
        return closed('judging');
      }
    }
    const recorded = await store.recordKick({ runId: p.r, n: p.n, at, kickTick: b.kickTick ?? null, input: b.input ?? null, kick: verdict.kick ?? null, result: verdict.result, detail: verdict.detail, rtt, version: game.version });
    if (!recorded) return bad(409, 'That shot was already judged.', { judged: true });
    const out = { n: p.n, practice, result: verdict.result, made: verdict.made, ...verdict.detail };
    if (practice) {
      await store.updateRun(run.runId, { practiceUsed: run.practiceUsed + 1 });
      return json(200, { ...out, ...runView({ ...run, practiceUsed: run.practiceUsed + 1 }) });
    }
    if (verdict.made) {
      const streak = run.streak + 1;
      await store.updateRun(run.runId, { streak, nextN: p.n + 1 }, { status: 'playing', nextN: p.n });
      await store.bumpBoard({ series: run.series, gameId: run.gameId, wallet: run.wallet, streak, reachedAt: at, runId: run.runId });
      return json(200, { ...out, ...runView({ ...run, streak, nextN: p.n + 1 }) });
    }
    await store.updateRun(run.runId, { status: 'over', endedAt: at }, { status: 'playing' });
    return json(200, { ...out, ...runView({ ...run, status: 'over' }), ...seedReveal(run) });
  }

  // ---------------------------------------------------------------- board: per (Series, game), or all time
  // (?series=all: each wallet's best ever, no prizes), cached for 5 s
  async function board(req, game) {
    const u = new URL(req.url), raw = u.searchParams.get('series'), all = raw === 'all', series = all ? 'all' : Number(raw);
    const limit = Math.max(1, Math.min(100, Number(u.searchParams.get('limit')) || 100));
    if (!all && (!Number.isSafeInteger(series) || series < 1)) return bad(400, 'Which Series? ?series=N (or ?series=all)');
    if (!store) return closed('storage');
    const key = `${series}:${game.gameId}:${limit}`, hit = boardCache.get(key), t = now();
    let rows;
    if (hit && t - hit.at < 5000) rows = hit.rows;
    else { rows = await (all ? store.allTime({ gameId: game.gameId, limit }) : store.board({ series, gameId: game.gameId, limit })); boardCache.set(key, { at: t, rows }); }
    return json(200, { series, gameId: game.gameId, rows: rows.map((r, i) => ({ rank: i + 1, ...r })) }, { 'cache-control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' });
  }

  const ROUTES = { create: ['POST', create], confirm: ['POST', confirm], run: ['POST', runState], shot: ['POST', shot], ping: ['POST', ping], kick: ['POST', kick], board: ['GET', board] };

  async function handle(req) {
    try {
      const parts = new URL(req.url).pathname.split('/').filter(Boolean); // api, games, <game>, <action>
      const i = parts.indexOf('games'), game = findGame(parts[i + 1]), route = ROUTES[parts[i + 2]];
      if (i < 0 || !game || !route) return bad(404, 'No such game or action.');
      if (req.method !== route[0]) return bad(405, `Use ${route[0]}.`);
      if (route[1] !== board && !configured()) return closed('config');
      return await route[1](req, game);
    } catch (e) {
      if (e.status) return bad(e.status, e.message);
      log('error', { message: e.message });
      return bad(500, 'Something went wrong. Your run is safe: try again.');
    }
  }
  return { handle };
}

function defaultLog(event, detail) {
  // never secrets, keys or tokens: events and ids only
  console.warn(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));
}
