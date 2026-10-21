// What the live site reads from the card contracts. Every function returns plain objects: numbers, strings, booleans
// and Amounts (raw as a decimal string plus text), so the plain-JS Forge can use them as they are.

import { erc20Abi, getAddress, hexToString, isAddress, type Address, type Hex } from "viem";
import { NET } from "../net";
import { BlockscoutData } from "../blockscout";
import { DRAND_GENESIS, DRAND_PERIOD } from "../drand";
import {
  addr, amount, argsOf, cardsAbi, chainNow, creditsAbi, dealerAbi, decimalsOf, eventOf, hasFunction, input, packsAbi, psaAbi,
  pub, read, rendererAbi, saleAbi, scanLogs, type Amount,
} from "./contracts";

export const PAY = ["PLANK", "ETH", "USDG"] as const;
export type PayCoin = (typeof PAY)[number];
export const payIndex = (p: PayCoin): number => PAY.indexOf(p);

// ---------------------------------------------------------------- Series and their drops

type DropRaw = {
  start: bigint; packs: bigint; starters: bigint; plankOnly: bigint; walletLimit: bigint; paidSold: bigint; startersClaimed: bigint;
  creditPacks: bigint; starterWindow: number; liftAfter: number; holderWindow: number; maxPerTx: number; plankOnlyFor: number;
  regularWalletsFor: number; starterPerPress: number; starterWalletLimit: number; creditsPerPick: number; plankBurnBps: number;
  creditPacksMax: bigint; creditPacksPerWallet: bigint; closed: boolean; priceUsd: bigint; paperPerPack: bigint; starterPriceUsd: bigint;
  starterPaper: bigint; holderRoot: Hex; paperCapUsd: bigint;
};
type PhaseRaw = {
  configured: boolean; live: boolean; closed: boolean; plankOnly: boolean; limitLifted: boolean; startersOpen: boolean; plankPriceOk: boolean;
  holdersOnly: boolean; regularWalletsOnly: boolean; paused: boolean; paidLeft: bigint; startersLeft: bigint; phasesOver: bigint; creditPacksLeft: bigint;
};

export type SeriesInfo = {
  fire: number;
  /** The drop's settings (times are unix seconds; windows are seconds after start). */
  start: number; packs: number; pressPacks: number; plankOnlyPacks: number; walletLimit: number; maxPerTx: number;
  holderWindowEnds: number; plankOnlyEnds: number; limitLiftsAt: number; pressWindowEnds: number; regularWalletsEnds: number;
  priceUsd: string; paperPerPack: Amount; paperCapUsd: string; holderRoot: string; creditsPerPick: number;
  /** Running numbers. */
  sold: number; pressClaimed: number; creditPacks: number;
  /** The drop now (FireSale.phase). */
  phase: { configured: boolean; live: boolean; closed: boolean; plankOnly: boolean; limitLifted: boolean; pressOpen: boolean; plankPriceOk: boolean;
    holdersOnly: boolean; regularWalletsOnly: boolean; paused: boolean; paidLeft: number; pressLeft: number; phasesOver: number; creditPacksLeft: number };
  /** Before it opens / open / sold out or ended. */
  state: "upcoming" | "live" | "closed";
  /** The Series' cards (FireCards): dealing state. */
  cards: { closed: boolean; packs: number; packsDealt: number; cardsPerPack: number; characters: number };
};

const usd8 = (v: bigint) => (Number(v) / 1e8).toFixed(2);

/** The Series that have a drop, oldest first (FireSale DropConfigured since the deploy). */
export async function seriesNumbers(): Promise<number[]> {
  const logs = await scanLogs(addr("FireSale"), eventOf(saleAbi, "DropConfigured"));
  return [...new Set(logs.map((l) => Number(argsOf<{ fire: bigint }>(l).fire)))].sort((a, b) => a - b);
}

