// Where tester reports live: Neon in production (DATABASE_URL, the same database as push and the game server), memory in
// tests. The table is made on first use.
import { neon } from '@neondatabase/serverless';

const TABLE = `create table if not exists tester_reports (
  id serial primary key, created_at bigint not null, kind text not null, area text not null, text text not null,
  wallet text, page text, net text, ua text, screen text, errors text, status text not null default 'open')`;
const row = (r) => ({ id: Number(r.id), at: Number(r.created_at), kind: r.kind, area: r.area, text: r.text, wallet: r.wallet, page: r.page, net: r.net, ua: r.ua, screen: r.screen, errors: r.errors, status: r.status });

export function neonStore(url, { sql = neon(url) } = {}) {
  const q = (text, params = []) => sql.query(text, params);
  let made = null;
  const ready = () => (made ||= q(TABLE).catch((e) => { made = null; throw e; }));
  return {
    async add(r, now) {
      await ready();
      const out = await q(`insert into tester_reports (created_at, kind, area, text, wallet, page, net, ua, screen, errors) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [now, r.kind, r.area, r.text, r.wallet, r.page, r.net, r.ua, r.screen, r.errors]);
      return Number(out[0].id);
    },
    async list(status, limit) {
      await ready();
      const rows = status === 'all' ? await q('select * from tester_reports order by id desc limit $1', [limit])
        : await q('select * from tester_reports where status = $1 order by id desc limit $2', [status, limit]);
      return rows.map(row);
    },
    async setStatus(id, status) { await ready(); return (await q('update tester_reports set status = $2 where id = $1 returning id', [id, status])).length === 1; },
  };
}

export function memoryStore() {
  const rows = [];
  return {
    async add(r, now) { rows.push({ ...r, id: rows.length + 1, at: now, status: 'open' }); return rows.length; },
    async list(status, limit) { return rows.filter((r) => status === 'all' || r.status === status).reverse().slice(0, limit).map((r) => ({ ...r })); },
    async setStatus(id, status) { const r = rows.find((x) => x.id === id); if (r) r.status = status; return !!r; },
    rows,
  };
}
