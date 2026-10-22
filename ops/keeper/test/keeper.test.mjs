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
import { createKeeper, dropEndTimes, flushPlan } from "../src/core.mjs";

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

test("alerts: new, repeated hourly, resolved; heartbeat once a day; dead-man's switch pinged as alive", async () => {
  let t = 1_000_000_000_000;
  const { n, posts, pings } = notifier({}, () => t);
  const a = { key: "feed:plank", text: "PLANK price stale" };
  await n.report([a], { address: "0xk", balance: 10n ** 17n, series: [7n] });
  assert.equal(posts.length, 2, "the alert and the start-up heartbeat");
  assert.match(posts[0].content, /PLANK price stale/);
  assert.equal(posts[0].content, posts[0].text, "same text for Discord (content) and Slack/Telegram (text)");
  assert.match(posts[1].content, /heartbeat/);
  assert.equal(pings.at(-1), "https://hc/x", "an alert goes to the webhook; the dead-man's switch only says the keeper is alive");
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

test("heartbeat: alive after every completed pass, even with long-lasting alerts; /fail only when a whole pass failed", async () => {
  let t = 1_000_000_000_000;
  const { n, pings } = notifier({ heartbeatHours: 1e9 }, () => t);
  const soft = [{ key: "balance", text: "keeper is low on gas" }, { key: "waiting:PaperBurner:ETH", text: "PaperBurner holds 0.001 ETH it can't burn yet" }];
  for (let i = 0; i < 5; i++) { await n.report(soft); t += 3_600_000; }
  assert.ok(pings.every((u) => u === "https://hc/x"), "never failing while passes complete");
  await n.report([{ key: "pass", text: "pass failed: RPC down" }], undefined, [], { passFailed: true });
  assert.equal(pings.at(-1), "https://hc/x/fail");
  await n.report([]);
  assert.equal(pings.at(-1), "https://hc/x");
});

test("config: low-balance alert at 0.002 ETH, burner flush minimums, overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-"));
  const file = join(dir, "4663.json");
  const a = (n) => `0x${String(n).repeat(40)}`;
  writeFileSync(file, JSON.stringify({ chainId: 4663, contracts: { PlankUsdTwap: a(1), PaperUsdTwap: a(2), FireCards: a(3), FirePsa: a(4), PaperBurner: a(5), PlankBurner: a(6) } }));
  const base = { RPC_URL: "https://rpc", DEPLOYMENTS_FILE: file };
  const c = loadConfig(base);
  assert.equal(c.lowBalanceEth, 0.002);
  assert.deepEqual([c.minFlushUsd, c.flushEveryMin, c.flushNowX, c.flushMaxWaitHours, c.flushDustUsd, c.gradingLookback], [1, 15, 25, 6, 0.05, 300]);
  const o = loadConfig({ ...base, LOW_BALANCE_ETH: "0.004", MIN_FLUSH_USD: "2.5", FLUSH_EVERY_MIN: "30", FLUSH_NOW_X: "10", FLUSH_MAX_WAIT_HOURS: "12", FLUSH_DUST_USD: "0.1" });
  assert.deepEqual([o.lowBalanceEth, o.minFlushUsd, o.flushEveryMin, o.flushNowX, o.flushMaxWaitHours, o.flushDustUsd], [0.004, 2.5, 30, 10, 12, 0.1]);
});