/** One Series: its drop's settings and phase, and its cards' dealing state. */
export async function series(fire: number): Promise<SeriesInfo> {
  const f = BigInt(fire);
  const [d, p, fi, chars, per] = await Promise.all([
    read<DropRaw>("FireSale", saleAbi, "dropOf", [f]),
    read<PhaseRaw>("FireSale", saleAbi, "phase", [f]),
    read<readonly [Address, boolean, boolean, number, bigint, bigint]>("FireCards", cardsAbi, "fires", [f]),
    read<bigint>("FireCards", cardsAbi, "characterCount", [f]).catch(() => 0n),
    read<bigint>("RecipeDealer", dealerAbi, "cardsPerPack", [f]).catch(() => 0n),
  ]);
  const s = Number(d.start);
  return {
    fire, start: s, packs: Number(d.packs), pressPacks: Number(d.starters), plankOnlyPacks: Number(d.plankOnly), walletLimit: Number(d.walletLimit),
    maxPerTx: d.maxPerTx || 50, holderWindowEnds: s + d.holderWindow, plankOnlyEnds: s + d.plankOnlyFor, limitLiftsAt: s + d.liftAfter,
    pressWindowEnds: s + d.starterWindow, regularWalletsEnds: s + d.regularWalletsFor,
    priceUsd: usd8(d.priceUsd), paperPerPack: amount(d.paperPerPack), paperCapUsd: usd8(d.paperCapUsd), holderRoot: d.holderRoot, creditsPerPick: d.creditsPerPick,
    sold: Number(d.paidSold), pressClaimed: Number(d.startersClaimed), creditPacks: Number(d.creditPacks),
    phase: {
      configured: p.configured, live: p.live, closed: p.closed, plankOnly: p.plankOnly, limitLifted: p.limitLifted, pressOpen: p.startersOpen,
      plankPriceOk: p.plankPriceOk, holdersOnly: p.holdersOnly, regularWalletsOnly: p.regularWalletsOnly, paused: p.paused,
      paidLeft: Number(p.paidLeft), pressLeft: Number(p.startersLeft), phasesOver: Number(p.phasesOver), creditPacksLeft: Number(p.creditPacksLeft),
    },
    state: p.closed || d.closed ? "closed" : p.live ? "live" : "upcoming",
    cards: { closed: fi[1], packs: Number(fi[4]), packsDealt: Number(fi[5]), cardsPerPack: Number(fi[3]) || Number(per), characters: Number(chars) },
  };
}

/** The Series the site is about now: the live drop, else the next one coming, else the latest. Null before any drop. */
export async function currentSeries(): Promise<SeriesInfo | null> {
  const nums = await seriesNumbers();
  if (!nums.length) return null;
  const all = await Promise.all(nums.map(series));
  return all.find((x) => x.state === "live") ?? all.filter((x) => x.state === "upcoming").sort((a, b) => a.start - b.start)[0] ?? all[all.length - 1];
}

export type Quote = { pay: PayCoin; cost: Amount | null; paper: Amount; available: boolean; reason?: string };

/** What `n` packs cost now in each coin, plus the PAPER they burn. A coin whose price is unavailable says so. */
export async function quotePacks(fire: number, n: number): Promise<Quote[]> {
  const f = BigInt(fire), k = BigInt(n);
  const paperRaw = await read<bigint>("FireSale", saleAbi, "paperFor", [f, k]);
  const paper = amount(paperRaw);
  const usdg = input("USDG");
  const usdgDec = usdg ? await decimalsOf(usdg) : 18;
  const one = async (pay: PayCoin, fn: string, dec: number): Promise<Quote> => {
    try { return { pay, cost: amount(await read<bigint>("FireSale", saleAbi, fn, [f, k]), dec), paper, available: true }; }
    catch { return { pay, cost: null, paper, available: false, reason: pay === "PLANK" ? "The PLANK price isn't available right now." : `${pay} price unavailable.` }; }
  };
  return Promise.all([one("PLANK", "quotePlank", 18), one("ETH", "quoteEth", 18), ...(usdg ? [one("USDG", "quoteUsdg", usdgDec)] : [])]);
}

/** Press-pack (Paper Press) claim cost: the dollar price in `pay` (none when press packs have no price) and PAPER. */
export async function quotePress(fire: number, n: number, pay: PayCoin): Promise<{ cost: Amount; paper: Amount }> {
  const [cost, paper] = await read<readonly [bigint, bigint]>("FireSale", saleAbi, "quoteStarter", [BigInt(fire), BigInt(n), payIndex(pay)]);
  return { cost: amount(cost, pay === "USDG" && input("USDG") ? await decimalsOf(input("USDG")!) : 18), paper: amount(paper) };
}

/** A wallet's standing in a drop: paid packs bought (for the wallet limit), credit and press packs used. */
export async function walletInDrop(fire: number, owner: Address) {
  const f = BigInt(fire);
  const [paid, credit, press] = await Promise.all([
    read<bigint>("FireSale", saleAbi, "paidBought", [f, owner]),
    read<bigint>("FireSale", saleAbi, "creditPacksBy", [f, owner]),
    read<bigint>("FireSale", saleAbi, "startersClaimedBy", [f, owner]),
  ]);
  return { paidBought: Number(paid), creditPacksUsed: Number(credit), pressPacksClaimed: Number(press) };
}

// ---------------------------------------------------------------- wallet

