/* Omni Forge (demo mode): the station screens. My cards / Open packs (one sheet: the collection, or straight into opening), Case & grade
   (the same wizard that follows every opening: grade picks, case picks, review, one payment), the ash bin
   (burn toward a free pack) and the suggestion box. Demo data only: everything reads and writes window.Store. */
(() => {
  const S = () => Store.state;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const HOLO = { none: 'No holo', frame: 'Holo frame', picture: 'Holo art', full: 'Full holo' };
  const HRANK = { none: 0, frame: 1, picture: 2, full: 3 };
  const GLOW = { paper: '#fff4dc', wood: '#ffc46b', fire: '#ff5a1c', charcoal: '#dcdcf0', diamond: '#9fd8ff' };
  const MAX_BATCH = 20, BURN_GOAL = 42; // FirePsa.maxBatch: cards per case/grade payment
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
  // true rarity, from the real odds (Store.trueOdds): material x holo x PDA grade. rarity() is N in "1 in N", bigger is rarer.
  const rarity = (c) => Store.trueOdds(c).n;
  // tier by odds: Rare (rarer than 1 in 50) gets the tease glow; Epic (1 in 300) the light leak + Share; Legendary (1 in 1,500) the big moment too
  const tierOf = (c) => Store.trueOdds(c).tier;
  const isBig = (t) => t === 'epic' || t === 'legendary';
  const isHolo = (c) => c.material === 'diamond' || (c.holo || 'none') !== 'none';
  const TIER_LABEL = { rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
  const HOLO_NAME = { frame: 'Holo-frame', picture: 'Holo-art', full: 'Full-holo' };
  const cardName = (c) => (c.material === 'diamond' ? 'Diamond' : ((c.holo || 'none') !== 'none' ? HOLO_NAME[c.holo] + ' ' : '') + Store.MAT_LABEL[c.material])
    + (c.grade != null ? ' · PDA ' + c.grade : ''); // "Full-holo Paper", "Diamond · PDA 10"
  const floorTxt = (c) => Store.eth(Store.floor(c));
  // light-leak colours per material: [hot core, glow]
  const LEAK = { paper: ['#fff6dc', '#ffd98a'], wood: ['#ffd9a0', '#ff9f2e'], fire: ['#ffd27a', '#ff5a12'], charcoal: ['#ffb08a', '#e0260c'], diamond: ['#ffffff', '#bfe6ff'] };
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
      // the light leak: a rising shimmer (three glides) under a crackle that gets denser and louder, d seconds long
      leak(m, d, leg) { if (!ac()) return; const t = ctx.currentTime, f = { paper: 520, wood: 330, fire: 262, charcoal: 196, diamond: 660 }[m] || 400;
        [1, 1.5, 2.01].forEach((k, i) => tone(t, f * k, { type: i ? 'sine' : 'triangle', peak: (leg ? 0.06 : 0.04) / (i + 1), a: d, dec: 0.16, to: f * k * (leg ? 2.6 : 2) }));
        const n = leg ? 30 : 16; for (let i = 0; i < n; i++) { const u = Math.sqrt(i / n);
          hiss(t + u * d, { f: 2200 + Math.random() * 4500, q: 2.2, peak: 0.025 + u * (leg ? 0.15 : 0.1), dec: 0.01 + Math.random() * 0.02 }); } },
      // a holo turning over: a soft rising shimmer (a quick run of glassy notes over a breath of air), well under the Epic chime
      shimmer() { if (!ac()) return; const t = ctx.currentTime;
        [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => { tone(t + i * 0.06, f, { peak: 0.045 - i * 0.005, a: 0.015, dec: 0.9 }); tone(t + i * 0.06, f * 1.5, { peak: 0.012, dec: 0.5 }); });
        hiss(t, { type: 'highpass', f: 5200, q: 0.5, peak: 0.035, a: 0.2, dec: 0.45 }); },
      pop(leg) { if (!ac()) return; const t = ctx.currentTime; hiss(t, { type: 'highpass', f: 2400, q: 0.6, peak: leg ? 0.24 : 0.16, a: 0.006, dec: leg ? 0.5 : 0.3 });
        tone(t, leg ? 1760 : 1318.5, { peak: 0.05, dec: 0.9 }); },
    };
  })();

  // ---------- the card: the finished card image (name, material, category, Series and PDA seal are printed on it)
  function cardFace(c) {
    const holo = c.holo || 'none';
    return h('div', { class: `cface m-${c.material} h-${holo} hd-${Store.holder(c)}${c.grade === 10 ? ' g10' : ''}` },
      h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: `${c.character}, ${Store.MAT_LABEL[c.material]} card`, draggable: 'false' }),
      holo !== 'none' ? h('i', { class: 'shine', 'aria-hidden': 'true' }) : null);
  }
  // the badge under a card: its grade once slabbed, else Cased, else Raw (with the fresh-day clock while it runs)
  const gradeBadge = (c) => {
    if (c.pending) return h('span', { class: 'pda wait', text: 'Grading' });
    if (c.grade != null) return h('span', { class: 'pda g' + c.grade, text: 'PDA ' + c.grade });
    if (c.cased) return h('span', { class: 'pda cased', text: 'Cased' });
    const f = Wear.freshLeft(c);
    return f ? h('span', { class: 'pda fresh', title: 'Fresh: no wear yet', text: 'Fresh ' + Wear.hhmm(f) }) : h('span', { class: 'pda none', text: 'Raw' });
  };
  const HOLDER = { raw: 'Raw', case: 'Cased', slab: 'Slabbed' };
  const matChip = (m) => h('span', { class: 'mat ' + m, text: Store.MAT_LABEL[m] });
  const holoBadge = (holo) => holo && holo !== 'none' ? h('span', { class: 'holo-b', text: HOLO[holo] }) : null;
  const describe = (c) => `${c.character}, ${Store.MAT_LABEL[c.material]}${c.holo !== 'none' ? ', ' + HOLO[c.holo] : ''}, ${c.pending ? 'being graded' : c.grade == null ? (c.cased ? 'cased, not graded' : 'raw, not graded') : 'slabbed, PDA ' + c.grade}, ${Store.trueOdds(c).label}, Series ${c.series}, ${c.edition}`;

  // a tile used by the collection and by every picker
  function cardTile(c, { selectable = false, selected = false, isNew = false, onTap, tag } = {}) {
    const b = h('button', { type: 'button', class: 'ctile' + (selectable ? ' pick' : ''), 'data-id': c.id, 'aria-label': describe(c), onclick: () => onTap?.(c, b) },
      h('div', { class: 'cwrap' }, cardFace(c), gradeBadge(c), isNew ? h('span', { class: 'new-b', text: 'New' }) : null,
        selectable ? h('span', { class: 'tick', 'aria-hidden': 'true' }) : null),
      h('div', { class: 'cmeta' }, tag || null, matChip(c.material), holoBadge(c.holo), h('span', { class: 'ser', text: `Series ${c.series}` }),
        h('span', { class: 'flr', title: 'Floor for this exact card type (demo number)', text: floorTxt(c) })));
    if (tag) b.setAttribute('aria-label', describe(c) + '. ' + tag.textContent);
    if (selectable) b.setAttribute('aria-pressed', String(selected));
    return b;
  }

  // ---------- share your pull: a 1080 x 1350 PNG of the card, its odds and the wordmark, then the share sheet (or a download)
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const holoLabel = (c) => { const hl = c.material === 'diamond' && (c.holo || 'none') === 'none' ? 'full' : c.holo || 'none'; return hl === 'none' ? '' : HOLO[hl]; };
  const pullLine = (c) => Store.trueOdds(c).label; // includes the grade when graded
  const kindLine = (c) => [Store.MAT_LABEL[c.material], holoLabel(c), c.grade != null ? 'PDA ' + c.grade : ''].filter(Boolean).join(' · ');
  async function shareImage(c) {
    const W = 1080, H = 1350, [core, glow] = LEAK[c.material], tier = tierOf(c);
    await Promise.all(['400 64px "Russo One"', '800 36px Nunito', '600 30px Nunito'].map((f) => document.fonts.load(f).catch(() => {})));
    await document.fonts.ready;
    const [strip, word] = await Promise.all([loadImg(Store.cardImg(c)), loadImg('ui/omni-wordmark.webp').catch(() => null)]);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    // the forge: warm planks, an ember glow behind the card, dark edges
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3b2614'); gr.addColorStop(0.55, '#22150b'); gr.addColorStop(1, '#0d0805');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = 88; x < W; x += 180) g.fillRect(x, 0, 3, H);
    gr = g.createRadialGradient(W / 2, 470, 40, W / 2, 470, 640); gr.addColorStop(0, tier ? glow + 'aa' : 'rgba(255,150,60,.42)'); gr.addColorStop(0.45, 'rgba(255,120,40,.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.6)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // the card: its slice of the strip (raw, cased, then slabbed PDA 1-10)
    const sw = strip.naturalWidth / Store.STATES, sh = strip.naturalHeight, ch = 760, cw = Math.round(ch * sw / sh), cx = (W - cw) / 2, cy = 92;
    g.save(); g.shadowColor = tier ? glow : 'rgba(0,0,0,.8)'; g.shadowBlur = tier ? 70 : 40; g.shadowOffsetY = tier ? 0 : 14;
    g.drawImage(strip, Store.stateIdx(c) * sw, 0, sw, sh, cx, cy, cw, ch); g.restore();
    g.drawImage(strip, Store.stateIdx(c) * sw, 0, sw, sh, cx, cy, cw, ch); // once more, crisp over its own glow
    // text
    const fit = (txt, font, px, max) => { let s = px; do g.font = font.replace('{}', s + 'px'); while (g.measureText(txt).width > max && (s -= 2) > 20); };
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    fit(c.character, '400 {} "Russo One", sans-serif', 66, W - 120); g.fillStyle = '#f6e8cf'; g.shadowColor = '#000'; g.shadowBlur = 0; g.shadowOffsetY = 4;
    g.fillText(c.character, W / 2, 940); g.shadowOffsetY = 0;
    const kind = kindLine(c);
    fit(kind, '800 {} Nunito, sans-serif', 38, W - 160); g.fillStyle = core; g.shadowColor = glow; g.shadowBlur = 18; g.fillText(kind, W / 2, 1000); g.shadowBlur = 0;
    const odds = pullLine(c);
    if (odds) { fit(odds, '400 {} "Russo One", sans-serif', 76, W - 120); g.fillStyle = '#ffd27a'; g.shadowColor = 'rgba(255,170,60,.7)'; g.shadowBlur = 24; g.fillText(odds, W / 2, 1102); g.shadowBlur = 0; }
    g.font = '600 30px Nunito, sans-serif'; g.fillStyle = '#b9a385'; g.fillText(`${c.grade >= 5 ? 'Odds incl. grade' : 'Pull odds'} · Series ${c.series}`, W / 2, 1152);
    // the wordmark, small: the Omni mark + FORGE, like the top bar
    g.font = '400 40px "Russo One", sans-serif'; const fw = g.measureText('FORGE').width, wh = 46, ww = word ? wh * word.naturalWidth / word.naturalHeight : 0, gap = word ? 12 : 0;
    const x0 = (W - ww - gap - fw) / 2, by = 1262;
    if (word) g.drawImage(word, x0, by - wh + 6, ww, wh);
    g.textAlign = 'left'; g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#0d141c'; g.strokeText('FORGE', x0 + ww + gap, by); g.fillStyle = '#f9e2b4'; g.fillText('FORGE', x0 + ww + gap, by);
    return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/png'));
  }
  async function shareCard(c, from) {
    if (from) { if (from.getAttribute('aria-busy') === 'true') return; from.setAttribute('aria-busy', 'true'); }
    try {
      const blob = await shareImage(c), slug = c.character.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const name = `omni-forge-${slug}.png`, file = new File([blob], name, { type: 'image/png' });
      const kind = kindLine(c), odds = pullLine(c);
      const title = `${c.character}, ${kind}`, text = `I pulled ${c.character} (${kind}${odds ? ', ' + odds : ''}) at the Omni Forge.`;
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title, text }); } catch (e) { if (e?.name !== 'AbortError') toast('Couldn’t share it', 'bad'); }
        return;
      }
      const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name, hidden: true });
      (from?.closest('dialog') || document.body).append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Saved', 'good');
    } catch { toast('Couldn’t make the image', 'bad'); } finally { from?.removeAttribute('aria-busy'); }
  }
  const shareBtn = (c, cls = '') => { const b = btn('Share', 'share-b ' + cls, () => shareCard(c, b), { 'aria-label': `Share your ${c.character}, ${[Store.MAT_LABEL[c.material], holoLabel(c)].filter(Boolean).join(' ')}` }); return b; };

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
        : ((q) => { const f = Math.random() < q, pi = Math.random() < q; return f && pi ? 'full' : f ? 'frame' : pi ? 'picture' : 'none'; })(1 - Math.sqrt(1 - holoP)); // frame and art each roll, like the contract
      const of = { paper: 80, wood: 48, fire: 24, charcoal: 8, diamond: 3 }[m] + Math.floor(Math.random() * 12);
      return { id: ++id, serial: ++serial, series, character: pool[Math.floor(Math.random() * pool.length)], material: m, holo,
        edition: `${1 + Math.floor(Math.random() * of)} of ${of}`, grade: null, pending: false, dealt: Date.now(), cased: false, frozenAge: 0, moves: 0 };
    });
  }
  // fresh PDA odds in percent (FirePsa defaults): grades 5-10 only. Grades 1-4 come only from long raw holds (wear.js).
  const GRADE_ODDS = [10, 9, 8, 7, 6, 5].map((g) => [g, Wear.FRESH[g - 1] / 100]);
  // demo data: graded cards were graded at some age (their grade drawn on the wear model at that age); one PDA 10 so the demo shows the gold edge
  (() => {
    let seed = 1607; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const graded = S().cards.filter((c) => c.grade != null);
    graded.forEach((c, i) => { c.frozenAge = Math.round((i % 4 ? R() * 20 : 60 + R() * 900) * Store.DAY); c.grade = Wear.draw(c.frozenAge / 1000, c.moves, R); });
    const show10 = graded.find((c) => c.material === 'wood') || graded[0];
    if (show10) { show10.grade = 10; show10.frozenAge = 3600e3; }
  })();

  // =====================================================================================
  // 1. My cards (sealed packs + the collection) and Open packs (the opening table)
  // =====================================================================================
  const filt = { series: 'all', hold: 'all', mat: 'all', holo: 'any', grade: 'all', sort: 'serial' };
  // sealed packs that can be opened now (the live Series opens when it sells out), oldest Series first
  function openable() {
    const s = S();
    return Object.keys(s.sealed).map(Number).filter((no) => s.sealed[no] > 0 && !(no === s.series.no && s.series.phase < 4))
      .sort((a, b) => a - b).map((no) => ({ series: no, n: s.sealed[no] }));
  }
  const openableCount = () => openable().reduce((a, o) => a + o.n, 0);
  // one sheet, two jobs: view 'cards' = My cards (sealed packs + the whole collection); view 'open' = straight into tearing the next pack
  function openTable(opts = {}) {
    let view = opts.view === 'open' ? 'open' : 'cards';
    if (view === 'open' && !openable().length) { toast('No packs to open', 'bad'); return; }
    const packsEl = h('section', { class: 'packs', 'aria-labelledby': 'packs-h' });
    const stage = h('section', { class: 'stage', hidden: true, 'aria-label': 'Opening' });
    const coll = h('section', { class: 'coll', 'aria-labelledby': 'coll-h' });
    const root = h('div', { class: 'st st-table' }, packsEl, stage, coll);
    const hide = new Set(); const fresh = new Set(); let busy = false;
    const TITLE = { cards: 'My cards', open: 'Open packs' };
    function setView(v) {
      view = v; packsEl.hidden = v === 'open' || !stage.hidden; coll.hidden = v === 'open';
      const t = root.closest('dialog')?.querySelector('.sheet-head h2'); if (t) t.textContent = TITLE[v];
    }

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
          h('div', { class: 'pimg' }, h('img', { src: 'a/pack.webp', alt: `Series ${no} pack`, width: 240, height: 336 }),
            live ? h('img', { class: 'padlock', src: 'a/s-padlock.webp', alt: 'Locked' }) : null,
            n > 0 ? h('span', { class: 'pcount', text: '×' + n }) : null),
          h('div', { class: 'pinfo' }, h('h4', { text: `Series ${no}` }), h('p', { class: 'muted', text: n ? `${n} sealed` : 'None sealed' }), act));
      });
      put(packsEl, h('h3', { id: 'packs-h', text: 'Your packs' }), h('div', { class: 'ptiles' }, tiles));
    }

    function renderColl() {
      const s = S(); const all = s.cards.filter((c) => !hide.has(c.id));
      const seriesList = [...new Set(all.map((c) => c.series))].sort((a, b) => b - a);
      let list = all.filter((c) => (filt.series === 'all' || c.series === +filt.series) && (filt.mat === 'all' || c.material === filt.mat)
        && (filt.hold === 'all' || Store.holder(c) === filt.hold)
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
      const counts = { raw: 0, case: 0, slab: 0 }; all.forEach((c) => counts[Store.holder(c)]++);
      const holdSeg = h('div', { class: 'seg hold-seg', role: 'group', 'aria-label': 'Show' },
        [['all', 'All', all.length], ['raw', 'Raw', counts.raw], ['case', 'Cased', counts.case], ['slab', 'Slabbed', counts.slab]].map(([v, t, n]) =>
          h('button', { type: 'button', 'aria-pressed': String(filt.hold === v), onclick: () => { filt.hold = v; renderColl(); coll.querySelector(`.hold-seg [data-v=${v}]`)?.focus(); }, 'data-v': v }, t, h('small', { text: ' ' + n }))));
      const filters = h('div', { class: 'filters' },
        sel('series', 'Series', [['all', 'All'], ...seriesList.map((n) => [n, 'Series ' + n])]),
        sel('mat', 'Material', [['all', 'All'], ...Store.MATS.map((m) => [m, Store.MAT_LABEL[m]])]),
        sel('holo', 'Holo', [['any', 'Any'], ['none', 'None'], ['frame', 'Frame'], ['picture', 'Art'], ['full', 'Full']]),
        sel('grade', 'Grade', [['all', 'All'], ['none', 'Not graded'], ['10', 'PDA 10'], ['9-8', 'PDA 9–8'], ['7-6', 'PDA 7–6'], ['5-4', 'PDA 5–4'], ['3-2', 'PDA 3–2'], ['1', 'PDA 1']]),
        sel('sort', 'Sort', [['serial', 'Newest'], ['rarity', 'Rarity'], ['grade', 'Grade'], ['edition', 'Edition']]));
      const grid = list.length ? h('div', { class: 'cgrid' }, list.map((c) => cardTile(c, { isNew: fresh.has(c.id), onTap: (card) => openDetail(card.id) })))
        : h('div', { class: 'empty-state' }, h('p', { text: all.length ? 'No cards match.' : 'No cards yet. Open a pack!' }),
          all.length ? btn('Clear filters', 'small', () => { Object.assign(filt, { series: 'all', hold: 'all', mat: 'all', holo: 'any', grade: 'all' }); renderColl(); }) : null);
      put(coll, h('div', { class: 'coll-h' }, h('h3', { id: 'coll-h', text: 'Your cards' }), h('span', { class: 'muted', text: list.length === all.length ? `${all.length} cards` : `${list.length} of ${all.length}` }),
        h('span', { class: 'cfloor', title: 'Collection floor on OpenSea (demo number)' }, h('small', { text: 'Collection floor (demo)' }), h('b', { text: Store.eth(Store.collectionFloor()) }))), holdSeg, filters, grid);
    }
    const render = () => { renderPacks(); renderColl(); };

    // ---------- opening: rip the pack, one card at a time (rarest last), then a summary of everything pulled
    async function openPacks(series, n) {
      if (busy) return; busy = true;
      const prior = new Map(); S().cards.forEach((c) => { const k = dupKey(c); prior.set(k, (prior.get(k) || 0) + 1); });
      const packs = []; for (let i = 0; i < n; i++) packs.push(makePack(series));
      // test hook: window.__forcePull = [{ material: 'diamond', holo: 'full' }, ...] sets the first pack's last cards, once
      if (Array.isArray(window.__forcePull)) { window.__forcePull.forEach((o, k) => packs[0][5 - k] && Object.assign(packs[0][5 - k], o)); delete window.__forcePull; }
      let id = Math.max(999, ...S().cards.map((c) => c.id)), serial = Math.max(0, ...S().cards.map((c) => c.serial));
      packs.flat().forEach((c) => { c.id = ++id; c.serial = ++serial; }); // makePack numbers each pack from the same start
      packs.forEach((p) => p.sort((a, b) => rarity(a) - rarity(b))); // rarest last, by true odds (material x holo x grade)
      const cards = packs.flat(); cards.forEach((c) => hide.add(c.id));
      Store.update((s) => { s.sealed[series] -= n; s.cards.push(...cards); Store.log(`Opened ${n === 1 ? 'a' : n} Series ${series} pack${n > 1 ? 's' : ''}`); });
      packsEl.hidden = true; stage.hidden = false; if (view === 'open') coll.hidden = true;
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
        await race(runStack({ order: packs[p], from, area, msg, meta, op, ctrls, halted, pause, tilt, lastPack: p === n - 1 }));
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
          if (reduced()) torn.style.opacity = 0; // reduced motion: the torn piece doesn't lift away, it's simply gone, so the cards show inside
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
    function runStack({ order, from, area, msg, meta, op, ctrls, halted, pause, tilt, lastPack }) {
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
        const rest = [...els]; let ready = false, drag = null, dragged = false, arm = null;
        const layout = () => rest.forEach((el, k) => { el.style.zIndex = 50 - k; el.style.transform = k ? `translate(${Math.min(k, 4) * 3}px, ${Math.min(k, 4) * 4}px)` : ''; });
        layout();
        if (from && !reduced()) {
          const r = stk.getBoundingClientRect(), s = from.width / r.width;
          stk.animate([{ transform: `translate(${from.left + from.width / 2 - (r.left + r.width / 2)}px, ${from.top + from.height / 2 - (r.top + r.height / 2)}px) scale(${s})` }, { transform: 'none' }],
            { duration: 560, easing: 'cubic-bezier(.2,.8,.3,1)' });
        } else stk.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });

        async function reveal() {
          const el = rest[0], c = el._c, i = order.length - rest.length, last = rest.length === 1, tier = tierOf(c), big = isBig(tier), rm = reduced();
          el.inert = false; el.setAttribute('aria-label', `Card ${i + 1} of ${order.length}, face down`); el.focus({ preventScroll: true });
          put(meta, h('span', { class: 'op-n', text: `${i + 1} / ${order.length}` }));
          const ho = isHolo(c), turn = ho ? holoArm(el) : null; // a holo shows its foil edge as soon as it's on top
          await pause(i === 0 ? 600 : 160); if (halted()) return;
          if (ho) { // ...and waits for you: drag it (the edge brightens the further it goes) or tap to turn it
            msg.textContent = 'Something’s shimmering…'; el.setAttribute('aria-label', `Card ${i + 1} of ${order.length}, face down and shimmering. Press to turn it over`);
            await turn; if (halted()) return;
            if (tier) el.classList.add('ho-yield'); // Rare and up: the holo edge hands over to the tier's own glow
          }
          if (tier) { // Rare and up (by true odds): the back glows in its material before it turns (a short tease leads into the leak)
            msg.textContent = 'Something’s glowing…';
            el.classList.add('tease', 't-' + c.material); Sfx.tease(c.material);
            await pause(big ? 520 : { fire: 850, charcoal: 1000, diamond: 1200 }[c.material] || 800); if (halted()) return;
            if (!big) el.classList.remove('tease');
          } else if (last) msg.textContent = 'Last card…';
          const slow = big && !rm;
          if (big) { await leak(el, c, tier === 'legendary', msg, pause); if (halted()) return; }
          el.classList.toggle('slow', slow); el.classList.toggle('hslow', ho && !tier && !rm); el.classList.add('flipped'); Sfx.flip();
          if (big) { el.classList.remove('tease'); el._lk?.(); }
          if ((big || ho) && rm) el.querySelector('.face.front').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
          if (ho) holoLand(el, !tier, slow, rm);
          const name = cardName(c);
          if (isHolo(c)) el.classList.add('holo-glow'); // every holo card, any material, glows on reveal
          if (tier) { el.classList.add('rare', 'burst'); Sfx.chime(tier === 'legendary' ? 4 : big ? 3 : 2); msg.textContent = name + '!'; }
          else msg.textContent = isHolo(c) ? name + '!' : last ? name : 'Swipe or tap for the next card';
          const od = Store.trueOdds(c);
          put(meta, h('span', { class: 'op-n', text: `${i + 1} / ${order.length}` }), matChip(c.material), holoBadge(c.holo),
            tier ? h('span', { class: 'tier-b ' + tier, text: TIER_LABEL[tier] }) : null, h('span', { class: 'op-odds', text: od.label }));
          el.setAttribute('aria-label', `${describe(c)}. ${last ? (lastPack ? 'Press to see all your cards' : 'Press for the next pack') : 'Press for the next card'}`);
          if (tier === 'legendary') { await pause(slow ? 700 : 0); if (halted()) return; bigMoment(c, el, op); }
          if (c.holo !== 'none') tilt.start(el);
          ready = true;
          if (big) { // once the moment settles: Share
            await pause(tier === 'legendary' ? 2300 : slow ? 1000 : 300); if (halted() || rest[0] !== el) return;
            ctrls.querySelector('.share-b')?.remove(); ctrls.prepend(shareBtn(c, 'gold'));
          }
        }
        // the holo edge: a prismatic foil ring on the back and a rainbow halo; --hp (0..1) is how close it is to turning.
        // Resolves when it should turn: dragged past the swipe threshold, or tapped / Enter (then it ramps up over 0.6 s)
        function holoArm(el) {
          el.querySelector('.back2').append(h('i', { class: 'ho-ring', 'aria-hidden': 'true' })); el.prepend(h('i', { class: 'ho-halo', 'aria-hidden': 'true' }));
          el.classList.add('ho'); const set = (p) => el.style.setProperty('--hp', p.toFixed(3)); set(0);
          return new Promise((res) => {
            arm = { el, set, go(now) {
              arm = null; if (now) { set(1); return res(); }
              const p0 = parseFloat(el.style.getPropertyValue('--hp')) || 0, t0 = performance.now(); el.style.transition = 'none';
              const step = (t) => { const u = Math.max(0, Math.min(1, (t - t0) / 600)); set(p0 + (1 - p0) * u * (2 - u)); if (u < 1 && !halted() && el.isConnected) requestAnimationFrame(step); else res(); };
              requestAnimationFrame(step);
            } };
          });
        }
        // the holo lands: the halo fades as it turns, a prismatic sweep crosses the face; a plain holo (no tier) also
        // gets a few sparkles round the edge and a shimmer chime. Reduced motion: none of that, the face fades in.
        function holoLand(el, plain, slow, rm) {
          const halo = el.querySelector('.ho-halo');
          halo?.animate([{ opacity: getComputedStyle(halo).opacity }, { opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' }).finished.then(() => halo.remove(), () => {});
          const at = slow ? 720 : plain ? 380 : 300;
          if (plain) setTimeout(() => el.isConnected && Sfx.shimmer(), at);
          if (rm) return;
          const sw = h('i', { class: 'ho-sweep', 'aria-hidden': 'true' }); el.querySelector('.face.front').append(sw);
          sw.animate([{ opacity: 1, backgroundPosition: '100% 0' }, { opacity: 1, backgroundPosition: '0% 0' }], { duration: plain ? 800 : 650, delay: at, easing: 'cubic-bezier(.4,.1,.4,1)', fill: 'both' })
            .finished.then(() => sw.remove(), () => sw.remove());
          if (!plain) return;
          const COLS = ['#ff8ae0', '#ffe98a', '#8affd0', '#8ad8ff', '#c48aff', '#ffffff'];
          const spk = Array.from({ length: 9 }, (_, k) => { const u = (k + Math.random() * 0.6) / 9 * 4, side = Math.floor(u), f = (u % 1) * 100, o = -3 + Math.random() * 6;
            const [x, y] = side === 0 ? [f, o] : side === 1 ? [100 - o, f] : side === 2 ? [100 - f, 100 - o] : [o, 100 - f]; // round the edge, clockwise
            return h('i', { class: 'ho-spk', 'aria-hidden': 'true', style: `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${(12 + Math.random() * 14).toFixed(0)}px;--c:${COLS[k % COLS.length]};--d:${(at + 40 + Math.random() * 380).toFixed(0)}ms` }); });
          el.append(...spk); setTimeout(() => spk.forEach((x) => x.remove()), at + 1400);
        }
        async function next(sign = 1) {
          if (!ready) return; ready = false; tilt.stop();
          const el = rest.shift(); el.inert = true; Sfx.slide(); ctrls.querySelector('.share-b')?.remove();
          el.style.transition = reduced() ? 'opacity .25s' : 'transform .4s cubic-bezier(.4,.1,.7,.7), opacity .4s .05s';
          if (!reduced()) el.style.transform = `translate(${sign * 125}%, -10%) rotate(${sign * 22}deg)`;
          el.style.opacity = 0;
          layout();
          await pause(reduced() ? 250 : 360); el.remove(); if (halted()) return;
          if (!rest.length) return resolve();
          reveal();
        }
        stk.addEventListener('pointerdown', (e) => {
          const el = rest[0]; if (!(ready || arm) || !el?.contains(e.target)) return;
          drag = { el, x: e.clientX, y: e.clientY, t: performance.now(), w: el.offsetWidth, moved: false }; el.setPointerCapture(e.pointerId); el.style.transition = 'none';
        });
        stk.addEventListener('pointermove', (e) => {
          const el = rest[0]; if (!el) return;
          const b = el.getBoundingClientRect();
          if (drag) {
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 6) drag.moved = true;
            const k = arm ? 0.6 : 1; // face down, it drags a little stiffer: you're turning it, not throwing it
            if (drag.moved && !reduced()) el.style.transform = `translate(${dx * k}px, ${dy * 0.3 * k}px) rotate(${dx * 0.05 * k}deg)`;
            if (arm && drag.moved) arm.set(Math.min(1, Math.abs(dx) / (drag.w * 0.28)));
          }
          if (drag || e.pointerType === 'mouse') tilt.aim((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
        });
        const up = (e) => {
          if (!drag) return; const d = drag; drag = null;
          if (!d.moved) return; dragged = true;
          const dx = e.clientX - d.x, v = dx / Math.max(1, performance.now() - d.t), far = e.type === 'pointerup' && (Math.abs(dx) > d.w * 0.28 || Math.abs(v) > 0.6);
          if (arm) { d.el.style.transition = 'transform .35s cubic-bezier(.3,1.4,.5,1), --hp .35s ease-out'; d.el.style.transform = ''; return far ? arm.go(true) : arm.set(0); } // a holo face down springs back, and turns if it went far enough
          if (far) next(Math.sign(dx) || 1);
          else { d.el.style.transition = 'transform .35s cubic-bezier(.3,1.4,.5,1)'; d.el.style.transform = ''; }
        };
        stk.addEventListener('pointerup', up); stk.addEventListener('pointercancel', up);
        stk.addEventListener('click', (e) => { if (dragged) { dragged = false; return; } if (!rest[0]?.contains(e.target)) return; if (arm) arm.go(); else next(1); });
        setTimeout(() => !halted() && reveal(), from && !reduced() ? 420 : 200);
      });
    }

    // the light leak (Epic and Legendary): the card hesitates, light cracks out of its edges and through jagged seams across
    // the back, brighter and brighter, then it bursts open. Reduced motion: a short static glow, then the card fades in.
    async function leak(el, c, leg, msg, pause) {
      const [core, glow] = LEAK[c.material], dur = leg ? 1100 : 600, rm = reduced(), back = el.querySelector('.back2');
      el.style.setProperty('--lk', glow); el.style.setProperty('--lkc', core);
      const halo = h('i', { class: 'lk-halo', 'aria-hidden': 'true' }), edge = h('i', { class: 'lk-edge', 'aria-hidden': 'true' });
      el.prepend(halo); back.append(edge); el.classList.add('leak', leg ? 'lk-leg' : 'lk-epic');
      msg.textContent = leg ? 'Light’s pouring out…' : 'Something’s breaking through…';
      Sfx.leak(c.material, dur / 1000, leg);
      const anims = [];
      el._lk = () => { // on the flip: the back turns away, the halo fades
        anims.forEach((a) => a.cancel()); el.classList.remove('leak');
        halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: rm ? 300 : 1000, easing: 'ease-out', fill: 'forwards' }).finished.then(() => halo.remove(), () => {});
      };
      if (rm) { await pause(leg ? 650 : 420); return; }
      const sv = seams(leg ? 6 : 4, c.material); back.append(sv);
      const flick = (n, lo, hi) => Array.from({ length: n + 1 }, (_, k) => { const u = k / n; return { opacity: u === 1 ? 1 : Math.min(1, lo + (hi - lo) * u * u + (k % 2 ? 0.12 : -0.08) * u) }; });
      const T = { duration: dur, easing: 'linear', fill: 'forwards' };
      anims.push(halo.animate(flick(leg ? 14 : 8, 0.05, 1), T), edge.animate(flick(leg ? 12 : 7, 0.1, 1), T),
        back.querySelector('img').animate([{ filter: 'brightness(1)' }, { filter: `brightness(${leg ? 0.38 : 0.5}) saturate(.7)`, offset: 0.35 }, { filter: `brightness(${leg ? 0.3 : 0.42}) saturate(.6)` }], T),
        halo.animate([{ transform: 'scale(.97)' }, { transform: `scale(${leg ? 1.05 : 1.02})` }], { ...T, easing: 'ease-in' }));
      sv.querySelectorAll('path').forEach((pa, k) => { // each crack runs across the back, the later ones start later
        const d0 = (pa.dataset.d || 0) * dur * 0.45;
        anims.push(pa.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: Math.max(140, dur * 0.7 - d0 * 0.5), delay: d0, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'both' }));
      });
      anims.push(sv.animate(flick(leg ? 16 : 9, 0.35, 1), T));
      const shake = leg ? [0, -1.2, 1.4, -1.8, 2.2, -2.4, 2.8, -2.6, 3, -1.5, 0] : [0, -0.8, 1, -1.2, 1.2, -0.6, 0];
      anims.push(el.querySelector('.sc-tilt').animate(shake.map((a, k) => ({ transform: `translate(${(k % 2 ? 1 : -1) * Math.abs(a) * 0.6}px, 0) rotate(${a * 0.5}deg) scale(${1 + (k / shake.length) * (leg ? 0.045 : 0.025)})` })),
        { duration: dur, easing: 'ease-in' }));
      await pause(dur);
      Sfx.pop(leg);
      const fl = h('i', { class: 'lk-flash', 'aria-hidden': 'true' }); el.append(fl);
      fl.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(.95)', offset: 0.25 }, { opacity: 0, transform: `scale(${leg ? 1.6 : 1.3})` }],
        { duration: leg ? 700 : 520, easing: 'ease-out' }).finished.then(() => fl.remove(), () => fl.remove());
    }
    // jagged seams: a few cracks from the edges across the back (viewBox 100 x 140 is the card's shape, so strokes stay even)
    function seams(n, m) {
      const NS = 'http://www.w3.org/2000/svg', sv = document.createElementNS(NS, 'svg'), id = 'lkg' + Math.random().toString(36).slice(2, 8);
      sv.setAttribute('viewBox', '0 0 100 140'); sv.setAttribute('preserveAspectRatio', 'none'); sv.setAttribute('class', 'lk-seams'); sv.setAttribute('aria-hidden', 'true');
      if (m === 'diamond') sv.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${['#ff8ae0', '#ffe98a', '#8affd0', '#8ad8ff', '#c48aff', '#ffffff'].map((col, k) => `<stop offset="${k / 5}" stop-color="${col}"/>`).join('')}</linearGradient></defs>`;
      const crack = (x, y, a, len, seg) => { const pts = [[x, y]]; let left = len;
        while (left > 0) { a += (Math.random() - 0.5) * 1.3; const s = seg * (0.6 + Math.random() * 0.8);
          x = Math.max(1.5, Math.min(98.5, x + Math.cos(a) * s)); y = Math.max(1.5, Math.min(138.5, y + Math.sin(a) * s)); pts.push([x, y]); left -= s; // stays on the card
          a += (Math.atan2(70 - y, 50 - x) - a) * 0.18; } // drift toward the middle
        return pts; };
      const d = (pts) => 'M' + pts.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L');
      const add = (pts, k) => ['g', 'c'].forEach((cl) => { const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', d(pts)); pa.setAttribute('class', cl); pa.setAttribute('pathLength', '1');
        if (cl === 'g' && m === 'diamond') pa.setAttribute('stroke', `url(#${id})`); pa.dataset.d = k; sv.append(pa); });
      for (let k = 0; k < n; k++) {
        const side = k % 4, u = 0.15 + Math.random() * 0.7; // from each edge in turn, aimed inward
        const [x, y, a] = side === 0 ? [u * 100, 0, Math.PI / 2] : side === 1 ? [100, u * 140, Math.PI] : side === 2 ? [u * 100, 140, -Math.PI / 2] : [0, u * 140, 0];
        const pts = crack(x, y, a + (Math.random() - 0.5) * 0.9, 36 + Math.random() * 40, 6); add(pts, k / n);
        if (Math.random() < 0.7) { const j = 2 + Math.floor(Math.random() * (pts.length - 3)), [bx, by] = pts[Math.max(1, j)]; add(crack(bx, by, a + (Math.random() < 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.6), 12 + Math.random() * 16, 4), k / n + 0.25); }
      }
      return sv;
    }

    // a Legendary card (rarer than 1 in 1,500: any Diamond, full-holo Paper, rare grades): flash, a burst of sparks, then settle.
    // The title names the card: "Full-holo Paper!", "Diamond!", "PDA 10!" (a plain card that's only Legendary for its grade)
    const BM_SPARKS = { dia: ['#ffffff', '#d8f0ff', '#9fd8ff', '#c9b6ff', '#ffd27a', '#ff9a3c'], g10: ['#fff6d6', '#ffd27a', '#ffb347', '#ff7a2e', '#ffffff'],
      charcoal: ['#fff2e0', '#ffb070', '#ff6a2a', '#ff3a1a', '#ffd27a'], paper: ['#ffffff', '#fff4d6', '#ffe7a8', '#ffd27a', '#f6e8cf'],
      wood: ['#fff0d0', '#ffd08a', '#ffb050', '#ff9f2e', '#ffffff'], fire: ['#fff2c0', '#ffd27a', '#ff9a3c', '#ff5a12', '#ffffff'] };
    function bigMoment(c, el, op) {
      const dia = c.material === 'diamond', plain = !isHolo(c);
      const kind = dia ? 'dia' : plain && c.grade === 10 ? 'g10' : c.material;
      const title = plain && c.grade != null ? `PDA ${c.grade}!` : c.grade != null ? cardName(c) : cardName(c) + '!';
      const cv = h('canvas', { class: 'bm-cv' });
      const ov = h('div', { class: 'bigm ' + (dia || kind === 'g10' ? kind : 'fh fh-' + kind), 'aria-hidden': 'true' }, h('i', { class: 'bm-flash' }), h('i', { class: 'bm-glow' }), cv,
        h('b', { class: 'bm-t', text: title }));
      (op.closest('dialog') || op).append(ov); Sfx.boom(); op.classList.add('big'); setTimeout(() => op.classList.remove('big'), 2300);
      if (!reduced()) { sparks(cv, el.getBoundingClientRect(), BM_SPARKS[kind]); const q = op.querySelector('.op-area'); q.classList.add('quake'); setTimeout(() => q.classList.remove('quake'), 450); }
      setTimeout(() => ov.classList.add('out'), 1900); setTimeout(() => ov.remove(), 2500);
    }
    function sparks(cv, r, cols) {
      const dpr = Math.min(1.5, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
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

    // after the pulls: the Case & grade wizard over every card just pulled (tagged New or Duplicate), then Keep / Burn / more
    function summary(series, cards, prior) {
      const seen = new Map(prior), dups = dupInfo(), tags = new Map();
      cards.forEach((c) => {
        const k = dupKey(c), isNew = !seen.get(k); seen.set(k, (seen.get(k) || 0) + 1);
        tags.set(c.id, isNew ? h('span', { class: 'new-t', text: 'New' }) : h('span', { class: 'dup-b', text: `Duplicate ×${dups.get(c.id)?.n || seen.get(k)}` }));
      });
      cards.forEach((c) => { hide.delete(c.id); fresh.add(c.id); });
      const best = [...cards].sort((a, b) => rarity(b) - rarity(a))[0];
      const big = cards.filter((c) => isBig(tierOf(c)));
      const close = () => { busy = false; stage.hidden = true; stage.classList.remove('opening'); packsEl.hidden = view === 'open'; put(stage); render(); };
      const go = (name) => { close(); Sheet.close('table'); Stations.open(name); };
      const seeAll = () => { close(); setView('cards'); root.closest('.sheet-body')?.scrollTo({ top: 0 }); coll.querySelector('h3')?.setAttribute('tabindex', '-1'); coll.querySelector('h3')?.focus({ preventScroll: true }); };
      const keep = view === 'open' ? () => { close(); Sheet.close('table'); } : close;
      const head = h('div', { class: 'op-sum-h' }, h('h3', { text: cards.length > 6 ? `Your ${cards.length} cards` : 'Your pulls' }),
        h('span', { class: 'muted', text: `Best: ${cardName(best)}, ${Store.trueOdds(best).label}` }),
        big.length ? h('span', { class: 'row' }, big.slice(0, 3).map((c) => shareBtn(c, 'small'))) : null);
      const host = h('div', { class: 'op-sum' }); put(stage, host);
      protectFlow(host, { cards, tags, head, done: () => {
        const more = openable(), left = more.reduce((a, o) => a + o.n, 0);
        const nextSeries = (more.find((o) => o.series === series) || more[0])?.series; // same Series first, then the oldest
        return [btn('Keep', 'primary', keep), btn('Burn', '', () => go('burn')), view === 'open' ? btn('See all my cards', '', seeAll) : null,
          left > 0 && connected() ? btn(`Open another (${left})`, 'gold', () => { busy = false; openPacks(nextSeries, 1); }) : null];
      } });
      renderColl(); Store.update(() => {}); // let the shell refresh counts
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
    }

    listen('table', render);
    Sheet.open('table', { title: TITLE[view], body: root, wide: true, onClose: () => unlisten('table') });
    setView(view); render();
    if (view === 'open') { // straight to the table: the oldest Series' next pack (demo: connects the demo wallet if needed)
      if (!connected()) { Store.update((s) => { s.wallet.connected = true; }); toast('Demo wallet connected. No real wallet is used.', 'good'); }
      openPacks(openable()[0].series, 1);
    }
  }

  // card detail: bigger card, its true odds and demo floor, all traits, quick actions, OpenSea
  function openDetail(id) {
    const c = byId(id); if (!c) return;
    const od = Store.trueOdds(c);
    const traits = [['Character', c.character], ['Category', Store.CHARS[c.character]?.category || '—'], ['Material', Store.MAT_LABEL[c.material]], ['Holo', HOLO[c.holo || 'none']], ['Series', 'Series ' + c.series],
      ['Edition', c.edition], ['Number', '#' + c.serial], ['PDA grade', c.pending ? 'Being graded' : c.grade == null ? 'Not graded' : String(c.grade)],
      // what an ungraded card's metadata shows (its condition stays hidden); a slab shows only its grade
      ...(c.grade == null ? [['Cased', c.cased ? 'Yes' : 'No'], ['Uncased age (days)', String(Math.floor(Store.ageMs(c) / Store.DAY))], ['Moves', String(Math.min(c.moves, 10))]] : [])];
    const goto = (name, o = {}) => { Sheet.close('card'); Sheet.close('table'); Stations.open(name, { pick: [c.id], ...o }); };
    const canGrade = c.grade == null && !c.pending, canCase = canGrade && !c.cased;
    const sea = (label, href, extra) => h('a', { class: 'btn sea', href, target: '_blank', rel: 'noopener', ...extra }, label, h('span', { 'aria-hidden': 'true', text: '↗' }));
    const body = h('div', { class: 'detail' },
      h('div', { class: 'big' }, h('div', { class: 'cwrap' }, cardFace(c), gradeBadge(c))),
      h('div', { class: 'traits' },
        h('div', { class: 'cmeta' }, matChip(c.material), holoBadge(c.holo), od.tier ? h('span', { class: 'tier-b ' + od.tier, text: TIER_LABEL[od.tier] }) : null),
        h('div', { class: 'dstats' },
          h('div', { class: 'dodds' }, h('small', { text: c.grade != null ? 'Odds, with its grade' : 'Pull odds' }), h('b', { text: od.label })),
          h('div', { class: 'dfloor' }, h('small', { text: 'Floor (demo)' }), h('b', { text: floorTxt(c) }),
            h('span', { text: `This exact type: ${c.character}, ${cardName(c)}` }))),
        h('dl', {}, traits.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        h('div', { class: 'row' },
          btn(`Grade · ${Wear.usd(Store.PRICES.GRADE_USD)}`, 'primary', () => goto('grade', { as: 'grade' }), { disabled: !canGrade }),
          btn(`Case · ${Wear.usd(Store.PRICES.CASE_USD)}`, '', () => goto('grade', { as: 'case' }), { disabled: !canCase }),
          btn('Burn', '', () => goto('burn'), { disabled: c.pending }),
          shareBtn(c)),
        h('div', { class: 'row' }, // collection link is a placeholder until the contract exists; then Store.openSeaItem links the card itself
          sea('View / Buy on OpenSea', Store.openSeaItem(c), { 'aria-label': 'View or buy on OpenSea (opens a new tab)' }),
          sea('List on OpenSea', Store.OPENSEA.contract ? Store.openSeaItem(c) : Store.OPENSEA.account, { 'aria-label': 'List on OpenSea (opens a new tab)' })),
        Wear.howPill(),
        h('p', { class: 'muted small', text: (c.pending ? 'Being graded right now. ' : !canGrade ? 'Slabbed: the grade is final. ' : c.cased ? 'Cased: no more wear. ' : '') + 'Floors are demo numbers. OpenSea links go to a placeholder collection for now.' })));
    Sheet.open('card', { title: c.character, body });
  }

  // =====================================================================================
  // 2. Case & grade: the wizard (after every opening, and the Case & grade station)
  //    1 Grade picks -> 2 Case picks (cards going to the grader greyed out) -> 3 Review, one payment -> cases slide on -> the grader
  // =====================================================================================
  const pctTxt = (p) => String(p).replace(/\.0$/, '') + '%';
  function oddsChart() {
    const max = Math.max(...GRADE_ODDS.map(([, p]) => p));
    return h('figure', { class: 'odds' },
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Fresh grade odds: ' + GRADE_ODDS.map(([g, p]) => `PDA ${g} is ${pctTxt(p)}`).join(', ') },
        GRADE_ODDS.map(([g, p]) => h('div', { class: 'bar' + (g === 10 ? ' top' : g >= 6 && g <= 9 ? ' mid' : '') },
          h('span', { class: 'pct', text: pctTxt(p) }), h('i', { style: `height:${Math.max(3, p / max * 64)}px` }), h('span', { class: 'lbl', text: g })))),
      h('figcaption', { text: 'Fresh cards grade 5 to 10. A PDA 10 is 1 in 100.' }));
  }
  let coin = 'ETH'; // last coin picked to pay with
  const STEPS = [['grade', 'Grade'], ['case', 'Case'], ['review', 'Review']];
  /** The wizard, drawn into `host`. cards: the cards on offer. pre: { grade: [ids], case: [ids] }, start: first step.
   *  tags: id -> a tag element (New / Duplicate), head: an element above the steps, done(el): buttons for the last screen. */
  function protectFlow(host, { cards, pre = {}, start = 'grade', tags = new Map(), head = null, done = () => [] }) {
    const P = Store.PRICES;
    const canGrade = (c) => c && c.grade == null && !c.pending;
    const canCase = (c) => canGrade(c) && !c.cased;
    const gSel = new Set((pre.grade || []).filter((id) => canGrade(byId(id))));
    const cSel = new Set((pre.case || []).filter((id) => canCase(byId(id)) && !gSel.has(id)));
    let step = start;
    const list = () => cards.map((c) => byId(c.id)).filter(Boolean);
    const total = () => gSel.size * P.GRADE_USD + cSel.size * P.CASE_USD;
    const tick = setInterval(() => { if (!host.isConnected) return clearInterval(tick); host.querySelectorAll('[data-fresh]').forEach(paintFresh); }, 30000);
    function paintFresh(el) {
      const ms = Math.max(0, ...list().map(Wear.freshLeft));
      el.hidden = !ms; el.querySelector('b').textContent = Wear.hhmm(ms);
    }
    function top() {
      const at = STEPS.findIndex(([k]) => k === step);
      const fresh = h('p', { class: 'wz-fresh', 'data-fresh': '' }, h('span', { text: 'Fresh for ' }), h('b'), h('span', { text: ' · case or grade now and they never wear' }));
      paintFresh(fresh);
      return h('div', { class: 'wz-top' },
        head,
        h('div', { class: 'wz-bar' },
          h('ol', { class: 'wz-steps', 'aria-label': 'Steps' }, STEPS.map(([k, t], i) => h('li', { class: i < at ? 'done' : i === at ? 'now' : '', 'aria-current': i === at ? 'step' : null },
            h('span', { class: 'wz-n', text: String(i + 1) }), t))),
          Wear.howPill()),
        fresh);
    }
    function quick(sel, ok) {
      const pick = (f) => { list().filter((c) => ok(c) && f(c)).slice(0, MAX_BATCH).forEach((c) => sel.size < MAX_BATCH && sel.add(c.id)); render(); };
      return h('div', { class: 'wz-quick' },
        btn('Select all holos', 'small', () => pick(isHolo)),
        btn('Select rare+', 'small', () => pick((c) => !!tierOf(c))),
        step === 'case' ? btn('Case all the rest', 'small', () => pick(() => true)) : null,
        sel.size ? btn('Clear', 'small ghost', () => { sel.clear(); render(); }) : null);
    }
    function grid(sel, ok, why) {
      return h('div', { class: 'cgrid wz-grid' }, list().map((c) => {
        const able = ok(c), w = why(c);
        const t = cardTile(c, { selectable: able, selected: sel.has(c.id), tag: tags.get(c.id)?.cloneNode(true), onTap: (card, el) => {
          if (!able) return;
          if (sel.has(card.id)) sel.delete(card.id); else if (sel.size >= MAX_BATCH) return toast(`Up to ${MAX_BATCH} at a time`, 'bad'); else sel.add(card.id);
          el.setAttribute('aria-pressed', String(sel.has(card.id))); paintFoot();
        } });
        if (!able) { t.classList.add('off'); t.setAttribute('aria-disabled', 'true'); if (w) t.querySelector('.cwrap').append(h('span', { class: 'wz-why', text: w })); }
        return t;
      }));
    }
    let foot;
    function paintFoot() {
      if (!foot) return;
      const n = step === 'grade' ? gSel.size : cSel.size, each = step === 'grade' ? P.GRADE_USD : P.CASE_USD;
      const next = step === 'grade' ? btn(gSel.size ? 'Next: cases' : 'Skip grading', 'primary', () => go('case'))
        : btn(gSel.size + cSel.size ? 'Next: review' : 'Skip cases', 'primary', () => go('review'));
      put(foot, h('div', { class: 'fsum' }, h('b', { text: n ? `${n} picked · ${Wear.usd(n * each)}` : 'None picked' }),
        h('span', { class: 'muted', text: step === 'grade' ? `${Wear.usd(each)} a card` : `${Wear.usd(each)} a card${gSel.size ? ` · ${gSel.size} going to the grader` : ''}` })),
        h('div', { class: 'row' }, step === 'case' ? btn('Back', '', () => go('grade')) : null, next));
    }
    function go(k) { step = k; render(); host.closest('.sheet-body')?.scrollTo({ top: 0 }); }
    function render() {
      if (step === 'work') return;
      foot = h('div', { class: 'foot' });
      if (step === 'grade') {
        put(host, h('div', { class: 'wz' }, top(),
          h('div', { class: 'wz-ask' }, h('h3', { text: 'Grade any now?' }),
            h('p', { class: 'muted', text: `${Wear.usd(P.GRADE_USD)} each. The grade is revealed now and the card is sealed in a slab.` }), oddsChart()),
          quick(gSel, canGrade), grid(gSel, canGrade, (c) => (c.grade != null ? 'Slabbed' : null)), foot));
      } else if (step === 'case') {
        [...cSel].forEach((id) => { if (gSel.has(id)) cSel.delete(id); });
        const ok = (c) => canCase(c) && !gSel.has(c.id);
        put(host, h('div', { class: 'wz' }, top(),
          h('div', { class: 'wz-ask' }, h('h3', { text: 'Case any?' }),
            h('p', { class: 'muted', text: `${Wear.usd(P.CASE_USD)} each. A case stops wear, so you can grade it any time later.` })),
          quick(cSel, ok), grid(cSel, ok, (c) => (gSel.has(c.id) ? 'Going to grader' : c.grade != null ? 'Slabbed' : c.cased ? 'Already cased' : null)), foot));
      } else return review();
      paintFoot();
    }
    function thumbs(ids, label) {
      return h('ul', { class: 'wz-thumbs', 'aria-label': label }, ids.map((id) => { const c = byId(id);
        return h('li', {}, h('div', { class: 'cwrap' }, cardFace(c)), h('span', { class: 'gt-name', text: c.character })); }));
    }
    function review() {
      const g = [...gSel], cs = [...cSel], raw = list().filter((c) => canCase(c) && !gSel.has(c.id) && !cSel.has(c.id));
      const usd = total(), amt = Wear.inCoin(usd, coin), bal = S().wallet.balances[coin], short = amt > bal;
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Pay with' }, Wear.COINS.map((k) =>
        h('button', { type: 'button', 'aria-pressed': String(k === coin), onclick: () => { coin = k; review(); } }, k)));
      const rawFresh = raw.some((c) => Wear.freshLeft(c) > 0);
      put(host, h('div', { class: 'wz' }, top(),
        h('div', { class: 'wz-ask' }, h('h3', { text: usd ? 'Check and pay once' : 'Nothing picked' })),
        g.length ? h('section', { class: 'wz-sec' }, h('h4', {}, 'To the grader ', h('small', { text: `${g.length} × ${Wear.usd(P.GRADE_USD)}` })), thumbs(g, 'Cards to grade')) : null,
        cs.length ? h('section', { class: 'wz-sec' }, h('h4', {}, 'Into cases ', h('small', { text: `${cs.length} × ${Wear.usd(P.CASE_USD)}` })), thumbs(cs, 'Cards to case')) : null,
        raw.length ? h('p', { class: 'wz-raw' }, h('b', { text: `${raw.length} staying raw.` }), ' ',
          rawFresh ? 'They start wearing when their fresh day ends. You can case or grade them any time.' : 'They keep wearing until cased or graded. You can do that any time.') : null,
        usd ? h('div', { class: 'wz-pay' },
          h('dl', { class: 'sum' }, h('dt', { text: 'Total' }), h('dd', { class: 'price' }, Wear.usd(usd), h('small', { text: ` ≈ ${Wear.fmtCoin(amt, coin)} ${coin}` })),
            h('dt', { text: 'You have' }), h('dd', { text: `${Wear.fmtCoin(bal, coin)} ${coin}` })),
          h('div', { class: 'wz-coin' }, h('span', { class: 'muted small', text: 'Pay with' }), seg),
          h('p', { class: 'wz-burn' }, h('b', { text: '🔥 All of it buys and burns PAPER.' }), ' 100% of every fee buys PAPER from the market and burns it. None of it goes to us.'),
          h('p', { class: 'demo-line', html: '<b>Demo</b> Demo balances only. No wallet is used.' })) : null,
        h('div', { class: 'foot' }, h('div', { class: 'fsum' }, h('b', { text: usd ? `${g.length + cs.length} cards · ${Wear.usd(usd)}` : 'Keep them all raw?' }),
          h('span', { class: 'muted', text: usd ? 'One payment for all of them' : 'You can case or grade any time from My cards' })),
          h('div', { class: 'row' }, btn('Back', '', () => go('case')),
            usd ? btn(short ? `Not enough ${coin}` : `Pay ${Wear.usd(usd)}`, 'primary', () => pay(g, cs, coin, amt), { disabled: short }) : btn('Done', 'primary', () => finish([], []))))));
      host.querySelector('.foot .btn.primary')?.focus({ preventScroll: true });
    }
    async function pay(g, cs, k, amt) {
      g = g.filter((id) => canGrade(byId(id))); cs = cs.filter((id) => canCase(byId(id)) && !g.includes(id));
      if (S().wallet.balances[k] < amt) return review();
      step = 'work';
      const now = Date.now();
      Store.update((s) => {
        s.wallet.balances[k] -= amt;
        cs.forEach((id) => { const c = byId(id); c.frozenAge = now - c.dealt; c.cased = true; }); // the case freezes its age
        g.forEach((id) => { const c = byId(id); c.frozenAge = Store.ageMs(c); c.pending = true; });
        Store.log(`Paid ${Wear.usd(total())}: ${[cs.length ? `${cs.length} cased` : '', g.length ? `${g.length} sent to the grader` : ''].filter(Boolean).join(', ')}`);
      });
      gSel.clear(); cSel.clear();
      toast('Paid · the fees buy and burn PAPER', 'good');
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite' });
      const ctrls = h('div', { class: 'stage-ctrls' });
      const slot = (id) => { const c = byId(id); const w = h('div', { class: 'gslot' }, h('div', { class: 'cwrap' }, cardFace(c)), h('div', { class: 'cmeta' }, matChip(c.material), holoBadge(c.holo))); w._id = id; return w; };
      const caseTiles = cs.map(slot), gradeTiles = g.map(slot);
      put(host, h('div', { class: 'wz wz-work' }, h('div', { class: 'wz-bar' }, h('span'), Wear.howPill()), msg,
        caseTiles.length ? h('section', { class: 'wz-sec' }, h('h4', { text: 'Casing' }), h('div', { class: 'ggrid' }, caseTiles)) : null,
        gradeTiles.length ? h('section', { class: 'wz-sec' }, h('h4', { text: 'At the grader' }), h('div', { class: 'ggrid' }, gradeTiles)) : null, ctrls));
      host.closest('.sheet-body')?.scrollTo({ top: 0 });
      // cases slide on, a beat apart
      if (caseTiles.length) msg.textContent = `Casing ${cs.length} card${cs.length > 1 ? 's' : ''}…`;
      for (const w of caseTiles) {
        const c = byId(w._id), wrap = w.querySelector('.cwrap');
        const shell = h('img', { class: 'case-in', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: '' });
        wrap.append(shell);
        await wait(reduced() ? 60 : 520);
        const f = wrap.querySelector('.cframe'); f.style.objectPosition = Store.cardPos(c); wrap.querySelector('.cface').className = wrap.querySelector('.cface').className.replace('hd-raw', 'hd-case');
        shell.remove(); w.classList.add('cased-done'); w.setAttribute('aria-label', `${c.character} cased`);
      }
      const got = [];
      if (gradeTiles.length) {
        msg.textContent = 'At the grader…';
        gradeTiles.forEach((w) => w.classList.add('scanning'));
        await wait(reduced() ? 300 : 1600);
        for (const w of gradeTiles) {
          const c0 = byId(w._id), gr = Wear.draw(c0.frozenAge / 1000, c0.moves); got.push(gr);
          Store.update((s) => { const c = s.cards.find((x) => x.id === w._id); if (c) { c.grade = gr; c.pending = false; } });
          const c = byId(w._id); w.querySelector('.cwrap').replaceChildren(cardFace(c), h('span', { class: 'stamp g' + gr, 'aria-hidden': 'true' }, h('small', { text: 'PDA' }), h('b', { text: gr })));
          w.classList.remove('scanning'); w.classList.add('stamped', 'slabbed'); w.setAttribute('aria-label', `${c.character}, PDA ${gr}, slabbed`);
          msg.textContent = `${c.character}: PDA ${gr}`;
          if (!reduced()) await wait(900);
        }
      }
      finish(cs, got, msg, ctrls);
    }
    function finish(cs, got, msg, ctrls) {
      if (!msg) { // nothing paid: straight to the end buttons
        msg = h('p', { class: 'stage-msg', text: 'All kept raw. Case or grade any time from My cards.' }); ctrls = h('div', { class: 'stage-ctrls' });
        put(host, h('div', { class: 'wz wz-work' }, h('div', { class: 'wz-bar' }, h('span'), Wear.howPill()), msg, ctrls));
      } else {
        const parts = [cs.length ? `${cs.length} cased` : '', got.length ? (got.length === 1 ? `PDA ${got[0]}` : `${got.length} graded, best PDA ${Math.max(...got)}`) : ''].filter(Boolean);
        msg.textContent = 'Done! ' + parts.join(' · ');
        if (got.length) toast(got.length === 1 ? `Graded: PDA ${got[0]}` : `${got.length} cards graded`, 'good');
      }
      put(ctrls, done());
      ctrls.querySelector('.btn.primary')?.focus({ preventScroll: true });
    }
    render();
  }

  // the Case & grade station: every ungraded card you own, rarest first
  function openGrade(opts = {}) {
    const root = h('div', { class: 'st st-grade' });
    const pool = S().cards.filter((c) => c.grade == null && !c.pending).sort((a, b) => rarity(b) - rarity(a) || b.serial - a.serial);
    const pick = opts.pick || [];
    Sheet.open('grade', { title: 'Case & grade', body: root, wide: true });
    if (!pool.length) { put(root, h('div', { class: 'empty-state' }, h('p', { text: 'Every card you have is slabbed. Open a pack for more!' }), Wear.howPill())); return; }
    protectFlow(root, { cards: pool, start: opts.as === 'case' ? 'case' : 'grade', pre: opts.as === 'case' ? { case: pick } : { grade: pick },
      done: () => [btn('Case or grade more', '', () => openGrade()), btn('Done', 'primary', () => Sheet.close('grade'))] });
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
    const sel = new Set(opts.pick || []);
    const root = h('div', { class: 'st st-burn' }); const foot = h('div', { class: 'foot' });
    let dups = new Map();
    const spare = (c) => (dups.get(c.id)?.spare ? 0 : 1);
    const SORTS = {
      best: (a, b) => spare(a) - spare(b) || rarity(a) - rarity(b) // spares, then the most common by true odds
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
      else act = btn(`Burn ${n}`, 'danger', () => confirmBurn([...sel], go), { 'aria-haspopup': 'dialog' });
      put(foot, h('div', { class: 'fsum' }, h('b', { text: n ? `${n} picked` : 'None picked' }),
        h('span', { class: 'muted', text: packs ? `+${packs} free pack${packs > 1 ? 's' : ''}` : `${BURN_GOAL - b} to a free pack` })), act);
    }
    function toggle(c, el) { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); el.setAttribute('aria-pressed', String(sel.has(c.id))); renderFoot(); }
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
        visPaper.length ? btn('All Paper', 'small', () => { visPaper.forEach((c) => sel.add(c.id)); render(); }) : null,
        sel.size ? btn('Clear', 'small', () => { sel.clear(); render(); }) : null,
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
    function go(picked) { // only ever called by the confirm window, after BURN is typed
      const ids = picked.filter((id) => byId(id) && !byId(id).pending); sel.clear(); if (!ids.length) return render();
      Store.update((s) => { s.cards = s.cards.filter((c) => !ids.includes(c.id)); Store.log(`Burned ${ids.length} card${ids.length > 1 ? 's' : ''}`); });
      unlisten('burn'); Sheet.close('burn');
      toast(`Burning ${ids.length} card${ids.length > 1 ? 's' : ''}…`);
      ids.forEach((_, i) => setTimeout(() => { if (window.Scene?.burn) { burnQueue++; window.Scene.burn(); } else addBurn(); }, i * 350));
    }
    listen('burn', render);
    Sheet.open('burn', { title: 'Ash bin', body: root, onClose: () => unlisten('burn') });
    render();
  }

  // The burn warning: a big window listing exactly what is about to be destroyed (most valuable first, with warnings),
  // what it earns toward a free pack, and a box where the player types BURN before anything happens.
  function confirmBurn(ids, onBurn) {
    const cards = ids.map(byId).filter(Boolean); if (!cards.length) return;
    const n = cards.length, b = S().wallet.burnCount % BURN_GOAL, after = b + n, packs = Math.floor(after / BURN_GOAL), rest = after % BURN_GOAL;
    const burning = new Set(cards.map((c) => c.id)), owned = new Map();
    for (const c of S().cards) owned.set(dupKey(c), (owned.get(dupKey(c)) || 0) + 1);
    const left = new Map(owned); cards.forEach((c) => left.set(dupKey(c), left.get(dupKey(c)) - 1));
    const flags = (c) => { const t = tierOf(c), f = [];
      if (!left.get(dupKey(c))) f.push(owned.get(dupKey(c)) === 1 ? 'Your only copy' : `All ${owned.get(dupKey(c))} of your copies`);
      if (t) f.push(TIER_LABEL[t]); if (isHolo(c)) f.push(holoLabel(c) || 'Holo'); if (c.grade != null) f.push('PDA ' + c.grade);
      return f; };
    const list = cards.map((c) => ({ c, f: flags(c) })).sort((x, y) => (y.f.length > 0) - (x.f.length > 0) || rarity(y.c) - rarity(x.c) || Store.floor(y.c) - Store.floor(x.c));
    const flagged = list.filter((x) => x.f.length).length, worth = cards.reduce((a, c) => a + Store.floor(c), 0);
    const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const word = 'BURN', ok = () => input.value.trim().toUpperCase() === word;
    const input = h('input', { id: 'bw-type', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'done', 'aria-describedby': 'bw-type-hint',
      oninput: () => { const m = ok(); fire.disabled = !m; wrap.classList.toggle('ok', m); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (ok()) burn(); } } });
    const burn = () => { if (!ok()) return; Sheet.close('burnwarn'); onBurn(ids); };
    const fire = btn(`Burn ${plural(n, 'card')} forever`, 'danger', burn, { disabled: true });
    const wrap = h('div', { class: 'bw-type' }, h('label', { for: 'bw-type' }, 'Type ', h('b', { text: word }), ' to confirm'), input,
      h('small', { id: 'bw-type-hint', class: 'muted', text: 'Not case-sensitive. The burn button unlocks when it matches.' }));
    const meterAt = (v) => h('i', { style: `width:${v / BURN_GOAL * 100}%` });
    const body = h('div', { class: 'bw' },
      h('div', { id: 'bw-warn', class: 'bw-warn' },
        h('span', { class: 'bw-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2.5 1.4-4 2.5-5 .2 1.7 1 2.8 2 3.2C11 8.6 11 5 12 2z" fill="currentColor"/></svg>' }),
        h('div', {}, h('p', { class: 'bw-big', text: 'Burned cards are destroyed forever. This can’t be undone.' }),
          h('p', { text: `You are about to burn ${plural(n, 'card')}` + (flagged ? `, and ${flagged === n ? (n === 1 ? 'it is' : 'all of them are') : flagged + ' of them ' + (flagged === 1 ? 'is' : 'are')} worth a second look.` : '.')
            + ` Floor value about ${Store.eth(+worth.toPrecision(2))} (demo numbers).` }))),
      h('div', { class: 'bw-gain' },
        h('div', { class: 'bb-top' }, h('b', { text: 'You get' }),
          h('span', { class: 'bw-ft' }, h('span', { class: 'muted', text: `${b}/${BURN_GOAL}` }), h('span', { 'aria-hidden': 'true', text: ' → ' }), h('span', { class: 'sr', text: ' to ' }),
            h('b', { text: packs ? `+${plural(packs, 'free pack')}` + (rest ? `, ${rest}/${BURN_GOAL}` : '') : `${after}/${BURN_GOAL}` }))),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, meterAt(packs ? BURN_GOAL : b), packs ? null : h('i', { class: 'add', style: `left:${b / BURN_GOAL * 100}%;width:${n / BURN_GOAL * 100}%` })),
        h('p', { class: 'muted small', text: packs ? `Every ${BURN_GOAL} cards burned is a free pack.` : `${BURN_GOAL - after} more to a free pack.` })),
      h('h3', { class: 'bw-h', text: flagged ? `The cards (${flagged} flagged, most valuable first)` : 'The cards' }),
      h('ul', { class: 'bw-list', tabindex: '0', 'aria-label': `The ${plural(n, 'card')} to burn` }, list.map(({ c, f }) => h('li', { class: f.length ? 'flag' : '' },
        h('div', { class: 'bw-thumb' }, cardFace(c)),
        h('div', { class: 'bw-info' }, h('b', { text: c.character }), h('span', { text: cardName(c) }), h('span', { class: 'muted', text: Store.trueOdds(c).label + ' · ' + floorTxt(c) }),
          f.length ? h('div', { class: 'bw-flags' }, f.map((t) => h('span', { class: 'bw-flag' + (/copy|copies/.test(t) ? ' last' : ''), text: t }))) : null)))),
      h('div', { class: 'bw-foot' }, wrap, h('div', { class: 'bw-act' }, btn('Cancel', '', () => Sheet.close('burnwarn')), fire),
        h('p', { class: 'demo-line', html: '<b>Demo</b>Nothing is really burned' })));
    const d = Sheet.open('burnwarn', { title: `Burn ${plural(n, 'card')}?`, body });
    d.classList.add('burnwarn'); d.setAttribute('role', 'alertdialog'); d.querySelector('h2').id = 'bw-title';
    d.setAttribute('aria-labelledby', 'bw-title'); d.setAttribute('aria-describedby', 'bw-warn');
    d.querySelector('.sheet-body').scrollTop = 0; input.focus();
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

  const OPEN = { cards: openTable, open: (o) => openTable({ ...o, view: 'open' }), table: openTable, grade: openGrade, burn: openBurn, suggest: openSuggest };
  window.Stations = {
    openable, openableCount,
    open(name, opts) { (OPEN[name] || (() => toast('Unknown station', 'bad')))(opts); },
    openCard: openDetail,
  };
})();
