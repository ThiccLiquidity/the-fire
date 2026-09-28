// Data layer. `FireApi` is what the UI talks to. `mockApi` runs the whole game in the browser so the
// site works before the contract is deployed; `chainApi` (later) implements the same interface with
// viem against Fire.sol.

export interface Buy {
  id: number;
  who: string;
  tickets: number;
  fromFire: boolean; // the PAPER part was paid in dollars (ETH or USDG)
  note: string;
  kind?: "mill"; // not a buy: the fire bought a mill off the floor and burned it
  title: string;
  at: number; // ms
}

export interface PastFire {
  id: number;
  nights: number;
  potPlank: number;
  prizePlank?: number; // what the winner actually got (the pot's 40%, or less if the prize cap applied)
  winner: string;
  peakSize: number;
}

export interface Storm {
  at: number;
  fireId: number; // the fire this storm hit
  night: number; // the night number of this storm
  strength: number; // in tickets
  size: number; // fire size at the roll
  sizeAfter?: number; // 0..1 display size after the storm (survived only)
  survived: boolean;
  intensity: number; // 0..1 — how violent it looks/sounds
  winner?: string;
  paidPlank?: number;
  potPlank?: number; // the pot the fire died with (out only)
  tickets?: number; // tickets that were in the fire (out only)
  prizeOwed?: boolean; // out only: the prize couldn't be sent; the winner claims it
  /** what the page showed just before the roll, held on screen until the ceremony reveals the result */
  before?: Snapshot;
}

export interface Snapshot { fireId: number; night: number; potPlank: number; fireSize: number; ticketsTotal: number; ticketsToday: number; youTickets: number; youPlank: number }

export interface Profile { name: string; pfp: string } // pfp: an image URL the site can render (data:/blob:), or ""

/**
 * The ceremony, in ms after the roll. Storm and page both read this so the sky and the words agree.
 * Survived: clouds → lightning → rain beats the fire down → verdict lingers → clears.
 * Out: same storm, but the fire dies in the rain, sits as embers, the winner is revealed and lingers,
 * and only then is the next fire lit. The old fire's pot stays on screen until the relight.
 */
export const CEREMONY = {
  IN: 8_000, // clouds roll in
  STRIKE: 16_000, // lightning
  RAIN: 34_000, // rain; fire beaten down (or dies)
  VERDICT: 28_000, // survived: card appears
  VERDICT_END: 44_000,
  OUT_CARD: 34_000, // out: "the fire went out"
  WINNER: 44_000, // out: winner revealed
  RELIGHT: 90_000, // out: next fire lit
  DONE: 105_000,
};

export interface FireState {
  fireId: number;
  night: number; // nights survived
  potPlank: number;
  potCarriedIn: number; // the part of the pot this fire started with (carry or seed), PLANK
  plankUsd: number;
  ethUsd: number;
  plankPerTicket: number; // $0.90 of PLANK at the pool's ~30-minute average
  paperPerTicket: number; // 1, or less once PAPER trades above $0.33
  paperUsd: number; // PAPER's price from the Fire's feed; 0 = no market yet
  ticketsToday: number;
  ticketsTotal: number;
  fireSize: number; // persistent, in logs: buys add, storms subtract, keeps 85% each night
  trailingAvg: number; // 7-night avg of daily logs; how tall the fire is drawn
  /** 0..1: how threatening tonight looks. Not a number for the UI to display — drives the sky. */
  threat: number;
  nextRollAt: number; // ms
  you: { address?: string; tickets: number; paper: number; plank: number; eth: number; usdg: number; remainingToday: number; isWinner: boolean; profile?: Profile;
    /** PLANK prize waiting for this wallet to claim (a payout that couldn't be sent) */
    prize?: number;
    /** abandoned game only: this wallet's share of the last pot, not yet taken */
    refund?: number };
  /** the game was ended for good (a roll stuck for 7 days): no buying, ticket holders take their refund */
  abandoned?: boolean;
  /** live only: exact per-ticket prices in wei, so a buy can cap what it pays at exactly what was shown */
  raw?: { plankPerTicket: bigint; paperPerTicket: bigint; ethPerTicket: bigint };
  /** live only: token addresses as the Fire contract reports them */
  tokens?: { paper: string; plank: string; usdg?: string; usdgDecimals: number };
  profiles: Record<string, Profile>; // lowercase address → profile
  burnedPaperAllTime: number;
  burnedPlankAllTime: number;
  millsEaten: number;
  millFundEth: number; // the mill fund's ETH side
  millFundUsdg: number; // and its USDG side
  millBidUsd: number; // what the fire will pay for a mill right now, in dollars
  usdgEnabled: boolean;
  feed: Buy[];
  past: PastFire[];
  storm?: Storm;
  /** a roll is waiting on its random number; buying is paused until it lands */
  rollPending?: boolean;
  /** live only: what the "roll" button would do right now, if anything */
  rollAction?: "roll" | "deliver" | "settle" | "reroll";
}

