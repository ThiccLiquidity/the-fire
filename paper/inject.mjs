#!/usr/bin/env node
// Code puts the numbers in, never the writers: draft.json (with {{tokens}}) + newspack.json -> issue.json.
//   node paper/inject.mjs --date YYYY-MM-DD           (paper/out/<date>/{draft,newspack}.json -> issue.json)
//   node paper/inject.mjs --draft <f> --pack <f> --out <f>
// - `markets` is copied from the news pack (plus the site's own 24h numbers) — whatever the draft had is replaced.
// - every {{token}} in any text is filled (lib/tokens.mjs).
// - weather numbers come from the pack; the draft keeps only its quips (matched by city).
// - letters/classifieds that cite a chain letter (`tx`) get the sender's exact text and name back from the pack.
import { resolve } from "node:path";
import { PAPER_DIR, args, issueDate, readJson, writeJson } from "./lib/util.mjs";
import { fill } from "./lib/tokens.mjs";

export function inject(draft, pack) {
  const markets = { ...pack.markets, site: { copiesSold24h: pack.site?.copiesSold24h ?? null, packsSold24h: pack.site?.packsSold24h ?? null, paperBurnedByBurner24h: pack.site?.paperBurnedByBurner24h ?? null } };
  const ctx = { markets, site: markets.site, weather: pack.weather };
  const missing = [];
  const walk = (v) => {
    if (typeof v === "string") return fill(v, ctx, missing);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "markets" ? x : walk(x)]));
    return v;
  };
  const out = walk(structuredClone(draft));
  out.markets = markets;
  if (pack.weather?.length) {
    const quips = Object.fromEntries((draft.weather ?? []).map((w) => [w.city, w.quip]));
    out.weather = pack.weather.map((w) => ({ city: w.city, highF: w.highF, lowF: w.lowF, sky: w.sky, rainPct: w.rainPct ?? null, ...(quips[w.city] ? { quip: fill(quips[w.city], ctx, missing) } : {}) }));
  }
  const byTx = new Map((pack.site?.letters ?? []).filter((l) => l.tx).map((l) => [l.tx, l]));
  for (const list of [out.letters ?? [], out.classifieds ?? []]) {
    for (const l of list) {
      const src = l.tx && byTx.get(l.tx);
      if (src) Object.assign(l, { text: src.text.replace(/^\s*AD:\s*/i, ""), name: src.name, from: src.from });
    }
  }
  return { issue: out, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const date = issueDate(a.date);
  const dir = resolve(PAPER_DIR, "out", date);
  const { issue, missing } = inject(readJson(a.draft ?? resolve(dir, "draft.json")), readJson(a.pack ?? resolve(dir, "newspack.json")));
  const out = a.out ?? resolve(dir, "issue.json");
  writeJson(out, issue);
  console.log(`numbers injected -> ${out}${issue.markets.sample ? "  [SAMPLE numbers]" : ""}`);
  if (missing.length) console.log(`  no number for: ${[...new Set(missing)].join(", ")} (printed as [n/a])`);
}
