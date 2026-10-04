/* Omni Forge mock: shared state (demo data, no chain), events, toasts and the sheet (dialog) helper.
   Every other module reads and writes through window.Store and opens screens with window.Sheet. */
(() => {
  const MATS = ['paper', 'wood', 'fire', 'charcoal', 'diamond'];
  const MAT_LABEL = { paper: 'Paper', wood: 'Wood', fire: 'Fire', charcoal: 'Charcoal', diamond: 'Diamond' };
  const NAMES = ['Ember Fox', 'Old Plank', 'Paper Crane', 'Ash Owl', 'Kettle Knight', 'Cinder Cat', 'Bellows Bear', 'Soot Sprite'];
  // demo collection: cards from Series 5 and 6 (already closed), with a spread of materials, holos and grades
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pickMat = () => { const u = R(); return u < 0.5 ? 'paper' : u < 0.8 ? 'wood' : u < 0.95 ? 'fire' : u < 0.995 ? 'charcoal' : 'diamond'; };
  const cards = [];
  for (let i = 0; i < 46; i++) {
    const material = i === 3 ? 'diamond' : i === 9 ? 'charcoal' : pickMat();
    const holoRate = { paper: 0.05, wood: 0.1, fire: 0.5, charcoal: 0.9, diamond: 1 }[material];
    const holo = i === 5 ? 'full' : R() < holoRate ? ['frame', 'picture', 'full'][Math.floor(R() * 3)] : 'none';
    const series = i < 20 ? 5 : 6;
    const g = R();
    cards.push({
      id: 1000 + i, serial: 300 + i * 7, series, character: NAMES[Math.floor(R() * NAMES.length)], material,
      holo: material === 'paper' && i === 5 ? 'full' : holo, edition: `${1 + Math.floor(R() * 40)} of ${41 + Math.floor(R() * 20)}`,
      grade: g < 0.55 ? null : Math.max(1, Math.min(10, Math.round(5.5 + (R() - 0.5) * 6))), pending: false,
    });
  }
  cards[5].material = 'paper'; cards[5].holo = 'full'; // a full-holo Paper, the rare one to show off

  const state = {
    demo: true,
    series: { no: 7, total: 167, starters: 50, startersClaimed: 23, sold: 12, plankOnly: 50, plankSold: 12, phase: 0, closed: false },
    // phase: 0 holders first + PLANK only, 1 holders first (any currency), 2 open to all (max 5), 3 no limit, 4 sold out
    wallet: {
      connected: false, address: '0x7a3f…c91e', name: 'Travis', isPressHolder: true, inSnapshot: true, isContract: false,
      balances: { ETH: 0.42, PLANK: 1250000000, PAPER: 24, USDG: 50 },
      credits: 1, burnCount: 12, starterClaimed: false, bought: 0, pending: [],
    },
    sealed: { 7: 0, 6: 2, 5: 1 }, // sealed packs owned, by Series (5 and 6 are closed: they can be opened)
    cards,
    suggestions: [{ text: 'A lighthouse keeper', at: 'Series 6', picked: true }, { text: 'Grandma’s cast-iron pan', at: 'Series 7', picked: false }],
    activity: [],
  };
  const listeners = new Set();
  const Store = {
    state, MATS, MAT_LABEL,
    get(path) { return path.split('.').reduce((o, k) => o?.[k], state); },
    update(fn) { fn(state); listeners.forEach((l) => l(state)); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    left() { const s = state.series; return s.phase >= 4 ? 0 : Math.max(0, s.total - s.startersClaimed - s.sold); },
    paidLeft() { const s = state.series; return Math.max(0, s.total - s.starters - s.sold + (s.phase >= 2 ? s.starters - s.startersClaimed : 0)); },
    log(text) { state.activity.unshift({ text, t: Date.now() }); state.activity.length = Math.min(state.activity.length, 30); },
    cardImg(c) { // frame thumbnail for a card: material, holo frame, wear level by grade
      const lvl = c.grade == null || c.grade === 10 ? '' : c.grade === 1 ? '-l6' : '-l' + (6 - Math.floor(c.grade / 2));
      const holo = c.holo === 'frame' || c.holo === 'full' ? '-holo' : '';
      return `ui/frames/${c.material}${holo}${lvl}.webp`;
    },
  };

  // toasts: short, stacked under the top bar
  const toastHost = document.createElement('div'); toastHost.className = 'toasts'; toastHost.setAttribute('role', 'status'); toastHost.setAttribute('aria-live', 'polite');
  document.addEventListener('DOMContentLoaded', () => document.body.append(toastHost));
  function toast(text, kind = '') {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; toastHost.append(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  // sheets: native <dialog>, focus returns to the opener, Escape and the backdrop close it
  const Sheet = {
    open(id, { title, body, wide = false, onClose } = {}) {
      let d = document.getElementById('sheet-' + id);
      if (!d) {
        d = document.createElement('dialog'); d.id = 'sheet-' + id; d.className = 'sheet' + (wide ? ' wide' : '');
        d.innerHTML = `<div class="sheet-head"><h2></h2><button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-body"></div>`;
        d.querySelector('.x').onclick = () => d.close();
        d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
        d.addEventListener('close', () => { d._opener?.focus?.(); d._onClose?.(); });
        document.body.append(d);
      }
      d._opener = document.activeElement; d._onClose = onClose;
      d.querySelector('h2').textContent = title || '';
      const b = d.querySelector('.sheet-body'); if (typeof body === 'string') b.innerHTML = body; else if (body) { b.replaceChildren(body); }
      if (!d.open) d.showModal();
      return d;
    },
    close(id) { document.getElementById('sheet-' + id)?.close(); },
  };

  window.Store = Store; window.Sheet = Sheet; window.toast = toast;
})();
