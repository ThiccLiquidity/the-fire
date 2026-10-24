// The sale settings policy: the bounds a drop's FireSale settings (the drop-wide fields and each group,
// docs/drop-groups.md) must sit in, and the wallets the sale must pay. VerifySeries and launch.mjs (before batch A and
// again at LOCK) both check them. A rule outside its bounds is RED unless it is allowed by name (--allow <rule>,<rule>):
// a deliberate exception, never a default. Some rules only warn; a few are hard (the contract refuses those anyway).
//
//   price           a group's dollar price is $1 to $10; 0 only for a holders' group (NFT or snapshot: free or PAPER only)
//   burn-total      plankBurnBps + paperBurnBps is 10% to 100% of each sale (drop-wide)
//   paper-burn      paperBurnBps is at least 10% (PAPER buy pressure is the point; Standard is 20%)
//   paper-per-pack  a group's PAPER per pack is at least 0.1 PAPER
//   no-paper        a group has no PAPER per pack (paper 0)
//   paper-cap       paperCapUsd is at least $0.10 (0 = no cap: a warning, not RED)
//   wallet-limit    a group's perWallet is 50 or less (0 = no limit: a warning for a finite open group)
//   limit-lifts     a per-wallet limit with a timer (limitFor) lifts 1 h to 7 days after the group opens
//   tax             a group's rising tax is at most 10% a pack (a warning above; the owner's default is 4%)
//   idle            an unlimited group idles out within 1 h (a warning above)
// Hard (no --allow): a snapshot group has a root at LOCK; an NFT group's collection has code; an open group isn't free;
// a limitFor has a perWallet to lift.
//
// The wallets: FireSale.revenueWallet, plankBurner and paperBurner must be the deployments file's REVENUE_WALLET
// (inputs) and PlankBurner / PaperBurner (contracts); FireGroups is wired to FireSale both ways. The field names are
// FireSale.DropConfig's and FireGroups.Group's (the recipe's "sale" block, contracts/test/cards/recipe-studio-sale.json).
import { getAddress, formatUnits, zeroAddress } from "viem";
import { saleAbi, groupsAbi, GATES, NONE } from "./sale-abi.mjs";

export const RULES = {
  price: "a group's price is $1 to $10, or 0 for a holders' group",
  "burn-total": "plankBurnBps + paperBurnBps is 10% to 100%",
  "paper-burn": "paperBurnBps is at least 10%",
  "paper-per-pack": "a group's PAPER per pack is at least 0.1 PAPER",
  "no-paper": "a group's PAPER per pack is not 0",
  "paper-cap": "paperCapUsd is at least $0.10, or 0 (no cap)",
  "wallet-limit": "a group's perWallet is 50 or less",
  "limit-lifts": "a group's per-wallet limit lifts 1 h to 7 days after it opens (limitFor)",
  tax: "a group's taxBps is 1000 (10%) or less",
  idle: "an unlimited group's idle is 1 h or less",
};

const USD = 100_000_000n; // FireSale's dollars have 8 decimals
const ZERO_ROOT = /^0x0{64}$/i;
const big = (v) => BigInt(v ?? 0);
export const DROP_FIELDS = ["start", "packs", "plankBurnBps", "paperBurnBps", "paperCapUsd", "maxPerTx", "regularWalletsFor", "creditsPerPick",
  "creditPacksMax", "creditPacksPerWallet", "creditGroup"];
export const GROUP_FIELDS = ["packs", "gate", "coins", "afterGroup", "rollTo", "startDelay", "duration", "perWallet", "limitFor", "perNft", "taxBps",
  "priceUsd", "paper", "nft", "idle", "perTx", "unlimited", "root"];

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
/** "15 min", "6 h", "2.5 days" from seconds. */
export const dur = (s) => { const n = Number(big(s)); return n < 3600 ? `${n / 60} min` : n <= 2 * 86400 ? `${n / 3600} h` : `${n / 86400} days`; };
/** "PLANK, ETH" from the coins mask (PLANK 1, ETH 2, USDG 4). */
export const coinNames = (mask) => ["PLANK", "ETH", "USDG"].filter((_, i) => Number(mask) & (1 << i)).join(", ") || "none";

/**
 * One sale in contract units: the recipe's sale block (gate "open" | "nft" | "snapshot", "nft": "press", optional keys
 * left out) or a drop read from the chain (`saleFromChain`). `mill` resolves "press"; `roots` ({ [i]: root }) and
 * `start` override, as GROUP_ROOT_<i> and DROP_START do for ConfigureSeries.
 */
