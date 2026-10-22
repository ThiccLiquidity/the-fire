/* Omni Cardworks (fun layer): the Binder. One page per Series: a row per character, a slot per card type. A slot
   shows your best copy (graded, then holo, then the lowest edition); an empty slot is the card back, dimmed. On top,
   how complete it is: the Common set (Paper, Wood, Fire, Coal) and the Master set (+ Gold + Full Art). From My cards
   and a card's detail. The cast comes from the Series' recipe on chain (live) or the demo cast; any character you
   hold is always listed. */
(() => {
  const { h, reduced } = Fun;
  const LIVE = window.Live?.on;
  const COMMON = ['paper', 'wood', 'fire', 'charcoal'], MASTER = [...COMMON, 'gold', 'fullart'];
  const HR = { none: 0, frame: 1, picture: 2, full: 3 };
  const better = (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || HR[b.holo || 'none'] - HR[a.holo || 'none'] || (parseInt(a.edition, 10) || 1e9) - (parseInt(b.edition, 10) || 1e9);
  const casts = {};
  /** A Series' characters: the recipe's (live, read once), else the demo cast, plus any you hold. */
  async function castOf(no) {
    let base = casts[no];
    if (!base) {
      base = Store.NAMES;
      if (LIVE) { const L = window.Live.chain; try { base = L ? await L.seriesCharacters(no) : []; casts[no] = base; } catch { base = []; } } else casts[no] = base;
    }
    const held = Store.state.cards.filter((c) => c.series === no).map((c) => c.character);
    return [...new Set([...base, ...held])];
  }
  /** What a wallet's cards fill in one Series: { slots: Map 'char|mat' -> card, common, master (0..1), commonDone }. */
  function fill(cards, no, cast) {
    const slots = new Map();
    for (const c of cards) if (c.series === no && MASTER.includes(c.material)) { const k = c.character + '|' + c.material, cur = slots.get(k); if (!cur || better(c, cur) < 0) slots.set(k, c); }
    const count = (mats) => cast.reduce((a, ch) => a + mats.filter((m) => slots.has(ch + '|' + m)).length, 0);
    const n = cast.length || 1;
    return { slots, common: count(COMMON) / (n * 4), master: count(MASTER) / (n * 6), commonN: count(COMMON), masterN: count(MASTER), cast };
  }
  Fun.binderStats = async (no, cards = Store.state.cards) => fill(cards, no, await castOf(no));
  /** Every Series with a complete Common set (for the badge). */
  Fun.commonSets = async (cards = Store.state.cards) => {
    const out = [];
    for (const no of [...new Set(cards.map((c) => c.series))]) { const f = fill(cards, no, await castOf(no)); if (f.cast.length && f.commonN === f.cast.length * 4) out.push(no); }
    return out;
  };
  const face = (c) => h('div', { class: `cface m-${c.material} hd-${Store.holder(c)}` }, h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
  const bar = (label, p, n, of) => h('div', { class: 'bd-bar' }, h('span', { class: 'bd-l' }, h('b', { text: label }), ` ${n} of ${of}`),
    h('span', { class: 'bd-meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p * 100), 'aria-label': `${label}: ${Math.round(p * 100)}% complete` }, h('i', { style: `transform:scaleX(${p.toFixed(4)})` })),
    h('b', { class: 'bd-p', text: Math.round(p * 100) + '%' }));

  Fun.open.binder = async ({ series = null, at = null } = {}) => {
    const S = Store.state;
    const list = () => [...new Set([...S.cards.map((c) => c.series), ...(S.series.no ? [S.series.no] : [])])].filter(Boolean).sort((a, b) => b - a);
    let no = series ?? list().find((x) => S.cards.some((c) => c.series === x)) ?? list()[0];
    const root = h('div', { class: 'st binder' }), tabs = h('div', { class: 'seg bd-tabs', role: 'group', 'aria-label': 'Series' }), page = h('div', { class: 'bd-page' });
    root.append(tabs, page);
    Sheet.open('binder', { title: 'Binder', body: root, wide: true, onClose: () => off() });
    let seq = 0, prev = null;
    async function draw(dir = 0) {
      const k = ++seq, ser = list();
      Fun.put(tabs, ...ser.map((x) => h('button', { type: 'button', 'aria-pressed': String(x === no), 'data-v': x, onclick: () => { if (x !== no) { const d = x < no ? 1 : -1; no = x; draw(d); } } }, `Series ${x}`)));
      if (!no) return Fun.put(page, h('p', { class: 'muted', text: 'No cards yet. Open a pack!' }));
      const cast = await castOf(no); if (k !== seq) return;
      const f = fill(S.cards, no, cast), ids = [...f.slots.values()].map((c) => c.id);
      const rows = cast.map((ch) => h('div', { class: 'bd-row' }, h('span', { class: 'bd-name', text: ch }),
        h('div', { class: 'bd-slots' }, MASTER.map((m) => {
          const c = f.slots.get(ch + '|' + m);
          if (!c) return h('div', { class: 'bd-slot empty' + (COMMON.includes(m) ? '' : ' master'), 'aria-label': `${ch}, ${Store.MAT_LABEL[m]}: missing` }, h('img', { src: 'ui/card-back.webp', alt: '', loading: 'lazy' }), h('span', { class: 'mat ' + m, text: Store.MAT_LABEL[m] }));
          return h('button', { type: 'button', class: 'bd-slot' + (c.id === at ? ' at' : ''), 'data-id': c.id, 'aria-label': `${ch}, ${Store.MAT_LABEL[m]}${c.grade != null ? ', PDA ' + c.grade : ''}. Open it`,
            onclick: () => window.Stations?.openCard(c.id, ids) }, face(c), c.grade != null ? h('span', { class: 'pda g' + c.grade, text: 'PDA ' + c.grade }) : null);
        }))));
      const body = h('div', { class: 'bd-sheet' },
        h('div', { class: 'bd-top' }, h('h3', { text: `Series ${no}` }), bar('Common set', f.common, f.commonN, cast.length * 4), bar('Master set', f.master, f.masterN, cast.length * 6),
          h('p', { class: 'muted small', text: 'Common: Paper, Wood, Fire and Coal of every character. Master adds Gold and Full Art.' })),
        cast.length ? h('div', { class: 'bd-head', 'aria-hidden': 'true' }, h('span'), MASTER.map((m) => h('span', { class: 'mat ' + m, text: Store.MAT_LABEL[m] }))) : null,
        cast.length ? rows : h('p', { class: 'muted', text: 'Loading…' }));
      Fun.put(page, body);
      // a page turn when the Series changes (transform only)
      if (dir && !reduced()) body.animate([{ transform: `perspective(1400px) rotateY(${dir * 70}deg)`, transformOrigin: dir > 0 ? 'left center' : 'right center', opacity: 0.2 }, { transform: 'none', transformOrigin: dir > 0 ? 'left center' : 'right center', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
      if (at && !prev) page.querySelector('.bd-slot.at')?.scrollIntoView({ block: 'center' });
      prev = no;
    }
    let key = '';
    const off = Store.on(() => { const k = JSON.stringify(S.cards.map((c) => [c.id, c.grade, c.series])); if (k !== key) { key = k; draw(); } });
    key = JSON.stringify(S.cards.map((c) => [c.id, c.grade, c.series]));
    draw();
  };
})();