test("flushPlan: a minimum in dollars, once per FLUSH_EVERY_MIN, at once when large, dust after it waited", () => {
  const cfg = { minFlushUsd: 1, flushEveryMin: 15, flushNowX: 25, flushMaxWaitHours: 6, flushDustUsd: 0.05 };
  const min = 60_000;
  const hour = 3_600_000;
  assert.equal(flushPlan({ usd: 0.000001, waitedMs: 0 }, cfg).go, false, "dust");
  assert.equal(flushPlan({ usd: 0.5, waitedMs: 5 * hour }, cfg).go, false);
  assert.equal(flushPlan({ usd: 1, waitedMs: 0 }, cfg).go, true, "worth the gas");
  assert.equal(flushPlan({ usd: 5, waitedMs: 0, sinceFlushMs: 5 * min }, cfg).go, false, "flushed 5 min ago");
  assert.equal(flushPlan({ usd: 5, waitedMs: 0, sinceFlushMs: 15 * min }, cfg).go, true);
  assert.equal(flushPlan({ usd: 25, waitedMs: 0, sinceFlushMs: 1 * min }, cfg).go, true, "large: at once");
  assert.equal(flushPlan({ usd: 0.06, waitedMs: 6 * hour }, cfg).go, true, "small, but waited long enough");
  assert.equal(flushPlan({ usd: 0.01, waitedMs: 100 * hour }, cfg).go, false, "under the dust floor: waits for more");
  assert.equal(flushPlan({ usd: undefined, waitedMs: hour }, cfg).go, false, "no price: only after the long wait");
  assert.equal(flushPlan({ usd: undefined, waitedMs: 6 * hour }, cfg).go, true);
  assert.equal(flushPlan({ usd: undefined, waitedMs: 7 * hour, sinceFlushMs: 10 * min }, cfg).go, false);
});

test("dropEndTimes: the owner after the longest phase (1 day at least), anyone END_GRACE later", () => {
  const d = { start: 1000n, starterWindow: 3600, liftAfter: 0, holderWindow: 7200, plankOnlyFor: 0, regularWalletsFor: 0 };
  assert.deepEqual(dropEndTimes(d, 86400n, 604800n), { owner: 1000n + 86400n, anyone: 1000n + 86400n + 604800n });
  assert.deepEqual(dropEndTimes({ ...d, regularWalletsFor: 3 * 86400 }, 86400n, 604800n), { owner: 1000n + 3n * 86400n, anyone: 1000n + 10n * 86400n });
});

// ------------------------------------------------------------------ the keeper's jobs against a fake chain
const A = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const ME = A(0xaa);
const CON = { plankTwap: A(1), paperTwap: A(2), cards: A(3), psa: A(4), paperBurner: A(5), plankBurner: A(6) };
const SALE = A(7);
const ETH_FEED = A(8);
const PLANK = A(9);

/** A chain stand-in: reads answered by `reads[functionName](address, args)`, and transactions recorded. */
function fakeChain({ reads, balances = {}, onWrite = () => {} }) {
  const writes = [];
  const read = (address, functionName, args = []) => {
    const f = reads[functionName];
    if (!f) throw new Error(`no fake for ${functionName}`);
    return f(address, args);
  };
  const pub = {
    readContract: async ({ address, functionName, args }) => read(address, functionName, args),
    getBalance: async ({ address }) => balances[address] ?? 0n,
    simulateContract: async ({ address, functionName, args }) => ({ result: reads[`sim:${functionName}`] ? reads[`sim:${functionName}`](address, args) : undefined }),
    estimateContractGas: async () => 100_000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 100n, maxPriorityFeePerGas: 1n }),
    getTransactionCount: async () => writes.length,
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const wallet = {
    chain: { id: 1 },
    writeContract: async (c) => { writes.push({ address: c.address, functionName: c.functionName, args: c.args }); onWrite(c); return `0x${String(writes.length).padStart(64, "0")}`; },
  };
  return { pub, wallet, writes };
}

function keeperOn(chain, cfg = {}) {
  return createKeeper({
    cfg: {
      label: "keeper", chainId: 4663, contracts: CON, ethUsdFeed: ETH_FEED, drandUrls: ["https://drand"], actAfterSec: 0n, gradingLookback: 3,
      minFlushUsd: 1, flushEveryMin: 15, flushNowX: 25, flushMaxWaitHours: 6, flushDustUsd: 0.05, alertRepeatMin: 60, heartbeatHours: 24,
      optional: { sale: SALE }, series: [7n], ...cfg,
    },
    pub: chain.pub, wallet: chain.wallet, account: { address: ME }, log: () => {}, fetchFn: async () => ({ ok: false }),
  });
}

