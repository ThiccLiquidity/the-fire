/* Omni Cardworks (fun layer): tap-to-explain words. The glossary below is the one place these short lines live. In an
   open sheet, the first time each word appears in plain text it gets a dotted underline; tap it for a one-line pop.
   Never inside buttons, links, form fields, live status lines or the opening table, and never while a pack is being
   opened. Scans run when the browser is idle, a moment after a sheet changes. */
(() => {
  const { h } = Fun;
  // one short line each (no prices, nothing about where money goes: these show on buy and grading screens too)
  const GLOSSARY = {
    PDA: 'Professional Digital Authenticators: the grade on a slab, 1 to 10. A 10 is GEM MINT.',
    cased: 'In a clear case. No more wear. Grade it any time.',
    slab: 'A graded card, sealed for good with its grade.',
    fresh: 'A card’s first 24 hours. Time doesn’t wear it, and casing or grading it now keeps fresh odds.',
    wear: 'Raw cards wear with time and moves. Wear lowers the grade.',
    raw: 'Not cased or graded yet. Raw cards wear.',
    holo: 'A rainbow foil on the frame, the picture, or both (full holo).',
    Series: 'One numbered run of cards, with its own cast, odds and settings.',
    sealed: 'An unopened pack. It’s an NFT too: keep it, collect it, or trade it sealed.',
    PAPER: 'A meme coin on Robinhood Chain, and what the cards are printed on. Every pack takes some. Tap Get PAPER.',
    PLANK: 'A meme coin on Robinhood Chain, and the wood that feeds the workshop’s fire. Holders get in early.',
  };
  // the word shown in bold at the start of each pop
  const LABEL = { cased: 'Cased', slab: 'Slab', fresh: 'Fresh', wear: 'Wear', raw: 'Raw', holo: 'Holo', sealed: 'Sealed pack' };
  // the words as they appear in sentences, and which entry each one opens
  const FORMS = [['PDA', 'PDA', true], ['cased', 'cased', false], ['Cased', 'cased', true], ['slabs?', 'slab', false], ['slabbed', 'slab', false],
    ['fresh', 'fresh', false], ['Fresh', 'fresh', true], ['wear', 'wear', false], ['Wear', 'wear', true], ['raw', 'raw', false], ['Raw', 'raw', true],
    ['holo', 'holo', false], ['Holo', 'holo', true], ['sealed packs?', 'sealed', false], ['Sealed packs?', 'sealed', true],
    ['Series', 'Series', true], ['PAPER', 'PAPER', true], ['PLANK', 'PLANK', true]];
  const RE = new RegExp(`(?<![\\w-])(${FORMS.map(([f]) => f).join('|')})(?![\\w-])`);
  const keyOf = (w) => (FORMS.find(([f]) => new RegExp(`^${f}$`).test(w)) || [])[1];
  const SKIP = 'summary, button, a, label, select, option, input, textarea, code, [aria-live], .stage-msg, .st-table .stage, .op, .tier-b, .mat, .pda, .gl-term, .gl-pop, .sr, svg, .fun-noterms, h2, .bw-flag, .sum dt, .bal, .wmenu .rows, .fun-badges, .fd-board, .bd-head, .prac-sum, .rs-wins';
  const OK = 'p, li, dd, small, span, figcaption';

  function scan(root) {
    const seen = new Set([...root.querySelectorAll('.gl-term')].map((b) => b.dataset.term));
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
      const p = n.parentElement; if (!p || !n.nodeValue.trim() || p.closest(SKIP) || !p.closest(OK)) return NodeFilter.FILTER_REJECT;
      return RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    const hits = []; let n; while ((n = w.nextNode())) hits.push(n);
    for (const node of hits) {
      const m = node.nodeValue.match(RE); if (!m) continue;
      const key = keyOf(m[1]); if (!key || seen.has(key)) continue;
      seen.add(key);
      const at = m.index, word = node.splitText(at); word.splitText(m[1].length);
      const b = h('button', { type: 'button', class: 'gl-term', 'data-term': key, 'aria-haspopup': 'dialog', 'aria-label': `${m[1]}: what's this?` }, m[1]);
      word.replaceWith(b);
    }
  }
  let timer = 0;
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 200));
  function soon() { clearTimeout(timer); timer = setTimeout(() => idle(run), 350); }
  function run() {
    for (const d of document.querySelectorAll('dialog.sheet[open]')) {
      const body = d.querySelector('.sheet-body'); if (!body || d.querySelector('.stage.opening, .wz-work')) continue;
      scan(body);
    }
  }
  const counts = (t) => !t.closest || t.closest('.gl-pop, .gl-term, [data-until], .cd, .fun-flap') || !(t === document.body || t.closest('dialog.sheet'));
  new MutationObserver((list) => { if (list.some((r) => !counts(r.target))) soon(); })
    .observe(document.body, { childList: true, subtree: true });

  // the pop: one line under the word, inside the same dialog (so it sits in the top layer with it)
  let pop = null;
  function close() { pop?.remove(); pop = null; }
  function show(b) {
    close();
    const key = b.dataset.term, host = b.closest('dialog') || document.body;
    pop = h('span', { class: 'gl-pop', role: 'tooltip', id: 'gl-pop' }, h('b', { text: LABEL[key] || key }), ' ', GLOSSARY[key]);
    host.append(pop); b.setAttribute('aria-describedby', 'gl-pop');
    const r = b.getBoundingClientRect(), hr = host === document.body ? { left: 0, top: 0, width: innerWidth } : host.getBoundingClientRect();
    const w = Math.min(280, hr.width - 16), x = Math.max(8, Math.min(hr.width - w - 8, r.left - hr.left + r.width / 2 - w / 2));
    const below = r.bottom - hr.top + 8, above = r.top - hr.top - 8;
    pop.style.width = w + 'px'; pop.style.left = x + 'px';
    if (r.bottom + 90 > innerHeight) { pop.style.top = above + 'px'; pop.classList.add('up'); } else pop.style.top = below + 'px';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.gl-term');
    if (b) { e.preventDefault(); e.stopPropagation(); if (pop && b.getAttribute('aria-describedby') === 'gl-pop' && pop.isConnected) return close(); return show(b); }
    if (pop && !e.target.closest('.gl-pop')) close();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { close(); } }, true);
  addEventListener('scroll', close, true);
  Fun.GLOSSARY = GLOSSARY;
  Fun.termsScan = run;
})();
