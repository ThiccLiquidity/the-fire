// What the live site reads from the card contracts. Every function returns plain objects: numbers, strings, booleans
// and Amounts (raw as a decimal string plus text), so the plain-JS Forge can use them as they are.

import { concat, encodeAbiParameters, erc20Abi, getAddress, hexToString, isAddress, keccak256, type Address, type Hex } from "viem";
import { NET } from "../net";
import { BlockscoutData } from "../blockscout";
import { DRAND_GENESIS, DRAND_PERIOD } from "../drand";
import {
  addr, amount, argsOf, cardsAbi, chainNow, creditsAbi, dealerAbi, decimalsOf, eventOf, hasFunction, input, packsAbi, psaAbi,
  pub, read, readGroups, rendererAbi, saleAbi, scanLogs, type Amount,
} from "./contracts";

export const PAY = ["PLANK", "ETH", "USDG"] as const;
export type PayCoin = (typeof PAY)[number];
export const payIndex = (p: PayCoin): number => PAY.indexOf(p);
/** Cases and grading (FirePsa.Pay) take the same coins: PLANK 0, ETH 1, USDG 2 (the fee buys PAPER and burns it). */
export const PSA_PAY = PAY;
export type PsaCoin = (typeof PSA_PAY)[number];
export const psaPayIndex = (p: PsaCoin): number => PSA_PAY.indexOf(p);

// ---------------------------------------------------------------- Series, their drops and the drops' groups

type DropRaw = {
  start: bigint; packs: bigint; sold: bigint; creditPacks: bigint; maxPerTx: number; regularWalletsFor: number; creditsPerPick: number;
  creditGroup: number; closed: boolean; creditPacksMax: bigint; creditPacksPerWallet: bigint; paperCapUsd: bigint;
};
type StatusRaw = {
  configured: boolean; live: boolean; closed: boolean; paused: boolean; plankPriceOk: boolean; regularWalletsOnly: boolean;
  left: bigint; endableAt: bigint; creditPacksLeft: bigint;
};
type GroupRaw = {
  packs: bigint; gate: number; coins: number; afterGroup: number; rollTo: number; startDelay: number; duration: number; perWallet: number;
  limitFor: number; perNft: number; taxBps: number; plankBurnBps: number; paperBurnBps: number; priceUsd: bigint; paper: bigint; nft: Address; idle: number; perTx: number; unlimited: boolean; root: Hex;
};
type GroupViewRaw = {
  config: GroupRaw; state: number; capacity: bigint; sold: bigint; left: bigint; opensAt: bigint; endsAt: bigint; limitUntil: bigint;
};

/** FireGroups.NONE: no group (opens with the drop, rolls nowhere, no credit packs). */
const NONE = 255;
/** Counts that read type(uint256).max mean "no limit" (an unlimited group): null here. */
const count = (v: bigint): number | null => (v >= 1n << 64n ? null : Number(v));
const usd8 = (v: bigint) => (Number(v) / 1e8).toFixed(2);
const ZERO_ADDR = /^0x0{40}$/i;
const COIN_BITS: [PayCoin, number][] = [["PLANK", 1], ["ETH", 2], ["USDG", 4]];

/** One pack's price in a group: dollars ("2.60") and the rising-tax part of it ("0.10"). */
export type PackPrice = { usd: string; tax: string };

/** One group of a drop, in plain fields (docs/drop-groups.md). Times are unix seconds (0 = not known yet). */
export type GroupInfo = {
  index: number;
  /** A name for people: "Paper Press holders", "Holders list", "Everyone", "Extra packs". */
  name: string;
  /** Who can buy: "Everyone", "Paper Press holders only", "NFT holders only", "Wallets on the holders list only". */
  who: string;
  gate: "open" | "nft" | "snapshot";
  /** NFT gate: the collection, whether it's the Paper Press, and packs per NFT id. */
  nft: string | null; isPress: boolean; perNft: number;
  /** Snapshot gate: the Merkle root of (wallet, allowance). */
  root: string | null;
  /** The base dollar price per pack ("2.50"; "0.00" = none), and PAPER per pack (before the drop's dollar ceiling). */
  priceUsd: string; paper: Amount;
  /** No dollar price and no PAPER: a free claim. */
  free: boolean;
  /** Coins the dollar price can be paid in (empty when it has none). */
  coins: PayCoin[];
  /** Most packs per wallet in this group (0 = no limit), most per purchase (the group's, under the drop's). */
  perWallet: number; perTx: number;
  /** The per-wallet limit lifts this long after the group opens (seconds; 0 = it holds the whole time), and when
   *  (unix seconds; 0 = no timer, or not known yet: the group before it runs until sold). After it: no limit. */
  limitFor: number; limitUntil: number;
  state: "upcoming" | "open" | "ended";
  /** When it opened / opens (0: when the group before it, which runs until sold, sells out), and when it ends if
   *  nothing more sells (0: until its packs are gone). */
  opensAt: number; endsAt: number;
  /** Its packs + leftovers rolled in; packs taken; packs it can still sell. null = no limit (an unlimited group). */
  capacity: number | null; sold: number; left: number | null;
  unlimited: boolean;
  /** Rising tax per pack (400 = 4%), and the idle end (seconds without a sale; 0 = off). */
  taxBps: number; idle: number; duration: number;
  /** How this group's dollar payments split (bps of each pack's base price; set per group, locked with the drop): the
   *  share that buys PLANK and burns it, and the share that buys PAPER and burns it. The rest goes to the revenue
   *  wallet; a rising tax all buys PAPER. */
  plankBurnBps: number; paperBurnBps: number;
  afterGroup: number | null; rollTo: number | null;
  /** The next pack's price now (the rising tax included), and the few after it (taxed groups; [] otherwise). null:
   *  past the price safety bound (PriceTooHigh: it can't sell more). */
  next: PackPrice | null; after: PackPrice[];
  /** Open with 0 left but a group that rolls its leftovers into it hasn't ended: more may come (at `moreAt`, the
   *  latest end of those groups; 0 = when they sell out). */
  waiting: boolean; moreFrom: number | null; moreAt: number;
};

