/* Omni Cardworks (fun layer): the market. Cards and sealed packs for sale at a fixed price in ETH, and offers
   (FireMarket: no owner, no fees; a listed card stays in its seller's wallet until someone buys it, and an offer's
   WETH stays in the buyer's wallet until a holder accepts).
     Market (top bar, the workshop's Market sign, Menu): Cards (floors by type, a grid; tap one to see it, buy it or
     make an offer), Packs, Offers (what people want: one card, any card like it, packs; "Sell yours" when you hold a
     match, and "Make an offer"), Activity (the newest sales), Mine (your listings, your offers, your WETH).
     A card's detail: Sell (or "For sale · 0.02 ETH"), and its best offer with Accept.
   Live: the chain (Live.chain: market.ts); only listings and offers that can be bought or accepted now are shown.
   Demo: made-up sellers and buyers, the demo wallet's ETH; a buyer turns up for what you list. Buy screens show prices
   only (where the money goes is for Info). */
(() => {
  const { h, put } = Fun;
  const LIVE = window.Live?.on;
  const S = Store.state;
  const L = () => window.Live?.chain;
  const ROYALTY_BPS = 500; // the collection's resale royalty (ERC-2981, set at deploy); for "You get about"
  const DAY_S = 86400;
  const trim = (x) => { const n = +x; if (!(n > 0)) return '0'; return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : n.toLocaleString('en-US', { maximumSignificantDigits: 4 }); };
  const ethTxt = (x) => `${trim(x)} ETH`;
  const usd = (x) => (Store.PRICES.ETH_USD > 0 ? `≈ $${(+x * Store.PRICES.ETH_USD).toLocaleString('en-US', { maximumFractionDigits: +x * Store.PRICES.ETH_USD < 10 ? 2 : 0 })}` : '');
  const net = (x) => +x * (1 - ROYALTY_BPS / 10000);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const HOLO_WORD = { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' };
  const kind = (c) => [Store.MAT_LABEL[c.material], c.holo && c.holo !== 'none' && !Store.ALWAYS_HOLO?.[c.material] ? HOLO_WORD[c.holo] : '', c.grade != null ? 'PDA ' + c.grade : c.cased ? 'Cased' : ''].filter(Boolean).join(' · ');
  const face = (c, lazy = true) => (window.Stations?.cardFace ? Stations.cardFace(c, lazy) : h('div', { class: `cface m-${c.material}` }, h('img', { class: 'cframe', src: Store.cardImg(c), alt: '', loading: 'lazy' })));
  const me = () => String(S.wallet.full || '').toLowerCase();
  const mine = (a) => !!a && String(a).toLowerCase() === me();
  const okPrice = (t) => /^\d*\.?\d+$/.test(String(t).trim()) && +t > 0 && +t < 1e6;
  const nowS = () => Math.floor(Date.now() / 1000);
  const ago = (t) => { const s = Math.max(1, nowS() - t); return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const ends = (t) => { const s = t - nowS(); return s < 3600 ? 'ends within the hour' : s < 86400 ? `ends in ${Math.round(s / 3600)} h` : `ends in ${Math.round(s / 86400)} days`; };
  const holoOf = (c) => (c.holo && c.holo !== 'none' ? c.holo : 'none');

  S.listed ||= {};

  // ---------- what a "match" offer asks for, in words; and whether a card meets it
  // rule: { fire (0 any), cardType (index | null), mat (the type's id, for words and the demo), character (index | null),
  //         charName, holo: any | none | frame | picture | full | anyHolo, minGrade (0 any) }
  const HOLO_RULE = { any: '', none: 'no holo', frame: 'holo frame', picture: 'holo picture', full: 'full holo', anyHolo: 'any holo' };
  function ruleText(r) {
    const what = [r.fire ? `Series ${r.fire}` : '', r.mat ? Store.MAT_LABEL[r.mat] || r.mat : '', r.charName || ''].filter(Boolean).join(' ');
    return `Any ${what || 'card'}${what && !r.charName ? ' card' : ''}${HOLO_RULE[r.holo] ? ', ' + HOLO_RULE[r.holo] : ''}${r.minGrade ? `, PDA ${r.minGrade}+` : ''}`;
  }
  function fits(r, c) {
    if (r.fire && c.series !== r.fire) return false;
    if (r.cardType != null && (LIVE ? c.cardType !== r.cardType : c.material !== r.mat)) return false;
    if (r.character != null && (LIVE ? c.characterIndex !== r.character : c.character !== r.charName)) return false;
    const hl = holoOf(c);
    if (r.holo === 'none' && hl !== 'none') return false;
    if (['frame', 'picture', 'full'].includes(r.holo) && hl !== r.holo) return false;
    if (r.holo === 'anyHolo' && hl === 'none') return false;
    if (r.minGrade && !(c.grade >= r.minGrade)) return false;
    return true;
  }
  /** Does offer `o` want card `c`? */
  const wants = (o, c) => !c.pending && (o.kind === 'card' ? o.serial === (c.serial ?? c.id) || o.cardId === c.id : o.kind === 'match' ? fits(o.rule, c) : false);
  // live: the words for a Series' types and characters (its recipe), read once per Series
  const sets = {};
  const setOf = (fire) => (LIVE && fire ? (sets[fire] ||= L().practiceSet(fire).catch(() => null)) : Promise.resolve(null));
  async function named(r) {
    if (!LIVE) return r;
    const set = await setOf(r.fire || S.series.no);
    const t = r.cardType != null ? set?.types?.[r.cardType] : null;
    return { ...r, mat: t ? (Live.toMaterial(t.name) || t.name) : null, charName: r.character != null ? set?.characters?.[r.character] || `#${r.character + 1}` : null };
  }

  // ---------- DEMO: made-up listings, offers and sales, the demo wallet's ETH
  const demo = (() => {
    if (LIVE) return null;
    let seed = 11; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cast = Object.keys(Store.CHARS).filter((k) => Store.CHARS[k].series === 6);
    const MATS = [['paper', 0.0012], ['wood', 0.0025], ['fire', 0.006], ['charcoal', 0.014], ['gold', 0.04], ['fullart', 0.09]];
    const people = ['0x5b1e44c0a9d3e2f1b6a7c8d9e0f1a2b3c4d5e6f7', '0x9c02aa13b4c5d6e7f8091a2b3c4d5e6f708192a3', '0x31d7fe2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d', '0xe40b6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e'];
    const mk = (i) => {
      const [material, base] = MATS[Math.min(MATS.length - 1, Math.floor(R() * R() * MATS.length * 1.4))];
      const holo = material === 'gold' || material === 'fullart' ? 'full' : R() < 0.35 ? ['frame', 'picture', 'full'][Math.floor(R() * 3)] : 'none';
      const grade = R() < 0.4 ? Math.max(3, Math.min(10, Math.round(6 + (R() - 0.3) * 6))) : null;
      const c = { id: 5000 + i, serial: 900 + i * 3, series: 6, character: cast[Math.floor(R() * cast.length)], material, holo, edition: String(1 + Math.floor(R() * 30)),
        grade, pending: false, dealt: Date.now() - Math.round((3 + R() * 90) * Store.DAY), cased: grade == null && R() < 0.3, frozenAge: Math.round(R() * 20 * Store.DAY), moves: Math.floor(R() * 3) };
      return { card: c, price: +(base * (1 + (holo !== 'none' ? 0.8 : 0) + (grade ? grade / 6 : 0)) * (0.7 + R() * 0.8)).toPrecision(2) };
    };
    const cards = []; for (let i = 0; i < 14; i++) { const x = mk(i); cards.push({ card: x.card, seller: people[i % people.length], priceEth: x.price }); }
    const packs = [{ id: 1, seller: people[1], series: 6, amount: 3, pricePerEth: 0.0016 }, { id: 2, seller: people[2], series: 6, amount: 1, pricePerEth: 0.0013 }, { id: 3, seller: people[3], series: 7, amount: 2, pricePerEth: 0.0021 }];
    const yours = S.cards, gold = yours.find((c) => c.material === 'gold') || yours[0];
    const t = nowS(), wk = 7 * DAY_S;
    const offers = [
      { id: 1, buyer: people[0], kind: 'card', cardId: gold.id, serial: gold.serial, priceEth: 0.035, qty: 1, expiry: t + 3 * DAY_S },
      { id: 2, buyer: people[2], kind: 'match', rule: { fire: 6, cardType: 0, mat: 'paper', character: null, charName: null, holo: 'any', minGrade: 0 }, priceEth: 0.0009, qty: 3, expiry: t + wk },
      { id: 3, buyer: people[3], kind: 'match', rule: { fire: 0, cardType: null, mat: null, character: null, charName: null, holo: 'any', minGrade: 8 }, priceEth: 0.012, qty: 2, expiry: t + 2 * wk },
      { id: 4, buyer: people[1], kind: 'packs', series: 6, priceEth: 0.0015, qty: 4, expiry: t + wk },
      { id: 5, buyer: people[2], kind: 'match', rule: { fire: 6, cardType: 5, mat: 'fullart', character: null, charName: 'Jellyfish', holo: 'any', minGrade: 10 }, priceEth: 0.3, qty: 1, expiry: t + 4 * wk },
    ];
    const sales = []; for (let i = 0; i < 9; i++) { const x = mk(40 + i); sales.push({ kind: 'card', card: x.card, priceEth: x.price, seller: people[i % 4], buyer: people[(i + 1) % 4], at: t - Math.round((0.2 + i * i * 0.7) * 3600) }); }
    sales.splice(3, 0, { kind: 'packs', series: 6, amount: 2, priceEth: 0.0031, seller: people[2], buyer: people[0], at: t - 5 * 3600 });
    return { cards, packs, offers, sales, mine: { packs: [] }, nextPack: 4, nextOffer: 6 };
  })();

  /** What's for sale and wanted now: { cards, packs, offers } (live: only what can be bought or accepted now). */
  async function listings() {
    if (!LIVE) {
      const myCards = Object.entries(S.listed).map(([id, p]) => ({ card: S.cards.find((c) => c.id === +id), seller: S.wallet.full, priceEth: p, mine: true })).filter((x) => x.card);
      return {
        cards: [...demo.cards.map((x) => ({ ...x, mine: false })), ...myCards],
        packs: [...demo.packs.map((p) => ({ ...p, mine: false })), ...demo.mine.packs.map((p) => ({ ...p, mine: true }))],
        offers: demo.offers.filter((o) => o.qty > 0 && o.expiry > nowS()).map((o) => ({ ...o, mine: mine(o.buyer) })),
      };
    }
    const r = await L().listings();
    const cards = r.cards.map((x) => ({ card: Live.toCard(x.card), seller: x.seller, priceEth: +x.priceEth, price: x.price, mine: mine(x.seller) }));
    S.listed = {}; for (const x of cards) if (x.mine) S.listed[x.card.id] = x.priceEth;
    const offers = await Promise.all(r.offers.map(async (o) => ({ ...o, priceEth: +o.priceEth, mine: mine(o.buyer), rule: o.rule ? await named(o.rule) : undefined })));
    S.offersSeen = offers;
    return { cards, packs: r.packs.map((p) => ({ ...p, pricePerEth: +p.pricePerEth, mine: mine(p.seller) })), offers };
  }
  async function sales() {
    if (!LIVE) return demo.sales;
    const rows = await L().recentSales(25);
    return Promise.all(rows.map(async (x) => ({ ...x, priceEth: +x.priceEth, card: x.kind === 'card' && x.serial ? await L().card(x.serial).then(Live.toCard, () => null) : null })));
  }

  // ---------- actions (demo: in memory; live: Live.run shows the steps and the wallet)
  const need = (fn) => (LIVE && !S.wallet.connected ? Live.needWallet(fn) : (S.wallet.connected || Store.update((s) => { s.wallet.connected = true; }), fn()));
  const spend = (eth) => { if (S.wallet.balances.ETH < eth) { toast('Not enough ETH in the demo wallet', 'bad'); return false; } Store.update((s) => { s.wallet.balances.ETH = +(s.wallet.balances.ETH - eth).toFixed(6); }); return true; };
  const earn = (eth) => Store.update((s) => { s.wallet.balances.ETH = +(s.wallet.balances.ETH + net(eth)).toFixed(6); });
  const sold = (row) => { if (demo) demo.sales.unshift({ ...row, at: nowS() }); };
  async function buyCard(x) {
    if (!LIVE) {
      if (!spend(x.priceEth)) return false;
      Store.update((s) => { s.cards.push({ ...x.card, id: Date.now() % 1e9, moves: (x.card.moves || 0) + 1 }); Store.log(`Bought ${x.card.character} for ${ethTxt(x.priceEth)}`); });
      demo.cards = demo.cards.filter((y) => y.card.id !== x.card.id); sold({ kind: 'card', card: x.card, priceEth: x.priceEth, seller: x.seller, buyer: S.wallet.full });
      toast(`${x.card.character} is in My cards`, 'good'); return true;
    }
    return !!(await Live.run(`Buy ${x.card.character}`, (o) => L().buyCard({ serial: x.card.serial, price: x.price }, o), `${x.card.character} is in My cards`));
  }
  async function buyPacks(p, n) {
    const total = +(p.pricePerEth * n).toFixed(8);
    if (!LIVE) {
      if (!spend(total)) return false;
      Store.update((s) => { s.sealed[p.series] = (s.sealed[p.series] || 0) + n; Store.log(`Bought ${plural(n, 'Series ' + p.series + ' pack')} for ${ethTxt(total)}`); });
      const d = demo.packs.find((y) => y.id === p.id); if (d) { d.amount -= n; if (d.amount <= 0) demo.packs = demo.packs.filter((y) => y !== d); }
      sold({ kind: 'packs', series: p.series, amount: n, priceEth: total, seller: p.seller, buyer: S.wallet.full });
      toast(`${plural(n, 'pack')} added`, 'good'); return true;
    }
    return !!(await Live.run(`Buy ${plural(n, 'pack')}`, (o) => L().buyMarketPacks({ id: p.id, amount: n, pricePer: p.pricePer }, o), `${plural(n, 'pack')} added`));
  }
  async function listCard(c, priceEth) {
    if (!LIVE) { Store.update((s) => { s.listed[c.id] = +priceEth; }); toast(`${c.character} is for sale at ${ethTxt(priceEth)}`, 'good'); demoBuyer(c.id); return true; }
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
    if (!LIVE) { Store.update((s) => { s.listed = {}; }); demo.mine.packs = []; demo.offers = demo.offers.filter((o) => !mine(o.buyer)); toast('Everything is off sale and your offers are cancelled', 'good'); return true; }
    const ok = await Live.run('Take everything off sale', (o) => L().cancelAllListings(o), 'Everything is off sale and your offers are cancelled');
    if (ok) Store.update((s) => { s.listed = {}; });
    return !!ok;
  }
  // offers: o = { kind: card | match | packs, card?, rule?, series?, priceEth, qty, days }
  async function makeOffer(o) {
    const total = +(o.priceEth * o.qty).toFixed(8);
    if (!LIVE) {
      if (S.wallet.balances.ETH < total) { toast('Not enough ETH in the demo wallet', 'bad'); return false; }
      demo.offers.push({ id: demo.nextOffer++, buyer: S.wallet.full, kind: o.kind, cardId: o.card?.id, serial: o.card?.serial, card: o.card, rule: o.rule, series: o.series, priceEth: +o.priceEth, qty: o.qty, expiry: nowS() + o.days * DAY_S });
      toast(`Offer made: ${ethTxt(o.priceEth)}${o.qty > 1 ? ' each' : ''}`, 'good'); return true;
    }
    const p = { priceEth: String(o.priceEth), qty: o.qty, days: o.days, ...(o.kind === 'card' ? { serial: o.card.serial } : o.kind === 'packs' ? { series: o.series } : { rule: { fire: o.rule.fire, cardType: o.rule.cardType, character: o.rule.character, holo: o.rule.holo, minGrade: o.rule.minGrade } }) };
    return !!(await Live.run('Make an offer', (w) => L().makeOffer(p, w), `Offer made: ${ethTxt(o.priceEth)}${o.qty > 1 ? ' each' : ''}`));
  }
  async function cancelOffer(o) {
    if (!LIVE) { demo.offers = demo.offers.filter((x) => x.id !== o.id); toast('Offer cancelled', 'good'); return true; }
    return !!(await Live.run('Cancel the offer', (w) => L().cancelOffer({ id: o.id }, w), 'Offer cancelled'));
  }
  async function accept(o, c, n = 1) {
    const total = +(o.priceEth * n).toFixed(8);
    if (!LIVE) {
      if (o.kind === 'packs') Store.update((s) => { s.sealed[o.series] -= n; });
      else Store.update((s) => { s.cards = s.cards.filter((x) => x.id !== c.id); delete s.listed[c.id]; });
      earn(total);
      const d = demo.offers.find((x) => x.id === o.id); if (d) d.qty -= n;
      Store.log(`Sold ${o.kind === 'packs' ? plural(n, 'pack') : c.character} for ${ethTxt(total)}`);
      sold(o.kind === 'packs' ? { kind: 'packs', series: o.series, amount: n, priceEth: total, seller: S.wallet.full, buyer: o.buyer } : { kind: 'card', card: c, priceEth: total, seller: S.wallet.full, buyer: o.buyer });
      toast(`Sold for ${ethTxt(total)}`, 'good'); return true;
    }
    return !!(await Live.run(`Sell for ${ethTxt(total)}`, (w) => L().acceptOffer({ id: o.id, kind: o.kind, serial: c?.serial, amount: n, price: o.price }, w), `Sold for ${ethTxt(total)}`));
  }
  // DEMO: someone buys what you list, a little later (so the whole flow can be tried)
  function demoBuyer(id) {
    setTimeout(() => {
      const p = S.listed[id], c = S.cards.find((x) => x.id === id);
      if (p == null || !c) return;
      Store.update((s) => { delete s.listed[id]; s.cards = s.cards.filter((x) => x.id !== id); Store.log(`Sold ${c.character} for ${ethTxt(p)}`); });
      earn(p); sold({ kind: 'card', card: c, priceEth: p, seller: S.wallet.full, buyer: '0x31d7fe2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d' });
      toast(`Your ${c.character} sold for ${ethTxt(p)}!`, 'good');
      if (document.getElementById('sheet-market')?.open) draw();
    }, 20000 + Math.random() * 15000);
  }

  // ---------- the market screen
  let tab = 'cards', sort = 'low', mat = 'all', root = null, data = null, act = null;
  const TABS = [['cards', 'Cards'], ['packs', 'Packs'], ['offers', 'Offers'], ['activity', 'Activity'], ['mine', 'Mine']];
  const MATS = ['all', 'paper', 'wood', 'fire', 'charcoal', 'gold', 'fullart'];
  function refresh() {
    listings().then((d) => { data = d; draw(); }, (e) => { console.warn('market', e); data = null; draw('Couldn’t load the market. Try again.'); });
    if (tab === 'activity') act = null;
    draw();
  }
  function draw(err) {
    if (!root?.isConnected) return;
    const tabs = h('div', { class: 'mk-tabs', role: 'tablist' }, TABS.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'btn small' + (tab === k ? ' on' : ''), 'aria-selected': String(tab === k), text: label, onclick: () => { tab = k; draw(); } })));
    if (err) return put(root, tabs, h('p', { class: 'warn', text: err }), h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: refresh }));
    if (!data) return put(root, tabs, h('p', { class: 'muted', text: 'Loading the market…' }));
    const body = { cards: cardsTab, packs: packsTab, offers: offersTab, activity: activityTab, mine: mineTab }[tab]();
    put(root, tabs, body, LIVE ? null : h('p', { class: 'demo-line', text: 'Demo market: made-up people, demo ETH' }));
  }
  const sel = (label, val, opts, set) => h('label', { class: 'mk-sel' }, h('span', { text: label }), h('select', { onchange: (e) => { set(e.target.value); } }, opts.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(val) || null }))));
  const tile = (c, price, onclick, sub) => h('button', { type: 'button', class: 'mk-tile', 'aria-label': `${c.character}, ${kind(c)}${price != null ? ', ' + ethTxt(price) : ''}`, onclick },
    h('div', { class: 'cwrap' }, face(c)), h('span', { class: 'mk-name', text: c.character }), h('span', { class: 'mk-kind', text: kind(c) }),
    price != null ? h('b', { class: 'mk-price', text: ethTxt(price) }) : null, sub ? h('span', { class: 'mk-sub', text: sub }) : null);

  function cardsTab() {
    const all = data.cards.filter((x) => !x.mine);
    // floors: the cheapest of each type
    const floors = MATS.slice(1).map((m) => [m, Math.min(...all.filter((x) => x.card.material === m).map((x) => x.priceEth))]).filter(([, p]) => Number.isFinite(p));
    let xs = all.filter((x) => mat === 'all' || x.card.material === mat);
    xs = xs.sort((a, b) => (sort === 'high' ? b.priceEth - a.priceEth : sort === 'grade' ? (b.card.grade ?? -1) - (a.card.grade ?? -1) || a.priceEth - b.priceEth : a.priceEth - b.priceEth));
    return [
      floors.length ? h('div', { class: 'mk-floors', 'aria-label': 'Floor prices' }, floors.map(([m, p]) => h('button', { type: 'button', class: 'mk-floor' + (mat === m ? ' on' : ''), onclick: () => { mat = mat === m ? 'all' : m; draw(); } },
        h('span', { text: Store.MAT_LABEL[m] }), h('b', { text: `from ${ethTxt(p)}` })))) : null,
      h('div', { class: 'mk-bar' },
        sel('Type', mat, MATS.map((m) => [m, m === 'all' ? 'All' : Store.MAT_LABEL[m]]), (v) => { mat = v; draw(); }),
        sel('Sort', sort, [['low', 'Price: low to high'], ['high', 'Price: high to low'], ['grade', 'Best grade']], (v) => { sort = v; draw(); })),
      xs.length ? h('div', { class: 'mk-grid' }, xs.map((x) => tile(x.card, x.priceEth, () => openListing(x), bestFor(x.card) ? `Best offer ${ethTxt(bestFor(x.card).priceEth)}` : '')))
        : h('p', { class: 'muted', text: mat === 'all' ? 'No cards for sale right now. Make an offer in Offers.' : `No ${Store.MAT_LABEL[mat]} cards for sale right now.` }),
    ];
  }
  function stepper(max, onChange) {
    let n = 1; const cnt = h('b', { class: 'mk-n', text: '1' });
    const set = (v) => { n = Math.max(1, Math.min(max, v)); cnt.textContent = String(n); onChange(n); };
    return { el: max > 1 ? h('div', { class: 'mk-step' }, h('button', { type: 'button', class: 'btn small', 'aria-label': 'One fewer', text: '−', onclick: () => set(n - 1) }), cnt, h('button', { type: 'button', class: 'btn small', 'aria-label': 'One more', text: '+', onclick: () => set(n + 1) })) : null, get n() { return n; } };
  }
  function packsTab() {
    const xs = data.packs.filter((p) => !p.mine).sort((a, b) => a.pricePerEth - b.pricePerEth);
    const wanted = data.offers.filter((o) => o.kind === 'packs' && !o.mine);
    return [
      xs.length ? h('div', { class: 'mk-packs' }, xs.map((p) => {
        const tot = h('span', { class: 'mk-tot', text: ethTxt(p.pricePerEth) });
        const st = stepper(p.amount, (n) => { tot.textContent = ethTxt(p.pricePerEth * n); });
        const buy = h('button', { type: 'button', class: 'btn primary', text: 'Buy', onclick: () => need(async () => { buy.disabled = true; if (await buyPacks(p, st.n)) refresh(); else buy.disabled = false; }) });
        return h('div', { class: 'mk-pack' }, h('img', { src: Store.packThumb(p.series), alt: '', loading: 'lazy' }),
          h('div', { class: 'mk-pinfo' }, h('h3', { text: `Series ${p.series} pack` }), h('span', { class: 'muted', text: `${plural(p.amount, 'pack')} · ${ethTxt(p.pricePerEth)} each` }), h('span', { class: 'mk-seller', text: `From ${Fun.label(p.seller)}` })),
          h('div', { class: 'mk-buy' }, st.el, tot, buy));
      })) : h('p', { class: 'muted', text: 'No packs for sale right now.' }),
      wanted.length ? [h('h3', { text: 'Wanted' }), h('div', { class: 'mk-offers' }, wanted.map(offerRow))] : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', text: 'Make an offer for packs', onclick: () => offerSheet({ kind: 'packs' }) })),
    ];
  }

  // ---------- offers
  /** The best open offer (not yours) that wants card c. */
  function bestFor(c) {
    const os = (data?.offers || (LIVE ? S.offersSeen : demo?.offers) || []).filter((o) => o.qty > 0 && !mine(o.buyer) && o.kind !== 'packs' && wants(o, c));
    return os.sort((a, b) => b.priceEth - a.priceEth)[0] || null;
  }
  const myMatches = (o) => (o.kind === 'packs' ? [] : S.cards.filter((c) => wants(o, c)).sort((a, b) => Store.trueOdds(a).n - Store.trueOdds(b).n));
  function offerWhat(o) {
    if (o.kind === 'packs') return `Series ${o.series} packs`;
    if (o.kind === 'match') return ruleText(o.rule);
    const c = o.card || S.cards.find((x) => x.id === o.cardId || x.serial === o.serial) || data?.cards.find((x) => x.card.serial === o.serial)?.card;
    return c ? `${c.character} · ${kind(c)}` : `Card #${o.serial}`;
  }
  function offerRow(o) {
    const have = o.kind === 'packs' ? (S.sealed[o.series] || 0) : myMatches(o).length;
    const pic = o.kind === 'packs' ? h('img', { class: 'mk-opic', src: Store.packThumb(o.series), alt: '' })
      : o.kind === 'card' && (o.card || S.cards.find((x) => x.id === o.cardId)) ? h('div', { class: 'mk-opic cwrap' }, face(o.card || S.cards.find((x) => x.id === o.cardId)))
      : h('span', { class: 'mk-opic mk-any', 'aria-hidden': 'true', text: 'Any' });
    return h('div', { class: 'mk-offer' + (have && !o.mine ? ' can' : '') }, pic,
      h('div', { class: 'mk-pinfo' }, h('b', { text: offerWhat(o) }),
        h('span', { class: 'mk-oprice', text: `${ethTxt(o.priceEth)}${o.qty > 1 ? ` each · ${o.qty} wanted` : ''}` }),
        h('span', { class: 'mk-seller', text: `${o.mine ? 'Your offer' : Fun.label(o.buyer)} · ${ends(o.expiry)}` })),
      o.mine ? h('button', { type: 'button', class: 'btn small', text: 'Cancel', onclick: async () => { if (await cancelOffer(o)) refresh(); } })
        : have ? h('button', { type: 'button', class: 'btn small primary', text: `Sell yours · ${ethTxt(o.priceEth)}`, onclick: () => acceptSheet(o) }) : null);
  }
  function offersTab() {
    const xs = data.offers.filter((o) => !o.mine).sort((a, b) => (myMatches(b).length || (b.kind === 'packs' && S.sealed[b.series]) ? 1 : 0) - (myMatches(a).length || (a.kind === 'packs' && S.sealed[a.series]) ? 1 : 0) || b.priceEth - a.priceEth);
    return [
      h('div', { class: 'row mk-ohead' }, h('p', { class: 'muted', text: 'What people want. Sell yours when you have one.' }), h('button', { type: 'button', class: 'btn primary', text: 'Make an offer', onclick: () => offerSheet({ kind: 'match' }) })),
      xs.length ? h('div', { class: 'mk-offers' }, xs.map(offerRow)) : h('p', { class: 'muted', text: 'No offers yet.' }),
    ];
  }
  // accept: pick which of your cards (a match offer), or how many packs, then sell
  function acceptSheet(o) {
    const body = h('div', { class: 'st sell' });
    if (o.kind === 'packs') {
      const max = Math.min(o.qty, S.sealed[o.series] || 0), tot = h('b', { text: ethTxt(net(o.priceEth)) });
      const st = stepper(max, (n) => { tot.textContent = ethTxt(net(o.priceEth * n)); });
      const go = h('button', { type: 'button', class: 'btn primary', text: 'Sell', onclick: () => need(async () => { go.disabled = true; if (await accept(o, null, st.n)) { Sheet.close('accept'); refresh(); } else go.disabled = false; }) });
      put(body, h('p', { class: 'mk-big' }, `Series ${o.series} packs at `, h('b', { text: ethTxt(o.priceEth) }), ' each'), st.el, h('p', { class: 'muted' }, 'You get about ', tot), h('div', { class: 'row' }, go));
    } else {
      const cs = myMatches(o);
      let pick = cs[0];
      const grid = h('div', { class: 'mk-grid' });
      const paint = () => put(grid, cs.map((c) => { const b = tile(c, null, () => { pick = c; paint(); }, S.listed[c.id] != null ? `For sale · ${ethTxt(S.listed[c.id])}` : ''); b.setAttribute('aria-pressed', String(c === pick)); return b; }));
      paint();
      const go = h('button', { type: 'button', class: 'btn primary', text: `Sell for ${ethTxt(o.priceEth)}`, onclick: () => need(async () => { if (!pick) return; go.disabled = true; if (await accept(o, pick)) { Sheet.close('accept'); Sheet.close('card'); refresh(); } else go.disabled = false; }) });
      put(body, h('p', { class: 'mk-big' }, offerWhat(o), ': ', h('b', { text: ethTxt(o.priceEth) })),
        cs.length > 1 ? h('p', { class: 'muted', text: 'Pick which of yours to sell.' }) : null, grid,
        h('p', { class: 'muted', text: `You get about ${ethTxt(net(o.priceEth))}` }), h('div', { class: 'row' }, go));
    }
    Sheet.open('accept', { title: 'Sell to this offer', body });
  }
  // make an offer: on one card, on any card like one, from scratch (Series, type, character, holo, grade), or for packs
  async function offerSheet(pre) {
    const r = { fire: 0, cardType: null, mat: null, character: null, charName: null, holo: 'any', minGrade: 0, ...(pre.rule || {}) };
    let k = pre.kind, series = pre.series || S.series.no, qty = 1, days = 30;
    const body = h('div', { class: 'st sell mk-make' });
    const price = h('input', { type: 'text', inputmode: 'decimal', class: 'mk-input', placeholder: '0.01', 'aria-label': 'Price in ETH', value: pre.priceEth || '' });
    const total = h('p', { class: 'muted small mk-get' });
    const upd = () => { const t = price.value.trim(); total.textContent = okPrice(t) ? `${qty > 1 ? `Up to ${ethTxt(+t * qty)} if all ${qty} are filled. ` : ''}${usd(+t * qty)}` : ' '; };
    price.addEventListener('input', upd);
    const seriesList = LIVE ? Array.from({ length: Math.max(1, S.series.no) }, (_, i) => i + 1).reverse() : [7, 6];
    async function paint() {
      let types = MATS.slice(1).map((m, i) => [i, Store.MAT_LABEL[m], m]), chars = Object.keys(Store.CHARS).filter((x) => Store.CHARS[x].series === (r.fire || 6)).map((n, i) => [i, n]);
      if (LIVE) {
        const set = await setOf(r.fire || S.series.no);
        if (set) { types = set.types.map((t, i) => [i, t.name, Live.toMaterial(t.name) || t.name]); chars = set.characters.map((n, i) => [i, n]); }
      }
      const qtyEl = k === 'card' ? null : h('label', { class: 'mk-field' }, h('span', { text: k === 'packs' ? 'How many packs' : 'How many cards' }),
        h('input', { type: 'number', min: '1', max: '50', value: String(qty), class: 'mk-input small', oninput: (e) => { qty = Math.max(1, Math.min(50, +e.target.value || 1)); upd(); } }));
      put(body,
        k === 'card' ? h('div', { class: 'mk-sellcard' }, h('div', { class: 'cwrap' }, face(pre.card, false)), h('div', {}, h('h3', { text: pre.card.character }), h('p', { class: 'muted', text: kind(pre.card) }),
          h('button', { type: 'button', class: 'linkish', text: 'Or any card like this', onclick: () => { k = 'match'; Object.assign(r, likeRule(pre.card)); paint(); } })))
          : k === 'packs' ? h('div', { class: 'mk-bar' }, sel('Series', series, seriesList.map((n) => [n, `Series ${n}`]), (v) => { series = +v; }))
          : [h('p', { class: 'mk-big', text: ruleText(r) }),
            h('div', { class: 'mk-bar mk-rule' },
              sel('Series', r.fire, [[0, 'Any'], ...seriesList.map((n) => [n, `Series ${n}`])], (v) => { r.fire = +v; r.character = null; r.charName = null; paint(); }),
              sel('Type', r.cardType ?? '', [['', 'Any'], ...types.map(([i, n]) => [i, n])], (v) => { r.cardType = v === '' ? null : +v; r.mat = v === '' ? null : types[+v][2]; paint(); }),
              sel('Character', r.character ?? '', [['', 'Any'], ...chars.map(([i, n]) => [i, n])], (v) => { r.character = v === '' ? null : +v; r.charName = v === '' ? null : chars[+v][1]; paint(); }),
              sel('Holo', r.holo, Object.entries({ any: 'Any', none: 'No holo', frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo', anyHolo: 'Any holo' }), (v) => { r.holo = v; paint(); }),
              sel('Grade', r.minGrade, [[0, 'Any'], ...[10, 9, 8, 7, 6, 5].map((g) => [g, `PDA ${g}+`])], (v) => { r.minGrade = +v; paint(); }))],
        h('label', { class: 'mk-field' }, h('span', { text: k === 'card' ? 'Your offer (ETH)' : 'Your offer each (ETH)' }), price),
        qtyEl,
        h('div', { class: 'mk-bar' }, sel('Lasts', days, [[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '90 days']], (v) => { days = +v; })),
        total,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', text: 'Make offer', onclick: (e) => need(async () => {
          const t = price.value.trim();
          if (!okPrice(t)) { toast('Enter a price in ETH, like 0.01', 'bad'); price.focus(); return; }
          e.target.disabled = true;
          const ok = await makeOffer({ kind: k, card: pre.card, rule: { ...r }, series, priceEth: +t, qty: k === 'card' ? 1 : qty, days });
          if (ok) { Sheet.close('offer'); tab = 'mine'; if (document.getElementById('sheet-market')?.open) refresh(); else Fun.open.market({ tab: 'mine' }); } else e.target.disabled = false;
        }) })),
        h('p', { class: 'muted small', text: LIVE ? 'Your ETH stays in your wallet (as WETH, which the wallet asks to wrap) until someone accepts. Cancel any time.' : 'Your ETH stays in your wallet until someone accepts. Cancel any time.' }));
      upd();
    }
    Sheet.open('offer', { title: pre.kind === 'card' ? 'Make an offer' : pre.kind === 'packs' ? 'Offer for packs' : 'Make an offer', body });
    await paint();
  }
  /** "Any card like this": the same Series, type and character, the same holo, at least its grade. */
  const likeRule = (c) => ({ fire: c.series, cardType: LIVE ? c.cardType : MATS.indexOf(c.material) - 1, mat: c.material, character: LIVE ? c.characterIndex : null, charName: c.character,
    holo: c.material === 'gold' || c.material === 'fullart' ? 'any' : holoOf(c), minGrade: c.grade || 0 });

  function activityTab() {
    if (!act) { sales().then((rows) => { act = rows; draw(); }, () => { act = []; draw(); }); return h('p', { class: 'muted', text: 'Loading the newest sales…' }); }
    if (!act.length) return h('p', { class: 'muted', text: 'No sales yet.' });
    return h('ul', { class: 'mk-act' }, act.map((x) => h('li', {},
      x.card ? h('div', { class: 'mk-opic cwrap' }, face(x.card)) : h('img', { class: 'mk-opic', src: Store.packThumb(x.series), alt: '' }),
      h('div', { class: 'mk-pinfo' }, h('b', { text: x.card ? `${x.card.character} · ${kind(x.card)}` : x.kind === 'packs' ? `${plural(x.amount, `Series ${x.series} pack`)}` : `Card #${x.serial}` }),
        h('span', { class: 'mk-seller', text: `${Fun.label(x.seller)} → ${Fun.label(x.buyer)}${x.at ? ' · ' + ago(x.at) : ''}` })),
      h('b', { class: 'mk-price', text: ethTxt(x.priceEth) }))));
  }

  function mineTab() {
    if (LIVE && !S.wallet.connected) return h('div', {}, h('p', { class: 'muted', text: 'Connect your wallet to see and sell yours.' }), h('button', { type: 'button', class: 'btn primary', text: 'Connect', onclick: () => Live.needWallet(() => refresh()) }));
    const cards = data.cards.filter((x) => x.mine), packs = data.packs.filter((p) => p.mine), offers = data.offers.filter((o) => o.mine);
    const extra = h('div');
    if (LIVE) {
      Promise.all([L().owedTo(S.wallet.full).catch(() => '0'), L().wethOf(S.wallet.full).catch(() => null)]).then(([owed, w]) => {
        const free = w ? (BigInt(w.balance) - BigInt(w.committed)) : 0n;
        put(extra,
          +owed > 0 ? h('p', { class: 'mk-owed' }, `${ethTxt(owed)} from a sale is waiting for you. `, h('button', { type: 'button', class: 'btn small primary', text: 'Collect', onclick: () => Live.run('Collect', (o) => L().withdrawOwed(o), 'Collected').then(refresh) })) : null,
          w && BigInt(w.balance) > 0n ? h('p', { class: 'mk-owed' }, `WETH in your wallet: ${ethTxt(Number(w.balance) / 1e18)}${BigInt(w.committed) > 0n ? ` (${ethTxt(Number(w.committed) / 1e18)} for your offers)` : ''}. `,
            free > 0n ? h('button', { type: 'button', class: 'btn small', text: `Turn ${ethTxt(Number(free) / 1e18)} back into ETH`, onclick: () => Live.run('Unwrap', (o) => L().unwrapWeth({ amount: free.toString() }, o), 'Done').then(refresh) }) : null) : null);
      }, () => {});
    }
    return [
      extra,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', text: 'Sell packs', onclick: sellPacks }), h('button', { type: 'button', class: 'btn', text: 'Sell a card', onclick: () => { Sheet.close('market'); Stations.open('cards'); toast('Open a card, then tap Sell', 'good'); } }),
        h('button', { type: 'button', class: 'btn', text: 'Make an offer', onclick: () => offerSheet({ kind: 'match' }) })),
      h('h3', { text: 'Your cards for sale' }),
      cards.length ? h('div', { class: 'mk-grid' }, cards.map((x) => tile(x.card, x.priceEth, () => Fun.open.sell({ id: x.card.id })))) : h('p', { class: 'muted', text: 'None. Open a card in My cards and tap Sell.' }),
      h('h3', { text: 'Your packs for sale' }),
      packs.length ? h('ul', { class: 'mk-mine' }, packs.map((p) => h('li', {}, h('span', { text: `Series ${p.series}: ${plural(p.amount, 'pack')} at ${ethTxt(p.pricePerEth)} each` }),
        h('button', { type: 'button', class: 'btn small', text: 'Take off sale', onclick: async () => { if (await unlistPacks(p)) refresh(); } })))) : h('p', { class: 'muted', text: 'None.' }),
      h('h3', { text: 'Your offers' }),
      offers.length ? h('div', { class: 'mk-offers' }, offers.map(offerRow)) : h('p', { class: 'muted', text: 'None.' }),
      cards.length + packs.length + offers.length > 1 ? h('button', { type: 'button', class: 'btn', text: 'Take everything off sale and cancel my offers', onclick: async () => { if (await cancelAll()) refresh(); } }) : null,
    ];
  }

  // one listed card, big: Buy, Make offer, and its best offer
  function openListing(x) {
    const c = x.card, zoom = () => window.Zoom?.open({ cards: [c], index: 0, face: (y) => face(y, false), name: (y) => `${y.character}, ${kind(y)}`, from: () => document.querySelector('#sheet-mcard .cface') });
    const buy = h('button', { type: 'button', class: 'btn primary', text: `Buy · ${ethTxt(x.priceEth)}`, onclick: () => need(async () => { buy.disabled = true; if (await buyCard(x)) { Sheet.close('mcard'); refresh(); } else buy.disabled = false; }) });
    const best = bestFor(c);
    const body = h('div', { class: 'detail mk-detail' },
      h('div', { class: 'big' }, h('div', { class: 'cwrap', onclick: zoom }, face(c, false), window.Zoom ? Zoom.expandButton(`View ${c.character} full screen`, zoom) : null)),
      h('div', { class: 'traits' },
        h('p', { class: 'mk-kind', text: `${kind(c)} · Series ${c.series}${Store.printNo?.(c) ? ' · #' + Store.printNo(c) : ''}` }),
        h('p', { class: 'mk-big' }, h('b', { text: ethTxt(x.priceEth) }), ' ', h('span', { class: 'muted', text: usd(x.priceEth) })),
        best ? h('p', { class: 'muted', text: `Best offer: ${ethTxt(best.priceEth)}` }) : null,
        h('div', { class: 'row dacts' }, buy, h('button', { type: 'button', class: 'btn', text: 'Make offer', onclick: () => offerSheet({ kind: 'card', card: c }) })),
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
  Fun.open.offer = (o) => offerSheet(o);

  // ---------- selling a card (from its detail)
  Fun.open.sell = ({ id }) => {
    const c = S.cards.find((x) => x.id === id); if (!c) return;
    if (c.pending) { toast('It can be sold once its grading is done', 'bad'); return; }
    const listed = S.listed[id], best = bestFor(c);
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 'mk-input', placeholder: '0.01', value: listed != null ? String(listed) : '', 'aria-label': 'Price in ETH' });
    const get = h('p', { class: 'muted small mk-get' });
    const upd = () => { const t = input.value.trim(); get.textContent = okPrice(t) ? `You get about ${ethTxt(net(t))} ${usd(net(t))}` : ' '; };
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
      best ? h('p', { class: 'mk-owed' }, `Someone offers ${ethTxt(best.priceEth)} for it. `, h('button', { type: 'button', class: 'btn small primary', text: 'Accept', onclick: () => { Sheet.close('sell'); acceptSheet(best); } })) : null,
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
    const set = (v) => { const max = S.sealed[series] || 1; n = Math.max(1, Math.min(max, v)); cnt.textContent = String(n); };
    const pick = h('select', { 'aria-label': 'Which Series', onchange: (e) => { series = +e.target.value; set(1); } }, have.map(([k, v]) => h('option', { value: k, text: `Series ${k} (${v})` })));
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

  // the card detail (screens.js): "Sell" or "For sale · 0.02 ETH", and its best offer with Accept
  Fun.sellLabel = (c) => (S.listed[c.id] != null ? `For sale · ${ethTxt(S.listed[c.id])}` : 'Sell');
  Fun.offerLine = (c) => {
    const o = bestFor(c); if (!o) return null;
    return h('p', { class: 'mk-owed mk-offerline' }, 'Offer: ', h('b', { text: ethTxt(o.priceEth) }), ` from ${Fun.label(o.buyer)} `,
      h('button', { type: 'button', class: 'btn small primary', text: 'Accept', 'data-key': 'accept', onclick: () => acceptSheet(o) }));
  };
  // live: your listings and the offers are read when the wallet connects (the detail's lines)
  if (LIVE) {
    let who = '';
    Store.on(() => { const w = me(); if (w && w !== who && Store.marketOn()) { who = w; listings().then((d) => { data = d; Store.update(() => {}); }, () => {}); } });
  }
})();
