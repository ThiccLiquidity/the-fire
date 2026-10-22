import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PAPER_DIR, readJson, issueNumber } from "../lib/util.mjs";
import { gather } from "../gather.mjs";
import { inject } from "../inject.mjs";
import { check } from "../check.mjs";
import { fill, format } from "../lib/tokens.mjs";
import { parseFeed } from "../lib/rss.mjs";
import { decodeString, u256Word } from "../lib/chain.mjs";
import { opensAt } from "../publish.mjs";
import { frontSvg, previewHtml, metadata } from "../layout.mjs";

const SAMPLE = resolve(PAPER_DIR, "samples/2026-10-22");

test("gather --mock: every part present, marked mock, no network", async () => {
  const p = await gather({ date: "2026-10-23", mock: true });
  assert.equal(p.meta.mock, true);
  assert.equal(p.meta.number, 2);
  assert.ok(p.news.crypto.length && p.news.world.length);
  assert.ok(p.x.posts.length >= 12 && p.x.posts.every((x) => x.mock));
  assert.equal(p.markets.sample, true);
  assert.ok(p.markets.tokens.PAPER.priceUsd && p.markets.tokens.PLANK.priceUsd);
  assert.ok(p.weather.length);
});

test("issue numbers start at 1 on 2026-10-22", () => {
  assert.equal(issueNumber("2026-10-22"), 1);
  assert.equal(issueNumber("2026-11-21"), 31);
});

test("tokens: numbers formatted by field, missing ones flagged", () => {
  assert.equal(format("change24hPct", -11.62), "−11.6%");
  assert.equal(format("priceUsd", 0.00000000094), "$0.00000000094");
  assert.equal(format("priceUsd", 0.000412), "$0.000412");
  assert.equal(format("liquidityUsd", 133000), "$133,000");
  assert.equal(format("highF", 61.4), "61°F");
  const missing = [];
  const ctx = { markets: { tokens: { PLANK: { priceUsd: 1.5 } } }, weather: [{ city: "New York", highF: 60 }] };
  assert.equal(fill("{{PLANK.priceUsd}} {{weather.New York.highF}} {{PAPER.holders}}", ctx, missing), "$1.50 60°F [n/a]");
  assert.deepEqual(missing, ["PAPER.holders"]);
});

test("the sample: draft passes --draft, inject reproduces issue.json, issue passes check, publish refuses it", () => {
  const draft = readJson(resolve(SAMPLE, "draft.json"));
  const pack = readJson(resolve(SAMPLE, "newspack.json"));
  assert.deepEqual(check(draft, { draft: true, dir: SAMPLE }).errors, []);
  const { issue, missing } = inject(draft, pack);
  assert.deepEqual(missing, []);
  assert.deepEqual(issue, readJson(resolve(SAMPLE, "issue.json")));
  assert.deepEqual(check(issue, { dir: SAMPLE }).errors, []);
  const pub = check(issue, { publish: true, dir: SAMPLE }).errors;
  assert.ok(pub.some((e) => e.includes("SAMPLE numbers")));
  assert.ok(pub.some((e) => e.includes("placeholder")));
});

test("check catches typed digits on the markets page and missing sections", () => {
  const draft = readJson(resolve(SAMPLE, "draft.json"));
  draft.pages.find((p) => p.section === "markets").stories[0].body += " PLANK did 12% today.";
  draft.pages = draft.pages.filter((p) => p.section !== "tanggang");
  const { errors } = check(draft, { draft: true });
  assert.ok(errors.some((e) => e.includes("digits outside")));
  assert.ok(errors.some((e) => e.includes("missing section: tanggang")));
});

test("inject: chain letters keep the sender's exact text", () => {
  const draft = readJson(resolve(SAMPLE, "draft.json"));
  draft.letters = [{ name: "x", text: "an AI paraphrase", tx: "0xabc" }];
  const pack = { ...readJson(resolve(SAMPLE, "newspack.json")), site: { letters: [{ tx: "0xabc", from: "0x1", name: "plankmaxi", text: "the real words" }] } };
  const { issue } = inject(draft, pack);
  assert.equal(issue.letters[0].text, "the real words");
  assert.equal(issue.letters[0].name, "plankmaxi");
});

test("rss: RSS and Atom", () => {
  const rss = `<rss><channel><item><title><![CDATA[Bitcoin &amp; friends]]></title><link>https://x/1</link><pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss>`;
  const [a] = parseFeed(rss);
  assert.equal(a.title, "Bitcoin & friends");
  assert.equal(a.link, "https://x/1");
  const atom = `<feed><entry><title>T</title><link href="https://y/2"/><updated>2026-10-21T10:00:00Z</updated></entry></feed>`;
  assert.equal(parseFeed(atom)[0].link, "https://y/2");
});

test("abi: decodes a Letter event's string", () => {
  const text = "Dear Editor, gm";
  const hex = Buffer.from(text).toString("hex");
  const data = "0x" + u256Word(32) + u256Word(text.length) + hex.padEnd(64, "0");
  assert.equal(decodeString(data), text);
});

test("opensAt: 6am New York", () => {
  assert.equal(new Date(opensAt("2026-10-23", 6) * 1000).toISOString(), "2026-10-23T10:00:00.000Z"); // EDT
  assert.equal(new Date(opensAt("2026-12-01", 6) * 1000).toISOString(), "2026-12-01T11:00:00.000Z"); // EST
});

test("layout: front page svg, preview and metadata", () => {
  const issue = readJson(resolve(SAMPLE, "issue.json"));
  const svg = frontSvg(issue, SAMPLE);
  assert.ok(svg.includes("The Morning Wood") && svg.includes("SATIRE") && svg.includes("Hard News, Every Morning"));
  assert.ok(previewHtml(issue).includes("SAMPLE NUMBERS"));
  assert.equal(metadata(issue).attributes.find((a) => a.trait_type === "Issue").value, 1);
});