export type SeriesInfo = {
  fire: number;
  /** The drop's drop-wide settings. `packs`: the base total (the finite groups); an unlimited group adds on top. */
  start: number; packs: number; maxPerTx: number; regularWalletsEnds: number; paperCapUsd: string; creditsPerPick: number;
  /** Seconds after the start that only regular wallets can buy (the burn splits are each group's: GroupInfo). */
  regularWalletsFor: number;
  /** The group credit packs come from (null = no credit packs), and the caps on them (0 = no cap). */
  creditGroup: number | null; creditPacksMax: number; creditPacksPerWallet: number;
  /** Packs taken (bought and free, all groups) and credit packs minted. */
  sold: number; creditPacks: number;
  /** The drop now (FireSale.status). `left` null: an unlimited group is open or yet to open (no end in sight). */
  status: { configured: boolean; live: boolean; closed: boolean; paused: boolean; plankPriceOk: boolean; regularWalletsOnly: boolean;
    left: number | null; endableAt: number; creditPacksLeft: number | null };
  /** Live with nothing left to sell, not closed yet: the keeper (or anyone) calls close. */
  closing: boolean;
  /** Before it opens / open / sold out or ended. */
  state: "upcoming" | "live" | "closed";
  groups: GroupInfo[];
  /** The Series' cards (FireCards): dealing state. */
  cards: { closed: boolean; packs: number; packsDealt: number; cardsPerPack: number; characters: number };
  /** The chain's clock when this was read (the latest block's time): countdowns run on it, not the device's. */
  now: number;
};

/** The Series that have a drop, oldest first (FireSale DropConfigured since the deploy). */
export async function seriesNumbers(): Promise<number[]> {
  const logs = await scanLogs(addr("FireSale"), eventOf(saleAbi, "DropConfigured"));
  return [...new Set(logs.map((l) => Number(argsOf<{ fire: bigint }>(l).fire)))].sort((a, b) => a - b);
}

/** Per-pack prices of the next `k` packs of a taxed group (priceOf(n) - priceOf(n - 1)), from the first. */
async function nextPrices(fire: bigint, g: number, k: number): Promise<(PackPrice | null)[]> {
  const totals = await Promise.all(Array.from({ length: k }, (_, i) => readGroups<readonly [bigint, bigint]>("priceOf", [fire, BigInt(g), BigInt(i + 1)]).catch(() => null)));
  return totals.map((t, i) => {
    const p = i ? totals[i - 1] : ([0n, 0n] as const);
    return t && p ? { usd: usd8(t[0] - p[0]), tax: usd8(t[1] - p[1]) } : null;
  });
}

/** A group's name and who it's for, from its gate (nothing on chain names it). */
function nameOf(c: GroupRaw, isPress: boolean): { name: string; who: string } {
  if (c.gate === 1) return isPress ? { name: "Paper Press holders", who: "Paper Press holders only" } : { name: "NFT holders", who: "NFT holders only" };
  if (c.gate === 2) return { name: "Holders list", who: "Holders list only" };
  return { name: c.unlimited ? "Extra packs" : c.taxBps ? "Everyone (rising price)" : "Everyone", who: "Everyone" };
}

/** A drop's groups now (FireGroups.groupsOf), with each taxed group's next prices. `maxPerTx`: the drop's. */
export async function groups(fire: number, maxPerTx = 50): Promise<GroupInfo[]> {
  const f = BigInt(fire);
  const raw = await readGroups<readonly GroupViewRaw[]>("groupsOf", [f]);
  const press = input("MILL");
  const out = await Promise.all(raw.map(async (v, i): Promise<GroupInfo> => {
    const c = v.config, isPress = c.gate === 1 && !!press && getAddress(c.nft) === press;
    const taxed = c.taxBps > 0 && v.state !== 2;
    const prices = taxed ? await nextPrices(f, i, 4) : [];
    const base: PackPrice = { usd: usd8(c.priceUsd), tax: "0.00" };
    return {
      index: i, ...nameOf(c, isPress), gate: c.gate === 1 ? "nft" : c.gate === 2 ? "snapshot" : "open",
      nft: c.gate === 1 && !ZERO_ADDR.test(c.nft) ? getAddress(c.nft) : null, isPress, perNft: Number(c.perNft),
      root: c.gate === 2 ? c.root : null,
      priceUsd: usd8(c.priceUsd), paper: amount(c.paper), free: c.priceUsd === 0n && c.paper === 0n,
      coins: c.priceUsd === 0n ? [] : COIN_BITS.filter(([, b]) => c.coins & b).map(([k]) => k).filter((k) => k !== "USDG" || !!input("USDG")),
      perWallet: Number(c.perWallet), perTx: Math.min(Number(c.perTx) || maxPerTx, maxPerTx),
      limitFor: Number(c.limitFor), limitUntil: Number(v.limitUntil),
      state: v.state === 2 ? "ended" : v.state === 1 ? "open" : "upcoming",
      opensAt: Number(v.opensAt), endsAt: Number(v.endsAt),
      capacity: count(v.capacity), sold: Number(v.sold), left: count(v.left), unlimited: c.unlimited,
      taxBps: Number(c.taxBps), idle: Number(c.idle), duration: Number(c.duration),
      plankBurnBps: Number(c.plankBurnBps), paperBurnBps: Number(c.paperBurnBps),
      afterGroup: c.afterGroup === NONE ? null : Number(c.afterGroup), rollTo: c.rollTo === NONE ? null : Number(c.rollTo),
      next: taxed ? prices[0] : base, after: taxed ? (prices.slice(1).filter(Boolean) as PackPrice[]) : [],
      waiting: false, moreFrom: null, moreAt: 0,
    };
  }));
  // a sold-out group still open waits on leftovers from groups that roll into it (directly or through an ended one)
  for (const g of out) {
    if (g.state !== "open" || g.left !== 0) continue;
    const feeders = (i: number): GroupInfo[] => out.filter((x) => x.rollTo === i).flatMap((x) => (x.state === "ended" ? feeders(x.index) : [x]));
    const live = feeders(g.index).filter((x) => x.state !== "ended");
    if (!live.length) continue;
    const last = live.reduce((a, b) => (a.endsAt === 0 ? a : b.endsAt === 0 || b.endsAt > a.endsAt ? b : a));
    Object.assign(g, { waiting: true, moreFrom: last.index, moreAt: last.endsAt });
  }
  return out;
}

/** RecipeDealer.slotsOf: each slot's cards, its weight per type (recipe order) and its total. */
type SlotsRaw = readonly [readonly bigint[], readonly (readonly bigint[])[], readonly bigint[]];
/** One slot of a Series' pack: its cards and its chance of each card type (recipe order; 0 = never in this slot). */
export type SlotOdds = { count: number; odds: number[] };

/** Each slot's cards and its chance of each type, from RecipeDealer.slotsOf's counts, weights and totals. */
export function slotOddsOf([counts, weights, totals]: SlotsRaw): SlotOdds[] {
  return counts.map((c, s) => ({
    count: Number(c),
    odds: weights[s].map((w) => (totals[s] > 0n ? Number((BigInt(w) * 10n ** 12n) / totals[s]) / 1e12 : 0)),
  }));
}

