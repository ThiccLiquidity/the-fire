(async () => {
const SW = 3840, SH = 2160, A = 'a/';
const G = await (await fetch(A + 'scene.json')).json();
const load = (n) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = A + n + '.webp'; });
const names = ['plate', 'belt', 'chain-up', 'chain-lo', 'front-stand', 'roll-0', 'roll-1', 'pack', 's-flywheel', 's-gear-big-a', 's-gear-big-b',
  's-gear-small', 'belt-light', 'p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 's-rod', 's-conrod', 's-capsule', 's-padlock', 's-token', 's-log0', 's-log1', 's-log2', 's-paper0', 's-paper1', 's-paper2', 'card'];
const img = {}; (await Promise.all(names.map(load))).forEach((im, k) => img[names[k]] = im);

// ---------- small canvas helpers (all effects are made in code from the source art)
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const CAN_FILTER = (() => { try { const g = mk(2, 2).getContext('2d'); g.filter = 'blur(1px)'; return g.filter === 'blur(1px)'; } catch (e) { return false; } })();
function silhouette(im, blur, color = '#000') { // a soft, blurred silhouette of a sprite (for shadows and glows)
  const pad = blur * 2 + 2, c = mk(im.width + pad * 2, im.height + pad * 2), g = c.getContext('2d');
  if (CAN_FILTER) { g.filter = `blur(${blur}px)`; g.drawImage(im, pad, pad); g.filter = 'none'; }
  else { const n = 12; g.globalAlpha = 1.6 / n; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; g.drawImage(im, pad + Math.cos(a) * blur * 0.7, pad + Math.sin(a) * blur * 0.7); } g.globalAlpha = 1; }
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  c.pad = pad; return c;
}
function tinted(im, color, w = im.width, h = im.height) { // multiply a sprite by a colour, keeping its own alpha
  const c = mk(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, w, h); g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(im, 0, 0, w, h); return c;
}
function prescale(im, w, h) { // high-quality downscale in halving steps (sharp, no aliasing)
  let src = im, sw = im.width, sh = im.height;
  while (sw / 2 >= w * 1.05 && sh / 2 >= h * 1.05) { const n = mk(sw / 2, sh / 2), g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, n.width, n.height); src = n; sw = n.width; sh = n.height; }
  const c = mk(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height); return c;
}
function glowSprite(stops, S = 256) { // a radial glow made once; per frame only its opacity changes
  const c = mk(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, S, S); return c;
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the view (declared before fit() runs)
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let dpr = 1, scale = 1, ox = 0, oy = 0;
let plateCache = null, plateHi = null, packSpr = null, rollBuf = [];
let view = { x: 0, y: 0, w: innerWidth, h: innerHeight, mode: 'contain', focus: 0.5, follow: false }; // CSS px box the scene draws into
// the follow camera (cover mode with follow:true, i.e. phones held upright): pans and gently zooms onto the action
const ZMAX = 1.6, CAM_HOLD = 2.5, CAM_MANUAL = 6;
const cam = { x: 0, y: 0, lz: 0, vx: 0, vy: 0, vz: 0, gx: 0, gy: 0, gz: 0, fvx: 0, fvy: 0, key: '', since: 0, last: null, lastAt: -99, manualUntil: -1, homeAfter: -1, homeX: 0, homeY: 0, on: false };
const vb = { bx: 0, by: 0, bw: 1, bh: 1 }; // the view box, device px
let curS = 1, curOX = 0, curOY = 0; // this frame's scene -> device transform (camera included)
function fit() {
  dpr = Math.min(innerWidth < 900 ? 1.5 : 2, devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  const bx = view.x * dpr, by = view.y * dpr, bw = view.w * dpr, bh = view.h * dpr;
  scale = view.mode === 'cover' ? Math.max(bw / SW, bh / SH) : Math.min(bw / SW, bh / SH);
  ox = bx + (bw - SW * scale) * (view.mode === 'cover' ? view.focus : 0.5); oy = by + (bh - SH * scale) / 2;
  Object.assign(vb, { bx, by, bw, bh });
  cam.homeX = (bx + bw / 2 - ox) / scale; cam.homeY = (by + bh / 2 - oy) / scale;
  if (!cam.on) { Object.assign(cam, { x: cam.homeX, y: cam.homeY, lz: 0, vx: 0, vy: 0, vz: 0, gx: cam.homeX, gy: cam.homeY, gz: 0, fvx: 0, fvy: 0 }); }
  curS = scale; curOX = ox; curOY = oy;
  plateCache = null; plateHi = null; packSpr = null; rollBuf = [];
}
addEventListener('resize', fit); fit();

// reduced motion: no shake, no flash, fewer particles, a slower machine
const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
let RM = RMQ.matches; RMQ.addEventListener?.('change', (e) => { RM = e.matches; });
const PN = () => (RM ? 0.4 : 1); // particle count factor

// ---------- the flame: the site's WebGL fire, one shared context, half resolution
const FRAG = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform float uT, uS, uF;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){ const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
 vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx); vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
 vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);
 vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
 vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
 vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-.5; vec3 ox=floor(x+.5); vec3 a0=x-ox;
 m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
 vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw; return 130.*dot(m,g); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
void main(){
  float s=uS, s3=s*s*s, t=uT;
  vec2 p=vec2(vUv.x-0.5, vUv.y-0.04)*vec2(1.0,1.15);
  float H=0.2+0.28*s+0.75*s3, W=0.14+0.17*s+0.05*s3;
  vec2 q=vec2(p.x/W, p.y/H);
  vec2 wq=vec2(p.x*6.5, p.y*4.2);
  float n=fbm(vec2(wq.x*0.5, wq.y*0.45-t*1.25));
  float n2=fbm(vec2(wq.x*0.95+n*0.8, wq.y*0.95-t*2.1+n*0.6));
  float qx=q.x+(0.2+0.45*s*s)*n*max(q.y,0.);
  float taper=1.7-0.9*s3;
  float env=clamp(1.0-qx*qx*(0.85+max(q.y,0.)*taper),0.,1.)*clamp(1.0-q.y*(0.8-0.15*s3),0.,1.)*smoothstep(-0.3,0.05,q.y);
  float I=env*(1.2+(0.8+0.3*s3)*n2)-0.14*max(q.y,0.);
  I=clamp(I,0.,1.); I=pow(I,1.3)*uF;
  vec3 c=mix(vec3(.5,.08,.02), vec3(1.,.42,.08), smoothstep(.08,.38,I));
  c=mix(c, vec3(1.,.78,.32), smoothstep(.34,.62,I)); c=mix(c, vec3(1.,.97,.86), smoothstep(.62,.92,I));
  float a=smoothstep(0.05,0.45,I)*smoothstep(-0.07,-0.015,p.y);
  o=vec4(c*a,a);
}`;
const FL_FIRE = [0, 0, 210, 180], FL_ASH = [212, 0, 150, 130]; // regions of the shared canvas (half of the old 420x360 / 300x260)
const flameGL = (() => {
  const c = mk(362, 180);
  const gl = c.getContext('webgl2', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 a; out vec2 vUv; void main(){ vUv=a*0.5+0.5; gl_Position=vec4(a,0.,1.); }`));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(pr, 'uT'), uS = gl.getUniformLocation(pr, 'uS'), uF = gl.getUniformLocation(pr, 'uF');
  gl.enable(gl.SCISSOR_TEST);
  return { c, draw([x, y, w, h], t, s, f) { const gy = c.height - y - h; // GL's origin is bottom-left
    gl.viewport(x, gy, w, h); gl.scissor(x, gy, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, t); gl.uniform1f(uS, s); gl.uniform1f(uF, f); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } };
})();
const FB_X = 380, FB_Y = 560, fireBuf = mk(500, 500); // the furnace's flames, scene px

// ---------- places (scene pixels, measured on the master)
const FIREBOX = { x0: 402, x1: 852, cx: 627, archY: 800, archRy: 84, base: 1046, flameX: 630, flameY: 1004 };
const ASHBIN = [[70, 1100], [497, 1092], [425, 1277], [95, 1238]]; // inside the bin, down to the front rim
const DIAL_HOOD = [695, 455, 41], DIAL_ASH = [393, 1355, 36];
const BOARD = { x: 2660, y: 452, w: 166, h: 179 };
const TUBE = [[3560, 860], [3590, 629], [3590, 432], [3623, 239], [3650, -60]];
const WINDOWS = [[3590, 629, 31], [3590, 432, 31], [3623, 239, 31]];
const PACK_FROM = 2296, PACK_TO = 3412, PACK_Y = 1003;
const LANTERNS = [[235, 465], [40, 790], [3412, 300]];
const PADLOCK = [1290, 1528];
const TOPROLL = { cx: 2268, cy: 147, R: 59, nip: 206 }; // the small top roll of the press; PAPER is drawn into its nip
const BELT_SKEW = 0.2; // the slats' lean: the belt's top surface in perspective
const CHUTE_A = -1.13; // logs lie along the chute (its slope), butt end down toward us

