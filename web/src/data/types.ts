// Data layer. `FireApi` is what the UI talks to. `mockApi` runs the whole game in the browser so the
// site works before the contract is deployed; `chainApi` (later) will implement the same interface
// with viem against Fire.sol.

export type Tier = 1 | 10 | 100 | 1000;

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
  name: string;
  nights: number;
  potPlank: number;
  winner: string;
  peakSize: number;
}

export interface FireState {
  fireId: number;
  fireName: string;
  night: number; // nights survived
  potPlank: number;
  plankUsd: number;
  ticketsToday: number;
  ticketsTotal: number;
  forecastLow: number; // tonight's storm range, in tickets
  forecastHigh: number;
  nextRollAt: number; // ms
  yourTickets: number;
  yourPaper: number; // PAPER in wallet
  burnedPaperAllTime: number;
  burnedPlankAllTime: number;
  millsEaten: number;
  millFundEth: number;
  millBidEth: number;
  feed: Buy[];
  past: PastFire[];
  storm?: { at: number; strength: number; survived: boolean; size: number };
}

export const PLANK_PER_TICKET = 10_000_000;
export const ETH_PER_TICKET = 0.0003;

export function priceMult(n: number) {
  if (n >= 1000) return 0.7;
  if (n >= 100) return 0.8;
  if (n >= 10) return 0.9;
  return 1;
}

export function quote(n: number) {
  const m = priceMult(n);
  return { paper: n * m, plank: n * m * PLANK_PER_TICKET, eth: n * m * ETH_PER_TICKET };
}

export interface FireApi {
  state(): FireState;
  subscribe(fn: (s: FireState) => void): () => void;
  buy(n: number, withEth: boolean, note: string): Promise<void>;
  stoke(plank: number): Promise<void>;
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

export function nextRollTime(now = Date.now()) {
  // 8:00 PM America/Phoenix = 03:00 UTC
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0);
  return t <= now ? t + 86_400_000 : t;
}
