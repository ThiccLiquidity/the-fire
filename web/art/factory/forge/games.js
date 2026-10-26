/* Omni Cardworks: the game room. Games register here (Games.add) and the room lists them; each has free play and,
   once paid play is open (the game server and FireGames are live, and the owner has opened it), competitive runs
   for prizes. Paper football (paperfb.js) is the first. The pack/grade wait (wait.js) offers the same games.
   Built for more games later: a game is { id, gameId (on chain), name, blurb, art, entry, mount(host, opts) }.
   Free play stats are kept in this browser, per wallet. Fund flows are never explained here (Info/Help only). */
(() => {
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v; else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const list = [];
  const who = () => (window.Fun?.who?.() || window.Store?.state?.wallet?.full || 'guest').toLowerCase();
  const statsKey = (id) => `omni.game.${id}.${who()}`;
  const loadStats = (id) => { try { return { best: 0, makes: 0, kicks: 0, ...JSON.parse(localStorage.getItem(statsKey(id)) || '{}') }; } catch { return { best: 0, makes: 0, kicks: 0 }; } };
  const saveStats = (id, s) => { try { localStorage.setItem(statsKey(id), JSON.stringify(s)); } catch { /* private window */ } };

  /** A game in a host element: a bar (Back, a status line, a Go button for the wait) over the game's own canvas.
   *  Returns { status(s), stop() } like the wait panel expects. */
  function play(id, host, { onBack, onGo, mode = 'free' } = {}) {
    const g = list.find((x) => x.id === id); if (!g) return null;
    const st = loadStats(id);
    const back = h('button', { type: 'button', class: 'btn small', 'data-key': 'game-back', onclick: () => onBack?.() }, '← Back');
    const note = h('span', { class: 'gm-note' });
    const go = h('button', { type: 'button', class: 'btn primary small', hidden: true, 'data-key': 'game-go', onclick: () => onGo?.() });
    const stage = h('div', { class: 'gm-stage' });
    const root = h('div', { class: 'gm' }, h('div', { class: 'gm-bar' }, back, note, go), stage);
    host.append(root);
    const game = g.mount(stage, {
      mode,
      onEvent(type, d) {
        if (type === 'kick') st.kicks++;
        if (type === 'make') { st.makes++; if (d.streak > st.best) st.best = d.streak; window.Fun?.badge?.('fg', 1); if (d.streak >= 3) window.Fun?.badge?.('fgBest', st.best, true); }
        if (type === 'kick' || type === 'make') saveStats(id, st);
      },
    });
    let status = {};
    return {
      game,
      status(s) {
        if (s.text === status.text && !!s.ready === !!status.ready) return; status = s;
        note.textContent = s.text || ''; note.classList.toggle('ready', !!s.ready);
        go.hidden = !s.ready; if (s.ready) go.textContent = s.go;
      },
      stop() { game?.destroy?.(); root.remove(); },
    };
  }

  /** The game room: every game, with free play and (when open) a competitive run. */
  function room() {
    let current = null;
    const body = h('div', { class: 'gr' });
    const close = () => { current?.stop(); current = null; render(); };
    function start(g, mode) {
      body.replaceChildren(); current = play(g.id, body, { mode, onBack: close });
      current?.status({ text: mode === 'free' ? 'Free play' : `Competitive · ${g.entry}` });
    }
    function render() {
      body.replaceChildren(h('p', { class: 'muted gr-lead', text: 'Games from the workshop floor. Free to play any time. Competitive runs play for free packs.' }),
        ...list.map((g) => {
          const st = loadStats(g.id), paid = Games.paidOpen(g);
          return h('article', { class: 'gr-game' },
            h('div', { class: 'gr-art', style: `background-image:url(${g.art})`, 'aria-hidden': 'true' }),
            h('div', { class: 'gr-info' },
              h('h3', { text: g.name }), h('p', { class: 'muted small', text: g.blurb }),
              st.kicks ? h('p', { class: 'small gr-stats' }, 'Best streak ', h('b', { text: String(st.best) }), ' · ', h('b', { text: String(st.makes) }), ' makes') : null,
              h('div', { class: 'gr-acts' },
                h('button', { type: 'button', class: 'btn primary', 'data-key': `game-free-${g.id}`, onclick: () => start(g, 'free') }, 'Free play'),
                h('button', { type: 'button', class: 'btn', 'data-key': `game-paid-${g.id}`, disabled: !paid, onclick: () => start(g, 'paid') }, paid ? `Competitive · ${g.entry}` : 'Competitive · soon')),
              h('p', { class: 'muted small gr-prize', text: g.prizes })));
        }));
    }
    render();
    window.Sheet.open('games', { title: 'Game room', body, wide: true, onClose: () => { current?.stop(); current = null; } });
  }

  const Games = window.Games = {
    add(g) { if (!list.some((x) => x.id === g.id)) list.push(g); },
    get list() { return list.slice(); },
    get: (id) => list.find((g) => g.id === id),
    play, room, stats: loadStats,
    /** competitive runs: only once the game server and FireGames are live and the owner has opened them (live.js
     *  sets Games.PAID to the open game ids); never in the demo until then */
    PAID: [],
    paidOpen: (g) => Games.PAID.includes(g.gameId),
  };

  // ---------- paper football (paperfb.js): game 1 on chain
  const ART = { bench: 'ui/paperfb/bench.webp', plank: 'ui/paperfb/plank.webp', plankHit: 'ui/paperfb/plank-hit.webp', plankSurprised: 'ui/paperfb/plank-surprised.webp', plankBlink: 'ui/paperfb/plank-blink.webp', backdrop: '../build3/plate-1280.webp', pack: 'ui/omni-pack.webp', cardBack: 'ui/card-back.webp', paperCoin: 'ui/brand/paper-coin-64.webp', plankCoin: 'ui/brand/plank-coin-64.webp' };
  Games.add({
    id: 'paperfb', gameId: 1, name: 'Paper Football', entry: '1 PAPER', art: ART.bench,
    blurb: 'Flick the folded paper through the pencils. Every make moves the goal. Clear Plank and find the furnace.',
    prizes: 'Each Series, the three best competitive streaks win 3, 2 and 1 free packs.',
    mount: (host, opts) => window.PaperFootball?.mount(host, { art: ART, onEvent: opts.onEvent, mute: () => !(window.Sound?.on ?? true), haptic: (p) => window.Fun?.haptics?.on !== false && navigator.vibrate?.(p) }),
  });
})();
