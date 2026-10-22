/* Omni Cardworks: live mode. Off unless the page is opened with ?live=testnet (or ?live=mainnet once the card
   contracts are on mainnet): without it this file sets window.Live = { on: false } and does nothing else, so the demo
   stays exactly as it is and nothing chain-related is loaded.

   Live: the demo data is cleared, the wallet bundle (vendor/wallet.js: window.ForgeWallet, window.ForgeChain) is
   loaded, and the Store is filled from the contracts (the Series, balances, packs, cards, credits, suggestions) and
   kept fresh. The screens keep their looks and flows; where they would change demo data they call Live instead, which
   sends the transaction through the wallet (a step list while it confirms, a toast when it lands, a plain reason when
   it fails) and then re-reads the chain. Loaded after core.js, before the other modules. */
(() => {
  const q = new URLSearchParams(location.search).get('live');
  const net = q === 'testnet' || q === 'mainnet' ? q : null;
  if (!net) { window.Live = { on: false }; return; }

  const S = Store.state, root = document.documentElement;
  root.classList.add('live', net);

  // ---------- no demo data: an empty wallet and a Series still loading
  Object.assign(S, { demo: false, cards: [], sealed: {}, suggestions: [], activity: [], burned: {}, teases: {} });
  S.series = { no: 0, total: 0, starters: 0, startersClaimed: 0, sold: 0, plankOnly: 0, plankSold: 0, walletLimit: 0, cast: 0, phase: 3, closed: false, note: 'Loading…', pressOpen: false };
  S.wallet = { connected: false, address: '', full: '', name: '', isPressHolder: false, inSnapshot: false, isContract: false,
    balances: { ETH: 0, PLANK: 0, PAPER: 0, USDG: 0 }, credits: 0, burnCount: 0, starterClaimed: false, bought: 0, pending: [], allowance: { PAPER: 0, PLANK: 0, USDG: 0 } };
  Store.SUGGEST_WAVE.closes = null; // the live box has no closing time on chain
  Store.SUGGEST_WAVE.count = 0;

  // the card on screen is the metadata's image for its state now (one image, not a strip); no live holo parts (those
  // exist only for the demo cast), the plain image is drawn
  const gateway = (u) => (String(u).startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + String(u).slice(7) : u);
  Store.cardImg = (c) => c.image || 'ui/card-back.webp';
  Store.cardPos = () => '50% 50%';
  Store.cardParts = () => null;
  Store.needsApproval = () => false; // the chain layer approves exactly what each call needs, as a step of the same action
  Store.floor = () => 0;
  Store.editionInfo = (c) => { const [k, of] = String(c.edition).split(' of ').map((x) => parseInt(x, 10)); const n = of || k || 1; return { k: k || 1, n, burned: 0, lookK: k || 1, lookN: n, lookBurned: 0 }; };
  addEventListener('error', (e) => { const t = e.target; if (t?.classList?.contains('cframe') && !t.src.endsWith('ui/card-back.webp')) t.src = 'ui/card-back.webp'; }, true);

  // ---------- the wallet bundle
  const vendor = document.createElement('script'); vendor.type = 'module'; vendor.src = 'vendor/wallet.js';
  vendor.onerror = () => fail('The wallet code is missing. Run npm run build:wallet.');
  document.head.append(vendor);
  let FW = null, L = null, chainUp = null;
  const ready = new Promise((ok) => {
    const go = () => { FW = window.ForgeWallet; ok(); };
    if (window.ForgeWallet) go(); else addEventListener('forgewallet:ready', go, { once: true });
  });
  function fail(text) { S.series.note = text; Store.update(() => {}); toast(text, 'bad'); }
  ready.then(() => {
    FW.onChange(onWallet);
    chainUp = window.ForgeChain.lib().then((c) => { L = c; return sync({ cards: true }); });
    chainUp.catch((e) => {
      if (net === 'mainnet') { // not on mainnet yet: the demo, as if ?live wasn't there
        const u = new URL(location.href); u.searchParams.delete('live'); location.replace(u.href); return;
      }
      fail(e?.message || String(e));
    });
  });

  // ---------- small helpers
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const num = (a) => (a ? parseFloat(String(a.text).replace(/,/g, '')) || 0 : 0);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const me = () => FW?.state().address || null;
  const friendly = (e) => (e?.name === 'TxError' ? e.message : FW ? FW.friendly(e) : String(e?.message || e)).split('\n')[0];
  const MAT = { paper: 'paper', wood: 'wood', fire: 'fire', coal: 'charcoal', charcoal: 'charcoal', diamond: 'diamond', gold: 'gold', 'full art': 'fullart', fullart: 'fullart' };
  const toCard = (c) => ({
    id: c.serial, serial: c.serial, series: c.fire, character: c.character || c.name, category: c.category,
    material: MAT[String(c.material).toLowerCase()] || 'paper', holo: c.holo || 'none', edition: String(c.edition), grade: c.grade, pending: !!c.gradePending,
    cased: !!c.cased, moves: c.moves, dealt: Math.min(Date.now(), c.dealtAt * 1000), frozenAge: 0, image: gateway(c.image), tokenId: c.serial,
  });
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, String(v)); } catch { /* private window */ } return null; };
  const hours = (t) => Math.max(1, Math.ceil((t - Date.now() / 1000) / 3600));

  // ---------- reading the chain into the Store
  let info = null, presses = [], pressN = 0, proof = null, picks = [], inDrop = null, syncing = null, cardsAt = 0;
  const phaseOf = (s) => (s.state === 'closed' ? 4 : s.phase.plankOnly ? 0 : s.phase.holdersOnly ? 1 : s.walletLimit && !s.phase.limitLifted ? 2 : 3);
  async function readSeries() {
    const s = await L.currentSeries();
    if (!s) { Object.assign(S.series, { no: 0, total: 0, phase: 4, note: 'No Series yet' }); info = null; return; }
    if (info?.fire !== s.fire) { proof = null; loadSnapshot(s.fire); }
    const was = S.series.phase, ph = phaseOf(s);
    info = s;
    Object.assign(S.series, {
      no: s.fire, total: s.packs + s.pressPacks, starters: s.pressPacks, startersClaimed: s.pressClaimed, sold: s.sold, plankOnly: s.plankOnlyPacks,
      plankSold: Math.min(s.sold, s.plankOnlyPacks), walletLimit: s.walletLimit, cast: s.cards.characters, phase: ph, closed: s.state === 'closed',
      pressOpen: s.phase.pressOpen && s.phase.pressLeft > 0, cardsPerPack: s.cards.cardsPerPack || 6,
      note: s.state === 'upcoming' ? `Opens in ${hours(s.start)}h` : s.phase.paused ? 'Paused' : null,
      hours: { window: ph === 0 ? hours(s.plankOnlyEnds) : ph === 1 ? hours(s.holderWindowEnds) : 0, limit: ph === 2 ? hours(s.limitLiftsAt) : 0 },
    });
    if (was < 4 && ph === 4 && S.series.loaded) { window.Scene?.finale?.(); setTimeout(() => toast(`Series ${s.fire} closed. Packs can be opened now.`, 'good'), 600); }
    S.series.loaded = true;
    Object.assign(Store.PRICES, { PACK_USD: +s.priceUsd, PACK_PAPER: num(s.paperPerPack) });
    L.quotePacks(s.fire, 1).then((qs) => { // what a dollar is in each coin now (the estimates the screens show)
      for (const x of qs) if (x.available && num(x.cost) > 0 && x.pay !== 'USDG') Store.PRICES[x.pay + '_USD'] = +s.priceUsd / num(x.cost);
      const e = qs.find((x) => x.pay === 'ETH'); // what PAPER costs now: its market price in ETH, in dollars
      if (num(e?.paperEth) > 0 && num(e?.paper) > 0) Store.PRICES.PAPER_USD = num(e.paperEth) * Store.PRICES.ETH_USD / num(e.paper);
    }).catch(() => {});
  }
  async function readRules() {
    const [p, r] = await Promise.all([L.psaPrices().catch(() => null), L.suggestionRules().catch(() => null)]);
    if (p) { Object.assign(Store.PRICES, { CASE_USD: +p.caseUsd, GRADE_USD: +p.gradeUsd }); Store.MAX_BATCH = p.maxBatch; }
    if (r) { Store.PRICES.SUGGEST_PAPER = num(r.paperEach); Store.SUGGEST_MAX_BYTES = r.maxBytes; Store.SUGGEST_WAVE.count = r.total; Live.rules = r; }
  }
  // the holder window: the snapshot published with the drop (ops/snapshot), at holders/series-<n>.json next to the page
  // TODO: publish the snapshot there when a drop has a holder window (until then only Paper Press holders get in early)
  function loadSnapshot(fire) {
    fetch(`holders/series-${fire}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((f) => { Live.snapshot = f; applyProof(); }).catch(() => {});
  }
  function applyProof() { const a = me(); proof = a && Live.snapshot && L ? L.proofFromSnapshot(Live.snapshot, a) : null; S.wallet.inSnapshot = !!proof; }
  async function readWallet(withCards) {
    const a = me();
    if (!a) { Object.assign(S.wallet, { connected: false, full: '', address: '', credits: 0, burnCount: 0, balances: { ETH: 0, PLANK: 0, PAPER: 0, USDG: 0 } }); S.cards = []; S.sealed = {}; S.suggestions = []; return; }
    const fire = info?.fire;
    const [bal, packs, cr, mine, pr, pn, wd] = await Promise.all([L.balances(a), L.packsOf(a), L.credits(a), L.suggestions({ by: a }).catch(() => []),
      L.pressesOf(a).catch(() => []), L.pressCount(a).catch(() => 0), fire ? L.walletInDrop(fire, a).catch(() => null) : null]);
    if (me() !== a) return; // switched wallets meanwhile
    // a Press that can't list its owners' tokens: the number the holder typed in last time (checked again here)
    const typed = +(store(`omni.press.${a}`) || 0);
    presses = pr.length ? pr : typed && pn && (await L.ownsPress(a, typed)) ? [typed] : []; pressN = pn; inDrop = wd;
    S.wallet.balances = { ETH: num(bal.ETH), PLANK: num(bal.PLANK), PAPER: num(bal.PAPER), USDG: num(bal.USDG) };
    S.wallet.credits = cr.credits; S.wallet.burnCount = cr.burnedTowardNext;
    S.wallet.isPressHolder = pn > 0; S.wallet.starterClaimed = !!wd?.pressPacksClaimed; S.wallet.bought = wd?.paidBought || 0;
    S.sealed = Object.fromEntries(packs.map((p) => [p.fire, p.count]));
    const round = Live.rules?.round;
    S.suggestions = mine.map((x) => ({ text: x.text, at: x.round === round ? 'Series ' + S.series.no : 'Earlier', picked: x.picked }));
    applyProof();
    if (withCards || Date.now() - cardsAt > 60_000) { cardsAt = Date.now(); const cs = await L.cardsOf(a); if (me() === a) S.cards = cs.map(toCard); }
  }
  /** Re-read the chain (cards too with { cards: true }). Calls made while one runs wait for it, then run once more. */
  function sync(o = {}) {
    if (!L) return chainUp || Promise.resolve();
    const run = async () => {
      try {
        await readSeries(); await readRules(); await readWallet(o.cards);
        picks = await L.picks().catch(() => picks);
      } catch (e) { console.warn('Live sync failed', e); }
      Store.update(() => {});
    };
    syncing = (syncing || Promise.resolve()).then(run);
    return syncing;
  }
  setInterval(() => { if (!document.hidden && L) sync(); }, 15_000);

  // results: a wave's winner also wins when the owner's pick for that Series is on chain (FireCredits.SuggestionPicked)
  const resultFor = Store.resultFor;
  Store.resultFor = (w, addr) => {
    const a = String(addr || '').toLowerCase();
    if (a && picks.some((p) => p.fire === w.series && p.by.toLowerCase() === a)) return 'won';
    return resultFor(w, addr);
  };

  // ---------- the wallet
  let lastAddr = null;
  function onWallet(st) {
    const on = st.connected && st.chainOk;
    Object.assign(S.wallet, { connected: on, full: st.address || '', address: st.short || '', name: st.walletName || st.short || '' });
    if (st.address !== lastAddr) { lastAddr = st.address; S.cards = []; S.sealed = {}; sync({ cards: true }); }
    Store.update(() => {});
  }
  function waitConnected(ms = 180_000) {
    return new Promise((ok) => {
      const t = setTimeout(() => { off(); ok(false); }, ms);
      const off = FW.onChange((st) => { if (st.connected) { clearTimeout(t); queueMicrotask(() => off()); ok(true); } });
    });
  }
  async function connect() {
    await ready;
    let how;
    try { how = await FW.open(); } catch (e) { toast(friendly(e), 'bad'); return false; }
    if (FW.state().connected) return true;
    if (how === 'list') walletList();
    return waitConnected();
  }
  // no AppKit (no Reown project id): the installed wallets, by name and icon
  async function walletList() {
    const list = await FW.wallets().catch(() => []);
    const body = document.createElement('div'); body.className = 'wlist';
    body.innerHTML = list.length ? list.map((w, i) => `<button class="btn" type="button" data-i="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="" width="24" height="24">` : ''}${esc(w.name)}</button>`).join('')
      : '<p class="lead">No wallet found. Install MetaMask, Rabby or Coinbase Wallet, then reload.</p>';
    body.querySelectorAll('[data-i]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await FW.connectWith(list[+b.dataset.i].id); Sheet.close('wallets'); } catch (e) { toast(friendly(e), 'bad'); b.disabled = false; }
    });
    Sheet.open('wallets', { title: 'Connect a wallet', body });
  }
  function wrongNet(then) {
    const label = net === 'testnet' ? 'Robinhood Chain Testnet' : 'Robinhood Chain';
    const body = document.createElement('div');
    body.innerHTML = `<p class="lead">Your wallet is on another network.</p><button class="btn primary go" type="button">Switch to ${label}</button>`;
    body.querySelector('.go').onclick = async () => {
      try { await FW.switchNetwork(); Sheet.close('net'); if (FW.state().chainOk) then?.(); } catch (e) { toast(friendly(e), 'bad'); }
    };
    Sheet.open('net', { title: 'Wrong network', body });
  }
  async function needWallet(then) {
    await ready;
    const st = FW.state();
    if (st.connected && st.chainOk) return then?.();
    if (st.connected) return wrongNet(then);
    if (await connect()) { if (FW.state().chainOk) { toast('Wallet connected', 'good'); await sync({ cards: true }); then?.(); } else wrongNet(then); }
  }
  function openWallet() {
    const w = S.wallet, sealed = Object.values(S.sealed).reduce((a, n) => a + n, 0), fmt = (v) => (+v.toFixed(4)).toLocaleString('en-US');
    const d = Sheet.open('wallet', { title: w.name || 'Wallet', body: `
      <div class="wmenu">
        <div class="who"><div class="avatar">${esc((w.name || '?')[0])}</div><div><b>${esc(w.name)}</b><small>${esc(w.address)}</small></div></div>
        <div class="bal">${Object.entries(w.balances).map(([k, v]) => `<div><small>${k}</small><b>${fmt(v)}</b></div>`).join('')}</div>
        <div class="rows">
          <div><span>Free packs</span><b>${w.credits}</b></div>
          <div><span>Burned toward a free pack</span><b>${w.burnCount % 42} / 42</b></div>
          <div><span>Sealed packs</span><b>${sealed}</b></div>
          <div><span>Cards</span><b>${S.cards.length}</b></div>
        </div>
        <div class="acts"><button class="btn primary" type="button" data-w="cards">My cards</button><button class="btn" type="button" data-w="paper">Get PAPER</button></div>
        <div class="acts">${FW?.state().modal ? '<button class="btn small" type="button" data-w="acct">Wallet</button>' : ''}<button class="btn small" type="button" data-w="out">Disconnect</button></div>
      </div>` });
    d.querySelector('[data-w=cards]').onclick = () => { d.close(); Stations.open('cards'); };
    d.querySelector('[data-w=paper]').onclick = () => { d.close(); getPaper(); };
    d.querySelector('[data-w=acct]')?.addEventListener('click', () => { d.close(); FW.open(); });
    d.querySelector('[data-w=out]').onclick = () => { d.close(); FW.disconnect().catch((e) => toast(friendly(e), 'bad')); };
  }

  // ---------- sending: a step list while the wallet confirms, a toast when it lands, a plain reason when it fails
  const STEP = { check: 'Checking…', simulate: 'Checking…', confirm: 'Confirm in your wallet', pending: 'Sending…', done: 'Done' };
  async function run(title, fn, ok) {
    const el = document.createElement('div'); el.className = 'txs';
    const steps = []; let err = null;
    const draw = () => {
      el.innerHTML = `<ol class="tx-steps">${steps.map((s) => `<li class="${s.state}"><b>${esc(s.label)}</b><small>${STEP[s.state] || ''}${s.hash && L?.NET.explorer ? ` · <a href="${esc(L.NET.explorer)}/tx/${esc(s.hash)}" target="_blank" rel="noopener">View</a>` : ''}</small></li>`).join('') || '<li class="check"><b>Getting ready…</b></li>'}</ol>`
        + (err ? `<p class="warn">${esc(err)}</p><button class="btn primary" type="button" data-x="close">Close</button>` : '<p class="muted small">Keep this page open.</p>');
      el.querySelector('[data-x=close]')?.addEventListener('click', () => Sheet.close('tx'));
    };
    const onStep = (state, label, hash) => {
      let s = steps.find((x) => x.label === label && x.state !== 'done');
      if (!s) steps.push((s = { label }));
      s.state = state; if (hash) s.hash = hash; draw();
    };
    draw(); Sheet.open('tx', { title, body: el });
    try {
      const r = await fn({ onStep });
      Sheet.close('tx');
      if (ok) toast(ok, 'good');
      sync({ cards: true });
      return r ?? true;
    } catch (e) {
      err = friendly(e); console.warn(title, e);
      if (/cancelled/i.test(err)) { Sheet.close('tx'); toast(err, 'bad'); } else draw();
      sync();
      return null;
    }
  }
  const need = async () => { await ready; await chainUp; if (!L) throw new Error('Not connected to the chain'); };
  const need_ = need; // (getPaper takes an amount called need)
  const requireWallet = () => new Promise((ok) => needWallet(() => ok(true)));

  // ---------- buying
  function access() { // the holder window: a Paper Press, or the snapshot's proof
    if (!info?.phase.holdersOnly) return undefined;
    if (presses.length) return { pressId: presses[0] };
    return proof ? { proof } : pressN ? 'ask' : null;
  }
  /** The Press can't list its owners' tokens: the holder types the number of one they hold (checked on chain). */
  function askPress() {
    return new Promise((done) => {
      const f = document.createElement('form'); f.className = 'namef';
      f.innerHTML = '<label for="pressno">Your Paper Press number</label><input id="pressno" inputmode="numeric" autocomplete="off"><button class="btn primary" type="submit">Use it</button><p class="muted small"></p>';
      let ok = false;
      f.onsubmit = async (e) => {
        e.preventDefault(); const id = parseInt(f.querySelector('input').value, 10), a = me();
        if (!(id >= 0) || !a || !(await L.ownsPress(a, id))) { f.querySelector('p').textContent = "That Press isn't in this wallet."; return; }
        store(`omni.press.${a}`, id); presses = [id]; ok = true; Sheet.close('press'); done(id);
      };
      Sheet.open('press', { title: 'Paper Press', body: f, onClose: () => { if (!ok) done(null); } });
      setTimeout(() => f.querySelector('input').focus(), 50);
    });
  }
  async function checkout() {
    await need(); if (!info) return toast(S.series.note || 'No Series on sale', 'bad');
    await requireWallet();
    if (info.state !== 'live') return Sheet.open('nope', { title: `Series ${info.fire}`, body: `<p class="lead">${info.state === 'upcoming' ? `Opens in ${hours(info.start)}h.` : 'Sold out.'}</p>` });
    if (info.phase.paused) return Sheet.open('nope', { title: 'Paused', body: '<p class="lead">The sale is paused for now.</p>' });
    let acc = access();
    if (acc === 'ask') { const id = await askPress(); if (id == null) return; acc = { pressId: id }; }
    if (acc === null) return Sheet.open('nope', { title: 'Holders first', body: `<p class="lead">Paper Press and PLANK holders buy first. Everyone else can buy in ${hours(info.holderWindowEnds)}h.</p>` });
    const limitLeft = info.walletLimit && !info.phase.limitLifted ? Math.max(0, info.walletLimit - (inDrop?.paidBought || 0)) : Infinity;
    const max = Math.max(0, Math.min(info.maxPerTx || 50, info.phase.paidLeft, limitLeft));
    if (!max) return Sheet.open('nope', { title: 'Limit reached', body: `<p class="lead">That's this wallet's limit for now. It lifts in ${hours(info.limitLiftsAt)}h.</p>` });
    let n = 1, cur = 'PLANK', quotes = null, seq = 0, ethAll = null; // ethAll null: on when the wallet is short of PAPER
    const body = document.createElement('div'); body.className = 'checkout';
    const requote = () => { const k = ++seq; quotes = null; draw(); L.quotePacks(info.fire, n).then((qs) => { if (k === seq) { quotes = qs; draw(); } }).catch(() => {}); };
    const draw = () => {
      const w = S.wallet, qt = quotes?.find((x) => x.pay === cur), paper = num(quotes?.[0]?.paper) || n * Store.PRICES.PACK_PAPER;
      const shortPaper = w.balances.PAPER < paper, canAll = cur === 'ETH' && qt?.paperEth != null && paper > 0;
      const allOn = canAll && (ethAll ?? shortPaper); // ETH pays for the PAPER too: FireSale buys it on the market and burns it
      const amt = num(qt?.cost) + (allOn ? num(qt.paperEth) : 0), shortCur = qt && w.balances[cur] < amt;
      const needPaper = shortPaper && !allOn, missing = Math.ceil((paper - w.balances.PAPER) * 1e4) / 1e4;
      const off = !quotes || !qt?.available || needPaper || shortCur;
      const paperUsd = paper * (Store.PRICES.PAPER_USD || 0), confirms = allOn ? 1 : cur === 'ETH' ? 2 : 3;
      body.innerHTML = `
        <div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output aria-live="polite">${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button>
          <span class="muted">${n === 1 ? 'pack' : 'packs'} · max ${max}</span></div>
        <div class="seg" role="group" aria-label="Pay with">${quotesCoins().map((c) => `<button type="button" data-c="${c}" aria-pressed="${c === cur}" ${info.phase.plankOnly && c !== 'PLANK' ? 'disabled' : ''}>${c}</button>`).join('')}</div>
        ${info.phase.plankOnly ? `<p class="note">The first ${info.plankOnlyPacks} packs are PLANK only.</p>` : ''}
        <dl class="sum"><dt>Price</dt><dd>${Wear.usd(n * +info.priceUsd)} <small>${!quotes ? '· getting the price…' : qt?.available ? `≈ ${esc(qt.cost.text)} ${cur}` : esc(qt?.reason || 'Not available')}</small></dd>
          <dt>PAPER</dt><dd>${(+paper.toFixed(4)).toLocaleString('en-US')} <small>${paperUsd > 0 ? `≈ ${Wear.usd(paperUsd)} · ` : ''}burned</small></dd>
          ${allOn ? `<dt>Total</dt><dd>≈ ${(+amt.toPrecision(4)).toLocaleString('en-US')} ETH <small>price + PAPER</small></dd>` : ''}
          <dt>You have</dt><dd>${(+w.balances[cur].toFixed(4)).toLocaleString('en-US')} ${cur} <small>· ${(+w.balances.PAPER.toFixed(2)).toLocaleString('en-US')} PAPER</small></dd></dl>
        ${canAll ? `<label class="paycheck"><input type="checkbox" data-all ${allOn ? 'checked' : ''}><span><b>Pay the PAPER in ETH too</b><small>The sale buys the ${(+paper.toFixed(4)).toLocaleString('en-US')} PAPER on the market and burns it. One step, no approval.</small></span></label>` : ''}
        ${needPaper ? `<div class="getpaper"><p class="warn">You need ${missing.toLocaleString('en-US')} more PAPER.</p>${cur === 'ETH' ? '' : `<button class="btn" type="button" data-getpaper>Get ${missing.toLocaleString('en-US')} PAPER</button>`}</div>` : ''}${shortCur ? `<p class="warn">Not enough ${cur}.</p>` : ''}
        <p class="fine">${confirms === 1 ? 'One wallet confirmation.' : `Up to ${confirms} wallet confirmations: approvals first (only what this buy takes), then the buy.`} Packs open once Series ${info.fire} closes. If the price moves over 3%, nothing is charged.</p>
        <button class="btn primary go" type="button" ${off ? 'disabled' : ''}>Buy ${plural(n, 'pack')}</button>`;
      body.querySelector('[data-all]')?.addEventListener('change', (e) => { ethAll = e.target.checked; draw(); });
      body.querySelector('[data-getpaper]')?.addEventListener('click', () => { Sheet.close('buy'); getPaper(missing, () => checkout()); });
      body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(max, n + +b.dataset.q)); requote(); });
      body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; draw(); });
      body.querySelector('.go').onclick = async () => {
        const k = n, coin = cur;
        Sheet.close('buy');
        const all = coin === 'ETH' && (ethAll ?? S.wallet.balances.PAPER < (num(quotes?.[0]?.paper) || k * Store.PRICES.PACK_PAPER)) && quotes?.find((x) => x.pay === 'ETH')?.paperEth != null;
        const r = await run(`Buy ${plural(k, 'pack')}`, (o) => L.buyPacks({ fire: info.fire, n: k, pay: coin, access: acc, paperInEth: all }, o), `${plural(k, 'pack')} bought`);
        if (r) { window.Scene?.buy?.(k); window.Sound?.play('pack-drop'); Store.log(`Bought ${plural(k, 'pack')}`); }
      };
    };
    const quotesCoins = () => (quotes ? quotes.map((x) => x.pay) : ['PLANK', 'ETH', 'USDG']);
    requote(); Sheet.open('buy', { title: 'Buy packs', body, onClose: () => { seq++; } });
  }
  async function press() {
    await need(); await requireWallet();
    if (!pressN) return Sheet.open('nope', { title: 'Press packs', body: '<p class="lead">Press packs are for Paper Press holders.</p>' });
    if (!presses.length && (await askPress()) == null) return;
    const body = document.createElement('div'); body.className = 'checkout';
    body.innerHTML = `<p class="lead">For Paper Press holders. ${info.phase.pressLeft} left.</p><p class="muted">Getting the price…</p>`;
    Sheet.open('starter', { title: 'Press pack', body });
    const pq = await L.quotePress(info.fire, 1, 'ETH').catch(() => null);
    body.innerHTML = `<p class="lead">For Paper Press holders. ${info.phase.pressLeft} left.</p>
      <dl class="sum">${num(pq?.cost) ? `<dt>Price</dt><dd>${esc(pq.cost.text)} ETH</dd>` : ''}<dt>PAPER</dt><dd>${esc(pq?.paper.text ?? '?')} <small>burned</small></dd></dl>
      <button class="btn primary go" type="button">Claim a press pack</button>`;
    body.querySelector('.go').onclick = async () => {
      Sheet.close('starter');
      if (await run('Claim a press pack', (o) => L.claimPressPacks({ fire: info.fire, pressId: presses[0], n: 1, pay: 'ETH' }, o), 'Press pack claimed')) { window.Scene?.buy?.(1); window.Sound?.play('pack-drop'); }
    };
  }
  async function free() {
    await need(); await requireWallet();
    if (!info || info.state !== 'live') return toast('Free packs work while a Series is on sale', 'bad');
    let n = 1; const body = document.createElement('div'); body.className = 'checkout';
    const draw = () => {
      const w = S.wallet; n = Math.max(1, Math.min(w.credits, n)); const paper = n * Store.PRICES.PACK_PAPER, short = w.balances.PAPER < paper;
      body.innerHTML = `<p class="lead">Use any time a Series is on sale. It still takes PAPER.</p>
        ${w.credits > 1 ? `<div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output>${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button><span class="muted">of ${w.credits}</span></div>` : ''}
        <dl class="sum"><dt>PAPER</dt><dd>${paper} <small>burned</small></dd><dt>You have</dt><dd>${(+w.balances.PAPER.toFixed(2)).toLocaleString('en-US')} PAPER</dd></dl>
        ${short ? `<div class="getpaper"><p class="warn">You need ${Math.ceil((paper - w.balances.PAPER) * 1e4) / 1e4} more PAPER.</p><button class="btn" type="button" data-getpaper>Get it</button></div>` : ''}
        <button class="btn gold go" type="button" ${short ? 'disabled' : ''}>Use ${n} free ${n === 1 ? 'pack' : 'packs'}</button>`;
      body.querySelector('[data-getpaper]')?.addEventListener('click', () => { Sheet.close('free'); getPaper(Math.ceil((paper - S.wallet.balances.PAPER) * 1e4) / 1e4, () => free()); });
      body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n += +b.dataset.q; draw(); });
      body.querySelector('.go').onclick = async () => {
        const k = n; Sheet.close('free');
        if (await run(`Use ${plural(k, 'free pack')}`, (o) => L.spendCredits({ fire: info.fire, n: k }, o), k === 1 ? 'Free pack on its way' : `${k} free packs on their way`)) { window.Scene?.buy?.(k); window.Sound?.play('pack-drop'); }
      };
    };
    draw(); Sheet.open('free', { title: S.wallet.credits > 1 ? 'Free packs' : 'Free pack', body });
  }
  // ---------- Get PAPER: the cheapest route (KyberSwap on mainnet, else the PAPER pools), for exactly the PAPER asked for.
  //            `need`: open on that amount (what a checkout was short); `then`: where to go once it's in the wallet.
  async function getPaper(need, then) {
    await need_(); await requireWallet();
    const coins = ['ETH', 'PLANK', ...(L.NET.deployment?.inputs?.USDG ? ['USDG'] : [])];
    let tok = 'ETH', amt = need > 0 ? need : 10, q = null, err = '', seq = 0, t;
    const body = document.createElement('form'); body.className = 'checkout';
    const raw = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
    const requote = () => {
      const k = ++seq; q = null; err = ''; paint(); clearTimeout(t);
      if (!(amt > 0)) return;
      t = setTimeout(() => L.quotePaperBuy(tok, raw(amt), 100).then((r) => { if (k === seq) { q = r; paint(); } },
        (e) => { if (k === seq) { err = net === 'testnet' ? 'No testnet PAPER pool for this coin. Testnet tokens are play tokens: ask the team for some.' : friendly(e); paint(); } }), 300);
    };
    const paint = () => {
      const have = S.wallet.balances[tok], cost = num(q?.cost), short = q && cost > have;
      body.querySelector('.sum').innerHTML = `<dt>You pay</dt><dd>${q ? `≈ ${esc(q.cost.text)} ${tok}` : amt > 0 && !err ? 'getting the best price…' : '—'}</dd>
        <dt>Route</dt><dd>${q ? (q.via === 'kyber' ? 'KyberSwap: the best price across every pool' : 'Straight from the PAPER pools') : '—'}</dd>
        <dt>You have</dt><dd>${(+have.toFixed(4)).toLocaleString('en-US')} ${tok}</dd>`;
      body.querySelector('.err').textContent = err || (short ? `Not enough ${tok}.` : '');
      body.querySelector('.fine').textContent = tok === 'ETH' ? 'One wallet confirmation. Any ETH not needed comes back.' : `Two wallet confirmations: approve exactly this ${tok}, then the swap.`;
      const go = body.querySelector('.go'); go.disabled = !q || !!short; go.textContent = `Get ${amt.toLocaleString('en-US')} PAPER`;
    };
    body.innerHTML = `<div class="seg" role="group" aria-label="Pay with">${coins.map((c) => `<button type="button" data-t="${c}" aria-pressed="${c === tok}">${c}</button>`).join('')}</div>
      <label class="amt" for="paperamt">How much PAPER</label><input id="paperamt" inputmode="decimal" value="${amt}">
      <dl class="sum"></dl><p class="warn err" aria-live="polite"></p><p class="fine"></p>
      <button class="btn primary go" type="submit" disabled></button>`;
    body.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tok = b.dataset.t; body.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); requote(); });
    body.querySelector('#paperamt').oninput = (e) => { const v = parseFloat(e.target.value); amt = Number.isFinite(v) && v > 0 ? v : 0; requote(); };
    body.onsubmit = async (e) => {
      e.preventDefault(); if (!q) return;
      const buy = q, n = amt; Sheet.close('paper');
      if (await run(`Get ${n.toLocaleString('en-US')} PAPER`, (o) => L.buyPaper(buy, o), `+${n.toLocaleString('en-US')} PAPER`)) { Store.log(`Got ${n} PAPER`); if (then) setTimeout(then, 400); }
    };
    Sheet.open('paper', { title: 'Get PAPER', body, onClose: () => { seq++; clearTimeout(t); } });
    requote();
  }

  // ---------- opening: open, wait for the draw (about 90 seconds), deliver it, deal, then reveal what was dealt
  async function openPacks(fire, n, say, alive) {
    await need();
    const before = new Set(S.cards.map((c) => c.id));
    if (info?.fire === fire && !info.cards.closed) { toast(`Packs open once Series ${fire} closes`, 'bad'); return null; }
    const r = await run(`Open ${plural(n, 'pack')}`, (o) => L.openPacks({ fire, n }, o));
    if (!r) return null;
    say('Waiting for the draw. About 90 seconds…');
    for (let failed = 0; alive();) {
      const op = (await L.opensOf(me()).catch(() => [])).find((x) => x.fire === fire && x.index === r.index);
      if (op?.status === 'cancelled') { toast('The draw never came. Your packs are back.', 'bad'); sync(); return null; }
      if (op?.status === 'dealt') break;
      if ((op?.status === 'deliverable' || op?.status === 'ready') && failed < 3) {
        say('Dealing your cards…');
        // the keeper may beat us to it (then this fails and the next look finds the cards dealt)
        if (await run('Deal your cards', (o) => L.deliverAndDeal({ fire }, o))) continue;
        failed++;
      }
      await new Promise((k) => setTimeout(k, 3000));
    }
    if (!alive()) { toast('Your cards land in My cards once dealt'); return null; }
    say('Here they come…');
    const all = (await L.cardsOf(me())).map(toCard);
    S.cards = all; cardsAt = Date.now();
    return all.filter((c) => !before.has(c.id) && c.series === fire).sort((a, b) => a.serial - b.serial);
  }

  // ---------- case & grade
  async function protect(caseIds, gradeIds, coin) {
    await need();
    const what = [caseIds.length ? `case ${plural(caseIds.length, 'card')}` : '', gradeIds.length ? `grade ${plural(gradeIds.length, 'card')}` : ''].filter(Boolean).join(', ');
    return run(what[0].toUpperCase() + what.slice(1), (o) => L.protect({ caseIds, gradeIds, pay: coin }, o), caseIds.length && !gradeIds.length ? 'Cased' : 'Paid');
  }
  /** Wait for a grading's draw, deliver it and reveal the grades. Resolves id -> grade, or null if the window closed. */
  async function finishGrading(index, ids, say, alive) {
    say('At the grader. About 90 seconds…');
    for (let failed = 0; alive();) {
      const g = (await L.gradingsOf(me()).catch(() => [])).find((x) => x.index === index);
      if (g?.status === 'done') break;
      if ((g?.status === 'deliverable' || g?.status === 'ready') && failed < 3) {
        say('Revealing the grades…');
        if (await run('Reveal the grades', (o) => L.deliverAndFinish({ index }, o))) continue;
        failed++;
      }
      await new Promise((k) => setTimeout(k, 3000));
    }
    if (!alive()) return null;
    const cs = await Promise.all(ids.map((id) => L.card(id)));
    sync({ cards: true });
    return new Map(cs.map((c) => [c.serial, c.grade]));
  }

  // ---------- burning, suggestions
  const burn = async (ids) => { await need(); return run(`Burn ${plural(ids.length, 'card')}`, (o) => L.burnCards({ ids }, o), `Burned ${plural(ids.length, 'card')}`); };
  const suggest = async (texts) => { await need(); return run(texts.length > 1 ? `Send ${texts.length} suggestions` : 'Send your suggestion', (o) => L.suggest({ texts }, o)); };

  window.Live = {
    on: true, net, testnet: net === 'testnet', sync, needWallet, openWallet, checkout, press, free, getPaper, openPacks, protect, finishGrading, burn, suggest,
    rules: null, snapshot: null, get chain() { return L; },
  };
})();
