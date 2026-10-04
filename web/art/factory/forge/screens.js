/* Omni Forge mock: the four station screens. Workbench (open packs + collection), PDA grading, the ash bin
   (burn toward a free pack) and the suggestion box. Demo data only: everything reads and writes window.Store. */
(() => {
  const S = () => Store.state;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const RANK = { paper: 0, wood: 1, fire: 2, charcoal: 3, diamond: 4 };
  const HOLO = { none: 'No holo', frame: 'Holo frame', picture: 'Holo art', full: 'Full holo' };
  const HRANK = { none: 0, frame: 1, picture: 2, full: 3 };
  const GLOW = { paper: '#fff4dc', wood: '#ffc46b', fire: '#ff5a1c', charcoal: '#dcdcf0', diamond: '#9fd8ff' };
  const GRADE_PRICE = 5, MAX_GRADE = 10, BURN_GOAL = 42;
  const FALLBACK_NAMES = ['Ember Fox', 'Old Plank', 'Paper Crane', 'Ash Owl', 'Kettle Knight', 'Cinder Cat', 'Bellows Bear', 'Soot Sprite'];
  const SILHOUETTE = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle cx="50" cy="38" r="17"/><path d="M12 104c2-24 18-37 38-37s36 13 38 37z"/></svg>';

  // ---------- small helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  const btn = (label, cls, onclick, extra = {}) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick, ...extra }, label);
  const paper = () => S().wallet.balances.PAPER;
  const connected = () => S().wallet.connected;
  const connectBtn = () => btn('Connect wallet', 'primary', () => { Store.update((s) => { s.wallet.connected = true; }); toast('Wallet connected', 'good'); });
  const getPaperBtn = () => btn('Get PAPER', 'gold', () => (window.UI?.openGetPaper ? window.UI.openGetPaper() : toast('Get PAPER is coming soon')));
  const byId = (id) => S().cards.find((c) => c.id === id);
  const rarity = (c) => RANK[c.material] * 4 + HRANK[c.holo || 'none'];
  const edNum = (c) => parseInt(c.edition, 10) || 0;
  const offs = {}; // one store subscription per open station
  const listen = (name, fn) => { offs[name]?.(); offs[name] = Store.on(fn); };
  const unlisten = (name) => { offs[name]?.(); delete offs[name]; };

  // ---------- the card: frame thumbnail with a tinted placeholder where the character art will go
  function cardFace(c) {
    const holo = c.holo || 'none';
    return h('div', { class: `cface m-${c.material} h-${holo}${c.grade === 10 ? ' g10' : ''}` },
      h('div', { class: 'cart' }, h('span', { class: 'sil', html: SILHOUETTE }), h('span', { class: 'cname', text: c.character })),
      h('img', { class: 'cframe', src: Store.cardImg(c), alt: `${Store.MAT_LABEL[c.material]} card frame`, draggable: 'false' }),
      h('span', { class: 'ctop', text: `Series ${c.series}` }),
      h('span', { class: 'ced', text: c.edition }),
      holo !== 'none' ? h('i', { class: 'shine', 'aria-hidden': 'true' }) : null);
  }
  const gradeBadge = (c) => c.pending ? h('span', { class: 'pda wait', text: 'Grading' })
    : c.grade == null ? h('span', { class: 'pda none', text: 'PDA ?' }) : h('span', { class: 'pda g' + c.grade, text: 'PDA ' + c.grade });
  const matChip = (m) => h('span', { class: 'mat ' + m, text: Store.MAT_LABEL[m] });
  const holoBadge = (holo) => holo && holo !== 'none' ? h('span', { class: 'holo-b', text: HOLO[holo] }) : null;
  const describe = (c) => `${c.character}, ${Store.MAT_LABEL[c.material]}${c.holo !== 'none' ? ', ' + HOLO[c.holo] : ''}, ${c.pending ? 'being graded' : c.grade == null ? 'not graded' : 'PDA ' + c.grade}, Series ${c.series}, ${c.edition}`;

  // a tile used by the collection and by every picker
  function cardTile(c, { selectable = false, selected = false, isNew = false, onTap, tag } = {}) {
    const b = h('button', { type: 'button', class: 'ctile' + (selectable ? ' pick' : ''), 'data-id': c.id, 'aria-label': describe(c), onclick: () => onTap?.(c, b) },
      h('div', { class: 'cwrap' }, cardFace(c), gradeBadge(c), isNew ? h('span', { class: 'new-b', text: 'New' }) : null,
        selectable ? h('span', { class: 'tick', 'aria-hidden': 'true' }) : null),
      h('div', { class: 'cmeta' }, tag || null, matChip(c.material), holoBadge(c.holo), h('span', { class: 'ser', text: `Series ${c.series}` })));
    if (tag) b.setAttribute('aria-label', describe(c) + '. ' + tag.textContent);
    if (selectable) b.setAttribute('aria-pressed', String(selected));
    return b;
  }

  // ---------- pack contents: 3 Paper, 1 Wood, 1 Wood or better, 1 Fire or better
  function roll(table) { let u = Math.random(), acc = 0; for (const [v, p] of table) { acc += p; if (u < acc) return v; } return table[table.length - 1][0]; }
  function makePack(series) {
    const names = [...new Set(S().cards.map((c) => c.character))]; const pool = names.length ? names : FALLBACK_NAMES;
    const mats = ['paper', 'paper', 'paper', 'wood',
      roll([['wood', 0.8], ['fire', 0.15], ['charcoal', 0.04], ['diamond', 0.01]]),
      roll([['fire', 0.85], ['charcoal', 0.12], ['diamond', 0.03]])];
    let id = Math.max(999, ...S().cards.map((c) => c.id)), serial = Math.max(0, ...S().cards.map((c) => c.serial));
    return mats.map((m) => {
      const holoP = { paper: 0.05, wood: 0.1, fire: 0.5, charcoal: 0.9, diamond: 1 }[m];
      const holo = m === 'diamond' ? roll([['frame', 1 / 3], ['picture', 1 / 3], ['full', 1 / 3]])
        : Math.random() < holoP ? roll([['frame', 0.5], ['picture', 0.35], ['full', 0.15]]) : 'none';
      const of = { paper: 80, wood: 48, fire: 24, charcoal: 8, diamond: 3 }[m] + Math.floor(Math.random() * 12);
      return { id: ++id, serial: ++serial, series, character: pool[Math.floor(Math.random() * pool.length)], material: m, holo,
        edition: `${1 + Math.floor(Math.random() * of)} of ${of}`, grade: null, pending: false };
    });
  }
  // PDA grade odds in percent (owner approved, Oct 4). Sums to exactly 100.
  const GRADE_ODDS = [[10, 1], [9, 17], [8, 24], [7, 25], [6, 18], [5, 7], [4, 3.5], [3, 2], [2, 1.5], [1, 1]];
  const ODDS_SUM = GRADE_ODDS.reduce((a, [, p]) => a + p, 0);
  if (Math.abs(ODDS_SUM - 100) > 1e-9) throw new Error('PDA odds must sum to 100, got ' + ODDS_SUM);
  function drawGrade(rand = Math.random) { // walk the table in tenths of a percent so 3.5 and 1.5 stay exact
    const u = Math.floor(rand() * 1000); let acc = 0;
    for (const [g, p] of GRADE_ODDS) { acc += Math.round(p * 10); if (u < acc) return g; }
    return GRADE_ODDS[GRADE_ODDS.length - 1][0];
  }
  // demo data: re-draw the sample collection's grades on the same odds (seed picked so the 29 demo grades look like the real odds)
  (() => {
    let seed = 1607; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const graded = S().cards.filter((c) => c.grade != null);
    graded.forEach((c) => { c.grade = drawGrade(R); });
    const show10 = graded.find((c) => c.material === 'wood') || graded[0]; // one PDA 10 so the demo shows the gold edge
    if (show10) show10.grade = 10;
  })();

  // =====================================================================================
  // 1. Workbench: sealed packs, the opening table, and the collection
  // =====================================================================================
  const filt = { series: 'all', mat: 'all', holo: 'any', grade: 'all', sort: 'serial' };
  function openTable() {
    const packsEl = h('section', { class: 'packs', 'aria-labelledby': 'packs-h' });
    const stage = h('section', { class: 'stage', hidden: true, 'aria-label': 'Opening' });
    const coll = h('section', { class: 'coll', 'aria-labelledby': 'coll-h' });
    const root = h('div', { class: 'st st-table' }, packsEl, stage, coll);
    const hide = new Set(); const fresh = new Set(); let busy = false;

    function renderPacks() {
      const s = S(); const keys = Object.keys(s.sealed).map(Number).sort((a, b) => b - a);
      const tiles = keys.map((no) => {
        const n = s.sealed[no], live = no === s.series.no && s.series.phase < 4;
        let act;
        if (live) act = h('p', { class: 'lock-note', text: `Opens when Series ${no} sells out` });
        else if (!n) act = h('p', { class: 'muted', text: 'All opened' });
        else if (!connected()) act = connectBtn();
        else act = h('div', { class: 'row' }, btn('Open', 'primary', () => openPacks(no, 1)),
          n > 1 ? btn(`Open all (${Math.min(n, 10)})`, '', () => openPacks(no, Math.min(n, 10))) : null);
        return h('div', { class: 'ptile' + (live ? ' live' : '') + (!n ? ' empty' : '') },
          h('div', { class: 'pimg' }, h('img', { src: '../build3/pack.webp', alt: `Series ${no} pack`, width: 240, height: 336 }),
            live ? h('img', { class: 'padlock', src: '../build3/s-padlock.webp', alt: 'Locked' }) : null,
            n > 0 ? h('span', { class: 'pcount', text: '×' + n }) : null),
          h('div', { class: 'pinfo' }, h('h4', { text: `Series ${no}` }), h('p', { class: 'muted', text: n ? `${n} sealed` : 'None sealed' }), act));
      });
      put(packsEl, h('h3', { id: 'packs-h', text: 'Your packs' }), h('div', { class: 'ptiles' }, tiles));
    }

    function renderColl() {
      const s = S(); const all = s.cards.filter((c) => !hide.has(c.id));
      const seriesList = [...new Set(all.map((c) => c.series))].sort((a, b) => b - a);
      let list = all.filter((c) => (filt.series === 'all' || c.series === +filt.series) && (filt.mat === 'all' || c.material === filt.mat)
        && (filt.holo === 'any' || (c.holo || 'none') === filt.holo)
        && (filt.grade === 'all' || (filt.grade === 'none' ? c.grade == null : c.grade != null && filt.grade.split('-').map(Number).includes(c.grade))));
      const sorts = {
        serial: (a, b) => b.serial - a.serial,
        rarity: (a, b) => rarity(b) - rarity(a) || b.serial - a.serial,
        grade: (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || rarity(b) - rarity(a),
        edition: (a, b) => edNum(a) - edNum(b) || rarity(b) - rarity(a),
      };
      list = list.sort(sorts[filt.sort]);
      const sel = (key, label, opts) => h('label', { class: 'f' }, h('span', { text: label }),
        h('select', { onchange: (e) => { filt[key] = e.target.value; renderColl(); coll.querySelector(`select[data-k=${key}]`)?.focus(); }, 'data-k': key },
          opts.map(([v, t]) => h('option', { value: v, selected: String(filt[key]) === String(v) }, t))));
      const filters = h('div', { class: 'filters' },
        sel('series', 'Series', [['all', 'All'], ...seriesList.map((n) => [n, 'Series ' + n])]),
        sel('mat', 'Material', [['all', 'All'], ...Store.MATS.map((m) => [m, Store.MAT_LABEL[m]])]),
        sel('holo', 'Holo', [['any', 'Any'], ['none', 'None'], ['frame', 'Frame'], ['picture', 'Art'], ['full', 'Full']]),
        sel('grade', 'Grade', [['all', 'All'], ['none', 'Not graded'], ['10', 'PDA 10'], ['9-8', 'PDA 9–8'], ['7-6', 'PDA 7–6'], ['5-4', 'PDA 5–4'], ['3-2', 'PDA 3–2'], ['1', 'PDA 1']]),
        sel('sort', 'Sort', [['serial', 'Newest'], ['rarity', 'Rarity'], ['grade', 'Grade'], ['edition', 'Edition']]));
      const grid = list.length ? h('div', { class: 'cgrid' }, list.map((c) => cardTile(c, { isNew: fresh.has(c.id), onTap: (card) => openDetail(card.id) })))
        : h('div', { class: 'empty-state' }, h('p', { text: all.length ? 'No cards match.' : 'No cards yet. Open a pack!' }),
          all.length ? btn('Clear filters', 'small', () => { Object.assign(filt, { series: 'all', mat: 'all', holo: 'any', grade: 'all' }); renderColl(); }) : null);
      put(coll, h('div', { class: 'coll-h' }, h('h3', { id: 'coll-h', text: 'Your cards' }), h('span', { class: 'muted', text: list.length === all.length ? `${all.length} cards` : `${list.length} of ${all.length}` })), filters, grid);
    }
    const render = () => { renderPacks(); renderColl(); };

    async function openPacks(series, n) {
      if (busy) return; busy = true;
      const cards = []; for (let i = 0; i < n; i++) cards.push(...makePack(series));
      cards.forEach((c) => hide.add(c.id));
      Store.update((s) => { s.sealed[series] -= n; s.cards.push(...cards); Store.log(`Opened ${n === 1 ? 'a' : n} Series ${series} pack${n > 1 ? 's' : ''}`); });
      packsEl.hidden = true; stage.hidden = false;
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
      await runStage(series, n, cards);
    }

    async function runStage(series, n, cards) {
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite' });
      const many = n > 1;
      const slots = cards.map((c, i) => {
        const front = h('div', { class: 'face front' }, cardFace(c));
        const back = h('div', { class: 'face back' }, h('img', { src: 'ui/omni-mark.webp', alt: '' }));
        const flipper = h('button', { type: 'button', class: 'flipper', 'aria-label': 'Face-down card. Tap to flip' }, h('div', { class: 'inner' }, back, front));
        const meta = h('div', { class: 'cmeta' }, matChip(c.material), holoBadge(c.holo));
        const slot = h('div', { class: `slot m-${c.material} wait`, style: `--glow:${GLOW[c.material]}` }, flipper, meta);
        slot._c = c; slot._i = i;
        flipper.onclick = () => (slot.classList.contains('flipped') ? openDetail(c.id) : flip(slot, true));
        return slot;
      });
      const landing = h('div', { class: 'landing' + (many ? ' many' : '') }, slots);
      // the pack: two copies of the art, clipped above and below a jagged tear line
      const pts = []; const Y = 74, steps = 16;
      for (let k = 0; k <= steps; k++) pts.push([(k / steps) * 240, Y + (k % 2 ? -7 : 7) + (k === 0 || k === steps ? 0 : (Math.random() - 0.5) * 6)]);
      const pct = ([x, y]) => `${(x / 240 * 100).toFixed(2)}% ${(y / 336 * 100).toFixed(2)}%`;
      const topClip = `polygon(0% 0%, 100% 0%, ${[...pts].reverse().map(pct).join(', ')})`;
      const botClip = `polygon(${pts.map(pct).join(', ')}, 100% 100%, 0% 100%)`;
      const tear = h('span', { class: 'tear', html: `<svg viewBox="0 0 240 336" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map((p) => p.join(',')).join(' ')}"/></svg>` });
      const pack = h('div', { class: 'pk', role: 'img', 'aria-label': `Series ${series} pack` },
        h('div', { class: 'pk-bot', style: `clip-path:${botClip}` }), h('div', { class: 'pk-top', style: `clip-path:${topClip}` }), tear,
        many ? h('span', { class: 'pk-n', text: '×' + n }) : null);
      const ctrls = h('div', { class: 'stage-ctrls' });
      put(stage, msg, h('div', { class: 'table-top' }, landing, pack), ctrls);

      const finish = () => {
        slots.forEach((s) => s.classList.add('flipped', 'landed'));
        slots.forEach((s) => { s.classList.remove('wait'); s.querySelector('.flipper').setAttribute('aria-label', describe(s._c)); if (s._c.material !== 'paper' && s._c.material !== 'wood') s.classList.add('rare'); });
        pack.remove(); done();
      };
      const done = () => {
        cards.forEach((c) => { hide.delete(c.id); fresh.add(c.id); });
        renderColl();
        const best = [...cards].sort((a, b) => rarity(b) - rarity(a))[0];
        msg.textContent = `Best pull: ${Store.MAT_LABEL[best.material]}${best.holo !== 'none' ? ' · ' + HOLO[best.holo] : ''}`;
        const left = S().sealed[series];
        put(ctrls, left > 0 && connected() ? btn(`Open another (${left})`, 'primary', () => { busy = false; openPacks(series, 1); }) : null,
          btn('Done', '', () => { busy = false; stage.hidden = true; packsEl.hidden = false; put(stage); render(); }));
        Store.update(() => {}); // let the shell refresh counts
      };
      if (reduced()) { msg.textContent = 'Opened'; return finish(); }

      // 1) tear the top off
      msg.textContent = many ? `Opening ${n} packs` : 'Tearing it open';
      await wait(350); pack.classList.add('cut');
      await wait(550); pack.classList.add('torn');
      // 2) a short beat while the cards are drawn
      await wait(450); msg.textContent = 'Shuffling…'; pack.classList.add('shuffle');
      await wait(1000); pack.classList.remove('shuffle');
      // 3) cards fly out and land face-down
      msg.textContent = 'Here they come';
      const pr = pack.getBoundingClientRect(); const ox = pr.left + pr.width / 2, oy = pr.top + pr.height * 0.35;
      const gap = many ? 45 : 110;
      slots.forEach((s, i) => {
        s.classList.remove('wait');
        const r = s.getBoundingClientRect(); const dx = ox - (r.left + r.width / 2), dy = oy - (r.top + r.height / 2);
        const rot = (Math.random() - 0.5) * 40;
        s.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.45) rotate(${rot}deg)`, opacity: 0 },
          { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 60}px) scale(.8) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.4 },
          { transform: 'none', opacity: 1 }], { duration: 650, delay: i * gap, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'backwards' });
      });
      await wait(650 + (slots.length - 1) * gap); slots.forEach((s) => s.classList.add('landed'));
      pack.classList.add('gone');
      // 4) flip: tap any card, or wait and they turn over by themselves
      msg.textContent = 'Tap to flip';
      let fast = false;
      put(ctrls, btn('Flip all', 'gold', () => { fast = true; put(ctrls); }));
      await wait(900);
      for (const s of slots) { if (!s.isConnected) return; if (!s.classList.contains('flipped')) await flip(s, false, fast || many); }
      await wait(400); if (!stage.contains(msg)) return;
      put(ctrls); done();
    }

    // more drama for rarer cards: a charge-up glow before the turn, a flash after it
    async function flip(slot, tapped, quick) {
      if (slot.classList.contains('flipped') || slot._flipping) return; slot._flipping = true;
      const c = slot._c, r = RANK[c.material];
      if (r >= 2 && !quick) { slot.classList.add('charge'); await wait(r === 4 ? 1000 : r === 3 ? 800 : 550); slot.classList.remove('charge'); }
      slot.classList.add('flipped'); if (r >= 2) slot.classList.add('rare', 'burst');
      slot.querySelector('.flipper').setAttribute('aria-label', describe(c));
      await wait(quick ? 160 : tapped ? 0 : r >= 2 ? 750 : 380);
    }

    listen('table', render);
    Sheet.open('table', { title: 'Workbench', body: root, wide: true, onClose: () => unlisten('table') });
    render();
  }

  // card detail: bigger card, all traits, quick actions
  function openDetail(id) {
    const c = byId(id); if (!c) return;
    const traits = [['Character', c.character], ['Material', Store.MAT_LABEL[c.material]], ['Holo', HOLO[c.holo || 'none']], ['Series', 'Series ' + c.series],
      ['Edition', c.edition], ['Number', '#' + c.serial], ['PDA grade', c.pending ? 'Being graded' : c.grade == null ? 'Not graded' : String(c.grade)]];
    const goto = (name) => { Sheet.close('card'); Sheet.close('table'); Stations.open(name, { pick: [c.id] }); };
    const canGrade = c.grade == null && !c.pending;
    const body = h('div', { class: 'detail' },
      h('div', { class: 'big' }, h('div', { class: 'cwrap' }, cardFace(c), gradeBadge(c))),
      h('div', { class: 'traits' },
        h('div', { class: 'cmeta' }, matChip(c.material), holoBadge(c.holo)),
        h('dl', {}, traits.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        h('div', { class: 'row' },
          btn('Grade', 'primary', () => goto('grade'), { disabled: !canGrade }),
          btn('Burn', '', () => goto('burn'), { disabled: c.pending }),
          h('a', { class: 'btn', href: 'https://opensea.io/', target: '_blank', rel: 'noopener' }, 'View on OpenSea')),
        !canGrade ? h('p', { class: 'muted small', text: c.pending ? 'Being graded right now.' : 'Already graded.' }) : null));
    Sheet.open('card', { title: c.character, body });
  }

  // =====================================================================================
  // 2. PDA grading
  // =====================================================================================
  const pctTxt = (p) => String(p).replace(/\.0$/, '') + '%';
  function oddsChart() {
    const max = Math.max(...GRADE_ODDS.map(([, p]) => p));
    return h('figure', { class: 'odds' },
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Grade odds: ' + GRADE_ODDS.map(([g, p]) => `PDA ${g} is ${pctTxt(p)}`).join(', ') },
        GRADE_ODDS.map(([g, p]) => h('div', { class: 'bar' + (g === 10 ? ' top' : g === 1 ? ' low' : g >= 6 && g <= 9 ? ' mid' : '') },
          h('span', { class: 'pct', text: pctTxt(p) }), h('i', { style: `height:${Math.max(3, p / max * 64)}px` }), h('span', { class: 'lbl', text: g })))),
      h('figcaption', { text: 'Most cards grade 6 to 9. A PDA 10 is as rare as a PDA 1: 1 in 100.' }));
  }
  function openGrade(opts = {}) {
    const sel = new Set((opts.pick || []).filter((id) => { const c = byId(id); return c && c.grade == null && !c.pending; }));
    let mode = 'pick';
    const root = h('div', { class: 'st st-grade' });
    const foot = h('div', { class: 'foot' });
    const pool = () => S().cards.filter((c) => c.grade == null && !c.pending).sort((a, b) => rarity(b) - rarity(a) || b.serial - a.serial);
    function renderFoot() {
      const n = sel.size, cost = n * GRADE_PRICE, have = paper();
      let act;
      if (!connected()) act = connectBtn();
      else if (!n) act = h('div', { class: 'row' }, h('span', { class: 'why', text: 'Pick a card' }), btn('Grade', 'primary', null, { disabled: true }));
      else if (have < cost) act = h('div', { class: 'row' }, h('span', { class: 'why', text: `Need ${cost} PAPER` }), btn('Grade', 'primary', null, { disabled: true }), getPaperBtn());
      else act = btn(`Grade ${n}`, 'primary', go);
      put(foot, h('div', { class: 'fsum' }, h('b', { text: n ? `${n} picked · ${cost} PAPER` : 'None picked' }), h('span', { class: 'muted', text: `You have ${have} PAPER` })), act);
    }
    function toggle(c, el) {
      if (sel.has(c.id)) sel.delete(c.id);
      else if (sel.size >= MAX_GRADE) return toast(`Up to ${MAX_GRADE} at a time`, 'bad');
      else sel.add(c.id);
      el.setAttribute('aria-pressed', String(sel.has(c.id))); renderFoot();
    }
    function render() {
      if (mode !== 'pick') return;
      [...sel].forEach((id) => { const c = byId(id); if (!c || c.grade != null || c.pending) sel.delete(id); });
      const list = pool();
      put(root, 
        h('div', { class: 'intro' },
          h('div', {}, h('p', { class: 'slead', text: 'Pick up to 10 cards. Each gets a grade from 1 to 10.' }),
            h('p', { class: 'muted', html: `<b class="price">${GRADE_PRICE} PAPER</b> per card (~$0.25 each)` }),
            h('p', { class: 'gnote', text: 'Cards can’t be traded while they’re being graded.' })),
          oddsChart()),
        list.length ? h('div', { class: 'cgrid' }, list.map((c) => cardTile(c, { selectable: true, selected: sel.has(c.id), onTap: toggle })))
          : h('div', { class: 'empty-state' }, h('p', { text: 'All your cards are graded. Open a pack for more!' })),
        foot);
      renderFoot();
    }
    async function go() {
      const ids = [...sel]; const cost = ids.length * GRADE_PRICE;
      if (paper() < cost) return renderFoot();
      mode = 'reveal'; sel.clear();
      Store.update((s) => { s.wallet.balances.PAPER -= cost; ids.forEach((id) => { const c = byId(id); if (c) c.pending = true; }); Store.log(`Sent ${ids.length} card${ids.length > 1 ? 's' : ''} to PDA`); });
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite', text: 'Grading…' });
      const tiles = ids.map((id) => { const c = byId(id); const w = h('div', { class: 'gslot' }, h('div', { class: 'cwrap' }, cardFace(c)), h('div', { class: 'cmeta' }, matChip(c.material), holoBadge(c.holo))); w._id = id; return w; });
      const ctrls = h('div', { class: 'stage-ctrls' });
      put(root, h('div', { class: 'grading' }, msg, h('div', { class: 'ggrid' }, tiles), ctrls));
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
      await wait(reduced() ? 300 : 1500);
      const got = [];
      for (const w of tiles) {
        const g = drawGrade(); got.push(g);
        Store.update((s) => { const c = s.cards.find((x) => x.id === w._id); if (c) { c.grade = g; c.pending = false; } });
        const c = byId(w._id); if (c) w.querySelector('.cframe').src = Store.cardImg(c);
        w.querySelector('.cface').classList.toggle('g10', g === 10);
        w.querySelector('.cwrap').append(h('span', { class: 'stamp g' + g, 'aria-hidden': 'true' }, h('small', { text: 'PDA' }), h('b', { text: g })));
        w.classList.add('stamped'); w.setAttribute('aria-label', `PDA ${g}`);
        if (!reduced()) await wait(650);
      }
      msg.textContent = got.length === 1 ? `PDA ${got[0]}` : `Done! Best: PDA ${Math.max(...got)}`;
      toast(got.length === 1 ? `Graded: PDA ${got[0]}` : `${got.length} cards graded`, 'good');
      put(ctrls, pool().length ? btn('Grade more', '', () => { mode = 'pick'; render(); }) : null, btn('Done', 'primary', () => Sheet.close('grade')));
    }
    listen('grade', render);
    Sheet.open('grade', { title: 'PDA grading', body: root, onClose: () => unlisten('grade') });
    render();
  }

  // =====================================================================================
  // 3. The ash bin: burn cards, every 42 is a free pack
  // =====================================================================================
  let burnQueue = 0; // cards thrown into the scene that have not landed yet
  function addBurn() {
    let free = false;
    Store.update((s) => { s.wallet.burnCount++; if (s.wallet.burnCount % BURN_GOAL === 0) { s.wallet.credits++; free = true; Store.log('Burned 42: free pack'); } });
    if (free) { window.Scene?.popToken?.(); toast('You burned 42: free pack!', 'good'); }
  }
  const hookScene = () => window.Scene?.on?.('cardBurned', () => { if (burnQueue > 0) { burnQueue--; addBurn(); } });
  if (window.Scene) hookScene(); else window.addEventListener('scene-ready', hookScene, { once: true });

  // Best to burn: spare copies first (never the best copy of a character+material), then least rare.
  // Within a group of copies the keeper is the most valuable one; every other copy is a spare.
  const gradeKey = (c) => c.grade ?? 0; // ungraded burns like a low grade
  const keepOrder = (a, b) => HRANK[b.holo || 'none'] - HRANK[a.holo || 'none'] || gradeKey(b) - gradeKey(a) || (edNum(a) || 1e9) - (edNum(b) || 1e9) || a.serial - b.serial;
  function dupInfo() { // id -> { n, spare }
    const groups = new Map();
    for (const c of S().cards) { const k = c.character + '|' + c.material; (groups.get(k) || groups.set(k, []).get(k)).push(c); }
    const out = new Map();
    for (const g of groups.values()) { if (g.length < 2) continue; const keep = [...g].sort(keepOrder)[0]; g.forEach((c) => out.set(c.id, { n: g.length, spare: c !== keep })); }
    return out;
  }
  const bfilt = { series: 'all', mat: 'all', holo: 'any', grade: 'all', sort: 'best' };
  function openBurn(opts = {}) {
    const sel = new Set(opts.pick || []); let confirm = false;
    const root = h('div', { class: 'st st-burn' }); const foot = h('div', { class: 'foot' });
    let dups = new Map();
    const spare = (c) => (dups.get(c.id)?.spare ? 0 : 1);
    const SORTS = {
      best: (a, b) => spare(a) - spare(b) || RANK[a.material] - RANK[b.material] || HRANK[a.holo || 'none'] - HRANK[b.holo || 'none']
        || gradeKey(a) - gradeKey(b) || edNum(b) - edNum(a) || b.serial - a.serial,
      serial: (a, b) => b.serial - a.serial,
      rarity: (a, b) => rarity(a) - rarity(b) || b.serial - a.serial,
      grade: (a, b) => gradeKey(a) - gradeKey(b) || rarity(a) - rarity(b),
    };
    const matches = (c) => (bfilt.series === 'all' || c.series === +bfilt.series) && (bfilt.mat === 'all' || c.material === bfilt.mat)
      && (bfilt.holo === 'any' || (c.holo || 'none') === bfilt.holo)
      && (bfilt.grade === 'all' || (bfilt.grade === 'none' ? c.grade == null : c.grade != null && bfilt.grade.split('-').map(Number).includes(c.grade)));
    const pool = () => S().cards.filter((c) => !c.pending);
    function progress() {
      const b = S().wallet.burnCount % BURN_GOAL;
      return h('div', { class: 'burnbar' },
        h('div', { class: 'bb-top' }, h('b', { text: 'Free pack' }), h('span', { class: 'bb-n', text: `${b} / ${BURN_GOAL}` })),
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': BURN_GOAL, 'aria-valuenow': b, 'aria-label': 'Burned toward a free pack' },
          h('i', { style: `width:${b / BURN_GOAL * 100}%` }), sel.size ? h('i', { class: 'add', style: `left:${b / BURN_GOAL * 100}%;width:${Math.min(BURN_GOAL - b, sel.size) / BURN_GOAL * 100}%` }) : null),
        h('p', { class: 'muted', text: `Burn ${BURN_GOAL} cards, get a free pack.` }));
    }
    function renderFoot() {
      const n = sel.size; const b = S().wallet.burnCount % BURN_GOAL; const packs = Math.floor((b + n) / BURN_GOAL);
      root.querySelector('.burnbar')?.replaceWith(progress());
      let act;
      if (!connected()) act = connectBtn();
      else if (!n) act = h('div', { class: 'row' }, h('span', { class: 'why', text: 'Pick cards' }), btn('Burn', 'danger', null, { disabled: true }));
      else if (confirm) act = h('div', { class: 'row' }, btn('Back', '', () => { confirm = false; renderFoot(); }), btn(`Burn ${n} for good`, 'danger', go));
      else act = btn(`Burn ${n}`, 'danger', () => { confirm = true; renderFoot(); foot.querySelector('.danger')?.focus(); });
      foot.classList.toggle('confirm', confirm && n > 0);
      put(foot, h('div', { class: 'fsum' },
        confirm && n ? h('b', { class: 'fwarn', text: 'Burned cards are gone for good.' }) : h('b', { text: n ? `${n} picked` : 'None picked' }),
        h('span', { class: 'muted', text: packs ? `+${packs} free pack${packs > 1 ? 's' : ''}` : `${BURN_GOAL - b} to a free pack` })), act);
    }
    function toggle(c, el) { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); confirm = false; el.setAttribute('aria-pressed', String(sel.has(c.id))); renderFoot(); }
    function render() {
      [...sel].forEach((id) => { const c = byId(id); if (!c || c.pending) sel.delete(id); });
      dups = dupInfo();
      const all = pool(); const list = all.filter(matches).sort(SORTS[bfilt.sort] || SORTS.best);
      const seriesList = [...new Set(all.map((c) => c.series))].sort((a, b) => b - a);
      const sel_ = (key, label, opts) => h('label', { class: 'f' }, h('span', { text: label }),
        h('select', { 'data-k': key, onchange: (e) => { bfilt[key] = e.target.value; render(); root.querySelector(`select[data-k=${key}]`)?.focus(); } },
          opts.map(([v, t]) => h('option', { value: v, selected: String(bfilt[key]) === String(v) }, t))));
      const filters = h('div', { class: 'filters' },
        sel_('series', 'Series', [['all', 'All'], ...seriesList.map((n) => [n, 'Series ' + n])]),
        sel_('mat', 'Material', [['all', 'All'], ...Store.MATS.map((m) => [m, Store.MAT_LABEL[m]])]),
        sel_('holo', 'Holo', [['any', 'Any'], ['none', 'None'], ['frame', 'Frame'], ['picture', 'Art'], ['full', 'Full']]),
        sel_('grade', 'Grade', [['all', 'All'], ['none', 'Not graded'], ['10', 'PDA 10'], ['9-8', 'PDA 9–8'], ['7-6', 'PDA 7–6'], ['5-4', 'PDA 5–4'], ['3-2', 'PDA 3–2'], ['1', 'PDA 1']]),
        sel_('sort', 'Sort', [['best', 'Best to burn'], ['serial', 'Newest'], ['rarity', 'Rarity'], ['grade', 'Grade']]));
      const tagFor = (c) => { const d = dups.get(c.id); return d?.spare ? h('span', { class: 'dup-b', text: `Duplicate ×${d.n}` }) : null; };
      const visPaper = list.filter((c) => c.material === 'paper');
      const quick = h('div', { class: 'row quick' },
        visPaper.length ? btn('All Paper', 'small', () => { visPaper.forEach((c) => sel.add(c.id)); confirm = false; render(); }) : null,
        sel.size ? btn('Clear', 'small', () => { sel.clear(); confirm = false; render(); }) : null,
        h('span', { class: 'muted small', text: list.length === all.length ? `${all.length} cards` : `${list.length} of ${all.length}` }));
      const spares = all.filter((c) => dups.get(c.id)?.spare).length;
      put(root, progress(),
        all.length ? filters : null,
        all.length && bfilt.sort === 'best' ? h('p', { class: 'muted small burn-hint', text: spares ? `Spare copies first (${spares}), then the most common. Your best copy is never marked as a duplicate.` : 'Most common cards first.' }) : null,
        all.length ? quick : null,
        list.length ? h('div', { class: 'cgrid' }, list.map((c) => cardTile(c, { selectable: true, selected: sel.has(c.id), onTap: toggle, tag: tagFor(c) })))
          : h('div', { class: 'empty-state' }, h('p', { text: all.length ? 'No cards match.' : 'No cards to burn.' }),
            all.length ? btn('Clear filters', 'small', () => { Object.assign(bfilt, { series: 'all', mat: 'all', holo: 'any', grade: 'all' }); render(); }) : null), foot);
      renderFoot();
    }
    function go() {
      const ids = [...sel]; sel.clear(); confirm = false;
      Store.update((s) => { s.cards = s.cards.filter((c) => !ids.includes(c.id)); Store.log(`Burned ${ids.length} card${ids.length > 1 ? 's' : ''}`); });
      unlisten('burn'); Sheet.close('burn');
      toast(`Burning ${ids.length} card${ids.length > 1 ? 's' : ''}…`);
      ids.forEach((_, i) => setTimeout(() => { if (window.Scene?.burn) { burnQueue++; window.Scene.burn(); } else addBurn(); }, i * 350));
    }
    listen('burn', render);
    Sheet.open('burn', { title: 'Ash bin', body: root, onClose: () => unlisten('burn') });
    render();
  }

  // =====================================================================================
  // 4. Suggestion box
  // =====================================================================================
  function openSuggest() {
    const MAX = 280;
    const ta = h('textarea', { id: 'sg-text', maxlength: MAX, rows: 3, placeholder: 'A sleepy volcano…', 'aria-describedby': 'sg-hint sg-count' });
    const count = h('span', { id: 'sg-count', class: 'count', text: `0 / ${MAX}` });
    const act = h('div', { class: 'sg-act' }); const listEl = h('div', { class: 'sg-list' });
    ta.addEventListener('input', () => { count.textContent = `${ta.value.length} / ${MAX}`; renderAct(); });
    function renderAct() {
      const txt = ta.value.trim(); let a;
      if (!connected()) a = connectBtn();
      else if (paper() < 1) a = h('div', { class: 'row' }, h('span', { class: 'why', text: 'Need 1 PAPER' }), btn('Send', 'primary', null, { disabled: true }), getPaperBtn());
      else a = btn('Send', 'primary', send, { disabled: !txt });
      put(act, h('span', { class: 'muted', html: `Costs <b class="price">1 PAPER</b> · you have ${paper()}` }), a);
    }
    function renderList() {
      const list = S().suggestions;
      put(listEl, h('h3', { text: 'Your ideas' }), list.length ? h('ul', {}, list.map((sg) => h('li', {},
        h('span', { class: 'sg-t', text: sg.text }), h('span', { class: 'muted', text: sg.at }),
        h('span', { class: 'sgp ' + (sg.picked ? 'yes' : 'wait'), text: sg.picked ? 'Picked' : 'Waiting' }))))
        : h('p', { class: 'muted', text: 'Nothing yet.' }));
    }
    function send() {
      const text = ta.value.trim(); if (!text || paper() < 1 || !connected()) return;
      Store.update((s) => { s.wallet.balances.PAPER -= 1; s.suggestions.unshift({ text, at: 'Series ' + s.series.no, picked: false }); Store.log('Suggested a character'); });
      ta.value = ''; count.textContent = `0 / ${MAX}`; renderAct(); toast('Sent. Fingers crossed!', 'good');
    }
    const root = h('div', { class: 'st st-suggest' },
      h('p', { class: 'slead', text: 'Who should be on a card in a future Series?' }),
      h('label', { for: 'sg-text', class: 'sr' }, 'Your idea'),
      h('p', { id: 'sg-hint', class: 'hint', text: 'Anything goes: a person, an animal, a food, a place, an object, an idea.' }),
      h('div', { class: 'ta-wrap' }, ta, count),
      h('p', { class: 'reward', text: 'If yours gets picked, you get a free pack.' }),
      act, listEl);
    const render = () => { renderAct(); renderList(); };
    listen('suggest', render);
    Sheet.open('suggest', { title: 'Suggest a character', body: root, onClose: () => unlisten('suggest') });
    render(); setTimeout(() => ta.focus(), 50);
  }

  const OPEN = { table: openTable, grade: openGrade, burn: openBurn, suggest: openSuggest };
  window.Stations = {
    open(name, opts) { (OPEN[name] || (() => toast('Unknown station', 'bad')))(opts); },
    openCard: openDetail,
  };
})();
