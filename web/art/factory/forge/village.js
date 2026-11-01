/* The village (village.html): the landing page. The picture for the visitor's time of day (village.json: morning, day,
   dusk, night by the local clock; ?time= to try one), cross-fading when the hour moves on. Each building has its
   outline (village.json `poly`, in picture pixels): pointing at it lifts and lights that building (the same picture cut
   to the outline); a nameplate floats over it (`label`) and is the link. The painted signs in the art are scenery. Desktop: the
   picture covers the screen. Phones held upright: a band you can drag sideways, opening on the plaza, with big
   Places buttons under it. ?live= is kept on every link. */
(() => {
  const $ = (s) => document.querySelector(s);
  const q = new URLSearchParams(location.search), live = q.get('live');
  const withLive = (href) => {
    if (!live || /^\//.test(href)) return href;
    const u = new URL(href, location.href); u.searchParams.set('live', live); return u.pathname.split('/').pop() + u.search;
  };
  const SZ = [1536, 1024];
  let V = null, time = null, mode = '';

  // ---------- time of day
  function timeNow() {
    const forced = q.get('time'); if (forced && V.times[forced]) return forced;
    const h = new Date().getHours();
    for (const [t, [a, b]] of Object.entries(V.times)) if (a < b ? h >= a && h < b : h >= a || h < b) return t;
    return 'dusk';
  }
  const src = (t) => `ui/village/${t}-${innerWidth * Math.min(devicePixelRatio || 1, 2) > 1700 || mode === 'port' ? 3072 : 1536}.webp`;
  function setTime(t, fade) {
    if (t === time) return;
    time = t; document.body.dataset.time = t;
    const a = $('#bgA'), b = $('#bgB'), url = src(t);
    $('#bgBlur').src = `ui/village/${t}-1536.webp`;
    if (!fade) { a.src = url; paintLifts(url); return; }
    const img = new Image(); img.onload = () => { // fade the new hour in over the old one, then swap
      b.src = url; b.hidden = false; b.classList.add('out'); void b.offsetWidth; b.classList.remove('out');
      setTimeout(() => { a.src = url; b.hidden = true; paintLifts(url); }, 2600);
    }; img.src = url;
  }

  // ---------- the buildings: outlines, lifts, signs, places
  const pct = (p) => `${(p[0] / SZ[0] * 100).toFixed(3)}% ${(p[1] / SZ[1] * 100).toFixed(3)}%`;
  function build() {
    const hit = $('#hit'), lifts = $('#lifts'), signs = $('#signs'), places = $('#places');
    for (const b of V.buildings) {
      const href = withLive(b.href);
      const lift = document.createElement('div'), inner = document.createElement('div');
      inner.style.clipPath = `polygon(${b.poly.map(pct).join(',')})`; lift.append(inner); lifts.append(lift);
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', b.poly.map((p) => p.join(',')).join(' '));
      // its nameplate, floating over the building (`label`, in picture pixels): the button to go in
      const sign = Object.assign(document.createElement('a'), { href, className: `vg-plate p-${b.id}` });
      sign.innerHTML = '<b></b><small></small>'; sign.querySelector('b').textContent = b.name; sign.querySelector('small').textContent = b.sub;
      sign.dataset.x = b.label[0]; sign.dataset.y = b.label[1];
      const on = (v) => { lift.classList.toggle('on', v); sign.classList.toggle('on', v); };
      for (const el of [poly, sign]) {
        el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') on(true); });
        el.addEventListener('pointerleave', () => on(false));
      }
      sign.addEventListener('focus', () => on(true)); sign.addEventListener('blur', () => on(false));
      poly.addEventListener('click', () => { on(true); location.href = href; });
      hit.append(poly); signs.append(sign);
      const place = Object.assign(document.createElement('a'), { href });
      place.innerHTML = `<b></b><small></small>`; place.querySelector('b').textContent = b.name; place.querySelector('small').textContent = b.sub;
      places.append(place);
    }
    $('#cta').href = withLive('index.html');
  }
  function paintLifts(url) { for (const d of $('#lifts').children) d.firstChild.style.backgroundImage = `url(${url})`; }

  // ---------- fit: cover the screen (desktop), or a sideways band (phones held upright)
  function fit() {
    const W = innerWidth, H = innerHeight, port = W < 760 && H > W;
    let s = 1;
    const was = mode; mode = port ? 'port' : 'desk';
    document.body.classList.toggle('port', port);
    const world = $('#world');
    if (port) {
      const band = Math.round(Math.min(H * 0.56, W * 1.25)), w = Math.round(band * SZ[0] / SZ[1]);
      document.documentElement.style.setProperty('--band', `${band}px`);
      Object.assign(world.style, { width: `${w}px`, height: `${band}px`, transform: 'none' });
      if (was !== 'port') { const vg = $('#vg'); vg.scrollLeft = (w - W) / 2; }
    } else {
      // the whole village (V.focus: the box from the top of the Workshop to the front of the buildings) always fits
      // between the top bar and the Workshop button; spare room at the sides shows the blurred scene behind
      const [fx, fy, fw, fh] = V.focus, top = 56, bottom = 110;
      s = Math.min(Math.max(W / SZ[0], H / SZ[1]), (H - top - bottom) / fh, W / fw);
      const ox = W / 2 - (fx + fw / 2) * s, oy = top + (H - top - bottom - fh * s) / 2 - fy * s;
      Object.assign(world.style, { left: '0', top: '0', width: `${SZ[0]}px`, height: `${SZ[1]}px`, transform: `translate(${ox}px, ${oy}px) scale(${s})` });
    }
    // the nameplates stay the same size on any screen; only their spot follows the picture
    const k = parseFloat(world.style.width) / SZ[0];
    for (const a of $('#signs').children) { a.style.left = `${a.dataset.x * k}px`; a.style.top = `${a.dataset.y * k}px`; a.style.scale = String(1 / s); }
    // phones: the signs are decoration (the Places buttons are the links); desktop: the signs are the links
    for (const a of $('#signs').children) { a.tabIndex = port ? -1 : 0; a.toggleAttribute('aria-hidden', port); }
    $('#signs').toggleAttribute('aria-hidden', port);
    if (was && was !== mode && time) { const t = time; time = null; setTime(t, false); } // the right size for the new layout
  }

  fetch('village.json').then((r) => r.json()).then((v) => {
    V = v; SZ[0] = v.size[0]; SZ[1] = v.size[1];
    build(); fit(); setTime(timeNow(), false);
    addEventListener('resize', fit);
    for (const ev of ['pointerdown', 'wheel']) $('#vg').addEventListener(ev, () => $('#hint').classList.add('gone'), { once: true, passive: true });
    setTimeout(() => $('#hint').classList.add('gone'), 6000);
    setInterval(() => setTime(timeNow(), true), 60_000);
  });
})();
