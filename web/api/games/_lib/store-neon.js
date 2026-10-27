// Neon Postgres storage (production): DATABASE_URL, tables from schema.sql. Same interface as store-memory.js.
import { neon } from '@neondatabase/serverless';

const COLS = { status: 'status', streak: 'streak', nextN: 'next_n', practiceUsed: 'practice_used', scoredStarted: 'scored_started', paidAt: 'paid_at', txHash: 'tx_hash', endedAt: 'ended_at' };
const num = (v) => (v == null ? v : Number(v));
const runRow = (r) => r && ({
  runId: r.run_id, gameId: r.game_id, wallet: r.wallet, series: num(r.series), status: r.status, streak: r.streak, nextN: r.next_n,
  practiceUsed: r.practice_used, scoredStarted: r.scored_started, createdAt: num(r.created_at), paidAt: num(r.paid_at), txHash: r.tx_hash, endedAt: num(r.ended_at), ip: r.ip,
});
const shotRow = (s) => s && ({ runId: s.run_id, n: s.n, level: s.level, practice: s.practice, t0: num(s.t0), nonce: s.nonce, pingAt: num(s.ping_at), shot: s.shot, issued: s.issued });

export function neonStore(url, { sql = neon(url) } = {}) {
  const q = (text, params = []) => sql.query(text, params);
  return {
    kind: 'neon',
    async createRun(r) {
      await q('insert into game_runs (run_id, game_id, wallet, series, status, streak, next_n, practice_used, scored_started, created_at, ip) values ($1,$2,$3,$4,$5,0,0,0,false,$6,$7)',
        [r.runId, r.gameId, r.wallet, r.series, r.status, r.createdAt, r.ip ?? null]);
    },
    async getRun(runId) { return runRow((await q('select * from game_runs where run_id = $1', [runId]))[0]) || null; },
    async findRunByTx(txHash) { return runRow((await q('select * from game_runs where tx_hash = $1', [txHash]))[0]) || null; },
    async updateRun(runId, patch, expect = {}) {
      const params = [runId], sets = [], where = ['run_id = $1'];
      for (const [k, v] of Object.entries(patch)) { if (!COLS[k]) throw new Error(`bad column ${k}`); params.push(v); sets.push(`${COLS[k]} = $${params.length}`); }
      for (const [k, v] of Object.entries(expect)) { if (!COLS[k]) throw new Error(`bad column ${k}`); params.push(v); where.push(`${COLS[k]} = $${params.length}`); }
      const rows = await q(`update game_runs set ${sets.join(', ')} where ${where.join(' and ')} returning run_id`, params);
      return rows.length === 1;
    },
    async issueShot(s) {
      await q(`insert into game_shots (run_id, n, level, practice, t0, nonce, ping_at, shot, issued) values ($1,$2,$3,$4,$5,$6,null,$7,1)
               on conflict (run_id, n) do update set t0 = excluded.t0, nonce = excluded.nonce, ping_at = null, issued = game_shots.issued + 1`,
      [s.runId, s.n, s.level, !!s.practice, s.t0, s.nonce, JSON.stringify(s.shot)]);
    },
    async getShot(runId, n) { return shotRow((await q('select * from game_shots where run_id = $1 and n = $2', [runId, n]))[0]) || null; },
    async pingShot(runId, n, nonce, at) {
      return (await q('update game_shots set ping_at = $4 where run_id = $1 and n = $2 and nonce = $3 and ping_at is null returning n', [runId, n, nonce, at])).length === 1;
    },
    async recordKick(k) {
      const rows = await q(`insert into game_kicks (run_id, n, at, kick_tick, input, kick, result, detail, rtt, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                            on conflict (run_id, n) do nothing returning n`,
      [k.runId, k.n, k.at, k.kickTick ?? null, JSON.stringify(k.input ?? null), JSON.stringify(k.kick ?? null), k.result, JSON.stringify(k.detail ?? null), k.rtt ?? null, k.version ?? null]);
      return rows.length === 1;
    },
    async getKicks(runId) {
      return (await q('select * from game_kicks where run_id = $1 order by at', [runId])).map((k) => ({ runId: k.run_id, n: k.n, at: num(k.at), kickTick: k.kick_tick, input: k.input, kick: k.kick, result: k.result, detail: k.detail, rtt: k.rtt, version: k.version }));
    },
    async logReject(r) { await q('insert into game_rejects (run_id, n, at, reason, input) values ($1,$2,$3,$4,$5)', [r.runId ?? null, r.n ?? null, r.at, r.reason, JSON.stringify(r.input ?? null)]); },
    async bumpBoard(b) {
      const rows = await q(`insert into game_board (series, game_id, wallet, streak, reached_at, run_id) values ($1,$2,$3,$4,$5,$6)
                            on conflict (series, game_id, wallet) do update set streak = excluded.streak, reached_at = excluded.reached_at, run_id = excluded.run_id
                            where game_board.streak < excluded.streak returning wallet`,
      [b.series, b.gameId, b.wallet, b.streak, b.reachedAt, b.runId ?? null]);
      return rows.length === 1;
    },
    async board({ series, gameId, limit = 100 }) {
      return (await q('select wallet, streak, reached_at from game_board where series = $1 and game_id = $2 order by streak desc, reached_at asc limit $3', [series, gameId, limit]))
        .map((r) => ({ wallet: r.wallet, streak: r.streak, reachedAt: num(r.reached_at) }));
    },
    async allTime({ gameId, limit = 100 }) {
      // each wallet's best across every Series (the earliest if it tied itself), then ranked the same way
      return (await q(`select * from (select distinct on (wallet) wallet, streak, reached_at, series from game_board where game_id = $1
                        order by wallet, streak desc, reached_at asc) b order by streak desc, reached_at asc limit $2`, [gameId, limit]))
        .map((r) => ({ wallet: r.wallet, streak: r.streak, reachedAt: num(r.reached_at), series: Number(r.series) }));
    },
    async rateHit(key, windowMs, max, now) {
      const rows = await q(`insert into game_rate (key, window_start, count) values ($1, $2, 1)
                            on conflict (key) do update set
                              count = case when game_rate.window_start <= $2::bigint - $3::bigint then 1 else game_rate.count + 1 end,
                              window_start = case when game_rate.window_start <= $2::bigint - $3::bigint then $2 else game_rate.window_start end
                            returning count`, [key, now, windowMs]);
      return rows[0].count <= max;
    },
    async getFlag(name) { return (await q('select value from game_flags where name = $1', [name]))[0]?.value ?? null; },
    async setFlag(name, value, at = Date.now()) { await q('insert into game_flags (name, value, at) values ($1,$2,$3) on conflict (name) do update set value = excluded.value, at = excluded.at', [name, value, at]); },
  };
}
