/* Omni Cardworks (demo mode): shared state (demo data, no chain), events, toasts and the sheet (dialog) helper.
   Every other module reads and writes through window.Store and opens screens with window.Sheet. */
(() => {
  // live or demo, decided once (live.js, net.ts and forge-wallet.ts follow the same rule): ?live=testnet|mainnet, else
  // ?live=off (the demo), else what the build wrote into <meta name="forge-live"> (VITE_LIVE; empty = the demo)
  const LIVE_NET = (() => {
    const q = new URLSearchParams(location.search).get('live'), ok = (v) => (v === 'testnet' || v === 'mainnet' ? v : null);
    if (q === 'off') return null;
    return ok(q) ?? ok(document.querySelector('meta[name="forge-live"]')?.content ?? '');
  })();
  // the URL's demo toys (?wave, ?theme, ?style, ?ideas, ?results): read in the demo only
  const demoQ = LIVE_NET ? new URLSearchParams() : new URLSearchParams(location.search);
  const MATS = ['paper', 'wood', 'fire', 'charcoal', 'diamond', 'gold', 'fullart'];
  const MAT_LABEL = { paper: 'Paper', wood: 'Wood', fire: 'Fire', charcoal: 'Coal', diamond: 'Diamond', gold: 'Gold', fullart: 'Full Art' };
  // always holo: Diamond (the old top card) and the Standard's Gold and Full Art (always full holo)
  const ALWAYS_HOLO = { diamond: true, gold: true, fullart: true };
  // the Standard recipe's pack (contracts StandardRecipe.sol; docs/cards-contracts.md): every pack has the same shape,
  // its slots in order, and each card rolls its material from its own slot's fixed odds, then its holo (frame and
  // picture each roll at 1 - sqrt(1 - rate); Gold and Full Art always full holo), then its character. The live site
  // reads each Series' own slots from the chain.
  const PACK_SLOTS = [
    { count: 3, odds: [['paper', 1]] },
    { count: 1, odds: [['wood', 1]] },
    { count: 1, odds: [['wood', 494], ['fire', 300], ['charcoal', 120], ['gold', 86]] }, // Wood or better, of 1,000
    { count: 1, odds: [['fire', 6732], ['charcoal', 1734], ['gold', 1534]] }, // Fire or better, of 10,000
  ];
  // Full Art is in no slot: exactly one per character per Series (the owner's rule), each in a random pack, where it
  // takes the place of a Paper. A pack's chance of one = Full Arts still to come / packs still to deal.
  const ONE_PER = 'fullart';
  const MAT_ORDER = ['paper', 'wood', 'fire', 'charcoal', 'gold', 'fullart'];
  /** Each material's share of all cards from a pack's slots: its expected cards per pack over cards per pack, as
   *  [material, share] in rank order; with `chars` and `packs`, Full Art's exact share (one per character) taken from
   *  Paper's. */
  const shareOf = (slots, chars = 0, packs = 0) => {
    const per = slots.reduce((a, s) => a + s.count, 0) || 1;
    const fa = chars > 0 && packs > 0 ? Math.min(chars, packs) / (packs * per) : 0;
    return MAT_ORDER.map((m) => [m, m === ONE_PER ? fa : slots.reduce((a, s) => {
      const total = s.odds.reduce((x, [, w]) => x + w, 0);
      return a + s.count * ((s.odds.find(([x]) => x === m) || [m, 0])[1] / (total || 1));
    }, 0) / per - (m === 'paper' ? fa : 0)]).filter(([, p]) => p > 0);
  };
  const CARD_ODDS = shareOf(PACK_SLOTS, 10, 167); // the demo Series: 167 packs, 10 characters
  const ODDS_TOTAL = CARD_ODDS.reduce((a, [, w]) => a + w, 0);
  const HOLO_RATE = { paper: 0.05, wood: 0.1, fire: 0.5, charcoal: 0.9 };
  // the demo's own pulls lean rare (owner's call) so visitors get to see Gold and Full Art: the same pack shape, with
  // Gold boosted in the Wood-or-better and Fire-or-better slots (about 0.41 Gold a pack against 0.24), and a Full Art
  // in about 1 pack in 3.5 (against 1 in 17), still only for a character the visitor doesn't have one of yet. The odds
  // the site shows stay the Series' real ones, and the live site always deals at the chain's odds.
  const DEMO_PACK_SLOTS = [
    PACK_SLOTS[0], PACK_SLOTS[1],
    { count: 1, odds: [['wood', 45], ['fire', 27], ['charcoal', 12], ['gold', 16]] },
    { count: 1, odds: [['fire', 59], ['charcoal', 16], ['gold', 25]] },
  ];
  const DEMO_FULL_ART = 0.29; // a demo pack's chance of a Full Art
  /** One card from a slot's odds ([material, weight] pairs): { material, holo }. */
  const rollCard = (rand = Math.random, odds = CARD_ODDS) => {
    const total = odds.reduce((a, [, w]) => a + w, 0);
    let u = rand() * total, material = odds[odds.length - 1][0];
    for (const [m, w] of odds) { if (u < w) { material = m; break; } u -= w; }
    if (!HOLO_RATE[material]) return { material, holo: 'full' };
    const q = 1 - Math.sqrt(1 - HOLO_RATE[material]), f = rand() < q, p = rand() < q;
    return { material, holo: f && p ? 'full' : f ? 'frame' : p ? 'picture' : 'none' };
  };
  /** One pack, slot by slot, each card its own roll from its slot's odds. The demo deals DEMO_PACK_SLOTS; `slots`
   *  overrides (e.g. the real PACK_SLOTS). `owed`: the characters still waiting on their Full Art; a pack that gets one
   *  (DEMO_FULL_ART) has it in its first Paper's place, for one of them: { material, holo, character }. */
  const rollPack = (rand = Math.random, slots = DEMO_PACK_SLOTS, owed = []) => {
    const cards = slots.flatMap((s) => Array.from({ length: s.count }, () => rollCard(rand, s.odds)));
    if (owed.length && rand() < DEMO_FULL_ART) cards[0] = { material: ONE_PER, holo: 'full', character: owed[Math.floor(rand() * owed.length)] };
    return cards;
  };
  // the demo cast: real card art (Jean Phil × Painted Cubism is Series 6, Renaissance Gym Bros × Fresco Painting is
  // Series 7), rendered by the Card Studio's own renderer into cards/<id>/s/<material>-<holo>-<state>.webp
  const CHARS = {
    Lobster: { id: 'lobster', category: 'Sea Life', series: 6 }, Pigeon: { id: 'pigeon', category: 'Bird', series: 6 }, Toaster: { id: 'toaster', category: 'Appliance', series: 6 },
    Cactus: { id: 'cactus', category: 'Plant', series: 6 }, Jellyfish: { id: 'jellyfish', category: 'Sea Life', series: 6 },
    Frog: { id: 'frog', category: 'Amphibian', series: 7 }, Mushroom: { id: 'mushroom', category: 'Fungus', series: 7 }, 'Praying Mantis': { id: 'mantis', category: 'Insect', series: 7 },
    Rooster: { id: 'rooster', category: 'Bird', series: 7 }, Sloth: { id: 'sloth', category: 'Mammal', series: 7 },
  };
  /** A Series' characters (demo): its own cast, else Series 6's (the collection's). */
  const castOf = (no) => { const c = Object.keys(CHARS).filter((k) => CHARS[k].series === no); return c.length ? c : Object.keys(CHARS).filter((k) => CHARS[k].series === 6); };
  const NAMES = castOf(6);
  const DAY = 86400000;
  const DEMO_ADDR = '0x7a3f2b9c41d0e5a6b8f9c0d1e2f3a4b5c6d7c91e'; // the demo wallet (its short form is shown)
  // demo prices: the pack, and the coins it can be paid in (cases and grades are priced in dollars too)
  const PRICES = { PACK_USD: 2.5, PAPER_USD: 0.08, ETH_USD: 2500, PLANK_USD: 0.0000021, CASE_USD: 0.05, GRADE_USD: 1, PACK_PAPER: 1, PRESS_PAPER: 1, SUGGEST_PAPER: 1 }; // this Series' settings (per drop)
  // demo collection: cards from Series 6 (already closed; the card images print "Series 6"), with a spread of materials, holos and grades
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mkR = (k) => () => (k = (k * 16807) % 2147483647) / 2147483647;
  const pickMat = () => { const u = R(); return u < 0.5 ? 'paper' : u < 0.8 ? 'wood' : u < 0.95 ? 'fire' : 'charcoal'; };
  const cards = [];
  for (let i = 0; i < 46; i++) {
    const material = i === 9 ? 'charcoal' : pickMat();
    const holoRate = { paper: 0.05, wood: 0.1, fire: 0.5, charcoal: 0.9, diamond: 1 }[material];
    const holo = i === 5 ? 'full' : R() < holoRate ? ['frame', 'picture', 'full'][Math.floor(R() * 3)] : 'none';
    const series = 6;
    const g = R();
    cards.push({
      id: 1000 + i, serial: 300 + i * 7, series, character: NAMES[Math.floor(R() * NAMES.length)], material,
      // print number: the k-th of this exact card pulled (the second roll keeps the demo's seeded cards as they were)
      holo: material === 'paper' && i === 5 ? 'full' : holo, edition: ((k) => (R(), String(k)))(1 + Math.floor(R() * 40)),
      grade: g < 0.55 ? null : Math.max(1, Math.min(10, Math.round(5.5 + (R() - 0.5) * 6))), pending: false,
      // wear (docs/grading.md): dealt this long ago, cased or not (a case freezes the clock), moves between wallets
      dealt: Date.now() - Math.round((2 + R() * 200) * DAY), cased: false, frozenAge: 0, moves: Math.floor(R() * R() * 4),
    });
  }
  cards[5].material = 'paper'; cards[5].holo = 'full'; // a full-holo Paper, the rare one to show off
  // raw holo cards to show off the holo (tilt them on the site): one of every look, plus a Gold and a Full Art
  [['gold', 'full', 'Toaster'], ['fullart', 'full', 'Pigeon'], ['fire', 'full'], ['charcoal', 'frame'], ['wood', 'picture'], ['paper', 'full']]
    .forEach(([material, holo, who], k) => Object.assign(cards[k], { material, holo, grade: null, cased: false, frozenAge: 0, dealt: Date.now() - (k + 1) * 3600e3, serial: 700 - k, ...(who ? { character: who } : {}) }));
  cards.forEach((c, i) => { if (i >= 6 && c.grade == null && i % 3 === 1) { c.cased = true; c.frozenAge = Math.round((0.2 + R() * 30) * DAY); } }); // some already cased

  const state = {
    demo: true,
    // this Series' settings (per drop; the live site reads them from the contracts): the base total of packs, the cast
    // size (characters) its recipe was built with, and its groups (docs/drop-groups.md: who can buy, how many, at what
    // price, when; Store.demoStage fills them in). phase: 3 on sale (or about to be), 4 sold out / closed.
    // Drop-wide settings too (live: FireSale.dropOf): cards per pack, most packs per checkout, the regular-wallets window
    // (seconds), the PAPER $ cap per pack and the free-pack caps. The burn splits (bps of the price) are each group's.
    series: { no: 7, total: 167, cast: 10, phase: 3, closed: false, groups: [], creditGroup: 2, creditPacksLeft: 16, left: null, closing: false,
      cardsPerPack: 6, maxPerTx: 50, regularWalletsFor: 48 * 3600, paperCapUsd: 1, creditPacksMax: 16, creditPacksPerWallet: 3 },
    wallet: {
      connected: false, address: '0x7a3f…c91e', full: DEMO_ADDR, name: 'Demo wallet', isPressHolder: true, inSnapshot: true, isContract: false,
      balances: { ETH: 0.42, PLANK: 1250000000, PAPER: 24, USDG: 50 },
      credits: 1, burnCount: 12, boughtIn: {}, pending: [],
      // ERC-20 allowances this wallet has given FireSale (packs, Press packs, free packs and suggestions all take PAPER)
      allowance: { PAPER: 0, PLANK: 0, USDG: 0 },
    },
    // Series teases: one character in every card type. Add one for any Series at any time: an entry here plus its six
    // cards in ui/announce/<id>-<type>.webp (paper, wood, fire, charcoal, gold, fullart), rendered for that Series (they
    // print "Series N"). While a Series is on sale its tease shows what's in its packs; between Series the next one's sits on the main page.
    teases: { 7: { id: 'frog-s7', name: 'Frog' } },
    sealed: { 7: 0, 6: 3 }, // sealed packs owned, by Series (6 is closed: it can be opened)
    cards,
    // suggestions: { text, at, picked }. text is exactly what goes on chain (FireCredits.suggest): Store.packSuggestion's lines
    suggestions: [
      { text: 'Character: A lighthouse keeper\nPersonality: Quiet, stubborn, never misses a ship.', at: 'Series 6', picked: true },
      { text: 'Character: Grandma’s cast-iron pan\nBackground: Four generations of Sunday breakfasts.', at: 'Series 7', picked: false },
    ],
    activity: [],
    // all-time PAPER and PLANK burned (live: the burn address's balances), and what the burned liquidity holds (live:
    // LiquidityBurner's burned pool tokens' share of the PAPER/PLANK pool)
    burnTally: { paper: 412880, plank: 1248300000, lp: { paper: 96400, plank: 310500000 } },
    burned: {}, // cards this wallet burned, by character + material and by look (Store.noteBurned)
  };
  const listeners = new Set();
  const Store = {
    state, MATS, MAT_LABEL, ALWAYS_HOLO, CHARS, NAMES, castOf, DAY, PRICES,
    LIVE_NET, // 'testnet' / 'mainnet' when the page runs live (live.js), else null
    // MAX_BATCH mirrors FirePsa.maxBatch() (an owner setting): the most cards one case & grade payment can take, cases and grades together
    MAX_BATCH: 20,
    // approvals (demo): the most a call may take must be approved to FireSale first; spending uses it up
    needsApproval(token, amount) { return token !== 'ETH' && amount > 0 && (state.wallet.allowance[token] || 0) < amount - 1e-9; },
    approve(token, amount) { state.wallet.allowance[token] = amount; },
    spend(token, amount) { if (token !== 'ETH') state.wallet.allowance[token] = Math.max(0, (state.wallet.allowance[token] || 0) - amount); },
    get(path) { return path.split('.').reduce((o, k) => o?.[k], state); },
    update(fn) { fn(state); listeners.forEach((l) => l(state)); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // the tease to show now: the Series on sale, or (between Series) the next one; null if none has been added
    tease() {
      const s = state.series, no = s.phase >= 4 ? s.no + 1 : s.no, t = state.teases[no];
      // the line under it: on sale, or still to come
      return t ? { no, live: s.phase < 4, line: s.phase < 4 ? 'Hot off the press' : 'Heating up', ...t } : null;
    },
    // packs that can still sell in the groups with a count (an unlimited "after sell-out" group adds on top)
    left() {
      const s = state.series; if (s.phase >= 4) return 0;
      return s.groups.filter((g) => g.state !== 'ended' && !g.unlimited).reduce((a, g) => a + (g.left || 0), 0);
    },
    // the after-sell-out group (no pack count, a rising price) while it's open
    extraOpen() { return state.series.phase < 4 ? state.series.groups.find((g) => g.unlimited && g.state === 'open') || null : null; },
    // the k-th next pack's price in a group (k = 1 for the next): base x (1 + tax)^(sold + k) for a rising tax
    packPrice(g, k = 1) {
      const r = 1 + (g.taxBps || 0) / 10000, usd = g.priceUsd * r ** (g.taxBps ? g.sold + k : 0);
      return { usd, tax: usd - g.priceUsd };
    },
    // what `n` more packs of a group cost in dollars, the rising tax included, and that tax
    groupCost(g, n) { let usd = 0, tax = 0; for (let k = 1; k <= n; k++) { const p = Store.packPrice(g, k); usd += p.usd; tax += p.tax; } return { usd, tax }; },
    // can this wallet buy in group g now, and how many? { ok, why, max }. The demo's rules; the live site has its own
    // (live.js: the NFTs it holds, the holders list, the packs it took)
    groupAccess(g) {
      const w = state.wallet, bought = w.boughtIn[g.index] || 0;
      if (g.gate === 'nft' && !w.isPressHolder) return { ok: false, why: g.who };
      if (g.gate === 'snapshot' && !w.inSnapshot) return { ok: false, why: g.who };
      if (g.gate === 'nft' && bought >= g.perNft) return { ok: false, why: 'Your Press already got its pack' };
      if (w.isContract && g.gate !== 'nft' && g.index < 3) return { ok: false, why: 'Regular wallets only for now' };
      const pw = Store.walletLimit(g);
      const lim = [g.perTx || 50, g.left ?? Infinity, pw ? pw - bought : Infinity, g.gate === 'nft' ? g.perNft - bought : Infinity];
      const max = Math.max(0, Math.min(...lim));
      return max ? { ok: true, max } : { ok: false, why: g.left === 0 ? 'Sold out' : Store.limitWhy(g) };
    },
    // ---- a per-wallet limit on a timer (limitFor, seconds): it lifts at limitUntil (0 = not known yet), then no limit
    /** The per-wallet limit that applies now (0 = none). */
    walletLimit(g) {
      const t = Date.now() / 1000 + (Store.clockSkew || 0);
      return g.perWallet && !(g.limitFor && g.limitUntil && t >= g.limitUntil) ? g.perWallet : 0;
    },
    /** "24 hours", "90 minutes", "3 days". */
    spanTxt(sec) {
      const s = Math.round(sec || 0), u = (n, w) => `${n.toLocaleString('en-US')} ${n === 1 ? w : w + 's'}`;
      return s >= 3 * 86400 && s % 86400 === 0 ? u(s / 86400, 'day') : s >= 3600 ? u(+(s / 3600).toFixed(1), 'hour') : u(Math.max(1, Math.round(s / 60)), 'minute');
    },
    /** "Sat 3:00 PM": a unix second on this device's clock. */
    clockTxt(t) { return new Date(t * 1000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); },
    /** "Limit: 5 per wallet", or with a timer "Limit: 5 per wallet until Sat 3:00 PM, then no limit". */
    limitWhy(g) {
      const base = `Limit: ${g.perWallet} per wallet`;
      if (!g.limitFor) return base;
      return `${base} ${g.limitUntil ? `until ${Store.clockTxt(g.limitUntil)}` : `for the first ${Store.spanTxt(g.limitFor)}`}, then no limit`;
    },
    // ---- refusals that quote this Series' own settings (one wording for the demo and live.js; never a fixed number)
    FREE_CLOSED: "Free packs work while a Series' free-pack group is open. Yours are safe until then.",
    FREE_GONE: "This Series' free packs are gone. Yours carry over to the next one.",
    /** The regular-wallets rule: "... for the first 48 hours of this sale ..." (the drop's window). */
    botRule() {
      const h = Math.round((state.series.regularWalletsFor || 0) / 3600);
      return h ? `Regular wallets only for the first ${h.toLocaleString('en-US')} ${h === 1 ? 'hour' : 'hours'} of this sale, so bots can't sweep it.` : "Regular wallets only for now, so bots can't sweep the sale.";
    },
    /** Who a holders-list group counts: "wallets that held $69+ of PLANK for 7 days" (its snapshot's settings), or null. */
    holdRule(g) {
      const x = g?.snap; if (!x || !x.min) return null;
      const amt = x.unit === 'usd' ? `$${(+x.min).toLocaleString('en-US')}+ of ${x.symbol || 'the token'}` : `${(+x.min).toLocaleString('en-US')}+ ${x.symbol || 'tokens'}`;
      return `wallets that held ${amt}${x.days ? ` for ${+x.days} ${+x.days === 1 ? 'day' : 'days'}` : ''}`;
    },
    /** A holders-list group's name for people: "PLANK holders" (its snapshot's token), else its own name. */
    holdersName(g) { return g?.gate === 'snapshot' && g.snap?.symbol ? `${g.snap.symbol} holders` : g?.name || ''; },
    /** Why this wallet can't buy in group g, as the sheet says it (groupAccess's short `why`, spelled out). */
    refusal(g, a) {
      const why = a?.why || g.who;
      if (why === g.who && g.gate === 'nft') return g.isPress ? `Paper Press holders only. At most 1 pack per Press${g.perWallet ? ` and ${g.perWallet} per wallet` : ''}, while they last.` : `${g.who}.`;
      if (why === g.who && g.gate === 'snapshot') { const r = Store.holdRule(g); return r ? `${Store.holdersName(g)} only: ${r} before this Series (checked by snapshot).` : `${g.who}.`; }
      if (/^Regular wallets/.test(why)) return Store.botRule();
      return /[.!?]$/.test(why) ? why : why + '.';
    },
    // DEMO: the Standard preset's groups (docs/drop-groups.md) at a stage of the sale: 'holders' (Press and PLANK
    // holders first), 'open' (Everyone), 'waiting' (Everyone sold out, more may come from the Press group), 'after'
    // (after sell-out: the rising price), 'closed'. ?stage=... in the URL, or Demo controls.
    demoStage(stage) {
      const now = Math.floor(Date.now() / 1000), H = 3600, s = state.series;
      const mk = (o) => {
        // plankBurnBps + paperBurnBps: the group's liquidity share (bps of its price; live: FireGroups), the Standard 10% + 20%
        const g = { perWallet: 0, limitFor: 0, limitUntil: 0, perNft: 0, perTx: 50, unlimited: false, taxBps: 0, plankBurnBps: 1000, paperBurnBps: 2000, idle: 0, duration: 0, sold: 0, waiting: false, moreFrom: null, moreAt: 0, afterGroup: null, rollTo: null, snap: null, ...o };
        // the next pack's price and the few after it (live: read from the contract), from the sold count
        return Object.defineProperties(g, { next: { enumerable: true, get: () => Store.packPrice(g, 1) }, after: { enumerable: true, get: () => (g.taxBps ? [2, 3, 4].map((k) => Store.packPrice(g, k)) : []) } });
      };
      // duration: how long a timed group runs (seconds; 0 = until sold out); rollTo: where its unsold packs go; snap: who the
      // holders list counts (live: the published snapshot file's settings)
      const press = mk({ index: 0, name: 'Paper Press holders', who: 'Paper Press holders only', gate: 'nft', isPress: true, priceUsd: 0, paper: Store.PRICES.PRESS_PAPER, coins: [], perNft: 1, perWallet: 2, capacity: 50, duration: 6 * H, rollTo: 2 });
      const plank = mk({ index: 1, name: 'PLANK holders', who: 'PLANK holders only', gate: 'snapshot', priceUsd: PRICES.PACK_USD, paper: PRICES.PACK_PAPER, coins: ['PLANK'], perWallet: 5, capacity: 40, duration: 24 * H, rollTo: 2, plankBurnBps: 10000, paperBurnBps: 0,
        snap: { unit: 'usd', min: '69', days: 7, symbol: 'PLANK' } });
      const all = mk({ index: 2, name: 'Everyone', who: 'Everyone', gate: 'open', priceUsd: PRICES.PACK_USD, paper: PRICES.PACK_PAPER, coins: ['PLANK', 'ETH', 'USDG'], perWallet: 5, limitFor: 24 * H, capacity: 77, afterGroup: 1 });
      const extra = mk({ index: 3, name: 'Extra packs', who: 'Everyone', gate: 'open', priceUsd: PRICES.PACK_USD, paper: PRICES.PACK_PAPER, coins: ['ETH'], perTx: 1, unlimited: true, taxBps: 400, idle: 900, capacity: null, left: null, afterGroup: 2 });
      // limitUntil: a timed wallet limit lifts limitFor after the group opened (0 = not known yet)
      const set = (g, o) => Object.assign(g, o, { left: g.unlimited ? (o.state === 'ended' ? 0 : null) : (o.capacity ?? g.capacity) - (o.sold ?? 0),
        limitUntil: g.limitFor && o.opensAt ? o.opensAt + g.limitFor : 0 });
      if (stage === 'open') {
        set(press, { state: 'ended', opensAt: now - 30 * H, endsAt: now - 24 * H, sold: 41 }); set(plank, { state: 'ended', opensAt: now - 30 * H, endsAt: now - 6 * H, sold: 40 });
        set(all, { state: 'open', opensAt: now - 6 * H, endsAt: 0, capacity: 86, sold: 30 }); set(extra, { state: 'upcoming', opensAt: 0, endsAt: 0 });
      } else if (stage === 'waiting') {
        set(press, { state: 'open', opensAt: now - H, endsAt: now + 5 * H, sold: 10 }); set(plank, { state: 'ended', opensAt: now - H, endsAt: now - 1800, sold: 40 });
        set(all, { state: 'open', opensAt: now - 1800, endsAt: 0, sold: 77 }); Object.assign(all, { waiting: true, moreFrom: 0, moreAt: now + 5 * H });
        set(extra, { state: 'upcoming', opensAt: 0, endsAt: 0 });
      } else if (stage === 'after') {
        set(press, { state: 'ended', opensAt: now - 30 * H, endsAt: now - 24 * H, sold: 41 }); set(plank, { state: 'ended', opensAt: now - 30 * H, endsAt: now - 6 * H, sold: 40 });
        set(all, { state: 'ended', opensAt: now - 6 * H, endsAt: now - 1200, capacity: 86, sold: 86 }); set(extra, { state: 'open', opensAt: now - 1200, endsAt: now + 12 * 60, sold: 3 });
      } else {
        set(press, { state: 'open', opensAt: now - H, endsAt: now + 5 * H, sold: 23 }); set(plank, { state: 'open', opensAt: now - H, endsAt: now + 23 * H, sold: 12 });
        set(all, { state: 'upcoming', opensAt: now + 23 * H, endsAt: 0 }); set(extra, { state: 'upcoming', opensAt: 0, endsAt: 0 });
      }
      Object.assign(s, { groups: [press, plank, all, extra], stage: stage || 'holders', phase: stage === 'closed' ? 4 : 3, closed: stage === 'closed', closing: false });
      if (stage === 'closed') s.groups.forEach((g) => { g.state = 'ended'; g.left = 0; });
    },

    CARD_ODDS, ODDS_TOTAL, HOLO_RATE, PACK_SLOTS, DEMO_PACK_SLOTS, ONE_PER, MAT_ORDER, shareOf, rollCard, rollPack,
    log(text) { state.activity.unshift({ text, t: Date.now() }); state.activity.length = Math.min(state.activity.length, 30); },
    cardStrip(c) { // the finished card images for a look (character, material, holo): one strip, raw, cased, then slabbed PDA 1-10
      const id = (CHARS[c.character] || CHARS[NAMES[0]]).id;
      const holo = (c.material === 'gold' || c.material === 'fullart') ? 'full' : c.material === 'diamond' && (c.holo || 'none') === 'none' ? 'full' : c.holo || 'none';
      return `cards/${id}/${c.material}-${holo}.webp`;
    },
    // the card as it is now: one state cut from its strip (360 x 504, size_images.py), so a tile loads ~30 KB, not the strip
    cardImg(c) { return Store.cardStrip(c).replace(/\/([^/]+)\.webp$/, `/s/$1-${Store.stateIdx(c)}.webp`); },
    // a card's parts for drawing it live (holo.js), sharp at any size and with moving holo: its picture + frame, its
    // print strip (text, seal, wear per state), and the slab label's lines; null for a retired Diamond (its card images
    // were made the old way)
    cardParts(c) {
      if (c.material === 'diamond') return null;
      const always = c.material === 'gold' || c.material === 'fullart', look = always ? 'full' : c.holo || 'none';
      const id = (CHARS[c.character] || CHARS[NAMES[0]]).id;
      const holoWord = { frame: 'Holo Frame', picture: 'Holo Picture', full: 'Full Holo' }[look]; // the slab label's words, as the studio prints them (render.ts)
      // print: just this state's layer (720 x 1008, size_images.py), not the 8640 px strip of all 12. Raw and cased
      // print the same (no wear on either): a cased card uses the raw layer, so it's never fetched twice
      const st = Store.stateIdx(c), ps = st === 1 ? 0 : st;
      return { look, holder: Store.holder(c), state: st, plain: `cards/${id}/${c.material}-plain.webp`, print: `cards/${id}/p/${c.material}-print-${ps}.webp`,
        label: { name: c.character, sub: [`Series ${c.series}`, MAT_LABEL[c.material], holoWord].filter(Boolean).join(' · '), grade: c.grade } };
    },
    // which card in the strip: 0 raw, 1 cased, 2-11 slabbed PDA 1-10
    stateIdx(c) { return c.grade != null ? c.grade + 1 : c.cased ? 1 : 0; },
    STATES: 12,
    cardPos() { return '50% 50%'; }, // cardImg is one state now (it was that state's object-position in the strip)
    holder(c) { return c.grade != null ? 'slab' : c.cased ? 'case' : 'raw'; },
    // wear time so far: frozen once cased, sent for grading or slabbed; otherwise still running (live: `dealt` is when the
    // wear clock started, read back from the chain's age, so a cancelled grading's frozen gap isn't counted)
    ageMs(c) { return c.cased || c.pending || c.grade != null ? c.frozenAge : Date.now() - c.dealt; },
    // what casing or grading a card costs, in dollars: one case price and one grading price for every card
    // (FirePsa.caseUsd18, gradeUsd18). Paid in PLANK, ETH or USDG.
    caseUsd(_c) { return PRICES.CASE_USD; },
    gradeUsd(_c) { return PRICES.GRADE_USD; },
    // the words on a slab, by grade
    GRADE_WORD: { 10: 'GEM MINT', 9: 'MINT', 8: 'NM-MT', 7: 'NEAR MINT', 6: 'EX-MT', 5: 'EXCELLENT', 4: 'VG-EX', 3: 'VERY GOOD', 2: 'GOOD', 1: 'POOR' },
    /** The pop report: how many slabs of each grade exist, by Series and material: { [series]: { [material]: { [grade]: n } } }.
     *  Live: FirePsa's Graded events (Live.popReport). Demo: a made-up population for each Series in the demo, plus this wallet's slabs. */
    async popReport() {
      if (window.Live?.on) return window.Live.popReport();
      const out = {}, add = (s, m, g) => { const x = ((out[s] ??= {})[m] ??= {}); x[g] = (x[g] || 0) + 1; };
      const W = window.Wear, series = [...new Set(state.cards.map((c) => c.series))];
      for (const s of series) { // DEMO DATA: about a third of each material graded, at ages drawn from a fixed seed
        const r = mkR(9000 + s);
        for (const [m, n] of [['paper', 120], ['wood', 70], ['fire', 26], ['charcoal', 9], ['gold', 3], ['fullart', 2]]) {
          for (let i = 0; i < n; i++) { const days = r() < 0.55 ? r() * 0.9 : r() < 0.7 ? 1 + r() * 120 : 120 + r() * 1400; add(s, m, W ? W.draw(days * 86400, Math.floor(r() * r() * 3), r) : 8); }
        }
      }
      state.cards.forEach((c) => { if (c.grade != null) add(c.series, c.material, c.grade); });
      return out;
    },
    // true rarity of one card, on one scale: the chance of that exact card (character + material + holo) per card dealt
    // in its Series, from its fixed odds (Info.lookP: material x holo x character odds), x "this grade or better" once graded (Info.gradeP). Tiers on the same scale (Info.TIERS):
    // Rare 1 in 100 or rarer, Epic 1 in 400, Legendary 1 in 1,000.
    trueOdds(c) {
      const I = window.Info; if (!I?.lookP) return { p: 1, n: 1, label: '', tier: null };
      const p = I.lookP(c.material, c.holo || 'none', c.character) * I.gradeP(c.grade);
      const n = p > 0 ? 1 / p : Infinity;
      return { p, n, label: p > 0 ? '1 in ' + I.oneIn(p) : '', tier: (I.TIERS.find(([, at]) => n >= at) || [null])[0] };
    },
    // DEMO DATA: a made-up OpenSea floor for this exact type (character + material + holo, + grade when graded), in ETH.
    // Deterministic, and rarer means higher: 0.0001 ETH x N^0.75 for "1 in N", nudged +-12% per look (never per grade,
    // so a better grade of the same card always floors at least as high).
    floor(c) {
      const k = [c.character, c.material, c.holo || 'none'].join('|');
      let hs = 2166136261; for (let i = 0; i < k.length; i++) hs = Math.imul(hs ^ k.charCodeAt(i), 16777619);
      const v = 0.0001 * Math.pow(Store.trueOdds(c).n, 0.75) * (0.88 + ((hs >>> 0) % 1000) / 1000 * 0.24);
      return +v.toPrecision(2);
    },
    collectionFloor() { return Math.min(...NAMES.map((character) => Store.floor({ character, material: 'paper', holo: 'none', grade: null }))); }, // the commonest type's floor
    eth(v) { return v.toLocaleString('en-US', { maximumSignificantDigits: 2 }) + ' ETH'; },
    // OpenSea. Demo: a PLACEHOLDER collection slug. Live: per network, set once the collection really is on OpenSea
    // ({ collection: 'https://opensea.io/collection/<slug>', chain: '<opensea chain>', contract: '0x…' }); null hides the
    // OpenSea button (testnet cards aren't on OpenSea). With a chain + contract, item() links the card itself.
    OPENSEA: { collection: 'https://opensea.io/collection/omni-cards', account: 'https://opensea.io/account', chain: null, contract: null },
    OPENSEA_LIVE: { testnet: null, mainnet: null },
    openSeaItem(c) {
      const o = LIVE_NET ? Store.OPENSEA_LIVE[LIVE_NET] : Store.OPENSEA;
      if (!o) return null;
      return o.chain && o.contract && c.tokenId != null ? `https://opensea.io/item/${o.chain}/${o.contract}/${c.tokenId}` : o.collection || null;
    },
    // a card's print number: it's the k-th of that exact card (Series, character, material, holo look) ever pulled, shown
    // as "#k" (no "of N": the odds are open-ended). null for a card without one (a practice card).
    printNo(c) { const k = parseInt(c?.edition, 10); return k > 0 ? k : null; },
    // how many Paper Presses exist now (live: the Press contract's totalSupply, cached; null if it can't be read, and the
    // line that shows it hides). DEMO DATA: a fixed number.
    pressSupply() { return Promise.resolve(2071); },
    // Character suggestions: one text on chain, as plain "Label: value" lines, only the filled ones, in this order.
    // SUGGEST_MAX_BYTES mirrors FireCredits.suggestionMaxBytes (an owner setting, 1 to 1,024; set it to about 1,000).
    SUGGEST_MAX_BYTES: 1000,
    SUGGEST_FIELDS: [['character', 'Character'], ['personality', 'Personality'], ['background', 'Background']],
    // Suggestions come in two waves per Series: first its theme and art style (one form; each is its own suggestion,
    // sent together in one transaction, FireCredits.suggestMany), then, once those are announced (off chain: the picks are
    // made on chain once per Series, at its drop setup, theme, style and characters together), its
    // characters for that theme and style. The owner sets the wave and the picked theme and style here (demo:
    // ?wave=look|characters&theme=...&style=... in the URL).
    SUGGEST_WAVE: (() => {
      const q = demoQ;
      const wave = q.get('wave') === 'characters' ? 'characters' : q.get('wave') === 'look' ? 'look' : 'look';
      return { wave, theme: q.get('theme') || 'Haunted diner', style: q.get('style') || 'Old woodcut print',
        closes: Date.now() + (3 * 24 + 4) * 3600 * 1000, // when this wave stops taking suggestions (the owner sets it)
        count: +(q.get('ideas') || 142) }; // ideas in the box so far (the real site reads FireCredits.suggestionCount for the round)
    })(),
    // Suggestion results: each finished wave the owner published (ops/suggestions/publish.mjs writes
    // suggestions/results.json): the 10 drawn at random per kind, the picks, the seed anyone can re-run the draw with,
    // and what happens next. Oldest first. Demo: ?results=won | lost | none, or Demo controls.
    SUGGEST_RESULTS: [],
    results(mode) { // demo: one finished theme & art style wave for the next Series, with the demo wallet won / shortlisted / absent
      if (mode === 'none') return [];
      const next = state.series.no + 1, me = DEMO_ADDR, R = mkR(31);
      const addr = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(R() * 16)]).join('');
      const THEMES = ['Haunted diner', 'Space pirates', 'Underwater kingdom', 'Desert carnival', 'Robot garden', 'Midnight library', 'Volcano spa', 'Toy factory after dark', 'Arctic post office', 'Jungle subway'];
      const STYLES = ['Old woodcut print', 'Neon pixel art', 'Watercolor storybook', 'Claymation', 'Stained glass', '1950s comic', 'Ink and wash', 'Paper cutout', 'Chrome airbrush', 'Chalk on blackboard'];
      let id = 100;
      const list = (kind, label, titles, pick) => ({ kind, label, pool: kind === 'theme' ? 61 : 54, shortlist: titles.map((t, i) => {
        const by = mode === 'won' && kind === 'theme' && i === pick ? me : mode === 'lost' && kind === 'style' && i === 6 ? me : addr();
        return { id: id++, by, title: t, text: `${label}: ${t}`, alsoBy: i === pick ? [addr(), addr()] : i % 4 === 1 ? [addr()] : [], picked: i === pick };
      }) });
      const kinds = [list('theme', 'Theme', THEMES, 0), list('style', 'Art style', STYLES, 0)];
      const winners = kinds.map((k) => { const s = k.shortlist.find((x) => x.picked); return { kind: k.kind, id: s.id, by: s.by, title: s.title, text: s.text, tx: null }; }); // announced; picked on chain at the drop setup
      return [{ series: next, wave: 'look', round: 3, chainId: 4663, seed: '9f3c51e07a2b84d6c1e0f5a39b7d2e48', drawnAt: new Date(Date.now() - 2 * DAY).toISOString(),
        publishedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), suggestions: 142, next: 'Character round is open. Who should be on the cards?', kinds, winners }];
    },
    /** Use a set of published waves: the newest finished theme & art style wave sets the character wave's theme and style. */
    setResults(waves) {
      Store.SUGGEST_RESULTS = Array.isArray(waves) ? waves : [];
      const q = demoQ, W = Store.SUGGEST_WAVE;
      const look = Store.SUGGEST_RESULTS.filter((w) => w.wave === 'look' && w.series === state.series.no + 1).pop();
      if (look && !q.has('wave')) {
        const win = (k) => look.winners.find((x) => x.kind === k)?.title;
        if (!Store.SUGGEST_RESULTS.some((w) => w.wave === 'characters' && w.series === look.series)) { W.wave = 'characters'; W.theme = win('theme') || W.theme; W.style = win('style') || W.style; }
      }
    },
    /** This wallet's place in a wave: 'won', 'shortlisted' (drawn, not picked) or null. */
    resultFor(w, addr) {
      const a = String(addr || '').toLowerCase(); if (!a) return null;
      if (w.winners.some((x) => x.by.toLowerCase() === a)) return 'won';
      return w.kinds.some((k) => k.shortlist.some((s) => s.by.toLowerCase() === a || (s.alsoBy || []).some((b) => b.toLowerCase() === a))) ? 'shortlisted' : null;
    },
    LOOK_FIELDS: [['theme', 'Theme'], ['style', 'Art style']],
    // a theme and an art style, each its own on-chain text ("Theme: ..." / "Art style: ...")
    packLook(f) {
      return Store.LOOK_FIELDS.map(([k, label]) => [label, Store.plain(f[k]).replace(/\s+/g, ' ').trim()])
        .filter(([, v]) => v).map(([label, v]) => label + ': ' + v);
    },
    packSuggestion(f) {
      return Store.SUGGEST_FIELDS.map(([k, label]) => [label, Store.plain(f[k]).replace(/\s+/g, ' ').trim()])
        .filter(([, v]) => v).map(([label, v]) => label + ': ' + v).join('\n');
    },
    // text people typed, without bidi controls (they can make text read in a different order than it's stored)
    plain(t) { return String(t ?? '').replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ''); },
    parseSuggestion(text) { // back to { kind, character, personality, background } or { kind: 'theme'|'style', value }
      text = Store.plain(text);
      const look = String(text).match(/^\s*(theme|art style)\s*:\s?([\s\S]*)$/i);
      if (look) return { kind: look[1].toLowerCase() === 'theme' ? 'theme' : 'style', value: look[2].trim(), character: '', personality: '', background: '' };
      const out = { kind: 'character', character: '', personality: '', background: '' }, keys = Object.fromEntries(Store.SUGGEST_FIELDS.map(([k, l]) => [l.toLowerCase(), k]));
      let cur = 'character', labelled = false;
      for (const line of String(text).split('\n')) {
        const m = line.match(/^\s*(character|personality|background)\s*:\s?(.*)$/i);
        if (m) { cur = keys[m[1].toLowerCase()]; labelled = true; out[cur] = (out[cur] ? out[cur] + ' ' : '') + m[2].trim(); }
        else if (line.trim()) out[cur] = (out[cur] ? out[cur] + ' ' : '') + line.trim();
      }
      if (!labelled) out.character = String(text).trim();
      return out;
    },
    bytes(text) { return new TextEncoder().encode(text).length; },
    /** A link back to the site for a share: this wallet's showcase of these cards (?show=<address>&c=<ids>), or the
     *  site itself; ?live= is kept so a testnet share opens the testnet. On the real site it goes through /s, the
     *  share preview (api/share: the picture X, Discord and iMessage show), which sends people on to the same place. */
    shareLink(ids = []) {
      const u = Store.shareBase();
      const live = new URLSearchParams(location.search).get('live'); if (live) u.searchParams.set('live', live);
      const a = state.wallet.connected ? String(state.wallet.full || '') : '', mine = ids.filter((id) => Number.isFinite(id) && id > 0);
      if (/^0x[0-9a-fA-F]{40}$/.test(a) && mine.length) { u.searchParams.set('show', a); u.searchParams.set('c', mine.join('.')); }
      return u.href;
    },
    /** Where share links start: /s on the real site (the preview page), the page itself when run locally. */
    shareBase() {
      const u = new URL(location.href); u.search = ''; u.hash = '';
      if (!/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol === 'https:') u.pathname = '/s';
      return u;
    },
    noteBurned(c) { // a card this wallet burned counts toward its edition's and its look's burned numbers
      const ed = [c.series, c.character, c.material].join('|'), look = ed + '|' + (c.holo || 'none');
      state.burned[ed] = (state.burned[ed] || 0) + 1; state.burned[look] = (state.burned[look] || 0) + 1;
    },
  };

  // rotation: a phone turned on its side can fire 'resize' before its new size has settled (iOS), or report the turn only
  // as orientationchange / a visual-viewport resize. Watch the size for a moment after any of those and announce the
  // settled one as a 'resize' (once per real change), so every layout listener (ui, scene, viewer, sheets) re-measures.
  {
    let last = innerWidth + 'x' + innerHeight, timers = [];
    const check = () => { const now = innerWidth + 'x' + innerHeight; if (now !== last) { last = now; dispatchEvent(new Event('resize')); } };
    addEventListener('resize', () => { last = innerWidth + 'x' + innerHeight; });
    const settle = () => { timers.forEach(clearTimeout); requestAnimationFrame(check); timers = [60, 250, 500, 900].map((ms) => setTimeout(check, ms)); };
    addEventListener('orientationchange', settle);
    try { screen.orientation?.addEventListener('change', settle); } catch { /* old browsers */ }
    window.visualViewport?.addEventListener('resize', settle);
    try { matchMedia('(orientation: portrait)').addEventListener('change', settle); } catch { /* old Safari: resize still runs */ }
  }

  // toasts: short, stacked under the top bar. An open dialog sits in the browser's top layer, over everything in the
  // page, so while one is open the toasts live inside the top one (else "+10 PAPER" would show under the sheet)
  const toastHost = document.createElement('div'); toastHost.className = 'toasts'; toastHost.setAttribute('role', 'status'); toastHost.setAttribute('aria-live', 'polite');
  const dlgOrder = []; // dialogs in the order they opened (the last open one is on top)
  const topDialog = () => { for (let i = dlgOrder.length - 1; i >= 0; i--) if (dlgOrder[i].open && dlgOrder[i].isConnected) return dlgOrder[i]; return [...document.querySelectorAll('dialog[open]')].pop() || null; };
  let offNote = null; // the offline line (below): it moves with the toasts, so a sheet never hides it
  const hostToTop = () => { const home = topDialog() || document.body; if (!home) return; if (toastHost.parentNode !== home) home.append(toastHost); if (offNote && offNote.parentNode !== home) home.append(offNote); lift(); };
  // in a sheet the toasts sit at the bottom (at the top they covered its x), over its sticky action bar and the
  // offline line if either is showing
  const lift = () => {
    const home = toastHost.parentNode; let b = 0;
    // a centred sheet (tablet, desktop) ends above the screen's bottom: keep the toasts inside it
    if (home?.tagName === 'DIALOG') b = Math.max(0, innerHeight - home.getBoundingClientRect().bottom + 8);
    if (home?.tagName === 'DIALOG') for (const f of home.querySelectorAll('.foot, .bw-foot, .filter-act, .dacts')) { const r = f.getBoundingClientRect(); if (r.height && r.bottom > innerHeight - 40) b = Math.max(b, innerHeight - r.top); }
    // nor over the sheet's main button when it sits near the bottom of the screen (Buy's Approve / Buy, Open)
    if (home?.tagName === 'DIALOG') for (const f of home.querySelectorAll('.btn.primary, .btn.gold')) { const r = f.getBoundingClientRect(); if (r.height && r.top < innerHeight && r.bottom > innerHeight - 150) b = Math.max(b, innerHeight - r.top); }
    if (offNote) { offNote.style.bottom = b ? `${Math.round(b + 8)}px` : ''; if (!offNote.hidden && offNote.parentNode === home) b = Math.max(b, innerHeight - offNote.getBoundingClientRect().top); }
    toastHost.style.bottom = b ? `${Math.round(b + 8)}px` : '';
  };
  const noteDialog = (d) => { const i = dlgOrder.indexOf(d); if (i >= 0) dlgOrder.splice(i, 1); if (d.open) dlgOrder.push(d); if (toastHost.childElementCount || d.open || (offNote && !offNote.hidden)) hostToTop(); };
  document.addEventListener('DOMContentLoaded', () => document.body.append(toastHost));
  // any dialog (the sheets, the card viewer): note its order when it opens; closing, the toasts move down with the page
  document.addEventListener('close', (e) => { if (e.target?.tagName === 'DIALOG') noteDialog(e.target); }, true);
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...a) { const r = showModal.apply(this, a); noteDialog(this); return r; };
  function toast(text, kind = '') {
    hostToTop();
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; toastHost.append(t); lift();
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  // titles on touch screens (no hover): a tap on something with a title (not a control: those do their own thing) shows
  // the title in a small tip beside it
  let tipEl = null;
  document.addEventListener('click', (e) => {
    tipEl?.remove(); tipEl = null;
    if (!matchMedia('(hover: none)').matches) return;
    const el = e.target.closest?.('[title]'); if (!el || el.closest('button, a, select, input, label, summary') || !el.title) return;
    const r = el.getBoundingClientRect(), t = document.createElement('div'); t.className = 'tip'; t.setAttribute('role', 'status'); t.textContent = el.title;
    (el.closest('dialog') || document.body).append(t);
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    t.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
    tipEl = t; setTimeout(() => { if (tipEl === t) { t.remove(); tipEl = null; } }, 3200);
  });

  // sheets: native <dialog>, focus returns to the opener, Escape and the backdrop close it. A sheet opened over another
  // gets "‹ Back" (to the one under it) beside its ×.
  // Phone Back closes the top sheet, never the page: while any sheet is open there's one history entry of ours on top
  // (state.sheet); Back pops it, the top sheet closes, and if sheets are still open the entry goes back. A sheet closed
  // from the page takes the entry away again once nothing is open (the full-screen viewer, zoom.js, stacks its own on it).
  const openSheets = () => [...document.querySelectorAll('dialog.sheet[open]')];
  const guarded = () => !!history.state?.sheet;
  let expectPop = 0;
  const guard = () => { if (!guarded()) try { history.pushState({ ...(history.state || {}), sheet: 1 }, ''); } catch { /* sandboxed: no history */ } };
  addEventListener('popstate', () => {
    if (expectPop) { expectPop--; if (openSheets().length) guard(); return; } // our own step back (one at a time)
    if (window.Zoom?.isOpen || guarded()) return; // the viewer's Back, or still on our entry: the sheets stay
    const top = openSheets().pop(); if (!top) return;
    top.close();
    if (openSheets().length) guard();
  });
  // CSS pauses what's under a sheet; the scene stops its frames until the last sheet closes ('sheets-change')
  const covered = () => { const on = openSheets().length > 0; document.body?.classList.toggle('covered', on); dispatchEvent(new CustomEvent('sheets-change', { detail: { covering: on } })); };
  // phones: a sheet comes up from the bottom (ui.css), and a drag down on its header puts it away (transform only)
  const phoneSheets = matchMedia('(max-width: 600px)');
  function swipeDown(d) {
    const head = d.querySelector('.sheet-head');
    head.addEventListener('pointerdown', (e) => {
      if (!phoneSheets.matches || e.pointerType === 'mouse' || e.button > 0 || e.target.closest('button, a, input')) return;
      const y0 = e.clientY, t0 = performance.now(); let dy = 0, raf = 0;
      const paint = () => { raf = 0; d.style.transform = dy ? `translateY(${dy}px)` : ''; };
      const move = (ev) => { if (ev.pointerId !== e.pointerId) return; dy = Math.max(0, ev.clientY - y0); if (!raf) raf = requestAnimationFrame(paint); };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); cancelAnimationFrame(raf);
        const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
        const done = () => { d.style.transition = ''; d.style.transform = ''; };
        if (ev.type === 'pointerup' && (dy > 110 || (fast && dy > 36))) {
          d.style.transition = 'transform .16s ease-in'; d.style.transform = 'translateY(100%)';
          setTimeout(() => { d.close(); done(); }, 160);
        } else { d.style.transition = 'transform .18s ease-out'; d.style.transform = ''; setTimeout(done, 180); }
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }
  const Sheet = {
    open(id, { title, body, wide = false, onClose } = {}) {
      let d = document.getElementById('sheet-' + id);
      if (!d) {
        d = document.createElement('dialog'); d.id = 'sheet-' + id; d.className = 'sheet' + (wide ? ' wide' : '');
        d.innerHTML = `<div class="sheet-head"><button class="back" type="button" hidden>‹ <span>Back</span></button><h2 id="sheet-${id}-t"></h2><button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-body"></div>`;
        d.setAttribute('aria-labelledby', `sheet-${id}-t`);
        d.querySelector('.x').onclick = () => d.close();
        d.querySelector('.back').onclick = () => d.close();
        swipeDown(d);
        d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
        d.addEventListener('close', () => {
          covered(); d._opener?.focus?.(); d._onClose?.();
          // nothing open any more (and nothing opened in the same turn): take our history entry away
          setTimeout(() => { if (!expectPop && !openSheets().length && guarded() && !window.Zoom?.isOpen) { expectPop++; history.back(); } }, 0); // never two steps back (two sheets closed at once)
        });
        document.body.append(d);
      }
      d._opener = document.activeElement; d._onClose = onClose;
      d.querySelector('h2').textContent = title || '';
      const b = d.querySelector('.sheet-body'); if (typeof body === 'string') b.innerHTML = body; else if (body) { b.replaceChildren(body); }
      if (!d.open) {
        const under = openSheets().pop(), back = d.querySelector('.back');
        back.hidden = !under; d.classList.toggle('stacked', !!under);
        if (under) { const t = under.querySelector('.sheet-head h2')?.textContent || 'Back'; back.querySelector('span').textContent = t; back.setAttribute('aria-label', `Back to ${t}`); }
        d.showModal(); guard(); covered();
        // the sheet's title takes the focus, not its × (no ring on the close button the moment it opens); Tab goes on from it
        const t = d.querySelector('.sheet-head h2'); t.tabIndex = -1; t.focus({ preventScroll: true });
      }
      return d;
    },
    close(id) { document.getElementById('sheet-' + id)?.close(); },
    // true while a modal sheet covers the scene (the scene stops drawing under it)
    get covering() { return openSheets().length > 0; },
  };

  // results: ?results=won|lost|none previews the demo states; otherwise the published file (empty until the owner
  // publishes a wave)
  {
    const mode = demoQ.get('results'); // live: never; the published file only
    if (mode) {
      Store.setResults(Store.results(mode === '1' ? 'lost' : mode));
      if (mode === 'won') { state.suggestions.unshift({ text: 'Theme: Haunted diner', at: 'Series ' + state.series.no, picked: true }); }
      if (mode === 'lost') state.suggestions.unshift({ text: 'Art style: Ink and wash', at: 'Series ' + state.series.no, picked: false });
    } else fetch('suggestions/results.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((f) => { if (f?.waves?.length) Store.update(() => Store.setResults(f.waves)); }).catch(() => {});
  }
  Store.demoStage(['open', 'waiting', 'after', 'closed'].includes(demoQ.get('stage')) ? demoQ.get('stage') : 'holders'); // the demo's sale (live.js replaces it)
  // IPFS pictures: the site's own /ipfs/ (vercel.json: Filebase, where the images are pinned, cached on Vercel's CDN),
  // then Filebase direct and public gateways; an <img> that fails on one tries the next (ipfs.io refuses some connections)
  Store.IPFS = [location.origin + '/ipfs/', 'https://ipfs.filebase.io/ipfs/', 'https://dweb.link/ipfs/', 'https://ipfs.io/ipfs/'];
  Store.ipfs = (u) => (String(u || '').startsWith('ipfs://') ? Store.IPFS[0] + String(u).slice(7) : String(u || ''));
  // each Series' own pack art (the sealed pack's wrapper). Live: FirePacks' image for that Series (<packImageBase>fire<N>.webp,
  // live.js sets Store.packBase); the demo: its two collections' packs. A pack art not loaded yet (or missing) shows the
  // generic Omni pack, so a pack never shows as a broken image; once it loads the page redraws with it.
  const PACK_DEF = '../build3/pack.webp', DEMO_PACKS = { 6: 'ui/packs/fire6.webp', 7: 'ui/packs/fire7.webp' }, packSeen = {};
  Store.packImg = (no) => {
    const u = LIVE_NET ? (Store.packBase && no ? Store.ipfs(`${Store.packBase}fire${no}.webp`) : '') : DEMO_PACKS[no] || '';
    if (!u) return PACK_DEF;
    if (packSeen[u] === 'ok') return u;
    if (!packSeen[u]) {
      packSeen[u] = 'loading'; const im = new Image();
      im.onload = () => { packSeen[u] = 'ok'; Store.update?.(() => {}); };
      im.onerror = () => { packSeen[u] = 'bad'; };
      im.src = u;
    }
    return PACK_DEF;
  };
  // a small pack for small places (the Buy bar's 27 px picture): the demo's own thumbnails; live, the Series' pack art
  Store.packThumb = (no) => (!LIVE_NET && DEMO_PACKS[no] ? DEMO_PACKS[no].replace('.webp', '-mini.webp') : Store.packImg(no));
  // ready before the first rip, without holding up the page's first paint
  if (!LIVE_NET) addEventListener('load', () => (window.requestIdleCallback || setTimeout)(() => Object.keys(DEMO_PACKS).forEach((n) => Store.packImg(+n)), { timeout: 3000 }));
  Store.nextGateway = (src) => { const i = Store.IPFS.findIndex((g) => String(src).startsWith(g)); return i >= 0 && i < Store.IPFS.length - 1 ? Store.IPFS[i + 1] + src.slice(Store.IPFS[i].length) : null; };
  // a picture that won't load (offline, a gateway down): the next IPFS gateway, then (a card) the card back, never a
  // broken-image box. Demo and live alike.
  addEventListener('error', (e) => {
    const t = e.target; if (t?.tagName !== 'IMG') return;
    const next = Store.nextGateway(t.src); if (next) { t.src = next; return; }
    if (t.classList?.contains('cframe') && !t.src.endsWith('ui/card-back.webp')) t.src = 'ui/card-back.webp';
  }, true);
  // offline: one short line at the bottom (over the Buy bar, or in the open sheet, like the toasts) until the
  // connection is back
  {
    const note = offNote = document.createElement('p'); note.className = 'offline-note'; note.setAttribute('role', 'status'); note.hidden = true;
    note.textContent = 'You\'re offline. Some things may not load.';
    const paint = () => { note.hidden = navigator.onLine !== false; };
    addEventListener('online', () => { paint(); toast('Back online', 'good'); }); addEventListener('offline', () => { paint(); hostToTop(); });
    const put = () => { (topDialog() || document.body).append(note); paint(); };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put, { once: true });
  }
  // rows of chips that scroll sideways (My cards' quick filters, Info's sections, the Series tabs): the edge that has more
  // past it fades out, so the row reads as "there's more this way"
  {
    const SEL = '.qpills, .inf-index, .bd-tabs, .fd-series, .hrow';
    const upd = (el) => { const max = el.scrollWidth - el.clientWidth, l = max > 2 && el.scrollLeft > 2, r = max > 2 && el.scrollLeft < max - 2;
      if (el.classList.contains('fade-l') !== l) el.classList.toggle('fade-l', l); if (el.classList.contains('fade-r') !== r) el.classList.toggle('fade-r', r); };
    addEventListener('scroll', (e) => { const t = e.target; if (t?.matches?.(SEL)) upd(t); }, true);
    let q = 0; const scan = () => { q = 0; document.querySelectorAll(SEL).forEach(upd); }, soon = () => { if (!q) q = requestAnimationFrame(scan); };
    const start = () => { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true }); addEventListener('resize', soon); soon(); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
  window.Store = Store; window.Sheet = Sheet; window.toast = toast;
})();
