// Unit tests for the sale settings policy (sale-policy.mjs): VerifySeries and launch.mjs both use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  salePolicy, saleWallets, parseAllow, describeSale, usd, pct, paper, hours, dur, coinNames, normSale, saleFromChain, dropDiffs, nftCodeOf,
  DROP_FIELDS, GROUP_FIELDS,
} from "./sale-policy.mjs";

const studio = JSON.parse(readFileSync(new URL("../../contracts/test/cards/recipe-studio-sale.json", import.meta.url), "utf8")).sale;
const reds = (sale, o) => salePolicy(sale, o).filter((p) => p.level === "red").map((p) => p.rule);
const warns = (sale, o) => salePolicy(sale, o).filter((p) => p.level === "warn").map((p) => p.rule);
const withGroup = (i, patch) => ({ ...studio, groups: studio.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
const MILL = `0x${"4".repeat(40)}`;

test("the studio's sale block (the Standard preset: press, PLANK snapshot, everyone, after sell-out) is inside the policy", () => {
  assert.deepEqual(reds(studio), []);
  assert.deepEqual(warns(studio), []);
  assert.deepEqual(salePolicy(studio).map((p) => p.level), Array(19).fill("ok"));
});

test("each rule: RED outside its bounds, per group", () => {
  assert.deepEqual(reds(withGroup(2, { priceUsd: "99999999" })), ["price"], "$0.99");
  assert.deepEqual(reds(withGroup(2, { priceUsd: "1000000001" })), ["price"], "over $10");
  assert.deepEqual(reds(withGroup(2, { priceUsd: "100000000" })), [], "$1 is in");
  assert.deepEqual(reds(withGroup(3, { priceUsd: "1000000000" })), [], "$10 is in");
  assert.deepEqual(reds(withGroup(2, { priceUsd: "0" })), ["price"], "an open group with PAPER only");
  assert.deepEqual(reds(withGroup(1, { priceUsd: "0" })), [], "a holders' group may be PAPER only");
  assert.deepEqual(reds(withGroup(0, { paper: "0" })), ["no-paper"], "free press packs: only with --allow no-paper");
  assert.deepEqual(reds(withGroup(2, { paper: "99999999999999999" })), ["paper-per-pack"]);
  assert.deepEqual(reds(withGroup(2, { perWallet: 51 })), ["wallet-limit"]);
  assert.deepEqual(reds(withGroup(2, { perWallet: 50 })), []);
  assert.deepEqual(reds(withGroup(2, { limitFor: 3599 })), ["limit-lifts"], "under 1 h");
  assert.deepEqual(reds(withGroup(2, { limitFor: 7 * 86400 + 1 })), ["limit-lifts"], "over 7 days");
  assert.deepEqual(reds(withGroup(2, { limitFor: 3600 })), []);
  assert.deepEqual(reds(withGroup(2, { limitFor: 7 * 86400 })), []);
  assert.deepEqual(reds(withGroup(2, { limitFor: undefined })), [], "no timer: the limit holds the whole time");
  assert.deepEqual(reds({ ...studio, plankBurnBps: 0, paperBurnBps: 900 }), ["burn-total", "paper-burn"]);
  assert.deepEqual(reds({ ...studio, plankBurnBps: 9500, paperBurnBps: 1000 }), ["burn-total"], "over 100%");
  assert.deepEqual(reds({ ...studio, plankBurnBps: 0, paperBurnBps: 1000 }), [], "10% all PAPER is in");
  assert.deepEqual(reds({ ...studio, plankBurnBps: 2000, paperBurnBps: 999 }), ["paper-burn"]);
  assert.deepEqual(reds({ ...studio, paperCapUsd: "9999999" }), ["paper-cap"], "under $0.10");
});

test("warnings: no wallet limit in a finite open group, a tax over 10%, an unlimited group idling over 1 h, no PAPER cap", () => {
  assert.deepEqual(warns(withGroup(2, { perWallet: 0 })), ["wallet-limit"]);
  assert.deepEqual(warns(withGroup(3, { perWallet: 0 })), [], "unlimited: its rising price limits it");
  assert.deepEqual(warns(withGroup(0, { perWallet: 0 })), [], "a gated group: the gate limits it");
  assert.deepEqual(warns(withGroup(3, { taxBps: 1001 })), ["tax"]);
  assert.deepEqual(warns(withGroup(3, { taxBps: 1000 })), []);
  assert.deepEqual(warns(withGroup(3, { idle: 3601 })), ["idle"]);
  assert.deepEqual(warns({ ...studio, paperCapUsd: "0" }), ["paper-cap"]);
});

test("hard rules (no --allow): a snapshot group's root, an NFT group's code, a free open group", () => {
  const noRoot = withGroup(1, { root: undefined });
  assert.deepEqual(reds(noRoot), ["snapshot-root"]);
  assert.match(salePolicy(noRoot).find((p) => p.rule === "snapshot-root").text, /GROUP_ROOT_1.*the contract refuses it/);
  assert.deepEqual(reds(noRoot, { roots: { 1: `0x${"1".repeat(64)}` } }), [], "the root batch B sets (GROUP_ROOT_1)");
  assert.deepEqual(reds(studio, { nftCode: { 0: false } }), ["nft-code"]);
  assert.deepEqual(reds(studio, { nftCode: { 0: true } }), []);
  assert.deepEqual(reds(withGroup(2, { priceUsd: "0", paper: "0" }), { allow: parseAllow("price,no-paper") }), ["free-open"]);
  const nothingToLift = withGroup(2, { perWallet: 0 });
  assert.deepEqual(reds(nothingToLift, { allow: parseAllow("limit-lifts") }), ["limit-lifts"], "limitFor with perWallet 0");
  assert.match(salePolicy(nothingToLift).find((p) => p.rule === "limit-lifts").text, /no per-wallet limit to lift.*the contract refuses it/);
});

test("--allow turns a RED rule into an allowed one, by name only", () => {
  const allow = parseAllow("price,wallet-limit");
  const p = salePolicy({ ...withGroup(2, { priceUsd: "5000000000", perWallet: 100 }), paperBurnBps: 0 }, { allow });
  assert.deepEqual(p.filter((x) => x.level === "allowed").map((x) => x.rule), ["price", "wallet-limit"]);
  assert.deepEqual(p.filter((x) => x.level === "red").map((x) => x.rule), ["paper-burn"]);
  assert.match(p.find((x) => x.rule === "paper-burn").text, /--allow paper-burn if meant/);
  assert.match(p.find((x) => x.rule === "price" && x.level === "allowed").text, /^group 3 \(Everyone\): \$50\.00 a pack/);
  assert.throws(() => parseAllow("price,everything"), /no such rule/);
  assert.throws(() => parseAllow("snapshot-root"), /no such rule/, "hard rules can't be allowed");
  assert.equal(parseAllow(undefined).size, 0);
  assert.equal(parseAllow(true).size, 0);
});

test("the wallets: FireSale's must be the deployments file's; FireGroups wired both ways", async () => {
  const a = (n) => `0x${String(n).repeat(40)}`;
  const SALE = a(9);
  const onChain = { revenueWallet: a(1), plankBurner: a(2), paperBurner: a(3), GROUPS: a(5), sale: SALE };
  const read = async (_, __, fn) => onChain[fn];
  const dep = { inputs: { REVENUE_WALLET: a(1) }, contracts: { PlankBurner: a(2), PaperBurner: a(3), FireGroups: a(5) } };
  assert.deepEqual((await saleWallets(read, SALE, dep)).map((w) => w.ok), [true, true, true, true]);
  onChain.revenueWallet = a(4);
  const w = await saleWallets(read, SALE, dep);
  assert.deepEqual(w.map((x) => x.ok), [false, true, true, true]);
  assert.match(w[0].text, /is NOT the deployments file's inputs.REVENUE_WALLET/);
  assert.equal((await saleWallets(read, SALE, { contracts: dep.contracts }))[0].ok, false, "nothing to check against: RED");
  onChain.sale = a(8);
  assert.match((await saleWallets(read, SALE, dep))[3].text, /FireGroups wiring/);
  onChain.sale = SALE;
  assert.equal((await saleWallets(read, SALE, { ...dep, contracts: { ...dep.contracts, FireGroups: undefined } }))[3].ok, false, "no FireGroups recorded");
});

test("NFT groups' collections are looked up; an unresolved press is no code", async () => {
  const s = normSale(studio, { mill: MILL });
  assert.deepEqual(await nftCodeOf(s, async (x) => (x === MILL ? "0x60" : "0x")), { 0: true });
  assert.deepEqual(await nftCodeOf(normSale(studio), async () => "0x60"), { 0: false });
});

test("the LOCK screen shows the drop-wide fields and every group in plain words", () => {
  assert.equal(usd("250000000"), "$2.50");
  assert.equal(usd("10000000"), "$0.10");
  assert.equal(pct(1000), "10%");
  assert.equal(pct(250), "2.5%");
  assert.equal(paper("100000000000000000"), "0.1 PAPER");
  assert.equal(hours(86400), "24 h");
  assert.equal(dur(900), "15 min");
  assert.equal(dur(21600), "6 h");
  assert.equal(dur(30 * 86400), "30 days");
  assert.equal(coinNames(7), "PLANK, ETH, USDG");
  assert.equal(coinNames(2), "ETH");
  const text = describeSale(studio, { start: "Sun 1 Nov", mill: MILL }).join("\n");
  for (const s of ["Opens:                Sun 1 Nov", "Packs:                167 in 3 group(s), plus what the unlimited group sells on top",
    "10% burns PLANK, 20% buys and burns PAPER, 70% to the revenue wallet", "at most $1.00 (paperCapUsd)", "Most per purchase:    50 (maxPerTx)",
    "Regular wallets only: 48 h", "1 credit(s) per picked suggestion; at most 16 in all, 3 per wallet; from group 3 (Everyone)",
    'Group 1 "Paper Press holders":', `holders of NFT ${MILL} (the Paper Press), 1 pack(s) per NFT`, "$0.00 + 1 PAPER (PAPER only) a pack", "- (no dollar price)",
    "Opens:      with the drop", "Max time:   6 h; idle: off", "Leftovers:  to group 3 (Everyone)",
    'Group 2 "PLANK holders":', "wallets in the snapshot (root 0xabab", "Coins:      PLANK", "Per wallet: 5; per purchase: 50 (the drop's)", "Max time:   24 h",
    'Group 3 "Everyone":', "Who:        everyone", "Packs:      77", "Per wallet: 5 for the first 24 h after it opens, then no limit", "Opens:      when group 2 (PLANK holders) ends", "until its packs are gone", "nowhere (never made)",
    'Group 4 "After sell-out":', "Packs:      no limit", "$2.50 + 1 PAPER a pack, rising 4% a pack", "Coins:      ETH", "Per wallet: no limit; per purchase: 1",
    "ends 15 min after its last sale", "Opens:      when group 3 (Everyone) ends"]) {
    assert.ok(text.includes(s), `missing: ${s}\n${text}`);
  }
  // every root override shows
  assert.ok(describeSale(studio, { roots: { 1: `0x${"c".repeat(64)}` } }).join("\n").includes(`root 0x${"c".repeat(64)}`));
});

/** A drop as FireSale.dropOf and FireGroups.groupsOf return it, from a normalized sale. */
function chainOf(want) {
  const GATE = { open: 0, nft: 1, snapshot: 2 };
  const drop = { ...Object.fromEntries(DROP_FIELDS.map((k) => [k, want[k]])), maxPerTx: want.maxPerTx === 0n ? 50n : want.maxPerTx, sold: 0n, closed: false };
  const views = want.groups.map((g) => ({ config: { ...Object.fromEntries(GROUP_FIELDS.map((k) => [k, g[k]])), gate: GATE[g.gate], nft: g.nft }, state: 0 }));
  return { drop, views };
}

test("dropDiffs reads back every drop-wide and group field; maxPerTx 0 is stored as 50", () => {
  const want = normSale({ ...studio, maxPerTx: 0 }, { mill: MILL, roots: { 1: `0x${"1".repeat(64)}` }, start: 10 });
  const { drop, views } = chainOf(want);
  assert.deepEqual(dropDiffs(drop, views, want), []);
  assert.equal(saleFromChain(drop, views).groups[1].gate, "snapshot");
  assert.match(dropDiffs({ ...drop, paperBurnBps: 0n }, views, want).join(), /paperBurnBps 0 \(meant 2000\)/);
  assert.match(dropDiffs({ ...drop, creditGroup: 1n }, views, want).join(), /creditGroup/);
  for (const k of GROUP_FIELDS) {
    const v = structuredClone(views);
    const c = v[3].config;
    c[k] = typeof c[k] === "boolean" ? !c[k] : typeof c[k] === "bigint" ? c[k] + 1n : k === "gate" ? 2 : k === "root" ? `0x${"9".repeat(64)}` : `0x${"9".repeat(40)}`;
    assert.match(dropDiffs(drop, v, want).join(), new RegExp(`groups\\[3\\]\\.${k} `), `${k} is compared`);
  }
  assert.match(dropDiffs(drop, views.slice(0, 3), want).join(), /3 groups \(meant 4\)/);
});
