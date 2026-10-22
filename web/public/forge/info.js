/* info.js: the Info panel. One wide sheet that explains the site and the collection.
   Facts: docs/omni-economy.md, docs/cards-contracts.md, docs/card-studio.md */
(() => {
  // ---- rarity numbers (computed, not typed in) ----
  // The Series on sale, from its settings in the Store (packs and cast size), by the Standard recipe (docs/card-studio.md,
  // the same maths as the studio's computePool): P packs make 6P cards: 3P Paper, Fire 15% and Coal 4.9% (rounded half up),
  // Gold 2 per character and Full Art 1 per character (each at most one per pack's worth; always full holo), Wood the
  // rest; then Fire-or-better is kept between P and 2P. Every Series sets its own recipe, so the copy only ever shows
  // these as "this Series", never as fixed rules. Holo is random per card for the others.
  // Diamond is the old top card (Series before Gold): kept only so older cards still show their odds.
  const series = () => window.Store?.state?.series || { total: 167, cast: 10 };
  const PACKS = Math.max(1, series().total), CHARACTERS = Math.max(1, series().cast), SERIES_CARDS = PACKS * 6;
  const pool = (() => {
    const P = PACKS, N = SERIES_CARDS, half = (x) => Math.floor(x + 0.5);
    const c = { paper: 3 * P, fire: half(0.15 * N), charcoal: half(0.049 * N), gold: Math.min(2 * CHARACTERS, P), fullart: Math.min(CHARACTERS, P) };
    let fob = c.fire + c.charcoal + c.gold + c.fullart; // Fire or better
    if (fob > 2 * P) { let cut = fob - 2 * P; for (const k of ['fire', 'charcoal']) { const d = Math.min(cut, c[k]); c[k] -= d; cut -= d; } } // extra Fire, then Coal, becomes Wood
    else if (fob < P) c.fire += P - fob; // a shortfall is taken from Wood
    c.wood = N - c.paper - c.fire - c.charcoal - c.gold - c.fullart;
    return c;
  })();
  const MATS = [
    { id: 'paper', name: 'Paper', count: pool.paper, holo: 0.05 },
    { id: 'wood', name: 'Wood', count: pool.wood, holo: 0.1 },
    { id: 'fire', name: 'Fire', count: pool.fire, holo: 0.5 },
    { id: 'charcoal', name: 'Coal', count: pool.charcoal, holo: 0.9 },
    { id: 'gold', name: 'Gold', count: pool.gold, holo: 1, perChar: pool.gold / CHARACTERS },
    { id: 'fullart', name: 'Full Art', count: pool.fullart, holo: 1, perChar: pool.fullart / CHARACTERS },
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
  // fresh PDA grade odds in percent (FirePsa, fixed forever for every Series: grades 7-10 only; 1-6 come only from wear), and the
  // wear frame each band gets (card-studio.md).
  const PDA = [10, 1, 9, 30, 8, 40, 7, 29]
    .reduce((a, v, i, arr) => (i % 2 ? a : [...a, { g: v, p: arr[i + 1] }]), []);
  // the six grade bands (Wear.BANDS: one set everywhere, with their colours), each with how its slab looks: the one set
  // of wear layers (studio/frames-src/wear_overlays.py, the same over every card type), shown over one clean card
  const NAMES = ['Clean + gold glow', 'Barely used', 'Lightly played', 'Played', 'Heavily played', 'Damaged'];
  const WEAR = Wear.BANDS.map((b, i) => ({ ...b, n: b.hi - b.lo + 1, layer: i ? `ui/wear/wear-l${i + 1}.webp` : null, name: NAMES[i] }));
  const bandOf = (g) => WEAR[Wear.BANDS.indexOf(Wear.bandOf(g))];
  const PDA_SUM = PDA.reduce((a, b) => a + b.p, 0);
  if (Math.abs(PDA_SUM - 100) > 1e-9) throw new Error('PDA odds must sum to 100, got ' + PDA_SUM);
  const PDA_LINE = Wear.FRESH_ODDS; // one string everywhere (wear.js)

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
  // the token contracts (Robinhood Chain); the short form shown is always cut from the real address
  const TOKENS = [['PLANK', '0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc'], ['PAPER', '0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6']];
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const chip = (id, label, cls = '') => `<span class="mat ${id}${cls ? ' ' + cls : ''}">${label || M[id].name}</span>`;

  // ---- pieces ----
  function pdaChart() {
    const max = Math.max(...PDA.map((b) => b.p));
    // every grade, 10 to 1: the fresh odds for 10 to 7, "wear only" for 6 to 1 (they only come from time and moves)
    const cols = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((g) => ({ g, p: PDA.find((x) => x.g === g)?.p || 0 })).map((b) => `
      <div class="inf-pcol${b.g === 10 ? ' top' : ''}${b.p ? '' : ' aged'}" style="--h:${b.p / max};--c:${bandOf(b.g).c}" title="PDA ${b.g}: ${b.p ? b.p + '%' : 'only from wear'}">
        <div class="inf-pplot"><span class="inf-pval">${b.p ? b.p + '%' : 'wear only'}</span><span class="inf-pbar"></span></div>
        <span class="inf-pg">${b.g}</span>
      </div>`).join('');
    // the legend: one clean card, and the same card under each band's wear layer, each under the grades it covers
    const wear = WEAR.map((w) => `
      <div class="inf-wear${w.layer ? '' : ' gold'}" style="grid-column: span ${w.n}" title="PDA ${w.g}: ${w.name}">
        <span class="inf-wthumb"><img src="ui/wear/card.webp" alt="" loading="lazy" width="52" height="73">${w.layer ? `<img src="${w.layer}" alt="" loading="lazy" width="52" height="73">` : ''}</span>
        <span>${w.name}</span>
      </div>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>Grade odds · fresh card</b><span>Same for every material</span></figcaption>
      <div class="inf-pda" role="img" aria-label="PDA odds on a fresh card: ${PDA.map((b) => `${b.g} is ${b.p}%`).join(', ')}. 6 to 1 only from wear">${cols}</div>
      <div class="inf-pwear" role="img" aria-label="How a slab looks by grade: ${WEAR.map((w) => `PDA ${w.g} ${w.name.toLowerCase()}`).join(', ')}">${wear}</div>
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
        <thead><tr><th scope="col">Material</th><th scope="col">Frame only</th><th scope="col">Picture only</th><th scope="col">Full</th><th scope="col">No holo</th></tr></thead>
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

  // how a Series sells: its groups, set per Series (the Buy box shows the live ones)
  function timeline() {
    return `<ol class="inf-time">
      <li><b>Groups</b><span>Press holders first, then PLANK holders, then everyone.</span></li>
      <li><b>Extra packs</b><span>Sold out? Extra packs follow, a bit pricier each time.</span></li>
      <li><b>Sales end</b><span>When sales end, packs open.</span></li>
    </ol>`;
  }

  // ---- sections ----
  const SHORT = { about: 'About', buy: 'Buying', free: 'Press & free packs', open: 'Opening', cards: 'Cards', pda: 'Cases & grading',
    burn: 'Burning', suggest: 'Suggest', paper: 'PLANK & PAPER', fair: 'Fairness', faq: 'FAQ' };
  const sec = (id, title, sum, body, tag) => ({ id, title, sum, body, tag });
  function sections(no) {
    const s = window.Store?.state?.series || {}, P = window.Store?.PRICES || {}, usd = window.Wear?.usd || ((v) => '$' + v);
    return [
      sec('about', 'What is Omni Cardworks?', 'Collectible cards on Robinhood Chain.', `
        <ul>
          <li>PLANK fuels the fire. PAPER feeds the press: every pack burns some.</li>
          <li>Packs and cards are NFTs. Keep them, trade them, or rip them.</li>
        </ul>`),
      sec('buy', 'Buying packs', 'Paid in PLANK, ETH or USDG, plus PAPER.', `
        <ul>
          <li><b>${s.total ?? '—'} packs</b> in Series ${no}.${(s.groups || []).some((g) => g.unlimited) ? ' Extra packs may follow, at a rising price.' : ''}</li>
          <li>Price moves over 3%? Nothing is charged. Your wallet may show up to 3% more; anything unused comes back.</li>
        </ul>
        <p class="inf-sub">Where the money goes</p>
        <ul>
          <li>Every sale burns: 20% buys PAPER, 10% buys PLANK. The rest goes to the team.</li>
          <li>The PAPER each pack takes is burned. Paying it with ETH? We buy the PAPER on the market and burn it.</li>
          <li>Extra packs cost a bit more each time. That extra buys PAPER and burns it.</li>
        </ul>
        <p class="inf-sub">How a Series sells</p>
        ${timeline()}
        <p>Prices and limits lock before a Series opens.</p>`),
      sec('free', 'Press & free packs', 'Press packs for Paper Press holders. Free packs are earned and never expire.', `
        <p class="inf-sub">Press packs</p>
        <ul>
          <li>Paper Press holders get their own group. First come, first served.</li>
          <li>One pack per Press, per Series.</li>
          <li>A Press pack is a normal pack: open it or trade it sealed.</li>
        </ul>
        <p class="inf-sub">Free packs</p>
        <ul>
          <li>Earn one by burning 42 cards, or when your idea is picked.</li>
          <li>Use them while a Series is on sale. They still cost PAPER.</li>
          <li>They stack and never expire.</li>
        </ul>`),
      sec('open', 'Opening packs', 'Packs open when sales end.', `
        <ul>
          <li>Opening burns the pack. Cards land in about 90 seconds.</li>
          <li>Cards are drawn when you open, from what's left. Nobody can peek.</li>
        </ul>
        <p class="inf-sub">A Series ${no} pack</p>
        ${packRow(no)}
        <ul>
          <li>Didn't sell out? Sales still end, and packs open.</li>
        </ul>`),
      sec('cards', 'The cards', 'Materials, holo and rarity.', `
        ${matChart(no)}
        <ul>
          <li>Gold and Full Art are always full holo.</li>
          <li>Other cards can be holo on the <b>frame</b>, the <b>picture</b>, or <b>both</b>: full holo.</li>
        </ul>
        ${holoTable(no)}
        <ul>
          <li>Rarity = how rare that exact card is. Graded cards count their grade too.</li>
          <li>Rare: 1 in 100 or rarer · Epic: 1 in 400 · Legendary: 1 in 1,000.</li>
          <li>Diamond: the top card of earlier Series.</li>
          <li>Each card has an edition (12 of 43) and a serial #.</li>
        </ul>`, 'Rarity'),
      sec('pda', 'Cases & grading', 'Case a card to stop wear, or grade it for a slab.', `
        <ul>
          <li>Raw cards wear over time. Each move can cost a grade.</li>
          <li>New cards stay fresh for 24h. Case or grade by then to stop wear.</li>
          <li><b>Case · ${usd(P.CASE_USD)}:</b> stops wear. Grade it later if you like.</li>
          <li><b>Grade · ${usd(P.GRADE_USD)}:</b> see the grade, get a slab. ${window.Wear?.FINAL_LINE || ''}</li>
        </ul>
        ${pdaChart()}
        <ul>
          <li>A PDA 1–4 takes years of raw wear. ${window.Wear?.TROPHY_LINE || ''}</li>
          <li>Condition is hidden, even from us, until you grade.</li>
          <li>Grading rules never change.</li>
          <li><b>${window.Wear?.BURN_LINE || ''}</b> Paid in PAPER? It's burned directly.</li>
        </ul>
        <p class="inf-links"><button type="button" class="inf-link" data-how>How it works</button><button type="button" class="inf-link" data-pop>Pop report</button></p>`),
      sec('burn', 'Burning cards', 'Burn 42 cards, get a free pack.', `
        <ul>
          <li>Every 42 cards you burn earns a free pack. Burned cards are gone for good.</li>
          <li>Extras carry over: burn 50, get 1 pack + 8 toward the next.</li>
        </ul>`),
      sec('suggest', 'Suggesting', 'Pitch an idea. Get picked, get a free pack.', `
        <ul>
          <li>Two rounds per Series: theme &amp; style, then characters. 1 PAPER per idea, burned.</li>
          <li>10 ideas are drawn at random. The picks come from those 10.</li>
          <li>Every pick wins a free pack. Same idea twice? First one wins.</li>
          <li>Prizes land before the Series goes on sale.</li>
        </ul>`),
      sec('paper', 'PLANK & PAPER', 'The forge burns both.', `
        <ul>
          <li><b>PLANK is the fuel.</b> Part of every sale buys PLANK and burns it.</li>
          <li><b>PAPER is what cards are printed on.</b> Packs, ideas and every fee burn it.</li>
          <li><b>The Paper Press prints PAPER.</b> Press holders get in early.</li>
        </ul>
        <div class="inf-cas">
          ${TOKENS.map(([t, a]) => `<button class="inf-link inf-ca" type="button" data-ca="${a}">${t} <code>${short(a)}</code> <span class="cp">Copy</span></button>`).join('')}
          <a class="inf-link" href="https://opensea.io/collection/the-plank-press" target="_blank" rel="noopener">Paper Press on OpenSea <span aria-hidden="true">↗</span></a>
        </div>`),
      sec('fair', 'Fairness', 'Public randomness, and odds locked before anyone buys.', `
        <ul>
          <li>Cards and grades use drand: public randomness nobody controls. No re-rolls.</li>
          <li>Odds shift a little as packs open. The last pack gets exactly what's left.</li>
          <li>A Series' odds, characters and settings lock before anyone can buy.</li>
          <li>The sale keeps nothing: every payment is burned or paid out.</li>
          <li>We can pause buying, casing and grading. Opening and transfers never pause.</li>
          <li>We can change the randomness source, with notice.</li>
          <li>Draw stuck 7 days? Anyone can cancel: packs return sealed.</li>
        </ul>`),
      sec('faq', 'FAQ', 'Short answers to the usual questions.', `
        <dl class="inf-faq">
          <dt>When can I open my packs?</dt><dd>When sales end.</dd>
          <dt>Can I sell a pack without opening it?</dt><dd>Yes. Sealed packs trade like any NFT.</dd>
          <dt>Why do I need PAPER too?</dt><dd>Every pack burns some, free ones too.</dd>
          <dt>Do free packs expire?</dt><dd>No. They stack and wait for any Series on sale.</dd>
          <dt>Should I grade every card?</dt><dd>Up to you. Not sure? Case it now, grade later.</dd>
          <dt>What if opening gets stuck?</dt><dd>Usually about 90 seconds. Stuck? See <a href="help.html">Help</a>.</dd>
          <dt>Is there a fee when I resell?</dt><dd>A royalty, on marketplaces that honor it.</dd>
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
      <p class="inf-welcome">Welcome to Cardworks. <b>Wood in. Packs out.</b></p>
      <nav class="inf-index" aria-label="Info sections">
        <button type="button" class="inf-jump hot" data-start>New here?</button>
        ${list.map((s) => `<button type="button" class="inf-jump${s.tag ? ' hot' : ''}" data-go="${s.id}">${SHORT[s.id]}</button>`).join('')}
      </nav>
      <div class="inf-glance" aria-label="Rarity at a glance">
        <button type="button" data-go="pda"><b>1 in 100</b><span>PDA 10 on a fresh card</span></button>
        <button type="button" data-go="cards"><b>1 in ${oneIn(M.paper.full)}</b><span>Paper is full holo in Series ${no}</span></button>
        <button type="button" data-go="cards"><b>1 of 1</b><span>Full Art: one per character in Series ${no}</span></button>
      </div>
      ${list.map((s, i) => `
        <details class="inf-sec${s.tag ? ' hot' : ''}" id="info-${s.id}"${i === 0 ? ' open' : ''}>
          <summary><span class="inf-st">${s.title}${s.tag ? `<em>${s.tag}</em>` : ''}</span><span class="inf-ss">${s.sum}</span></summary>
          <div class="inf-body">${s.body}</div>
        </details>`).join('')}
      <p class="menu-links"><button class="inf-link" type="button" data-fun="tour">Workshop tour</button><button class="inf-link" type="button" data-fun="practice">Practice pack</button><button class="inf-link" type="button" data-fun="feed">Top stokers</button><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>`;
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
        if (e.target.closest('[data-pop]')) return window.Stations?.open('pop');
        if (e.target.closest('[data-start]')) return window.UI?.openStart();
        const f = e.target.closest('[data-fun]'); if (f) { Sheet.close('info'); return window.Fun?.go(f.dataset.fun, f.dataset.fun === 'feed' ? { tab: 'board' } : undefined); } // the fun layer (fun.js)
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
