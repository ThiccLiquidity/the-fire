// Data layer. `FireApi` is what the UI talks to. `mockApi` runs the whole game in the browser so the
// site works before the contract is deployed; `chainApi` (later) implements the same interface with
// viem against Fire.sol.

export interface Buy {
  id: number;
  who: string;
  tickets: number;
  withEth: boolean;
  note: string;
  title: string;
  at: number; // ms
}

export interface PastFire {
  id: number;
  nights: number;
  potPlank: number;
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
}

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
  plankUsd: number;
  ethUsd: number;
  plankPerTicket: number; // ratchets toward $0.90
  ticketsToday: number;
  ticketsTotal: number;
  fireSize: number; // persistent, in tickets: buys add, storms subtract, burns down to 60% each night
  trailingAvg: number; // 7-night avg of daily tickets; storm scale
  /** 0..1: how threatening tonight looks. Not a number for the UI to display — drives the sky. */
  threat: number;
  nextRollAt: number; // ms
  you: { address?: string; tickets: number; paper: number; plank: number; eth: number; remainingToday: number; isWinner: boolean; profile?: Profile };
  profiles: Record<string, Profile>; // lowercase address → profile
  burnedPaperAllTime: number;
  burnedPlankAllTime: number;
  millsEaten: number;
  millFundEth: number;
  millBidEth: number;
  feed: Buy[];
  past: PastFire[];
  storm?: Storm;
}

export const DAILY_CAP = 500;
export const KEEP = 0.6;
export const FULL_DAYS = 5; // a fire worth 5 days of buys is "full height" on screen
/** Storm median for a night: trailingAvg × ((n-1)/8)^1.5 (night 1: none, night 24+: infinite). */
export function stormBase(night: number, trailingAvg: number) {
  if (night >= 24) return Infinity;
  if (night <= 1) return 0;
  return trailingAvg * Math.pow((night - 1) / 8, 1.5);
}
export const TX_CAP = 10;
export const ETH_USD_PER_TICKET = 1.0;
export const PLANK_USD_PER_TICKET = 0.9;

export function priceMult(n: number) {
  return n >= TX_CAP ? 0.97 : 1;
}

export function quote(n: number, plankPerTicket: number, ethUsd: number) {
  const m = priceMult(n);
  return { paper: n * m, plank: n * m * plankPerTicket, eth: (n * m * ETH_USD_PER_TICKET) / ethUsd };
}

export interface FireApi {
  state(): FireState;
  subscribe(fn: (s: FireState) => void): () => void;
  buy(n: number, withEth: boolean, note: string): Promise<void>;
  setProfile(name: string, image: Uint8Array | null): Promise<void>; // null = keep the current picture
  /** live only: ask the wallet for an account so balances and the buy buttons light up */
  connect?(): Promise<void>;
  /** demo only: force tonight's storm now */
  demoStorm?(): void;
}

export function titleFor(lifetime: number, withEth: boolean) {
  if (withEth) return "Paper buyer";
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
  // 8:00 PM America/Phoenix = 03:00 UTC (Arizona doesn't observe DST)
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0);
  return t <= now ? t + 86_400_000 : t;
}

/** Hour of day in Phoenix, fractional (0..24). */
export function phoenixHour(now = Date.now()) {
  const ms = (now - 7 * 3_600_000) % 86_400_000;
  return (ms < 0 ? ms + 86_400_000 : ms) / 3_600_000;
}
