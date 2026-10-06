/* Omni Forge (demo mode): the shell. Top bar, wallet, the Buy box and checkout, station pills, the bottom strip,
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
    feed: '<path d="M4 6h16M4 12h10M4 18h13"/>',
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
    <a class="brand" href="#" aria-label="Omni Forge"><img class="mark" src="ui/omni-mark.webp" alt=""><img class="word" src="ui/omni-wordmark.webp" alt="Omni"><span class="forge">FORGE</span><em class="tag">Wood in. Packs out.</em></a>
    <button class="chip series" id="seriesChip" type="button"></button>
    <div class="grow"></div>
    <nav class="tools" aria-label="Tools">
      <button class="chip mycards" type="button" data-st="cards" aria-label="My cards">${svg('cards')}<span>My cards</span></button>
      <button class="chip" type="button" data-go="paper" aria-label="Get PAPER">${svg('paper')}<span>Get PAPER</span></button>
      <button class="chip" type="button" data-go="info" aria-label="Info">${svg('info')}<span>Info</span></button>
      <button class="chip round" type="button" data-go="feed" aria-label="Activity">${svg('feed')}</button>
      <button class="chip round" type="button" id="soundBtn" aria-label="Sound" aria-pressed="false">${svg('mute')}</button>
      <button class="chip demo" type="button" data-go="demo">Demo</button>
    </nav>
    <button class="chip round menu-btn" type="button" data-go="menu" aria-label="Menu">${svg('menu')}</button>
    <button class="wallet" id="walletBtn" type="button">${svg('wallet')}<span>Connect</span></button>
  </header>
  <div class="demo-note" role="note"><b>Demo</b><span>Nothing here is real. No wallet, no payments.</span></div>
  <div class="ui" id="pills">
    <div class="buybox" id="buybox" data-x="1480" data-y="250"></div>
    <button class="pill" type="button" data-st="burn" data-x="320" data-y="1035" style="--c: var(--fire)">${svg('fire')}<span>Burn<small id="pBurn"></small></span></button>
    <button class="pill openp" type="button" data-st="open" data-x="1385" data-y="1395" style="--c: var(--wood)">${svg('pack')}<span><b id="pOpenT">Open packs</b><small id="pOpen"></small></span></button>
    <button class="pill" type="button" data-st="grade" data-x="2390" data-y="1225" style="--c: var(--diamond)">${svg('lens')}<span>Case &amp; grade<small>$0.05 · $1</small></span></button>
    <button class="pill" type="button" data-st="suggest" data-x="3590" data-y="1185" style="--c: var(--paper)">${svg('mail')}<span>Suggest<small>1 PAPER</small></span></button>
  </div>
  <section class="stations" aria-label="Stations">
    <button class="station" type="button" data-st="burn" style="--c: var(--fire)">${svg('fire')}<b>Burn</b><small id="sBurn"></small></button>
    <button class="station" type="button" data-st="cards" style="--c: var(--wood)">${svg('cards')}<b>My cards</b><small id="sCards"></small></button>
    <button class="station" type="button" data-st="grade" style="--c: var(--diamond)">${svg('lens')}<b>Case &amp; grade</b><small>$0.05 · $1</small></button>
    <button class="station" type="button" data-st="suggest" style="--c: var(--paper)">${svg('mail')}<b>Suggest</b><small>1 PAPER</small></button>
    <button class="openbtn" type="button" data-st="open" id="openBtn">${svg('pack')}<span><b id="sOpenT">Open packs</b><small id="sOpen"></small></span></button>
  </section>
  <footer class="strip" aria-label="What's in a pack">
    <img class="packart" src="ui/omni-pack.webp" alt="Series 7 pack">
    <div class="what">
      <h3><b class="sw">SERIES 7</b> PACK<span>6 cards</span></h3>
      <table class="types" aria-label="Cards in a pack">
        <tr><th scope="row">Material</th><td><span class="mat paper">Paper</span></td><td><span class="mat wood">Wood</span></td><td><span class="mat fire">Fire</span></td><td><span class="mat charcoal">Coal</span></td><td><span class="mat diamond">Diamond</span></td></tr>
        <tr><th scope="row">Per pack</th><td>3</td><td>1–2</td><td colspan="3" class="span">At least 1 of these</td></tr>
      </table>
    </div>
    <button class="btn small more" type="button" data-go="info-cards">Rarity</button>
  </footer>
  <div class="buybar" id="buybar"></div>`;

  // ---------- layout: desktop / phone portrait / phone landscape
  const TOP = 54 + 24; // the top bar plus the demo notice under it (CSS --top)
  const DEMO_LINE = '<p class="demo-line"><b>Demo</b>No payment, nothing is charged</p>';
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

  // ---------- the Series: phases, numbers, chip
  const PH = [
    { line: 'Holders first', window: 17, sub: 'PLANK only', plankOnly: true },
    { line: 'Holders first', window: 9, sub: 'PLANK, ETH or USDG' },
    { line: 'Open to all', limit: 14, sub: 'Max 5 each' },
    { line: 'Open to all', sub: 'PLANK, ETH or USDG' },
  ];
  const sold = () => S.series.phase >= 4;
  function syncScene() {
    const ph = PH[S.series.phase];
    window.Scene?.setState({ left: Store.left(), total: S.series.total, burnCount: S.wallet.burnCount, series: S.series.no, windowFrac: ph?.window ? ph.window / 24 : 0 });
  }
  function renderChip() {
    const ph = PH[S.series.phase], c = $('#seriesChip');
    c.innerHTML = sold() ? `Series ${S.series.no} · <b>Sold out</b>` : `Series ${S.series.no} · <b>${Store.left()}</b> left · ${ph.line}${ph.window ? ` <i>${ph.window}h</i>` : ''}`;
  }
  function buyButtons() {
    const ph = PH[S.series.phase], w = S.wallet, out = [];
    if (sold()) return { line: `Series ${S.series.no} sold out`, opts: [Stations.openableCount() ? ['open', 'Open your packs', `Series ${S.series.no + 1} soon`, 'alt'] : ['cards', 'My cards', `Series ${S.series.no + 1} soon`, 'alt']] };
    let sub2 = ph.plankOnly ? `PLANK only · ${S.series.plankOnly - S.series.plankSold} left` : ph.sub;
    out.push(['buy', 'Buy packs', `$2.50 + 1 PAPER<br>${sub2}`, 'main']);
    if (S.series.phase <= 1 && !w.starterClaimed && S.series.startersClaimed < S.series.starters) out.push(['starter', 'Press pack', 'Press holders<br>1 PAPER', 'alt']);
    if (w.credits > 0) out.push(['free', `Free pack (${w.credits})`, '1 PAPER<br>any time', 'gold']);
    return { line: ph.window ? `${ph.line} · ${ph.window}h left` : ph.limit ? `${ph.line} · max 5 for ${ph.limit}h` : ph.line, opts: out };
  }
  function renderBuy() {
    const { line, opts } = buyButtons();
    const html = `<div class="phase">${line}</div><div class="opts">` + opts.map(([k, t, sub, cls]) =>
      `<button class="opt ${cls}" type="button" data-buy="${k}">${k === 'buy' ? '<img class="mini" src="../build3/pack.webp" alt="">' : ''}<span>${t}<small>${sub}</small></span></button>`).join('') + '</div>';
    $('#buybox').innerHTML = html; $('#buybar').innerHTML = html;
    $('#buybox').classList.toggle('calm', sold()); $('#buybar').classList.toggle('calm', sold());
    for (const b of document.querySelectorAll('[data-buy]')) b.onclick = () => ({ buy: checkout, starter, free: useFree, open: () => openStation('open'), cards: () => openStation('cards') })[b.dataset.buy]?.();
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
    const nm = mode === 'port' ? '' : S.wallet.name; // phones: just the balance (and no icon), so the button fits beside the brand
    wb.textContent = S.wallet.connected ? `${nm ? nm + ' · ' : ''}${S.wallet.balances.PAPER} PAPER` : 'Connect';
    $('#walletBtn').classList.toggle('on', S.wallet.connected);
  }
  let bbH = 0;
  function render() {
    renderChip(); renderBuy(); renderCounts(); syncScene(); placePills();
    const h = mode === 'port' ? $('#buybar').offsetHeight : 0; if (h !== bbH) { bbH = h; if (h) layout(); } // the Buy bar changed height: keep the stations clear of it
  }
  Store.on(render);

  // ---------- wallet
  function needWallet(then) { // demo: one click connects a demo wallet; the real site opens the standard wallet window
    if (S.wallet.connected) return then();
    Store.update((s) => { s.wallet.connected = true; });
    toast('Demo wallet connected. No real wallet is used.', 'good');
    setTimeout(then, 200);
  }
  $('#walletBtn').onclick = () => needWallet(openWallet);
  function openWallet() {
    const w = S.wallet, sealed = Object.entries(S.sealed).filter(([, n]) => n).map(([k, n]) => `${n} from Series ${k}`).join(', ') || 'none';
    const d = Sheet.open('wallet', { title: w.name || 'Wallet', body: `
      <div class="wmenu">
        <div class="who"><div class="avatar">${(w.name || '?')[0]}</div><div><b>${w.name || 'No name yet'}</b><small>${w.address}</small></div><button class="btn small" type="button" data-w="name">Edit</button></div>
        <div class="bal">${Object.entries(w.balances).map(([k, v]) => `<div><small>${k}</small><b>${fmt(v)}</b></div>`).join('')}</div>
        <div class="rows">
          <div><span>Free packs</span><b>${w.credits}</b></div>
          <div><span>Burned toward next</span><b>${w.burnCount % 42} / 42</b></div>
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
      f.innerHTML = `<label for="nm">Name</label><input id="nm" maxlength="24" value="${w.name}"><button class="btn primary" type="submit">Save</button>`;
      f.onsubmit = (e) => { e.preventDefault(); Store.update((s) => { s.wallet.name = $('#nm', f).value.trim(); }); openWallet(); };
      Sheet.open('wallet', { title: 'Your name', body: f });
    };
  }

  // ---------- checkout (paid packs)
  function checkout() {
    needWallet(() => {
      const ph = PH[S.series.phase], w = S.wallet;
      if (w.isContract && S.series.phase < 3) return Sheet.open('nope', { title: 'Regular wallets only', body: '<p class="lead">For the first 48 hours, packs can only be bought from a regular wallet like MetaMask or Rabby. Smart-contract wallets can buy after that.</p>' });
      if (S.series.phase <= 1 && !(w.isPressHolder || w.inSnapshot)) return Sheet.open('nope', { title: 'Holders first', body: `<p class="lead">The first 24 hours are for Paper Press holders and PLANK holders. Everyone else can buy in ${ph.window}h.</p>` });
      const limitLeft = S.series.phase < 3 ? Math.max(0, 5 - w.bought) : 50;
      const max = Math.max(0, Math.min(50, limitLeft, Store.paidLeft(), ph.plankOnly ? S.series.plankOnly - S.series.plankSold : 50));
      if (!max) return Sheet.open('nope', { title: 'Limit reached', body: `<p class="lead">That's 5 packs for this wallet. The limit lifts ${ph.limit ? `in ${ph.limit}h` : 'after 48 hours'}.</p>` });
      let n = 1, cur = 'PLANK', step = 'pick';
      const body = document.createElement('div'); body.className = 'checkout';
      const draw = () => {
        const usd = n * PRICE, amt = cur === 'ETH' ? usd / ETH_USD : cur === 'USDG' ? usd : usd / PLANK_USD, paper = n;
        const needApprove = cur !== 'ETH' && step === 'pick';
        const shortPaper = w.balances.PAPER < paper, shortCur = w.balances[cur] < amt;
        body.innerHTML = `
          <div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output aria-live="polite">${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button>
            <span class="muted">${n === 1 ? 'pack' : 'packs'} · max ${max}</span></div>
          <div class="seg" role="group" aria-label="Pay with">${['PLANK', 'ETH', 'USDG'].map((c) => `<button type="button" data-c="${c}" aria-pressed="${c === cur}" ${ph.plankOnly && c !== 'PLANK' ? 'disabled' : ''}>${c}</button>`).join('')}</div>
          ${ph.plankOnly ? '<p class="note">The first 50 packs are PLANK only.</p>' : ''}
          <dl class="sum"><dt>Price</dt><dd>$${usd.toFixed(2)} <small>≈ ${fmt(amt)} ${cur}</small></dd><dt>PAPER</dt><dd>${paper} <small>burned to make the ${n === 1 ? 'pack' : 'packs'}</small></dd></dl>
          ${shortPaper ? `<p class="warn">You need ${paper - w.balances.PAPER} more PAPER. <button class="btn small" type="button" data-x="paper">Get PAPER</button></p>` : ''}
          ${shortCur ? `<p class="warn">Not enough ${cur}. <button class="btn small" type="button" data-x="paper">Get ${cur}</button></p>` : ''}
          <p class="fine">Packs go straight to your wallet and open when Series ${S.series.no} sells out. If the price moves more than 1% before it goes through, nothing is charged.</p>
          ${DEMO_LINE}
          <button class="btn primary go" type="button" ${shortPaper || shortCur ? 'disabled' : ''}>${step === 'sending' ? 'Sending…' : needApprove ? `Approve ${cur} · step 1 of 2` : `Buy ${n} ${n === 1 ? 'pack' : 'packs'}`}</button>`;
        body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(max, n + +b.dataset.q)); draw(); });
        body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; step = 'pick'; draw(); });
        body.querySelectorAll('[data-x=paper]').forEach((b) => b.onclick = () => openGetPaper(shortPaper ? 'PAPER' : cur));
        body.querySelector('.go').onclick = () => {
          if (step === 'sending') return;
          if (needApprove) { step = 'sending'; draw(); setTimeout(() => { step = 'approved'; toast(`${cur} approved`); draw(); }, 900); return; }
          step = 'sending'; draw();
          setTimeout(() => {
            Sheet.close('buy');
            Store.update((s) => { s.wallet.balances.PAPER -= n; s.wallet.balances[cur] -= amt; s.wallet.bought += n; if (ph.plankOnly) s.series.plankSold += n; Store.log(`${s.wallet.name || 'You'} bought ${n} ${n === 1 ? 'pack' : 'packs'}`); });
            pendingDeliver += n; Scene?.buy(n); toast(`Buying ${n} ${n === 1 ? 'pack' : 'packs'}…`);
          }, 1100);
        };
      };
      draw(); Sheet.open('buy', { title: 'Buy packs', body });
    });
  }
  function starter() {
    needWallet(() => {
      if (!S.wallet.isPressHolder) return Sheet.open('nope', { title: 'Press packs', body: '<p class="lead">Press packs are for Paper Press holders: one per wallet, 1 PAPER each.</p>' });
      const d = Sheet.open('starter', { title: 'Press pack', body: `<p class="lead">One pack for 1 PAPER, for Paper Press holders. ${S.series.starters - S.series.startersClaimed} left.</p><div class="checkout">${DEMO_LINE}<button class="btn primary go" type="button">Claim for 1 PAPER</button></div>` });
      d.querySelector('.go').onclick = () => { d.close(); Store.update((s) => { s.wallet.starterClaimed = true; s.wallet.balances.PAPER -= 1; s.series.startersClaimed++; s.series.sold--; }); pendingDeliver++; Scene?.buy(1); };
    });
  }
  function useFree() {
    needWallet(() => {
      let n = 1; const body = document.createElement('div'); body.className = 'checkout';
      const draw = () => {
        body.innerHTML = `<p class="lead">Free packs work any time a Series is on sale. Each one costs just 1 PAPER.</p>
          <div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output>${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button><span class="muted">of ${S.wallet.credits}</span></div>
          ${DEMO_LINE}
          <button class="btn gold go" type="button">Use ${n} free ${n === 1 ? 'pack' : 'packs'}</button>`;
        body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(S.wallet.credits, n + +b.dataset.q)); draw(); });
        body.querySelector('.go').onclick = () => { Sheet.close('free'); Store.update((s) => { s.wallet.credits -= n; s.wallet.balances.PAPER -= n; }); pendingDeliver += n; Scene?.buy(n); };
      };
      draw(); Sheet.open('free', { title: 'Free packs', body });
    });
  }
  function openGetPaper(token = 'PAPER') {
    let tok = token, amt = tok === 'PAPER' ? 10 : tok === 'USDG' ? 25 : 1000000;
    const body = document.createElement('form'); body.className = 'checkout';
    const usdOf = () => tok === 'PAPER' ? amt * PAPER_USD : tok === 'USDG' ? amt : amt * PLANK_USD;
    const draw = () => {
      body.innerHTML = `<div class="seg" role="group" aria-label="Get">${['PAPER', 'PLANK', 'USDG'].map((c) => `<button type="button" data-t="${c}" aria-pressed="${c === tok}">${c}</button>`).join('')}</div>
        <label class="amt" for="amt">How many ${tok}</label><input id="amt" inputmode="decimal" value="${amt}">
        <dl class="sum"><dt>You pay</dt><dd>${(usdOf() / ETH_USD * 1.005).toFixed(5)} ETH <small>≈ $${(usdOf() * 1.005).toFixed(2)}</small></dd></dl>
        ${DEMO_LINE}<button class="btn primary go" type="submit">Get ${fmt(amt)} ${tok}</button><p class="fine">Swapped at the best rate. Includes a 0.5% fee.</p>`;
      body.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tok = b.dataset.t; amt = tok === 'PAPER' ? 10 : tok === 'USDG' ? 25 : 1000000; draw(); });
      $('#amt', body).oninput = (e) => { amt = Math.max(0, +e.target.value || 0); body.querySelector('.sum dd').innerHTML = `${(usdOf() / ETH_USD * 1.005).toFixed(5)} ETH <small>≈ $${(usdOf() * 1.005).toFixed(2)}</small>`; body.querySelector('.go').textContent = `Get ${fmt(amt)} ${tok}`; };
    };
    body.onsubmit = (e) => { e.preventDefault(); needWallet(() => { Sheet.close('paper'); Store.update((s) => { s.wallet.balances[tok] += amt; s.wallet.balances.ETH -= usdOf() / ETH_USD; }); toast(`+${fmt(amt)} ${tok}`, 'good'); }); };
    draw(); Sheet.open('paper', { title: 'Get ' + tok, body });
  }
  window.UI = { openGetPaper, checkout };

  // ---------- activity, menu, demo
  function openFeed() {
    const items = S.activity.length ? S.activity : [{ text: 'Waiting for the first pack of Series 7' }];
    Sheet.open('feed', { title: 'Activity', body: `<ul class="feed">${items.map((a) => `<li>${a.text}</li>`).join('')}</ul>` });
  }
  function openMenu() {
    const d = Sheet.open('menu', { title: 'Menu', body: `<div class="menu">
      <button class="btn" type="button" data-m="cards">${svg('cards')}My cards</button><button class="btn" type="button" data-m="open">${svg('pack')}Open packs${Stations.openableCount() ? ` (${Stations.openableCount()})` : ''}</button>
      <button class="btn" type="button" data-m="paper">${svg('paper')}Get PAPER</button><button class="btn" type="button" data-m="info">${svg('info')}Info</button>
      <button class="btn" type="button" data-m="feed">${svg('feed')}Activity</button><button class="btn" type="button" data-m="sound">${svg('sound')}Sound ${sound ? 'on' : 'off'}</button>
      <button class="btn" type="button" data-m="demo">Demo controls</button></div>` });
    d.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { d.close(); go(b.dataset.m); });
  }
  let auto = null;
  function openDemo() {
    const d = Sheet.open('demo', { title: 'Demo controls', body: `<p class="lead">Jump the demo to any stage of a sale.</p><div class="menu">
      <button class="btn" type="button" data-d="phase">Next phase</button><button class="btn" type="button" data-d="sold">Sold-out show</button>
      <button class="btn" type="button" data-d="auto">${auto ? 'Stop' : 'Start'} crowd</button><button class="btn" type="button" data-d="credit">+1 free pack</button>
      <button class="btn" type="button" data-d="holder">${S.wallet.isPressHolder || S.wallet.inSnapshot ? 'Make not a holder' : 'Make a holder'}</button><button class="btn" type="button" data-d="bot">${S.wallet.isContract ? 'Regular wallet' : 'Contract wallet'}</button>
      <button class="btn" type="button" data-d="reset">Reset</button></div>` });
    d.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
      const k = b.dataset.d; d.close();
      if (k === 'phase') Store.update((s) => { s.series.phase = (s.series.phase + 1) % 4; });
      if (k === 'sold') { const n = Math.min(3, Store.left()); Store.update((s) => { s.series.sold = s.series.total - s.series.startersClaimed - n; }); Scene?.buy(n); }
      if (k === 'auto') { if (auto) { clearInterval(auto); auto = null; } else auto = setInterval(() => { if (Store.left() > 0) { crowd++; Scene?.buy(1); } }, 3200); }
      if (k === 'credit') Store.update((s) => { s.wallet.credits++; });
      if (k === 'holder') Store.update((s) => { const v = !(s.wallet.isPressHolder || s.wallet.inSnapshot); s.wallet.isPressHolder = v; s.wallet.inSnapshot = v; });
      if (k === 'bot') Store.update((s) => { s.wallet.isContract = !s.wallet.isContract; });
      if (k === 'reset') location.reload();
    });
  }
  let sound = false;
  $('#soundBtn').onclick = () => { sound = !sound; $('#soundBtn').setAttribute('aria-pressed', sound); $('#soundBtn').innerHTML = svg(sound ? 'sound' : 'mute'); toast(sound ? 'Sound on' : 'Sound off'); };
  function go(k) {
    if (k === 'paper') openGetPaper(); if (k === 'info') Info.open(); if (k === 'info-cards') Info.open('cards'); if (k === 'feed') openFeed();
    if (k === 'menu') openMenu(); if (k === 'demo') openDemo(); if (k === 'sound') $('#soundBtn').click();
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
  $('#seriesChip').onclick = () => Info.open('buying');
  document.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => openStation(b.dataset.st));

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
