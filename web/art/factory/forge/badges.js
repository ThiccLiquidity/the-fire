/* Omni Cardworks (fun layer): badges for doing things, never for luck: no badge is about a pull, a holo or a grade.
   Kept in this browser, per wallet (the demo wallet in the demo).
   TODO: move them on chain or into the profile (profile.js) once profiles have a place to keep them. */
(() => {
  const { h, mem } = Fun;
  const BADGES = [
    ['first-open', 'First rip', 'Open your first pack.', (s) => s.packs >= 1],
    ['packs-10', 'Ten packs', 'Open 10 packs.', (s) => s.packs >= 10],
    ['first-case', 'Safe keeper', 'Case a card.', (s) => s.cased >= 1],
    ['fresh-case', 'Fresh keeper', 'Case a card in its first 24h.', (s) => s.fresh >= 1],
    ['first-slab', 'First slab', 'Grade a card.', (s) => s.slabs >= 1],
    ['common-set', 'Common set', 'Fill a Series’ Common set in the Binder.', (s) => s.sets >= 1],
    ['first-burn', 'Stoker', 'Burn a card.', (s) => s.burned >= 1],
    ['burn-42', '42 club', 'Burn 42 cards.', (s) => s.burned >= 42],
    ['first-idea', 'Idea box', 'Send an idea.', (s) => s.ideas >= 1],
    ['showcase', 'On show', 'Share your showcase.', (s) => s.shared >= 1],
  ];
  const keyOf = (who) => who && { s: 'omni.stats.' + who, b: 'omni.badges.' + who };
  const stats = (who = Fun.who()) => ({ packs: 0, cased: 0, fresh: 0, slabs: 0, sets: 0, burned: 0, ideas: 0, shared: 0, ...(mem(keyOf(who)?.s || '') || {}) });
  const earned = (who = Fun.who()) => (who ? mem(keyOf(who).b) || {} : {});
  function add(field, n = 1, set = false) {
    const who = Fun.who(), k = keyOf(who); if (!k) return;
    const s = stats(who); s[field] = set ? n : (s[field] || 0) + n; mem(k.s, s);
    const have = earned(who), now = [];
    for (const [id, name, , ok] of BADGES) if (!have[id] && ok(s)) { have[id] = Date.now(); now.push(name); }
    if (now.length) { mem(k.b, have); now.forEach((n2, i) => setTimeout(() => toast(`Badge earned: ${n2}!`, 'good'), 900 + i * 1400)); }
  }
  Fun.badge = add;
  Fun.on('opened', async ({ packs = 1, practice }) => {
    if (practice) return; add('packs', packs);
    if (Fun.commonSets) { const sets = await Fun.commonSets(); if (sets.length) add('sets', sets.length, true); }
  });
  Fun.on('paid', ({ cased = 0, graded = 0, fresh = 0 }) => { if (cased) add('cased', cased); if (fresh) add('fresh', fresh); if (graded) add('slabs', graded); });
  Fun.on('burned', ({ n = 1 }) => add('burned', n));
  Fun.on('suggested', () => add('ideas'));

  /** The badges as a row of chips (earned lit, the rest dim with how to get them). */
  function row(who = Fun.who(), { all = true } = {}) {
    const have = earned(who), list = BADGES.filter(([id]) => all || have[id]);
    if (!list.length) return null;
    return h('ul', { class: 'fun-badges', 'aria-label': 'Badges' }, list.map(([id, name, how]) =>
      h('li', { class: have[id] ? 'on' : '', title: how }, h('i', { 'aria-hidden': 'true', html: have[id] ? '&#9733;' : '&#9734;' }), h('b', { text: name }), h('small', { text: have[id] ? 'Earned' : how }))));
  }
  Fun.badgeRow = row;
  Fun.badgeCount = (who) => Object.keys(earned(who)).length;
  Fun.open.badges = () => {
    const who = Fun.who();
    Sheet.open('badges', { title: 'Badges', body: h('div', { class: 'st' }, who ? row(who) : h('p', { class: 'muted', text: 'Connect a wallet to collect badges.' }),
      h('p', { class: 'muted small', text: 'Earned by doing, never by luck. Saved in this browser.' })) });
  };
  // the wallet sheet shows them (ui.js / live.js call this after opening it)
  Fun.decorateWallet = (d) => {
    const who = Fun.who(); if (!d || !who || d.querySelector('.fun-wallet')) return;
    const n = Fun.badgeCount(who);
    const box = h('div', { class: 'fun-wallet' },
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', text: `Badges (${n})`, onclick: () => { d.close(); Fun.open.badges(); } }),
        h('button', { type: 'button', class: 'btn small', text: 'Showcase', onclick: () => { d.close(); Fun.go('showcase'); } }),
        h('button', { type: 'button', class: 'btn small', text: 'Binder', onclick: () => { d.close(); Fun.go('binder'); } })));
    (d.querySelector('.wmenu') || d.querySelector('.sheet-body'))?.append(box);
  };
})();
