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
  S.series = { no: 0, total: 0, cast: 0, phase: 3, closed: false, closing: false, groups: [], creditGroup: null, creditPacksLeft: 0, left: 0, note: 'Loading…' };
  S.wallet = { connected: false, address: '', full: '', name: '', isPressHolder: false, inSnapshot: false, isContract: false,
    balances: { ETH: 0, PLANK: 0, PAPER: 0, USDG: 0 }, credits: 0, burnCount: 0, boughtIn: {}, pending: [], allowance: { PAPER: 0, PLANK: 0, USDG: 0 } };
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
      console.warn('Live mode:', e?.message || e); fail('Not open yet');
    });
  });
  /** The live code didn't load: an error with a Retry (a reload), never a silent switch to the demo. */
  function cantLoad(e) {
    console.warn('Live mode failed to load', e);
    S.series.note = 'Not connected'; Store.update(() => {});
    const body = document.createElement('div');
    body.innerHTML = '<p class="lead">Couldn\'t load. Check your connection.</p><button class="btn primary go" type="button">Retry</button>';
    body.querySelector('.go').onclick = () => location.reload();
    Sheet.open('chainerr', { title: 'Not connected', body });
  }

  // ---------- small helpers
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const num = (a) => (a ? parseFloat(String(a.text).replace(/,/g, '')) || 0 : 0);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const me = () => FW?.state().address || null;
  const friendly = (e) => (e?.name === 'TxError' ? e.message : FW ? FW.friendly(e) : 'Something went wrong. Try again.').split('\n')[0];
  const MAT = { paper: 'paper', wood: 'wood', fire: 'fire', coal: 'charcoal', charcoal: 'charcoal', diamond: 'diamond', gold: 'gold', 'full art': 'fullart', fullart: 'fullart' };
  // wear: the chain's own age (FireCards.wearOf, seconds), never a guess from the deal time. Cased, pending or slabbed, it's
  // frozen (frozenAge). Raw, the clock runs from now minus that age (`dealt` is when its wear clock started, so a cancelled
  // grading's frozen gap isn't counted); `dealtAt` is the real deal date the card's details show.
  const toCard = (c) => {
    const ageMs = Math.max(0, (c.age || 0) * 1000), frozen = !!c.cased || !!c.gradePending || c.grade != null;
    return {
      id: c.serial, serial: c.serial, series: c.fire, character: c.character || c.name, category: c.category,
      material: MAT[String(c.material).toLowerCase()] || 'paper', holo: c.holo || 'none', edition: String(c.edition), grade: c.grade, pending: !!c.gradePending,
      cased: !!c.cased, moves: c.moves, dealt: Date.now() - ageMs, dealtAt: Math.min(Date.now(), c.dealtAt * 1000), frozenAge: frozen ? ageMs : 0,
      image: gateway(c.image), tokenId: c.serial,
    };
  };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, String(v)); } catch { /* private window */ } return null; };
  const hours = (t) => Math.max(1, Math.ceil((t - Date.now() / 1000) / 3600));

  // ---------- reading the chain into the Store
  // info: the Series now (reads.currentSeries: its drop, status and groups). gate[i]: this wallet's way into NFT group i
  // (the ids it holds or typed in, and what each has used there).
  let info = null, gate = {}, picks = [], syncing = null, cardsAt = 0;
  const snapGroups = (s) => (s?.groups || []).filter((g) => g.gate === 'snapshot' && g.state !== 'ended' && g.root);
  /** A group as the screens use it (ui.js): plain numbers. */
  const toGroup = (g) => {
    const part = g.gate === 'snapshot' && Live.snapshot ? L.snapshotFor(Live.snapshot, g.root) : null; // the holders list can name its group
    const pp = (x) => x && { usd: +x.usd, tax: +x.tax };
    return { ...g, name: part?.name || part?.label || g.name, priceUsd: +g.priceUsd, paper: num(g.paper), next: pp(g.next), after: g.after.map(pp) };
  };
  async function readSeries(fires) {
    const s = await L.currentSeries(fires);
    if (!s) { Object.assign(S.series, { no: 0, total: 0, phase: 4, groups: [], note: 'No Series on sale' }); info = null; return; }
    const was = S.series.phase, ph = s.state === 'closed' ? 4 : 3, changed = info?.fire !== s.fire;
    info = s;
    Store.clockSkew = s.now - Date.now() / 1000; // countdowns run on the chain's clock
    if (changed) { gate = {}; loadSnapshot(s); }
    Object.assign(S.series, {
      no: s.fire, total: s.packs, cast: s.cards.characters, phase: ph, closed: s.state === 'closed', closing: s.closing, cardsPerPack: s.cards.cardsPerPack || 6,
      groups: s.groups.map(toGroup), creditGroup: s.creditGroup, creditPacksLeft: s.status.creditPacksLeft, left: s.status.left,
      note: s.state === 'upcoming' ? `Opens in ${hours(s.start)}h` : s.status.paused ? 'Paused' : null,
    });
    if (was < 4 && ph === 4 && S.series.loaded) { window.Scene?.finale?.(); setTimeout(() => toast(`Series ${s.fire} is closed. Open your packs!`, 'good'), 600); }
    S.series.loaded = true;
    const priced = s.groups.find((g) => +g.priceUsd > 0 && g.state !== 'ended') || s.groups.find((g) => +g.priceUsd > 0);
    const cg = s.groups[s.creditGroup] || priced || s.groups[0];
    Object.assign(Store.PRICES, { PACK_USD: priced ? +priced.priceUsd : 0, PACK_PAPER: cg ? num(cg.paper) : 0 });
    if (priced) L.quoteGroup(s.fire, priced.index, 1).then((q) => { // what a dollar is in each coin now (the estimates the screens show)
      for (const x of q.quotes) if (x.available && num(x.cost) > 0 && x.pay !== 'USDG') Store.PRICES[x.pay + '_USD'] = +q.usd / num(x.cost);
      if (num(q.paperEth) > 0 && num(q.paper) > 0) Store.PRICES.PAPER_USD = num(q.paperEth) * Store.PRICES.ETH_USD / num(q.paper); // PAPER at its market price
    }).catch(() => {});
  }
  async function readRules() {
    const [p, r] = await Promise.all([L.psaPrices().catch(() => null), L.suggestionRules().catch(() => null)]);
    if (p) { Object.assign(Store.PRICES, { CASE_USD: +p.caseUsd, GRADE_USD: +p.gradeUsd }); Store.MAX_BATCH = p.maxBatch; Store.PSA_PAPER_DISCOUNT_BPS = p.paperDiscountBps || 0; }
    if (r) { Store.PRICES.SUGGEST_PAPER = num(r.paperEach); Store.SUGGEST_MAX_BYTES = r.maxBytes; Store.SUGGEST_WAVE.count = r.total; Live.rules = r; }
  }
  // snapshot groups: the holders list published with the drop (ops/snapshot), at holders/series-<n>.json next to the
  // page: each wallet's allowance and proof, checked against the group's root on chain. A list that won't load is
  // retried (5 s, 10 s, 20 s... up to 5 min) while a snapshot group is open or to come, and the buyer is told "try
  // again", never "you're not on it". snap.state: 'none' (no snapshot group), 'loading', 'ok', 'error'
  let snap = { fire: 0, state: 'none', tries: 0, timer: 0, done: Promise.resolve() };
  function loadSnapshot(s) {
    clearTimeout(snap.timer);
    const roots = snapGroups(s).map((g) => g.root);
    if (!roots.length) { snap = { fire: s.fire, state: 'none', tries: 0, timer: 0, done: Promise.resolve() }; Live.snapshot = null; return snap.done; }
    const k = { fire: s.fire, state: 'loading', tries: snap.fire === s.fire ? snap.tries : 0, timer: 0 };
    snap = k;
    k.done = fetch(`holders/series-${s.fire}.json`, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((f) => {
        if (snap !== k) return;
        if (!roots.some((r) => L.snapshotFor(f, r))) throw new Error("it doesn't match this drop's snapshot groups (root)");
        Live.snapshot = f; k.state = 'ok'; S.series.groups = info ? info.groups.map(toGroup) : S.series.groups; Store.update(() => {});
      })
      .catch((e) => {
        if (snap !== k) return;
        console.warn(`Holders list for Series ${s.fire}:`, e?.message || e);
        k.state = 'error'; k.tries++;
        const wanted = () => info?.fire === s.fire && snapGroups(info).length > 0;
        if (wanted()) k.timer = setTimeout(() => { if (snap === k && wanted()) loadSnapshot(info); }, Math.min(300_000, 5_000 * 2 ** Math.min(k.tries - 1, 6)));
        Store.update(() => {});
      });
    return k.done;
  }
  const typedKey = (nft, a) => `omni.nft.${String(nft).toLowerCase()}.${String(a).toLowerCase()}`;
  /** This wallet's NFTs for each NFT group still to come or open: the ids it holds (listed by the collection, or the
   *  one the holder typed in last time, checked again), and what each has used in that group. */
  async function readGates(fire, a) {
    const out = {};
    for (const g of info?.groups || []) {
      if (g.gate !== 'nft' || g.state === 'ended' || !g.nft) continue;
      const [count, held] = await Promise.all([L.nftCount(g.nft, a), L.nftsOf(g.nft, a)]);
      const typed = +(store(typedKey(g.nft, a)) || (g.isPress ? store(`omni.press.${a}`) : 0) || 0);
      const ids = held.length ? held : typed && count && (await L.ownsNft(g.nft, a, typed)) ? [typed] : [];
      const uses = ids.length ? await L.nftUse(fire, g.index, ids).catch(() => ids.map((id) => ({ id, used: 0 }))) : [];
      out[g.index] = { count, ids, uses };
    }
    return out;
  }
  async function readWallet(withCards, fires) {
    const a = me();
    if (!a) { Object.assign(S.wallet, { connected: false, full: '', address: '', credits: 0, burnCount: 0, boughtIn: {}, balances: { ETH: 0, PLANK: 0, PAPER: 0, USDG: 0 } }); S.cards = []; S.sealed = {}; S.suggestions = []; gate = {}; return; }
    const fire = info?.fire;
    const [bal, packs, cr, mine, pn, st, gs] = await Promise.all([L.balances(a), L.packsOf(a, fires), L.credits(a), L.suggestions({ by: a }).catch(() => []),
      L.pressCount(a).catch(() => 0), fire ? L.myGroupStanding(fire, a).catch(() => null) : null, fire ? readGates(fire, a).catch(() => ({})) : {}]);
    if (me() !== a) return; // switched wallets meanwhile
    gate = gs;
    S.wallet.balances = { ETH: num(bal.ETH), PLANK: num(bal.PLANK), PAPER: num(bal.PAPER), USDG: num(bal.USDG) };
    S.wallet.credits = cr.credits; S.wallet.burnCount = cr.burnedTowardNext;
    S.wallet.isPressHolder = pn > 0; S.wallet.boughtIn = st ? Object.fromEntries(st.bought.map((n, i) => [i, n])) : {};
    S.sealed = Object.fromEntries(packs.map((p) => [p.fire, p.count]));
    const round = Live.rules?.round;
    S.suggestions = mine.map((x) => ({ text: x.text, at: x.round === round ? 'Series ' + S.series.no : 'Earlier', picked: x.picked }));
    S.wallet.inSnapshot = snapGroups(info).some((g) => !!(Live.snapshot && L.snapshotEntry(Live.snapshot, g.root, a)));
    if (withCards || Date.now() - cardsAt > 60_000) {
      cardsAt = Date.now(); const cs = (await L.cardsOf(a)).map(toCard);
      // grading is priced by card type (FirePsa.gradeUsdOf): each ungraded card's own price
      const open = cs.filter((c) => c.grade == null && !c.pending).map((c) => c.id);
      const usd = open.length ? await L.gradeUsdOf(open).catch(() => ({})) : {};
      cs.forEach((c) => { if (usd[c.id] > 0) c.gradeUsd = usd[c.id]; });
      if (me() === a) S.cards = cs;
    }
  }
  /** Can this wallet buy in group g now, and how many? { ok, max, access } or { ok: false, why } (ask: the collection
   *  can't list its owners' tokens, so the holder says which NFT; retry: the holders list didn't load yet). */
  Store.groupAccess = (g) => {
    const w = S.wallet, bought = w.boughtIn?.[g.index] || 0, nft = g.isPress ? 'Paper Press' : 'NFT';
    if (!w.connected || !L) return g.gate === 'open' ? { ok: true, max: Math.min(g.perTx || 50, g.left ?? Infinity) } : { ok: false, why: g.who };
    let cap = Infinity, access;
    if (g.gate === 'nft') {
      const x = gate[g.index];
      if (!x?.count) return { ok: false, why: g.who };
      if (!x.ids.length) return { ok: false, ask: true, why: `Pick your ${nft}` };
      const free = x.uses.filter((u) => u.used < g.perNft);
      cap = free.reduce((s, u) => s + g.perNft - u.used, 0);
      if (!cap) return { ok: false, why: `Your ${g.isPress ? 'Press' : nft} already got ${g.perNft === 1 ? 'its pack' : 'its packs'}` };
      access = { nftIds: free.map((u) => u.id) };
    } else if (g.gate === 'snapshot') {
      if (snap.state === 'loading' || snap.state === 'error') return { ok: false, retry: true, why: snap.state === 'loading' ? 'Checking the list…' : 'Couldn\'t check the list. Try again' };
      const e = Live.snapshot ? L.snapshotEntry(Live.snapshot, g.root, me()) : null;
      if (!e) return { ok: false, why: g.who };
      cap = e.allowance - bought;
      if (cap <= 0) return { ok: false, why: `You've hit your limit here (${e.allowance})` };
      access = { allowance: e.allowance, proof: e.proof };
    }
    const max = Math.min(g.perTx || 50, g.left ?? Infinity, g.perWallet ? g.perWallet - bought : Infinity, cap);
    if (max <= 0) return { ok: false, why: g.left === 0 ? 'Sold out' : `Limit: ${g.perWallet} per wallet` };
    return { ok: true, max, access };
  };
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
    bar.innerHTML = (stale ? '<p class="stale">Offline? This may be out of date. <button class="btn small" type="button" data-bar="retry">Retry</button></p>' : '')
      + pend.map((t) => `<p class="pend"><b>${esc(t.label)}</b> · pending${txLink(t.hash)}</p>`).join('');
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
  const landed = (t, outcome) => (outcome === 'success' ? `${t.label}: done` : outcome === 'replaced' ? `${t.label} was cancelled in your wallet.` : `${t.label} failed. Only the network fee was spent.`);
  function resume(a) {
    if (!L || !a) return;
    const list = L.pendingTxs(a).filter((t) => !following.has(t.hash)), these = new Set(list.map((t) => t.hash));
    if (!list.length) return;
    list.forEach((t) => { following.add(t.hash); pend.push(t); });
    paintBar(); Store.update(() => {});
    L.resumePending((t, outcome) => { unpend(t); toast(landed(t, outcome), outcome === 'success' ? 'good' : 'bad'); sync({ cards: true }); }, a, (t) => these.has(t.hash));
  }
  /** A buy, free pack or suggestion of this wallet still on its way (sent from this browser in the last 30 minutes):
   *  starting another of the same kind could pay twice, so it waits. True (and says so) when blocked. */
  const WAIT_FOR = { buy: 'Your last purchase', credits: 'Your last free pack', suggest: 'Your last idea' };
  function stillSending(kind) {
    const a = me(), t = a && L ? L.pendingTxs(a).find((x) => x.kind === kind && Date.now() - x.at < 30 * 60_000) : null;
    if (!t) return false;
    toast(`${WAIT_FOR[kind]} is still pending. Wait for it to finish.`, 'bad');
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
          <div><span>Burn progress</span><b>${w.burnCount % 42} / 42</b></div>
          <div><span>Sealed packs</span><b>${sealed}</b></div>
          <div><span>Cards</span><b>${S.cards.length}</b></div>
          ${pend.length ? `<div><span>Pending</span><b>${pend.length}</b></div>` : ''}
        </div>
        <div class="acts"><button class="btn primary" type="button" data-w="cards">My cards</button><button class="btn" type="button" data-w="paper">Get PAPER</button></div>
        <div class="acts">${FW?.state().modal ? '<button class="btn small" type="button" data-w="acct">Manage wallet</button>' : ''}<button class="btn small" type="button" data-w="out">Disconnect</button></div>
      </div>` });
    d.querySelector('[data-w=cards]').onclick = () => { d.close(); Stations.open('cards'); };
    d.querySelector('[data-w=paper]').onclick = () => { d.close(); getPaper(); };
    d.querySelector('[data-w=acct]')?.addEventListener('click', () => { d.close(); FW.open(); });
    d.querySelector('[data-w=out]').onclick = () => { d.close(); FW.disconnect().catch((e) => toast(friendly(e), 'bad')); };
    window.Profiles?.decorate(d); // profile.js: the avatar, the profile's name and Edit
    window.Fun?.decorateWallet?.(d); // badges, showcase, binder (badges.js)
  }

  // ---------- sending: a step list while the wallet confirms, a toast when it lands, a plain reason when it fails
  // late: sent, but the network hasn't confirmed it within the wait (tx.ts TxStillPending): it's saved and followed
  const STEP = { check: 'Checking…', simulate: 'Checking…', confirm: 'Confirm in your wallet', pending: 'Sending…', late: 'Pending', done: 'Done' };
  // onFail(e): a known refusal the caller shows its own way (true: handled, the step list just closes)
  async function run(title, fn, ok, onFail) {
    const el = document.createElement('div'); el.className = 'txs';
    const steps = []; let err = null, late = false;
    const close = () => { if (el.isConnected) Sheet.close('tx'); }; // not another action's sheet opened since
    const draw = () => {
      el.innerHTML = `<ol class="tx-steps">${steps.map((s) => `<li class="${s.state}"><b>${esc(s.label)}</b><small>${STEP[s.state] || ''}${s.hash ? txLink(s.hash) : ''}</small></li>`).join('') || '<li class="check"><b>Getting ready…</b></li>'}</ol>`
        + (err ? `<p class="warn">${esc(err)}</p><button class="btn primary" type="button" data-x="close">Close</button>`
          : late ? '<p class="muted small">Still pending. Safe to close. Don\'t send it again.</p><button class="btn" type="button" data-x="close">Close</button>'
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
      if (onFail?.(e)) { close(); sync(); return null; }
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
  const need = async () => { await ready; await chainUp; if (!L) throw new Error('Not connected'); };
  const need_ = need; // (getPaper takes an amount called need)
  const requireWallet = () => new Promise((ok) => needWallet(() => ok(true)));

  // ---------- buying: one checkout per group (ui.js draws it; Live.groupApi gets its prices and sends it)
  // Prices: the sheet re-quotes every 15 s while open, and the buy is capped at the price shown + 3% (writes.ts takes
  // the shown quote), so "if the price moves over 3%, nothing is charged" is from what the buyer saw. The wallet must
  // hold that cap (and a little ETH for gas when paying in ETH); anything unused comes back. A rising-price group's
  // next pack costs 4% more once someone else buys: that refusal (PriceMoved) comes back as 'moved', and the sheet
  // shows the new price.
  const SLIP = 1.03, GAS_ETH = 0.0005, REQUOTE = 15_000;
  const capOf = (amt, coin) => (coin === 'USDG' ? amt : amt * SLIP) + (coin === 'ETH' ? GAS_ETH : 0); // what the wallet needs
  /** The collection can't list its owners' tokens: the holder types the number of one they hold (checked on chain:
   *  theirs, and with packs left in this group). Resolves the id, or null. */
  function askNft(g) {
    const what = g.isPress ? 'Paper Press' : 'NFT';
    return new Promise((done) => {
      const f = document.createElement('form'); f.className = 'namef';
      f.innerHTML = `<label for="pressno">Your ${g.isPress ? 'Press' : what} #</label><input id="pressno" inputmode="numeric" autocomplete="off"><button class="btn primary" type="submit">Use</button><p class="muted small"></p>`;
      let ok = false;
      f.onsubmit = async (e) => {
        e.preventDefault(); const id = parseInt(f.querySelector('input').value, 10), a = me(), say = (t) => { f.querySelector('p').textContent = t; };
        if (!(id >= 0) || !a || !(await L.ownsNft(g.nft, a, id))) return say(`That ${what} isn't in this wallet.`);
        const [u] = await L.nftUse(info.fire, g.index, [id]).catch(() => [{ id, used: 0 }]);
        if (u.used >= g.perNft) return say(`That ${g.isPress ? 'Press' : what} already got ${g.perNft === 1 ? 'its pack' : 'its packs'}.`);
        store(typedKey(g.nft, a), id); gate[g.index] = { ...(gate[g.index] || { count: 1 }), ids: [id], uses: [u] }; ok = true; Sheet.close('press'); done(id);
      };
      Sheet.open('press', { title: what, body: f, onClose: () => { if (!ok) done(null); } });
      setTimeout(() => f.querySelector('input').focus(), 50);
    });
  }
  const groupApi = {
    refresh: REQUOTE,
    cap: capOf,
    /** Before the checkout: the wallet, nothing of this kind still on its way, the sale on, and this wallet's way in
     *  (asking which NFT if needed). The access, or null when there's nothing to show (a sheet already said why). */
    async prepare(g) {
      await need(); if (!info) { toast(S.series.note || 'No Series on sale', 'bad'); return null; }
      await requireWallet();
      if (stillSending('buy')) return null;
      if (info.state !== 'live') { Sheet.open('nope', { title: `Series ${info.fire}`, body: `<p class="lead">${info.state === 'upcoming' ? `Opens in ${hours(info.start)}h.` : 'Sold out.'}</p>` }); return null; }
      if (info.status.paused) { Sheet.open('nope', { title: 'Paused', body: '<p class="lead">Sales are paused.</p>' }); return null; }
      let a = Store.groupAccess(g);
      if (a.ask) { if ((await askNft(g)) == null) return null; a = Store.groupAccess(g); }
      if (a.retry) { // the holders list didn't load: not "you're not on it"
        const d = Sheet.open('nope', { title: g.name, body: `<p class="lead">${esc(a.why)}.</p><button class="btn primary go" type="button">Try again</button>` });
        d.querySelector('.go').onclick = async () => { d.close(); await loadSnapshot(info); window.UI.checkout(g.index); };
        return null;
      }
      return a;
    },
    async quote(g, n) {
      const q = await L.quoteGroup(info.fire, g.index, n);
      return {
        usd: +q.usd, tax: +q.tax, paper: num(q.paper), paperEth: q.paperEth ? num(q.paperEth) : null, paperEthRaw: q.paperEth?.raw ?? null,
        coins: q.quotes.map((x) => ({ pay: x.pay, cost: x.cost ? num(x.cost) : null, raw: x.cost?.raw ?? null, available: x.available, reason: x.reason })),
      };
    },
    /** Send it: the shown quote caps it. 'moved': refused because the price moved past the cap (nothing charged). */
    async buy({ g, n, coin, all, q }) {
      if (stillSending('buy')) return false;
      const a = Store.groupAccess(g), quote = { cost: coin ? q.coins.find((c) => c.pay === coin)?.raw : null, paperEth: all ? q.paperEthRaw : null };
      let moved = false;
      const r = await run(`Buy ${plural(n, 'pack')}`, (o) => L.buyPacks({ fire: info.fire, group: g.index, n, pay: coin, access: a.access, paperInEth: all, quote }, o),
        `${plural(n, 'pack')} bought`, (e) => (e?.code === 'PriceMoved' ? (moved = true) : false));
      if (moved) return 'moved';
      if (r) { window.Scene?.buy?.(n); window.Sound?.play('pack-drop'); Store.log(`Bought ${plural(n, 'pack')}`); window.UI?.afterBuy?.(n); window.Fun?.emit('bought', { n }); }
      return !!r;
    },
  };
  async function free() {
    await need(); await requireWallet();
    const cg = S.series.groups[S.series.creditGroup];
    if (!info || info.state !== 'live' || cg?.state !== 'open') return toast('No free-pack sale right now.', 'bad');
    if (S.series.creditPacksLeft === 0) return toast("This Series' free packs are gone. Yours carry over.", 'bad');
    if (stillSending('credits')) return;
    let n = 1; const body = document.createElement('div'); body.className = 'checkout';
    const draw = () => {
      const w = S.wallet; n = Math.max(1, Math.min(w.credits, S.series.creditPacksLeft ?? w.credits, n)); const paper = n * cg.paper, short = w.balances.PAPER < paper;
      body.innerHTML = `<p class="lead">Free packs still cost ${cg.paper} PAPER each.</p>
        ${w.credits > 1 ? `<div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output>${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button><span class="muted">of ${w.credits}</span></div>` : ''}
        <dl class="sum"><dt>PAPER</dt><dd>${paper}</dd><dt>You have</dt><dd>${(+w.balances.PAPER.toFixed(2)).toLocaleString('en-US')} PAPER</dd></dl>
        ${short ? `<div class="getpaper"><p class="warn">Need ${Math.ceil((paper - w.balances.PAPER) * 1e4) / 1e4} more PAPER.</p><button class="btn" type="button" data-getpaper>Get PAPER</button></div>` : ''}
        <button class="btn gold go" type="button" ${short ? 'disabled' : ''}>Use ${n} free ${n === 1 ? 'pack' : 'packs'}</button>`;
      body.querySelector('[data-getpaper]')?.addEventListener('click', () => { Sheet.close('free'); getPaper(Math.ceil((paper - S.wallet.balances.PAPER) * 1e4) / 1e4, () => free()); });
      body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n += +b.dataset.q; draw(); });
      body.querySelector('.go').onclick = async () => {
        const k = n; if (stillSending('credits')) return;
        Sheet.close('free');
        if (await run(`Use ${plural(k, 'free pack')}`, (o) => L.spendCredits({ fire: info.fire, n: k }, o), k === 1 ? 'Free pack on its way' : `${k} free packs on their way`)) { window.Scene?.buy?.(k); window.Sound?.play('pack-drop'); window.UI?.afterBuy?.(k, true); window.Fun?.emit('bought', { n: k }); }
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
        (e) => { if (k === seq) { err = net === 'testnet' ? 'No test pool for this coin. Ask the team for test PAPER.' : friendly(e); paint(); } }), 300);
    };
    const paint = () => {
      const have = S.wallet.balances[tok], cost = num(q?.cost), short = q && cost > have;
      body.querySelector('.sum').innerHTML = `<dt>You pay</dt><dd>${q ? `≈ ${esc(q.cost.text)} ${tok}` : amt > 0 && !err ? 'getting price…' : '—'}</dd>
        <dt>You have</dt><dd>${(+have.toFixed(4)).toLocaleString('en-US')} ${tok}</dd>`;
      body.querySelector('.err').textContent = err || (short ? `Not enough ${tok}.` : '');
      body.querySelector('.fine').textContent = tok === 'ETH' ? '1 tap in your wallet.' : '2 taps: approve, then swap.';
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
  const DIY = 'Skip the wait. Same cards.';
  const sleep = (ms) => new Promise((k) => setTimeout(k, ms));
  async function openPacks(fire, n, say, alive) {
    await need();
    const before = new Set(S.cards.map((c) => c.id));
    if (info?.fire === fire && !info.cards.closed) { toast(`Your Series ${fire} packs open when sales end.`, 'bad'); return null; }
    const r = await run(`Open ${plural(n, 'pack')}`, (o) => L.openPacks({ fire, n }, o));
    if (!r) return null;
    if (r.late || !(r.index >= 0)) { toast('Opened! Your cards land in My cards soon.'); return null; }
    say('Drawing your cards… about 90 seconds');
    for (let asked = false, tried = false; alive();) {
      const op = await L.openStatus(fire, r.index).catch(() => null); // one open by its index: no log scan
      if (op?.status === 'cancelled') { toast('The draw never came. Your packs are back.', 'bad'); sync(); return null; }
      if (op?.status === 'dealt') break;
      if (asked && !tried) { // the buyer tapped "Deal them now"
        tried = true;
        const d = await run('Deal your cards', (o) => L.deliverAndDeal({ fire, index: r.index }, o));
        if (d?.reached) continue;
        say(SAFE);
      } else if (op?.roundAt && op.now >= op.roundAt && !tried) {
        const late = op.now - op.roundAt;
        say(late < LATE ? 'Dealing your cards…' : SAFE,
          late >= OFFER ? { label: 'Deal now (small fee)', note: DIY, fn: () => { asked = true; } } : undefined);
      }
      await sleep(asked && !tried ? 50 : POLL);
    }
    if (!alive()) { toast('Your cards land in My cards soon.'); return null; }
    say('Here they come…');
    const all = (await L.cardsOf(me())).map(toCard);
    const usd = await L.gradeUsdOf(all.filter((c) => c.grade == null).map((c) => c.id)).catch(() => ({}));
    all.forEach((c) => { if (usd[c.id] > 0) c.gradeUsd = usd[c.id]; });
    S.cards = all; cardsAt = Date.now();
    return all.filter((c) => !before.has(c.id) && c.series === fire).sort((a, b) => a.serial - b.serial);
  }

  // ---------- case & grade: priced by FirePsa.quote, capped at the price shown + 3%
  /** Exactly what casing the cards `caseIds` and grading `gradeIds` costs now in `coin` (FirePsa.quoteFor: what
   *  protect charges): an Amount (raw + text), or null. Paying in PAPER while its price can't be read (FeedUnavailable):
   *  null, and Store.PSA_PAPER_OFF says why (the review turns PAPER off); a working PAPER quote clears it. */
  async function quoteProtect(caseIds, gradeIds, coin) {
    await need();
    try {
      const q = await L.quoteProtect(caseIds, gradeIds, coin);
      if (coin === 'PAPER' && Store.PSA_PAPER_OFF) { Store.PSA_PAPER_OFF = null; Store.update(() => {}); }
      return q;
    } catch (e) {
      if (/FeedUnavailable/.test(String(e?.message || e)) && coin === 'PAPER') { Store.PSA_PAPER_OFF = 'PAPER unavailable right now. Pick another coin.'; Store.update(() => {}); }
      return null;
    }
  }
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
    say('Grading… about 90 seconds');
    for (let asked = false, tried = false; alive();) {
      const g = await L.gradingStatus(index).catch(() => null); // one grading by its index: no log scan
      if (g?.status === 'done') break;
      if (asked && !tried) { // the buyer tapped "Reveal them now"
        tried = true;
        if (await run('Reveal the grades', (o) => L.deliverAndFinish({ index, ids }, o))) continue;
        // it didn't go through: they can try again, or leave it (the grades land in My cards once revealed)
        say("Didn't go through. Your cards are safe.",
          { label: 'Try again', note: DIY, fn: () => { asked = true; tried = false; }, alt: { label: 'My cards', fn: () => window.Stations?.open('cards') } });
      } else if (g?.roundAt && g.now >= g.roundAt && !tried) {
        const late = g.now - g.roundAt;
        say(late < LATE ? 'Revealing the grades…' : SAFE,
          late >= OFFER ? { label: 'Reveal now (small fee)', note: DIY, fn: () => { asked = true; } } : undefined);
      }
      await sleep(asked && !tried ? 50 : POLL);
    }
    if (!alive()) return null;
    const cs = await Promise.all(ids.map((id) => L.card(id)));
    sync({ cards: true });
    return new Map(cs.map((c) => [c.serial, c.grade]));
  }

  // ---------- the pop report: every slab that still exists, by Series, material and grade (FirePsa Graded events)
  /** { [series]: { [material]: { [grade]: count } } } */
  async function popReport() {
    await need();
    const out = {};
    for (const x of await L.gradedPop()) {
      const m = MAT[String(x.material).toLowerCase()] || 'paper', s = ((out[x.fire] ??= {})[m] ??= {});
      s[x.grade] = (s[x.grade] || 0) + 1;
    }
    return out;
  }

  // ---------- burning, suggestions
  const burn = async (ids) => { await need(); return run(`Burn ${plural(ids.length, 'card')}`, (o) => L.burnCards({ ids }, o), `Burned ${plural(ids.length, 'card')}`); };
  const suggest = async (texts) => { await need(); if (stillSending('suggest')) return null; return run(texts.length > 1 ? `Send ${texts.length} ideas` : 'Send your idea', (o) => L.suggest({ texts }, o)); };

  window.Live = {
    on: true, net, testnet: net === 'testnet', sync, needWallet, openWallet, run, groupApi, free, getPaper, openPacks, quoteProtect, protect, finishGrading, popReport, burn, suggest,
    walletNeeds: capOf, // what the wallet must hold to pay `amt` in a coin: the cap (+3%, not USDG) and gas for ETH
    rules: null, snapshot: null, get chain() { return L; },
  };
})();
