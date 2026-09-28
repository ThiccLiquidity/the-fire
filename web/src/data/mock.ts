import {
  type Buy,
  type DemoControls,
  type FireApi,
  type FireState,
  type Pay,
  type Profile,
  DAILY_CAP,
  FULL_DAYS,
  KEEP,
  PLANK_USD_PER_TICKET,
  stormBase,
  nextRollTime,
  quote,
  ticketsFor,
  paperPerTicketAt,
  titleFor,
} from "./types";

const PLANK_USD = 1.056e-9; // from the V2 pool, Sep 27 2026
const ETH_USD = 3_333;
const YOU = "0xYOU0000000000000000000000000000000000d00d";

const wallets = Array.from({ length: 40 }, (_, i) => "0x" + (0x7a3e1c + i * 9973).toString(16).padStart(40, "a"));
const notes = [
  "gm from 1 mill", "for the boys", "wildfire or nothing", "burn it all", "printed this morning",
  "logs on the fire", "not tonight storm", "one more for luck", "paper go brrr", "we ride at 8", "", "", "",
];
function rnd(n: number) { return Math.floor(Math.random() * n); }
const demoNames = ["plankdaddy", "MillOwner420", "Cinder", "sawdust.eth", "Brisket", "log_lady", "not_a_bot", "Fireside Phil", "matchstick", "Torch"];
const demoProfiles: Record<string, Profile> = {};
demoNames.forEach((name, i) => { demoProfiles[wallets[i].toLowerCase()] = { name, pfp: "" }; });

