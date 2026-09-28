// The demo: the whole game simulated in the browser with play money. It never touches a real wallet
// (no window.ethereum, no RPC). Rules follow Fire.sol; state is kept in localStorage so a reload doesn't wipe it.
import {
  type Buy,
  type DemoControls,
  type DemoToken,
  type FireApi,
  type FireState,
  type Pay,
  type PriceSeen,
  type Profile,
  type Snapshot,
  DAILY_CAP,
  FULL_DAYS,
  PRIZE_CAP_MULT,
  LUCK_BPS,
  stormLook,
  KEEP,
  PLANK_USD_PER_TICKET,
  TX_CAP,
  stormBase,
  nextStormBase,
  nextRollTime,
  quote,
  ticketsFor,
  paperPerTicketAt,
  titleFor,
} from "./types";

const PLANK_USD = 1.056e-9; // from the V2 pool, Sep 27 2026
const ETH_USD = 3_333;
const PAPER_USD = 0.2; // demo only: a pretend PAPER market so PAPER has a price and can be swapped
const YOU = "0xd00d000000000000000000000000000000000001";
const FRIEND = "0xb0b0000000000000000000000000000000000002"; // "Switch wallet" in the demo flips to this one
const NOBODY = "0x0000000000000000000000000000000000000000";
const STORE = "the-fire-demo-v3";
const PRICE_MOVED = "The price moved at tonight's storm — check the new price and try again.";

const wallets = Array.from({ length: 40 }, (_, i) => "0x" + (0x7a3e1c + i * 9973).toString(16).padStart(40, "a"));
const notes = [
  "gm from 1 mill", "for the boys", "wildfire or nothing", "burn it all", "printed this morning",
  "logs on the fire", "not tonight storm", "one more for luck", "paper go brrr", "we ride at 8", "", "", "",
];
function rnd(n: number) { return Math.floor(Math.random() * n); }
const demoNames = ["plankdaddy", "MillOwner420", "Cinder", "sawdust.eth", "Brisket", "log_lady", "not_a_bot", "Fireside Phil", "matchstick", "Torch"];
const demoProfiles: Record<string, Profile> = {};
demoNames.forEach((name, i) => { demoProfiles[wallets[i].toLowerCase()] = { name, pfp: "" }; });

// Fire.sol's tables: storm age factor ((n-1)/8)^1.5 for nights 2..23, and the 32-point luck table (e^(0.9 z) quantiles), in bps.
const AGE = Array.from({ length: 22 }, (_, i) => 1250 * (i + 1)); // (night-1)/8 in bps, nights 2..23
const LUCK = LUCK_BPS;
const RATCHET = 0.05; // ticket legs move at most 5% a night toward their target

/** One demo wallet's money and tickets. */
interface Acct { paper: number; plank: number; eth: number; usdg: number; tickets: number; fire: number; bought: number; day: number; prize: number; refunded: boolean }
const starter = (big: boolean): Acct => big
  ? { paper: 30, plank: 40e9, eth: 0.03, usdg: 40, tickets: 0, fire: 0, bought: 0, day: 0, prize: 0, refunded: false } // ~$36 PLANK: 40+ tickets
  : { paper: 5, plank: 12e9, eth: 0.01, usdg: 10, tickets: 0, fire: 0, bought: 0, day: 0, prize: 0, refunded: false };

interface World {
  s: FireState;
  accounts: Record<string, Acct>;
  active: string;
  connected: boolean;
  lifetime: Record<string, number>;
  paperBuyers: string[];
  trail: number[]; // the last 7 nights' ticketsToday, oldest first (today excluded)
  base?: number; // the storm's normal level (Fire.stormBaseMilli / 1000)
  day: number;
  refundPot: number;
  refundTickets: number;
  lastWinner: string;
  crowdPerMin: number;
  ethFeedStale: boolean;
}

