/* Omni Cardworks (demo mode): the shell. Top bar, wallet, the Buy box and checkout, station pills, the bottom strip,
   the phone layouts, loading screen and the demo menu. Talks to the scene through window.Scene and to the
   station screens / Info through window.Stations and window.Info. */
(() => {
  const S = Store.state, $ = (sel, el = document) => el.querySelector(sel);
  const ICON = {
    flame: '<path d="M12 3c1 3 4 4.5 4 8.5A4 4 0 0 1 8 11.5C8 9 10 8 10 5c1.2.8 2 1.6 2-2z"/><path d="M12 21a6 6 0 0 0 6-6"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
    pack: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h6M12 11v6"/>',
    lens: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
    fire: '<path d="M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2-7 1.5 1 2.5 2 4-4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    paper: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3M9 11h6M9 15h6"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    feed: '<path d="M3 12h4l3-7 4 14 3-7h4"/>', // a pulse: what's happening
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    cards: '<rect x="3.5" y="6" width="11" height="15" rx="1.8"/><path d="M8.5 3.5l9.6 1.7a1.8 1.8 0 0 1 1.5 2.1l-2 11.1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(+n.toFixed(3));
  const { PACK_USD: PRICE, PAPER_USD, ETH_USD, PLANK_USD } = Store.PRICES;

  // ---------- markup
  $('#app').innerHTML = `
  <div id="loading" class="loading"><img src="ui/omni-mark.webp" alt=""><p>Lighting the forge…</p><small class="demo-load">Demo · nothing here is real</small></div>
  <header class="topbar">
    <a class="brand" href="#" aria-label="Omni Cardworks"><img class="mark" src="ui/omni-mark.webp" alt=""><img class="word" src="ui/omni-wordmark.webp" alt="Omni"><span class="forge">CARDWORKS</span><em class="tag">Wood in. Packs out.</em></a>
    <button class="chip series" id="seriesChip" type="button"></button>
    <div class="grow"></div>
    <nav class="tools" aria-label="Tools">
      <button class="chip mycards" type="button" data-st="cards" aria-label="My cards">${svg('cards')}<span>My cards</span></button>
      <button class="chip" type="button" data-go="paper" aria-label="Get PAPER">${svg('paper')}<span>Get PAPER</span></button>
      <button class="chip" type="button" data-go="info" aria-label="Info">${svg('info')}<span>Info</span></button>
      <button class="chip round" type="button" data-go="feed" aria-label="Activity">${svg('feed')}</button>
      <button class="chip round" type="button" id="soundBtn" aria-label="Sound" aria-pressed="${!!window.Sound?.on}">${svg(window.Sound?.on ? 'sound' : 'mute')}</button>
      <button class="chip demo" type="button" data-go="demo">Demo</button>
    </nav>
    <button class="chip round menu-btn" type="button" data-go="menu" aria-label="Menu">${svg('menu')}</button>
    <button class="wallet" id="walletBtn" type="button">${svg('wallet')}<span>Connect</span></button>
  </header>
  <div class="demo-note" role="note"><b>Demo</b><span>Nothing here is real.<span class="dn-more"> No wallet, no payments.</span></span><button class="start-link" type="button" data-go="start">New here?</button></div>
  <div class="ui" id="pills">
    <div class="buybox" id="buybox" data-x="1480" data-y="250"></div>
    <button class="pill" type="button" data-st="burn" data-x="320" data-y="1035" style="--c: var(--fire)">${svg('fire')}<span>Burn<small id="pBurn"></small></span></button>
    <button class="pill openp" type="button" data-st="open" data-x="1385" data-y="1395" style="--c: var(--wood)">${svg('pack')}<span><b id="pOpenT">Open packs</b><small id="pOpen"></small></span></button>
    <button class="pill" type="button" data-st="grade" data-x="2390" data-y="1225" style="--c: var(--diamond)">${svg('lens')}<span>Case &amp; grade<small>${Wear.usd(Store.PRICES.CASE_USD)} · ${Wear.usd(Store.PRICES.GRADE_USD)}</small></span></button>
    <button class="pill" type="button" data-st="suggest" data-x="3590" data-y="1185" style="--c: var(--paper)">${svg('mail')}<span>Suggest<small>${Store.PRICES.SUGGEST_PAPER} PAPER</small></span></button>
    <button class="pill peek" type="button" data-peek data-x="2880" data-y="700" style="--c: var(--gold)"><span class="peek-fan" aria-hidden="true"><img alt=""><img alt=""></span><span><b id="pPeekT">Series 8</b><small id="pPeek"></small></span></button>
  </div>
  <section class="stations" aria-label="Stations">
    <button class="station" type="button" data-st="burn" style="--c: var(--fire)">${svg('fire')}<b>Burn</b><small id="sBurn"></small></button>
    <button class="station" type="button" data-st="cards" style="--c: var(--wood)">${svg('cards')}<b>My cards</b><small id="sCards"></small></button>
    <button class="station" type="button" data-st="grade" style="--c: var(--diamond)">${svg('lens')}<b>Case &amp; grade</b><small>${Wear.usd(Store.PRICES.CASE_USD)} · ${Wear.usd(Store.PRICES.GRADE_USD)}</small></button>
    <button class="station" type="button" data-st="suggest" style="--c: var(--paper)">${svg('mail')}<b>Suggest</b><small>${Store.PRICES.SUGGEST_PAPER} PAPER</small></button>
    <button class="station peek" type="button" data-peek><span class="peek-fan" aria-hidden="true"><img alt=""><img alt=""></span><b id="sPeekT">Series 8</b><small id="sPeek"></small></button>
    <button class="openbtn" type="button" data-st="open" id="openBtn">${svg('pack')}<span><b id="sOpenT">Open packs</b><small id="sOpen"></small></span></button>
  </section>
  <footer class="strip" aria-label="What's in a pack">
    <img class="packart" src="ui/omni-pack.webp" alt="Series 7 pack">
    <div class="what">
      <h3><b class="sw">SERIES 7</b> PACK<span>6 cards</span></h3>
      <table class="types" aria-label="Cards in a pack">
        <tr><th scope="row">Material</th><td><span class="mat paper">Paper</span></td><td><span class="mat wood">Wood</span></td><td><span class="mat fire">Fire</span></td><td><span class="mat charcoal">Coal</span></td><td><span class="mat gold">Gold</span></td><td><span class="mat fullart">Full Art</span></td></tr>
        <tr><th scope="row">Per pack</th><td>3</td><td>1–2</td><td colspan="4" class="span">At least 1</td></tr>
      </table>
    </div>
    <button class="btn small more" type="button" data-go="info-cards">Rarity</button>
  </footer>
  <div class="buybar" id="buybar"></div>`;

  // ---------- layout: desktop / phone portrait / phone landscape
  const TOP = 54 + 24; // the top bar plus the demo notice under it (CSS --top)
  const DEMO_LINE = '<p class="demo-line">Demo · nothing is charged</p>'; // the one demo line, at payment and burn buttons only
  let mode = 'desk';
  function layout() {
    const W = innerWidth, H = innerHeight, bar = TOP;
    mode = W < 700 && H > W ? 'port' : H < 520 ? 'land' : 'desk';
    document.body.dataset.mode = mode;
    if (!window.Scene) return;
    if (mode === 'port') {
      const bb = document.querySelector('.buybar')?.offsetHeight || 190, st = document.querySelector('.stations')?.offsetHeight || 150;
      const sh = Math.round(Math.max(160, Math.min(H * 0.42, W * 0.9, H - bar - st - bb - 24))); // stations must stay clear of the Buy bar on short phones
      Scene.setView({ x: 0, y: bar, w: W, h: sh, mode: 'cover', focus: 0.42, follow: true }); // the camera follows the action
      document.documentElement.style.setProperty('--sceneH', sh + 'px');
    } else if (mode === 'land') {
      Scene.setView({ x: 0, y: bar, w: W - 240, h: H - bar, mode: 'contain', follow: false });
    } else {
      const strip = H < 760 ? 92 : 104; document.documentElement.style.setProperty('--stripH', strip + 'px');
      Scene.setView({ x: 0, y: bar, w: W, h: H - bar - strip, mode: 'contain', follow: false });
    }
    placePills(); if (S.wallet) renderCounts();
  }
  function placePills() {
    if (!window.Scene) return;
    const k = Scene.scale, fs = Math.max(12, Math.min(14, 30 * k));
    document.documentElement.style.setProperty('--fs', fs + 'px');
    for (const el of document.querySelectorAll('#pills [data-x]')) {
      let [x, y] = Scene.toScreen(+el.dataset.x, +el.dataset.y);
      const half = el.offsetWidth / 2 + 8; x = Math.max(half, Math.min(innerWidth - half, x)); // never off-screen
      el.style.left = x + 'px'; el.style.top = Math.max(TOP + el.offsetHeight / 2 + 6, y) + 'px';
    }
  }
  addEventListener('resize', layout);

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); // for text typed by people (names)
  // ---------- the Series: phases, numbers, chip
  const PH = [
    { line: 'Holders first', window: 17, sub: 'PLANK only', plankOnly: true },
    { line: 'Holders first', window: 9, sub: 'PLANK, ETH or USDG' },
    { line: 'Open to all', limit: 14, sub: () => `Max ${S.series.walletLimit} each` },
    { line: 'Open to all', sub: 'PLANK, ETH or USDG' },
  ];
  const sold = () => S.series.phase >= 4;
  function syncScene() {
    const ph = PH[S.series.phase];
    window.Scene?.setState({ left: Store.left(), total: S.series.total, burnCount: S.wallet.burnCount, series: S.series.no, windowFrac: ph?.window ? ph.window / 24 : 0, openable: Stations.openableCount() > 0 });
  }
  function renderChip() {
    const ph = PH[S.series.phase], c = $('#seriesChip');
    const html = sold() ? `Series ${S.series.no} · <b>Sold out</b>` : `Series ${S.series.no} · <b>${Store.left()}</b> left · ${ph.line}${ph.window ? ` <i>${ph.window}h</i>` : ''}`;
    if (c._html !== html) { c._html = html; c.innerHTML = html; } // only on a real change: a node swapped under a click eats it
  }
  function buyButtons() {
    const ph = PH[S.series.phase], w = S.wallet, out = [];
    if (sold()) return { line: `Series ${S.series.no} sold out`, opts: [] }; // just the tease: Open packs is already on the scene / in the stations
    let sub2 = ph.plankOnly ? `PLANK-only packs: ${S.series.plankOnly - S.series.plankSold} left` : typeof ph.sub === 'function' ? ph.sub() : ph.sub;
    out.push(['buy', 'Buy packs', `${Wear.usd(PRICE)} + PAPER<br>${sub2}`, 'main']);
    if (S.series.phase <= 1 && !w.starterClaimed && S.series.startersClaimed < S.series.starters) out.push(['starter', 'Press pack', `Press holders<br>${Store.PRICES.PRESS_PAPER} PAPER`, 'alt']);
    if (w.credits > 0) out.push(['free', `Free pack (${w.credits})`, `${Store.PRICES.PACK_PAPER} PAPER<br>any time`, 'gold']);
    return { line: ph.window ? `${ph.line} · ${ph.window}h left` : ph.limit ? `${ph.line} · max ${S.series.walletLimit} for ${ph.limit}h` : ph.line, opts: out };
  }
  // Background Store updates (other buyers, burns landing) must never re-create these buttons under a click or a
  // keyboard focus: the boxes are rebuilt only when what they show changes, else just the bar's header text is patched;
  // a rebuild puts focus back on the same button (by its data-buy key).
  let buyKey = '';
  function renderBuy() {
    const { line, opts } = buyButtons(), t = Store.tease(), tease = t && !t.live ? t : null;
    const head = sold() ? line : `${Store.left()} left · ${line}`; // phones: no Series chip up top, so the bar's header says how many are left
    const key = JSON.stringify([line, opts, tease && [tease.no, tease.id, tease.line], sold()]);
    if (key === buyKey) { const ph = $('#buybar .phase'); if (ph && ph.textContent !== head) ph.textContent = head; return; }
    buyKey = key;
    const a = document.activeElement, box = a?.closest?.('#buybox, #buybar');
    const back = box && (a.dataset.buy ? `#${box.id} [data-buy="${a.dataset.buy}"]` : a.classList.contains('tease-inline') ? `#${box.id} .tease-inline` : null);
    const optsHtml = (list) => list.length ? '<div class="opts">' + list.map(([k, t, sub, cls]) =>
      `<button class="opt ${cls}" type="button" data-buy="${k}">${k === 'buy' ? '<img class="mini" src="../build3/pack.webp" alt="">' : ''}<span>${t}${sub ? `<small>${sub}</small>` : ''}</span></button>`).join('') + '</div>' : '';
    $('#buybox').innerHTML = `<div class="phase"></div>${optsHtml(opts)}`; $('#buybox .phase').textContent = line;
    // sold out, the stations' Open packs is enough
    $('#buybar').innerHTML = `<div class="phase"></div>${optsHtml(sold() ? [] : opts)}`; $('#buybar .phase').textContent = head;
    // between Series: the next Series' tease sits right here on the main page
    if (tease) for (const box of [$('#buybox'), $('#buybar')]) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'tease-inline'; card.setAttribute('aria-label', `Series ${tease.no}: ${tease.line}`);
      card.innerHTML = `<span class="ti-fan"></span><span class="ti-text"><b>Series ${tease.no}</b><small>${tease.line}</small></span>`;
      card.onclick = () => Announce.open();
      card.querySelector('.ti-fan').append(Announce.fan(tease, { mini: true }));
      box.querySelector('.phase').after(card);
    }
    $('#buybox').classList.toggle('calm', sold()); $('#buybar').classList.toggle('calm', sold());
    for (const b of document.querySelectorAll('[data-buy]')) b.onclick = () => ({ buy: checkout, starter, free: useFree, open: () => openStation('open'), cards: () => openStation('cards'), announce: () => Announce.open() })[b.dataset.buy]?.();
    if (back) $(back)?.focus({ preventScroll: true });
  }
  // the peek buttons: what's in the Series on sale (sold out, the next one's tease sits in the Buy box / bar instead)
  function renderPeek() {
    const t = Store.tease(), show = !!t?.live;
    document.querySelectorAll('[data-peek]').forEach((b) => { b.hidden = !show; });
    if (!show) return;
    document.querySelectorAll('.peek-fan img').forEach((im, i) => { const src = `ui/announce/${t.id}-${i % 2 ? 'fullart' : 'gold'}.webp`; if (im.getAttribute('src') !== src) im.src = src; }); // this Series' own cards
    $('#pPeekT').textContent = $('#sPeekT').textContent = `Series ${t.no}`;
    $('#pPeek').textContent = $('#sPeek').textContent = t.line;
    document.querySelectorAll('[data-peek]').forEach((b) => b.setAttribute('aria-label', `Series ${t.no}`));
  }
  function renderCounts() {
    const sealed = Object.values(S.sealed).reduce((a, b) => a + b, 0), b = S.wallet.burnCount % 42;
    for (const id of ['pBurn', 'sBurn']) $('#' + id).textContent = `${b} / 42`;
    // Open packs: what can be opened now (the live Series' packs stay sealed until it sells out)
    const ready = Stations.openable(), n = ready.reduce((a, o) => a + o.n, 0), locked = sealed - n;
    const title = n ? `Open packs (${n})` : 'No packs', sub = n ? `Series ${ready[0].series}${ready.length > 1 ? ' first' : ''}` : locked ? 'Open at sell-out' : 'Buy one first';
    const why = n ? `Open packs: ${n} sealed ${n === 1 ? 'pack' : 'packs'} ready to open` : locked
      ? `No packs to open yet. Your ${locked} Series ${S.series.no} ${locked === 1 ? 'pack opens' : 'packs open'} when the Series sells out`
      : 'No packs to open. Buy packs to get some';
    for (const [t, s, b] of [['pOpenT', 'pOpen', '.pill.openp'], ['sOpenT', 'sOpen', '#openBtn']]) {
      $('#' + t).textContent = title; $('#' + s).textContent = sub;
      const el = $(b); el.classList.toggle('none', !n); el.setAttribute('aria-label', why); el.setAttribute('aria-disabled', String(!n));
    }
    $('#sCards').textContent = `${S.cards.length} ${S.cards.length === 1 ? 'card' : 'cards'} · ${sealed} ${sealed === 1 ? 'pack' : 'packs'}`;
    const wb = $('#walletBtn span');
    const nm = mode === 'port' || innerWidth < 1500 ? '' : S.wallet.name; // phones: the icon and the balance, so the button fits beside the brand
    wb.textContent = S.wallet.connected ? `${nm ? nm + ' · ' : ''}${S.wallet.balances.PAPER} PAPER` : 'Connect';
    $('#walletBtn').classList.toggle('on', S.wallet.connected);
  }
  let bbH = 0;
  function render() {
    renderChip(); renderBuy(); renderPeek(); renderCounts(); syncScene(); placePills();
    const h = mode === 'port' ? $('#buybar').offsetHeight : 0; if (h !== bbH) { bbH = h; if (h) layout(); } // the Buy bar changed height: keep the stations clear of it
  }
  Store.on(render);

  // ---------- wallet
  function needWallet(then) { // demo: one click connects a demo wallet; the real site opens the standard wallet window
    if (S.wallet.connected) return then();
    Store.update((s) => { s.wallet.connected = true; });
    toast('Demo wallet connected', 'good');
    setTimeout(then, 200);
  }
  $('#walletBtn').onclick = () => needWallet(openWallet);
  function openWallet() {
    const w = S.wallet, nm = esc(w.name), sealed = Object.values(S.sealed).reduce((a, n) => a + n, 0);
    const d = Sheet.open('wallet', { title: w.name || 'Wallet', body: `
      <div class="wmenu">
        <div class="who"><div class="avatar">${esc((w.name || '?')[0])}</div><div><b>${nm || 'No name yet'}</b><small>${esc(w.address)}</small></div><button class="btn small" type="button" data-w="name">Edit</button></div>
        <div class="bal">${Object.entries(w.balances).map(([k, v]) => `<div><small>${k}</small><b>${fmt(v)}</b></div>`).join('')}</div>
        <div class="rows">
          <div><span>Free packs</span><b>${w.credits}</b></div>
          <div><span>Burned toward a free pack</span><b>${w.burnCount % 42} / 42</b></div>
          <div><span>Sealed packs</span><b>${sealed}</b></div>
          <div><span>Cards</span><b>${S.cards.length}</b></div>
          ${w.pending.length ? `<div><span>Pending</span><b>${w.pending.length}</b></div>` : ''}
        </div>
        <div class="acts"><button class="btn primary" type="button" data-w="cards">My cards</button><button class="btn" type="button" data-w="paper">Get PAPER</button></div>
        <div class="acts"><button class="btn small" type="button" data-w="switch">Switch wallet</button><button class="btn small" type="button" data-w="out">Disconnect</button></div>
      </div>` });
    d.querySelector('[data-w=cards]').onclick = () => { d.close(); openStation('cards'); };
    d.querySelector('[data-w=paper]').onclick = () => { d.close(); openGetPaper(); };
    d.querySelector('[data-w=out]').onclick = () => { d.close(); Store.update((s) => { s.wallet.connected = false; }); };
    d.querySelector('[data-w=switch]').onclick = () => { d.close(); Store.update((s) => { s.wallet.connected = false; }); needWallet(openWallet); };
    d.querySelector('[data-w=name]').onclick = () => {
      const f = document.createElement('form'); f.className = 'namef';
      f.innerHTML = `<label for="nm">Name</label><input id="nm" maxlength="24" value="${esc(w.name)}"><button class="btn primary" type="submit">Save</button>`;
      f.onsubmit = (e) => { e.preventDefault(); Store.update((s) => { s.wallet.name = $('#nm', f).value.trim(); }); openWallet(); };
      Sheet.open('wallet', { title: 'Your name', body: f });
    };
  }

  // ---------- approvals (demo). FireSale takes PAPER for every pack (paid, Press or free) and every suggestion, and PLANK
  // or USDG for a paid pack, so each needs an ERC-20 approval first. What's approved is the most that call may take
  // (maxPaper / maxCost), never unlimited, and the call uses it up.
  function approveNow(tok, amount, done) {
    setTimeout(() => { Store.update(() => Store.approve(tok, amount)); toast(`${tok} approved`, 'good'); done?.(); }, 900);
  }
  // redraw a sheet's body, keeping keyboard focus on the same control (its data key, or the main button)
  function redraw(body, draw) {
    const a = document.activeElement, inside = body.contains(a);
    const key = inside ? (['data-q', 'data-c', 'data-t', 'data-x'].map((k) => a.hasAttribute(k) && `[${k}="${a.getAttribute(k)}"]`).find(Boolean) || (a.classList.contains('go') ? '.go' : null)) : null;
    draw();
    if (key) body.querySelector(key)?.focus({ preventScroll: true });
  }
  // while a sheet is open, redraw it when what it shows changes (a Get PAPER on top, say), never on unrelated updates
  function watch(body, draw, key) {
    let k = key();
    return Store.on(() => { const nk = key(); if (nk !== k) { k = nk; redraw(body, draw); } });
  }
  const walletKey = () => JSON.stringify([S.wallet.balances, S.wallet.allowance, S.wallet.credits]);
  const shortLine = (tok, need, x = 'paper') => `<p class="warn">You need ${fmt(need)} more ${tok}. <button class="btn small" type="button" data-x="${x}">Get ${tok}</button></p>`;

  // ---------- checkout (paid packs)
  function checkout() {
    needWallet(() => {
      const ph = PH[S.series.phase], w = S.wallet, lim = S.series.walletLimit;
      if (w.isContract && S.series.phase < 3) return Sheet.open('nope', { title: 'Regular wallets only', body: '<p class="lead">Packs can only be bought from a regular wallet like MetaMask or Rabby for now. Smart-contract wallets can buy later.</p>' });
      if (S.series.phase <= 1 && !(w.isPressHolder || w.inSnapshot)) return Sheet.open('nope', { title: 'Holders first', body: `<p class="lead">Paper Press and PLANK holders buy first. Everyone else can buy in ${ph.window}h.</p>` });
      const limitLeft = S.series.phase < 3 ? Math.max(0, lim - w.bought) : 50;
      const max = Math.max(0, Math.min(50, limitLeft, Store.paidLeft(), ph.plankOnly ? S.series.plankOnly - S.series.plankSold : 50));
      if (!max) return Sheet.open('nope', { title: 'Limit reached', body: `<p class="lead">That's this wallet's limit for now. It lifts ${ph.limit ? `in ${ph.limit}h` : 'later'}.</p>` });
      let n = 1, cur = 'PLANK', busy = false;
      const body = document.createElement('div'); body.className = 'checkout';
      const draw = () => {
        const usd = n * PRICE, amt = cur === 'ETH' ? usd / ETH_USD : cur === 'USDG' ? usd : usd / PLANK_USD, paper = n * Store.PRICES.PACK_PAPER;
        const maxCost = amt * 1.01; // the most it may take: the price can move 1% before nothing is charged
        const shortPaper = w.balances.PAPER < paper, shortCur = w.balances[cur] < amt;
        const need = shortPaper || shortCur ? null : [['PAPER', paper], [cur, maxCost]].find(([k, v]) => Store.needsApproval(k, v));
        body.innerHTML = `
          <div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output aria-live="polite">${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button>
            <span class="muted">${n === 1 ? 'pack' : 'packs'} · max ${max}</span></div>
          <div class="seg" role="group" aria-label="Pay with">${['PLANK', 'ETH', 'USDG'].map((c) => `<button type="button" data-c="${c}" aria-pressed="${c === cur}" ${ph.plankOnly && c !== 'PLANK' ? 'disabled' : ''}>${c}</button>`).join('')}</div>
          ${ph.plankOnly ? `<p class="note">The first ${S.series.plankOnly} packs are PLANK only.</p>` : ''}
          <dl class="sum"><dt>Price</dt><dd>${Wear.usd(usd)} <small>≈ ${fmt(amt)} ${cur}</small></dd><dt>PAPER</dt><dd>${paper} <small>burned</small></dd>
            <dt>You have</dt><dd>${fmt(w.balances[cur])} ${cur} <small>· ${w.balances.PAPER} PAPER</small></dd></dl>
          ${shortPaper ? shortLine('PAPER', paper - w.balances.PAPER) : ''}
          ${shortCur ? (cur === 'ETH' ? '<p class="warn">Not enough ETH.</p>' : shortLine(cur, amt - w.balances[cur], 'cur')) : ''}
          <p class="fine">Packs open when Series ${S.series.no} sells out. If the price moves over 1%, nothing is charged.</p>
          ${DEMO_LINE}
          <button class="btn primary go" type="button" ${shortPaper || shortCur ? 'disabled' : ''}>${busy ? 'Sending…' : need ? `Approve ${need[0]}` : `Buy ${n} ${n === 1 ? 'pack' : 'packs'}`}</button>`;
        body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(max, n + +b.dataset.q)); redraw(body, draw); });
        body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; redraw(body, draw); });
        body.querySelector('[data-x=paper]')?.addEventListener('click', () => openGetPaper('PAPER'));
        body.querySelector('[data-x=cur]')?.addEventListener('click', () => openGetPaper(cur));
        body.querySelector('.go').onclick = () => {
          if (busy) return;
          busy = true; redraw(body, draw);
          if (need) return approveNow(need[0], need[1], () => { busy = false; redraw(body, draw); });
          setTimeout(() => {
            Sheet.close('buy');
            Store.update((s) => { s.wallet.balances.PAPER -= paper; Store.spend('PAPER', paper); s.wallet.balances[cur] -= amt; Store.spend(cur, amt); s.wallet.bought += n; if (ph.plankOnly) s.series.plankSold += n; Store.log(`${s.wallet.name || 'You'} bought ${n} ${n === 1 ? 'pack' : 'packs'}`); });
            pendingDeliver += n; Scene?.buy(n); window.Sound?.play('pack-drop'); toast(`Buying ${n} ${n === 1 ? 'pack' : 'packs'}…`);
          }, 1100);
        };
      };
      draw(); Sheet.open('buy', { title: 'Buy packs', body, onClose: watch(body, draw, walletKey) });
    });
  }
  function starter() {
    needWallet(() => {
      if (!S.wallet.isPressHolder) return Sheet.open('nope', { title: 'Press packs', body: '<p class="lead">Press packs are for Paper Press holders.</p>' });
      const cost = Store.PRICES.PRESS_PAPER; let busy = false;
      const body = document.createElement('div');
      const draw = () => {
        const w = S.wallet, short = w.balances.PAPER < cost, need = !short && Store.needsApproval('PAPER', cost);
        body.innerHTML = `<p class="lead">For Paper Press holders. ${S.series.starters - S.series.startersClaimed} left.</p><div class="checkout">
          ${short ? shortLine('PAPER', cost - w.balances.PAPER) : ''}${DEMO_LINE}
          <button class="btn primary go" type="button" ${short ? 'disabled' : ''}>${busy ? 'Sending…' : need ? 'Approve PAPER' : `Claim for ${cost} PAPER`}</button></div>`;
        body.querySelector('[data-x=paper]')?.addEventListener('click', () => openGetPaper('PAPER'));
        body.querySelector('.go').onclick = () => {
          if (busy || short) return;
          if (need) { busy = true; redraw(body, draw); return approveNow('PAPER', cost, () => { busy = false; redraw(body, draw); }); }
          Sheet.close('starter');
          Store.update((s) => { s.wallet.starterClaimed = true; s.wallet.balances.PAPER -= cost; Store.spend('PAPER', cost); s.series.startersClaimed++; s.series.sold--; });
          pendingDeliver++; Scene?.buy(1); window.Sound?.play('pack-drop'); toast('Press pack on its way', 'good');
        };
      };
      draw(); Sheet.open('starter', { title: 'Press pack', body, onClose: watch(body, draw, walletKey) });
    });
  }
  function useFree() {
    needWallet(() => {
      let n = 1, busy = false; const per = Store.PRICES.PACK_PAPER;
      const body = document.createElement('div'); body.className = 'checkout';
      const draw = () => {
        const w = S.wallet; n = Math.max(1, Math.min(w.credits, n));
        const paper = n * per, short = w.balances.PAPER < paper, need = !short && Store.needsApproval('PAPER', paper);
        body.innerHTML = `<p class="lead">Use any time a Series is on sale. It still takes PAPER.</p>
          ${w.credits > 1 ? `<div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output>${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button><span class="muted">of ${w.credits}</span></div>` : ''}
          <dl class="sum"><dt>PAPER</dt><dd>${paper} <small>burned</small></dd><dt>You have</dt><dd>${w.balances.PAPER} PAPER</dd></dl>
          ${short ? shortLine('PAPER', paper - w.balances.PAPER) : ''}${DEMO_LINE}
          <button class="btn gold go" type="button" ${short ? 'disabled' : ''}>${busy ? 'Sending…' : need ? 'Approve PAPER' : `Use ${n} free ${n === 1 ? 'pack' : 'packs'}`}</button>`;
        body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(S.wallet.credits, n + +b.dataset.q)); redraw(body, draw); });
        body.querySelector('[data-x=paper]')?.addEventListener('click', () => openGetPaper('PAPER'));
        body.querySelector('.go').onclick = () => {
          if (busy || short) return;
          if (need) { busy = true; redraw(body, draw); return approveNow('PAPER', paper, () => { busy = false; redraw(body, draw); }); }
          Sheet.close('free');
          Store.update((s) => { s.wallet.credits -= n; s.wallet.balances.PAPER -= paper; Store.spend('PAPER', paper); });
          pendingDeliver += n; Scene?.buy(n); window.Sound?.play('pack-drop'); toast(n === 1 ? 'Free pack on its way' : `${n} free packs on their way`, 'good');
        };
      };
      draw(); Sheet.open('free', { title: S.wallet.credits > 1 ? 'Free packs' : 'Free pack', body, onClose: watch(body, draw, walletKey) });
    });
  }
  function openGetPaper(token = 'PAPER') {
    let tok = token, amt = tok === 'PAPER' ? 10 : tok === 'USDG' ? 25 : 1000000;
    const body = document.createElement('form'); body.className = 'checkout';
    const usdOf = () => tok === 'PAPER' ? amt * PAPER_USD : tok === 'USDG' ? amt : amt * PLANK_USD;
    const ethOf = () => usdOf() / ETH_USD * 1.005; // what it costs in ETH, the 0.5% fee included
    // nothing to swap for 0 (or less); connected, the ETH has to be there
    const why = () => !(amt > 0 && ethOf() > 0) ? 'Enter an amount' : S.wallet.connected && ethOf() > S.wallet.balances.ETH ? 'Not enough ETH' : '';
    const paint = () => {
      body.querySelector('.sum dd').innerHTML = `${ethOf().toFixed(5)} ETH <small>≈ ${Wear.usd(usdOf() * 1.005)}</small>`;
      const go = body.querySelector('.go'), w = why(); go.disabled = !!w; go.textContent = w || `Get ${fmt(amt)} ${tok}`;
    };
    const draw = () => {
      const hd = document.querySelector('#sheet-paper .sheet-head h2'); if (hd) hd.textContent = 'Get ' + tok; // the title follows the token
      body.innerHTML = `<div class="seg" role="group" aria-label="Get">${['PAPER', 'PLANK', 'USDG'].map((c) => `<button type="button" data-t="${c}" aria-pressed="${c === tok}">${c}</button>`).join('')}</div>
        <label class="amt" for="amt">How many ${tok}</label><input id="amt" inputmode="decimal" value="${amt}">
        <dl class="sum"><dt>You pay</dt><dd></dd></dl>
        ${DEMO_LINE}<button class="btn primary go" type="submit"></button><p class="fine">Swapped at the best rate. Includes a 0.5% fee.</p>`;
      body.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tok = b.dataset.t; amt = tok === 'PAPER' ? 10 : tok === 'USDG' ? 25 : 1000000; redraw(body, draw); });
      $('#amt', body).oninput = (e) => { const v = parseFloat(e.target.value); amt = Number.isFinite(v) ? v : 0; paint(); };
      paint();
    };
    body.onsubmit = (e) => {
      e.preventDefault(); if (why()) return;
      needWallet(() => { if (why()) return paint(); const eth = ethOf(), got = amt, t = tok; Sheet.close('paper'); Store.update((s) => { s.wallet.balances[t] += got; s.wallet.balances.ETH -= eth; }); toast(`+${fmt(got)} ${t}`, 'good'); });
    };
    draw(); Sheet.open('paper', { title: 'Get ' + tok, body });
  }
  // ---------- New here? a short checklist; each step ticks itself off from the demo state and has its own button
  function openStart() {
    const sealed = () => Object.values(S.sealed).reduce((a, b) => a + b, 0);
    const did = (word) => S.activity.some((a) => a.text.startsWith(word));
    const steps = [
      ['Connect a wallet', 'MetaMask, Rabby or any wallet on Robinhood Chain.', () => S.wallet.connected, 'Connect', () => needWallet(() => openStart())],
      ['Get PAPER', 'Every pack burns some.', () => S.wallet.balances.PAPER >= 1, 'Get PAPER', () => openGetPaper()],
      ['Buy a pack', 'In PLANK, ETH or USDG, plus PAPER.', () => S.wallet.bought > 0 || sealed() > 0, 'Buy', () => checkout()],
      ['Open it', 'Packs open once the Series sells out.', () => did('Opened'), 'Open packs', () => openStation('open')],
      ['Case or grade', 'Within 24 hours, so new cards never wear.', () => did('Paid'), 'Case & grade', () => Stations.open('grade')],
    ];
    const body = document.createElement('div'); body.className = 'start';
    const draw = () => {
      body.innerHTML = `<ol class="start-list">${steps.map(([t, sub, done, b], i) => `<li class="${done() ? 'done' : ''}">
          <span class="start-n" aria-hidden="true">${done() ? '✓' : i + 1}</span><span class="start-t"><b>${t}</b><small>${sub}</small></span>
          ${done() ? '<span class="sr">Done</span>' : `<button class="btn small" type="button" data-s="${i}">${b}</button>`}</li>`).join('')}</ol>
        <p class="menu-links"><button class="inf-link" type="button" data-s="info">How it all works</button><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>`;
      body.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { Sheet.close('start'); if (b.dataset.s === 'info') return Info.open(); steps[+b.dataset.s][4](); });
    };
    draw(); Sheet.open('start', { title: 'New here?', body });
  }
  window.UI = { openGetPaper, checkout, openStart, approveNow };

  // ---------- activity, menu, demo
  function openFeed() {
    const items = S.activity.length ? S.activity : [{ text: 'Waiting for the first pack of Series 7' }];
    Sheet.open('feed', { title: 'Activity', body: `<ul class="feed">${items.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul>` });
  }
  function openMenu() {
    const d = Sheet.open('menu', { title: 'Menu', body: `<div class="menu">
      <button class="btn" type="button" data-m="cards">${svg('cards')}My cards</button><button class="btn" type="button" data-m="open">${svg('pack')}Open packs${Stations.openableCount() ? ` (${Stations.openableCount()})` : ''}</button>
      <button class="btn" type="button" data-m="paper">${svg('paper')}Get PAPER</button><button class="btn" type="button" data-m="info">${svg('info')}Info</button>
      <button class="btn" type="button" data-m="feed">${svg('feed')}Activity</button><button class="btn" type="button" data-m="sound">${svg('sound')}Sound: ${window.Sound?.on ? 'On' : 'Off'}</button>
      <button class="btn" type="button" data-m="start">New here?</button><button class="btn" type="button" data-m="demo">Demo controls</button></div>
      <p class="menu-links"><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>` });
    d.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { d.close(); go(b.dataset.m); });
  }
  let auto = null;
  function openDemo() {
    const d = Sheet.open('demo', { title: 'Demo controls', body: `<p class="lead">Jump the demo to any stage of a sale.</p><div class="menu">
      <button class="btn" type="button" data-d="phase">Next phase</button><button class="btn" type="button" data-d="sold">Sold-out show</button>
      <button class="btn" type="button" data-d="auto">${auto ? 'Stop' : 'Start'} crowd</button><button class="btn" type="button" data-d="credit">+1 free pack</button><button class="btn" type="button" data-d="announce">Series tease</button>
      <button class="btn" type="button" data-d="holder">Holder: ${S.wallet.isPressHolder || S.wallet.inSnapshot ? 'On' : 'Off'}</button><button class="btn" type="button" data-d="bot">${S.wallet.isContract ? 'Regular wallet' : 'Contract wallet'}</button>
      <button class="btn" type="button" data-d="reset">Reset</button></div>` });
    d.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
      const k = b.dataset.d; d.close();
      if (k === 'phase') Store.update((s) => { s.series.phase = (s.series.phase + 1) % 4; });
      if (k === 'sold') { const n = Math.min(3, Store.left()); Store.update((s) => { s.series.sold = s.series.total - s.series.startersClaimed - n; }); Scene?.buy(n); }
      if (k === 'auto') { if (auto) { clearInterval(auto); auto = null; } else auto = setInterval(() => { if (Store.left() > 0) { crowd++; Scene?.buy(1); } }, 3200); }
      if (k === 'credit') Store.update((s) => { s.wallet.credits++; });
      if (k === 'announce') Announce.open();
      if (k === 'holder') Store.update((s) => { const v = !(s.wallet.isPressHolder || s.wallet.inSnapshot); s.wallet.isPressHolder = v; s.wallet.inSnapshot = v; });
      if (k === 'bot') Store.update((s) => { s.wallet.isContract = !s.wallet.isContract; });
      if (k === 'reset') location.reload();
    });
  }
  // sound is on by default (it starts on the first tap anywhere); the speaker turns it off, remembered per visitor
  $('#soundBtn').onclick = () => { const sound = window.Sound ? Sound.set(!Sound.on) : false; $('#soundBtn').setAttribute('aria-pressed', sound); $('#soundBtn').innerHTML = svg(sound ? 'sound' : 'mute'); toast(sound ? 'Sound: On' : 'Sound: Off'); };
  function go(k) {
    if (k === 'paper') openGetPaper(); if (k === 'info') Info.open(); if (k === 'info-cards') Info.open('cards'); if (k === 'feed') openFeed();
    if (k === 'menu') openMenu(); if (k === 'demo') openDemo(); if (k === 'start') openStart(); if (k === 'sound') $('#soundBtn').click();
    if (k === 'cards' || k === 'open') openStation(k);
  }
  // My cards opens the collection; Open packs goes straight to tearing the next pack, or (none to open) says why and points at Buy
  function openStation(k) {
    if (k !== 'open' || Stations.openableCount()) return Stations.open(k);
    const sealed = Object.values(S.sealed).reduce((a, b) => a + b, 0);
    if (sealed) return toast(`Your Series ${S.series.no} packs open when it sells out`);
    if (sold()) return toast(`No packs to open. Series ${S.series.no + 1} is coming soon`);
    toast('No packs to open yet. Buy one first!');
    const b = $(mode === 'desk' ? '#buybox [data-buy]' : '#buybar [data-buy]'); if (!b) return;
    b.focus({ preventScroll: true }); b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  $('#seriesChip').onclick = () => Info.open('buy');
  document.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => openStation(b.dataset.st));
  document.querySelectorAll('[data-peek]').forEach((b) => b.onclick = () => Announce.open());

  // ---------- the scene's events: a pack made is a pack sold; delivered packs land in the wallet
  let pendingDeliver = 0, crowd = 0;
  function hookScene() {
    Scene.on('packMade', () => {
      Store.update((s) => { if (crowd > 0) { crowd--; s.series.sold++; Store.log('Someone bought a pack'); } else s.series.sold++; });
      if (Store.left() <= 0 && !sold()) { Store.update((s) => { s.series.phase = 4; }); Scene.finale(); setTimeout(() => toast(`Series ${S.series.no} sold out!`, 'good'), 600); }
    });
    Scene.on('delivered', () => { if (pendingDeliver > 0) { pendingDeliver--; Store.update((s) => { s.sealed[s.series.no] = (s.sealed[s.series.no] || 0) + 1; }); toast('+1 pack', 'good'); } });
    layout(); render();
    requestAnimationFrame(() => setTimeout(() => $('#loading').classList.add('done'), 300));
  }
  if (window.Scene) hookScene(); else addEventListener('scene-ready', hookScene, { once: true });
  layout(); render();
})();
