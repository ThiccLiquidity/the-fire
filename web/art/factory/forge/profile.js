/* Omni Cardworks: profiles. A wallet's name and a round picture cut from one of its cards (FireProfiles on chain; in
   the demo, kept in this browser). window.Profiles:
     get(addr)          -> Promise<{ name, pfpCard, crop, url, material, avatarCanvas } | null>   (cached)
     avatar(addr, size) -> a round element: the picture, else a gradient made from the address (filled in when known)
     label(addr)        -> the name if known, else 0x1234…abcd
     edit()             -> the editor: name, pick a card, frame it (drag, pinch or wheel to zoom), save (one transaction)
   and fires `profile:changed` on window ({ detail: { address, profile } }). The picture shows only while the wallet
   still holds the card. The picture is the card's art window only (the frame's square, studio/src/frames.ts
   FRAME_GEOMETRY.art); Full Art uses the whole card. Loaded after ui.js. */
(() => {
  const S = Store.state, LIVE = !!window.Live?.on;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
  const low = (a) => String(a || '').toLowerCase();
  const me = () => (S.wallet.connected ? low(S.wallet.full) : '');
  const ART = { x: 128 / 1500, y: 296 / 2100, w: 1244 / 1500, h: 1244 / 2100 }; // the art window, every framed material
  const WHOLE = { x: 0, y: 0, w: 1, h: 1 }; // Full Art: the photo is the whole card
  const artOf = (m) => (m === 'fullart' ? WHOLE : ART);
  const MAT = (m) => { const k = low(m).replace(/\s+/g, ''); return k === 'coal' ? 'charcoal' : k; };
  const ZMAX = 4, CENTER = { x: 0.5, y: 0.5, zoom: 1 };
  const gateway = Store.ipfs;
  // a card's image at its best: live, the raw card of the same look (a cased or slabbed state's image moves the art)
  const rawUrl = (u) => gateway(u).replace(/-(c|\d+)\.webp(\?.*)?$/, '-u.webp');

  // ---------- name rules (FireProfiles): 1-20 printable ASCII, single spaces between words; unique ignoring case
  function nameProblem(n) {
    if (!n) return 'empty';
    if (n.length > 20) return 'Too long';
    if (/[^\x20-\x7e]/.test(n)) return 'Plain letters, numbers and symbols only';
    if (/^ | $| {2}/.test(n)) return 'One space between words';
    return '';
  }

  // ---------- demo: profiles kept in this browser
  const DEMO_KEY = 'omni.profiles';
  const demoAll = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '{}') || {}; } catch { return {}; } };
  const demoPut = (a, p) => { try { const all = demoAll(); if (p) all[a] = p; else delete all[a]; localStorage.setItem(DEMO_KEY, JSON.stringify(all)); } catch { /* private window */ } };

  // ---------- live: the chain layer, once it's up (null: no FireProfiles on this network, or not live)
  let chainP = null, enabled = !LIVE; // live: known once the chain layer is up
  const chain = () => (chainP ??= new Promise((ok) => {
    if (!LIVE) return ok(null);
    const go = () => window.ForgeChain.lib().then((L) => { enabled = L.profilesOn(); ok(enabled ? L : null); }, () => { chainP = null; ok(null); });
    if (window.ForgeChain) go(); else addEventListener('forgewallet:ready', go, { once: true });
  }));

  // ---------- pictures: the card image (highest resolution there is), then the crop
  const imgs = new Map();
  const loadImg = (src) => {
    let p = imgs.get(src);
    if (!p) { p = new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => { const n = Store.nextGateway(i.src); if (n) i.src = n; else no(); }; i.src = src; }); imgs.set(src, p); p.catch(() => imgs.delete(src)); }
    return p;
  };
  const srcs = new Map();
  /** The whole card as something drawable: { img, w, h, material }. Demo: drawn with its own holo (holo.js), so Gold
   *  keeps its gold leaf; live: the card's own image. */
  function cardSource(c) {
    const k = c.url ? 'u:' + c.url : `d:${c.id}:${c.material}:${c.holo}`;
    let p = srcs.get(k);
    if (!p) {
      p = (async () => {
        const parts = !c.url && Store.cardParts?.(c);
        if (parts) {
          const [plain, print] = await Promise.all([loadImg(parts.plain), loadImg(parts.print).catch(() => null)]);
          if (window.Holo?.render && print) {
            const cv = document.createElement('canvas'); cv.width = plain.naturalWidth; cv.height = plain.naturalHeight;
            try { Holo.render(cv.getContext('2d'), plain, print, c.material, parts.look, Holo.STILL, 0); return { img: cv, w: cv.width, h: cv.height }; } catch { /* plain below */ }
          }
          return { img: plain, w: plain.naturalWidth, h: plain.naturalHeight };
        }
        const i = await loadImg(c.url || Store.cardImg(c));
        return { img: i, w: i.naturalWidth, h: i.naturalHeight };
      })();
      srcs.set(k, p); p.catch(() => srcs.delete(k));
    }
    return p;
  }
  /** The visible square of the art (source pixels) for a crop: centre x, y (0..1 of the art), zoom 1..4. */
  function cropRect(src, material, crop) {
    const A = artOf(material), ax = A.x * src.w, ay = A.y * src.h, aw = A.w * src.w, ah = A.h * src.h;
    const side = Math.min(aw, ah) / Math.min(ZMAX, Math.max(1, crop.zoom || 1)), half = side / 2;
    const cx = Math.min(aw - half, Math.max(half, (crop.x ?? 0.5) * aw)), cy = Math.min(ah - half, Math.max(half, (crop.y ?? 0.5) * ah));
    return { sx: ax + cx - half, sy: ay + cy - half, side };
  }
  function drawCrop(cv, src, material, crop, px) {
    cv.width = cv.height = px;
    const r = cropRect(src, material, crop), g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src.img, r.sx, r.sy, r.side, r.side, 0, 0, px, px);
  }

  // ---------- reading profiles
  const cache = new Map(); // addr -> { at, p }
  const known = new Map(); // addr -> the last profile read (sync, for label())
  const TTL = 60_000;
  async function read(a) {
    if (!LIVE) {
      const p = demoAll()[a];
      if (!p?.name) return null;
      // demo: the picture counts while the card is still in the demo wallet
      const c = a === low(Store.state.wallet.full) && p.pfpCard ? S.cards.find((x) => x.id === p.pfpCard) : null;
      return { name: p.name, pfpCard: c ? c.id : null, crop: p.crop || CENTER, material: c?.material || null, card: c || null, url: null };
    }
    const L = await chain();
    if (!L) return null;
    const p = await L.profile(a, true);
    if (!p) return null;
    return { name: p.name, pfpCard: p.pfpCard, crop: p.crop, material: p.material ? MAT(p.material) : null, url: p.image ? rawUrl(p.image) : null, card: null };
  }
  async function withCanvas(p) {
    if (!p || p.pfpCard == null) return p;
    try {
      const c = p.card || { id: p.pfpCard, url: p.url, material: p.material };
      const src = await cardSource(c), cv = document.createElement('canvas');
      drawCrop(cv, src, p.material, p.crop, 256);
      p.avatarCanvas = cv;
      p.url = p.url || (c.url ?? null);
    } catch { p.pfpCard = null; } // the image didn't load: the fallback
    return p;
  }
  function get(addr, fresh = false) {
    const a = low(addr);
    if (!/^0x[0-9a-f]{40}$/.test(a)) return Promise.resolve(null);
    const hit = cache.get(a);
    if (hit && !fresh && Date.now() - hit.at < TTL) return hit.p;
    const p = read(a).then(withCanvas).then((x) => { known.set(a, x); return x; });
    cache.set(a, { at: Date.now(), p });
    p.catch(() => { if (cache.get(a)?.p === p) cache.delete(a); });
    return p;
  }
  const label = (addr) => { const a = low(addr), p = known.get(a); if (!known.has(a)) get(a).catch(() => {}); return p?.name || short(addr); };

  // ---------- avatars
  /** A gradient from the address: the same wallet always gets the same one. */
  function fallbackStyle(a) {
    const h = (i) => parseInt(a.slice(2 + i * 4, 6 + i * 4), 16) || 0;
    const h1 = h(0) % 360, h2 = (h1 + 50 + (h(1) % 160)) % 360, ang = h(2) % 360;
    return `linear-gradient(${ang}deg, hsl(${h1} 72% 58%), hsl(${h2} 70% 34%))`;
  }
  function paint(el, p) {
    const a = el.dataset.addr, size = +el.dataset.size;
    el.classList.toggle('pf-gold', p?.material === 'gold');
    if (p?.avatarCanvas) {
      let cv = el.querySelector('canvas');
      if (!cv) { cv = document.createElement('canvas'); el.replaceChildren(cv); }
      const px = Math.min(256, Math.ceil(size * (devicePixelRatio || 1)));
      cv.width = cv.height = px; const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(p.avatarCanvas, 0, 0, px, px);
      el.style.background = '';
    } else {
      el.style.background = fallbackStyle(a);
      el.textContent = p?.name ? p.name[0].toUpperCase() : '';
    }
    el.setAttribute('aria-label', p?.name || short(a));
  }
  function avatar(addr, size = 32, tag = 'span') {
    const a = low(addr), el = document.createElement(tag);
    el.className = 'pf-av'; el.dataset.addr = a; el.dataset.size = size; el.setAttribute('role', 'img');
    el.style.setProperty('--s', size + 'px');
    paint(el, known.get(a));
    if (/^0x[0-9a-f]{40}$/.test(a)) get(a).then((p) => { if (el.isConnected || !el.parentNode) paint(el, p); }, () => {});
    return el;
  }
  function changed(a, p) {
    known.set(a, p); cache.set(a, { at: Date.now(), p: Promise.resolve(p) });
    document.querySelectorAll(`.pf-av[data-addr="${a}"]`).forEach((el) => paint(el, p));
    chip();
    dispatchEvent(new CustomEvent('profile:changed', { detail: { address: a, profile: p } }));
  }

  // ---------- the wallet chip: the avatar in place of the wallet icon, and the name where there's room
  let chipAddr = null;
  const wb = document.getElementById('walletBtn');
  function chip() {
    if (!wb) return;
    const a = me(), span = wb.querySelector(':scope > span');
    if (a !== chipAddr) {
      chipAddr = a; wb.querySelector('.pf-av')?.remove(); wb.classList.remove('has-pf');
      if (a) get(a).then(() => { if (chipAddr === a) chip(); }, () => {});
    }
    if (!a) return;
    // an <i>, not a <span>: ui.js writes the balance into the chip's first span
    if (!wb.querySelector('.pf-av')) { wb.prepend(avatar(a, 24, 'i')); wb.classList.add('has-pf'); }
    // the name before the balance, where ui.js would show the wallet's name (not on phones)
    const name = known.get(a)?.name;
    if (span && name) {
      const txt = span.textContent, bal = txt.includes(' · ') ? txt.slice(txt.lastIndexOf(' · ') + 3) : txt;
      const want = document.body.dataset.mode === 'port' ? bal : `${name} · ${bal}`;
      if (txt !== want && /PAPER$/.test(bal)) span.textContent = want;
    }
  }
  if (wb) new MutationObserver(() => chip()).observe(wb, { childList: true, subtree: true, characterData: true });
  Store.on(() => chip());

  // ---------- the wallet sheet (ui.js / live.js call decorate): the avatar, the name, Edit
  function decorate(d) {
    const a = me(), who = d?.querySelector('.who');
    if (!a || !who) return;
    who.querySelector('.avatar')?.replaceWith(avatar(a, 46));
    let btn = who.querySelector('[data-w=name]');
    if (!enabled) return; // live, before FireProfiles is deployed: no profiles
    if (!btn) { btn = document.createElement('button'); btn.className = 'btn small'; btn.type = 'button'; btn.dataset.w = 'name'; btn.textContent = 'Edit'; who.append(btn); }
    btn.onclick = (e) => { e.stopImmediatePropagation(); d.close(); edit(); };
    get(a).then((p) => { if (!p?.name || !d.open) return; who.querySelector('b').textContent = p.name; d.querySelector('h2').textContent = p.name; }, () => {});
  }

  // ---------- the editor
  async function edit() {
    if (LIVE) {
      const L = await chain();
      if (!L) return toast('Profiles aren\'t on this network yet', 'bad');
      return Live.needWallet(() => openEditor(L));
    }
    if (!S.wallet.connected) Store.update((s) => { s.wallet.connected = true; });
    openEditor(null);
  }

  async function openEditor(L) {
    const a = me();
    if (!a) return;
    const cur = await get(a, true).catch(() => null);
    const st = { name: cur?.name || '', card: null, crop: { ...(cur?.crop || CENTER) }, check: '', checking: 0 };
    let busy = false;
    if (cur?.pfpCard != null) st.card = S.cards.find((c) => c.id === cur.pfpCard) || { id: cur.pfpCard, url: cur.url, material: cur.material };
    const body = document.createElement('div');
    body.className = 'pf-ed';
    body.innerHTML = `
      <div class="pf-crop" tabindex="0" aria-label="Picture: drag to move, pinch or scroll to zoom">
        <div class="pf-stage"></div>
        <span class="pf-ring" aria-hidden="true"></span>
      </div>
      <input class="pf-zoom" type="range" min="1" max="${ZMAX}" step="0.01" aria-label="Zoom">
      <div class="pf-cardbtns"><button class="btn small" type="button" data-p="pick">Pick a card</button><button class="btn small" type="button" data-p="none">No picture</button></div>
      <label class="pf-name"><span>Name</span><input maxlength="20" autocomplete="off" spellcheck="false" placeholder="Name"><small class="pf-hint" aria-live="polite"></small></label>
      <div class="acts"><button class="btn primary" type="button" data-p="save">Save</button>${cur ? '<button class="btn" type="button" data-p="clear">Remove</button>' : ''}</div>
      <div class="pf-pick" hidden><div class="pf-grid" role="list"></div><button class="btn" type="button" data-p="back">Back</button></div>`;
    const $ = (s) => body.querySelector(s);
    const box = $('.pf-crop'), stage = $('.pf-stage'), zoomIn = $('.pf-zoom'), nameIn = $('.pf-name input'), hint = $('.pf-hint'), saveB = $('[data-p=save]');
    nameIn.value = st.name;

    // the art on stage: a canvas of just the art window, moved and scaled by transform only
    let art = null, V = 0, raf = 0;
    const view = () => (V = box.clientWidth || V);
    function place() {
      raf = 0;
      if (!art) return;
      const { aw, ah } = art, s = (V / Math.min(aw, ah)) * st.crop.zoom, half = V / 2 / s;
      st.crop.x = Math.min(1 - half / aw, Math.max(half / aw, st.crop.x)); st.crop.y = Math.min(1 - half / ah, Math.max(half / ah, st.crop.y));
      art.el.style.transform = `translate3d(${V / 2 - st.crop.x * aw * s}px, ${V / 2 - st.crop.y * ah * s}px, 0) scale(${s})`;
      zoomIn.value = st.crop.zoom;
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(place); };
    box.addEventListener('click', () => { if (!st.card) $('[data-p=pick]').click(); }); // the empty slot is the way to pick one
    async function loadArt() {
      stage.replaceChildren(); art = null; box.classList.toggle('empty', !st.card); body.classList.toggle('no-card', !st.card);
      box.style.background = ''; // empty: a plain dashed slot (polish.css), not the big coloured identicon
      $('[data-p=pick]').textContent = st.card ? 'Change card' : 'Pick a card';
      if (!st.card) return check();
      box.classList.add('loading');
      const want = st.card;
      try {
        const src = await cardSource(want);
        if (st.card !== want) return;
        const A = artOf(want.material), cv = document.createElement('canvas');
        const sx = A.x * src.w, sy = A.y * src.h, aw = Math.round(A.w * src.w), ah = Math.round(A.h * src.h);
        cv.width = aw; cv.height = ah; cv.className = 'pf-art';
        cv.getContext('2d').drawImage(src.img, sx, sy, aw, ah, 0, 0, aw, ah);
        stage.replaceChildren(cv); art = { el: cv, aw, ah }; box.classList.toggle('pf-gold', want.material === 'gold');
        view(); place();
      } catch { if (st.card === want) { toast('Couldn\'t load that card', 'bad'); box.style.background = fallbackStyle(a); } } // still saved with it
      box.classList.remove('loading'); check();
    }

    // gestures: one finger or the mouse drags, two pinch (and drag), the wheel and the slider zoom; arrows and +/- too
    const pts = new Map(); let last = null;
    const span2 = () => { const [p, q] = [...pts.values()]; return { d: Math.hypot(p.x - q.x, p.y - q.y), x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
    const scaleNow = () => (art ? (V / Math.min(art.aw, art.ah)) * st.crop.zoom : 1);
    function pan(dx, dy) { if (!art) return; const s = scaleNow(); st.crop.x -= dx / (s * art.aw); st.crop.y -= dy / (s * art.ah); }
    function zoomBy(f) { st.crop.zoom = Math.min(ZMAX, Math.max(1, st.crop.zoom * f)); }
    box.addEventListener('pointerdown', (e) => { if (!art) return; box.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = pts.size === 2 ? span2() : null; box.classList.add('drag'); });
    box.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { pan(e.clientX - p.x, e.clientY - p.y); p.x = e.clientX; p.y = e.clientY; }
      else { p.x = e.clientX; p.y = e.clientY; const n = span2(); if (last && last.d > 0) { zoomBy(n.d / last.d); pan(n.x - last.x, n.y - last.y); } last = n; }
      kick();
    });
    const up = (e) => { pts.delete(e.pointerId); last = pts.size === 2 ? span2() : null; if (!pts.size) box.classList.remove('drag'); };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    box.addEventListener('wheel', (e) => { if (!art) return; e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); kick(); }, { passive: false });
    box.addEventListener('keydown', (e) => {
      const k = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
      if (k) { pan(...k); kick(); e.preventDefault(); } else if (e.key === '+' || e.key === '=') { zoomBy(1.1); kick(); } else if (e.key === '-') { zoomBy(1 / 1.1); kick(); }
    });
    zoomIn.addEventListener('input', () => { st.crop.zoom = +zoomIn.value; kick(); });
    const ro = new ResizeObserver(() => { view(); kick(); }); ro.observe(box);

    // the name: its rules here, and (live) whether someone else has it
    let timer = 0;
    function check() {
      const n = nameIn.value.trim(), bad = nameProblem(n);
      st.check = bad;
      hint.textContent = bad && bad !== 'empty' ? bad : '';
      saveB.disabled = !!bad || busy;
      clearTimeout(timer);
      if (bad || !L) return;
      const k = ++st.checking;
      timer = setTimeout(async () => {
        try {
          const o = await L.nameOwner(n);
          if (k !== st.checking) return;
          if (o && low(o) !== a) { st.check = 'Taken'; hint.textContent = 'Taken'; saveB.disabled = true; }
        } catch { /* checked again on save */ }
      }, 300);
    }
    nameIn.addEventListener('input', check);

    // picking a card: the wallet's cards (not the retired Diamond, which has no plain picture)
    function pickView(on) {
      $('.pf-pick').hidden = !on;
      for (const el of body.children) if (!el.classList.contains('pf-pick')) el.hidden = on;
      if (!on) { view(); kick(); return; }
      const list = S.cards.filter((c) => c.material !== 'diamond'), grid = $('.pf-grid');
      grid.innerHTML = list.length ? '' : '<p class="fine">No cards yet</p>';
      const frag = document.createDocumentFragment();
      for (const c of list) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pf-tile'; b.setAttribute('role', 'listitem');
        b.setAttribute('aria-pressed', String(st.card?.id === c.id));
        b.setAttribute('aria-label', `${c.character}, ${Store.MAT_LABEL[c.material] || c.material}`);
        b.innerHTML = `<img src="${esc(Store.cardImg(c))}" style="object-position:${esc(Store.cardPos(c))}" alt="" loading="lazy" decoding="async" draggable="false">`;
        b.onclick = () => {
          st.card = LIVE ? { id: c.id, url: rawUrl(c.image), material: c.material } : c;
          st.crop = { ...CENTER }; pickView(false); loadArt();
        };
        frag.append(b);
      }
      grid.append(frag);
      grid.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest' });
    }
    $('[data-p=pick]').onclick = () => pickView(true);
    $('[data-p=back]').onclick = () => pickView(false);
    $('[data-p=none]').onclick = () => { st.card = null; st.crop = { ...CENTER }; loadArt(); };

    // saving: one transaction (live), or this browser (demo)
    saveB.onclick = async () => {
      const name = nameIn.value.trim();
      if (nameProblem(name) || st.check === 'Taken') return check();
      const crop = { x: +st.crop.x.toFixed(4), y: +st.crop.y.toFixed(4), zoom: +st.crop.zoom.toFixed(3) }, pfp = st.card?.id ?? null;
      if (!L) {
        demoPut(a, { name, pfpCard: pfp, crop, updated: Math.floor(Date.now() / 1000) });
        d.close(); toast('Saved', 'good');
        changed(a, await withCanvas(await read(a)));
        return;
      }
      busy = true; saveB.disabled = true;
      d.close();
      const r = await Live.run('Save profile', (o) => L.setProfile({ name, pfpCard: pfp, crop }, o), 'Saved');
      busy = false;
      if (r) { L.forgetProfile(a); changed(a, await get(a, true).catch(() => null)); }
    };
    $('[data-p=clear]')?.addEventListener('click', async () => {
      if (!L) { demoPut(a, null); d.close(); toast('Removed', 'good'); changed(a, null); return; }
      d.close();
      const r = await Live.run('Remove profile', (o) => L.clearProfile(o), 'Removed');
      if (r) { L.forgetProfile(a); changed(a, null); }
    });

    const d = Sheet.open('profile', { title: 'Profile', body, onClose: () => { ro.disconnect(); cancelAnimationFrame(raf); } });
    loadArt();
  }

  window.Profiles = {
    /** Profiles work here (the demo, or a network with FireProfiles); false until the live chain layer is up. */
    get on() { return enabled; }, get, avatar, label, edit, decorate, nameProblem, cropRect, artOf,
    forget(addr) { if (addr) { cache.delete(low(addr)); known.delete(low(addr)); } else { cache.clear(); known.clear(); } },
  };
  // live: find out early whether this network has profiles (hides nothing until it knows; the chip fills in after)
  if (LIVE) chain().then(() => chip());
  chip();
})();
