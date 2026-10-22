/* Omni Cardworks (fun layer): the practice pack. Anyone can rip one, no wallet, demo or live: six sample cards with
   the full reveal (the same tear, flips, glows and sounds), stamped PRACTICE over the card (drawn in code), and never
   saved anywhere: they're not in My cards, the binder, badges or the counts. The cards use the site's own sample art
   (the demo cast's finished card images in cards/<id>/), so it works offline and in live mode too. */
(() => {
  const { h } = Fun;
  const CH = Store.CHARS, CAST = Object.keys(CH), SPECIAL = Store.SPECIAL_CAST;
  const ART_SERIES = 6; // the sample card images print "Forged · Series 6"
  const special = (c) => c.material === 'gold' || c.material === 'fullart';
  const look = (c) => (special(c) ? 'full' : c.holo || 'none');
  const artOf = (c) => (special(c) ? CH[SPECIAL] : CH[c.character] || CH[CAST[0]]).id;
  // live mode points the card images at the chain's metadata: practice cards keep the sample art
  if (window.Live?.on) {
    const img = Store.cardImg, pos = Store.cardPos;
    Store.cardImg = (c) => (c?.practice ? `cards/${artOf(c)}/${c.material}-${look(c)}.webp` : img(c));
    Store.cardPos = (c) => (c?.practice ? '0% 0' : pos(c));
  }
  const roll = (t) => { let u = Math.random(), a = 0; for (const [v, p] of t) { a += p; if (u < a) return v; } return t[t.length - 1][0]; };
  let n = 0;
  /** Six practice cards: 3 Paper, 1 Wood, 1 Wood or better, 1 Fire or better (Gold and Full Art turn up often here). */
  Fun.practicePack = () => {
    const mats = ['paper', 'paper', 'paper', 'wood', roll([['wood', 0.7], ['fire', 0.2], ['charcoal', 0.06], ['gold', 0.04]]), roll([['fire', 0.55], ['charcoal', 0.15], ['gold', 0.18], ['fullart', 0.12]])];
    return mats.map((m) => {
      const q = 1 - Math.sqrt(1 - ({ paper: 0.05, wood: 0.1, fire: 0.5, charcoal: 0.9 }[m] || 1)), f = Math.random() < q, p = Math.random() < q;
      const holo = m === 'gold' || m === 'fullart' ? 'full' : f && p ? 'full' : f ? 'frame' : p ? 'picture' : 'none';
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
