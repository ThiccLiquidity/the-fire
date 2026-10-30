/* Omni Cardworks: the 3D card. A card you can pick up: drag to turn it all the way round (its back, its edge, the
   thickness of the stock), flick to spin it, tilt the phone to rock it. The face is the live holo (holo.js draws it at
   the card's angle every frame it moves, the same look as everywhere else), on a real card body in WebGL with a light
   that glints off it as it turns. A case or a slab is built like the real thing: the card sits inside, a few
   millimetres under clear plastic (a slab's label in its own pocket above it), and the light slides across the
   plastic in front of it. No library: one small shader pair. Card3D.supported, Card3D.open(card, name).
   Reduced motion: no drift, no spin. */
(() => {
  const ASPECT = 1008 / 720, W = 1, H = ASPECT;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl1 = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl', { failIfMajorPerformanceCaveat: true }) || c.getContext('experimental-webgl')); } catch { return false; } })();

  // ---------- geometry. A vertex: x y z, normal, u v (8 floats). Shapes are rounded rectangles in the card's own
  // units (W wide, H tall, centred), each with its own picture mapped across it.
  const STRIDE = 8;
  function outline(x0, y0, x1, y1, r, seg = 10) {
    const pts = [], cs = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI], [x1 - r, y0 + r, Math.PI * 1.5]];
    for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * (i / seg); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }
  /** a flat rounded rectangle at depth z, facing +z (front) or -z (back, its picture mirrored so it reads right) */
  function sheet(x0, y0, x1, y1, r, z, front = true) {
    const out = [], pts = outline(x0, y0, x1, y1, r), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const uv = (x, y) => { const u = (x - x0) / (x1 - x0); return [front ? u : 1 - u, (y1 - y) / (y1 - y0)]; };
    const push = (x, y) => out.push(x, y, z, 0, 0, front ? 1 : -1, ...uv(x, y));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (front) { push(cx, cy); push(a[0], a[1]); push(b[0], b[1]); } else { push(cx, cy); push(b[0], b[1]); push(a[0], a[1]); }
    }
    return out;
  }
  /** the band all round a rounded rectangle, from z0 to z1 (its u runs round, v from back to front) */
  function band(x0, y0, x1, y1, r, z0, z1) {
    const out = [], pts = outline(x0, y0, x1, y1, r);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1, n = [nx / l, ny / l, 0];
      const v = (x, y, z) => out.push(x, y, z, ...n, i / pts.length, (z - z0) / (z1 - z0));
      v(a[0], a[1], z1); v(a[0], a[1], z0); v(b[0], b[1], z0);
      v(a[0], a[1], z1); v(b[0], b[1], z0); v(b[0], b[1], z1);
    }
    return out;
  }

  // ---------- shaders. kind 0: a picture (the card's face or back, a label), lit; 1: an edge (a colour, its two
  // bevels bright); 2: clear plastic (nearly invisible: its rims from the picture, and the light's glint and the
  // grazing-angle sheen); 3: a plain colour (the back of a slab's label)
  const VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t;
    uniform mat4 M, VP; varying vec3 vn; varying vec3 vp; varying vec2 vt;
    void main(){ vec4 w = M * vec4(p, 1.0); vp = w.xyz; vn = mat3(M) * n; vt = t; gl_Position = VP * w; }`;
  const FS = `precision mediump float; varying vec3 vn; varying vec3 vp; varying vec2 vt;
    uniform sampler2D tex; uniform vec3 col, eye; uniform float kind, gloss, alpha;
    void main(){
      vec3 N = normalize(vn), V = normalize(eye - vp), L = normalize(vec3(-0.45, 0.6, 0.9)), Hh = normalize(L + V);
      float facing = max(dot(N, V), 0.0), dif = 0.72 + 0.28 * max(dot(N, L), 0.0);
      if (kind < 0.5) {
        vec4 c = texture2D(tex, vt); if (c.a < 0.35) discard;
        gl_FragColor = vec4(c.rgb * dif + vec3(pow(max(dot(N, Hh), 0.0), 70.0) * gloss), 1.0);
      } else if (kind < 1.5) {
        // solid clear acrylic seen edge-on: lit like glass (brighter facing up), bright bevels at the front and back,
        // and on a slab the seam down the middle where its two halves are sealed
        float spec = pow(max(dot(N, Hh), 0.0), 90.0) * 1.1;
        float bevel = smoothstep(0.80, 0.99, abs(vt.y * 2.0 - 1.0));
        float seam = alpha < 0.99 ? 1.0 - smoothstep(0.0, 0.05, abs(vt.y - 0.5)) : 0.0;
        float env = 0.78 + 0.22 * N.y + 0.12 * sin(vt.y * 18.0);
        vec3 glass = col * dif * env - vec3(seam * 0.22) + vec3(spec + bevel * 0.5);
        gl_FragColor = vec4(glass, max(max(alpha, spec), bevel * 0.95));
      } else if (kind < 2.5) {
        vec4 c = texture2D(tex, vt);
        float spec = pow(max(dot(N, Hh), 0.0), 140.0) * 1.3, sheen = pow(1.0 - facing, 4.0) * 0.35;
        gl_FragColor = vec4(c.rgb + vec3(spec + sheen), clamp(c.a + spec + sheen + 0.03, 0.0, 1.0));
      } else {
        gl_FragColor = vec4(col * dif, 1.0);
      }
    }`;

  // ---------- small matrix helpers (column-major, like WebGL)
  const mul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]); };
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  const move = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

  function program(gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function texture(gl, img) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return t;
  }
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // depths, in card widths: a card's stock; a case's and a slab's plastic (a real slab is about 6.5 mm thick on 83 mm)
  const STOCK = 0.012, CASE_D = 0.034, SLAB_D = 0.078;

  /** The clear plastic's own marks (static): the rim round its edge and, in a slab, the well the card sits in. Mostly
   *  transparent: the light does the rest. */
  function shellPicture(box, slab) {
    const c = canvas(720, 1008), g = c.getContext('2d'), k = 720 / box.W;
    g.scale(k, k);
    const rr = (b, r) => { g.beginPath(); g.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, r); };
    g.fillStyle = 'rgba(225,235,245,0.05)'; rr(box.body, box.r); g.fill(); // the faintest tint
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.55)'; rr({ x0: box.body.x0 + 6, y0: box.body.y0 + 6, x1: box.body.x1 - 6, y1: box.body.y1 - 6 }, box.r - 4); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(40,60,80,0.45)'; rr(box.body, box.r); g.stroke();
    if (slab) {
      const cb = box.card, win = { x0: cb.x0 - 16, y0: cb.y0 - 16, x1: cb.x1 + 16, y1: cb.y1 + 16 };
      g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.5)'; rr(win, 40); g.stroke();
      g.lineWidth = 2; g.strokeStyle = 'rgba(40,60,80,0.4)'; rr({ x0: win.x0 - 4, y0: win.y0 - 4, x1: win.x1 + 4, y1: win.y1 + 4 }, 44); g.stroke();
      const lb = box.label, lw = { x0: lb.x0 - 10, y0: lb.y0 - 10, x1: lb.x1 + 10, y1: lb.y1 + 10 };
      g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.45)'; rr(lw, 24); g.stroke();
    }
    return c;
  }

  async function open(c, name = '') {
    const F = await window.Holo?.face(c).catch(() => null);
    if (!F) { window.toast?.('This card can’t be shown in 3D.', 'bad'); return; }
    const d = document.createElement('dialog'); d.className = 'c3d';
    d.innerHTML = `<canvas class="c3d-cv" aria-label="${(name || 'Card').replace(/[&<>"]/g, '')} in 3D. Drag to turn it."></canvas>
      <button class="c3d-x btn round" type="button" aria-label="Close">✕</button>
      <p class="c3d-hint">Drag to turn · flick to spin · double-tap to reset</p>`;
    document.body.append(d); d.showModal();
    const cv = d.querySelector('canvas'), gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { d.remove(); window.toast?.('3D isn’t available on this device.', 'bad'); return; }
    let raf = 0, alive = true;
    const close = () => { alive = false; cancelAnimationFrame(raf); removeEventListener('deviceorientation', tiltIn); d.close(); d.remove(); };
    d.querySelector('.c3d-x').onclick = close; d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

    const prog = program(gl); gl.useProgram(prog);
    const U = (nm) => gl.getUniformLocation(prog, nm);
    const A = ['p', 'n', 't'].map((nm) => gl.getAttribLocation(prog, nm));
    A.forEach((l) => gl.enableVertexAttribArray(l));
    gl.uniform1i(U('tex'), 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    const back = await loadImg('ui/card-back.webp').catch(() => null);

    // ---------- the parts: each { buf, n, kind, tex, col, gloss, alpha, see (see-through: drawn after the solid ones) }
    const parts = [];
    const add = (verts, o) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW); parts.push({ buf, n: verts.length / STRIDE, ...o }); };
    const faceTex = texture(gl, null), backTex = texture(gl, back);
    const X = (x) => x * W - W / 2, Y = (y) => H / 2 - y * H; // 0..1 across and down the holder -> the card's units
    let faceCv, drawFace;
    if (F.holder === 'raw') {
      const r = W * 46.5 / 750, z = STOCK / 2;
      faceCv = canvas(720, 1008); drawFace = (g, tl) => F.draw(g, tl);
      add(sheet(-W / 2, -H / 2, W / 2, H / 2, r, z, true), { kind: 0, tex: faceTex, gloss: 0.32 });
      add(sheet(-W / 2, -H / 2, W / 2, H / 2, r, -z, false), { kind: 0, tex: backTex, gloss: 0.2 });
      add(band(-W / 2, -H / 2, W / 2, H / 2, r, -z, z), { kind: 1, col: [0.93, 0.9, 0.84], alpha: 1 });
    } else {
      const B = F.box, slab = F.holder === 'slab', D = slab ? SLAB_D : CASE_D, cb = B.card, bd = B.body;
      const cx0 = X(cb.x0 / B.W), cx1 = X(cb.x1 / B.W), cy0 = Y(cb.y1 / B.H), cy1 = Y(cb.y0 / B.H), cr = (cx1 - cx0) * 46.5 / 750;
      const bx0 = X(bd.x0 / B.W), bx1 = X(bd.x1 / B.W), by0 = Y(bd.y1 / B.H), by1 = Y(bd.y0 / B.H), br = (bx1 - bx0) * B.r / (bd.x1 - bd.x0);
      // the card inside, in the middle of the plastic
      faceCv = canvas(640, Math.round(640 * (cb.y1 - cb.y0) / (cb.x1 - cb.x0))); drawFace = (g, tl) => F.drawCard(g, tl);
      add(sheet(cx0, cy0, cx1, cy1, cr, 0.0015, true), { kind: 0, tex: faceTex, gloss: 0.3 });
      add(sheet(cx0, cy0, cx1, cy1, cr, -0.0015, false), { kind: 0, tex: backTex, gloss: 0.2 });
      // a slab's label in its pocket, a little behind the front
      if (slab && F.drawLabel) {
        const lb = B.label, lc = canvas(720, Math.round(720 * (lb.y1 - lb.y0) / (lb.x1 - lb.x0))); F.drawLabel(lc.getContext('2d'));
        const lx0 = X(lb.x0 / B.W), lx1 = X(lb.x1 / B.W), ly0 = Y(lb.y1 / B.H), ly1 = Y(lb.y0 / B.H), lr = (lx1 - lx0) * 18 / (lb.x1 - lb.x0);
        add(sheet(lx0, ly0, lx1, ly1, lr, D * 0.18, true), { kind: 0, tex: texture(gl, lc), gloss: 0.25 });
        add(sheet(lx0, ly0, lx1, ly1, lr, D * 0.18 - 0.002, false), { kind: 3, col: [0.92, 0.88, 0.8] });
      }
      // the clear plastic: its back, its edge, its front (see-through, drawn last, back to front)
      const shell = texture(gl, shellPicture(B, slab));
      add(sheet(bx0, by0, bx1, by1, br, -D / 2, false), { kind: 2, tex: shell, see: true });
      add(band(bx0, by0, bx1, by1, br, -D / 2, D / 2), { kind: 1, col: [0.8, 0.86, 0.88], alpha: slab ? 0.9 : 0.8, see: true });
      add(sheet(bx0, by0, bx1, by1, br, D / 2, true), { kind: 2, tex: shell, see: true });
    }
    const fg = faceCv.getContext('2d');

    // ---------- the angle: drag, a flick's spin, the phone's tilt, and (untouched) a slow drift
    const S = { yaw: -0.35, pitch: 0.12, vy: 0, vp: 0, drag: null, last: performance.now(), touched: 0, tilt: { x: 0, y: 0 }, drawn: null };
    const down = (e) => { cv.setPointerCapture(e.pointerId); S.drag = { x: e.clientX, y: e.clientY, t: performance.now() }; S.vy = S.vp = 0; S.touched = performance.now(); };
    const moveTo = (e) => {
      if (!S.drag) return;
      const t = performance.now(), dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y, k = 3.2 / Math.max(240, cv.clientWidth), dt = Math.max(8, t - S.drag.t);
      S.yaw += dx * k; S.pitch = Math.max(-0.7, Math.min(0.7, S.pitch + dy * k));
      S.vy = (dx * k) / dt * 16; S.vp = (dy * k) / dt * 16; S.drag = { x: e.clientX, y: e.clientY, t }; S.touched = t;
    };
    const up = () => { S.drag = null; if (reduced()) S.vy = S.vp = 0; };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', moveTo); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    let lastTap = 0;
    cv.addEventListener('pointerup', () => { const t = performance.now(); if (t - lastTap < 300) { S.yaw = Math.round(S.yaw / (2 * Math.PI)) * 2 * Math.PI; S.pitch = 0; S.vy = S.vp = 0; } lastTap = t; });
    function tiltIn(e) { const t = window.Holo?.tiltOf(e, 35); if (t) { S.tilt = { x: t.tx * 0.35, y: t.ty * 0.25 }; } }
    addEventListener('deviceorientation', tiltIn);

    function size() {
      const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      gl.viewport(0, 0, cv.width, cv.height);
      return w / h;
    }
    function draw(part) {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buf);
      gl.vertexAttribPointer(A[0], 3, gl.FLOAT, false, STRIDE * 4, 0); gl.vertexAttribPointer(A[1], 3, gl.FLOAT, false, STRIDE * 4, 12); gl.vertexAttribPointer(A[2], 2, gl.FLOAT, false, STRIDE * 4, 24);
      gl.uniform1f(U('kind'), part.kind); gl.uniform1f(U('gloss'), part.gloss ?? 0.3); gl.uniform1f(U('alpha'), part.alpha ?? 1); gl.uniform3fv(U('col'), part.col || [1, 1, 1]);
      if (part.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, part.tex); }
      gl.drawArrays(gl.TRIANGLES, 0, part.n);
    }
    function frame(t) {
      if (!alive) return;
      const dt = Math.min(0.05, (t - S.last) / 1000); S.last = t;
      if (!S.drag) {
        S.yaw += S.vy; S.vy *= Math.pow(0.04, dt); // a flick spins, then slows
        S.pitch += S.vp; S.vp *= Math.pow(0.02, dt);
        S.pitch += (0 - S.pitch) * (1 - Math.pow(0.25, dt)) * (Math.abs(S.vp) < 0.002 ? 1 : 0); // and rights itself
        if (!reduced() && t - S.touched > 2500 && Math.abs(S.vy) < 0.002) S.yaw += Math.sin(t / 1600) * 0.0016; // a slow sway
      }
      const yaw = S.yaw + S.tilt.x, pitch = S.pitch + S.tilt.y;
      // the face, at this angle (the holo moves with the card); only while the face can be seen
      const tl = { tx: Math.max(-1, Math.min(1, Math.sin(yaw) * 1.8)), ty: Math.max(-1, Math.min(1, -Math.sin(pitch) * 1.8)), o: 1 };
      if (Math.cos(yaw) * Math.cos(pitch) > -0.05 && (!S.drawn || Math.abs(S.drawn.tx - tl.tx) > 0.006 || Math.abs(S.drawn.ty - tl.ty) > 0.006)) {
        fg.clearRect(0, 0, faceCv.width, faceCv.height); drawFace(fg, tl); S.drawn = tl;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, faceTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, faceCv);
      }
      const asp = size(), dist = Math.max(2.5, 2.05 / Math.max(0.42, asp)); // the card (and its swing) fits with room round it
      gl.uniformMatrix4fv(U('VP'), false, mul(persp(0.62, asp, 0.1, 20), move(0, 0, -dist)));
      gl.uniformMatrix4fv(U('M'), false, mul(rotX(pitch), rotY(yaw)));
      gl.uniform3fv(U('eye'), [0, 0, dist]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND); gl.depthMask(true);
      for (const p of parts) if (!p.see) draw(p); // the card, its label, card stock
      // the clear plastic over them, the far side first (seen from behind, the front sheet is the far one)
      gl.enable(gl.BLEND); gl.depthMask(false);
      const see = parts.filter((p) => p.see), facingFront = Math.cos(yaw) * Math.cos(pitch) >= 0;
      for (const p of facingFront ? see : see.slice().reverse()) draw(p);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  window.Card3D = { get supported() { return gl1 && !!window.Holo?.face; }, open };
})();
