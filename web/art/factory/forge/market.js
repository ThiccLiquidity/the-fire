/* Omni Cardworks (fun layer): the market. Cards and sealed packs for sale at a fixed price in ETH (FireMarket: no
   owner, no fees; a listed card stays in its seller's wallet until someone buys it).
     Market (Menu › Market, My cards › Market): Cards / Packs / Mine. Tap a card to see it big and buy it; packs are
     bought by the handful. Mine: your listings (change the price, take them off sale, or everything at once), and
     "Sell packs".
     Sell (a card's detail › Sell): set a price, list it; once listed the detail says "For sale" and opens this again.
   Live: the chain (Live.chain: market.ts); only listings that can be bought now are shown. Demo: made-up sellers, the
   demo wallet's ETH, and a buyer turns up for what you list. Buy screens show prices only (where the money goes is for
   Info). */
(() => {
  const { h, put } = Fun;
  const LIVE = window.Live?.on;
  const S = Store.state;
  const L = () => window.Live?.chain;
  const ROYALTY_BPS = 500; // the collection's resale royalty (ERC-2981, set at deploy); for "You get about"
  const trim = (x) => { const n = +x; if (!(n > 0)) return '0'; return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : n.toLocaleString('en-US', { maximumSignificantDigits: 4 }); };
  const ethTxt = (x) => `${trim(x)} ETH`;
  const usd = (x) => (Store.PRICES.ETH_USD > 0 ? `≈ $${(+x * Store.PRICES.ETH_USD).toLocaleString('en-US', { maximumFractionDigits: +x * Store.PRICES.ETH_USD < 10 ? 2 : 0 })}` : '');
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const kind = (c) => [Store.MAT_LABEL[c.material], c.holo && c.holo !== 'none' && !Store.ALWAYS_HOLO?.[c.material] ? { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' }[c.holo] : '', c.grade != null ? 'PDA ' + c.grade : c.cased ? 'Cased' : ''].filter(Boolean).join(' · ');
  const face = (c, lazy = true) => (window.Stations?.cardFace ? Stations.cardFace(c, lazy) : h('div', { class: `cface m-${c.material}` }, h('img', { class: 'cframe', src: Store.cardImg(c), alt: '', loading: 'lazy' })));
  const me = () => String(S.wallet.full || '').toLowerCase();
  const okPrice = (t) => /^\d*\.?\d+$/.test(String(t).trim()) && +t > 0 && +t < 1e6;

  /** Is there a market on this network? (live: FireMarket deployed) */
  Store.marketOn = () => !LIVE || !!L()?.marketOn?.();
  /** Your own listings, by card id (the detail's "For sale" line): { [id]: priceEth } */
  S.listed ||= {};

  // ---------- DEMO: made-up listings, the demo wallet's ETH
  const demo = (() => {
    if (LIVE) return null;
    let seed = 11; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cast = Object.keys(Store.CHARS).filter((k) => Store.CHARS[k].series === 6);
    const MATS = [['paper', 0.0012], ['wood', 0.0025], ['fire', 0.006], ['charcoal', 0.014], ['gold', 0.04], ['fullart', 0.09]];
    const sellers = ['0x5b1e44c0a9d3e2f1b6a7c8d9e0f1a2b3c4d5e6f7', '0x9c02aa13b4c5d6e7f8091a2b3c4d5e6f708192a3', '0x31d7fe2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d', '0xe40b6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e'];
    const cards = [];
    for (let i = 0; i < 14; i++) {
      const [material, base] = MATS[Math.min(MATS.length - 1, Math.floor(R() * R() * MATS.length * 1.4))];
      const holo = material === 'gold' || material === 'fullart' ? 'full' : R() < 0.35 ? ['frame', 'picture', 'full'][Math.floor(R() * 3)] : 'none';
      const grade = R() < 0.4 ? Math.max(3, Math.min(10, Math.round(6 + (R() - 0.3) * 6))) : null;
      const c = { id: 5000 + i, serial: 900 + i * 3, series: 6, character: cast[Math.floor(R() * cast.length)], material, holo, edition: String(1 + Math.floor(R() * 30)),
        grade, pending: false, dealt: Date.now() - Math.round((3 + R() * 90) * Store.DAY), cased: grade == null && R() < 0.3, frozenAge: Math.round(R() * 20 * Store.DAY), moves: Math.floor(R() * 3) };
      const price = base * (1 + (holo !== 'none' ? 0.8 : 0) + (grade ? grade / 6 : 0)) * (0.7 + R() * 0.8);
      cards.push({ card: c, seller: sellers[i % sellers.length], priceEth: +price.toPrecision(2) });
    }
    const packs = [{ id: 1, seller: sellers[1], series: 6, amount: 3, pricePerEth: 0.0016 }, { id: 2, seller: sellers[2], series: 6, amount: 1, pricePerEth: 0.0013 }, { id: 3, seller: sellers[3], series: 7, amount: 2, pricePerEth: 0.0021 }];
    return { cards, packs, mine: { packs: [] }, nextPack: 4 };
  })();

  /** What's for sale now: { cards: [{ card, seller, priceEth, price?, mine }], packs: [{ id, seller, series, amount, pricePerEth, pricePer?, mine }] } */
  async function listings() {
    if (!LIVE) {
      const mineCards = Object.entries(S.listed).map(([id, p]) => ({ card: S.cards.find((c) => c.id === +id), seller: S.wallet.full, priceEth: p, mine: true })).filter((x) => x.card);
      return { cards: [...demo.cards.map((x) => ({ ...x, mine: false })), ...mineCards], packs: [...demo.packs.map((p) => ({ ...p, mine: false })), ...demo.mine.packs.map((p) => ({ ...p, mine: true }))] };
    }
    const r = await L().listings();
    const mine = me();
    const cards = r.cards.map((x) => ({ card: Live.toCard(x.card), seller: x.seller, priceEth: +x.priceEth, price: x.price, mine: x.seller.toLowerCase() === mine }));
    S.listed = {}; for (const x of cards) if (x.mine) S.listed[x.card.id] = x.priceEth;
    return { cards, packs: r.packs.map((p) => ({ ...p, pricePerEth: +p.pricePerEth, mine: p.seller.toLowerCase() === mine })) };
  }

  // ---------- actions
  const need = (fn) => (LIVE && !S.wallet.connected ? Live.needWallet(fn) : (S.wallet.connected || Store.update((s) => { s.wallet.connected = true; }), fn()));
  async function buyCard(x) {
    if (!LIVE) {
      if (S.wallet.balances.ETH < x.priceEth) { toast('Not enough ETH in the demo wallet', 'bad'); return false; }
      Store.update((s) => { s.wallet.balances.ETH = +(s.wallet.balances.ETH - x.priceEth).toFixed(6); s.cards.push({ ...x.card, id: Date.now() % 1e9, moves: x.card.moves + 1 }); Store.log(`Bought ${x.card.character} for ${ethTxt(x.priceEth)}`); });
      demo.cards = demo.cards.filter((y) => y.card.id !== x.card.id);
      toast(`${x.card.character} is in My cards`, 'good'); return true;
    }
    return !!(await Live.run(`Buy ${x.card.character}`, (o) => L().buyCard({ serial: x.card.serial, price: x.price }, o), `${x.card.character} is in My cards`));
  }
  async function buyPacks(p, n) {
    const total = +(p.pricePerEth * n).toFixed(8);
    if (!LIVE) {
      if (S.wallet.balances.ETH < total) { toast('Not enough ETH in the demo wallet', 'bad'); return false; }
      Store.update((s) => { s.wallet.balances.ETH = +(s.wallet.balances.ETH - total).toFixed(6); s.sealed[p.series] = (s.sealed[p.series] || 0) + n; Store.log(`Bought ${plural(n, 'Series ' + p.series + ' pack')} for ${ethTxt(total)}`); });
      const d = demo.packs.find((y) => y.id === p.id); if (d) { d.amount -= n; if (d.amount <= 0) demo.packs = demo.packs.filter((y) => y !== d); }
      toast(`${plural(n, 'pack')} added`, 'good'); return true;
    }
    return !!(await Live.run(`Buy ${plural(n, 'pack')}`, (o) => L().buyMarketPacks({ id: p.id, amount: n, pricePer: p.pricePer }, o), `${plural(n, 'pack')} added`));
  }
  async function listCard(c, priceEth) {
    if (!LIVE) {
      Store.update((s) => { s.listed[c.id] = +priceEth; });
      toast(`${c.character} is for sale at ${ethTxt(priceEth)}`, 'good');
      demoBuyer(c.id);
      return true;
    }
    const ok = await Live.run(`List ${c.character}`, (o) => L().listCard({ serial: c.serial, priceEth: String(priceEth) }, o), `${c.character} is for sale at ${ethTxt(priceEth)}`);
    if (ok) Store.update((s) => { s.listed[c.id] = +priceEth; });
    return !!ok;
  }
  async function unlistCard(c) {
    if (!LIVE) { Store.update((s) => { delete s.listed[c.id]; }); toast('Taken off sale', 'good'); return true; }
    const ok = await Live.run('Take off sale', (o) => L().cancelCard({ serial: c.serial }, o), 'Taken off sale');
    if (ok) Store.update((s) => { delete s.listed[c.id]; });
    return !!ok;
  }
  async function listPacks(series, n, priceEth) {
    if (!LIVE) {
      const held = (S.sealed[series] || 0) - demo.mine.packs.filter((p) => p.series === series).reduce((a, p) => a + p.amount, 0);
      if (n > held) { toast(`You have ${plural(held, 'pack')} to sell`, 'bad'); return false; }
      demo.mine.packs.push({ id: demo.nextPack++, seller: S.wallet.full, series, amount: n, pricePerEth: +priceEth });
      toast(`${plural(n, 'pack')} for sale`, 'good'); return true;
    }
    return !!(await Live.run(`List ${plural(n, 'pack')}`, (o) => L().listPacks({ series, amount: n, pricePerEth: String(priceEth) }, o), `${plural(n, 'pack')} for sale`));
  }
  async function unlistPacks(p) {
    if (!LIVE) { demo.mine.packs = demo.mine.packs.filter((y) => y.id !== p.id); toast('Taken off sale', 'good'); return true; }
    return !!(await Live.run('Take packs off sale', (o) => L().cancelPacks({ id: p.id }, o), 'Taken off sale'));
  }
  async function cancelAll() {
    if (!LIVE) { Store.update((s) => { s.listed = {}; }); demo.mine.packs = []; toast('Everything is off sale', 'good'); return true; }
    const ok = await Live.run('Take everything off sale', (o) => L().cancelAllListings(o), 'Everything is off sale');
    if (ok) Store.update((s) => { s.listed = {}; });
    return !!ok;
  }
  // DEMO: someone buys what you list, a little later (so the whole flow can be tried)
  function demoBuyer(id) {
    setTimeout(() => {
      const p = S.listed[id], c = S.cards.find((x) => x.id === id);
      if (p == null || !c) return;
      const got = +(p * (1 - ROYALTY_BPS / 10000)).toFixed(6);
      Store.update((s) => { delete s.listed[id]; s.cards = s.cards.filter((x) => x.id !== id); s.wallet.balances.ETH = +(s.wallet.balances.ETH + got).toFixed(6); Store.log(`Sold ${c.character} for ${ethTxt(p)}`); });
      toast(`Your ${c.character} sold for ${ethTxt(p)}!`, 'good');
      if (document.getElementById('sheet-market')?.open) draw();
    }, 20000 + Math.random() * 15000);
  }

  // ---------- the market screen
  let tab = 'cards', sort = 'low', mat = 'all', root = null, data = null;
  const TABS = [['cards', 'Cards'], ['packs', 'Packs'], ['mine', 'Mine']];
  const MATS = ['all', 'paper', 'wood', 'fire', 'charcoal', 'gold', 'fullart'];
  function refresh() {
    listings().then((d) => { data = d; draw(); }, (e) => { console.warn('market', e); data = null; draw('Couldn’t load the market. Try again.'); });
    draw();
  }
  function draw(err) {
    if (!root?.isConnected) return;
    const tabs = h('div', { class: 'mk-tabs', role: 'tablist' }, TABS.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'btn small' + (tab === k ? ' on' : ''), 'aria-selected': String(tab === k), text: label, onclick: () => { tab = k; draw(); } })));
    if (err) return put(root, tabs, h('p', { class: 'warn', text: err }), h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: refresh }));
    if (!data) return put(root, tabs, h('p', { class: 'muted', text: 'Loading the market…' }));
    put(root, tabs, tab === 'cards' ? cardsTab() : tab === 'packs' ? packsTab() : mineTab(), LIVE ? null : h('p', { class: 'demo-line', text: 'Demo market: made-up sellers, demo ETH' }));
  }
  function cardsTab() {
    let xs = data.cards.filter((x) => !x.mine && (mat === 'all' || x.card.material === mat));
    xs = xs.sort((a, b) => (sort === 'high' ? b.priceEth - a.priceEth : sort === 'grade' ? (b.card.grade ?? -1) - (a.card.grade ?? -1) || a.priceEth - b.priceEth : a.priceEth - b.priceEth));
    const sel = (label, val, opts, set) => h('label', { class: 'mk-sel' }, h('span', { text: label }), h('select', { onchange: (e) => { set(e.target.value); draw(); } }, opts.map(([v, t]) => h('option', { value: v, text: t, selected: v === val || null }))));
    return [
      h('div', { class: 'mk-bar' },
        sel('Type', mat, MATS.map((m) => [m, m === 'all' ? 'All' : Store.MAT_LABEL[m]]), (v) => { mat = v; }),
        sel('Sort', sort, [['low', 'Price: low to high'], ['high', 'Price: high to low'], ['grade', 'Best grade']], (v) => { sort = v; })),
      xs.length ? h('div', { class: 'mk-grid' }, xs.map((x) => h('button', { type: 'button', class: 'mk-tile', 'aria-label': `${x.card.character}, ${kind(x.card)}, ${ethTxt(x.priceEth)}`, onclick: () => openListing(x) },
        h('div', { class: 'cwrap' }, face(x.card)),
        h('span', { class: 'mk-name', text: x.card.character }), h('span', { class: 'mk-kind', text: kind(x.card) }),
        h('b', { class: 'mk-price', text: ethTxt(x.priceEth) }))))
        : h('p', { class: 'muted', text: mat === 'all' ? 'No cards for sale right now.' : `No ${Store.MAT_LABEL[mat]} cards for sale right now.` }),
    ];
  }
  function packsTab() {
    const xs = data.packs.filter((p) => !p.mine).sort((a, b) => a.pricePerEth - b.pricePerEth);
    if (!xs.length) return h('p', { class: 'muted', text: 'No packs for sale right now.' });
    return h('div', { class: 'mk-packs' }, xs.map((p) => {
      let n = 1;
      const cnt = h('b', { class: 'mk-n', text: '1' }), tot = h('span', { class: 'mk-tot', text: ethTxt(p.pricePerEth) });
      const set = (v) => { n = Math.max(1, Math.min(p.amount, v)); cnt.textContent = String(n); tot.textContent = ethTxt(p.pricePerEth * n); };
      const buy = h('button', { type: 'button', class: 'btn primary', text: 'Buy', onclick: () => need(async () => { buy.disabled = true; if (await buyPacks(p, n)) refresh(); else buy.disabled = false; }) });
      return h('div', { class: 'mk-pack' },
        h('img', { src: Store.packThumb(p.series), alt: '', loading: 'lazy' }),
        h('div', { class: 'mk-pinfo' }, h('h3', { text: `Series ${p.series} pack` }), h('span', { class: 'muted', text: `${plural(p.amount, 'pack')} · ${ethTxt(p.pricePerEth)} each` }), h('span', { class: 'mk-seller', text: `From ${Fun.label(p.seller)}` })),
        h('div', { class: 'mk-buy' },
          p.amount > 1 ? h('div', { class: 'mk-step' }, h('button', { type: 'button', class: 'btn small', 'aria-label': 'One fewer', text: '−', onclick: () => set(n - 1) }), cnt, h('button', { type: 'button', class: 'btn small', 'aria-label': 'One more', text: '+', onclick: () => set(n + 1) })) : null,
          tot, buy));
    }));
  }
  function mineTab() {
    if (LIVE && !S.wallet.connected) return h('div', {}, h('p', { class: 'muted', text: 'Connect your wallet to see and sell yours.' }), h('button', { type: 'button', class: 'btn primary', text: 'Connect', onclick: () => Live.needWallet(() => refresh()) }));
    const cards = data.cards.filter((x) => x.mine), packs = data.packs.filter((p) => p.mine);
    const owed = h('div');
    if (LIVE) L().owedTo(S.wallet.full).then((v) => { if (+v > 0) put(owed, h('p', { class: 'mk-owed' }, `${ethTxt(v)} from a sale is waiting for you. `, h('button', { type: 'button', class: 'btn small primary', text: 'Collect', onclick: () => Live.run('Collect', (o) => L().withdrawOwed(o), 'Collected').then(refresh) }))); }, () => {});
    return [
      owed,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', text: 'Sell packs', onclick: sellPacks }), h('button', { type: 'button', class: 'btn', text: 'Sell a card', onclick: () => { Sheet.close('market'); Stations.open('cards'); toast('Open a card, then tap Sell', 'good'); } })),
      h('h3', { text: 'Your cards for sale' }),
      cards.length ? h('div', { class: 'mk-grid' }, cards.map((x) => h('button', { type: 'button', class: 'mk-tile', onclick: () => Fun.open.sell({ id: x.card.id }) },
        h('div', { class: 'cwrap' }, face(x.card)), h('span', { class: 'mk-name', text: x.card.character }), h('b', { class: 'mk-price', text: ethTxt(x.priceEth) }))))
        : h('p', { class: 'muted', text: 'None. Open a card in My cards and tap Sell.' }),
      h('h3', { text: 'Your packs for sale' }),
      packs.length ? h('ul', { class: 'mk-mine' }, packs.map((p) => h('li', {}, h('span', { text: `Series ${p.series}: ${plural(p.amount, 'pack')} at ${ethTxt(p.pricePerEth)} each` }),
        h('button', { type: 'button', class: 'btn small', text: 'Take off sale', onclick: async () => { if (await unlistPacks(p)) refresh(); } }))))
        : h('p', { class: 'muted', text: 'None.' }),
      cards.length + packs.length > 1 ? h('button', { type: 'button', class: 'btn', text: 'Take everything off sale', onclick: async () => { if (await cancelAll()) refresh(); } }) : null,
    ];
  }

  // one listed card, big, with its Buy button
  function openListing(x) {
    const c = x.card, zoom = () => window.Zoom?.open({ cards: [c], index: 0, face: (y) => face(y, false), name: (y) => `${y.character}, ${kind(y)}`, from: () => document.querySelector('#sheet-mcard .cface') });
    const buy = h('button', { type: 'button', class: 'btn primary', text: `Buy · ${ethTxt(x.priceEth)}`, onclick: () => need(async () => { buy.disabled = true; if (await buyCard(x)) { Sheet.close('mcard'); refresh(); } else buy.disabled = false; }) });
    const body = h('div', { class: 'detail mk-detail' },
      h('div', { class: 'big' }, h('div', { class: 'cwrap', onclick: zoom }, face(c, false), window.Zoom ? Zoom.expandButton(`View ${c.character} full screen`, zoom) : null)),
      h('div', { class: 'traits' },
        h('p', { class: 'mk-kind', text: `${kind(c)} · Series ${c.series}${Store.printNo?.(c) ? ' · #' + Store.printNo(c) : ''}` }),
        h('p', { class: 'mk-big' }, h('b', { text: ethTxt(x.priceEth) }), ' ', h('span', { class: 'muted', text: usd(x.priceEth) })),
        h('div', { class: 'row dacts' }, buy),
        c.grade == null ? h('p', { class: 'muted small', text: `${c.cased ? 'Cased' : 'Not cased'} · ${plural(Math.min(c.moves || 0, 10), 'move')} so far. Buying it adds one more.` }) : null,
        h('p', { class: 'mk-seller', text: `Sold by ${Fun.label(x.seller)}` }),
        Wear.howPill?.()));
    Sheet.open('mcard', { title: c.character, body });
  }

  Fun.open.market = (o = {}) => {
    if (LIVE && !Store.marketOn()) { toast('The market isn’t open on this network yet', 'bad'); return; }
    if (o.tab) tab = o.tab;
    root = h('div', { class: 'st market' });
    Sheet.open('market', { title: 'Market', body: root, wide: true });
    refresh();
  };

  // ---------- selling a card (from its detail)
  Fun.open.sell = ({ id }) => {
    const c = S.cards.find((x) => x.id === id); if (!c) return;
    if (c.pending) { toast('It can be sold once its grading is done', 'bad'); return; }
    const listed = S.listed[id];
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 'mk-input', placeholder: '0.01', value: listed != null ? String(listed) : '', 'aria-label': 'Price in ETH' });
    const get = h('p', { class: 'muted small mk-get' });
    const upd = () => { const t = input.value.trim(); get.textContent = okPrice(t) ? `You get about ${ethTxt(+t * (1 - ROYALTY_BPS / 10000))} ${usd(+t * (1 - ROYALTY_BPS / 10000))}` : ' '; };
    input.addEventListener('input', upd); upd();
    const go = h('button', { type: 'button', class: 'btn primary', text: listed != null ? 'Change price' : 'List for sale', onclick: () => need(async () => {
      const t = input.value.trim();
      if (!okPrice(t)) { toast('Enter a price in ETH, like 0.01', 'bad'); input.focus(); return; }
      go.disabled = true;
      if (await listCard(c, +t)) { Sheet.close('sell'); window.Stations?.openCard(c.id); } else go.disabled = false;
    }) });
    const body = h('div', { class: 'st sell' },
      h('div', { class: 'mk-sellcard' }, h('div', { class: 'cwrap' }, face(c, false)),
        h('div', {}, h('h3', { text: c.character }), h('p', { class: 'muted', text: kind(c) }), listed != null ? h('p', { class: 'mk-big' }, 'For sale at ', h('b', { text: ethTxt(listed) })) : null)),
      h('label', { class: 'mk-field' }, h('span', { text: 'Price (ETH)' }), input), get,
      h('div', { class: 'row' }, go, listed != null ? h('button', { type: 'button', class: 'btn', text: 'Take off sale', onclick: async () => { if (await unlistCard(c)) { Sheet.close('sell'); window.Stations?.openCard(c.id); } } }) : null),
      h('p', { class: 'muted small', text: 'It stays in your wallet until someone buys it. You can change the price or take it off sale any time.' }),
      LIVE ? null : h('p', { class: 'demo-line', text: 'Demo: a buyer turns up in a little while' }));
    Sheet.open('sell', { title: listed != null ? 'For sale' : 'Sell', body });
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  };

  // ---------- selling packs
  function sellPacks() {
    const have = Object.entries(S.sealed).map(([k, v]) => [+k, v]).filter(([, v]) => v > 0);
    if (!have.length) { toast('No sealed packs to sell', 'bad'); return; }
    let series = have[0][0], n = 1;
    const cnt = h('b', { class: 'mk-n', text: '1' });
    const pick = h('select', { 'aria-label': 'Which Series', onchange: (e) => { series = +e.target.value; set(1); } }, have.map(([k, v]) => h('option', { value: k, text: `Series ${k} (${v})` })));
    const set = (v) => { const max = S.sealed[series] || 1; n = Math.max(1, Math.min(max, v)); cnt.textContent = String(n); };
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 'mk-input', placeholder: '0.002', 'aria-label': 'Price per pack in ETH' });
    const go = h('button', { type: 'button', class: 'btn primary', text: 'List for sale', onclick: () => need(async () => {
      const t = input.value.trim();
      if (!okPrice(t)) { toast('Enter a price in ETH, like 0.002', 'bad'); input.focus(); return; }
      go.disabled = true;
      if (await listPacks(series, n, +t)) { Sheet.close('sellpacks'); tab = 'mine'; if (document.getElementById('sheet-market')?.open) refresh(); else Fun.open.market({ tab: 'mine' }); } else go.disabled = false;
    }) });
    Sheet.open('sellpacks', { title: 'Sell packs', body: h('div', { class: 'st sell' },
      h('label', { class: 'mk-field' }, h('span', { text: 'Packs' }), pick),
      h('div', { class: 'mk-step' }, h('button', { type: 'button', class: 'btn small', 'aria-label': 'One fewer', text: '−', onclick: () => set(n - 1) }), cnt, h('button', { type: 'button', class: 'btn small', 'aria-label': 'One more', text: '+', onclick: () => set(n + 1) })),
      h('label', { class: 'mk-field' }, h('span', { text: 'Price per pack (ETH)' }), input),
      h('div', { class: 'row' }, go),
      h('p', { class: 'muted small', text: 'They stay in your wallet until someone buys them.' })) });
  }

  // the card detail's line (screens.js): "Sell", or "For sale · 0.02 ETH" once listed
  Fun.sellLabel = (c) => (S.listed[c.id] != null ? `For sale · ${ethTxt(S.listed[c.id])}` : 'Sell');
  // live: your listings are known once the market is read (the detail's label); read them when the wallet connects
  if (LIVE) {
    let who = '';
    Store.on(() => { const w = me(); if (w && w !== who && Store.marketOn()) { who = w; listings().then(() => Store.update(() => {}), () => {}); } });
  }
})();
