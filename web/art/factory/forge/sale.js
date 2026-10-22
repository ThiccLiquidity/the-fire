/* Omni Cardworks (fun layer): the drop, in the workshop's style.
   Fuel gauges: while a Series is on sale, a brass dial per group: how full it still is (packs left of its packs),
   and its time left (or when it opens).
   Last call: once the after-sell-out group is open, a big countdown (its idle timer: every sale starts it again) and
   a flip board with the next pack's price. Live: the group's end time and next price as FireSale reports them (the
   Store, kept fresh by live.js); demo: the demo sale. Tapping it opens that group's checkout.
   Desktop: under the Buy box. Phones: over the top of the scene. Text only ticks once a second; transforms only. */
(() => {
  const { h, reduced } = Fun;
  const S = Store.state;
  const box = h('div', { class: 'fun-sale', hidden: true, 'aria-label': 'The drop' });
  document.body.append(box);
  const money = (v) => '$' + (+v).toFixed(2);
  const mmss = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
  const left = (t) => { const s = Math.max(0, Math.round(t - Fun.now())), d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };

  // ---------- the flip board: one tile per character; a changed one flips down
  function flap(el, text) {
    const old = el._t || '';
    if (old === text) return; el._t = text;
    const tiles = [...el.children];
    while (tiles.length < text.length) { const t = h('span', { class: 'fun-flap' }); el.append(t); tiles.push(t); }
    tiles.forEach((t, i) => { const ch = text[i] ?? ''; t.hidden = i >= text.length; if (t.textContent === ch) return; t.textContent = ch;
      if (old && !reduced()) t.animate([{ transform: 'rotateX(-90deg)' }, { transform: 'rotateX(0)' }], { duration: 260, delay: i * 45, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' }); });
    el.setAttribute('aria-label', text);
  }

  let key = '', mode = '';
  function render() {
    const x = Store.extraOpen(), on = S.series.phase < 4 && (S.series.groups || []).length && !S.series.note;
    const gs = (S.series.groups || []).slice(0, 4);
    const m = x ? 'last' : on ? 'gauges' : '';
    const k = JSON.stringify([m, x?.index, gs.map((g) => [g.name, g.state, g.unlimited, g.capacity != null])]);
    box.hidden = !m;
    if (k !== key) {
      key = k; mode = m; box.className = 'fun-sale ' + m;
      if (m === 'last') {
        Fun.put(box, h('button', { type: 'button', class: 'lc', onclick: () => { const b = document.querySelector(`#buybox [data-buy="g${x.index}"], #buybar [data-buy="g${x.index}"]`); b?.click(); }, 'aria-label': 'Last call: buy an extra pack' },
          h('span', { class: 'lc-k', text: 'Last call' }), h('b', { class: 'lc-clock', 'aria-live': 'off' }),
          h('span', { class: 'lc-n' }, h('small', { text: 'Next pack' }), h('span', { class: 'lc-board' }))));
      } else if (m === 'gauges') {
        Fun.put(box, h('div', { class: 'gg-row' }, gs.map((g, i) => h('div', { class: 'gg', 'data-i': i },
          h('span', { class: 'gg-dial', 'aria-hidden': 'true', html: '<svg viewBox="0 0 100 60"><path class="gg-bg" d="M10 54 A40 40 0 0 1 90 54"/><path class="gg-fill" pathLength="100" d="M10 54 A40 40 0 0 1 90 54"/>'
            + '<g class="gg-ticks">' + [0, 1, 2, 3, 4].map((t) => { const a = Math.PI * (1 - t / 4); return `<line x1="${50 + Math.cos(a) * 33}" y1="${54 - Math.sin(a) * 33}" x2="${50 + Math.cos(a) * 38}" y2="${54 - Math.sin(a) * 38}"/>`; }).join('') + '</g>'
            + '<g class="gg-needle"><line x1="50" y1="54" x2="50" y2="22"/></g><circle cx="50" cy="54" r="4.5"/></svg>' }),
          h('b', { class: 'gg-name' }), h('small', { class: 'gg-sub' })))));
      }
    }
    tick(); place();
  }
  function tick() {
    if (box.hidden || document.hidden) return;
    if (mode === 'last') {
      const x = Store.extraOpen(); if (!x) return;
      const s = x.endsAt ? x.endsAt - Fun.now() : x.idle;
      const c = box.querySelector('.lc-clock'); const t = mmss(s); if (c.textContent !== t) c.textContent = t;
      box.classList.toggle('hot', s <= 60);
      flap(box.querySelector('.lc-board'), x.next ? money(x.next.usd) : '—');
    } else if (mode === 'gauges') {
      (S.series.groups || []).slice(0, 4).forEach((g, i) => {
        const el = box.querySelector(`.gg[data-i="${i}"]`); if (!el) return;
        const frac = g.state === 'ended' ? 0 : g.unlimited || g.capacity == null ? (g.state === 'open' ? 1 : 0) : g.state === 'upcoming' ? 1 : Math.max(0, Math.min(1, (g.left ?? 0) / Math.max(1, g.capacity)));
        el.querySelector('.gg-needle').style.transform = `rotate(${(-90 + frac * 180).toFixed(1)}deg)`;
        el.querySelector('.gg-fill').style.strokeDashoffset = String(100 - frac * 100);
        el.classList.toggle('off', g.state !== 'open'); el.classList.toggle('low', g.state === 'open' && frac > 0 && frac < 0.15);
        const name = g.unlimited ? 'Extra packs' : String(g.name).replace('Paper Press holders', 'Press holders'), sub = g.state === 'ended' ? (g.left === 0 ? 'Sold out' : 'Ended')
          : g.state === 'upcoming' ? (g.opensAt > Fun.now() ? 'Opens in ' + left(g.opensAt) : 'Up next')
          : g.unlimited ? (g.endsAt ? left(g.endsAt) + ' left' : 'Open') : `${g.left ?? 0} left${g.endsAt ? ' · ' + left(g.endsAt) : ''}`;
        const n = el.querySelector('.gg-name'), sb = el.querySelector('.gg-sub');
        if (n.textContent !== name) n.textContent = name; if (sb.textContent !== sub) sb.textContent = sub;
        el.setAttribute('aria-label', `${name}: ${sub}`);
      });
    }
  }
  // desktop: under the Buy box; phones: over the top of the scene (CSS); landscape phones: the scene's bottom left
  function place() {
    if (box.hidden) return;
    const port = document.body.dataset.mode === 'port', land = document.body.dataset.mode === 'land';
    box.classList.toggle('port', port); box.classList.toggle('land', land);
    if (port || land) { box.style.transform = ''; return; }
    const b = document.getElementById('buybox'); if (!b || b.hidden) return;
    const r = b.getBoundingClientRect();
    box.style.transform = `translate(${(r.left + r.width / 2).toFixed(0)}px, ${(r.bottom + 10).toFixed(0)}px) translateX(-50%)`;
  }
  Store.on(() => requestAnimationFrame(render)); addEventListener('resize', () => requestAnimationFrame(place));
  setInterval(tick, 1000);
  render();
})();