/** A Series' pack shape and odds (RecipeDealer.slotsOf): its slots in pack order, each with its cards and its own odds
 *  per card type. Fixed once the Series locks; the same in every pack. */
export async function seriesSlots(fire: number): Promise<SlotOdds[]> {
  return slotOddsOf(await read<SlotsRaw>("RecipeDealer", dealerAbi, "slotsOf", [BigInt(fire)]));
}

/** One Series: its drop's settings, status and groups, and its cards' dealing state. */
export async function series(fire: number): Promise<SeriesInfo> {
  const f = BigInt(fire);
  const [d, p, fi, chars, per, now] = await Promise.all([
    read<DropRaw>("FireSale", saleAbi, "dropOf", [f]),
    read<StatusRaw>("FireSale", saleAbi, "status", [f]),
    read<readonly [Address, boolean, boolean, number, bigint, bigint]>("FireCards", cardsAbi, "fires", [f]),
    read<bigint>("FireCards", cardsAbi, "characterCount", [f]).catch(() => 0n),
    read<bigint>("RecipeDealer", dealerAbi, "cardsPerPack", [f]).catch(() => 0n),
    chainNow(),
  ]);
  const s = Number(d.start), maxPerTx = d.maxPerTx || 50;
  const gs = p.configured ? await groups(fire, maxPerTx) : [];
  const closed = p.closed || d.closed, left = closed ? 0 : count(p.left);
  return {
    fire, start: s, packs: Number(d.packs), maxPerTx, regularWalletsEnds: s + d.regularWalletsFor, paperCapUsd: usd8(d.paperCapUsd),
    regularWalletsFor: Number(d.regularWalletsFor),
    creditsPerPick: d.creditsPerPick, creditGroup: d.creditGroup === NONE ? null : d.creditGroup,
    creditPacksMax: Number(d.creditPacksMax), creditPacksPerWallet: Number(d.creditPacksPerWallet),
    sold: Number(d.sold), creditPacks: Number(d.creditPacks),
    status: {
      configured: p.configured, live: p.live, closed, paused: p.paused, plankPriceOk: p.plankPriceOk, regularWalletsOnly: p.regularWalletsOnly,
      left, endableAt: Number(p.endableAt), creditPacksLeft: count(p.creditPacksLeft),
    },
    closing: p.live && !closed && left === 0,
    state: closed ? "closed" : p.live ? "live" : "upcoming",
    groups: gs,
    cards: { closed: fi[1], packs: Number(fi[4]), packsDealt: Number(fi[5]), cardsPerPack: Number(fi[3]) || Number(per), characters: Number(chars) },
    now,
  };
}

/** The Series the site is about now: the live drop, else the next one coming, else the latest. Null before any drop.
 *  `nums`: seriesNumbers() when the caller already has it (one scan per sync). */
export async function currentSeries(nums?: number[]): Promise<SeriesInfo | null> {
  nums ??= await seriesNumbers();
  if (!nums.length) return null;
  // the drop now is the newest one that isn't closed (one drop at a time); else the latest
  const last = await series(nums[nums.length - 1]);
  if (last.state !== "closed" || nums.length === 1) return last;
  const all = await Promise.all(nums.slice(0, -1).map(series));
  return all.find((x) => x.state === "live") ?? all.filter((x) => x.state === "upcoming").sort((a, b) => a.start - b.start)[0] ?? last;
}

/** The drop-wide status alone (FireSale.status), cheap to poll. */
export async function status(fire: number): Promise<SeriesInfo["status"]> {
  const p = await read<StatusRaw>("FireSale", saleAbi, "status", [BigInt(fire)]);
  return {
    configured: p.configured, live: p.live, closed: p.closed, paused: p.paused, plankPriceOk: p.plankPriceOk, regularWalletsOnly: p.regularWalletsOnly,
    left: p.closed ? 0 : count(p.left), endableAt: Number(p.endableAt), creditPacksLeft: count(p.creditPacksLeft),
  };
}

export type Quote = {
  pay: PayCoin; cost: Amount | null; paper: Amount; available: boolean; reason?: string;
  /** ETH only: what the packs' PAPER costs in ETH when FireSale buys it (buyWithEthAll); null with no PAPER pool. */
  paperEth?: Amount | null;
};

/** What `n` packs of one group cost now: dollars (the rising tax included, and its part), the PAPER they burn, and
 *  the price in each coin the group takes (FireSale.quote). `paperEth`: the PAPER bought with ETH instead
 *  (buyWithEthAll), offered when the group takes ETH or has no dollar price; null without a PAPER pool. */
export type GroupQuote = { group: number; n: number; usd: string; tax: string; paper: Amount; paperEth: Amount | null; ethAlone: boolean; quotes: Quote[] };

export async function quoteGroup(fire: number, group: number, n: number): Promise<GroupQuote> {
  const f = BigInt(fire), g = BigInt(group), k = BigInt(n);
  const [cfg, price, paperRaw] = await Promise.all([
    readGroups<GroupRaw>("groupOf", [f, g]),
    readGroups<readonly [bigint, bigint]>("priceOf", [f, g, k]),
    read<bigint>("FireSale", saleAbi, "paperFor", [f, g, k]),
  ]);
  const paper = amount(paperRaw);
  const usdg = input("USDG");
  const usdgDec = usdg ? await decimalsOf(usdg) : 18;
  const coins = cfg.priceUsd === 0n ? [] : COIN_BITS.filter(([c, b]) => cfg.coins & b && (c !== "USDG" || !!usdg));
  const quotes = await Promise.all(coins.map(async ([pay]): Promise<Quote> => {
    try {
      const [cost] = await read<readonly [bigint, bigint]>("FireSale", saleAbi, "quote", [f, g, k, payIndex(pay)]);
      return { pay, cost: amount(cost, pay === "USDG" ? usdgDec : 18), paper, available: true };
    } catch { return { pay, cost: null, paper, available: false, reason: pay === "PLANK" ? "The PLANK price isn't available right now." : `${pay} price unavailable.` }; }
  }));
  const ethAlone = cfg.priceUsd === 0n || (cfg.coins & 2) !== 0;
  const paperEth = !ethAlone ? null : paperRaw === 0n ? amount(0n) : await read<bigint>("FireSale", saleAbi, "quotePaperInEth", [paperRaw]).then((e) => amount(e, 18, 8), () => null);
  const eth = quotes.find((x) => x.pay === "ETH");
  if (eth) eth.paperEth = paperEth;
  return { group, n, usd: usd8(price[0]), tax: usd8(price[1]), paper, paperEth, ethAlone, quotes };
}