test("burners: dust isn't flushed, $1+ is (once per 15 min), large at once, dust that waited 6 h is; PaperBurner flusher check", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000_000_000 });
  const balances = {};
  const usd = (d) => BigInt(Math.round(d * 1e6)) * 10n ** 12n / 2000n; // ETH wei worth $d at $2,000
  const chain = fakeChain({
    balances,
    reads: {
      PLANK: () => PLANK, USDG: () => "0x0000000000000000000000000000000000000000", flusher: () => false,
      balanceOf: () => 0n, latestRoundData: (a) => [0n, a === ETH_FEED ? 2000n * 10n ** 8n : 0n, 0n, 0n, 0n],
      "sim:flush": (a) => balances[a],
    },
    onWrite: (c) => { balances[c.address] = 0n; },
  });
  const k = keeperOn(chain);
  const flushes = () => chain.writes.filter((w) => w.functionName === "flush").length;
  const pass = async () => { const w = []; await k.jobs.burners(w); return w; };

  balances[CON.plankBurner] = 1000n; // a few wei: an attacker's dust
  await pass();
  assert.equal(flushes(), 0, "dust: no flush");
  balances[CON.plankBurner] = usd(5);
  await pass();
  assert.equal(flushes(), 1, "$5: flushed");
  balances[CON.plankBurner] = usd(5);
  t.mock.timers.tick(5 * 60_000);
  await pass();
  assert.equal(flushes(), 1, "again 5 min later: waits for FLUSH_EVERY_MIN");
  balances[CON.plankBurner] = usd(30);
  await pass();
  assert.equal(flushes(), 2, "$30 (25x the minimum): at once");
  balances[CON.plankBurner] = usd(0.2);
  t.mock.timers.tick(60 * 60_000);
  await pass();
  assert.equal(flushes(), 2, "$0.20: waits");
  t.mock.timers.tick(6 * 3_600_000);
  await pass();
  assert.equal(flushes(), 3, "$0.20 that waited 6 h: flushed so nothing waits forever");

  balances[CON.paperBurner] = usd(5);
  const w = await pass();
  assert.equal(flushes(), 3, "a keeper PaperBurner doesn't allow doesn't flush it");
  assert.ok(w.some((x) => x.notFlusher && x.name === "PaperBurner"), "it alerts instead");
  balances[CON.paperBurner] = 1000n;
  assert.equal((await pass()).length, 0, "no alert for dust");
});

test("burners: the backup flushes only a balance that has waited ACT_AFTER_SEC", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000_000_000 });
  const balances = { [CON.plankBurner]: 10n ** 16n }; // $20
  const chain = fakeChain({
    balances,
    reads: { PLANK: () => PLANK, USDG: () => "0x0000000000000000000000000000000000000000", flusher: () => true, balanceOf: () => 0n, latestRoundData: () => [0n, 2000n * 10n ** 8n, 0n, 0n, 0n], "sim:flush": (a) => balances[a] },
    onWrite: (c) => { balances[c.address] = 0n; },
  });
  const k = keeperOn(chain, { actAfterSec: 300n });
  await k.jobs.burners([]);
  assert.equal(chain.writes.length, 0);
  t.mock.timers.tick(301_000);
  await k.jobs.burners([]);
  assert.equal(chain.writes.length, 1);
});

function dropChain(drop, closeOnEnd = true) {
  const d = { ...drop };
  return fakeChain({
    reads: {
      MIN_DROP_TIME: () => 86400n, END_GRACE: () => 604800n, dropOf: () => d, "sim:endDrop": () => undefined,
    },
    onWrite: (c) => { if (c.functionName === "endDrop" && closeOnEnd) d.closed = true; },
  });
}
const DROP = { start: 1_000_000n, closed: false, starterWindow: 0, liftAfter: 0, holderWindow: 3600, plankOnlyFor: 0, regularWalletsFor: 0 };

