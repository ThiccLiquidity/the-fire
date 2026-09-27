// Data layer. `FireApi` is what the UI talks to. `mockApi` runs the whole game in the browser so the
// site works before the contract is deployed; `chainApi` (later) implements the same interface with
// viem against Fire.sol.

export interface Buy {
  id: number;
  who: string;
  tickets: number;
  withEth: boolean;
  stoke?: boolean; // pyro mode: PLANK burned, no ticket
  note: string;
  title: string;
  at: number; // ms
}

export interface PastFire {
  id: number;
  nameId: number; // 0 = unnamed
  nights: number;
  potPlank: number;
  winner: string;
  peakSize: number;
}

export interface Storm {
  at: number;
  strength: number; // in tickets
  size: number; // fire size at the roll
  survived: boolean;
  intensity: number; // 0..1 — how big relative to the fire; drives lightning/thunder
  winner?: string;
  paidPlank?: number;
}

export interface FireState {
  fireId: number;
  nameId: number;
  night: number; // nights survived
  potPlank: number;
  plankUsd: number;
  ethUsd: number;
  plankPerTicket: number; // ratchets toward $0.90
  ticketsToday: number;
  ticketsTotal: number;
  /** 0..1: how threatening tonight looks. Not a number for the UI to display — drives the sky. */
  threat: number;
  nextRollAt: number; // ms
  you: { tickets: number; paper: number; plank: number; eth: number; remainingToday: number; isWinner: boolean };
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
  stoke(plank: number, note: string): Promise<void>;
  nameFire(nameId: number): Promise<void>;
  /** demo only: force tonight's storm now */
  demoStorm?(): void;
}

export function titleFor(lifetime: number, withEth: boolean, stoke?: boolean) {
  if (stoke) return "Pyro";
  if (withEth) return "Paper buyer";
  if (lifetime >= 1000) return "Arsonist";
  if (lifetime >= 200) return "Lumberjack";
  if (lifetime >= 20) return "Paper boy";
  return "Kindling";
}

export function short(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
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
