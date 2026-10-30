// The push server: browsers subscribe (their wallet, what they want to hear about), the keepers ask it to notify.
//   GET  /api/push/key          the public key browsers subscribe with
//   POST /api/push/subscribe    { subscription, wallet?, topics? }        a browser signs up (or changes its topics)
//   POST /api/push/unsubscribe  { endpoint }                              a browser stops
//   POST /api/push/send         { tag, to: wallet | 'all', topic, title, body, url }   keepers only (Bearer PUSH_SEND_SECRET)
// Push addresses are only accepted from the known push services (the server posts to them: never to anywhere else).
// Each event is sent once (tag), however many keepers ask. A gone subscription (404/410) is deleted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];
const TOPICS = ['ready', 'drops'];
const isWallet = (w) => typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bad = (status, error) => json(status, { error });
export const LIMITS = { perWallet: 8, subscribePerIp: [30, 600e3], bodyBytes: 4096, broadcast: 5000 };

export function pushOk(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname)); } catch { return false; }
}

export function createPushServer({ store, config, send, now = () => Date.now() }) {
  const hits = new Map();
  const limited = (ip) => {
    const [n, ms] = LIMITS.subscribePerIp, t = now(), h = (hits.get(ip) || []).filter((x) => t - x < ms);
    h.push(t); hits.set(ip, h); if (hits.size > 5000) hits.clear();
    return h.length > n;
  };
  const body = async (req) => { const t = await req.text(); if (t.length > LIMITS.bodyBytes) throw new Error('too big'); return JSON.parse(t || '{}'); };
  const ready = () => !!(store && config.publicKey && config.privateKey);

  async function subscribe(req) {
    if (!ready()) return bad(503, 'Notifications are off right now.');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (limited(ip)) return bad(429, 'Too many tries. Wait a few minutes.');
    let b; try { b = await body(req); } catch { return bad(400, 'Bad request.'); }
    const s = b.subscription;
    if (!s || !pushOk(s.endpoint) || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string' || s.keys.p256dh.length > 200 || s.keys.auth.length > 64) return bad(400, 'That browser subscription is not valid.');
    const wallet = b.wallet == null ? null : isWallet(b.wallet) ? b.wallet.toLowerCase() : undefined;
    if (wallet === undefined) return bad(400, 'Bad wallet.');
    const topics = Array.isArray(b.topics) ? TOPICS.filter((t) => b.topics.includes(t)) : TOPICS;
    if (wallet && (await store.countFor(wallet)) >= LIMITS.perWallet) return bad(409, 'This wallet already has notifications on several devices.');
    await store.save({ endpoint: s.endpoint, wallet, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, topics }, now());
    return json(200, { ok: true, topics });
  }

  async function unsubscribe(req) {
    if (!store) return bad(503, 'Notifications are off right now.');
    let b; try { b = await body(req); } catch { return bad(400, 'Bad request.'); }
    if (!pushOk(b.endpoint)) return bad(400, 'Bad endpoint.');
    await store.remove(b.endpoint);
    return json(200, { ok: true });
  }

  async function sendOne(req) {
    const auth = req.headers.get('authorization') || '';
    if (!config.sendSecret || auth !== `Bearer ${config.sendSecret}`) return bad(401, 'No.');
    if (!ready()) return bad(503, 'Notifications are off.');
    let b; try { b = await body(req); } catch { return bad(400, 'Bad request.'); }
    if (typeof b.tag !== 'string' || !b.tag || b.tag.length > 120 || !TOPICS.includes(b.topic) || typeof b.title !== 'string' || typeof b.body !== 'string') return bad(400, 'Bad message.');
    if (b.to !== 'all' && !isWallet(b.to)) return bad(400, 'Bad recipient.');
    if (!(await store.claim(b.tag, now()))) return json(200, { sent: 0, already: true });
    const subs = b.to === 'all' ? await store.forTopic(b.topic, LIMITS.broadcast) : await store.forWallet(b.to.toLowerCase(), b.topic);
    const msg = JSON.stringify({ title: b.title.slice(0, 80), body: b.body.slice(0, 200), url: typeof b.url === 'string' && b.url.startsWith('/') ? b.url : '/forge/', tag: b.tag });
    let sent = 0, gone = 0;
    for (const s of subs) {
      try { await send(s, msg); sent++; await store.ok(s.endpoint, now()); }
      catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) { gone++; await store.remove(s.endpoint); } }
    }
    return json(200, { sent, gone });
  }

  const ROUTES = { key: ['GET', () => (config.publicKey ? json(200, { key: config.publicKey }) : bad(503, 'Notifications are off right now.'))], subscribe: ['POST', subscribe], unsubscribe: ['POST', unsubscribe], send: ['POST', sendOne] };
  return {
    async handle(req) {
      const action = new URL(req.url).pathname.split('/').filter(Boolean).pop();
      const r = ROUTES[action];
      if (!r) return bad(404, 'Not found.');
      if (req.method !== r[0]) return bad(405, 'Method not allowed.');
      try { return await r[1](req); } catch (e) { console.warn(JSON.stringify({ event: 'push-error', action, error: String(e?.message || e).slice(0, 200) })); return bad(500, 'Something went wrong.'); }
    },
  };
}
