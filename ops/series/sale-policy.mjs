// The sale settings policy: the bounds a drop's FireSale settings must sit in, and the wallets the sale must pay.
// VerifySeries and launch.mjs (before LOCK) both check them. A rule outside its bounds is RED unless it is allowed
// by name (--allow <rule>,<rule>): a deliberate exception, never a default.
//
//   price           a paid pack costs $1 to $10
//   burn-total      plankBurnBps + paperBurnBps is 10% to 100% of each sale
//   paper-burn      paperBurnBps is at least 10% (PAPER buy pressure is the point; Standard is 20%)
//   paper-per-pack  paperPerPack is at least 0.1 PAPER
//   no-paper        paperPerPack is 0 (no PAPER per pack at all)
//   paper-cap       paperCapUsd is at least $0.10 (0 = no cap: a warning, not RED)
//   wallet-limit    walletLimit is 50 or less
//   holder-window   a holder window has a holder root, or is presses only on purpose (--no-holders)
//
// The wallets: FireSale.revenueWallet, plankBurner and paperBurner must be the deployments file's REVENUE_WALLET
// (inputs) and PlankBurner / PaperBurner (contracts). The field names are FireSale.DropConfig's (the recipe's "sale"
// block, contracts/test/cards/recipe-studio-sale.json).
import { getAddress, parseAbi, formatUnits } from "viem";

export const RULES = {
  price: "a paid pack costs $1 to $10",
  "burn-total": "plankBurnBps + paperBurnBps is 10% to 100%",
  "paper-burn": "paperBurnBps is at least 10%",
  "paper-per-pack": "paperPerPack is at least 0.1 PAPER",
  "no-paper": "paperPerPack is not 0",
  "paper-cap": "paperCapUsd is at least $0.10, or 0 (no cap)",
  "wallet-limit": "walletLimit is 50 or less",
  "holder-window": "a holder window has a holder root (or --no-holders)",
};

const USD = 100_000_000n; // FireSale's dollars have 8 decimals
const ZERO_ROOT = /^0x0{64}$/i;
const big = (v) => BigInt(v ?? 0);

/** "--allow price,wallet-limit" (a string, a list or nothing) -> the set of allowed rules. Unknown names throw. */
export function parseAllow(v) {
  if (v === undefined || v === true || v === false || v === "") return new Set();
  const list = (Array.isArray(v) ? v : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);
  const bad = list.filter((r) => !RULES[r]);
  if (bad.length) throw new Error(`--allow ${bad.join(",")}: no such rule (rules: ${Object.keys(RULES).join(", ")})`);
  return new Set(list);
}

/** "$2.50" from 8-decimal dollars. */
export const usd = (v) => { const t = formatUnits(big(v), 8); const [i, f = ""] = t.split("."); return `$${i}.${f.padEnd(2, "0")}`; };
/** "12.5%" from basis points. */
export const pct = (bps) => `${Number(big(bps)) / 100}%`;
/** "1.5 PAPER" from wei. */
export const paper = (wei) => `${formatUnits(big(wei), 18)} PAPER`;
/** "24 h" from seconds. */
export const hours = (s) => `${Number(big(s)) / 3600} h`;

/**
 * The policy over a sale block (or an on-chain Drop: the same field names). Returns one line per rule:
 * { rule, level: "ok" | "warn" | "red" | "allowed", text }. `holderRoot`: the root batch B sets (else sale.holderRoot);
 * `noHolders`: a presses-only holder window on purpose.
 */
export function salePolicy(sale, { allow = new Set(), holderRoot, noHolders = false } = {}) {
  const out = [];
  const rule = (name, good, text, { warnOnly = false } = {}) => {
    const level = good ? "ok" : warnOnly ? "warn" : allow.has(name) ? "allowed" : "red";
    out.push({ rule: name, level, text: `${text}${level === "allowed" ? ` (allowed: --allow ${name})` : level === "red" ? ` (policy: ${RULES[name]}; --allow ${name} if meant)` : ""}` });
  };
  const price = big(sale.priceUsd);
  rule("price", price >= 1n * USD && price <= 10n * USD, `price ${usd(price)} a pack`);
  const plankBps = big(sale.plankBurnBps);
  const paperBps = big(sale.paperBurnBps);
  rule("burn-total", plankBps + paperBps >= 1000n && plankBps + paperBps <= 10000n, `burns ${pct(plankBps + paperBps)} of each sale (PLANK ${pct(plankBps)} + PAPER ${pct(paperBps)})`);
  rule("paper-burn", paperBps >= 1000n, `PAPER buy-and-burn ${pct(paperBps)} of each sale`);
  const perPack = big(sale.paperPerPack);
  if (perPack === 0n) rule("no-paper", false, "no PAPER per pack (paperPerPack 0)");
  else rule("paper-per-pack", perPack >= 10n ** 17n, `${paper(perPack)} per pack`);
  const cap = big(sale.paperCapUsd);
  if (cap === 0n) rule("paper-cap", false, "no dollar cap on a pack's PAPER (paperCapUsd 0)", { warnOnly: true });
  else rule("paper-cap", cap >= USD / 10n, `a pack's PAPER is capped at ${usd(cap)}`);
  rule("wallet-limit", big(sale.walletLimit) <= 50n, `wallet limit ${big(sale.walletLimit) === 0n ? "none" : `${sale.walletLimit} packs`}`);
  const root = holderRoot ?? sale.holderRoot;
  const hasRoot = !!root && !ZERO_ROOT.test(String(root));
  if (big(sale.holderWindow) > 0n) {
    rule("holder-window", hasRoot || noHolders, `holder window ${hours(sale.holderWindow)}: ${hasRoot ? "snapshot holders and presses" : noHolders ? "presses only (--no-holders)" : "no holder root"}`);
  } else rule("holder-window", true, "no holder window");
  return out;
}

