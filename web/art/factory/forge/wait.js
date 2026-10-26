/* Omni Cardworks: the wait for a drand draw (opening packs, PDA grading), about 90 seconds.
   Wait.panel(): a brass pressure gauge that builds as the draw nears, a countdown plate, a steam puff when it's out,
   and "Play while you wait": paper football (flick the folded triangle through the uprights). The game keeps going
   after the draw is in; a button in it goes straight on to the rip or the reveal.
   Points and the best streak are kept in this browser, per wallet, and earn badges (badges.js). No prizes: free play. */
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
    const play = h('button', { type: 'button', class: 'btn wg-play', 'data-key': 'wait-play', onclick: () => startGame() }, '🏈 Play while you wait');
    const gauge = h('div', { class: 'wg' }, dial, plate, unit);
    const wait = h('div', { class: 'wg-wait' }, msg, gauge, sub, window.Wait.GAME ? play : null); // the game: off until approved
    const el = h('div', { class: 'wg-host' + (kind === 'grade' ? ' wg-grade' : '') }, wait);
    const goLabel = kind === 'open' ? 'Rip your cards →' : 'See your grades →';
    function paint() {
      raf = 0; if (!el.isConnected && playing == null) return;
      const left = (due - Date.now()) / 1000;
      setDial(dial, ready ? 1 : 1 - left * 1000 / span);
      plate.textContent = ready ? (kind === 'open' ? 'OPEN!' : 'READY!') : left > 0 ? mmss(left) : '0:00';
      unit.textContent = ready ? '' : left > 0 ? 'until the draw' : 'any second now';
      gauge.classList.toggle('done', ready);
      playing?.status(ready ? { ready: true, text: kind === 'open' ? 'Your cards are ready!' : 'Your grades are in!', go: goLabel } : { text: left > 0 ? `Draw in ${mmss(left)}` : 'Any second now…' });
      if (!ready || playing) raf = requestAnimationFrame(paint);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(paint); };
    function startGame() {
      if (playing) return;
      wait.hidden = true;
      playing = game(el, { onBack: stopGame, onGo: stopGame });
      window.Wait.current = playing; // tests and mocks
      kick();
    }
    function stopGame() { playing?.stop(); playing = null; wait.hidden = false; freeWaiters.splice(0).forEach((f) => f()); kick(); }
    paint();
    return {
      el,
      /** the draw is due in `sec` seconds (the chain's round time); the gauge keeps its full span from the first call */
      at(sec) { const t = Date.now() + Math.max(0, sec) * 1000; if (Math.abs(t - due) > 1500) { due = t; if (sec > total) span = sec * 1000; } kick(); },
      arrived() { ready = true; window.Sound?.play('fire-flare', { gap: 600 }); kick(); },
      free() { return playing ? new Promise((r) => freeWaiters.push(r)) : Promise.resolve(); },
      get playing() { return !!playing; },
    };
  }

  // ---------- paper football: flick the triangle through the uprights. A swipe's speed is the power, its sideways
  // drift the aim; the wind blows it off line. Every good kick moves the posts back, narrows them, and the wind grows.
  const KEY = () => `omni.paperfb.${(window.Fun?.who?.() || window.Store?.state?.wallet?.full || 'guest').toLowerCase()}`;
  const load = () => { try { return { best: 0, points: 0, kicks: 0, goals: 0, ...JSON.parse(localStorage.getItem(KEY()) || '{}') }; } catch { return { best: 0, points: 0, kicks: 0, goals: 0 }; } };
  const save = (s) => { try { localStorage.setItem(KEY(), JSON.stringify(s)); } catch { /* private window */ } };
  Object.assign(window.Wait = window.Wait || {}, { stats: load, GAME: false });

  // the table, seen from just behind the paper: units are inches; the camera sits low, a few inches back
  const W = 600, H = 400, EYE = 200, CAM_H = 1.2, CAM_Z = 6, FOCAL = 720, G = 386;
  const proj = (x, y, z) => { const s = FOCAL / (z + CAM_Z); return { x: W / 2 + x * s, y: EYE + (CAM_H - y) * s, s }; };
  const BAR = 3, POST = 7.2; // crossbar height and pencil height (in)
  const SLOW = 0.4; // the flight runs slower than life, so you can watch it sail (a real flick is over in a blink)
  const levelOf = (streak) => ({ dist: Math.min(40, 18 + streak * 1.5), half: Math.max(1.6, 3.2 - streak * 0.1), wind: (Math.random() * 2 - 1) * Math.min(8, 1 + streak * 0.5) });
  const img = (src) => { const i = new Image(); i.src = src; return i; };
  let ART = null; // the backdrop (the factory, blurred) and Plank, loaded once
  const art = () => ART || (ART = { plate: img('../build3/plate-1280.webp'), plank: img('ui/brand/plank-256.webp') });

  function game(host, { onBack, onGo }) {
    const st = load(), A = art();
    let streak = 0, lv = levelOf(0), ball = null, result = null, resultAt = 0, trail = [], touch = null, status = { text: '' }, hint = true, alive = true, last = performance.now(), jab = -1;
    const cv = h('canvas', { class: 'pf-cv', width: W, height: H, 'aria-label': 'Paper football: flick the paper through the pencil uprights', role: 'img' });
    const back = h('button', { type: 'button', class: 'btn small', 'data-key': 'pf-back', onclick: () => onBack() }, '← Back');
    const note = h('span', { class: 'pf-note' });
    const go = h('button', { type: 'button', class: 'btn primary small', hidden: true, 'data-key': 'pf-go', onclick: () => onGo() });
    const hud = h('div', { class: 'pf-hud' });
    const root = h('div', { class: 'pf' }, h('div', { class: 'pf-bar' }, back, note, go), cv, hud);
    host.append(root);
    const g = cv.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; g.scale(dpr, dpr);
    const paintHud = () => { hud.innerHTML = ''; hud.append(h('span', {}, 'Streak ', h('b', { text: String(streak) })), h('span', {}, 'Best ', h('b', { text: String(st.best) })), h('span', {}, h('b', { text: st.points.toLocaleString('en-US') }), ' pts')); };
    paintHud();

    // a flick up the screen kicks: its speed is the power, its sideways drift the aim (the last ~90 ms of the swipe)
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, t: performance.now() }; };
    cv.addEventListener('pointerdown', (e) => { if (ball || result) return; const p = at(e); if (p.y < H * 0.45) return; touch = [p]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (touch) { touch.push(at(e)); if (touch.length > 30) touch.shift(); } });
    cv.addEventListener('pointerup', (e) => {
      if (!touch) return; const pts = touch; touch = null; pts.push(at(e));
      const end = pts[pts.length - 1], from = pts.find((p) => end.t - p.t <= 90) || pts[0], dt = Math.max(12, end.t - from.t);
      const vy = (end.y - from.y) / dt, vx = (end.x - from.x) / dt; // px per ms (up is negative)
      if (vy > -0.3) return; // not a flick up
      const vz = Math.min(150, -vy * 62), loft = 0.4 + Math.random() * 0.05;
      ball = { x: 0, y: 0, z: 0, vx: vx * 28, vy: vz * loft, vz, spin: vx * 10 + (Math.random() - 0.5) * 3, rot: 0 };
      trail = []; hint = false; st.kicks++; jab = performance.now();
      window.Sound?.play('paper-fold', { gap: 120, gain: 0.7 });
    });
    cv.addEventListener('pointercancel', () => { touch = null; });

    function judge(b) {
      if (b.y <= 0 && b.z < lv.dist) return 'Short';
      if (Math.abs(b.x) <= lv.half && b.y >= BAR) return 'GOOD!';
      if (b.y < BAR) return Math.abs(b.x) <= lv.half ? 'Under the bar' : b.x < 0 ? 'Wide left' : 'Wide right';
      return b.x < 0 ? 'Wide left' : 'Wide right';
    }
    function settle(r) {
      result = r; resultAt = performance.now();
      if (r === 'GOOD!') {
        streak++; st.goals++; const pts = 3 + Math.floor(streak / 5); st.points += pts; if (streak > st.best) st.best = streak;
        result = streak > 1 ? `GOOD! ×${streak}  +${pts}` : `GOOD!  +${pts}`;
        window.Sound?.play('case-snap', { gap: 120 });
        window.Fun?.badge?.('fg', 1); if (streak >= 3) window.Fun?.badge?.('fgBest', st.best, true);
      } else { streak = 0; window.Sound?.play('ui-click', { gap: 120 }); }
      save(st); paintHud();
    }
    function step(dt) {
      const b = ball; if (!b) return;
      b.vx += lv.wind * 6 * dt; b.vy -= G * dt; // wind: mph to a sideways push
      const z0 = b.z, y0 = b.y, x0 = b.x;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.rot += b.spin * dt;
      trail.push({ x: b.x, y: b.y, z: b.z }); if (trail.length > 12) trail.shift();
      if (z0 < lv.dist && b.z >= lv.dist) { const f = (lv.dist - z0) / (b.z - z0); settle(judge({ x: x0 + (b.x - x0) * f, y: y0 + (b.y - y0) * f, z: lv.dist })); ball = null; return; }
      if (b.y <= 0 && b.vy < 0) { settle(judge(b)); ball = null; }
    }

    // ---------- drawing
    function backdrop() {
      const p = A.plate, edge = proj(0, 0, 70).y;
      g.fillStyle = '#1a120b'; g.fillRect(0, 0, W, edge + 2);
      if (p.complete && p.naturalWidth) { g.save(); g.filter = 'blur(6px) brightness(.55) saturate(.8)'; const s = Math.max(W / p.naturalWidth, (edge + 30) / p.naturalHeight) * 1.15;
        g.drawImage(p, (W - p.naturalWidth * s) / 2, edge + 20 - p.naturalHeight * s, p.naturalWidth * s, p.naturalHeight * s); g.restore(); }
      const wood = g.createLinearGradient(0, edge, 0, H); wood.addColorStop(0, '#6b4220'); wood.addColorStop(0.5, '#a5672c'); wood.addColorStop(1, '#c9853e');
      g.fillStyle = wood; g.fillRect(0, edge, W, H - edge);
      g.strokeStyle = 'rgba(60,30,10,.28)'; g.lineWidth = 1.2;
      for (let x = -40; x <= 40; x += 2.6) { const a = proj(x, 0, -2), b = proj(x * 0.9, 0, 70); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); } // grain
      const glow = g.createRadialGradient(W * 0.55, H * 0.62, 10, W * 0.55, H * 0.62, W * 0.6); glow.addColorStop(0, 'rgba(255,200,120,.22)'); glow.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = glow; g.fillRect(0, edge, W, H - edge);
    }
    function props() { // Plank leaning on the left, a cup of pencils beside him
      const k = A.plank;
      if (k.complete && k.naturalWidth) { const p = proj(-11, 0, 34), hh = 6 * p.s, ww = hh * k.naturalWidth / k.naturalHeight;
        g.save(); g.translate(p.x, p.y); g.rotate(-0.12); g.drawImage(k, -ww / 2, -hh, ww, hh); g.restore(); }
      const c = proj(-15, 0, 32), cw = 2.6 * c.s, ch = 3 * c.s;
      ['#3b5bdb', '#e9b45a', '#e03131'].forEach((col, i) => { g.fillStyle = col; g.fillRect(c.x - cw * 0.3 + i * cw * 0.25, c.y - ch - 1.8 * c.s + i * 4, cw * 0.12, 2.2 * c.s); });
      g.fillStyle = '#8a8f96'; g.beginPath(); g.moveTo(c.x - cw / 2, c.y - ch); g.lineTo(c.x + cw / 2, c.y - ch); g.lineTo(c.x + cw * 0.42, c.y); g.lineTo(c.x - cw * 0.42, c.y); g.closePath(); g.fill();
    }
    function pencil(x, d) {
      const b = proj(x, 1, d), t = proj(x, POST, d), w = Math.max(3, 0.38 * b.s);
      g.fillStyle = '#f2b81d'; g.fillRect(b.x - w / 2, t.y + w * 1.3, w, b.y - t.y - w * 1.3);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(b.x + w * 0.15, t.y + w * 1.3, w * 0.35, b.y - t.y - w * 1.3);
      g.fillStyle = '#b8bcc2'; g.fillRect(b.x - w / 2, t.y + w * 0.7, w, w * 0.6);
      g.fillStyle = '#ef8fa6'; g.beginPath(); g.roundRect(b.x - w / 2, t.y, w, w * 0.75, [w * 0.3, w * 0.3, 0, 0]); g.fill();
    }
    function uprights() {
      const d = lv.dist, half = lv.half, L = proj(-half - 0.9, 0, d), R = proj(half + 0.9, 1, d), bh = (L.y - R.y);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse((L.x + R.x) / 2, L.y + 2, (R.x - L.x) / 2 + 6, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9a6a35'; g.fillRect(L.x, R.y, R.x - L.x, bh); g.fillStyle = 'rgba(255,220,160,.18)'; g.fillRect(L.x, R.y, R.x - L.x, bh * 0.3); // the wooden base
      g.fillStyle = '#7d8086'; for (const x of [-half, half]) { const p = proj(x, 0, d); g.fillRect(p.x - 0.6 * p.s, R.y - 1, 1.2 * p.s, bh + 1); }
      const a = proj(-half, BAR, d), b = proj(half, BAR, d);
      g.strokeStyle = '#d9a441'; g.lineWidth = Math.max(2, 0.22 * a.s); g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      pencil(-half, d); pencil(half, d);
      g.fillStyle = '#7d8086'; for (const p of [a, b]) g.fillRect(p.x - 0.4 * p.s, p.y - 0.4 * p.s, 0.8 * p.s, 0.8 * p.s); // brackets
    }
    function paper(x, y, z, rot, alpha = 1) {
      const p = proj(x, y, z), r = Math.max(3, 0.45 * p.s);
      g.save(); g.translate(p.x, p.y - r * 0.55); g.rotate(rot); g.globalAlpha = alpha;
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.85, r * 0.55); g.lineTo(-r * 0.85, r * 0.55); g.closePath();
      g.fillStyle = '#f7f4ec'; g.fill(); g.save(); g.clip();
      g.strokeStyle = 'rgba(80,130,220,.55)'; g.lineWidth = Math.max(0.6, r * 0.03); for (let k = -0.6; k < 0.6; k += 0.22) { g.beginPath(); g.moveTo(-r, k * r); g.lineTo(r, k * r - r * 0.1); g.stroke(); }
      g.strokeStyle = 'rgba(220,60,60,.75)'; g.beginPath(); g.moveTo(r * 0.05, -r); g.lineTo(r * 0.35, r * 0.6); g.stroke(); g.restore();
      g.strokeStyle = 'rgba(120,110,95,.6)'; g.lineWidth = Math.max(0.8, r * 0.04); g.stroke();
      g.restore();
    }
    function shadow(x, z, y) { const p = proj(x, 0, z), r = 0.45 * p.s * Math.max(0.35, 1 - y / 10); g.fillStyle = 'rgba(40,20,5,.35)'; g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.25, 0, 0, Math.PI * 2); g.fill(); }
    function finger(now) { // the kicker's finger, at the right; it jabs in on a flick
      const t = jab < 0 ? 1 : Math.min(1, (now - jab) / 260), push = Math.sin(t * Math.PI) * 50;
      const x = W * 0.86 - push, y = H * 0.74;
      g.save(); g.translate(x, y); g.rotate(-0.35);
      const skin = g.createLinearGradient(0, -40, 0, 40); skin.addColorStop(0, '#f2b08a'); skin.addColorStop(1, '#d9845e');
      g.fillStyle = skin; g.beginPath(); g.roundRect(-34, -26, 190, 52, 26); g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.ellipse(-10, -12, 18, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,220,210,.7)'; g.beginPath(); g.ellipse(-16, 8, 10, 13, 0.3, 0, Math.PI * 2); g.fill(); // the nail
      g.restore();
    }
    function box(x, y, top, big, alignRight) {
      g.font = '400 13px "Russo One", sans-serif'; const w1 = g.measureText(top).width; g.font = '400 19px "Russo One", sans-serif'; const w2 = g.measureText(big).width;
      const w = Math.max(w1, w2) + 22, bx = alignRight ? x - w : x;
      g.fillStyle = 'rgba(10,8,6,.82)'; g.beginPath(); g.roundRect(bx, y, w, 50, 8); g.fill();
      g.fillStyle = '#f6e8cf'; g.textAlign = 'left'; g.font = '400 13px "Russo One", sans-serif'; g.fillText(top, bx + 11, y + 18);
      g.font = '400 19px "Russo One", sans-serif'; g.fillText(big, bx + 11, y + 41);
    }
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.033, (now - last) / 1000) * SLOW; last = now;
      if (ball) { let t = dt; while (t > 0 && ball) { const s = Math.min(t, 1 / 240); step(s); t -= s; } }
      if (result && now - resultAt > 1400) { result = null; lv = levelOf(streak); }
      g.clearRect(0, 0, W, H); backdrop(); props();
      const behind = !ball || ball.z > lv.dist;
      if (!behind) uprights();
      trail.forEach((p, i) => paper(p.x, p.y, p.z, 0, (i / trail.length) * 0.15));
      if (ball) { shadow(ball.x, ball.z, ball.y); paper(ball.x, ball.y, ball.z, ball.rot); }
      if (behind) uprights();
      if (!ball && !result) { shadow(0, 0, 0); paper(0, 0, 0, 0); }
      finger(now);
      const wind = lv.wind, arrow = Math.round(Math.abs(wind)) === 0 ? '' : wind > 0 ? ' →' : ' ←';
      box(14, 14, 'WIND', `${Math.abs(wind).toFixed(0)} MPH${arrow}`); box(W - 14, 14, 'DISTANCE', `${Math.round(lv.dist)} IN.`, true);
      if (hint && !ball) { g.fillStyle = 'rgba(246,232,207,.92)'; g.font = '800 15px Nunito, sans-serif'; g.textAlign = 'center'; g.fillText('Flick up to kick it through the pencils', W / 2, H - 14); }
      if (result) {
        const good = result.startsWith('GOOD'); g.font = '400 30px "Russo One", sans-serif'; g.textAlign = 'center';
        g.fillStyle = good ? '#6fcf7a' : '#ff6b5a'; g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 5;
        g.strokeText(result, W / 2, H * 0.42); g.fillText(result, W / 2, H * 0.42);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {
      status(s) {
        if (s.text === status.text && !!s.ready === !!status.ready) return; status = s;
        note.textContent = s.text; note.classList.toggle('ready', !!s.ready);
        go.hidden = !s.ready; if (s.ready) go.textContent = s.go;
      },
      stop() { alive = false; root.remove(); },
      /** tests and mocks: a kick from code (vx, vz in inches per second) */
      kick(vx, vz) { ball = { x: 0, y: 0, z: 0, vx, vy: vz * 0.42, vz, spin: 2, rot: 0 }; hint = false; },
    };
  }
  Object.assign(window.Wait, { panel });
})();
