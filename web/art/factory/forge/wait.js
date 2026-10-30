/* Omni Cardworks: the wait for a drand draw (opening packs, PDA grading), about 90 seconds.
   Wait.panel(): a brass pressure gauge that builds as the draw nears, a countdown plate, a steam puff when it's out,
   and "Play while you wait!": an invite (Let's play / No thanks) that opens the game list (games.js) in place, each game
   with free play or a competitive run. The games keep going after the draw is in: a bar over them says the cards (or
   grades) are ready, with a button straight on to the rip or the reveal. */
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
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- the gauge: the needle sweeps from empty (left) to full (right) as the draw nears; an arc fills behind it
  const SVGNS = 'http://www.w3.org/2000/svg';
  const A0 = 225, A1 = -45, R = 82; // dial angles (degrees, counter-clockwise from 3 o'clock) and radius, in a 200 x 200 box
  const pt = (a, r) => [100 + r * Math.cos(a * Math.PI / 180), 100 - r * Math.sin(a * Math.PI / 180)];
  function gaugeSvg() {
    const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 200 200'); s.setAttribute('class', 'wg-dial'); s.setAttribute('aria-hidden', 'true');
    let ticks = '';
    for (let i = 0; i <= 18; i++) { const a = A0 - (A0 - A1) * i / 18, [x1, y1] = pt(a, R - 4), [x2, y2] = pt(a, R - (i % 3 ? 9 : 14));
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e9b45a" stroke-width="${i % 3 ? 1.2 : 2.5}"/>`; }
    s.innerHTML = `<circle cx="100" cy="100" r="96" fill="#2a1c10" stroke="#6b4a2a" stroke-width="4"/><circle cx="100" cy="100" r="88" fill="#1f1710" stroke="#e9b45a" stroke-width="2"/>${ticks}
      <path class="wg-arc" fill="none" stroke="#ff7a2e" stroke-width="6" stroke-linecap="round" opacity=".85"/>
      <line class="wg-needle" x1="100" y1="100" x2="100" y2="100" stroke="#ff7a2e" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="100" cy="100" r="8" fill="#e9b45a"/>
      <g class="wg-steam" fill="#f6e8cf"><circle cx="70" cy="22" r="14"/><circle cx="90" cy="12" r="18"/><circle cx="115" cy="18" r="15"/><circle cx="132" cy="30" r="11"/></g>`;
    return s;
  }
  function setDial(svg, frac) {
    const a = A0 - (A0 - A1) * Math.max(0, Math.min(1, frac)), [sx, sy] = pt(A0, R - 20), [ex, ey] = pt(a, R - 20), [nx, ny] = pt(a, R - 12);
    svg.querySelector('.wg-arc').setAttribute('d', frac > 0.002 ? `M${sx.toFixed(1)},${sy.toFixed(1)} A${R - 20},${R - 20} 0 ${A0 - a > 180 ? 1 : 0} 1 ${ex.toFixed(1)},${ey.toFixed(1)}` : '');
    const n = svg.querySelector('.wg-needle'); n.setAttribute('x2', nx.toFixed(1)); n.setAttribute('y2', ny.toFixed(1));
  }

  /** The wait, drawn into the page: msg is the screen's own status line (Live's say() keeps writing to it).
   *  kind 'open' | 'grade'. at(ms): when the draw is due (wall clock); arrived(): it's in (the cards are dealt / the
   *  grades set); free(): resolves once the player isn't in the game (at once, or when they leave it or tap go on). */
  function panel({ kind = 'open', msg, total = 90 } = {}) {
    let due = Date.now() + total * 1000, span = total * 1000, ready = false, playing = null, raf = 0, freeWaiters = [];
    const dial = gaugeSvg(), plate = h('div', { class: 'wg-plate', role: 'timer', 'aria-live': 'off' }), unit = h('div', { class: 'wg-unit', text: 'until the draw' });
    const sub = h('p', { class: 'wg-sub muted small', text: kind === 'open' ? 'Nobody knows what’s inside yet, not even us.' : 'Nobody knows the grades yet, not even us.' });
    const isOpen = kind === 'open', goLabel = isOpen ? 'Rip your cards →' : 'See your grades →';
    const again = h('button', { type: 'button', class: 'btn small ghost wg-play', 'data-key': 'wait-play-again', onclick: () => startGame() }, '🎮 Play while you wait');
    const invite = h('div', { class: 'wg-invite', role: 'group', 'aria-label': 'Play while you wait' },
      h('b', { class: 'wg-invite-t', text: 'Play while you wait!' }),
      h('p', { class: 'muted small', text: isOpen ? 'Your pack stays right here. We\u2019ll tell you the moment your cards are ready.' : 'Your cards stay right here. We\u2019ll tell you the moment your grades are in.' }),
      h('div', { class: 'gr-acts' },
        h('button', { type: 'button', class: 'btn primary', 'data-key': 'wait-play', onclick: () => startGame() }, 'Let\u2019s play'),
        h('button', { type: 'button', class: 'btn ghost', 'data-key': 'wait-no', onclick: () => invite.replaceWith(again) }, 'No thanks')));
    // live, notifications off: one tap so leaving the page doesn't mean missing it
    const pushOffer = window.Live?.on && window.App?.push?.supported && !window.App.push.on ? h('button', { type: 'button', class: 'inf-link wg-notify', 'data-key': 'wait-notify', onclick: (e) => {
      const b = e.currentTarget; b.disabled = true;
      window.App.push.enable().then(() => { b.replaceWith(h('p', { class: 'muted small', text: isOpen ? 'We\u2019ll notify you when your cards are ready.' : 'We\u2019ll notify you when your grades are in.' })); },
        (err) => { b.disabled = false; window.toast?.(err.message, 'bad'); });
    } }, '🔔 Notify me if I leave') : null;
    const gauge = h('div', { class: 'wg' }, dial, plate, unit);
    const offer = window.Wait.GAME && window.Games?.lobby;
    const wait = h('div', { class: 'wg-wait' }, msg, gauge, sub, offer ? invite : null, pushOffer);
    // while playing: a bar over the games with the draw's countdown, then "ready" and the way back
    const barText = h('span', { class: 'wg-bar-t' });
    const barGo = h('button', { type: 'button', class: 'btn primary small', 'data-key': 'wait-go', hidden: true, onclick: () => goBack() }, goLabel);
    const bar = h('div', { class: 'wg-bar', role: 'status', hidden: true }, barText, barGo);
    const games = h('div', { class: 'wg-games' });
    const el = h('div', { class: 'wg-host' + (kind === 'grade' ? ' wg-grade' : '') }, wait, bar, games);
    let told = false;
    function paint() {
      raf = 0; if (!el.isConnected && playing == null) return;
      const left = (due - Date.now()) / 1000;
      setDial(dial, ready ? 1 : 1 - left * 1000 / span);
      plate.textContent = ready ? (isOpen ? 'OPEN!' : 'READY!') : left > 0 ? mmss(left) : '0:00';
      unit.textContent = ready ? '' : left > 0 ? 'until the draw' : 'any second now';
      gauge.classList.toggle('done', ready);
      const t = ready ? (isOpen ? 'Your cards are ready!' : 'Your grades are in!') : left > 0 ? `${isOpen ? 'Your cards' : 'Your grades'}: draw in ${mmss(left)}` : 'Any second now\u2026';
      if (barText.textContent !== t) barText.textContent = t;
      bar.classList.toggle('ready', ready); barGo.hidden = !ready;
      if (ready && playing && !told) { // the moment it lands: say so even mid-game
        told = true;
        window.toast?.(isOpen ? 'Your cards are ready! Tap "Rip your cards" when you are.' : 'Your grades are in! Tap "See your grades" when you are.', 'good');
        if (window.Fun?.haptics?.on !== false) navigator.vibrate?.([60, 40, 60]);
      }
      if (!ready || playing) raf = requestAnimationFrame(paint);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(paint); };
    function startGame() {
      if (playing) return;
      if (invite.isConnected) invite.replaceWith(again);
      wait.hidden = true; bar.hidden = false;
      if (msg) bar.after(msg); // the screen's own line comes along: a late draw's "Deal now" / "Get my packs back" stay in reach
      playing = window.Games.lobby(games, { lead: 'Pick a game. It keeps going while the draw comes in.', leave: [isOpen ? '\u2190 Back to my pack' : '\u2190 Back to my cards', () => stopGame()] });
      window.Wait.current = playing; // tests and mocks
      kick();
    }
    function goBack() {
      if (playing?.inRun() && !confirm('Your competitive run is still going. Leave it now and it ends here?')) return;
      stopGame();
    }
    // in another tab or app: the tab's title says so (and a browser notification, if they've allowed them)
    function tellAway() {
      if (!document.hidden) return;
      const text = isOpen ? 'Your cards are ready!' : 'Your grades are in!', was = document.title;
      document.title = `\u{1F525} ${text}`;
      const back = () => { if (document.hidden) return; document.title = was; document.removeEventListener('visibilitychange', back); };
      document.addEventListener('visibilitychange', back);
      try { if (window.Notification?.permission === 'granted') new Notification('Omni Cardworks', { body: text, icon: 'ui/omni-mark.webp', tag: 'omni-ready' }); } catch { /* not on this browser */ }
    }
    function stopGame() { playing?.stop(); playing = null; bar.hidden = true; if (msg) wait.prepend(msg); wait.hidden = false; if (ready) again.remove(); freeWaiters.splice(0).forEach((f) => f()); kick(); }
    paint();
    return {
      el,
      /** the draw is due in `sec` seconds (the chain's round time); the gauge keeps its full span from the first call */
      at(sec) { const t = Date.now() + Math.max(0, sec) * 1000; if (Math.abs(t - due) > 1500) { due = t; if (sec > total) span = sec * 1000; } kick(); },
      arrived() { ready = true; window.Sound?.play('fire-flare', { gap: 600 }); if (!playing) { invite.remove(); again.remove(); } tellAway(); kick(); },
      free() { return playing ? new Promise((r) => freeWaiters.push(r)) : Promise.resolve(); },
      get playing() { return !!playing; },
    };
  }

  // ---------- the games (games.js): the wait offers them in place; the draw going on never waits for them
  Object.assign(window.Wait = window.Wait || {}, { GAME: true });

  Object.assign(window.Wait, { panel });
})();
