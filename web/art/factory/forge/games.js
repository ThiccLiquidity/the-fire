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
  function play(id, host, { onBack, onGo, mode = 'free', onKick } = {}) {
    const g = list.find((x) => x.id === id); if (!g) return null;
    const st = loadStats(id);
    const back = h('button', { type: 'button', class: 'btn small', 'data-key': 'game-back', onclick: () => onBack?.() }, '← Back');
    const note = h('span', { class: 'gm-note' });
    const go = h('button', { type: 'button', class: 'btn primary small', hidden: true, 'data-key': 'game-go', onclick: () => onGo?.() });
    const stage = h('div', { class: 'gm-stage' });
    const root = h('div', { class: 'gm' }, h('div', { class: 'gm-bar' }, back, note, go), stage);
    host.append(root);
    const game = g.mount(stage, {
      mode, waitForShot: mode === 'paid',
      onEvent(type, d) {
        if (mode === 'paid') { onKick?.(type, d); return; } // a competitive run: the run counts, not the free-play stats
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
      if (mode === 'paid') return Comp.start(g, body, close, (c) => { current = c; });
      body.replaceChildren(); current = play(g.id, body, { mode, onBack: close });
      current?.status({ text: 'Free play' });
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
                h('button', { type: 'button', class: 'btn', 'data-key': `game-paid-${g.id}`, disabled: !paid, onclick: () => start(g, 'paid') }, paid ? `Competitive · ${g.entry}` : 'Competitive · soon'),
                h('button', { type: 'button', class: 'btn small ghost', 'data-key': `game-board-${g.id}`, onclick: () => Comp.board(g) }, 'Leaderboard')),
              h('p', { class: 'muted small gr-prize', text: g.prizes })));
        }));
    }
    render();
    Comp.refresh().then(() => { if (!current) render(); }); // whether competitive runs are open now
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

  // ---------- competitive runs. Live: the game server (web/api/games) deals each shot and judges each kick, FireGames
  // takes the entry. The demo plays the same screens with nothing charged and a board kept in this browser.
  const LIVE = !!window.Live?.on;
  const api = async (g, action, body) => {
    const r = await fetch(`/api/games/${g.gameId}/${action}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `The game server answered ${r.status}.`), { status: r.status, data: j });
    return j;
  };
  const wallet = () => window.Store?.state?.wallet?.full || '';
  const runKey = (g) => `omni.game.run.${g.gameId}.${wallet().toLowerCase()}`;
  const keepRun = (g, r) => { try { r ? localStorage.setItem(runKey(g), JSON.stringify(r)) : localStorage.removeItem(runKey(g)); } catch { /* private window */ } };
  const savedRun = (g) => { try { return JSON.parse(localStorage.getItem(runKey(g)) || 'null'); } catch { return null; } };
  const DEMO_BOARD = 'omni.game.demoBoard';
  const series = () => window.Store?.state?.series?.no || 1;

  const Comp = {
    /** live: whether FireGames is open for paid runs (and the Series it counts toward); the demo: always */
    async refresh() {
      if (!LIVE) { Games.PAID = list.map((g) => g.gameId); return; }
      const open = [];
      for (const g of list) { try { if ((await window.Live.gameStatus(g.gameId)).open) open.push(g.gameId); } catch { /* not deployed yet */ } }
      Games.PAID = open;
    },
    /** the start screen: the rules, the 18+ check, then pay and play (or pick up a run already paid for) */
    start(g, body, back, setCurrent) {
      const saved = LIVE ? savedRun(g) : null;
      const adult = h('input', { type: 'checkbox', id: 'gm-adult' });
      const go = h('button', { type: 'button', class: 'btn primary', 'data-key': 'comp-pay', disabled: true }, LIVE ? `Pay ${g.entry} and play` : `Play (demo: nothing is charged)`);
      adult.onchange = () => { go.disabled = !adult.checked; };
      const msg = h('p', { class: 'warn small', hidden: true });
      go.onclick = async () => { go.disabled = true; msg.hidden = true; try { await Comp.begin(g, body, back, setCurrent); } catch (e) { msg.textContent = e.message; msg.hidden = false; go.disabled = !adult.checked; } };
      body.replaceChildren(h('div', { class: 'gm-start' },
        h('button', { type: 'button', class: 'btn small', onclick: back }, '← Back'),
        h('h3', { text: `${g.name}: competitive` }),
        h('ul', { class: 'gm-rules' },
          h('li', { text: `${g.entry} per run.` }),
          h('li', { text: 'Up to 3 practice kicks first. They don\'t count.' }),
          h('li', { text: 'Your first miss ends the run.' }),
          h('li', { text: 'Your best streak this Series is your place on the board. A tie goes to whoever got there first.' }),
          h('li', { text: 'When the Series ends, the top three win 3, 2 and 1 free packs.' }),
          h('li', { text: 'Each kick is checked by our game server. Its call is final.' })),
        saved ? h('button', { type: 'button', class: 'btn', 'data-key': 'comp-resume', onclick: () => Comp.resume(g, saved, body, back, setCurrent).catch((e) => { msg.textContent = e.message; msg.hidden = false; }) }, 'Pick up your run') : null,
        h('label', { class: 'gm-adult', for: 'gm-adult' }, adult, ' I\'m 18 or older and competitive play is allowed where I live.'),
        go, msg,
        h('p', { class: 'muted small' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.Info?.open?.('games'); } }, 'Official rules'))));
    },
    async begin(g, body, back, setCurrent) {
      if (!LIVE) return Comp.play(g, { demo: true, series: series() }, body, back, setCurrent);
      await new Promise((ok) => window.Live.needWallet(() => ok()));
      const c = await api(g, 'create', { wallet: wallet(), adult: true, series: window.Store?.state?.series?.no });
      const rc = await window.Live.payRun({ gameId: c.gameId, runId: c.runId, series: c.series, deadline: c.deadline, sig: c.sig });
      if (!rc) throw new Error('Nothing was paid.');
      const r = { runId: c.runId, cap: c.cap, series: c.series, txHash: rc.transactionHash || null };
      keepRun(g, r);
      if (!r.txHash) throw new Error('Your payment is still on its way. Open the Game room again in a minute to play.');
      await Comp.confirm(g, r);
      return Comp.play(g, r, body, back, setCurrent);
    },
    async confirm(g, r) {
      for (let i = 0; i < 6; i++) {
        try { return await api(g, 'confirm', { runId: r.runId, cap: r.cap, txHash: r.txHash }); }
        catch (e) { if (!e.data?.retry || i === 5) throw e; await new Promise((ok) => setTimeout(ok, 2500)); }
      }
    },
    async resume(g, r, body, back, setCurrent) {
      if (r.txHash) await Comp.confirm(g, r);
      const st = await api(g, 'run', { runId: r.runId, cap: r.cap });
      if (st.over) { keepRun(g, null); throw new Error(`That run is over: a streak of ${st.streak}.`); }
      return Comp.play(g, r, body, back, setCurrent);
    },
    /** the run itself: practice kicks, then scored kicks until the first miss */
    play(g, r, body, back, setCurrent) {
      const demo = !!r.demo;
      let practiceLeft = 3, practicing = true, streak = 0, cur = null, shotAt = 0, timer = 0, over = false, busy = false, landed = null;
      // the engine shows a shot only between kicks: keep offering it until the last flight has finished
      const show = (shot) => new Promise((ok) => { const t = () => (over || c.game.setShot(shot) ? ok() : setTimeout(t, 100)); t(); });
      body.replaceChildren();
      const skip = h('button', { type: 'button', class: 'btn small', 'data-key': 'comp-skip' }, 'Start the run');
      const c = play(g.id, body, { mode: 'paid', onBack: () => { stop(); back(); }, onKick });
      setCurrent(c); Games.current = c; // tests and mocks
      c.game.hold();
      body.querySelector('.gm-bar').append(skip);
      const say = (text) => c.status({ text });
      const tick = () => {
        if (over || !cur) return;
        const left = Math.max(0, Math.ceil((15000 - (Date.now() - shotAt)) / 1000));
        say(`${practicing ? `Practice · ${practiceLeft} left` : `Streak ${streak}`} · kick in ${left}s`);
      };
      const stop = () => { over = true; clearInterval(timer); };
      async function next() {
        if (over) return;
        skip.hidden = !practicing;
        try {
          if (demo) {
            const n = practicing ? -(4 - practiceLeft) : streak;
            cur = { shot: window.PaperFBSim.shotFor(r.seed ??= (Math.random() * 2 ** 31) | 0, n, practicing ? [3, 5, 7][3 - practiceLeft] : streak, window.PaperFootball.DEFAULT_TUNING) };
          } else {
            cur = await api(g, 'shot', { runId: r.runId, cap: r.cap, practice: practicing });
            if (cur.over) return end(cur.streak);
            api(g, 'ping', { token: cur.token }).catch(() => {});
          }
          await show(cur.shot); c.game.setStreak(streak); shotAt = Date.now(); tick();
        } catch (e) { say(e.message); }
      }
      async function onKick(type, d) {
        if ((type === 'make' || type === 'miss') && landed) { landed(type === 'make' ? 'good' : d.why); landed = null; return; }
        if (type !== 'kick' || over || busy || !cur) return;
        busy = true; cur = { ...cur, kicked: true };
        const onScreen = new Promise((ok) => { landed = ok; }); // the engine's own call, from the same physics
        try {
          let v;
          if (demo) { const res = await onScreen; v = { made: res === 'good', result: res }; }
          else { v = await api(g, 'kick', { token: cur.token, cap: r.cap, input: d.input, kickTick: d.kickTick }); await onScreen; }
          if (practicing) { practiceLeft--; if (practiceLeft <= 0) practicing = false; return next(); }
          if (v.made) { streak++; return next(); }
          return end(streak, v.result);
        } catch (e) {
          if (e.data?.rejected || e.data?.stale) { window.toast?.(e.message || "That kick didn't count. Kick again.", 'bad'); return next(); }
          say(e.message);
        } finally { busy = false; }
      }
      skip.onclick = () => { if (!practicing || busy) return; practicing = false; practiceLeft = 0; next(); };
      timer = setInterval(tick, 500);
      async function end(final, why) {
        stop(); keepRun(g, null); c.game.hold();
        if (demo) { try { const b = JSON.parse(localStorage.getItem(DEMO_BOARD) || '[]'); b.push({ wallet: 'you', streak: final, at: Date.now() }); localStorage.setItem(DEMO_BOARD, JSON.stringify(b)); } catch { /* private */ } }
        say(`Run over · streak ${final}`);
        const card = h('div', { class: 'gm-over' },
          h('h3', { text: why === 'delay' ? 'Delay of game' : 'Run over' }),
          h('p', {}, 'Your streak: ', h('b', { text: String(final) })),
          h('div', { class: 'gr-acts' },
            h('button', { type: 'button', class: 'btn primary', 'data-key': 'comp-again', onclick: () => { c.stop(); Comp.start(g, body, back, setCurrent); } }, 'Play again'),
            h('button', { type: 'button', class: 'btn', onclick: () => Comp.board(g) }, 'Leaderboard'),
            h('button', { type: 'button', class: 'btn ghost', onclick: () => { c.stop(); back(); } }, 'Done')));
        body.querySelector('.gm-stage')?.append(card);
      }
      next();
    },
    /** the Series' leaderboard: one row per wallet, its best streak */
    async board(g) {
      const el = h('div', { class: 'gm-board' }, h('p', { class: 'muted', text: 'Loading…' }));
      window.Sheet.open('game-board', { title: `${g.name} · Series ${series()}`, body: el });
      let rows = [];
      try {
        if (!LIVE) {
          const mine = JSON.parse(localStorage.getItem(DEMO_BOARD) || '[]'), best = mine.reduce((a, x) => Math.max(a, x.streak), 0);
          rows = [{ wallet: '0x7a3…91c', streak: 14 }, { wallet: '0x2be…04d', streak: 11 }, { wallet: '0x9f1…7aa', streak: 9 }, { wallet: '0x51c…e02', streak: 6 }];
          if (mine.length) rows.push({ wallet: 'you', streak: best, me: true });
          rows.sort((a, b) => b.streak - a.streak); rows.forEach((x, i) => { x.rank = i + 1; });
        } else {
          const j = await api(g, `board?series=${series()}`); const me = wallet().toLowerCase();
          rows = j.rows.map((x) => ({ ...x, me: x.wallet?.toLowerCase() === me }));
        }
      } catch (e) { el.replaceChildren(h('p', { class: 'muted', text: e.data?.closed ? 'The leaderboard opens with competitive play.' : e.message })); return; }
      const short = (a) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
      el.replaceChildren(
        rows.length ? h('ol', { class: 'gm-rows' }, rows.slice(0, 50).map((x) => h('li', { class: (x.me ? 'me ' : '') + (x.rank <= 3 ? 'prize' : '') },
          h('span', { class: 'rk', text: String(x.rank) }), h('span', { class: 'who', text: x.me ? 'You' : short(x.wallet) }), h('b', { text: String(x.streak) }),
          x.rank <= 3 ? h('small', { text: `${[3, 2, 1][x.rank - 1]} free ${x.rank === 3 ? 'pack' : 'packs'}` }) : null)))
          : h('p', { class: 'muted', text: 'No runs yet this Series.' }),
        h('p', { class: 'muted small', text: LIVE ? 'Best streak per wallet. A tie goes to whoever got there first.' : 'Demo: sample rows, and your runs from this browser.' }));
    },
  };
  Games.competitive = Comp;

  // ---------- paper football (paperfb.js): game 1 on chain
  const ART = { bench: 'ui/paperfb/bench.webp', plank: 'ui/paperfb/plank.webp', plankHit: 'ui/paperfb/plank-hit.webp', plankSurprised: 'ui/paperfb/plank-surprised.webp', plankBlink: 'ui/paperfb/plank-blink.webp', backdrop: '../build3/plate-1280.webp', pack: 'ui/omni-pack.webp', cardBack: 'ui/card-back.webp', paperCoin: 'ui/brand/paper-coin-64.webp', plankCoin: 'ui/brand/plank-coin-64.webp' };
  Games.add({
    id: 'paperfb', gameId: 1, name: 'Paper Football', entry: '1 PAPER', art: ART.bench,
    blurb: 'Flick the folded paper through the pencils. Every make moves the goal. Clear Plank and find the furnace.',
    prizes: 'Each Series, the three best competitive streaks win 3, 2 and 1 free packs.',
    mount: (host, opts) => window.PaperFootball?.mount(host, { art: ART, onEvent: opts.onEvent, waitForShot: opts.waitForShot, mute: () => !(window.Sound?.on ?? true), haptic: (p) => window.Fun?.haptics?.on !== false && navigator.vibrate?.(p) }),
  });
})();
