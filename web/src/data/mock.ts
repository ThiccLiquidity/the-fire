import {
  type Buy,
  type FireApi,
  type FireState,
  PLANK_PER_TICKET,
  nextRollTime,
  quote,
  titleFor,
} from "./types";

const PLANK_USD = 750_000 / 8_000_000_000_000;
const YOU = "0xYOU0000000000000000000000000000000000d00d";

const names = ["The Great Fire", "Night of Logs", "Lumberjack's Revenge", "Kindling Sunday", "The Big One"];
const wallets = Array.from({ length: 40 }, (_, i) => "0x" + (0x7a3e1c + i * 9973).toString(16).padStart(40, "a"));
const notes = [
  "gm from 1 mill", "for the boys", "wildfire or nothing", "burn it all", "printed this morning",
  "logs on the fire", "not tonight storm", "one more for luck", "paper go brrr", "we ride at 8",
];

function rnd(n: number) { return Math.floor(Math.random() * n); }

export function makeMockApi(): FireApi {
  const lifetime = new Map<string, number>();
  let nextId = 1;
  let s: FireState = {
    fireId: 14,
    fireName: "The October Fire",
    night: 6,
    potPlank: 31_000_000_000,
    plankUsd: PLANK_USD,
    ticketsToday: 410,
    ticketsTotal: 4_120,
    forecastLow: 380,
    forecastHigh: 890,
    nextRollAt: nextRollTime(),
    yourTickets: 12,
    yourPaper: 7,
    burnedPaperAllTime: 61_400,
    burnedPlankAllTime: 320_000_000_000,
    millsEaten: 9,
    millFundEth: 0.021,
    millBidEth: 0.031,
    feed: [],
    past: [
      { id: 13, name: "Kindling Sunday", nights: 3, potPlank: 9_800_000_000, winner: wallets[3], peakSize: 520 },
      { id: 12, name: "Lumberjack's Revenge", nights: 17, potPlank: 158_000_000_000, winner: wallets[11], peakSize: 2_140 },
      { id: 11, name: "Night of Logs", nights: 9, potPlank: 44_000_000_000, winner: wallets[7], peakSize: 900 },
      { id: 10, name: "The Great Fire", nights: 12, potPlank: 71_000_000_000, winner: wallets[22], peakSize: 1_300 },
    ],
  };

  // seed the feed
  for (let i = 0; i < 14; i++) {
    const who = wallets[rnd(wallets.length)];
    const t = [1, 1, 10, 10, 100][rnd(5)];
    push(who, t, Math.random() < 0.15, notes[rnd(notes.length)], Date.now() - (14 - i) * 6 * 60_000);
  }

  const subs = new Set<(s: FireState) => void>();
  const emit = () => subs.forEach((f) => f(s));

  function push(who: string, tickets: number, withEth: boolean, note: string, at = Date.now()) {
    const life = (lifetime.get(who) ?? 0) + tickets;
    lifetime.set(who, life);
    const b: Buy = { id: nextId++, who, tickets, withEth, note, title: titleFor(life, withEth), at };
    s = { ...s, feed: [b, ...s.feed].slice(0, 60) };
  }

  function applyBuy(who: string, n: number, withEth: boolean, note: string) {
    const q = quote(n);
    push(who, n, withEth, note);
    s = {
      ...s,
      ticketsToday: s.ticketsToday + n,
      ticketsTotal: s.ticketsTotal + n,
      potPlank: s.potPlank + q.plank / 2,
      burnedPlankAllTime: s.burnedPlankAllTime + q.plank / 2,
      burnedPaperAllTime: withEth ? s.burnedPaperAllTime : s.burnedPaperAllTime + q.paper,
      millFundEth: withEth ? s.millFundEth + q.eth : s.millFundEth,
    };
    if (who === YOU) s = { ...s, yourTickets: s.yourTickets + n, yourPaper: withEth ? s.yourPaper : Math.max(0, s.yourPaper - q.paper) };
    if (s.millFundEth >= s.millBidEth) s = { ...s, millFundEth: s.millFundEth - s.millBidEth, millsEaten: s.millsEaten + 1 };
    emit();
  }

  // ambient buys so the fire feels alive
  setInterval(() => {
    if (Math.random() < 0.55) {
      const t = [1, 1, 1, 10, 10, 100][rnd(6)];
      applyBuy(wallets[rnd(wallets.length)], t, Math.random() < 0.15, notes[rnd(notes.length)]);
    }
  }, 4_500);

  function storm() {
    const strength = Math.round(s.forecastLow + Math.random() * (s.forecastHigh - s.forecastLow) * 1.4);
    const survived = s.ticketsToday >= strength;
    const size = s.ticketsToday;
    if (survived) {
      s = { ...s, night: s.night + 1, ticketsToday: 0, storm: { at: Date.now(), strength, survived, size } };
    } else {
      const winner = wallets[rnd(wallets.length)];
      const paid = s.potPlank * 0.4;
      s = {
        ...s,
        storm: { at: Date.now(), strength, survived, size },
        past: [{ id: s.fireId, name: s.fireName, nights: s.night, potPlank: s.potPlank, winner, peakSize: size }, ...s.past],
        fireId: s.fireId + 1,
        fireName: names[rnd(names.length)],
        night: 0,
        potPlank: s.potPlank * 0.3,
        burnedPlankAllTime: s.burnedPlankAllTime + s.potPlank * 0.3,
        ticketsToday: 0,
        ticketsTotal: 0,
        yourTickets: 0,
      };
      void paid;
    }
    // next forecast scales with the new night
    const base = 520 * ((s.night + 1) / 8);
    s = { ...s, forecastLow: Math.round(base * 0.5), forecastHigh: Math.round(base * 1.6), nextRollAt: nextRollTime() };
    emit();
  }

  return {
    state: () => s,
    subscribe(fn) { subs.add(fn); fn(s); return () => subs.delete(fn); },
    async buy(n, withEth, note) { await new Promise((r) => setTimeout(r, 400)); applyBuy(YOU, n, withEth, note); },
    async stoke(plank) {
      await new Promise((r) => setTimeout(r, 400));
      s = { ...s, potPlank: s.potPlank + plank / 2, burnedPlankAllTime: s.burnedPlankAllTime + plank / 2 };
      emit();
    },
    demoStorm: storm,
  };
}

export { PLANK_PER_TICKET };
