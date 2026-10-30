// web/api/push: subscribe, send once per event, only to the known push services, keepers only. npm run test:push
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPushServer, pushOk } from '../../api/push/_lib/server.js';
import { memoryStore } from '../../api/push/_lib/store.js';

const W = '0x' + 'ab'.repeat(20), SECRET = 's3cret';
const sub = (n = 1, host = 'fcm.googleapis.com') => ({ endpoint: `https://${host}/fcm/send/dev${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } });
function setup(over = {}) {
  const store = memoryStore(), sent = [];
  const send = async (s, msg) => { if (s.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); sent.push({ to: s.endpoint, msg: JSON.parse(msg) }); };
  const server = createPushServer({ store, send, config: { publicKey: 'PUB', privateKey: 'PRIV', sendSecret: SECRET, ...over } });
  const call = (action, body, { method = 'POST', auth } = {}) => server.handle(new Request(`https://x.test/api/push/${action}`, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body) }));
  return { store, sent, call };
}

test('the key, and subscribing (a wallet and topics; only real push services)', async () => {
  const env = setup();
  assert.equal((await (await env.call('key', null, { method: 'GET' })).json()).key, 'PUB');
  assert.equal((await env.call('subscribe', { subscription: sub(1), wallet: W })).status, 200);
  assert.equal((await env.call('subscribe', { subscription: sub(2, 'evil.example.com'), wallet: W })).status, 400, 'not a push service: refused (no posting to arbitrary hosts)');
  assert.equal((await env.call('subscribe', { subscription: { ...sub(3), endpoint: 'http://fcm.googleapis.com/x' } })).status, 400, 'not https');
  assert.equal((await env.call('subscribe', { subscription: sub(4), wallet: 'nope' })).status, 400);
  const r = await (await env.call('subscribe', { subscription: sub(5), topics: ['drops', 'spam'] })).json();
  assert.deepEqual(r.topics, ['drops'], 'unknown topics dropped; no wallet = drop news only');
  assert.ok(pushOk('https://web.push.apple.com/abc') && pushOk('https://wns2-by3p.notify.windows.com/w/?token=1') && !pushOk('https://notify.windows.com.evil.io/x'));
});

test("send: keepers only, once per event, to the wallet's devices or everyone on a topic; gone devices removed", async () => {
  const env = setup();
  await env.call('subscribe', { subscription: sub(1), wallet: W });
  await env.call('subscribe', { subscription: sub(2), wallet: W, topics: ['drops'] });
  await env.call('subscribe', { subscription: { ...sub(3), endpoint: 'https://fcm.googleapis.com/fcm/send/gone' }, wallet: W });
  const msg = { tag: 'open-1-0', to: W, topic: 'ready', title: 'Your cards are ready', body: 'Rip your Series 1 pack.', url: '/forge/?open=1' };
  assert.equal((await env.call('send', msg)).status, 401, 'no secret');
  assert.equal((await env.call('send', msg, { auth: 'Bearer wrong' })).status, 401);
  const r = await (await env.call('send', msg, { auth: `Bearer ${SECRET}` })).json();
  assert.deepEqual([r.sent, r.gone], [1, 1], 'the ready device; the drops-only one not; the gone one removed');
  assert.equal(env.sent[0].msg.title, 'Your cards are ready');
  assert.equal(env.store.subs.size, 2);
  const again = await (await env.call('send', msg, { auth: `Bearer ${SECRET}` })).json();
  assert.equal(again.already, true, 'the backup keeper asking for the same event: nothing sent twice');
  const all = await (await env.call('send', { ...msg, tag: 'series-2-open', to: 'all', topic: 'drops', url: 'https://evil.example.com' }, { auth: `Bearer ${SECRET}` })).json();
  assert.equal(all.sent, 2, 'both devices that take Series news'); assert.equal(env.sent.at(-1).msg.url, '/forge/', 'only our own pages');
});

test("off without keys or storage; a wallet's device cap", async () => {
  const off = setup({ privateKey: '' });
  assert.equal((await off.call('subscribe', { subscription: sub(1), wallet: W })).status, 503);
  const env = setup();
  for (let i = 0; i < 8; i++) assert.equal((await env.call('subscribe', { subscription: sub(10 + i), wallet: W })).status, 200);
  assert.equal((await env.call('subscribe', { subscription: sub(99), wallet: W })).status, 409);
  assert.equal((await env.call('unsubscribe', { endpoint: sub(10).endpoint })).status, 200);
  assert.equal(env.store.subs.size, 7);
});