/** A wallet's standing in a drop: packs it took in each group (for the wallet limits) and credit packs used. */
export async function myGroupStanding(fire: number, owner: Address): Promise<{ bought: number[]; creditPacksUsed: number }> {
  const f = BigInt(fire);
  const [b, credit] = await Promise.all([
    readGroups<readonly bigint[]>("boughtBy", [f, owner]),
    read<bigint>("FireSale", saleAbi, "creditPacksBy", [f, owner]),
  ]);
  return { bought: b.map(Number), creditPacksUsed: Number(credit) };
}

// ---------------------------------------------------------------- wallet

/** ETH, PAPER, PLANK and USDG held. */
export async function balances(owner: Address): Promise<Record<"ETH" | "PAPER" | "PLANK" | "USDG", Amount | null>> {
  const tok = async (t: Address | undefined) => (t ? amount(await pub().readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner] }), await decimalsOf(t)) : null);
  const [eth, paper, plank, usdg] = await Promise.all([pub().getBalance({ address: owner }).then((v) => amount(v)), tok(input("PAPER")), tok(input("PLANK")), tok(input("USDG"))]);
  return { ETH: eth, PAPER: paper, PLANK: plank, USDG: usdg };
}

/** The burn address: PAPER and PLANK sent here are gone for good. */
export const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;

/** All-time PAPER and PLANK burned: what the burn address holds (the site's burn tally). */
export async function burnedTotals(): Promise<{ PAPER: Amount | null; PLANK: Amount | null }> {
  const b = await balances(DEAD);
  return { PAPER: b.PAPER, PLANK: b.PLANK };
}

const liquidityAbi = [
  { type: "function", name: "lpBurned", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "PAIR", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;
const pairAbi = [
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "token0", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "getReserves", inputs: [], outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }], stateMutability: "view" },
] as const;

/** The liquidity LiquidityBurner has burned (docs/liquidity-burn.md): its pool tokens sent to the burn address, and
 *  the PAPER and PLANK they hold in the PAPER/PLANK pool today (their share of its reserves). null before it's
 *  deployed or before its first burn. */
export async function liquidityBurned(): Promise<{ lp: Amount; PAPER: Amount; PLANK: Amount } | null> {
  const deployed = NET.deployment.contracts?.LiquidityBurner;
  if (!deployed) return null;
  const at = getAddress(deployed);
  const [lp, pair] = await Promise.all([
    pub().readContract({ address: at, abi: liquidityAbi, functionName: "lpBurned" }),
    pub().readContract({ address: at, abi: liquidityAbi, functionName: "PAIR" }),
  ]);
  if (lp === 0n) return null;
  const [supply, token0, [r0, r1]] = await Promise.all([
    pub().readContract({ address: pair, abi: pairAbi, functionName: "totalSupply" }),
    pub().readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    pub().readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
  ]);
  if (supply === 0n) return null;
  const paper = input("PAPER");
  const [rPaper, rPlank] = paper && getAddress(token0) === getAddress(paper) ? [r0, r1] : [r1, r0];
  return { lp: amount(lp), PAPER: amount((rPaper * lp) / supply), PLANK: amount((rPlank * lp) / supply) };
}

/** ETH to keep for the network fee on top of an ETH price: the gas price now x `gas` (room for a buy, an open or a
 *  grading on this L2), never under a small floor (0.00002 ETH). */
export async function gasReserve(gas = 1_000_000n): Promise<Amount> {
  const floor = 20_000_000_000_000n, v = (await pub().getGasPrice().catch(() => 0n)) * gas;
  return amount(v > floor ? v : floor, 18, 8);
}

/** Sealed packs held, per Series that has any. `nums`: seriesNumbers() when the caller already has it. */
export async function packsOf(owner: Address, nums?: number[]): Promise<{ fire: number; count: number }[]> {
  nums ??= await seriesNumbers();
  const counts = await Promise.all(nums.map((n) => read<bigint>("FirePacks", packsAbi, "balanceOf", [owner, BigInt(n)])));
  return nums.map((fire, i) => ({ fire, count: Number(counts[i]) })).filter((x) => x.count > 0);
}

const nftAbi = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "ownerOf", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "tokenOfOwnerByIndex", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

/** How many NFTs of collection `nft` a wallet holds (0 if it can't be read). */
export async function nftCount(nft: Address, owner: Address): Promise<number> {
  try { return Number(await pub().readContract({ address: nft, abi: nftAbi, functionName: "balanceOf", args: [owner] })); } catch { return 0; }
}

/** Whether `owner` holds NFT `id` of `nft` (for a collection that can't list its owners' tokens: the holder types it). */
export async function ownsNft(nft: Address, owner: Address, id: number): Promise<boolean> {
  try { return getAddress(await pub().readContract({ address: nft, abi: nftAbi, functionName: "ownerOf", args: [BigInt(id)] })) === getAddress(owner); } catch { return false; }
}

/** The NFT ids of `nft` a wallet holds (up to 50): the collection's own list (ERC721Enumerable), else the explorer's,
 *  each checked on chain (ownerOf: the explorer can lag a transfer). Empty if neither can list them: the holder types it. */
export async function nftsOf(nft: Address, owner: Address): Promise<number[]> {
  try {
    const n = Number(await pub().readContract({ address: nft, abi: nftAbi, functionName: "balanceOf", args: [owner] }));
    const ids = await Promise.all(Array.from({ length: Math.min(n, 50) }, (_, i) => pub().readContract({ address: nft, abi: nftAbi, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] })));
    return ids.map(Number);
  } catch { /* not enumerable: ask the explorer */ }
  if (!NET.explorer) return [];
  try {
    const listed = await new BlockscoutData({ packs: addr("FirePacks"), cards: addr("FireCards") }, NET.explorer).erc721IdsOf(owner, nft);
    const mine = await Promise.all([...new Set(listed)].slice(0, 50).map(async (id) => ((await ownsNft(nft, owner, id)) ? id : null)));
    return mine.filter((id): id is number => id !== null).sort((a, b) => a - b);
  } catch { return []; }
}

/** How many Paper Presses a wallet holds (0 when the Press isn't set up on this network). */
export async function pressCount(owner: Address): Promise<number> {
  const press = input("MILL");
  return press ? nftCount(press, owner) : 0;
}

/** How many Paper Presses exist now (the Press contract's totalSupply: burned Presses don't count), or null when it
 *  can't be read (no Press on this network, or a collection without totalSupply). Cached for 10 minutes. */
let pressSupplyAt = 0, pressSupplyV: Promise<number | null> | null = null;
export function pressSupply(): Promise<number | null> {
  const press = input("MILL");
  if (!press) return Promise.resolve(null);
  if (pressSupplyV && Date.now() - pressSupplyAt < 600_000) return pressSupplyV;
  pressSupplyAt = Date.now();
  pressSupplyV = pub().readContract({ address: press, abi: erc20Abi, functionName: "totalSupply" }).then((n) => Number(n), () => { pressSupplyAt = 0; return null; });
  return pressSupplyV;
}

