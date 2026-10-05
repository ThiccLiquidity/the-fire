/* info.js: the Info panel. One wide sheet that explains the site and the collection.
   Facts: docs/omni-economy.md, docs/cards-contracts.md, docs/card-studio.md */
(() => {
  // ---- rarity numbers (computed, not typed in) ----
  // A full Series: 167 packs x 6 = 1,002 cards. At least one Diamond per Series (more can be set per Series);
  // the rest follow their share within the Series. Holo is random per card.
  const SERIES_CARDS = 167 * 6;
  const MATS = [
    { id: 'paper', name: 'Paper', share: 0.5, holo: 0.05 },
    { id: 'wood', name: 'Wood', share: 0.3, holo: 0.1 },
    { id: 'fire', name: 'Fire', share: 0.15, holo: 0.5 },
    { id: 'charcoal', name: 'Coal', share: 0.049, holo: 0.9 },
    { id: 'diamond', name: 'Diamond', share: null, holo: 1 },
  ];
  MATS.forEach((m) => {
    m.count = m.share == null ? 1 : Math.round(m.share * SERIES_CARDS); // 501 / 301 / 150 / 49 / 1
    if (m.id === 'diamond') { m.frame = m.full = 1 / 3; m.none = 0; return; } // always holo, split evenly
    const r = 1 - Math.sqrt(1 - m.holo); // frame and picture each roll at this
    m.frame = r * (1 - r); m.full = r * r; m.none = (1 - r) * (1 - r); // picture only = frame only
  });
  const M = Object.fromEntries(MATS.map((m) => [m.id, m]));
  // PDA grade odds in percent (FirePsa defaults), and the wear frame each band gets (card-studio.md).
  const PDA = [10, 1, 9, 17, 8, 24, 7, 25, 6, 18, 5, 7, 4, 3.5, 3, 2, 2, 1.5, 1, 1]
    .reduce((a, v, i, arr) => (i % 2 ? a : [...a, { g: v, p: arr[i + 1] }]), []);
  const WEAR = [ // band, grades covered, frame suffix, seal ring colour
    { g: '10', n: 1, f: '', c: '#ffd36a', name: 'Clean + gold glow' }, { g: '9–8', n: 2, f: '-l2', c: '#3fc1b0', name: 'Barely used' },
    { g: '7–6', n: 2, f: '-l3', c: '#5ab8f0', name: 'Lightly played' }, { g: '5–4', n: 2, f: '-l4', c: '#4a7fe8', name: 'Played' },
    { g: '3–2', n: 2, f: '-l5', c: '#ff8a3a', name: 'Heavily played' }, { g: '1', n: 1, f: '-l6', c: '#ff5a4a', name: 'Damaged' },
  ];
  const bandOf = (g) => WEAR[g === 10 ? 0 : g === 1 ? 5 : 5 - Math.ceil((g - 1) / 2)];
  const PDA_SUM = PDA.reduce((a, b) => a + b.p, 0);
  if (Math.abs(PDA_SUM - 100) > 1e-9) throw new Error('PDA odds must sum to 100, got ' + PDA_SUM);
  const PDA_LINE = 'Most cards grade 6 to 9. A PDA 10 is as rare as a PDA 1: 1 in 100.';

  const pct = (x) => { // 0.025 -> "2.5%", 0.00032 -> "0.032%"
    const v = x * 100;
    const s = v >= 1 ? +v.toFixed(2) : +v.toPrecision(2);
    return s.toLocaleString('en-US', { maximumFractionDigits: 3 }) + '%';
  };
  const oneIn = (x) => { const n = 1 / x; return (n >= 100 ? Math.round(n / 10) * 10 : Math.round(n)).toLocaleString('en-US'); };
  const hp = (x, both) => { // holo table percentages: 2.47%, 20.7%, 0.064%, 8.6%, 46.8%
    const v = x * 100;
    return (v < 1 ? +v.toPrecision(2) : both ? +v.toFixed(1) : +v.toPrecision(3)) + '%';
  };
  const chip = (id, label, cls = '') => `<span class="mat ${id}${cls ? ' ' + cls : ''}">${label || M[id].name}</span>`;

  // ---- pieces ----
  function pdaChart() {
    const max = Math.max(...PDA.map((b) => b.p));
    const cols = PDA.map((b) => `
      <div class="inf-pcol${b.g === 10 ? ' top' : ''}" style="--h:${b.p / max};--c:${bandOf(b.g).c}" title="PDA ${b.g}: ${b.p}%">
        <div class="inf-pplot"><span class="inf-pval">${b.p}%</span><span class="inf-pbar"></span></div>
        <span class="inf-pg">${b.g}</span>
      </div>`).join('');
    const wear = WEAR.map((w) => `
      <div class="inf-wear${w.f ? '' : ' gold'}" style="grid-column: span ${w.n}" title="PDA ${w.g}: ${w.name}">
        <img src="ui/frames/wood${w.f}.webp" alt="" loading="lazy" width="40" height="56">
        <span>${w.name}</span>
      </div>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>PDA grade odds</b><span>Same odds for every material</span></figcaption>
      <div class="inf-pda" role="img" aria-label="PDA odds: ${PDA.map((b) => `${b.g} is ${b.p}%`).join(', ')}">${cols}</div>
      <div class="inf-pwear" role="img" aria-label="Frames by grade: ${WEAR.map((w) => `PDA ${w.g} ${w.name.toLowerCase()}`).join(', ')}">${wear}</div>
      <p class="inf-big">${PDA_LINE}</p>
    </figure>`;
  }

  function matChart() {
    const max = Math.max(...MATS.map((m) => m.count));
    const rows = MATS.map((m) => `
      <div class="inf-mrow" title="${m.name}: ${m.id === 'diamond' ? 'at least 1 in every Series' : m.count + ' cards, ' + pct(m.share)}">
        ${chip(m.id)}
        <span class="inf-mtrack"><span class="inf-mfill ${m.id}" style="--w:${m.count / max}"></span></span>
        <span class="inf-mval">${m.id === 'diamond' ? '1+' : m.count}<small>${m.id === 'diamond' ? 'always' : pct(m.share)}</small></span>
      </div>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>Materials</b><span>Cards in a full Series of ${SERIES_CARDS.toLocaleString('en-US')}</span></figcaption>
      <div class="inf-mat">${rows}</div>
      <p class="inf-legend">Every Series has at least one Diamond, sometimes more.</p>
    </figure>`;
  }

  function holoTable() {
    const cell = (x, both) => x === 0 ? '<td class="inf-nil">Never</td>'
      : `<td><b><span>1 in</span> ${oneIn(x)}</b><small>${hp(x, both)}</small></td>`;
    const rows = MATS.map((m) => `<tr><th scope="row">${chip(m.id)}</th>${cell(m.frame)}${cell(m.frame)}${cell(m.full, true)}${
      m.none ? `<td class="inf-none"><b>${hp(m.none, true).replace('.0%', '%')}</b></td>` : '<td class="inf-nil">Never</td>'}</tr>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>Holo odds</b><span>For each card, by material</span></figcaption>
      <p class="inf-lead">The frame and the picture each get their own shot at holo. Hit both and it's full holo.</p>
      <div class="inf-tablewrap"><table class="inf-table inf-holo">
        <thead><tr><th scope="col">Material</th><th scope="col">Frame only</th><th scope="col">Picture only</th><th scope="col">Both <span>(full)</span></th><th scope="col">No holo</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="inf-callout">
        <p>${chip('paper', 'Full-holo Paper', 'inf-full')}</p>
        <p>A full-holo Paper is one of the rarest cards in the forge. Only 1 Paper in ${oneIn(M.paper.full)} gets one, so most Series have none.</p>
      </div>
    </figure>`;
  }

  function packRow() {
    const slots = [['paper'], ['paper'], ['paper'], ['wood'], ['wood', 'Wood+'], ['fire', 'Fire+']];
    return `<div class="inf-pack" role="img" aria-label="A pack: 3 Paper, 1 Wood, 1 Wood or better, 1 Fire or better">
      ${slots.map(([id, l], i) => `<span class="inf-slot"><i>${i + 1}</i>${chip(id, l)}</span>`).join('')}
    </div><p class="inf-note">“+” means that material or better.</p>`;
  }

  function timeline() {
    return `<ol class="inf-time">
      <li><b>First 24 h</b><span>Holders first. The first 50 paid packs take PLANK only, to get the fire stoked.</span></li>
      <li><b>After 24 h</b><span>Open to everyone. Unclaimed Press packs join the sale.</span></li>
      <li><b>After 48 h</b><span>The 5-per-wallet limit lifts.</span></li>
      <li><b>Sold out</b><span>The Series closes and packs can be opened.</span></li>
    </ol>`;
  }

  // ---- sections ----
  const SHORT = { about: 'About', buy: 'Buying', free: 'Free packs', open: 'Opening', cards: 'Cards', pda: 'PDA grades',
    burn: 'Burning', suggest: 'Suggest', paper: 'PAPER & PLANK', fair: 'Fairness', faq: 'FAQ' };
  const sec = (id, title, sum, body, tag) => ({ id, title, sum, body, tag });
  function sections(no) {
    return [
      sec('about', 'What is Omni Forge', 'A forge for collectible NFT cards, released in numbered Series.', `
        <ul>
          <li>Omni Forge mints collectible cards on Robinhood Chain, released in numbered Series.</li>
          <li>The story: PLANK is the wood. It feeds the fire, and the fire runs the card press. The press needs PAPER, so every pack takes 1.</li>
          <li>Sealed packs are their own NFTs. Trade them sealed, or open them once the Series ends and keep the cards.</li>
          <li>Every card is its own NFT: character, material, holo, edition and grade.</li>
          <li>Each Series has its own cast of characters, so a card always tells you where it came from.</li>
        </ul>`),
      sec('buy', 'Buying packs', '$2.50 plus 1 PAPER a pack, paid in PLANK, ETH or USDG.', `
        <ul>
          <li>For this Series: <b>167 packs</b> in total, <b>50</b> of them Press packs. When they're gone, they're gone.</li>
          <li>A pack is currently <b>$2.50 + 1 PAPER</b>. You pay in PLANK, ETH or USDG. The PAPER is burned.</li>
          <li><b>30%</b> of every sale buys PLANK and burns it. The contract keeps nothing.</li>
          <li>You set the most you'll pay. If the price moves past it, the purchase fails and costs nothing.</li>
          <li>Short on PAPER? You can get it right in the buy panel.</li>
        </ul>
        <p class="inf-sub">How a Series sells</p>
        ${timeline()}
        <ul>
          <li><b>Holders first:</b> Paper Press holders, and wallets that held $69 or more of PLANK at a secret snapshot taken before the Series.</li>
          <li>Up to <b>5 paid packs per wallet</b> for the first 48 hours.</li>
          <li>These numbers are set for each Series before it opens, and can't change once it does.</li>
        </ul>`),
      sec('free', 'Press & free packs', 'Paper Press holders claim a Press pack. Free packs are earned and never expire.', `
        <p class="inf-sub">Press packs</p>
        <ul>
          <li>For Paper Press holders. A Press pack costs 1 PAPER and nothing else.</li>
          <li>One per wallet, and each press counts once per Series. First come, first served.</li>
          <li>They're claimable for the first 24 hours. Any left over join the paid sale.</li>
          <li>A Press pack is a normal pack: open it, or trade it sealed.</li>
        </ul>
        <p class="inf-sub">Free packs</p>
        <ul>
          <li>Earn one by burning 42 cards, or when your character suggestion gets picked.</li>
          <li>Use them <b>any time</b> while a Series is on sale, in every phase. The holder window, PLANK-only packs and wallet limit don't apply to them.</li>
          <li>Each one mints a pack for 1 PAPER (burned), from the current Series.</li>
          <li>They stack and never expire. Nothing on sale? Yours wait for the next Series.</li>
        </ul>`),
      sec('open', 'Opening packs', 'Packs open once the Series sells out. Nobody knows what’s inside until then.', `
        <ul>
          <li>You can open your packs once the Series sells out or ends. Until then, keep them or trade them sealed.</li>
          <li>Open up to 10 at a time. The packs are burned, and fresh randomness deals your cards a few seconds later.</li>
          <li>A pack's cards are decided at that moment, from what's left in the Series. Nobody, the owner included, can know a sealed pack's contents in advance.</li>
        </ul>
        <p class="inf-sub">Every pack holds 6 cards</p>
        ${packRow()}
        <ul>
          <li>What's left in a Series is public, so the odds shift a little as people open. The very last pack gets exactly what remains.</li>
          <li>Doesn't sell out? The owner can end the Series after 48 hours. If they don't, anyone can, 7 days later. It closes with the packs that were sold.</li>
        </ul>`),
      sec('cards', 'The cards', 'Five materials, three kinds of holo, an edition and a Series number.', `
        ${matChart()}
        <ul>
          <li>Each material keeps its share in every Series: half of all cards are Paper.</li>
          <li>Every Series has at least one Diamond, and every Diamond is holo.</li>
          <li>A card can be holo on its <b>frame</b>, its <b>picture</b>, or <b>both</b>: that's full holo.</li>
        </ul>
        ${holoTable()}
        <ul>
          <li>Printed on the card: the character's name, material, category, “Forged · Series ${no}” and the PDA seal.</li>
          <li>Every character has a category, like Person, Animal, Place or Idea. New ones arrive as the Series go on.</li>
          <li>In the card's details: its edition (like “12 of 43”, final once every pack in the Series is dealt) and a serial number that never resets.</li>
        </ul>`, 'Rarity'),
      sec('pda', 'PDA grading', 'Spend a little PAPER and the card gets its grade, 1 to 10.', `
        <ul>
          <li>PDA stands for Professional Digital Authenticators: our nod to real card grading.</li>
          <li>Every card starts as “PDA ?”. Reveal its grade once, whenever you like, up to 10 cards at a time.</li>
          <li>It costs as many whole PAPER as fit under $0.25, and never more than $1. That PAPER is burned.</li>
        </ul>
        ${pdaChart()}
        <ul>
          <li>Most cards land between 6 and 9. A 10 and a 1 are the rarest grades, 1 in 100 each.</li>
          <li>The grade changes the frame: a 10 stays clean with a gold glow, 9–8 barely used, 7–6 lightly played, 5–4 played, 3–2 heavily played, and a 1 is damaged. The seal gets a ring in the grade's colour.</li>
          <li>A Series' odds are fixed before its first pack exists.</li>
          <li>While a card is being graded it can't be transferred.</li>
        </ul>`, 'Rarity'),
      sec('burn', 'Burning cards', 'Every 42 cards you burn earn a free pack.', `
        <ul>
          <li>Burn any cards you don't want to keep. Every 42 burned earns a free pack.</li>
          <li>Your count never resets: 3 today and 2 tomorrow makes 5 of 42.</li>
          <li>Extras carry over. Burn 50 and you get a free pack, with 8 toward the next.</li>
          <li>The count belongs to the wallet that burns. A burned card is gone for good.</li>
        </ul>`),
      sec('suggest', 'Suggesting characters', 'Pitch a character for 1 PAPER. If it’s picked, you get a free pack.', `
        <ul>
          <li>Anything goes. A suggestion costs 1 PAPER, burned, and the box is always open.</li>
          <li>Before each Series, the artist picks from the list. A picked suggestion earns a free pack.</li>
          <li>The list clears after every picking round. Not picked? Suggest it again.</li>
        </ul>`),
      sec('paper', 'Fuel & paper', 'The forge runs on assets it doesn’t make. It burns them.', `
        <ul>
          <li><b>PLANK is the fuel.</b> Every sale feeds the fire: 30% buys PLANK and burns it, and each Series opens on PLANK alone to get the fire stoked.</li>
          <li><b>PAPER is what every card is printed on.</b> Each pack, grade and suggestion burns a little.</li>
          <li><b>The Paper Press prints PAPER.</b> Holding one puts you first in line every Series.</li>
        </ul>
        <div class="inf-cas">
          <button class="inf-link inf-ca" type="button" data-ca="0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc">PLANK <code>0x6942…2DDc</code> <span class="cp">Copy</span></button>
          <button class="inf-link inf-ca" type="button" data-ca="0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6">PAPER <code>0x0642…e3c6</code> <span class="cp">Copy</span></button>
          <a class="inf-link" href="https://opensea.io/collection/the-plank-press" target="_blank" rel="noopener">Paper Press on OpenSea <span aria-hidden="true">↗</span></a>
        </div>`),
      sec('fair', 'Fairness', 'Randomness nobody controls, and odds fixed before anyone buys.', `
        <ul>
          <li>Cards and grades come from drand, a public randomness source nobody controls, the owner included.</li>
          <li>Results depend only on that randomness and the order packs were opened, not on who presses the button.</li>
          <li>The contract keeps nothing. Every payment is burned or passed on in the same transaction.</li>
          <li>A Series' numbers lock when it opens, and its odds are fixed before it sells. Its characters can't change once packs are selling.</li>
          <li>If randomness stops for 7 days, anyone can cancel: packs come back sealed, cards come back ungraded.</li>
          <li>While the wallet limit is on, packs go to regular wallets like MetaMask or Rabby, not bot contracts.</li>
          <li>The contracts go through internal audits.</li>
        </ul>`),
      sec('faq', 'FAQ', 'Short answers to the usual questions.', `
        <dl class="inf-faq">
          <dt>When can I open my packs?</dt><dd>Once the Series sells out, or is ended. Until then they stay sealed.</dd>
          <dt>Can I sell a pack without opening it?</dt><dd>Yes. Sealed packs trade like any NFT, one kind per Series.</dd>
          <dt>Why do I need PAPER as well as money?</dt><dd>The press needs paper. Every pack burns 1 PAPER, including Press and free packs.</dd>
          <dt>Do free packs expire?</dt><dd>No. They stack, and work in any Series while it's on sale.</dd>
          <dt>Should I grade every card?</dt><dd>Up to you. A grade is drawn once and it's final. ${PDA_LINE}</dd>
          <dt>What if opening gets stuck?</dt><dd>If no randomness arrives within a day, it can be asked for again. After 7 days, anyone can cancel and your packs come back sealed.</dd>
          <dt>Is there a fee when I resell?</dt><dd>A 5% royalty, on marketplaces that honour it.</dd>
        </dl>`),
    ];
  }

  // ---- build ----
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function build() {
    const no = window.Store?.state?.series?.no ?? 7;
    const list = sections(no);
    const root = document.createElement('div'); root.className = 'inf';
    root.innerHTML = `
      <p class="inf-welcome">Welcome to the forge. <b>Wood in. Packs out.</b> Everything about the site and the cards is right here.</p>
      <nav class="inf-index" aria-label="Info sections">
        ${list.map((s) => `<button type="button" class="inf-jump${s.tag ? ' hot' : ''}" data-go="${s.id}">${SHORT[s.id]}</button>`).join('')}
      </nav>
      <div class="inf-glance" aria-label="Rarity at a glance">
        <button type="button" data-go="pda"><b>1 in 100</b><span>PDA 10, as rare as a PDA 1. Most cards grade 6 to 9</span></button>
        <button type="button" data-go="cards"><b>1 in ${oneIn(M.paper.full)}</b><span>Paper cards is full holo, one of the rarest finds</span></button>
        <button type="button" data-go="cards"><b>1+</b><span>Diamond in every Series, always holo</span></button>
      </div>
      ${list.map((s, i) => `
        <details class="inf-sec${s.tag ? ' hot' : ''}" id="info-${s.id}"${i === 0 ? ' open' : ''}>
          <summary><span class="inf-st">${s.title}${s.tag ? `<em>${s.tag}</em>` : ''}</span><span class="inf-ss">${s.sum}</span></summary>
          <div class="inf-body">${s.body}</div>
        </details>`).join('')}`;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (b) go(root, b.dataset.go);
    });
    return root;
  }
  function go(root, id) {
    const d = root.querySelector('#info-' + id); if (!d) return;
    d.open = true;
    requestAnimationFrame(() => {
      d.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      d.querySelector('summary').focus({ preventScroll: true });
    });
  }

  window.Info = {
    // pull odds for one card of a material + holo, from the same numbers as the tables above ("1 in 3,120")
    pullOdds(material, holo = 'none') {
      const m = M[material]; if (!m) return null;
      const share = m.count / SERIES_CARDS, h = material === 'diamond' && holo === 'none' ? 'full' : holo;
      const p = share * (h === 'full' ? m.full : h === 'none' ? m.none : m.frame); // picture only = frame only
      return p > 0 ? oneIn(p) : null;
    },
    open(sectionId) {
      const root = build();
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ca]'); if (!b) return;
        const done = () => { const c = b.querySelector('.cp'); c.textContent = 'Copied'; setTimeout(() => (c.textContent = 'Copy'), 1500); };
        try { navigator.clipboard.writeText(b.dataset.ca).then(done, done); } catch { done(); }
      });
      const dlg = Sheet.open('info', { title: 'Info', body: root, wide: true });
      dlg.querySelector('.sheet-body').scrollTop = 0;
      if (sectionId) go(root, sectionId);
      return dlg;
    },
  };
})();
