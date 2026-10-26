/* Omni Cardworks (demo mode): the station screens. My cards / Open packs (one sheet: the collection, or straight into opening), Case & grade
   (the same wizard that follows every opening: grade picks, case picks, review, one payment), Burn
   (burn toward a free pack) and the suggestion box. Demo data only: everything reads and writes window.Store. */
(() => {
  const S = () => Store.state;
  const LIVE = window.Live?.on; // live mode (live.js): the chain's data, and Live sends the transactions
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const HOLO = { none: 'No holo', frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' };
  const HRANK = { none: 0, frame: 1, picture: 2, full: 3 };
  const GLOW = { paper: '#fff4dc', wood: '#ffc46b', fire: '#ff5a1c', charcoal: '#dcdcf0', diamond: '#9fd8ff', gold: '#ffd25a', fullart: '#ffe9a8' };
  const BURN_GOAL = 42; // fixed forever: every 42 cards burned is a free pack
  const maxBatch = () => Store.MAX_BATCH; // FirePsa.maxBatch(): the most cards one case & grade payment takes, cases and grades together
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
  // Background Store updates (other buyers, burns landing, timers) must never swap nodes under a click or the keyboard
  // focus. patch() rebuilds a part only when what it shows changed (its key); a rebuild puts focus back on the same
  // control, found again by its data-id / data-k / data-v / data-key.
  const focusSel = (el) => { for (const k of ['data-id', 'data-k', 'data-v', 'data-key']) if (el?.hasAttribute?.(k)) return `[${k}="${CSS.escape(el.getAttribute(k))}"]`; return null; };
  function patch(host, key, build) {
    if (host._key === key) return false;
    host._key = key;
    const a = document.activeElement, sel = host.contains(a) ? focusSel(a) : null;
    build();
    if (sel && !host.contains(document.activeElement)) host.querySelector(sel)?.focus({ preventScroll: true });
    return true;
  }
  const btn = (label, cls, onclick, extra = {}) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick, ...extra }, label);
  /** A live wait's status line, with an optional action the buyer can choose (never pressed for them): a button and
   *  one plain line saying what it does. The same text and action again doesn't redraw (a poll repeats it). */
  const sayTo = (el, text, a) => {
    const key = text + '|' + (a?.label || '');
    if (el.dataset.key === key) return;
    el.dataset.key = key; el.textContent = text;
    // tapped: the action goes, and the same line may offer it again later (a "Not now" in its confirm)
    if (a) el.append(h('span', { class: 'stage-act' }, btn(a.label, 'small', () => { el.querySelector('.stage-act')?.remove(); el.dataset.key = ''; a.fn(); }, { 'data-key': 'diy' }),
      a.alt ? btn(a.alt.label, 'small', () => a.alt.fn(), { 'data-key': 'diy-alt' }) : null, h('small', { text: a.note })));
  };
  const paper = () => S().wallet.balances.PAPER;
  const connected = () => S().wallet.connected;
  const connectBtn = () => btn('Connect wallet', 'primary', () => {
    if (LIVE) return Live.needWallet();
    Store.update((s) => { s.wallet.connected = true; }); toast('Demo wallet connected', 'good');
  });
  const getPaperBtn = () => btn('Get PAPER', 'gold', () => (window.UI?.openGetPaper ? window.UI.openGetPaper() : toast('Get PAPER is coming soon')));
  const byId = (id) => S().cards.find((c) => c.id === id);
  // true rarity (Store.trueOdds): how rare that exact card (character, material, holo) is in its Series, x "that grade or better"
  // once graded. rarity() is N in "1 in N", bigger is rarer.
  const rarity = (c) => Store.trueOdds(c).n;
  // tier on the same scale: Rare (1 in 100 or rarer) gets the tease glow; Epic (1 in 400) the light leak + Share; Legendary (1 in 1,000) the big moment too
  const tierOf = (c) => Store.trueOdds(c).tier;
  const isBig = (t) => t === 'epic' || t === 'legendary';
  const isHolo = (c) => !!Store.ALWAYS_HOLO[c.material] || (c.holo || 'none') !== 'none';
  const TIER_LABEL = { rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
  const CEL_HEAD = { rare: 'Nice pull!', epic: 'Huge pull!', legendary: 'Legendary pull!' }; // the after-party's heading, by the best pull's tier
  const HOLO_NAME = { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' };
  const cardName = (c) => (Store.ALWAYS_HOLO[c.material] ? Store.MAT_LABEL[c.material] : ((c.holo || 'none') !== 'none' ? HOLO_NAME[c.holo] + ' ' : '') + Store.MAT_LABEL[c.material])
    + (c.grade != null ? ' · PDA ' + c.grade : ''); // "Full holo Paper", "Diamond · PDA 10"
  const floorTxt = (c) => Store.eth(Store.floor(c));
  // light-leak colours per material: [hot core, glow]
  const LEAK = { paper: ['#fff6dc', '#ffd98a'], wood: ['#ffd9a0', '#ff9f2e'], fire: ['#ffd27a', '#ff5a12'], charcoal: ['#ffb08a', '#e0260c'], diamond: ['#ffffff', '#bfe6ff'], gold: ['#fff4c4', '#ffb81c'], fullart: ['#ffffff', '#ffd27a'] };
  const edNum = (c) => parseInt(c.edition, 10) || 0;
  const offs = {}; // one store subscription per open station
  const listen = (name, fn) => { offs[name]?.(); offs[name] = Store.on(fn); };
  const unlisten = (name) => { offs[name]?.(); delete offs[name]; };

  const BACK = 'ui/card-back.webp'; // the card back, for every face-down card
  // a pack's cards, fetched and decoded while the pack is torn (its art covers the wait): each card's image, and a live
  // card's picture and print. Never rejects. The decoded images stay referenced until the reveal is over.
  const decoded = (src) => new Promise((ok) => { const i = new Image(); i.decoding = 'async'; i.onload = () => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(() => ok(i)); i.onerror = () => ok(null); i.src = src; });
  const preloadCards = (cards) => Promise.all(cards.map((c) => Promise.all([decoded(Store.cardImg(c)), window.Holo?.preload?.(c)])));
  // a card face is shown: its image decoded and, live, its holo drawn once (or 8 s, whatever comes first)
  const faceShown = (face) => !face ? Promise.resolve() : Promise.race([wait(8000),
    Promise.all([face.querySelector('img.cframe')?.decode?.().catch(() => {}), face._ready])]);

  // ---------- pack-opening sounds: recordings (sound.js) for the tear, slides, flips and the Rare / Epic / Legendary pulls
  // (Epic and Legendary: a build-up under the glow and the light leak, then a hit); a couple of small made-in-WebAudio
  // accents (the Rare tease rumble, the plain-holo shimmer) where no recording fits. All through Sound's one AudioContext, so the speaker button silences everything.
  const Sfx = (() => {
    let noise = null, ctx = null, out = null;
    function ac() {
      ctx = window.Sound?.ctx; if (!ctx || ctx.state !== 'running') return null; out = Sound.out;
      if (!noise || noise.sampleRate !== ctx.sampleRate) { noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      return ctx;
    }
    const play = (n, o) => window.Sound?.play(n, o);
    const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
    function hiss(t, { type = 'bandpass', f = 2500, q = 1, peak = 0.2, a = 0.004, dec = 0.05 } = {}) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q; env(g, t, a, peak, dec);
      s.connect(fl).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + a + dec + 0.05); return fl;
    }
    function tone(t, f, { type = 'sine', peak = 0.12, a = 0.01, dec = 1.2, to } = {}) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + dec); env(g, t, a, peak, dec);
      o.connect(g).connect(out); o.start(t); o.stop(t + a + dec + 0.05);
    }
    // the tear follows the finger: one voice plays the recording on from where the tear is, and goes quiet when the finger stops
    let rv = null, rvT = 0, cur = null; // cur: the build-up for the card on top { tier, h, hit }
    const RIP = 0.85; // pack-rip.mp3 length (s)
    return {
      rip(p = 0) {
        clearTimeout(rvT);
        if (!rv || rv.done) rv = play('pack-rip', { offset: Math.min(0.75, p) * RIP, fadeIn: 0.015 });
        rvT = setTimeout(() => { rv?.stop(0.06); rv = null; }, 140);
      },
      ripFull() { // the tear completes: let the running voice play out, or (no drag, e.g. Enter) the whole tear
        clearTimeout(rvT);
        if (rv && !rv.done) { rv = null; return; }
        play('pack-rip');
      },
      slide() { play('card-slide', { gap: 60 }); },
      flip() { play('card-flip', { gap: 60 }); },
      tease(m) { if (!ac()) return; const t = ctx.currentTime, d = { fire: 0.85, charcoal: 1, diamond: 1.2, gold: 1.2, fullart: 1.3 }[m] || 1;
        if (Store.ALWAYS_HOLO[m]) { tone(t, 900, { peak: 0.04, a: d * 0.8, dec: 0.3, to: 2400 }); tone(t, 1350, { peak: 0.025, a: d * 0.8, dec: 0.3, to: 3600 }); }
        else { tone(t, m === 'fire' ? 70 : 52, { type: 'triangle', peak: 0.16, a: d * 0.85, dec: 0.25 }); hiss(t, { type: 'lowpass', f: 600, peak: 0.08, a: d * 0.8, dec: 0.25 }); } },
      // Epic / Legendary build-up: starts as the card begins to glow, lined up so its last moment lands lead seconds from now
      // (the flip for Epic, the flash for Legendary). A lead shorter than the file starts partway in; a longer one waits.
      // One per card: a new build cuts any old one, and the card's hit (hit / cut) ends it.
      build(tier, lead) {
        this.cut(false);
        const n = `pull-${tier}-build`, d = window.Sound?.dur(n), p = cur = { tier, h: null, hit: false };
        if (!d) return;
        const off = Math.max(0, d - lead);
        p.h = play(n, { offset: off, delay: Math.max(0, lead - d), fadeIn: off > 0.02 ? 0.1 : 0 });
        if (p.h) Sound.duck(lead, 0.65, Math.min(0.8, lead * 0.5)); // the room eases down a little under it
      },
      // the tier hit: Rare on the flip; Epic on the flip; Legendary on the big moment's flash. The room dips under it.
      hit(tier) {
        const p = cur?.tier === tier ? cur : null;
        if (p) { cur = null; if (p.hit) return; p.hit = true; p.h?.stop(0.04); } // the build is at its end now (a late frame: cut it)
        if (play(`pull-${tier}${tier === 'rare' ? '' : '-hit'}`, { gap: 300 })) Sound.duck(tier === 'legendary' ? 4.5 : tier === 'epic' ? 2.4 : 1.4, tier === 'rare' ? 0.5 : 0.3);
      },
      // skipped (withHit: the card's hit still lands) or closed mid-build: the build fades out quickly
      cut(withHit) {
        const p = cur; if (!p) return; cur = null;
        p.h?.stop(0.12);
        if (withHit && !p.hit) this.hit(p.tier);
      },
      // a holo turning over: a soft rising shimmer (a quick run of glassy notes over a breath of air), well under the tier hits
      shimmer() { if (!ac()) return; const t = ctx.currentTime;
        [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => { tone(t + i * 0.06, f, { peak: 0.045 - i * 0.005, a: 0.015, dec: 0.9 }); tone(t + i * 0.06, f * 1.5, { peak: 0.012, dec: 0.5 }); });
        hiss(t, { type: 'highpass', f: 5200, q: 0.5, peak: 0.035, a: 0.2, dec: 0.45 }); },
    };
  })();

  // ---------- the card: the finished card image (name, material, category, Series and PDA seal are printed on it)
  // a raw holo card's holo moves with the mouse or finger wherever it's shown (holo.js); sway: it also drifts on its own
  // (the big card and the pack reveal)
  function cardFace(c, lazy = false, sway = false) { // lazy: grids and lists (off-screen tiles load as they scroll in)
    const holo = c.holo || 'none', moving = !!Store.cardParts(c) && !!window.Holo;
    const el = h('div', { class: `cface m-${c.material} h-${holo} hd-${Store.holder(c)}${c.grade === 10 ? ' g10' : ''}` },
      h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: `${c.character}, ${Store.MAT_LABEL[c.material]} card`, draggable: 'false', loading: lazy ? 'lazy' : null, decoding: 'async' }),
      holo !== 'none' && !moving ? h('i', { class: 'shine', 'aria-hidden': 'true' }) : null);
    // a tile in a grid or list is its saved image (one state, ~30 KB); the live holo (holo.js: its picture and print,
    // ~200 KB more) joins only when a mouse comes over it. A big card (detail, reveal, viewer) is live from the start.
    if (moving && !lazy) Holo.attach(el, c, sway);
    else if (moving) el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !el._holo) Holo.attach(el, c, sway); });
    return el;
  }
  // the badge under a card: its grade once slabbed, else Cased (with a lock), else Raw, or Fresh while its first day runs
  // (time doesn't wear it; a card that already moved says so: moves still count). noFresh: a short "Fresh" chip, a banner has the time.
  const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="2.5" y="7" width="11" height="8" rx="1.8" fill="currentColor"/></svg>';
  const freshTip = (c, f) => `Fresh for ${Wear.hhmm(f)}.${c.moves ? ` Moved ${c.moves === 1 ? 'once' : c.moves + ' times'}.` : ''}`;
  const gradeBadge = (c, noFresh = false) => {
    if (c.pending) return h('span', { class: 'pda wait', text: 'Grading' });
    if (c.grade != null) return h('span', { class: 'pda g' + c.grade, text: 'PDA ' + c.grade });
    if (c.cased) return h('span', { class: 'pda cased', title: 'Cased: no wear' }, h('i', { class: 'lock', html: LOCK }), 'Cased');
    const f = Wear.freshLeft(c);
    if (!f) return h('span', { class: 'pda none', text: 'Raw' });
    const moved = c.moves > 0, cls = 'pda fresh' + (moved ? ' moved' : '');
    if (noFresh) return h('span', { class: cls, title: freshTip(c, f), text: moved ? 'Fresh · moved' : 'Fresh' });
    return h('span', { class: cls, title: freshTip(c, f), text: moved ? `Fresh ${Math.max(1, Math.floor(f / 3600e3))}h · moved` : 'Fresh ' + Wear.hhmm(f) });
  };
  const HOLDER = { raw: 'Raw', case: 'Cased', slab: 'Slabbed' };
  const matChip = (m) => h('span', { class: 'mat ' + m, text: Store.MAT_LABEL[m] });
  const holoBadge = (holo) => holo && holo !== 'none' ? h('span', { class: 'holo-b', text: HOLO[holo] }) : null;
  const holoChip = (c) => (c.material === 'gold' || c.material === 'fullart' ? null : holoBadge(c.holo)); // Gold and Full Art are always full holo: no chip
  const describe = (c) => `${c.character}, ${Store.MAT_LABEL[c.material]}${c.holo !== 'none' ? ', ' + HOLO[c.holo] : ''}, ${c.pending ? 'being graded' : c.grade == null ? (c.cased ? 'cased, not graded' : 'raw, not graded') : 'slabbed, PDA ' + c.grade}, ${Store.trueOdds(c).label}, Series ${c.series}${Store.printNo(c) ? `, #${Store.printNo(c)}` : ''}`;

  // "If graded now": the grade odds an ungraded card has today (Wear.odds on its uncased age and moves; a case froze them),
  // by wear band (PDA 10, 9-8, 7-6, 5-4, 3-2, 1). The thin bar sits on every ungraded tile; the card's detail adds the key.
  const canGradeNow = (c) => c.grade == null && !c.pending;
  const pctNow = (p) => (p >= 0.995 ? '100%' : p >= 0.005 ? Math.round(p * 100) + '%' : '<1%');
  const oddsNow = (c) => Wear.odds(Wear.ageSecOf(c), c.moves);
  // the six bands with their share, the ones that can happen (one set of bands everywhere: Wear.BANDS)
  const bandsOf = (o) => Wear.bandOdds(o).filter((b) => b.p >= 0.001);
  const nowBands = (c) => bandsOf(oddsNow(c));
  const saysOf = (bands, lead = 'If graded now') => `${lead}: ` + bands.map((b) => `PDA ${b.g} ${pctNow(b.p)}`).join(', ');
  // the bar (thin on tiles), or with its key: caption, the bar, "10 1% · 9–8 70% ..."
  function bandBar(bands, { full = false, caption = 'If graded now', says = saysOf(bands, caption) } = {}) {
    const bar = h('span', { class: 'gnow-bar', ...(full ? { role: 'img', 'aria-label': says } : { 'aria-hidden': 'true', title: says }) },
      bands.map((b) => h('i', { style: `flex:${b.p} 1 0;background:${b.c}` })));
    if (!full) return bar;
    return h('div', { class: 'gnow' }, h('small', { text: caption }), bar,
      h('ul', { class: 'gnow-key', 'aria-hidden': 'true' }, bands.map((b) => h('li', {}, h('i', { style: `background:${b.c}` }), b.g + ' ', h('b', { text: pctNow(b.p) })))));
  }
  const nowBar = (c, full = false, caption) => bandBar(nowBands(c), { full, caption });

  // a tile used by the collection and by every picker (Series and floor live in the card's detail)
  function cardTile(c, { selectable = false, selected = false, onTap, tag, noFresh = false } = {}) {
    const label = describe(c) + (canGradeNow(c) ? '. ' + saysOf(nowBands(c)) : ''); // the odds bar, for screen readers too
    const b = h('button', { type: 'button', class: 'ctile' + (selectable ? ' pick' : ''), 'data-id': c.id, 'aria-label': label, onclick: () => onTap?.(c, b) },
      h('div', { class: 'cwrap' }, cardFace(c, true), gradeBadge(c, noFresh), selectable ? h('span', { class: 'tick', 'aria-hidden': 'true' }) : null),
      canGradeNow(c) ? nowBar(c) : null,
      h('div', { class: 'cmeta' }, tag || null, matChip(c.material), holoChip(c)));
    if (tag) b.setAttribute('aria-label', label + '. ' + tag.textContent);
    if (selectable) b.setAttribute('aria-pressed', String(selected));
    return b;
  }

  // everything a tile shows, as text: a part is rebuilt only when one of these changes
  const tileSig = (c) => [c.id, describe(c), c.pending, c.cased, c.grade, Wear.freshLeft(c) ? Wear.hhmm(Wear.freshLeft(c)) : '',
    canGradeNow(c) ? nowBands(c).map((b) => pctNow(b.p)).join(',') : ''].join('|');

  // ---------- share your pull: a 1080 x 1350 PNG of the card, its odds and the wordmark, then the share sheet (or a download)
  // cross-origin art (live: the IPFS gateway) loads with CORS, so the canvas can still be saved (share.js, clip.js do the same)
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); if (/^https?:/.test(src)) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const holoLabel = (c) => { const hl = (c.material === 'gold' || c.material === 'fullart') ? 'full' : c.material === 'diamond' && (c.holo || 'none') === 'none' ? 'full' : c.holo || 'none'; return hl === 'none' ? '' : HOLO[hl]; };
  const pullLine = (c) => Store.trueOdds(c).label; // includes the grade when graded
  const kindLine = (c) => [Store.MAT_LABEL[c.material], holoLabel(c), c.grade != null ? 'PDA ' + c.grade : ''].filter(Boolean).join(' · ');
  async function shareImage(c) {
    const W = 1080, H = 1350, [core, glow] = LEAK[c.material], tier = tierOf(c);
    await Promise.all(['400 64px "Russo One"', '800 36px Nunito', '600 30px Nunito'].map((f) => document.fonts.load(f).catch(() => {})));
    await document.fonts.ready;
    const [strip, word] = await Promise.all([loadImg(Store.cardStrip?.(c) || Store.cardImg(c)), loadImg('ui/omni-wordmark.webp').catch(() => null)]); // the strip: the full-size card
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
    const n = strip.naturalWidth / strip.naturalHeight > 2 ? Store.STATES : 1, si = n > 1 ? Store.stateIdx(c) : 0; // a strip of 12 states, or one image (live)
    const sw = strip.naturalWidth / n, sh = strip.naturalHeight, ch = 760, cw = Math.round(ch * sw / sh), cx = (W - cw) / 2, cy = 92;
    g.save(); g.shadowColor = tier ? glow : 'rgba(0,0,0,.8)'; g.shadowBlur = tier ? 70 : 40; g.shadowOffsetY = tier ? 0 : 14;
    g.drawImage(strip, si * sw, 0, sw, sh, cx, cy, cw, ch); g.restore();
    g.drawImage(strip, si * sw, 0, sw, sh, cx, cy, cw, ch); // once more, crisp over its own glow
    // text
    const fit = (txt, font, px, max) => { let s = px; do g.font = font.replace('{}', s + 'px'); while (g.measureText(txt).width > max && (s -= 2) > 20); };
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    fit(c.character, '400 {} "Russo One", sans-serif', 66, W - 120); g.fillStyle = '#f6e8cf'; g.shadowColor = '#000'; g.shadowBlur = 0; g.shadowOffsetY = 4;
    g.fillText(c.character, W / 2, 940); g.shadowOffsetY = 0;
    const kind = kindLine(c);
    fit(kind, '800 {} Nunito, sans-serif', 38, W - 160); g.fillStyle = core; g.shadowColor = glow; g.shadowBlur = 18; g.fillText(kind, W / 2, 1000); g.shadowBlur = 0;
    const odds = pullLine(c);
    if (odds) { fit(odds, '400 {} "Russo One", sans-serif', 76, W - 120); g.fillStyle = '#ffd27a'; g.shadowColor = 'rgba(255,170,60,.7)'; g.shadowBlur = 24; g.fillText(odds, W / 2, 1102); g.shadowBlur = 0; }
    g.font = '600 30px Nunito, sans-serif'; g.fillStyle = '#b9a385'; g.fillText(`${c.grade >= 5 ? 'Odds with grade' : 'Pull odds'} · Series ${c.series}`, W / 2, 1152);
    // the wordmark, small: the Omni wordmark + CARDWORKS, like the top bar (no image: the words alone)
    const tail = word ? 'CARDWORKS' : 'OMNI CARDWORKS';
    g.font = '400 40px "Russo One", sans-serif'; const fw = g.measureText(tail).width, wh = 46, ww = word ? wh * word.naturalWidth / word.naturalHeight : 0, gap = word ? 12 : 0;
    const x0 = (W - ww - gap - fw) / 2, by = 1262;
    if (word) g.drawImage(word, x0, by - wh + 6, ww, wh);
    g.textAlign = 'left'; g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#0d141c'; g.strokeText(tail, x0 + ww + gap, by); g.fillStyle = '#f9e2b4'; g.fillText(tail, x0 + ww + gap, by);
    return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/png'));
  }
  async function shareCard(c, from) {
    if (from) { if (from.getAttribute('aria-busy') === 'true') return; from.setAttribute('aria-busy', 'true'); }
    const kind = kindLine(c), odds = pullLine(c);
    const title = `${c.character}, ${kind}`, text = `I pulled ${c.character} (${kind}${odds ? ', ' + odds : ''}) at Omni Cardworks.`;
    try {
      // the card's art couldn't be drawn (its host refused it): share the words alone where the device can
      const blob = await shareImage(c).catch(async (e) => {
        if (!navigator.share) throw e;
        try { await navigator.share({ title, text }); } catch (x) { if (x?.name !== 'AbortError') toast('Couldn’t share it', 'bad'); }
        return null;
      });
      if (!blob) return;
      const slug = c.character.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const name = `omni-cardworks-${slug || 'card'}.png`, file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title, text }); } catch (e) { if (e?.name !== 'AbortError') toast('Couldn’t share it', 'bad'); }
        return;
      }
      const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name, hidden: true });
      (from?.closest('dialog') || document.body).append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Saved', 'good');
    } catch { toast('Couldn’t make the image', 'bad'); } finally { from?.removeAttribute('aria-busy'); }
  }
  // label: the visible text (several Share buttons side by side each name their card)
  const shareBtn = (c, cls = '', label = 'Share') => { const b = btn(label, 'share-b ' + cls, () => shareCard(c, b), { 'aria-label': `Share your ${c.character}, ${[Store.MAT_LABEL[c.material], holoLabel(c)].filter(Boolean).join(' ')}` }); return b; };
  // a tilt clip (clip.js): a few seconds of the card shining, as a video; where video can't be recorded, the picture above
  const setPicture = () => { if (window.Clip) Clip.picture = (c, from) => shareCard(c, from); }; // clip.js loads after this file
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setPicture, { once: true }); else setPicture();
  const clipBtn = (c, cls = '') => (window.Clip ? Clip.button(c, { cls }) : null);

  // ---------- pack contents: the pack's slots, each card rolled on its own at its slot's fixed odds (Store.rollPack), like the contract
  function makePack(series) {
    const names = [...new Set(S().cards.map((c) => c.character))]; const pool = names.length ? names : FALLBACK_NAMES;
    let id = Math.max(999, ...S().cards.map((c) => c.id)), serial = Math.max(0, ...S().cards.map((c) => c.serial));
    const ser = S().series, cardsInSeries = Math.max(1, ser.total) * (ser.cardsPerPack || 6), cast = Math.max(1, ser.cast);
    return Store.rollPack().map(({ material: m, holo }) => {
      // DEMO DATA: a print number (#k: the k-th of this exact card pulled), somewhere up to what the odds give it in a full Series
      const w = (Store.CARD_ODDS.find(([x]) => x === m) || [m, 1])[1];
      const of = Math.max(1, Math.round((w / Store.ODDS_TOTAL) * cardsInSeries / cast * (m === 'gold' || m === 'fullart' ? 1 : window.Info?.holoP(m, holo) ?? 1)) + 2);
      const character = m === 'gold' || m === 'fullart' ? Store.SPECIAL_CAST : pool[Math.floor(Math.random() * pool.length)];
      return { id: ++id, serial: ++serial, series, character, material: m, holo,
        edition: String(1 + Math.floor(Math.random() * of)), grade: null, pending: false, dealt: Date.now(), cased: false, frozenAge: 0, moves: 0 };
    });
  }
  // demo data: graded cards were graded at some age (their grade drawn on the wear model at that age); one PDA 10 so the demo shows the gold edge
  (() => {
    let seed = 1607; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const graded = S().cards.filter((c) => c.grade != null);
    graded.forEach((c, i) => { c.frozenAge = Math.round((i % 4 ? R() * 20 : 60 + R() * 900) * Store.DAY); c.grade = Wear.draw(c.frozenAge / 1000, c.moves, R); });
    const show10 = graded.find((c) => c.material === 'wood') || graded[0];
    if (show10) { show10.grade = 10; show10.frozenAge = 3600e3; }
  })();

  // a Legendary card (1 in 1,000 or rarer: a Full Art, full-holo Paper or Wood, plain Coal, any Diamond, PDA 10s): flash, a burst of sparks, then settle.
  // The title names the card: "Full holo Paper!", "Diamond!", "PDA 10!" (a plain card that's only Legendary for its grade)
  const BM_SPARKS = { dia: ['#ffffff', '#d8f0ff', '#9fd8ff', '#c9b6ff', '#ffd27a', '#ff9a3c'], g10: ['#fff6d6', '#ffd27a', '#ffb347', '#ff7a2e', '#ffffff'],
    charcoal: ['#fff2e0', '#ffb070', '#ff6a2a', '#ff3a1a', '#ffd27a'], paper: ['#ffffff', '#fff4d6', '#ffe7a8', '#ffd27a', '#f6e8cf'],
    wood: ['#fff0d0', '#ffd08a', '#ffb050', '#ff9f2e', '#ffffff'], fire: ['#fff2c0', '#ffd27a', '#ff9a3c', '#ff5a12', '#ffffff'],
    gold: ['#fff6d6', '#ffe08a', '#ffc23a', '#e09a14', '#ffffff'], fullart: ['#ffffff', '#ffe98a', '#ff8ae0', '#8affd0', '#8ad8ff', '#ffd27a'] };
  // (module level: the grade reveal's PDA 10 gets the same moment)
  // o: { kind, title } to set them (the grade reveal: the PDA 10's gold and "PDA 10! GEM MINT")
  function bigMoment(c, el, op, o = {}) {
    const dia = c.material === 'diamond', plain = !isHolo(c);
    const kind = o.kind || (dia ? 'dia' : plain && c.grade === 10 ? 'g10' : c.material);
    const title = o.title || (plain && c.grade != null ? `PDA ${c.grade}!` : c.grade != null ? cardName(c) : cardName(c) + '!');
    const cv = h('canvas', { class: 'bm-cv' });
    const ov = h('div', { class: 'bigm ' + (dia || kind === 'g10' ? kind : 'fh fh-' + kind), 'aria-hidden': 'true' }, h('i', { class: 'bm-flash' }), h('i', { class: 'bm-glow' }), cv,
      h('b', { class: 'bm-t', text: title }));
    (op.closest('dialog') || op).append(ov); Sfx.hit('legendary'); op.classList.add('big'); setTimeout(() => op.classList.remove('big'), 2300);
    if (!reduced()) { sparks(cv, el.getBoundingClientRect(), BM_SPARKS[kind]); const q = op.querySelector('.op-area'); q?.classList.add('quake'); setTimeout(() => q?.classList.remove('quake'), 450); }
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
  const dealing = () => (S().wallet.unfinished || []).some((x) => x.kind === 'open'); // live: an open still being drawn or dealt
  // live: opens and gradings not finished yet (Live's sync: S().wallet.unfinished, so they survive a reload): a status
  // line each ("Drawing…", "Ready"), and what the buyer may do (deal or reveal now; after 24 hours with no draw, take
  // the packs back or the cards back ungraded). onDeal: an open's "Deal now" through the reveal (My cards).
  function progressList(host, kinds, onDeal) {
    const list = (S().wallet.unfinished || []).filter((x) => kinds.includes(x.kind));
    patch(host, JSON.stringify(list), () => put(host, list.length ? [h('h3', { class: 'ip-h', text: 'In progress' }),
      h('ul', { class: 'ip-list' }, list.map((x) => h('li', { class: 'ip' },
        h('span', { class: 'ip-t' }, h('b', { text: x.title }), h('span', { class: 'ip-s', text: x.line })),
        x.acts.length ? h('span', { class: 'ip-acts' }, x.acts.map((a) => btn(a.label, 'small' + (a.act === 'deal' ? ' primary' : ''),
          () => (a.act === 'deal' && x.kind === 'open' && onDeal ? onDeal(x) : Live.progressAct(x, a.act)), { 'data-key': `ip-${x.kind}-${x.index}-${a.act}` }))) : null)))] : []));
  }
  // one sheet, two jobs: view 'cards' = My cards (sealed packs + the whole collection); view 'open' = straight into tearing the next pack
  function openTable(opts = {}) {
    let view = opts.view === 'open' ? 'open' : 'cards';
    if (view === 'open' && !openable().length && !dealing()) { toast('No packs to open', 'bad'); return; }
    const progEl = h('div', { class: 'inprog' }), tilesEl = h('div');
    const packsEl = h('section', { class: 'packs', 'aria-label': 'Your packs' }, progEl, tilesEl);
    const stage = h('section', { class: 'stage', hidden: true, 'aria-label': 'Opening' });
    const coll = h('section', { class: 'coll', 'aria-labelledby': 'coll-h' });
    const root = h('div', { class: 'st st-table' }, packsEl, stage, coll);
    const hide = new Set(); let busy = false;
    // this visit's pulls, every pack opened one after another (not practice): after the last one, Case & grade them
    const pulled = [], pulledTags = new Map(); let prompted = false;
    const practice = !!opts.practice; let practiceRun = false; // a practice pack (fun layer: practice.js): never saved
    if (practice) root.classList.add('practice');
    const TITLE = { cards: 'My cards', open: 'Open packs', practice: 'Practice pack' };
    // live: Open packs lists the packs first (their Open button is what asks the wallet); the demo tears one at once
    const packsOff = () => view === 'open' && !LIVE;
    function setView(v) {
      view = v; packsEl.hidden = packsOff() || !stage.hidden; coll.hidden = v === 'open';
      const d = root.closest('dialog'), t = d?.querySelector('.sheet-head h2'); if (t) t.textContent = TITLE[practice ? 'practice' : v];
      d?.classList.toggle('fit', v === 'open'); // opening only: the sheet sizes to the stage (desktop)
    }

    function renderPacks() {
      const s = S();
      progressList(progEl, ['open', 'grading'], resumeLive);
      patch(tilesEl, JSON.stringify([s.sealed, s.series.no, s.series.phase, connected()]), () => drawPacks(s));
    }
    function drawPacks(s) {
      const keys = Object.keys(s.sealed).map(Number).sort((a, b) => b - a);
      const tiles = keys.filter((no) => s.sealed[no] > 0).map((no) => { // only Series you hold sealed packs of
        const n = s.sealed[no], live = no === s.series.no && s.series.phase < 4;
        let act;
        if (live) act = h('p', { class: 'lock-note', text: 'Opens when sales end' });
        else if (!n) act = h('p', { class: 'muted', text: 'All opened' });
        else if (!connected()) act = connectBtn();
        else act = h('div', { class: 'row' }, btn('Open', 'primary', () => openPacks(no, 1), { 'data-key': 'open1-' + no }),
          n > 1 ? btn(n > 10 ? 'Open 10' : `Open all (${n})`, '', () => openPacks(no, Math.min(n, 10)), { 'data-key': 'openN-' + no }) : null);
        return h('div', { class: 'ptile' + (live ? ' live' : '') + (!n ? ' empty' : '') },
          h('div', { class: 'pimg' }, h('img', { src: '../build3/pack.webp', alt: `Series ${no} pack`, width: 240, height: 336, decoding: 'async' }),
            live ? h('img', { class: 'padlock', src: '../build3/s-padlock.webp', alt: 'Locked' }) : null,
            n > 0 ? h('span', { class: 'pcount', text: '×' + n }) : null),
          h('div', { class: 'pinfo' }, h('h4', { text: `Series ${no}` }), h('p', { class: 'muted', text: n ? `${n} sealed` : 'None sealed' }), act));
      });
      if (!tiles.length) return put(tilesEl);
      put(tilesEl, h('h3', { id: 'packs-h', text: 'Your packs' }), h('p', { class: 'muted small packs-nft', text: 'A sealed pack is an NFT too: keep it sealed, collect it, or trade it unopened.' }), h('div', { class: 'ptiles' }, tiles));
    }

    function renderColl() {
      if (view === 'open' || !stage.hidden) return; // opening: the collection isn't built behind the reveal (it's drawn when shown)
      const all = S().cards.filter((c) => !hide.has(c.id));
      patch(coll, JSON.stringify([filt, all.map(tileSig), Store.collectionFloor()]), () => drawColl(all));
    }
    const FILT0 = { series: 'all', hold: 'all', mat: 'all', holo: 'any', grade: 'all' };
    const matching = (all) => all.filter((c) => (filt.series === 'all' || c.series === +filt.series) && (filt.mat === 'all' || c.material === filt.mat)
      && (filt.hold === 'all' || Store.holder(c) === filt.hold)
      && (filt.holo === 'any' || (filt.holo === 'yes' ? isHolo(c) : (c.holo || 'none') === filt.holo))
      && (filt.grade === 'all' || (filt.grade === 'none' ? c.grade == null : c.grade != null && filt.grade.split('-').map(Number).includes(c.grade))));
    const filtersOn = () => Object.keys(FILT0).filter((k) => filt[k] !== FILT0[k]).length;
    const isHolo = (c) => !!Store.ALWAYS_HOLO[c.material] || (c.holo || 'none') !== 'none';
    // one tap: sort (Newest, Best first) and one filter at a time (only what this collection has); Filter has the rest
    function quickPills(all) {
      const has = (f) => all.some(f), only = (k, v) => Object.keys(FILT0).every((x) => filt[x] === (x === k ? v : FILT0[x]));
      const pill = (t, on, fn, key) => h('button', { type: 'button', class: 'qp', 'aria-pressed': String(on), onclick: () => { fn(); renderColl(); }, 'data-q': key }, t);
      const pick = (k, v) => () => { Object.assign(filt, FILT0, { sort: filt.sort }); if (k) filt[k] = v; };
      const mats = Store.MATS.filter((m) => has((c) => c.material === m));
      return h('div', { class: 'qpills', role: 'group', 'aria-label': 'Quick filters' },
        pill('Newest', filt.sort === 'serial', () => { filt.sort = 'serial'; }, 'newest'),
        pill('Best first', filt.sort === 'rarity', () => { filt.sort = 'rarity'; }, 'best'),
        h('span', { class: 'qp-gap', 'aria-hidden': 'true' }),
        pill('All', only(null), pick(), 'all'),
        has(isHolo) ? pill('Holo', only('holo', 'yes'), pick('holo', 'yes'), 'holo') : null,
        has((c) => c.grade != null) ? pill('Slabbed', only('hold', 'slab'), pick('hold', 'slab'), 'slab') : null,
        has((c) => Store.holder(c) === 'case') ? pill('Cased', only('hold', 'case'), pick('hold', 'case'), 'case') : null,
        ...(mats.length > 1 ? mats.map((m) => pill(Store.MAT_LABEL[m], only('mat', m), pick('mat', m), m)) : []));
    }
    // the filters and sort: one "Filter" button on the collection, the choices in their own sheet (cards come first)
    function filterControls(all, after) {
      const seriesList = [...new Set(all.map((c) => c.series))].sort((a, b) => b - a);
      const sel = (key, label, opts) => h('label', { class: 'f' }, h('span', { text: label }),
        h('select', { onchange: (e) => { filt[key] = e.target.value; renderColl(); after(); }, 'data-k': key },
          opts.map(([v, t]) => h('option', { value: v, selected: String(filt[key]) === String(v) }, t))));
      const counts = { raw: 0, case: 0, slab: 0 }; all.forEach((c) => counts[Store.holder(c)]++);
      const holdSeg = h('div', { class: 'seg hold-seg', role: 'group', 'aria-label': 'Show' },
        [['all', 'All', all.length], ['raw', 'Raw', counts.raw], ['case', 'Cased', counts.case], ['slab', 'Slabbed', counts.slab]].map(([v, t, n]) =>
          h('button', { type: 'button', 'aria-pressed': String(filt.hold === v), onclick: () => { filt.hold = v; renderColl(); after(); }, 'data-v': v }, t, h('small', { text: ' ' + n }))));
      const filters = h('div', { class: 'filters' },
        sel('series', 'Series', [['all', 'All'], ...seriesList.map((n) => [n, 'Series ' + n])]),
        sel('mat', 'Material', [['all', 'All'], ...Store.MATS.map((m) => [m, Store.MAT_LABEL[m]])]),
        sel('holo', 'Holo', [['any', 'Any'], ['yes', 'Any holo'], ['none', 'None'], ['frame', 'Frame'], ['picture', 'Picture'], ['full', 'Full']]),
        sel('grade', 'Grade', [['all', 'All'], ['none', 'Not graded'], ['10', 'PDA 10'], ['9-8', 'PDA 9–8'], ['7-6', 'PDA 7–6'], ['5-4', 'PDA 5–4'], ['3-2', 'PDA 3–2'], ['1', 'PDA 1']]),
        sel('sort', 'Sort', [['serial', 'Newest'], ['rarity', 'Rarity'], ['grade', 'Grade'], ['edition', 'Print #']]));
      return [holdSeg, filters];
    }
    function openFilter() {
      const body = h('div', { class: 'st st-filter' });
      const draw = () => {
        const all = S().cards.filter((c) => !hide.has(c.id)), n = matching(all).length;
        patch(body, JSON.stringify([filt, all.length, n]), () => put(body, filterControls(all, draw),
          h('div', { class: 'row filter-act' }, filtersOn() ? btn('Clear', '', () => { Object.assign(filt, FILT0); renderColl(); draw(); }, { 'data-key': 'fclear' }) : null,
            btn(n ? `Show ${n} ${n === 1 ? 'card' : 'cards'}` : 'No cards match', 'primary', () => Sheet.close('filter'), { 'data-key': 'fshow' }))));
      };
      draw(); Sheet.open('filter', { title: 'Filter & sort', body });
    }
    function drawColl(all) {
      const sorts = {
        serial: (a, b) => b.serial - a.serial,
        rarity: (a, b) => rarity(b) - rarity(a) || b.serial - a.serial,
        grade: (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || rarity(b) - rarity(a),
        edition: (a, b) => edNum(a) - edNum(b) || rarity(b) - rarity(a),
      };
      const list = matching(all).sort(sorts[filt.sort]), on = filtersOn(), dups = dupInfo();
      const ids = list.map((c) => c.id); // the viewer swipes through the list as shown
      // copies (same character and material) show a small "×N" here; the reveal never tags them
      const grid = list.length ? h('div', { class: 'cgrid' }, list.map((c) => cardTile(c, { onTap: (card) => openDetail(card.id, ids),
          tag: dups.get(c.id)?.n > 1 ? h('span', { class: 'dupn', text: '×' + dups.get(c.id).n, 'aria-label': `${dups.get(c.id).n} copies` }) : null })))
        : all.length ? h('div', { class: 'empty-state' }, h('p', { text: 'No cards match.' }),
          btn('Clear filters', 'small', () => { Object.assign(filt, FILT0); renderColl(); }, { 'data-key': 'clear' }))
        : emptyColl();
      put(coll, h('div', { class: 'coll-h' }, h('h3', { id: 'coll-h', text: 'Your cards' }), h('span', { class: 'muted', text: list.length === all.length ? `${all.length} cards` : `${list.length} of ${all.length}` }),
        btn(on ? `Filter · ${on}` : 'Filter', 'small filter-b' + (on ? ' on' : ''), openFilter, { 'data-key': 'filter', 'aria-haspopup': 'dialog', 'aria-label': on ? `Filter and sort (${on} on)` : 'Filter and sort' }),
        h('span', { class: 'cfloor', title: 'Collection floor on OpenSea (demo number)' }, h('small', { text: 'Floor (demo)' }), h('b', { text: Store.eth(Store.collectionFloor()) })),
        btn('Pop report', 'small pop-b', () => openPop(), { 'data-key': 'pop' }), btn('Binder', 'small', () => window.Fun?.go('binder', { series: filt.series === 'all' ? null : +filt.series }), { 'data-key': 'binder' })), all.length ? quickPills(all) : null, freshNudge(all), grid);
    }
    // no cards at all: PLANK, and the way to a first pack. Packs ready to open: open one (packs only open once their
    // Series sells out); a sale on: Get a pack (the Buy flow); neither: just the line.
    function emptyColl() {
      const ready = !practice && openableCount() > 0, sale = !practice && !ready && S().series.groups?.some((g) => g.state === 'open' && !g.waiting && g.left !== 0);
      return h('div', { class: 'empty-state empty-cards' },
        h('img', { class: 'ec-plank', src: 'ui/brand/plank-256.webp', alt: '', 'aria-hidden': 'true', width: 95, height: 150 }),
        h('p', { text: dealing() ? 'Your cards are on their way.' : 'No cards yet. Open a pack!' }),
        ready ? btn('Open a pack', 'primary', () => { // as a sealed pack's own Open does
            if (LIVE) return Live.needWallet(() => openable().length && openPacks(openable()[0].series, 1));
            if (!connected()) { Store.update((s) => { s.wallet.connected = true; }); toast('Demo wallet connected', 'good'); }
            openPacks(openable()[0].series, 1); }, { 'data-key': 'empty-go' })
          : sale ? btn('Get a pack', 'primary', () => { Sheet.close('table'); window.UI?.openGroup?.(); }, { 'data-key': 'empty-go' }) : null);
    }
    const render = () => { renderPacks(); renderColl(); };
    // the fresh window: "5 cards still fresh · 3h 12m left · Case all fresh for $0.25" (the wizard, with them picked)
    function freshNudge(all) {
      const fresh = all.filter((c) => Wear.freshLeft(c) > 0).sort((a, b) => Wear.freshLeft(a) - Wear.freshLeft(b));
      if (!fresh.length) return null;
      const pick = fresh.slice(0, maxBatch()), usd = pick.reduce((a, c) => a + Store.caseUsd(c), 0), n = fresh.length;
      return h('div', { class: 'fresh-nudge' },
        h('p', {}, h('span', {}, h('b', { text: `${n} fresh ${n === 1 ? 'card' : 'cards'}` }), ` · ${Wear.hhmm(Wear.freshLeft(fresh[0]))} left`)), // one line: the detail and How say why
        h('div', { class: 'row' },
          btn('Grade', 'small', () => { Sheet.close('table'); Stations.open('grade', { pick: [] }); }, { 'data-key': 'grade-fresh' }),
          btn(pick.length < n ? `Case ${pick.length} fresh for ${Wear.usd(usd)}` : `Case all fresh for ${Wear.usd(usd)}`, 'primary small', () => {
            Sheet.close('table'); Stations.open('grade', { as: 'case', pick: pick.map((c) => c.id) });
          }, { 'data-key': 'case-fresh' })));
    }

    // ---------- opening: rip the pack, one card at a time (rarest last), then a summary of everything pulled
    const priorOf = () => { const prior = new Map(); S().cards.forEach((c) => { const k = dupKey(c); prior.set(k, (prior.get(k) || 0) + 1); }); return prior; };
    async function openPacks(series, n) {
      if (busy) return; busy = true; practiceRun = false;
      const prior = priorOf();
      if (LIVE) return openLive(series, n, prior);
      const packs = []; for (let i = 0; i < n; i++) packs.push(makePack(series));
      // test hook: window.__forcePull = [{ material: 'diamond', holo: 'full' }, ...] sets the first pack's last cards, once
      if (Array.isArray(window.__forcePull)) { window.__forcePull.forEach((o, k) => packs[0][5 - k] && Object.assign(packs[0][5 - k], o)); delete window.__forcePull; }
      let id = Math.max(999, ...S().cards.map((c) => c.id)), serial = Math.max(0, ...S().cards.map((c) => c.serial));
      packs.flat().forEach((c) => { c.id = ++id; c.serial = ++serial; }); // makePack numbers each pack from the same start
      packs.forEach((p) => p.sort((a, b) => rarity(a) - rarity(b))); // rarest last, by true odds
      const cards = packs.flat(); cards.forEach((c) => hide.add(c.id));
      Store.update((s) => { s.sealed[series] -= n; s.cards.push(...cards); Store.log(`Opened ${n === 1 ? 'a' : n} Series ${series} pack${n > 1 ? 's' : ''}`); });
      packsEl.hidden = true; stage.hidden = false; if (view === 'open') coll.hidden = true;
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
      await runOpening(series, packs, prior);
    }

    // live: an open still unfinished (In progress, after a reload): "Deal now" deals it, then the same reveal
    async function resumeLive(x, dealNow = true) {
      if (busy) return; busy = true; practiceRun = false;
      return openLive(x.fire, x.packs, priorOf(), x.index, dealNow);
    }
    // live: open on chain (or follow open `index`), wait for the draw and the deal (the stage says where it is), then the same reveal
    async function openLive(series, n, prior, index, dealNow = true) {
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite', text: 'Opening…' });
      packsEl.hidden = true; stage.hidden = false; if (view === 'open') coll.hidden = true;
      put(stage, h('div', { class: 'op-wait' }, h('img', { src: '../build3/pack.webp', alt: '', width: 240, height: 336 }), msg));
      const say = (t, a) => sayTo(msg, t, a), alive = () => root.isConnected;
      const got = index != null ? await Live.followOpen(series, index, say, alive, { dealNow }) : await Live.openPacks(series, n, say, alive);
      if (!got?.length) { busy = false; stage.hidden = true; put(stage); packsEl.hidden = packsOff(); coll.hidden = view === 'open'; render(); return; }
      const per = S().series.cardsPerPack || 6, packs = [];
      for (let i = 0; i < got.length; i += per) packs.push(got.slice(i, i + per).sort((a, b) => rarity(a) - rarity(b))); // rarest last
      got.forEach((c) => hide.add(c.id));
      Store.update(() => Store.log(`Opened ${n === 1 ? 'a' : n} Series ${series} pack${n > 1 ? 's' : ''}`));
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
      await runOpening(series, packs, prior);
    }

    // practice: one pack of sample cards, the same reveal, nothing saved (practice.js makes the cards and the summary)
    async function openPractice() {
      if (busy || !window.Fun?.practicePack) return; busy = true; practiceRun = true;
      const pack = (await Fun.practicePack()).sort((a, b) => rarity(a) - rarity(b)); // live: the current Series' cards (a short read)
      packsEl.hidden = true; coll.hidden = true; stage.hidden = false;
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
      await runOpening(pack[0].series, [pack], new Map());
    }

    async function runOpening(series, packs, prior) {
      const n = packs.length, cards = packs.flat();
      const ac = new AbortController(); let stopR; const stopP = new Promise((r) => (stopR = r));
      root.closest('dialog')?.addEventListener('close', () => { Sfx.cut(false); ac.abort(); stopR(); }, { once: true, signal: ac.signal });
      let skipped = false;
      const halted = () => skipped || ac.signal.aborted || !root.isConnected;
      const race = (p) => Promise.race([p, stopP]);
      const pause = (ms) => race(wait(ms));
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite' });
      const area = h('div', { class: 'op-area' });
      const meta = h('div', { class: 'op-meta' });
      const ctrls = h('div', { class: 'stage-ctrls' }, btn(n > 1 ? 'See all' : 'Skip', 'small skip-b', () => { skipped = true; Sfx.cut(true); stopR(); }));
      const said = h('p', { class: 'sr', 'aria-live': 'polite', 'aria-atomic': 'true' }); // screen readers: each card as it turns over
      const op = h('div', { class: 'op' }, msg, area, meta, ctrls, said);
      put(stage, op); stage.classList.add('opening');
      const tilt = holoTilt(halted, ac.signal);
      const warm = []; const warmUp = (p) => { if (p < n) warm[p] ??= preloadCards(packs[p]); }; // this pack's cards load while it's torn

      for (let p = 0; p < n && !halted(); p++) {
        put(meta); const label = n > 1 ? `Pack ${p + 1} of ${n}` : `Series ${series} pack`;
        warmUp(p);
        const from = await race(ripPack({ area, msg, label, tag: n > 1 ? `${p + 1} / ${n}` : null, halted, pause }));
        warmUp(p + 1);
        if (halted()) break;
        await race(runStack({ order: packs[p], from, area, msg, meta, op, ctrls, said, halted, pause, tilt, lastPack: p === n - 1 }));
      }
      tilt.stop(); ac.abort();
      if (!root.isConnected || !root.closest('dialog')?.open) return;
      stage.classList.remove('opening');
      if (practiceRun) return window.Fun?.practiceSummary?.(stage, cards, { again: () => { busy = false; openPractice(); }, done: () => Sheet.close('table') });
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
        put(area, pk); pk.focus({ preventScroll: true }); window.Fun?.emit('pack-shown', { el: pk, practice: practiceRun });
        // the words only until the first real pack is torn (then the dashed line and its dot say enough)
        let coached = false; try { coached = !!localStorage.getItem('omni.coached'); } catch { /* not remembered */ }
        msg.textContent = coached ? (tag ? label : '') : tag ? `${label}: tear across the top` : 'Drag across the top to tear it open';
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
          if (grain > 0.03) { grain = 0; Sfx.rip(prog); }
          if (prog >= 0.97) finish();
        };
        async function finish() {
          if (done) return; done = true; prog = 1; draw(); Sfx.ripFull(); window.Fun?.emit('tear', { practice: practiceRun });
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
    function runStack({ order, from, area, msg, meta, op, ctrls, said, halted, pause, tilt, lastPack }) {
      return new Promise((resolve) => {
        const els = order.map((c) => {
          const back = h('div', { class: 'face back2' }, h('img', { src: BACK, alt: '', draggable: 'false' }), h('i', { class: 'tease-fx', 'aria-hidden': 'true' }));
          const front = h('div', { class: 'face front' }, cardFace(c, true, true), c.holo !== 'none' && !Store.cardParts(c) ? h('i', { class: 'sheen', 'aria-hidden': 'true' }) : null); // its live holo joins when it's on top (reveal)
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
          if (last && lastPack) { const sk = ctrls.querySelector('.skip-b'); if (sk) sk.textContent = 'See all'; } // the last card: nothing left to skip
          put(meta, h('span', { class: 'op-n', text: `${i + 1} / ${order.length}` }));
          let due = 0; // Epic / Legendary: when (performance.now) the flip / flash is due, so the build-up ends on it
          const ho = isHolo(c), turn = ho ? holoArm(el) : null; // a holo shows its foil edge as soon as it's on top
          await pause(i === 0 ? 600 : 160); if (halted()) return;
          window.Fun?.emit('card-ready', { el, i, practice: practiceRun });
          if (ho) { // ...and waits for you: drag it (the edge brightens the further it goes) or tap to turn it
            msg.textContent = 'Something’s shimmering…'; el.setAttribute('aria-label', `Card ${i + 1} of ${order.length}, face down and shimmering. Press to turn it over`);
            await turn; if (halted()) return;
            if (tier) el.classList.add('ho-yield'); // Rare and up: the holo edge hands over to the tier's own glow
          }
          if (tier) { // Rare and up (by true odds): the back glows in its material before it turns (a short tease leads into the leak)
            msg.textContent = 'Something’s glowing…';
            el.classList.add('tease', 't-' + c.material);
            if (big) { const lead = TEASE_BIG + leakMs(tier === 'legendary', rm) + (tier === 'legendary' && !rm ? LEG_HOLD : 0); due = performance.now() + lead; Sfx.build(tier, lead / 1000); }
            else Sfx.tease(c.material);
            await pause(big ? TEASE_BIG : { fire: 850, charcoal: 1000, diamond: 1200, gold: 1200, fullart: 1400 }[c.material] || 800); if (halted()) return;
            if (!big) el.classList.remove('tease');
          } else if (last) msg.textContent = 'Last card…';
          const slow = big && !rm;
          if (big) { await leak(el, c, tier === 'legendary', msg, pause, due - (tier === 'legendary' && !rm ? LEG_HOLD : 0)); if (halted()) return; }
          const fc = el.querySelector('.face.front .cface');
          if (fc && !fc._holo && Store.cardParts(c) && window.Holo) Holo.attach(fc, c, true, { rock: 0.3 }); // one live card at a time (its parts were loaded during the tear)
          await faceShown(fc); if (halted()) return; // never turn over a card that isn't drawn yet
          el.classList.toggle('slow', slow); el.classList.toggle('hslow', ho && !tier && !rm); el.classList.add('flipped'); Sfx.flip();
          if (big) { el.classList.remove('tease'); el._lk?.(); }
          if ((big || ho) && rm) el.querySelector('.face.front').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
          if (ho) holoLand(el, !tier, slow, rm);
          const name = cardName(c);
          if (isHolo(c)) el.classList.add('holo-glow'); // every holo card, any material, glows on reveal
          if (tier) { el.classList.add('rare', 'burst'); if (tier !== 'legendary') Sfx.hit(tier); msg.textContent = tier === 'legendary' ? `LEGENDARY. ${name}` : tier === 'epic' ? `Epic pull! ${name}` : name + '!'; }
          else msg.textContent = isHolo(c) ? name + '!' : last ? name : 'Swipe or tap for the next card';
          const od = Store.trueOdds(c);
          put(meta, h('span', { class: 'op-n', text: `${i + 1} / ${order.length}` }), matChip(c.material), holoChip(c),
            tier ? h('span', { class: 'tier-b ' + tier, text: TIER_LABEL[tier] }) : null, tier ? h('span', { class: 'op-odds', text: od.label }) : null); // odds: Rare and up only
          said.textContent = `Card ${i + 1} of ${order.length}: ${describe(c)}${tier ? '. ' + TIER_LABEL[tier] : ''}`;
          window.Fun?.emit('flip', { card: c, tier, holo: isHolo(c), el, i, last: last && lastPack, practice: practiceRun });
          el.setAttribute('aria-label', `${describe(c)}. ${last ? (lastPack ? 'Press to see all your cards' : 'Press for the next pack') : 'Press for the next card'}`);
          if (tier === 'legendary') { await pause(slow ? Math.max(LEG_HOLD / 2, due - performance.now()) : 0); if (halted()) return; bigMoment(c, el, op); }
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
          if (drag || e.pointerType === 'mouse') tilt.aim((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height, !!drag && e.pointerType !== 'mouse'); // a live card follows the mouse itself
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
    // (its length is fixed so the build-up can be lined up to end on the flip: tease + leak [+ the Legendary's hold] before it)
    const TEASE_BIG = 520, LEG_HOLD = 700, leakMs = (leg, rm) => rm ? (leg ? 650 : 420) : (leg ? 1100 : 600);
    // flipAt: when (performance.now) the flip is due; a late start (a busy frame) is made up here so the sound stays on time
    async function leak(el, c, leg, msg, pause, flipAt) {
      const rm = reduced(), [core, glow] = LEAK[c.material], dur = leakMs(leg, rm), back = el.querySelector('.back2');
      el.style.setProperty('--lk', glow); el.style.setProperty('--lkc', core);
      const halo = h('i', { class: 'lk-halo', 'aria-hidden': 'true' }), edge = h('i', { class: 'lk-edge', 'aria-hidden': 'true' });
      el.prepend(halo); back.append(edge); el.classList.add('leak', leg ? 'lk-leg' : 'lk-epic');
      msg.textContent = leg ? 'Light’s pouring out…' : 'Something’s breaking through…';
      const anims = [];
      el._lk = () => { // on the flip: the back turns away, the halo fades
        anims.forEach((a) => a.cancel()); el.classList.remove('leak');
        halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: rm ? 300 : 1000, easing: 'ease-out', fill: 'forwards' }).finished.then(() => halo.remove(), () => {});
      };
      const left = () => Math.max(dur / 2, (flipAt || 0) - performance.now());
      if (rm) { await pause(left()); return; }
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
      await pause(left());
      const fl = h('i', { class: 'lk-flash', 'aria-hidden': 'true' }); el.append(fl);
      fl.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(.95)', offset: 0.25 }, { opacity: 0, transform: `scale(${leg ? 1.6 : 1.3})` }],
        { duration: leg ? 700 : 520, easing: 'ease-out' }).finished.then(() => fl.remove(), () => fl.remove());
    }
    // jagged seams: a few cracks from the edges across the back (viewBox 100 x 140 is the card's shape, so strokes stay even)
    function seams(n, m) {
      const NS = 'http://www.w3.org/2000/svg', sv = document.createElementNS(NS, 'svg'), id = 'lkg' + Math.random().toString(36).slice(2, 8);
      sv.setAttribute('viewBox', '0 0 100 140'); sv.setAttribute('preserveAspectRatio', 'none'); sv.setAttribute('class', 'lk-seams'); sv.setAttribute('aria-hidden', 'true');
      if (m === 'diamond' || m === 'fullart') sv.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${['#ff8ae0', '#ffe98a', '#8affd0', '#8ad8ff', '#c48aff', '#ffffff'].map((col, k) => `<stop offset="${k / 5}" stop-color="${col}"/>`).join('')}</linearGradient></defs>`;
      const crack = (x, y, a, len, seg) => { const pts = [[x, y]]; let left = len;
        while (left > 0) { a += (Math.random() - 0.5) * 1.3; const s = seg * (0.6 + Math.random() * 0.8);
          x = Math.max(1.5, Math.min(98.5, x + Math.cos(a) * s)); y = Math.max(1.5, Math.min(138.5, y + Math.sin(a) * s)); pts.push([x, y]); left -= s; // stays on the card
          a += (Math.atan2(70 - y, 50 - x) - a) * 0.18; } // drift toward the middle
        return pts; };
      const d = (pts) => 'M' + pts.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L');
      const add = (pts, k) => ['g', 'c'].forEach((cl) => { const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', d(pts)); pa.setAttribute('class', cl); pa.setAttribute('pathLength', '1');
        if (cl === 'g' && (m === 'diamond' || m === 'fullart')) pa.setAttribute('stroke', `url(#${id})`); pa.dataset.d = k; sv.append(pa); });
      for (let k = 0; k < n; k++) {
        const side = k % 4, u = 0.15 + Math.random() * 0.7; // from each edge in turn, aimed inward
        const [x, y, a] = side === 0 ? [u * 100, 0, Math.PI / 2] : side === 1 ? [100, u * 140, Math.PI] : side === 2 ? [u * 100, 140, -Math.PI / 2] : [0, u * 140, 0];
        const pts = crack(x, y, a + (Math.random() - 0.5) * 0.9, 36 + Math.random() * 40, 6); add(pts, k / n);
        if (Math.random() < 0.7) { const j = 2 + Math.floor(Math.random() * (pts.length - 3)), [bx, by] = pts[Math.max(1, j)]; add(crack(bx, by, a + (Math.random() < 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.6), 12 + Math.random() * 16, 4), k / n + 0.25); }
      }
      return sv;
    }

    // holo: pointer or device tilt moves a rainbow sheen across the card and tips it a little. A live card (holo.js) leans
    // and shines itself from one smoothed value (mouse, finger, device tilt via gyro.js): here it only gets the finger
    // while a drag holds the pointer (the card then never sees the moves). The old CSS sheen (a card with no live parts) is
    // tipped here, eased the same way.
    function holoTilt(halted, signal) {
      let s = null;
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') // never prompt for motion access
        addEventListener('deviceorientation', (e) => { if (e.gamma != null && s && !s.face) aim(0.5 + Math.max(-0.5, Math.min(0.5, e.gamma / 50)), 0.5 + Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 50))); }, { signal });
      function aim(x, y, drag = true) {
        if (!s) return;
        if (s.face) { if (drag) window.Holo?.aim(s.face, x * 2 - 1, y * 2 - 1); return; }
        s.tx = Math.max(0, Math.min(1, x)); s.ty = Math.max(0, Math.min(1, y)); s.last = performance.now();
      }
      function stop() { if (!s) return; cancelAnimationFrame(s.raf); if (s.t) s.t.style.transform = ''; s = null; }
      function start(el) {
        stop(); const t = el.querySelector('.sc-tilt'), face = el.querySelector('.cface.live');
        if (face?._holo) { s = { face }; return; } // one source of truth: the live card's own
        s = { t, x: 0.2, y: 0.3, tx: 0.2, ty: 0.3, last: 0, t0: performance.now(), raf: 0 };
        const loop = (now) => {
          if (!s || s.t !== t || halted() || !t.isConnected) return;
          if (now - s.last > 1800 && !reduced()) { const a = (now - s.t0) / 1000; s.tx = 0.5 + Math.sin(a * 1.4 - 1.2) * 0.38; s.ty = 0.5 + Math.cos(a * 0.9) * 0.25; }
          s.x += (s.tx - s.x) * 0.1; s.y += (s.ty - s.y) * 0.1;
          t.style.setProperty('--mx', s.x.toFixed(3)); t.style.setProperty('--my', s.y.toFixed(3));
          if (!reduced()) t.style.transform = `rotateY(${((s.x - 0.5) * 16).toFixed(2)}deg) rotateX(${((0.5 - s.y) * 13).toFixed(2)}deg)`;
          s.raf = requestAnimationFrame(loop);
        };
        s.raf = requestAnimationFrame(loop);
      }
      return { start, stop, aim };
    }

    // after the pulls: a celebration first. The best card big, every pull small (tagged New only: copies are counted in
    // My cards), then the main button: Open next (packs left) or Done; Share and My cards beside it. Case & grade is one
    // small line that opens the wizard (the Case & grade station's) over these cards. After the last pack (none left, or
    // Done) it goes straight to Case & grade with everything pulled this visit, a short how-it-works on top.
    function summary(series, cards, prior) {
      const seen = new Map(prior), tags = new Map();
      cards.forEach((c) => { const k = dupKey(c); if (!seen.get(k)) tags.set(c.id, h('span', { class: 'new-t', text: 'New' })); seen.set(k, (seen.get(k) || 0) + 1); });
      cards.forEach((c) => hide.delete(c.id));
      pulled.push(...cards); tags.forEach((t, id) => pulledTags.set(id, t));
      const fresh = () => pulled.map((c) => byId(c.id)).filter((c) => c && c.grade == null && !c.pending && !c.cased);
      const rank = (a, b) => rarity(b) - rarity(a) || HRANK[b.holo || 'none'] - HRANK[a.holo || 'none'] || b.serial - a.serial; // one ranking for Best and Share
      const best = [...cards].sort(rank)[0];
      const close = () => { busy = false; stage.hidden = true; stage.classList.remove('opening'); packsEl.hidden = packsOff(); put(stage); render(); };
      const seeAll = () => { close(); setView('cards'); renderColl(); root.closest('.sheet-body')?.scrollTo({ top: 0 }); coll.querySelector('h3')?.setAttribute('tabindex', '-1'); coll.querySelector('h3')?.focus({ preventScroll: true }); };
      const more = openable(), left = more.reduce((a, o) => a + o.n, 0);
      const nextSeries = (more.find((o) => o.series === series) || more[0])?.series; // same Series first, then the oldest
      const canNext = left > 0 && connected();
      const next = () => { busy = false; openPacks(nextSeries, 1); };
      const closeAll = () => { close(); Sheet.close('table'); };
      const finish = () => (!prompted && fresh().length ? wizard(true) : closeAll()); // the last pack done: Case & grade first
      const host = h('div', { class: 'op-sum' }); put(stage, host);
      const ps = window.Fun?.packShare?.(cards, series); // the whole pack as one image
      const celebrate = () => {
        const od = Store.trueOdds(best), tier = tierOf(best), ids = cards.map((c) => c.id);
        const caseable = cards.filter((c) => c.grade == null && !c.pending && !c.cased), caseUsd = caseable.reduce((a, c) => a + Store.caseUsd(c), 0);
        put(host, h('div', { class: 'cel' + (tier ? ' t-' + tier : '') },
          h('h3', { class: 'cel-k', text: CEL_HEAD[tier] || (cards.length > 6 ? `Your ${cards.length} cards` : 'Your pulls') }),
          h('div', { class: 'cel-best', style: `--glow:${GLOW[best.material]}` },
            h('button', { type: 'button', class: 'cel-big', 'aria-label': `Best: ${describe(best)}. See it`, onclick: () => openDetail(best.id, ids) }, cardFace(best, false, true)),
            h('div', { class: 'cel-name' }, h('small', { text: 'Best pull' }), h('b', { text: best.character }), h('span', { text: cardName(best) }),
              h('span', { class: 'row' }, tier ? h('span', { class: 'tier-b ' + tier, text: TIER_LABEL[tier] }) : null, od.label ? h('span', { class: 'op-odds', text: od.label }) : null))),
          h('ul', { class: 'cel-pulls', 'aria-label': 'Everything you pulled' }, cards.map((c) => h('li', {},
            h('button', { type: 'button', class: 'cel-c' + (c === best ? ' best' : ''), 'aria-label': describe(c) + (tags.has(c.id) ? '. New' : ''), onclick: () => openDetail(c.id, ids) },
              cardFace(c, true), tags.get(c.id)?.cloneNode(true) || null)))),
          h('div', { class: 'cel-acts' },
            canNext ? btn(`Open next (${left})`, 'gold big', next, { 'data-key': 'next' }) : btn('Done', 'primary big', finish, { 'data-key': 'done' }),
            h('div', { class: 'row' }, shareBtn(best, '', 'Share best'), clipBtn(best), window.Rip?.button(cards, series) || null, ps || null, btn('My cards', '', seeAll, { 'data-key': 'mycards' }), canNext ? btn('Done', '', finish, { 'data-key': 'done2' }) : null)),
          caseable.length ? h('p', { class: 'cel-protect' }, btn('Case & grade them', 'linkish', wizard, { 'data-key': 'protect' }),
            h('span', { class: 'muted', text: ` · case all ${caseable.length} for ${Wear.usd(caseUsd)}, grade for ${Wear.usd(Store.PRICES.GRADE_USD)} each` })) : null));
        host.querySelector('.cel-acts .btn.big')?.focus({ preventScroll: true });
      };
      // after: the last pack (how it works on top, and "Not now"), over everything pulled this visit; else this pack's cards
      function wizard(after = false) {
        if (after) prompted = true;
        const P = Store.PRICES, mine = after ? pulled : cards;
        const head = h('div', { class: 'op-sum-h' }, btn('‹ Your pulls', 'small', () => { celebrate(); root.closest('.sheet-body')?.scrollTo({ top: 0 }); }, { 'data-key': 'pulls' }),
          after ? btn('Not now', 'small', closeAll, { 'data-key': 'notnow' }) : null);
        const intro = after ? Wear.nowOrNever() : null;
        protectFlow(host, { cards: mine, tags: after ? pulledTags : tags, head, intro, done: () => [btn('Done', 'primary', closeAll),
          canNext ? btn(`Open next (${left})`, 'gold', next) : null, btn('My cards', '', seeAll)] });
        root.closest('.sheet-body')?.scrollTo({ top: 0 });
      }
      if (!canNext && fresh().length) wizard(true); // no packs left: straight to Case & grade (the pulls are a tap back)
      else celebrate();
      window.Fun?.emit('opened', { host, cards, series, packs: Math.max(1, Math.round(cards.length / (S().series.cardsPerPack || 6))) });
      Store.update(() => {}); // let the shell refresh counts
      root.closest('.sheet-body')?.scrollTo({ top: 0 });
    }

    listen('table', render);
    Sheet.open('table', { title: TITLE[view], body: root, wide: true, onClose: () => unlisten('table') });
    setView(view); render();
    if (practice) { setView('open'); return openPractice(); }
    if (view === 'open') { // straight to the table: the oldest Series' next pack (demo: connects the demo wallet if needed)
      if (LIVE) { // an open still waiting on its draw: back to its waiting screen (no new transaction); else the packs list
        const going = (S().wallet.unfinished || []).find((x) => x.kind === 'open');
        return going ? resumeLive(going, false) : Live.needWallet(() => {});
      }
      if (!connected()) { Store.update((s) => { s.wallet.connected = true; }); toast('Demo wallet connected', 'good'); }
      openPacks(openable()[0].series, 1);
    }
  }

  // card detail: bigger card, its true odds and demo floor, all traits, quick actions, OpenSea.
  // ids: the list it was opened from (the full-screen viewer swipes through it)
  function openDetail(id, ids) {
    const c = byId(id); if (!c) return;
    const od = Store.trueOdds(c);
    const frozenAt = (ms) => { const d = Math.floor(ms / Store.DAY); return d < 1 ? 'under a day' : `${d.toLocaleString('en-US')} ${d === 1 ? 'day' : 'days'}`; };
    const traits = [['Character', c.character], ['Category', Store.CHARS[c.character]?.category || c.category || '—'], ['Material', Store.MAT_LABEL[c.material]], ['Holo', HOLO[c.holo || 'none']], ['Series', 'Series ' + c.series],
      // print number: the k-th of this exact card ever pulled ("#k", never "of N"); the serial counts every card
      ['Print number', Store.printNo(c) ? '#' + Store.printNo(c) : '—'], ['Serial', '#' + c.serial],
      ['Grade', c.pending ? 'Grading…' : c.grade == null ? 'None' : `PDA ${c.grade} · ${Wear.WORD[c.grade]}`],
      // what an ungraded card's metadata shows (its condition stays hidden); a slab shows only its grade
      // (docs/grading.md: a fixed Dealt date, plus the age frozen when it was cased)
      ...(c.grade == null ? [['Cased', c.cased ? `Cased · ${frozenAt(c.frozenAge)} old` : 'No'], ['Dealt', new Date(c.dealtAt ?? c.dealt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })],
        ['Moves', String(Math.min(c.moves, 10))]] : [])];
    // a slab's line in the pop report: "1 of 3 Gold PDA 10s" (read once the report is in)
    const popDd = c.grade != null ? h('dd', { class: 'pop-line', text: '…' }) : null;
    if (popDd) Store.popReport().then((pop) => {
      const n = pop?.[c.series]?.[c.material]?.[c.grade] || 1, what = `${Store.MAT_LABEL[c.material]} PDA ${c.grade}`;
      popDd.replaceChildren(btn(n === 1 ? `The only ${what} in Series ${c.series}` : `1 of ${n} ${what}s in Series ${c.series}`, 'linkish', () => openPop({ series: c.series, mat: c.material, grade: c.grade }), { 'data-key': 'popline' }));
    }, () => { popDd.textContent = 'Couldn’t load the pop report. Try again.'; });
    const goto = (name, o = {}) => { Sheet.close('card'); Sheet.close('table'); Stations.open(name, { pick: [c.id], ...o }); };
    const canGrade = c.grade == null && !c.pending, canCase = canGrade && !c.cased;
    const sea = (label, href, extra) => h('a', { class: 'btn sea', href, target: '_blank', rel: 'noopener', ...extra }, label, h('span', { 'aria-hidden': 'true', text: '↗' }));
    const face = cardFace(c, false, true);
    const upside = window.Info?.upsideDown?.(c.material, c.holo || 'none'); // a full holo Paper, a plain Coal…
    const zoom = () => viewCard(c, ids);
    const body = h('div', { class: 'detail' },
      h('div', { class: 'big' }, h('div', { class: 'cwrap', onclick: (e) => { if (!e.target.closest('button')) zoom(); } }, face, gradeBadge(c),
        window.Zoom ? Zoom.expandButton(`View ${c.character} full screen`, zoom) : null), clipBtn(c, 'small big-clip')),
      h('div', { class: 'traits' },
        h('div', { class: 'cmeta' }, matChip(c.material), holoChip(c), od.tier ? h('span', { class: 'tier-b ' + od.tier, text: TIER_LABEL[od.tier] }) : null),
        upside ? h('p', { class: 'upside-b' }, h('b', { text: 'Upside-down rare' }), ` · about 1 in ${Info.oneIn(upside.p)} cards`) : null,
        h('div', { class: 'dstats' },
          h('div', { class: 'dodds' }, h('small', { text: c.grade != null ? 'Odds with grade' : 'Pull odds' }), h('b', { text: od.label })),
          h('div', { class: 'dfloor' }, h('small', { text: 'Floor (demo)' }), h('b', { text: floorTxt(c) }))),
        // the actions first, right under the card (they stick to the bottom of the sheet on a short screen); the traits fold away
        h('div', { class: 'row dacts' },
          c.grade == null ? btn(`Grade · ${Wear.usd(Store.PRICES.GRADE_USD)}`, 'primary', () => goto('grade', { as: 'grade' }), { disabled: !canGrade }) : null, // slabbed: final, nothing to do
          c.grade == null ? btn(`Case · ${Wear.usd(Store.PRICES.CASE_USD)}`, '', () => goto('grade', { as: 'case' }), { disabled: !canCase }) : null,
          btn('Burn', '', () => goto('burn'), { disabled: c.pending }),
          shareBtn(c)),
        canGradeNow(c) ? (c.cased ? nowBar(c, true, 'If graded now (cased)') : oddsClock(c, () => goto('grade', { as: 'case' }), canCase)) : null,
        h('details', { class: 'dmore' }, h('summary', { text: 'Details' }),
          h('dl', {}, traits.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]), popDd ? [h('dt', { text: 'Pop' }), popDd] : null)),
        h('div', { class: 'row' }, // demo: the placeholder collection; live: only once the network's collection is set (Store.openSeaItem)
          Store.openSeaItem(c) ? sea('OpenSea', Store.openSeaItem(c), { 'aria-label': 'OpenSea: view, buy or list (opens a new tab)' }) : null, btn('Binder', '', () => window.Fun?.go('binder', { series: c.series, at: c.id }))),
        Wear.howPill(),
        LIVE ? null : h('p', { class: 'muted small', text: 'Demo floors. OpenSea links are placeholders.' })));
    const d = document.getElementById('sheet-card'), opener = d?.open ? d._opener : null;
    Sheet.open('card', { title: c.character, body });
    if (opener) d._opener = opener; // swapped from the viewer: focus still goes back to the tile it came from
  }

  // the full-screen viewer (zoom.js) over the card detail: swipes through the list the detail came from, and the detail
  // follows along, so closing lands on the card last shown
  function viewCard(c, ids) {
    if (!window.Zoom) return;
    const cards = (ids && ids.includes(c.id) ? ids : [c.id]).map(byId).filter(Boolean);
    const bigFace = () => document.querySelector('#sheet-card[open] .detail .big .cface');
    Zoom.open({ cards, index: cards.indexOf(cards.find((x) => x.id === c.id)), from: bigFace,
      face: (x) => cardFace(x, false, true), name: (x) => `${x.character}, ${cardName(x)}`,
      onNav: (x) => { openDetail(x.id, ids); const f = bigFace(); if (f) window.Holo?.hold(f, true); } }); // the detail behind waits, still
  }

  // the odds clock (a raw card's detail): its grade odds if graded now, in 30 days and in 6 months (Wear.odds on its
  // age, moves as they are), by band, and "Case now to freeze these odds"
  function oddsClock(c, onCase, canCase) {
    const age = Wear.ageSecOf(c), DAYS = [['Now', 0], ['30 days', 30], ['6 months', 182]];
    const cols = DAYS.map(([l, d]) => ({ l, b: Wear.bandOdds(Wear.odds(age + d * 86400, c.moves)) }));
    const rows = Wear.BANDS.map((band, i) => ({ band, i })).filter(({ i }) => cols.some((x) => x.b[i].p >= 0.001));
    const says = cols.map((x) => saysOf(x.b.filter((b) => b.p >= 0.001), x.l)).join('. ');
    return h('div', { class: 'gclock' },
      h('table', { class: 'gclock-t', 'aria-label': 'Grade odds over time. ' + says },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'PDA' }), cols.map((x, k) => h('th', { scope: 'col', class: k ? '' : 'now' }, x.l, bandBar(x.b.filter((b) => b.p >= 0.001)))))),
        h('tbody', {}, rows.map(({ band, i }) => h('tr', {}, h('th', { scope: 'row' }, h('i', { style: `background:${band.c}` }), band.g),
          cols.map((x, k) => h('td', { class: k ? '' : 'now', text: Wear.pct(x.b[i].p) })))))),
      h('p', { class: 'gclock-note muted small', text: 'Raw cards wear over time. Moves can cost a grade.' }),
      canCase ? btn(`Lock these odds · ${Wear.usd(Store.caseUsd(c))}`, 'gclock-case', onCase) : null);
  }

  // the pop report: how many slabs of each grade exist, per Series, by material (Store.popReport: live from FirePsa's
  // Graded events, the demo from demo data). at: { series, mat, grade } highlights that line (from a slab's detail).
  function openPop(at = {}) {
    const root = h('div', { class: 'st st-pop' }, h('p', { class: 'muted', text: 'Reading the slabs…' }));
    Sheet.open('pop', { title: 'Pop report', body: root, wide: true });
    Store.popReport().then((pop) => {
      const series = Object.keys(pop || {}).map(Number).sort((a, b) => b - a);
      if (!series.length) return put(root, h('p', { class: 'slead', text: 'No slabs yet.' }), h('p', { class: 'muted', text: 'Graded cards show up here.' }));
      const G = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], MATS = Store.MATS;
      put(root, h('p', { class: 'muted', text: 'Every slab, by grade. Burned ones don’t count.' }),
        series.map((no) => {
          const per = pop[no], mats = MATS.filter((m) => per[m]), sum = (m) => G.reduce((a, g) => a + (per[m][g] || 0), 0);
          return h('section', { class: 'pop-s' }, h('h3', {}, `Series ${no} `, h('small', { class: 'muted', text: `${mats.reduce((a, m) => a + sum(m), 0).toLocaleString('en-US')} slabs` })),
            h('div', { class: 'pop-wrap', tabindex: '0', role: 'region', 'aria-label': `Series ${no} pop report` }, h('table', { class: 'pop-t' },
              h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Material' }), G.map((g) => h('th', { scope: 'col', class: 'pg', style: `--c:${Wear.bandOf(g).c}`, title: Wear.WORD[g], text: String(g) })), h('th', { scope: 'col', text: 'All' }))),
              h('tbody', {}, mats.map((m) => h('tr', { class: at.series === no && at.mat === m ? 'at' : '' }, h('th', { scope: 'row' }, matChip(m)),
                G.map((g) => { const n = per[m][g] || 0; return h('td', { class: (n ? '' : 'z') + (at.series === no && at.mat === m && at.grade === g ? ' at' : ''), text: n ? n.toLocaleString('en-US') : '·' }); }),
                h('td', { class: 'all', text: sum(m).toLocaleString('en-US') })))))));
        }),
        LIVE ? null : h('p', { class: 'demo-line', text: 'Demo numbers' }));
      root.querySelector('td.at')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, () => put(root, h('p', { class: 'warn', text: 'Couldn’t load the pop report. Try again.' })));
  }

  // =====================================================================================
  // 2. Case & grade: the wizard (after every opening, and the Case & grade station)
  //    1 Grade picks -> 2 Case picks (cards going to the grader greyed out) -> 3 Review, one payment -> cases slide on -> the grader
  // =====================================================================================
  // the fresh odds by band (FirePsa, fixed forever for every Series: 10 to 7 only), titled for what they are: a card in
  // its first 24 hours. Older cards have their own odds (the bar under each card, and "Your picks" below).
  function oddsChart() {
    const bands = Wear.bandOdds(Wear.FRESH), max = Math.max(...bands.map((b) => b.p));
    return h('figure', { class: 'odds' },
      h('figcaption', { class: 'odds-t', text: 'Fresh card odds' }),
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Grade odds for a fresh card, its first 24 hours: ' + bands.map((b) => `PDA ${b.g} ${b.p ? Wear.pct(b.p) : 'never'}`).join(', ') },
        bands.map((b) => h('div', { class: 'bar' + (b.g === '10' ? ' top' : '') + (b.p ? '' : ' nil'), style: `--c:${b.c}` },
          h('span', { class: 'pct', text: b.p ? Wear.pct(b.p) : '—' }), h('i', { style: `height:${b.p ? Math.max(3, b.p / max * 56) : 0}px` }), h('span', { class: 'lbl', text: b.g })))),
      h('p', { class: 'odds-cap', text: Wear.FRESH_ODDS }));
  }
  let coin = 'ETH'; // last coin picked to pay with (ETH first)
  const STEPS = [['grade', 'Grade'], ['case', 'Case'], ['review', 'Review']];
  /** The wizard, drawn into `host`. cards: the cards on offer. pre: { grade: [ids], case: [ids] }, start: first step.
   *  tags: id -> a tag element (New / Duplicate), head: an element above the steps, done(el): buttons for the last screen.
   *  station: opened from Case & grade (no "Keep all raw"; nothing picked, the primary waits and "Skip to cases" is secondary). */
  // the slabbed card, drawn under a card that's being graded (same box, hidden) and decoded before its reveal: show()
  // puts it on top in one frame (the press calls it at its thunk), fade() crosses to it; the old face goes once the slab
  // has drawn, so the card is on screen the whole time
  function slabUnder(w, c) {
    const wrap = w.querySelector('.cwrap'), old = [...wrap.querySelectorAll('.cface')], face = cardFace(c);
    face.classList.add('slab-next'); wrap.append(face);
    const img = face.querySelector('.cframe');
    const ready = Promise.race([Promise.all([img.decode ? img.decode().catch(() => {}) : null, face._ready]), wait(4000)]);
    let shown = false;
    const show = () => {
      if (shown) return; shown = true;
      face.style.opacity = '1'; window.Sound?.play('grade-stamp', { gap: 60 });
      ready.then(() => { old.forEach((f) => f.remove()); face.classList.remove('slab-next'); face.style.opacity = ''; });
    };
    const fade = () => face.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' }).finished.catch(() => {}).then(show);
    return { ready, show, fade };
  }
  // graded results, best first: the higher grade, then the rarer card type (Full Art, Gold, Diamond, Coal, Fire, Wood,
  // Paper), then the holo, then the rarer card
  const MAT_RANK = { fullart: 6, gold: 5, diamond: 4, charcoal: 3, fire: 2, wood: 1, paper: 0 };
  const bestFirst = (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || (MAT_RANK[b.material] ?? 0) - (MAT_RANK[a.material] ?? 0)
    || HRANK[b.holo || 'none'] - HRANK[a.holo || 'none'] || rarity(b) - rarity(a);
  /** Re-order revealed slab tiles (in their grid) best first, animating each from where it was (FLIP). list: [{ w, c }] */
  function rankSlabs(list) {
    const grid = list[0]?.w.parentElement; if (!grid) return Promise.resolve();
    const sorted = [...list].sort((x, y) => bestFirst(x.c, y.c));
    if (sorted.every((x, i) => grid.children[i] === x.w)) return Promise.resolve();
    const before = new Map(list.map(({ w }) => [w, w.getBoundingClientRect()]));
    sorted.forEach(({ w }) => grid.append(w));
    if (reduced() || !grid.animate) return Promise.resolve();
    return Promise.all(sorted.map(({ w }) => {
      const a = before.get(w), b = w.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return null;
      return w.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.7,.2,1)' }).finished.catch(() => {});
    }));
  }
  function protectFlow(host, { cards, pre = {}, start = 'grade', tags = new Map(), head = null, intro = null, done = () => [], station = false }) {
    const P = Store.PRICES;
    const canGrade = (c) => c && c.grade == null && !c.pending;
    const canCase = (c) => canGrade(c) && !c.cased;
    // one payment takes at most maxBatch cards, cases and grades together
    const gSel = new Set((pre.grade || []).filter((id) => canGrade(byId(id))).slice(0, maxBatch()));
    const cSel = new Set((pre.case || []).filter((id) => canCase(byId(id)) && !gSel.has(id)).slice(0, maxBatch() - gSel.size));
    const room = () => maxBatch() - gSel.size - cSel.size;
    const full = () => toast(`Up to ${maxBatch()} cards a payment`, 'bad');
    let step = start;
    const list = () => cards.map((c) => byId(c.id)).filter(Boolean);
    // dollars: one case price and one grading price for every card
    const usdOf = (ids, f) => [...ids].reduce((a, id) => a + f(byId(id)), 0);
    const total = () => usdOf(gSel, Store.gradeUsd) + usdOf(cSel, Store.caseUsd);
    const howMany = (ids, f) => { const v = new Set(ids.map((id) => f(byId(id)))); return v.size === 1 ? `${ids.length} × ${Wear.usd([...v][0])}` : `${ids.length} cards · ${Wear.usd(usdOf(ids, f))}`; };
    const tick = setInterval(() => { if (!host.isConnected) return clearInterval(tick); host.querySelectorAll('[data-fresh]').forEach(paintFresh); }, 30000);
    // "3 fresh cards · 22h 59m left. Case now to stop wear."; on a phone it folds into the step row
    function paintFresh(el) {
      const ms = list().map(Wear.freshLeft).filter((x) => x > 0).sort((a, b) => a - b);
      el.hidden = !ms.length; if (!ms.length) return;
      const n = ms.length, lo = ms[0];
      put(el, h('span', { class: 'wz-fresh-long' }, h('b', { text: `${n} fresh ${n === 1 ? 'card' : 'cards'}` }), ' · ', h('b', { class: 't', text: Wear.hhmm(lo) }),
        ' left. Case now to stop wear.'),
      h('span', { class: 'wz-fresh-short', 'aria-hidden': 'true' }, h('b', { text: `${n} fresh` }), ' · ', h('b', { class: 't', text: Wear.hhmm(lo) })));
    }
    function top() {
      const at = STEPS.findIndex(([k]) => k === step);
      const fresh = h('p', { class: 'wz-fresh', 'data-fresh': '' });
      paintFresh(fresh);
      return h('div', { class: 'wz-top' },
        head, step === start ? intro : null,
        h('div', { class: 'wz-bar' },
          h('ol', { class: 'wz-steps', 'aria-label': 'Steps' }, STEPS.map(([k, t], i) => h('li', { class: i < at ? 'done' : i === at ? 'now' : '', 'aria-current': i === at ? 'step' : null },
            h('span', { class: 'wz-n', text: String(i + 1) }), t))),
          fresh, Wear.howPill()));
    }
    function quick(sel, ok) {
      const pick = (f) => {
        const want = list().filter((c) => ok(c) && f(c) && !sel.has(c.id));
        want.forEach((c) => { if (room() > 0) sel.add(c.id); });
        if (want.some((c) => !sel.has(c.id))) full(); // the rest wait for another payment
        render();
      };
      return h('div', { class: 'wz-quick' },
        btn('All holos', 'small', () => pick(isHolo)),
        btn('Rare & up', 'small', () => pick((c) => !!tierOf(c))),
        step === 'case' ? btn('All the rest', 'small', () => pick(() => true)) : null,
        step === 'case' && list().some((c) => ok(c) && Wear.freshLeft(c) > 0) ? btn('All fresh', 'small', () => pick((c) => Wear.freshLeft(c) > 0)) : null,
        sel.size ? btn('Clear', 'small ghost', () => { sel.clear(); render(); }) : null);
    }
    function grid(sel, ok, why) {
      return h('div', { class: 'cgrid wz-grid' }, list().map((c) => {
        const able = ok(c), w = why(c);
        const t = cardTile(c, { selectable: able, selected: sel.has(c.id), tag: tags.get(c.id)?.cloneNode(true), noFresh: true, onTap: (card, el) => { // the banner shows the fresh time
          if (!able) return;
          if (sel.has(card.id)) sel.delete(card.id); else if (room() <= 0) return full(); else sel.add(card.id);
          el.setAttribute('aria-pressed', String(sel.has(card.id))); paintFoot();
        } });
        if (!able) { t.classList.add('off'); t.setAttribute('aria-disabled', 'true'); if (w) t.querySelector('.cwrap').append(h('span', { class: 'wz-why', text: w })); }
        return t;
      }));
    }
    // the grade picks' own odds, together: what one of them grades on average if graded now, and the chance of a PDA 10
    let picksEl = null;
    function paintPicks() {
      if (!picksEl) return;
      const ids = [...gSel];
      if (!ids.length) return put(picksEl, h('p', { class: 'muted small', text: 'Pick cards to see their odds.' }));
      const os = ids.map((id) => oddsNow(byId(id))), share = (o, i) => o[i] / (o.reduce((a, b) => a + b, 0) || 1);
      const any10 = 1 - os.reduce((a, o) => a * (1 - share(o, 9)), 1);
      put(picksEl, bandBar(bandsOf(Wear.mixOdds(os)), { full: true, caption: ids.length === 1 ? 'Your pick, if graded now' : 'Your picks, if graded now (average)' }),
        h('p', { class: 'small', text: ids.length === 1 ? `PDA 10: ${Wear.pct(any10)}` : `At least one PDA 10: ${Wear.pct(any10)}` }));
    }
    let foot;
    function paintFoot() {
      if (!foot) return;
      paintPicks();
      const sel = step === 'grade' ? gSel : cSel, n = sel.size, each = step === 'grade' ? P.GRADE_USD : P.CASE_USD, usd = usdOf(sel, step === 'grade' ? Store.gradeUsd : Store.caseUsd);
      const next = step === 'grade' ? (gSel.size ? btn('Next: cases', 'primary', () => go('case'))
          : station ? [btn('Skip to cases', '', () => go('case')), btn('Next', 'primary', null, { disabled: true })] // came to grade: the primary waits for a pick
          : btn('Skip grading', 'primary', () => go('case')))
        : btn(gSel.size + cSel.size ? 'Next: review' : 'Skip cases', 'primary', () => go('review'));
      const keepRaw = station ? null : btn('Keep all raw', '', () => finish([], [])); // one tap, straight to the end, nothing paid
      put(foot, h('div', { class: 'fsum' }, h('b', { text: n ? `${n} picked · ${Wear.usd(usd)}` : 'None picked' }),
        h('span', { class: 'muted', text: `${Wear.usd(each)} each · max ${maxBatch()}` })),
        h('div', { class: 'row' }, step === 'case' ? btn('Back', '', () => go('grade')) : null, keepRaw, next));
    }
    function go(k) { step = k; render(); host.closest('.sheet-body')?.scrollTo({ top: 0 }); }
    function render() {
      if (step === 'work') return;
      foot = h('div', { class: 'foot' }); picksEl = null;
      if (step === 'grade') {
        picksEl = h('div', { class: 'wz-picks', 'aria-live': 'polite' });
        put(host, h('div', { class: 'wz' }, top(),
          h('div', { class: 'wz-ask' }, h('h3', { text: 'Grade any now?' }),
            h('p', { class: 'muted', text: `${Wear.usd(P.GRADE_USD)} each. See the grade, get a slab.` }),
            // right after opening: the cards first, the odds chart a tap away
            intro ? h('details', { class: 'wz-oddsd' }, h('summary', { text: 'Fresh card odds' }), oddsChart()) : oddsChart()),
          picksEl, quick(gSel, canGrade), grid(gSel, canGrade, (c) => (c.grade != null ? 'Slabbed' : null)), foot));
      } else if (step === 'case') {
        [...cSel].forEach((id) => { if (gSel.has(id)) cSel.delete(id); });
        const ok = (c) => canCase(c) && !gSel.has(c.id);
        put(host, h('div', { class: 'wz' }, top(),
          h('div', { class: 'wz-ask' }, h('h3', { text: 'Case any?' }),
            h('p', { class: 'muted', text: `${Wear.usd(P.CASE_USD)} each. Stops wear. Grade any time.` })),
          quick(cSel, ok), grid(cSel, ok, (c) => (gSel.has(c.id) ? 'Grade' : c.grade != null ? 'Slabbed' : c.cased ? 'Already cased' : null)), foot));
      } else return review();
      paintFoot();
    }
    // withOdds: each card going to the grader shows its own "now" odds (a mini bar and its PDA 10 chance)
    function thumbs(ids, label, withOdds = false) {
      return h('ul', { class: 'wz-thumbs', 'aria-label': label }, ids.map((id) => { const c = byId(id);
        const b = withOdds ? nowBands(c) : null, p10 = withOdds ? Wear.bandOdds(oddsNow(c))[0].p : 0;
        return h('li', { title: withOdds ? saysOf(b) : null }, h('div', { class: 'cwrap' }, cardFace(c, true)), h('span', { class: 'gt-name', text: c.character }),
          withOdds ? [bandBar(b), h('span', { class: 'gt-odds' }, h('span', { class: 'sr', text: 'Chance of ' }), 'PDA 10 · ', h('b', { text: Wear.pct(p10) }))] : null); }));
    }
    // live: the price is FirePsa.quote for these cards in this coin (re-read every 15 s while the review is open), and
    // the payment is capped at it + 3%; the wallet must hold that (Live.walletNeeds). liveQ: the Amount, null while
    // loading, false when unavailable.
    let liveQ = null, liveKey = '', liveArgs = null;
    function fetchQ(key, cs, g, k) {
      liveArgs = [key, cs, g, k];
      Live.quoteProtect(cs, g, k).then((q) => {
        if (key !== liveKey || step !== 'review' || !host.isConnected) return;
        const v = q || false; if (JSON.stringify(v) !== JSON.stringify(liveQ)) { liveQ = v; review(); }
      });
    }
    const qTick = LIVE ? setInterval(() => { if (!host.isConnected) return clearInterval(qTick); if (step === 'review' && liveArgs && !document.hidden) fetchQ(...liveArgs); }, 15000) : 0;
    function review() {
      const g = [...gSel], cs = [...cSel], raw = list().filter((c) => canCase(c) && !gSel.has(c.id) && !cSel.has(c.id));
      const coins = Wear.coins();
      if (!coins.includes(coin)) coin = 'ETH';
      const usd = total(), key = `${cs.join(',')}|${g.join(',')}|${coin}`;
      if (LIVE && usd && key !== liveKey) { liveKey = key; liveQ = null; fetchQ(key, cs, g, coin); }
      const quoting = LIVE && usd && !liveQ, amt = LIVE && liveQ ? liveQ.n ?? (parseFloat(String(liveQ.text).replace(/,/g, '')) || 0) : Wear.inCoin(usd, coin); // live: from the raw quote
      const bal = S().wallet.balances[coin] || 0, short = !quoting && (LIVE ? Live.walletNeeds(amt, coin) : amt) > bal;
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Pay with' }, coins.map((k) =>
        h('button', { type: 'button', 'aria-pressed': String(k === coin), 'data-coin': k, onclick: () => { coin = k; review(); } }, k)));
      const amtTxt = quoting ? (liveQ === false ? 'price unavailable right now' : 'getting price…') : `≈ ${LIVE ? liveQ.text : Wear.fmtCoin(amt, coin)} ${coin}`;
      const rawFresh = raw.filter((c) => Wear.freshLeft(c) > 0), rawOld = raw.filter((c) => !Wear.freshLeft(c));
      const soonest = rawFresh.length ? Math.min(...rawFresh.map(Wear.freshLeft)) : 0;
      const toCoin = () => { const sg = host.querySelector('.wz-coin .seg'); sg?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); sg?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }); };
      put(host, h('div', { class: 'wz' }, top(),
        h('div', { class: 'wz-ask' }, h('h3', { text: usd ? 'Review' : 'Nothing picked' })),
        g.length ? h('section', { class: 'wz-sec' }, h('h4', {}, 'Grade ', h('small', { text: howMany(g, Store.gradeUsd) })), thumbs(g, 'Cards to grade, with their odds if graded now', true)) : null,
        cs.length ? h('section', { class: 'wz-sec' }, h('h4', {}, 'Case ', h('small', { text: howMany(cs, Store.caseUsd) })), thumbs(cs, 'Cards to case')) : null,
        raw.length ? h('div', { class: 'wz-raw' }, h('p', {}, h('b', { text: `${raw.length} stay raw.` })),
          h('ul', {},
            rawFresh.length ? h('li', { class: 'fresh' }, h('b', { text: `${rawFresh.length} fresh` }), `: wear starts in ${Wear.hhmm(soonest)}.`) : null,
            rawOld.length ? h('li', {}, h('b', { text: `${rawOld.length} already wearing` }), '.') : null)) : null,
        usd ? h('div', { class: 'wz-pay' },
          g.length ? h('p', { class: 'wz-final' }, h('b', { text: 'Before you pay: ' }), Wear.FINAL_LINE) : null,
          h('dl', { class: 'sum' }, h('dt', { text: 'Total' }), h('dd', { class: 'price' }, Wear.usd(usd), h('small', { text: quoting ? ' · ' + amtTxt : ' ' + amtTxt })),
            h('dt', { text: 'You have' }), h('dd', { text: `${Wear.fmtCoin(bal, coin)} ${coin}` })),
          h('div', { class: 'wz-coin' }, h('span', { class: 'muted small', text: 'Pay with' }), seg),
          LIVE && coin !== 'USDG' ? h('p', { class: 'fine', text: 'Price moves over 3%? Nothing is charged.' }) : null,
          h('p', { class: 'demo-line', text: 'Demo: nothing is charged' })) : null,
        h('div', { class: 'foot' }, h('div', { class: 'fsum' }, h('b', { text: usd ? `${g.length + cs.length} ${g.length + cs.length === 1 ? 'card' : 'cards'} · ${Wear.usd(usd)}` : 'Keep all raw?' }),
          usd ? h('span', { class: 'muted fpay' }, h('span', { class: 'fpay-amt', text: amtTxt }), ' · ', h('button', { type: 'button', class: 'linkish', 'aria-label': `Change the coin (paying in ${coin})`, onclick: toCoin }, 'Change coin'))
            : h('span', { class: 'muted', text: 'Case or grade any time.' })),
          h('div', { class: 'row' }, btn('Back', '', () => go('case')),
            usd ? btn(quoting ? 'Getting the price…' : short ? `Not enough ${coin}` : `Pay ${Wear.usd(usd)}`, 'primary', () => pay(g, cs, coin, amt, liveQ), { disabled: short || quoting }) : btn('Done', 'primary', () => finish([], []))))));
      host.querySelector('.foot .btn.primary')?.focus({ preventScroll: true });
    }
    async function pay(g, cs, k, amt, quote) {
      g = g.filter((id) => canGrade(byId(id))); cs = cs.filter((id) => canCase(byId(id)) && !g.includes(id));
      if ((S().wallet.balances[k] || 0) < (LIVE ? Live.walletNeeds(amt, k) : amt)) return review();
      if (LIVE && (`${cs.join(',')}|${g.join(',')}|${k}` !== liveKey || !quote)) return review(); // the picks changed: price them again
      step = 'work';
      let gIndex = -1;
      if (LIVE) { // the chain: one transaction (capped at the price shown + 3%), then the cases show and the grades come after the draw
        const r = await Live.protect(cs, g, k, quote);
        if (!r) { step = 'review'; return review(); }
        gIndex = r.gradingIndex;
      }
      const paid = total(), freshN = cs.filter((id) => Wear.freshLeft(byId(id)) > 0).length;
      Store.update((s) => {
        if (!LIVE) s.wallet.balances[k] -= amt;
        cs.forEach((id) => { const c = byId(id); c.frozenAge = Store.ageMs(c); c.cased = true; }); // the case freezes its age
        g.forEach((id) => { const c = byId(id); c.frozenAge = Store.ageMs(c); c.pending = true; });
        Store.log(`Paid ${Wear.usd(paid)}: ${[cs.length ? `${cs.length} cased` : '', g.length ? `${g.length} sent to grade` : ''].filter(Boolean).join(', ')}`);
      });
      gSel.clear(); cSel.clear();
      toast('Paid', 'good'); window.Fun?.emit('paid', { cased: cs.length, graded: g.length, fresh: freshN });
      const msg = h('p', { class: 'stage-msg', 'aria-live': 'polite' });
      const ctrls = h('div', { class: 'stage-ctrls' });
      const slot = (id) => { const c = byId(id); const w = h('div', { class: 'gslot' }, h('div', { class: 'cwrap' }, cardFace(c)), h('div', { class: 'cmeta' }, matChip(c.material), holoChip(c))); w._id = id; return w; };
      const caseTiles = cs.map(slot), gradeTiles = g.map(slot);
      const caseH = h('h4', { text: 'Casing…' }), gradeH = h('h4', { text: 'Grading…' }); // "Cased" / "Graded" once done
      const share = h('div', { class: 'g10-share', hidden: true });
      put(host, h('div', { class: 'wz wz-work' }, h('div', { class: 'wz-bar' }, h('span'), Wear.howPill()), msg, share,
        caseTiles.length ? h('section', { class: 'wz-sec' }, caseH, h('div', { class: 'ggrid' }, caseTiles)) : null,
        gradeTiles.length ? h('section', { class: 'wz-sec' }, gradeH, h('div', { class: 'ggrid' }, gradeTiles)) : null, ctrls));
      host.closest('.sheet-body')?.scrollTo({ top: 0 });
      // cases slide on, a beat apart
      if (caseTiles.length) msg.textContent = `Casing ${cs.length} card${cs.length > 1 ? 's' : ''}…`;
      for (const w of caseTiles) {
        const c = byId(w._id), wrap = w.querySelector('.cwrap');
        const shell = h('img', { class: 'case-in', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: '' });
        wrap.append(shell);
        w.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); // the ones below the fold too
        await wait(reduced() ? 60 : 520);
        const f = wrap.querySelector('.cframe'); f.src = Store.cardImg(c); f.style.objectPosition = Store.cardPos(c); wrap.querySelector('.cface').className = wrap.querySelector('.cface').className.replace('hd-raw', 'hd-case');
        shell.remove(); w.classList.add('cased-done'); window.Sound?.play('case-snap', { gap: 60 }); window.Fun?.emit('case'); w.setAttribute('aria-label', `${c.character} cased`);
      }
      caseH.textContent = 'Cased';
      const got = [];
      if (gradeTiles.length) {
        msg.textContent = 'Grading…';
        gradeTiles.forEach((w) => w.classList.add('scanning'));
        const liveGrades = LIVE ? await Live.finishGrading(gIndex, g, (t, a) => sayTo(msg, t, a), () => host.isConnected) : null;
        if (LIVE && liveGrades === 'cancelled') { gradeH.textContent = 'Returned ungraded'; gradeTiles.forEach((w) => w.classList.remove('scanning')); msg.textContent = 'Returned ungraded.'; put(ctrls, done()); return; }
        if (LIVE && !liveGrades) { msg.textContent = 'Grades land in My cards soon.'; return finish(cs, [], msg, ctrls); }
        await wait(reduced() ? 300 : 1200);
        // the suspense: every grade is known now; they're revealed lowest first, the best last, each after a short scan
        const order = gradeTiles.map((w, k) => { const c0 = byId(w._id); return { w, k, gr: LIVE ? liveGrades.get(w._id) : Wear.draw(c0.frozenAge / 1000, c0.moves) }; })
          .sort((a, b) => a.gr - b.gr || a.k - b.k);
        const best = Math.max(...order.map((x) => x.gr)), many = order.length > 1;
        // every slab is drawn and decoded under its card now, while the scan runs, so the reveal never shows a blank frame
        const slabs = new Map(order.map(({ w, gr }) => [w, slabUnder(w, { ...byId(w._id), grade: gr, pending: false })]));
        gradeTiles.forEach((w) => w.classList.remove('scanning'));
        for (const [i, { w, gr }] of order.entries()) {
          const last = i === order.length - 1, c0 = byId(w._id);
          w.classList.add('scan-now');
          msg.textContent = last && many ? 'And the best for last…' : `Grading ${c0.character}…`;
          await wait(reduced() ? 250 : last && many ? 1500 : 700);
          w.classList.remove('scan-now');
          const slab = slabs.get(w); await slab.ready;
          // the slab press (fx.js): the slab comes down over the card and shows the slabbed card at its thunk, then the
          // grade prints on the label. Reduced motion, or no fun layer: the slabbed card fades in over the card.
          const press = !reduced() && window.Fun?.slabPress;
          await (press ? press(w, slab.show) : slab.fade());
          got.push(gr);
          Store.update((s) => { const c = s.cards.find((x) => x.id === w._id); if (c) { c.grade = gr; c.pending = false; } });
          const c = byId(w._id) || { ...c0, grade: gr, pending: false };
          // the grade stays in view: a PDA pill and the slab's word
          w.querySelector('.cmeta').before(h('div', { class: 'gres' }, h('span', { class: 'pda-pill g' + gr, style: `--sc:${Wear.bandOf(gr).c}`, text: 'PDA ' + gr }), h('b', { class: 'gword', text: Wear.WORD[gr] })));
          w.classList.add('slabbed');
          w.setAttribute('aria-label', `${c.character}, PDA ${gr}, ${Wear.WORD[gr]}, slabbed`); window.Fun?.emit('graded', { card: c, grade: gr });
          msg.textContent = `${c.character}: PDA ${gr} · ${Wear.WORD[gr]}`;
          if (gr === 10) { // its own moment (the opening's big reveal, in gold), then a share prompt
            await wait(reduced() ? 0 : 380);
            bigMoment(c, w, host, { kind: 'g10', title: 'PDA 10! GEM MINT' });
            put(share, h('p', {}, h('b', { text: 'PDA 10!' }), ` That’s ${Wear.TEN_FRESH}. Show it off?`), shareBtn(c, 'gold', 'Share your PDA 10'), clipBtn(c));
            share.hidden = false;
            await wait(reduced() ? 600 : 2400);
          } else if (!reduced()) await wait(900);
        }
        if (many) gradeTiles.forEach((w) => { const top = order.find((x) => x.w === w).gr === best; w.classList.toggle('best', top); if (top) w.querySelector('.gres')?.append(h('span', { class: 'best-t', text: 'Best' })); });
        gradeH.textContent = 'Graded';
        // all revealed: the slabs settle best first, worst last (FLIP: transform only, ~300 ms; reduced motion: at once)
        if (many) await rankSlabs(order.map(({ w, gr }) => ({ w, c: { ...byId(w._id), grade: gr } })));
      }
      finish(cs, got, msg, ctrls);
    }
    function finish(cs, got, msg, ctrls) {
      step = 'work';
      if (!msg) { // nothing paid: straight to the end buttons
        msg = h('p', { class: 'stage-msg', text: 'All kept raw.' }); ctrls = h('div', { class: 'stage-ctrls' });
        put(host, h('div', { class: 'wz wz-work' }, h('div', { class: 'wz-bar' }, h('span'), Wear.howPill()), msg, ctrls));
      } else {
        const top = got.length ? Math.max(...got) : 0;
        const parts = [cs.length ? `${cs.length} cased` : '', got.length ? `${got.length} graded` : '', got.length ? `${got.length > 1 ? 'best ' : ''}PDA ${top} ${Wear.WORD[top]}` : ''];
        msg.textContent = parts.filter(Boolean).join(' · '); // "4 cased · 2 graded · best PDA 8 NM-MT"
        if (got.length) toast(got.length === 1 ? `Graded: PDA ${got[0]} · ${Wear.WORD[got[0]]}!` : `${got.length} cards graded · best: PDA ${top} · ${Wear.WORD[top]}`, 'good');
      }
      put(ctrls, done());
      ctrls.querySelector('.btn.primary')?.focus({ preventScroll: true });
    }
    render();
  }

  // the Case & grade station: every ungraded card you own, rarest first
  function openGrade(opts = {}) {
    const prog = h('div', { class: 'inprog' }), wiz = h('div'), root = h('div', { class: 'st st-grade' }, prog, wiz);
    const pool = S().cards.filter((c) => c.grade == null && !c.pending).sort((a, b) => rarity(b) - rarity(a) || b.serial - a.serial);
    const pick = opts.pick || [];
    const drawProg = () => progressList(prog, ['grading']); // gradings still out (after a reload too)
    drawProg(); listen('grade', drawProg);
    Sheet.open('grade', { title: 'Case & grade', body: root, wide: true, onClose: () => unlisten('grade') });
    if (!pool.length) { put(wiz, h('div', { class: 'empty-state' }, h('p', { text: 'Every card you have is slabbed. Open a pack for more!' }), Wear.howPill())); return; }
    protectFlow(wiz, { cards: pool, station: true, start: opts.as === 'case' ? 'case' : 'grade', pre: opts.as === 'case' ? { case: pick } : { grade: pick },
      done: () => [btn('Case or grade more', '', () => openGrade()), btn('Done', 'primary', () => Sheet.close('grade'))] });
  }

  // =====================================================================================
  // 3. Burn: burn cards, every 42 is a free pack
  // =====================================================================================
  let burnQueue = 0, liveEarned = 0; // cards thrown into the scene that have not landed yet; live: free packs the burn earned
  function addBurn() {
    if (LIVE) { if (burnQueue === 0 && liveEarned) { const k = liveEarned; liveEarned = 0; freePackMoment(k); } return; } // live: the chain counted (Live re-read it)
    let free = false;
    Store.update((s) => { s.wallet.burnCount++; if (s.wallet.burnCount % BURN_GOAL === 0) { s.wallet.credits++; free = true; Store.log('Burned 42: free pack'); } });
    if (free) freePackMoment(1);
  }
  // A free pack earned by burning: exactly one moment per pack. One token out of the ash bin, one pack flying to where
  // free packs are kept (the buy box's Free pack row, else the wallet), a "+1" there, and one toast.
  function freePackMoment(k = 1) {
    if (k < 1) return;
    window.Scene?.popToken?.();
    toast(k === 1 ? '+1 free pack · in your wallet' : `+${k} free packs · in your wallet`, 'good');
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight ? el : null; };
    const to = vis(document.querySelector('#buybox [data-buy="free"]')) || vis(document.querySelector('#buybar [data-buy="free"]')) || vis(document.getElementById('walletBtn'));
    if (!to) return;
    const pip = () => { const q = to.getBoundingClientRect(); // fixed over the target's corner (the wallet chip clips its overflow)
      const plus = h('span', { class: 'fp-plus', 'aria-hidden': 'true', text: '+' + k, style: `left:${Math.min(innerWidth - 34, q.right - 18)}px;top:${Math.max(4, q.top - 10)}px` });
      document.body.append(plus); to.classList.add('fp-got'); setTimeout(() => { plus.remove(); to.classList.remove('fp-got'); }, 1800); };
    if (reduced() || !document.body.animate) return pip();
    const from = window.Scene?.toScreen ? window.Scene.toScreen(330, 1150) : [innerWidth / 2, innerHeight / 2];
    const r = to.getBoundingClientRect(), tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    const [fx0, fy0] = [Math.min(innerWidth - 30, Math.max(30, from[0])), Math.min(innerHeight - 40, Math.max(40, from[1]))];
    const pk = h('img', { class: 'fp-fly', src: 'ui/omni-pack.webp', alt: '', 'aria-hidden': 'true' });
    document.body.append(pk);
    const dx = tx - fx0, dy = ty - fy0;
    const a = pk.animate([
      { transform: `translate(${fx0}px, ${fy0}px) translate(-50%, -50%) scale(.4)`, opacity: 0 },
      { transform: `translate(${fx0}px, ${fy0 - 60}px) translate(-50%, -50%) scale(1.15)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${fx0 + dx * 0.55}px, ${fy0 + dy * 0.55 - 40}px) translate(-50%, -50%) scale(.9) rotate(-8deg)`, opacity: 1, offset: 0.7 },
      { transform: `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(.35)`, opacity: 0.2 }],
    { duration: 1300, delay: 450, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
    a.onfinish = () => { pk.remove(); pip(); };
  }
  const hookScene = () => window.Scene?.on?.('cardBurned', () => { if (burnQueue > 0) { burnQueue--; addBurn(); window.Sound?.play('fire-flare', { gap: 650 }); } });
  if (window.Scene) hookScene(); else window.addEventListener('scene-ready', hookScene, { once: true });

  // Best to burn: spare copies first (never the best copy of a character+material), then least rare.
  // Within a group of copies the keeper is the most valuable one; every other copy is a spare.
  const dupKey = (c) => c.character + '|' + c.material; // copies = same character and material
  const stackKey = (c) => [c.series, c.character, c.material, c.holo || 'none', c.cased ? 'case' : 'raw'].join('|'); // exact copies (Burn's stacks)
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
    const root = h('div', { class: 'st st-burn' }); const foot = h('div', { class: 'foot' }), prog = h('div', { class: 'burnbar-host' });
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
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': BURN_GOAL, 'aria-valuenow': b, 'aria-label': 'Burn progress' },
          h('i', { style: `width:${b / BURN_GOAL * 100}%` }), sel.size ? h('i', { class: 'add', style: `left:${b / BURN_GOAL * 100}%;width:${Math.min(BURN_GOAL - b, sel.size) / BURN_GOAL * 100}%` }) : null),
        h('p', { class: 'muted', text: `Burn ${BURN_GOAL} cards, get a free pack.` }));
    }
    function renderFoot() {
      const n = sel.size; const b = S().wallet.burnCount % BURN_GOAL; const packs = Math.floor((b + n) / BURN_GOAL);
      patch(prog, JSON.stringify([b, n]), () => put(prog, progress()));
      patch(foot, JSON.stringify([b, n, connected()]), () => drawFoot(n, b, packs));
    }
    function drawFoot(n, b, packs) {
      let act;
      if (!connected()) act = connectBtn();
      else if (!n) act = h('div', { class: 'row' }, h('span', { class: 'why', text: 'Pick cards' }), btn('Burn', 'danger', null, { disabled: true, 'data-key': 'burn' }));
      else act = btn(`Burn ${n}`, 'danger', () => confirmBurn([...sel], go), { 'aria-haspopup': 'dialog', 'data-key': 'burn' });
      put(foot, h('div', { class: 'fsum' }, h('b', { text: n ? `${n} picked` : 'None picked' }),
        h('span', { class: 'muted', text: packs ? `+${packs} free pack${packs > 1 ? 's' : ''}` : `${BURN_GOAL - b - n} to a free pack` })), act); // counts the picks, like the confirm window
    }
    function toggle(c, el) { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); el.setAttribute('aria-pressed', String(sel.has(c.id))); renderFoot(); }
    // a stack of exact copies: one tile with its count; tapping it picks how many of them to burn
    function stackTile(g) {
      const k = g.filter((c) => sel.has(c.id)).length;
      const b = cardTile(g[0], { onTap: () => pickFromStack(g), tag: h('span', { class: 'stack-n', text: `×${g.length}` }) });
      b.classList.add('stack', 'pick'); b.setAttribute('aria-pressed', String(k > 0));
      b.setAttribute('aria-label', `${describe(g[0])}, ${g.length} copies${k ? `, ${k} to burn` : ''}. Pick how many to burn`);
      b.querySelector('.cwrap').append(h('span', { class: 'stack-burn', hidden: !k, text: `Burn ${k}` }));
      return b;
    }
    // which copies go first: the highest print numbers (the low ones are the keepers), then the newest
    const burnFirst = (a, b) => (edNum(b) || 0) - (edNum(a) || 0) || b.serial - a.serial;
    function pickFromStack(g) {
      const order = [...g].sort(burnFirst), n = g.length;
      let k = g.filter((c) => sel.has(c.id)).length || n - 1;
      const body = h('div', { class: 'st st-stack' });
      const draw = () => put(body,
        h('div', { class: 'stk-top' }, h('div', { class: 'stk-card' }, cardFace(g[0], true)),
          h('div', {}, h('h3', { text: g[0].character }), h('p', { class: 'muted', text: `${kindLine(g[0])} · ${g[0].cased ? 'Cased' : 'Raw'} · Series ${g[0].series}` }),
            h('p', { class: 'stk-have', text: `You have ${n}` }))),
        h('div', { class: 'stk-step', role: 'group', 'aria-label': 'How many to burn' },
          btn('−', 'stk-b', () => { k = Math.max(0, k - 1); draw(); }, { disabled: k <= 0, 'aria-label': 'One fewer', 'data-key': 'stk-less' }),
          h('div', { class: 'stk-k' }, h('b', { text: String(k) }), h('small', { text: `to burn · ${n - k} left` })),
          btn('+', 'stk-b', () => { k = Math.min(n, k + 1); draw(); }, { disabled: k >= n, 'aria-label': 'One more', 'data-key': 'stk-more' })),
        h('div', { class: 'row stk-quick' }, btn('All but one', 'small', () => { k = n - 1; draw(); }, { 'data-key': 'stk-allbut' }), btn('None', 'small', () => { k = 0; draw(); }, { 'data-key': 'stk-none' })),
        k === n ? h('p', { class: 'why', text: `That's every copy: none left after.` }) : null,
        h('div', { class: 'row' }, btn(k ? `Pick ${k} to burn` : 'Done', 'primary', () => {
          g.forEach((c) => sel.delete(c.id)); order.slice(0, k).forEach((c) => sel.add(c.id));
          Sheet.close('burnstack'); render(true);
        }, { 'data-key': 'stk-done' })));
      draw(); Sheet.open('burnstack', { title: `${g[0].character} ×${n}`, body });
    }
    // force: the picks changed from here (All Paper, Clear); a Store update rebuilds only when the cards or filters did
    function render(force) {
      const n0 = sel.size; [...sel].forEach((id) => { const c = byId(id); if (!c || c.pending) sel.delete(id); });
      const all = pool();
      if (force === true || sel.size !== n0) root._key = null;
      if (!patch(root, JSON.stringify([bfilt, all.map(tileSig), connected()]), () => drawBurn(all))) renderFoot();
    }
    function drawBurn(all) {
      dups = dupInfo();
      const list = all.filter(matches).sort(SORTS[bfilt.sort] || SORTS.best);
      const seriesList = [...new Set(all.map((c) => c.series))].sort((a, b) => b - a);
      const sel_ = (key, label, opts) => h('label', { class: 'f' }, h('span', { text: label }),
        h('select', { 'data-k': key, onchange: (e) => { bfilt[key] = e.target.value; render(); } },
          opts.map(([v, t]) => h('option', { value: v, selected: String(bfilt[key]) === String(v) }, t))));
      const filters = h('div', { class: 'filters' },
        sel_('series', 'Series', [['all', 'All'], ...seriesList.map((n) => [n, 'Series ' + n])]),
        sel_('mat', 'Material', [['all', 'All'], ...Store.MATS.map((m) => [m, Store.MAT_LABEL[m]])]),
        sel_('holo', 'Holo', [['any', 'Any'], ['none', 'None'], ['frame', 'Frame'], ['picture', 'Picture'], ['full', 'Full']]),
        sel_('grade', 'Grade', [['all', 'All'], ['none', 'Not graded'], ['10', 'PDA 10'], ['9-8', 'PDA 9–8'], ['7-6', 'PDA 7–6'], ['5-4', 'PDA 5–4'], ['3-2', 'PDA 3–2'], ['1', 'PDA 1']]),
        sel_('sort', 'Sort', [['best', 'Best to burn'], ['serial', 'Newest'], ['rarity', 'Rarity'], ['grade', 'Grade']]));
      // stacks: exact copies (same Series, character, material and holo; raw or cased apart; a slab is always its own)
      const stacks = new Map();
      for (const c of list) { const k = c.grade != null ? 'g' + c.id : stackKey(c); (stacks.get(k) || stacks.set(k, []).get(k)).push(c); }
      const tiles = [...stacks.values()].map((g) => (g.length === 1
        ? cardTile(g[0], { selectable: true, selected: sel.has(g[0].id), onTap: toggle })
        : stackTile(g)));
      const visPaper = list.filter((c) => c.material === 'paper');
      const quick = h('div', { class: 'row quick' },
        visPaper.length ? btn('All Paper', 'small', () => { visPaper.forEach((c) => sel.add(c.id)); render(true); }, { 'data-key': 'allpaper' }) : null,
        sel.size ? btn('Clear', 'small', () => { sel.clear(); render(true); }, { 'data-key': 'clearsel' }) : null,
        h('span', { class: 'muted small', text: list.length === all.length ? `${all.length} cards` : `${list.length} of ${all.length}` }));
      const spares = all.filter((c) => dups.get(c.id)?.spare).length;
      put(root, prog,
        all.length ? filters : null,
        all.length && bfilt.sort === 'best' ? h('p', { class: 'muted small burn-hint', text: spares ? 'Spares first. Your best copy is never picked.' : 'Commons first.' }) : null,
        all.length ? quick : null,
        list.length ? h('div', { class: 'cgrid' }, tiles)
          : h('div', { class: 'empty-state' }, h('p', { text: all.length ? 'No cards match.' : 'No cards to burn.' }),
            all.length ? btn('Clear filters', 'small', () => { Object.assign(bfilt, { series: 'all', mat: 'all', holo: 'any', grade: 'all' }); render(); }, { 'data-key': 'clear' }) : null), foot);
      prog._key = foot._key = null; renderFoot();
    }
    async function go(picked) { // only ever called by the confirm window
      const ids = picked.filter((id) => byId(id) && !byId(id).pending); sel.clear(); if (!ids.length) return render();
      const b0 = S().wallet.burnCount % BURN_GOAL; // live: what this burn earns, shown once as its last card lands
      if (LIVE && !(await Live.burn(ids))) return render();
      if (LIVE) liveEarned += Math.floor((b0 + ids.length) / BURN_GOAL);
      Store.update((s) => { ids.forEach((id) => Store.noteBurned(byId(id))); s.cards = s.cards.filter((c) => !ids.includes(c.id)); Store.log(`Burned ${ids.length} card${ids.length > 1 ? 's' : ''}`); });
      window.Fun?.emit('burned', { n: ids.length });
      unlisten('burn'); Sheet.close('burn');
      toast(`Burning ${ids.length} card${ids.length > 1 ? 's' : ''}…`);
      if (window.Scene?.burn) burnQueue += ids.length; // counted up front: the moment waits for the last card in the queue
      ids.forEach((_, i) => setTimeout(() => { if (window.Scene?.burn) window.Scene.burn(); else { addBurn(); window.Sound?.play('fire-flare', { gap: 650 }); } }, i * 350));
    }
    listen('burn', render);
    Sheet.open('burn', { title: 'Burn', body: root, onClose: () => unlisten('burn') });
    render();
  }

  // The burn warning: a big window listing exactly what is about to be destroyed (most valuable first, with warnings),
  // what it earns toward a free pack, and (when a card is flagged, or BIG_BURN cards or more go at once) a box where the
  // player types BURN first.
  const BIG_BURN = 10; // this many cards at once always asks for BURN typed (a careless "All Paper")
  function confirmBurn(ids, onBurn) {
    const cards = ids.map(byId).filter(Boolean); if (!cards.length) return;
    const n = cards.length, b = S().wallet.burnCount % BURN_GOAL, after = b + n, packs = Math.floor(after / BURN_GOAL), rest = after % BURN_GOAL;
    const burning = new Set(cards.map((c) => c.id)), owned = new Map();
    for (const c of S().cards) owned.set(dupKey(c), (owned.get(dupKey(c)) || 0) + 1);
    const left = new Map(owned); cards.forEach((c) => left.set(dupKey(c), left.get(dupKey(c)) - 1));
    const flags = (c) => { const t = tierOf(c), f = [];
      if (!left.get(dupKey(c))) f.push(owned.get(dupKey(c)) === 1 ? 'Your only copy' : `All ${owned.get(dupKey(c))} of your copies`);
      if (t) f.push(TIER_LABEL[t]); if (isHolo(c)) f.push(holoLabel(c) || 'Holo'); if (c.grade != null) f.push('PDA ' + c.grade); else if (c.cased) f.push('Cased');
      return f; };
    const list = cards.map((c) => ({ c, f: flags(c) })).sort((x, y) => (y.f.length > 0) - (x.f.length > 0) || rarity(y.c) - rarity(x.c) || Store.floor(y.c) - Store.floor(x.c));
    const flagged = list.filter((x) => x.f.length).length, worth = cards.reduce((a, c) => a + Store.floor(c), 0);
    const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const word = 'BURN', typed = flagged > 0 || n >= BIG_BURN, ok = () => !typed || input.value.trim().toUpperCase() === word; // a few plain spares: a plain confirm
    const input = h('input', { id: 'bw-type', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'done',
      oninput: () => { const m = ok(); fire.disabled = !m; wrap.classList.toggle('ok', m); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (ok()) burn(); } } });
    const burn = () => { if (!ok()) return; Sheet.close('burnwarn'); onBurn(ids); };
    const fire = btn(`Burn ${plural(n, 'card')} forever`, 'danger', burn, { disabled: typed });
    const wrap = !typed ? null : h('div', { class: 'bw-type' }, h('label', { for: 'bw-type' }, 'Type ', h('b', { text: word }), ' to confirm'), input);
    const meterAt = (v) => h('i', { style: `width:${v / BURN_GOAL * 100}%` });
    const body = h('div', { class: 'bw' },
      h('div', { id: 'bw-warn', class: 'bw-warn' },
        h('span', { class: 'bw-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2.5 1.4-4 2.5-5 .2 1.7 1 2.8 2 3.2C11 8.6 11 5 12 2z" fill="currentColor"/></svg>' }),
        h('div', {}, h('p', { class: 'bw-big', text: 'Burned cards are gone forever.' }),
          h('p', { text: (flagged ? `${flagged === n ? (n === 1 ? 'This one is' : 'All of these are') : flagged + ' of these ' + (flagged === 1 ? 'is' : 'are')} worth a second look. ` : '')
            + (LIVE ? '' : `Floor about ${Store.eth(+worth.toPrecision(2))} (demo).`) }))),
      h('div', { class: 'bw-gain' },
        h('div', { class: 'bb-top' }, h('b', { text: 'You get' }),
          h('span', { class: 'bw-ft' }, h('span', { class: 'muted', text: `${b}/${BURN_GOAL}` }), h('span', { 'aria-hidden': 'true', text: ' → ' }), h('span', { class: 'sr', text: ' to ' }),
            h('b', { text: packs ? `+${plural(packs, 'free pack')}` + (rest ? `, ${rest}/${BURN_GOAL}` : '') : `${after}/${BURN_GOAL}` }))),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, meterAt(packs ? BURN_GOAL : b), packs ? null : h('i', { class: 'add', style: `left:${b / BURN_GOAL * 100}%;width:${n / BURN_GOAL * 100}%` })),
        h('p', { class: 'muted small', text: packs ? `Every ${BURN_GOAL} cards burned is a free pack.` : `${BURN_GOAL - after} more to a free pack.` })),
      h('h3', { class: 'bw-h', text: flagged ? `Cards · ${flagged} flagged` : 'Cards' }),
      h('ul', { class: 'bw-list', tabindex: '0', 'aria-label': `The ${plural(n, 'card')} to burn` }, list.map(({ c, f }) => h('li', { class: f.length ? 'flag' : '' },
        h('div', { class: 'bw-thumb' }, cardFace(c, true)),
        h('div', { class: 'bw-info' }, h('b', { text: c.character }), h('span', { text: cardName(c) }), h('span', { class: 'muted', text: Store.trueOdds(c).label + ' · ' + floorTxt(c) }),
          f.length ? h('div', { class: 'bw-flags' }, f.map((t) => h('span', { class: 'bw-flag' + (/copy|copies/.test(t) ? ' last' : ''), text: t }))) : null)))),
      h('div', { class: 'bw-foot' }, wrap, h('div', { class: 'bw-act' }, btn('Cancel', '', () => Sheet.close('burnwarn')), fire),
        h('p', { class: 'demo-line', text: 'Demo: nothing is charged' })));
    const d = Sheet.open('burnwarn', { title: `Burn ${plural(n, 'card')}?`, body });
    d.classList.add('burnwarn'); d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-describedby', 'bw-warn'); // labelled by its title (Sheet)
    d.querySelector('.sheet-body').scrollTop = 0; (typed ? input : fire).focus();
  }

  // =====================================================================================
  // 4. Suggestion box
  // =====================================================================================
  // A sheet of paper with three handwritten fields (character, then optional personality and background), packed into
  // the ONE on-chain text (Store.packSuggestion: "Character: …\nPersonality: …\nBackground: …", only filled lines) and
  // counted in bytes against FireCredits.suggestionMaxBytes (Store.SUGGEST_MAX_BYTES, an owner setting). Typing looks
  // like ink: each textarea is transparent over a mirror of its text, where new letters fade in wet and settle.
  // Send folds the paper and drops it in the box (the Suggest pill/station if it's in view, else a box in the window).
  function openSuggest() {
    const MAXB = Store.SUGGEST_MAX_BYTES, ONE = Store.PRICES.SUGGEST_PAPER, WET = 900;
    const W = Store.SUGGEST_WAVE, LOOK = W.wave === 'look';
    // the theme-and-style wave: either or both, each its own suggestion at ONE PAPER, sent together
    const FIELDS = LOOK ? [
      { k: 'theme', label: 'Theme', opt: true, ph: 'A haunted diner', hint: 'sg-hint' },
      { k: 'style', label: 'Art style', opt: true, ph: 'Old woodcut print' },
    ] : [
      { k: 'character', label: 'Character', ph: 'A sleepy volcano', hint: 'sg-hint' },
      { k: 'personality', label: 'Personality', opt: true, ph: 'Grumpy until noon, then very generous' },
      { k: 'background', label: 'Background', opt: true, ph: 'Napping since the last ice age' },
    ];
    // what this paper sends: the on-chain texts (one per suggestion), what's required, and the cost
    const texts = () => LOOK ? Store.packLook(values()) : [Store.packSuggestion(values())].filter((t) => values().character.trim());
    const cost = () => ONE * Math.max(1, texts().length);
    let busy = false, approving = false;
    const opened = new Set(); // "Your ideas" rows left expanded, kept across re-renders
    const fields = FIELDS.map(inkField);
    const values = () => Object.fromEntries(fields.map((f) => [f.k, f.ta.value]));
    const count = h('span', { id: 'sg-count', class: 'sg-count' });
    const paperEl = h('div', { class: 'sg-paper' },
      h('div', { class: 'sg-head', 'aria-hidden': 'true' }, h('span', { text: LOOK ? 'Theme & art style' : 'Character' }), h('span', { text: 'Series ' + (S().series.no + 1) })),
      LOOK ? null : h('p', { class: 'sg-wave', text: `${W.theme} · ${W.style}` }),
      fields.map((f) => f.row),
      h('div', { class: 'sg-foot' }, count));
    const doneEl = h('div', { class: 'sg-done', hidden: true, tabindex: '-1' },
      h('span', { class: 'sg-done-box', 'aria-hidden': 'true', html: BOX_SVG }),
      h('p', { class: 'sg-done-t', text: 'In the box.' }),
      h('p', { class: 'muted', text: 'Picks are made before each Series.' }),
      btn('Write another', '', () => { doneEl.hidden = true; formBits.forEach((el) => { el.hidden = false; }); paperEl.hidden = false; paperEl.style.visibility = ''; renderAct(); fields.forEach((f) => f.grow()); fields[0].ta.focus(); }));
    const act = h('div', { class: 'sg-act' }); const listEl = h('div', { class: 'sg-list' });
    const notes = h('div', { class: 'sg-notes' },
      h('p', { class: 'sg-joke', text: 'Jokes cost PAPER too. Only real ideas get picked.' }),
      h('p', { class: 'reward', text: 'Get picked, get a free pack.' }),
      Store.SUGGEST_RESULTS.length ? h('p', {}, btn('Last results', 'rs-link', () => { Sheet.close('suggest'); openResults(); })) : null);
    const stage = h('div', { class: 'sg-stage' }, paperEl, doneEl, h('img', { class: 'sg-mascot', src: 'ui/brand/paper-256.webp', alt: '', 'aria-hidden': 'true', width: 62, height: 80 }));
    const formBits = [notes, act];

    function inkField(f, i) {
      const id = 'sg-' + f.k;
      const ta = h('textarea', { id, rows: 1, placeholder: f.ph, autocomplete: 'off', enterkeyhint: i < FIELDS.length - 1 ? 'next' : 'done',
        'aria-describedby': [f.hint, 'sg-count'].filter(Boolean).join(' '), 'aria-required': f.opt ? null : 'true' });
      const ink = h('div', { class: 'ink', 'aria-hidden': 'true' });
      const row = h('div', { class: 'sg-field' },
        h('label', { for: id }, f.label, f.opt ? h('small', { text: 'optional' }) : null),
        h('div', { class: 'ink-field' }, ink, ta));
      let chars = [], born = [], settle = 0; // born[i]: when letter i was written (0 = dry)
      const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      function paint() {
        const now = performance.now(), out = []; let run = '';
        chars.forEach((c, j) => {
          const age = now - born[j];
          if (!born[j] || age >= WET) { run += c; return; }
          if (run) { out.push(run); run = ''; }
          out.push(h('span', { class: 'wet', style: `animation-delay:${-Math.round(age)}ms` }, c));
        });
        out.push(run + '​'); // keeps a trailing space's line
        ink.replaceChildren(...out);
      }
      function sync() {
        if (/[\r\n]/.test(ta.value)) { const p = ta.selectionStart; ta.value = ta.value.replace(/\r\n|[\r\n]/g, ' '); ta.setSelectionRange(p, p); }
        const b = Array.from(ta.value), a = chars; let s = 0, e = 0;
        while (s < a.length && s < b.length && a[s] === b[s]) s++;
        while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
        const now = performance.now();
        born = [...born.slice(0, s), ...Array(b.length - s - e).fill(now), ...born.slice(born.length - e)];
        chars = b; paint(); grow();
        clearTimeout(settle); settle = setTimeout(paint, WET + 60);
      }
      ta.addEventListener('input', () => { sync(); renderAct(); window.Sound?.typing(); }); // the pen scratches while you write
      ta.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault(); const next = fields[i + 1]; if (next) next.ta.focus(); else act.querySelector('.btn.primary:not([disabled])')?.focus();
      });
      const clear = () => { ta.value = ''; chars = []; born = []; paint(); grow(); };
      return { ...f, ta, row, ink, clear, sync, grow };
    }

    function renderAct() {
      const t = texts(), COST = cost(), bytes = Math.max(0, ...t.map(Store.bytes)), over = bytes > MAXB;
      count.textContent = `${bytes.toLocaleString('en-US')} / ${MAXB.toLocaleString('en-US')}` + (over ? ' · too long' : '');
      count.classList.toggle('over', over);
      // FireSale takes the PAPER, so it needs a PAPER approval first (just this suggestion's cost)
      const state = !connected() ? 'connect' : paper() < COST ? 'short' : approving ? 'approving' : Store.needsApproval('PAPER', COST) ? 'approve' : 'send';
      const off = busy || !t.length || over;
      patch(act, JSON.stringify([state, off, paper(), COST]), () => {
        let a;
        if (state === 'connect') a = connectBtn();
        else if (state === 'short') a = h('div', { class: 'row' }, h('span', { class: 'why', text: `Need ${COST} PAPER` }), btn('Send', 'primary', null, { disabled: true, 'data-key': 'send' }), getPaperBtn());
        else if (state === 'approving') a = btn('Approving…', 'primary', null, { disabled: true, 'data-key': 'send' });
        else if (state === 'approve') a = btn('Approve PAPER', 'primary', approve, { disabled: off, 'data-key': 'send' });
        else a = btn('Send', 'primary', send, { disabled: off, 'data-key': 'send' });
        put(act, h('span', { class: 'muted', html: `Costs <b class="price">${COST} PAPER</b> · you have ${paper()}` }), a);
      });
    }
    function approve() {
      if (approving) return; approving = true; renderAct(); const COST = cost();
      const ok = () => { approving = false; renderAct(); act.querySelector('.btn.primary:not([disabled])')?.focus({ preventScroll: true }); };
      if (window.UI?.approveNow) window.UI.approveNow('PAPER', COST, ok); else { Store.update(() => Store.approve('PAPER', COST)); ok(); }
    }
    // this round's wave already has published results: its ideas that weren't picked are done
    const decided = (kind) => Store.SUGGEST_RESULTS.some((w) => w.series === S().series.no + 1 && (w.wave === 'characters') === (kind === 'character'));
    function renderList() {
      const list = S().suggestions;
      patch(listEl, JSON.stringify([list, S().series.no]), () => put(listEl, h('h3', { text: 'Your ideas' }), list.length ? h('ul', {}, list.map((sg) => {
        const p = Store.parseSuggestion(sg.text), key = sg.at + '|' + sg.text;
        const more = p.kind === 'character' ? [['Personality', p.personality], ['Background', p.background]].filter(([, x]) => x) : [];
        const det = more.length ? h('details', { class: 'sg-more', open: opened.has(key) },
          h('summary', { text: more.map(([k]) => k).join(' · ') }),
          h('dl', {}, more.map(([k, x]) => [h('dt', { text: k }), h('dd', { text: x })]))) : null;
        det?.addEventListener('toggle', () => { if (det.open) opened.add(key); else opened.delete(key); });
        return h('li', {},
          h('div', { class: 'sg-main' }, h('span', { class: 'sg-t', text: p.kind === 'character' ? p.character || sg.text : (p.kind === 'theme' ? 'Theme: ' : 'Art style: ') + p.value }), det),
          h('span', { class: 'muted', text: sg.at }),
          h('span', { class: 'sgp ' + (sg.picked ? 'yes' : 'wait'), text: sg.picked ? 'Picked' : sg.at === 'Series ' + S().series.no && !decided(p.kind) ? 'Waiting' : 'Not picked' })); // past rounds and decided waves: not picked
      })) : h('p', { class: 'muted', text: 'Nothing yet.' })));
    }
    async function send() {
      const t = texts(), COST = cost();
      if (busy || !t.length || t.some((x) => Store.bytes(x) > MAXB) || paper() < COST || !connected() || Store.needsApproval('PAPER', COST)) return;
      busy = true;
      if (LIVE && !(await Live.suggest(t))) { busy = false; return renderAct(); }
      // one transaction either way: suggest(text) for one, suggestMany(texts) for a theme and an art style together
      if (!LIVE) Store.update((s) => {
        s.wallet.balances.PAPER -= COST; Store.spend('PAPER', COST);
        t.slice().reverse().forEach((text) => s.suggestions.unshift({ text, at: 'Series ' + s.series.no, picked: false }));
        Store.log(LOOK ? (t.length > 1 ? 'Suggested a theme and an art style' : 'Suggested ' + (t[0].startsWith('Theme') ? 'a theme' : 'an art style')) : 'Suggested a character');
      });
      window.Fun?.emit('suggested', { n: t.length });
      document.activeElement?.blur?.();
      try { await foldAndDrop(); } catch { /* closed mid-flight */ }
      fields.forEach((f) => f.clear());
      formBits.forEach((el) => { el.hidden = true; });
      paperEl.hidden = true; doneEl.hidden = false; doneEl.classList.remove('in'); void doneEl.offsetWidth; doneEl.classList.add('in');
      busy = false; renderAct(); doneEl.focus({ preventScroll: true }); toast('Sent. Fingers crossed!', 'good');
    }

    // ---------- the fold and the drop
    async function foldAndDrop() {
      const dlg = document.getElementById('sheet-suggest'), snd = (n, ms = 0) => setTimeout(() => window.Sound?.play(n), ms);
      if (reduced() || !dlg?.open || !paperEl.animate) { snd('paper-fold'); snd('suggestion-drop', 450); return; } // no animation: the sounds still say it went in
      paperEl.scrollIntoView({ block: 'nearest' });
      const r = paperEl.getBoundingClientRect(), W = r.width, H3 = r.height / 3;
      const face = (k) => { // one third of the paper, as it looks now
        const clip = h('div', { class: 'fp-face' }), copy = paperEl.cloneNode(true);
        copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id')); copy.classList.add('dry');
        copy.style.cssText = `position:absolute;left:0;top:${-k * H3}px;width:${W}px;height:${r.height}px;margin:0;visibility:visible`;
        clip.append(copy); return clip;
      };
      const panel = (k) => h('div', { class: 'fp fp' + k }, face(k), h('div', { class: 'fp-back' }));
      const top = panel(0), mid = panel(1), bot = panel(2); mid.append(top, bot);
      const pack = h('div', { class: 'sg-pack' }, mid);
      const fly = h('div', { class: 'sg-fly', style: `left:${r.left}px;top:${r.top + H3}px;width:${W}px;height:${H3}px` }, pack);
      dlg.append(fly); paperEl.style.visibility = 'hidden';
      const ease = 'cubic-bezier(.55,.05,.35,1)', go = (el, kf, o) => el.animate(kf, { fill: 'forwards', easing: ease, ...o }).finished;
      try {
        // two folds: the bottom third up, then the top third down over it
        snd('paper-fold');
        await go(bot, [{ transform: 'rotateX(0deg) translateZ(0px)' }, { transform: 'rotateX(180deg) translateZ(-1px)' }], { duration: 520 });
        await go(top, [{ transform: 'rotateX(0deg) translateZ(0px)' }, { transform: 'rotateX(-180deg) translateZ(-2px)' }], { duration: 520 });
        const tgt = boxTarget(dlg);
        if (tgt) { // into the Suggest pill/station in the scene
          const t = tgt.getBoundingClientRect(), dx = t.left + t.width / 2 - (r.left + W / 2), dy = t.top + t.height / 2 - (r.top + 1.5 * H3);
          const s = Math.min(1, 46 / W);
          snd('suggestion-drop', 640); // lands as it reaches the box
          await go(pack, [{ transform: 'translate(0,0) scale(1) rotate(0deg)' }, { transform: 'translate(0,-14px) scale(.92) rotate(-4deg)', offset: .25 },
            { transform: `translate(${dx}px,${dy}px) scale(${s}) rotate(8deg)`, opacity: 1, offset: .88 }, { transform: `translate(${dx}px,${dy}px) scale(${s * .6}) rotate(8deg)`, opacity: 0 }],
          { duration: 900, easing: 'cubic-bezier(.45,0,.55,1)' });
          tgt.classList.remove('sg-got'); void tgt.offsetWidth; tgt.classList.add('sg-got'); setTimeout(() => tgt.classList.remove('sg-got'), 900);
        } else { // into a box in the window
          const bw = Math.min(150, W * .5), s = Math.min(1, (bw * .4) / W), bh = bw * .78, cx = r.left + W / 2, by = r.top + r.height * .5;
          const box = h('div', { class: 'sg-dropbox', style: `left:${cx - bw / 2}px;top:${by}px;width:${bw}px;height:${bh}px`, html: BOX_SVG });
          box.style.zIndex = '19'; dlg.append(box); // behind the packet until it reaches the slot
          box.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 260, fill: 'forwards' });
          const slot = by + bh * .14, dx = 0, h0 = H3 * s; // the packet lands just above the slot, then slides in
          const dyAbove = slot - h0 / 2 - (r.top + 1.5 * H3);
          await go(pack, [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px,${dyAbove}px) scale(${s})` }], { duration: 560 });
          fly.style.zIndex = '1'; box.style.zIndex = '2'; // the box now covers it: it slides in through the slot
          snd('suggestion-drop');
          await go(pack, [{ transform: `translate(${dx}px,${dyAbove}px) scale(${s})` }, { transform: `translate(${dx}px,${dyAbove + h0 + 6}px) scale(${s})` }], { duration: 380, easing: 'cubic-bezier(.5,0,.75,0)' });
          await box.animate([{ transform: 'none' }, { transform: 'translateY(3px) scaleY(.96)' }, { transform: 'none' }], { duration: 220 }).finished;
          await box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished;
          box.remove();
        }
      } finally { fly.remove(); }
    }
    function boxTarget(dlg) { // the Suggest pill or station, if it's on screen and not under this window
      const d = dlg.getBoundingClientRect();
      return [...document.querySelectorAll('#pills [data-st="suggest"], .stations [data-st="suggest"]')].find((el) => {
        const t = el.getBoundingClientRect(), cx = t.left + t.width / 2, cy = t.top + t.height / 2;
        return t.width > 0 && getComputedStyle(el).visibility !== 'hidden' && cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight
          && !(cx > d.left - 8 && cx < d.right + 8 && cy > d.top - 8 && cy < d.bottom + 8);
      }) || null;
    }

    const root = h('div', { class: 'st st-suggest' },
      h('p', { class: 'slead', text: LOOK ? 'What should the next Series look like?' : 'Who should be on a card in the next Series?' }),
      h('p', { id: 'sg-hint', class: 'hint', text: LOOK
        ? `One or both. ${Store.PRICES.SUGGEST_PAPER} PAPER each.`
        : 'Anyone or anything. Add a personality if you like.' }),
      stage, notes, act, listEl);
    const render = () => { renderAct(); renderList(); };
    listen('suggest', render);
    Sheet.open('suggest', { title: LOOK ? 'Suggest a theme and art style' : 'Suggest a character', body: root, onClose: () => { unlisten('suggest'); document.querySelectorAll('.sg-fly, .sg-dropbox').forEach((el) => el.remove()); } });
    render(); fields.forEach((f) => f.sync()); setTimeout(() => fields[0].ta.focus(), 50);
    document.fonts?.ready.then(() => fields.forEach((f) => f.grow())); // the handwriting font changes the line breaks
  }

  // =====================================================================================
  // 5. Suggestion results
  // =====================================================================================
  // Every wave the owner published (Store.SUGGEST_RESULTS, from ops/suggestions/publish.mjs): the winners, the 10 drawn
  // at random per kind, how anyone can check the draw, and what's next. A winner's wallet sees "You won a free pack"
  // (FireCredits.pickSuggestions already put it in their wallet). New results get a one-time reveal (resultsReveal).
  const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
  const me = () => (connected() ? S().wallet.full || '' : '');
  const isMe = (a) => !!me() && String(a).toLowerCase() === me().toLowerCase();
  const mineIn = (x) => isMe(x.by) || (x.alsoBy || []).some(isMe);
  const waveTitle = (w) => `Series ${w.series} · ${w.wave === 'look' ? 'Theme & art style' : 'Characters'}`;
  const waveKey = (w) => `${w.series}-${w.wave}`;
  const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const KIND_LABEL = { theme: 'Theme', style: 'Art style', character: 'Character' };
  const drawCmd = (w) => `node suggestions/draw.mjs --round ${w.round} --seed ${w.seed} --kind ${w.wave === 'look' ? 'look' : 'character'}`;
  function youBanner(w, compact = false) {
    if (!connected()) return h('div', { class: 'rs-you' }, h('p', { text: 'Connect to see how your idea did.' }), compact ? null : connectBtn());
    const r = Store.resultFor(w, me());
    if (r === 'won') {
      // the picks are made on chain once per Series, at its drop setup: until then the pack is on its way
      const win = w.winners.find((x) => isMe(x.by)) || w.winners[0], open = S().series.phase < 4, landed = !!win.tx;
      return h('div', { class: 'rs-you won' },
        h('p', { class: 'rs-you-k', text: 'You won a free pack!' }),
        h('p', { text: `"${win.title}" was picked! ` + (landed
          ? 'Your free pack is in your wallet.'
          : `Your free pack lands before Series ${w.series} goes on sale.`) }),
        compact || !landed ? null : open
          ? btn('Use my free pack', 'primary', () => { Sheet.close('results'); Sheet.close('reveal'); const b = document.querySelector('#buybox [data-buy], #buybar [data-buy]'); b?.focus({ preventScroll: true }); b?.classList.add('nudge'); })
          : h('p', { class: 'muted', text: `Use it on any pack when Series ${S().series.no + 1} opens.` }));
    }
    if (r === 'shortlisted') {
      const mine = w.kinds.flatMap((k) => k.shortlist).find(mineIn);
      return h('div', { class: 'rs-you near' }, h('p', { class: 'rs-you-k', text: 'Shortlisted!' }),
        h('p', { text: mine?.title ? `"${mine.title}": not picked this time. Thanks!` : 'Not picked this time. Thanks!' }));
    }
    const sent = S().suggestions.some((x) => x.at === 'Series ' + S().series.no && (Store.parseSuggestion(x.text).kind === 'character') === (w.wave === 'characters'));
    return sent ? h('div', { class: 'rs-you' }, h('p', { text: 'Not drawn this time. Try again next round.' })) : null;
  }
  function winnerCard(x, i) {
    return h('div', { class: 'rs-win' + (isMe(x.by) ? ' mine' : ''), style: `--i:${i}` },
      h('span', { class: 'rs-win-k', text: KIND_LABEL[x.kind] || x.kind }),
      h('span', { class: 'rs-win-t', text: x.title }),
      h('span', { class: 'rs-win-by' }, 'Suggested by ', h('b', { text: shortAddr(x.by) }), isMe(x.by) ? h('span', { class: 'rs-me', text: 'You' }) : null));
  }
  function waveSection(w, wi) {
    const nextBtn = wi === 0 && w.wave === 'look' && Store.SUGGEST_WAVE.wave === 'characters'
      ? btn('Suggest a character', 'primary', () => { Sheet.close('results'); openSuggest(); }) : null;
    return h('section', { class: 'rs-wave' },
      h('div', { class: 'rs-head' }, h('h3', { text: waveTitle(w) }), h('span', { class: 'muted', text: `Picked ${day(w.publishedAt)}` })),
      h('div', { class: 'rs-wins' }, w.winners.map(winnerCard)),
      w.next || nextBtn ? h('div', { class: 'rs-next' }, w.next ? h('p', { text: w.next }) : null, nextBtn) : null,
      w.kinds.map((k) => h('details', { class: 'rs-list', open: wi === 0 && w.kinds.length < 3 ? true : null },
        h('summary', {}, `The 10 ${k.kind === 'character' ? 'characters' : k.label.toLowerCase() + 's'} drawn`, k.pool ? h('small', { text: ` from ${Number(k.pool).toLocaleString('en-US')} ideas` }) : null),
        h('ol', {}, k.shortlist.map((x) => h('li', { class: (x.picked ? 'picked' : '') + (mineIn(x) ? ' mine' : '') },
          h('span', { class: 'rs-t', text: x.title }),
          h('span', { class: 'rs-by', title: x.alsoBy?.length ? 'Sent first' : null }, shortAddr(x.by), x.alsoBy?.length ? h('small', { text: ` +${x.alsoBy.length} had it too` }) : null),
          x.picked ? h('span', { class: 'sgp yes', text: 'Picked' }) : mineIn(x) ? h('span', { class: 'sgp wait', text: 'Yours' }) : h('span')))))),
      h('details', { class: 'rs-fair' }, h('summary', { text: 'How the 10 were drawn' }),
        h('p', { text: 'A fair random draw: one entry per wallet. Same idea twice? The first one wins.' }),
        h('details', { class: 'rs-check' }, h('summary', { text: 'Check the draw' }),
        h('p', { class: 'muted', text: 'Run this to get the same 10:' }),
        h('code', { class: 'rs-cmd', text: drawCmd(w) }),
        h('p', { class: 'muted' }, 'Seed ', h('b', { text: w.seed }), w.suggestions ? ` · ${Number(w.suggestions).toLocaleString('en-US')} ideas sent · ` : ' · ',
          h('a', { href: 'https://github.com/ThiccLiquidity/the-fire/blob/main/ops/suggestions/draw.mjs', target: '_blank', rel: 'noopener', text: 'the draw script' })),
        btn('Copy command', '', (e) => { e.currentTarget.blur(); navigator.clipboard?.writeText(drawCmd(w)).then(() => toast('Copied'), () => toast("Couldn't copy. Select the line instead.", 'bad')); }))));
  }
  function openResults() {
    const root = h('div', { class: 'st st-results' });
    const render = () => {
      const waves = Store.SUGGEST_RESULTS.slice().reverse();
      patch(root, JSON.stringify([waves.map(waveKey), connected(), S().wallet.credits, S().series.phase, Store.SUGGEST_WAVE.wave]), () => {
        if (!waves.length) return put(root, h('p', { class: 'slead', text: 'No results yet.' }),
          h('p', { class: 'muted', text: `Ideas for Series ${S().series.no + 1} are still coming in.` }),
          btn('Suggest an idea', 'primary', () => { Sheet.close('results'); openSuggest(); }));
        put(root, youBanner(waves[0]), waves.map(waveSection));
      });
    };
    listen('results', render);
    Sheet.open('results', { title: 'Idea results', body: root, wide: true, onClose: () => unlisten('results') });
    render(); markSeen();
  }
  // the reveal: new results, once per visitor (localStorage), when nothing else is open
  const SEEN_RESULTS = 'omni.resultsSeen';
  const latest = () => Store.SUGGEST_RESULTS[Store.SUGGEST_RESULTS.length - 1];
  const seenKey = () => { try { return localStorage.getItem(SEEN_RESULTS) || ''; } catch { return null; } };
  function markSeen() { const w = latest(); if (w) try { localStorage.setItem(SEEN_RESULTS, waveKey(w)); } catch { /* private window */ } }
  let revealed = false, revealTimer = 0;
  function resultsReveal() {
    revealTimer = 0;
    const w = latest(); if (!w || revealed) return;
    const k = seenKey(); if (k === null || k === waveKey(w)) return; // storage blocked: don't show it on every visit
    if (Sheet.covering || !document.getElementById('loading')?.classList.contains('done')) { revealTimer = setTimeout(resultsReveal, 1500); return; }
    revealed = true; markSeen();
    const you = h('div', { class: 'rs-you-host' });
    const body = h('div', { class: 'st rs-reveal' + (reduced() ? ' still' : '') },
      h('p', { class: 'rs-kick', text: 'The results are in' }),
      h('h3', { class: 'rs-big', text: w.wave === 'look' ? `Series ${w.series} will be…` : `On the cards in Series ${w.series}…` }),
      h('div', { class: 'rs-wins' }, w.winners.slice(0, 6).map(winnerCard)),
      you,
      h('div', { class: 'row rs-act' }, btn('See all results', 'primary', () => { Sheet.close('reveal'); openResults(); }), btn('Close', '', () => Sheet.close('reveal'))));
    // the personal line follows the wallet (connect while it's open and it updates)
    const renderYou = () => patch(you, JSON.stringify([connected(), S().wallet.credits]), () => put(you, youBanner(w, true)));
    listen('reveal', renderYou); renderYou();
    Sheet.open('reveal', { title: 'Idea results', body, onClose: () => unlisten('reveal') });
  }
  const queueReveal = () => { if (!revealed && !revealTimer && latest()) revealTimer = setTimeout(resultsReveal, 1200); };
  Store.on(queueReveal); setTimeout(queueReveal, 1000);

  // the suggestion box: a little wooden box with a slot in the lid
  const BOX_SVG = '<svg viewBox="0 0 120 94" aria-hidden="true"><path d="M8 22 L20 6 H100 L112 22 Z" fill="#8a5a2b" stroke="#3a2412" stroke-width="2.5" stroke-linejoin="round"/>'
    + '<rect x="34" y="11" width="52" height="6" rx="3" fill="#1a0f07"/>'
    + '<rect x="8" y="22" width="104" height="66" rx="4" fill="#b0743a" stroke="#3a2412" stroke-width="2.5"/>'
    + '<path d="M8 44 H112 M8 66 H112" stroke="#8a5a2b" stroke-width="2"/><rect x="44" y="40" width="32" height="14" rx="3" fill="#f0ece5" stroke="#3a2412" stroke-width="2"/>'
    + '<path d="M48 45 H72 M48 49 H66" stroke="#8a7b62" stroke-width="1.6" stroke-linecap="round"/></svg>';

  const OPEN = { cards: openTable, open: (o) => openTable({ ...o, view: 'open' }), table: openTable, grade: openGrade, burn: openBurn, suggest: openSuggest, results: openResults, pop: openPop };
  window.Stations = {
    openable, openableCount,
    open(name, opts) { (OPEN[name] || (() => toast('Unknown station', 'bad')))(opts); },
    openCard: openDetail,
    practice: () => openTable({ practice: true }), // a practice pack: no wallet, nothing saved
  };
})();