/** Packs already taken with each NFT id in an NFT-gated group this drop (FireGroups.usedWith), whoever held it. */
export async function nftUse(fire: number, group: number, ids: number[]): Promise<{ id: number; used: number }[]> {
  const f = BigInt(fire), g = BigInt(group);
  return Promise.all(ids.map(async (id) => ({ id, used: Number(await readGroups<bigint>("usedWith", [f, g, BigInt(id)])) })));
}

// ---------------------------------------------------------------- cards

export type Card = {
  serial: number; fire: number; name: string; image: string; character: string; category: string; material: string;
  holo: "none" | "frame" | "picture" | "full"; holoFrame: boolean; holoPicture: boolean;
  /** Print number: this is the k-th of this exact card (Series, character, material, holo look) ever dealt ("#k").
   *  `edition` is the same number as text (kept for older callers). */
  print: number; edition: string;
  grade: number | null; cased: boolean; moves: number; dealtAt: number; gradePending: boolean;
  /** Seconds of wear time: uncased since dealt, frozen once cased or sent for grading (FireCards.wearOf; a cancelled
   *  grading's frozen gap doesn't count). Read at the chain's latest block. */
  age: number;
  traits: Record<string, string | number>;
};
// printNumber: FireCards' print number (#k of this exact card: Series, character, type, holo look, in the order dealt).
type CardRaw = { fire: bigint; cardType: bigint; holoFrame: boolean; holoPicture: boolean; character: bigint; printNumber: bigint;
  grade: bigint; cased: boolean; age: bigint; moves: bigint; dealtAt: bigint; extra: bigint };

