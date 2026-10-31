// Share previews (docs/share.md): a share link is /s?show=<wallet>&c=<card serials>&live=<net>. Link previewers (X,
// Discord, iMessage, Telegram...) read this page's tags and show a picture of the shared cards; people are sent straight
// on to the showcase on the site (/forge/?show=...). The picture (/api/share/img) is the workshop backdrop with up to
// three of the cards on it, the best in front, read from the chain (only cards the wallet still holds).
// Demo links (no ?live) get the site's own preview: demo cards only exist in the visitor's browser.
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';

const NETS = {
  testnet: { chainId: 46630, rpc: 'https://rpc.testnet.chain.robinhood.com/rpc', file: '46630.json' },
  mainnet: { chainId: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com', file: '4663.json' },
};
const ABI = parseAbi([
  'function tokenURI(uint256 serial) view returns (string)',
  'function ownerOf(uint256 serial) view returns (address)',
]);
const MAX_IDS = 6, PICTURED = 3;
const MAT_RANK = { 'full art': 6, gold: 5, diamond: 5, coal: 4, charcoal: 4, fire: 3, wood: 2, paper: 1 };
const HOLO_RANK = { full: 3, 'full holo': 3, picture: 2, 'holo picture': 2, frame: 1, 'holo frame': 1 };
// where card pictures may come from: the IPFS gateways the site itself uses
const IMG_HOSTS = new Set(['ipfs.filebase.io', 'ipfs.io', 'dweb.link', 'gateway.pinata.cloud']);

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The link's query, checked: { addr, show, ids, live } (live: 'testnet' | 'mainnet' | null). Anything odd is dropped. */
export function parseQuery(sp) {
  const a = sp.get('show') || '', addr = /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null, show = /^0x[0-9a-fA-F]{4,40}$/.test(a) ? a : null; // show: a demo showcase too
  const ids = [...new Set((sp.get('c') || '').split('.').filter((x) => /^\d{1,9}$/.test(x)).map(Number).filter((x) => x > 0))].slice(0, MAX_IDS);
  const l = sp.get('live'), live = l === 'testnet' || l === 'mainnet' ? l : null;
  return { addr, show, ids, live };
}
/** Where a person goes: the showcase on the site, same query (only the checked parts). */
export function siteHref(q) {
  const u = new URLSearchParams();
  if (q.live) u.set('live', q.live);
  if (q.show) { u.set('show', q.show); if (q.ids.length) u.set('c', q.ids.join('.')); }
  return `/forge/${u.size ? `?${u}` : ''}`;
}

function deployment(live) {
  try { return JSON.parse(readFileSync(new URL(`../../../../deployments/${NETS[live].file}`, import.meta.url), 'utf8')); } catch { return null; }
}
export function decodeUri(uri) {
  const m = /^data:application\/json;base64,(.*)$/.exec(uri || '');
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
}
const trait = (md, k) => md.attributes?.find((x) => x.trait_type === k)?.value;
/** One card from its metadata: { serial, name, material, holo, grade, image } */
export function cardFrom(serial, md) {
  const g = /^PDA (\d+)$/.exec(String(trait(md, 'PDA') ?? '')), holo = String(trait(md, 'Holo') ?? 'none').toLowerCase();
  return { serial, name: String(md.name || '').replace(/\s*#\d+$/, ''), material: String(trait(md, 'Material') ?? '').toLowerCase(), holo, grade: g ? +g[1] : null, image: String(md.image || '') };
}
export const rank = (c) => (c.grade != null ? 100 + c.grade * 10 : 0) + (MAT_RANK[c.material] || 0) * 4 + (HOLO_RANK[c.holo] || 0);
export const best = (cards) => [...cards].sort((a, b) => rank(b) - rank(a));
/** "Gold Toaster · Full holo · PDA 10" */
export function label(c) {
  const holo = { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' }[c.holo] || (/holo/i.test(c.holo) ? c.holo[0].toUpperCase() + c.holo.slice(1) : '');
  return [c.name, c.material === 'full art' || c.material === 'gold' ? '' : holo, c.grade != null ? `PDA ${c.grade}` : ''].filter(Boolean).join(' · ');
}
/** A card picture's https address, or null if it isn't one of the IPFS gateways the site uses. */
export function imageUrl(src) {
  if (/^ipfs:\/\/[A-Za-z0-9]{20,100}\/[A-Za-z0-9._/-]{1,200}$/.test(src)) return `https://ipfs.filebase.io/ipfs/${src.slice(7)}`;
  try { const u = new URL(src); return u.protocol === 'https:' && IMG_HOSTS.has(u.hostname) ? u.href : null; } catch { return null; }
}

/** The shared cards the wallet still holds, best first. reader(net) -> { tokenURI(serial), ownerOf(serial) } (tests). */
export async function readCards(q, { reader = chainReader } = {}) {
  if (!q.live || !q.addr || !q.ids.length) return [];
  const r = reader(q.live);
  if (!r) return [];
  const one = async (serial) => {
    const [owner, uri] = await Promise.all([r.ownerOf(serial), r.tokenURI(serial)]);
    if (String(owner).toLowerCase() !== q.addr.toLowerCase()) return null;
    const md = decodeUri(uri);
    return md ? cardFrom(serial, md) : null;
  };
  const got = await Promise.allSettled(q.ids.map(one));
  return best(got.map((x) => (x.status === 'fulfilled' ? x.value : null)).filter(Boolean));
}
function chainReader(live) {
  const net = NETS[live], d = deployment(live), c = d?.contracts || {};
  if (!c.CardsRenderer || !c.FireCards) return null;
  const rpc = (live === 'testnet' ? process.env.SHARE_RPC_TESTNET : process.env.SHARE_RPC_MAINNET) || net.rpc;
  const client = createPublicClient({ transport: http(rpc, { timeout: 6000, retryCount: 1 }) });
  return {
    tokenURI: (s) => client.readContract({ address: c.CardsRenderer, abi: ABI, functionName: 'tokenURI', args: [BigInt(s)] }),
    ownerOf: (s) => client.readContract({ address: c.FireCards, abi: ABI, functionName: 'ownerOf', args: [BigInt(s)] }),
  };
}

/** The page link previewers read. */
export function page(q, cards, origin) {
  const to = siteHref(q), img = q.addr && q.live && cards.length ? `${origin}/api/share/img?${new URLSearchParams({ show: q.addr, c: q.ids.join('.'), live: q.live })}` : `${origin}/forge/ui/og.jpg`;
  const top = cards[0], n = cards.length;
  const title = top ? `${label(top)} | Omni Cardworks` : q.addr ? `${short(q.addr)}'s cards | Omni Cardworks` : 'Omni Cardworks';
  const desc = top
    ? `${n > 1 ? `${n} cards` : 'A card'} from ${short(q.addr)}'s collection${n > 1 ? `, best: ${label(top)}` : ''}. Rip packs, pull rares, grade your best. On Robinhood Chain.`
    : 'Wood and paper in, packs out. Rip packs, pull rares, grade your best. On Robinhood Chain.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Omni Cardworks">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + to)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(top ? `${label(top)}, a card at Omni Cardworks` : 'Omni Cardworks workshop')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${esc(to)}">
<link rel="canonical" href="${esc(origin + to)}">
<style>body{background:#140c06;color:#f6e8cf;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh}a{color:#ffb357}</style>
</head><body><p><a href="${esc(to)}">Open Omni Cardworks</a></p></body></html>`;
}

// ---------- the picture: 1200 x 630, the backdrop and up to three cards
const W = 1200, H = 630;
async function fetchImg(url, fetcher) {
  const r = await fetcher(url, { signal: AbortSignal.timeout(7000), redirect: 'error' });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const len = +r.headers.get('content-length') || 0;
  if (len > 6e6) throw new Error('image too big');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 6e6) throw new Error('image too big');
  return buf;
}
/** The picture as a JPEG buffer; null when no card picture loads (the caller then sends the site's own). */
export async function picture(cards, { backdrop, sharp, fetcher = fetch }) {
  const shown = cards.slice(0, PICTURED).map((c) => ({ c, url: imageUrl(c.image) })).filter((x) => x.url);
  const bufs = (await Promise.allSettled(shown.map((x) => fetchImg(x.url, fetcher)))).map((x) => (x.status === 'fulfilled' ? x.value : null));
  const ok = bufs.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) return null;
  // the best in the middle, the next two behind it, tilted out
  const slots = ok.length === 1 ? [{ h: 500, x: 0, rot: 0 }] : ok.length === 2 ? [{ h: 480, x: -120, rot: -5 }, { h: 430, x: 170, rot: 7 }] : [{ h: 490, x: 0, rot: 0 }, { h: 410, x: -300, rot: -9 }, { h: 410, x: 300, rot: 9 }];
  const layers = [];
  for (let k = ok.length - 1; k >= 0; k--) { // back to front
    const s = slots[k], src = sharp(bufs[ok[k]]).resize({ height: s.h, fit: 'inside' });
    const card = await src.png().toBuffer();
    const meta = await sharp(card).metadata();
    // sharp runs blur and rotate before a composite in the same chain, so each step is its own pass
    const pad = 40, clear = { r: 0, g: 0, b: 0, alpha: 0 };
    const rect = await sharp({ create: { width: meta.width + 2 * pad, height: meta.height + 2 * pad, channels: 4, background: clear } })
      .composite([{ input: { create: { width: meta.width, height: meta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.7 } } }, top: pad + 12, left: pad }]).png().toBuffer();
    const shadow = await sharp(rect).blur(16).png().toBuffer();
    const flat = await sharp(shadow).composite([{ input: card, top: pad, left: pad }]).png().toBuffer();
    const both = await sharp(flat).rotate(s.rot, { background: clear }).png().toBuffer();
    const m = await sharp(both).metadata();
    layers.push({ input: both, left: Math.round(W / 2 + s.x - m.width / 2), top: Math.round(H / 2 - 22 - m.height / 2) });
  }
  return sharp(backdrop).resize(W, H).composite(layers).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}
