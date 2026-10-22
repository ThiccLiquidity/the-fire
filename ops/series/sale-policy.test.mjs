// Unit tests for the sale settings policy (sale-policy.mjs): VerifySeries and launch.mjs both use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { salePolicy, saleWallets, parseAllow, describeSale, usd, pct, paper, hours } from "./sale-policy.mjs";
import { dropDiffs, DROP_FIELDS } from "./launch.mjs";

const studio = JSON.parse(readFileSync(new URL("../../contracts/test/cards/recipe-studio-sale.json", import.meta.url), "utf8")).sale;
const reds = (sale, o) => salePolicy(sale, o).filter((p) => p.level === "red").map((p) => p.rule);

test("the studio's sale block (Standard: 10% PLANK + 20% PAPER, $2.50, 1 PAPER, $1 cap, 5 a wallet) is inside the policy", () => {
  assert.deepEqual(reds(studio), []);
  assert.deepEqual(salePolicy(studio).map((p) => p.level), Array(7).fill("ok"));
});

test("each rule: RED outside its bounds", () => {
  assert.deepEqual(reds({ ...studio, priceUsd: "99999999" }), ["price"], "$0.99");
  assert.deepEqual(reds({ ...studio, priceUsd: "1000000001" }), ["price"], "over $10");
  assert.deepEqual(reds({ ...studio, priceUsd: "100000000" }), [], "$1 is in");
  assert.deepEqual(reds({ ...studio, priceUsd: "1000000000" }), [], "$10 is in");
  assert.deepEqual(reds({ ...studio, plankBurnBps: 0, paperBurnBps: 900 }), ["burn-total", "paper-burn"]);
  assert.deepEqual(reds({ ...studio, plankBurnBps: 9500, paperBurnBps: 1000 }), ["burn-total"], "over 100%");
  assert.deepEqual(reds({ ...studio, plankBurnBps: 0, paperBurnBps: 1000 }), [], "10% all PAPER is in");
  assert.deepEqual(reds({ ...studio, plankBurnBps: 2000, paperBurnBps: 999 }), ["paper-burn"]);
  assert.deepEqual(reds({ ...studio, paperPerPack: "99999999999999999" }), ["paper-per-pack"]);
  assert.deepEqual(reds({ ...studio, paperPerPack: "0" }), ["no-paper"]);
  assert.deepEqual(reds({ ...studio, paperCapUsd: "9999999" }), ["paper-cap"], "under $0.10");
  assert.deepEqual(reds({ ...studio, walletLimit: 51 }), ["wallet-limit"]);
  assert.deepEqual(reds({ ...studio, walletLimit: 50 }), []);
  assert.deepEqual(reds({ ...studio, holderRoot: `0x${"0".repeat(64)}` }), ["holder-window"]);
  assert.deepEqual(reds({ ...studio, holderRoot: `0x${"0".repeat(64)}` }, { noHolders: true }), [], "presses only, on purpose");
  assert.deepEqual(reds({ ...studio, holderRoot: undefined }, { holderRoot: `0x${"1".repeat(64)}` }), [], "the root batch B sets");
  assert.deepEqual(reds({ ...studio, holderWindow: 0, holderRoot: undefined }), []);
});

test("no PAPER cap is a warning; --allow turns a RED rule into an allowed one, by name only", () => {
  const cap = salePolicy({ ...studio, paperCapUsd: "0" }).find((p) => p.rule === "paper-cap");
  assert.equal(cap.level, "warn");
  const allow = parseAllow("price,wallet-limit");
  const p = salePolicy({ ...studio, priceUsd: "5000000000", walletLimit: 100, paperBurnBps: 0 }, { allow });
  assert.deepEqual(p.filter((x) => x.level === "allowed").map((x) => x.rule), ["price", "wallet-limit"]);
  assert.deepEqual(p.filter((x) => x.level === "red").map((x) => x.rule), ["paper-burn"]);
  assert.match(p.find((x) => x.rule === "paper-burn").text, /--allow paper-burn if meant/);
  assert.throws(() => parseAllow("price,everything"), /no such rule/);
  assert.equal(parseAllow(undefined).size, 0);
  assert.equal(parseAllow(true).size, 0);
});