test("drops: an unsold drop alerts once the owner may end it, and the keeper ends it once anyone may", async () => {
  const day = 86400n;
  let chain = dropChain(DROP);
  let k = keeperOn(chain);
  assert.deepEqual(await k.jobs.drops(DROP.start + day - 1n), { alerts: [], events: [] }, "too early: nothing");
  const r = await k.jobs.drops(DROP.start + day);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0].text, /Series 7 hasn't sold out; the owner can end it now with FireSale.endDrop\(7\), or anyone can after 1970-01-20 /);
  assert.equal(chain.writes.length, 0, "the keeper can't end it yet");
  const late = DROP.start + 8n * day;
  const r2 = await k.jobs.drops(late);
  assert.deepEqual(chain.writes.map((w) => [w.functionName, w.args]), [["endDrop", [7n]]], "anyone may: the main keeper ends it");
  assert.equal(r2.alerts.length, 0);
  assert.match(r2.events[0].text, /ended the drop/);
  assert.equal((await k.jobs.drops(late)).alerts.length, 0, "closed: nothing more");

  chain = dropChain(DROP);
  k = keeperOn(chain, { actAfterSec: 300n });
  const b = await k.jobs.drops(late + 299n);
  assert.equal(chain.writes.length, 0, "the backup waits its grace");
  assert.match(b.alerts[0].text, /anyone can end it since .*the main keeper ends it/);
  await k.jobs.drops(late + 300n);
  assert.equal(chain.writes.length, 1, "then steps in");

  assert.deepEqual(await keeperOn(dropChain({ ...DROP, closed: true })).jobs.drops(late), { alerts: [], events: [] }, "sold out (closed): nothing");
  assert.deepEqual(await keeperOn(dropChain(DROP), { optional: {} }).jobs.drops(late), { alerts: [], events: [] }, "no FireSale known: nothing");
});

test("gradings: the window plus a sweep from the oldest unfinished, so nothing older than the window is dropped", async () => {
  const done = new Set([0, 2, 3, 4, 5, 6, 7, 9].map(BigInt)); // 1 and 8 unfinished; window 3 (7, 8, 9)
  const chain = fakeChain({ reads: { gradingCount: () => 10n, gradingOf: (_, [i]) => ({ done: done.has(i), ready: false, requestedAt: 100n + i, source: A(0xd), requestId: i, idsHash: "0x" }) } });
  const k = keeperOn(chain, { gradingLookback: 3 });
  const idx = (gs) => gs.map((g) => g.index);
  let gs = await k.jobs.gradingsWaiting(true);
  assert.deepEqual(idx(gs), [1n, 8n], "chunk 0-2 and the window 7-9");
  assert.equal(gs[0].behind, true);
  assert.match(k.jobs.behindAlert().text, /1 unfinished grading\(s\) are older than the newest 3 \(oldest: grading 1\)/);
  assert.deepEqual(idx(await k.jobs.gradingsWaiting()), [1n, 8n], "a rescan in the same pass reads the same chunk");
  assert.deepEqual(idx(await k.jobs.gradingsWaiting(true)), [1n, 8n], "next pass: the oldest unfinished, chunk 3-5 and the window");
  assert.ok(k.jobs.behindAlert(), "grading 1 is still remembered");
  done.delete(5n); // an older one the sweep hasn't reached again: found on its next lap
  done.delete(4n);
  assert.deepEqual(idx(await k.jobs.gradingsWaiting(true)), [1n, 8n], "chunk 6");
  assert.deepEqual(idx(await k.jobs.gradingsWaiting(true)), [1n, 8n], "wraps back to the oldest unfinished: chunk 1-3");
  assert.deepEqual(idx(await k.jobs.gradingsWaiting(true)), [1n, 4n, 5n, 8n], "chunk 4-6 finds 4 and 5");
  assert.match(k.jobs.behindAlert().text, /^3 unfinished/);
  done.add(1n); done.add(4n); done.add(5n);
  assert.deepEqual(idx(await k.jobs.gradingsWaiting(true)), [8n], "all finished");
  await k.jobs.gradingsWaiting(true);
  assert.equal(k.jobs.behindAlert(), undefined);
  const reads = [];
  chain.pub.readContract = async ({ functionName, args }) => { if (functionName === "gradingOf") reads.push(args[0]); return functionName === "gradingCount" ? 10n : { done: done.has(args[0]), ready: false, requestedAt: 0n, source: A(0xd), requestId: 0n, idsHash: "0x" }; };
  for (let i = 0; i < 3; i++) await k.jobs.gradingsWaiting(true);
  const n0 = reads.length;
  await k.jobs.gradingsWaiting(true);
  assert.deepEqual(reads.slice(n0), [8n, 9n], "the floor moved up to grading 8 (unfinished, in the window): only 8 and 9 are read now");
});