const walletAbi = parseAbi([
  "function revenueWallet() view returns (address)",
  "function plankBurner() view returns (address)",
  "function paperBurner() view returns (address)",
]);

/** FireSale's revenue wallet and burners against the deployments file. `read(address, abi, fn)`; `dep`: the whole
 *  deployments JSON. Returns [{ ok, text }]. */
export async function saleWallets(read, sale, dep) {
  const want = { revenueWallet: dep.inputs?.REVENUE_WALLET, plankBurner: dep.contracts?.PlankBurner, paperBurner: dep.contracts?.PaperBurner };
  const src = { revenueWallet: "inputs.REVENUE_WALLET", plankBurner: "contracts.PlankBurner", paperBurner: "contracts.PaperBurner" };
  const out = [];
  for (const fn of ["revenueWallet", "plankBurner", "paperBurner"]) {
    const got = getAddress(await read(sale, walletAbi, fn));
    if (!want[fn]) { out.push({ ok: false, text: `FireSale.${fn} is ${got}: no ${src[fn]} in the deployments file to check it against` }); continue; }
    const same = got === getAddress(want[fn]);
    out.push({ ok: same, text: `FireSale.${fn} ${got} ${same ? `is the deployments file's ${src[fn]}` : `is NOT the deployments file's ${src[fn]} ${getAddress(want[fn])}`}` });
  }
  return out;
}

/** Every sale field in plain units, for the LOCK screen. `start`: the opening time as text. */
export function describeSale(sale, { start, holderRoot, noHolders = false } = {}) {
  const s = (k) => big(sale[k]);
  const h = (k) => (s(k) === 0n ? "off" : hours(sale[k]));
  const rest = 10000n - s("plankBurnBps") - s("paperBurnBps");
  const root = holderRoot ?? sale.holderRoot;
  const hasRoot = !!root && !ZERO_ROOT.test(String(root));
  return [
    `Opens:                ${start ?? `unix ${sale.start}`}`,
    `Paid packs:           ${s("packs")} at ${usd(s("priceUsd"))} each (priceUsd)`,
    `PAPER per pack:       ${s("paperPerPack") === 0n ? "none" : paper(s("paperPerPack"))}; worth at most ${s("paperCapUsd") === 0n ? "no cap" : usd(s("paperCapUsd"))} a pack (paperCapUsd)`,
    `Each sale:            ${pct(s("plankBurnBps"))} burns PLANK, ${pct(s("paperBurnBps"))} buys and burns PAPER, ${pct(rest)} to the revenue wallet`,
    `PLANK-only packs:     ${s("plankOnly")}${s("plankOnly") > 0n ? `, open to ETH and USDG after ${h("plankOnlyFor")}` : ""} (plankOnlyFor ${h("plankOnlyFor")})`,
    `Wallet limit:         ${s("walletLimit") === 0n ? "none" : `${s("walletLimit")} paid packs per wallet, lifted after ${h("liftAfter")}`}`,
    `Most per purchase:    ${s("maxPerTx") === 0n ? "50 (default)" : s("maxPerTx")} (maxPerTx)`,
    `Holder window:        ${s("holderWindow") === 0n ? "none" : `${h("holderWindow")}, ${hasRoot ? `snapshot holders (root ${root}) and presses` : noHolders ? "presses only" : "NO holder root"}`}`,
    `Regular wallets only: ${h("regularWalletsFor")} (regularWalletsFor)`,
    `Press packs:          ${s("starters")}${s("starters") > 0n ? `, claimable for ${h("starterWindow")}, ${s("starterPerPress")} per press, ${s("starterWalletLimit")} per wallet, price ${usd(s("starterPriceUsd"))} + ${paper(s("starterPaper"))}${s("starterPriceUsd") === 0n && s("starterPaper") === 0n ? " (free)" : ""}` : ""}`,
    `Free (credit) packs:  ${s("creditsPerPick")} credit(s) per picked suggestion; at most ${s("creditPacksMax") === 0n ? "no limit" : s("creditPacksMax")} in all, ${s("creditPacksPerWallet") === 0n ? "no limit" : s("creditPacksPerWallet")} per wallet`,
  ];
}