/** The card's metadata JSON from tokenURI (data:application/json;base64,...). */
function decodeUri(uri: string): { name?: string; image?: string; attributes?: { trait_type: string; value: string | number }[] } {
  const m = /^data:application\/json;base64,(.*)$/.exec(uri);
  if (!m) return {};
  try {
    const bin = atob(m[1]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return {}; }
}

/** One card, with everything the site shows. */
export async function card(serial: number): Promise<Card> {
  const s = BigInt(serial);
  const [c, uri, pending] = await Promise.all([
    read<CardRaw>("FireCards", cardsAbi, "cardOf", [s]),
    read<string>("CardsRenderer", rendererAbi, "tokenURI", [s]).catch(() => ""),
    read<boolean>("FireCards", cardsAbi, "gradePending", [s]).catch(() => false),
  ]);
  const meta = decodeUri(uri);
  const traits: Record<string, string | number> = {};
  for (const a of meta.attributes ?? []) traits[a.trait_type] = a.value;
  const holo = c.holoFrame && c.holoPicture ? "full" : c.holoFrame ? "frame" : c.holoPicture ? "picture" : "none";
  // the metadata's "Print number", else the card's own field
  const print = Number(String(traits["Print number"] ?? c.printNumber).replace(/^#/, "")) || 0;
  return {
    serial, fire: Number(c.fire), name: meta.name ?? `#${serial}`, image: meta.image ?? "",
    character: String(traits.Character ?? ""), category: String(traits.Category ?? ""), material: String(traits.Material ?? ""),
    holo, holoFrame: c.holoFrame, holoPicture: c.holoPicture, print, edition: String(print),
    grade: c.grade ? Number(c.grade) : null, cased: c.cased, moves: Number(c.moves), dealtAt: Number(c.dealtAt), gradePending: pending,
    age: Number(c.age), traits,
  };
}

/** The serials a wallet holds: the explorer's list when there is one (fast), else a scan of FireCards transfers
 *  since the deploy (any RPC). */
export async function cardSerialsOf(owner: Address): Promise<number[]> {
  if (NET.explorer) {
    try {
      const bs = new BlockscoutData({ packs: addr("FirePacks"), cards: addr("FireCards") }, NET.explorer);
      const out: number[] = [];
      let next: string | undefined;
      for (let i = 0; i < 40; i++) {
        const page = await bs.cardsOf(owner, next);
        out.push(...page.items.map((c) => Number(c.tokenId)));
        if (!(next = page.next)) break;
      }
      return out.sort((a, b) => b - a);
    } catch { /* the explorer is down or slow: scan the chain instead */ }
  }
  const transfer = eventOf(cardsAbi, "Transfer");
  const got = await scanLogs(addr("FireCards"), transfer, { to: owner });
  const ids = [...new Set(got.map((l) => argsOf<{ tokenId: bigint }>(l).tokenId))];
  const owners = await Promise.all(ids.map((id) => read<Address>("FireCards", cardsAbi, "ownerOf", [id]).catch(() => null)));
  return ids.filter((_, i) => owners[i] && getAddress(owners[i]!) === getAddress(owner)).map(Number).sort((a, b) => b - a);
}

/** A wallet's cards, newest first (all of them, read in parallel batches). */
export async function cardsOf(owner: Address): Promise<Card[]> {
  const serials = await cardSerialsOf(owner);
  const out: Card[] = [];
  for (let i = 0; i < serials.length; i += 20) out.push(...(await Promise.all(serials.slice(i, i + 20).map(card))));
  return out;
}

// ---------------------------------------------------------------- free packs and burning

/** Free pack credits, and progress toward the next one from burning (every CARDS_PER_CREDIT cards). */
export async function credits(owner: Address) {
  const [n, burned, per] = await Promise.all([
    read<bigint>("FireCredits", creditsAbi, "credits", [owner]),
    read<bigint>("FireCredits", creditsAbi, "burnCount", [owner]),
    read<bigint>("FireCredits", creditsAbi, "CARDS_PER_CREDIT"),
  ]);
  return { credits: Number(n), burnedTowardNext: Number(burned), cardsPerCredit: Number(per) };
}

// ---------------------------------------------------------------- suggestions

export type Suggestion = { id: number; by: string; round: number; text: string; at: number; picked: boolean };

/** The suggestion box's rules now. `many`: theme + style in one transaction (FireCredits.suggestMany); false on an
 *  older deploy, where each suggestion is its own transaction. */
export async function suggestionRules() {
  const [paper, maxBytes, round, count, many] = await Promise.all([
    read<bigint>("FireCredits", creditsAbi, "suggestionPaper"),
    read<bigint>("FireCredits", creditsAbi, "suggestionMaxBytes"),
    read<number>("FireCredits", creditsAbi, "currentRound"),
    read<bigint>("FireCredits", creditsAbi, "suggestionCount"),
    hasFunction("FireCredits", "suggestMany(string[],uint256)"),
  ]);
  const perTx = many ? Number(await read<bigint>("FireCredits", creditsAbi, "MAX_SUGGESTIONS_PER_TX").catch(() => 3n)) : 1;
  return { paperEach: amount(paper), maxBytes: Number(maxBytes), round: Number(round), total: Number(count), many, perTx };
}

const decodeText = (t: unknown) => (typeof t === "string" ? t : hexToString(t as Hex));

/** Suggestions, newest first: one wallet's (`by`), or one round's (the box the next Series is picked from), or all. */
export async function suggestions(opts: { by?: Address; round?: number } = {}): Promise<Suggestion[]> {
  const args: Record<string, unknown> = {};
  if (opts.by) args.by = opts.by;
  if (opts.round !== undefined) args.round = opts.round;
  const logs = await scanLogs(addr("FireCredits"), eventOf(creditsAbi, "Suggested"), Object.keys(args).length ? args : undefined);
  const list = logs.map((l) => argsOf<{ id: bigint; by: Address; round: number; text: string }>(l));
  const raw = await Promise.all(list.map((x) => read<readonly [Address, bigint, boolean, number]>("FireCredits", creditsAbi, "suggestions", [x.id])));
  return list.map((x, i) => ({ id: Number(x.id), by: x.by, round: Number(x.round), text: decodeText(x.text), at: Number(raw[i][1]), picked: raw[i][2] }))
    .sort((a, b) => b.id - a.id);
}

export type Pick = { fire: number; id: number; by: string; credits: number; text: string };

const pickTexts = new Map<number, string>(); // a suggestion's text never changes: read once per tab

/** The picks, per Series (results page): which suggestions won, by whom, and the credits each got. Only the picked
 *  suggestions' texts are read (by id), not the whole box. */
export async function picks(fire?: number): Promise<Pick[]> {
  const logs = await scanLogs(addr("FireCredits"), eventOf(creditsAbi, "SuggestionPicked"), fire !== undefined ? { fire: BigInt(fire) } : undefined);
  const list = logs.map((l) => argsOf<{ fire: bigint; id: bigint; by: Address; credits: bigint }>(l));
  if (!list.length) return [];
  const missing = [...new Set(list.map((x) => x.id))].filter((id) => !pickTexts.has(Number(id)));
  if (missing.length) {
    const sugg = await scanLogs(addr("FireCredits"), eventOf(creditsAbi, "Suggested"), { id: missing });
    for (const l of sugg) { const a = argsOf<{ id: bigint; text: string }>(l); pickTexts.set(Number(a.id), decodeText(a.text)); }
  }
  return list.map((x) => ({ fire: Number(x.fire), id: Number(x.id), by: x.by, credits: Number(x.credits), text: pickTexts.get(Number(x.id)) ?? "" }));
}

// ---------------------------------------------------------------- opening

export type OpenStatus = {
  fire: number; index: number; packs: number;
  /** waiting: for its drand round; deliverable: the round is out, nobody delivered it yet; ready: delivered, cards not
   *  dealt yet; dealt: done; cancelled: randomness never came, packs back. */
  status: "waiting" | "deliverable" | "ready" | "dealt" | "cancelled";
  round: number | null; roundAt: number | null; requestedAt: number;
  /** When anyone may cancel it if no answer came (requestedAt + CANCEL_AFTER), and whether that's now (writes.cancelOpen). */
  cancelAt: number; canCancel: boolean;
  /** The chain's clock when this was read. */
  now: number;
};
/** FireCards / FirePsa CANCEL_AFTER: a request with no answer this long after it was asked for can be cancelled. */
export const CANCEL_AFTER = 24 * 3600;
/** No answer yet, and CANCEL_AFTER has passed (the contracts' own test: not ready, not answered, late enough). */
const cancellable = (ready: boolean, requestedAt: number, now: number, r: { fulfilled: boolean } | null) =>
  !ready && !!r && !r.fulfilled && now >= requestedAt + CANCEL_AFTER;
type OpenRaw = { to: Address; requestedAt: bigint; readyAt: bigint; ready: boolean; count: bigint; packsDone: bigint; cardInPack: number; source: Address; requestId: bigint; packBase: bigint; word: bigint };

const routerRequestsAbi = [{
  type: "function", name: "requests", inputs: [{ type: "uint256" }], stateMutability: "view",
  outputs: [{ name: "consumer", type: "address" }, { name: "round", type: "uint64" }, { name: "callbackGasLimit", type: "uint32" }, { name: "fulfilled", type: "bool" },
    { name: "delivered", type: "bool" }, { name: "randomWord", type: "uint256" }, { name: "fee", type: "uint256" }],
}] as const;
const adapterRouterAbi = [{ type: "function", name: "ROUTER", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }] as const;

/** A randomness request (FireCards or FirePsa asked `source`, an adapter, for it): its drand round and whether the
 *  router has it. */
export async function requestInfo(source: Address, requestId: bigint) {
  const router = await pub().readContract({ address: source, abi: adapterRouterAbi, functionName: "ROUTER" });
  const r = await pub().readContract({ address: router, abi: routerRequestsAbi, functionName: "requests", args: [requestId] });
  const round = Number(r[1]);
  return { router, round, roundAt: Number(DRAND_GENESIS + (BigInt(round) - 1n) * DRAND_PERIOD), fulfilled: r[3], delivered: r[4] };
}

/** A wallet's pack opens, newest first, with where each one is. */
export async function opensOf(owner: Address): Promise<OpenStatus[]> {
  const logs = await scanLogs(addr("FireCards"), eventOf(cardsAbi, "PacksOpened"), { holder: owner });
  const now = await chainNow();
  const out = await Promise.all(logs.map(async (l) => {
    const a = argsOf<{ fire: bigint; openIndex: bigint; count: bigint }>(l);
    const [o, head] = await Promise.all([
      read<OpenRaw>("FireCards", cardsAbi, "openOf", [a.fire, a.openIndex]),
      read<bigint>("FireCards", cardsAbi, "headOf", [a.fire]),
    ]);
    let status: OpenStatus["status"]; let round: number | null = null; let roundAt: number | null = null, canCancel = false;
    if (o.count === 0n && o.ready) status = "cancelled";
    else if (a.openIndex < head) status = "dealt";
    else {
      const r = await requestInfo(o.source, o.requestId).catch(() => null);
      round = r?.round ?? null; roundAt = r?.roundAt ?? null;
      status = o.ready ? "ready" : r && (r.fulfilled || now >= r.roundAt) ? "deliverable" : "waiting";
      canCancel = cancellable(o.ready, Number(o.requestedAt), now, r);
    }
    return { fire: Number(a.fire), index: Number(a.openIndex), packs: Number(a.count), status, round, roundAt, requestedAt: Number(o.requestedAt),
      cancelAt: Number(o.requestedAt) + CANCEL_AFTER, canCancel, now };
  }));
  return out.sort((x, y) => y.requestedAt - x.requestedAt || y.index - x.index);
}

/** One open, by its index (what openPacks returned): where it is, with no log scan, so it can be polled cheaply while
 *  the buyer waits. `now` is the chain's clock. */
export async function openStatus(fire: number, index: number): Promise<OpenStatus> {
  const f = BigInt(fire);
  const [o, head, now] = await Promise.all([
    read<OpenRaw>("FireCards", cardsAbi, "openOf", [f, BigInt(index)]),
    read<bigint>("FireCards", cardsAbi, "headOf", [f]),
    chainNow(),
  ]);
  let status: OpenStatus["status"]; let round: number | null = null; let roundAt: number | null = null, canCancel = false;
  if (o.count === 0n && o.ready) status = "cancelled";
  else if (BigInt(index) < head) status = "dealt";
  else {
    const r = await requestInfo(o.source, o.requestId).catch(() => null);
    round = r?.round ?? null; roundAt = r?.roundAt ?? null;
    status = o.ready ? "ready" : r && (r.fulfilled || now >= r.roundAt) ? "deliverable" : "waiting";
    canCancel = cancellable(o.ready, Number(o.requestedAt), now, r);
  }
  return { fire, index, packs: Number(o.count), status, round, roundAt, requestedAt: Number(o.requestedAt), cancelAt: Number(o.requestedAt) + CANCEL_AFTER, canCancel, now };
}

/** A Series' opening queue: opens waiting, and how many at its head are ready to deal. */
export async function queue(fire: number) {
  const [queued, ready] = await read<readonly [bigint, bigint]>("FireCards", cardsAbi, "pending", [BigInt(fire)]);
  return { queued: Number(queued), readyAtHead: Number(ready) };
}

// ---------------------------------------------------------------- cases and grading

/** Case and grading prices (dollars: one case price and one grading price for every card) and the batch limit. */
export async function psaPrices() {
  const [caseUsd, gradeUsd, maxBatch, paused] = await Promise.all([
    read<bigint>("FirePsa", psaAbi, "caseUsd18"), read<bigint>("FirePsa", psaAbi, "gradeUsd18"),
    read<bigint>("FirePsa", psaAbi, "maxBatch"), read<boolean>("FirePsa", psaAbi, "paused"),
  ]);
  return { caseUsd: (Number(caseUsd) / 1e18).toFixed(2), gradeUsd: (Number(gradeUsd) / 1e18).toFixed(2), maxBatch: Number(maxBatch), paused };
}

/** Exactly what casing `caseIds` and grading `gradeIds` costs now in `pay` (FirePsa.quote: what protect charges; every
 *  card costs the same, so only the counts matter). */
export async function quoteProtect(caseIds: readonly number[], gradeIds: readonly number[], pay: PsaCoin, owner?: Address | null): Promise<Amount & { freeCases: number; freeGrades: number }> {
  const c = await couponsOf(owner);
  const freeCases = Math.min(c.cases, caseIds.length), freeGrades = Math.min(c.grades, gradeIds.length);
  const nc = caseIds.length - freeCases, ng = gradeIds.length - freeGrades;
  const raw = nc + ng ? await read<bigint>("FirePsa", psaAbi, "quote", [BigInt(nc), BigInt(ng), psaPayIndex(pay)]) : 0n;
  return { ...amount(raw, pay === "USDG" && input("USDG") ? await decimalsOf(input("USDG")!) : 18), freeCases, freeGrades };
}

/** Free cases and gradings a wallet holds (game prizes, FirePsa coupons). FirePsa.protect uses them first. */
export async function couponsOf(owner?: Address | null): Promise<{ cases: number; grades: number }> {
  if (!owner) return { cases: 0, grades: 0 };
  const [cases, grades] = await Promise.all([read<bigint>("FirePsa", psaAbi, "caseCoupons", [owner]), read<bigint>("FirePsa", psaAbi, "gradeCoupons", [owner])]);
  return { cases: Number(cases), grades: Number(grades) };
}

/** A grading: done also when it was cancelled (its cards came back ungraded). cancelAt / canCancel: as for opens
 *  (writes.cancelGrading). `now`: the chain's clock. */
export type GradingStatus = { index: number; ids: number[]; status: "waiting" | "deliverable" | "ready" | "done"; round: number | null; roundAt: number | null; requestedAt: number;
  cancelAt: number; canCancel: boolean; now: number };
type GradingRaw = { by: Address; requestedAt: bigint; ready: boolean; done: boolean; source: Address; requestId: bigint; word: bigint; idsHash: Hex };

/** A wallet's gradings (cards sent for grading together), newest first. */
export async function gradingsOf(owner: Address): Promise<GradingStatus[]> {
  const logs = await scanLogs(addr("FirePsa"), eventOf(psaAbi, "Protected"), { by: owner });
  const now = await chainNow();
  const NONE = (1n << 256n) - 1n;
  const out = await Promise.all(logs.map((l) => argsOf<{ graded: readonly bigint[]; gradingIndex: bigint }>(l)).filter((a) => a.gradingIndex !== NONE).map(async (a) => {
    const g = await read<GradingRaw>("FirePsa", psaAbi, "gradingOf", [a.gradingIndex]);
    let status: GradingStatus["status"]; let round: number | null = null; let roundAt: number | null = null, canCancel = false;
    if (g.done) status = "done";
    else {
      const r = await requestInfo(g.source, g.requestId).catch(() => null);
      round = r?.round ?? null; roundAt = r?.roundAt ?? null;
      status = g.ready ? "ready" : r && (r.fulfilled || now >= r.roundAt) ? "deliverable" : "waiting";
      canCancel = cancellable(g.ready, Number(g.requestedAt), now, r);
    }
    return { index: Number(a.gradingIndex), ids: a.graded.map(Number), status, round, roundAt, requestedAt: Number(g.requestedAt),
      cancelAt: Number(g.requestedAt) + CANCEL_AFTER, canCancel, now };
  }));
  return out.sort((x, y) => y.index - x.index);
}

/** One grading, by its index: where it is, with no log scan (for polling while the buyer waits). `now`: the chain's clock. */
export async function gradingStatus(index: number): Promise<Omit<GradingStatus, "ids">> {
  const [g, now] = await Promise.all([read<GradingRaw>("FirePsa", psaAbi, "gradingOf", [BigInt(index)]), chainNow()]);
  let status: GradingStatus["status"]; let round: number | null = null; let roundAt: number | null = null, canCancel = false;
  if (g.done) status = "done";
  else {
    const r = await requestInfo(g.source, g.requestId).catch(() => null);
    round = r?.round ?? null; roundAt = r?.roundAt ?? null;
    status = g.ready ? "ready" : r && (r.fulfilled || now >= r.roundAt) ? "deliverable" : "waiting";
    canCancel = cancellable(g.ready, Number(g.requestedAt), now, r);
  }
  return { index, status, round, roundAt, requestedAt: Number(g.requestedAt), cancelAt: Number(g.requestedAt) + CANCEL_AFTER, canCancel, now };
}

/** The card list a grading was sent with, in order: what finish() needs. `known`: the list the page sent, used as is
 *  when it matches the grading's idsHash (no log scan); else it's read from the grading's Protected event. */
export async function gradingIds(index: number, known?: readonly number[]): Promise<bigint[]> {
  if (known?.length) {
    const ids = known.map(BigInt);
    const g = await read<GradingRaw>("FirePsa", psaAbi, "gradingOf", [BigInt(index)]);
    if (keccak256(encodeAbiParameters([{ type: "uint256[]" }], [ids])) === g.idsHash) return ids;
  }
  const logs = await scanLogs(addr("FirePsa"), eventOf(psaAbi, "Protected"));
  for (const l of logs) {
    const a = argsOf<{ graded: readonly bigint[]; gradingIndex: bigint }>(l);
    if (a.gradingIndex === BigInt(index)) return [...a.graded];
  }
  throw new Error(`No grading #${index}`);
}

/** One slab in the pop report: its Series, material (the metadata's Material trait) and grade. */
export type PopSlab = { serial: number; fire: number; material: string; grade: number };
const slabKinds = new Map<number, Promise<{ fire: number; material: string } | null>>(); // a slab's kind never changes
/** The pop report's raw list: every slab that still exists, from FirePsa's `Graded` events (an incremental cached scan),
 *  each slab's Series and material read once and kept for the tab's life. A burned slab is left out (it no longer exists). */
export async function gradedPop(): Promise<PopSlab[]> {
  const logs = await scanLogs(addr("FirePsa"), eventOf(psaAbi, "Graded"));
  const graded = new Map<number, number>();
  for (const l of logs) { const a = argsOf<{ serial: bigint; grade: bigint }>(l); graded.set(Number(a.serial), Number(a.grade)); }
  const out = await Promise.all([...graded].map(async ([serial, grade]) => {
    let k = slabKinds.get(serial);
    if (!k) {
      k = card(serial).then((c) => ({ fire: c.fire, material: c.material }), () => null);
      slabKinds.set(serial, k);
    }
    const kind = await k;
    if (!kind) slabKinds.delete(serial); // burned (or a blip): asked again next time
    return kind ? { serial, grade, ...kind } : null;
  }));
  return out.filter((x): x is PopSlab => !!x);
}

// ---------------------------------------------------------------- snapshot groups

/** The leaf a snapshot group checks: keccak256(keccak256(abi.encode(wallet, allowance))) (OpenZeppelin
 *  StandardMerkleTree of ["address", "uint256"], as FireGroups._admit). */
export function snapshotLeaf(owner: Address, allowance: bigint | number): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(owner), BigInt(allowance)])));
}

