/* Omni Cardworks (fun layer): around the fire. The Activity sheet becomes three tabs:
   Pulls: the latest Rare-or-better pulls with their card pictures (live: FireCards CardDealt events, joined to the
   wallet that opened the pack; demo: made up, plus your own). Tap one for the full-screen viewer.
   Top stokers: per Series, the wallets that fed the fire most. Live from FireSale PacksBought / CreditsUsed and FirePsa
   Protected: no event ties a wallet to the PAPER it burned, so it ranks by packs, then cases and grades.
   Activity: what you did here (the old list).
   Wallets show their profile name and picture once profile.js is loaded, else a short address. */
(() => {
  const { h, mem } = Fun;
  const LIVE = window.Live?.on;
  const S = Store.state;
  const TIER = { rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
  const tierOf = (c) => Store.trueOdds(c).tier;
  const kind = (c) => [{ frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' }[!Store.ALWAYS_HOLO[c.material] && c.holo] || '', Store.MAT_LABEL[c.material]].filter(Boolean).join(' ');
  const ago = (t) => { const s = Math.max(1, Math.round(Date.now() / 1000 - t)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  const face = (c) => { const f = h('div', { class: `cface m-${c.material} hd-raw` }, h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
    return f; };
  const bigFace = (c) => { const f = face(c); if (Store.cardParts(c) && window.Holo) Holo.attach(f, c, true); return f; };
  const LMAT = { paper: 'paper', wood: 'wood', fire: 'fire', coal: 'charcoal', charcoal: 'charcoal', diamond: 'diamond', gold: 'gold', 'full art': 'fullart', fullart: 'fullart' };

  // ---------- the pulls
  const mine = []; // your own Rare-or-better pulls this visit
  Fun.on('flip', ({ card, tier, practice }) => { if (!tier || practice) return; mine.unshift({ ...card, by: S.wallet.full || 'you', at: Date.now() / 1000, you: true }); mine.length = Math.min(mine.length, 20); });
  // DEMO: a made-up crowd's pulls, a new one now and then while the page is open
  let seed = 4242; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const addr = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(R() * 16)]).join('');
  const fake = (at) => {
    const m = [['fullart', 0.12], ['gold', 0.2], ['charcoal', 0.28], ['fire', 0.25], ['paper', 0.08], ['wood', 0.07]];
    let u = R(), mat = 'fire'; for (const [k, p] of m) { if ((u -= p) < 0) { mat = k; break; } }
    const holo = mat === 'gold' || mat === 'fullart' ? 'full' : mat === 'charcoal' ? (R() < 0.5 ? 'none' : 'full') : 'full';
    const character = Store.NAMES[Math.floor(R() * Store.NAMES.length)];
    return { id: -100000 - Math.floor(R() * 1e6), series: 6, character, material: mat, holo, grade: null, cased: false, by: addr(), at };
  };
  const crowd = LIVE ? [] : Array.from({ length: 14 }, (_, i) => fake(Date.now() / 1000 - (i + 1) * (300 + R() * 2400)));
  if (!LIVE) (function more() { setTimeout(() => { if (!document.hidden) { const p = fake(Date.now() / 1000); crowd.unshift(p); crowd.length = Math.min(crowd.length, 40); if (/epic|legendary/.test(tierOf(p) || '')) Fun.emit('others-pull', p); refresh(); } more(); }, 25000 + Math.random() * 20000); })();
  // LIVE: the latest deals of the newest dealt Series (and the one before), the rare ones with their images
  const imgs = new Map(); let liveList = [], liveAt = 0, liveBusy = null;
  async function readLive() {
    if (liveBusy) return liveBusy;
    liveBusy = (async () => {
      for (let i = 0; i < 60 && !window.Live.chain; i++) await new Promise((r) => setTimeout(r, 300));
      const L = window.Live.chain; if (!L || !S.series.no) return liveList;
      const fires = [S.series.no, S.series.no - 1].filter((x) => x > 0);
      const all = (await Promise.all(fires.map((f) => L.dealtCards(f, 150).catch(() => [])))).flat();
      const rare = all.map((d) => ({ id: d.serial, serial: d.serial, series: d.fire, character: d.character, material: LMAT[d.material.toLowerCase()] || 'paper', holo: d.holo, grade: null, cased: false, by: d.holder, at: d.at || Date.now() / 1000 }))
        .filter((c) => tierOf(c)).sort((a, b) => b.at - a.at).slice(0, 24);
      await Promise.all(rare.map(async (c) => { if (!imgs.has(c.serial)) imgs.set(c.serial, L.card(c.serial).then((x) => Store.ipfs(x.image), () => '')); c.image = await imgs.get(c.serial); }));
      liveList = rare; liveAt = Date.now(); return rare;
    })().finally(() => { liveBusy = null; });
    return liveBusy;
  }
  async function pulls() {
    const others = LIVE ? (Date.now() - liveAt > 30000 ? await readLive().catch(() => liveList) : liveList) : crowd;
    const me = (S.wallet.full || '').toLowerCase();
    return [...mine, ...others.filter((p) => !mine.some((m) => m.id === p.id))].map((p) => ({ ...p, you: p.you || (!!me && String(p.by).toLowerCase() === me) })).sort((a, b) => b.at - a.at);
  }
  /** The best few pulls of a Series (the sell-out recap). */
  Fun.feedTop = async (no) => (await pulls()).filter((p) => p.series === no || !LIVE).sort((a, b) => Store.trueOdds(b).n - Store.trueOdds(a).n).slice(0, 3);

  // ---------- the board
  async function board(no) {
    if (LIVE) {
      for (let i = 0; i < 60 && !window.Live.chain; i++) await new Promise((r) => setTimeout(r, 300));
      return (await window.Live.chain.fuelBoard(no)).map((r) => ({ ...r, packs: r.packs + r.free }));
    }
    // DEMO: a made-up board, plus the demo wallet with what you did here
    let k = 900 + no; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
    const rows = Array.from({ length: 9 }, () => { const packs = 1 + Math.floor(r() * r() * 30); return { wallet: '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join(''), packs, cased: Math.floor(packs * r() * 3), graded: Math.floor(packs * r() * 0.8) }; });
    const st = mem('omni.stats.demo') || {};
    if (no === S.series.no || no === 6) rows.push({ wallet: S.wallet.full, packs: (st.packs || 0) + Object.values(S.wallet.boughtIn || {}).reduce((a, b) => a + b, 0), cased: st.cased || 0, graded: st.slabs || 0 });
    return rows.sort((a, b) => b.packs - a.packs || b.cased + b.graded - (a.cased + a.graded));
  }

  // ---------- the sheet
  let tab = 'pulls', refresh = () => {};
  Fun.open.feed = (o = {}) => {
    tab = o.tab || tab;
    const root = h('div', { class: 'st feed2' }), tabs = h('div', { class: 'seg fd-tabs', role: 'tablist', 'aria-label': 'Around the fire' }), panel = h('div', { class: 'fd-panel', role: 'tabpanel' });
    root.append(tabs, panel);
    let boardNo = S.series.no || 1, seq = 0;
    const who = (a, you) => h('span', { class: 'fd-who' }, Fun.avatar(a, 26), h('b', { text: you ? 'You' : Fun.label(a) }));
    async function draw() {
      const k = ++seq;
      Fun.put(tabs, ...[['pulls', 'Pulls'], ['board', 'Top stokers'], ['you', 'Yours']].map(([v, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === v), 'data-v': v, onclick: () => { tab = v; draw(); } }, t)));
      if (tab === 'pulls') {
        if (!panel.querySelector('.fd-list')) Fun.put(panel, h('p', { class: 'muted', text: 'Loading pulls…' }));
        const list = await pulls(); if (k !== seq) return;
        if (!list.length) return Fun.put(panel, h('p', { class: 'muted', text: 'No rare pulls yet.' }));
        const cards = list.map((p) => ({ ...p }));
        Fun.put(panel, h('ul', { class: 'fd-list' }, list.slice(0, 30).map((p, i) => { const t = tierOf(p);
          return h('li', { class: 'fd-row' + (p.you ? ' you' : '') },
            h('button', { type: 'button', class: 'fd-card', 'aria-label': `${p.character}, ${kind(p)}. View it big`, onclick: () => window.Zoom?.open({ cards, index: i, face: bigFace, name: (x) => `${x.character}, ${kind(x)}`, from: () => null }) }, face(p)),
            h('div', { class: 'fd-txt' }, who(p.by, p.you), h('span', {}, ' pulled ', h('b', { text: `${kind(p)} ${p.character}` })),
              h('small', { class: 'muted' }, t ? h('span', { class: 'tier-b ' + t, text: TIER[t] }) : null, ` ${Store.trueOdds(p).label} · ${ago(p.at)}`)));
        })), LIVE ? null : h('p', { class: 'demo-line', text: 'Demo pulls' }));
      } else if (tab === 'board') {
        const nos = [...new Set([S.series.no, S.series.no - 1, ...S.cards.map((c) => c.series)])].filter((x) => x > 0).sort((a, b) => b - a).slice(0, 4);
        const pick = h('div', { class: 'seg fd-series', role: 'group', 'aria-label': 'Series' }, nos.map((x) => h('button', { type: 'button', 'aria-pressed': String(x === boardNo), 'data-v': 's' + x, onclick: () => { boardNo = x; draw(); } }, `Series ${x}`)));
        Fun.put(panel, pick, h('p', { class: 'muted', text: 'Loading…' }));
        let rows; try { rows = await board(boardNo); } catch { rows = null; }
        if (k !== seq) return;
        const me = (S.wallet.full || '').toLowerCase();
        Fun.put(panel, pick, !rows ? h('p', { class: 'warn', text: 'Couldn’t load the board. Try again.' }) : !rows.length ? h('p', { class: 'muted', text: 'Nobody on the board yet.' }) :
          h('table', { class: 'fd-board' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '#' }), h('th', { scope: 'col', text: 'Wallet' }), h('th', { scope: 'col', text: 'Packs' }), h('th', { scope: 'col', text: 'Cased' }), h('th', { scope: 'col', text: 'Graded' }))),
            h('tbody', {}, rows.slice(0, 25).map((r, i) => h('tr', { class: r.wallet?.toLowerCase() === me ? 'you' : '' }, h('td', { text: String(i + 1) }), h('td', {}, who(r.wallet, r.wallet?.toLowerCase() === me)),
              h('td', { text: String(r.packs) }), h('td', { text: String(r.cased) }), h('td', { text: String(r.graded) }))))),
          h('p', { class: 'muted small', text: 'Ranked by packs, then cases and grades.' }), LIVE ? null : h('p', { class: 'demo-line', text: 'Demo board' }));
      } else {
        const items = S.activity.length ? S.activity : [{ text: 'No activity yet.' }];
        Fun.put(panel, h('ul', { class: 'feed' }, items.map((a) => h('li', { text: a.text }))));
      }
    }
    refresh = () => { if (root.isConnected && tab === 'pulls') draw(); };
    const poll = LIVE ? setInterval(() => { if (root.isConnected && !document.hidden && tab === 'pulls') { liveAt = 0; draw(); } }, 30000) : 0;
    const onProfile = () => { if (root.isConnected) draw(); };
    addEventListener('profile:changed', onProfile);
    Sheet.open('feed', { title: 'Activity', body: root, wide: true, onClose: () => { clearInterval(poll); removeEventListener('profile:changed', onProfile); refresh = () => {}; } });
    draw();
  };
})();
