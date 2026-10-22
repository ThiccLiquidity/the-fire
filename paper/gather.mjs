#!/usr/bin/env node
// Step 1 of the nightly run: gather everything into one news pack (paper/out/<date>/newspack.json).
//   node paper/gather.mjs [--date YYYY-MM-DD] [--mock] [--out <file>]
// --mock: no network at all (mock feeds, X posts, markets, letters, weather), every part marked mock. Without --mock,
// each source is tried and a source that fails is noted in meta.notes (and left empty, never invented); X falls back to
// mock posts only when TWITTERAPI_IO_KEY is unset.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAPER_DIR, args, env, issueDate, issueNumber, loadEnv, readJson, soft, writeJson } from "./lib/util.mjs";
import { readFeed } from "./lib/rss.mjs";
import { gatherX, mockX } from "./lib/x.mjs";
import { gatherMarkets, mockMarkets } from "./lib/markets.mjs";
import { gatherSite, mockSite } from "./lib/site.mjs";
import { gatherWeather, mockWeather } from "./lib/weather.mjs";
import { deployments } from "./lib/chain.mjs";

const MOCK_NEWS = [
  { desk: "crypto", source: "mock", title: "Bitcoin slips under $81,000 as liquidations top $400 million", summary: "Longs wiped out after hot inflation data." },
  { desk: "crypto", source: "mock", title: "Ether falls 9% on the week; ETF outflows continue", summary: "ETH funds lead the outflows." },
  { desk: "crypto", source: "mock", title: "MSCI rules could drop crypto treasury companies from indexes", summary: "Strategy, Metaplanet named." },
  { desk: "world", source: "mock", title: "Brent crude tops $111 as Middle East attacks persist", summary: "Oil shock revives inflation fears." },
  { desk: "politics", source: "mock", title: "Super PAC spending passes $400 million ahead of midterms", summary: "Attack ads everywhere." },
  { desk: "culture", source: "mock", title: "Clip of pop star arguing with autograph seeker goes viral", summary: "Internet takes sides." },
  { desk: "world", source: "mock", title: "Chiricahua named 64th U.S. national park", summary: "Rock formations, finally famous." },
].map((n, i) => ({ ...n, link: "", published: new Date(Date.now() - i * 3_600_000).toISOString(), feed: "mock", mock: true }));

function memory() {
  const dir = resolve(PAPER_DIR, "memory");
  const jokes = existsSync(resolve(dir, "running-jokes.md")) ? readFileSync(resolve(dir, "running-jokes.md"), "utf8") : "";
  const past = existsSync(resolve(dir, "past-issues.json")) ? readJson(resolve(dir, "past-issues.json")) : [];
  return { runningJokes: jokes, recentIssues: past.slice(-7) };
}

export async function gather({ date, mock }) {
  loadEnv();
  const cfg = readJson(resolve(PAPER_DIR, "config/sources.json"));
  const notes = [];
  const number = issueNumber(date);
  const dep = deployments();

  const news = [];
  if (mock) news.push(...MOCK_NEWS);
  else {
    const results = await Promise.all(cfg.rss.map((f) => soft(`rss ${f.id}`, () => readFeed(f, { perFeed: cfg.rssPerFeed }), [], notes)));
    const seen = new Set();
    for (const it of results.flat()) {
      const k = it.title.toLowerCase().slice(0, 80);
      if (!seen.has(k)) { seen.add(k); news.push(it); }
    }
  }

  const xKey = mock ? undefined : env("TWITTERAPI_IO_KEY");
  const x = mock ? mockX(cfg.x) : await gatherX(cfg.x, xKey, notes);
  if (x.mock && !mock) notes.push("x: TWITTERAPI_IO_KEY not set, mock posts used");

  const markets = mock ? mockMarkets() : await soft("markets", () => gatherMarkets(dep, cfg, notes), { ...mockMarkets(), source: "unavailable", sample: true }, notes);
  const site = mock ? mockSite() : await soft("site", () => gatherSite(dep, { prevIssue: number - 1 }, notes), { letters: [], copiesSold24h: null, packsSold24h: null, paperBurnedByBurner24h: null, unavailable: true }, notes);
  const weather = mock ? mockWeather(cfg.weather) : await gatherWeather(cfg.weather, notes);

  return {
    meta: { kind: "morning-wood/newspack", version: 1, date, number, gatheredAt: new Date().toISOString(), mock: Boolean(mock), notes, x: { mock: x.mock, billed: x.billed, estCostUsd: x.estCostUsd } },
    news: { crypto: news.filter((n) => n.desk === "crypto"), world: news.filter((n) => n.desk === "world"), politics: news.filter((n) => n.desk === "politics"), culture: news.filter((n) => n.desk === "culture") },
    x: { posts: x.posts, searches: x.searches, accounts: cfg.x.accounts },
    markets,
    site,
    weather,
    memory: memory(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const date = issueDate(a.date);
  const pack = await gather({ date, mock: Boolean(a.mock) });
  const out = a.out ?? resolve(PAPER_DIR, "out", date, "newspack.json");
  writeJson(out, pack);
  const n = Object.values(pack.news).reduce((s, l) => s + l.length, 0);
  console.log(`news pack for issue #${pack.meta.number} (${date})${pack.meta.mock ? " [MOCK]" : ""}: ${n} headlines, ${pack.x.posts.length} X posts${pack.meta.x.mock ? " (mock)" : ` (~$${pack.meta.x.estCostUsd})`}, markets ${pack.markets.source}, ${pack.site.letters.length} letters, ${pack.weather.length} cities`);
  for (const w of pack.meta.notes) console.log(`  note: ${w}`);
  console.log(`-> ${out}`);
}
