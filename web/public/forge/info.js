/* info.js: the Info panel. One wide sheet that explains the site and the collection.
   Facts: docs/omni-economy.md, docs/cards-contracts.md, docs/card-studio.md */
(() => {
  // ---- rarity numbers (computed, not typed in) ----
  // The demo's current Series (the Standard recipe): 167 packs x 6 = 1,002 cards, here with 10 characters. Every Series
  // sets its own recipe, so the copy only ever shows these as "this Series", never as fixed rules. Gold is 2 per character
  // and Full Art 1 per character (always full holo); Wood is the rest. Holo is random per card for the others.
  // Diamond is the old top card (Series before Gold): kept only so older cards still show their odds.
  const SERIES_CARDS = 167 * 6, CHARACTERS = 10;
  const MATS = [
    { id: 'paper', name: 'Paper', count: 501, holo: 0.05 },
    { id: 'wood', name: 'Wood', count: 272, holo: 0.1 },
    { id: 'fire', name: 'Fire', count: 150, holo: 0.5 },
    { id: 'charcoal', name: 'Coal', count: 49, holo: 0.9 },
    { id: 'gold', name: 'Gold', count: 2 * CHARACTERS, holo: 1, perChar: 2 },
    { id: 'fullart', name: 'Full Art', count: CHARACTERS, holo: 1, perChar: 1 },
  ];
  const LEGACY = [{ id: 'diamond', name: 'Diamond', count: 1, holo: 1 }];
  [...MATS, ...LEGACY].forEach((m) => {
    m.share = m.count / SERIES_CARDS;
    if (m.id === 'diamond') { m.frame = m.full = 1 / 3; m.none = 0; return; } // always holo, split evenly
    if (m.perChar) { m.frame = 0; m.full = 1; m.none = 0; return; } // always full holo
    const r = 1 - Math.sqrt(1 - m.holo); // frame and picture each roll at this
    m.frame = r * (1 - r); m.full = r * r; m.none = (1 - r) * (1 - r); // picture only = frame only
  });
  const M = Object.fromEntries([...MATS, ...LEGACY].map((m) => [m.id, m]));
  // fresh PDA grade odds in percent (FirePsa defaults: grades 5-10 only; 1-4 come only from long raw holds), and the
  // wear frame each band gets (card-studio.md).
  const PDA = [10, 1, 9, 17, 8, 25, 7, 27, 6, 20, 5, 10]
    .reduce((a, v, i, arr) => (i % 2 ? a : [...a, { g: v, p: arr[i + 1] }]), []);
  const WEAR = [ // band, grades covered, frame suffix, seal ring colour
    { g: '10', n: 1, f: '', c: '#ffd36a', name: 'Clean + gold glow' }, { g: '9–8', n: 2, f: '-l2', c: '#3fc1b0', name: 'Barely used' },
    { g: '7–6', n: 2, f: '-l3', c: '#5ab8f0', name: 'Lightly played' }, { g: '5–4', n: 2, f: '-l4', c: '#4a7fe8', name: 'Played' },
    { g: '3–2', n: 2, f: '-l5', c: '#ff8a3a', name: 'Heavily played' }, { g: '1', n: 1, f: '-l6', c: '#ff5a4a', name: 'Damaged' },
  ];
  const bandOf = (g) => WEAR[g === 10 ? 0 : g === 1 ? 5 : 5 - Math.ceil((g - 1) / 2)];
  const PDA_SUM = PDA.reduce((a, b) => a + b.p, 0);
  if (Math.abs(PDA_SUM - 100) > 1e-9) throw new Error('PDA odds must sum to 100, got ' + PDA_SUM);
  const PDA_LINE = 'Fresh cards grade 5 to 10, mostly 6 to 9. A PDA 10 is 1 in 100.';

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
    const cols = [...PDA, ...[4, 3, 2, 1].map((g) => ({ g, p: 0 }))].map((b) => `
      <div class="inf-pcol${b.g === 10 ? ' top' : ''}${b.p ? '' : ' aged'}" style="--h:${b.p / max};--c:${bandOf(b.g).c}" title="PDA ${b.g}: ${b.p ? b.p + '%' : 'only from long raw holds'}">
        <div class="inf-pplot"><span class="inf-pval">${b.p ? b.p + '%' : 'wear only'}</span><span class="inf-pbar"></span></div>
        <span class="inf-pg">${b.g}</span>
      </div>`).join('');
    const wear = WEAR.map((w) => `
      <div class="inf-wear${w.f ? '' : ' gold'}" style="grid-column: span ${w.n}" title="PDA ${w.g}: ${w.name}">
        <img src="ui/frames/wood${w.f}.webp" alt="" loading="lazy" width="40" height="56">
        <span>${w.name}</span>
      </div>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>PDA odds, fresh card</b><span>Same odds for every material</span></figcaption>
      <div class="inf-pda" role="img" aria-label="PDA odds on a fresh card: ${PDA.map((b) => `${b.g} is ${b.p}%`).join(', ')}. 4 to 1 only from long raw holds">${cols}</div>
      <div class="inf-pwear" role="img" aria-label="Frames by grade: ${WEAR.map((w) => `PDA ${w.g} ${w.name.toLowerCase()}`).join(', ')}">${wear}</div>
      <p class="inf-big">${PDA_LINE}</p>
    </figure>`;
  }

  function matChart(no) {
    const max = Math.max(...MATS.map((m) => m.count));
    const rows = MATS.map((m) => `
      <div class="inf-mrow" title="${m.name}: ${m.perChar ? m.perChar + ' per character' : m.count + ' cards, ' + pct(m.share)}">
        ${chip(m.id)}
        <span class="inf-mtrack"><span class="inf-mfill ${m.id}" style="--w:${m.count / max}"></span></span>
        <span class="inf-mval">${m.count}<small>${m.perChar ? m.perChar + ' each' : pct(m.share)}</small></span>
      </div>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>Materials</b><span>Series ${no}: ${SERIES_CARDS.toLocaleString('en-US')} cards, ${CHARACTERS} characters</span></figcaption>
      <div class="inf-mat">${rows}</div>
    </figure>`;
  }

  function holoTable(no) {
    const cell = (x, both) => x === 0 ? '<td class="inf-nil">Never</td>'
      : `<td><b><span>1 in</span> ${oneIn(x)}</b><small>${hp(x, both)}</small></td>`;
    const full = (m) => m.perChar ? '<td class="inf-always"><b>Always</b></td>' : cell(m.full, true); // Gold and Full Art: always full holo
    const rows = MATS.map((m) => `<tr><th scope="row">${chip(m.id)}</th>${cell(m.frame)}${cell(m.frame)}${full(m)}${
      m.none ? `<td class="inf-none"><b>${hp(m.none, true).replace('.0%', '%')}</b></td>` : '<td class="inf-nil">Never</td>'}</tr>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>Holo odds</b><span>Series ${no}, by material</span></figcaption>
      <div class="inf-tablewrap"><table class="inf-table inf-holo">
        <thead><tr><th scope="col">Material</th><th scope="col">Frame only</th><th scope="col">Picture only</th><th scope="col">Both <span>(full)</span></th><th scope="col">No holo</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="inf-callout">
        <p>${chip('paper', 'Full holo Paper', 'inf-full')}</p>
        <p>Only 1 Paper in ${oneIn(M.paper.full)} is full holo in Series ${no}.</p>
      </div>
    </figure>`;
  }

  function packRow(no) {
    const slots = [['paper'], ['paper'], ['paper'], ['wood'], ['wood', 'Wood+'], ['fire', 'Fire+']];
    return `<div class="inf-pack" role="img" aria-label="A Series ${no} pack: 3 Paper, 1 Wood, 1 Wood or better, 1 Fire or better">
      ${slots.map(([id, l], i) => `<span class="inf-slot"><i>${i + 1}</i>${chip(id, l)}</span>`).join('')}
    </div><p class="inf-note">“+” means that material or better.</p>`;
  }

  // the phases in order; their lengths, limits and PLANK-only packs are set per Series (the buy panel shows the live ones)
  function timeline() {
    return `<ol class="inf-time">
      <li><b>Holders first</b><span>Paper Press and PLANK holders. Early packs can be PLANK only.</span></li>
      <li><b>Open to all</b><span>Unclaimed Press packs join the sale.</span></li>
      <li><b>Limits lift</b><span>Any per-wallet limit ends.</span></li>
      <li><b>Sold out</b><span>The Series closes. Packs can be opened.</span></li>
    </ol>`;
  }

  // ---- sections ----
  const SHORT = { about: 'About', buy: 'Buying', free: 'Press & free packs', open: 'Opening', cards: 'Cards', pda: 'Cases & grading',
    burn: 'Burning', suggest: 'Suggest', paper: 'PLANK & PAPER', fair: 'Fairness', faq: 'FAQ' };
  const sec = (id, title, sum, body, tag) => ({ id, title, sum, body, tag });
  function sections(no) {
    const s = window.Store?.state?.series || {}, P = window.Store?.PRICES || {}, usd = window.Wear?.usd || ((v) => '$' + v);
    return [
      sec('about', 'What is Omni Forge', 'Collectible NFT cards on Robinhood Chain, in numbered Series.', `
        <ul>
          <li>PLANK is the wood. It feeds the fire, and the fire runs the card press. The press needs PAPER, so every pack takes some.</li>
          <li>Sealed packs are NFTs. Trade them sealed, or open them once the Series ends.</li>
          <li>Every card is its own NFT. Each Series has its own characters.</li>
        </ul>`),
      sec('buy', 'Buying packs', 'Paid in PLANK, ETH or USDG, plus PAPER.', `
        <ul>
          <li>Series ${no} has <b>${s.total ?? '—'} packs</b>, <b>${s.starters ?? '—'}</b> of them Press packs. When they're gone, they're gone.</li>
          <li>Pay in PLANK, ETH or USDG. Each pack also takes PAPER, which is burned.</li>
          <li>Part of every sale buys PLANK and burns it. The rest goes to the team.</li>
          <li>You set the most you'll pay. If the price moves past it, nothing is charged.</li>
        </ul>
        <p class="inf-sub">How a Series sells</p>
        ${timeline()}
        <p>Each Series sets its own price, windows and limits before it opens. They can't change after.</p>`),
      sec('free', 'Press & free packs', 'Press packs for Paper Press holders. Free packs are earned and never expire.', `
        <p class="inf-sub">Press packs</p>
        <ul>
          <li>For Paper Press holders, at the start of a Series. First come, first served.</li>
          <li>Each press counts once per Series. Unclaimed ones join the paid sale.</li>
          <li>A Press pack is a normal pack: open it or trade it sealed.</li>
        </ul>
        <p class="inf-sub">Free packs</p>
        <ul>
          <li>Earn one by burning 42 cards, or when your character suggestion is picked.</li>
          <li>Use them any time a Series is on sale. Holder windows and wallet limits don't apply. They still take PAPER.</li>
          <li>They stack and never expire. A Series can cap how many it takes; the rest wait for the next one.</li>
        </ul>`),
      sec('open', 'Opening packs', 'Packs open once the Series sells out. Nobody knows what’s inside until then.', `
        <ul>
          <li>Open your packs once the Series sells out or is ended.</li>
          <li>Opening burns the packs. Randomness deals your cards a minute or two later.</li>
          <li>A sealed pack has no cards yet. They're drawn when it's opened, from what's left in the Series. Nobody can know them in advance.</li>
        </ul>
        <p class="inf-sub">A Series ${no} pack</p>
        ${packRow(no)}
        <ul>
          <li>What's left is public, so odds shift a little as people open. The last pack gets exactly what remains.</li>
          <li>Doesn't sell out? The owner can end it once its sale windows are over. If not, anyone can a week later.</li>
        </ul>`),
      sec('cards', 'The cards', 'Materials, holo and rarity.', `
        <p>Materials, holo odds and characters are set per Series. These are Series ${no}'s.</p>
        ${matChart(no)}
        <ul>
          <li>Gold and Full Art are always full holo. Full Art puts the art over the whole card.</li>
          <li>Other cards can be holo on the <b>frame</b>, the <b>picture</b>, or <b>both</b>: full holo.</li>
        </ul>
        ${holoTable(no)}
        <ul>
          <li>Rarity is how rare that exact card is in its Series: character, material and holo. Graded, it counts that grade or better.</li>
          <li>Rare: 1 in 100 or rarer · Epic: 1 in 400 · Legendary: 1 in 1,000.</li>
          <li>Diamond: the top card of earlier Series.</li>
          <li>Each card has an edition (like “12 of 43”, final once the whole Series is dealt) and a serial that never resets.</li>
        </ul>`, 'Rarity'),
      sec('pda', 'Cases & grading', 'Case a card to stop wear, or grade it for a slab.', `
        <ul>
          <li>Every card starts raw. A raw card wears with time, and each move to another wallet can knock a grade off.</li>
          <li>New cards are fresh for 24 hours. Case or grade them by then and they never take a hit.</li>
          <li><b>Case, ${usd(P.CASE_USD)}:</b> stops wear. Still ungraded: trade it, or grade it later.</li>
          <li><b>Grade, ${usd(P.GRADE_USD)}:</b> reveals the PDA grade and seals the card in a slab. Final, no regrades.</li>
        </ul>
        ${pdaChart()}
        <ul>
          <li>Grades 1 to 4 only come from long raw holds. After 10 raw years, a 1 is likely.</li>
          <li>Condition is hidden, from us too. An ungraded card shows only Cased, Dealt and Moves. A slab shows only its grade.</li>
          <li>The grading and wear rules are fixed forever, the same for every Series.</li>
          <li><b>${window.Wear?.BURN_LINE || ''}</b></li>
        </ul>
        <p><button type="button" class="inf-link" data-how>How does this work? Step by step</button></p>`, 'Rarity'),
      sec('burn', 'Burning cards', 'Burn 42 cards, get a free pack.', `
        <ul>
          <li>Every 42 cards you burn earns a free pack. Burned cards are gone for good.</li>
          <li>Your count never resets, and extras carry over: burn 50, get a free pack and 8 toward the next.</li>
        </ul>`),
      sec('suggest', 'Suggesting characters', 'Pitch a character. If it’s picked, you get a free pack.', `
        <ul>
          <li>Anything goes. A suggestion costs a little PAPER, burned.</li>
          <li>Before each Series, we pick from the list. Picked ones earn a free pack.</li>
          <li>The list clears after every pick. Not picked? Suggest it again.</li>
        </ul>`),
      sec('paper', 'PLANK & PAPER', 'The forge burns both.', `
        <ul>
          <li><b>PLANK is the fuel.</b> Part of every sale buys PLANK and burns it.</li>
          <li><b>PAPER is what cards are printed on.</b> Packs and suggestions burn it, and every case and grade fee buys PAPER and burns it.</li>
          <li><b>The Paper Press prints PAPER.</b> Press holders get in early.</li>
        </ul>
        <div class="inf-cas">
          <button class="inf-link inf-ca" type="button" data-ca="0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc">PLANK <code>0x6942…2DDc</code> <span class="cp">Copy</span></button>
          <button class="inf-link inf-ca" type="button" data-ca="0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6">PAPER <code>0x0642…e3c6</code> <span class="cp">Copy</span></button>
          <a class="inf-link" href="https://opensea.io/collection/the-plank-press" target="_blank" rel="noopener">Paper Press on OpenSea <span aria-hidden="true">↗</span></a>
        </div>`),
      sec('fair', 'Fairness', 'Public randomness, and odds locked before anyone buys.', `
        <ul>
          <li>Cards and grades come from drand, public randomness nobody controls. One open, one number: no re-rolls.</li>
          <li>Results depend only on that randomness and the order packs were opened.</li>
          <li>A Series' odds, characters and settings lock before anyone can buy.</li>
          <li>The sale keeps nothing: every payment is burned or paid out.</li>
          <li>The owner can pause buying and case and grade payments. Opening, dealing and transfers never pause.</li>
          <li>The owner can switch the randomness source, announced first. Only new requests use it.</li>
          <li>No answer from randomness for 7 days? Anyone can cancel: packs come back sealed, cards come back ungraded.</li>
          <li>The contracts are audited internally.</li>
        </ul>`),
      sec('faq', 'FAQ', 'Short answers to the usual questions.', `
        <dl class="inf-faq">
          <dt>When can I open my packs?</dt><dd>Once the Series sells out or is ended.</dd>
          <dt>Can I sell a pack without opening it?</dt><dd>Yes. Sealed packs trade like any NFT.</dd>
          <dt>Why do I need PAPER too?</dt><dd>The press runs on it. Every pack burns some, Press and free packs included.</dd>
          <dt>Do free packs expire?</dt><dd>No. They stack and wait for any Series on sale.</dd>
          <dt>Should I grade every card?</dt><dd>Up to you. Grades are final. ${PDA_LINE} Not sure? Case it now, grade it later.</dd>
          <dt>What if opening gets stuck?</dt><dd>Cards usually arrive within minutes. If randomness stops for 7 days, anyone can cancel and your packs come back sealed. <a href="help.html">More help</a></dd>
          <dt>Is there a fee when I resell?</dt><dd>A royalty, on marketplaces that honour it.</dd>
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
      <p class="inf-welcome">Welcome to the forge. <b>Wood in. Packs out.</b></p>
      <nav class="inf-index" aria-label="Info sections">
        <button type="button" class="inf-jump hot" data-start>New here?</button>
        ${list.map((s) => `<button type="button" class="inf-jump${s.tag ? ' hot' : ''}" data-go="${s.id}">${SHORT[s.id]}</button>`).join('')}
      </nav>
      <div class="inf-glance" aria-label="Rarity at a glance">
        <button type="button" data-go="pda"><b>1 in 100</b><span>PDA 10 on a fresh card. Case or grade in 24 h and it never wears</span></button>
        <button type="button" data-go="cards"><b>1 in ${oneIn(M.paper.full)}</b><span>Paper is full holo in Series ${no}</span></button>
        <button type="button" data-go="cards"><b>1 of 1</b><span>Full Art: one per character in Series ${no}</span></button>
      </div>
      ${list.map((s, i) => `
        <details class="inf-sec${s.tag ? ' hot' : ''}" id="info-${s.id}"${i === 0 ? ' open' : ''}>
          <summary><span class="inf-st">${s.title}${s.tag ? `<em>${s.tag}</em>` : ''}</span><span class="inf-ss">${s.sum}</span></summary>
          <div class="inf-body">${s.body}</div>
        </details>`).join('')}
      <p class="menu-links"><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>`;
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
    // how likely a holo look is on a card of this material (Diamond, Gold and Full Art are never plain)
    holoP(material, holo = 'none') {
      const m = M[material]; if (!m) return 0;
      const h = (material === 'diamond' || m.perChar) && holo === 'none' ? 'full' : holo;
      return h === 'full' ? m.full : h === 'none' ? m.none : m.frame; // picture only = frame only
    },
    // rarity of one exact card (character + material + holo look): its copies in a full Series / the Series' cards.
    // Per character for every material: a random-character type splits its count evenly over the cast.
    lookP(material, holo = 'none') {
      const m = M[material]; if (!m) return 0;
      return (m.perChar || m.count / CHARACTERS) * this.holoP(material, holo) / SERIES_CARDS;
    },
    // a grade counts as "this grade or better" (fresh odds), so a PDA 5 never reads rarer than a PDA 9.
    // Ungraded, PDA 5 and the aged 1-4 all come to 1: no grade factor.
    gradeP(g) { return g == null ? 1 : Math.min(1, PDA.filter((x) => x.g >= g).reduce((a, x) => a + x.p, 0) / 100); },
    // the tiers, on that same scale: "1 in N" with N = 1 / (lookP x gradeP)
    TIERS: [['legendary', 1000], ['epic', 400], ['rare', 100]],
    PDA, WEAR, bandOf, oneIn,
    open(sectionId) {
      const root = build();
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-how]')) return window.Wear?.openHow();
        if (e.target.closest('[data-start]')) return window.UI?.openStart();
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