export const DAILY_CAP = 500;
export const PRIZE_CAP_MULT = 20;
/** Fire.prizeNow(): the winner's 40%, taken from the pot or from 20x what this fire's tickets put in, if smaller. */
export function prizeOf(pot: number, carriedIn: number, tickets: number) {
  if (tickets <= 0) return 0;
  return Math.min(pot, PRIZE_CAP_MULT * Math.max(0, pot - carriedIn)) * 0.4;
}
export const KEEP = 0.85; // the fire keeps 85% of its size overnight
export const FULL_DAYS = 2.5; // a fire worth 2.5 days of buys is "full height" on screen (fires settle at ~1-2 days)
/** Fire.sol's storm ladder: 20 fixed storm sizes, in logs. Storms never grow; the odds move with the fire's age. */
export const STORM_LOGS = [5, 8, 12, 19, 30, 47, 74, 115, 180, 283, 442, 693, 1084, 1698, 2658, 4161, 6515, 10199, 15968, 25000];
/** Running odds out of 10,000 of each size, for nights 2..23 (Fire.STORM_ODDS, built by sim/fire_sim.py storm_ladder()). */
export const STORM_ODDS: number[][] = [[1375, 3122, 5015, 6763, 8137, 9059, 9585, 9841, 9947, 9985, 9996, 9999, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000], [963, 2344, 4030, 5785, 7342, 8518, 9276, 9692, 9886, 9964, 9990, 9998, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000], [633, 1656, 3064, 4717, 6370, 7778, 8801, 9433, 9767, 9917, 9975, 9993, 9998, 10000, 10000, 10000, 10000, 10000, 10000, 10000], [387, 1092, 2187, 3636, 5269, 6838, 8123, 9020, 9553, 9823, 9939, 9982, 9995, 9999, 10000, 10000, 10000, 10000, 10000, 10000], [219, 669, 1456, 2630, 4123, 5741, 7234, 8408, 9196, 9645, 9864, 9955, 9987, 9997, 9999, 10000, 10000, 10000, 10000, 10000], [114, 378, 899, 1776, 3032, 4567, 6164, 7581, 8651, 9341, 9719, 9896, 9967, 9991, 9998, 10000, 10000, 10000, 10000, 10000], [54, 197, 513, 1114, 2084, 3420, 4988, 6556, 7892, 8862, 9463, 9779, 9921, 9976, 9994, 9999, 10000, 10000, 10000, 10000], [24, 94, 270, 647, 1333, 2398, 3808, 5397, 6924, 8174, 9046, 9565, 9827, 9941, 9982, 9996, 9999, 10000, 10000, 10000], [10, 41, 131, 347, 791, 1568, 2727, 4200, 5797, 7270, 8429, 9206, 9650, 9866, 9956, 9987, 9997, 9999, 10000, 10000], [3, 17, 58, 172, 434, 952, 1824, 3073, 4599, 6187, 7595, 8659, 9345, 9721, 9897, 9967, 9991, 9998, 10000, 10000], [1, 6, 24, 78, 220, 536, 1135, 2103, 3436, 5000, 6564, 7897, 8865, 9464, 9780, 9922, 9976, 9994, 9999, 10000], [0, 2, 9, 33, 103, 279, 655, 1341, 2405, 3813, 5401, 6927, 8176, 9048, 9566, 9828, 9942, 9983, 9997, 10000], [0, 1, 3, 13, 44, 134, 350, 794, 1571, 2730, 4203, 5800, 7273, 8432, 9209, 9653, 9869, 9959, 9990, 10000], [0, 0, 1, 4, 18, 59, 173, 435, 954, 1826, 3076, 4603, 6192, 7602, 8667, 9353, 9730, 9906, 9976, 10000], [0, 0, 0, 1, 6, 24, 79, 221, 537, 1138, 2108, 3444, 5012, 6580, 7916, 8886, 9487, 9803, 9946, 10000], [0, 0, 0, 0, 2, 9, 33, 104, 281, 659, 1349, 2419, 3836, 5433, 6968, 8224, 9101, 9622, 9886, 10000], [0, 0, 0, 0, 1, 3, 13, 45, 136, 355, 804, 1592, 2766, 4259, 5877, 7370, 8544, 9331, 9781, 10000], [0, 0, 0, 0, 0, 1, 5, 18, 61, 177, 447, 980, 1877, 3162, 4731, 6364, 7813, 8908, 9613, 10000], [0, 0, 0, 0, 0, 0, 2, 7, 25, 83, 233, 567, 1199, 2222, 3630, 5283, 6936, 8344, 9367, 10000], [0, 0, 0, 0, 0, 0, 0, 2, 10, 36, 114, 308, 724, 1482, 2658, 4215, 5970, 7656, 9037, 10000], [0, 0, 0, 0, 0, 0, 0, 1, 4, 15, 53, 159, 415, 941, 1863, 3237, 4985, 6878, 8625, 10000], [0, 0, 0, 0, 0, 0, 0, 0, 1, 6, 23, 78, 227, 573, 1255, 2402, 4047, 6055, 8146, 10000]];
/** The storm a random draw r (0..9,999) brings on night n, in logs (night 1: none, night 24+: infinite). */
export function stormFor(night: number, r: number) {
  if (night >= 24) return Infinity;
  if (night <= 1) return 0;
  const row = STORM_ODDS[night - 2];
  let i = 0;
  while (i < STORM_LOGS.length - 1 && r % 10000 >= row[i]) i++;
  return STORM_LOGS[i];
}
/** Chance (0..1) that night n's storm is at least `size` logs, i.e. that a fire this size goes out (Fire.stormOdds). */
export function stormOdds(night: number, size: number) {
  if (night >= 24) return 1;
  if (night <= 1) return 0;
  const row = STORM_ODDS[night - 2];
  let below = 0;
  for (let i = 0; i < STORM_LOGS.length && STORM_LOGS[i] < size; i++) below = row[i];
  return 1 - below / 10000;
}
/** How heavy the rain is drawn (0.15..1): as heavy as the call was close. A storm that barely touched the fire is a
 *  drizzle, a near miss is a downpour; a storm that puts the fire out is always full force. Same as sim/fire_sim.py. */
