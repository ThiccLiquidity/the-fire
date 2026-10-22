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
  const LIVE = window.Live?.on; // live mode (live.js): the chain's data, and Live sends the transactions
  const P = Store.PRICES; // read each time: live mode fills them in from the contracts

  // ---------- markup
  $('#app').innerHTML = `
  <div id="loading" class="loading"><img src="ui/omni-mark.webp" alt=""><p>Lighting the forge…</p><small class="demo-load">Demo: nothing here is real</small></div>
  <header class="topbar">
    <a class="brand" href="#" aria-label="Omni Cardworks"><img class="mark" src="ui/omni-mark.webp" alt=""><img class="word" src="ui/omni-wordmark.webp" alt="Omni"><span class="forge">CARDWORKS</span><em class="tag">Wood in. Packs out.</em></a>${LIVE && Live.testnet ? '<span class="net-badge">Testnet</span>' : ''}
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
  <div class="qbanner" id="qbanner" hidden></div>
  <div class="demo-note" role="note"><b>Demo</b><span>Nothing here is real.</span><button class="start-link" type="button" data-go="start">New here?</button></div>
  <div class="ui" id="pills">
    <div class="buybox" id="buybox" data-x="1480" data-y="250"></div>
    <p class="pitch desk-pitch" data-x="1385" data-y="1225">Rip packs, pull holo cards, grade the best.</p>
    <button class="pill tool" type="button" data-st="burn" data-x="320" data-y="1035" style="--c: var(--fire)">${svg('fire')}<span>Burn<small id="pBurn"></small></span></button>
    <button class="pill openp hero" type="button" data-hero data-x="1385" data-y="1395" style="--c: var(--wood)">${svg('pack')}<span><b id="pOpenT">Open packs</b><small id="pOpen"></small></span></button>
    <button class="pill tool" type="button" data-st="grade" data-x="2390" data-y="1225" style="--c: var(--diamond)">${svg('lens')}<span>Case &amp; grade<small data-price="psa">from ${Wear.usd(Store.PRICES.CASE_USD)}</small></span></button>
    <div class="spot" id="spot" data-x="3590" data-y="1750" aria-hidden="true"></div>
    <aside class="sdock" id="sdock" data-x="3040" data-y="930" aria-label="Suggestion box"></aside>
    <button class="pill tool" type="button" data-st="suggest" data-x="3590" data-y="1185" style="--c: var(--paper)">${svg('mail')}<span>Suggest<small data-price="suggest">${Store.PRICES.SUGGEST_PAPER} PAPER</small></span></button>
    <button class="pill peek" type="button" data-peek data-x="2880" data-y="700" style="--c: var(--gold)"><span class="peek-fan" aria-hidden="true"><img alt=""><img alt=""></span><span><b id="pPeekT">Series 8</b><small id="pPeek"></small></span></button>
  </div>
  <section class="stations" aria-label="Stations">
    <p class="pitch">Rip packs, pull holo cards, grade the best.</p>
    <button class="openbtn hero" type="button" data-hero id="openBtn">${svg('pack')}<span><b id="sOpenT">Open packs</b><small id="sOpen"></small></span></button>
    <button class="station" type="button" data-st="cards" style="--c: var(--wood)">${svg('cards')}<b>My cards</b><small id="sCards"></small></button>
    <button class="station peek" type="button" data-peek><span class="peek-fan" aria-hidden="true"><img alt=""><img alt=""></span><b id="sPeekT">Series 8</b><small id="sPeek"></small></button>
    <button class="station tool" type="button" data-st="burn" style="--c: var(--fire)">${svg('fire')}<b>Burn</b><small id="sBurn"></small></button>
    <button class="station tool" type="button" data-st="grade" style="--c: var(--diamond)">${svg('lens')}<b>Case &amp; grade</b><small data-price="psa">from ${Wear.usd(Store.PRICES.CASE_USD)}</small></button>
    <button class="station tool" type="button" data-st="suggest" style="--c: var(--paper)">${svg('mail')}<b>Suggest</b><small data-price="suggest">${Store.PRICES.SUGGEST_PAPER} PAPER</small></button>
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
    <button class="btn small more" type="button" data-go="info-cards">Odds</button>
  </footer>
  <div class="buybar" id="buybar"></div>`;

  // ---------- layout: desktop / phone portrait / phone landscape
  const TOP = 54 + (LIVE ? 0 : 24); // the top bar plus the demo notice under it (CSS --top; live mode has no notice)
  const DEMO_LINE = '<p class="demo-line">Demo: nothing is charged</p>'; // the one demo line, at payment and burn buttons only
  let mode = 'desk', view = null;
  // The UI shows before the scene has loaded (slow networks): until it's ready, a small still of the workshop
  // (build3/plate-640.webp) sits in the scene's box as the canvas's background, and the pills are placed with the
  // same maths the scene uses (no camera yet). The scene's first frame paints over it.
  const SW = 3840, SH = 2160;
  const lite = () => { const v = view, s = v.mode === 'cover' ? Math.max(v.w / SW, v.h / SH) : Math.min(v.w / SW, v.h / SH);
    return { s, ox: v.x + (v.w - SW * s) * (v.mode === 'cover' ? v.focus : 0.5), oy: v.y + (v.h - SH * s) / 2 }; };
  const toScreen = (x, y) => { if (window.Scene) return Scene.toScreen(x, y); const l = lite(); return [l.ox + x * l.s, l.oy + y * l.s]; };
  function poster() {
    const c = document.getElementById('c'); if (!c || !view) return;
    if (c.dataset.drawn) { c.style.backgroundImage = ''; return; }
    const l = lite();
    Object.assign(c.style, { backgroundImage: 'url(a/plate-640.webp)', backgroundRepeat: 'no-repeat', backgroundSize: `${SW * l.s}px ${SH * l.s}px`, backgroundPosition: `${l.ox}px ${l.oy}px` });
  }
  function layout() {
    const W = innerWidth, H = innerHeight, bar = TOP;
    mode = W < 700 && H > W ? 'port' : H < 520 ? 'land' : 'desk';
    document.body.dataset.mode = mode; document.documentElement.dataset.mode = mode;
    if (mode === 'port') {
      const bb = document.querySelector('.buybar')?.offsetHeight || 80, st = document.querySelector('.stations')?.offsetHeight || 220;
      const sh = Math.round(Math.max(150, Math.min(H * 0.42, W * 0.9, H - bar - st - bb - 24))); // the stations stay clear of the Buy bar on short phones
      view = { x: 0, y: bar, w: W, h: sh, mode: 'cover', focus: 0.42, follow: true }; // the camera follows the action
      document.documentElement.style.setProperty('--sceneH', sh + 'px');
      document.documentElement.style.setProperty('--bbH', bb + 'px');
    } else if (mode === 'land') {
      view = { x: 0, y: bar, w: W - 240, h: H - bar, mode: 'contain', follow: false };
    } else {
      const strip = H < 760 ? 92 : 104; document.documentElement.style.setProperty('--stripH', strip + 'px');
      view = { x: 0, y: bar, w: W, h: H - bar - strip, mode: 'contain', follow: false };
    }
    if (window.Scene) Scene.setView(view);
    poster(); placePills(); if (S.wallet) renderCounts();
  }
  function placePills() {
    if (!view) return;
    const k = window.Scene ? Scene.scale : lite().s, fs = Math.max(12, Math.min(14, 30 * k));
    document.documentElement.style.setProperty('--fs', fs + 'px'); document.documentElement.style.setProperty('--sk', k);
    for (const el of document.querySelectorAll('#pills [data-x]')) {
      let [x, y] = toScreen(+el.dataset.x, +el.dataset.y);
      if (el.id === 'spot') { el.style.left = x + 'px'; el.style.top = y + 'px'; continue; } // the light sits on the floor, wherever that is
      const half = el.offsetWidth / 2 + 8; x = Math.max(half, Math.min(innerWidth - half, x)); // never off-screen
      el.style.left = x + 'px'; el.style.top = Math.max(TOP + el.offsetHeight / 2 + 6, y) + 'px';
    }
  }
  addEventListener('resize', layout);

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); // for text typed by people (names)
  // ---------- the Series: its groups (docs/drop-groups.md), numbers, chip
  // S.series.groups: each group of the drop (who can buy, price, coins, how many, when). The demo fills them from the
  // Standard preset (Store.demoStage), the live site from the contracts (live.js). Store.groupAccess(g): can this
  // wallet buy there now, and how many (or why not).
  const sold = () => S.series.phase >= 4;
  const groups = () => S.series.groups || [];
  const open = () => groups().filter((g) => g.state === 'open');
  const note = () => (LIVE ? S.series.note : null); // live: Loading…, Opens in 3h, Paused, No Series yet
  const nowS = () => Date.now() / 1000 + (Store.clockSkew || 0); // live: the chain's clock (live.js sets the skew)
  /** "3h 12m", "4m 05s": time until unix second `t`. */
  const until = (t) => {
    const s = Math.max(0, Math.round(t - nowS())), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
  };
  // countdowns: any element with data-until="<unix seconds>" shows the time left, refreshed every second
  const tickCountdowns = () => document.querySelectorAll('[data-until]').forEach((el) => { const t = until(+el.dataset.until); if (el.textContent !== t) el.textContent = t; });
  setInterval(tickCountdowns, 1000);
  const cd = (t) => `<span class="cd" data-until="${t}">${until(t)}</span>`;
  const money = (v) => Wear.usd(+(+v).toFixed(2));
  const paperTxt = (v) => `${(+(+v).toFixed(4)).toLocaleString('en-US')} PAPER`;
  /** A group's price for one pack now, for people: "$2.50 + 1 PAPER", "1 PAPER", "Free". */
  const priceTxt = (g) => {
    const usd = g.next ? g.next.usd : g.priceUsd;
    return g.priceUsd > 0 ? `${money(usd)} + ${paperTxt(g.paper)}` : g.paper > 0 ? paperTxt(g.paper) : 'Free';
  };
  const coinsTxt = (g) => (!g.coins.length ? '' : g.coins.length === 3 ? 'PLANK, ETH or USDG' : g.coins.length === 1 ? `${g.coins[0]} only` : g.coins.join(' or '));
  const pct = (bps) => `${+(bps / 100).toFixed(2)}%`;
  const leftTxt = (g) => (g.left == null ? `+${pct(g.taxBps)} per pack` : `${g.left.toLocaleString('en-US')} left`);
  const groupName = (i) => groups()[i]?.name || `group ${i + 1}`;
  /** Why a sold-out group may still get packs: "more may come in 4h 59m". */
  const moreTxt = (g) => `more may come${g.moreAt ? ` in ${cd(g.moreAt)}` : ' soon'}`;
  /** The group(s) opening next, for people (the earliest first). */
  function nextUp() {
    const up = groups().filter((g) => g.state === 'upcoming').sort((a, b) => (a.opensAt || 9e12) - (b.opensAt || 9e12));
    const g = up[0];
    if (!g) return null;
    const when = g.opensAt > nowS() ? `in ${cd(g.opensAt)}` : g.afterGroup != null && !g.opensAt ? `after ${esc(groupName(g.afterGroup))}` : 'soon';
    return { g, html: `Next: <b>${esc(g.name)}</b> · ${when}` };
  }
  function syncScene() {
    const x = Store.extraOpen(), timed = open().find((g) => g.endsAt > 0 && g.opensAt > 0 && !g.unlimited);
    const frac = timed ? Math.max(0, Math.min(1, (timed.endsAt - nowS()) / (timed.endsAt - timed.opensAt))) : 0;
    window.Scene?.setState({ left: x ? 999 : Store.left(), total: S.series.total, burnCount: S.wallet.burnCount, series: S.series.no, windowFrac: frac, openable: Stations.openableCount() > 0, extra: x ? money(x.next?.usd ?? x.priceUsd) : null });
  }
  function renderChip() {
    const c = $('#seriesChip'), x = Store.extraOpen();
    const html = note() ? `${S.series.no ? `Series ${S.series.no} · ` : ''}<b>${esc(note())}</b>` : sold() ? `Series ${S.series.no} · <b>Sold out</b>`
      : S.series.closing ? `Series ${S.series.no} · <b>Closing…</b>` : x ? `Series ${S.series.no} · <b>Extra packs</b> · ${money(x.next?.usd ?? x.priceUsd)}`
      : `Series ${S.series.no} · <b>${Store.left()}</b> left${open().length ? '' : ' · <i>soon</i>'}`;
    if (c._html !== html) { c._html = html; c.innerHTML = html; } // only on a real change: a node swapped under a click eats it
  }
  /** The Buy box's options: one per open group (the ones this wallet can't use greyed, with why), a free pack, and
   *  what opens next. Each: [key, title, sub html, class]. */
  function buyButtons() {
    const w = S.wallet, out = [];
    if (note()) return { line: note(), opts: [], next: null };
    if (sold()) return { line: `Series ${S.series.no} sold out`, opts: [], next: null }; // just the tease: Open packs is already on the scene / in the stations
    if (S.series.closing) return { line: 'Sales over', opts: [], next: null, sub: 'Packs open in a moment.' };
    let main = false;
    const rows = open().map((g) => {
      const a = g.waiting || g.left === 0 ? null : Store.groupAccess(g);
      return { g, a, usable: !!(a?.ok || a?.ask) }; // ask: holds the NFT, the checkout asks which one
    }).sort((x, y) => y.usable - x.usable || x.g.index - y.g.index);
    for (const { g, a, usable } of rows) {
      if (g.unlimited) {
        const p = g.next;
        out.push([`g${g.index}`, 'Extra pack', p ? `${money(p.usd)} + ${paperTxt(g.paper)}<br>+${pct(g.taxBps)} each${g.endsAt ? ` · ends in ${cd(g.endsAt)}` : ''}` : 'Price cap reached',
          usable && p ? (main ? 'extra' : (main = true, 'extra main')) : 'off']);
        continue;
      }
      const sub = g.waiting ? `Sold out · ${moreTxt(g)}` : g.left === 0 ? 'Sold out' : usable ? `${priceTxt(g)}${coinsTxt(g) && g.coins.length < 3 ? ` · ${coinsTxt(g)}` : ''}<br>${leftTxt(g)}${g.endsAt ? ` · ends in ${cd(g.endsAt)}` : ''}` : esc(a?.why || g.who);
      out.push([`g${g.index}`, esc(g.name), sub, usable ? (main ? 'alt' : (main = true, 'main')) : 'off']);
    }
    const cg = groups()[S.series.creditGroup];
    if (w.credits > 0 && cg?.state === 'open' && S.series.creditPacksLeft !== 0) out.push(['free', `Free pack (${w.credits})`, `${paperTxt(cg.paper)}<br>any time`, 'gold']);
    const x = Store.extraOpen();
    return { line: x ? 'Extra packs' : open().length ? 'On sale now' : `Series ${S.series.no}`, opts: out, next: nextUp() };
  }
  // Background Store updates (other buyers, burns landing) must never re-create these buttons under a click or a
  // keyboard focus: the boxes are rebuilt only when what they show changes, else just the bar's header text is patched;
  // a rebuild puts focus back on the same button (by its data-buy key). Countdowns tick in place (data-until).
  let buyKey = '';
  function renderBuy() {
    const { line, opts, next, sub } = buyButtons(), t = Store.tease(), tease = t && !t.live ? t : null;
    const x = Store.extraOpen();
    const head = sold() || S.series.closing || x || note() ? line : `${Store.left()} left · ${line}`; // phones: no Series chip up top, so the bar's header says how many are left
    const strip = (h) => String(h).replace(/<span class="cd" data-until="(\d+)">[^<]*<\/span>/g, '<cd $1>'); // the key ignores the ticking text
    const key = JSON.stringify([line, opts.map((o) => o.map(strip)), next && strip(next.html), sub, tease && [tease.no, tease.id, tease.line], sold()]);
    if (key === buyKey) { const ph = $('#buybar .phase'); if (ph && ph.textContent !== head) ph.textContent = head; return; }
    buyKey = key;
    const a = document.activeElement, box = a?.closest?.('#buybox, #buybar');
    const back = box && (a.dataset.buy ? `#${box.id} [data-buy="${a.dataset.buy}"]` : a.classList.contains('tease-inline') ? `#${box.id} .tease-inline` : null);
    const optsHtml = (list) => list.length ? '<div class="opts">' + list.map(([k, t, sub, cls]) =>
      `<button class="opt ${cls}" type="button" data-buy="${k}"${cls === 'off' ? ' aria-disabled="true"' : ''}>${/main/.test(cls) && !/extra/.test(cls) ? '<img class="mini" src="a/pack.webp" alt="">' : ''}<span>${t}${sub ? `<small>${sub}</small>` : ''}</span></button>`).join('') + '</div>' : '';
    const extras = (next ? `<p class="gnext">${next.html}</p>` : '') + (sub ? `<p class="gnext">${sub}</p>` : '');
    $('#buybox').innerHTML = `<div class="phase"></div>${optsHtml(opts)}${extras}`; $('#buybox .phase').textContent = line;
    // sold out, the stations' Open packs is enough
    // phones: the bar is one row (the main way to buy) with "More" for the rest, so it never covers the page (short
    // phones, browser toolbars); open, it lists everything over the page
    $('#buybar').innerHTML = `<div class="phase"></div>${optsHtml(sold() ? [] : opts)}${sold() ? '' : extras}<button class="bb-more" type="button" aria-expanded="false" aria-controls="buybar" aria-label="All ways to buy"><span>More</span></button>`; $('#buybar .phase').textContent = head;
    $('#buybar').classList.remove('open'); $('#buybar .bb-more').onclick = () => barOpen(!$('#buybar').classList.contains('open'));
    $('#buybox').classList.toggle('many', opts.length > 2);
    // between Series: the next Series' tease sits right here on the main page
    if (tease) for (const box of [$('#buybox'), $('#buybar')]) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'tease-inline'; card.setAttribute('aria-label', `Series ${tease.no}: ${tease.line}`);
      card.innerHTML = `<span class="ti-fan"></span><span class="ti-text"><b>Series ${tease.no}</b><small>${tease.line}</small></span>`;
      card.onclick = () => Announce.open();
      card.querySelector('.ti-fan').append(Announce.fan(tease, { mini: true }));
      box.querySelector('.phase').after(card);
    }
    $('#buybox').classList.toggle('calm', sold() || !!S.series.closing); $('#buybar').classList.toggle('calm', sold() || !!S.series.closing); dockKey = ''; // the bar was rebuilt: the dock goes back in
    for (const b of document.querySelectorAll('[data-buy]')) b.onclick = () => {
      const k = b.dataset.buy;
      if (/^g\d+$/.test(k)) return openGroup(+k.slice(1));
      ({ buy: () => openGroup(), free: useFree, open: () => openStation('open'), cards: () => openStation('cards'), announce: () => Announce.open() })[k]?.();
    };
    if (back) $(back)?.focus({ preventScroll: true });
  }
  /** A group's Buy: its checkout, or (one this wallet can't use) why not. No index: the first one this wallet can use. */
  function openGroup(i) {
    if (i == null) { const g = open().find((x) => !x.waiting && x.left !== 0 && Store.groupAccess(x).ok) || open()[0]; if (!g) return toast(S.series.note || 'Nothing on sale right now', 'bad'); i = g.index; }
    const g = groups()[i];
    if (!g) return;
    if (g.state !== 'open') return Sheet.open('nope', { title: g.name, body: `<p class="lead">${g.state === 'ended' ? 'This group has ended.' : 'This group isn\'t open yet.'}</p>` });
    if (g.waiting || g.left === 0) return Sheet.open('nope', { title: g.name, body: `<p class="lead">Sold out.${g.waiting ? ` Unclaimed packs from ${esc(groupName(g.moreFrom))} land here ${g.moreAt ? `in ${cd(g.moreAt)}` : 'when it ends'}.` : ''}</p>` });
    const a = Store.groupAccess(g);
    if (!a.ok && LIVE && !S.wallet.connected) return Live.needWallet(() => openGroup(i)); // the wallet decides what it can use
    if (!a.ok && !a.ask) return Sheet.open('nope', { title: g.name, body: `<p class="lead">${esc(a.why || g.who)}.</p>` });
    return checkout(i);
  }
  // the peek buttons: what's in the Series on sale (sold out, the next one's tease sits in the Buy box / bar instead)
  // background updates rewrite nothing that didn't change (no DOM churn every tick)
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const setAttr = (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); };
  function renderPeek() {
    const t = Store.tease(), show = !!t?.live;
    document.querySelectorAll('[data-peek]').forEach((b) => { if (b.hidden !== !show) b.hidden = !show; });
    if (!show) return;
    document.querySelectorAll('.peek-fan img').forEach((im, i) => { const src = `ui/announce/${t.id}-${i % 2 ? 'fullart' : 'gold'}-sm.webp`; if (im.getAttribute('src') !== src) im.src = src; }); // this Series' own cards, small
    for (const id of ['#pPeekT', '#sPeekT']) setText($(id), `Series ${t.no}`);
    for (const id of ['#pPeek', '#sPeek']) setText($(id), t.line);
    document.querySelectorAll('[data-peek]').forEach((b) => setAttr(b, 'aria-label', `Series ${t.no}: what's in its packs`));
  }
  // ---------- the hero: the one main thing to do now. Packs ready to open: Open them (the demo's gift packs: "Open your 3
  // free packs"); else a sale on: Buy a pack; else See your cards (with what's next). Open shows only when a pack can
  // open (packs open once their Series sells out or closes). Burn, Case & grade and Suggest stay quiet until a first
  // pack is opened.
  const GIFT = LIVE ? [] : Object.keys(S.sealed).map(Number).filter((no) => no !== S.series.no && S.sealed[no] > 0); // the demo's starting packs
  const OPENED = 'omni.opened';
  const opened = () => { if (S.activity.some((a) => /^Opened/.test(a.text))) { try { localStorage.setItem(OPENED, '1'); } catch { /* private window */ } return true; }
    try { return !!localStorage.getItem(OPENED); } catch { return false; } };
  const plainTxt = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
  function heroOf() {
    const ready = Stations.openable(), n = ready.reduce((a, o) => a + o.n, 0);
    if (n) {
      const gift = ready.every((o) => GIFT.includes(o.series));
      return { kind: 'open', title: gift ? `Open your ${n} free ${n === 1 ? 'pack' : 'packs'}` : `Open packs (${n})`, sub: gift ? 'Tear one open' : `Series ${ready[0].series}${ready.length > 1 ? ' first' : ''}`,
        label: `${gift ? `Open your ${n} free` : `Open ${n}`} ${n === 1 ? 'pack' : 'packs'}`, go: () => openStation('open') };
    }
    if (!note() && !sold() && !S.series.closing && open().length) {
      const g = open().find((x) => !x.waiting && x.left !== 0 && Store.groupAccess(x).ok) || open().find((x) => !x.waiting && x.left !== 0);
      if (g) return { kind: 'buy', title: 'Buy a pack', sub: plainTxt(priceTxt(g)), label: `Buy a pack: ${plainTxt(priceTxt(g))}`, go: () => openGroup(g.index) };
    }
    const nx = !note() && !sold() ? nextUp() : null;
    const sub = note() || (sold() ? `Series ${S.series.no + 1} is coming` : nx ? plainTxt(nx.html) : `${S.cards.length} ${S.cards.length === 1 ? 'card' : 'cards'}`);
    return { kind: 'cards', title: 'See your cards', sub, label: `See your cards. ${sub}`, go: () => openStation('cards') };
  }
  let hero = null;
  const fmtChip = (n) => (n >= 1000 ? fmt(n) : String(+(+n).toFixed(n < 10 ? 2 : 1))); // "22.9", not "22.919": the chip stays short
  function renderCounts() {
    const sealed = Object.values(S.sealed).reduce((a, b) => a + b, 0), b = S.wallet.burnCount % 42;
    for (const id of ['pBurn', 'sBurn']) setText($('#' + id), `${b} / 42`);
    hero = heroOf();
    for (const [t, s, sel] of [['pOpenT', 'pOpen', '.pill.openp'], ['sOpenT', 'sOpen', '#openBtn']]) {
      setText($('#' + t), hero.title); setText($('#' + s), hero.sub); setAttr($(sel), 'aria-label', hero.label);
    }
    for (const k of ['open', 'buy', 'cards']) document.body.classList.toggle('hero-' + k, hero.kind === k);
    document.body.classList.toggle('fresh', !opened());
    setText($('#sCards'), `${S.cards.length} ${S.cards.length === 1 ? 'card' : 'cards'} · ${sealed} ${sealed === 1 ? 'pack' : 'packs'}`);
    const wb = $('#walletBtn span');
    const nm = mode === 'port' || innerWidth < 1500 ? '' : S.wallet.name; // phones: the icon and the balance, so the button fits beside the brand
    setText(wb, S.wallet.connected ? `${nm ? nm + ' · ' : ''}${fmtChip(S.wallet.balances.PAPER)} PAPER` : 'Connect');
    setAttr($('#walletBtn'), 'aria-label', S.wallet.connected ? `Wallet: ${fmt(S.wallet.balances.PAPER)} PAPER` : 'Connect a wallet');
    if (LIVE) { // prices from the contracts
      document.querySelectorAll('[data-price=psa]').forEach((el) => setText(el, `from ${Wear.usd(P.CASE_USD)}`));
      document.querySelectorAll('[data-price=suggest]').forEach((el) => setText(el, `${P.SUGGEST_PAPER} PAPER`));
      if (S.series.no) { setText($('.strip .sw'), `SERIES ${S.series.no}`); setAttr($('.strip .packart'), 'alt', `Series ${S.series.no} pack`); }
    }
    $('#walletBtn').classList.toggle('on', S.wallet.connected);
  }
  document.querySelectorAll('[data-hero]').forEach((b) => b.addEventListener('click', () => hero?.go()));
  // ---------- between Series: the quiet shift. Nothing on sale, so the press and the belt rest (the fire, casing and
  // grading carry on) and the suggestion box takes the spotlight: a warm light on the mailbox, a panel docked beside it
  // (on phones, in the bottom bar) and a slim banner up top.
  const SEEN = 'omni.quietSeen';
  const seen = () => { try { return !!localStorage.getItem(SEEN); } catch { return true; } };
  const left = (t) => { const m = Math.max(0, Math.round((t - Date.now()) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
  function dockHtml() {
    const W = Store.SUGGEST_WAVE, next = S.series.no + 1, look = W.wave === 'look', w = S.wallet;
    const mine = S.suggestions.filter((x) => x.at === 'Series ' + S.series.no).length;
    const need = Store.PRICES.SUGGEST_PAPER, short = w.connected && w.balances.PAPER < need;
    const last = Store.SUGGEST_RESULTS[Store.SUGGEST_RESULTS.length - 1], won = w.connected && last && Store.resultFor(last, w.full) === 'won';
    const cta = !w.connected ? '<button class="opt main" type="button" data-q="connect"><span>Connect wallet</span></button>'
      : short ? '<button class="opt main" type="button" data-q="paper"><span>Get PAPER</span></button>'
      : `<button class="opt main" type="button" data-q="suggest"><span>${look ? 'Suggest a theme' : 'Suggest a character'}</span></button>`;
    return `${seen() ? '' : '<span class="sd-start">Start here</span>'}
      <p class="sd-k">Help shape Series ${next}</p>
      <h3 class="sd-t">${look ? 'Suggest a theme and an art style' : 'Suggest a character'}</h3>
      ${look ? '' : `<p class="sd-pick">${esc(W.theme)} · ${esc(W.style)}</p>`}
      <p class="sd-how">${need} PAPER each. Get picked, win a free pack.</p>
      <p class="sd-meta">${W.closes ? `<span>Closes in <b>${left(W.closes)}</b></span>` : ''}<span><b>${W.count.toLocaleString('en-US')}</b> ideas in the box</span></p>
      ${w.connected ? `<p class="sd-bal">You have <b>${fmt(w.balances.PAPER)} PAPER</b>${short ? ` · need ${need}` : ''}</p>` : ''}
      <div class="opts">${cta}</div>
      ${mine && w.connected ? `<p class="sd-mine">${mine} sent · results soon</p>` : ''}
      ${won ? '<p class="sd-won">You won a free pack!</p>' : ''}${Store.SUGGEST_RESULTS.length ? '<button class="sd-res" type="button" data-q="results">Last results</button>' : ''}`;
  }
  let dockKey = '';
  function renderQuiet() {
    const q = sold();
    document.body.classList.toggle('quiet', q);
    const W = Store.SUGGEST_WAVE, ban = $('#qbanner'); ban.hidden = !q;
    if (!q) { dockKey = ''; return; }
    const html = dockHtml(), key = html;
    const banner = `<span>Help shape Series ${S.series.no + 1}</span><button class="qb-go" type="button" data-q="suggest">${W.wave === 'look' ? 'Suggest a theme' : 'Suggest a character'}</button>`;
    if (ban._html !== banner) { ban._html = banner; ban.innerHTML = banner; }
    if (key !== dockKey) {
      dockKey = key;
      $('#sdock').innerHTML = html;
      let bar = $('#buybar .sdock-bar'); // phones: the same panel, in the bottom bar
      if (!bar) { bar = document.createElement('div'); bar.className = 'sdock-bar'; $('#buybar').append(bar); }
      bar.innerHTML = html;
    }
    for (const b of document.querySelectorAll('[data-q]')) b.onclick = () => {
      try { localStorage.setItem(SEEN, '1'); } catch { /* private window */ }
      dockKey = ''; const k = b.dataset.q;
      if (k === 'suggest') openStation('suggest');
      if (k === 'paper') openGetPaper();
      if (k === 'connect') needWallet(() => render());
      if (k === 'results') openStation('results');
    };
  }
  setInterval(() => { if (sold()) { dockKey = ''; renderQuiet(); } }, 60000); // the countdown

  let bbH = 0;
  function barOpen(on) {
    const bar = $('#buybar'), m = $('#buybar .bb-more'); bar.classList.toggle('open', on);
    if (m) { m.setAttribute('aria-expanded', String(on)); m.querySelector('span').textContent = on ? 'Less' : 'More'; }
  }
  // the open bar closes on a tap outside it, Escape, or once an option is picked
  document.addEventListener('pointerdown', (e) => { if ($('#buybar')?.classList.contains('open') && !e.target.closest('#buybar')) barOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#buybar')?.classList.contains('open')) barOpen(false); });
  $('#buybar').addEventListener('click', (e) => { if (e.target.closest('[data-buy], [data-q], .tease-inline')) barOpen(false); });
  function render() {
    renderChip(); renderBuy(); renderPeek(); renderCounts(); renderQuiet(); syncScene(); placePills();
    const h = mode === 'port' && !$('#buybar').classList.contains('open') ? $('#buybar').offsetHeight : bbH; if (h !== bbH) { bbH = h; if (h) layout(); } // the Buy bar changed height: keep the stations clear of it
  }
  Store.on(render);

  // ---------- wallet
  function needWallet(then) { // demo: one click connects a demo wallet; live: the wallet window (Live)
    if (LIVE) return Live.needWallet(then);
    if (S.wallet.connected) return then();
    Store.update((s) => { s.wallet.connected = true; });
    toast('Demo wallet connected', 'good');
    setTimeout(then, 200);
  }
  $('#walletBtn').onclick = () => needWallet(openWallet);
  function openWallet() {
    if (LIVE) return Live.openWallet();
    const w = S.wallet, nm = esc(w.name), sealed = Object.values(S.sealed).reduce((a, n) => a + n, 0);
    const d = Sheet.open('wallet', { title: w.name || 'Wallet', body: `
      <div class="wmenu">
        <div class="who"><div class="avatar">${esc((w.name || '?')[0])}</div><div><b>${nm || 'No name yet'}</b><small>${esc(w.address)}</small></div><button class="btn small" type="button" data-w="name">Edit</button></div>
        <div class="bal">${Object.entries(w.balances).map(([k, v]) => `<div><small>${k}</small><b>${fmt(v)}</b></div>`).join('')}</div>
        <div class="rows">
          <div><span>Free packs</span><b>${w.credits}</b></div>
          <div><span>Burn progress</span><b>${w.burnCount % 42} / 42</b></div>
          <div><span>Sealed packs</span><b>${sealed}</b></div>
          <div><span>Cards</span><b>${S.cards.length}</b></div>
          ${w.pending.length ? `<div><span>Pending</span><b>${w.pending.length}</b></div>` : ''}
        </div>
        <div class="acts"><button class="btn primary" type="button" data-w="cards">My cards</button><button class="btn" type="button" data-w="paper">Get PAPER</button></div>
        <div class="acts"><button class="btn small" type="button" data-w="switch">Switch wallet</button><button class="btn small" type="button" data-w="out">Disconnect</button></div>
      </div>` });
    d.querySelector('[data-w=cards]').onclick = () => { d.close(); openStation('cards'); };
    window.Fun?.decorateWallet?.(d); // badges, showcase, binder (badges.js)
    d.querySelector('[data-w=paper]').onclick = () => { d.close(); openGetPaper(); };
    d.querySelector('[data-w=out]').onclick = () => { d.close(); Store.update((s) => { s.wallet.connected = false; }); };
    d.querySelector('[data-w=switch]').onclick = () => { d.close(); Store.update((s) => { s.wallet.connected = false; }); needWallet(openWallet); };
    d.querySelector('[data-w=name]').onclick = () => {
      const f = document.createElement('form'); f.className = 'namef';
      f.innerHTML = `<label for="nm">Name</label><input id="nm" maxlength="24" value="${esc(w.name)}"><button class="btn primary" type="submit">Save</button>`;
      f.onsubmit = (e) => { e.preventDefault(); Store.update((s) => { s.wallet.name = $('#nm', f).value.trim(); }); openWallet(); };
      Sheet.open('wallet', { title: 'Your name', body: f });
    };
    window.Profiles?.decorate(d); // profile.js: the avatar, the profile's name, Edit opens the profile editor
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

  // ---------- checkout: one per group
  // The coins the group takes, its PAPER (and "Pay the PAPER in ETH too" where ETH works), what it costs now. The
  // after-sell-out group (a rising price) gets its own panel and a clear confirm step before the wallet. Prices and
  // sending come from `api`: live, Live.groupApi (the contracts, re-quoted every 15 s, sent through the wallet); here,
  // the demo's (the demo prices, nothing sent).
  const idleTxt = (s) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} hours` : s >= 60 ? `${Math.round(s / 60)} minutes` : `${s} seconds`);
  const coinAmt = (v) => (v >= 1000 ? fmt(v) : (+v).toLocaleString('en-US', { maximumSignificantDigits: 4 }));
  const demoApi = {
    refresh: 0,
    prepare: async (g) => Store.groupAccess(g),
    quote: async (g, n) => {
      const { usd, tax } = Store.groupCost(g, n), paper = n * g.paper;
      const rate = { ETH: P.ETH_USD, PLANK: P.PLANK_USD, USDG: 1 };
      return { usd, tax, paper, paperEth: paper * P.PAPER_USD / P.ETH_USD * 1.003, coins: g.coins.map((c) => ({ pay: c, cost: usd / rate[c], available: true })) };
    },
    cap: (amt) => amt,
    async buy({ g, n, coin, all, q }) {
      await new Promise((r) => setTimeout(r, 900));
      const paid = (coin ? q.coins.find((c) => c.pay === coin).cost : 0) + (all ? q.paperEth : 0), payIn = coin || (all ? 'ETH' : null);
      Store.update((s) => {
        const x = s.series.groups[g.index];
        if (!all) { s.wallet.balances.PAPER -= q.paper; Store.spend('PAPER', q.paper); }
        if (payIn) { s.wallet.balances[payIn] -= paid; Store.spend(payIn, paid); }
        x.sold += n; if (x.left != null) x.left -= n; if (x.unlimited) x.endsAt = Math.floor(Date.now() / 1000) + x.idle;
        s.wallet.boughtIn[g.index] = (s.wallet.boughtIn[g.index] || 0) + n;
        Store.log(`${s.wallet.name || 'You'} bought ${n} ${n === 1 ? 'pack' : 'packs'}`);
      });
      sendPacks(n); window.Sound?.play('pack-drop'); afterBuy(n); window.Fun?.emit('bought', { n });
      return true;
    },
  };
  function checkout(i) {
    const api = LIVE ? Live.groupApi : demoApi;
    needWallet(async () => {
      const g0 = groups()[i];
      if (!g0 || g0.state !== 'open') return;
      const acc = await api.prepare(g0);
      if (!acc) return; // live: the holder closed the "which NFT" question
      if (!acc.ok) return Sheet.open('nope', { title: g0.name, body: `<p class="lead">${esc(acc.why || g0.who)}.</p>` });
      const max = Math.max(1, acc.max || 1), extra = g0.unlimited || g0.taxBps > 0;
      let n = 1, cur = g0.coins[0] || null, q = null, seq = 0, ethAll = null, view = 'form', busy = false, notice = '', understood = false;
      const body = document.createElement('div'); body.className = 'checkout' + (extra ? ' xcheck' : '');
      const requote = (quiet) => {
        const k = ++seq; if (!quiet) { q = null; redraw(body, draw); }
        return api.quote(groups()[i], n).then((r) => { if (k === seq && (!quiet || JSON.stringify(r) !== JSON.stringify(q))) { q = r; if (view === 'form' || !quiet) redraw(body, draw); } return r; }, () => null);
      };
      // while the sheet is open: re-quote every api.refresh ms, and redraw on what it shows (the wallet, e.g. a Get
      // PAPER on top; the group: someone else's buy, its end). Started on every open, stopped on close.
      let tick = 0, stopWatch = () => {};
      const start = () => {
        tick = api.refresh ? setInterval(() => { if (!body.isConnected) return clearInterval(tick); if (!document.hidden && !busy) requote(true); }, api.refresh) : 0;
        stopWatch = watch(body, () => { if (!busy) draw(); }, () => JSON.stringify([walletKey(), groups()[i]?.sold, groups()[i]?.left, groups()[i]?.endsAt, groups()[i]?.state]));
      };
      const stop = () => { seq++; clearInterval(tick); stopWatch(); };
      const pack = (k) => `${k} ${k === 1 ? 'pack' : 'packs'}`;
      const draw = () => {
        const g = groups()[i], w = S.wallet, priced = g.priceUsd > 0;
        const qc = q?.coins.find((c) => c.pay === cur), paper = q ? q.paper : n * g.paper;
        const canAll = q?.paperEth != null && paper > 0 && (!priced || cur === 'ETH');
        const allOn = canAll && (ethAll ?? w.balances.PAPER < paper); // ETH pays for the PAPER too: the sale buys it on the market and burns it
        const payIn = priced ? cur : allOn ? 'ETH' : null;
        const amt = (priced ? qc?.cost || 0 : 0) + (allOn ? q.paperEth : 0);
        const shortCur = !!(q && payIn && w.balances[payIn] < api.cap(amt, payIn)), needPaper = w.balances.PAPER < paper && !allOn;
        const missing = Math.ceil((paper - w.balances.PAPER) * 1e4) / 1e4;
        const need = LIVE || needPaper || shortCur ? null : [...(allOn ? [] : [['PAPER', paper]]), ...(priced && cur !== 'ETH' ? [[cur, amt]] : [])].find(([k, v]) => Store.needsApproval(k, v));
        const off = busy || !q || (priced && !qc?.available) || needPaper || shortCur;
        const usd = q ? q.usd : Store.groupCost(g, n).usd;
        const confirms = allOn ? 1 : !priced || cur === 'ETH' ? 2 : 3;
        const costTxt = `${priced && qc?.available ? `≈ ${coinAmt(qc.cost)} ${cur}` : ''}${allOn ? `${priced ? ' + ' : '≈ '}${coinAmt(q.paperEth)} ETH for the PAPER` : ''}`;
        if (view === 'confirm') {
          const nextP = n === 1 && g.after?.[0] ? g.after[0].usd : Store.packPrice({ ...g, sold: g.sold + n }, 1).usd; // the pack after these
          body.innerHTML = `<div class="xconfirm" role="alert">
              <h3>${n === 1 ? 'Extra pack' : `${n} extra packs`}: ${money(usd)} + ${paperTxt(paper)}</h3>
              <ul>
                ${costTxt ? `<li>${esc(costTxt)}</li>` : ''}
                <li>Next one costs ${money(nextP)}.</li>
                <li>Sales end ${idleTxt(g.idle)} after the last buy.</li>
              </ul>
              <label class="paycheck"><input type="checkbox" data-ok ${understood ? 'checked' : ''}><span><b>Got it</b></span></label>
            </div>${LIVE ? '' : DEMO_LINE}
            <button class="btn primary go" type="button" ${understood && !busy ? '' : 'disabled'}>${busy ? 'Checking the price…' : `Buy for ${money(usd)}`}</button>
            <button class="btn" type="button" data-x="back">Back</button>`;
          body.querySelector('[data-ok]').onchange = (e) => { understood = e.target.checked; redraw(body, draw); };
          body.querySelector('[data-x=back]').onclick = () => { view = 'form'; understood = false; redraw(body, draw); };
          body.querySelector('.go').onclick = () => go();
          return;
        }
        const head = extra
          ? `<div class="xpanel"><p class="xhead">Extra pack: <b>${money(usd / n)}</b></p>
              <p>+${pct(g.taxBps)} each sale. Sales end ${idleTxt(g.idle)} after the last buy.</p>
              ${g.endsAt ? `<p class="xend">Ends in ${cd(g.endsAt)} if nobody buys.</p>` : ''}
              ${g.after?.length ? `<p class="xnext">Then ${g.after.map((x) => money(x.usd)).join(', ')}…</p>` : ''}</div>`
          : `<p class="lead">${esc(g.who)} · ${esc(leftTxt(g))}${g.endsAt ? ` · ends in ${cd(g.endsAt)}` : ''}</p>`;
        body.innerHTML = `${head}${notice ? `<p class="xmoved" role="alert">${esc(notice)}</p>` : ''}
          ${max > 1 ? `<div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output aria-live="polite">${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button>
            <span class="muted">${n === 1 ? 'pack' : 'packs'} · max ${max}</span></div>` : ''}
          ${priced && g.coins.length > 1 ? `<div class="seg" role="group" aria-label="Pay with">${g.coins.map((c) => `<button type="button" data-c="${c}" aria-pressed="${c === cur}">${c}</button>`).join('')}</div>` : ''}
          <dl class="sum">${priced ? `<dt>Price</dt><dd>${money(usd)} <small>${!q ? '· getting price…' : qc?.available ? `≈ ${coinAmt(qc.cost)} ${cur}` : esc(qc?.reason || 'Not available')}</small></dd>` : ''}
            <dt>PAPER</dt><dd>${(+paper.toFixed(4)).toLocaleString('en-US')} ${P.PAPER_USD > 0 ? `<small>≈ ${money(paper * P.PAPER_USD)}</small>` : ''}</dd>
            ${allOn ? `<dt>Total</dt><dd>≈ ${coinAmt(amt)} ETH <small>${priced ? '(price + PAPER)' : '(PAPER)'}</small></dd>` : ''}
            <dt>You have</dt><dd>${payIn ? `${coinAmt(w.balances[payIn])} ${payIn} <small>· ` : '<small>'}${(+w.balances.PAPER.toFixed(2)).toLocaleString('en-US')} PAPER</small></dd></dl>
          ${canAll ? `<label class="paycheck"><input type="checkbox" data-all ${allOn ? 'checked' : ''}><span><b>Pay PAPER with ETH</b><small>One step. We buy the PAPER for you.</small></span></label>` : ''}
          ${needPaper ? `<div class="getpaper"><p class="warn">Need ${missing.toLocaleString('en-US')} more PAPER.</p><button class="btn small" type="button" data-x="paper">Get PAPER</button></div>` : ''}
          ${shortCur ? `<p class="warn">Not enough ${payIn}.${LIVE && payIn !== 'USDG' ? ` Keep 3% extra${payIn === 'ETH' ? ' plus a little for fees' : ''}.` : ''}${!LIVE && payIn !== 'ETH' ? ` <button class="btn small" type="button" data-x="cur">Get ${payIn}</button>` : ''}</p>` : ''}
          <p class="fine">${confirms === 1 ? '1 tap in your wallet.' : `Up to ${confirms} taps in your wallet.`} Price moves over 3%? Nothing is charged.</p>
          ${LIVE ? '' : DEMO_LINE}
          <button class="btn primary go" type="button" ${off ? 'disabled' : ''}>${busy ? 'Sending…' : need ? `Approve ${need[0]}` : extra ? `Buy for ${money(usd)}` : priced ? `Buy ${pack(n)}` : `Claim ${pack(n)}`}</button>`;
        body.querySelector('[data-all]')?.addEventListener('change', (e) => { ethAll = e.target.checked; redraw(body, draw); });
        body.querySelector('[data-x=paper]')?.addEventListener('click', () => { Sheet.close('buy'); if (LIVE) Live.getPaper(missing, () => checkout(i)); else openGetPaper('PAPER'); });
        body.querySelector('[data-x=cur]')?.addEventListener('click', () => openGetPaper(cur));
        body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(max, n + +b.dataset.q)); notice = ''; requote(); });
        body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; redraw(body, draw); });
        body.querySelector('.go').onclick = () => {
          if (off) return;
          if (need) { busy = true; redraw(body, draw); return approveNow(need[0], need[1], () => { busy = false; redraw(body, draw); }); }
          if (extra) { view = 'confirm'; understood = false; return redraw(body, draw); }
          go();
        };
      };
      // the buy itself: the price shown (and its PAPER in ETH) caps it at that + 3%. A rising-price group checks the
      // price again first: if someone bought meanwhile, the buyer sees the new price instead of a refusal.
      const moved = (fresh) => {
        if (LIVE) Live.sync(); // the group's count and next prices move on too
        notice = extra ? `Someone beat you to it. Next one: ${money(fresh.usd / n)}.` : `Price changed to ${money(fresh.usd)}. Nothing charged.`;
        view = 'form'; understood = false; q = fresh;
      };
      async function go() {
        const g = groups()[i], priced = g.priceUsd > 0, shown = q, paper = q?.paper ?? 0;
        if (!shown || busy) return;
        const canAll = shown.paperEth != null && paper > 0 && (!priced || cur === 'ETH');
        const all = canAll && (ethAll ?? S.wallet.balances.PAPER < paper);
        if (extra) {
          busy = true; redraw(body, draw);
          const fresh = await api.quote(g, n).catch(() => null);
          busy = false;
          if (!fresh) { notice = 'Couldn\'t check the price. Try again.'; view = 'form'; return redraw(body, draw); }
          if (fresh.usd > shown.usd + 0.005) { moved(fresh); return redraw(body, draw); }
        }
        Sheet.close('buy');
        const r = await api.buy({ g, n, coin: priced ? cur : null, all, q: shown });
        if (r === 'moved') { // refused by the price check on chain (PriceMoved): show the new price, not an error
          const fresh = await api.quote(groups()[i], n).catch(() => null);
          if (fresh) moved(fresh); else notice = 'Someone just bought it. Check the new price.';
          view = 'form'; understood = false;
          redraw(body, draw); Sheet.open('buy', { title: extra ? 'Extra packs' : g.name, body, onClose: stop }); start();
        }
      }
      redraw(body, draw);
      Sheet.open('buy', { title: extra ? 'Extra packs' : g0.name, body, onClose: stop }); start();
      requote();
    });
  }
  function useFree() {
    if (LIVE) return Live.free();
    needWallet(() => {
      let n = 1, busy = false; const cg = groups()[S.series.creditGroup], per = cg ? cg.paper : P.PACK_PAPER;
      const body = document.createElement('div'); body.className = 'checkout';
      const draw = () => {
        const w = S.wallet; n = Math.max(1, Math.min(w.credits, n));
        const paper = n * per, short = w.balances.PAPER < paper, need = !short && Store.needsApproval('PAPER', paper);
        body.innerHTML = `<p class="lead">Free packs still cost ${per} PAPER each.</p>
          ${w.credits > 1 ? `<div class="qty"><button class="btn round" type="button" data-q="-1" aria-label="One fewer">−</button><output>${n}</output><button class="btn round" type="button" data-q="1" aria-label="One more">+</button><span class="muted">of ${w.credits}</span></div>` : ''}
          <dl class="sum"><dt>PAPER</dt><dd>${paper}</dd><dt>You have</dt><dd>${w.balances.PAPER} PAPER</dd></dl>
          ${short ? shortLine('PAPER', paper - w.balances.PAPER) : ''}${DEMO_LINE}
          <button class="btn gold go" type="button" ${short ? 'disabled' : ''}>${busy ? 'Sending…' : need ? 'Approve PAPER' : `Use ${n} free ${n === 1 ? 'pack' : 'packs'}`}</button>`;
        body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { n = Math.max(1, Math.min(S.wallet.credits, n + +b.dataset.q)); redraw(body, draw); });
        body.querySelector('[data-x=paper]')?.addEventListener('click', () => openGetPaper('PAPER'));
        body.querySelector('.go').onclick = () => {
          if (busy || short) return;
          if (need) { busy = true; redraw(body, draw); return approveNow('PAPER', paper, () => { busy = false; redraw(body, draw); }); }
          Sheet.close('free');
          Store.update((s) => { s.wallet.credits -= n; s.wallet.balances.PAPER -= paper; Store.spend('PAPER', paper); const x = s.series.groups[s.series.creditGroup]; if (x) { x.sold += n; if (x.left != null) x.left -= n; } });
          sendPacks(n); window.Sound?.play('pack-drop'); afterBuy(n, true); window.Fun?.emit('bought', { n });
        };
      };
      draw(); Sheet.open('free', { title: S.wallet.credits > 1 ? 'Free packs' : 'Free pack', body, onClose: watch(body, draw, walletKey) });
    });
  }
  function openGetPaper(token = 'PAPER') {
    if (LIVE) return Live.getPaper();
    let tok = token, amt = tok === 'PAPER' ? 10 : tok === 'USDG' ? 25 : 1000000;
    const body = document.createElement('form'); body.className = 'checkout';
    const usdOf = () => tok === 'PAPER' ? amt * P.PAPER_USD : tok === 'USDG' ? amt : amt * P.PLANK_USD;
    const ethOf = () => usdOf() / P.ETH_USD * 1.003; // what it costs in ETH (the pools' trading fee included)
    // nothing to swap for 0 (or less); connected, the ETH has to be there
    const why = () => !(amt > 0 && ethOf() > 0) ? 'Enter an amount' : S.wallet.connected && ethOf() > S.wallet.balances.ETH ? 'Not enough ETH' : '';
    const paint = () => {
      body.querySelector('.sum dd').innerHTML = `${ethOf().toFixed(5)} ETH <small>≈ ${Wear.usd(usdOf() * 1.003)}</small>`;
      const go = body.querySelector('.go'), w = why(); go.disabled = !!w; go.textContent = w || `Get ${fmt(amt)} ${tok}`;
    };
    const draw = () => {
      const hd = document.querySelector('#sheet-paper .sheet-head h2'); if (hd) hd.textContent = 'Get ' + tok; // the title follows the token
      body.innerHTML = `<div class="seg" role="group" aria-label="Get">${['PAPER', 'PLANK', 'USDG'].map((c) => `<button type="button" data-t="${c}" aria-pressed="${c === tok}">${c}</button>`).join('')}</div>
        <label class="amt" for="amt">How much ${tok}</label><input id="amt" inputmode="decimal" value="${amt}">
        <dl class="sum"><dt>You pay</dt><dd></dd></dl>
        ${DEMO_LINE}<button class="btn primary go" type="submit"></button><p class="fine">Best price across all pools. 1 tap.</p>`;
      body.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tok = b.dataset.t; amt = tok === 'PAPER' ? 10 : tok === 'USDG' ? 25 : 1000000; redraw(body, draw); });
      $('#amt', body).oninput = (e) => { const v = parseFloat(e.target.value); amt = Number.isFinite(v) ? v : 0; paint(); };
      paint();
    };
    body.onsubmit = (e) => {
      e.preventDefault(); if (why()) return;
      needWallet(() => { if (why()) return paint(); const eth = ethOf(), got = amt, t = tok; Sheet.close('paper'); Store.update((s) => { s.wallet.balances[t] += got; s.wallet.balances.ETH -= eth; }); toast(`+${fmt(got)} ${t}`, 'good'); did.add('paper'); });
    };
    draw(); Sheet.open('paper', { title: 'Get ' + tok, body });
  }
  // ---------- New here? a short checklist. A step ticks only for what this visitor did in this visit (the demo wallet
  // starts with PAPER and packs: that's not them having done it); packs ready to open come first, with the main button.
  const did = new Set(); // 'paper', 'buy' this visit (connect, open and grade are read from the state)
  function openStart() {
    const ready = () => Stations.openableCount();
    const opened = () => S.activity.some((a) => a.text.startsWith('Opened'));
    const open = ['Open your packs', () => (ready() ? `${ready()} ready to open now.` : 'Packs open when sales end.'), opened, 'Open packs', () => openStation('open')];
    const rest = [
      ['Connect a wallet', 'Any wallet on Robinhood Chain.', () => S.wallet.connected, 'Connect', () => needWallet(() => openStart())],
      ['Get PAPER', 'Every pack takes some.', () => did.has('paper'), 'Get PAPER', () => openGetPaper()],
      ['Buy a pack', 'PLANK, ETH or USDG, plus PAPER. Opens when sales end.', () => did.has('buy'), 'Buy', () => openGroup()],
      ['Case or grade', 'Within 24h to stop wear.', () => S.activity.some((a) => a.text.startsWith('Paid')), 'Case & grade', () => Stations.open('grade')],
    ];
    const steps = ready() && !opened() ? [open, ...rest] : [...rest.slice(0, 3), open, rest[3]];
    const body = document.createElement('div'); body.className = 'start';
    const draw = () => {
      const first = steps.findIndex(([, , done]) => !done()); // the next thing to do gets the main button
      body.innerHTML = `<ol class="start-list">${steps.map(([t, sub, done, b], i) => `<li class="${done() ? 'done' : ''}">
          <span class="start-n" aria-hidden="true">${done() ? '✓' : i + 1}</span><span class="start-t"><b>${t}</b><small>${typeof sub === 'function' ? sub() : sub}</small></span>
          ${done() ? '<span class="sr">Done</span>' : `<button class="btn small${i === first ? ' primary' : ''}" type="button" data-s="${i}">${b}</button>`}</li>`).join('')}</ol>
        <p class="menu-links"><button class="inf-link" type="button" data-s="fun:practice">Rip a practice pack</button><button class="inf-link" type="button" data-s="fun:tour">Workshop tour</button><button class="inf-link" type="button" data-s="info">Info</button><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>`;
      body.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { Sheet.close('start'); if (b.dataset.s === 'info') return Info.open(); if (b.dataset.s.startsWith('fun:')) return window.Fun?.go(b.dataset.s.slice(4)); steps[+b.dataset.s][4](); });
    };
    draw(); Sheet.open('start', { title: 'New here?', body });
  }
  // ---------- after a buy: packs can't open until the sale ends, so the end of a buy says so, with what's left in the
  // sale, a way to My packs, and any packs that can open now. Not a sheet: it never blocks the next buy. The demo can
  // skip to the sell-out so a visitor can open what they bought.
  function afterBuy(n, free = false) {
    did.add('buy');
    document.querySelector('.receipt')?.remove();
    const ready = Stations.openableCount(), x = Store.extraOpen(), left = Store.left();
    const el = document.createElement('div'); el.className = 'receipt'; el.setAttribute('role', 'status');
    el.innerHTML = `<button class="x" type="button" aria-label="Close">×</button>
      <p class="rc-t"><b>${n === 1 ? (free ? 'Free pack added' : 'Pack added') : `${n} ${free ? 'free ' : ''}packs added`}</b> · ${n === 1 ? 'opens' : 'they open'} when sales end</p>
      <p class="rc-s">${x ? 'Extra packs on sale now' : sold() ? `Series ${S.series.no} is sold out` : `${left.toLocaleString('en-US')} ${left === 1 ? 'pack' : 'packs'} left`}</p>
      ${ready ? `<p class="rc-r">You have ${ready} ${ready === 1 ? 'pack' : 'packs'} ready to open</p>` : ''}
      <div class="rc-a">${ready ? '<button class="btn small gold" type="button" data-r="open">Open one</button>' : ''}<button class="btn small" type="button" data-r="cards">My packs</button>${LIVE ? '' : '<button class="btn small ghost" type="button" data-r="skip">End sales <i>(demo)</i></button>'}</div>`;
    let t = 0; const close = () => { clearTimeout(t); el.classList.remove('on'); setTimeout(() => el.remove(), 250); };
    const later = () => { clearTimeout(t); t = setTimeout(close, 9000); };
    el.querySelector('.x').onclick = close;
    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { close(); ({ open: () => openStation('open'), cards: () => openStation('cards'), skip: skipToSellOut })[b.dataset.r](); });
    el.addEventListener('pointerenter', () => clearTimeout(t)); el.addEventListener('pointerleave', later); el.addEventListener('focusin', () => clearTimeout(t));
    document.body.append(el); requestAnimationFrame(() => el.classList.add('on')); later();
  }
  // DEMO: the sale sells out now (packs on their way land at once), so the packs just bought can be opened
  function skipToSellOut() {
    if (LIVE) return;
    const n = pendingDeliver; pendingDeliver = 0;
    Store.update((s) => { if (n) s.sealed[s.series.no] = (s.sealed[s.series.no] || 0) + n; Store.demoStage('closed'); });
    window.Scene?.finale?.(); setTimeout(() => toast('Sales ended (demo). Open your packs!', 'good'), 600);
  }
  window.UI = { openGetPaper, checkout, openStart, approveNow, afterBuy, openGroup };

  // ---------- activity, menu, demo
  function openFeed() {
    if (window.Fun) return Fun.go('feed'); // the fun layer's feed: pulls, top stokers, activity (feed.js)
    const items = S.activity.length ? S.activity : [{ text: 'No activity yet' }];
    Sheet.open('feed', { title: 'Activity', body: `<ul class="feed">${items.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul>` });
  }
  function openMenu() {
    const d = Sheet.open('menu', { title: 'Menu', body: `<div class="menu">
      <button class="btn" type="button" data-m="cards">${svg('cards')}My cards</button><button class="btn" type="button" data-m="open">${svg('pack')}Open packs${Stations.openableCount() ? ` (${Stations.openableCount()})` : ''}</button>
      <button class="btn" type="button" data-m="paper">${svg('paper')}Get PAPER</button><button class="btn" type="button" data-m="info">${svg('info')}Info</button>
      <button class="btn" type="button" data-m="feed">${svg('feed')}Activity</button><button class="btn" type="button" data-m="sound">${svg('sound')}Sound: ${window.Sound?.on ? 'On' : 'Off'}</button>
      <button class="btn" type="button" data-m="start">New here?</button>${LIVE ? '' : '<button class="btn" type="button" data-m="demo">Demo controls</button>'}
      <button class="btn" type="button" data-m="fun:practice">Practice pack</button><button class="btn" type="button" data-m="fun:binder">Binder</button>
      <button class="btn" type="button" data-m="fun:showcase">Showcase</button><button class="btn" type="button" data-m="fun:badges">Badges</button>
      <button class="btn" type="button" data-m="fun:tour">Workshop tour</button>${window.Fun?.haptics?.supported ? `<button class="btn" type="button" data-m="haptics">Vibration: ${Fun.haptics.on ? 'On' : 'Off'}</button>` : ''}</div>
      <p class="menu-links"><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>` });
    d.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { d.close(); go(b.dataset.m); });
  }
  let auto = null;
  function openDemo() {
    const d = Sheet.open('demo', { title: 'Demo controls', body: `<p class="lead">Jump the demo to any stage of a sale.</p><div class="menu">
      <button class="btn" type="button" data-d="phase">Next stage</button><button class="btn" type="button" data-d="sold">Sold-out show</button>
      <button class="btn" type="button" data-d="after">Extra packs</button><button class="btn" type="button" data-d="waiting">More may come</button>
      <button class="btn" type="button" data-d="between">Between Series</button>
      <button class="btn" type="button" data-d="res-won">Results: you won</button><button class="btn" type="button" data-d="res-lost">Results: not picked</button><button class="btn" type="button" data-d="res-none">No results yet</button>
      <button class="btn" type="button" data-d="auto">${auto ? 'Stop' : 'Start'} crowd</button><button class="btn" type="button" data-d="credit">+1 free pack</button><button class="btn" type="button" data-d="announce">Series tease</button>
      <button class="btn" type="button" data-d="holder">Holder: ${S.wallet.isPressHolder || S.wallet.inSnapshot ? 'On' : 'Off'}</button><button class="btn" type="button" data-d="bot">${S.wallet.isContract ? 'Regular wallet' : 'Contract wallet'}</button>
      <button class="btn" type="button" data-d="reset">Reset</button></div>` });
    d.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
      const k = b.dataset.d; d.close();
      const STAGES = ['holders', 'open', 'waiting', 'after'];
      if (k === 'phase') Store.update(() => Store.demoStage(STAGES[(STAGES.indexOf(S.series.stage) + 1) % STAGES.length]));
      if (k === 'after' || k === 'waiting') Store.update(() => Store.demoStage(k));
      if (k === 'sold') { // Everyone down to its last 3 packs, and the crowd takes them: the after-sell-out group opens
        Store.update((s) => { Store.demoStage('open'); const g = s.series.groups[2]; g.sold = g.capacity - 3; g.left = 3; });
        crowd += 3; window.Scene?.buy(3);
      }
      if (k === 'auto') { if (auto) { clearInterval(auto); auto = null; } else auto = setInterval(() => { if (Store.left() > 0 || Store.extraOpen()) { crowd++; window.Scene?.buy(1); } }, 3200); }
      if (k === 'between') Store.update(() => Store.demoStage('closed'));
      if (k === 'credit') Store.update((s) => { s.wallet.credits++; });
      if (k === 'announce') Announce.open();
      if (k === 'holder') Store.update((s) => { const v = !(s.wallet.isPressHolder || s.wallet.inSnapshot); s.wallet.isPressHolder = v; s.wallet.inSnapshot = v; });
      if (k === 'bot') Store.update((s) => { s.wallet.isContract = !s.wallet.isContract; });
      if (k === 'reset') location.reload();
      if (k.startsWith('res-')) { // reload into that state (the results reveal shows again)
        try { localStorage.removeItem('omni.resultsSeen'); } catch { /* private window */ }
        const q = new URLSearchParams(location.search); q.set('results', k.slice(4)); if (sold()) q.set('between', ''); location.search = q.toString();
      }
    });
  }
  // sound is on by default (it starts on the first tap anywhere); the speaker turns it off, remembered per visitor
  $('#soundBtn').onclick = () => { const sound = window.Sound ? Sound.set(!Sound.on) : false; $('#soundBtn').setAttribute('aria-pressed', sound); $('#soundBtn').innerHTML = svg(sound ? 'sound' : 'mute'); toast(sound ? 'Sound: On' : 'Sound: Off'); };
  function go(k) {
    if (k.startsWith('fun:')) return window.Fun?.go(k.slice(4)); // the fun layer's screens (fun.js)
    if (k === 'haptics' && window.Fun?.haptics) return toast(`Vibration: ${Fun.haptics.set(!Fun.haptics.on) ? 'On' : 'Off'}`);
    if (k === 'paper') openGetPaper(); if (k === 'info') Info.open(); if (k === 'info-cards') Info.open('cards'); if (k === 'feed') openFeed();
    if (k === 'menu') openMenu(); if (k === 'demo' && !LIVE) openDemo(); if (k === 'start') openStart(); if (k === 'sound') $('#soundBtn').click();
    if (k === 'cards' || k === 'open') openStation(k);
  }
  // My cards opens the collection; Open packs goes straight to tearing the next pack, or (none to open) says why and points at Buy
  function openStation(k) {
    if (k !== 'open' || Stations.openableCount()) return Stations.open(k);
    const sealed = Object.values(S.sealed).reduce((a, b) => a + b, 0);
    if (sealed) return toast(`Your Series ${S.series.no} packs open when sales end.`);
    if (sold()) return toast(`No packs to open. Series ${S.series.no + 1} is coming soon`);
    toast('No packs to open yet. Buy one first!');
    const b = $(mode === 'desk' ? '#buybox [data-buy]' : '#buybar [data-buy]'); if (!b) return;
    b.focus({ preventScroll: true }); b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  document.querySelectorAll('.tools .chip[aria-label], .menu-btn').forEach((b) => { b.title = b.getAttribute('aria-label'); }); // icon-only buttons say what they are on hover
  $('#seriesChip').onclick = () => Info.open('buy');
  document.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => openStation(b.dataset.st));
  document.querySelectorAll('[data-peek]').forEach((b) => b.onclick = () => Announce.open());

  // ---------- the scene's events: a pack made is a pack sold; delivered packs land in the wallet
  let pendingDeliver = 0, crowd = 0;
  // bought packs ride the machine to the wallet (the scene says when each lands); before the scene has loaded they land at once
  function sendPacks(n) {
    if (window.Scene) { pendingDeliver += n; Scene.buy(n); return; }
    Store.update((s) => { s.sealed[s.series.no] = (s.sealed[s.series.no] || 0) + n; });
  }
  function hookScene() {
    if (LIVE) { layout(); render(); return; } // live: the chain says what sold and what landed
    Scene.on('packMade', () => { // the buyer's own packs were counted when bought; this is the crowd
      if (crowd > 0) { crowd--; Store.update((s) => { const g = s.series.groups.find((x) => x.state === 'open' && x.gate === 'open' && (x.left == null || x.left > 0)); if (!g) return; g.sold++; if (g.left != null) g.left--; if (g.unlimited) g.endsAt = Math.floor(Date.now() / 1000) + g.idle; Store.log('Someone bought a pack'); }); }
      demoAdvance();
    });
    setInterval(demoAdvance, 1000);
    Scene.on('delivered', () => { if (pendingDeliver > 0) { pendingDeliver--; Store.update((s) => { s.sealed[s.series.no] = (s.sealed[s.series.no] || 0) + 1; }); toast('+1 pack', 'good'); } });
    layout(); render();
  }
  // DEMO: the sale moves on by itself: Everyone selling out opens the after-sell-out group; that ending (nobody bought
  // for its idle time) closes the Series
  function demoAdvance() {
    if (LIVE || sold()) return;
    const [, , all, x] = groups(), now = Date.now() / 1000;
    if (all?.state === 'open' && all.left === 0 && !all.waiting && x?.state === 'upcoming') {
      Store.update(() => { all.state = 'ended'; all.endsAt = Math.floor(now); Object.assign(x, { state: 'open', opensAt: Math.floor(now), endsAt: Math.floor(now) + x.idle }); S.series.stage = 'after'; });
      toast('Sold out! Extra packs on sale now.', 'good');
    } else if (x?.state === 'open' && x.endsAt && now >= x.endsAt) {
      Store.update(() => Store.demoStage('closed')); Scene.finale(); setTimeout(() => toast(`Series ${S.series.no} is closed. Open your packs!`, 'good'), 600);
    } else if (x?.state === 'open' || all?.state === 'open') renderChip();
  }
  if (!LIVE && new URLSearchParams(location.search).has('between')) Store.update(() => Store.demoStage('closed'));
  if (window.Scene) hookScene(); else addEventListener('scene-ready', hookScene, { once: true });
  layout(); render();
  // the UI is ready: show it now, over a still of the workshop; the live scene fades in when it has loaded (slow networks
  // used to wait ~20 s on "Lighting the forge…")
  requestAnimationFrame(() => setTimeout(() => $('#loading').classList.add('done'), 120));
})();
