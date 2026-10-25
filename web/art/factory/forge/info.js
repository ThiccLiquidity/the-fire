/* info.js: the Info panel. One wide sheet that explains the site and the collection.
   Facts: docs/omni-economy.md, docs/cards-contracts.md, docs/card-studio.md */
(() => {
  // ---- rarity numbers (computed, not typed in) ----
  // Slots (docs/cards-contracts.md): every pack has the same shape, its slots in order (Standard: 3 Paper · 1 Wood · 1
  // Wood or better · 1 Fire or better), and every card is rolled on its own from its slot's fixed odds: its material,
  // then its holo, then its character. The same odds for the first and the last pack; no pool or caps. A material's
  // share of cards (the "about 1 in N cards") = its expected cards per pack over cards per pack. Demo: the Standard
  // recipe (Store.PACK_SLOTS, Store.CARD_ODDS; characters equally likely). Live: the Series' own slots and odds read
  // from the chain (Store.LIVE_ODDS, set by live.js). Every Series sets its own recipe, so the copy only ever shows
  // these as "this Series", never as fixed rules.
  // Diamond is the old top card (Series before Gold): kept only so older cards still show their odds.
  const series = () => window.Store?.state?.series || { total: 167, cast: 10 };
  let PACKS, CHARACTERS, SERIES_CARDS, LIVE, MATS, M, charP, modelKey;
  /** (Re)build the model when the Series, its cast or its live odds change. */
  function model() {
    const live = window.Store?.LIVE_ODDS || null, key = `${series().total}|${series().cast}`;
    if (modelKey && key === modelKey && live === LIVE) return;
    modelKey = key;
    PACKS = Math.max(1, series().total); CHARACTERS = Math.max(1, series().cast); SERIES_CARDS = PACKS * (series().cardsPerPack || 6);
    LIVE = window.Store?.LIVE_ODDS || null; // { types: { [material]: { share, holo: [none, frame, picture, full], name, rank } }, slots: [{ count, odds: [[material, p]] }], chars: { [name]: p } }
    const STD = window.Store?.CARD_ODDS || [['paper', 5000], ['wood', 2415], ['fire', 1497], ['charcoal', 489], ['gold', 399], ['fullart', 200]];
    const STD_TOTAL = STD.reduce((a, [, w]) => a + w, 0);
    const NAME = { paper: 'Paper', wood: 'Wood', fire: 'Fire', charcoal: 'Coal', gold: 'Gold', fullart: 'Full Art' };
    const RATE = { paper: 0.05, wood: 0.1, fire: 0.5, charcoal: 0.9 };
    MATS = (LIVE ? Object.keys(LIVE.types) : STD.map(([id]) => id)).map((id) => ({
    id, name: NAME[id] || id, share: LIVE ? LIVE.types[id].share : (STD.find(([x]) => x === id)?.[1] || 0) / STD_TOTAL,
    always: LIVE ? LIVE.types[id].holo[0] === 0 && LIVE.types[id].holo[1] === 0 && LIVE.types[id].holo[2] === 0 : !RATE[id],
    }));
    const LEGACY = [{ id: 'diamond', name: 'Diamond', share: 1 / SERIES_CARDS, always: true }];
    [...MATS, ...LEGACY].forEach((m) => {
    m.count = m.share * SERIES_CARDS; // expected cards in a full Series (the odds, not a fixed count)
    if (m.id === 'diamond') { m.frame = m.full = 1 / 3; m.none = 0; return; } // always holo, split evenly
    if (LIVE) { const [n, f, , full] = LIVE.types[m.id].holo; m.none = n; m.frame = f; m.full = full; return; } // picture only = frame only (Standard)
    if (m.always) { m.frame = 0; m.full = 1; m.none = 0; return; } // always full holo
    const r = 1 - Math.sqrt(1 - RATE[m.id]); // frame and picture each roll at this
    m.frame = r * (1 - r); m.full = r * r; m.none = (1 - r) * (1 - r);
    });
    // a character's chance per card: its odds on the chain (live), else every character equally likely
    charP = (character) => (LIVE?.chars && character != null && LIVE.chars[character] != null ? LIVE.chars[character] : 1 / CHARACTERS);
    M = Object.fromEntries([...MATS, ...LEGACY].map((m) => [m.id, m]));
  }
  model();
  // fresh PDA grade odds in percent (FirePsa, fixed forever for every Series: grades 7-10 only; 1-6 come only from wear), and the
  // wear frame each band gets (card-studio.md).
  const PDA = Wear.FRESH.map((w, i) => ({ g: i + 1, p: w / Wear.FRESH.reduce((a, b) => a + b, 0) * 100 })).filter((x) => x.p).reverse();
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
    const max = Math.max(...MATS.map((m) => m.share));
    const rows = MATS.map((m) => `
      <div class="inf-mrow" title="${m.name}: ${pct(m.share)} of cards, 1 in ${oneIn(m.share)}">
        ${chip(m.id)}
        <span class="inf-mtrack"><span class="inf-mfill ${m.id}" style="--w:${m.share / max}"></span></span>
        <span class="inf-mval">${pct(m.share)}<small>1 in ${oneIn(m.share)}</small></span>
      </div>`).join('');
    return `<figure class="inf-plate">
      <figcaption><b>Materials</b><span>Series ${no}: each card's odds</span></figcaption>
      <div class="inf-mat">${rows}</div>
    </figure>`;
  }

  // upside-down rarity: holo flips the odds. A look that goes against its material (full holo where holo is unlikely,
  // no holo where it's likely) at least twice as rare as a Full Art. Rarest first; empty if the Series has none.
  function upsideDown() {
    model();
    const top = M.fullart?.share || 0; if (!top) return [];
    const out = [];
    MATS.filter((m) => !m.always).forEach((m) => {
      if (m.full && m.full < m.none) out.push({ id: m.id, holo: 'full', p: m.share * m.full, label: 'Full holo ' + m.name });
      if (m.none && m.none < m.full) out.push({ id: m.id, holo: 'none', p: m.share * m.none, label: 'Plain ' + m.name, plain: true });
    });
    return out.filter((x) => x.p * 2 <= top).sort((a, b) => a.p - b.p);
  }
  // the highest material a look is rarer than ("a Full Art", "a Gold")
  const beats = (p) => { const m = [...MATS].sort((a, b) => a.share - b.share).find((x) => p < x.share); return m ? m.name : null; };
  function upsideBox(no) {
    const list = upsideDown(); if (!list.length) return '';
    const fa = M.fullart.share;
    const line = (x, i) => {
      const extra = i === 0 && fa / x.p >= 2 ? ` That's ${Math.round(fa / x.p)} times rarer than a Full Art.` : x.plain && beats(x.p) ? ` Rarer than a ${beats(x.p)}.` : '';
      return `<li><b>${x.label}${x.plain ? ' (no holo at all)' : ''}:</b> about 1 in ${oneIn(x.p)} cards.${extra}</li>`;
    };
    const lo = MATS.find((m) => !m.always && m.full < m.none), hi = [...MATS].reverse().find((m) => !m.always && m.none < m.full);
    return `<aside class="inf-upside" id="info-upside">
      <h4>Upside-down rarity.</h4>
      <p>Holo flips the odds.${lo && hi ? ` ${lo.name} almost never shines, and ${hi.name} almost always does.` : ''} So the plainest cards in a pack can be the rarest:</p>
      <ul>${list.map(line).join('')}</ul>
      <p class="inf-upside-k">Check the bottom of your stack before you burn it.</p>
    </aside>`;
  }

  function holoTable(no) {
    const cell = (x, both) => x === 0 ? '<td class="inf-nil">Never</td>'
      : `<td><b><span>1 in</span> ${oneIn(x)}</b><small>${hp(x, both)}</small></td>`;
    const full = (m) => m.always ? '<td class="inf-always"><b>Always</b></td>' : cell(m.full, true); // Gold and Full Art: always full holo
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

  // the pack's slots: the live Series' (from the chain), else the Standard's
  const packSlots = () => { model(); return LIVE?.slots?.length ? LIVE.slots : window.Store?.PACK_SLOTS || []; };
  const rankOf = (id) => (LIVE?.types?.[id]?.rank ?? MATS.findIndex((m) => m.id === id));
  /** A slot in words: "Paper", "Wood or better" (every material from the lowest it holds up), else "Fire or Gold". The
   *  studio says the same (recipe.ts slotLabel). `lead` is the material its chip shows, `tail` the words after it. */
  function slotLabel(slot) {
    const ids = slot.odds.filter(([, p]) => p > 0).map(([m]) => m).filter((m) => M[m]);
    if (!ids.length) return { lead: 'paper', text: 'Any', tail: '' };
    if (ids.length === 1) return { lead: ids[0], text: M[ids[0]].name, tail: '' };
    const low = Math.min(...ids.map(rankOf)), up = MATS.filter((m) => rankOf(m.id) >= low).map((m) => m.id), first = ids.filter((m) => rankOf(m) === low);
    if (first.length === 1 && up.length === ids.length && up.every((m) => ids.includes(m))) return { lead: first[0], text: `${M[first[0]].name} or better`, tail: 'or better' };
    return { lead: ids[0], text: orList(ids.map((m) => M[m].name)), tail: 'or ' + orList(ids.slice(1).map((m) => M[m].name)) };
  }
  /** "3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better" */
  const packLine = () => packSlots().map((s) => `${nf(s.count)} ${slotLabel(s).text}`).join(' · ');
  function packRow(no, cpp) {
    const slots = packSlots();
    const cells = slots.flatMap((s) => Array.from({ length: s.count }, () => slotLabel(s)));
    const n = Math.max(1, cells.length || cpp);
    const row = cells.length ? cells : Array.from({ length: n }, () => ({ lead: 'paper', text: 'Any', tail: '' }));
    const line = cells.length ? packLine() : `${n} cards`;
    return `<div class="inf-pack" role="img" aria-label="A Series ${no} pack: ${line}" style="--n:${Math.min(n, 6)}">
      ${row.map((l, i) => `<span class="inf-slot"><i>${i + 1}</i>${chip(l.lead, l.text === 'Any' ? 'Any' : M[l.lead].name)}${l.tail ? `<small>${l.tail}</small>` : ''}</span>`).join('')}
    </div>
    <p class="inf-note">${line}.</p>`;
  }

  // ---- the Series' own settings, for the copy (every number reads the current Series: "in Series N", never fixed)
  const nf = (n) => (+n).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const paperT = (n) => `${nf(n)} PAPER`;
  const orList = (xs) => xs.join(', ').replace(/, ([^,]*)$/, ' or $1');
  const andList = (xs) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');
  const about = (n) => (n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n)).toLocaleString('en-US');
  const bpsPct = (b) => `${+((b || 0) / 100).toFixed(2)}%`;
  /** "6 hours", "15 minutes", "3 days" */
  const durT = (sec) => {
    const s = Math.round(sec || 0), u = (n, w) => `${nf(n)} ${n === 1 ? w : w + 's'}`;
    if (s >= 3 * 86400 && s % 86400 === 0) return u(s / 86400, 'day');
    if (s >= 3600 && s % 3600 === 0) return u(s / 3600, 'hour');
    if (s >= 3600) return u(+(s / 3600).toFixed(1), 'hour');
    return s >= 60 ? u(Math.round(s / 60), 'minute') : u(s, 'second');
  };
  // a group's length: its timer (live: the chain's; demo: its window)
  const lenOf = (g) => g.duration || (g.endsAt && g.opensAt ? g.endsAt - g.opensAt : 0);
  /** What one pack of a group costs, for people: "$2.50 + 1 PAPER" or "1 PAPER, no dollar price". */
  const costOf = (g, usd) => (g.priceUsd > 0 ? `${usd(g.priceUsd)} + ${paperT(g.paper)}` : `${paperT(g.paper)}, no dollar price`);
  /** "the PLANK group", "the Press group": a group as one word, for "when ... ends". */
  const groupWord = (g) => (g.gate === 'snapshot' && g.snap?.symbol ? g.snap.symbol : g.isPress ? 'Press' : g.name);
  const whoOf = (g) => (g.gate === 'open' ? 'everyone' : g.gate === 'snapshot' ? Store.holdersName(g) : g.name);
  function facts() {
    const s = series(), P = window.Store?.PRICES || {}, usd = window.Wear?.usd || ((v) => '$' + v);
    const G = s.groups || [], finite = G.filter((g) => !g.unlimited);
    const press = G.find((g) => g.gate === 'nft' && g.isPress) || null, holders = G.filter((g) => g.gate === 'snapshot');
    const everyone = finite.find((g) => g.gate === 'open') || null, extra = G.find((g) => g.unlimited) || null;
    const coins = ['PLANK', 'ETH', 'USDG'].filter((c) => G.some((g) => g.priceUsd > 0 && (g.coins || []).includes(c)));
    const cpp = s.cardsPerPack || 6;
    return { s, P, usd, G, finite, press, holders, everyone, extra, cg: G[s.creditGroup] || null, cpp,
      price: usd(P.PACK_USD || 0), paper: paperT(P.PACK_PAPER || 0), coins: orList(coins.length ? coins : ['PLANK', 'ETH', 'USDG']),
      packs: (s.total || 0).toLocaleString('en-US'), cards: about((s.total || 0) * cpp),
      perWallet: everyone?.perWallet || holders[0]?.perWallet || 0, limitFor: (everyone?.perWallet && everyone.limitFor) || 0, maxTx: s.maxPerTx || 50,
      rwHours: Math.round((s.regularWalletsFor || 0) / 3600), cap: +s.paperCapUsd || 0 };
  }

  // how a Series sells: built from its own groups (the Buy box shows the live ones)
  function timeline(no, F) {
    const { G, press, holders, everyone, extra, usd } = F;
    if (!G.length) return '';
    const first = [press, ...holders].filter(Boolean).filter((g) => g.afterGroup == null);
    const holderLine = (g) => g.gate === 'nft'
      ? `<li><b>${g.isPress ? 'Paper Press holders' : g.name}:</b> ${nf(g.perNft || 1)} ${g.perNft > 1 ? 'packs' : 'pack'} per ${g.isPress ? 'Press' : 'NFT'}${g.perWallet ? `, up to ${nf(g.perWallet)} per wallet,` : ''} for ${costOf(g, usd)}. ${g.capacity != null ? `${nf(g.capacity)} packs, ` : ''}${lenOf(g) ? `open for ${durT(lenOf(g))} or until they're claimed, whichever comes first` : 'open until they\'re claimed'}.</li>`
      : `<li><b>${Store.holdersName(g)}</b>${Store.holdRule(g) ? ` (${Store.holdRule(g)})` : ''}: ${costOf(g, usd)}${g.coins?.length ? `, paid in ${orList(g.coins)}` : ''}${g.perWallet ? `, up to ${nf(g.perWallet)} each` : ''}. ${g.capacity != null ? `${nf(g.capacity)} packs, ` : ''}${lenOf(g) ? `open for ${durT(lenOf(g))} or until they're gone` : 'open until they\'re gone'}.</li>`;
    const steps = [];
    if (first.length) {
      const names = first.map((g) => (g.isPress ? 'Paper Press holders' : Store.holdersName(g)));
      steps.push(`<li><b>Holders first.</b> ${first.length > 1 ? `${andList(names)} get their turns side by side, each in their own group:` : `${names[0]} get their turn first:`}
        <ul>${first.map(holderLine).join('')}</ul></li>`);
    }
    if (everyone) {
      const after = everyone.afterGroup != null ? G[everyone.afterGroup] : null, rolls = G.some((g) => g.rollTo === everyone.index && g !== everyone);
      const coin = (everyone.coins || []).length >= 3 ? 'in any coin' : everyone.coins?.length ? `in ${orList(everyone.coins)}` : '';
      steps.push(`<li><b>Everyone.</b> ${after ? `The moment the ${groupWord(after)} group ends, everyone` : 'Everyone'} can buy${coin ? `, ${coin}` : ''}${everyone.perWallet ? `, up to ${nf(everyone.perWallet)} per wallet${everyone.limitFor ? ` for the first ${durT(everyone.limitFor)}, then as many as you like` : ''}` : ''}.${rolls ? ' Any holder packs left unclaimed roll in here, so every pack still finds a home.' : ''}</li>`);
    }
    if (extra) {
      steps.push(`<li><b>Extra packs.</b> Sold out? Extra packs go on sale${extra.perTx === 1 ? ' one at a time' : ''}${extra.coins?.length ? `, paid in ${orList(extra.coins)}` : ''}${extra.taxBps ? `, each with a pack tax ${bpsPct(extra.taxBps)} higher than the last` : ''}.${extra.idle ? ` If ${durT(extra.idle)} pass with no buyer, sales end.` : ''}</li>`);
    }
    steps.push('<li><b>Rip.</b> When sales end, every pack in the Series can open.</li>');
    return `<p class="inf-sub">How Series ${no} sells</p>
      <ol class="inf-time">${steps.join('')}</ol>
      <p>Every Series sets its own groups, prices, limits and timers, and they lock before it opens. The Buy box always shows the live ones.</p>`;
  }

  // the cards a Series prints, per material: "about 1 in N cards", with a line of flavour
  const FLAVOR = { paper: 'The everyday stock.', fire: 'This is where the heat starts.', gold: 'Gold leaf on the art, always full holo.',
    fullart: 'The art takes over the whole card with no frame, always full holo. Pull a Full Art of a character nobody else has, and you\'re holding something special.' };
  function characterLine(no) {
    const chars = LIVE?.chars ? Object.entries(LIVE.chars).filter(([, p]) => p > 0) : [];
    const ps = chars.map(([, p]) => p), equal = !ps.length || Math.max(...ps) - Math.min(...ps) <= 1e-9 * Math.max(...ps);
    if (equal) return `In Series ${no}, every character is equally likely.`;
    const list = chars.sort((a, b) => a[1] - b[1]).map(([name, p]) => `${esc(name)}: 1 in ${oneIn(p)} cards`);
    return `In Series ${no}, some characters are rarer than others: ${list.join(' · ')}.`;
  }
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // ---- sections ----
  const SHORT = { about: 'About', buy: 'Buying', press: 'Press packs', free: 'Free packs', open: 'Opening', cards: 'Cards', pda: 'Cases & grading',
    burn: 'Burning', suggest: 'Suggest', paper: 'PLANK & PAPER', fair: 'Fairness', faq: 'FAQ' };
  const sec = (id, title, sum, body, tag) => ({ id, title, sum, body, tag });
  function sections(no) {
    const F = facts(), { s, P, usd, press, everyone, extra, cg, cpp } = F;
    const inS = `in Series ${no}`, InS = `In Series ${no}`;
    const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const base = MATS.filter((m) => !m.always).map((m) => m.name), top = MATS.filter((m) => m.always).map((m) => m.name);
    const printsOn = `${andList(base)}${top.length ? `, with rare ${andList(top)} on top` : ''}`;
    const run = extra ? `Series ${no} starts with ${F.packs} packs, about ${F.cards} cards.` : `Series ${no} is ${F.packs} packs, about ${F.cards} cards.`;
    const pressCap = press?.capacity != null ? nf(press.capacity) : null;
    const snapG = F.holders[0];
    const sn = snapG?.snap, holdShort = sn?.min ? `${sn.unit === 'usd' ? `$${nf(sn.min)}+` : `${nf(sn.min)}+ ${sn.symbol}`} held${sn.days ? ` for ${nf(sn.days)} ${+sn.days === 1 ? 'day' : 'days'}` : ''}` : null; // "$69+ held for 7 days"
    const order = F.finite.map(whoOf), orderTxt = order.length ? ' ' + cap1(order.length > 1 ? `${order.slice(0, -1).join(', ')}, then ${order[order.length - 1]}` : order[0]) + '.' : '';
    const freeMax = s.creditPacksMax || 0, freePer = s.creditPacksPerWallet || 0;
    return [
      sec('about', 'What is Omni Cardworks?', 'A trading-card workshop on Robinhood Chain. Wood and paper in, packs out.', `
        <p>Welcome to the workshop. Omni Cardworks makes trading cards the old-fashioned way: a roaring furnace, a big iron press and a stack of paper. Every pack and every card is an NFT on Robinhood Chain, and the characters on them are suggested and picked by the community. Nobody, us included, knows what's in a pack until you rip it.</p>
        <p><b>PLANK is the wood.</b> It feeds the furnace, and the furnace runs the Card Press. A slice of every pack sold buys PLANK and throws it on the fire, gone for good.</p>
        <p><b>PAPER is what the cards are printed on.</b> Every pack takes PAPER (${F.paper} a pack ${inS}), and the press eats it: paid packs, Press packs and free packs alike. Paper Press holders are the ones printing that PAPER, so they get first dibs on every Series.</p>
        <p><b>Every Series is a small, fixed run.</b> ${run} When it sells out, it's done. Fan favorites might just come back someday, with a twist.</p>
        <p><b>${nf(cpp)} cards a pack.</b> Series ${no} prints on ${printsOn}. Any card can come out holo: on the frame, on the picture, or both.</p>
        <p><b>Then they're yours to play with:</b></p>
        <ul>
          <li><b>Rip</b> packs once the Series sells out. Public randomness deals your cards in about 90 seconds. Or keep them sealed: a sealed pack is an NFT too.</li>
          <li><b>Protect</b> your keepers. Raw cards wear with time and trades, like real ones. A case stops the clock; a PDA grade (1 to 10) seals a card in a slab for good.</li>
          <li><b>Burn</b> what you don't want. Every 42 cards burned earns a free pack for a future Series.</li>
          <li><b>Shape</b> the next Series. Suggest its theme, art style or characters. Every idea costs a little PAPER, because you need paper to write it on, just like the cards. Get picked, win a free pack.</li>
          <li><b>Trade</b> anything, any time. Sealed packs, raw cards and slabs all sell like any other NFT.</li>
        </ul>
        <p>Next door, the Printing Press puts out <i>The Morning Wood</i>, a satirical paper, every morning. Same PAPER, same fire.</p>`),
      sec('buy', 'Buying packs', `In Series ${no}: ${F.price} + ${F.paper} a pack, paid in ${F.coins}.`, `
        <p>${run}${extra ? ` Once those sell out, extra packs go on sale${extra.perTx === 1 ? ' one at a time' : ''}, each with a pack tax that rises with every sale.` : ''}</p>
        <ul>
          <li><b>Price:</b> pay the dollar price in ${F.coins}, plus the pack's PAPER. Short on PAPER and paying in ETH? Tick <i>Pay PAPER with ETH</i> and we'll buy it for you in the same step.</li>
          ${F.cap ? `<li><b>PAPER cap:</b> ${inS}, we'll never require more than ${usd(F.cap)} worth of PAPER per pack. If PAPER's price climbs, a pack simply takes less of it.</li>` : ''}
          <li><b>Safe checkout:</b> you see the price before you sign. If it moves more than 3% before your buy lands, nothing is charged. Your wallet may show up to 3% more as a ceiling; anything unused comes back.</li>
          <li><b>Groups and limits:</b> a Series sells in groups, each with its own turn.${orderTxt} ${InS}, each wallet can buy ${F.perWallet ? `up to ${nf(F.perWallet)} packs in each group${F.limitFor ? ` (in the Everyone group, for the first ${durT(F.limitFor)}, then as many as you like)` : ''}, and ` : ''}up to ${nf(F.maxTx)} packs in a single checkout.${F.rwHours ? ` For the first ${nf(F.rwHours)} hours, only regular wallets (MetaMask, Rabby and friends) can buy, so no bot can sweep the drop.` : ''}</li>
          <li><b>Keep it sealed if you like.</b> A sealed pack is an NFT too: hold it, collect it, or trade it unopened.</li>
        </ul>
        ${timeline(no, F)}
        <p class="inf-sub">Where the money goes</p>
        <p>Every pack is a little bonfire (Series ${no} splits):</p>
        <ul>
          ${s.paperBurnBps ? `<li>${bpsPct(s.paperBurnBps)} of the price buys PAPER on the market and burns it.</li>` : ''}
          ${s.plankBurnBps ? `<li>${bpsPct(s.plankBurnBps)} buys PLANK and burns it.</li>` : ''}
          <li>The pack's own PAPER is burned too.</li>
          ${F.G.some((g) => g.taxBps > 0) ? '<li>Extra packs: the pack tax buys PAPER and burns it.</li>' : ''}
        </ul>`),
      sec('press', 'Press packs', 'First dibs for Paper Press holders.', `
        <ul>
          <li>Every Series sets aside a limited number of Press packs. ${press ? `${InS}: ${pressCap != null ? `${pressCap} packs, ` : ''}at most ${nf(press.perNft || 1)} per Press${press.perWallet ? ` and ${nf(press.perWallet)} per wallet` : ''}, for ${press.priceUsd > 0 ? `${usd(press.priceUsd)} + ${paperT(press.paper)}` : `${paperT(press.paper)} each with no dollar price`}.` : `Series ${no} has none.`}</li>
          <li>First come, first served while the Press group is open${press ? ` (${inS}: ${lenOf(press) ? `${durT(lenOf(press))}, or until all ${pressCap ?? 'of them'} are claimed` : `until all ${pressCap ?? 'of them'} are claimed`})` : ''}.</li>
          <li>The Press itself is checked, not the wallet, so passing it around never claims twice.</li>
          <li>Unclaimed Press packs roll on to everyone. A Press pack is just like every other pack: rip it, or keep it sealed and trade it.</li>
        </ul>`),
      sec('free', 'Free packs', 'Earned, stackable, and they never expire.', `
        <ul>
          <li>Two ways to earn one: burn cards, or get your idea picked for a Series.</li>
          <li>Burns add up. Every 42 cards you burn earns a free pack, and they don't have to go at once: 10 today and 32 next week still counts. Extra burns roll toward your next pack.</li>
          <li>They stack and never expire. Use them in a future Series while its free-pack group is open${cg ? ` (${inS}, that's the ${esc(cg.name)} group)` : ''}. A free pack still takes its PAPER.</li>
          <li>To keep drops fair, each Series sets a limit on free packs. ${freeMax || freePer ? `${InS}: ${[freeMax ? `up to ${nf(freeMax)} in total${s.total ? ` (${Math.round(freeMax / s.total * 100)}% of its packs)` : ''}` : '', freePer ? `${nf(freePer)} per wallet` : ''].filter(Boolean).join(', ')}. Anything over that waits for the next Series.` : `Series ${no} has no limit.`}</li>
        </ul>`),
      sec('open', 'Opening packs', 'Rip them once sales end. Nobody knows what\'s inside until then.', `
        <ul>
          <li><b>When:</b> packs open once the Series' sales end, whether it sells out or its last group closes. Until then they stay sealed, and you can keep or trade them sealed (a sealed pack is an NFT too, even years from now).</li>
          <li><b>How:</b> opening burns the pack. About 90 seconds later, public randomness (drand) deals your cards.</li>
          <li><b>No peeking:</b> a sealed pack has no cards in it yet. Nobody can know them in advance: not us, not the seller, not the chain.</li>
        </ul>
        <p class="inf-sub">A Series ${no} pack</p>
        ${packRow(no, cpp)}
        <ul>
          <li><b>Every pack has the same shape, and each slot is its own roll.</b> The first pack and the last pack have exactly the same odds.</li>
          <li><b>Sales stalled?</b> We can end the sale once every group has had its turn. If we don't, anyone can end it 7 days later. Either way, your packs always open.</li>
          <li><b>Stuck?</b> If the randomness never arrives within 24 hours, anyone can cancel and your packs come back sealed.</li>
        </ul>`),
      sec('cards', 'The cards', 'Every card is its own roll: material, holo and character.', `
        <p>Each card is printed on a material. The higher the material, the rarer the card, and the likelier it is to come out holo. In Series ${no}, each card rolls:</p>
        <ul>${MATS.map((m) => `<li><b>${m.name}:</b> about 1 in ${oneIn(m.share)} cards.${FLAVOR[m.id] ? ' ' + FLAVOR[m.id] : ''}</li>`).join('')}</ul>
        ${matChart(no)}
        <ul>
          <li><b>Holo.</b> Any card can come out holo: on the frame, on the picture, or both (full holo). Higher materials shine more often.</li>
        </ul>
        ${holoTable(no)}
        ${upsideBox(no)}
        <ul>
          <li><b>Characters.</b> ${characterLine(no)}</li>
          <li><b>Rarity.</b> "Rare," "Epic" and "Legendary" count that exact card: character, material and holo, plus its grade once it's slabbed. Rare: 1 in 100 or rarer · Epic: 1 in 400 · Legendary: 1 in 1,000. The reveal glows when you hit one.</li>
          <li><b>Print number.</b> Every card is numbered in the order it was pulled. The first of that exact card ever opened is #1, then #2, #3 and on. Get there early and the low numbers are yours.</li>
          <li>Materials, odds and characters are set for each Series and locked before it goes on sale.</li>
        </ul>`, 'Rarity'),
      sec('pda', 'Cases & grading', 'Raw cards wear like real ones. Case to stop the clock, or grade for a slab.', `
        <p>Every card comes out of the pack raw. Raw cards age like real ones: time and trips between wallets slowly wear them down. You decide what to protect.</p>
        <ul>
          <li><b>Fresh for 24 hours.</b> For its first day, time doesn't touch a new card (moves still count). Case or grade it in that window and it keeps fresh odds: 7 to 10, with a ${Wear.TEN_FRESH} shot at a PDA 10. After that, raw cards wear every day, and after ${Wear.NO_TEN_DAYS} days raw a PDA 10 is gone for good.</li>
          <li><b>Case · ${usd(P.CASE_USD)}.</b> A clear top-loader that freezes the card: no more wear from time or moves, from the moment it's cased. It stays ungraded, so you can trade it as a mystery or grade it later with the odds it had when you cased it.</li>
          <li><b>Grade · ${usd(P.GRADE_USD)}.</b> Sends the card to PDA (Professional Digital Authenticators). Its condition is revealed, it gets a grade from 1 to 10, and it's sealed in a slab with its grade word: GEM MINT, MINT, NEAR MINT… Grades are random and final: no regrades, no refunds. Nothing you pay raises the odds.</li>
        </ul>
        ${pdaChart()}
        <ul>
          <li><b>How wear works.</b> Each of a raw card's first 10 moves has a 1-in-5 chance to knock off a grade (moves alone never take it below 5). After the free day, time chips away slowly: a card left raw for a year averages about 6.6, three years about 5.</li>
          <li><b>Low grades take patience.</b> These are the earliest those grades become possible, not guarantees; grading stays random: PDA 4 after a month raw, PDA 3 after six months, PDA 2 after a year, PDA 1 after two years. A 1 is a patience trophy.</li>
          <li><b>Why case instead of grade?</b> Sell it as a mystery, save the gamble for later, protect a stack cheaply, or age a card on purpose and then freeze it.</li>
          <li><b>Hidden from everyone.</b> A card's condition isn't decided until it's graded: not in its data, not on our servers.</li>
          <li><b>The rules are fixed forever.</b> Fresh odds and wear are written into the contract, the same for every Series, and nobody can change them.</li>
          <li><b>Pay in PLANK, ETH or USDG.</b> Every case and grade fee buys PAPER on the market and burns it. 100% of the PAPER purchased through these fees is burned.</li>
        </ul>
        <p class="inf-links"><button type="button" class="inf-link" data-how>How it works</button><button type="button" class="inf-link" data-pop>Pop report</button></p>`),
      sec('burn', 'Burning cards', 'Burn 42 cards, get a free pack.', `
        <ul>
          <li>Every 42 cards you burn earns a free pack. Burned cards are gone for good.</li>
          <li>Extras carry over: burn 50, get 1 pack + 8 toward the next.</li>
        </ul>`),
      sec('suggest', 'Suggesting', 'Your ideas shape every Series. Get picked, win a free pack.', `
        <p>Each Series' look and cast come from community suggestions, in two rounds. Everyone gets a shot at shaping what ends up on the cards:</p>
        <ul>
          <li><b>The look.</b> Suggest a theme and an art style, like "A haunted diner" or "Old woodcut print."</li>
          <li><b>The cast.</b> Once the look is announced, suggest who goes on the cards: anyone or anything, plus a personality and a backstory if you like.</li>
          <li><b>Ideas take PAPER.</b> You need paper to write your suggestion on, just like the press needs paper to print cards. Right now an idea costs ${paperT(P.SUGGEST_PAPER || 0)} (never more than $1 worth), and it's burned.</li>
          <li><b>A fair shortlist.</b> When a round closes, 10 ideas of each kind are drawn at random: one entry per wallet, and the same idea from two people counts once. The results, the random seed and the script are published, so anyone can re-run the draw and check it.</li>
          <li><b>The final picks.</b> From that random shortlist, the final picks are chosen by hand, so there's an element of curation at the end.</li>
          <li><b>Prizes.</b> The picked theme, the picked art style and every picked character each win a free pack. Same idea from two people? The first to send it wins. Packs land before the Series goes on sale.</li>
          <li><b>Get weird.</b> Go full degen. Ridiculous, raunchy, unhinged: send it. Every suggestion burns PAPER, so even your jokes do something good for the community.</li>
        </ul>`),
      sec('paper', 'PLANK & PAPER', 'Two coins and a press run the workshop.', `
        <div class="inf-duo" aria-hidden="true"><figure><img src="ui/brand/plank-256.webp" alt="" width="76" height="120" loading="lazy"><figcaption>PLANK · the wood</figcaption></figure><figure><img src="ui/brand/paper-256.webp" alt="" width="85" height="110" loading="lazy"><figcaption>PAPER · the press</figcaption></figure></div>
        <p><b>PLANK</b> and <b>PAPER</b> are meme coins on Robinhood Chain. The <b>Paper Press</b> (the paper mills) is an NFT that lets its holder produce PAPER.</p>
        <ul>
          <li><b>PLANK is the wood.</b> It's the workshop's fuel and its community coin. ${s.plankBurnBps ? `${InS}, ${bpsPct(s.plankBurnBps)} of every pack sale buys PLANK and throws it on the fire. ` : ''}You can pay for packs, cases and grading in PLANK, and PLANK holders get their own early group in each Series${holdShort ? ` (${inS}: ${holdShort})` : ''}.</li>
          <li><b>PAPER is what everything is printed on.</b> Every pack takes PAPER to print (${inS}, ${F.paper}${F.cap ? `, never more than ${usd(F.cap)} worth` : ''}), and every idea you suggest takes PAPER to write on. Every case and grade fee buys PAPER on the market and burns it${s.paperBurnBps ? `, and so does ${bpsPct(s.paperBurnBps)} of every Series ${no} pack sale` : ''}.</li>
          <li><b>The Paper Press makes PAPER.</b> Over 2,000 Presses were minted in a single seven-day window by locking up PLANK, and no more will ever be minted. Each Press lets its holder mint 1 PAPER a day. It isn't automatic: the holder has to mint it.<span class="inf-presses" hidden> (Presses today: <b data-presses></b>.)</span></li>
          <li><b>Burning a Press.</b> A holder can burn their Press at any time to get its locked PLANK back. That leaves fewer Presses, and so less PAPER that can be made in the future. It doesn't touch the PAPER that already exists.</li>
          <li><b>Press holders get first dibs.</b> Each Series gives them their own group${press ? ` (${inS}: ${nf(press.perNft || 1)} ${press.perNft > 1 ? 'packs' : 'pack'} per Press for ${press.priceUsd > 0 ? `${usd(press.priceUsd)} + ` : ''}${paperT(press.paper)})` : ''}.</li>
          <li><b>Need some?</b> <i>Get PAPER</i> swaps ETH, PLANK or USDG for exactly the PAPER you need.</li>
        </ul>
        <div class="inf-cas">
          ${TOKENS.map(([t, a]) => `<button class="inf-link inf-ca" type="button" data-ca="${a}">${t} <code>${short(a)}</code> <span class="cp">Copy</span></button>`).join('')}
          <a class="inf-link" href="https://opensea.io/collection/the-plank-press" target="_blank" rel="noopener">Paper Press on OpenSea <span aria-hidden="true">↗</span></a>
        </div>`),
      sec('fair', 'Fairness', 'Public randomness, fixed odds, no bot sweeps.', `
        <ul>
          <li><b>Nobody picks your cards.</b> Cards and grades come from drand, a public randomness source run by independent groups around the world. Nobody owns it, us included. Each pack you open, and each card you grade, is tied to a drand number that doesn't exist yet when you hit the button, about 90 seconds in the future. One request, one number: no re-rolls.</li>
          <li><b>Every pack has the same shape, and each slot is its own roll.</b> The first pack and the last pack have exactly the same odds, so nobody can tell what's left or what's coming.</li>
          <li><b>Locked before the sale.</b> A Series' odds, characters, prices and limits are set and locked before anyone can buy.</li>
          <li><b>No bot sweeps.</b> Holders get their turn first, and for the first part of a sale only regular wallets can buy${F.rwHours ? ` (${inS}: the first ${nf(F.rwHours)} hours)` : ''}.</li>
          <li><b>Your money never sits in the contract.</b> Every payment is split and sent where it goes (the burns, and the rest) in the same transaction you sign.</li>
          <li><b>What we can do:</b> pause buying, casing and grading in an emergency, and switch the randomness source (announced first; only new requests use it).</li>
          <li><b>What we can't do:</b> stop opening, dealing or transfers. Those never pause.</li>
          <li><b>Randomness never arrives?</b> After 24 hours, anyone can cancel: packs come back sealed, and cards sent for grading come back ungraded.</li>
        </ul>`),
      sec('faq', 'FAQ', 'Short answers to the usual questions.', `
        <dl class="inf-faq">
          <dt>What does a pack cost?</dt><dd>${InS}: ${F.price} + ${F.paper}.${press ? ` Paper Press holders can claim one per Press for ${paperT(press.paper)}${press.priceUsd > 0 ? ` + ${usd(press.priceUsd)}` : ''} while their packs last.` : ''}</dd>
          <dt>When can I open my packs?</dt><dd>Once the Series' sales end. Until then, nobody knows what's inside.</dd>
          <dt>Can I keep a pack sealed?</dt><dd>Yes. Sealed packs are NFTs too. Collect them, hold them, or trade them unopened, even years from now.</dd>
          <dt>Why do I need PAPER too?</dt><dd>The press prints on it. Every pack takes PAPER, Press and free packs included.</dd>
          <dt>How rare is a PDA 10?</dt><dd>${Wear.TEN_FRESH} on a fresh card. After the first 24 hours raw, rarer every day. After ${Wear.NO_TEN_DAYS} days raw, never.</dd>
          <dt>Should I grade every card?</dt><dd>Up to you. Grades are final. Not sure? Case it now for ${usd(P.CASE_USD)} and grade it later.</dd>
          <dt>Do free packs expire?</dt><dd>No. They stack and wait for a future Series' free-pack group.</dd>
          <dt>What if opening gets stuck?</dt><dd>Cards usually land in about 90 seconds. If the randomness never arrives within 24 hours, anyone can cancel and your packs come back sealed. <a href="help.html">More help</a></dd>
          <dt>Is there a fee when I resell?</dt><dd>A royalty (5% today, never over 10%) on marketplaces that honor it.</dd>
        </dl>`),
    ];
  }

  // ---- build ----
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function build() {
    model();
    const no = window.Store?.state?.series?.no ?? 7;
    const list = sections(no);
    const root = document.createElement('div'); root.className = 'inf';
    root.innerHTML = `
      <p class="inf-welcome">Welcome to Cardworks. <b>Wood and paper in, packs out.</b></p>
      <nav class="inf-index" aria-label="Info sections">
        <button type="button" class="inf-jump hot" data-start>New here?</button>
        ${list.map((s) => `<button type="button" class="inf-jump${s.tag ? ' hot' : ''}" data-go="${s.id}">${SHORT[s.id]}</button>`).join('')}
      </nav>
      <div class="inf-glance" aria-label="Rarity at a glance">
        <button type="button" data-go="pda"><b>${Wear.TEN_FRESH}</b><span>PDA 10 on a fresh card</span></button>
        ${(() => { const u = upsideDown()[0]; return u ? `<button type="button" data-go="cards" data-upside><b>1 in ${oneIn(u.p)}</b><span>${u.label}. Rarer than a Full Art.</span></button>` : ''; })()}
        ${M.fullart?.share ? `<button type="button" data-go="cards"><b>1 in ${oneIn(M.fullart.share)}</b><span>Full Art in Series ${no}</span></button>` : ''}
      </div>
      ${list.map((s, i) => `
        <details class="inf-sec${s.tag ? ' hot' : ''}" id="info-${s.id}"${i === 0 ? ' open' : ''}>
          <summary><span class="inf-st">${s.id === 'paper' ? `<span class="coin-pair">${Brand.coin('PLANK')}${Brand.coin('PAPER')}</span>` : ''}${s.title}${s.tag ? `<em>${s.tag}</em>` : ''}</span><span class="inf-ss">${s.sum}</span></summary>
          <div class="inf-body">${s.body}</div>
        </details>`).join('')}
      <p class="menu-links"><button class="inf-link" type="button" data-fun="tour">Workshop tour</button><button class="inf-link" type="button" data-fun="practice">Practice pack</button><button class="inf-link" type="button" data-fun="feed">Top stokers</button><a class="inf-link" href="terms.html">Terms &amp; risks</a><a class="inf-link" href="help.html">Stuck transaction?</a></p>`;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (b) go(root, b.dataset.go, b.hasAttribute('data-upside') ? '#info-upside' : null);
    });
    // the Presses that exist now, read on chain (demo: a fixed number); the line stays hidden if it can't be read
    const pr = root.querySelector('.inf-presses');
    if (pr) Promise.resolve(window.Store?.pressSupply?.()).then((n) => {
      if (!(n > 0)) return;
      pr.querySelector('[data-presses]').textContent = n.toLocaleString('en-US') + (window.Store?.state?.demo ? ' in the demo' : '');
      pr.hidden = false;
    }, () => {});
    return root;
  }
  function go(root, id, inner) {
    const d = root.querySelector('#info-' + id); if (!d) return;
    d.open = true;
    requestAnimationFrame(() => {
      (inner && d.querySelector(inner) || d).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      d.querySelector('summary').focus({ preventScroll: true });
    });
  }

  window.Info = {
    // how likely a holo look is on a card of this material (Diamond, Gold and Full Art are never plain)
    holoP(material, holo = 'none') {
      model();
      const m = M[material]; if (!m) return 0;
      const h = (material === 'diamond' || m.always) && holo === 'none' ? 'full' : holo;
      return h === 'full' ? m.full : h === 'none' ? m.none : m.frame; // picture only = frame only
    },
    // rarity of one exact card (character + material + holo look): its chance per card dealt = material odds x holo
    // odds x that character's odds (Series' character weights; equal by default). The same for every pack.
    lookP(material, holo = 'none', character) {
      model();
      const m = M[material]; if (!m) return 0;
      return m.share * this.holoP(material, holo) * charP(character);
    },
    /** An upside-down rare look (a full holo low material, a plain high one, at least twice as rare as a Full Art): its chance per card
     *  (any character), else null. The card detail's "Upside-down rare" badge. */
    upsideDown(material, holo = 'none') {
      const h = holo === 'full' ? 'full' : holo === 'none' ? 'none' : null;
      return h ? upsideDown().find((x) => x.id === material && x.holo === h) || null : null;
    },
    // a material's chance per card (Series' odds)
    shareOf(material) { model(); return M[material]?.share ?? 0; },
    // this Series' materials, in order, with each one's share of cards (the pack strip)
    materials() { model(); return MATS.map(({ id, name, share }) => ({ id, name, share })); },
    // this Series' pack, slot by slot: [{ count, odds: [[material, p]], text: "Wood or better" }], and the one-line shape
    slots() { return packSlots().map((s) => ({ count: s.count, odds: s.odds, text: slotLabel(s).text })); },
    packLine,
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