test("gradings: one-pass runs read the window only; no backlog alert", async () => {
  const chain = fakeChain({ reads: { gradingCount: () => 10n, gradingOf: (_, [i]) => ({ done: i !== 1n, ready: false, requestedAt: 0n, source: A(0xd), requestId: i, idsHash: "0x" }) } });
  const k = keeperOn(chain, { gradingLookback: 3, once: true });
  assert.deepEqual(await k.jobs.gradingsWaiting(true), []);
  assert.equal(k.jobs.behindAlert(), undefined);
});

test("sale settings: each WalletsSet / FeedsSet from FireSale is one event with the new addresses; the first pass only starts watching", async () => {
  const logs = [];
  const asked = [];
  const chain = fakeChain({ reads: {} });
  chain.pub.getLogs = async ({ address, fromBlock, toBlock }) => { asked.push([address, fromBlock, toBlock]); return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock); };
  const k = keeperOn(chain);
  logs.push({ eventName: "WalletsSet", blockNumber: 90n, transactionHash: "0xold", logIndex: 0, args: { revenue: A(0xe1), plankBurner: CON.plankBurner, paperBurner: CON.paperBurner } });
  assert.deepEqual(await k.jobs.saleSettings(100n), [], "the first pass starts at the next block (the deploy's own WalletsSet isn't replayed)");
  assert.equal(asked.length, 0);
  logs.push({ eventName: "WalletsSet", blockNumber: 101n, transactionHash: "0xa", logIndex: 3, args: { revenue: A(0xe2), plankBurner: A(0xe3), paperBurner: CON.paperBurner } });
  logs.push({ eventName: "FeedsSet", blockNumber: 102n, transactionHash: "0xb", logIndex: 0, args: { ethUsd: ETH_FEED, plankUsd: CON.plankTwap, paperUsd: A(0xe4), router: A(0xe5) } });
  const ev = await k.jobs.saleSettings(102n);
  assert.deepEqual(asked.at(-1), [SALE, 101n, 102n]);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].key, "sale:WalletsSet:0xa:3");
  assert.match(ev[0].text, new RegExp(`wallets were CHANGED.*revenue ${A(0xe2)}, PlankBurner ${A(0xe3)} \\(NOT the deployed PlankBurner ${CON.plankBurner}\\), PaperBurner ${CON.paperBurner} \\(`));
  assert.match(ev[1].text, new RegExp(`price feeds were CHANGED.*PAPER/USD ${A(0xe4)} \\(NOT the deployed PaperUsdTwap.*router ${A(0xe5)}`));
  assert.deepEqual(await k.jobs.saleSettings(102n), [], "each event once");
  assert.deepEqual(await k.jobs.saleSettings(103n), []);
  assert.deepEqual(asked.at(-1), [SALE, 103n, 103n]);
  chain.pub.getLogs = async () => { throw new Error("rpc down"); };
  await assert.rejects(k.jobs.saleSettings(104n));
  chain.pub.getLogs = async ({ fromBlock }) => { asked.push(["retry", fromBlock]); return []; };
  await k.jobs.saleSettings(105n);
  assert.deepEqual(asked.at(-1), ["retry", 104n], "a failed read is retried from the same block");
  assert.deepEqual(await keeperOn(chain, { optional: {} }).jobs.saleSettings(100n), [], "no FireSale known: nothing");
});
