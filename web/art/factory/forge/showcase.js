/* Omni Cardworks (fun layer): your showcase and your trophy shelf.
   Showcase: pick up to 6 cards to show, then share a link: ?show=<wallet>&c=<card numbers>. Anyone opening it sees
   that wallet's cards (live: read from the chain, only cards it still holds; demo: the demo cards), its name and
   picture once profiles exist (profile.js), its Series progress, and (your own) your badges. No picks in the link:
   the wallet's best 6 by rarity.
   Trophy shelf: your best 3 slabs stand on a shelf in the workshop (a strip over the scene on phones). Tap one to
   open it. */
(() => {
  const { h, mem } = Fun;
  const LIVE = window.Live?.on;
  const S = Store.state;
  const MAX = 6;
  const rank = (c) => (c.grade != null ? 1e6 * c.grade : 0) + Store.trueOdds(c).n;
  const best = (cards, n) => [...cards].sort((a, b) => rank(b) - rank(a)).slice(0, n);
  const face = (c) => h('div', { class: `cface m-${c.material} hd-${Store.holder(c)}` }, h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: `${c.character}, ${Store.MAT_LABEL[c.material]}`, loading: 'lazy', decoding: 'async', draggable: 'false' }));
  const kind = (c) => [Store.MAT_LABEL[c.material], c.grade != null ? 'PDA ' + c.grade : c.cased ? 'Cased' : ''].filter(Boolean).join(' · ');
  const myAddr = () => (LIVE ? S.wallet.full : S.wallet.full || '0xdemo');
  const pickKey = () => 'omni.showcase.' + (Fun.who() || 'none');
  function link(addr, ids) {
    const u = new URL(location.href); u.search = '';
    const live = new URLSearchParams(location.search).get('live'); if (live) u.searchParams.set('live', live);
    u.searchParams.set('show', addr); if (ids.length) u.searchParams.set('c', ids.join('.'));
    return u.href;
  }
  const view = (cards, i) => window.Zoom?.open({ cards, index: i, face, name: (x) => `${x.character}, ${kind(x)}`, from: () => null });

  // ---------- your showcase: pick, preview, share
  Fun.open.showcase = () => {
    if (LIVE && !S.wallet.connected) return Live.needWallet(() => Fun.open.showcase());
    if (!LIVE && !S.wallet.connected) Store.update((s) => { s.wallet.connected = true; });
    const ok = (id) => S.cards.some((c) => c.id === id);
    let picks = (mem(pickKey()) || []).filter(ok);
    if (!picks.length) picks = best(S.cards, MAX).map((c) => c.id);
    const root = h('div', { class: 'st showcase-ed' });
    const save = () => mem(pickKey(), picks);
    function draw() {
      const chosen = picks.map((id) => S.cards.find((c) => c.id === id)).filter(Boolean), url = link(myAddr(), picks);
      Fun.put(root, 
        h('p', { class: 'muted', text: `Pick up to ${MAX} cards. Tap to add or remove.` }),
        h('div', { class: 'sc-shelf' }, Array.from({ length: MAX }, (_, i) => chosen[i] ? h('button', { type: 'button', class: 'sc-slot', 'aria-label': `Remove ${chosen[i].character}`, onclick: () => { picks = picks.filter((x) => x !== chosen[i].id); save(); draw(); } }, face(chosen[i])) : h('div', { class: 'sc-slot empty', 'aria-hidden': 'true' }))),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary', text: 'Share link', onclick: async () => {
            Fun.badge?.('shared');
            if (navigator.share) { try { await navigator.share({ title: 'My Omni Cardworks showcase', url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
            try { await navigator.clipboard.writeText(url); toast('Link copied', 'good'); } catch { prompt('Copy your link', url); }
          } }),
          h('button', { type: 'button', class: 'btn', text: 'Preview', onclick: () => Fun.open.showView({ addr: myAddr(), ids: picks }) })),
        h('h3', { text: 'Your cards' }),
        h('div', { class: 'cgrid sc-pick' }, best(S.cards, 400).map((c) => {
          const on = picks.includes(c.id);
          return h('button', { type: 'button', class: 'sc-c' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-id': c.id, 'aria-label': `${c.character}, ${kind(c)}`,
            onclick: () => { if (on) picks = picks.filter((x) => x !== c.id); else if (picks.length >= MAX) return toast(`Up to ${MAX} cards`, 'bad'); else picks.push(c.id); save(); draw(); } }, face(c));
        })));
    }
    draw();
    Sheet.open('showcase', { title: 'Your showcase', body: root, wide: true });
  };

  // ---------- anyone's showcase (the link)
  async function cardsOf(addr) {
    if (!LIVE) return S.cards; // demo: every link shows the demo cards
    if (S.wallet.connected && S.wallet.full?.toLowerCase() === addr.toLowerCase()) return S.cards;
    for (let i = 0; i < 100 && !window.Live.chain; i++) await new Promise((r) => setTimeout(r, 300));
    const L = window.Live.chain; if (!L) throw new Error('not connected');
    const MAT = { coal: 'charcoal', 'full art': 'fullart' };
    return (await L.cardsOf(addr)).map((c) => ({ id: c.serial, serial: c.serial, series: c.fire, character: c.character || c.name, material: MAT[String(c.material).toLowerCase()] || String(c.material).toLowerCase() || 'paper',
      holo: c.holo, edition: c.edition, grade: c.grade, cased: c.cased, pending: c.gradePending, image: c.image.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + c.image.slice(7) : c.image }));
  }
  Fun.open.showView = async ({ addr, ids = [] }) => {
    const root = h('div', { class: 'st showcase' }, h('p', { class: 'muted', text: 'Loading cards…' }));
    Sheet.open('show', { title: 'Showcase', body: root, wide: true });
    let cards;
    try { cards = await cardsOf(addr); } catch { Fun.put(root, h('p', { class: 'warn', text: 'Couldn’t load this wallet’s cards. Try again.' })); return; }
    const picked = ids.map((id) => cards.find((c) => c.id === id)).filter(Boolean), shown = picked.length ? picked.slice(0, MAX) : best(cards, MAX);
    const mine = Fun.who() && Fun.who() === addr.toLowerCase() || (!LIVE && S.wallet.full?.toLowerCase() === addr.toLowerCase());
    const name = h('b', { class: 'sv-name', text: Fun.label(addr) });
    Fun.profileOf(addr).then((p) => { if (p?.name) name.textContent = p.name; });
    const series = [...new Set(cards.map((c) => c.series))].sort((a, b) => b - a).slice(0, 4);
    const prog = h('div', { class: 'sv-prog' });
    if (Fun.binderStats) Promise.all(series.map((no) => Fun.binderStats(no, cards))).then((st) => Fun.put(prog, ...st.map((f, i) =>
      h('div', { class: 'bd-bar' }, h('span', { class: 'bd-l' }, h('b', { text: `Series ${series[i]}` }), ' common set'), h('span', { class: 'bd-meter', 'aria-hidden': 'true' }, h('i', { style: `transform:scaleX(${f.common.toFixed(4)})` })), h('b', { class: 'bd-p', text: Math.round(f.common * 100) + '%' })))));
    Fun.put(root, 
      h('div', { class: 'sv-head' }, Fun.avatar(addr, 48), h('div', {}, name, h('small', { class: 'muted', text: `${Fun.label(addr) === Fun.short(addr) ? '' : Fun.short(addr) + ' · '}${cards.length} cards` }))),
      shown.length ? h('div', { class: 'sc-shelf sv-shelf' }, shown.map((c, i) => h('button', { type: 'button', class: 'sc-slot', 'aria-label': `${c.character}, ${kind(c)}. View it big`, onclick: () => view(shown, i) }, face(c), h('small', { text: kind(c) }))))
        : h('p', { class: 'muted', text: 'No cards here yet.' }),
      series.length ? h('h3', { text: 'Series progress' }) : h('span'), prog,
      mine && Fun.badgeRow ? h('div', { class: 'sv-badges' }, h('h3', { text: 'Badges' }), Fun.badgeRow(Fun.who(), { all: false }) || h('p', { class: 'muted', text: 'None yet. Open, case and grade to earn them.' })) : h('span'),
      mine ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', text: 'Edit my showcase', onclick: () => { Sheet.close('show'); Fun.open.showcase(); } })) : h('span'),
      LIVE ? h('span') : h('p', { class: 'demo-line', text: 'Demo cards' }));
  };
  addEventListener('profile:changed', () => { /* names refresh on the next open */ });
  // a showcase link opens it
  const q = new URLSearchParams(location.search), who = q.get('show');
  if (who && /^0x[0-9a-fA-F]{4,40}$/.test(who)) {
    const ids = (q.get('c') || '').split('.').map(Number).filter((x) => Number.isFinite(x) && x !== 0);
    const go = () => (window.Sheet?.covering ? setTimeout(go, 500) : Fun.open.showView({ addr: who, ids }));
    setTimeout(go, 300);
  }

  // ---------- the trophy shelf: your best 3 slabs, in the workshop
  const SPOT = [470, 1850]; // the floor by the burn bin (scene units)
  const shelf = h('div', { class: 'fun-shelf', hidden: true }, h('span', { class: 'fs-t', text: 'Best slabs' }), h('div', { class: 'fs-row' }));
  document.body.append(shelf);
  let key = '';
  function paint() {
    const show = !LIVE || S.wallet.connected, slabs = show ? best(S.cards.filter((c) => c.grade != null), 3) : [];
    const k = JSON.stringify([slabs.map((c) => [c.id, c.grade]), document.body.dataset.mode]);
    if (k !== key) {
      key = k; shelf.hidden = !slabs.length;
      const ids = slabs.map((c) => c.id);
      shelf.querySelector('.fs-row').replaceChildren(...slabs.map((c) => h('button', { type: 'button', class: 'fs-slab', 'aria-label': `${c.character}, PDA ${c.grade}. Open it`, onclick: () => window.Stations?.openCard(c.id, ids) }, face(c))));
    }
    place();
  }
  function place() {
    if (shelf.hidden || !window.Scene) return;
    const port = document.body.dataset.mode === 'port';
    shelf.classList.toggle('port', port);
    if (port) { shelf.style.transform = ''; return; }
    const [x, y] = Scene.toScreen(...SPOT), k = Math.max(1, Math.min(1.25, Scene.scale * 3.4)); // never below 1: the label stays 12px+, the slabs a 44px+ tap
    shelf.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`;
  }
  Store.on(paint); addEventListener('resize', () => requestAnimationFrame(place));
  paint();
})();