/** Is `proof` a valid snapshot proof of (`owner`, `allowance`) under `root`? Pairs hashed sorted (OpenZeppelin
 *  MerkleProof), the same check as FireGroups. */
export function verifySnapshotProof(proof: readonly Hex[], root: string, owner: Address, allowance: bigint | number): boolean {
  if (!/^0x[0-9a-f]{64}$/i.test(root) || BigInt(root) === 0n || !isAddress(owner)) return false;
  let h = snapshotLeaf(owner, allowance);
  for (const p of proof) h = BigInt(h) < BigInt(p) ? keccak256(concat([h, p])) : keccak256(concat([p, h]));
  return h.toLowerCase() === root.toLowerCase();
}

type SnapEntry = { allowance?: number | string; proof?: Hex[] };
type SnapFile = {
  root?: string; name?: string; label?: string;
  wallets?: Record<string, SnapEntry> | (SnapEntry & { address?: string; wallet?: string })[];
  proofs?: Record<string, Hex[]>; allowances?: Record<string, number | string>; holders?: { wallet?: string; address?: string; allowance?: number | string }[];
  groups?: SnapFile[] | Record<string, SnapFile>; snapshots?: SnapFile[];
};

/** The part of a snapshot file (ops/snapshot, published as holders/series-<n>.json) for one root: the file itself, or
 *  one of its `groups` / `snapshots` (a drop with several snapshot groups). Null if none has that root. */
