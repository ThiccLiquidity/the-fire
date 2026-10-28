/* Omni Cardworks: tilt clips. "Share clip" records a few seconds of a card shining as a video to share: the same live
   holo (holo.js: the card's picture + frame, the drawn holo, its print, and its case or slab when it has one) drawn on
   its own canvas at a fixed size (1080 x 1350), on the forge backdrop with the card's name and the wordmark under it.
   While it records, the light sweeps a smooth figure 8 by itself (no gyroscope needed); a phone being tilted adds its
   own motion on top. canvas.captureStream(30) + MediaRecorder (MP4 where the browser records it, Safari / iOS; else
   WebM VP9 / VP8), then the share sheet where the phone shares files, else a download. No MediaRecorder: the share
   picture instead. Nothing leaves the device until the person shares it. */
(() => {
  const W = 1080, H = 1350, FPS = 30, SECS = 4.5, BITS = 8_000_000;
  const CARD = { w: 700, h: 980, x: (W - 700) / 2, y: 78 }; // 5 x 7, the card's and the holders' shape
  const GLOW = { paper: '#ffd98a', wood: '#ff9f2e', fire: '#ff5a12', charcoal: '#e0260c', diamond: '#bfe6ff', gold: '#ffb81c', fullart: '#ffd27a' };
  const HOLO_WORD = { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' };
  // H.264 MP4 first (Safari / iOS, Chrome): it plays everywhere; then WebM; a bare "video/mp4" last (it can mean VP9 in MP4)
  const MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); if (/^https?:/.test(src)) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => { const n = Store.nextGateway(i.src); if (n) i.src = n; else no(); }; i.src = src; });

  /** The video type this browser records (MP4 first), or '' when it can't record a canvas. */
  function mime() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') return 'video/mp4'; // early Safari: records MP4, can't be asked
    return MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
  }
  const ext = (m) => (/mp4/.test(m) ? 'mp4' : 'webm');
  const kindLine = (c) => {
    const look = Store.ALWAYS_HOLO[c.material] ? 'full' : c.holo || 'none';
    return [Store.MAT_LABEL[c.material], c.material === 'gold' || c.material === 'fullart' ? '' : HOLO_WORD[look], c.grade != null ? `PDA ${c.grade} · ${Store.GRADE_WORD?.[c.grade] || ''}`.trim() : ''].filter(Boolean).join(' · ');
  };

  // ---------- the still parts of a frame: drawn once
  async function backdrop(c) {
    const bg = mk(W, H), g = bg.getContext('2d'), glow = GLOW[c.material] || '#ff9650';
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#2c1c0f'); gr.addColorStop(0.55, '#170e07'); gr.addColorStop(1, '#070403');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = 88; x < W; x += 180) g.fillRect(x, 0, 3, H);
    gr = g.createRadialGradient(W / 2, CARD.y + CARD.h * 0.45, 40, W / 2, CARD.y + CARD.h * 0.45, 700); gr.addColorStop(0, glow + '88'); gr.addColorStop(0.45, 'rgba(255,120,40,.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.6)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // the card's shadow (the card itself is drawn every frame, over it)
    g.save(); g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 46; g.shadowOffsetY = 18; g.fillStyle = '#000';
    g.beginPath(); g.roundRect(CARD.x + 8, CARD.y + 8, CARD.w - 16, CARD.h - 16, 40); g.fill(); g.restore();
    // the words: name, what it is, the wordmark
    await Promise.all(['400 60px "Russo One"', '800 34px Nunito'].map((f) => document.fonts?.load(f).catch(() => {})));
    const word = await loadImg('ui/omni-wordmark.webp').catch(() => null);
    const fit = (txt, font, px, max) => { let s = px; do g.font = font.replace('{}', s + 'px'); while (g.measureText(txt).width > max && (s -= 2) > 18); };
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    fit(c.character, '400 {} "Russo One", sans-serif', 60, W - 140); g.fillStyle = '#f6e8cf'; g.shadowColor = '#000'; g.shadowOffsetY = 4; g.fillText(c.character, W / 2, 1150); g.shadowOffsetY = 0;
    const k = kindLine(c); fit(k, '800 {} Nunito, sans-serif', 34, W - 160); g.fillStyle = '#ffd27a'; g.fillText(k, W / 2, 1204);
    const tail = word ? 'CARDWORKS' : 'OMNI CARDWORKS';
    g.font = '400 34px "Russo One", sans-serif'; const fw = g.measureText(tail).width, wh = 40, ww = word ? wh * word.naturalWidth / word.naturalHeight : 0, gap = word ? 10 : 0, x0 = (W - ww - gap - fw) / 2, by = 1290;
    if (word) g.drawImage(word, x0, by - wh + 5, ww, wh);
    g.textAlign = 'left'; g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#0d141c'; g.strokeText(tail, x0 + ww + gap, by); g.fillStyle = '#f9e2b4'; g.fillText(tail, x0 + ww + gap, by);
    return bg;
  }

  // ---------- the moving card: holo.js's own drawing, or (no live parts: a retired Diamond, live mode) its saved image
  // with a band of light across it. q: the resolution it's drawn at (1, or less on a slow device), shown at full size.
  async function cardDrawer(c) {
    const P = Store.cardParts?.(c), cvs = new Map();
    const canvas = (q) => { if (!cvs.has(q)) cvs.set(q, mk(Math.round(CARD.w * q), Math.round(CARD.h * q))); return cvs.get(q); };
    if (P && window.Holo?.render) {
      const fonts = P.holder === 'slab' ? document.fonts?.load('400 52px "Russo One"').catch(() => null) : null;
      const [plain, print] = await Promise.all([loadImg(P.plain), loadImg(P.print), fonts]);
      const held = { ...P, plain, print };
      return (tl, q) => { const cv = canvas(q), g = cv.getContext('2d');
        if (P.holder === 'raw') Holo.render(g, plain, print, c.material, P.look, tl, P.state); else Holo.renderHeld(g, held, c.material, P.look, tl); return cv; };
    }
    const src = Store.cardImg(c), im = await loadImg(src);
    const strip = im.naturalWidth / im.naturalHeight > 2, sw = strip ? im.naturalWidth / Store.STATES : im.naturalWidth, sx = strip ? Store.stateIdx(c) * sw : 0;
    return (tl, q) => {
      const cv = canvas(q), g = cv.getContext('2d'), w = cv.width, h = cv.height;
      g.clearRect(0, 0, w, h); g.drawImage(im, sx, 0, sw, im.naturalHeight, 0, 0, w, h);
      g.save(); g.globalCompositeOperation = 'source-atop'; const p = (tl.tx + 1) / 2 * 1.6 - 0.3, gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(clamp(p - 0.18, 0, 1), 'rgba(255,255,255,0)'); gr.addColorStop(clamp(p, 0, 1), 'rgba(255,250,235,.35)'); gr.addColorStop(clamp(p + 0.18, 0, 1), 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore(); return cv;
    };
  }

  // the light's path: one figure 8 over the clip (so it loops cleanly), eased in from the middle; a phone's tilt on top
  const path = (t) => { const a = t * Math.PI * 2, e = Math.min(1, t * 6); return { tx: Math.sin(a) * 0.85 * e + Math.sin(a) * 0.15, ty: Math.sin(a * 2) * 0.5 * e - 0.1, o: 1 }; };
  function frame(g, bg, draw, tl, q) {
    g.drawImage(bg, 0, 0);
    // the card turns a little with the light (a squeeze and a lean, so it reads as tilting)
    const cx = CARD.x + CARD.w / 2, cy = CARD.y + CARD.h / 2;
    g.save(); g.translate(cx, cy); g.transform(1 - Math.abs(tl.tx) * 0.05, tl.tx * 0.035, 0, 1 - Math.abs(tl.ty) * 0.03, 0, 0);
    g.imageSmoothingQuality = q < 1 ? 'medium' : 'low'; g.drawImage(draw(tl, q), -CARD.w / 2, -CARD.h / 2, CARD.w, CARD.h); g.restore();
  }
  // a frame should take well under 33 ms; a slow device draws the card a step smaller (as the viewer does) to keep 30 fps
  const QUALITY = [1, 0.8, 0.62, 0.5];
  const timed = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };

  /** A clip's frames without recording: resolves draw(t, tl?) -> the 1080 x 1350 canvas at time t (0..1) of the sweep
   *  (or at tilt tl). For posters and checks; record() uses the same drawing. */
  async function frames(c) {
    const [bg, draw] = await Promise.all([backdrop(c), cardDrawer(c)]), cv = mk(W, H), g = cv.getContext('2d', { alpha: false });
    return (t, tl = path(t)) => { frame(g, bg, draw, tl, 1); return cv; };
  }

  /** Record a card's clip. onProgress(0..1) each frame. Resolves { blob, type, name }; rejects if it can't record. */
  async function record(c, { onProgress, secs = SECS } = {}) {
    const type = mime(); if (!type) throw Object.assign(new Error('no MediaRecorder'), { name: 'NotSupportedError' });
    const [bg, draw] = await Promise.all([backdrop(c), cardDrawer(c)]);
    const cv = mk(W, H), g = cv.getContext('2d', { alpha: false });
    // a few frames first, timed: where the card draws slowly, start a step or two down
    let qi = 0, slow = 0;
    for (let i = 0; i < 3; i++) { const ms = timed(() => frame(g, bg, draw, path(i / 40), QUALITY[qi])); if (i && ms > 30 && qi < QUALITY.length - 1) qi++; }
    frame(g, bg, draw, path(0), QUALITY[qi]); // the first frame, before the stream starts
    const stream = cv.captureStream(FPS); // throws on a tainted canvas (a cross-origin picture): the caller falls back
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITS }), chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    // a phone being tilted (where the browser gives tilt with no question, or it was allowed): blended into the sweep
    let user = null, seen = 0; const ac = new AbortController();
    const ask = typeof window.DeviceOrientationEvent?.requestPermission === 'function';
    if (window.DeviceOrientationEvent && (!ask || window.Fun?.gyro?.on)) addEventListener('deviceorientation', (e) => { const t = window.Holo?.tiltOf?.(e); if (!t) return; user = t; seen = performance.now(); }, { signal: ac.signal });
    const done = new Promise((ok, no) => { rec.onstop = () => ok(); rec.onerror = (e) => no(e.error || new Error('recorder')); });
    rec.start(500);
    await new Promise((ok) => {
      let t0 = 0;
      const tick = (now) => {
        t0 ||= now; const t = Math.min(1, (now - t0) / (secs * 1000));
        let tl = path(t);
        if (user && now - seen < 600) tl = { tx: clamp(tl.tx * 0.5 + user.tx * 0.7, -1, 1), ty: clamp(tl.ty * 0.5 + user.ty * 0.7, -1, 1), o: 1 };
        const ms = timed(() => frame(g, bg, draw, tl, QUALITY[qi])); onProgress?.(t);
        slow = ms > 26 ? slow + 1 : 0; if (slow >= 3 && qi < QUALITY.length - 1) { qi++; slow = 0; }
        if (t < 1) requestAnimationFrame(tick); else ok();
      };
      requestAnimationFrame(tick);
    });
    ac.abort();
    await new Promise((r) => setTimeout(r, 120)); // the last frames reach the recorder
    rec.stop(); await done; stream.getTracks().forEach((tr) => tr.stop());
    const plain = (rec.mimeType || type).split(';')[0] || type.split(';')[0];
    const blob = new Blob(chunks, { type: plain });
    if (!blob.size) throw new Error('empty clip');
    const slug = c.character.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
    return { blob, type: plain, name: `omni-cardworks-${slug}-${c.material}.${ext(plain)}` };
  }

  // ---------- the button: "Share clip" -> "Recording…" (a ring fills) -> the share sheet, or "Saved" (a download)
  const FILM = '<svg class="clip-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 10.2l5-3v9.6l-5-3z" fill="currentColor"/></svg>';
  const RING = '<svg class="clip-ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2.4"/><circle class="clip-p" cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="59.7" stroke-dashoffset="59.7" transform="rotate(-90 12 12)"/><circle cx="12" cy="12" r="4" fill="#ff4a2a"/></svg>';
  let busy = false; // one clip at a time
  const said = (b, text, state) => { b.querySelector('.clip-t').textContent = text; b.dataset.state = state; };

  async function share(c, b, before, after) {
    if (busy) return;
    const ready = b._clip; // recorded, but the share sheet needed a fresh tap
    if (ready) { b._clip = null; return send(ready, c, b, true); }
    if (!mime()) return fallback(c, b);
    busy = true; b.setAttribute('aria-busy', 'true'); said(b, 'Recording…', 'rec');
    const p = b.querySelector('.clip-p');
    before?.();
    let out = null;
    try { out = await record(c, { onProgress: (t) => p?.setAttribute('stroke-dashoffset', (59.7 * (1 - t)).toFixed(1)) }); }
    catch { out = null; }
    finally { busy = false; b.removeAttribute('aria-busy'); p?.setAttribute('stroke-dashoffset', '59.7'); after?.(); }
    if (!out) return fallback(c, b);
    if (!b.isConnected) return said(b, 'Share clip', ''); // closed while it recorded: nothing pops up
    b.dispatchEvent(new CustomEvent('clip', { detail: out, bubbles: true }));
    return send(out, c, b, false);
  }
  async function send(out, c, b, tapped) {
    const file = new File([out.blob], out.name, { type: out.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: c.character, text: `${c.character}, ${kindLine(c)} at Omni Cardworks.` }); said(b, 'Share clip', ''); }
      catch (e) {
        // the recording took longer than the tap's permission lasts (Safari): one more tap shares it
        if (e?.name === 'NotAllowedError' && !tapped) { b._clip = out; return said(b, 'Share', 'ready'); }
        said(b, 'Share clip', ''); if (e?.name !== 'AbortError') toast('Couldn’t share it', 'bad');
      }
      return;
    }
    const url = URL.createObjectURL(out.blob), a = document.createElement('a'); a.href = url; a.download = out.name; a.hidden = true;
    (b.closest('dialog') || document.body).append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    said(b, 'Saved', 'saved'); setTimeout(() => { if (b.dataset.state === 'saved') said(b, 'Share clip', ''); }, 2200);
  }
  // no video here: the share picture (screens.js) instead, with a short note
  function fallback(c, b) {
    said(b, 'Share clip', '');
    toast('Video isn’t supported here. Sharing a picture.');
    return Clip.picture?.(c, b);
  }

  /** A "Share clip" button for card c (or a function giving the card shown now: the viewer swipes). cls: extra
   *  classes; before/after: run around the recording (the viewer holds its own holo still meanwhile). */
  function button(c, { cls = '', before, after } = {}) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn clip-b ' + cls;
    b.setAttribute('aria-label', typeof c === 'function' ? 'Share a clip of this card' : `Share a clip of ${c.character}`);
    b.innerHTML = `${FILM}${RING}<span class="clip-t">Share clip</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); const card = typeof c === 'function' ? c() : c; if (card) share(card, b, before, after); });
    return b;
  }

  // the share picture is screens.js's (Clip.picture is set there)
  const Clip = window.Clip = { mime, record, frames, button, picture: null, SIZE: { W, H }, SECS, drawer: cardDrawer, CARD, loadImg, path, ICONS: { FILM, RING } };
})();
