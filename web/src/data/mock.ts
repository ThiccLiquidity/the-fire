import {
  type Buy,
  type FireApi,
  type FireState,
  DAILY_CAP,
  FULL_DAYS,
  KEEP,
  PLANK_USD_PER_TICKET,
  stormBase,
  nextRollTime,
  quote,
  titleFor,
} from "./types";

const PLANK_USD = 750_000 / 8_000_000_000_000;
const ETH_USD = 3_333;
const YOU = "0xYOU0000000000000000000000000000000000d00d";

const wallets = Array.from({ length: 40 }, (_, i) => "0x" + (0x7a3e1c + i * 9973).toString(16).padStart(40, "a"));
const notes = [
  "gm from 1 mill", "for the boys", "wildfire or nothing", "burn it all", "printed this morning",
  "logs on the fire", "not tonight storm", "one more for luck", "paper go brrr", "we ride at 8", "", "", "",
];
function rnd(n: number) { return Math.floor(Math.random() * n); }

export function makeMockApi(): FireApi {
  const lifetime = new Map<string, number>();
  let nextId = 1;
  const plankPerTicket = PLANK_USD_PER_TICKET / PLANK_USD;
  let s: FireState = {
    fireId: 14,
    nameId: 3,
    night: 6,
    potPlank: 31_000_000_000,
    plankUsd: PLANK_USD,
    ethUsd: ETH_USD,
    plankPerTicket,
    ticketsToday: 410,
    ticketsTotal: 4_120,
    fireSize: 1_150,
    trailingAvg: 520,
    threat: 0.45,
    nextRollAt: nextRollTime(),
    you: { tickets: 12, paper: 7, plank: 120_000_000, eth: 0.08, remainingToday: DAILY_CAP - 12, isWinner: false },
    burnedPaperAllTime: 61_400,
    burnedPlankAllTime: 320_000_000_000,
    millsEaten: 9,
    millFundEth: 0.021,
    millBidEth: 0.031,
    feed: [],
    past: [
      { id: 13, nameId: 16, nights: 3, potPlank: 9_800_000_000, winner: wallets[3], peakSize: 520 },
      { id: 12, nameId: 3, nights: 17, potPlank: 158_000_000_000, winner: wallets[11], peakSize: 2_140 },
      { id: 11, nameId: 2, nights: 9, potPlank: 44_000_000_000, winner: wallets[7], peakSize: 900 },
      { id: 10, nameId: 1, nights: 12, potPlank: 71_000_000_000, winner: wallets[22], peakSize: 1_300 },
    ],
  };

  const subs = new Set<(s: FireState) => void>();
  const emit = () => subs.forEach((f) => f(s));

  function push(who: string, tickets: number, withEth: boolean, note: string, stoke = false, at = Date.now()) {
    const life = (lifetime.get(who) ?? 0) + tickets;
    lifetime.set(who, life);
    const b: Buy = { id: nextId++, who, tickets, withEth, stoke, note, title: titleFor(life, withEth, stoke), at };
    s = { ...s, feed: [b, ...s.feed].slice(0, 40) };
  }
  for (let i = 0; i < 12; i++) push(wallets[rnd(wallets.length)], [1, 1, 10, 10, 100][rnd(5)], Math.random() < 0.15, notes[rnd(notes.length)], false, Date.now() - (12 - i) * 5 * 60_000);

  function applyBuy(who: string, n: number, withEth: boolean, note: string) {
    const q = quote(n, s.plankPerTicket, s.ethUsd);
    push(who, n, withEth, note);
    s = {
      ...s,
      ticketsToday: s.ticketsToday + n,
      ticketsTotal: s.ticketsTotal + n,
      fireSize: s.fireSize + n,
      potPlank: s.potPlank + q.plank / 2,
      burnedPlankAllTime: s.burnedPlankAllTime + q.plank / 2,
      burnedPaperAllTime: withEth ? s.burnedPaperAllTime : s.burnedPaperAllTime + q.paper,
      millFundEth: withEth ? s.millFundEth + q.eth : s.millFundEth,
    };
    if (who === YOU) {
      s = { ...s, you: { ...s.you, tickets: s.you.tickets + n, remainingToday: s.you.remainingToday - n,
        paper: withEth ? s.you.paper : s.you.paper - q.paper, plank: s.you.plank - q.plank, eth: withEth ? s.you.eth - q.eth : s.you.eth } };
    }
    if (s.millFundEth >= s.millBidEth) s = { ...s, millFundEth: s.millFundEth - s.millBidEth, millsEaten: s.millsEaten + 1 };
    emit();
  }

  setInterval(() => {
    if (Math.random() < 0.5) applyBuy(wallets[rnd(wallets.length)], [1, 1, 1, 10, 10, 100][rnd(6)], Math.random() < 0.15, notes[rnd(notes.length)]);
  }, 5_000);

  function storm() {
    const night = s.night + 1;
    const luck = Math.exp(0.9 * (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3)); // ~N(0,1) via sum of uniforms
    const strength = Math.round(stormBase(night, s.trailingAvg) * luck);
    const size = s.fireSize;
    const survived = night === 1 || (night < 24 && size > strength);
    const intensity = Math.max(0.15, Math.min(1, strength / Math.max(1, s.trailingAvg * FULL_DAYS) * 2.5));
    const trailingAvg = (s.trailingAvg * 6 + s.ticketsToday) / 7;
    if (survived) {
      const after = Math.max(0, (size - strength) * KEEP);
      s = { ...s, night, fireSize: after, trailingAvg, ticketsToday: 0,
        storm: { at: Date.now(), strength, size, survived, intensity, sizeAfter: after / (trailingAvg * FULL_DAYS) },
        you: { ...s.you, remainingToday: DAILY_CAP } };
    } else {
      const winner = Math.random() < 0.2 ? YOU : wallets[rnd(wallets.length)];
      const paid = s.potPlank * 0.4 * 0.95;
      s = {
        ...s,
        storm: { at: Date.now(), strength, size, survived, intensity, winner, paidPlank: paid },
        past: [{ id: s.fireId, nameId: s.nameId, nights: s.night, potPlank: s.potPlank, winner, peakSize: size }, ...s.past],
        fireId: s.fireId + 1, nameId: 0, night: 0, fireSize: 0, trailingAvg,
        potPlank: s.potPlank * 0.3,
        burnedPlankAllTime: s.burnedPlankAllTime + s.potPlank * 0.3,
        ticketsToday: 0, ticketsTotal: 0,
        you: { ...s.you, tickets: 0, remainingToday: DAILY_CAP, isWinner: winner === YOU, plank: winner === YOU ? s.you.plank + paid : s.you.plank },
      };
    }
    const nb = stormBase(s.night + 1, s.trailingAvg);
    s = { ...s, threat: Math.max(0.1, Math.min(1, nb / (s.trailingAvg * 2))), nextRollAt: nextRollTime() };
    emit();
  }
  function rng() { return Math.random(); }

  return {
    state: () => s,
    subscribe(fn) { subs.add(fn); fn(s); return () => subs.delete(fn); },
    async buy(n, withEth, note) { await new Promise((r) => setTimeout(r, 400)); applyBuy(YOU, n, withEth, note); },
    async stoke(plank, note) {
      await new Promise((r) => setTimeout(r, 400));
      push(YOU, 0, false, note, true);
      s = { ...s, potPlank: s.potPlank + plank / 2, burnedPlankAllTime: s.burnedPlankAllTime + plank / 2, you: { ...s.you, plank: s.you.plank - plank } };
      emit();
    },
    async nameFire(nameId) { s = { ...s, nameId, you: { ...s.you, isWinner: false } }; emit(); },
    demoStorm: storm,
  };
}