export function normSale(sale, { mill, roots = {}, start } = {}) {
  const groups = (sale.groups ?? []).map((g, i) => {
    const gate = typeof g.gate === "string" ? g.gate : GATES[Number(g.gate)];
    const nft = g.nft === undefined || g.nft === zeroAddress ? zeroAddress : g.nft === "press" ? (mill ? getAddress(mill) : "press") : getAddress(g.nft);
    const root = roots[i] ?? roots[String(i)] ?? g.root;
    return {
      name: g.name, gate, nft, root: root && !ZERO_ROOT.test(String(root)) ? String(root).toLowerCase() : `0x${"0".repeat(64)}`,
      unlimited: !!g.unlimited,
      ...Object.fromEntries(["packs", "coins", "afterGroup", "rollTo", "startDelay", "duration", "perWallet", "limitFor", "perNft", "taxBps", "priceUsd", "paper", "idle", "perTx"].map((k) => [k, big(g[k])])),
    };
  });
  return {
    ...Object.fromEntries(DROP_FIELDS.map((k) => [k, big(sale[k])])),
    ...(start !== undefined ? { start: big(start) } : {}),
    groups,
  };
}

/** The drop on chain (FireSale.dropOf and FireGroups.groupsOf) as a sale block. */
export function saleFromChain(drop, groupViews) {
  return normSale({ ...drop, groups: groupViews.map((v) => v.config ?? v) });
}

const NAME = (g, i) => `group ${i + 1}${g.name ? ` (${g.name})` : ""}`;

/**
 * The policy over a sale (normSale's shape, or a raw sale block: normalized here). Returns one line per rule:
 * { rule, level: "ok" | "warn" | "red" | "allowed", text }. `roots`: the snapshot roots batch B sets ({ [i]: root });
 * `nftCode`: { [i]: true | false } when the NFT groups' collections were looked up (launch, VerifySeries).
 */
export function salePolicy(sale0, { allow = new Set(), roots, nftCode = {}, mill } = {}) {
  const sale = normSale(sale0, { roots, mill });
  const out = [];
  const rule = (name, good, text, { warnOnly = false, hard = false } = {}) => {
    const level = good ? "ok" : warnOnly ? "warn" : !hard && allow.has(name) ? "allowed" : "red";
    const why = hard ? "the contract refuses it" : `policy: ${RULES[name]}; --allow ${name} if meant`;
    out.push({ rule: name, level, text: `${text}${level === "allowed" ? ` (allowed: --allow ${name})` : level === "red" ? ` (${why})` : ""}` });
  };
  const plankBps = sale.plankBurnBps;
  const paperBps = sale.paperBurnBps;
  rule("burn-total", plankBps + paperBps >= 1000n && plankBps + paperBps <= 10000n, `burns ${pct(plankBps + paperBps)} of each sale (PLANK ${pct(plankBps)} + PAPER ${pct(paperBps)})`);
  rule("paper-burn", paperBps >= 1000n, `PAPER buy-and-burn ${pct(paperBps)} of each sale`);
  const cap = sale.paperCapUsd;
  if (cap === 0n) rule("paper-cap", false, "no dollar cap on a pack's PAPER (paperCapUsd 0)", { warnOnly: true });
  else rule("paper-cap", cap >= USD / 10n, `a pack's PAPER is capped at ${usd(cap)}`);
  sale.groups.forEach((g, i) => {
    const n = NAME(g, i);
    const holders = g.gate === "nft" || g.gate === "snapshot";
    if (g.gate === "open" && g.priceUsd === 0n && g.paper === 0n) rule("free-open", false, `${n}: free packs open to everyone`, { hard: true });
    if (g.priceUsd === 0n) rule("price", holders, `${n}: no dollar price${holders ? ` (a holders' group: ${g.paper === 0n ? "free" : "PAPER only"})` : " in an open group"}`);
    else rule("price", g.priceUsd >= 1n * USD && g.priceUsd <= 10n * USD, `${n}: ${usd(g.priceUsd)} a pack`);
    if (g.paper === 0n) rule("no-paper", false, `${n}: no PAPER per pack (paper 0)`);
    else rule("paper-per-pack", g.paper >= 10n ** 17n, `${n}: ${paper(g.paper)} per pack`);
    if (g.perWallet === 0n) {
      const fine = g.unlimited || holders;
      rule("wallet-limit", fine, `${n}: no wallet limit${g.unlimited ? " (an unlimited group: its rising price limits it)" : holders ? ` (the gate limits it: ${g.gate === "nft" ? `${g.perNft} per NFT` : "each wallet's snapshot allowance"})` : ""}`, { warnOnly: true });
    } else rule("wallet-limit", g.perWallet <= 50n, `${n}: ${g.perWallet} packs per wallet${g.limitFor ? ` for the first ${dur(g.limitFor)}` : ""}`);
    if (g.limitFor !== 0n) {
      if (g.perWallet === 0n) rule("limit-lifts", false, `${n}: limitFor ${dur(g.limitFor)} with no per-wallet limit to lift`, { hard: true });
      else rule("limit-lifts", g.limitFor >= 3600n && g.limitFor <= 7n * 86400n, `${n}: the per-wallet limit lifts ${dur(g.limitFor)} after it opens, then no limit`);
    }
    if (g.taxBps !== 0n) rule("tax", g.taxBps <= 1000n, `${n}: the price rises ${pct(g.taxBps)} a pack`, { warnOnly: true });
    if (g.unlimited) rule("idle", g.idle !== 0n && g.idle <= 3600n, `${n}: no pack count, ends ${g.idle === 0n ? "never by idling (the contract refuses it)" : `${dur(g.idle)} after its last sale`}`, { warnOnly: g.idle !== 0n, hard: g.idle === 0n });
    if (g.gate === "snapshot") rule("snapshot-root", !ZERO_ROOT.test(g.root), `${n}: snapshot root ${ZERO_ROOT.test(g.root) ? "missing (take the snapshot: GROUP_ROOT_" + i + ")" : g.root}`, { hard: true });
    if (g.gate === "nft" && nftCode[i] !== undefined) rule("nft-code", nftCode[i], `${n}: NFT ${g.nft} ${nftCode[i] ? "is a contract" : "has no code"}`, { hard: true });
  });
  return out;
}

/** Whether each NFT group's collection has code: { [i]: bool }. `getCode(address)`. "press" unresolved: false. */
export async function nftCodeOf(sale, getCode) {
  const out = {};
  for (const [i, g] of sale.groups.entries()) {
    if (g.gate !== "nft") continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(g.nft))) { out[i] = false; continue; }
    const c = await getCode(g.nft);
    out[i] = !!c && c !== "0x";
  }
  return out;
}

