/* Omni Cardworks (fun layer): the practice pack. Anyone can rip one, no wallet, demo or live: six sample cards with
   the full reveal (the same tear, flips, glows and sounds), stamped PRACTICE over the card (drawn in code), and never
   saved anywhere: they're not in My cards, the binder, badges or the counts.
   Demo: the demo cast's finished card images (cards/<id>/). Live: the current Series' own cards: its recipe's types,
   their odds and holo odds, its characters and its image folder (Live.chain.practiceSet / practiceDeal: the same file
   names CardsRenderer gives real cards). If those reads fail or nothing is deployed yet, the demo cast stands in. */
(() => {
  const { h } = Fun;
  const CH = Store.CHARS, CAST = Object.keys(CH), SPECIAL = Store.SPECIAL_CAST;
  const ART_SERIES = 6; // the sample card images print "Forged · Series 6"
  const special = (c) => c.material === 'gold' || c.material === 'fullart';
  const look = (c) => (special(c) ? 'full' : c.holo || 'none');
  const artOf = (c) => (special(c) ? CH[SPECIAL] : CH[c.character] || CH[CAST[0]]).id;
  // live mode points the card images at the chain's metadata: a live practice card has its Series' own image; one
  // from the demo cast (the fallback) keeps the sample art
  if (window.Live?.on) {
    const img = Store.cardImg, pos = Store.cardPos;
    Store.cardImg = (c) => (c?.practice && !c.image ? `cards/${artOf(c)}/${c.material}-${look(c)}.webp` : img(c));
    Store.cardPos = (c) => (c?.practice && !c.image ? '0% 0' : pos(c));
  }
  let n = 0;
  const RANKED = ['paper', 'wood', 'fire', 'charcoal', 'gold', 'fullart'];
  /** Live: a pack of the current Series' own cards, or null (no Series yet, or the reads failed or took too long). */
  async function livePack() {
    const L = window.Live, no = Store.state.series.no;
    if (!L?.on || !L.chain || !no) return null;
    const set = await Promise.race([L.chain.practiceSet(no), new Promise((ok) => setTimeout(() => ok(null), 6000))]).catch(() => null);
    if (!set) return null;
    return L.chain.practiceDeal(set).map((x) => ({
      id: -(++n), serial: 0, series: set.fire, practice: true, character: x.character,
      material: L.toMaterial(x.typeName) || L.toMaterial(x.slug) || RANKED[Math.min(x.rank, RANKED.length - 1)], holo: x.holo, image: L.gateway(x.image),
      edition: 'Practice', grade: null, pending: false, dealt: Date.now(), cased: false, frozenAge: 0, moves: 0 }));
  }
  // live: read the Series' set ahead (cached by the chain layer), so the first rip doesn't wait on it
  let pre = 0;
  if (window.Live?.on) Store.on(() => { const no = Store.state.series.no; if (no && no !== pre && window.Live.chain) { pre = no; window.Live.chain.practiceSet(no).catch(() => {}); } });
  /** Six practice cards. Live: the current Series' (a promise); else the demo cast, slot by slot, each card rolled on
   *  its own at its slot's odds (Store.rollPack), like the contract. */
  Fun.practicePack = () => (window.Live?.on ? livePack().catch(() => null).then((p) => p || demoPack()) : demoPack());
  const demoPack = () => {
    return Store.rollPack().map(({ material: m, holo }) => {
      return { id: -(++n), serial: 0, series: ART_SERIES, practice: true, character: m === 'gold' || m === 'fullart' ? SPECIAL : CAST[Math.floor(Math.random() * CAST.length)],
        material: m, holo, edition: 'Practice', grade: null, pending: false, dealt: Date.now(), cased: false, frozenAge: 0, moves: 0 };
    });
  };
  const face = (c) => h('div', { class: `cface m-${c.material} hd-raw` }, h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: `${c.character}, ${Store.MAT_LABEL[c.material]} practice card`, draggable: 'false' }));
  /** After the reveal: the six, clearly practice, then another, a real pack, or done. */
  Fun.practiceSummary = (stage, cards, { again, done }) => {
    const best = [...cards].sort((a, b) => Store.trueOdds(b).n - Store.trueOdds(a).n)[0];
    const real = () => { done(); const b = document.querySelector('#buybox [data-buy]:not(.off), #buybar [data-buy]:not(.off)'); if (b) { b.focus({ preventScroll: true }); b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge'); } else window.Info?.open('buy'); };
    const ids = cards.map((c) => c.id);
    Fun.put(stage, h('div', { class: 'prac-sum' },
      h('div', { class: 'prac-h' }, h('h3', { text: 'Not real, not saved' }),
        h('p', { class: 'muted', text: `Best: ${best.character}, ${Store.MAT_LABEL[best.material]}${Store.trueOdds(best).label ? ' · ' + Store.trueOdds(best).label : ''}. Real packs work the same way.` })),
      h('div', { class: 'prac-grid' }, cards.map((c) => h('button', { type: 'button', class: 'prac-c', 'aria-label': `${c.character}, ${Store.MAT_LABEL[c.material]}, practice card. View it big`,
        onclick: () => window.Zoom?.open({ cards, index: ids.indexOf(c.id), face, name: (x) => `${x.character}, practice card`, from: () => null }) }, face(c)))),
      h('div', { class: 'row prac-acts' },
        h('button', { type: 'button', class: 'btn primary', text: 'Rip another', onclick: again }),
        h('button', { type: 'button', class: 'btn gold', text: 'Get a real pack', onclick: real }),
        h('button', { type: 'button', class: 'btn', text: 'Done', onclick: done }))));
    stage.querySelector('.prac-acts .btn.primary')?.focus({ preventScroll: true });
  };
  Fun.open.practice = () => { window.Stations?.practice?.(); }; // (the opening runs on; don't wait for it)
})();