export function stormLook(strength: number, size: number, survived: boolean) {
  if (!survived || size <= 0) return 1;
  return Math.max(0.15, Math.min(1, 0.15 + 0.85 * Math.pow(strength / size, 0.8)));
}
export const TX_CAP = 10;
export const ETH_USD_PER_TICKET = 1.0;
export const PLANK_USD_PER_TICKET = 0.9;

/** Buy 10, get 1 free: tickets received for n paid (Fire.ticketsFor). */
/** Free logs with a full throw of 10: 3 on a fire's first day, 2 on its second, 1 after that (Fire.ticketsFor). */
export function freeLogs(night: number) { return night === 0 ? 3 : night === 1 ? 2 : 1; }
/** Logs received for n paid, on a fire that has survived `night` nights. Every log is a ticket to win. */
export function ticketsFor(n: number, night: number) {
  return n === TX_CAP ? n + freeLogs(night) : n;
}

export const PAPER_USD_CAP = 0.33; // the PAPER part never costs more than this (Fire.PAPER_USD_CAP)
/** PAPER per ticket: 1, or less once PAPER trades above the cap. 0 / unknown price = 1. */
export function paperPerTicketAt(paperUsd: number) {
  return paperUsd > PAPER_USD_CAP ? PAPER_USD_CAP / paperUsd : 1;
}

/** The prices the buyer was shown; a buy never pays more than this. */
export interface PriceSeen { plankPerTicket: number; paperPerTicket: number; ethUsd: number; raw?: FireState["raw"] }

export function quote(n: number, plankPerTicket: number, ethUsd: number, paperPerTicket = 1) {
  return { paper: n * paperPerTicket, plank: n * plankPerTicket, eth: (n * ETH_USD_PER_TICKET) / ethUsd, usdg: n * ETH_USD_PER_TICKET };
}