// ---------- made-once sprites
const G_ROOM = glowSprite([[0, 'rgba(255,120,40,1)'], [30 / 820, 'rgba(255,120,40,1)'], [1, 'rgba(255,90,20,0)']]);
const G_LANT = glowSprite([[0, 'rgba(255,190,110,1)'], [2 / 170, 'rgba(255,190,110,1)'], [1, 'rgba(255,190,110,0)']], 128);
const G_LANT_IN = glowSprite([[0, 'rgba(255,215,150,1)'], [1 / 34, 'rgba(255,215,150,1)'], [1, 'rgba(255,200,120,0)']], 64);
const G_FLARE_IN = glowSprite([[0, 'rgba(255,170,70,1)'], [20 / 300, 'rgba(255,170,70,1)'], [1, 'rgba(255,110,30,0)']], 128);
const G_FLARE_ROOM = glowSprite([[0, 'rgba(255,130,50,1)'], [60 / 760, 'rgba(255,130,50,1)'], [1, 'rgba(255,90,20,0)']]);
const G_STAMP = glowSprite([[0, 'rgba(255,170,80,1)'], [10 / 230, 'rgba(255,170,80,1)'], [1, 'rgba(255,140,60,0)']], 128);
const G_FLASH = glowSprite([[0, 'rgba(255,150,60,1)'], [50 / 2600, 'rgba(255,150,60,1)'], [1, 'rgba(255,100,30,0)']]);
const G_WIN = glowSprite([[0, 'rgba(255,190,110,1)'], [0.5, 'rgba(255,150,70,.5)'], [1, 'rgba(255,120,40,0)']], 64);
const G_HOT = glowSprite([[0, 'rgba(255,200,120,1)'], [0.4, 'rgba(255,130,40,.55)'], [1, 'rgba(255,80,20,0)']], 64);
const VIGNETTE = (() => { // the scene's own edges melt into the black page
  const W = 480, H = 270, c = mk(W, H), g = c.getContext('2d'), d = g.createImageData(W, H), F = 150 / 8; // 150 scene px feather
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ex = Math.min(x + 0.5, W - x - 0.5), ey = Math.min(y + 0.5, H - y - 0.5);
    const e = smooth(0, F, ex) * smooth(0, F * 0.8, ey);
    const nx = (x / W - 0.5) * 2, ny = (y / H - 0.5) * 2, rr = Math.sqrt(nx * nx * 0.8 + ny * ny * 0.9);
    const a = 1 - e * (1 - 0.22 * smooth(0.75, 1.3, rr));
    d.data[(y * W + x) * 4 + 3] = Math.round(255 * a);
  }
  g.putImageData(d, 0, 0); return c;
})();
// rod: the rod sprite, thickened, warmed to the painting's steel/brass, lit on top and shaded under
const ROD = (() => { const r = img['s-rod']; if (!r) return null;
  const T = Math.round(r.height * 1.55), c = mk(r.width, T), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(r, 0, 0, r.width, T);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(236,196,150)'; g.fillRect(0, 0, c.width, T); // warm steel, like the pipes
  g.globalCompositeOperation = 'destination-in'; g.drawImage(r, 0, 0, r.width, T);
  g.globalCompositeOperation = 'source-atop';
  let gr = g.createLinearGradient(0, 0, 0, T);
  gr.addColorStop(0, 'rgba(255,214,160,0)'); gr.addColorStop(0.22, 'rgba(255,226,180,.55)'); gr.addColorStop(0.36, 'rgba(255,214,160,.08)');
  gr.addColorStop(0.55, 'rgba(30,14,6,.1)'); gr.addColorStop(0.85, 'rgba(22,10,4,.62)'); gr.addColorStop(1, 'rgba(10,4,2,.8)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, T);
  gr = g.createLinearGradient(0, 0, 0, T); gr.addColorStop(0.6, 'rgba(255,140,60,0)'); gr.addColorStop(0.8, 'rgba(255,130,50,.18)'); gr.addColorStop(0.95, 'rgba(255,140,60,0)'); // a little fire bounce on the underside
  g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(0, 0, c.width, T);
  c.shadow = silhouette(c, 5, 'rgba(0,0,0,1)'); return c; })();
// logs: darkened toward the chute's own tone, with a soft shadow each
const LOGS = [0, 1, 2].map((k) => { const im = img['s-log' + k]; const c = tinted(im, 'rgb(128,104,88)'); c.shadow = silhouette(im, 7); return c; });
// the burned card: the Paper frame, its window filled with the frame's own paper tone so it reads as a solid card
const CARD = (() => { const im = img.card; if (!im) return null; const S = 2, c = mk(im.width * S, im.height * S), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const gr = g.createLinearGradient(0, 16 * S, 0, 90 * S); gr.addColorStop(0, 'rgb(226,219,210)'); gr.addColorStop(1, 'rgb(212,204,194)');
  g.fillStyle = gr; g.fillRect(6 * S, 14 * S, (im.width - 12) * S, 78 * S);
  g.drawImage(im, 0, 0, c.width, c.height);
  const hot = tinted(c, 'rgb(255,150,70)'); const hg = hot.getContext('2d'); hg.globalCompositeOperation = 'source-atop';
  const r = hg.createRadialGradient(c.width / 2, c.height / 2, 10, c.width / 2, c.height / 2, c.height * 0.6); r.addColorStop(0, 'rgba(60,20,8,.55)'); r.addColorStop(0.6, 'rgba(255,120,30,0)'); r.addColorStop(1, 'rgba(255,200,90,.6)');
  hg.fillStyle = r; hg.fillRect(0, 0, c.width, c.height); // charring in the middle, bright burning edges
  c.hot = hot; c.glow = silhouette(c, 10, 'rgb(255,120,40)'); return c; })();
// PAPER sheets: the sheet sprites squared up (an affine from three of their corners) and washed toward the roll's cream
const SHEET_Q = [[[1, 44], [61, 1], [66, 62]], [[1, 20], [80, 1], [33, 62]], [[2, 18], [59, 1], [60, 62]]]; // corner, next corner, other neighbour
const papers = [0, 1, 2].map((k) => { const im = img['s-paper' + k], [[ax, ay], [bx, by], [cx2, cy2]] = SHEET_Q[k], W = 240, H = 128;
  const c = mk(W, H), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  const ux = bx - ax, uy = by - ay, vx = cx2 - ax, vy = cy2 - ay, det = ux * vy - uy * vx; // map u -> (W,0), v -> (0,H)
  const a = W * vy / det, b = -H * uy / det, cc = -W * vx / det, d = H * ux / det;
  g.setTransform(a, b, cc, d, -(a * ax + cc * ay), -(b * ax + d * ay)); g.drawImage(im, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(244,232,214,.55)'; g.fillRect(0, 0, W, H);
  return tinted(c, 'rgb(255,228,198)'); }); // the same warm cream as the press's roll
// the belt's light as a shade: belt-light is grey (r = g = b), so multiplying by it is exactly black laid on at alpha 1 - light.
// Made once here so the belt needs no 'multiply' per frame: if a phone drops that blend, the bare slats (near white) show.
const BELT_SHADE = (() => { const L = img['belt-light']; if (!L) return null; const c = mk(L.width, L.height), g = c.getContext('2d'); g.drawImage(L, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data; for (let i = 0; i < p.length; i += 4) { p[i + 3] = 255 - p[i]; p[i] = p[i + 1] = p[i + 2] = 0; }
  g.putImageData(d, 0, 0); return c; })();
// the paper sheet's buffer (shaded to the roll as it wraps into the nip)
const paperBuf = mk(200, 150);
// steam: soft, wispy, noise-textured puffs made at load
const PUFFS = (() => {
  const S = 128, out = { warm: [], cool: [] };
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y, s) => { let a = 0.5, t = 0; for (let o = 0; o < 5; o++) { t += a * vn(x, y, s + o * 17); x = x * 2.02 + 3.1; y = y * 2.02 + 1.7; a *= 0.5; } return t / 0.97; };
  for (let k = 0; k < 4; k++) {
    const d = new ImageData(S, S), e = new ImageData(S, S), seed = 11 + k * 101;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = x / S * 2 - 1, ny = y / S * 2 - 1;
      const wx = fbm(nx * 2 + 5, ny * 2, seed) - 0.5, wy = fbm(nx * 2, ny * 2 + 9, seed + 7) - 0.5; // domain warp: wisps
      const n = fbm((nx + wx * 0.7) * 2.6 + 20, (ny + wy * 0.7) * 2.6, seed + 3);
      const r = Math.sqrt(nx * nx + ny * ny) * 1.2 + (n - 0.5) * 0.8;
      const fall = Math.max(0, 1 - r); const a = Math.min(1, Math.pow(smooth(0, 1, fall), 1.3) * (0.2 + 0.8 * smooth(0.3, 0.74, n)) * 1.25);
      const i = (y * S + x) * 4, A = Math.round(255 * a);
      d.data[i] = 236; d.data[i + 1] = 233; d.data[i + 2] = 228; d.data[i + 3] = A; // cool
      e.data[i] = 255; e.data[i + 1] = 224; e.data[i + 2] = 194; e.data[i + 3] = A; // warm, by the furnace
    }
    const c1 = mk(S, S), c2 = mk(S, S); c1.getContext('2d').putImageData(d, 0, 0); c2.getContext('2d').putImageData(e, 0, 0);
    out.cool.push(c1); out.warm.push(c2);
  }
  return out;
})();

// ---------- state
let left = 167, total = 167, queue = 0, ready = [], burnCount = 12, windowFrac = 17 / 24, seriesNo = 7;
const listeners = {};
const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d));
let speed = 0.15, target = 0.15;
let beltSp = 0.32, wheelA = +(new URLSearchParams(location.search).get("wheel") || 0), beltX = 0, chainX = 0, rollS = 0, ft = 0, at = 0, flare = 0, stamp = 0, bank = 0;
const items = [], packs = [], caps = [], tokens = [], jobs = []; // a job: one bought pack, followed from logs to capsule (for the camera)
let jobId = 0;
let nextPackAt = 0, now = 0, lockFall = left > 0 ? -1 : 1;
function buy(n) {
  n = Math.min(n, left - queue); if (n <= 0) return;
  for (let k = 0; k < n; k++) {
    const t0 = now + k * 0.6;
    items.push({ kind: 'log', t0, img: LOGS[k % 3], dx: -90 + Math.random() * 120, rot: (Math.random() - .5) * .6 });
    items.push({ kind: 'log', t0: t0 + 0.18, img: LOGS[(k + 1) % 3], dx: -10 + Math.random() * 120, rot: (Math.random() - .5) * .6 });
    items.push({ kind: 'paper', t0: t0 + 0.05, img: papers[k % 3], dx: -60 + Math.random() * 120, rot: (Math.random() - .5) * .5, spin: (Math.random() - .5) * 1.2, ph: Math.random() * 6 });
  }
  queue += n;
  for (let k = 0; k < n; k++) { ready.push(now + k * 0.6 + 1.8); jobs.push({ id: ++jobId, t0: now + k * 0.6, born: now, pack: null, cap: null, done: -1 }); } // a pack once its logs are in
}
const cardsIn = []; let ashFlare = 0;
function burn() { cardsIn.push({ t0: now, rot: Math.random() * 0.4 - 0.2, landed: false, acc: 0 }); }
function cardLanded(x, y) { ashFlare = 1.6; sparkBurst(x, y, Math.round(18 * PN()), 0.7); emit('cardBurned'); }
function popToken() { tokens.push({ t0: now }); }
const CARD_FLY = 1.25, CARD_BURN = 0.75;
const cardPath = (u) => { // a high arc from the open bench up over the furnace and down into the ash bin
  const P = [[1250, 1450], [1300, 200], [200, 250], [300, 1188]], v = 1 - u;
  const b = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
  return [b[0] * P[0][0] + b[1] * P[1][0] + b[2] * P[2][0] + b[3] * P[3][0], b[0] * P[0][1] + b[1] * P[1][1] + b[2] * P[2][1] + b[3] * P[3][1]];
};
function drawCards(dt) {
  if (!CARD) return;
  for (let i = cardsIn.length - 1; i >= 0; i--) {
    const c = cardsIn[i], t = now - c.t0;
    if (t >= CARD_FLY + CARD_BURN) { cardsIn.splice(i, 1); continue; }
    let x, y, sc, sx, sy, rot, heat, alpha = 1, sink = 0;
    if (t < CARD_FLY) {
      const u = t / CARD_FLY;
      [x, y] = cardPath(u); sc = 1.15 - 0.2 * u;
      const land = smooth(0.84, 1, u);
      sx = Math.cos(Math.PI * 2 * smooth(0.04, 0.8, u)); // one flip, both faces the card
      sy = 1 - 0.55 * land; rot = c.rot + 1.1 * Math.sin(Math.PI * u) * (1 - land);
      heat = 0.12 + 0.5 * smooth(0.3, 1, u);
      c.acc += dt * 55 * PN(); // the ember trail
      const [px, py] = cardPath(Math.max(0, u - 0.02));
      while (c.acc > 1) { c.acc--; embers.push({ x: x + (px - x) * 0.8 + rnd(-14, 14), y: y + (py - y) * 0.8 + rnd(-14, 14), vx: (px - x) * 3 + rnd(-30, 30), vy: (py - y) * 3 + rnd(-40, 10), life: 0, max: rnd(0.45, 0.95), ph: rnd(0, 6), s: rnd(1.4, 2.8) }); }
    } else {
      if (!c.landed) { c.landed = true; cardLanded(300, 1200); }
      const b = (t - CARD_FLY) / CARD_BURN; [x, y] = cardPath(1); sc = 0.95; sx = 1; sy = 0.45; rot = c.rot;
      heat = 0.62 + 0.38 * smooth(0, 0.4, b); sink = 46 * b * b; alpha = 1 - smooth(0.35, 1, b);
      if (Math.random() < dt * 14 * PN()) embers.push({ x: x + rnd(-40, 40), y: y + rnd(-8, 8), vx: rnd(-15, 15), vy: rnd(-120, -60), life: 0, max: rnd(0.8, 1.6), ph: rnd(0, 6), s: rnd(1.6, 3) });
    }
    ctx.save();
    if (t >= CARD_FLY * 0.9) { const [a, b2, c2, d] = ASHBIN; ctx.beginPath(); ctx.moveTo(a[0], 0); ctx.lineTo(b2[0] + 40, 0); ctx.lineTo(b2[0], 1196); ctx.lineTo(c2[0], 1205); ctx.lineTo(d[0], 1205); ctx.lineTo(a[0], 1196); ctx.closePath(); ctx.clip(); } // sinks into the coals
    ctx.translate(x, y + sink); ctx.rotate(rot); const fx = Math.abs(sx) < 0.04 ? (sx < 0 ? -0.04 : 0.04) : sx; ctx.scale(sc * 0.5 * fx, sc * 0.5 * sy);
    const W = CARD.width, H = CARD.height;
    ctx.globalAlpha = alpha * 0.55 * heat; ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(CARD.glow, -W / 2 - CARD.glow.pad, -H / 2 - CARD.glow.pad);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha;
    ctx.drawImage(CARD, -W / 2, -H / 2);
    ctx.globalAlpha = alpha * heat; ctx.drawImage(CARD.hot, -W / 2, -H / 2);
    ctx.restore();
  }
}
// ---------- helpers
function spin(im, cx, cy, a) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.drawImage(im, -im.width / 2, -im.height / 2); ctx.restore(); }
const board = { key: '', c: mk(332, 358) }; // twice the board's size, for crisp chalk
function chalkGrain(g, W, H, seed, n) { // the grain: chalk skips over the board's texture
  g.globalCompositeOperation = 'destination-out';
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.6})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.2, 1 + rnd() * 1.4); }
  g.globalCompositeOperation = 'source-over';
}
function drawBoard(lines) { // chalk: off-white strokes, grainy where the chalk skipped, a faint dusty smudge
  const c = board.c, g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H); g.textAlign = 'center'; g.textBaseline = 'middle';
  const write = (blur, alpha) => { g.save(); g.filter = blur ? `blur(${blur}px)` : 'none';
    for (const [t, size, y, k = 1] of lines) { g.fillStyle = `rgba(238,236,226,${alpha * k})`; let s = size * 2; g.font = `700 ${s}px Kalam, cursive`; while (g.measureText(t).width > W - 56 && s > 12) { s -= 2; g.font = `700 ${s}px Kalam, cursive`; } // 14px clear of the frame
      g.fillText(t, W / 2, y * 2); } g.restore(); };
  write(7, 0.18); write(0, 0.95);
  chalkGrain(g, W, H, 11, 9000);
}
const SOLD = (() => { // the SOLD OUT stamp, in red chalk, at twice the board's size
  const W = 332, H = 358, c = mk(W, H), g = c.getContext('2d');
  g.translate(W / 2, H / 2 + 8); g.rotate(-0.24);
  const col = (a) => `rgba(236,128,104,${a})`;
  g.strokeStyle = col(0.9); g.lineWidth = 7; g.lineJoin = 'round';
  const bw = 258, bh = 104; g.strokeRect(-bw / 2, -bh / 2, bw, bh); g.lineWidth = 3; g.strokeRect(-bw / 2 + 11, -bh / 2 + 11, bw - 22, bh - 22);
  g.fillStyle = col(0.95); g.textAlign = 'center'; g.textBaseline = 'middle';
  let s = 66; g.font = `700 ${s}px "Cabin Sketch", Kalam, cursive`; while (g.measureText('SOLD OUT').width > bw - 40 && s > 20) { s -= 2; g.font = `700 ${s}px "Cabin Sketch", Kalam, cursive`; }
  g.fillText('SOLD OUT', 0, 3);
  g.setTransform(1, 0, 0, 1, 0, 0); chalkGrain(g, W, H, 29, 7000);
  return c;
})();
function chalk(text, x, y, size, w, alpha = 0.88) {
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let s = size; ctx.font = `700 ${s}px "Cabin Sketch", cursive`;
  while (ctx.measureText(text).width > w && s > 8) { s -= 1; ctx.font = `700 ${s}px "Cabin Sketch", cursive`; }
  ctx.fillStyle = `rgba(240,236,224,${alpha})`; ctx.shadowColor = 'rgba(255,255,255,.25)'; ctx.shadowBlur = 3;
  ctx.fillText(text, x, y); ctx.restore();
}
function dialText(text, x, y, size, color = '#3b2412') {
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${size}px "Russo One", sans-serif`;
  ctx.fillStyle = 'rgba(255,236,190,.5)'; ctx.fillText(text, x + 1, y + 1.5); ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
}
const along = (pts, u) => { // u 0..1 along a polyline -> [x, y, angle]
  const seg = []; let tot = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); tot += l; }
  let d = u * tot;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], f = Math.min(1, d / seg[i]);
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.atan2(y1 - y0, x1 - x0)]; }
    d -= seg[i];
  }
};
const glow = (spr, x, y, r, a) => { if (a <= 0.002) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(spr, x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; };

// ---------- drawing pieces
function drawRolls() { // the print on the rollers turns: built row by row (one row per device pixel) off-screen, laid on as one multiply layer
  G.rolls.forEach((r, i) => {
    let b = rollBuf[i];
    const rs = view.follow ? scale * ZMAX : scale, rows = Math.ceil(r.h * rs), cols = Math.ceil(r.w * rs); // sharp when the camera zooms in
    if (!b) { b = rollBuf[i] = { c: mk(cols, rows), s: NaN }; }
    if (b.s !== rollS) {
      const im = img['roll-' + i], P = r.period, g = b.c.getContext('2d'); g.clearRect(0, 0, cols, rows);
      for (let k = 0; k < rows; k++) {
        const y = (k + 0.5) * r.h / rows;
        const s = r.r * Math.asin(Math.max(-0.999, Math.min(0.999, (y - r.r) / r.r)));
        const ty = ((s + r.r * Math.PI / 2 - rollS) % P + P) % P; // texture row
        g.drawImage(im, 0, Math.floor(ty), r.w, 1, 0, k, cols, 1);
      }
      b.s = rollS;
    }
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(b.c, r.x, r.y, r.w, r.h); ctx.restore();
  });
}
function beltClip() { const b = G.belt; ctx.beginPath(); ctx.moveTo(b.x, 900); ctx.lineTo(3430, 900); ctx.lineTo(3430, b.y); ctx.quadraticCurveTo(3446, 1000, 3446, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.closePath(); ctx.clip(); }
function drawBelt(dt) { // one exact slat tiled (seamless), shifted along; the room's light laid on top, fixed; the packs ride on it
  const b = G.belt, P = b.period, off = beltX % P;
  ctx.save(); beltClip(); // ends at the drum's curved rim
  for (let x = b.x + off - P; x < b.x + b.w; x += P) ctx.drawImage(img.belt, x, b.y);
  if (BELT_SHADE) ctx.drawImage(BELT_SHADE, b.x, b.y); // the room's light (plain source-over: no blend mode at draw time)
  drawPacks(dt);
  const dk = ctx.createLinearGradient(3392, 0, 3446, 0); dk.addColorStop(0, 'rgba(0,0,0,0)'); dk.addColorStop(1, 'rgba(0,0,0,.75)'); // into the drum's shadow (packs too)
  ctx.fillStyle = dk; ctx.fillRect(3392, 900, 60, b.y + b.h - 900);
  ctx.restore();
}
function drawChainStill() { for (const k of ['up', 'lo']) ctx.drawImage(img['chain-' + k], G.chain[k].pos[0], G.chain[k].pos[1]); }
function drawChain() { // each strand slides along itself (the loop: top goes one way, bottom the other)
  for (const [k, dir] of [['up', 1], ['lo', -1]]) {
    const c = G.chain[k], im = img['chain-' + k], [ax, ay] = c.a, [bx, by] = c.b;
    const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, vx = -uy, vy = ux;
    const off = ((chainX * dir) % c.period + c.period) % c.period;
    ctx.save(); ctx.beginPath();
    ctx.moveTo(ax - vx * 10, ay - vy * 10); ctx.lineTo(bx - vx * 10, by - vy * 10); ctx.lineTo(bx + vx * 10, by + vy * 10); ctx.lineTo(ax + vx * 10, ay + vy * 10); ctx.closePath(); ctx.clip();
    ctx.drawImage(im, c.pos[0] + ux * off, c.pos[1] + uy * off);
    ctx.drawImage(im, c.pos[0] + ux * (off - c.period), c.pos[1] + uy * (off - c.period));
    ctx.restore();
  }
}
function drawEngine() {
  const F = G.fly, ga = wheelA * 1.35;
  G.pulleys.forEach(([cx, cy, r], i) => spin(img['p-' + i], cx, cy, beltX / r)); // the painted wheels themselves, turning
  G.gears.forEach((g, i) => spin(img['s-' + g.n], g.cx, g.cy, i === 1 ? -ga * 2 + 0.1 : ga + i * 0.05));
  ctx.drawImage(img['front-stand'], G.front.stand[0], G.front.stand[1]); // the stand and its base, behind the wheel
  spin(img['s-flywheel'], F.cx, F.cy, wheelA);
  // the piston rod: rigid, slides into the cylinder's gland, pinned to the crank on a spoke (spokes at 30° + k·60° on the sprite)
  const r0 = 136, a0 = 210 * Math.PI / 180;
  const px = F.cx + r0 * Math.cos(a0 + wheelA), py = F.cy + r0 * Math.sin(a0 + wheelA);
  const [gx, gy] = G.gland, ang = Math.atan2(gy - py, gx - px);
  if (ROD) {
    const flip = Math.cos(ang) < 0 ? -1 : 1, T = ROD.height; // keep the lit edge on top whichever way it points
    ctx.save(); ctx.beginPath(); ctx.rect(gx - 4, 600, 800, 500); ctx.clip();
    ctx.save(); ctx.translate(px + 4, py + 14); ctx.rotate(ang); ctx.scale(1, flip); ctx.globalAlpha = 0.4; // its shadow, soft, below
    ctx.drawImage(ROD.shadow, -ROD.shadow.pad, -T / 2 - ROD.shadow.pad); ctx.restore();
    ctx.translate(px, py); ctx.rotate(ang); ctx.scale(1, flip); ctx.drawImage(ROD, 0, -T / 2); ctx.restore();
  }
  // the crank eye: its hole (sprite 45.5, 36) sits exactly on the pin; the stub points down the rod
  const e = img['s-conrod'];
  ctx.save(); ctx.translate(px, py); ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(4, 7, 30, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(ang + Math.PI); if (Math.cos(ang) > 0) ctx.scale(1, -1); ctx.drawImage(e, -45.5, -36); ctx.restore();
}
function drawFires(fl) {
  if (flameGL) {
    const fx = Math.min(1, flare / 1.6), lo = 1 - 0.55 * bank;
    flameGL.draw(FL_FIRE, ft, (0.64 + 0.08 * fx + speed * 0.04) * (1 - 0.3 * bank), (0.62 + 0.22 * fx) * (1 - 0.25 * bank));
    const w = 560, h = 470, f = FIREBOX, [sx, sy, sw, sh] = FL_FIRE;
    ctx.save(); ctx.beginPath(); ctx.rect(f.x0, f.archY, f.x1 - f.x0, f.base - f.archY); ctx.ellipse(f.cx, f.archY + 1, (f.x1 - f.x0) / 2, f.archRy, 0, Math.PI, 0); ctx.clip();
    // three tongues across the opening (the side ones mirrored, so they don't move in step)
    // drawn off-screen first so the base can melt into the coals (no hard bottom edge)
    const fb = fireBuf.getContext('2d'); fb.globalCompositeOperation = 'source-over'; fb.clearRect(0, 0, fireBuf.width, fireBuf.height);
    for (const [dx, sc, flip] of [[-135, 0.8, -1], [135, 0.78, -1], [0, 1, 1]]) {
      fb.save(); fb.translate(f.flameX + dx - FB_X, 1030 - FB_Y); fb.scale(flip * sc, sc); fb.drawImage(flameGL.c, sx, sy, sw, sh, -w / 2, -h, w, h); fb.restore(); }
    fb.globalCompositeOperation = 'destination-in';
    const mg = fb.createLinearGradient(0, 1030 - FB_Y, 0, 930 - FB_Y); mg.addColorStop(0, 'rgba(0,0,0,0)'); mg.addColorStop(0.35, 'rgba(0,0,0,.55)'); mg.addColorStop(1, 'rgba(0,0,0,1)');
    fb.fillStyle = mg; fb.fillRect(0, 0, fireBuf.width, fireBuf.height);
    ctx.globalAlpha = 0.92 * (0.55 + 0.45 * lo); ctx.drawImage(fireBuf, FB_X, FB_Y); ctx.globalAlpha = 1;
    if (fx > 0) { ctx.globalCompositeOperation = 'lighter'; glow(G_FLARE_IN, f.cx, 960, 300, 0.32 * fx); } // the opening brightens
    ctx.restore();
    if (fx > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(G_FLARE_ROOM, f.cx, 950, 760, 0.12 * fx); ctx.restore(); } // and lights the room
  }
  if (flameGL) {
    const ax = Math.min(1, ashFlare), [sx, sy, sw, sh] = FL_ASH;
    flameGL.draw(FL_ASH, at, 0.42 + 0.1 * ax, 0.75 + 0.25 * ax);
    ctx.save(); ctx.beginPath(); ctx.moveTo(70, 820); ctx.lineTo(530, 820); ctx.lineTo(ASHBIN[1][0], ASHBIN[1][1]); ctx.lineTo(...ASHBIN[2]); ctx.lineTo(...ASHBIN[3]); ctx.lineTo(...ASHBIN[0]); ctx.closePath(); ctx.clip();
    const aw = 340 + 40 * ax, ah = 300 + 40 * ax; ctx.drawImage(flameGL.c, sx, sy, sw, sh, 290 - aw / 2, 1268 - ah, aw, ah); ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  glow(G_ROOM, 630, 960, 820, 0.07 * fl);
  for (const [lx, ly] of LANTERNS) { // a candle-like flicker: slow breathing plus small quick dips
    const n = Math.sin(now * 2.3 + lx) * 0.5 + Math.sin(now * 7.1 + ly) * 0.3 + Math.sin(now * 17.3 + lx * 0.7) * 0.2;
    glow(G_LANT, lx, ly, 170, 0.06 + 0.03 * n);
    glow(G_LANT_IN, lx, ly, 34, 0.22 + 0.12 * n); // the flame inside
  }
  if (stamp > 0) glow(G_STAMP, 2296, 820, 230, 0.22 * stamp); // the press glows as it stamps a pack
  ctx.restore();
}
function drawItems() { // logs slide down the chute into the firebox; PAPER sheets feed into the press's top roll
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i], dur = it.kind === 'log' ? 0.95 : 1.5, t = (now - it.t0) / dur;
    if (t < 0) continue;
    if (t >= 1) { if (it.kind === 'log') { flare = Math.min(2.4, flare + 0.6); sparkBurst(FIREBOX.cx + it.dx * 0.5, 990, Math.round(8 * PN()), 0.6); } items.splice(i, 1); continue; }
    ctx.save();
    if (it.kind === 'log') { // sliding down the hopper chute into the hood (the fire flares when it lands, out of sight)
      const u = t, e = u * u, im = it.img;
      ctx.beginPath(); ctx.moveTo(585, 0); ctx.lineTo(862, 0); ctx.lineTo(828, 300); ctx.lineTo(802, 398); ctx.lineTo(604, 398); ctx.lineTo(598, 300); ctx.closePath(); ctx.clip();
      const x = 735 - 30 * e + it.dx * 0.3, y = 40 + (430 - 40) * e, sc = 0.72 + 0.28 * e;
      const a = Math.min(1, u * 6) * (1 - Math.max(0, (u - 0.82) / 0.18));
      ctx.translate(x, y); ctx.rotate(CHUTE_A + it.rot * 0.2); ctx.scale(sc, sc);
      ctx.globalAlpha = a * 0.75; const s = im.shadow; ctx.drawImage(s, -im.width / 2 - s.pad - 8, -im.height / 2 - s.pad + 15); // soft shadow on the chute
      ctx.globalAlpha = a; ctx.drawImage(im, -im.width / 2, -im.height / 2);
    } else {
      const im = it.img, W = 188, Hfull = W * im.height / im.width, R = TOPROLL;
      let yT, yL, x = R.cx, rot = 0, a = 1;
      const yOn = (th) => R.cy + R.R * Math.sin(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, th)));
      if (t < 0.42) { // falls, flutters and settles onto the top roll
        const ta = t / 0.42, e = ta * ta, cyc = -40 + (111.5 + 40) * e;
        const h = 47 + (Hfull * 0.75 - 47) * (1 - e) * Math.abs(Math.cos(ta * 6 + it.ph));
        yT = cyc - h / 2; yL = cyc + h / 2; x = R.cx + it.dx * (1 - e); rot = (it.rot + it.spin * (1 - ta)) * (1 - smooth(0.4, 1, ta)); a = Math.min(1, ta * 6);
      } else { // gripped and drawn down over the roll into the nip
        const tb = (t - 0.42) / 0.58, lead = -0.2 + 3.35 * Math.pow(tb, 1.25);
        yL = yOn(lead); yT = yOn(lead - 1.4);
      }
      const h = yL - yT;
      if (h > 0.6) {
        const g = paperBuf.getContext('2d'), bh = Math.ceil(h) + 2; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, paperBuf.width, paperBuf.height); g.drawImage(im, 0, 1, W, h);
        g.globalCompositeOperation = 'source-atop'; // shade it like the roll's surface where it lies
        const sg = g.createLinearGradient(0, 1 - (yT - 88), 0, 1 + (R.nip - yT));
        sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.3, 'rgba(0,0,0,.02)'); sg.addColorStop(0.72, 'rgba(20,10,4,.2)'); sg.addColorStop(0.95, 'rgba(20,10,4,.24)'); sg.addColorStop(1, 'rgba(10,5,2,.55)');
        g.fillStyle = sg; g.fillRect(0, 0, W, bh);
        ctx.beginPath(); ctx.rect(1900, -200, 800, R.nip + 200); ctx.clip(); // the nip swallows it
        ctx.globalAlpha = a; ctx.translate(x, (yT + yL) / 2); ctx.rotate(rot);
        ctx.drawImage(paperBuf, 0, 0, W, bh, -W / 2, -h / 2 - 1, W, bh);
      }
    }
    ctx.restore();
  }
}
function packSprite() { // the pack, pre-scaled at 2x its on-screen size, lightly warmed to the room's light
  if (packSpr) return packSpr;
  const w = Math.max(8, Math.round(106 * scale * (view.follow ? ZMAX : 1) * 2)), h = Math.round(w * 1.4);
  const c = prescale(img.pack, w, h), g = c.getContext('2d');
  g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(218,204,190)'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(prescale(img.pack, w, h), 0, 0);
  const sh = mk(w + 40, h + 40), sg = sh.getContext('2d'); sg.fillStyle = '#000';
  if (CAN_FILTER) sg.filter = 'blur(9px)'; sg.beginPath(); sg.roundRect ? sg.roundRect(20, 20, w, h, 10) : sg.rect(20, 20, w, h); sg.fill();
  c.shadow = sh; return (packSpr = c);
}
function drawPacks(dt) { // packs lie on the belt in its perspective, drop and settle under the press, and ride into the drum
  const spr = packSprite(), w = 106, h = w * 1.4 * 0.5;
  for (let i = packs.length - 1; i >= 0; i--) {
    const p = packs[i]; p.age += dt; if (p.age > 0.32) p.d += dt * beltSp * 190 * (RM ? 0.6 : 1); // packs ride the belt at its speed
    const x = PACK_FROM + p.d;
    if (!p.capped && x > PACK_TO + 50) { p.capped = true; const c = { t0: now, job: p.job }; caps.push(c); if (p.job) p.job.cap = c; }
    if (x > 3446 + w / 2 + h * BELT_SKEW + 10) { packs.splice(i, 1); continue; }
    const ft = Math.min(1, p.age / 0.2), fall = 1 - ft * ft; // falls from the press...
    const bt = Math.max(0, p.age - 0.2), bounce = bt < 0.25 ? Math.sin(bt / 0.25 * Math.PI) * 5 * (1 - bt / 0.25) : 0; // ...then a tiny settle
    const squash = bt < 0.12 ? 1 - 0.06 * Math.sin(bt / 0.12 * Math.PI) : 1;
    const y = PACK_Y - 22 * fall - bounce;
    ctx.save(); ctx.globalAlpha = Math.min(1, p.age / 0.06);
    ctx.save(); ctx.translate(x + 5, PACK_Y + 4); ctx.transform(1, 0, BELT_SKEW, 1, 0, 0); // contact shadow on the slats
    ctx.globalAlpha *= 0.55 * (1 - 0.6 * fall); const sk = 1 + 0.15 * fall; ctx.drawImage(spr.shadow, -w / 2 * sk - 20 * w / spr.width, -h / 2 * sk - 20 * h / spr.height, (w * sk) * (spr.shadow.width / spr.width), (h * sk) * (spr.shadow.height / spr.height)); ctx.restore();
    ctx.translate(x, y); ctx.transform(1, 0, BELT_SKEW, 1, 0, 0); ctx.scale(1 / squash, squash);
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
// the capsule's run up the tube: it eases into each window, so it's seen, and a glint as it passes
const CAP = (() => { const N = 240, seg = []; let L = 0; for (let i = 0; i < TUBE.length - 1; i++) { const l = Math.hypot(TUBE[i + 1][0] - TUBE[i][0], TUBE[i + 1][1] - TUBE[i][1]); seg.push(l); L += l; }
  const ts = [0]; let T = 0;
  for (let k = 1; k <= N; k++) { const s = (k - 0.5) / N * L, [, y] = along(TUBE, s / L);
    let dw = 1e9; for (const [, wy] of WINDOWS) dw = Math.min(dw, Math.abs(y - wy));
    const v = (0.3 + 0.7 * smooth(10, 95, dw)) * (0.3 + 0.7 * smooth(0, 160, s)); T += (L / N) / v; ts.push(T); }
  return { L, N, ts, T }; })();
const CAP_TIME = 1.7;
function capU(t) { const tt = t * CAP.T, ts = CAP.ts; let lo = 0, hi = CAP.N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] < tt) lo = m; else hi = m; }
  return (lo + (tt - ts[lo]) / Math.max(1e-6, ts[hi] - ts[lo])) / CAP.N; }
function drawCapsules() { // through the tube's three windows, up and out to the buyer's wallet
  const cap = img['s-capsule'], pos = [];
  for (let i = caps.length - 1; i >= 0; i--) {
    const c = caps[i], t = (now - c.t0 - 0.25) / CAP_TIME;
    if (t < 0) continue;
    if (t >= 1) { caps.splice(i, 1); if (c.job) c.job.done = now; emit('delivered'); continue; }
    pos.push(along(TUBE, capU(t)));
  }
  for (const [wx, wy, wr] of WINDOWS) {
    ctx.save(); ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI * 2); ctx.clip();
    const fl = 0.85 + 0.15 * Math.sin(now * 2.1 + wy) * Math.sin(now * 5.3 + wx);
    ctx.globalCompositeOperation = 'lighter'; glow(G_WIN, wx + 4, wy + 6, wr * 1.1, 0.16 * fl); ctx.globalCompositeOperation = 'source-over'; // a dim lamp-lit inside
    let pass = 0;
    for (const [x, y, a] of pos) {
      if (Math.abs(y - wy) > wr + cap.height / 2) continue;
      pass = Math.max(pass, 1 - Math.min(1, Math.abs(y - wy) / (wr + 12)));
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2); ctx.drawImage(cap, -cap.width / 2, -cap.height / 2); ctx.restore();
    }
    const g = ctx.createRadialGradient(wx - 8, wy - 10, 2, wx, wy, wr); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g; ctx.fillRect(wx - wr, wy - wr, wr * 2, wr * 2); // the glass's depth at its rim
    if (pass > 0 && !RM) { ctx.globalCompositeOperation = 'lighter'; glow(G_HOT, wx, wy, wr * 1.25, 0.75 * Math.pow(pass, 1.5)); ctx.globalCompositeOperation = 'source-over'; } // a brief glint as it passes
    ctx.restore();
    ctx.save(); ctx.lineCap = 'round'; // the curved glass highlight
    ctx.strokeStyle = 'rgba(255,244,226,.38)'; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(wx, wy, wr * 0.74, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,244,226,.14)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(wx, wy, wr * 0.74, Math.PI * 0.12, Math.PI * 0.3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,250,240,.32)'; ctx.beginPath(); ctx.arc(wx - wr * 0.36, wy - wr * 0.46, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
function gauge(x, y, r, frac, arc) { // a brass gauge: ticks, a coloured arc, a needle
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5, an = a0 + span * frac + Math.sin(now * 9) * 0.006;
  ctx.save(); ctx.lineCap = 'round';
  for (let k = 0; k <= 6; k++) { const t = a0 + span * k / 6; ctx.strokeStyle = 'rgba(50,28,12,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(t) * (r - 8), y + Math.sin(t) * (r - 8)); ctx.lineTo(x + Math.cos(t) * (r - 14), y + Math.sin(t) * (r - 14)); ctx.stroke(); }
  if (frac > 0) { ctx.strokeStyle = arc; ctx.lineWidth = 3.5; ctx.shadowColor = arc; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(x, y, r - 5, a0, a0 + span * frac); ctx.stroke(); ctx.shadowBlur = 0; }
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 2, y + 3); ctx.lineTo(x + 2 + Math.cos(an) * (r - 11), y + 3 + Math.sin(an) * (r - 11)); ctx.stroke();
  ctx.strokeStyle = '#2a1608'; ctx.beginPath(); ctx.moveTo(x - Math.cos(an) * 6, y - Math.sin(an) * 6); ctx.lineTo(x + Math.cos(an) * (r - 11), y + Math.sin(an) * (r - 11)); ctx.stroke();
  const hub = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5); hub.addColorStop(0, '#f6d48a'); hub.addColorStop(1, '#6b4316');
  ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
let soldDust = false;
function drawBoardAndDials() {
  const b = BOARD, cx = b.x + b.w / 2, sold = left <= 0 || finale >= 0;
  const key = (sold ? 'S' + left : 'L' + left) + seriesNo;
  if (board.key !== key) { board.key = key; drawBoard(sold ? [['SERIES ' + seriesNo, 24, 32], [String(Math.max(0, left)), 70, 92, 0.55], ['packs left', 24, 150, 0.55]] : [['SERIES ' + seriesNo, 24, 32], [String(left), 70, 92], ['packs left', 24, 150]]); }
  ctx.drawImage(board.c, b.x, b.y, b.w, b.h);
  if (sold) { // the SOLD OUT stamp lands on the chalkboard (already there if the page opens sold out)
    const st = finale >= 0 ? now - finale - 0.45 : 9;
    if (st > 0) {
      const k = Math.min(1, st / 0.2), s = 1 + 0.7 * (1 - k) * (1 - k) - (st > 0.2 && st < 0.36 ? 0.035 * Math.sin((st - 0.2) / 0.16 * Math.PI) : 0);
      if (k >= 1 && !soldDust && finale >= 0) { soldDust = true; chalkDust(cx, b.y + b.h / 2 + 4); }
      ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      ctx.globalAlpha = Math.min(1, st / 0.08) * 0.92; ctx.translate(cx, b.y + b.h / 2); ctx.scale(s, s); ctx.drawImage(SOLD, -b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
  }
  // hood dial: the holder window, an amber arc that empties over 24h (demo: 17h left)
  { const [x, y, r] = DIAL_HOOD, frac = left > 0 ? windowFrac : 0;
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5, an = a0 + span * frac + Math.sin(now * 9) * 0.006; // a gauge: 7 o'clock to 5 o'clock
    ctx.save(); ctx.lineCap = 'round';
    for (let k = 0; k <= 8; k++) { const t = a0 + span * k / 8; ctx.strokeStyle = 'rgba(50,28,12,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(t) * (r - 9), y + Math.sin(t) * (r - 9)); ctx.lineTo(x + Math.cos(t) * (r - 15), y + Math.sin(t) * (r - 15)); ctx.stroke(); }
    if (frac > 0) { ctx.strokeStyle = 'rgba(255,150,40,.75)'; ctx.lineWidth = 3.5; ctx.shadowColor = 'rgba(255,140,40,.8)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, r - 6, a0, a0 + span * frac); ctx.stroke(); ctx.shadowBlur = 0; }
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.moveTo(x + 2, y + 3); ctx.lineTo(x + 2 + Math.cos(an) * (r - 12), y + 3 + Math.sin(an) * (r - 12)); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
    ctx.strokeStyle = '#2a1608'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(an) * 6, y - Math.sin(an) * 6); ctx.lineTo(x + Math.cos(an) * (r - 12), y + Math.sin(an) * (r - 12)); ctx.stroke();
    const hub = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5.5); hub.addColorStop(0, '#f6d48a'); hub.addColorStop(1, '#6b4316');
    ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  gauge(...DIAL_ASH, (burnCount % 42) / 42, 'rgba(235,60,28,.8)'); // the ash bin: how close to a free pack
}
function drawPadlock(dt) { // on the open bench until the Fire closes, then it drops off
  const im = img['s-padlock']; if (!im) return;
  if (left <= 0 && lockFall < 0) lockFall = 0;
  if (lockFall >= 0) lockFall += dt * 0.9;
  const t = Math.max(0, lockFall), [x, y] = PADLOCK;
  if (t >= 1) return;
  ctx.save(); ctx.globalAlpha = 1 - t; ctx.translate(x + 40 * t, y + 220 * t * t); ctx.rotate(0.5 * t);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(10, im.height * 0.42, im.width * 0.42, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(im, -im.width / 2, -im.height / 2); ctx.restore();
}
function drawTokens() { // 42.0 burned: a free-pack token pops out of the ash bin
  for (let i = tokens.length - 1; i >= 0; i--) {
    const k = tokens[i], t = (now - k.t0) / 1.6;
    if (t >= 1) { tokens.splice(i, 1); emit('tokenOut'); continue; }
    const im = img['s-token'], x = 330 + 160 * t, y = 1150 - 260 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 40 * t;
    ctx.save(); ctx.globalAlpha = Math.min(1, t * 6) * (1 - Math.max(0, (t - 0.8) / 0.2)); ctx.translate(x, y); ctx.scale(Math.cos(t * 12), 1);
    ctx.drawImage(im, -im.width / 2, -im.height / 2); ctx.restore();
  }
}

// ---------- effects: sparks, embers, steam, chalk dust, shake (code only, no new art)
const sparks = [], embers = [], puffs = [], dust = [];
let shake = 0, finale = -1, emberAcc = 0, lastStroke = 0, sighs = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const VENTS = { cyl: [1169, 712, -0.2, -1], stub: [1532, 577, 1, -0.35], cross: [1214, 330, -0.15, -1], press: [2130, 230, -0.6, -1], drum: [3560, 830, 0.1, -1] };
function steam(v, n, power = 1) {
  const [x, y, dx, dy] = VENTS[v], set = x < 1700 ? PUFFS.warm : PUFFS.cool; // warmer near the furnace
  const m = Math.max(1, Math.round(n * 3 * PN()));
  for (let k = 0; k < m; k++) { const sp = rnd(70, 130) * power, vx = (dx + rnd(-0.25, 0.25)) * sp, vy = (dy + rnd(-0.2, 0.2)) * sp;
    puffs.push({ x: x + rnd(-4, 4), y: y + rnd(-4, 4), vx, vy, life: -k / m * Math.min(0.9, 0.12 * n), // a burst comes out as a plume, not a stack
      r: rnd(5, 9) * power, grow: rnd(110, 170) * power, max: rnd(1.5, 2.7), im: set[(Math.random() * 4) | 0], ang: Math.atan2(vy, vx), rot: rnd(-0.4, 0.4), vr: rnd(-0.2, 0.2), asp: rnd(1.5, 2.1), a: rnd(0.25, 0.4) }); }
}
function chalkDust(x, y) { // a little puff of chalk off the board as the stamp lands
  const n = Math.round(16 * PN());
  for (let k = 0; k < n; k++) { const a = rnd(0, Math.PI * 2), sp = rnd(30, 110);
    dust.push({ x: x + Math.cos(a) * rnd(50, 80), y: y + Math.sin(a) * rnd(25, 45), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 10, r: rnd(6, 12), grow: rnd(20, 45), life: 0, max: rnd(0.7, 1.3), im: PUFFS.cool[k % 4], rot: rnd(0, 6), a: rnd(0.25, 0.42) }); }
}
function sparkBurst(x, y, n, power = 1) {
  for (let k = 0; k < n; k++) { const a = rnd(-Math.PI, 0), v = rnd(180, 520) * power;
    sparks.push({ x: x + rnd(-60, 60), y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - 60, life: 0, max: rnd(0.35, 0.9) }); }
}
function stampFx() { sparkBurst(PACK_FROM, 948, Math.round(26 * PN())); if (!RM) shake = Math.max(shake, 0.6); steam('press', 3, 0.7); steam('cross', 2, 0.8); }
function finaleFx() {
  finale = now; flare = 2.4; if (!RM) shake = 1.6; soldDust = false; sighs = 0;
  sparkBurst(FIREBOX.cx, 980, Math.round(90 * PN()), 1.4); sparkBurst(PACK_FROM, 948, Math.round(60 * PN()), 1.3);
  for (const v of Object.keys(VENTS)) steam(v, 10, 1.6);
}
function updateFx(dt) {
  shake = RM ? 0 : Math.max(0, shake - dt * 2.2);
  // a puff from the cylinder every piston stroke (twice a turn), a breath from the stub
  const stroke = Math.floor(wheelA / Math.PI);
  if (stroke !== lastStroke) { lastStroke = stroke; if (speed > 0.3) { steam('cyl', 2, 0.6 + speed * 0.4); if (stroke % 2) steam('stub', 1, 0.6); } }
  if (finale >= 0) { const f = now - finale; if (sighs === 0 && f > 2.6) { sighs = 1; steam('cyl', 2, 0.55); } if (sighs === 1 && f > 4.4) { sighs = 2; steam('stub', 1, 0.45); steam('cyl', 1, 0.4); } } // the machine's last breaths
  // embers rise out of the firebox, more when it flares, few once banked
  emberAcc += dt * (3 + flare * 22 + speed * 4) * (left > 0 || finale >= 0 ? 1 : 0.4) * (1 - 0.7 * bank) * PN();
  while (emberAcc > 1) { emberAcc--; embers.push({ x: rnd(470, 790), y: rnd(900, 990), vx: rnd(-20, 20), vy: rnd(-150, -70), life: 0, max: rnd(1.2, 2.6), ph: rnd(0, 6), s: rnd(1.6, 3.4) }); }
  for (const a of [sparks, embers, puffs, dust]) for (let i = a.length - 1; i >= 0; i--) { const p = a[i]; p.life += dt; if (p.life >= p.max) a.splice(i, 1); }
  for (const p of sparks) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (const p of embers) { p.vx += Math.sin(now * 3 + p.ph) * 40 * dt; p.vy -= 10 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (const p of puffs) { if (p.life < 0) continue; p.vx *= 1 - dt * 1.3; p.vy = p.vy * (1 - dt * 1.1) - 26 * dt; p.vx += Math.sin(now * 0.9 + p.rot * 3) * 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt; p.grow *= 1 - dt * 0.9; p.rot += p.vr * dt; }
  for (const p of dust) { p.vx *= 1 - dt * 2.5; p.vy = p.vy * (1 - dt * 2.5) + 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt; }
}
function drawFx() {
  ctx.save();
  for (const p of puffs) { if (p.life < 0) continue; const t = p.life / p.max, a = p.a * smooth(0, 0.3, t) * Math.pow(1 - t, 1.5);
    const st = 1 + (p.asp - 1) * (1 - smooth(0, 0.6, t)); // streaks out of the vent, then billows round
    ctx.globalAlpha = a; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.scale(st, 1 / Math.sqrt(st)); ctx.rotate(p.rot); ctx.drawImage(p.im, -p.r, -p.r, p.r * 2, p.r * 2); ctx.restore(); }
  for (const p of dust) { const t = p.life / p.max; ctx.globalAlpha = p.a * smooth(0, 0.1, t) * (1 - t); ctx.drawImage(p.im, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const p of embers) { const t = p.life / p.max, a = (1 - t) * (0.6 + 0.4 * Math.sin(now * 14 + p.ph));
    ctx.fillStyle = `rgba(255,${150 + 60 * (1 - t) | 0},60,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill(); }
  for (const p of sparks) { const t = p.life / p.max;
    ctx.strokeStyle = `rgba(255,${200 - 90 * t | 0},${110 - 80 * t | 0},${1 - t})`; ctx.lineWidth = 4.5 * (1 - t) + 1.5;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); }
  if (!RM && finale >= 0 && now - finale < 1.2) glow(G_FLASH, 1400, 900, 2600, 0.28 * (1 - (now - finale) / 1.2)); // the whole room flashes with the last pack
  ctx.restore();
}

