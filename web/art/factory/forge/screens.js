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
  const FALLBACK_NAMES = Store.NAMES;

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

  const BACK = 'ui/card-back.webp'; // the card back, for every face-down card

  // ---------- pack-opening sounds, made with WebAudio (no files). Silent while the top bar's sound toggle is off;
  // the AudioContext is only made after the player has turned sound on (a user gesture).
  const Sfx = (() => {
    let ctx = null, noise = null;
    const on = () => document.getElementById('soundBtn')?.getAttribute('aria-pressed') === 'true' && navigator.userActivation?.hasBeenActive !== false;
    function ac() {
      if (!on()) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        try { ctx = new AC(); } catch { return null; }
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
    function hiss(t, { type = 'bandpass', f = 2500, q = 1, peak = 0.2, a = 0.004, dec = 0.05 } = {}) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q; env(g, t, a, peak, dec);
      s.connect(fl).connect(g).connect(ctx.destination); s.start(t, Math.random() * 0.5); s.stop(t + a + dec + 0.05); return fl;
    }
    function tone(t, f, { type = 'sine', peak = 0.12, a = 0.01, dec = 1.2, to } = {}) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + dec); env(g, t, a, peak, dec);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + a + dec + 0.05);
    }
    return {
      rip(n = 2) { if (!ac()) return; const t = ctx.currentTime; for (let i = 0; i < n; i++) hiss(t + i * 0.018 + Math.random() * 0.012, { f: 1800 + Math.random() * 2800, q: 0.9, peak: 0.12 + Math.random() * 0.1, dec: 0.025 + Math.random() * 0.04 }); },
      ripFull() { if (!ac()) return; this.rip(14); hiss(ctx.currentTime, { type: 'highpass', f: 2600, q: 0.5, peak: 0.16, a: 0.02, dec: 0.28 }); },
      slide() { if (!ac()) return; const t = ctx.currentTime; const fl = hiss(t, { type: 'lowpass', f: 450, q: 0.8, peak: 0.2, a: 0.03, dec: 0.3 });
        fl.frequency.setValueAtTime(450, t); fl.frequency.exponentialRampToValueAtTime(3000, t + 0.12); fl.frequency.exponentialRampToValueAtTime(700, t + 0.34); },
      flip() { if (!ac()) return; hiss(ctx.currentTime, { type: 'lowpass', f: 1400, q: 0.7, peak: 0.1, dec: 0.06 }); },
      tease(m) { if (!ac()) return; const t = ctx.currentTime, d = { fire: 0.85, charcoal: 1, diamond: 1.2 }[m] || 1;
        if (m === 'diamond') { tone(t, 900, { peak: 0.04, a: d * 0.8, dec: 0.3, to: 2400 }); tone(t, 1350, { peak: 0.025, a: d * 0.8, dec: 0.3, to: 3600 }); }
        else { tone(t, m === 'fire' ? 70 : 52, { type: 'triangle', peak: 0.16, a: d * 0.85, dec: 0.25 }); hiss(t, { type: 'lowpass', f: 600, peak: 0.08, a: d * 0.8, dec: 0.25 }); } },
      chime(rank) { if (!ac()) return; const t = ctx.currentTime;
        const notes = rank >= 4 ? [880, 1108.7, 1318.5, 1760, 2217.5] : rank === 3 ? [659.3, 987.8, 1318.5] : [784, 1174.7];
        notes.forEach((f, i) => { tone(t + i * 0.07, f, { peak: 0.1, dec: 1.3 }); tone(t + i * 0.07, f * 2.01, { peak: 0.03, dec: 0.8 }); }); },
      boom() { if (!ac()) return; const t = ctx.currentTime; tone(t, 120, { peak: 0.35, a: 0.005, dec: 0.6, to: 38 }); hiss(t, { type: 'lowpass', f: 900, peak: 0.25, dec: 0.45 }); },
    };
  })();

  // ---------- the card: the finished card image (name, material, category, Series and PDA seal are printed on it)
  function cardFace(c) {
    const holo = c.holo || 'none';
    return h('div', { class: `cface m-${c.material} h-${holo}${c.grade === 10 ? ' g10' : ''}` },
      h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: `${c.character}, ${Store.MAT_LABEL[c.material]} card`, draggable: 'false' }),
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

    // ---------- opening: rip the pack, one card at a time (rarest last), then a summary of everything pulled
    async function openPacks(series, n) {
      if (busy) return; busy = true;
      const prior = new Map(); S().cards.forEach((c) => { const k = dupKey(c); prior.set(k, (prior.get(k) || 0) + 1); });
      const packs = []; for (let i = 0; i < n; i++) packs.push(makePack(series));
      let id = Math.max(999, ...S().cards.map((c) => c.id)), serial = Math.max(0, ...S().cards.map((c) => c.serial));
      packs.flat().forEach((c) => { c.id = ++id; c.serial = ++serial; }); // makePack numbers each pack from the same start
      packs.forEach((p) => p.sort((a, b) => rarity(a) - rarity(b))); // rarest last (ties: holo after plain)
      const cards = packs.flat(); cards.forEach((c) => hide.add(c.id));
      Store.update((s) => { s.sealed[series] -= n; s.cards.push(...cards); Store.log(`Opened ${n === 1 ? 'a' : n} Series ${series} pack${n > 1 ? 's' : ''}`); });
      packsEl.hidden = true; stage.hidden = false;
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
      await runOpening(series, packs, prior);
    }

    async function runOpening(series, packs, prior) {
      const n = packs.length, cards = packs.flat();
      const ac = new AbortController(); let stopR; const stopP = new Promise((r) => (stopR = r));
      root.closest('dialog')?.addEventListener('close', () => { ac.abort(); stopR(); }, { once: true, signal: ac.signal });
      let skipped = false;
      const halted = () => skipped || ac.signal.aborted || !root.isConnected;
      const race = (p) => Promise.race([p, stopP]);
      const pause = (ms) => race(wait(ms));
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite' });
      const area = h('div', { class: 'op-area' });
      const meta = h('div', { class: 'op-meta' });
      const ctrls = h('div', { class: 'stage-ctrls' }, btn(n > 1 ? 'Skip to all cards' : 'Skip', 'small', () => { skipped = true; stopR(); }));
      const op = h('div', { class: 'op' }, msg, area, meta, ctrls);
      put(stage, op); stage.classList.add('opening');
      const tilt = holoTilt(halted, ac.signal);

      for (let p = 0; p < n && !halted(); p++) {
        put(meta); const label = n > 1 ? `Pack ${p + 1} of ${n}` : `Series ${series} pack`;
        const from = await race(ripPack({ area, msg, label, tag: n > 1 ? `${p + 1} / ${n}` : null, halted, pause }));
        if (halted()) break;
        await race(runStack({ order: packs[p], from, area, msg, meta, op, halted, pause, tilt, lastPack: p === n - 1 }));
      }
      tilt.stop(); ac.abort();
      if (!root.isConnected || !root.closest('dialog')?.open) return;
      stage.classList.remove('opening');
      summary(series, cards, prior);
    }

    // the pack: drag across the top and the foil strip follows the pointer; tap / Enter tears it for you
    function ripPack({ area, msg, label, tag, halted, pause }) {
      return new Promise((resolve) => {
        const Y = 46, steps = 24, pts = []; // tear line in pack pixels (240 x 336), just under the crimp
        for (let k = 0; k <= steps; k++) pts.push([(k / steps) * 240, Y + (k % 2 ? -3.5 : 3.5) + (k % 3 ? (Math.random() - 0.5) * 3 : 0)]);
        const yAt = (x) => { const i = Math.min(steps - 1, Math.floor(x / 240 * steps)); const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; return y0 + (y1 - y0) * ((x - x0) / (x1 - x0)); };
        const P = ([x, y]) => `${(x / 2.4).toFixed(2)}% ${(y / 3.36).toFixed(2)}%`;
        const region = (x0, x1) => `polygon(${[[x0, 0], [x1, 0], [x1, yAt(x1)], ...pts.filter(([x]) => x > x0 && x < x1).reverse(), [x0, yAt(x0)]].map(P).join(', ')})`;
        const inside = h('div', { class: 'pk-cards', 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('img', { src: BACK, alt: '', draggable: 'false' })));
        const body = h('div', { class: 'pk-body', style: `clip-path:polygon(${pts.map(P).join(', ')}, 100% 100%, 0% 100%)` });
        const edge = h('span', { class: 'pk-edge', html: '<svg viewBox="0 0 240 336" preserveAspectRatio="none" aria-hidden="true"><polyline/></svg>' });
        const keep = h('div', { class: 'pk-strip', style: `clip-path:${region(0, 240)}` }), torn = h('div', { class: 'pk-strip torn' });
        const hint = h('span', { class: 'pk-hint', 'aria-hidden': 'true' });
        const pk = h('button', { type: 'button', class: 'pk2', 'aria-label': `${label}. Drag across the top to tear it open, or press Enter` },
          inside, body, edge, keep, torn, hint, tag ? h('span', { class: 'pk-n', text: tag }) : null);
        put(area, pk); pk.focus({ preventScroll: true });
        msg.textContent = tag ? `${label}: tear across the top` : 'Drag across the top to tear it open';
        let prog = 0, dir = 1, done = false, drag = null, moved = false, grain = 0;
        const draw = () => {
          const px = dir > 0 ? prog * 240 : 240 - prog * 240;
          torn.style.clipPath = prog ? (dir > 0 ? region(0, px) : region(px, 240)) : 'polygon(0 0, 0 0, 0 0)';
          keep.style.clipPath = prog >= 1 ? 'polygon(0 0, 0 0, 0 0)' : dir > 0 ? region(px, 240) : region(0, px);
          torn.style.transformOrigin = P([px, yAt(px)]);
          torn.style.transform = reduced() ? '' : `translateY(${-prog * 5}px) rotate(${-dir * (3 + prog * 24)}deg)`;
          const seg = pts.filter(([x]) => (dir > 0 ? x < px : x > px));
          edge.querySelector('polyline').setAttribute('points', [...seg, [px, yAt(px)]].filter(([x]) => x >= 11 && x <= 229).map((q) => q.join(',')).join(' ')); // inside the crimped sides
          hint.hidden = prog > 0;
        };
        const advance = (p) => {
          if (done || p <= prog) return;
          grain += p - prog; prog = Math.min(1, p); draw();
          if (grain > 0.06) { grain = 0; Sfx.rip(2); }
          if (prog >= 0.97) finish();
        };
        async function finish() {
          if (done) return; done = true; prog = 1; draw(); Sfx.ripFull();
          pk.classList.add('open'); pk.setAttribute('aria-label', `${label}, torn open`);
          msg.textContent = 'Here they come';
          if (reduced()) torn.style.opacity = 0;
          else torn.animate([{ transform: torn.style.transform, opacity: 1 }, { transform: `translate(${dir * 70}px, -110px) rotate(${-dir * 70}deg)`, opacity: 0 }],
            { duration: 650, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
          await pause(260); if (halted()) return;
          inside.classList.add('peek'); // the tops of the cards show above the torn edge
          await pause(reduced() ? 500 : 900); if (halted()) return;
          Sfx.slide();
          const out = reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'none', opacity: 1 }, { transform: 'translateY(30%)', opacity: 0 }];
          [body, edge, keep].forEach((el) => el.animate(out, { duration: 480, easing: 'ease-in', fill: 'forwards' }));
          if (!reduced()) inside.animate([{ transform: 'translateY(-9%)' }, { transform: 'translateY(-62%)' }], { duration: 480, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
          await pause(480); if (halted()) return;
          const r = inside.getBoundingClientRect(); pk.remove(); resolve(r);
        }
        const auto = () => {
          if (done) return; dir = 1;
          if (reduced()) return finish();
          const t0 = performance.now(), from = prog;
          const step = (now) => { if (halted() || done) return; advance(from + (1 - from) * Math.min(1, (now - t0) / 520)); if (!done) requestAnimationFrame(step); };
          requestAnimationFrame(step);
        };
        pk.addEventListener('pointerdown', (e) => {
          if (done) return; const r = pk.getBoundingClientRect(); moved = false;
          if ((e.clientY - r.top) / r.height > 0.45) { drag = null; return; } // the lower part is a tap target only
          if (!prog) dir = e.clientX - r.left < r.width / 2 ? 1 : -1;
          drag = { r, x0: e.clientX }; pk.setPointerCapture(e.pointerId);
        });
        pk.addEventListener('pointermove', (e) => {
          if (!drag || done) return;
          if (!moved && Math.abs(e.clientX - drag.x0) < 6) return; moved = true;
          const f = Math.min(1, Math.max(0, (e.clientX - drag.r.left) / drag.r.width)); advance(dir > 0 ? f : 1 - f);
        });
        const up = () => { if (drag && moved && !done && prog > 0.7) finish(); drag = null; };
        pk.addEventListener('pointerup', up); pk.addEventListener('pointercancel', up);
        pk.addEventListener('click', () => { if (moved) { moved = false; return; } auto(); });
        draw();
      });
    }

    // the stack: face down, the top card turns over; swipe it away (or tap / Enter) for the next one
    function runStack({ order, from, area, msg, meta, op, halted, pause, tilt, lastPack }) {
      return new Promise((resolve) => {
        const els = order.map((c) => {
          const back = h('div', { class: 'face back2' }, h('img', { src: BACK, alt: '', draggable: 'false' }), h('i', { class: 'tease-fx', 'aria-hidden': 'true' }));
          const front = h('div', { class: 'face front' }, cardFace(c), c.holo !== 'none' ? h('i', { class: 'sheen', 'aria-hidden': 'true' }) : null);
          const el = h('button', { type: 'button', class: `sc m-${c.material}`, style: `--glow:${GLOW[c.material]}`, inert: true },
            h('div', { class: 'sc-tilt' }, h('div', { class: 'inner' }, back, front)));
          el._c = c; return el;
        });
        const stk = h('div', { class: 'stk' }, [...els].reverse());
        put(area, stk);
        const rest = [...els]; let ready = false, drag = null, dragged = false;
        const layout = () => rest.forEach((el, k) => { el.style.zIndex = 50 - k; el.style.transform = k ? `translate(${Math.min(k, 4) * 3}px, ${Math.min(k, 4) * 4}px)` : ''; });
        layout();
        if (from && !reduced()) {
          const r = stk.getBoundingClientRect(), s = from.width / r.width;
          stk.animate([{ transform: `translate(${from.left + from.width / 2 - (r.left + r.width / 2)}px, ${from.top + from.height / 2 - (r.top + r.height / 2)}px) scale(${s})` }, { transform: 'none' }],
            { duration: 560, easing: 'cubic-bezier(.2,.8,.3,1)' });
        } else stk.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });

        async function reveal() {
          const el = rest[0], c = el._c, i = order.length - rest.length, last = rest.length === 1, r = RANK[c.material];
          el.inert = false; el.setAttribute('aria-label', `Card ${i + 1} of ${order.length}, face down`); el.focus({ preventScroll: true });
          put(meta, h('span', { class: 'op-n', text: `${i + 1} / ${order.length}` }));
          await pause(i === 0 ? 600 : 160); if (halted()) return;
          if (last && r >= 2) { // tease the rare: the back glows in its material before it turns
            msg.textContent = 'Something’s glowing…';
            el.classList.add('tease', 't-' + c.material); Sfx.tease(c.material);
            await pause({ fire: 850, charcoal: 1000, diamond: 1200 }[c.material]); if (halted()) return;
            el.classList.remove('tease');
          } else if (last) msg.textContent = 'Last card…';
          el.classList.add('flipped'); Sfx.flip();
          const name = `${Store.MAT_LABEL[c.material]}${c.holo !== 'none' ? ' · ' + HOLO[c.holo] : ''}${c.grade === 10 ? ' · PDA 10' : ''}`;
          if (r >= 2) { el.classList.add('rare', 'burst'); Sfx.chime(r); msg.textContent = name + '!'; }
          else msg.textContent = c.holo !== 'none' ? name + '!' : last ? name : 'Swipe or tap for the next card';
          if (c.material === 'diamond' || c.grade === 10) bigMoment(c, el, op);
          put(meta, h('span', { class: 'op-n', text: `${i + 1} / ${order.length}` }), matChip(c.material), holoBadge(c.holo));
          el.setAttribute('aria-label', `${describe(c)}. ${last ? (lastPack ? 'Press to see all your cards' : 'Press for the next pack') : 'Press for the next card'}`);
          if (c.holo !== 'none') tilt.start(el);
          ready = true;
        }
        async function next(sign = 1) {
          if (!ready) return; ready = false; tilt.stop();
          const el = rest.shift(); el.inert = true; Sfx.slide();
          el.style.transition = reduced() ? 'opacity .25s' : 'transform .4s cubic-bezier(.4,.1,.7,.7), opacity .4s .05s';
          if (!reduced()) el.style.transform = `translate(${sign * 125}%, -10%) rotate(${sign * 22}deg)`;
          el.style.opacity = 0;
          layout();
          await pause(reduced() ? 250 : 360); el.remove(); if (halted()) return;
          if (!rest.length) return resolve();
          reveal();
        }
        stk.addEventListener('pointerdown', (e) => {
          const el = rest[0]; if (!ready || !el?.contains(e.target)) return;
          drag = { el, x: e.clientX, y: e.clientY, t: performance.now(), w: el.offsetWidth, moved: false }; el.setPointerCapture(e.pointerId); el.style.transition = 'none';
        });
        stk.addEventListener('pointermove', (e) => {
          const el = rest[0]; if (!el) return;
          const b = el.getBoundingClientRect();
          if (drag) {
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 6) drag.moved = true;
            if (drag.moved && !reduced()) el.style.transform = `translate(${dx}px, ${dy * 0.3}px) rotate(${dx * 0.05}deg)`;
          }
          if (drag || e.pointerType === 'mouse') tilt.aim((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
        });
        const up = (e) => {
          if (!drag) return; const d = drag; drag = null;
          if (!d.moved) return; dragged = true;
          const dx = e.clientX - d.x, v = dx / Math.max(1, performance.now() - d.t);
          if (e.type === 'pointerup' && (Math.abs(dx) > d.w * 0.28 || Math.abs(v) > 0.6)) next(Math.sign(dx) || 1);
          else { d.el.style.transition = 'transform .35s cubic-bezier(.3,1.4,.5,1)'; d.el.style.transform = ''; }
        };
        stk.addEventListener('pointerup', up); stk.addEventListener('pointercancel', up);
        stk.addEventListener('click', (e) => { if (dragged) { dragged = false; return; } if (rest[0]?.contains(e.target)) next(1); });
        setTimeout(() => !halted() && reveal(), from && !reduced() ? 420 : 200);
      });
    }

    // a Diamond or a PDA 10: flash, a burst of sparks, then settle
    function bigMoment(c, el, op) {
      const dia = c.material === 'diamond';
      const cv = h('canvas', { class: 'bm-cv' });
      const ov = h('div', { class: 'bigm ' + (dia ? 'dia' : 'g10'), 'aria-hidden': 'true' }, h('i', { class: 'bm-flash' }), h('i', { class: 'bm-glow' }), cv,
        h('b', { class: 'bm-t', text: dia && c.grade === 10 ? 'Diamond · PDA 10' : dia ? 'Diamond!' : 'PDA 10!' }));
      (op.closest('dialog') || op).append(ov); Sfx.boom(); op.classList.add('big'); setTimeout(() => op.classList.remove('big'), 2300);
      if (!reduced()) { sparks(cv, el.getBoundingClientRect(), dia); const q = op.querySelector('.op-area'); q.classList.add('quake'); setTimeout(() => q.classList.remove('quake'), 450); }
      setTimeout(() => ov.classList.add('out'), 1900); setTimeout(() => ov.remove(), 2500);
    }
    function sparks(cv, r, dia) {
      const dpr = Math.min(1.5, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
      const cols = dia ? ['#ffffff', '#d8f0ff', '#9fd8ff', '#c9b6ff', '#ffd27a', '#ff9a3c'] : ['#fff6d6', '#ffd27a', '#ffb347', '#ff7a2e', '#ffffff'];
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2, sp = Math.max(W, H) / 900; // time-based: px per second, seconds of life
      const ps = Array.from({ length: 180 }, (_, i) => { const a = Math.random() * Math.PI * 2, v = (260 + Math.random() * 900) * sp;
        return { x: ox + Math.cos(a) * r.width * 0.3, y: oy + Math.sin(a) * r.height * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 180 * sp, life: 0.7 + Math.random() * 1.1,
          c: cols[i % cols.length], w: 1.5 + Math.random() * 2.5, dot: i % 3 === 0 }; });
      let t0 = 0, prev = 0;
      const tick = (now) => {
        if (!cv.isConnected) return; if (!t0) t0 = prev = now;
        const dt = Math.min(0.05, (now - prev) / 1000), age = (now - t0) / 1000; prev = now;
        g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; let live = 0;
        for (const p of ps) {
          if (age > p.life) continue; live++;
          const k = Math.pow(0.18, dt); p.vx *= k; p.vy = p.vy * k + 520 * sp * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          g.globalAlpha = Math.max(0, 1 - age / p.life); g.strokeStyle = g.fillStyle = p.c; g.lineWidth = p.w;
          if (p.dot) { g.beginPath(); g.arc(p.x, p.y, p.w * 1.3, 0, 7); g.fill(); }
          else { g.beginPath(); g.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); g.lineTo(p.x, p.y); g.stroke(); }
        }
        if (live) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // holo: pointer or device tilt moves a rainbow sheen across the card and tips it a little
    function holoTilt(halted, signal) {
      let s = null;
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') // never prompt for motion access
        addEventListener('deviceorientation', (e) => { if (e.gamma != null) aim(0.5 + Math.max(-0.5, Math.min(0.5, e.gamma / 50)), 0.5 + Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 50))); }, { signal });
      function aim(x, y) { if (!s) return; s.tx = Math.max(0, Math.min(1, x)); s.ty = Math.max(0, Math.min(1, y)); s.last = performance.now(); }
      function stop() { if (!s) return; cancelAnimationFrame(s.raf); s.t.style.transform = ''; s = null; }
      function start(el) {
        stop(); const t = el.querySelector('.sc-tilt');
        s = { t, x: 0.2, y: 0.3, tx: 0.2, ty: 0.3, last: 0, t0: performance.now(), raf: 0 };
        const loop = (now) => {
          if (!s || s.t !== t || halted() || !t.isConnected) return;
          if (now - s.last > 1800 && !reduced()) { const a = (now - s.t0) / 1000; s.tx = 0.5 + Math.sin(a * 1.4 - 1.2) * 0.38; s.ty = 0.5 + Math.cos(a * 0.9) * 0.25; }
          s.x += (s.tx - s.x) * 0.14; s.y += (s.ty - s.y) * 0.14;
          t.style.setProperty('--mx', s.x.toFixed(3)); t.style.setProperty('--my', s.y.toFixed(3));
          if (!reduced()) t.style.transform = `rotateY(${((s.x - 0.5) * 20).toFixed(2)}deg) rotateX(${((0.5 - s.y) * 16).toFixed(2)}deg)`;
          s.raf = requestAnimationFrame(loop);
        };
        s.raf = requestAnimationFrame(loop);
      }
      return { start, stop, aim };
    }

    // the summary: every card pulled, tagged New or Duplicate, then Keep / Grade / Burn
    function summary(series, cards, prior) {
      const seen = new Map(prior), dups = dupInfo();
      const tiles = cards.map((c) => {
        const k = dupKey(c), isNew = !seen.get(k); seen.set(k, (seen.get(k) || 0) + 1);
        const tag = isNew ? h('span', { class: 'new-t', text: 'New' }) : h('span', { class: 'dup-b', text: `Duplicate ×${dups.get(c.id)?.n || seen.get(k)}` });
        return cardTile(c, { tag, onTap: (card) => openDetail(card.id) });
      });
      cards.forEach((c) => { hide.delete(c.id); fresh.add(c.id); });
      const best = [...cards].sort((a, b) => rarity(b) - rarity(a))[0];
      const close = () => { busy = false; stage.hidden = true; stage.classList.remove('opening'); packsEl.hidden = false; put(stage); render(); };
      const go = (name) => { close(); Sheet.close('table'); Stations.open(name); };
      const left = S().sealed[series];
      put(stage, h('div', { class: 'op-sum' },
        h('div', { class: 'op-sum-h' }, h('h3', { text: cards.length > 6 ? `Your ${cards.length} cards` : 'Your pulls' }),
          h('span', { class: 'muted', text: `Best: ${Store.MAT_LABEL[best.material]}${best.holo !== 'none' ? ' · ' + HOLO[best.holo] : ''}` })),
        h('div', { class: 'op-sum-grid' + (cards.length > 6 ? ' many' : '') }, tiles),
        h('div', { class: 'stage-ctrls' }, btn('Keep', 'primary', close), btn('Grade', '', () => go('grade')), btn('Burn', '', () => go('burn')),
          left > 0 && connected() ? btn(`Open another (${left})`, 'gold', () => { busy = false; openPacks(series, 1); }) : null)));
      renderColl(); Store.update(() => {}); // let the shell refresh counts
      stage.querySelector('.op-sum .btn.primary')?.focus({ preventScroll: true });
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
    }

    listen('table', render);
    Sheet.open('table', { title: 'Workbench', body: root, wide: true, onClose: () => unlisten('table') });
    render();
  }

  // card detail: bigger card, all traits, quick actions
  function openDetail(id) {
    const c = byId(id); if (!c) return;
    const traits = [['Character', c.character], ['Category', Store.CHARS[c.character]?.category || '—'], ['Material', Store.MAT_LABEL[c.material]], ['Holo', HOLO[c.holo || 'none']], ['Series', 'Series ' + c.series],
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
        const c = byId(w._id); if (c) { const f = w.querySelector('.cframe'); f.src = Store.cardImg(c); f.style.objectPosition = Store.cardPos(c); }
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
  const dupKey = (c) => c.character + '|' + c.material; // copies = same character and material
  const gradeKey = (c) => c.grade ?? 0; // ungraded burns like a low grade
  const keepOrder = (a, b) => HRANK[b.holo || 'none'] - HRANK[a.holo || 'none'] || gradeKey(b) - gradeKey(a) || (edNum(a) || 1e9) - (edNum(b) || 1e9) || a.serial - b.serial;
  function dupInfo() { // id -> { n, spare }
    const groups = new Map();
    for (const c of S().cards) { const k = dupKey(c); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
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