/** ETH, PAPER, PLANK and USDG held. */
export async function balances(owner: Address): Promise<Record<"ETH" | "PAPER" | "PLANK" | "USDG", Amount | null>> {
  const tok = async (t: Address | undefined) => (t ? amount(await pub().readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner] }), await decimalsOf(t)) : null);
  const [eth, paper, plank, usdg] = await Promise.all([pub().getBalance({ address: owner }).then((v) => amount(v)), tok(input("PAPER")), tok(input("PLANK")), tok(input("USDG"))]);
  return { ETH: eth, PAPER: paper, PLANK: plank, USDG: usdg };
}

/** Sealed packs held, per Series that has any. */
export async function packsOf(owner: Address): Promise<{ fire: number; count: number }[]> {
  const nums = await seriesNumbers();
  const counts = await Promise.all(nums.map((n) => read<bigint>("FirePacks", packsAbi, "balanceOf", [owner, BigInt(n)])));
  return nums.map((fire, i) => ({ fire, count: Number(counts[i]) })).filter((x) => x.count > 0);
}

/** Paper Presses held (they let a wallet in during the holder window, and claim press packs). Empty if the Press
 *  can't list its owners' tokens. */
export async function pressesOf(owner: Address): Promise<number[]> {
  const press = input("MILL");
  if (!press) return [];
  const abi = [
    { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "tokenOfOwnerByIndex", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  ] as const;
  try {
    const n = Number(await pub().readContract({ address: press, abi, functionName: "balanceOf", args: [owner] }));
    const ids = await Promise.all(Array.from({ length: Math.min(n, 50) }, (_, i) => pub().readContract({ address: press, abi, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] })));
    return ids.map(Number);
  } catch { return []; }
}

// ---------------------------------------------------------------- cards

export type Card = {
  serial: number; fire: number; name: string; image: string; character: string; category: string; material: string;
  holo: "none" | "frame" | "picture" | "full"; holoFrame: boolean; holoPicture: boolean; edition: string;
  grade: number | null; cased: boolean; moves: number; dealtAt: number; gradePending: boolean;
  traits: Record<string, string | number>;
};
type CardRaw = { fire: bigint; cardType: bigint; holoFrame: boolean; holoPicture: boolean; character: bigint; edition: bigint; editionOf: bigint;
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
  return {
    serial, fire: Number(c.fire), name: meta.name ?? `#${serial}`, image: meta.image ?? "",
    character: String(traits.Character ?? ""), category: String(traits.Category ?? ""), material: String(traits.Material ?? ""),
    holo, holoFrame: c.holoFrame, holoPicture: c.holoPicture, edition: String(traits.Edition ?? c.edition),
    grade: c.grade ? Number(c.grade) : null, cased: c.cased, moves: Number(c.moves), dealtAt: Number(c.dealtAt), gradePending: pending, traits,
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

/** The picks, per Series (results page): which suggestions won, by whom, and the credits each got. */
export async function picks(fire?: number): Promise<Pick[]> {
  const logs = await scanLogs(addr("FireCredits"), eventOf(creditsAbi, "SuggestionPicked"), fire !== undefined ? { fire: BigInt(fire) } : undefined);
  const list = logs.map((l) => argsOf<{ fire: bigint; id: bigint; by: Address; credits: bigint }>(l));
  if (!list.length) return [];
  const texts = new Map<number, string>();
  const sugg = await scanLogs(addr("FireCredits"), eventOf(creditsAbi, "Suggested"));
  for (const l of sugg) { const a = argsOf<{ id: bigint; text: string }>(l); texts.set(Number(a.id), decodeText(a.text)); }
  return list.map((x) => ({ fire: Number(x.fire), id: Number(x.id), by: x.by, credits: Number(x.credits), text: texts.get(Number(x.id)) ?? "" }));
}

// ---------------------------------------------------------------- opening

export type OpenStatus = {
  fire: number; index: number; packs: number;
  /** waiting: for its drand round; deliverable: the round is out, nobody delivered it yet; ready: delivered, cards not
   *  dealt yet; dealt: done; cancelled: randomness never came, packs back. */
  status: "waiting" | "deliverable" | "ready" | "dealt" | "cancelled";
  round: number | null; roundAt: number | null; requestedAt: number;
};
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
    let status: OpenStatus["status"]; let round: number | null = null; let roundAt: number | null = null;
    if (o.count === 0n && o.ready) status = "cancelled";
    else if (a.openIndex < head) status = "dealt";
    else if (o.ready) status = "ready";
    else {
      const r = await requestInfo(o.source, o.requestId).catch(() => null);
      round = r?.round ?? null; roundAt = r?.roundAt ?? null;
      status = r && (r.fulfilled || now >= r.roundAt) ? "deliverable" : "waiting";
    }
    return { fire: Number(a.fire), index: Number(a.openIndex), packs: Number(a.count), status, round, roundAt, requestedAt: Number(o.requestedAt) };
  }));
  return out.sort((x, y) => y.requestedAt - x.requestedAt || y.index - x.index);
}

