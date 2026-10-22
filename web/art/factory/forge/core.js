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
  // demo: only the Bowling Ball has Gold and Full Art art so far, so every Gold or Full Art pulled is a Bowling Ball
  const SPECIAL_CAST = 'Bowling Ball';
  // the demo cast: real card art, rendered by the Card Studio's own card builder into cards/<id>/<material>-<holo>-<grade|u>.webp
  const CHARS = { 'Bowling Ball': { id: 'bowling', category: 'Sports' }, Jellyfish: { id: 'jellyfish', category: 'Animal' }, Cactus: { id: 'cactus', category: 'Plant' } };
  const NAMES = Object.keys(CHARS);
  const DAY = 86400000;
  const DEMO_ADDR = '0x7a3f2b9c41d0e5a6b8f9c0d1e2f3a4b5c6d7c91e'; // the demo wallet (its short form is shown)
  // demo prices: the pack, and the coins it can be paid in (cases and grades are priced in dollars too)
  const PRICES = { PACK_USD: 2.5, PAPER_USD: 0.08, ETH_USD: 2500, PLANK_USD: 0.0000021, CASE_USD: 0.05, GRADE_USD: 1, PACK_PAPER: 1, PRESS_PAPER: 1, SUGGEST_PAPER: 1 }; // this Series' settings (per drop)
  // demo collection: cards from Series 6 (already closed; the card images print "Forged · Series 6"), with a spread of materials, holos and grades
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
      holo: material === 'paper' && i === 5 ? 'full' : holo, edition: `${1 + Math.floor(R() * 40)} of ${41 + Math.floor(R() * 20)}`,
      grade: g < 0.55 ? null : Math.max(1, Math.min(10, Math.round(5.5 + (R() - 0.5) * 6))), pending: false,
      // wear (docs/grading.md): dealt this long ago, cased or not (a case freezes the clock), moves between wallets
      dealt: Date.now() - Math.round((2 + R() * 200) * DAY), cased: false, frozenAge: 0, moves: Math.floor(R() * R() * 4),
    });
  }
  cards[5].material = 'paper'; cards[5].holo = 'full'; // a full-holo Paper, the rare one to show off
  // raw holo cards to show off the holo (tilt them on the site): one of every look, plus a Gold and a Full Art
  [['gold', 'full', 'Bowling Ball'], ['fullart', 'full', 'Bowling Ball'], ['fire', 'full'], ['charcoal', 'frame'], ['wood', 'picture'], ['paper', 'full']]
    .forEach(([material, holo, who], k) => Object.assign(cards[k], { material, holo, grade: null, cased: false, frozenAge: 0, dealt: Date.now() - (k + 1) * 3600e3, serial: 700 - k, ...(who ? { character: who } : {}) }));
  cards.forEach((c, i) => { if (i >= 6 && c.grade == null && i % 3 === 1) { c.cased = true; c.frozenAge = Math.round((0.2 + R() * 30) * DAY); } }); // some already cased

  const state = {
    demo: true,
    // this Series' settings (per drop; the live site reads them from the contracts): the base total of packs, the cast
    // size (characters) its recipe was built with, and its groups (docs/drop-groups.md: who can buy, how many, at what
    // price, when; Store.demoStage fills them in). phase: 3 on sale (or about to be), 4 sold out / closed.
    series: { no: 7, total: 167, cast: 10, phase: 3, closed: false, groups: [], creditGroup: 2, creditPacksLeft: 16, left: null, closing: false },
    wallet: {
      connected: false, address: '0x7a3f…c91e', full: DEMO_ADDR, name: 'Demo wallet', isPressHolder: true, inSnapshot: true, isContract: false,
      balances: { ETH: 0.42, PLANK: 1250000000, PAPER: 24, USDG: 50 },
      credits: 1, burnCount: 12, boughtIn: {}, pending: [],
      // ERC-20 allowances this wallet has given FireSale (packs, Press packs, free packs and suggestions all take PAPER)
      allowance: { PAPER: 0, PLANK: 0, USDG: 0 },
    },
    // Series teases: one character in every card type. Add one for any Series at any time: an entry here plus its six
    // cards in ui/announce/<id>-<type>.webp (paper, wood, fire, charcoal, gold, fullart), rendered for that Series (they
    // print "Forged · Series N"). While a Series is on sale its tease shows what's in its packs; between Series the next one's sits on the main page.
    teases: { 7: { id: 'bowling-s7', name: 'Bowling Ball' }, 8: { id: 'bowling-s8', name: 'Bowling Ball' } },
    sealed: { 7: 0, 6: 3 }, // sealed packs owned, by Series (6 is closed: it can be opened)
    cards,
    // suggestions: { text, at, picked }. text is exactly what goes on chain (FireCredits.suggest): Store.packSuggestion's lines
    suggestions: [
      { text: 'Character: A lighthouse keeper\nPersonality: Quiet, stubborn, never misses a ship.', at: 'Series 6', picked: true },
      { text: 'Character: Grandma’s cast-iron pan\nBackground: Four generations of Sunday breakfasts.', at: 'Series 7', picked: false },
    ],
    activity: [],
    burned: {}, // cards this wallet burned, by edition and by look (Store.editionInfo)
  };
  const listeners = new Set();
  const Store = {
    state, MATS, MAT_LABEL, ALWAYS_HOLO, SPECIAL_CAST, CHARS, NAMES, DAY, PRICES,
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
      const lim = [g.perTx || 50, g.left ?? Infinity, g.perWallet ? g.perWallet - bought : Infinity, g.gate === 'nft' ? g.perNft - bought : Infinity];
      const max = Math.max(0, Math.min(...lim));
      return max ? { ok: true, max } : { ok: false, why: g.left === 0 ? 'Sold out' : `Limit: ${g.perWallet} per wallet` };
    },
    // DEMO: the Standard preset's groups (docs/drop-groups.md) at a stage of the sale: 'holders' (Press and PLANK
    // holders first), 'open' (Everyone), 'waiting' (Everyone sold out, more may come from the Press group), 'after'
    // (after sell-out: the rising price), 'closed'. ?stage=... in the URL, or Demo controls.
    demoStage(stage) {
      const now = Math.floor(Date.now() / 1000), H = 3600, s = state.series;
      const mk = (o) => {
        const g = { perWallet: 0, perNft: 0, perTx: 50, unlimited: false, taxBps: 0, idle: 0, sold: 0, waiting: false, moreFrom: null, moreAt: 0, afterGroup: null, ...o };
        // the next pack's price and the few after it (live: read from the contract), from the sold count
        return Object.defineProperties(g, { next: { enumerable: true, get: () => Store.packPrice(g, 1) }, after: { enumerable: true, get: () => (g.taxBps ? [2, 3, 4].map((k) => Store.packPrice(g, k)) : []) } });
      };
      const press = mk({ index: 0, name: 'Paper Press holders', who: 'Paper Press holders only', gate: 'nft', isPress: true, priceUsd: 0, paper: Store.PRICES.PRESS_PAPER, coins: [], perNft: 1, capacity: 50 });
      const plank = mk({ index: 1, name: 'PLANK holders', who: 'PLANK holders only', gate: 'snapshot', priceUsd: PRICES.PACK_USD, paper: PRICES.PACK_PAPER, coins: ['PLANK'], perWallet: 5, capacity: 40 });
      const all = mk({ index: 2, name: 'Everyone', who: 'Everyone', gate: 'open', priceUsd: PRICES.PACK_USD, paper: PRICES.PACK_PAPER, coins: ['PLANK', 'ETH', 'USDG'], perWallet: 5, capacity: 77, afterGroup: 1 });
      const extra = mk({ index: 3, name: 'Extra packs', who: 'Everyone', gate: 'open', priceUsd: PRICES.PACK_USD, paper: PRICES.PACK_PAPER, coins: ['ETH'], perTx: 1, unlimited: true, taxBps: 400, idle: 900, capacity: null, left: null, afterGroup: 2 });
      const set = (g, o) => Object.assign(g, o, { left: g.unlimited ? (o.state === 'ended' ? 0 : null) : (o.capacity ?? g.capacity) - (o.sold ?? 0) });
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

    log(text) { state.activity.unshift({ text, t: Date.now() }); state.activity.length = Math.min(state.activity.length, 30); },
    cardStrip(c) { // the finished card images for a look (character, material, holo): one strip, raw, cased, then slabbed PDA 1-10
      // demo: only the Bowling Ball has Gold and Full Art art, so those always show it
      const id = (c.material === 'gold' || c.material === 'fullart' ? CHARS[SPECIAL_CAST] : CHARS[c.character] || CHARS[NAMES[0]]).id;
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
      const id = (always ? CHARS[SPECIAL_CAST] : CHARS[c.character] || CHARS[NAMES[0]]).id;
      const holoWord = { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' }[look];
      // print: just this state's layer (720 x 1008, size_images.py), not the 8640 px strip of all 12
      return { look, holder: Store.holder(c), state: Store.stateIdx(c), plain: `cards/${id}/${c.material}-plain.webp`, print: `cards/${id}/p/${c.material}-print-${Store.stateIdx(c)}.webp`,
        label: { name: always ? SPECIAL_CAST : c.character, sub: [`Series ${c.series}`, MAT_LABEL[c.material], holoWord].filter(Boolean).join(' · '), grade: c.grade } };
    },
    // which card in the strip: 0 raw, 1 cased, 2-11 slabbed PDA 1-10
    stateIdx(c) { return c.grade != null ? c.grade + 1 : c.cased ? 1 : 0; },
    STATES: 12,
    cardPos() { return '50% 50%'; }, // cardImg is one state now (it was that state's object-position in the strip)
    holder(c) { return c.grade != null ? 'slab' : c.cased ? 'case' : 'raw'; },
    // wear time so far: frozen once cased, sent for grading or slabbed; otherwise still running (live: `dealt` is when the
    // wear clock started, read back from the chain's age, so a cancelled grading's frozen gap isn't counted)
    ageMs(c) { return c.cased || c.pending || c.grade != null ? c.frozenAge : Date.now() - c.dealt; },
    // what casing or grading this card costs, in dollars: grading is priced by card type (FirePsa.gradeUsdOf; live.js
    // puts it on each card as c.gradeUsd), else the default price
    caseUsd(_c) { return PRICES.CASE_USD; }, // one case price for every card
    gradeUsd(c) { return c?.gradeUsd ?? PRICES.GRADE_USD; },
    // cases and grades can be paid in PAPER: burned directly, at the PAPER feed's price less the owner's discount
    // (FirePsa.paperDiscountBps, 0-2000; DEMO: a made-up 10%). PSA_PAPER_OFF: why it can't be used right now (live: the
    // PAPER price can't be read, FeedUnavailable), else null.
    PSA_PAPER: true, PSA_PAPER_DISCOUNT_BPS: LIVE_NET ? 0 : 1000, PSA_PAPER_OFF: null,
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
    // true rarity of one card, on one scale: how rare that exact card (character + material + holo) is in its Series
    // (Info.lookP), x "this grade or better" once graded (Info.gradeP). Tiers on the same scale (Info.TIERS):
    // Rare 1 in 100 or rarer, Epic 1 in 400, Legendary 1 in 1,000.
    trueOdds(c) {
      const I = window.Info; if (!I?.lookP) return { p: 1, n: 1, label: '', tier: null };
      const p = I.lookP(c.material, c.holo || 'none') * I.gradeP(c.grade);
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
    // OpenSea: the collection slug is a PLACEHOLDER until the contract is deployed. With a contract + token ids, item() links the card itself.
    OPENSEA: { collection: 'https://opensea.io/collection/omni-cards', account: 'https://opensea.io/account', chain: null, contract: null },
    openSeaItem(c) { const o = Store.OPENSEA; return o.contract && c.tokenId != null ? `https://opensea.io/item/${o.chain}/${o.contract}/${c.tokenId}` : o.collection; },
    // DEMO DATA: the edition ("12 of 43": this character in this material), how many of those are burned, and the same
    // for its exact look (+ holo). The live site counts these from the indexer; here they're deterministic per card,
    // plus whatever this wallet burns (state.burned).
    editionInfo(c) {
      const [k, of] = String(c.edition).split(' of ').map((x) => parseInt(x, 10)), n = of || k || 1;
      const ed = [c.series, c.character, c.material].join('|'), look = ed + '|' + (c.holo || 'none');
      const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; };
      const always = c.material === 'gold' || c.material === 'fullart';
      const lookN = always ? n : Math.max(1, Math.min(n, Math.round(n * (window.Info?.holoP(c.material, c.holo || 'none') ?? 1))));
      const burned = Math.min(n - 1, hash(ed) % Math.max(1, Math.floor(n / 6))) + (state.burned[ed] || 0);
      const lookBurned = Math.min(lookN - 1, burned, hash(look) % Math.max(1, Math.floor(lookN / 4) + 1)) + (state.burned[look] || 0);
      return { k: k || 1, n, burned, lookK: 1 + (hash(look + c.serial) % lookN), lookN, lookBurned };
    },
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
    noteBurned(c) { // a card this wallet burned counts toward its edition's and its look's burned numbers
      const ed = [c.series, c.character, c.material].join('|'), look = ed + '|' + (c.holo || 'none');
      state.burned[ed] = (state.burned[ed] || 0) + 1; state.burned[look] = (state.burned[look] || 0) + 1;
    },
  };

  // toasts: short, stacked under the top bar
  const toastHost = document.createElement('div'); toastHost.className = 'toasts'; toastHost.setAttribute('role', 'status'); toastHost.setAttribute('aria-live', 'polite');
  document.addEventListener('DOMContentLoaded', () => document.body.append(toastHost));
  function toast(text, kind = '') {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; toastHost.append(t);
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
  const covered = () => document.body?.classList.toggle('covered', openSheets().length > 0); // CSS pauses what's under a sheet
  const Sheet = {
    open(id, { title, body, wide = false, onClose } = {}) {
      let d = document.getElementById('sheet-' + id);
      if (!d) {
        d = document.createElement('dialog'); d.id = 'sheet-' + id; d.className = 'sheet' + (wide ? ' wide' : '');
        d.innerHTML = `<div class="sheet-head"><button class="back" type="button" hidden>‹ <span>Back</span></button><h2 id="sheet-${id}-t"></h2><button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-body"></div>`;
        d.setAttribute('aria-labelledby', `sheet-${id}-t`);
        d.querySelector('.x').onclick = () => d.close();
        d.querySelector('.back').onclick = () => d.close();
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
  window.Store = Store; window.Sheet = Sheet; window.toast = toast;
})();