/** FireSale's revenue wallet and burners against the deployments file, and FireGroups wired to FireSale both ways.
 *  `read(address, abi, fn)`; `dep`: the whole deployments JSON. Returns [{ ok, text }]. */
export async function saleWallets(read, sale, dep) {
  const want = { revenueWallet: dep.inputs?.REVENUE_WALLET, plankBurner: dep.contracts?.PlankBurner, paperBurner: dep.contracts?.PaperBurner };
  const src = { revenueWallet: "inputs.REVENUE_WALLET", plankBurner: "contracts.PlankBurner", paperBurner: "contracts.PaperBurner" };
  const out = [];
  for (const fn of ["revenueWallet", "plankBurner", "paperBurner"]) {
    const got = getAddress(await read(sale, saleAbi, fn));
    if (!want[fn]) { out.push({ ok: false, text: `FireSale.${fn} is ${got}: no ${src[fn]} in the deployments file to check it against` }); continue; }
    const same = got === getAddress(want[fn]);
    out.push({ ok: same, text: `FireSale.${fn} ${got} ${same ? `is the deployments file's ${src[fn]}` : `is NOT the deployments file's ${src[fn]} ${getAddress(want[fn])}`}` });
  }
  const groups = getAddress(await read(sale, saleAbi, "GROUPS"));
  const recorded = dep.contracts?.FireGroups ? getAddress(dep.contracts.FireGroups) : undefined;
  const back = groups === zeroAddress ? zeroAddress : getAddress(await read(groups, groupsAbi, "sale"));
  const ok = !!recorded && groups === recorded && back === getAddress(sale);
  out.push({ ok, text: ok ? `FireSale.GROUPS is the deployments file's FireGroups ${groups}, and its sale is FireSale`
    : `FireGroups wiring: FireSale.GROUPS ${groups}, deployments file ${recorded ?? "has no FireGroups"}, FireGroups.sale ${back}` });
  return out;
}

