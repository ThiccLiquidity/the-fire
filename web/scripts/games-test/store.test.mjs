// Both storage adapters keep the same contract: in-memory (always) and the Neon adapter's SQL on a real Postgres
// (PGlite, when PGLITE points at the @electric-sql/pglite package; skipped otherwise). Run: npm run test:games (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { memoryStore } from '../../api/games/_lib/store-memory.js';
import { neonStore } from '../../api/games/_lib/store-neon.js';

async function pgliteStore() {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE + '/dist/index.js').href);
  const db = new PGlite();
  await db.exec(readFileSync(new URL('../../api/games/_lib/schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../api/games/_lib/schema.sql', import.meta.url), 'utf8')); // safe to run twice
  return neonStore('postgres://unused', { sql: { query: async (text, params) => (await db.query(text, params)).rows } });
}

async function contract(store) {
  const run = { runId: '0x' + 'ab'.repeat(32), gameId: 1, wallet: '0x11', series: 7, status: 'created', streak: 0, nextN: 0, practiceUsed: 0, scoredStarted: false, createdAt: 1000, ip: '1.2.3.4' };
  await store.createRun(run);
  await assert.rejects(store.createRun(run));
  assert.deepEqual({ ...(await store.getRun(run.runId)), paidAt: undefined, txHash: undefined, endedAt: undefined }, { ...run, paidAt: undefined, txHash: undefined, endedAt: undefined });
  assert.equal(await store.getRun('0xnone'), null);
  // compare-and-set updates
  assert.equal(await store.updateRun(run.runId, { status: 'playing', paidAt: 2000, txHash: '0xtx' }, { status: 'created' }), true);
  assert.equal(await store.updateRun(run.runId, { status: 'playing' }, { status: 'created' }), false);
  assert.equal((await store.findRunByTx('0xtx')).runId, run.runId);
  // shots: issue, re-issue (new nonce, ping cleared), ping once
  const shot = { level: 2, dist: 20.5, wind: -3.25, half: 2.5, offset: 0.1, move: null, drift: 1, unlock: null };
  await store.issueShot({ runId: run.runId, n: 0, level: 2, practice: false, t0: 5000, nonce: 'a1', shot });
  assert.equal(await store.pingShot(run.runId, 0, 'a1', 5040), true);
  assert.equal(await store.pingShot(run.runId, 0, 'a1', 5090), false);
  await store.issueShot({ runId: run.runId, n: 0, level: 2, practice: false, t0: 9000, nonce: 'b2', shot });
  const s = await store.getShot(run.runId, 0);
  assert.deepEqual([s.t0, s.nonce, s.pingAt, s.issued, s.level], [9000, 'b2', null, 2, 2]);
  assert.deepEqual(s.shot, shot);
  assert.equal(await store.pingShot(run.runId, 0, 'a1', 9010), false);
  // kicks: one verdict per shot
  const kick = { runId: run.runId, n: 0, at: 9900, kickTick: 300, input: { kind: 'flick', samples: [[1, 2, 3]] }, kick: { power: 0.5 }, result: 'good', detail: { doinked: false }, rtt: 40, version: 1 };
  assert.equal(await store.recordKick(kick), true);
  assert.equal(await store.recordKick({ ...kick, result: 'short' }), false);
  const ks = await store.getKicks(run.runId);
  assert.equal(ks.length, 1); assert.equal(ks[0].result, 'good'); assert.deepEqual(ks[0].input, kick.input);
  await store.logReject({ runId: run.runId, n: 1, at: 1, reason: 'timing', input: {} });
  // the board
  const b = { series: 7, gameId: 1 };
  assert.equal(await store.bumpBoard({ ...b, wallet: 'w1', streak: 3, reachedAt: 50, runId: run.runId }), true);
  assert.equal(await store.bumpBoard({ ...b, wallet: 'w1', streak: 3, reachedAt: 10 }), false); // not better
  assert.equal(await store.bumpBoard({ ...b, wallet: 'w1', streak: 2, reachedAt: 10 }), false);
  await store.bumpBoard({ ...b, wallet: 'w2', streak: 3, reachedAt: 40 });
  await store.bumpBoard({ ...b, wallet: 'w3', streak: 5, reachedAt: 90 });
  await store.bumpBoard({ series: 7, gameId: 2, wallet: 'w9', streak: 50, reachedAt: 1 });
  assert.deepEqual(await store.board({ ...b, limit: 10 }), [{ wallet: 'w3', streak: 5, reachedAt: 90 }, { wallet: 'w2', streak: 3, reachedAt: 40 }, { wallet: 'w1', streak: 3, reachedAt: 50 }]);
  assert.equal((await store.board({ ...b, limit: 1 })).length, 1);
  // rate limits: a window
  const hits = [];
  for (let i = 0; i < 3; i++) hits.push(await store.rateHit('k', 1000, 2, 100 + i));
  hits.push(await store.rateHit('k', 1000, 2, 1200));
  assert.deepEqual(hits, [true, true, false, true]);
  // flags
  assert.equal(await store.getFlag('judging'), null);
  await store.setFlag('judging', 'off', 1); await store.setFlag('judging', 'on', 2);
  assert.equal(await store.getFlag('judging'), 'on');
}

test('memory store keeps the storage contract', () => contract(memoryStore()));
test('Neon store SQL keeps the same contract on Postgres (PGlite)', { skip: process.env.PGLITE ? false : 'set PGLITE to the @electric-sql/pglite package folder' }, async () => contract(await pgliteStore()));
