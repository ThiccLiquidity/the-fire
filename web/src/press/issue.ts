// The Morning Wood: an issue as the site reads it (issue.json, written by the paper's pipeline in paper/), loading
// it (network first, then the offline copy of an owned issue), and the small Markdown the stories are written in.
//
// The format is paper/schema/issue.schema.json (the paper's pipeline writes it): { date, number, title, motto, edition,
// weatherEar, pages: [{ section, title, layout, accent, blocks, stories: [{ kicker, headline, deck, byline, body,
// pullQuote, image: { src, alt, kind, credit, caption, placeholder, captions, prompt } }] }], markets: { asOf, sample,
// tokens: { PAPER, PLANK }, mills }, letters, classifieds, horoscopes, weather, nft: { opensAt } }. normalize() is
// forgiving: a missing field reads as empty, so a slow section or a half-filled issue still renders.

export type Section = "front" | "plank" | "tanggang" | "crypto" | "trending" | "markets" | "back";
export type ImageKind = "ai" | "meme" | "staff";
/** A picture. src is empty while it's a placeholder (the pipeline's image step hasn't made it): the site draws a
 *  stand-in from the meme's captions or the photo's prompt. */
export interface Picture { src: string; alt: string; kind: ImageKind; credit: string; caption: string; standIn: string }
export interface Story { kicker: string; headline: string; deck: string; byline: string; body: string; pullQuote: string; image: Picture | null }
export interface Page { section: Section | string; title: string; accent: string; layout: "broadsheet" | "tabloid"; stories: Story[]; blocks: string[] }
export interface MarketRow { symbol: string; price: number | null; change24h: number | null; volume24h: number | null; liquidity: number | null; burned24h: number | null; holders: number | null; spark: number[]; stats?: [string, string][] }
export interface Line { text: string; by: string; heading: string; reply: string }
export interface Horoscope { sign: string; text: string }
export interface Weather { city: string; highF: number | null; lowF: number | null; sky: string; quip: string }
export interface Issue {
  date: string; number: number | null; motto: string; edition: string; weatherEar: string; base: string;
  pages: Page[]; markets: { asOf: string; sample: boolean; rows: MarketRow[] };
  letters: Line[]; classifieds: Line[]; horoscopes: Horoscope[]; weather: Weather[];
  saleStart: number | null; saleEnd: number | null;
}
export interface IndexEntry { date: string; number: number | null; headline: string }

export const SECTIONS: Record<string, { name: string; color: string; ink: string }> = {
  front: { name: "Front Page", color: "#1b1712", ink: "#f4ecd8" },
  plank: { name: "PLANK", color: "#e1251b", ink: "#fff" },
  tanggang: { name: "Tang Gang", color: "#ff8a00", ink: "#1b0f00" },
  crypto: { name: "Crypto", color: "#6a2bd9", ink: "#fff" },
  trending: { name: "Trending", color: "#ff2e88", ink: "#fff" },
  markets: { name: "Markets", color: "#0b8f3c", ink: "#fff" },
  back: { name: "Back Page", color: "#ffd400", ink: "#111" },
};
export const sectionOf = (s: string) => SECTIONS[s] ?? { name: s.replace(/^\w/, (c) => c.toUpperCase()), color: "#222", ink: "#fff" };

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const time = (v: unknown): number | null => { const t = typeof v === "number" ? v * (v < 1e12 ? 1000 : 1) : Date.parse(str(v)); return isFinite(t) ? t : null; };

/** A picture's address: ipfs:// through the gateway (CSP img-src allows ipfs.io), a relative path from the issue's folder. */
export function pictureUrl(src: string, base: string): string {
  if (src.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + src.slice(7);
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  return base + src;
}

function story(v: unknown, base: string): Story {
  const s = obj(v), im = s.image ? obj(s.image) : null;
  const kind = str(im?.kind), src = im && !im.placeholder ? str(im.src) : "";
  const standIn = im ? (arr(im.captions).map(str).filter(Boolean).join(" / ") || str(im.caption) || str(im.alt) || str(im.prompt)) : "";
  return {
    kicker: str(s.kicker), headline: str(s.headline), deck: str(s.deck), byline: str(s.byline), body: str(s.body), pullQuote: str(s.pullQuote),
    image: im && (src || standIn) ? { src: src ? pictureUrl(src, base) : "", alt: str(im.alt), kind: (kind === "meme" || kind === "staff" ? kind : "ai"), credit: str(im.credit), caption: str(im.caption), standIn } : null,
  };
}

/** 6:00 in the morning in New York on that date (the paper goes on sale then), as ms. */
export function nyMorning(date: string): number {
  const guess = Date.parse(date + "T10:00:00Z"); // 6am EDT
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(guess));
  return guess + (6 - hour) * 3_600_000; // EST: 11:00Z
}

