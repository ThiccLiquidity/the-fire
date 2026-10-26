// ops/games/award.mjs: the winners from a board, and its dry run. Run: node --test games/award.test.mjs (from ops/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { award, winnersFrom } from './award.mjs';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40), D = '0x' + 'd'.repeat(40);
const rows = [{ wallet: A, streak: 9, reachedAt: 5 }, { wallet: B, streak: 7, reachedAt: 2 }, { wallet: C, streak: 7, reachedAt: 3 }, { wallet: D, streak: 1, reachedAt: 1 }];

test('the top three get 3, 2 and 1 packs, in board order', () => {
  assert.deepEqual(winnersFrom(rows).map((w) => [w.wallet.toLowerCase(), w.packs]), [[A, 3], [B, 2], [C, 1]]);
});
test('excluded wallets drop out and the next move up; zero streaks and junk never win', () => {
  assert.deepEqual(winnersFrom(rows, { exclude: [B.toUpperCase().replace('0X', '0x')] }).map((w) => w.wallet.toLowerCase()), [A, C, D]);
  assert.deepEqual(winnersFrom([{ wallet: A, streak: 0 }, { wallet: 'x', streak: 5 }, { wallet: B, streak: 2 }, { wallet: B, streak: 2 }]).map((w) => [w.wallet.toLowerCase(), w.packs]), [[B, 3]]);
});
test('a dry run reads the board and sends nothing; --send without a key or RPC stops', async () => {
  const lines = [], fetchImpl = async (url) => { assert.match(url, /\/api\/games\/1\/board\?series=7$/); return { ok: true, json: async () => ({ rows }) }; };
  const r = await award(['--series', '7', '--site', 'https://example.test/'], { env: {}, out: (l) => lines.push(l), fetchImpl });
  assert.equal(r.sent, false); assert.equal(r.winners.length, 3);
  assert.ok(lines.some((l) => l.includes('awardPrizes(7, 1, [')));
  await assert.rejects(award(['--series', '7', '--site', 'https://example.test', '--send'], { env: {}, out: () => {}, fetchImpl }), /RPC/);
  await assert.rejects(award([], { env: {}, out: () => {} }), /--series/);
  const empty = await award(['--series', '7', '--site', 'https://x.test'], { env: {}, out: () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ rows: [] }) }) });
  assert.deepEqual(empty.winners, []);
});
