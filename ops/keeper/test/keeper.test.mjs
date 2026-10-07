// Unit tests for the keeper's pure parts (node --test). The whole keeper runs end to end in ops/rehearsal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAND_CHAIN, DRAND_GENESIS, drandClient, roundAt, roundTime } from "../src/drand.mjs";
import { createNotifier } from "../src/alerts.mjs";
import { loadConfig, loadKey } from "../src/config.mjs";

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("drand round times match OpenDrandRouter (genesis 1727521075, 3 s rounds)", () => {
  assert.equal(roundTime(1n), DRAND_GENESIS);
  assert.equal(roundTime(1000n), 1727521075n + 999n * 3n);
  assert.equal(roundAt(roundTime(1000n)), 1000n);
  assert.equal(roundAt(roundTime(1000n) + 2n), 1000n);
  assert.equal(roundAt(roundTime(1000n) + 3n), 1001n);
});

test("drand client: falls through relays, checks the round and the signature, caches", async () => {
  const sig = "ab".repeat(64);
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.startsWith("https://a")) return json(500, {});
    if (url.startsWith("https://b")) return json(200, { round: 7, signature: "zz" }); // wrong round, bad signature
    return json(200, { round: 5, signature: sig });
  };
  const d = drandClient(["https://a", "https://b/", "https://c"], fetchFn);
  assert.equal(await d.signature(5n), `0x${sig}`);
  assert.deepEqual(calls, [`https://a/${DRAND_CHAIN}/public/5`, `https://b/${DRAND_CHAIN}/public/5`, `https://c/${DRAND_CHAIN}/public/5`]);
  await d.signature(5n);
  assert.equal(calls.length, 3, "cached");
  const none = drandClient(["https://a"], async () => json(404, {}));
  assert.equal(await none.signature(9n), undefined);
});

test("drand client: latest is the newest round any relay reports", async () => {
  const d = drandClient(["https://a", "https://b", "https://c"], async (url) => {
    if (url.startsWith("https://a")) throw new Error("down");
    return json(200, { round: url.startsWith("https://b") ? 100 : 105 });
  });
  assert.equal(await d.latest(), 105n);
  assert.equal(await drandClient(["https://a"], async () => { throw new Error("x"); }).latest(), undefined);
});

function notifier(cfg, clock) {
  const posts = [];
  const pings = [];
  const fetchFn = async (url, init) => {
    if (url === "https://hook") posts.push(JSON.parse(init.body));
    else pings.push(url);
    return { ok: true, status: 200 };
  };
  const n = createNotifier({ cfg: { label: "keeper", chainId: 4663, alertRepeatMin: 60, heartbeatHours: 24, intervalSec: 20, webhookUrl: "https://hook", heartbeatUrl: "https://hc/x", ...cfg }, log: () => {}, fetchFn, clock });
  return { n, posts, pings };
}

test("alerts: new, repeated hourly, resolved; heartbeat once a day; dead-man's switch pinged", async () => {
  let t = 1_000_000_000_000;
  const { n, posts, pings } = notifier({}, () => t);
  const a = { key: "feed:plank", text: "PLANK price stale" };
  await n.report([a], { address: "0xk", balance: 10n ** 17n, series: [7n] });
  assert.equal(posts.length, 2, "the alert and the start-up heartbeat");
  assert.match(posts[0].content, /PLANK price stale/);
  assert.equal(posts[0].content, posts[0].text, "same text for Discord (content) and Slack/Telegram (text)");
  assert.match(posts[1].content, /heartbeat/);
  assert.equal(pings.at(-1), "https://hc/x/fail");
  t += 10 * 60_000;
  await n.report([a]);
  assert.equal(posts.length, 2, "not repeated within the hour");
  t += 51 * 60_000;
  await n.report([a]);
  assert.match(posts.at(-1).content, /still: PLANK price stale/);
  t += 60_000;
  await n.report([]);
  assert.match(posts.at(-1).content, /resolved: PLANK price stale/);
  assert.equal(pings.at(-1), "https://hc/x");
  await n.report([{ key: "note", text: "just a note", quiet: true }]);
  assert.doesNotMatch(posts.at(-1).content, /just a note/, "quiet notes are logged only");
});

test("alerts in one-pass mode (the backup): only in the first minutes of each hour, except 'backup acted'", async () => {
  const hour = 3_600_000;
  let t = 10 * hour + 30 * 60_000; // half past
  const { n, posts } = notifier({ once: true, label: "backup" }, () => t);
  await n.report([{ key: "feed:plank", text: "PLANK price stale" }]);
  assert.equal(posts.length, 0);
  await n.report([{ key: "backup-acted", text: "the backup keeper had to step in" }]);
  assert.equal(posts.length, 1);
  t = 11 * hour + 60_000;
  await n.report([{ key: "feed:plank", text: "PLANK price stale" }]);
  assert.equal(posts.length, 2);
  assert.match(posts[1].content, /\[backup\]/);
});

test("config: addresses from the deployments file, env overrides, readable errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-"));
  const file = join(dir, "4663.json");
  const a = (n) => `0x${String(n).repeat(40)}`;
  writeFileSync(file, JSON.stringify({
    chainId: 4663, startBlock: 123, inputs: { ETH_USD_FEED: a(9) },
    contracts: { PlankUsdTwap: a(1), PaperUsdTwap: a(2), FireCards: a(3), FirePsa: a(4), PaperBurner: a(5), PlankBurner: a(6) },
  }));
  const cfg = loadConfig({ RPC_URL: "https://rpc", DEPLOYMENTS_FILE: file, FIRE_CARDS: a(7) });
  assert.equal(cfg.contracts.cards, a(7), "env override");
  assert.equal(cfg.contracts.psa, a(4));
  assert.equal(cfg.startBlock, 123n);
  assert.deepEqual(cfg.rpcUrls, ["https://rpc", "https://rpc.mainnet.chain.robinhood.com"], "public RPC as fallback on mainnet");
  assert.equal(cfg.ethUsdFeed, a(9));
  assert.equal(loadConfig({ RPC_URL: "https://rpc", DEPLOYMENTS_FILE: file, FALLBACK_RPC_URL: "none" }).rpcUrls.length, 1);
  assert.throws(() => loadConfig({ DEPLOYMENTS_FILE: file }), /RPC_URL/);
  assert.throws(() => loadConfig({ RPC_URL: "x", DEPLOYMENTS_FILE: join(dir, "none.json") }), /deploy first/);
});

test("key: only from KEEPER_PRIVATE_KEY, checked, never echoed", () => {
  assert.throws(() => loadKey({}), /KEEPER_PRIVATE_KEY/);
  const bad = "0x1234";
  assert.throws(() => loadKey({ KEEPER_PRIVATE_KEY: bad }), (e) => !e.message.includes(bad));
  const k = "11".repeat(32);
  assert.equal(loadKey({ KEEPER_PRIVATE_KEY: ` ${k}\n` }), `0x${k}`);
});