/** A Series' opening queue: opens waiting, and how many at its head are ready to deal. */
export async function queue(fire: number) {
  const [queued, ready] = await read<readonly [bigint, bigint]>("FireCards", cardsAbi, "pending", [BigInt(fire)]);
  return { queued: Number(queued), readyAtHead: Number(ready) };
}

// ---------------------------------------------------------------- cases and grading

/** Case and grading prices (dollars, and now in each coin for one of each) and the batch limit. */
export async function psaPrices() {
  const [caseUsd, gradeUsd, maxBatch, paused] = await Promise.all([
    read<bigint>("FirePsa", psaAbi, "caseUsd18"), read<bigint>("FirePsa", psaAbi, "gradeUsd18"),
    read<bigint>("FirePsa", psaAbi, "maxBatch"), read<boolean>("FirePsa", psaAbi, "paused"),
  ]);
  return { caseUsd: (Number(caseUsd) / 1e18).toFixed(2), gradeUsd: (Number(gradeUsd) / 1e18).toFixed(2), maxBatch: Number(maxBatch), paused };
}

/** What casing `cases` cards and grading `grades` costs now in `pay`. */
export async function quoteProtect(cases: number, grades: number, pay: PayCoin): Promise<Amount> {
  const raw = await read<bigint>("FirePsa", psaAbi, "quote", [BigInt(cases), BigInt(grades), payIndex(pay)]);
  return amount(raw, pay === "USDG" && input("USDG") ? await decimalsOf(input("USDG")!) : 18);
}

export type GradingStatus = { index: number; ids: number[]; status: "waiting" | "deliverable" | "ready" | "done"; round: number | null; roundAt: number | null; requestedAt: number };
type GradingRaw = { by: Address; requestedAt: bigint; ready: boolean; done: boolean; source: Address; requestId: bigint; word: bigint; idsHash: Hex };

/** A wallet's gradings (cards sent for grading together), newest first. */
export async function gradingsOf(owner: Address): Promise<GradingStatus[]> {
  const logs = await scanLogs(addr("FirePsa"), eventOf(psaAbi, "Protected"), { by: owner });
  const now = await chainNow();
  const NONE = (1n << 256n) - 1n;
  const out = await Promise.all(logs.map((l) => argsOf<{ graded: readonly bigint[]; gradingIndex: bigint }>(l)).filter((a) => a.gradingIndex !== NONE).map(async (a) => {
    const g = await read<GradingRaw>("FirePsa", psaAbi, "gradingOf", [a.gradingIndex]);
    let status: GradingStatus["status"]; let round: number | null = null; let roundAt: number | null = null;
    if (g.done) status = "done";
    else if (g.ready) status = "ready";
    else {
      const r = await requestInfo(g.source, g.requestId).catch(() => null);
      round = r?.round ?? null; roundAt = r?.roundAt ?? null;
      status = r && (r.fulfilled || now >= r.roundAt) ? "deliverable" : "waiting";
    }
    return { index: Number(a.gradingIndex), ids: a.graded.map(Number), status, round, roundAt, requestedAt: Number(g.requestedAt) };
  }));
  return out.sort((x, y) => y.index - x.index);
}

/** The card list a grading was sent with (from its Protected event), in order: what finish() needs. */
export async function gradingIds(index: number): Promise<bigint[]> {
  const logs = await scanLogs(addr("FirePsa"), eventOf(psaAbi, "Protected"));
  for (const l of logs) {
    const a = argsOf<{ graded: readonly bigint[]; gradingIndex: bigint }>(l);
    if (a.gradingIndex === BigInt(index)) return [...a.graded];
  }
  throw new Error(`No grading #${index}`);
}

// ---------------------------------------------------------------- the holder window

/** The holder window's proof for a wallet, from the snapshot file ops/snapshot wrote (published with the drop). */
export function proofFromSnapshot(snapshot: unknown, owner: Address): Hex[] | null {
  const s = snapshot as { proofs?: Record<string, Hex[]>; wallets?: { address: string; proof: Hex[] }[] };
  if (!isAddress(owner)) return null;
  const key = getAddress(owner);
  if (s.proofs) for (const [k, v] of Object.entries(s.proofs)) if (isAddress(k) && getAddress(k) === key) return v;
  for (const w of s.wallets ?? []) if (isAddress(w.address) && getAddress(w.address) === key) return w.proof;
  return null;
}
