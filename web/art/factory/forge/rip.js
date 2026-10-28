/* Omni Cardworks: rip videos. "Share rip video" after an opening makes a ~35 second vertical video (1080 x 1920) of that
   pack, cut like a movie trailer to the soundtrack (owner-approved Oct 2026): embers and the Series' name, the pack in
   close-up, a slow push in, then the pack rips on the drop and the strip is tossed in slow motion; the cards come up and
   each gets its own shot on the beat, with its emoji (👀, 🔥, 😱🙌...); the rarest stays face down and glows through the
   beat where the bass stops, then turns over when it slams back in, with its tier, "1 in N" and a shower of its emoji;
   then a title card. Most common first, rarest last: the reveal's order. The same film for everyone, with their own
   cards. Drawn on a canvas from a time t (scene(...).draw(t)), recorded with the soundtrack (MediaRecorder, MP4 where
   the browser records it), then shared like a card clip (clip.js). */
(() => {
  const W = 1080, H = 1920;
  const GLOW = { paper: '#ffe6a8', wood: '#ff9f2e', fire: '#ff5a12', charcoal: '#ff3a1c', diamond: '#bfe6ff', gold: '#ffb81c', fullart: '#ffd27a' };
  const TIER = { rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };
  // the soundtrack ("Menace in the Minor", the owner's, made on Suno): where its drop is, its beat, and the beat where the
  // bass comes back after a one-beat stop. Measured from the file (scratchpad analysis): drop 12.39 s, 103.4 BPM.
  const MUSIC = { src: 'ui/sfx/menace-in-the-minor.mp3', drop: 12.39, beat: 0.5805, reveal: 24.82 };
  const EMO = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; // each phone's own emoji
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a)); // 0..1 across [a, b]
  const eo = (x) => 1 - Math.pow(1 - x, 3); // ease out
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }; // overshoot
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const rnd = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; // fixed seed: every frame draws the same sparks

  async function assets() {
    const L = Clip.loadImg;
    const [pack, back_, word] = await Promise.all([L('ui/omni-pack.webp'), L('ui/card-back.webp'), L('ui/omni-wordmark.webp').catch(() => null)]);
    await Promise.all(['400 60px "Russo One"', '800 34px Nunito', '700 40px Kalam'].map((f) => document.fonts?.load(f).catch(() => {})));
    // the pack art has see-through margins: find its real left and right edge on the tear row, and keep a mask of it
    const pc = mk(pack.naturalWidth, pack.naturalHeight), px = pc.getContext('2d', { willReadFrequently: true }); px.drawImage(pack, 0, 0);
    const row = Math.round(pack.naturalHeight * TEAR_AT), d = px.getImageData(0, row, pack.naturalWidth, 1).data;
    let l = 0, rgt = pack.naturalWidth - 1; while (l < rgt && d[l * 4 + 3] < 128) l++; while (rgt > l && d[rgt * 4 + 3] < 128) rgt--;
    px.globalCompositeOperation = 'source-in'; px.fillStyle = '#0b0705'; px.fillRect(0, 0, pc.width, pc.height);
    return { pack, back: back_, word, packL: l / pack.naturalWidth, packR: (rgt + 1) / pack.naturalWidth, packDark: pc };
  }

  // the backdrop: the forge's dark wood, a warm glow, a vignette
  function backdrop() {
    const bg = mk(W, H), g = bg.getContext('2d');
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#24170c'); gr.addColorStop(0.5, '#140c06'); gr.addColorStop(1, '#060302');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = 88; x < W; x += 180) g.fillRect(x, 0, 3, H);
    gr = g.createRadialGradient(W / 2, H * 0.62, H * 0.25, W / 2, H * 0.5, H * 0.75); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.7)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    return bg;
  }
  // effects drawn from sprites made once (a frame must stay well under 33 ms on a phone): glows, rays, emoji, shadows
  const sprites = new Map();
  const sprite = (key, w, h, paint) => { if (!sprites.has(key)) { const c = mk(w, h); paint(c.getContext('2d'), w, h); sprites.set(key, c); } return sprites.get(key); };
  function glow(g, x, y, r, color, a) {
    if (a <= 0) return;
    const sp = sprite('glow' + color, 256, 256, (x2) => { const gr = x2.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)'); x2.fillStyle = gr; x2.fillRect(0, 0, 256, 256); });
    g.save(); g.globalAlpha = clamp(a); g.globalCompositeOperation = 'lighter'; g.drawImage(sp, x - r, y - r, r * 2, r * 2); g.restore();
  }
  function rays(g, x, y, r, color, a, spin) {
    if (a <= 0) return;
    const S = 768, sp = sprite('rays' + color, S, S, (x2) => {
      x2.translate(S / 2, S / 2);
      for (let i = 0; i < 14; i++) {
        x2.rotate(Math.PI * 2 / 14);
        const gr = x2.createLinearGradient(0, 0, S / 2, 0); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        x2.fillStyle = gr; x2.beginPath(); x2.moveTo(0, 0); x2.lineTo(S / 2, -S * 0.035); x2.lineTo(S / 2, S * 0.035); x2.closePath(); x2.fill();
      }
    });
    g.save(); g.translate(x, y); g.rotate(spin); g.globalAlpha = clamp(a); g.globalCompositeOperation = 'lighter'; g.drawImage(sp, -r, -r, r * 2, r * 2); g.restore();
  }
  function sparks(g, x, y, t, color, seed, n = 46) {
    if (t <= 0 || t >= 1) return;
    const r = rnd(seed);
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, v = 380 + r() * 700, life = 0.5 + r() * 0.5, k = clamp(t / life);
      if (k >= 1) { r(); continue; }
      const d = v * eo(k), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d + 260 * k * k, s = 3 + r() * 6;
      g.globalAlpha = 1 - k; g.fillStyle = i % 3 ? color : '#fff6dc';
      g.beginPath(); g.arc(px, py, s * (1 - k * 0.6), 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  function text(g, s, x, y, font, color, { align = 'center', shadow = true, alpha = 1, track = 0 } = {}) {
    if (alpha <= 0) return;
    g.save(); g.globalAlpha = clamp(alpha); g.font = font; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = track + 'px';
    if (shadow) { g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 18; g.shadowOffsetY = 4; }
    g.fillStyle = color; g.fillText(s, x, y); g.restore();
  }
  // a card: its back or its face, turned by `turn` (0 back, 1 face; the squeeze in between is the flip)
  function card(g, A, face, cx, cy, w, turn, { rot = 0, tl, lift = 0, shadow = 1 } = {}) {
    const h = w * 1.4, sx = Math.abs(Math.cos(turn * Math.PI)), showFace = turn > 0.5;
    g.save(); g.translate(cx, cy - lift); g.rotate(rot);
    if (shadow) { g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 40 * shadow; g.shadowOffsetY = 16 + lift * 0.2; g.fillStyle = '#000'; g.beginPath(); g.roundRect(-w * sx / 2 + 6, -h / 2 + 6, w * sx - 12, h - 12, w * 0.05); g.fill(); g.restore(); }
    g.scale(Math.max(0.001, sx), 1);
    if (showFace) g.drawImage(face(tl || { tx: 0, ty: -0.1, o: 1 }, w > 500 ? 1 : 0.62), -w / 2, -h / 2, w, h);
    else g.drawImage(A.back, -w / 2, -h / 2, w, h);
    g.restore();
  }
  // the pack: whole, shaking, or torn (the strip above a jagged line flies off); `open` 0..1, light from the tear
  // the pack, whole (the close-up): a little darker and punchier, made once
  function pack(g, A, cx, cy, w) {
    const h = w * A.pack.naturalHeight / A.pack.naturalWidth;
    const sp = sprite('packDim', A.pack.naturalWidth, A.pack.naturalHeight, (x2) => { x2.filter = 'brightness(0.8) contrast(1.15)'; x2.drawImage(A.pack, 0, 0); });
    g.drawImage(sp, cx - w / 2, cy - h / 2, w, h);
  }
  // a real pack tear. p: how far the tear has run, left to right (0..1); fall: the strip, once off, dropping away (0..1).
  // The tear follows a ragged line under the crimp; the torn part of the strip peels up, hinged at the tear's front, and
  // stays on until the end; both torn edges show the white inside of the foil; the pack flexes with each pull.
  const TEAR_AT = 0.075; // just under the crimp (owner: the tear goes where you'd really tear a pack)
  const TEAR = (() => { const r = rnd(4242), pts = []; let y = 0; for (let i = 0; i <= 48; i++) { y = clamp(y + (r() - 0.5) * 7, -9, 9); pts.push([i / 48, y + (r() - 0.5) * 3]); } return pts; })();
  function packReal(g, A, cx, cy, w, { p = 0, fall = 0, flex = 0, alpha = 1, inner = null } = {}) {
    const h = w * A.pack.naturalHeight / A.pack.naturalWidth, x = cx - w / 2, y = cy - h / 2, y0 = y + h * TEAR_AT;
    const xl = x + A.packL * w, xr = x + A.packR * w, tw = xr - xl; // the tear runs edge to edge of the real pack
    const pt = (q) => [xl + q[0] * tw, y0 + q[1] * (w / 640)];
    const fx = xl + p * tw;
    g.save(); g.globalAlpha = alpha;
    g.translate(cx, cy); g.rotate(-0.035 * flex); g.transform(1, 0, -0.02 * flex, 1 - 0.01 * flex, 0, 0); g.translate(-cx, -cy);
    // the body, under the tear line
    const below = () => { g.beginPath(); g.moveTo(x - 4, y + h + 60); TEAR.forEach((q) => g.lineTo(...pt(q))); g.lineTo(x + w + 4, y + h + 60); g.closePath(); };
    g.save(); g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 50; g.shadowOffsetY = 24; below(); g.clip(); g.drawImage(A.pack, x, y, w, h); g.restore();
    // what's inside, showing through the opening (the stack's top), then the shadow just under the torn edge
    if (p > 0) {
      // the back layer's torn edge, a little higher than the front's: a thin dark gap where the pack opens
      const torn = TEAR.filter((q) => xl + q[0] * tw <= fx);
      g.save(); g.beginPath(); torn.forEach((q, i) => { const [X, Y] = pt(q); (i ? g.lineTo : g.moveTo).call(g, X, Y - 9 - 4 * Math.sin(q[0] * Math.PI)); }); [...torn].reverse().forEach((q) => g.lineTo(...pt(q))); g.closePath(); g.clip();
      g.drawImage(A.packDark, x, y, w, h); inner?.(); g.restore();
      g.save(); g.beginPath(); below(); g.clip(); const gr = g.createLinearGradient(0, y0, 0, y0 + 26); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(xl, y0 - 10, fx - xl, 40); g.restore();
      // the white torn edge on the body
      g.save(); g.strokeStyle = 'rgba(245,238,225,.95)'; g.lineWidth = 2.6; g.lineJoin = 'round'; g.beginPath();
      TEAR.filter((q) => xl + q[0] * tw <= fx).forEach((q, i) => (i ? g.lineTo : g.moveTo).call(g, ...pt([q[0], q[1] + 1.2]))); g.stroke(); g.restore();
    }
    // the strip, above the line: the untorn part lies flat; the torn part peels up from the tear's front; once fully torn
    // it comes away and drops
    const above = (x0, x1) => { g.beginPath(); g.moveTo(x0, y - 30); g.lineTo(x1, y - 30); TEAR.filter((q) => { const X = xl + q[0] * tw; return X >= x0 - 0.01 && X <= x1 + 0.01; }).reverse().forEach((q) => g.lineTo(...pt(q))); g.closePath(); };
    if (p < 1) { g.save(); above(fx, x + w + 4); g.clip(); g.drawImage(A.pack, x, y, w, h); g.restore(); }
    if (p > 0) {
      const x0s = x - 4, lift = p < 1 ? 0.06 + 0.42 * eo(p) : 0.48, front = pt(TEAR[Math.round(p * 48)]);
      g.save();
      // once off: pulled up and away to the right, then it drops out of frame (never back across the pack's face)
      // once off: tossed, up and away to the right, spinning, then gravity takes it out of frame
      if (fall > 0) { g.translate(1100 * fall, -520 * fall + 1500 * fall * fall); g.translate(front[0], front[1]); g.rotate(fall * 4.2); g.translate(-front[0], -front[1]); }
      // the torn end swings up, hinged at the tear's front
      g.translate(front[0], front[1]); g.rotate(lift); g.transform(1, 0, 0, 1 - 0.25 * lift, 0, 0); g.translate(-front[0], -front[1]);
      g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 20; g.shadowOffsetY = 10; above(x0s, fx); g.clip(); g.drawImage(A.pack, x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, y - 30, w, h * 0.2); g.restore(); // the lifted foil catches a little light
      g.strokeStyle = 'rgba(245,238,225,.95)'; g.lineWidth = 2.6; g.lineJoin = 'round'; g.beginPath();
      TEAR.filter((q) => xl + q[0] * tw <= fx).forEach((q, i) => (i ? g.lineTo : g.moveTo).call(g, ...pt([q[0], q[1] - 1.2]))); g.stroke();
      g.restore();
    }
    g.restore();
  }

  // a card turned about its vertical axis with perspective (angle 0 = face on, PI = its back): drawn in thin strips
  function turn3d(g, A, face, cx, cy, w, ang, { tl, shadow = 1, rot = 0, scale = 1 } = {}) {
    const h = w * 1.4, a = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), showBack = a > Math.PI / 2 && a < Math.PI * 1.5;
    const src = showBack ? A.back : face(tl || { tx: 0, ty: -0.1, o: 1 }, w > 500 ? 0.8 : 0.62), sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    const c = Math.cos(a), sn = Math.sin(a), f = 2200, N = 44;
    g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(scale, scale);
    if (shadow) {
      const sp = sprite('shadow', 300, 400, (x2) => { x2.shadowColor = 'rgba(0,0,0,.85)'; x2.shadowBlur = 26; x2.shadowOffsetY = 600; x2.fillStyle = '#000'; x2.beginPath(); x2.roundRect(40, 40 - 600, 220, 320, 14); x2.fill(); });
      const ww = Math.max(1, Math.abs(c) * w); g.save(); g.globalAlpha = clamp(shadow); g.drawImage(sp, -ww / 2 - ww * 0.18, -h / 2 - h * 0.1 + 18, ww * 1.36, h * 1.25); g.restore();
    }
    for (let i = 0; i < N; i++) {
      const u0 = -w / 2 + (w / N) * i, u1 = u0 + w / N, z0 = u0 * sn, z1 = u1 * sn;
      const x0 = u0 * c * f / (f + z0), x1 = u1 * c * f / (f + z1), s0 = f / (f + (z0 + z1) / 2), hh = h * s0;
      const si = showBack ? N - 1 - i : i; // the back reads the right way round
      g.drawImage(src, (sw / N) * si, 0, sw / N + 0.5, sh, Math.min(x0, x1) - 0.4, -hh / 2, Math.abs(x1 - x0) + 0.8, hh);
    }
    g.restore();
  }
  function header(g, A, series, a) {
    text(g, `SERIES ${series}`, W / 2, 170, '400 40px "Russo One", sans-serif', '#ffd27a', { alpha: a, track: 10 });
  }
  function footer(g, A, a) {
    if (a <= 0) return;
    const tail = 'CARDWORKS'; g.save(); g.globalAlpha = clamp(a); g.font = '400 52px "Russo One", sans-serif';
    const fw = g.measureText(tail).width, wh = 62, ww = A.word ? wh * A.word.naturalWidth / A.word.naturalHeight : 0, gap = A.word ? 14 : 0, x0 = (W - ww - gap - fw) / 2, by = H - 120;
    if (A.word) g.drawImage(A.word, x0, by - wh + 8, ww, wh);
    g.textAlign = 'left'; g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#0d141c'; g.strokeText(tail, x0 + ww + gap, by); g.fillStyle = '#f9e2b4'; g.fillText(tail, x0 + ww + gap, by);
    g.restore();
  }
  const look = (c) => (Store.ALWAYS_HOLO?.[c.material] ? 'full' : c.holo || 'none');
  const nameOf = (c) => { const m = Store.MAT_LABEL[c.material], l = look(c); return c.material === 'gold' || c.material === 'fullart' ? m : l === 'full' ? `Full holo ${m}` : l === 'none' ? m : `Holo ${m}`; };

  /** The film for a pack: cards (any order) and its Series number. Resolves { W, H, secs, draw(t) -> the canvas at t
   *  seconds }; t runs with the soundtrack from its start. */
  async function scene(cards, { series = 7 } = {}) {
    const A = await assets(), bg = backdrop();
    const odds = (c) => Store.trueOdds(c);
    const order = [...cards].sort((a, b) => odds(a).n - odds(b).n); // most common first, rarest last
    const faces = await Promise.all(order.map((c) => Clip.drawer(c)));
    const best = order[order.length - 1], bo = odds(best), col = GLOW[best.material] || '#ffd27a';
    const tier = bo.tier, up = window.Info?.upsideDown?.(best.material, look(best));
    const n = order.length, cv = mk(W, H), g = cv.getContext('2d', { alpha: false });
    let lite = false; // a slow device: no grain, no embers (the recorder turns it on)
    const S = trailer();
    return { W, H, secs: S.secs, draw: (t) => { g.drawImage(bg, 0, 0); S.draw(t); return cv; }, set lite(v) { lite = !!v; }, get lite() { return lite; } };

    // ---- emoji reactions by pull (owner-approved set): the look decides, the rarest reason wins
    // (function declarations: scene() returns above them, so they're hoisted; a const here would never be set)
    function emojiOf(c) {
      const o = odds(c), l = look(c);
      if (window.Info?.upsideDown?.(c.material, l)) return ['🙃', '🤯'];
      if (o.tier === 'legendary') return ['🤯', '🙌', '🔥'];
      if (o.tier === 'epic') return ['😱', '🙌'];
      if (c.material === 'gold') return ['🤑', '👑'];
      if (o.tier === 'rare') return ['😮', '🔥'];
      if (c.material === 'fire' || c.material === 'charcoal') return ['🔥'];
      return l === 'none' ? ['👀'] : ['👀', '✨'];
    }
    // an emoji, drawn once at 160 px (with its shadow) and reused
    function emo(e) { return sprite('emo' + e, 224, 224, (x2) => { x2.font = `160px ${EMO}`; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.shadowColor = 'rgba(0,0,0,.6)'; x2.shadowBlur = 18; x2.fillText(e, 112, 116); }); }
    // the pop: each emoji bounces in, a little apart and tilted
    function emoji(t, t0, c, x, y, big = 1) {
      const k = t - t0; if (k < 0) return;
      emojiOf(c).forEach((e, i) => {
        const s = back(seg(k, i * 0.09, i * 0.09 + 0.35)); if (s <= 0) return;
        const size = (emojiOf(c).length > 2 ? 120 : 140) * big;
        g.save(); g.translate(x + i * size * 0.62 - (emojiOf(c).length - 1) * size * 0.2, y + (i % 2) * size * 0.55); g.rotate(i % 2 ? 0.18 : -0.15); g.scale(s, s);
        g.drawImage(emo(e), -size * 0.7, -size * 0.7, size * 1.4, size * 1.4); g.restore();
      });
    }
    // the shower on a big pull (Epic and up): its emoji falling, tumbling
    function rain(t, t0) {
      const k = t - t0; if (k < 0 || !(tier === 'epic' || tier === 'legendary' || up)) return;
      const set = emojiOf(best), r = rnd(33);
      g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i < 40; i++) {
        const x = r() * W, d = r() * 1.6, sp = 500 + r() * 600, sz = 60 + r() * 60, spin = (r() - 0.5) * 4, y = -120 + (k - d) * sp;
        if (k < d || y > H + 100) continue;
        g.save(); g.globalAlpha = clamp(1 - (k - 2.6) / 0.8); g.translate(x, y); g.rotate(spin * (k - d)); g.drawImage(emo(set[i % set.length]), -sz * 0.7, -sz * 0.7, sz * 1.4, sz * 1.4); g.restore();
      }
      g.restore();
    }

    // ---- the best card's moment, shared: flash, rays, sparks, its tier and "1 in N" (and "Upside-down rare")
    function moment(t, t0, cx, cy) {
      const k = t - t0; if (k < 0) return;
      glow(g, cx, cy, 900, col, 0.9 * Math.exp(-k * 1.2) + 0.35);
      rays(g, cx, cy, 1100, col + 'aa', clamp(1 - k / 2.2) * 0.8 + 0.12, k * 0.25);
      sparks(g, cx, cy, k / 1.6, col, 7);
    }
    function label(t, t0, y) {
      const k = t - t0; if (k < 0) return;
      const a = eo(seg(k, 0, 0.35)), s = back(seg(k, 0, 0.45));
      if (tier) text(g, TIER[tier], W / 2, y, '400 44px "Russo One", sans-serif', col, { alpha: a, track: 14 });
      g.save(); g.translate(W / 2, y + 96); g.scale(lerp(0.6, 1, s), lerp(0.6, 1, s));
      text(g, bo.label ? bo.label.toUpperCase() : nameOf(best), 0, 0, '400 96px "Russo One", sans-serif', '#fff3d6', { alpha: a });
      g.restore();
      text(g, up ? `${nameOf(best)} · upside-down rare` : `${best.character} · ${nameOf(best)}`, W / 2, y + 160, '800 40px Nunito, sans-serif', '#f3dcae', { alpha: eo(seg(k, 0.25, 0.6)) });
    }
    function flash(t, t0) { const k = t - t0; if (k < 0 || k > 0.5) return; g.save(); g.globalAlpha = (1 - k / 0.5) * 0.85; g.fillStyle = '#fff8e8'; g.fillRect(0, 0, W, H); g.restore(); }
    function ending(t, t0, from) { // the best card settles up top, every pull in a row under it, the wordmark
      const k = eo(seg(t, t0, t0 + 0.8)), cw = lerp(from.w, 600, k), cx = W / 2, cy = lerp(from.y, 760, k);
      glow(g, cx, cy, 760, col, 0.45);
      card(g, A, faces[n - 1], cx, cy, cw, 1, { tl: Clip.path(((t - t0) / 3) % 1) });
      const a = eo(seg(t, t0 + 0.4, t0 + 1.1)), tw = 150, gap = 18, row = n * tw + (n - 1) * gap, y = 1420;
      order.forEach((c, i) => card(g, A, faces[i], W / 2 - row / 2 + tw / 2 + i * (tw + gap), y + (1 - a) * 60, tw, 1, { shadow: a * 0.6, tl: { tx: 0, ty: 0, o: 1 } }));
      g.save(); g.globalAlpha = 1 - a; g.fillStyle = '#100a05'; g.fillRect(0, y - 140, W, 300); g.restore();
      text(g, `${best.character} · ${nameOf(best)}${bo.label ? ' · ' + bo.label : ''}`, W / 2, 1230, '800 40px Nunito, sans-serif', '#ffd27a', { alpha: a });
      footer(g, A, a);
    }

    // ---- the trailer: a movie trailer. Dark, slow camera moves, hard cuts with beats of black, title cards, film grain;
    // the pack in close-up, the tear, the commons as quick shots, the last card's back glowing, its turn in slow motion.
    function trailer() {
      // timed to the soundtrack (MUSIC): slow, slow, then the snap rip on the drop; the commons cut on the beat; the last
      // card holds through the beat where the bass stops, and turns over when it slams back in
      const M = MUSIC, Tl = { intro: 0, macro: 4.6, wide: 8.0, rip: M.drop, cards: M.drop + 3 * M.beat };
      const hitAt = M.reveal, build0 = hitAt - 4 * M.beat;
      Tl.per = Math.max(2, Math.round((build0 - Tl.cards) / Math.max(1, n - 1) / M.beat)) * M.beat;
      const build = Tl.cards + (n - 1) * Tl.per, outro = hitAt + 12 * M.beat, secs = outro + 6 * M.beat;
      // film grain: a few noise tiles, cycled
      const grain = [0, 1, 2, 3].map((k) => { const c = mk(270, 480), x = c.getContext('2d'), d = x.createImageData(270, 480), r = rnd(91 + k); for (let i = 0; i < d.data.length; i += 4) { const v = r() < 0.5 ? 0 : 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = r() < 0.35 ? 40 : 0; } x.putImageData(d, 0, 0); return c; });
      const embers = (t, a) => { // drifting up from the bottom, slow
        if (a <= 0 || lite) return; const r = rnd(5); g.save(); g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 70; i++) { const x0 = r() * W, sp = 40 + r() * 90, ph = r() * 30, s = 1.5 + r() * 3.5, y = H - ((t * sp + ph * 60) % (H + 200)) + 100, x = x0 + Math.sin(t * 0.7 + i) * 40;
          g.globalAlpha = a * (0.25 + 0.6 * r()) * clamp(y / H * 1.5); g.fillStyle = i % 4 ? '#ff8a3a' : '#ffd27a'; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); }
        g.restore(); };
      const cam = (z, cx, cy, fn) => { g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-cx, -cy); fn(); g.restore(); };
      const black = (a) => { if (a <= 0) return; g.save(); g.globalAlpha = clamp(a); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.restore(); };
      const title = (s1, y, a, size = 46, color = '#e9d6b0') => text(g, s1, W / 2, y, `400 ${size}px "Russo One", sans-serif`, color, { alpha: a, track: size * 0.35 });
      const inOut = (t, a, b, f = 0.35) => seg(t, a, a + f) * (1 - seg(t, b - f, b));
      const CY = 960;
      const draw = (t) => {
        // 1. black, embers, the Series' name
        if (t < Tl.macro) {
          black(1); embers(t, seg(t, 0.2, 1.4));
          title(`SERIES ${series}`, H / 2 + 16, inOut(t, 0.5, Tl.macro - 0.1, 0.6), 54);
        }
        // 2. the pack in close-up: a slow pan across its face, rim light
        else if (t < Tl.wide) {
          const k = seg(t, Tl.macro, Tl.wide);
          g.save();
          cam(1.35 - 0.1 * k, W / 2 + lerp(-40, 40, eio(k)), CY - 40 + lerp(20, -20, k), () => pack(g, A, W / 2, CY, 640));
          g.restore();
          glow(g, W * 0.8, H * 0.25, 700, 'rgba(255,170,90,.35)', 0.8);
          black(1 - seg(t, Tl.macro, Tl.macro + 0.25) + seg(t, Tl.wide - 0.15, Tl.wide));
        }
        // 3. wide: a slow push in; the top peels, the light spills, the strip goes
        else if (t < Tl.cards) {
          // a slow push in, quiet; then the snap rip at real speed; the toss in slow motion; the cards come up
          const k = seg(t, Tl.wide, Tl.rip), p = eio(seg(t, Tl.rip, Tl.rip + 0.3)), fall = seg(t, Tl.rip + 0.3, Tl.rip + 2.1) ** 1.3;
          const rise = eio(seg(t, Tl.rip + 0.6, Tl.cards - 0.1)), z = lerp(1.0, 1.12, eio(k)) + 0.03 * Math.exp(-Math.max(0, t - Tl.rip - 0.3) * 6) * (t > Tl.rip + 0.3 ? 1 : 0);
          const PW = 620, ph = PW * A.pack.naturalHeight / A.pack.naturalWidth;
          embers(t, 0.35);
          cam(z, W / 2, CY - 40, () => {
            if (rise > 0) { g.save(); g.beginPath(); g.rect(0, 0, W, CY - ph / 2 + ph * TEAR_AT + 6); g.clip(); turn3d(g, A, faces[0], W / 2, lerp(CY + 120, CY - 200, rise), PW * 0.9, Math.PI, { shadow: 0.5 }); g.restore(); }
            packReal(g, A, W / 2, CY, PW, { p, fall, flex: Math.sin(seg(t, Tl.rip - 0.05, Tl.rip + 0.45) * Math.PI) });
          });
          black(1 - seg(t, Tl.wide, Tl.wide + 0.3) + seg(t, Tl.cards - 0.18, Tl.cards));
        }
        // 4. the commons: one quick shot each, a different framing every time, a slow drift, hard cuts
        else if (t < build) {
          const i = Math.min(n - 2, Math.floor((t - Tl.cards) / Tl.per)), k = seg(t, Tl.cards + i * Tl.per, Tl.cards + (i + 1) * Tl.per);
          if (t >= Tl.cards + (n - 1) * Tl.per) { black(1); embers(t, 0.4); }
          else {
            const shots = [[1.0, -0.35, 0.18, 0], [1.06, 0.3, -0.12, -20], [0.98, -0.2, 0.25, 10], [1.05, 0.25, -0.2, -10], [1.02, -0.3, 0.1, 0]];
            const [z, a0, a1, dy] = shots[i % shots.length];
            embers(t, 0.25);
            cam(z + 0.05 * k, W / 2 + lerp(-20, 20, k), CY + dy, () => turn3d(g, A, faces[i], W / 2, CY, 640, lerp(a0, a1, eio(k)), { tl: { tx: lerp(-0.8, 0.8, k), ty: -0.1, o: 1 } }));
            emoji(t, Tl.cards + i * Tl.per + 0.12, order[i], W / 2 + 250, CY - 400);
            black(1 - seg(t, Tl.cards + i * Tl.per, Tl.cards + i * Tl.per + 0.08) + seg(t, Tl.cards + (i + 1) * Tl.per - 0.07, Tl.cards + (i + 1) * Tl.per));
          }
        }
        // 5. the last card, face down: its edges glow, the camera creeps in; then the turn, in slow motion
        else if (t < outro) {
          const k = seg(t, build, hitAt), turnK = seg(t, hitAt - 0.25, hitAt + 0.9), ang = Math.PI * (1 - eio(turnK)) + (turnK ? 0 : Math.sin(t * 0.8) * 0.12);
          embers(t, 0.3 + 0.5 * k);
          if (t < hitAt) glow(g, W / 2, CY, 520 + 260 * k, col, 0.15 + 0.6 * k * k);
          else moment(t, hitAt, W / 2, CY);
          const z = t < hitAt ? lerp(0.96, 1.06, eio(k)) : lerp(1.06, 0.92, eo(seg(t, hitAt, hitAt + 1.6)));
          const shake = t < hitAt ? (k * k) * 6 : 0;
          cam(z, W / 2 + Math.sin(t * 70) * shake, CY, () => turn3d(g, A, faces[n - 1], W / 2, CY, 640, ang, { tl: Clip.path(((t - hitAt) / 4) % 1 + 1) }));
          if (t >= hitAt) { rain(t, hitAt + 0.5); emoji(t, hitAt + 0.5, best, W / 2 + 230, CY - 380, 1.25); flash(t, hitAt); label(t, hitAt + 0.9, 1640); }
          black(1 - seg(t, build, build + 0.4) + seg(t, outro - 0.2, outro));
        }
        // 6. the title card: the best card small, the wordmark, the Series
        else {
          black(1); embers(t, 0.5);
          const a = seg(t, outro + 0.1, outro + 0.8);
          glow(g, W / 2, 820, 520, col, 0.35 * a);
          g.save(); g.globalAlpha = a; turn3d(g, A, faces[n - 1], W / 2, 820, 520, Math.sin(t * 0.7) * 0.18, { tl: Clip.path(((t - outro) / 3) % 1) }); g.restore();
          text(g, `${best.character} · ${nameOf(best)}${bo.label ? ' · ' + bo.label : ''}`, W / 2, 1290, '800 40px Nunito, sans-serif', '#ffd27a', { alpha: seg(t, outro + 0.5, outro + 1.1) });
          title(`SERIES ${series}`, 1400, seg(t, outro + 0.7, outro + 1.3), 36, '#cdb68c');
          footer(g, A, seg(t, outro + 0.9, outro + 1.6));
          black(seg(t, secs - 0.5, secs));
        }
        // letterbox, grain
        g.fillStyle = '#000'; g.fillRect(0, 0, W, 96); g.fillRect(0, H - 96, W, 96);
        if (!lite) g.drawImage(grain[Math.floor(t * 24) % 4], 0, 0, W, H);
      };
      return { secs, draw };
    }
  }

  // ---------- recording: the film drawn live on its canvas, timed by the soundtrack's own clock, both into one recorder
  // with sound: MP4 (H.264 + AAC) where the browser records it (Safari, iOS, recent Chrome), else WebM
  const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  function mime() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream || !(window.AudioContext || window.webkitAudioContext)) return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') return 'video/mp4';
    return MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
  }
  /** Record the film for a pack. onProgress(0..1) as it goes. Resolves { blob, type, name }; rejects if it can't. */
  async function record(cards, { series = 7, onProgress } = {}) {
    const type = mime(); if (!type) throw Object.assign(new Error('no recorder'), { name: 'NotSupportedError' });
    const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    try {
      const [S, data] = await Promise.all([scene(cards, { series }), fetch(MUSIC.src).then((r) => { if (!r.ok) throw new Error('soundtrack ' + r.status); return r.arrayBuffer(); })]);
      const music = await new Promise((ok, no) => ctx.decodeAudioData(data, ok, no)); // the callback form: older Safari
      const dest = ctx.createMediaStreamDestination(), gain = ctx.createGain(), src = ctx.createBufferSource();
      src.buffer = music; src.connect(gain); gain.connect(dest);
      const cv = S.draw(0), stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 160_000 }), chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((ok, no) => { rec.onstop = () => ok(); rec.onerror = (e) => no(e.error || new Error('recorder')); });
      if (ctx.state === 'suspended') await ctx.resume();
      rec.start(500);
      const t0 = ctx.currentTime + 0.06; src.start(t0);
      gain.gain.setValueAtTime(1, t0 + S.secs - 2.4); gain.gain.linearRampToValueAtTime(0, t0 + S.secs); // the music fades with the title card
      await new Promise((ok) => {
        let slow = 0;
        const tick = () => {
          const t = ctx.currentTime - t0, a = performance.now(); S.draw(Math.max(0, t));
          if (!S.lite && (slow = performance.now() - a > 28 ? slow + 1 : 0) >= 5) S.lite = true; // five slow frames in a row: the lighter look
          onProgress?.(clamp(t / S.secs)); if (t < S.secs) requestAnimationFrame(tick); else ok();
        };
        requestAnimationFrame(tick);
      });
      await new Promise((r) => setTimeout(r, 150)); // the last frames reach the recorder
      rec.stop(); await done; stream.getTracks().forEach((tr) => tr.stop()); src.stop();
      const plain = (rec.mimeType || type).split(';')[0];
      const blob = new Blob(chunks, { type: plain }); if (!blob.size) throw new Error('empty video');
      return { blob, type: plain, name: `omni-cardworks-series-${series}-pack.${/mp4/.test(plain) ? 'mp4' : 'webm'}` };
    } finally { ctx.close?.().catch(() => {}); }
  }

  // ---------- the button: "Rip video" -> "Making it…" (a ring fills) -> the share sheet, or "Saved" (a download)
  let busy = false;
  const said = (b, text, state) => { b.querySelector('.clip-t').textContent = text; b.dataset.state = state; };
  async function send(out, b, text, tapped) {
    const file = new File([out.blob], out.name, { type: out.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Omni Cardworks', text }); said(b, 'Rip video', ''); }
      catch (e) {
        if (e?.name === 'NotAllowedError' && !tapped) { b._out = out; return said(b, 'Share', 'ready'); } // took longer than the tap allows: one more tap
        said(b, 'Rip video', ''); if (e?.name !== 'AbortError') toast('Couldn’t share it', 'bad');
      }
      return;
    }
    const url = URL.createObjectURL(out.blob), a = document.createElement('a'); a.href = url; a.download = out.name; a.hidden = true;
    (b.closest('dialog') || document.body).append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    said(b, 'Saved', 'saved'); setTimeout(() => { if (b.dataset.state === 'saved') said(b, 'Rip video', ''); }, 2200);
  }
  /** A "Rip video" button for a pack's cards, or null where this browser can't record one. */
  function button(cards, series) {
    if (!mime() || !window.Clip || !cards?.length) return null;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn clip-b rip-b'; b.dataset.key = 'ripvideo';
    b.setAttribute('aria-label', 'Make a video of this pack opening to share');
    b.innerHTML = `${Clip.ICONS.FILM}${Clip.ICONS.RING}<span class="clip-t">Rip video</span>`;
    const best = [...cards].sort((a, c) => Store.trueOdds(c).n - Store.trueOdds(a).n)[0], od = Store.trueOdds(best);
    const text = `Series ${series} pack at Omni Cardworks: ${best.character}, ${nameOf(best)}${od.label ? ' (' + od.label + ')' : ''}. ${Store.shareLink(cards.map((c) => c.id))}`;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (b._out) { const o = b._out; b._out = null; return send(o, b, text, true); }
      if (busy) return; busy = true; b.setAttribute('aria-busy', 'true'); said(b, 'Making it…', 'rec');
      const ring = b.querySelector('.clip-p'); let out = null;
      try { out = await record(cards, { series, onProgress: (t) => ring?.setAttribute('stroke-dashoffset', (59.7 * (1 - t)).toFixed(1)) }); }
      catch { out = null; }
      finally { busy = false; b.removeAttribute('aria-busy'); ring?.setAttribute('stroke-dashoffset', '59.7'); }
      if (!out) { said(b, 'Rip video', ''); return toast('Couldn’t make the video here', 'bad'); }
      if (!b.isConnected) return; // closed while it was made: nothing pops up
      b.dispatchEvent(new CustomEvent('ripvideo', { detail: out, bubbles: true }));
      return send(out, b, text, false);
    });
    return b;
  }

  window.Rip = { scene, record, button, mime, SIZE: { W, H }, MUSIC };
})();
