// Tester reports (api/report): anyone sends, only the owner's key reads; plain text, cut to size, rate limited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportServer, parseReport, LIMITS } from '../../api/report/_lib/server.js';
import { memoryStore } from '../../api/report/_lib/store.js';

const KEY = 'k'.repeat(24);
const make = (o = {}) => { const store = memoryStore(); let t = 1_000_000; return { store, s: createReportServer({ store, key: KEY, now: () => t, ...o }), tick: (ms) => { t += ms; } }; };
const post = (path, body, h = {}) => new Request(`https://x.test/api/report/${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'x-forwarded-for': '1.2.3.4', ...h } });
const get = (path, h = {}) => new Request(`https://x.test/api/report/${path}`, { headers: h });
const owner = { authorization: `Bearer ${KEY}` };

test('a tester sends a bug; the owner lists it and marks it done', async () => {
  const { s } = make();
  const r = await s.handle(post('send', { kind: 'bug', area: 'open', text: 'The pack\nwould not open', wallet: '0x' + 'Ab'.repeat(20), page: '/forge/?live=testnet', net: 'testnet', ua: 'X', screen: '390x844', errors: ['boom'] }));
  assert.equal(r.status, 200);
  const { id } = await r.json();
  const l = await (await s.handle(get('list', owner))).json();
  assert.equal(l.reports.length, 1);
  assert.deepEqual({ ...l.reports[0], at: 0 }, { id, at: 0, kind: 'bug', area: 'open', text: 'The pack\nwould not open', wallet: '0x' + 'ab'.repeat(20), page: '/forge/?live=testnet', net: 'testnet', ua: 'X', screen: '390x844', errors: 'boom', status: 'open' });
  assert.equal((await s.handle(post('status', { id, status: 'done' }, owner))).status, 200);
  assert.equal((await (await s.handle(get('list', owner))).json()).reports.length, 0, 'done ones leave the open list');
  assert.equal((await (await s.handle(get('list?status=all', owner))).json()).reports.length, 1);
});

test('only the owner\'s key reads or changes reports; a short key switches that side off', async () => {
  const { s } = make();
  await s.handle(post('send', { kind: 'idea', text: 'More games' }));
  for (const h of [{}, { authorization: 'Bearer nope' }, { authorization: `Bearer ${KEY}x` }]) {
    assert.equal((await s.handle(get('list', h))).status, 401);
    assert.equal((await s.handle(post('status', { id: 1, status: 'done' }, h))).status, 401);
  }
  const short = createReportServer({ store: memoryStore(), key: 'short' });
  assert.equal((await short.handle(get('list', { authorization: 'Bearer short' }))).status, 401);
});

test('plain text only, cut to size; bad input is refused', async () => {
  const p = parseReport({ kind: 'bug', text: 'a\u0000b‮c' + 'x'.repeat(5000), wallet: 'nope', area: '<script>', net: 'evil', page: 'y'.repeat(999) });
  assert.equal(p.report.text.length, LIMITS.text);
  assert.ok(p.report.text.startsWith('a bc'));
  assert.equal(p.report.wallet, null);
  assert.equal(p.report.area, 'other');
  assert.equal(p.report.net, 'other');
  assert.equal(p.report.page.length, 300);
  assert.equal(parseReport({ kind: 'spam', text: 'hello' }).error, 'Pick bug or idea.');
  assert.equal(parseReport({ kind: 'bug', text: '  ' }).error, 'Write a few words.');
  const { s } = make();
  assert.equal((await s.handle(post('send', 'not json'))).status, 400);
  assert.equal((await s.handle(post('send', { kind: 'bug', text: 'x'.repeat(LIMITS.bodyBytes + 10) }))).status, 400);
});

test('a few per address every 10 minutes', async () => {
  const { s, tick } = make();
  const send = () => s.handle(post('send', { kind: 'idea', text: 'hello there' }));
  for (let i = 0; i < LIMITS.perIp[0]; i++) assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 429);
  tick(LIMITS.perIp[1] + 1);
  assert.equal((await send()).status, 200);
});

test('no database: reports are off, said plainly', async () => {
  const s = createReportServer({ store: null, key: KEY });
  const r = await s.handle(post('send', { kind: 'bug', text: 'hello' }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'Reports are off right now.');
});