export interface FireApi {
  state(): FireState;
  subscribe(fn: (s: FireState) => void): () => void;
  buy(n: number, pay: Pay, note: string, seen: PriceSeen): Promise<void>;
  /** take a prize that couldn't be sent when the fire went out */
  claim?(): Promise<void>;
  /** abandoned game: take your share of the last pot */
  refund?(): Promise<void>;
  setProfile(name: string, image: Uint8Array | null): Promise<void>; // null = keep the current picture
  /** live only: ask the wallet for an account so balances and the buy buttons light up */
  connect?(): Promise<void>;
  /** ask the wallet to pick a different account */
  switchWallet?(): Promise<void>;
  /** forget the connected account on this page (the wallet itself stays unlocked) */
  disconnect?(): void;
  /** live only: roll tonight's storm, deliver a stuck answer, or re-roll — whichever the contract allows now */
  rollStorm?(): Promise<void>;
  /** demo only: force tonight's storm now */
  demoStorm?(): void;
  /** demo only: the playground's hooks into the simulated game */
  demo?: DemoControls;
}

/** How the PAPER part is paid: real PAPER, or $1 a ticket in ETH or USDG. */
export type Pay = "paper" | "eth" | "usdg";

/** cashOnly: this wallet has never paid with PAPER */
export function titleFor(lifetime: number, cashOnly: boolean) {
  if (cashOnly) return "Cash buyer";
  if (lifetime >= 1000) return "Arsonist";
  if (lifetime >= 200) return "Lumberjack";
  if (lifetime >= 20) return "Paper boy";
  return "Kindling";
}

export function short(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}
export function nameOf(addr: string, profiles: Record<string, Profile>) {
  return profiles[addr.toLowerCase()]?.name || short(addr);
}

export function nextRollTime(now = Date.now()) {
  // 8:00 PM MST = 03:00 UTC (MST all year, no daylight saving)
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0);
  return t <= now ? t + 86_400_000 : t;
}

/** Hour of day in MST, fractional (0..24). */
export function phoenixHour(now = Date.now()) {
  const ms = (now - 7 * 3_600_000) % 86_400_000;
  return (ms < 0 ? ms + 86_400_000 : ms) / 3_600_000;
}

export type DemoToken = "ETH" | "PLANK" | "PAPER" | "USDG";

/** Demo-only controls: drive every state of the site without a chain. */
export interface DemoControls {
  /** roll tonight: "random" uses the real storm ladder; "survive"/"out"/"you-win" force the result; draw 0..9,999 picks the storm */
  roll(outcome: "random" | "survive" | "out" | "you-win", draw?: number): void;
  /** advance n nights instantly, no ceremony (fires may die and relight) */
  skipNights(n: number): void;
  /** hold the storm: buying paused, "deliver" button shown; release it with roll() or setPending(false) */
  setPending(on: boolean): void;
  set(patch: Partial<Pick<FireState, "fireSize" | "potPlank" | "night" | "trailingAvg" | "ticketsTotal" | "ticketsToday" | "threat" | "plankUsd" | "paperUsd" | "ethUsd" | "millBidUsd" | "millFundUsdg" | "millFundEth" | "usdgEnabled">>): void;
  setYou(patch: Partial<FireState["you"]>): void;
  /** connect/disconnect the demo wallet */
  setConnected(on: boolean): void;
  /** crowd buys per minute (0 = quiet) */
  setCrowd(perMinute: number): void;
  /** one crowd buy right now */
  crowdBuy(tickets: number, pay?: Pay): void;
  /** the fire eats a mill right now */
  eatMill(): void;
  /** ETH/USD feed stale: the ETH path closes */
  setEthFeedStale(on: boolean): void;
  /** end the game for good (a roll stuck 7 days): buying closes, ticket holders get refunds */
  setAbandoned(on: boolean): void;
  /** leave a prize waiting for you to claim (as when a payout can't be sent) */
  setPrizeStuck(on: boolean): void;
  /** simulated swaps on play money */
  swapQuote(from: DemoToken, to: DemoToken, amountIn: number): { out: number; impact: number } | undefined;
  swap(from: DemoToken, to: DemoToken, amountIn: number, minOut: number): Promise<number>;
  reset(): void;
}