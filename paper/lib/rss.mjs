// RSS/Atom without dependencies: enough for news headlines (title, link, date, summary).
import { fetchText } from "./util.mjs";

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

/** Parses RSS 2.0 <item> or Atom <entry> blocks. */
export function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    let link = tag(b, "link");
    if (!link) link = (b.match(/<link[^>]*href="([^"]+)"/i) ?? [])[1] ?? "";
    const date = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date");
    const t = Date.parse(date);
    return {
      title: tag(b, "title"),
      link,
      published: Number.isNaN(t) ? null : new Date(t).toISOString(),
      summary: (tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded")).slice(0, 400),
    };
  }).filter((i) => i.title);
}

export async function readFeed(feed, { perFeed = 12, sinceMs = 36 * 3_600_000 } = {}) {
  const items = parseFeed(await fetchText(feed.url));
  const cutoff = Date.now() - sinceMs;
  return items
    .filter((i) => !i.published || Date.parse(i.published) >= cutoff)
    .slice(0, perFeed)
    .map((i) => ({ ...i, source: feed.name, feed: feed.id, desk: feed.desk }));
}
