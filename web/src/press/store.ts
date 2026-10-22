// The Printing Press's state for this visitor. In the demo it all lives in this browser (a demo wallet with PAPER,
// the papers bought, the letters sent), and starts with a 6-day streak so buying today earns the first badge. Live,
// the same questions go to the chain (live.ts).

export interface Badge { id: string; name: string; days: number; blurb: string }
export const BADGES: Badge[] = [
  { id: "subscriber", name: "Subscriber", days: 7, blurb: "7 days in a row" },
  { id: "paperboy", name: "Paperboy", days: 30, blurb: "30 days in a row" },
];

export interface DemoState {
  paper: number; eth: number; usdg: number;
  bought: string[]; // issue dates (YYYY-MM-DD)
  letters: { date: string; kind: string; text: string }[];
}

const KEY = "omni.press.demo.v1";
export const DEMO_ADDR = "0x7a3f2b9c41d0e5a6b8f9c0d1e2f3a4b5c6d7c91e"; // the Cardworks demo wallet (core.js)
export const DEMO_SHORT = "0x7a3f…c91e";

export const addDays = (date: string, n: number): string => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let state: DemoState | null = null;

export function demo(today: string): DemoState {
  if (state) return state;
  try { const j = JSON.parse(localStorage.getItem(KEY) || "null"); if (j && Array.isArray(j.bought)) state = j as DemoState; } catch { /* private window */ }
  // a fresh visitor: a demo wallet and the six days before today, so today's paper makes 7 (the Subscriber badge)
  state ??= { paper: 24, eth: 0.42, usdg: 50, bought: [6, 5, 4, 3, 2, 1].map((n) => addDays(today, -n)), letters: [] };
  return state;
}

export function save(): void {
  try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window: this visit only */ }
}

export function resetDemo(): void {
  state = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Days in a row up to today (today counts once bought; a streak that reached yesterday is still alive). */
export function streak(bought: string[], today: string): number {
  const have = new Set(bought);
  let day = have.has(today) ? today : addDays(today, -1), n = 0;
  while (have.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

/** The longest run ever: a badge, once earned, stays. */
export function bestStreak(bought: string[]): number {
  const days = [...new Set(bought)].sort();
  let best = 0, run = 0, prev = "";
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

/** The demo profile name for the demo wallet, if the visitor set one on Cardworks (profile.js keeps demo profiles
 *  in this browser under omni.profiles). */
export function demoName(): string {
  try { const all = JSON.parse(localStorage.getItem("omni.profiles") || "{}"); return all?.[DEMO_ADDR]?.name || DEMO_SHORT; } catch { return DEMO_SHORT; }
}