export function makeMockApi(): FireApi {
  const plankTarget = () => PLANK_USD_PER_TICKET / w.s.plankUsd;
  const fresh = (): World => {
    const trail = [470, 540, 505, 560, 490, 530, 545]; // mean 520
    const s: FireState = {
      fireId: 14,
      night: 6,
      potPlank: 2_750_000_000_000, // ~$2,900
      potCarriedIn: 800_000_000_000, // what fire #14 started with
      plankUsd: PLANK_USD,
      paperUsd: PAPER_USD,
      paperPerTicket: paperPerTicketAt(PAPER_USD),
      ethUsd: ETH_USD,
      plankPerTicket: PLANK_USD_PER_TICKET / PLANK_USD,
      ticketsToday: 410,
      ticketsTotal: 4_120,
      fireSize: 1_150,
      trailingAvg: 520,
      threat: 0.45,
      nextRollAt: nextRollTime(),
      you: { tickets: 0, paper: 0, plank: 0, eth: 0, usdg: 0, remainingToday: DAILY_CAP, isWinner: false },
      profiles: { ...demoProfiles },
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
    };
    return {
      s, accounts: { [YOU]: { ...starter(true), fire: 14 }, [FRIEND]: { ...starter(false), fire: 14 } }, active: YOU, connected: false,
      lifetime: {}, paperBuyers: [], trail, day: 0, refundPot: 0, refundTickets: 0, lastWinner: "", crowdPerMin: 6, ethFeedStale: false,
    };
  };

  let w!: World;
  let nextId = 1;
  const subs = new Set<(s: FireState) => void>();
  const saved = load();
  if (saved) { w = saved; nextId = Math.max(0, ...w.s.feed.map((b) => b.id)) + 1; }
  else seed(fresh());

  function seed(x: World) {
    w = x;
    for (let i = 0; i < 12; i++) push(wallets[rnd(wallets.length)], [1, 1, 2, 5, 11][rnd(5)], Math.random() < 0.15, notes[rnd(notes.length)], Date.now() - (12 - i) * 5 * 60_000);
    return w;
  }
  function load(): World | undefined {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return undefined;
      const x = JSON.parse(raw) as World;
      if (!x?.s || !x.accounts || !x.trail) return undefined;
      return x;
    } catch { return undefined; }
  }
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const flush = () => { clearTimeout(saveT); saveT = undefined; try { localStorage.setItem(STORE, JSON.stringify(w)); } catch { /* private mode / full: the demo still works, it just forgets */ } };
  function save() { clearTimeout(saveT); saveT = setTimeout(flush, 400); }
  try { addEventListener("pagehide", () => { if (saveT) flush(); }); } catch { /* no window */ }

  const acct = (a = w.active) => (w.accounts[a] ??= starter(false));
  const ticketsOf = (a: Acct) => (a.fire === w.s.fireId ? a.tickets : 0);
  const boughtToday = (a: Acct) => (a.day === w.day ? a.bought : 0);
  function you(): FireState["you"] {
    if (!w.connected) return { tickets: 0, paper: 0, plank: 0, eth: 0, usdg: 0, remainingToday: DAILY_CAP, isWinner: false };
    const a = acct();
    const mine = ticketsOf(a);
    return {
      address: w.active, tickets: mine, paper: a.paper, plank: a.plank, eth: a.eth, usdg: a.usdg,
      remainingToday: Math.max(0, DAILY_CAP - boughtToday(a)), isWinner: w.lastWinner === w.active, profile: w.s.profiles[w.active.toLowerCase()],
      prize: a.prize, refund: w.s.abandoned && !a.refunded && w.refundTickets > 0 ? (w.refundPot * mine) / w.refundTickets : 0,
    };
  }
  const emit = () => {
    const avg = Math.floor(w.trail.reduce((x, y) => x + y, 0) / Math.max(1, w.trail.length));
    w.s = { ...w.s, you: you(), trailingAvg: Math.max(1, avg) };
    subs.forEach((f) => f(w.s));
    save();
  };

  function push(who: string, tickets: number, fromFire: boolean, note: string, at = Date.now()) {
    const life = (w.lifetime[who] ?? 0) + tickets;
    w.lifetime[who] = life;
    if (!fromFire && !w.paperBuyers.includes(who)) w.paperBuyers.push(who);
    const b: Buy = { id: nextId++, who, tickets, fromFire, note, title: titleFor(life, !w.paperBuyers.includes(who)), at };
    w.s = { ...w.s, feed: [b, ...w.s.feed].slice(0, 40) };
  }
  function millEvent() {
    const b: Buy = { id: nextId++, who: NOBODY, tickets: 0, fromFire: false, note: "", title: "", at: Date.now(), kind: "mill" };
    w.s = { ...w.s, feed: [b, ...w.s.feed].slice(0, 40) };
  }

  /** The fire buys a mill off the floor with one side of the fund (a listing is in ETH or USDG), then burns it. */
  function eatMill(paidUsd: number, side: "eth" | "usdg") {
    const s = w.s;
    w.s = {
      ...s,
      millFundUsdg: side === "usdg" ? Math.max(0, s.millFundUsdg - paidUsd) : s.millFundUsdg,
      millFundEth: side === "eth" ? Math.max(0, s.millFundEth - paidUsd / (s.ethUsd || ETH_USD)) : s.millFundEth,
      millsEaten: s.millsEaten + 1,
      millBidUsd: Math.round(paidUsd * 0.9), // the bid restarts at 90% of the price paid
    };
    millEvent();
  }
  function maybeEatMill() {
    const s = w.s;
    if (s.millFundUsdg >= s.millBidUsd) eatMill(s.millBidUsd, "usdg");
    else if (s.ethUsd > 0 && s.millFundEth * s.ethUsd >= s.millBidUsd) eatMill(s.millBidUsd, "eth");
  }

  function applyBuy(who: string, n: number, pay: Pay, note: string, seen?: PriceSeen) {
    const s = w.s;
    if (s.abandoned) throw new Error("The game has ended. Buying is closed.");
    if (s.rollPending) throw new Error("The storm is rolling in. Try again once it lands.");
    if (n < 1 || n > TX_CAP) throw new Error(`Up to ${TX_CAP} a buy.`);
    const q = quote(n, s.plankPerTicket, s.ethUsd, s.paperPerTicket); // priced on tickets paid for
    const got = ticketsFor(n, s.night); // throw 10, get 3/2/1 free logs by the fire's day; priced on the 10
    const mine = w.accounts[who];
    if (mine) {
      // never charge more than the buyer was shown
      if (seen && (s.plankPerTicket > seen.plankPerTicket * (1 + 1e-9) || (pay === "paper" && s.paperPerTicket > seen.paperPerTicket * (1 + 1e-9)))) throw new Error(PRICE_MOVED);
      if (pay === "eth" && !(s.ethUsd > 0)) throw new Error("ETH is paused (price feed late). Pay with PAPER or USDG.");
      if (pay === "eth" && seen && q.eth > (n / seen.ethUsd) * (1 + 1e-9)) throw new Error(PRICE_MOVED);
      if (pay === "usdg" && !s.usdgEnabled) throw new Error("USDG isn't on.");
      if (boughtToday(mine) + got > DAILY_CAP) throw new Error(`That's over your ${DAILY_CAP} a day.`);
      if (mine.plank < q.plank - 1e-6) throw new Error("Not enough PLANK.");
      if (pay === "paper" && mine.paper < q.paper - 1e-9) throw new Error("Not enough PAPER.");
      if (pay === "eth" && mine.eth < q.eth) throw new Error("Not enough ETH.");
      if (pay === "usdg" && mine.usdg < q.usdg) throw new Error("Not enough USDG.");
      mine.plank -= q.plank;
      if (pay === "paper") mine.paper -= q.paper; else if (pay === "eth") mine.eth -= q.eth; else mine.usdg -= q.usdg;
      if (mine.fire !== s.fireId) { mine.fire = s.fireId; mine.tickets = 0; }
      mine.tickets += got;
      if (mine.day !== w.day) { mine.day = w.day; mine.bought = 0; }
      mine.bought += got;
    }
    push(who, got, pay !== "paper", note);
    w.s = {
      ...w.s,
      ticketsToday: s.ticketsToday + got,
      ticketsTotal: s.ticketsTotal + got,
      fireSize: s.fireSize + got,
      potPlank: s.potPlank + q.plank, // all the PLANK goes into the pot
      burnedPaperAllTime: pay !== "paper" ? s.burnedPaperAllTime : s.burnedPaperAllTime + q.paper,
      millFundEth: pay === "eth" ? s.millFundEth + q.eth : s.millFundEth,
      millFundUsdg: pay === "usdg" ? s.millFundUsdg + q.usdg : s.millFundUsdg,
    };
    if (pay !== "paper") maybeEatMill();
    emit();
  }

  const crowdBuy = (n?: number, pay?: Pay) => {
    const s = w.s;
    if (s.abandoned || s.rollPending) return;
    const payWith = pay ?? ((Math.random() < 0.15 ? (Math.random() < 0.5 && s.ethUsd > 0 ? "eth" : "usdg") : "paper") as Pay);
    applyBuy(wallets[rnd(wallets.length)], n ?? [1, 1, 2, 5, 10, 10][rnd(6)], payWith === "usdg" && !s.usdgEnabled ? "paper" : payWith, notes[rnd(notes.length)]);
  };

  /** Move a ticket leg at most 5% toward its target, like the contract does each night. */
  const ratchet = (cur: number, target: number) => Math.min(cur * (1 + RATCHET), Math.max(cur * (1 - RATCHET), target));

  function storm(outcome: "random" | "survive" | "out" | "you-win" = "random", luckIdx?: number, quiet = false) {
    const s = w.s;
    if (s.abandoned) return;
    const before: Snapshot = { fireId: s.fireId, night: s.night, potPlank: s.potPlank, fireSize: s.fireSize, ticketsTotal: s.ticketsTotal, ticketsToday: s.ticketsToday, youTickets: s.you.tickets, youPlank: s.you.plank };
    const night = s.night + 1;
    const avg = Math.floor(w.trail.reduce((x, y) => x + y, 0) * 1000 / Math.max(1, w.trail.length)) / 1000; // to the thousandth, like the contract
    const luck = LUCK[luckIdx ?? rnd(32)];
    const size = s.fireSize;
    // Fire.sol: storm = trailingAvg × ageBps × luckBps / 1e8, to the thousandth of a ticket; night 1 none, night 24+ infinite
    const base = w.base ?? (w.trail.length ? avg : s.ticketsToday); // the storm's normal level
    let strength = night >= 24 ? Infinity : night <= 1 ? 0 : Math.floor((base * 1000 * AGE[night - 2] * luck) / 1e8) / 1000;
    if (outcome === "survive") strength = Math.min(strength, Math.max(0, size * 0.6));
    if (outcome === "out" || outcome === "you-win") strength = Math.max(strength, size + 1);
    const survived = night === 1 && outcome !== "out" && outcome !== "you-win" ? true : night < 24 && size > strength;
    const shown = Number.isFinite(strength) ? strength : size * 3 + 1;
    const intensity = stormLook(shown, size, survived);

    // the night turns over: today's tickets join the 7-night average, the daily cap resets, the ticket legs ratchet
    w.trail = [...w.trail, s.ticketsToday].slice(-7);
    w.base = nextStormBase(base, w.trail.reduce((x, y) => x + y, 0) / w.trail.length);
    w.day += 1;
    const legs = { plankPerTicket: ratchet(s.plankPerTicket, plankTarget()), paperPerTicket: Math.min(1, ratchet(s.paperPerTicket, paperPerTicketAt(s.paperUsd))) };
    if (survived) {
      const after = Math.max(0, (size - shown) * KEEP);
      const newAvg = Math.max(1, Math.floor(w.trail.reduce((x, y) => x + y, 0) / w.trail.length));
      w.s = { ...s, ...legs, night, fireSize: after, ticketsToday: 0,
        storm: { at: Date.now(), fireId: s.fireId, night, strength: shown, size, survived, intensity, sizeAfter: after / (newAvg * FULL_DAYS), before } };
    } else {
      // pick the winning ticket: our demo wallets hold real tickets; the rest belong to the crowd
      let winner = NOBODY;
      if (s.ticketsTotal > 0) {
        const held = Object.entries(w.accounts).map(([a, x]) => [a, ticketsOf(x)] as const).filter(([, t]) => t > 0);
        if (outcome === "you-win") winner = w.active;
        else {
          let r = Math.random() * Math.max(s.ticketsTotal, held.reduce((x, [, t]) => x + t, 0));
          winner = wallets[rnd(wallets.length)];
          for (const [a, t] of held) { if (r < t) { winner = a; break; } r -= t; }
        }
      }
      const pot = s.potPlank;
      const nobody = winner === NOBODY;
      // 40% to the winner, 25% burns, 5% to the Paper Mill royalty pool, the rest carries. The split is taken from the pot or
      // from 20x what this fire's tickets put in, if smaller (Fire.sol's prize cap). No tickets: the whole pot carries.
      const base = nobody ? 0 : Math.min(pot, PRIZE_CAP_MULT * Math.max(0, pot - s.potCarriedIn));
      const paid = base * 0.4;
      const carry = pot - base * 0.7;
      if (w.accounts[winner]) w.accounts[winner].plank += paid;
      w.lastWinner = winner;
      w.s = {
        ...s, ...legs,
        storm: { at: Date.now(), fireId: s.fireId, night, strength: shown, size, survived, intensity, winner, paidPlank: paid, potPlank: pot, tickets: s.ticketsTotal, before },
        past: [{ id: s.fireId, nights: night, potPlank: pot, prizePlank: paid, winner, peakSize: size }, ...s.past].slice(0, 20),
        fireId: s.fireId + 1, night: 0, fireSize: 0,
        potPlank: carry, potCarriedIn: carry,
        burnedPlankAllTime: s.burnedPlankAllTime + base * 0.25,
        ticketsToday: 0, ticketsTotal: 0,
      };
    }
    const nextAvg = Math.max(1, Math.floor(w.trail.reduce((x, y) => x + y, 0) / w.trail.length));
    const nb = stormBase(w.s.night + 1, w.base ?? nextAvg);
    w.s = { ...w.s, threat: Math.max(0.1, Math.min(1, nb / (nextAvg * 2))), nextRollAt: nextRollTime(), rollPending: false, rollAction: undefined };
    if (quiet) w.s = { ...w.s, storm: undefined };
    emit();
  }

  // Missed storms while the page was closed happen quietly; one that's due now plays out.
  {
    let missed = 0;
    while (!w.s.abandoned && !w.s.rollPending && Date.now() >= w.s.nextRollAt && missed < 30) {
      const late = Date.now() - w.s.nextRollAt;
      if (late < 10 * 60_000) break; // due right now: let the page play it
      const at = w.s.nextRollAt;
      storm("random", undefined, true); missed++;
      w.s = { ...w.s, nextRollAt: nextRollTime(at + 1) };
    }
  }

  setInterval(() => {
    const s = w.s;
    if (s.abandoned) return;
    if (!s.rollPending && Date.now() >= s.nextRollAt) { storm(); return; } // 8 PM MST: the storm comes by itself
    if (!s.rollPending && Math.random() < w.crowdPerMin / 60) crowdBuy();
  }, 1_000);

  // ---- demo swaps: constant-product pools against dollars, 0.3% a hop, depth per pool in $
  const DEPTH: Record<DemoToken, number> = { ETH: 400_000, USDG: 200_000, PLANK: 60_000, PAPER: 15_000 };
  const price = (t: DemoToken) => (t === "ETH" ? w.s.ethUsd || ETH_USD : t === "PLANK" ? w.s.plankUsd : t === "PAPER" ? w.s.paperUsd : 1);
  function swapQuote(from: DemoToken, to: DemoToken, amountIn: number) {
    if (from === to || !(amountIn > 0)) return undefined;
    const pa = price(from), pb = price(to);
    if (!(pa > 0) || !(pb > 0)) return undefined; // no market (e.g. PAPER at $0)
    const x = amountIn * pa * 0.997;
    const usd = from === "USDG" ? x : (DEPTH[from] * x) / (DEPTH[from] + x);
    const y = usd * (to === "USDG" ? 1 : 0.997);
    const outUsd = to === "USDG" ? y : (DEPTH[to] * y) / (DEPTH[to] + y);
    const out = outUsd / pb;
    const spot = (amountIn * pa) / pb * 0.997 * (from === "USDG" || to === "USDG" ? 1 : 0.997);
    return { out, impact: Math.max(0, 1 - out / spot) };
  }
  const bal = (a: Acct, t: DemoToken) => (t === "ETH" ? a.eth : t === "PLANK" ? a.plank : t === "PAPER" ? a.paper : a.usdg);
  const addBal = (a: Acct, t: DemoToken, v: number) => { if (t === "ETH") a.eth += v; else if (t === "PLANK") a.plank += v; else if (t === "PAPER") a.paper += v; else a.usdg += v; };

  const demo: DemoControls = {
    roll: (o, luck) => storm(o, luck),
    skipNights: (n) => {
      for (let i = 0; i < n; i++) {
        const avg = Math.max(1, Math.floor(w.trail.reduce((x, y) => x + y, 0) / w.trail.length));
        const today = Math.round(avg * (0.6 + Math.random() * 0.8));
        w.s = { ...w.s, ticketsToday: w.s.ticketsToday + today, ticketsTotal: w.s.ticketsTotal + today, fireSize: w.s.fireSize + today };
        storm("random", undefined, true);
      }
    },
    setPending: (on) => { w.s = { ...w.s, rollPending: on, rollAction: on ? "deliver" : undefined }; emit(); },
    set: (patch) => {
      // Prices move the market; the ticket's PLANK and PAPER amounts follow at most 5% a night, like the contract.
      w.s = { ...w.s, ...patch };
      emit();
    },
    setYou: (patch) => {
      const a = acct();
      if (patch.paper !== undefined) a.paper = patch.paper;
      if (patch.plank !== undefined) a.plank = patch.plank;
      if (patch.eth !== undefined) a.eth = patch.eth;
      if (patch.usdg !== undefined) a.usdg = patch.usdg;
      if (patch.tickets !== undefined) { const d = patch.tickets - ticketsOf(a); a.fire = w.s.fireId; a.tickets = patch.tickets; w.s = { ...w.s, ticketsTotal: Math.max(patch.tickets, w.s.ticketsTotal + d) }; }
      if (patch.remainingToday !== undefined) { a.day = w.day; a.bought = Math.max(0, DAILY_CAP - patch.remainingToday); }
      emit();
    },
    setConnected: (on) => { w.connected = on; emit(); },
    setCrowd: (perMin) => { w.crowdPerMin = perMin; save(); },
    crowdBuy: (n, pay) => crowdBuy(n, pay),
    eatMill: () => {
      const s = w.s, ethUsd = s.ethUsd || ETH_USD;
      if (s.millFundUsdg >= s.millBidUsd) eatMill(s.millBidUsd, "usdg");
      else if (s.millFundEth * ethUsd >= s.millBidUsd) eatMill(s.millBidUsd, "eth");
      // not enough for the bid: pretend a cheap listing turned up at what the bigger side holds
      else if (s.millFundUsdg >= s.millFundEth * ethUsd) eatMill(s.millFundUsdg, "usdg");
      else eatMill(s.millFundEth * ethUsd, "eth");
      emit();
    },
    setEthFeedStale: (on) => { w.ethFeedStale = on; w.s = { ...w.s, ethUsd: on ? 0 : ETH_USD }; emit(); },
    setAbandoned: (on) => {
      if (on && !w.s.abandoned) { w.refundPot = w.s.potPlank; w.refundTickets = w.s.ticketsTotal; w.s = { ...w.s, abandoned: true, potPlank: 0, rollPending: false, rollAction: undefined }; }
      if (!on && w.s.abandoned) { w.s = { ...w.s, abandoned: false, potPlank: w.refundPot }; w.refundPot = 0; w.refundTickets = 0; Object.values(w.accounts).forEach((a) => (a.refunded = false)); }
      emit();
    },
    setPrizeStuck: (on) => { acct().prize = on ? Math.round(w.s.potPlank * 0.4) || 1e12 : 0; emit(); },
    swapQuote,
    async swap(from, to, amountIn, minOut) {
      await new Promise((r) => setTimeout(r, 500));
      if (!w.connected) throw new Error("Connect the demo wallet first.");
      const a = acct();
      if (bal(a, from) < amountIn) throw new Error(`Not enough ${from}.`);
      const q = swapQuote(from, to, amountIn);
      if (!q) throw new Error(`No pool trades ${from} for ${to} yet.`);
      if (q.out < minOut) throw new Error("The price moved more than your slippage. Check the new quote.");
      addBal(a, from, -amountIn); addBal(a, to, q.out);
      emit();
      return q.out;
    },
    reset: () => {
      try { localStorage.removeItem(STORE); } catch { /* nothing saved */ }
      seed(fresh()); emit();
    },
  };

  return {
    state: () => w.s,
    subscribe(fn) { subs.add(fn); fn(w.s); return () => subs.delete(fn); },
    async buy(n, pay, note, seen) { await new Promise((r) => setTimeout(r, 400)); if (!w.connected) throw new Error("Connect the demo wallet first."); applyBuy(w.active, n, pay, note, seen); },
    async setProfile(name, image) {
      await new Promise((r) => setTimeout(r, 400));
      const key = w.active.toLowerCase();
      const prev = w.s.profiles[key];
      const prof = { name, pfp: image ? dataUrl(image) : prev?.pfp ?? "" };
      w.s = { ...w.s, profiles: { ...w.s.profiles, [key]: prof } };
      emit();
    },
    async claim() {
      await new Promise((r) => setTimeout(r, 400));
      const a = acct();
      if (!a.prize) throw new Error("Nothing to claim.");
      a.plank += a.prize; a.prize = 0; emit();
    },
    async refund() {
      await new Promise((r) => setTimeout(r, 400));
      const share = w.s.you.refund ?? 0;
      if (!share) throw new Error("Nothing to claim.");
      const a = acct(); a.plank += share; a.refunded = true; emit();
    },
    async connect() { w.connected = true; emit(); },
    async switchWallet() { await new Promise((r) => setTimeout(r, 300)); w.active = w.active === YOU ? FRIEND : YOU; w.connected = true; emit(); },
    disconnect() { w.connected = false; emit(); },
    async rollStorm() { storm(); },
    demoStorm: () => storm(),
    demo,
  };
}

/** Picture bytes → a data: URL (survives a reload, unlike a blob: URL). */
function dataUrl(b: Uint8Array): string {
  const mime = b[0] === 0x52 && b[8] === 0x57 ? "image/webp" : b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : b[0] === 0x47 ? "image/gif" : "image/webp";
  let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}
