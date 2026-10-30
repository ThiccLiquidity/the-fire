// /api/idx/<path>: the site's way to the indexer (ops/indexer, docs/indexer.md), so the page stays same-origin.
// Only the public read endpoints pass (cards, packs, pulls, board, burners); its SQL and GraphQL stay private.
// INDEXER_URL unset: 503, and the site falls back to the block explorer and the chain.
const OK = /^(cards|packs)\/0x[0-9a-fA-F]{40}$|^pulls$|^board\/\d{1,7}$|^burners$/;

export async function GET(request) {
  const base = (process.env.INDEXER_URL || '').replace(/\/$/, '');
  if (!base) return new Response('{"error":"no indexer"}', { status: 503, headers: { 'content-type': 'application/json' } });
  const u = new URL(request.url), path = u.pathname.replace(/^\/api\/idx\//, '');
  if (!OK.test(path)) return new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
  const q = new URLSearchParams([...u.searchParams].filter(([k]) => ['fire', 'min', 'limit'].includes(k)));
  try {
    const r = await fetch(`${base}/${path}${q.size ? `?${q}` : ''}`, { signal: AbortSignal.timeout(8000) });
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': r.headers.get('cache-control') || 'no-store' } });
  } catch {
    return new Response('{"error":"indexer unreachable"}', { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