export function makeMockApi(): FireApi {
  const lifetime = new Map<string, number>();
  let nextId = 1;
  const plankPerTicket = PLANK_USD_PER_TICKET / PLANK_USD;
  const initial = (): FireState => ({
    fireId: 14,
    night: 6,
    potPlank: 2_750_000_000_000, // ~$2,900
    plankUsd: PLANK_USD,
    paperUsd: 0,
    paperPerTicket: 1,
    ethUsd: ETH_USD,
    plankPerTicket,
    ticketsToday: 410,
    ticketsTotal: 4_120,
    fireSize: 1_150,
    trailingAvg: 520,
    threat: 0.45,
    nextRollAt: nextRollTime(),
    you: { address: YOU, tickets: 12, paper: 7, plank: 9_000_000_000, eth: 0.08, usdg: 25, remainingToday: DAILY_CAP - 12, isWinner: false },
    profiles: demoProfiles,
    burnedPaperAllTime: 61_400,
    burnedPlankAllTime: 300_000_000_000_000,
    millsEaten: 9,
    millFundEth: 0.021,
    millFundUsdg: 212,
    millBidUsd: 740,
    usdgEnabled: true,
    feed: [],
    past: [
      { id: 13, nights: 3, potPlank: 870_000_000_000, winner: wallets[3], peakSize: 520 },
      { id: 12, nights: 17, potPlank: 14_000_000_000_000, winner: wallets[11], peakSize: 2_140 },
      { id: 11, nights: 9, potPlank: 3_900_000_000_000, winner: wallets[7], peakSize: 900 },
      { id: 10, nights: 12, potPlank: 6_300_000_000_000, winner: wallets[22], peakSize: 1_300 },
    ],
  });
  let s: FireState = initial();

  const subs = new Set<(s: FireState) => void>();
  const emit = () => subs.forEach((f) => f(s));

  function push(who: string, tickets: number, fromFire: boolean, note: string, at = Date.now()) {
    const life = (lifetime.get(who) ?? 0) + tickets;
    lifetime.set(who, life);
    const b: Buy = { id: nextId++, who, tickets, fromFire, note, title: titleFor(life, fromFire), at };
    s = { ...s, feed: [b, ...s.feed].slice(0, 40) };
  }
  for (let i = 0; i < 12; i++) push(wallets[rnd(wallets.length)], [1, 1, 10, 10, 100][rnd(5)], Math.random() < 0.15, notes[rnd(notes.length)], Date.now() - (12 - i) * 5 * 60_000);

  function applyBuy(who: string, n: number, pay: Pay, note: string) {
    const q = quote(n, s.plankPerTicket, s.ethUsd, s.paperPerTicket); // priced on tickets paid for
    const withEth = pay === "eth", withUsdg = pay === "usdg";
    n = ticketsFor(n); // buy 10, get 1 free: 11 in, priced on the 10 above
    push(who, n, pay !== "paper", note);
    s = {
      ...s,
      ticketsToday: s.ticketsToday + n,
      ticketsTotal: s.ticketsTotal + n,
      fireSize: s.fireSize + n,
      potPlank: s.potPlank + q.plank / 2,
      burnedPlankAllTime: s.burnedPlankAllTime + q.plank / 2,
      burnedPaperAllTime: pay !== "paper" ? s.burnedPaperAllTime : s.burnedPaperAllTime + q.paper,
      millFundEth: withEth ? s.millFundEth + q.eth : s.millFundEth,
      millFundUsdg: withUsdg ? s.millFundUsdg + q.usdg : s.millFundUsdg,
    };
    if (who === YOU) {
      s = { ...s, you: { ...s.you, tickets: s.you.tickets + n, remainingToday: s.you.remainingToday - n,
        paper: pay !== "paper" ? s.you.paper : s.you.paper - q.paper, plank: s.you.plank - q.plank, eth: withEth ? s.you.eth - q.eth : s.you.eth,
        usdg: withUsdg ? s.you.usdg - q.usdg : s.you.usdg } };
    }
    if (s.millFundUsdg + s.millFundEth * s.ethUsd >= s.millBidUsd) s = { ...s, millFundUsdg: 0, millFundEth: 0, millsEaten: s.millsEaten + 1 };
    emit();
  }

  let crowdPerMin = 6;
  const crowdBuy = (n?: number, pay?: Pay) => applyBuy(wallets[rnd(wallets.length)], n ?? [1, 1, 2, 5, 10, 10][rnd(6)], pay ?? ((Math.random() < 0.15 ? (Math.random() < 0.5 ? "eth" : "usdg") : "paper") as Pay), notes[rnd(notes.length)]);
  setInterval(() => { if (!s.rollPending && Math.random() < crowdPerMin / 60) crowdBuy(); }, 1_000);

  // the contract's 32-point luck table (e^(0.9 z) quantiles), so the demo storms match the chain
  const LUCK = [1439, 2213, 2791, 3306, 3792, 4265, 4736, 5210, 5692, 6187, 6699, 7232, 7789, 8375, 8994, 9654, 10359, 11118, 11941, 12839, 13828, 14927, 16162, 17568, 19195, 21116, 23446, 26373, 30249, 35823, 45192, 69482];
  function storm(outcome: "random" | "survive" | "out" | "you-win" = "random", luckIdx?: number, quiet = false) {
    const night = s.night + 1;
    const luck = LUCK[luckIdx ?? rnd(32)] / 10_000;
    let strength = Math.round(stormBase(night, s.trailingAvg) * luck);
    const size = s.fireSize;
    if (outcome === "survive") strength = Math.min(strength, Math.max(0, Math.floor(size * 0.6)));
    if (outcome === "out" || outcome === "you-win") strength = Math.max(strength, size + 1);
    const survived = night === 1 && outcome !== "out" && outcome !== "you-win" ? true : (night < 24 && size > strength);
    const intensity = Math.max(0.15, Math.min(1, strength / Math.max(1, s.trailingAvg * FULL_DAYS) * 2.5));
    const trailingAvg = (s.trailingAvg * 6 + s.ticketsToday) / 7;
    if (survived) {
      const after = Math.max(0, (size - strength) * KEEP);
      s = { ...s, night, fireSize: after, trailingAvg, ticketsToday: 0,
        storm: { at: Date.now(), fireId: s.fireId, night, strength, size, survived, intensity, sizeAfter: after / (trailingAvg * FULL_DAYS) },
        you: { ...s.you, remainingToday: DAILY_CAP } };
    } else {
      const winner = outcome === "you-win" || (s.ticketsTotal > 0 && Math.random() < s.you.tickets / s.ticketsTotal) ? YOU : wallets[rnd(wallets.length)];
      const paid = s.potPlank * 0.4; // 40% to the winner; 25% burns, 5% to mill holders, 30% carries
      s = {
        ...s,
        storm: { at: Date.now(), fireId: s.fireId, night, strength, size, survived, intensity, winner, paidPlank: paid, potPlank: s.potPlank, tickets: s.ticketsTotal },
        past: [{ id: s.fireId, nights: s.night, potPlank: s.potPlank, winner, peakSize: size }, ...s.past],
        fireId: s.fireId + 1, night: 0, fireSize: 0, trailingAvg,
        potPlank: s.potPlank * 0.3,
        burnedPlankAllTime: s.burnedPlankAllTime + s.potPlank * 0.25,
        ticketsToday: 0, ticketsTotal: 0,
        you: { ...s.you, tickets: 0, remainingToday: DAILY_CAP, isWinner: winner === YOU, plank: winner === YOU ? s.you.plank + paid : s.you.plank },
      };
    }
    const nb = stormBase(s.night + 1, s.trailingAvg);
    s = { ...s, threat: Math.max(0.1, Math.min(1, nb / (s.trailingAvg * 2))), nextRollAt: nextRollTime(), rollPending: false, rollAction: undefined };
    if (quiet) s = { ...s, storm: undefined };
    emit();
  }
  let ethFeedStale = false;
  const demo: DemoControls = {
    roll: (o, luck) => storm(o, luck),
    skipNights: (n) => { for (let i = 0; i < n; i++) { s = { ...s, ticketsToday: Math.round(s.trailingAvg * (0.6 + Math.random() * 0.8)), fireSize: s.fireSize + Math.round(s.trailingAvg * 0.7) }; storm("random", undefined, true); } },
    setPending: (on) => { s = { ...s, rollPending: on, rollAction: on ? "deliver" : undefined }; emit(); },
    set: (patch) => { s = { ...s, ...patch }; if (patch.plankUsd) s = { ...s, plankPerTicket: PLANK_USD_PER_TICKET / patch.plankUsd }; if (patch.paperUsd !== undefined) s = { ...s, paperPerTicket: paperPerTicketAt(patch.paperUsd) }; emit(); },
    setYou: (patch) => { s = { ...s, you: { ...s.you, ...patch } }; emit(); },
    setConnected: (on) => { s = { ...s, you: { ...s.you, address: on ? YOU : undefined } }; emit(); },
    setCrowd: (perMin) => { crowdPerMin = perMin; },
    crowdBuy: (n, pay) => crowdBuy(n, pay),
    eatMill: () => { push(wallets[rnd(wallets.length)], 0, false, "sold a mill to the fire"); s = { ...s, millsEaten: s.millsEaten + 1, millFundUsdg: 0, millBidUsd: Math.round(s.millBidUsd * 0.9) }; emit(); },
    setEthFeedStale: (on) => { ethFeedStale = on; s = { ...s, ethUsd: on ? 0 : ETH_USD }; emit(); },
    reset: () => { s = initial(); lifetime.clear(); for (let i = 0; i < 12; i++) push(wallets[rnd(wallets.length)], [1, 1, 10, 10, 100][rnd(5)], Math.random() < 0.15, notes[rnd(notes.length)], Date.now() - (12 - i) * 5 * 60_000); emit(); },
  };
  void ethFeedStale;

  return {
    state: () => s,
    subscribe(fn) { subs.add(fn); fn(s); return () => subs.delete(fn); },
    async buy(n, pay, note) { await new Promise((r) => setTimeout(r, 400)); applyBuy(YOU, n, pay, note); },
    async setProfile(name, image) {
      await new Promise((r) => setTimeout(r, 400));
      const prev = s.profiles[YOU.toLowerCase()];
      const prof = { name, pfp: image ? URL.createObjectURL(new Blob([image as BlobPart])) : prev?.pfp ?? "" };
      s = { ...s, profiles: { ...s.profiles, [YOU.toLowerCase()]: prof }, you: { ...s.you, profile: prof } };
      emit();
    },
    async connect() { s = { ...s, you: { ...s.you, address: YOU } }; emit(); },
    async switchWallet() { await new Promise((r) => setTimeout(r, 300)); const alt = wallets[3]; s = { ...s, you: { ...s.you, address: s.you.address === YOU ? alt : YOU } }; emit(); },
    disconnect() { s = { ...s, you: { ...s.you, address: undefined } }; emit(); },
    async rollStorm() { storm(); },
    demoStorm: () => storm(),
    demo,
  };
}