export function snapshotFor(file: unknown, root: string): (SnapFile & { name?: string }) | null {
  const f = file as SnapFile | null;
  if (!f || typeof f !== "object") return null;
  const same = (x?: string) => !!x && x.toLowerCase() === root.toLowerCase();
  if (same(f.root)) return f;
  const parts = [...(Array.isArray(f.groups) ? f.groups : Object.values(f.groups ?? {})), ...(f.snapshots ?? [])];
  return parts.find((p) => same(p?.root)) ?? null;
}

/** A wallet's place in a snapshot group: its allowance and proof, checked against the group's `root` (null: not on
 *  it, or the file's entry doesn't check out). Reads the file ops/snapshot writes: `wallets` as { address: {
 *  allowance, proof } } or a list of { address, allowance, proof }, or the older `proofs` map with `allowances` /
 *  `holders[].allowance` beside it. */
export function snapshotEntry(file: unknown, root: string, owner: Address): { allowance: number; proof: Hex[] } | null {
  const s = snapshotFor(file, root);
  if (!s || !isAddress(owner)) return null;
  const key = getAddress(owner);
  const is = (k?: string) => !!k && isAddress(k) && getAddress(k) === key;
  let e: SnapEntry | undefined;
  if (Array.isArray(s.wallets)) e = s.wallets.find((w) => is(w.address ?? w.wallet));
  else if (s.wallets) e = Object.entries(s.wallets).find(([k]) => is(k))?.[1];
  if (!e && s.proofs) {
    const proof = Object.entries(s.proofs).find(([k]) => is(k))?.[1];
    const allowance = Object.entries(s.allowances ?? {}).find(([k]) => is(k))?.[1] ?? s.holders?.find((h) => is(h.wallet ?? h.address))?.allowance;
    if (proof) e = { proof, allowance };
  }
  if (!e?.proof || e.allowance == null) return null;
  const allowance = Number(e.allowance);
  return verifySnapshotProof(e.proof, root, owner, BigInt(e.allowance)) ? { allowance, proof: e.proof } : null;
}