export function normalize(raw: unknown, base: string): Issue {
  const j = obj(raw), m = obj(j.markets);
  const row = (o: Record<string, unknown>, symbol: string): MarketRow => ({
    symbol: str(o.symbol) || symbol, price: num(o.priceUsd ?? o.price), change24h: num(o.change24hPct ?? o.change24h), volume24h: num(o.volume24hUsd ?? o.volume24h),
    liquidity: num(o.liquidityUsd ?? o.liquidity), burned24h: num(o.burned24h), holders: num(o.holders), spark: arr(o.spark).map(num).filter((x): x is number => x != null),
  });
  const tokens = m.tokens;
  const rows: MarketRow[] = Array.isArray(tokens) || Array.isArray(m.rows) ? arr(m.rows ?? tokens).map((r) => row(obj(r), ""))
    : Object.entries(obj(tokens)).map(([k, v]) => row(obj(v), k));
  if (m.mills && typeof m.mills === "object") { // Paper Mills: an NFT, so its own numbers
    const ml = obj(m.mills), f = (v: unknown, unit = "") => (num(v) == null ? "—" : `${num(v)!.toLocaleString("en-US", { maximumFractionDigits: 4 })}${unit}`);
    rows.push({ symbol: str(ml.name) || "Paper Mills", price: null, change24h: null, volume24h: null, liquidity: null, burned24h: null, holders: num(ml.holders), spark: [],
      stats: [["Live", f(ml.live)], ["Holders", f(ml.holders)], ["Floor", f(ml.floorEth, " ETH")], ["Backing", num(ml.backingUsd) == null ? "—" : "$" + f(ml.backingUsd)]] });
  }
  const line = (v: unknown): Line => {
    if (typeof v === "string") return { text: v, by: "", heading: "", reply: "" };
    const o = obj(v);
    return { text: str(o.text), by: str(o.name ?? o.by), heading: str(o.heading), reply: str(o.reply) };
  };
  return {
    date: str(j.date), number: num(j.number), motto: str(j.motto) || "Hard News, Every Morning", edition: str(j.edition), weatherEar: str(j.weatherEar), base,
    pages: arr(j.pages).map((p) => {
      const o = obj(p), section = str(o.section) || "front";
      const accent = /^#[0-9a-f]{6}$/i.test(str(o.accent)) ? str(o.accent) : "";
      return { section, title: str(o.title), accent, layout: o.layout === "broadsheet" || (!o.layout && section === "front") ? "broadsheet" : "tabloid", stories: arr(o.stories).map((s) => story(s, base)), blocks: arr(o.blocks).map(str) } as Page;
    }),
    markets: { asOf: str(m.asOf), sample: m.sample === true || str(m.source) === "sample" || str(m.source) === "mock", rows },
    weather: arr(j.weather).map((w) => { const o = obj(w); return { city: str(o.city), highF: num(o.highF), lowF: num(o.lowF), sky: str(o.sky), quip: str(o.quip) }; }),
    letters: arr(j.letters).map(line), classifieds: arr(j.classifieds).map(line),
    horoscopes: arr(j.horoscopes).map((h) => (typeof h === "string" ? { sign: "", text: h } : { sign: str(obj(h).sign), text: str(obj(h).text) })),
    saleStart: time(j.saleStart ?? obj(j.nft).opensAt), saleEnd: time(j.saleEnd),
  };
}

// ---------- loading
export const ISSUES = "/press/issues/";
export const OFFLINE_CACHE = "press-issues-v1";

async function getJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (r.ok) return await r.json();
    throw new Error(`${r.status}`);
  } catch (e) {
    // offline: an owned issue's saved copy (cacheIssue), else the service worker's copy
    try { const hit = await caches.match(url); if (hit) return await hit.json(); } catch { /* no Cache API */ }
    throw e;
  }
}

export async function loadIndex(): Promise<IndexEntry[]> {
  return arr(await getJson(ISSUES + "index.json")).map((e) => { const o = obj(e); return { date: str(o.date), number: num(o.number), headline: str(o.headline) }; }).filter((e) => e.date);
}

const loaded = new Map<string, Promise<Issue>>();
export function loadIssue(date: string): Promise<Issue> {
  let p = loaded.get(date);
  if (!p) {
    const base = `${ISSUES}${date}/`;
    p = getJson(base + "issue.json").then((j) => normalize(j, base));
    loaded.set(date, p);
    p.catch(() => loaded.delete(date));
  }
  return p;
}

/** Keep an owned issue for offline reading: its issue.json and every picture, in the Cache API (the service worker
 *  serves them from there too). Best effort. */
export async function cacheIssue(issue: Issue): Promise<void> {
  try {
    const c = await caches.open(OFFLINE_CACHE);
    const urls = [issue.base + "issue.json", ...issue.pages.flatMap((p) => p.stories.flatMap((s) => (s.image?.src && !/^https?:/.test(s.image.src) ? [s.image.src] : [])))];
    await Promise.all(urls.map(async (u) => { if (!(await c.match(u))) await c.add(u); }));
  } catch { /* private window, quota: reading online still works */ }
}

export async function isCached(issue: Issue): Promise<boolean> {
  try { return !!(await (await caches.open(OFFLINE_CACHE)).match(issue.base + "issue.json")); } catch { return false; }
}

// ---------- words
export const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The stories' Markdown: paragraphs, **bold**, *italic*, > quotes and - lists. Everything is escaped first; no
 *  links or HTML (an issue is content, never code). */
export function markdown(md: string): string {
  const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/_(.+?)_/g, "<i>$1</i>");
  return md.replace(/\r/g, "").split(/\n{2,}/).map((block) => {
    const b = block.trim();
    if (!b) return "";
    if (/^>\s?/.test(b)) return `<blockquote>${inline(b.replace(/^>\s?/gm, ""))}</blockquote>`;
    if (/^[-*]\s/.test(b)) return `<ul>${b.split(/\n/).map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${inline(b).replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

export function longDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return isNaN(+d) ? date : d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
export function shortDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return isNaN(+d) ? date : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
