/* Omni Cardworks: the 3D card. A card you can pick up: drag to turn it all the way round (its back, its edge, the
   thickness of the stock, or of the case or slab), flick to spin it, tilt the phone to rock it. The face is the live
   holo (holo.js draws it at the card's angle every frame it moves, the same look as everywhere else), wrapped on a
   real card body in WebGL with a light that glints off it as it turns. No library: one small shader pair.
   Card3D.supported, Card3D.open(card, name). Reduced motion: no drift, no spin. */
(() => {
  const ASPECT = 1008 / 720, W = 1, H = ASPECT;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl1 = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl', { failIfMajorPerformanceCaveat: true }) || c.getContext('experimental-webgl')); } catch { return false; } })();

  // ---------- geometry: a rounded rectangle, extruded: front (the face), back (the card back), the edge all round
  function body(radius, depth, seg = 10) {
    const pts = [], hw = W / 2, hh = H / 2, r = radius;
    const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, Math.PI / 2], [-hw + r, -hh + r, Math.PI], [hw - r, -hh + r, Math.PI * 1.5]];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * (i / seg); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    const v = [], e = []; // x y z  nx ny nz  u v  part (0 face, 1 back, 2 edge): faces in v, the edge in e (drawn after)
    const z = depth / 2, uv = (x, y) => [x / W + 0.5, 0.5 - y / H];
    const tri = (a, b, c, n, part, flipU = false) => { for (const p of [a, b, c]) { const [u, w] = uv(p[0], p[1]); (part === 2 ? e : v).push(p[0], p[1], p[2], ...n, flipU ? 1 - u : u, w, part); } };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      tri([0, 0, z], [a[0], a[1], z], [b[0], b[1], z], [0, 0, 1], 0); // the face (counter-clockwise from the front)
      tri([0, 0, -z], [b[0], b[1], -z], [a[0], a[1], -z], [0, 0, -1], 1, true); // the back (mirrored so it reads right)
      const nx = (a[1] - b[1]), ny = (b[0] - a[0]), l = Math.hypot(nx, ny) || 1, n = [nx / l, ny / l, 0];
      tri([a[0], a[1], z], [a[0], a[1], -z], [b[0], b[1], -z], n, 2);
      tri([a[0], a[1], z], [b[0], b[1], -z], [b[0], b[1], z], n, 2);
    }
    return { data: new Float32Array([...v, ...e]), faces: v.length / 9, edges: e.length / 9 };
  }

  // ---------- shaders: the face and back from their pictures, the edge a solid colour; a soft light, a moving glint,
  // and for a case or slab a clear-plastic rim
  const VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t; attribute float part;
    uniform mat4 M, VP; varying vec3 vn; varying vec3 vp; varying vec2 vt; varying float vpart;
    void main(){ vec4 w = M * vec4(p, 1.0); vp = w.xyz; vn = mat3(M) * n; vt = t; vpart = part; gl_Position = VP * w; }`;
  const FS = `precision mediump float; varying vec3 vn; varying vec3 vp; varying vec2 vt; varying float vpart;
    uniform sampler2D face, back; uniform vec3 edge, eye; uniform float gloss, plastic, edgeAlpha;
    void main(){
      vec4 c = vpart < 0.5 ? texture2D(face, vt) : vpart < 1.5 ? texture2D(back, vt) : vec4(edge, 1.0);
      if (c.a < 0.35) discard;
      vec3 N = normalize(vn), V = normalize(eye - vp), L = normalize(vec3(-0.45, 0.6, 0.9));
      float dif = 0.72 + 0.28 * max(dot(N, L), 0.0);
      bool side = vpart > 1.5;
      float spec = pow(max(dot(N, normalize(L + V)), 0.0), side ? (plastic > 0.0 ? 90.0 : 18.0) : 70.0) * (side ? (plastic > 0.0 ? 1.1 : 0.35) : gloss);
      float rim = plastic * pow(1.0 - max(dot(N, V), 0.0), 5.0) * 0.18; // a thin bright line at the plastic's edge, no haze
      gl_FragColor = vec4(c.rgb * dif + vec3(spec) + vec3(rim), side ? max(edgeAlpha, spec) : 1.0);
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

  // what each holder looks like from the side: card stock, a case, a slab (thickness and edge colour, in card widths)
  const HOLDER = { raw: { r: 46.5 / 750, d: 0.012, edge: [0.93, 0.9, 0.84], gloss: 0.32, plastic: 0 },
    case: { r: 58 / 1500, d: 0.032, edge: [0.62, 0.7, 0.76], gloss: 0.5, plastic: 1, alpha: 0.28 },
    slab: { r: 50 / 1500, d: 0.06, edge: [0.6, 0.68, 0.74], gloss: 0.55, plastic: 1, alpha: 0.32 } }; // a real slab: ~6.5 mm of clear plastic

  // the back: the card back; in a case or slab, the card back sits inside the clear plastic where the card is (the same
  // place holo.js draws the card on the front: CASE / SLAB there)
  const CARD_IN = { case: { s: 0.958, top: 44 }, slab: { s: 0.868, top: 244 } };
  function backOf(holder, img) {
    const at = CARD_IN[holder];
    if (!at || !img) return img;
    const c = document.createElement('canvas'); c.width = 720; c.height = 1008;
    const g = c.getContext('2d'), k = 720 / 1500, w = 1500 * at.s * k, h = 2100 * at.s * k, x = (720 - w) / 2, y = at.top * k;
    const pl = g.createLinearGradient(0, 0, 720, 1008); pl.addColorStop(0, '#e8edf1'); pl.addColorStop(0.5, '#c9d0d6'); pl.addColorStop(1, '#e2e7eb');
    g.fillStyle = pl; g.beginPath(); g.roundRect(3, 3, 714, 1002, holder === 'slab' ? 24 : 28); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(16, 16, 688, holder === 'slab' ? y - 30 : 6); // the back of the label
    g.save(); g.beginPath(); g.roundRect(x, y, w, h, 22); g.clip(); g.drawImage(img, x, y, w, h); g.restore();
    return c;
  }

  async function open(c, name = '') {
    const F = await window.Holo?.face(c).catch(() => null);
    if (!F) { window.toast?.('This card can’t be shown in 3D.', 'bad'); return; }
    const look = HOLDER[F.holder] || HOLDER.raw;
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
    const geo = body(look.r, look.d), buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.STATIC_DRAW);
    const attr = (nm, size, off) => { const l = gl.getAttribLocation(prog, nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 9 * 4, off * 4); };
    attr('p', 3, 0); attr('n', 3, 3); attr('t', 2, 6); attr('part', 1, 8);
    const U = (nm) => gl.getUniformLocation(prog, nm);
    gl.uniform3fv(U('edge'), look.edge); gl.uniform1f(U('gloss'), look.gloss); gl.uniform1f(U('plastic'), look.plastic); gl.uniform1f(U('edgeAlpha'), look.alpha ?? 1);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(U('face'), 0); gl.uniform1i(U('back'), 1);
    gl.enable(gl.DEPTH_TEST);

    // the face: holo.js draws into this canvas at the card's angle; uploaded only when it changes
    const faceCv = document.createElement('canvas'); faceCv.width = 720; faceCv.height = 1008;
    const fg = faceCv.getContext('2d');
    gl.activeTexture(gl.TEXTURE0); const faceTex = texture(gl, null);
    gl.activeTexture(gl.TEXTURE1); texture(gl, backOf(F.holder, await loadImg('ui/card-back.webp').catch(() => null)));

    // the angle: drag, a flick's spin, the phone's tilt, and (untouched) a slow drift
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
        fg.clearRect(0, 0, 720, 1008); F.draw(fg, tl); S.drawn = tl;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, faceTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, faceCv);
      }
      const asp = size(), dist = Math.max(2.5, 2.05 / Math.max(0.42, asp)); // the card (and its swing) fits with room round it
      const VP = mul(persp(0.62, asp, 0.1, 20), move(0, 0, -dist));
      gl.uniformMatrix4fv(U('VP'), false, VP);
      gl.uniformMatrix4fv(U('M'), false, mul(rotX(pitch), rotY(yaw)));
      gl.uniform3fv(U('eye'), [0, 0, dist]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.drawArrays(gl.TRIANGLES, 0, geo.faces); // the face and back
      if (look.alpha) { gl.enable(gl.BLEND); gl.depthMask(false); } // a case's or slab's clear edge, over them
      gl.drawArrays(gl.TRIANGLES, geo.faces, geo.edges);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  window.Card3D = { get supported() { return gl1 && !!window.Holo?.face; }, open };
})();
