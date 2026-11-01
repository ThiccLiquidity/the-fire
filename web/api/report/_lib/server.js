// Tester reports (docs/testnet-runbook.md, "Reports"): testers send a bug or an idea from the site's Testnet sheet;
// the owner reads them on /forge/reports.html.
//   POST /api/report/send    { kind: 'bug' | 'idea', area, text, wallet?, page?, net?, ua?, screen?, errors? }   anyone
//   GET  /api/report/list    ?status=open|done|all                         the owner (Bearer REPORTS_KEY)
//   POST /api/report/status  { id, status: 'open' | 'done' }                the owner (Bearer REPORTS_KEY)
// Plain text only, every field cut to size, control characters dropped; the reports page shows it as text, never HTML.
// A few per minute per address, so nobody can flood it.
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bad = (status, error) => json(status, { error });
export const LIMITS = { bodyBytes: 8192, text: 2000, perIp: [6, 600e3], list: 1000 };
export const KINDS = ['bug', 'idea'];
export const STATUSES = ['open', 'done'];

/** Plain one-line-or-more text: no control characters except new lines, trimmed, at most `max` characters. */
export const clean = (v, max, lines = false) => (typeof v === 'string' ? v : '')
  .replace(lines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ').replace(/[‪-‮⁦-⁩]/g, '').trim().slice(0, max);

/** The report as stored, or a reason it isn't one. */
export function parseReport(b) {
  if (!b || typeof b !== 'object') return { error: 'Bad request.' };
  if (!KINDS.includes(b.kind)) return { error: 'Pick bug or idea.' };
  const text = clean(b.text, LIMITS.text, true);
  if (text.length < 3) return { error: 'Write a few words.' };
  const wallet = typeof b.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(b.wallet) ? b.wallet.toLowerCase() : null;
  const area = /^[a-z0-9:-]{1,32}$/.test(b.area || '') ? b.area : 'other';
  const net = ['testnet', 'mainnet', 'demo'].includes(b.net) ? b.net : 'other';
  const errors = Array.isArray(b.errors) ? b.errors.slice(-5).map((e) => clean(e, 300)).filter(Boolean).join('\n') : '';
  return { report: { kind: b.kind, area, text, wallet, page: clean(b.page, 300), net, ua: clean(b.ua, 300), screen: clean(b.screen, 20), errors } };
}

export function createReportServer({ store, key = '', now = () => Date.now() }) {
  const hits = new Map();
  const limited = (ip) => {
    const [n, ms] = LIMITS.perIp, t = now(), h = (hits.get(ip) || []).filter((x) => t - x < ms);
    h.push(t); hits.set(ip, h); if (hits.size > 5000) hits.clear();
    return h.length > n;
  };
  const body = async (req) => { const t = await req.text(); if (t.length > LIMITS.bodyBytes) throw new Error('too big'); return JSON.parse(t || '{}'); };
  // the owner's key: at least 16 characters (a short one switches the owner's side off), compared in full
  const owner = (req) => {
    const got = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (key.length < 16 || got.length !== key.length) return false;
    let d = 0; for (let i = 0; i < key.length; i++) d |= key.charCodeAt(i) ^ got.charCodeAt(i);
    return d === 0;
  };

  async function send(req) {
    if (!store) return bad(503, 'Reports are off right now.');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (limited(ip)) return bad(429, 'That’s a lot of reports. Wait a few minutes.');
    let b; try { b = await body(req); } catch { return bad(400, 'Bad request.'); }
    const r = parseReport(b);
    if (r.error) return bad(400, r.error);
    const id = await store.add(r.report, now());
    return json(200, { ok: true, id });
  }

  async function list(req, url) {
    if (!owner(req)) return bad(401, 'Wrong key.');
    if (!store) return bad(503, 'No database.');
    const status = url.searchParams.get('status') || 'open';
    if (![...STATUSES, 'all'].includes(status)) return bad(400, 'Bad status.');
    return json(200, { reports: await store.list(status, LIMITS.list) });
  }

  async function setStatus(req) {
    if (!owner(req)) return bad(401, 'Wrong key.');
    if (!store) return bad(503, 'No database.');
    let b; try { b = await body(req); } catch { return bad(400, 'Bad request.'); }
    if (!Number.isSafeInteger(b.id) || b.id < 1 || !STATUSES.includes(b.status)) return bad(400, 'Bad request.');
    return json(200, { ok: await store.setStatus(b.id, b.status) });
  }

  return {
    async handle(req) {
      const url = new URL(req.url), action = url.pathname.split('/').pop();
      try {
        if (action === 'send' && req.method === 'POST') return await send(req);
        if (action === 'list' && req.method === 'GET') return await list(req, url);
        if (action === 'status' && req.method === 'POST') return await setStatus(req);
        return bad(404, 'Not found.');
      } catch (e) {
        console.error(JSON.stringify({ event: 'report-error', message: String(e?.message || e).slice(0, 200) }));
        return bad(500, 'Something went wrong. Try again.');
      }
    },
  };
}
