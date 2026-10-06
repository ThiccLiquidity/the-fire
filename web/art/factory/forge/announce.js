/* Omni Forge (demo mode): the Series tease. One character in every card type, held like a hand of cards pinched at
   the bottom: Full Art in front, then Gold, Coal, Fire, Wood and Paper behind it, their tops fanned out and gently
   floating. Which Series and character: Store.tease() (the Series on sale, or between Series the next one). While a
   Series is on sale it shows what's in its packs; between Series a small hand sits on the main page (Buy box / bar).
   The cards are ui/announce/<character>-<type>.webp, rendered by the Card Studio (raw, 720 x 1008). */
(() => {
  const S = () => Store.state;
  // back to front
  const HAND = [
    { kind: 'paper', label: 'Paper' }, { kind: 'wood', label: 'Wood' }, { kind: 'fire', label: 'Fire' },
    { kind: 'charcoal', label: 'Coal' }, { kind: 'gold', label: 'Gold' }, { kind: 'fullart', label: 'Full Art' },
  ];
  function card(c, i, n, cast) {
    const el = document.createElement('div');
    el.className = `fan-card k-${c.kind}`;
    const depth = n - 1 - i; // 0 = front
    // pinched at the bottom: each card further back turns a little more, alternating sides, and rides a little higher
    const side = depth % 2 ? -1 : 1;
    el.style.setProperty('--rot', `${depth ? side * (4 + depth * 4) : 0}deg`);
    el.style.setProperty('--lift', `${-depth * 5}px`);
    el.style.setProperty('--spread', `${depth ? side * (4 + depth * 2.5) : 0}deg`); // extra turn on hover
    el.style.setProperty('--delay', `${-i * 0.55}s`);
    el.style.zIndex = String(i + 1);
    el.innerHTML = `<img src="ui/announce/${cast.id}-${c.kind}.webp" alt="" draggable="false">${c.kind === 'gold' || c.kind === 'fullart' ? '<i class="fan-shine" aria-hidden="true"></i>' : ''}`;
    return el;
  }

  /** The hand of cards. `mini`: the small one on the main page (no labels; tapping it opens the full tease). */
  function fan(cast, { mini = false } = {}) {
    const box = document.createElement('div');
    box.className = 'fan' + (mini ? ' mini' : '');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${cast.name} in every card type, fanned out: Full Art in front, then Gold, Coal, Fire, Wood and Paper`);
    HAND.forEach((c, i) => box.append(card(c, i, HAND.length, cast)));
    if (!mini) { // tap or hover spreads the hand a little wider
      box.tabIndex = 0;
      box.onclick = () => box.classList.toggle('open');
    }
    return box;
  }

  function open() {
    const t = Store.tease(); if (!t) return;
    const body = document.createElement('div');
    body.className = 'announce';
    body.append(fan(t), Object.assign(document.createElement('p'), { className: 'ann-line', textContent: t.line })); // just the cards and a few words
    Sheet.open('announce', { title: `Series ${t.no}`, body });
  }

  window.Announce = { open, fan };
})();
