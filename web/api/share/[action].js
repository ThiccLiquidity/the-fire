// /api/share/<action>: share previews (docs/share.md). page: the tags link previewers read (/s rewrites here), then on
// to the showcase; img: the 1200 x 630 picture of the shared cards. Both cached on Vercel's CDN for an hour.
import { readFileSync } from 'node:fs';
import { page, parseQuery, picture, readCards, siteHref } from './_lib/share.js';

const CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
let backdrop;

export async function GET(request) {
  const u = new URL(request.url), action = u.pathname.split('/').pop(), q = parseQuery(u.searchParams);
  if (action === 'page') {
    const cards = await readCards(q).catch(() => []);
    return new Response(page(q, cards, u.origin), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': CACHE } });
  }
  if (action === 'img') {
    const fallback = () => Response.redirect(`${u.origin}/forge/ui/og.jpg`, 302);
    try {
      const cards = await readCards(q);
      if (!cards.length) return fallback();
      const { default: sharp } = await import('sharp');
      backdrop ||= readFileSync(new URL('./_lib/backdrop.jpg', import.meta.url));
      const jpg = await picture(cards, { backdrop, sharp });
      if (!jpg) return fallback();
      return new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': CACHE } });
    } catch {
      return fallback();
    }
  }
  return Response.redirect(`${u.origin}${siteHref(q)}`, 302);
}
