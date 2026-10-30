// Where push subscriptions live: Neon in production (DATABASE_URL), memory in tests.
import { neon } from '@neondatabase/serverless';

const row = (r) => r && ({ endpoint: r.endpoint, wallet: r.wallet, keys: { p256dh: r.p256dh, auth: r.auth }, topics: String(r.topics || '').split(',').filter(Boolean) });

export function neonStore(url, { sql = neon(url) } = {}) {
  const q = (text, params = []) => sql.query(text, params);
  return {
    async save(s, now) {
      await q(`insert into push_subs (endpoint, wallet, p256dh, auth, topics, created_at) values ($1,$2,$3,$4,$5,$6)
               on conflict (endpoint) do update set wallet = excluded.wallet, p256dh = excluded.p256dh, auth = excluded.auth, topics = excluded.topics`,
      [s.endpoint, s.wallet, s.keys.p256dh, s.keys.auth, s.topics.join(','), now]);
    },
    async remove(endpoint) { await q('delete from push_subs where endpoint = $1', [endpoint]); },
    async countFor(wallet) { return Number((await q('select count(*)::int as n from push_subs where wallet = $1', [wallet]))[0]?.n || 0); },
    async forWallet(wallet, topic) { return (await q("select * from push_subs where wallet = $1 and (',' || topics || ',') like $2", [wallet, `%,${topic},%`])).map(row); },
    async forTopic(topic, limit) { return (await q("select * from push_subs where (',' || topics || ',') like $1 limit $2", [`%,${topic},%`, limit])).map(row); },
    /** true the first time a tag is claimed (a second keeper asking for the same event gets false) */
    async claim(tag, now) { return (await q('insert into push_sent (tag, sent_at) values ($1,$2) on conflict (tag) do nothing returning tag', [tag, now])).length === 1; },
    async ok(endpoint, now) { await q('update push_subs set last_ok = $2 where endpoint = $1', [endpoint, now]); },
  };
}

export function memoryStore() {
  const subs = new Map(), sent = new Set();
  return {
    async save(s) { subs.set(s.endpoint, structuredClone(s)); },
    async remove(endpoint) { subs.delete(endpoint); },
    async countFor(wallet) { return [...subs.values()].filter((s) => s.wallet === wallet).length; },
    async forWallet(wallet, topic) { return [...subs.values()].filter((s) => s.wallet === wallet && s.topics.includes(topic)); },
    async forTopic(topic, limit) { return [...subs.values()].filter((s) => s.topics.includes(topic)).slice(0, limit); },
    async claim(tag) { if (sent.has(tag)) return false; sent.add(tag); return true; },
    async ok() {},
    subs,
  };
}