test("the wallets: FireSale's must be the deployments file's", async () => {
  const a = (n) => `0x${String(n).repeat(40)}`;
  const onChain = { revenueWallet: a(1), plankBurner: a(2), paperBurner: a(3) };
  const read = async (_, __, fn) => onChain[fn];
  const dep = { inputs: { REVENUE_WALLET: a(1) }, contracts: { PlankBurner: a(2), PaperBurner: a(3) } };
  assert.deepEqual((await saleWallets(read, a(9), dep)).map((w) => w.ok), [true, true, true]);
  onChain.revenueWallet = a(4);
  const w = await saleWallets(read, a(9), dep);
  assert.deepEqual(w.map((x) => x.ok), [false, true, true]);
  assert.match(w[0].text, /is NOT the deployments file's inputs.REVENUE_WALLET/);
  assert.equal((await saleWallets(read, a(9), { contracts: dep.contracts }))[0].ok, false, "nothing to check against: RED");
});

test("the LOCK screen shows every sale field in plain units", () => {
  assert.equal(usd("250000000"), "$2.50");
  assert.equal(usd("10000000"), "$0.10");
  assert.equal(usd("100000000"), "$1.00");
  assert.equal(pct(1000), "10%");
  assert.equal(pct(250), "2.5%");
  assert.equal(paper("100000000000000000"), "0.1 PAPER");
  assert.equal(hours(86400), "24 h");
  const text = describeSale(studio, { start: "Sun 1 Nov" }).join("\n");
  for (const s of ["Sun 1 Nov", "117 at $2.50", "1 PAPER", "$1.00 a pack", "10% burns PLANK, 20% buys and burns PAPER, 70% to the revenue wallet",
    "PLANK-only packs:     50, open to ETH and USDG after 48 h", "5 paid packs per wallet, lifted after 48 h", "Most per purchase:    50", "Holder window:        24 h, snapshot holders",
    "Regular wallets only: 48 h", "Press packs:          50, claimable for 24 h, 1 per press, 1 per wallet, price $0.00 + 1 PAPER", "1 credit(s) per picked suggestion; at most 16 in all, 3 per wallet"]) {
    assert.ok(text.includes(s), `missing: ${s}\n${text}`);
  }
  // every DropConfig field is on it
  const shown = { start: "Opens", packs: "Paid packs", priceUsd: "priceUsd", paperPerPack: "PAPER per pack", paperCapUsd: "paperCapUsd", plankBurnBps: "burns PLANK", paperBurnBps: "burns PAPER",
    plankOnly: "PLANK-only", plankOnlyFor: "plankOnlyFor", walletLimit: "Wallet limit", liftAfter: "lifted after", maxPerTx: "maxPerTx", holderWindow: "Holder window", holderRoot: "root",
    regularWalletsFor: "regularWalletsFor", starters: "Press packs", starterWindow: "claimable for", starterPerPress: "per press", starterWalletLimit: "per wallet, price",
    starterPriceUsd: "price $", starterPaper: "+ 1 PAPER", creditsPerPick: "per picked suggestion", creditPacksMax: "in all", creditPacksPerWallet: "per wallet" };
  for (const k of [...DROP_FIELDS, "holderRoot"]) assert.ok(shown[k] && text.includes(shown[k]), `${k} isn't shown`);
});

test("dropDiffs reads back every field; maxPerTx 0 is stored as 50", () => {
  const drop = { ...Object.fromEntries(DROP_FIELDS.map((k) => [k, BigInt(studio[k] ?? 0)])), start: 10n, maxPerTx: 50n, holderRoot: studio.holderRoot };
  const want = { ...studio, start: "10" };
  assert.deepEqual(dropDiffs(drop, want), []);
  assert.deepEqual(dropDiffs({ ...drop, maxPerTx: 50n }, { ...want, maxPerTx: 0 }), []);
  assert.match(dropDiffs({ ...drop, paperBurnBps: 0n }, want).join(), /paperBurnBps 0 \(meant 2000\)/);
  assert.match(dropDiffs({ ...drop, creditPacksPerWallet: 9n }, want).join(), /creditPacksPerWallet/);
});
