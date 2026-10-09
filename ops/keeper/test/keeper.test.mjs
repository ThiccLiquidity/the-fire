// Unit tests for the keeper's pure parts (node --test). The whole keeper runs end to end in ops/rehearsal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAND_CHAIN, DRAND_GENESIS, drandClient, roundAt, roundTime } from "../src/drand.mjs";
import { createNotifier } from "../src/alerts.mjs";
import { loadConfig, loadKey } from "../src/config.mjs";
import { createSender } from "../src/tx.mjs";

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

test("alerts in one-pass mode without a state file: in the first 15 minutes of each hour (a late GitHub run still lands), events always", async () => {
  const hour = 3_600_000;
  let t = 10 * hour + 30 * 60_000; // half past
  const { n, posts } = notifier({ once: true, label: "backup", intervalSec: 300 }, () => t);
  await n.report([{ key: "feed:plank", text: "PLANK price stale" }]);
  assert.equal(posts.length, 0);
  await n.report([], undefined, [{ key: "backup-acted", text: "the backup keeper had to step in" }]);
  assert.equal(posts.length, 1);
  t = 11 * hour + 12 * 60_000; // a scheduled run 12 minutes late
  await n.report([{ key: "feed:plank", text: "PLANK price stale" }]);
  assert.equal(posts.length, 2);
  assert.match(posts[1].content, /\[backup\]/);
});

test("alerts in one-pass mode with STATE_FILE: the memory survives between runs (new, still, resolved, once a day)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-state-"));
  const stateFile = join(dir, "state.json");
  let t = 1_000_000_000_000;
  const run = () => notifier({ once: true, label: "backup", stateFile }, () => t);
  const a = { key: "feed:plank", text: "PLANK price stale" };
  let r = run();
  await r.n.report([a], { address: "0xk", balance: 1n });
  assert.equal(r.posts.length, 2, "the alert and the daily heartbeat");
  t += 5 * 60_000;
  r = run();
  await r.n.report([a]);
  assert.equal(r.posts.length, 0, "a new process remembers it already posted");
  t += 60 * 60_000;
  r = run();
  await r.n.report([a]);
  assert.match(r.posts[0].content, /still: PLANK price stale/);
  t += 5 * 60_000;
  r = run();
  await r.n.report([]);
  assert.match(r.posts[0].content, /resolved/);
});

test("alerts: a pause is posted once (no hourly repeat) and doesn't fail the dead-man's switch; events are rate-limited per key", async () => {
  let t = 1_000_000_000_000;
  const { n, posts, pings } = notifier({ heartbeatHours: 1e9 }, () => t);
  const p = { key: "pause:sale", repeat: false, text: "FireSale is PAUSED" };
  await n.report([p]);
  assert.equal(posts.length, 1);
  assert.equal(pings.at(-1), "https://hc/x", "a pause is the owner's choice, not a keeper failure");
  t += 3 * 3_600_000;
  await n.report([p]);
  assert.equal(posts.length, 1, "no 'still' line for a pause");
  await n.report([]);
  assert.match(posts.at(-1).content, /resolved: FireSale is PAUSED/);
  const ev = { key: "backup-acted", text: "the backup keeper had to step in" };
  await n.report([], undefined, [ev]);
  await n.report([], undefined, [ev]);
  assert.equal(posts.filter((x) => /step in/.test(x.content)).length, 1, "the same event at most once an hour");
  await n.report([], undefined, [{ key: "source:FireCards:0xb", text: "FireCards' randomness source was SWITCHED" }]);
  assert.match(posts.at(-1).content, /SWITCHED/);
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

test("config: KEEPER_ROLE=backup waits 5 min and yields; production needs HEARTBEAT_URL and ALERT_WEBHOOK_URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-"));
  const file = join(dir, "46630.json");
  const a = (n) => `0x${String(n).repeat(40)}`;
  writeFileSync(file, JSON.stringify({
    chainId: 46630, contracts: { PlankUsdTwap: a(1), PaperUsdTwap: a(2), FireCards: a(3), FirePsa: a(4), PaperBurner: a(5), PlankBurner: a(6), FireSale: a(7), CardsAdapter: a(8) },
  }));
  const base = { RPC_URL: "https://rpc", DEPLOYMENTS_FILE: file, CHAIN_ID: "46630" };
  const main = loadConfig(base);
  assert.equal(main.role, "main");
  assert.equal(main.actAfterSec, 0n);
  assert.equal(main.yieldMs, 0);
  assert.equal(main.label, "keeper");
  assert.deepEqual(main.rpcUrls, ["https://rpc", "https://rpc.testnet.chain.robinhood.com/rpc"], "the public testnet RPC as fallback");
  assert.equal(main.optional.sale, a(7));
  assert.equal(main.optional.cardsAdapter, a(8));
  const b = loadConfig({ ...base, KEEPER_ROLE: "backup", MAIN_KEEPER_ADDRESS: a(9) });
  assert.equal(b.role, "backup");
  assert.equal(b.actAfterSec, 300n);
  assert.equal(b.label, "backup");
  assert.ok(b.yieldMs > 0);
  assert.equal(b.mainKeeper, a(9));
  assert.equal(loadConfig({ ...base, KEEPER_ROLE: "backup", ACT_AFTER_SEC: "600" }).actAfterSec, 600n);
  assert.throws(() => loadConfig({ ...base, KEEPER_ROLE: "spare" }), /KEEPER_ROLE/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production", ALERT_WEBHOOK_URL: "https://hook" }), /HEARTBEAT_URL/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production", HEARTBEAT_URL: "https://hc" }), /ALERT_WEBHOOK_URL/);
  assert.equal(loadConfig({ ...base, NODE_ENV: "production", HEARTBEAT_URL: "https://hc", ALERT_WEBHOOK_URL: "https://hook" }).production, true);
});

test("sender: start-up replaces transactions an earlier run left waiting (0-ETH to itself, higher fee, bumped if refused)", async () => {
  const me = "0x00000000000000000000000000000000000000aa";
  const sentTx = [];
  let refusals = 1;
  const pub = {
    getTransactionCount: async ({ blockTag }) => (blockTag === "pending" ? 7 : 5),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 100n, maxPriorityFeePerGas: 1n }),
  };
  const wallet = {
    chain: { id: 1 },
    sendTransaction: async (tx) => {
      if (refusals-- > 0) throw new Error("replacement transaction underpriced");
      sentTx.push(tx);
      return `0xhash${tx.nonce}`;
    },
  };
  const s = createSender({ pub, wallet, account: { address: me }, log: () => {} });
  assert.equal(await s.fillNonceGaps(), 2);
  assert.deepEqual(sentTx.map((t) => [t.to, t.value, t.nonce]), [[me, 0n, 5], [me, 0n, 6]]);
  assert.equal(sentTx[0].maxFeePerGas, 400n, "twice today's fee, doubled again after the refusal");
  assert.equal(sentTx[1].maxFeePerGas, 200n);
  assert.equal(s.inflight.size, 2, "tracked like any transaction in flight");
});

test("key: only from KEEPER_PRIVATE_KEY, checked, never echoed", () => {
  assert.throws(() => loadKey({}), /KEEPER_PRIVATE_KEY/);
  const bad = "0x1234";
  assert.throws(() => loadKey({ KEEPER_PRIVATE_KEY: bad }), (e) => !e.message.includes(bad));
  const k = "11".repeat(32);
  assert.equal(loadKey({ KEEPER_PRIVATE_KEY: ` ${k}\n` }), `0x${k}`);
});