// ---------- the follow camera
// Picks what to look at (the newest thing happening), then glides there with a critically damped spring on a
// low-passed goal (continuous position, speed and acceleration: no jerks), feed-forward of the subject's own speed
// (a moving pack or capsule is held steady in frame, not chased), and a slight pull-back on long moves.
const following = () => view.follow && view.mode === 'cover' && !RM;
const camBounds = (z) => { const hw = vb.bw / (2 * scale * z), hh = vb.bh / (2 * scale * z);
  return [Math.min(hw, SW / 2), Math.max(SW - hw, SW / 2), Math.min(hh, SH / 2), Math.max(SH - hh, SH / 2)]; };
const clampTo = (v, a, b) => Math.max(a, Math.min(b, v));
function jobGoal(j) {
  const key = 'job' + j.id;
  if (j.cap) { // the capsule up the tube, through its three windows
    const t = (now - j.cap.t0 - 0.25) / CAP_TIME, u0 = capU(clampTo(t, 0, 1)), u1 = capU(clampTo(t + 0.03, 0, 1));
    const [x, y] = along(TUBE, u0), [x1, y1] = along(TUBE, u1), m = t < 0 || t >= 1 ? 0 : 1 / (0.03 * CAP_TIME);
    return { x, y: Math.max(y, 120), z: 1.6, vx: (x1 - x) * m, vy: (y1 - y) * m, key };
  }
  if (j.pack) { const p = j.pack, x = PACK_FROM + p.d, v = p.age > 0.32 ? beltSp * 190 * (RM ? 0.6 : 1) : 0; // riding the belt
    return { x: x + 60, y: 880, z: 1.6, vx: v, vy: 0, key }; }
  if (now < j.t0 + 1.05) return { x: 660, y: 640, z: 1.4, vx: 0, vy: 0, key }; // logs down the chute, the fire flares
  return { x: 2270, y: 560, z: 1.35, vx: 0, vy: 0, key }; // PAPER into the press, the stamp
}
function camSubject() {
  if (finale >= 0) cam.homeAfter = Math.max(cam.homeAfter, finale); // after the sold-out show, nothing older pulls the camera back
  if (finale >= 0 && now - finale < 7) return { x: 1700, y: SH / 2, z: 1, vx: 0, vy: 0, key: 'fin', t0: finale }; // sold out: the whole room
  const c = [];
  const tk = tokens[tokens.length - 1];
  if (tk && tk.t0 > cam.homeAfter) { const t = Math.min(1, (now - tk.t0) / 1.6), x = 330 + 160 * t, y = 1150 - 260 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 40 * t;
    c.push({ x, y: y - 40, z: 1.5, vx: 0, vy: 0, key: 'tok' + tk.t0, t0: tk.t0 }); }
  const cd = cardsIn[cardsIn.length - 1];
  if (cd && cd.t0 > cam.homeAfter) { const t = now - cd.t0;
    if (t < CARD_FLY) { const u = Math.min(1, t / CARD_FLY + 0.3), [x, y] = cardPath(u), [x1, y1] = cardPath(Math.min(1, u + 0.02)), m = u < 1 ? 1 / (0.02 * CARD_FLY) : 0; // a little ahead: it's quick
      c.push({ x, y, z: 1.3, vx: (x1 - x) * m, vy: (y1 - y) * m, key: 'card' + cd.t0, t0: cd.t0 }); }
    else c.push({ x: 330, y: 1120, z: 1.5, vx: 0, vy: 0, key: 'card' + cd.t0, t0: cd.t0 }); } // the bin flares
  for (let i = jobs.length - 1; i >= 0; i--) { const j = jobs[i]; // the newest job that has started
    if (j.done >= 0 || j.t0 > now || j.born <= cam.homeAfter) continue; c.push({ ...jobGoal(j), t0: j.t0 }); break; }
  if (!c.length) return null;
  c.sort((a, b) => b.t0 - a.t0);
  const cur = c.find((g) => g.key === cam.key); // don't hop off what we're on within a moment of choosing it
  return cur && cur !== c[0] && now - cam.since < 1.2 ? cur : c[0];
}
function camUpdate(dt) {
  cam.on = following();
  if (!cam.on) { curS = scale; curOX = ox; curOY = oy; return; }
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].done >= 0 && now - jobs[i].done > 10) jobs.splice(i, 1);
  const manual = now < cam.manualUntil;
  if (!manual) {
    let g = camSubject();
    if (g) { cam.last = g; cam.lastAt = now; }
    else if (cam.last && now - cam.lastAt < CAM_HOLD) g = { ...cam.last, vx: 0, vy: 0, key: cam.last.key }; // hold where it ended
    else g = { x: cam.homeX, y: cam.homeY, z: 1, vx: 0, vy: 0, key: 'home' };
    if (g.key !== cam.key) { cam.key = g.key; cam.since = now; }
    const dist = Math.hypot(g.x - cam.x, g.y - cam.y);
    const gz = Math.log(Math.max(1, Math.min(ZMAX, g.z / (1 + 0.22 * smooth(250, 1600, dist))))); // pull back a little on long moves
    const [x0, x1, y0, y1] = camBounds(Math.min(Math.exp(cam.lz), Math.exp(gz))); // a goal reachable at both zooms: never shows black
    const a = 1 - Math.exp(-dt / 0.14), af = 1 - Math.exp(-dt / 0.25);
    const cx = clampTo(g.x, x0 + 40, x1 - 40), cy = clampTo(g.y, y0 + 40, y1 - 40); // a goal at the wall stops feeding speed into it
    cam.gx += (clampTo(g.x, x0, x1) - cam.gx) * a; cam.gy += (clampTo(g.y, y0, y1) - cam.gy) * a; cam.gz += (gz - cam.gz) * a;
    cam.fvx += ((cx === g.x ? g.vx || 0 : 0) - cam.fvx) * af; cam.fvy += ((cy === g.y ? g.vy || 0 : 0) - cam.fvy) * af;
    const W = g.key === 'home' ? 1.9 : 2.6, WZ = g.key === 'home' ? 1.7 : 2.2, n = 2, h = dt / n;
    for (let k = 0; k < n; k++) {
      cam.vx += (W * W * (cam.gx - cam.x) + 2 * W * (cam.fvx - cam.vx)) * h; cam.x += cam.vx * h;
      cam.vy += (W * W * (cam.gy - cam.y) + 2 * W * (cam.fvy - cam.vy)) * h; cam.y += cam.vy * h;
      cam.vz += (WZ * WZ * (cam.gz - cam.lz) - 2 * WZ * cam.vz) * h; cam.lz += cam.vz * h;
    }
    cam.lz = clampTo(cam.lz, 0, Math.log(ZMAX));
  }
  camClamp();
  // test hook: window.__camLog = [] records the camera path
  if (window.__camLog) window.__camLog.push([+now.toFixed(4), +cam.x.toFixed(2), +cam.y.toFixed(2), +Math.exp(cam.lz).toFixed(4), cam.key]);
}
function camClamp() {
  const [x0, x1, y0, y1] = camBounds(Math.exp(cam.lz));
  if (cam.x < x0) { cam.x = x0; cam.vx = Math.max(0, cam.vx); } if (cam.x > x1) { cam.x = x1; cam.vx = Math.min(0, cam.vx); }
  if (cam.y < y0) { cam.y = y0; cam.vy = Math.max(0, cam.vy); } if (cam.y > y1) { cam.y = y1; cam.vy = Math.min(0, cam.vy); }
  curS = scale * Math.exp(cam.lz); curOX = vb.bx + vb.bw / 2 - cam.x * curS; curOY = vb.by + vb.bh / 2 - cam.y * curS;
}
function camHome() { cam.homeAfter = now; cam.last = null; cam.manualUntil = -1; }
// touch: drag pans by hand (auto-follow waits ~6 s), a double tap goes home
{ const P = { id: null, x: 0, y: 0, moved: 0, tapAt: -1, tapX: 0, tapY: 0 };
  const inBox = (e) => { const x = e.clientX * dpr, y = e.clientY * dpr; return x >= vb.bx && x <= vb.bx + vb.bw && y >= vb.by && y <= vb.by + vb.bh; };
  cv.addEventListener('pointerdown', (e) => { if (!cam.on || !inBox(e)) return; P.id = e.pointerId; P.x = e.clientX; P.y = e.clientY; P.moved = 0; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
  cv.addEventListener('pointermove', (e) => { if (e.pointerId !== P.id || !cam.on) return;
    const dx = e.clientX - P.x, dy = e.clientY - P.y; P.x = e.clientX; P.y = e.clientY; P.moved += Math.abs(dx) + Math.abs(dy);
    cam.x -= dx * dpr / curS; cam.y -= dy * dpr / curS; cam.vx = cam.vy = cam.vz = cam.fvx = cam.fvy = 0;
    camClamp(); cam.gx = cam.x; cam.gy = cam.y; cam.gz = cam.lz; cam.manualUntil = now + CAM_MANUAL; });
  const end = (e) => { if (e.pointerId !== P.id) return; P.id = null;
    if (P.moved < 8 && e.type === 'pointerup') { const t = performance.now();
      if (t - P.tapAt < 350 && Math.hypot(e.clientX - P.tapX, e.clientY - P.tapY) < 30) { camHome(); P.tapAt = -1; } else { P.tapAt = t; P.tapX = e.clientX; P.tapY = e.clientY; } } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); }

// ---------- frame
let last = performance.now();
const FIXED = location.search.includes('fixed');
window.__frames = 0; // test hook: frame counter
document.addEventListener('visibilitychange', () => { last = performance.now(); });
function frame(tms) {
  if (document.hidden) { last = tms; requestAnimationFrame(frame); return; } // nothing drawn while the tab is hidden
  if (window.__paused && !(window.__steps > 0)) { last = tms; requestAnimationFrame(frame); return; } // test hook: step frame by frame
  if (window.__steps > 0) window.__steps--;
  const dt = FIXED ? 1 / 30 : Math.min(0.05, Math.max(0, (tms - last) / 1000)); last = tms; now += dt;
  const closing = (left <= 0 || finale >= 0) && !packs.length && queue <= 0;
  target = closing ? 0 : queue > 0 || packs.length ? 1 : 0.15;
  speed += (target - speed) * Math.min(1, dt * (closing ? 0.45 : 1.4)); // winds down slowly when the Fire closes
  bank = Math.max(0, Math.min(1, bank + dt * (left <= 0 || finale >= 0 ? (finale >= 0 && now - finale < 0.5 ? 0 : 1 / 3) : -1 / 2))); // the fire banks to embers over ~3 s
  const MS = RM ? 0.6 : 1;
  wheelA += dt * speed * 2.6 * MS; beltSp += (Math.max(speed, 0.32) - beltSp) * Math.min(1, dt * 2); beltX += dt * beltSp * 190 * MS; chainX += dt * speed * 190 * MS; rollS += dt * speed * 150 * MS;
  ft += dt * (0.9 + speed * 0.6) * (1 - 0.4 * bank); at += dt * 0.8;
  flare = Math.max(0, flare - dt * 0.7); ashFlare = Math.max(0, ashFlare - dt * 0.8); stamp = Math.max(0, stamp - dt * 1.6);
  if (queue > 0 && now >= nextPackAt && now >= ready[0] && (!packs.length || packs[packs.length - 1].d >= 128)) { // never stacked on the last one
    ready.shift(); queue--; const job = jobs.find((j) => !j.pack); const pk = { d: 0, age: 0, job }; if (job) job.pack = pk; packs.push(pk); stamp = RM ? 0.4 : 1; nextPackAt = now + 0.8; stampFx(); emit('packMade');
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  updateFx(dt);
  camUpdate(dt);
  const camOn = cam.on;
  if (camOn) { ctx.save(); ctx.beginPath(); ctx.rect(vb.bx, vb.by, vb.bw, vb.bh); ctx.clip(); } // a zoomed view stays in its box
  const sk = RM ? 0 : shake * shake * 7 * scale;
  ctx.setTransform(curS, 0, 0, curS, curOX + rnd(-sk, sk), curOY + rnd(-sk, sk));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, SW, SH); ctx.clip(); // nothing escapes the scene's own box
  const hi = camOn && curS > scale * 1.02;
  if (!(hi ? plateHi : plateCache)) { const k = hi ? scale * ZMAX : scale, c = mk(SW * k, SH * k);
    const pg = c.getContext('2d'); pg.imageSmoothingQuality = 'high'; pg.drawImage(img.plate, 0, 0, c.width, c.height); if (hi) plateHi = c; else plateCache = c; } // the plate, scaled once per resize (and once more for the zoomed camera)
  ctx.drawImage(hi ? plateHi : plateCache, 0, 0, SW, SH);
  drawRolls();
  drawBelt(dt);
  drawEngine();
  const base = 0.85 + 0.15 * Math.sin(now * 7.3) * Math.sin(now * 3.1) + flare * 0.35;
  const fl = base * (1 - bank) + (0.45 + 0.05 * Math.sin(now * 1.7)) * bank;
  drawItems();
  drawFires(fl);
  drawFx();
  drawCapsules();
  drawBoardAndDials();
  drawPadlock(dt);
  drawCards(dt);
  drawTokens();
  ctx.drawImage(VIGNETTE, 0, 0, SW, SH);
  ctx.restore();
  if (camOn) ctx.restore();

  window.__frames++;
  requestAnimationFrame(frame);
}
await Promise.all([document.fonts.ready, document.fonts.load("700 40px Kalam"), document.fonts.load("40px \"Russo One\""), document.fonts.load("700 40px \"Cabin Sketch\"")]).catch(() => {});
requestAnimationFrame(frame);
window.Scene = {
  buy, burn, popToken, finale: finaleFx,
  setState(o) { if ('left' in o) { left = o.left; if (left > 0 && finale >= 0 && now - finale > 1) finale = -1; } if ('total' in o) total = o.total; if ('burnCount' in o) burnCount = o.burnCount; if ('windowFrac' in o) windowFrac = o.windowFrac; if ('series' in o) seriesNo = o.series; board.key = ''; },
  setView(v) { Object.assign(view, v); fit(); camUpdate(0); }, // follow:true (cover mode) turns on the follow camera
  home: camHome,
  get camera() { return { x: cam.x, y: cam.y, zoom: Math.exp(cam.lz), on: cam.on, key: cam.key }; },
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  toScreen(x, y) { return [(curOX + x * curS) / dpr, (curOY + y * curS) / dpr]; },
  get scale() { return scale / dpr; },
  get reducedMotion() { return RM; },
  debug() { return { packs: packs.length, caps: caps.length, cards: cardsIn.length, puffs: puffs.length, now }; },
};
window.dispatchEvent(new Event('scene-ready'));
})();