/** One group in plain words, for the LOCK screen: [title, ...lines]. */
export function describeGroup(g, i, sale, { mill } = {}) {
  const ref = (k) => (k === NONE ? undefined : `group ${k + 1}${sale.groups[k]?.name ? ` (${sale.groups[k].name})` : ""}`);
  const who = g.gate === "open" ? "everyone"
    : g.gate === "nft" ? `holders of NFT ${g.nft}${mill && String(g.nft).toLowerCase() === String(mill).toLowerCase() ? " (the Paper Press)" : ""}, ${g.perNft} pack(s) per NFT`
      : `wallets in the snapshot (root ${g.root}), each up to its allowance`;
  const price = g.priceUsd === 0n && g.paper === 0n ? "free" : `${usd(g.priceUsd)} + ${paper(g.paper)}${g.priceUsd === 0n ? " (PAPER only)" : ""}`;
  const after = Number(g.afterGroup);
  const opens = after === NONE ? `with the drop${g.startDelay ? ` + ${dur(g.startDelay)}` : ""}` : `when ${ref(after)} ends${g.startDelay ? ` + ${dur(g.startDelay)}` : ""}`;
  return [
    `Group ${i + 1}${g.name ? ` "${g.name}"` : ""}:`,
    `  Who:        ${who}`,
    `  Packs:      ${g.unlimited ? "no limit (unlimited: adds on top of the total)" : `${g.packs}${g.packs === 0n ? " (only leftovers rolled in)" : ""}`}`,
    `  Price:      ${price} a pack${g.taxBps ? `, rising ${pct(g.taxBps)} a pack (taxBps ${g.taxBps}: the rise buys and burns PAPER)` : ""}`,
    `  Coins:      ${g.priceUsd === 0n ? "- (no dollar price)" : coinNames(g.coins)}`,
    `  Per wallet: ${g.perWallet === 0n ? "no limit" : g.limitFor ? `${g.perWallet} for the first ${dur(g.limitFor)} after it opens, then no limit` : g.perWallet}; per purchase: ${g.perTx === 0n ? `${sale.maxPerTx === 0n ? 50n : sale.maxPerTx} (the drop's)` : g.perTx}`,
    `  Opens:      ${opens}`,
    `  Max time:   ${g.duration === 0n ? (g.unlimited ? "no time limit" : "until its packs are gone") : dur(g.duration)}; idle: ${g.idle === 0n ? "off" : `ends ${dur(g.idle)} after its last sale`}`,
    `  Leftovers:  ${Number(g.rollTo) === NONE ? "nowhere (never made)" : `to ${ref(Number(g.rollTo))}`}`,
  ];
}

/** Every sale field in plain units, for the LOCK screen: the drop-wide fields, then each group. `start`: the opening
 *  time as text. */
export function describeSale(sale0, { start, roots, mill } = {}) {
  const sale = normSale(sale0, { roots, mill });
  const rest = 10000n - sale.plankBurnBps - sale.paperBurnBps;
  const finite = sale.groups.filter((g) => !g.unlimited).length;
  const cg = Number(sale.creditGroup);
  return [
    `Opens:                ${start ?? `unix ${sale.start}`}`,
    `Packs:                ${sale.packs} in ${finite} group(s)${finite < sale.groups.length ? ", plus what the unlimited group sells on top" : ""}`,
    `Each sale:            ${pct(sale.plankBurnBps)} burns PLANK, ${pct(sale.paperBurnBps)} buys and burns PAPER, ${pct(rest)} to the revenue wallet`,
    `PAPER ceiling:        a pack's PAPER is worth at most ${sale.paperCapUsd === 0n ? "no cap" : usd(sale.paperCapUsd)} (paperCapUsd)`,
    `Most per purchase:    ${sale.maxPerTx === 0n ? "50 (default)" : sale.maxPerTx} (maxPerTx)`,
    `Regular wallets only: ${sale.regularWalletsFor === 0n ? "off" : dur(sale.regularWalletsFor)} (regularWalletsFor)`,
    `Free (credit) packs:  ${cg === NONE ? "none (creditGroup 255)" : `${sale.creditsPerPick} credit(s) per picked suggestion; at most ${sale.creditPacksMax === 0n ? "no limit" : sale.creditPacksMax} in all, ${sale.creditPacksPerWallet === 0n ? "no limit" : sale.creditPacksPerWallet} per wallet; from group ${cg + 1}${sale.groups[cg]?.name ? ` (${sale.groups[cg].name})` : ""}`}`,
    ...sale.groups.flatMap((g, i) => describeGroup(g, i, sale, { mill })),
  ];
}

/** The drop on chain (dropOf, groupsOf) against what batch B was meant to set (`want`: normSale with the start, the
 *  press and the roots resolved). Returns the differences, by field. */
export function dropDiffs(drop, groupViews, want) {
  const d = [];
  for (const k of DROP_FIELDS) {
    if (drop[k] === undefined) continue;
    const meant = k === "maxPerTx" && big(want[k]) === 0n ? 50n : big(want[k]); // FireSale stores 0 as its default, 50
    if (big(drop[k]) !== meant) d.push(`${k} ${drop[k]} (meant ${meant})`);
  }
  if (groupViews.length !== want.groups.length) d.push(`${groupViews.length} groups (meant ${want.groups.length})`);
  const got = saleFromChain(drop, groupViews).groups;
  want.groups.forEach((w, i) => {
    const g = got[i];
    if (!g) return;
    for (const k of GROUP_FIELDS) {
      const a = typeof g[k] === "string" ? g[k].toLowerCase() : g[k];
      const b = typeof w[k] === "string" ? w[k].toLowerCase() : w[k];
      if (a !== b) d.push(`groups[${i}].${k} ${g[k]} (meant ${w[k]})`);
    }
  });
  return d;
}
