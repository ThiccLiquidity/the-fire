/* Omni Cardworks: live mode. Off unless the page is opened with ?live=testnet (or ?live=mainnet once the card
   contracts are on mainnet), or the build turned it on (VITE_LIVE, written into <meta name="forge-live">; ?live=off
   still shows the demo): see Store.LIVE_NET in core.js. Off, this file sets window.Live = { on: false } and does
   nothing else, so the demo stays exactly as it is and nothing chain-related is loaded.

   Live: the demo data is cleared, the wallet bundle (vendor/wallet.js: window.ForgeWallet, window.ForgeChain) is
   loaded, and the Store is filled from the contracts (the Series, balances, packs, cards, credits, suggestions) and
   kept fresh. The screens keep their looks and flows; where they would change demo data they call Live instead, which
   sends the transaction through the wallet (a step list while it confirms, a toast when it lands, a plain reason when
   it fails) and then re-reads the chain. Loaded after core.js, before the other modules. */
(() => {
  const net = Store.LIVE_NET;
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
  vendor.onerror = () => cantLoad(new Error('vendor/wallet.js did not load'));
  document.head.append(vendor);
  let FW = null, L = null, chainUp = null;
  const ready = new Promise((ok) => {
    const go = () => { FW = window.ForgeWallet; ok(); };
    if (window.ForgeWallet) go(); else addEventListener('forgewallet:ready', go, { once: true });
  });
  function fail(text) { S.series.note = text; Store.update(() => {}); toast(text, 'bad'); }
  ready.then(() => {
    FW.onChange(onWallet);
    chainUp = window.ForgeChain.lib().then((c) => { L = c; resume(me()); return sync({ cards: true }); });
    chainUp.catch((e) => {
      if (e?.name !== 'NotDeployedError') return cantLoad(e); // the code didn't load (a network blip): say so, offer a retry
      if (net === 'mainnet') { // no card contracts on mainnet yet: the demo, as if ?live wasn't there
        const u = new URL(location.href); u.searchParams.delete('live');
        if (document.querySelector('meta[name="forge-live"]')?.content) u.searchParams.set('live', 'off'); // the build says live: say demo
        location.replace(u.href); return;
      }
      fail(e?.message || String(e));
    });
  });
  /** The live code didn't load: an error with a Retry (a reload), never a silent switch to the demo. */
  function cantLoad(e) {
    console.warn('Live mode failed to load', e);
    S.series.note = 'Not connected'; Store.update(() => {});
    const body = document.createElement('div');
    body.innerHTML = '<p class="lead">Couldn\'t load the live site. Check your connection and try again.</p><button class="btn primary go" type="button">Retry</button>';
    body.querySelector('.go').onclick = () => location.reload();
    Sheet.open('chainerr', { title: 'Not connected', body });
  }

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
  let info = null, presses = [], pressUse = [], pressN = 0, proof = null, picks = [], inDrop = null, syncing = null, cardsAt = 0;
  const ZERO = /^0x0{40}$/i, NO_ROOT = /^0x0{64}$/i;
  const phaseOf = (s) => (s.state === 'closed' ? 4 : s.phase.plankOnly ? 0 : s.phase.holdersOnly ? 1 : s.walletLimit && !s.phase.limitLifted ? 2 : 3);
  async function readSeries(fires) {
    const s = await L.currentSeries(fires);
    if (!s) { Object.assign(S.series, { no: 0, total: 0, phase: 4, note: 'No Series yet' }); info = null; return; }
    const was = S.series.phase, ph = phaseOf(s), changed = info?.fire !== s.fire;
    info = s;
    if (changed) { proof = null; loadSnapshot(s); }
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
  // the holder window: the snapshot published with the drop (ops/snapshot), at holders/series-<n>.json next to the page.
  // Checked against the drop's holderRoot on chain; a list that won't load is retried (5 s, 10 s, 20 s... up to 5 min)
  // while the drop hasn't passed its holder window, and the buyer is told "try again", never "you're not on it".
  // snap.state: 'none' (no holder list for this drop: Paper Presses only), 'loading', 'ok', 'error'
  let snap = { fire: 0, state: 'none', tries: 0, timer: 0, done: Promise.resolve() };
  function loadSnapshot(s) {
    clearTimeout(snap.timer);
    if (!s.holderRoot || NO_ROOT.test(s.holderRoot)) { snap = { fire: s.fire, state: 'none', tries: 0, timer: 0, done: Promise.resolve() }; Live.snapshot = null; return snap.done; }
    const k = { fire: s.fire, state: 'loading', tries: snap.fire === s.fire ? snap.tries : 0, timer: 0 };
    snap = k;
    k.done = fetch(`holders/series-${s.fire}.json`, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((f) => {
        if (snap !== k) return;
        if (!f || (f.root && String(f.root).toLowerCase() !== s.holderRoot.toLowerCase())) throw new Error("it doesn't match this drop's holderRoot");
        Live.snapshot = f; k.state = 'ok'; applyProof(); Store.update(() => {});
      })
      .catch((e) => {
        if (snap !== k) return;
        console.warn(`Holder list for Series ${s.fire}:`, e?.message || e);
        k.state = 'error'; k.tries++;
        const wanted = () => info?.fire === s.fire && (info.state === 'upcoming' || info.phase.holdersOnly);
        if (wanted()) k.timer = setTimeout(() => { if (snap === k && wanted()) loadSnapshot(info); }, Math.min(300_000, 5_000 * 2 ** Math.min(k.tries - 1, 6)));
      });
    return k.done;
  }
  function applyProof() {
    const a = me(), p = a && Live.snapshot && L ? L.proofFromSnapshot(Live.snapshot, a) : null;
    proof = p && info && L.verifyHolderProof(p, info.holderRoot, a) ? p : null;
    if (p && !proof) console.warn("The holder list's proof for this wallet doesn't check out against the drop");
    S.wallet.inSnapshot = !!proof;
  }
  const readPressUse = (fire, ids) => (ids.length ? L.pressUse(fire, ids).catch(() => ids.map((id) => ({ id, buyer: '0x' + '0'.repeat(40), claimed: 0 }))) : []);
  async function readWallet(withCards, fires) {
    const a = me();
    if (!a) { Object.assign(S.wallet, { connected: false, full: '', address: '', credits: 0, burnCount: 0, balances: { ETH: 0, PLANK: 0, PAPER: 0, USDG: 0 } }); S.cards = []; S.sealed = {}; S.suggestions = []; return; }
    const fire = info?.fire;
    const [bal, packs, cr, mine, pr, pn, wd] = await Promise.all([L.balances(a), L.packsOf(a, fires), L.credits(a), L.suggestions({ by: a }).catch(() => []),
      L.pressesOf(a).catch(() => []), L.pressCount(a).catch(() => 0), fire ? L.walletInDrop(fire, a).catch(() => null) : null]);
    if (me() !== a) return; // switched wallets meanwhile
    // a Press that can't list its owners' tokens: the number the holder typed in last time (checked again here)
    const typed = +(store(`omni.press.${a}`) || 0);
    presses = pr.length ? pr : typed && pn && (await L.ownsPress(a, typed)) ? [typed] : []; pressN = pn; inDrop = wd;
    pressUse = fire ? await readPressUse(fire, presses) : [];
    S.wallet.balances = { ETH: num(bal.ETH), PLANK: num(bal.PLANK), PAPER: num(bal.PAPER), USDG: num(bal.USDG) };
    S.wallet.credits = cr.credits; S.wallet.burnCount = cr.burnedTowardNext;
    S.wallet.isPressHolder = pn > 0; S.wallet.starterClaimed = !!wd?.pressPacksClaimed; S.wallet.bought = wd?.paidBought || 0;
    S.sealed = Object.fromEntries(packs.map((p) => [p.fire, p.count]));
    const round = Live.rules?.round;
    S.suggestions = mine.map((x) => ({ text: x.text, at: x.round === round ? 'Series ' + S.series.no : 'Earlier', picked: x.picked }));
    applyProof();
    if (withCards || Date.now() - cardsAt > 60_000) { cardsAt = Date.now(); const cs = await L.cardsOf(a); if (me() === a) S.cards = cs.map(toCard); }
  }
  /** Re-read the chain (cards too with { cards: true }). Calls made while one runs wait for it, then run once more.
   *  The log scans behind it are incremental (chain/contracts.ts), so this costs a handful of calls, not the history.
   *  When it fails (the RPC is down or rate-limits), the bar says the data may be out of date and the timer backs off
   *  (15 s, 30 s, 1 min, 2 min); the next success clears it. */
  let fails = 0, nextAt = 0;
  function sync(o = {}) {
    if (!L) return chainUp || Promise.resolve();
    const run = async () => {
      try {
        const fires = await L.seriesNumbers(); // once per sync: the Series and the sealed packs both use it
        await readSeries(fires); await readRules(); await readWallet(o.cards, fires);
        picks = await L.picks().catch(() => picks);
        fails = 0; nextAt = 0; setStale(false);
      } catch (e) {
        fails++; nextAt = Date.now() + Math.min(120_000, 15_000 * 2 ** (fails - 1));
        console.warn('Live sync failed', e); setStale(true);
      }
      Store.update(() => {});
    };
    syncing = (syncing || Promise.resolve()).then(run);
    return syncing;
  }
  setInterval(() => { if (!document.hidden && L && Date.now() >= nextAt) sync(); }, 15_000);

  // ---------- the bar: "may be out of date" while syncing fails, and sent transactions still on their way
  const bar = document.createElement('div'); bar.className = 'live-bar'; bar.setAttribute('role', 'status'); bar.hidden = true;
  const onBody = () => document.body.append(bar);
  if (document.body) onBody(); else addEventListener('DOMContentLoaded', onBody, { once: true });
  let stale = false; const pend = []; // pend: the PendingTx list shown (tx.ts), in the order sent
  S.wallet.pending = pend;
  const txLink = (hash) => (L?.NET.explorer ? ` · <a href="${esc(L.NET.explorer)}/tx/${esc(hash)}" target="_blank" rel="noopener">View</a>` : '');
  function paintBar() {
    bar.innerHTML = (stale ? '<p class="stale">Couldn\'t reach the network. What you see may be out of date. <button class="btn small" type="button" data-bar="retry">Retry</button></p>' : '')
      + pend.map((t) => `<p class="pend"><b>${esc(t.label)}</b> sent, waiting for the network${txLink(t.hash)}</p>`).join('');
    bar.hidden = !stale && !pend.length;
    bar.querySelector('[data-bar=retry]')?.addEventListener('click', () => { nextAt = 0; sync({ cards: true }); });
  }
  function setStale(on) { if (on !== stale) { stale = on; paintBar(); } }

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
    if (st.address !== lastAddr) { lastAddr = st.address; S.cards = []; S.sealed = {}; sync({ cards: true }); resume(st.address); }
    Store.update(() => {});
  }
  // sent transactions that hadn't landed when the page closed (tx.ts keeps them): shown in the bar and followed until
  // they land, then a toast and a fresh read. `following`: the ones this tab already follows (never twice).
  const following = new Set();
  const unpend = (t) => { const i = pend.findIndex((x) => x.at === t.at && x.from === t.from); if (i >= 0) pend.splice(i, 1); paintBar(); Store.update(() => {}); };
  const landed = (t, outcome) => (outcome === 'success' ? `${t.label}: done` : outcome === 'replaced' ? `${t.label} was cancelled or replaced in your wallet.` : `${t.label} failed on the network. Only the network fee was spent.`);
  function resume(a) {
    if (!L || !a) return;
    const list = L.pendingTxs(a).filter((t) => !following.has(t.hash)), these = new Set(list.map((t) => t.hash));
    if (!list.length) return;
    list.forEach((t) => { following.add(t.hash); pend.push(t); });
    paintBar(); Store.update(() => {});
    L.resumePending((t, outcome) => { unpend(t); toast(landed(t, outcome), outcome === 'success' ? 'good' : 'bad'); sync({ cards: true }); }, a, (t) => these.has(t.hash));
  }
  /** A buy, press pack, free pack or suggestion of this wallet still on its way (sent from this browser in the last 30
   *  minutes): starting another of the same kind could pay twice, so it waits. True (and says so) when blocked. */
  const WAIT_FOR = { buy: 'Your last purchase', press: 'Your last press pack', credits: 'Your last free pack', suggest: 'Your last suggestion' };
  function stillSending(kind) {
    const a = me(), t = a && L ? L.pendingTxs(a).find((x) => x.kind === kind && Date.now() - x.at < 30 * 60_000) : null;
    if (!t) return false;
    toast(`${WAIT_FOR[kind]} is still on its way. Wait for it to land first.`, 'bad');
    return true;
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
          ${pend.length ? `<div><span>Waiting for the network</span><b>${pend.length}</b></div>` : ''}
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
  // late: sent, but the network hasn't confirmed it within the wait (tx.ts TxStillPending): it's saved and followed
  const STEP = { check: 'Checking…', simulate: 'Checking…', confirm: 'Confirm in your wallet', pending: 'Sending…', late: 'Sent, waiting for the network', done: 'Done' };
  async function run(title, fn, ok) {
    const el = document.createElement('div'); el.className = 'txs';
    const steps = []; let err = null, late = false;
    const close = () => { if (el.isConnected) Sheet.close('tx'); }; // not another action's sheet opened since
    const draw = () => {
      el.innerHTML = `<ol class="tx-steps">${steps.map((s) => `<li class="${s.state}"><b>${esc(s.label)}</b><small>${STEP[s.state] || ''}${s.hash ? txLink(s.hash) : ''}</small></li>`).join('') || '<li class="check"><b>Getting ready…</b></li>'}</ol>`
        + (err ? `<p class="warn">${esc(err)}</p><button class="btn primary" type="button" data-x="close">Close</button>`
          : late ? '<p class="muted small">It\'s saved: you can close this or reload, and it finishes by itself. Don\'t send it again.</p><button class="btn" type="button" data-x="close">Close</button>'
          : '<p class="muted small">Keep this page open.</p>');
      el.querySelector('[data-x=close]')?.addEventListener('click', close);
    };
    const onStep = (state, label, hash) => {
      let s = steps.find((x) => x.label === label && x.state !== 'done');
      if (!s) steps.push((s = { label }));
      s.state = state; if (hash) s.hash = hash; draw();
    };
    draw(); Sheet.open('tx', { title, body: el });
    try {
      const r = await fn({ onStep });
      close();
      if (ok) toast(ok, 'good');
      sync({ cards: true });
      return r ?? true;
    } catch (e) {
      if (e?.name === 'TxStillPending') return landLate(e);
      err = friendly(e); console.warn(title, e);
      if (/cancelled/i.test(err)) { close(); toast(err, 'bad'); } else draw();
      sync();
      return null;
    }
    // sent, not confirmed yet: not a failure (buying again would pay twice). Wait for it, then finish as usual.
    // Resolves { late: true } once it landed (the receipt's details, e.g. an open's index, aren't known then).
    async function landLate(e) {
      const t = e.tx;
      const s = steps.find((x) => x.hash === t.hash) || steps.filter((x) => x.state === 'pending').pop();
      if (s) { s.state = 'late'; s.hash = t.hash; } else steps.push({ label: t.label, state: 'late', hash: t.hash });
      late = true; draw();
      following.add(t.hash); pend.push(t); paintBar(); Store.update(() => {});
      const outcome = await e.later;
      unpend(t); late = false; sync({ cards: true });
      if (outcome !== 'success') { err = landed(t, outcome); if (el.isConnected) draw(); else toast(err, 'bad'); return null; }
      close();
      if (t.kind === 'approve') { toast('Approved. Tap again to finish.', 'good'); return null; } // the step after it was never sent
      toast(ok || landed(t, outcome), 'good');
      return { late: true };
    }
  }
  const need = async () => { await ready; await chainUp; if (!L) throw new Error('Not connected to the chain'); };
  const need_ = need; // (getPaper takes an amount called need)
  const requireWallet = () => new Promise((ok) => needWallet(() => ok(true)));

  // ---------- buying
  // Prices: the sheet re-quotes every 15 s while open, and the buy is capped at the price shown + 3% (writes.ts takes
  // the shown quote), so "if the price moves over 3%, nothing is charged" is from what the buyer saw. The wallet must
  // hold that cap (and a little ETH for gas when paying in ETH); anything unused comes back.
  const SLIP = 1.03, GAS_ETH = 0.0005, REQUOTE = 15_000;
  const capOf = (amt, coin) => (coin === 'USDG' ? amt : amt * SLIP) + (coin === 'ETH' ? GAS_ETH : 0); // what the wallet needs
  const usable = (u, kind) => (kind === 'claim' ? u.claimed < (info?.pressPacksPerPress || 1) : ZERO.test(u.buyer) || u.buyer.toLowerCase() === me()?.toLowerCase());
  /** The holder window: the snapshot's proof first (it doesn't use up a Press), else a Paper Press that can still let
   *  this wallet in this drop (each Press lets in one wallet per drop). 'ask': the Press can't list tokens, the holder
   *  types its number; 'retry': the holder list didn't load (yet); 'used': this wallet's Presses let others in. */
  function access() {
    if (!info?.phase.holdersOnly) return undefined;
    if (proof) return { proof };
    const p = pressUse.find((u) => usable(u, 'buy'));
    if (p) return { pressId: p.id };
    if (pressN && !presses.length) return 'ask';
    if (snap.state === 'loading' || snap.state === 'error') return 'retry';
    return presses.length ? 'used' : null;
  }
  /** The Press can't list its owners' tokens: the holder types the number of one they hold (checked on chain: theirs,
   *  and still usable for `kind`, 'buy' or 'claim'). */
  function askPress(kind = 'buy') {
    return new Promise((done) => {
      const f = document.createElement('form'); f.className = 'namef';
      f.innerHTML = '<label for="pressno">Your Paper Press number</label><input id="pressno" inputmode="numeric" autocomplete="off"><button class="btn primary" type="submit">Use it</button><p class="muted small"></p>';
      let ok = false;
      f.onsubmit = async (e) => {
        e.preventDefault(); const id = parseInt(f.querySelector('input').value, 10), a = me(), say = (t) => { f.querySelector('p').textContent = t; };
        if (!(id >= 0) || !a || !(await L.ownsPress(a, id))) return say("That Press isn't in this wallet.");
        const [u] = info ? await readPressUse(info.fire, [id]) : [{ id, buyer: '0x' + '0'.repeat(40), claimed: 0 }];
        if (!usable(u, kind)) return say(kind === 'claim' ? 'That Press has claimed its press packs this Series.' : 'That Press already let another wallet in this Series.');
        store(`omni.press.${a}`, id); presses = [id]; pressUse = [u]; ok = true; Sheet.close('press'); done(id);
      };
      Sheet.open('press', { title: 'Paper Press', body: f, onClose: () => { if (!ok) done(null); } });
      setTimeout(() => f.querySelector('input').focus(), 50);
    });
  }
  async function checkout() {
    await need(); if (!info) return toast(S.series.note || 'No Series on sale', 'bad');
    await requireWallet();
    if (stillSending('buy')) return;
    if (info.state !== 'live') return Sheet.open('nope', { title: `Series ${info.fire}`, body: `<p class="lead">${info.state === 'upcoming' ? `Opens in ${hours(info.start)}h.` : 'Sold out.'}</p>` });
    if (info.phase.paused) return Sheet.open('nope', { title: 'Paused', body: '<p class="lead">The sale is paused for now.</p>' });
    let acc = access();
    if (acc === 'ask') { const id = await askPress('buy'); if (id == null) return; acc = { pressId: id }; }
    if (acc === 'retry') { // the holder list didn't load: not "you're not on it"
      const d = Sheet.open('nope', { title: 'Holders first', body: '<p class="lead">Couldn\'t load the holder list. Try again in a moment.</p><button class="btn primary go" type="button">Try again</button>' });
      d.querySelector('.go').onclick = async () => { d.close(); await loadSnapshot(info); checkout(); };
      return;
    }
    if (acc === 'used') return Sheet.open('nope', { title: 'Holders first', body: `<p class="lead">Your Paper Press already let another wallet in this Series. Everyone can buy in ${hours(info.holderWindowEnds)}h.</p>` });
    if (acc === null) return Sheet.open('nope', { title: 'Holders first', body: `<p class="lead">Paper Press and PLANK holders buy first. Everyone else can buy in ${hours(info.holderWindowEnds)}h.</p>` });
    const limitLeft = info.walletLimit && !info.phase.limitLifted ? Math.max(0, info.walletLimit - (inDrop?.paidBought || 0)) : Infinity;
    const max = Math.max(0, Math.min(info.maxPerTx || 50, info.phase.paidLeft, limitLeft));
    if (!max) return Sheet.open('nope', { title: 'Limit reached', body: `<p class="lead">That's this wallet's limit for now. It lifts in ${hours(info.limitLiftsAt)}h.</p>` });
    let n = 1, cur = 'PLANK', quotes = null, seq = 0, ethAll = null; // ethAll null: on when the wallet is short of PAPER
    const body = document.createElement('div'); body.className = 'checkout';
    // quiet: the 15-second refresh (the sheet keeps the old price until the new one is in)
    const requote = (quiet) => {
      const k = ++seq; if (!quiet) { quotes = null; draw(); }
      L.quotePacks(info.fire, n).then((qs) => { if (k === seq && (!quiet || JSON.stringify(qs) !== JSON.stringify(quotes))) { quotes = qs; draw(); } }).catch(() => {});
    };
    const tick = setInterval(() => { if (!body.isConnected) return clearInterval(tick); if (!document.hidden) requote(true); }, REQUOTE);
    const paperOf = () => num(quotes?.[0]?.paper) || n * Store.PRICES.PACK_PAPER;
    const allFor = (coin, qt) => coin === 'ETH' && qt?.paperEth != null && paperOf() > 0 && (ethAll ?? S.wallet.balances.PAPER < paperOf());
    const draw = () => {
      const w = S.wallet, qt = quotes?.find((x) => x.pay === cur), paper = paperOf();
      const shortPaper = w.balances.PAPER < paper, canAll = cur === 'ETH' && qt?.paperEth != null && paper > 0;
      const allOn = allFor(cur, qt); // ETH pays for the PAPER too: FireSale buys it on the market and burns it
      const amt = num(qt?.cost) + (allOn ? num(qt.paperEth) : 0), shortCur = qt && w.balances[cur] < capOf(amt, cur);
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
        ${needPaper ? `<div class="getpaper"><p class="warn">You need ${missing.toLocaleString('en-US')} more PAPER.</p>${cur === 'ETH' ? '' : `<button class="btn" type="button" data-getpaper>Get ${missing.toLocaleString('en-US')} PAPER</button>`}</div>` : ''}${shortCur ? `<p class="warn">Not enough ${cur}${cur === 'USDG' ? '' : `: keep the price + 3%${cur === 'ETH' ? ' and a little for gas' : ''}`}.</p>` : ''}
        <p class="fine">${confirms === 1 ? 'One wallet confirmation.' : `Up to ${confirms} wallet confirmations: approvals first (only what this buy takes), then the buy.`} Packs open once Series ${info.fire} closes. If the price moves over 3%, nothing is charged.${cur === 'ETH' ? ' Your wallet may show up to 3% more; anything unused comes back.' : ''}</p>
        <button class="btn primary go" type="button" ${off ? 'disabled' : ''}>Buy ${plural(n, 'pack')}</button>`;
      body.querySelector('[data-all]')?.addEventListener('change', (e) => { ethAll = e.target.checked; draw(); });
      body.querySelector('[data-getpaper]')?.addEventListener('click', () => { Sheet.close('buy'); getPaper(missing, () => checkout()); });
      body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(max, n + +b.dataset.q)); requote(); });
      body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; draw(); });
      body.querySelector('.go').onclick = async () => {
        const k = n, coin = cur, q = quotes?.find((x) => x.pay === coin);
        if (!q?.available || stillSending('buy')) return;
        const all = allFor(coin, q); // the price shown (and its PAPER in ETH): the buy is capped at that + 3%
        const quote = { cost: q.cost.raw, paperEth: all ? q.paperEth.raw : null };
        Sheet.close('buy');
        const r = await run(`Buy ${plural(k, 'pack')}`, (o) => L.buyPacks({ fire: info.fire, n: k, pay: coin, access: acc, paperInEth: all, quote }, o), `${plural(k, 'pack')} bought`);
        if (r) { window.Scene?.buy?.(k); window.Sound?.play('pack-drop'); Store.log(`Bought ${plural(k, 'pack')}`); }
      };
    };
    const quotesCoins = () => (quotes ? quotes.map((x) => x.pay) : ['PLANK', 'ETH', 'USDG']);
    requote(); Sheet.open('buy', { title: 'Buy packs', body, onClose: () => { seq++; clearInterval(tick); } });
  }
  async function press() {
    await need(); await requireWallet();
    if (stillSending('press')) return;
    if (!pressN) return Sheet.open('nope', { title: 'Press packs', body: '<p class="lead">Press packs are for Paper Press holders.</p>' });
    let id = pressUse.find((u) => usable(u, 'claim'))?.id;
    if (id == null && !presses.length) id = await askPress('claim');
    if (id == null) return presses.length ? Sheet.open('nope', { title: 'Press packs', body: '<p class="lead">Your Paper Press has claimed its press packs this Series.</p>' }) : undefined;
    const body = document.createElement('div'); body.className = 'checkout';
    let pq = null, seq = 0;
    const draw = () => {
      const w = S.wallet, cost = num(pq?.cost), paper = num(pq?.paper), shortEth = cost > 0 && w.balances.ETH < capOf(cost, 'ETH'), shortPaper = pq && w.balances.PAPER < paper;
      body.innerHTML = `<p class="lead">For Paper Press holders. ${info.phase.pressLeft} left.</p>
        ${pq ? `<dl class="sum">${cost ? `<dt>Price</dt><dd>${esc(pq.cost.text)} ETH</dd>` : ''}<dt>PAPER</dt><dd>${esc(pq.paper.text)} <small>burned</small></dd></dl>` : '<p class="muted">Getting the price…</p>'}
        ${shortEth ? '<p class="warn">Not enough ETH: keep the price + 3% and a little for gas.</p>' : ''}${shortPaper ? '<p class="warn">Not enough PAPER.</p>' : ''}
        ${cost ? '<p class="fine">If the price moves over 3%, nothing is charged. Your wallet may show up to 3% more; anything unused comes back.</p>' : ''}
        <button class="btn primary go" type="button" ${!pq || shortEth || shortPaper ? 'disabled' : ''}>Claim a press pack</button>`;
      body.querySelector('.go').onclick = async () => {
        if (!pq || stillSending('press')) return;
        const quote = { cost: pq.cost.raw, paper: pq.paper.raw }; // the caps are built from what was shown
        Sheet.close('starter');
        if (await run('Claim a press pack', (o) => L.claimPressPacks({ fire: info.fire, pressId: id, n: 1, pay: 'ETH', quote }, o), 'Press pack claimed')) { window.Scene?.buy?.(1); window.Sound?.play('pack-drop'); }
      };
    };
    const requote = () => { const k = ++seq; L.quotePress(info.fire, 1, 'ETH').then((q) => { if (k === seq && JSON.stringify(q) !== JSON.stringify(pq)) { pq = q; draw(); } }).catch(() => {}); };
    const tick = setInterval(() => { if (!body.isConnected) return clearInterval(tick); if (!document.hidden) requote(); }, REQUOTE);
    draw(); Sheet.open('starter', { title: 'Press pack', body, onClose: () => { seq++; clearInterval(tick); } });
    requote();
  }
  async function free() {
    await need(); await requireWallet();
    if (!info || info.state !== 'live') return toast('Free packs work while a Series is on sale', 'bad');
    if (stillSending('credits')) return;
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
        const k = n; if (stillSending('credits')) return;
        Sheet.close('free');
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

  // ---------- opening: open, wait for the draw (about 90 seconds), then the keeper delivers it and deals; reveal
  // The keeper does the delivering and dealing. Nothing reaches the wallet unless the buyer asks: if the keeper is
  // late (LATE after the draw is out) the page says so calmly, and from OFFER on it shows a button to finish it
  // themselves (one delivery for the opens up to theirs, one deal: writes.ts deliverAndDeal), used at most once.
  const LATE = 45, OFFER = 120, POLL = 4000;
  const SAFE = "Taking a little longer than usual. Your cards are safe.";
  const DIY = "This finishes it yourself instead of waiting for us. It can't change what you get.";
  const sleep = (ms) => new Promise((k) => setTimeout(k, ms));
  async function openPacks(fire, n, say, alive) {
    await need();
    const before = new Set(S.cards.map((c) => c.id));
    if (info?.fire === fire && !info.cards.closed) { toast(`Packs open once Series ${fire} closes`, 'bad'); return null; }
    const r = await run(`Open ${plural(n, 'pack')}`, (o) => L.openPacks({ fire, n }, o));
    if (!r) return null;
    if (r.late || !(r.index >= 0)) { toast('Opened. Your cards land in My cards once dealt.'); return null; }
    say('Waiting for the draw. About 90 seconds…');
    for (let asked = false, tried = false; alive();) {
      const op = await L.openStatus(fire, r.index).catch(() => null); // one open by its index: no log scan
      if (op?.status === 'cancelled') { toast('The draw never came. Your packs are back.', 'bad'); sync(); return null; }
      if (op?.status === 'dealt') break;
      if (asked && !tried) { // the buyer tapped "Deal them now"
        tried = true;
        const d = await run('Deal your cards', (o) => L.deliverAndDeal({ fire, index: r.index }, o));
        if (d?.reached) continue;
        say(`${SAFE} They land in My cards as soon as they're dealt.`);
      } else if (op?.roundAt && op.now >= op.roundAt && !tried) {
        const late = op.now - op.roundAt;
        say(late < LATE ? 'Dealing your cards…' : SAFE,
          late >= OFFER ? { label: 'Deal them now (small network fee)', note: DIY, fn: () => { asked = true; } } : undefined);
      }
      await sleep(asked && !tried ? 50 : POLL);
    }
    if (!alive()) { toast('Your cards land in My cards once dealt'); return null; }
    say('Here they come…');
    const all = (await L.cardsOf(me())).map(toCard);
    S.cards = all; cardsAt = Date.now();
    return all.filter((c) => !before.has(c.id) && c.series === fire).sort((a, b) => a.serial - b.serial);
  }

  // ---------- case & grade: priced by FirePsa.quote, capped at the price shown + 3%
  /** What casing `cases` and grading `grades` cards costs now in `coin` (an Amount: raw + text), or null. */
  async function quoteProtect(cases, grades, coin) { await need(); return L.quoteProtect(cases, grades, coin).catch(() => null); }
  async function protect(caseIds, gradeIds, coin, quote) {
    await need();
    const what = [caseIds.length ? `case ${plural(caseIds.length, 'card')}` : '', gradeIds.length ? `grade ${plural(gradeIds.length, 'card')}` : ''].filter(Boolean).join(', ');
    const r = await run(what[0].toUpperCase() + what.slice(1), (o) => L.protect({ caseIds, gradeIds, pay: coin, quote: quote?.raw }, o), caseIds.length && !gradeIds.length ? 'Cased' : 'Paid');
    return r?.late ? { gradingIndex: -1, late: true } : r; // landed late: the grades show in My cards once revealed
  }
  /** Wait for a grading's draw (the keeper delivers it and sets the grades; if it's late, the page offers once) and
   *  reveal the grades. Resolves id -> grade, or null if the window closed. */
  async function finishGrading(index, ids, say, alive) {
    if (!(index >= 0)) return null;
    say('At the grader. About 90 seconds…');
    for (let asked = false, tried = false; alive();) {
      const g = await L.gradingStatus(index).catch(() => null); // one grading by its index: no log scan
      if (g?.status === 'done') break;
      if (asked && !tried) { // the buyer tapped "Reveal them now"
        tried = true;
        if (await run('Reveal the grades', (o) => L.deliverAndFinish({ index, ids }, o))) continue;
        say("Taking a little longer than usual. Your cards are safe; the grades land in My cards once revealed.");
      } else if (g?.roundAt && g.now >= g.roundAt && !tried) {
        const late = g.now - g.roundAt;
        say(late < LATE ? 'Revealing the grades…' : SAFE,
          late >= OFFER ? { label: 'Reveal them now (small network fee)', note: DIY, fn: () => { asked = true; } } : undefined);
      }
      await sleep(asked && !tried ? 50 : POLL);
    }
    if (!alive()) return null;
    const cs = await Promise.all(ids.map((id) => L.card(id)));
    sync({ cards: true });
    return new Map(cs.map((c) => [c.serial, c.grade]));
  }

  // ---------- burning, suggestions
  const burn = async (ids) => { await need(); return run(`Burn ${plural(ids.length, 'card')}`, (o) => L.burnCards({ ids }, o), `Burned ${plural(ids.length, 'card')}`); };
  const suggest = async (texts) => { await need(); if (stillSending('suggest')) return null; return run(texts.length > 1 ? `Send ${texts.length} suggestions` : 'Send your suggestion', (o) => L.suggest({ texts }, o)); };

  window.Live = {
    on: true, net, testnet: net === 'testnet', sync, needWallet, openWallet, checkout, press, free, getPaper, openPacks, quoteProtect, protect, finishGrading, burn, suggest,
    walletNeeds: capOf, // what the wallet must hold to pay `amt` in a coin: the cap (+3%, not USDG) and gas for ETH
    rules: null, snapshot: null, get chain() { return L; },
  };
})();
