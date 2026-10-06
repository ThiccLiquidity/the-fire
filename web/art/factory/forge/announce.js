/* Omni Forge (demo mode): the Series announcement. One character in every card type, held like a hand of cards
   pinched at the bottom: Full Art in front, then Gold, Coal, Fire, Wood and Paper behind it, their tops fanned out and
   gently floating. Opens from the Buy box once the next Series is announced, and from the demo controls.
   The cards are ui/announce/<character>-<type>.webp, rendered by the Card Studio (raw, 720 x 1008). */
(() => {
  const S = () => Store.state;
  // back to front
  const HAND = [
    { kind: 'paper', label: 'Paper' }, { kind: 'wood', label: 'Wood' }, { kind: 'fire', label: 'Fire' },
    { kind: 'charcoal', label: 'Coal' }, { kind: 'gold', label: 'Gold' }, { kind: 'fullart', label: 'Full Art' },
  ];
  const CAST = { id: 'bowling', name: 'Bowling Ball' }; // demo: the character shown for the next Series

  function card(c, i, n) {
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
    el.innerHTML = `<img src="ui/announce/${CAST.id}-${c.kind}.webp" alt="" draggable="false">${c.kind === 'gold' || c.kind === 'fullart' ? '<i class="fan-shine" aria-hidden="true"></i>' : ''}`;
    el.insertAdjacentHTML('beforeend', `<span class="fan-tag">${c.label}</span>`);
    return el;
  }

  function fan() {
    const box = document.createElement('div');
    box.className = 'fan';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${CAST.name} in every card type, fanned out: Full Art in front, then Gold, Coal, Fire, Wood and Paper`);
    HAND.forEach((c, i) => box.append(card(c, i, HAND.length)));
    // tap or hover spreads the hand a little wider
    box.tabIndex = 0;
    box.onclick = () => box.classList.toggle('open');
    return box;
  }

  function open() {
    const no = S().series.no + 1;
    const body = document.createElement('div');
    body.className = 'announce';
    body.append(
      Object.assign(document.createElement('p'), { className: 'ann-kicker', textContent: `Series ${no} announced` }),
      fan(),
      Object.assign(document.createElement('h3'), { textContent: `${CAST.name} leads Series ${no}` }),
      Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Every character comes in Paper, Wood, Fire, Coal and Gold, plus one Full Art each. Tap the hand to spread it.' }),
    );
    Sheet.open('announce', { title: `Series ${no}`, body });
  }

  window.Announce = { open, fan };
})();
