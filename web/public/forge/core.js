/* Omni Forge (demo mode): shared state (demo data, no chain), events, toasts and the sheet (dialog) helper.
   Every other module reads and writes through window.Store and opens screens with window.Sheet. */
(() => {
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
  // demo prices: the pack, and the coins it can be paid in (cases and grades are priced in dollars too)
  const PRICES = { PACK_USD: 2.5, PAPER_USD: 0.08, ETH_USD: 2500, PLANK_USD: 0.0000021, CASE_USD: 0.05, GRADE_USD: 1 };
  // demo collection: cards from Series 6 (already closed; the card images print "Forged · Series 6"), with a spread of materials, holos and grades
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pickMat = () => { const u = R(); return u < 0.5 ? 'paper' : u < 0.8 ? 'wood' : u < 0.95 ? 'fire' : u < 0.995 ? 'charcoal' : 'diamond'; };
  const cards = [];
  for (let i = 0; i < 46; i++) {
    const material = i === 3 ? 'diamond' : i === 9 ? 'charcoal' : pickMat();
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
  cards.forEach((c, i) => { if (c.grade == null && i % 3 === 1) { c.cased = true; c.frozenAge = Math.round((0.2 + R() * 30) * DAY); } }); // some already cased

  const state = {
    demo: true,
    series: { no: 7, total: 167, starters: 50, startersClaimed: 23, sold: 12, plankOnly: 50, plankSold: 12, phase: 0, closed: false },
    // phase: 0 holders first + PLANK only, 1 holders first (any currency), 2 open to all (max 5), 3 no limit, 4 sold out
    wallet: {
      connected: false, address: '0x7a3f…c91e', name: 'Demo wallet', isPressHolder: true, inSnapshot: true, isContract: false,
      balances: { ETH: 0.42, PLANK: 1250000000, PAPER: 24, USDG: 50 },
      credits: 1, burnCount: 12, starterClaimed: false, bought: 0, pending: [],
    },
    // Series teases: one character in every card type. Add one for any Series at any time: an entry here plus its six
    // cards in ui/announce/<id>-<type>.webp (paper, wood, fire, charcoal, gold, fullart). While a Series is on sale its
    // tease shows what's in its packs; between Series the next one's tease sits on the main page.
    teases: { 7: { id: 'bowling', name: 'Bowling Ball' }, 8: { id: 'bowling', name: 'Bowling Ball' } },
    sealed: { 7: 0, 6: 3 }, // sealed packs owned, by Series (6 is closed: it can be opened)
    cards,
    suggestions: [{ text: 'A lighthouse keeper', at: 'Series 6', picked: true }, { text: 'Grandma’s cast-iron pan', at: 'Series 7', picked: false }],
    activity: [],
  };
  const listeners = new Set();
  const Store = {
    state, MATS, MAT_LABEL, ALWAYS_HOLO, SPECIAL_CAST, CHARS, NAMES, DAY, PRICES,
    get(path) { return path.split('.').reduce((o, k) => o?.[k], state); },
    update(fn) { fn(state); listeners.forEach((l) => l(state)); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // the tease to show now: the Series on sale, or (between Series) the next one; null if none has been added
    tease() {
      const s = state.series, no = s.phase >= 4 ? s.no + 1 : s.no, t = state.teases[no];
      // the line under it: on sale, or still to come
      return t ? { no, live: s.phase < 4, line: s.phase < 4 ? 'Hot off the press' : 'Heating up', ...t } : null;
    },
    left() { const s = state.series; return s.phase >= 4 ? 0 : Math.max(0, s.total - s.startersClaimed - s.sold); },
    paidLeft() { const s = state.series; return Math.max(0, s.total - s.starters - s.sold + (s.phase >= 2 ? s.starters - s.startersClaimed : 0)); },
    log(text) { state.activity.unshift({ text, t: Date.now() }); state.activity.length = Math.min(state.activity.length, 30); },
    cardImg(c) { // the finished card images for a look (character, material, holo): one strip, raw, cased, then slabbed PDA 1-10
      const id = (CHARS[c.character] || CHARS[NAMES[0]]).id;
      const holo = (c.material === 'gold' || c.material === 'fullart') ? 'full' : c.material === 'diamond' && (c.holo || 'none') === 'none' ? 'full' : c.holo || 'none';
      return `cards/${id}/${c.material}-${holo}.webp`;
    },
    // which card in the strip: 0 raw, 1 cased, 2-11 slabbed PDA 1-10
    stateIdx(c) { return c.grade != null ? c.grade + 1 : c.cased ? 1 : 0; },
    STATES: 12,
    cardPos(c) { return `${(Store.stateIdx(c) * 100 / 11).toFixed(4)}% 0`; }, // object-position of that card in the strip
    holder(c) { return c.grade != null ? 'slab' : c.cased ? 'case' : 'raw'; },
    // time uncased so far: frozen once cased (or slabbed); otherwise still running
    ageMs(c) { return c.cased || c.grade != null ? c.frozenAge : Date.now() - c.dealt; },
    // true rarity of one card: P(material) x P(its holo for that material) x P(its PDA grade) when graded (ungraded: no grade factor).
    // Same maths as the Info tables (Info.pullP / Info.gradeP). Tier by odds: Rare rarer than 1 in 50, Epic 1 in 300, Legendary 1 in 1,500.
    trueOdds(c) {
      const I = window.Info; if (!I?.pullP) return { p: 1, n: 1, label: '', tier: null };
      const p = I.pullP(c.material, c.holo || 'none') * (c.grade == null ? 1 : I.gradeP(c.grade));
      const n = p > 0 ? 1 / p : Infinity;
      // a Full Art is one of one for its character: always Legendary
      return { p, n, label: p > 0 ? '1 in ' + I.oneIn(p) : '', tier: c.material === 'fullart' || n > 1500 ? 'legendary' : n > 300 ? 'epic' : n > 50 ? 'rare' : null };
    },
    // DEMO DATA: a made-up OpenSea floor for this exact type (character + material + holo, + grade when graded), in ETH.
    // Deterministic, and rarer means higher: 0.0001 ETH x N^0.75 for "1 in N", nudged +-12% per type so they don't look formulaic.
    floor(c) {
      const k = [c.character, c.material, c.holo || 'none', c.grade ?? 'u'].join('|');
      let hs = 2166136261; for (let i = 0; i < k.length; i++) hs = Math.imul(hs ^ k.charCodeAt(i), 16777619);
      const v = 0.0001 * Math.pow(Store.trueOdds(c).n, 0.75) * (0.88 + ((hs >>> 0) % 1000) / 1000 * 0.24);
      return +v.toPrecision(2);
    },
    collectionFloor() { return Math.min(...NAMES.map((character) => Store.floor({ character, material: 'paper', holo: 'none', grade: null }))); }, // the commonest type's floor
    eth(v) { return v.toLocaleString('en-US', { maximumSignificantDigits: 2 }) + ' ETH'; },
    // OpenSea: the collection slug is a PLACEHOLDER until the contract is deployed. With a contract + token ids, item() links the card itself.
    OPENSEA: { collection: 'https://opensea.io/collection/omni-cards', account: 'https://opensea.io/account', chain: null, contract: null },
    openSeaItem(c) { const o = Store.OPENSEA; return o.contract && c.tokenId != null ? `https://opensea.io/item/${o.chain}/${o.contract}/${c.tokenId}` : o.collection; },
  };

  // toasts: short, stacked under the top bar
  const toastHost = document.createElement('div'); toastHost.className = 'toasts'; toastHost.setAttribute('role', 'status'); toastHost.setAttribute('aria-live', 'polite');
  document.addEventListener('DOMContentLoaded', () => document.body.append(toastHost));
  function toast(text, kind = '') {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; toastHost.append(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  // sheets: native <dialog>, focus returns to the opener, Escape and the backdrop close it
  const Sheet = {
    open(id, { title, body, wide = false, onClose } = {}) {
      let d = document.getElementById('sheet-' + id);
      if (!d) {
        d = document.createElement('dialog'); d.id = 'sheet-' + id; d.className = 'sheet' + (wide ? ' wide' : '');
        d.innerHTML = `<div class="sheet-head"><h2></h2><button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-body"></div>`;
        d.querySelector('.x').onclick = () => d.close();
        d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
        d.addEventListener('close', () => { d._opener?.focus?.(); d._onClose?.(); });
        document.body.append(d);
      }
      d._opener = document.activeElement; d._onClose = onClose;
      d.querySelector('h2').textContent = title || '';
      const b = d.querySelector('.sheet-body'); if (typeof body === 'string') b.innerHTML = body; else if (body) { b.replaceChildren(body); }
      if (!d.open) d.showModal();
      return d;
    },
    close(id) { document.getElementById('sheet-' + id)?.close(); },
  };

  window.Store = Store; window.Sheet = Sheet; window.toast = toast;
})();
