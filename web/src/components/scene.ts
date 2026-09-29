// The campfire scene: the painted clearing (Plank in his chair, the Plank & Paper press on the stream), a WebGL fire
// whose height follows the fire's log count, the daily storm (21:00 UTC), and the animals that wander by. The sky follows
// the player's own clock.
// Ported from the approved scene mock (docs/HANDOFF.md, scene makeover). The whole painting is drawn at its own size
// (1942 x 809) on an offscreen canvas, then cropped to fill the page: on a wide screen it's centred on the fire; on an
// upright phone it frames Plank and the fire, can be dragged left and right, and pans to an animal that shows up.

import { CEREMONY as C, type Storm } from "../data/types";
import { createAmbience } from "./ambience";
import { DEER, PAINT, RAB, SOLO, SQ, TUFTS } from "./sceneData";

export type Kind = "deer" | "rabbit" | "squirrel" | "birds" | "heron" | "frog" | "bear";
export const KINDS: Kind[] = ["deer", "rabbit", "squirrel", "heron", "frog", "bear", "birds"];

export interface SceneInput {
  /** 0..1: how big the fire is drawn (fireLook of its log count) */
  size: number;
  /** the player's local hour 0..24: sun, moon and stars follow it */
  hour: number;
  /** 0..1: how threatening the next storm looks. Darkens the sky and gathers clouds. */
  threat: number;
  /** hours until the storm: its clouds gather over the last 3 */
  stormIn?: number;
  storm?: Storm;
  /** ms timestamp of the most recent buy: logs fly into the fire */
  lastBuyAt: number;
  lastBuyBig: boolean;
  /** forest, campfire and storm sound (the header toggle) */
  sound?: boolean;
}
/** Where the fire is on screen (CSS px inside the scene), so the page can float the pot right above it. */
export interface SceneView { fireX: number; fireTop: number; width: number; height: number }

// The art is painted at twice the size it is drawn (AR), so it stays sharp on big and high-density screens.
const AR = 2, aw = (i: { width: number }) => i.width / AR, ah = (i: { height: number }) => i.height / AR;
const W = 1942, H = 809, ZOOM = 1.1, FIRE = { x: 958, y: 605 }, PIT = { x: 958, y: 634 }, LOGS_AT = { x: 825, y: 584 };
const BASE = import.meta.env.BASE_URL;
const THUNDER = ["clap1", "sr1", "sr2", "sr3", "sr4", "dry1", "dry2", "dry3", "dry4"];
const IMAGES = ["a-land.webp", "a-water.webp", "a-logs.webp", "a-tufts.webp", "a-canopy.webp", ...PAINT.clouds.map((c) => c.f),
  ...["bend", "backA", "backB", "frontC", "frontD"].map((n) => `deer-${n}.webp`),
  ...["body", "ears", "backNear", "backFar", "frontNear", "frontFar"].map((n) => `rabbit-${n}.webp`),
  ...["body", "tail", "backNear", "backFar", "frontNear", "frontFar"].map((n) => `squirrel-${n}.webp`),
  "frog-sit.webp", "frog-jump.webp", "bear.webp", "heron.webp"];

// ---- small helpers
const VN = Array.from({ length: 256 }, () => Math.random() * 2 - 1);
function vnoise(v: number) { const i = Math.floor(v), f = v - i, u = f * f * (3 - 2 * f); return VN[i & 255] * (1 - u) + VN[(i + 1) & 255] * u; }
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u, ease = (u: number) => u * u * (3 - 2 * u), clamp01 = (u: number) => Math.max(0, Math.min(1, u));
/** smooth keyframes: kf(p, [[p0, v0], [p1, v1], ...]) eases between the values */
const kf = (p: number, ks: number[][]) => { for (let i = 1; i < ks.length; i++) if (p <= ks[i][0]) { const [a0, v0] = ks[i - 1], [a1, v1] = ks[i], u = (p - a0) / (a1 - a0), e = u * u * (3 - 2 * u); return v0 + (v1 - v0) * e; } return ks[ks.length - 1][1]; };
function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const mk = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const STARS = (() => { const r = rnd(7); return Array.from({ length: 90 }, () => [r() * W, r() * 330, 1.5 + r() * 2.5, r()]); })();
// sky and land tint by hour: [hour, skyTop, skyBottom, landTint, dark(0..1)]
const KEYS: [number, number[], number[], number[], number][] = [
  [0, [10, 14, 38], [26, 34, 72], [70, 80, 140], 1], [5, [12, 16, 44], [40, 44, 90], [80, 88, 150], 0.95],
  [6.2, [92, 90, 160], [245, 160, 110], [230, 180, 160], 0.35], [8, [70, 150, 235], [150, 205, 245], [255, 255, 255], 0],
  [17, [70, 150, 235], [160, 210, 245], [255, 255, 255], 0], [18.6, [90, 70, 150], [245, 130, 80], [240, 170, 140], 0.3],
  [19.8, [20, 22, 60], [70, 50, 110], [90, 90, 160], 0.85], [24, [10, 14, 38], [26, 34, 72], [70, 80, 140], 1]];
function sky(h: number) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [h0, t0, b0, l0, d0] = KEYS[i], [h1, t1, b1, l1, d1] = KEYS[i + 1];
    if (h >= h0 && h <= h1) { const t = (h - h0) / (h1 - h0); return { top: mix(t0, t1, t), bot: mix(b0, b1, t), land: mix(l0, l1, t), dark: d0 + (d1 - d0) * t }; }
  }
  return { top: KEYS[0][1], bot: KEYS[0][2], land: KEYS[0][3], dark: 1 };
}

// ---- the fire: a WebGL flame drawn on its own canvas over the pit and screened onto the scene
const VERT = `#version 300 es
in vec2 a; out vec2 vUv; void main(){ vUv = a*0.5+0.5; gl_Position = vec4(a,0.,1.); }`;
const FRAG = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform float uT, uS, uF; uniform vec2 uRes, uBase; uniform float uUnit;
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
  float s=uS, s3=s*s*s, t=uT; // uT is a phase the page integrates, so a change of size never jumps the motion
  vec2 p=(vUv-uBase)*uRes/uUnit;
  // grows wide first, then climbs tall; the top gets fuller and busier as it grows
  float H=0.2+0.28*s+0.75*s3, W=0.14+0.17*s+0.05*s3;
  vec2 q=vec2(p.x/W, p.y/H);
  vec2 wq=vec2(p.x*6.5, p.y*4.2); // turbulence is fixed in the world, so a bigger fire splits into more tongues
  float n=fbm(vec2(wq.x*0.5, wq.y*0.45-t*1.25));
  float n2=fbm(vec2(wq.x*0.95+n*0.8, wq.y*0.95-t*2.1+n*0.6));
  float lean=0.25*s*s*snoise(vec2(t*0.25,7.));
  float qx=q.x+(0.2+0.45*s*s)*n*max(q.y,0.)+lean*max(q.y,0.)*max(q.y,0.);
  float taper=1.7-0.9*s3;
  float env=clamp(1.0-qx*qx*(0.85+max(q.y,0.)*taper),0.,1.)*clamp(1.0-q.y*(0.8-0.15*s3),0.,1.)*smoothstep(-0.3,0.05,q.y);
  float I=env*(1.2+(0.8+0.3*s3)*n2)-0.14*max(q.y,0.);
  I=clamp(I,0.,1.); I=pow(I,1.3)*uF;
  vec3 c=mix(vec3(.5,.08,.02), vec3(1.,.42,.08), smoothstep(.08,.38,I));
  c=mix(c, vec3(1.,.78,.32), smoothstep(.34,.62,I)); c=mix(c, vec3(1.,.97,.86), smoothstep(.62,.92,I));
  float a=smoothstep(0.05,0.45,I)*smoothstep(-0.07,-0.015,p.y);
  o=vec4(c*a,a);
}`;
function glFire(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true });
  if (!gl) return null;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram()!; gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n: string) => gl.getUniformLocation(pr, n);
  const uT = U("uT"), uS = U("uS"), uF = U("uF"), uRes = U("uRes"), uBase = U("uBase"), uUnit = U("uUnit");
  return (time: number, flick: number, size: number) => {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, time); gl.uniform1f(uS, Math.min(1.1, size)); gl.uniform1f(uF, flick); gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform2f(uBase, 0.5, 1 - 866 / canvas.height); gl.uniform1f(uUnit, 479);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

export function createScene(canvas: HTMLCanvasElement, onView?: (v: SceneView) => void) {
  const out = canvas.getContext("2d")!;
  // how many pixels each painting pixel gets: 1 on a small screen, up to 2 on a big or high-density one (picked once;
  // the layers below are that much bigger and every draw into them is scaled, so world coordinates stay the same)
  let R = (() => { const rc = canvas.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const s = Math.max((rc.width || innerWidth) * d / W, (rc.height || innerHeight * 0.86) * d / H) * ZOOM; return s > 1.6 ? 2 : s > 1.1 ? 1.5 : 1; })();
  const mkL = () => { const c = mk(Math.round(W * R), Math.round(H * R)); c.getContext("2d")!.setTransform(R, 0, 0, R, 0, 0); return c; };
  let world = mkL(), ctx = world.getContext("2d")!;
  let inp: SceneInput = { size: 0.5, hour: 20, threat: 0.2, lastBuyAt: 0, lastBuyBig: false };
  let raf = 0, stopped = false, dpr = 1, cw = 0, ch = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const assets: Record<string, HTMLImageElement> = {};
  let ready = false;
  void Promise.all(IMAGES.concat("plank.webp").map((n) => new Promise<void>((ok) => {
    const i = new Image(); i.onload = () => { assets[n] = i; ok(); }; i.onerror = () => ok(); i.src = n === "plank.webp" ? `${BASE}plank.webp` : `${BASE}scene/${n}`;
  }))).then(() => { if (!stopped && assets["a-land.webp"]) { setup(); ready = true; } });

  // ---- sound: the forest/campfire ambience plus thunder, all through one master gain (the header toggle)
  let ac: AudioContext | null = null, amb: ReturnType<typeof createAmbience> | null = null, loadingThunder = false;
  const thunderBufs: Record<string, AudioBuffer> = {};
  function audio() {
    try {
      ac ??= new AudioContext(); amb ??= createAmbience(ac);
      if (ac.state === "suspended" && inp.sound && !document.hidden) void ac.resume();
    } catch { /* no audio */ }
  }
  async function loadThunder() {
    if (!ac || loadingThunder) return; loadingThunder = true;
    for (const k of THUNDER) { try { const r = await fetch(`${BASE}thunder/${k}.mp3`); thunderBufs[k] = await ac.decodeAudioData(await r.arrayBuffer()); } catch { /* skip */ } }
  }
  // close strikes can crack, distant ones only rumble (muffled, and later after the flash)
  function thunder(I: number, delay: number) {
    try {
      if (!ac || !amb) return; const keys = Object.keys(thunderBufs); if (!keys.length) return;
      const pool = I > 0.6 ? keys : keys.filter((k) => !k.startsWith("clap")); const k = pool[Math.floor(Math.random() * pool.length)];
      const src = ac.createBufferSource(); src.buffer = thunderBufs[k]; src.playbackRate.value = 0.92 + Math.random() * 0.16;
      const g = ac.createGain(); g.gain.value = 0.25 + I * 0.55; const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400 + I * 5000;
      src.connect(lp).connect(g).connect(amb.out); src.start(ac.currentTime + delay);
    } catch { /* ignore */ }
  }

  // ---- layers, built once the art has loaded
  let land = mkL(), lx = land.getContext("2d")!, water = mkL(), wx = water.getContext("2d")!, cl = mkL(), cx = cl.getContext("2d")!;
  let actors = mkL(), ax = actors.getContext("2d")!, glowC = mkL(), glowX = glowC.getContext("2d")!;
  // a device that can't keep up at the sharp size drops back to the painting's own size, once: measured over ~3 s
  // (up to 90 frames) starting a couple of seconds after the art is up
  const perf = { from: 0, n: 0, sum: 0, last: 0 };
  function checkSpeed(now: number) {
    if (R === 1 || perf.from === Infinity || document.hidden) { perf.last = 0; return; }
    const d = perf.last ? now - perf.last : 0; perf.last = now;
    if (!perf.from) { perf.from = now + 2; return; }
    if (now < perf.from || !d || d > 3) return; // a gap that long is a paused tab, not a slow frame
    perf.n++; perf.sum += d;
    if (perf.n < 90 && !(perf.n >= 5 && now - perf.from > 3)) return;
    perf.from = Infinity;
    if (perf.sum / perf.n > 1 / 40) {
      R = 1; world = mkL(); ctx = world.getContext("2d")!;
      land = mkL(); lx = land.getContext("2d")!; water = mkL(); wx = water.getContext("2d")!; cl = mkL(); cx = cl.getContext("2d")!;
      actors = mkL(); ax = actors.getContext("2d")!; glowC = mkL(); glowX = glowC.getContext("2d")!;
    }
  }
  const haze = document.createElement("canvas"), hx = haze.getContext("2d")!;
  const glc = mk(800, 900), glDraw = glFire(glc);
  let clouds: { f: string; x: number; y: number; img?: HTMLImageElement; speed: number }[] = [];
  let ringFront: HTMLCanvasElement | null = null, course: { mid: Float32Array; half: Float32Array; x0: number; x1: number } | null = null;
  function setup() {
    clouds = PAINT.clouds.map((c, i) => ({ ...c, img: assets[c.f], speed: 0.5 + i * 0.3 })); // px per step: a slow drift
    // the stones on the near side of the fire ring, drawn over any animal whose feet are behind them
    { const c = mk(W * AR, H * AR), x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(assets["a-land.webp"], 0, 0);
      const d = x.getImageData(700 * AR, 560 * AR, 520 * AR, 190 * AR), a = d.data;
      for (let i = 0; i < a.length; i += 4) { const r = a[i], g = a[i + 1], b = a[i + 2], y = 560 + Math.floor(i / 4 / (520 * AR)) / AR;
        const stone = Math.abs(r - g) < 18 && Math.abs(g - b) < 22 && r > 95 && r < 215, inkp = r < 60 && g < 60 && b < 60;
        if (!((stone || inkp) && y > 612)) a[i + 3] = 0; }
      ringFront = mk(520 * AR, 190 * AR); ringFront.getContext("2d")!.putImageData(d, 0, 0); }
    // the stream's course, read from its mask: for each column, the middle and half-width of the water
    { const m = assets["a-water.webp"]; if (m) { const c = mk(), x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(m, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data, mid = new Float32Array(W), half = new Float32Array(W); let x0 = W, x1 = 0;
      for (let q = 0; q < W; q++) { let lo = -1, hi = -1; for (let y = 480; y < H; y++) if (d[(y * W + q) * 4 + 3] > 128) { if (lo < 0) lo = y; hi = y; }
        if (lo >= 0 && hi - lo > 6) { mid[q] = (lo + hi) / 2; half[q] = (hi - lo) / 2; x0 = Math.min(x0, q); x1 = Math.max(x1, q); } }
      for (let q = x0; q <= x1; q++) if (!half[q]) { mid[q] = mid[q - 1]; half[q] = half[q - 1]; }
      const sm = (a: Float32Array) => { const o = new Float32Array(W); for (let q = x0; q <= x1; q++) { let s0 = 0, n = 0; for (let k = -30; k <= 30; k++) { const j = q + k; if (j >= x0 && j <= x1) { s0 += a[j]; n++; } } o[q] = s0 / n; } return o; };
      course = { mid: sm(mid), half: sm(half), x0, x1 }; } }
  }
  const ripples = Array.from({ length: 30 }, () => ({ u: Math.random(), o: (Math.random() * 2 - 1) * 0.6, len: 30 + Math.random() * 40, v: 0.03 + Math.random() * 0.025, w: 1.4 + Math.random() * 1.2 }));

  // ---- the storm: clouds roll in for 8 s, lightning to 16 s, rain to 34 s; the fire is beaten down (survives) or
  // dies slowly in the rain, sits as embers, and is relit at 90 s. Timed from the roll's wall clock, so a reload mid-storm
  // lands in the right place. How hard it hits (vis) is set by the storm's size on the 20-step ladder.
  const ost = { phase: "none" as "none" | "in" | "strike" | "rain" | "ashes" | "relight" | "out", vis: 0.6, cover: 0, rainA: 0, at: 0, seen: 0, survived: true, dead: 0,
    bolts: [] as { x: number; cloud: boolean; age: number; life: number; pts: number[][] }[], nextBolt: 0, flash: 0, sizeTo: 0, sizeNow: 0, f: 0 };
  const sclouds = Array.from({ length: 14 }, (_, i) => ({ x: (i / 14) * 1.6 - 0.3, y: 0.02 + ((i * 37) % 50) / 100 * 0.28, s: 0.7 + ((i * 13) % 7) * 0.12, v: 0.0006 + ((i * 7) % 5) * 0.0002 }));
  const drops = Array.from({ length: 900 }, (_, i) => ({ x: Math.random() * 1.6 - 0.3, y: Math.random(), z: i < 300 ? 1 : i < 650 ? 0.6 : 0.35, v: 0, l: 0 }));
  for (const d of drops) { d.v = (0.018 + Math.random() * 0.012) * d.z * 1.6; d.l = (0.05 + Math.random() * 0.05) * d.z; }
  const splashes = Array.from({ length: 80 }, () => ({ x: 0, y: 0, age: 99 }));
  let gust = 0;
  function startStorm(s: Storm) {
    startle();
    ost.seen = s.at; ost.at = s.at; ost.phase = "in"; ost.bolts = []; ost.dead = 0; ost.cover = Math.max(ost.cover, 0.05);
    ost.survived = s.survived; ost.vis = s.intensity; ost.sizeTo = s.survived ? s.sizeAfter ?? inp.size * 0.6 : 0; ost.sizeNow = inp.size;
    audio(); void loadThunder();
  }
  function bolt() {
    const I = ost.vis, inCloud = Math.random() > I * 0.7, bx = 0.15 + Math.random() * 0.7;
    const b = { x: bx, cloud: inCloud, age: 0, life: 8 + Math.random() * 10, pts: [] as number[][] };
    if (!inCloud) { let px = bx * W, py = H * 0.12; b.pts.push([px, py]); while (py < H * 0.55) { px += (Math.random() - .5) * 60; py += 20 + Math.random() * 30; b.pts.push([px, py]); } }
    ost.bolts.push(b); thunder(I, 0.15 + (1 - I) * 1.4 + Math.random() * 0.4);
    ost.flash = (inCloud ? 0.18 : 0.5) + I * 0.35; setTimeout(() => (ost.flash = 0), 60 + Math.random() * 90);
  }
  // Rates below are per 60th of a second (k scales them to the real frame time), so every screen plays it at the same pace.
  function stepStorm(dt: number) {
    const I = ost.vis, age = Date.now() - ost.at, k = dt * 60; ost.f += k;
    if (ost.phase === "in") { ost.cover = Math.min(1, ost.cover + 0.003 * (0.6 + I) * k); if (ost.cover > 0.55 && Math.random() < 0.004 * (0.3 + I * 2) * k) bolt(); if (age > C.IN) ost.phase = "strike"; }
    else if (ost.phase === "strike") { ost.cover = Math.min(1, ost.cover + 0.006 * k); if (ost.f >= ost.nextBolt) { bolt(); ost.nextBolt = ost.f + (30 + Math.random() * 90) * (1.3 - I); } if (age > C.STRIKE) { ost.phase = "rain"; ost.nextBolt = ost.f + 60; } }
    else if (ost.phase === "rain") {
      ost.rainA = Math.min(1, ost.rainA + 0.01 * k); if (Math.random() < 0.003 * (0.2 + I * 2) * k) bolt();
      ost.sizeNow += (ost.sizeTo - ost.sizeNow) * Math.min(1, 0.012 * k);
      if (!ost.survived && age > C.STRIKE + 6000) ost.dead = Math.min(1, ost.dead + 0.004 * k); // dies slowly in the rain
      if (age > C.RAIN) ost.phase = ost.survived ? "out" : "ashes";
    }
    else if (ost.phase === "ashes") { ost.rainA = Math.max(0, ost.rainA - 0.004 * k); ost.cover = Math.max(0.35, ost.cover - 0.002 * k); ost.dead = Math.min(1, ost.dead + 0.01 * k); if (age > C.RELIGHT) { ost.phase = "relight"; ost.sizeNow = 0; } }
    else if (ost.phase === "relight") { ost.dead = Math.max(0, ost.dead - 0.006 * k); ost.sizeNow += (inp.size - ost.sizeNow) * Math.min(1, 0.02 * k); ost.rainA = Math.max(0, ost.rainA - 0.01 * k); ost.cover = Math.max(0, ost.cover - 0.003 * k); if (ost.dead === 0 && ost.cover === 0) ost.phase = "none"; }
    else if (ost.phase === "out") { ost.rainA = Math.max(0, ost.rainA - 0.006 * k); ost.cover = Math.max(0, ost.cover - 0.003 * k); ost.sizeNow += (inp.size - ost.sizeNow) * Math.min(1, 0.004 * k); if (ost.rainA === 0 && ost.cover === 0) { ost.phase = "none"; ost.dead = 0; } }
    for (const b of ost.bolts) b.age += k; ost.bolts = ost.bolts.filter((b) => b.age < b.life);
  }

  // ---- the fire and its logs
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; max: number }[] = [];
  const smoke: { x: number; y: number; r: number; life: number; max: number }[] = [];
  const flying: { t0: number; x0: number; big: boolean }[] = [];
  let sacc = 0, smacc = 0, heat = 0, lastT = 0, firePhase = 0, seenBuy = -1;
  const flameTop = (fs: number) => PIT.y - (0.2 + 0.28 * fs + 0.75 * fs * fs * fs) * 479;
  const fireLight = (t: number) => 0.93 + 0.05 * vnoise(t * 0.9) + 0.025 * vnoise(t * 2.7 + 11) + 0.012 * vnoise(t * 6.1 + 23); // the light breathes
  function tossLog(big: boolean) { // someone threw logs: they fly into the pit
    startle();
    for (let i = 0; i < (big ? 5 : 1); i++) flying.push({ t0: lastT + i * 0.12, x0: 700 + Math.random() * 520, big });
  }
  function drawFlyingLogs(t: number) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], u = (t - f.t0) / 0.9; if (u < 0) continue;
      if (u >= 1) { flying.splice(i, 1); continue; }
      const px = f.x0 + (PIT.x - f.x0) * u, py = H + 60 + (PIT.y - 20 - H - 60) * u - Math.sin(u * Math.PI) * 260;
      ctx.save(); ctx.translate(px, py); ctx.rotate(u * 7); ctx.fillStyle = "#1b1712"; ctx.fillRect(-36, -12, 72, 24);
      ctx.fillStyle = "#7a4a22"; ctx.fillRect(-33, -9, 66, 18); ctx.fillStyle = "#c9955a"; ctx.beginPath(); ctx.ellipse(33, 0, 5, 9, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  }
  // the logs glow warm where they meet the fire: an orange tint, masked to the logs, strongest at the pit's middle
  let tl: HTMLCanvasElement | null = null, hcv: HTMLCanvasElement | null = null, lc: HTMLCanvasElement | null = null;
  function tintedLogs(img: HTMLImageElement) {
    if (tl) return tl; tl = mk(img.width, img.height); const x = tl.getContext("2d")!;
    x.drawImage(img, 0, 0); x.globalCompositeOperation = "source-atop"; x.fillStyle = "rgb(236,96,28)"; x.fillRect(0, 0, img.width, img.height); return tl;
  }
  function drawFire(t: number, dt: number, fs: number, flick: number, dk: number) {
    if (fs > 0.01 && glDraw) {
      glDraw(firePhase, flick, fs);
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.drawImage(glc, 558, -226); ctx.restore();
      if (dk < 0.6) { ctx.save(); ctx.globalAlpha = 0.28 * (1 - dk / 0.6); ctx.drawImage(glc, 558, -226); ctx.restore(); }
    }
    heat += ((fs > 0.01 ? 0.35 + 0.65 * Math.min(1, fs) : 0) - heat) * Math.min(1, dt * (fs > 0.01 ? 2 : 0.12)); // logs keep glowing a while after it dies
    const img = assets["a-logs.webp"];
    if (img) { // built on their own small canvas so the glow and the fading tip stay on the logs
      lc ??= mk(img.width, img.height); const L = lc.getContext("2d")!;
      L.globalCompositeOperation = "source-over"; L.globalAlpha = 1; L.clearRect(0, 0, lc.width, lc.height); L.drawImage(img, 0, 0);
      if (heat > 0.02) {
        hcv ??= mk(img.width, img.height); const x = hcv.getContext("2d")!;
        x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, hcv.width, hcv.height); x.drawImage(tintedLogs(img), 0, 0);
        const gx = (PIT.x - LOGS_AT.x) * AR, gy = (PIT.y - 30 - LOGS_AT.y) * AR, rad = (55 + 55 * Math.min(1, heat)) * AR;
        const g = x.createRadialGradient(gx, gy, 0, gx, gy, rad); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.55, "rgba(0,0,0,0.75)"); g.addColorStop(1, "rgba(0,0,0,0)");
        x.globalCompositeOperation = "destination-in"; x.fillStyle = g; x.fillRect(0, 0, hcv.width, hcv.height);
        L.globalAlpha = Math.min(1, heat * (0.8 + 0.2 * vnoise(t * 1.3 + 5))); L.drawImage(hcv, 0, 0);
        L.globalCompositeOperation = "lighter"; L.globalAlpha = 0.25 * heat * flick; L.drawImage(hcv, 0, 0);
        L.globalCompositeOperation = "source-over"; L.globalAlpha = 1;
      }
      const lit = Math.min(1, fs * 1.6);
      if (lit > 0.01) { // the broken end of the right-hand log sits in the flames: it burns into their colour (plain wood again when the fire is out)
        L.save(); L.scale(AR, AR); L.beginPath(); L.moveTo(194, 4); L.lineTo(242, 4); L.lineTo(242, 38); L.lineTo(214, 54); L.lineTo(194, 52); L.closePath(); L.clip();
        const f = L.createLinearGradient(203, 25, 230, 41); f.addColorStop(0, `rgba(255,236,190,${lit})`); f.addColorStop(0.45, `rgba(255,170,70,${0.75 * lit})`); f.addColorStop(1, "rgba(255,120,40,0)");
        L.globalCompositeOperation = "source-atop"; L.fillStyle = f; L.fillRect(190, 0, 60, 60); L.restore();
      }
      ctx.drawImage(lc, LOGS_AT.x, LOGS_AT.y, aw(img), ah(img));
    }
    // smoke from a big fire, lit warm from below at night; thin grey smoke when it's out
    const top = flameTop(Math.max(fs, 0.2));
    smacc += dt * (fs > 0.4 ? 3 + 9 * fs : fs <= 0.01 && heat > 0.05 ? 3 : 0);
    while (smacc > 1) { smacc--; smoke.push({ x: PIT.x + (Math.random() - 0.5) * 60 * (0.5 + fs), y: fs > 0.01 ? top + 30 : PIT.y - 30, r: 14 + 20 * fs, life: 0, max: 5 + Math.random() * 3 }); }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const m = smoke[i]; m.life += dt; if (m.life > m.max) { smoke.splice(i, 1); continue; }
      const u = m.life / m.max; m.y -= (40 + 30 * fs) * dt; m.x += (14 + 20 * u) * dt; m.r += (10 + 14 * fs) * dt;
      const c = mix([78, 76, 82], [170, 95, 55], Math.max(0, 1 - u * 3) * dk * Math.min(1, fs * 1.5));
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.12 * Math.min(1, m.life * 0.7) * (1 - u)})`; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill();
    }
    if (fs > 0.01) sacc += dt * (2 + 8 * fs + 10 * fs * fs * fs);
    while (sacc > 1) { sacc--; sparks.push({ x: PIT.x + (Math.random() - 0.5) * (60 + 120 * fs), y: PIT.y - 40 - Math.random() * 80, vx: (Math.random() - 0.5) * 50, vy: -(90 + 150 * Math.min(1, fs)) * (0.5 + Math.random()), life: 0, max: 1 + Math.random() * 1.6 }); }
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = sparks.length - 1; i >= 0; i--) {
      const e = sparks[i]; e.life += dt; if (e.life > e.max) { sparks.splice(i, 1); continue; }
      const u = e.life / e.max; e.x += (e.vx + Math.sin(e.life * 5 + i) * 20) * dt; e.y += e.vy * dt;
      ctx.fillStyle = `rgba(255,${190 - u * 100 | 0},80,${1 - u})`; const z = 2.6 * (1 - u) + 1; ctx.fillRect(e.x, e.y, z, z * 2.6);
    }
    ctx.restore();
  }
  // the reveal: when the fire has died, every ticket rises out of the embers as a glowing scrap, swirls up, and thins
  // to one that drifts to where the winner card appears
  const SCRAPS = Array.from({ length: 220 }, () => ({ phase: Math.random() * 6.283, r: 0.4 + Math.random() * 0.6, h: 0.7 + Math.random() * 0.5, spin: Math.random() * 2, delay: Math.random() }));
  function drawScraps(t: number) {
    const s = inp.storm; if (!s || s.survived) return;
    const age = Date.now() - s.at, start = C.OUT_CARD - 3000, end = C.WINNER + 1500;
    if (age <= start || age >= end) return;
    const p = (age - start) / (end - start), nT = Math.min(SCRAPS.length, Math.max(12, Math.round(Math.sqrt(s.tickets ?? 100) * 6)));
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < nT; i++) {
      const sc = SCRAPS[i], born = sc.delay * 0.35; if (p < born) continue;
      const q = Math.min(1, (p - born) / (1 - born)), win = i === 0; // scrap 0 is the winner
      const ang = sc.phase + q * (5 + sc.spin) * Math.PI;
      const rad = (40 + 280 * Math.sin(q * Math.PI) * sc.r) * (win ? Math.max(0.15, 1 - Math.max(0, q - 0.7) / 0.3) : 1);
      const px = PIT.x + Math.cos(ang) * rad, py = PIT.y - 40 - q * 350 * sc.h + Math.sin(ang) * rad * 0.18;
      const fade = win ? 1 : Math.max(0, 1 - Math.max(0, q - 0.62) / 0.3); if (fade <= 0) continue;
      const size = (win ? 8 + q * 20 : 7 + sc.r * 6) * (0.8 + 0.2 * Math.sin(t * 12 + i));
      const settle = win ? Math.max(0, (q - 0.8) / 0.2) : 0;
      ctx.save(); ctx.translate(px + (PIT.x - px) * settle, py + (360 - py) * settle); ctx.rotate(ang * 0.6 + sc.phase);
      ctx.globalAlpha = fade * (0.55 + 0.45 * Math.sin(t * 9 + i));
      ctx.fillStyle = win ? "rgba(255,170,60,0.35)" : "rgba(255,140,40,0.22)"; ctx.fillRect(-size * 1.3, -size * 1.5, size * 2.6, size * 3);
      ctx.fillStyle = win ? "#ffd166" : `hsl(${28 + sc.r * 20} 100% ${60 + sc.r * 15}%)`; ctx.fillRect(-size * 0.6, -size * 0.8, size * 1.2, size * 1.6);
      ctx.restore();
    }
    ctx.restore();
  }
  function drawWheel(frame: number) {
    const wh = PAINT.wheel, off = (frame * 6) % wh.h;
    ctx.save(); ctx.beginPath(); ctx.rect(wh.x, wh.y, wh.w, wh.h); ctx.clip();
    ctx.drawImage(land, wh.x * R, wh.y * R, wh.w * R, wh.h * R, wh.x, wh.y + off, wh.w, wh.h);
    ctx.drawImage(land, wh.x * R, wh.y * R, wh.w * R, wh.h * R, wh.x, wh.y + off - wh.h, wh.w, wh.h);
    ctx.restore();
  }
  function drawSun(px: number, py: number) {
    ctx.save(); ctx.translate(px, py); ctx.lineWidth = 4; ctx.strokeStyle = "#1b1712"; ctx.lineJoin = "round";
    ctx.beginPath(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.lineTo(Math.cos(a) * 78, Math.sin(a) * 78); ctx.lineTo(Math.cos(a + 0.26) * 58, Math.sin(a + 0.26) * 58); }
    ctx.closePath(); ctx.fillStyle = "#ffb52e"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.fillStyle = "#ffd84a"; ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function drawMoon(px: number, py: number) {
    ctx.save(); ctx.beginPath(); ctx.arc(px, py, 44, 0.35 * Math.PI, 1.65 * Math.PI, false); ctx.arc(px + 22, py - 6, 38, 1.55 * Math.PI, 0.45 * Math.PI, true); ctx.closePath();
    ctx.fillStyle = "#f4ecd0"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#1b1712"; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore();
  }
  // the Plank & Paper sign over the press, painted into the ground layer so it takes the same light as the mill
  function drawSign(x: CanvasRenderingContext2D) {
    const sx = 1436, sy = 424, w = 106, h = 24;
    x.save(); x.fillStyle = "#1b1712"; x.fillRect(sx - 3, sy - 3, w + 6, h + 6); x.fillStyle = "#1f5a45"; x.fillRect(sx, sy, w, h);
    x.strokeStyle = "#d8ae4a"; x.lineWidth = 1.6; x.strokeRect(sx + 3, sy + 3, w - 6, h - 6);
    x.fillStyle = "#2a2014"; for (const nx of [sx + 7, sx + w - 7]) { x.beginPath(); x.arc(nx, sy + h / 2, 1.6, 0, 7); x.fill(); }
    x.textAlign = "center"; x.textBaseline = "middle";
    if ("letterSpacing" in x) (x as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0.4px";
    // the widest size that fits between the two nails (fonts differ by device, so measure rather than guess)
    for (let px = 11.5; px >= 7; px -= 0.5) { x.font = `700 ${px}px Georgia, 'Times New Roman', serif`; if (x.measureText("PLANK & PAPER").width <= w - 24) break; }
    x.fillStyle = "#0e2a20"; x.fillText("PLANK & PAPER", sx + w / 2 + 0.8, sy + h / 2 + 1.6); x.fillStyle = "#f2c85e"; x.fillText("PLANK & PAPER", sx + w / 2, sy + h / 2 + 0.8);
    x.restore();
  }
  // Plank, kicked back in a camp chair left of the pit, toasting a marshmallow
  function drawPlank(x: CanvasRenderingContext2D, t: number) {
    const inkc = "#1b1712", gx = 640, gy = 728, sy0 = gy - 74;
    x.save(); x.lineJoin = "round"; x.lineCap = "round";
    const tube = (pts: number[][]) => { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) x.lineTo(q[0], q[1]); x.strokeStyle = inkc; x.lineWidth = 9; x.stroke(); x.strokeStyle = "#b9bcc4"; x.lineWidth = 5; x.stroke(); };
    const quad = (pts: number[][], fill: string) => { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) x.lineTo(q[0], q[1]); x.closePath(); x.fillStyle = fill; x.fill(); x.strokeStyle = inkc; x.lineWidth = 4; x.stroke(); };
    tube([[gx - 46, gy], [gx + 42, sy0]]); tube([[gx + 42, gy], [gx - 46, sy0]]); // X legs under the seat
    tube([[gx - 50, gy], [gx - 50, sy0], [gx - 78, gy - 205]]); // rear leg running up the back
    quad([[gx - 50, sy0 - 2], [gx - 34, sy0 - 4], [gx - 60, gy - 200], [gx - 76, gy - 198]], "#2e7d52"); // back canvas
    const img = assets["plank.webp"];
    if (img) { x.save(); x.translate(gx - 4, sy0 + 2); x.rotate(-0.3); const h = 148, w = h * img.width / img.height; x.drawImage(img, -w / 2, -h, w, h); x.restore(); }
    quad([[gx - 54, sy0 - 8], [gx + 50, sy0 - 8], [gx + 46, sy0 + 8], [gx - 50, sy0 + 8]], "#35915f"); // seat canvas
    tube([[gx + 46, gy], [gx + 46, sy0 - 48]]); tube([[gx - 62, gy - 128], [gx + 52, sy0 - 50]]); // front leg, armrest
    const bob = Math.sin(t * 0.8) * 3, sx = gx + 40, sy = gy - 120, ex = 862, ey = 575 + bob; // the stick, out toward the fire
    x.strokeStyle = inkc; x.lineWidth = 8; x.beginPath(); x.moveTo(sx, sy); x.lineTo(ex, ey); x.stroke(); x.strokeStyle = "#8a5a2b"; x.lineWidth = 4; x.stroke();
    const u = (t % 25) / 25, c0 = [250, 248, 240], c1 = [236, 186, 98], c2 = [132, 84, 40]; // the marshmallow toasts, then a fresh one goes on
    const col = u < 0.6 ? mix(c0, c1, u / 0.6) : mix(c1, c2, (u - 0.6) / 0.4);
    x.save(); x.translate(ex + 10, ey - 2); x.rotate(-0.42); x.beginPath(); x.roundRect(-13, -10, 26, 20, 7);
    x.fillStyle = rgb(col); x.fill(); x.strokeStyle = inkc; x.lineWidth = 3.5; x.stroke(); x.restore();
    x.restore();
  }

  // ---- depth: after an animal is drawn, any weed or bush whose base is lower on screen than its feet goes back over it
  function inFront(x: CanvasRenderingContext2D, footY: number, xa: number, xb: number) {
    const img = assets["a-tufts.webp"]; if (!img) return;
    for (const [sx, sy, w, h, base] of TUFTS) if (base > footY && sx < xb && sx + w > xa) x.drawImage(img, sx * AR, sy * AR, w * AR, h * AR, sx, sy, w, h);
  }
  // ---- the deer: walks in from the left, grazes, turns back (land animals never cross the stream)
  const deer = { active: false, x: -200, dir: 1, phase: 0, graze: 0, mode: "walk", until: 0, stopAt: 380 };
  function sendDeer() { if (deer.active) return; Object.assign(deer, { active: true, x: -160, dir: 1, phase: 0, graze: 0, mode: "walk", stopAt: 250 + Math.random() * 170 }); }
  function drawDeer(x: CanvasRenderingContext2D, t: number, dt: number) {
    if (!deer.active) return;
    const k = 0.5, groundY = 604, speed = 72;
    if (deer.mode === "walk") {
      deer.x += speed * dt * deer.dir; deer.phase += dt * 6.2;
      if (deer.dir > 0 && deer.stopAt && deer.x >= deer.stopAt) { deer.mode = "graze"; deer.until = t + 5 + Math.random() * 2; deer.stopAt = 0; }
      if (deer.dir < 0 && deer.x < -220) { deer.active = false; return; }
    } else if (deer.mode === "graze") { deer.phase += (Math.round(deer.phase / Math.PI) * Math.PI - deer.phase) * Math.min(1, dt * 6); if (t > deer.until) { deer.mode = "turn"; deer.until = t + 0.6; } }
    else if (deer.mode === "turn") { if (t > deer.until) { deer.dir = -1; deer.mode = "walk"; } }
    deer.graze += ((deer.mode === "graze" ? 1 : 0) - deer.graze) * Math.min(1, dt * 1.8); // 0 = head up, 1 = nose in the grass
    const sw = Math.sin(deer.phase) * 0.3, bob = deer.mode === "walk" ? -Math.abs(Math.sin(deer.phase)) * 3 : 0;
    x.save(); x.translate(deer.x, 0); x.scale(deer.dir, 1);
    const ox = -DEER.W * k / 2, oy = groundY - DEER.foot * k;
    const part = (name: "backA" | "backB" | "frontC" | "frontD", ang: number) => { const pp = DEER[name], img = assets[`deer-${name}.webp`]; if (!img) return;
      x.save(); x.translate(ox + pp.px * k, oy + pp.py * k); x.rotate(ang); x.drawImage(img, (pp.x - pp.px) * k, (pp.y - pp.py) * k, aw(img) * k, ah(img) * k); x.restore(); };
    const g = deer.graze, e = ease(g), tilt = 0.1 * e, hip = DEER.backA;
    part("backB", -sw); part("backA", sw);
    x.save(); x.translate(ox + hip.px * k, oy + hip.py * k + bob); x.rotate(tilt); x.translate(-(ox + hip.px * k), -(oy + hip.py * k + bob));
    part("frontC", -sw - tilt * 0.8); part("frontD", sw - tilt * 0.8);
    // body + neck are one pre-bent drawing (12 poses, head up -> nose in the grass), so the shoulder never splits
    const nibble = g > 0.85 ? Math.max(0, Math.sin(t * 2.3)) * 1.4 : 0, sheet = assets["deer-bend.webp"];
    const fi = Math.max(0, Math.min(10, Math.round(e * 10 - nibble))); // pose 11 of the sheet clips the nose, so the graze stops at 10
    if (sheet) { const fw = sheet.width / 4, fh = sheet.height / 3; x.drawImage(sheet, (fi % 4) * fw, Math.floor(fi / 4) * fh, fw, fh, ox, oy + bob, fw / AR * k, fh / AR * k); } // 12 poses, 4 x 3
    x.restore(); x.restore();
    if (ringFront && deer.x > 640 && deer.x < 1280) x.drawImage(ringFront, 700, 560, 520, 190);
    inFront(x, groundY, deer.x - 95, deer.x + 95);
  }
  // ---- the frog: surfaces in the stream by the near bank, hops along the grass, hops back and dives in
  const frogRings: { x: number; y: number; t0: number; big: boolean }[] = [];
  function drawFrogRings(x: CanvasRenderingContext2D, t: number) {
    for (let i = frogRings.length - 1; i >= 0; i--) { const sp = frogRings[i], age = t - sp.t0; if (age > 1.6) { frogRings.splice(i, 1); continue; }
      x.save(); x.strokeStyle = "#eef8ff"; x.lineWidth = 1.4;
      for (let r = 0; r < 2; r++) { const a2 = age - r * 0.25; if (a2 < 0) continue; const rad = 3 + a2 * (sp.big ? 20 : 12);
        x.globalAlpha = Math.max(0, 0.9 - a2 / 1.3); x.beginPath(); x.ellipse(sp.x, sp.y, rad, rad * 0.32, 0, 0, Math.PI * 2); x.stroke(); }
      if (sp.big && age < 0.45) { x.globalAlpha = 1 - age / 0.45; x.fillStyle = "#eef8ff";
        for (let d = 0; d < 7; d++) { const ang = -Math.PI / 2 + (d - 3) * 0.35, v = 38 + (d % 3) * 10;
          x.beginPath(); x.arc(sp.x + Math.cos(ang) * v * age * 0.6, sp.y + Math.sin(ang) * v * age + 160 * age * age, 1.3, 0, 7); x.fill(); } }
      x.restore(); }
  }
  type Leg = [string, number, { x: number; y: number }?];
  const frog = { active: false, legs: [] as Leg[], i: 0, t0: null as number | null, x: 0, y: 0, dir: -1, from: { x: 0, y: 0 }, splashed: false, turned: false, leftWater: false };
  const F_IN = { x: 1624, y: 607 }, F_PTS = [{ x: 1585, y: 628 }, { x: 1553, y: 639 }, { x: 1522, y: 645 }];
  function sendFrog() { if (frog.active) return;
    const back = [{ x: F_PTS[1].x + 2, y: F_PTS[1].y - 1 }, { x: F_PTS[0].x + 3, y: F_PTS[0].y }];
    const legs: Leg[] = [["rise", 1.8], ["wait", 1 + Math.random()], ["jump", 0.5, F_PTS[0]], ["sit", 0.7 + Math.random() * 0.8], ["jump", 0.42, F_PTS[1]], ["sit", 0.5 + Math.random()],
      ["jump", 0.42, F_PTS[2]], ["look", 2.5 + Math.random() * 2], ["jump", 0.42, back[0]], ["sit", 0.5 + Math.random() * 0.6], ["jump", 0.42, back[1]], ["sit", 0.6], ["dive", 0.5, { x: F_IN.x + 8, y: F_IN.y + 26 }], ["gone", 1.6]];
    Object.assign(frog, { active: true, legs, i: 0, t0: null, x: F_IN.x, y: F_IN.y + 34, dir: -1, splashed: false, turned: false, leftWater: false }); }
  function drawFrog(x: CanvasRenderingContext2D, t: number) {
    if (!frog.active) return;
    if (frog.t0 === null) { frog.t0 = t; frog.from = { x: frog.x, y: frog.y }; if (frog.legs[frog.i][0] === "rise") frogRings.push({ x: F_IN.x, y: F_IN.y + 2, t0: t, big: false }); }
    const [kind, dur, to] = frog.legs[frog.i], u = clamp01((t - frog.t0) / dur);
    let sprite: "frog-sit" | "frog-jump" = "frog-sit", ang = 0, sy = 1, lift = 0;
    if (kind === "rise") frog.y = lerp(F_IN.y + 34, F_IN.y + 9, ease(u));
    else if ((kind === "jump" || kind === "dive") && to) {
      const f = frog.from; frog.dir = to.x < f.x ? -1 : 1;
      if (u < 0.15) sy = 1 - 0.12 * Math.sin(u / 0.15 * Math.PI); // a quick crouch, then it springs
      else { const v = (u - 0.15) / 0.85; sprite = "frog-jump"; frog.x = lerp(f.x, to.x, v); frog.y = lerp(f.y, to.y, v); lift = 4 * v * (1 - v) * (kind === "dive" ? 20 : 15);
        ang = (kind === "dive" ? 0.9 : 0.55) * (v - 0.5) * 1.2;
        if (kind === "dive" && !frog.splashed && frog.y - lift > F_IN.y - 2 && v > 0.5) { frog.splashed = true; frogRings.push({ x: frog.x, y: F_IN.y + 2, t0: t, big: true }); } }
      if (kind === "jump" && f.x >= 1600 && u > 0.15 && !frog.leftWater) { frog.leftWater = true; frogRings.push({ x: f.x, y: F_IN.y + 2, t0: t, big: false }); }
    } else if (kind === "look") { if (u > 0.45 && !frog.turned) { frog.turned = true; frog.dir = 1; } sy = 1 + Math.max(0, Math.sin(t * 9)) * 0.03; }
    else if (kind === "sit" || kind === "wait") { sy = 1 + Math.max(0, Math.sin(t * 9)) * 0.03; if (u < 0.2 && frog.i > 1) sy *= 1 - 0.08 * (1 - u / 0.2); }
    if (kind !== "gone") {
      const info = SOLO[sprite], img = assets[`${sprite}.webp`], k = 0.34;
      x.save();
      x.beginPath(); x.rect(0, 0, W, H); x.moveTo(1600, F_IN.y); x.lineTo(1600, H); x.lineTo(W, H); x.lineTo(W, F_IN.y); x.closePath(); x.clip("evenodd"); // below the water line it's hidden
      x.translate(frog.x, frog.y - lift); x.scale(frog.dir, 1);
      if (img) { if (sprite === "frog-jump") { x.rotate(ang); x.drawImage(img, -info.cx * k, -info.cy * k - 8, info.w * k, info.h * k); }
        else { x.scale(1, sy); x.drawImage(img, -info.cx * k, -info.foot * k, info.w * k, info.h * k); } }
      x.restore();
      inFront(x, frog.y, frog.x - 26, frog.x + 26);
    }
    if (u >= 1) { if (kind === "gone") { frog.active = false; return; } frog.i++; frog.t0 = t; frog.from = { x: frog.x, y: frog.y }; frog.leftWater = false; }
  }
  // ---- the squirrel: head-first down one pine on the left, scampers across, sits, runs up the other pine
  const TREES = [{ x: 186, top: 513, ground: 541 }, { x: 342, top: 531, ground: 562 }];
  const sq = { active: false, S: TREES[0], T: TREES[1], dir: 1, mode: "down", y: 0, x: 0, gait: 0, rot: 0, until: 0, sat: false, look: 0, y0: 0, xs: 0 };
  function sendSquirrel() { if (sq.active) return; const ab = Math.random() < 0.5, S = TREES[ab ? 0 : 1], T = TREES[ab ? 1 : 0];
    Object.assign(sq, { active: true, S, T, dir: T.x > S.x ? 1 : -1, mode: "down", y: S.top - 30, x: S.x, gait: 0, rot: Math.PI / 2, until: 0, sat: false, look: 0 }); }
  function drawSquirrel(x: CanvasRenderingContext2D, t: number, dt: number) {
    if (!sq.active) return;
    const k = 0.3, len = (SQ.x1 - SQ.x0) * k, half = (SQ.foot - SQ.top) * k / 2, ccx = (SQ.x0 + SQ.x1) / 2, ccy = (SQ.top + SQ.foot) / 2;
    let moving = true, speed = 0;
    const gy = (xx: number) => lerp(sq.S.ground, sq.T.ground, clamp01((xx - sq.S.x) / (sq.T.x - sq.S.x))) - half;
    if (sq.mode === "down") { speed = 34; sq.y += speed * dt; sq.rot = Math.PI / 2; if (sq.y >= sq.S.ground - len / 2 + 2) { sq.mode = "turn"; sq.until = t + 0.3; sq.y0 = sq.y; } }
    else if (sq.mode === "turn") { const u = clamp01(1 - (sq.until - t) / 0.3); sq.rot = lerp(Math.PI / 2, 0, ease(u)); sq.x = sq.S.x + sq.dir * len * 0.25 * ease(u); sq.y = lerp(sq.y0, gy(sq.x), ease(u)); moving = false; if (u >= 1) sq.mode = "run"; }
    else if (sq.mode === "run") { speed = 80; sq.x += speed * dt * sq.dir; sq.y = gy(sq.x);
      const mid = (sq.S.x + sq.T.x) / 2; if (!sq.sat && (sq.x - mid) * sq.dir > -10) { sq.sat = true; sq.mode = "sit"; sq.until = t + 1.6 + Math.random() * 1.6; }
      if ((sq.x - sq.T.x) * sq.dir > -len * 0.25) { sq.mode = "turnUp"; sq.until = t + 0.3; sq.y0 = sq.y; sq.xs = sq.x; } }
    else if (sq.mode === "sit") { moving = false; if (!sq.look && Math.random() < dt * 0.6) sq.look = t; if (sq.look && t - sq.look > 0.7) sq.look = 0; if (t > sq.until) { sq.mode = "run"; sq.look = 0; } }
    else if (sq.mode === "turnUp") { const u = clamp01(1 - (sq.until - t) / 0.3); sq.rot = lerp(0, -Math.PI / 2, ease(u)); sq.x = lerp(sq.xs, sq.T.x, ease(u)); sq.y = lerp(sq.y0, sq.T.ground - len / 2 - 2, ease(u)); moving = false; if (u >= 1) sq.mode = "up"; }
    else if (sq.mode === "up") { speed = 38; sq.y -= speed * dt; sq.rot = -Math.PI / 2; if (sq.y < sq.T.top - len) { sq.active = false; return; } }
    if (moving) sq.gait += dt * speed / 22;
    const p = moving ? sq.gait % 1 : 0;
    const legB = moving ? kf(p, [[0, 0], [0.3, 0.9], [0.62, 0.5], [0.88, -0.45], [1, 0]]) : 0, legF = moving ? kf(p, [[0, 0], [0.25, 0.3], [0.6, -0.6], [0.8, 0.05], [1, 0]]) : 0;
    const lift = moving ? Math.sin(Math.PI * p) * 3 : 0;
    const tail = moving ? Math.sin(p * Math.PI * 2) * 0.12 : (sq.mode === "sit" ? Math.max(0, Math.sin(t * 7)) ** 3 * 0.25 : 0);
    const face = sq.look ? -sq.dir : sq.dir;
    x.save(); x.translate(sq.x, sq.y); x.scale(face, 1); x.rotate(face === sq.dir ? sq.rot : -sq.rot); x.translate(0, -lift);
    const part = (name: "tail" | "backFar" | "frontFar" | "backNear" | "frontNear" | "body", ang: number) => { const pp = SQ[name], img = assets[`squirrel-${name}.webp`]; if (!img) return;
      x.save(); x.translate((pp.px - ccx) * k, (pp.py - ccy) * k); x.rotate(ang); x.drawImage(img, (pp.x - pp.px) * k, (pp.y - pp.py) * k, aw(img) * k, ah(img) * k); x.restore(); };
    part("tail", -tail); part("backFar", legB * 0.85); part("frontFar", legF * 0.85); part("backNear", legB); part("frontNear", legF); part("body", 0);
    x.restore();
    const can = assets["a-canopy.webp"]; if (can && sq.mode !== "run" && sq.mode !== "sit") x.drawImage(can, 110, 380, aw(can), ah(can)); // on a trunk the branches stay in front
    inFront(x, sq.y + half, sq.x - 25, sq.x + 25);
  }
  // ---- the bear (bottom-left bush) and the heron (bottom-right bush) peek up over the leaves, look around, sink back
  type Peek = { x: number; hide: number; l1: number; l2: number; pivot: number; active: boolean; t0: number | null; hold: number; duck: number | { t: number; from: number }; lastTop?: number };
  const peekers: Record<"bear" | "heron", Peek> = {
    bear: { x: 165, hide: 790, l1: 652, l2: 606, pivot: 720, active: false, t0: null, hold: 5, duck: 0 },
    heron: { x: 1808, hide: 705, l1: 598, l2: 540, pivot: 646, active: false, t0: null, hold: 5, duck: 0 } };
  function sendPeek(name: "bear" | "heron") { const pk = peekers[name]; if (pk.active) return; Object.assign(pk, { active: true, t0: null, hold: 4 + Math.random() * 2.5, duck: 0, lastTop: undefined }); }
  function drawPeek(x: CanvasRenderingContext2D, t: number, name: "bear" | "heron") {
    const pk = peekers[name]; if (!pk.active) return;
    if (pk.t0 === null) pk.t0 = t;
    const a = t - pk.t0, T1 = 1.8, H1 = 1.3, T2 = 1.2, H2 = pk.hold, T3 = 2.0; let top: number;
    if (pk.duck) { if (pk.duck === 1) pk.duck = { t, from: pk.lastTop ?? pk.hide }; const d = pk.duck as { t: number; from: number }, u = clamp01((t - d.t) / 0.45); top = lerp(d.from, pk.hide, u * u); if (u >= 1) { pk.active = false; return; } }
    else if (a < T1) top = lerp(pk.hide, pk.l1, ease(a / T1));
    else if (a < T1 + H1) top = pk.l1 + Math.sin((a - T1) * 3) * 1.2;
    else if (a < T1 + H1 + T2) top = lerp(pk.l1, pk.l2, ease((a - T1 - H1) / T2));
    else if (a < T1 + H1 + T2 + H2) top = pk.l2 + Math.sin((a - T1 - H1 - T2) * 1.7) * 1.5;
    else if (a < T1 + H1 + T2 + H2 + T3) top = lerp(pk.l2, pk.hide, ease((a - T1 - H1 - T2 - H2) / T3));
    else { pk.active = false; return; }
    pk.lastTop = top;
    const holding = a > T1 + H1 + T2 && a < T1 + H1 + T2 + H2;
    const look = (a > T1 ? Math.sin((a - T1) * 0.9) : 0) * (name === "heron" ? 0.13 : 0.07);
    const blink = a % 2.9 > 2.75 || (holding && (a - T1 - H1 - T2) % 3.7 > 3.58);
    const info = SOLO[name], img = assets[`${name}.webp`]; if (!img) return;
    x.save(); x.translate(pk.x, pk.pivot); x.rotate(look); x.translate(-pk.x, -pk.pivot);
    const ox = pk.x - info.w / 2; x.drawImage(img, ox, top, info.w, info.h);
    if (blink) { x.fillStyle = `rgb(${info.lid.join(",")})`; x.strokeStyle = "#1b1712"; x.lineWidth = 1;
      for (const [ex, ey, rx, ry] of info.eyes) { x.beginPath(); x.ellipse(ox + ex, top + ey, rx, ry, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.moveTo(ox + ex - rx, top + ey + ry * 0.2); x.quadraticCurveTo(ox + ex, top + ey + ry * 0.7, ox + ex + rx, top + ey + ry * 0.2); x.stroke(); } }
    x.restore();
    inFront(x, 800, pk.x - info.w / 2 - 12, pk.x + info.w / 2 + 12);
  }
  // ---- the rabbit: hops out of the bottom-right bush, freezes and sniffs, hops home; a log toss or a storm sends it bolting
  const rab = { active: false, x: 1760, dir: -1, mode: "hop", hop: 0, burst: 3, until: 0, stopAt: 1300, flee: false, look: 0, ear: 0, visits: 0 };
  function sendRabbit() { if (rab.active) return; Object.assign(rab, { active: true, x: 1730, dir: -1, mode: "hop", hop: 0, burst: 3, until: 0, flee: false, look: 0, stopAt: 1300 + Math.random() * 180, visits: 1 + Math.floor(Math.random() * 2) }); }
  function startle() { for (const pk of Object.values(peekers)) if (pk.active && !pk.duck) pk.duck = 1;
    if (rab.active && !rab.flee && rab.dir < 0) { rab.flee = true; rab.dir = 1; rab.mode = "hop"; rab.hop = 0; rab.look = 0; } }
  function drawRabbit(x: CanvasRenderingContext2D, t: number, dt: number) {
    if (!rab.active) return;
    const k = 0.42, groundY = 776, hopLen = rab.flee ? 66 : 40, hopT = rab.flee ? 0.3 : 0.38;
    let p = 0;
    if (rab.mode === "hop") {
      rab.hop += dt / hopT; p = Math.min(1, rab.hop);
      const q = clamp01((p - 0.08) / 0.72); rab.x += (hopLen / hopT) * dt * rab.dir * (0.25 + 1.5 * Math.sin(Math.PI * q) ** 2 * 0.9);
      if (rab.hop >= 1) { rab.hop = 0; p = 0; rab.burst--;
        if (rab.dir < 0 && rab.x <= rab.stopAt) { rab.mode = "alert"; rab.until = t + 2.5 + Math.random() * 3; }
        else if (rab.dir > 0 && rab.x > 1780) { rab.active = false; return; }
        else if (!rab.flee && rab.burst <= 0) { rab.mode = "pause"; rab.until = t + 0.5 + Math.random() * 0.9; rab.burst = 2 + Math.floor(Math.random() * 3); } }
    } else if (rab.mode === "pause") { if (t > rab.until) rab.mode = "hop"; }
    else if (rab.mode === "alert") {
      if (Math.random() < dt * 0.5) rab.ear = t;
      if (!rab.look && Math.random() < dt * 0.25) rab.look = t;
      if (rab.look && t - rab.look > 0.9) rab.look = 0;
      if (t > rab.until) { rab.visits--; rab.look = 0;
        if (rab.visits > 0) { rab.stopAt = Math.max(1280, rab.x - 50 - Math.random() * 70); rab.mode = "hop"; rab.burst = 2; }
        else { rab.dir = 1; rab.mode = "hop"; rab.burst = 9; } }
    }
    const inAir = rab.mode === "hop", q = clamp01((p - 0.08) / 0.72);
    const lift = inAir ? Math.sin(Math.PI * q) * (rab.flee ? 20 : 12) : 0;
    const pitch = inAir ? kf(p, [[0, 0], [0.2, -0.13], [0.55, 0.02], [0.8, 0.12], [1, 0]]) : 0;
    const legB = inAir ? kf(p, [[0, 0], [0.3, 0.95], [0.62, 0.55], [0.88, -0.4], [1, 0]]) : 0;
    const legF = inAir ? kf(p, [[0, 0], [0.25, 0.25], [0.6, -0.55], [0.8, 0.05], [1, 0]]) : 0;
    const sx = inAir ? 1 + 0.08 * Math.sin(Math.PI * q) : 1, sy = inAir ? kf(p, [[0, 0.95], [0.12, 1.02], [0.8, 1], [0.9, 0.94], [1, 1]]) : 1;
    const face = rab.look && rab.mode === "alert" ? -rab.dir : rab.dir;
    const sniff = rab.mode === "alert" || rab.mode === "pause" ? Math.max(0, Math.sin(t * 14)) * 0.5 : 0;
    const flick = rab.ear && t - rab.ear < 0.35 ? Math.sin((t - rab.ear) / 0.35 * Math.PI) * 0.22 : 0;
    const earAng = flick + (inAir ? -0.2 * Math.sin(Math.PI * q) + kf(p, [[0, 0], [0.85, 0], [0.93, 0.12], [1, 0]]) : 0);
    x.save(); x.translate(rab.x, 0); x.scale(face, 1);
    const ox = -RAB.cx * k, oy = groundY - RAB.foot * k - lift + sniff, cx0 = ox + 170 * k, cy0 = groundY - lift;
    x.translate(cx0, cy0); x.rotate(pitch); x.scale(sx, sy); x.translate(-cx0, -cy0);
    const part = (name: "ears" | "body" | "backNear" | "backFar" | "frontNear" | "frontFar", ang: number) => { const pp = RAB[name], img = assets[`rabbit-${name}.webp`]; if (!img) return;
      x.save(); x.translate(ox + pp.px * k, oy + pp.py * k); x.rotate(ang); x.drawImage(img, (pp.x - pp.px) * k, (pp.y - pp.py) * k, aw(img) * k, ah(img) * k); x.restore(); };
    part("backFar", legB * 0.85); part("frontFar", legF * 0.85); part("ears", -earAng); part("backNear", legB); part("frontNear", legF); part("body", 0);
    x.restore();
    inFront(x, 776, rab.x - 60, rab.x + 60);
  }
  // ---- visitors: the first 4-12 min after the page opens, then one every 15-40 min, one at a time. The bear only
  // comes at night; the squirrel and the heron by day.
  let nextVisit = performance.now() / 1000 + 240 + Math.random() * 480, night = 0;
  const busy = () => deer.active || rab.active || frog.active || sq.active || peekers.bear.active || peekers.heron.active;
  // ---- birds: a few classic black "m" strokes flapping across the daytime sky every few minutes
  type Bird = { x: number; y: number; s: number; ph: number; glide: number };
  const flock = { active: false, dir: 1, v: 70, birds: [] as Bird[] };
  let nextFlock = performance.now() / 1000 + 40 + Math.random() * 80;
  function sendBirds() {
    if (flock.active) return;
    const dir = Math.random() < 0.5 ? 1 : -1, n = 2 + Math.floor(Math.random() * 4), y0 = 110 + Math.random() * 170, x0 = dir > 0 ? -60 : W + 60;
    flock.birds = Array.from({ length: n }, (_, i) => ({ x: x0 - dir * (i * (40 + Math.random() * 30)), y: y0 + (Math.random() - 0.5) * 70, s: 0.7 + Math.random() * 0.5, ph: Math.random() * 6, glide: 0 }));
    Object.assign(flock, { active: true, dir, v: 55 + Math.random() * 35 });
  }
  function drawBirds(t: number, dt: number, fade: number) {
    if (!flock.active) return;
    ctx.save(); ctx.strokeStyle = `rgba(27,23,18,${fade})`; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const b of flock.birds) {
      b.x += flock.dir * flock.v * b.s * dt; b.y += Math.sin(t * 0.7 + b.ph) * 4 * dt;
      if (b.glide > 0) b.glide -= dt; else { b.ph += dt * 9; if (Math.random() < dt * 0.25) b.glide = 0.8 + Math.random() * 1.2; }
      const span = 19 * b.s, flap = b.glide > 0 ? 0.25 : Math.sin(b.ph), tip = -flap * 9 * b.s, mid = 4 * b.s;
      ctx.lineWidth = 3.2 * b.s; ctx.beginPath();
      ctx.moveTo(b.x - span, b.y + tip); ctx.quadraticCurveTo(b.x - span * 0.45, b.y - 8 * b.s + tip * 0.3, b.x, b.y + mid);
      ctx.quadraticCurveTo(b.x + span * 0.45, b.y - 8 * b.s + tip * 0.3, b.x + span, b.y + tip); ctx.stroke();
    }
    ctx.restore();
    if (flock.birds.every((b) => (flock.dir > 0 ? b.x > W + 60 : b.x < -60))) flock.active = false;
  }
  function visitor(kind: Kind) {
    if (kind === "birds") { sendBirds(); return; }
    if (kind === "deer") sendDeer(); else if (kind === "rabbit") sendRabbit(); else if (kind === "frog") sendFrog();
    else if (kind === "squirrel") sendSquirrel(); else if (kind === "bear" || kind === "heron") sendPeek(kind);
  }
  function wildlife(t: number) {
    if (t < nextVisit || busy() || ost.phase !== "none") return;
    nextVisit = t + 900 + Math.random() * 1500;
    const pool: Kind[] = night > 0.6 ? ["bear", "deer", "rabbit", "frog"] : ["deer", "rabbit", "squirrel", "heron", "frog"];
    visitor(pool[Math.floor(Math.random() * pool.length)]);
  }
  /** where the camera should look while an animal is out (painting x), or null */
  function actorFocus(): number | null {
    if (peekers.bear.active) return peekers.bear.x; if (peekers.heron.active) return peekers.heron.x;
    if (frog.active) return frog.x; if (rab.active) return rab.x; if (sq.active) return sq.x; if (deer.active) return deer.x;
    return null;
  }

  // ---- the camera: crop the painting to fill the canvas. Wide screens centre on the fire; an upright phone frames
  // Plank and the fire, can be dragged sideways, drifts back when let go, and pans to an animal that shows up.
  const cam = { x: FIRE.x, drag: null as null | { x0: number; cam0: number; id: number }, lastDrag: -99, placed: false };
  const zx = (px: number) => FIRE.x + (px - FIRE.x) * ZOOM; // painting x after the scene's 1.1x zoom on the ground
  function camRange(scale: number) { const half = cw / 2 / scale; return [half, W - half]; } // limits for the view centre
  // Only an upright phone moves: it frames Plank and the fire, can be dragged, and nudges over to a visiting animal.
  // Anything wider (desktop, tablet, a phone on its side) holds perfectly still, centred on the fire.
  const upright = () => cw / ch < 1.2;
  function homeX() { return upright() ? 0.42 * W : FIRE.x; }
  function onDown(e: PointerEvent) {
    const scale = ch / H; if (!upright() || W * scale <= cw + 2) return;
    cam.drag = { x0: e.clientX, cam0: cam.x, id: e.pointerId }; canvas.setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!cam.drag || e.pointerId !== cam.drag.id) return;
    const scale = ch / H / dpr; const [a, b] = camRange(ch / H);
    cam.x = Math.max(a, Math.min(b, cam.drag.cam0 - (e.clientX - cam.drag.x0) / scale));
  }
  function onUp(e: PointerEvent) { if (cam.drag && e.pointerId === cam.drag.id) { cam.drag = null; cam.lastDrag = performance.now() / 1000; } }
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  let lastView = "";
  function blit(t: number, dt: number) {
    const scale = Math.max(cw / W, ch / H); // cover
    const [a, b] = camRange(scale);
    if (!cam.placed || !upright()) { cam.x = homeX(); cam.placed = true; cam.drag = null; } // start framed; a wide screen never moves
    else if (!cam.drag && a < b) {
      // an animal out of frame: move just enough to bring it in (with a margin), not all the way to it
      const f = actorFocus(), idle = t - cam.lastDrag > 3, half = cw / 2 / scale, m = Math.min(260, half * 0.6);
      const home = homeX(), fx = f === null ? 0 : zx(f);
      const want = !idle ? cam.x : f === null ? home : Math.max(fx - half + m, Math.min(fx + half - m, home));
      cam.x += (Math.max(a, Math.min(b, want)) - cam.x) * Math.min(1, dt * (f !== null ? 0.9 : 1.4));
    }
    if (a >= b) cam.x = W / 2; else cam.x = Math.max(a, Math.min(b, cam.x));
    const tx = cw / 2 - cam.x * scale, ty = (ch - H * scale) * 0.7;
    out.setTransform(1, 0, 0, 1, 0, 0); out.imageSmoothingQuality = "high";
    out.drawImage(world, tx, ty, W * scale, H * scale);
    const v = { fireX: Math.round((tx + FIRE.x * scale) / dpr), fireTop: Math.round((ty + 300 * scale) / dpr), width: Math.round(cw / dpr), height: Math.round(ch / dpr) };
    const key = `${v.fireX},${v.fireTop},${v.width},${v.height}`;
    if (onView && key !== lastView) { lastView = key; onView(v); }
  }

  // ---- one frame
  let frame = 0, lastStep = 0, lastStorm = 0;
  function render(now: number) {
    if (stopped) return;
    raf = requestAnimationFrame(render);
    if (!ready || !cw || !ch) return;
    const tNow = now / 1000;
    if (!reduced && now - lastStep >= 100) { lastStep = now; frame++; } // scenery steps at 10 fps; the fire moves every frame
    checkSpeed(tNow);
    const t = reduced ? lastT : tNow, dt = Math.max(0, Math.min(0.05, t - lastT)); lastT = t;
    if (inp.storm && inp.storm.at !== ost.seen && Date.now() - inp.storm.at < C.DONE) startStorm(inp.storm);
    const sdt = Math.max(0, Math.min(0.5, tNow - lastStorm)); lastStorm = tNow; // the storm keeps real time even on a slow device
    if (ost.phase !== "none") stepStorm(sdt);
    if (inp.lastBuyAt !== seenBuy) { if (seenBuy >= 0 && Date.now() - inp.lastBuyAt < 5000) tossLog(inp.lastBuyBig); seenBuy = inp.lastBuyAt; }
    const useStorm = ost.phase === "rain" || ost.phase === "out" || ost.phase === "ashes" || ost.phase === "relight";
    const fs = Math.max(0, (useStorm ? ost.sizeNow : inp.size) * (1 - ost.dead * 0.97));
    firePhase += dt * (0.9 + 0.2 * Math.min(1, fs) + 0.9 * Math.min(1, fs) ** 3);
    // the forecast only shows in the sky in the last 3 hours before the storm, whatever the player's time of day
    const gather = inp.stormIn !== undefined && inp.stormIn > 0 && inp.stormIn < 3 ? (3 - inp.stormIn) / 3 : 0;
    const s = sky(inp.hour), c = ost.cover, threat = ost.phase === "none" ? inp.threat * gather : 0;
    night = s.dark;
    const sd = ost.phase === "strike" || ost.phase === "rain" ? 0.7 : ost.phase === "ashes" ? 0.6 : c * 0.5 + threat * 0.3; // how dark the storm (or its forecast) makes the sky
    const cc = Math.max(c, threat * 0.45); // storm clouds: the forecast gathers a few, the storm brings them all
    const dark = Math.max(s.dark, sd), flick = fireLight(t);
    if (amb) {
      if (amb.on !== !!inp.sound) { amb.setOn(!!inp.sound); if (inp.sound) { audio(); void loadThunder(); } }
      amb.update({ hour: inp.hour, size: Math.min(1, fs), rain: ost.rainA, cover: cc, dead: ost.dead, stream: true });
    }
    // sky, darkening as the storm rolls in
    const g = ctx.createLinearGradient(0, 0, 0, 520);
    g.addColorStop(0, rgb(mix(s.top, [15, 18, 28], sd))); g.addColorStop(1, rgb(mix(s.bot, [38, 44, 59], sd)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (s.dark > 0.3 && cc < 0.5) for (const [sx0, sy0, r, p] of STARS) {
      const on = ((frame + Math.floor(p * 40)) % 23) > 2;
      ctx.fillStyle = `rgba(255,248,220,${(s.dark - 0.3) * 1.4 * (on ? 1 : 0.25) * (1 - 2 * cc)})`; ctx.fillRect(sx0 - r, sy0 - r, r * 2, r * 2);
    }
    const h = inp.hour;
    ctx.save(); ctx.globalAlpha = 1 - cc;
    if (h >= 5.8 && h <= 19.2) { const u = (h - 5.8) / 13.4; drawSun(80 + u * (W - 160), 470 - Math.sin(u * Math.PI) * 400); }
    else { const u = (h >= 19.2 ? h - 19.2 : h + 4.8) / 10.6; drawMoon(80 + u * (W - 160), 460 - Math.sin(u * Math.PI) * 370); }
    ctx.restore();
    cx.clearRect(0, 0, W, H);
    for (const cl0 of clouds) {
      if (!cl0.img) continue;
      const cw0 = aw(cl0.img), span = W + cw0, px = ((cl0.x + frame * cl0.speed * (1 + 0.4 * cc)) % span + span) % span - cw0;
      cx.drawImage(cl0.img, px, cl0.y, cw0, ah(cl0.img));
    }
    const cloudTint = mix(mix([255, 255, 255], s.land, 0.9), [95, 100, 115], cc);
    cx.save(); cx.globalCompositeOperation = "source-atop"; cx.fillStyle = rgb(cloudTint); cx.globalAlpha = Math.max(0.85 * cc, 0.6 * (1 - (s.land[0] + s.land[1] + s.land[2]) / 765)); cx.fillRect(0, 0, W, H); cx.restore();
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - cc * 1.8); ctx.drawImage(cl, 0, 0, W, H); ctx.restore(); // the painted clouds fade out as the storm arrives
    drawBirds(t, reduced ? 0 : Math.min(0.25, sdt), Math.max(0, 1 - cc * 2)); // real time, so they cross at the same pace on a slow device
    if (cc > 0) { // the storm's own clouds roll in over the painted ones, with lightning glowing inside
      const nt = s.dark > 0.5;
      for (const k of sclouds) {
        k.x += k.v * (1 + ost.vis); if (k.x > 1.35) k.x -= 1.7;
        const px = k.x * W, py = k.y * H, sc = k.s * (0.9 + cc * 0.6) * W / 1200, shade = 40 - cc * 28, al = Math.min(1, cc * 1.4) * (nt ? 0.92 : 0.6);
        ctx.fillStyle = nt ? `rgba(${shade + 10},${shade + 12},${shade + 22},${al})` : `rgba(${240 - cc * 120},${242 - cc * 120},${248 - cc * 110},${al})`;
        for (const b of [[0, 0, 90, 32], [-40, -14, 52], [20, -22, 64], [62, -8, 46], [-75, -2, 40], [95, 2, 34]]) { ctx.beginPath(); if (b.length === 4) ctx.ellipse(px + b[0] * sc, py + b[1] * sc, b[2] * sc, b[3] * sc, 0, 0, 7); else ctx.arc(px + b[0] * sc, py + b[1] * sc, b[2] * sc, 0, 7); ctx.fill(); }
      }
      if (c > 0.5) { ctx.fillStyle = `rgba(14,16,26,${(c - 0.5) * 1.2})`; ctx.fillRect(0, 0, W, H * 0.45); }
      for (const b of ost.bolts) {
        const a = 1 - b.age / b.life, lg = ctx.createRadialGradient(b.x * W, H * 0.12, 0, b.x * W, H * 0.12, W * 0.35);
        lg.addColorStop(0, `rgba(220,225,255,${0.55 * a})`); lg.addColorStop(1, "rgba(220,225,255,0)"); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H * 0.55);
        if (!b.cloud) { ctx.strokeStyle = `rgba(240,245,255,${a})`; ctx.lineWidth = 2 + a * 2; ctx.shadowColor = "rgba(200,220,255,.9)"; ctx.shadowBlur = 18; ctx.beginPath(); ctx.moveTo(b.pts[0][0], b.pts[0][1]); for (const q of b.pts) ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.shadowBlur = 0; }
      }
    }
    // the ground: tinted by the hour and the storm, lit by the fire; the animals on their own layer so the stream never covers them
    lx.clearRect(0, 0, W, H); lx.globalCompositeOperation = "source-over"; lx.drawImage(assets["a-land.webp"], 0, 0, W, H); drawSign(lx); drawPlank(lx, t);
    ax.clearRect(0, 0, W, H); wildlife(tNow);
    if (tNow > nextFlock) { nextFlock = tNow + 180 + Math.random() * 300; if (s.dark < 0.4 && cc < 0.05) sendBirds(); }
    drawSquirrel(ax, t, dt); drawDeer(ax, t, dt); drawFrog(ax, t); drawFrogRings(ax, t); drawRabbit(ax, t, dt); drawPeek(ax, t, "heron"); drawPeek(ax, t, "bear");
    lx.drawImage(actors, 0, 0, W, H);
    const tint = mix(s.land, mix(s.land, [110, 116, 140], 0.7), sd / 0.7);
    if (tint.join() !== "255,255,255") { lx.globalCompositeOperation = "multiply"; lx.fillStyle = rgb(tint); lx.fillRect(0, 0, W, H); lx.globalCompositeOperation = "source-over"; }
    if (fs > 0.01) {
      const amt = (0.16 + 0.42 * Math.min(1, fs)) * (0.3 + 0.7 * dark) * flick;
      let gl = glowX.createRadialGradient(FIRE.x, FIRE.y - 30, 10, FIRE.x, FIRE.y - 30, 200 + fs * 420);
      gl.addColorStop(0, `rgba(255,160,70,${amt})`); gl.addColorStop(0.5, `rgba(255,120,40,${amt * 0.35})`); gl.addColorStop(1, "rgba(255,100,30,0)");
      glowX.globalCompositeOperation = "source-over"; glowX.clearRect(0, 0, W, H); glowX.fillStyle = gl; glowX.fillRect(0, 0, W, H);
      const fade = glowX.createLinearGradient(0, 470, 0, 560); fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
      glowX.globalCompositeOperation = "destination-in"; glowX.fillStyle = fade; glowX.fillRect(0, 0, W, H); // the light stays on the nearby ground
      lx.globalCompositeOperation = "lighter"; lx.drawImage(glowC, 0, 0, W, H);
      const mill = 0.22 * Math.min(1, fs) * dark * flick;
      gl = lx.createRadialGradient(1470, 470, 10, 1470, 470, 230); gl.addColorStop(0, `rgba(255,150,70,${mill})`); gl.addColorStop(1, "rgba(255,120,50,0)");
      lx.fillStyle = gl; lx.fillRect(1200, 200, 560, 500);
    }
    lx.globalCompositeOperation = "destination-in"; lx.drawImage(assets["a-land.webp"], 0, 0, W, H); lx.globalCompositeOperation = "source-over";
    ctx.save(); ctx.translate(FIRE.x, H); ctx.scale(ZOOM, ZOOM); ctx.translate(-FIRE.x, -H);
    ctx.drawImage(land, 0, 0, W, H);
    const wm = assets["a-water.webp"];
    if (wm) { // ripples follow the stream's curve downstream; at night they catch the firelight
      wx.clearRect(0, 0, W, H); wx.globalCompositeOperation = "source-over";
      const fireGlint = Math.min(1, fs) * dark * flick;
      if (course) {
        const { mid, half, x0, x1 } = course; wx.lineCap = "round";
        for (const rp of ripples) {
          rp.u += rp.v * dt; if (rp.u > 1) { rp.u -= 1; rp.o = (Math.random() * 2 - 1) * 0.75; }
          const px = Math.round(x0 + rp.u * (x1 - x0)), k = Math.max(x0 + 2, Math.min(x1 - 2, px));
          const py = mid[k] + rp.o * half[k], dy = (mid[Math.min(x1, k + 8)] - mid[Math.max(x0, k - 8)]) / 16, n = Math.hypot(1, dy), tx = 1 / n, ty = dy / n;
          const fadeIn = Math.min(1, rp.u * 8, (1 - rp.u) * 8), edge = 1 - Math.abs(rp.o) * 0.6;
          const warm = fireGlint * (1 - rp.u * 0.7), col = mix([255, 255, 255], [255, 170, 90], warm);
          wx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.45 - dark * 0.25 + warm * 0.3) * fadeIn * edge})`; wx.lineWidth = rp.w;
          const wob = Math.sin(t * 1.5 + rp.o * 9);
          wx.beginPath(); wx.moveTo(px - tx * rp.len / 2, py - ty * rp.len / 2 + wob); wx.quadraticCurveTo(px, py - 1.5 + wob, px + tx * rp.len / 2, py + ty * rp.len / 2 + wob); wx.stroke();
        }
      }
      if (fireGlint > 0.02) { const gw = wx.createRadialGradient(1640, 560, 10, 1640, 560, 260); gw.addColorStop(0, `rgba(255,140,60,${0.35 * fireGlint})`); gw.addColorStop(1, "rgba(255,120,40,0)"); wx.fillStyle = gw; wx.fillRect(1400, 380, 560, 380); }
      wx.globalCompositeOperation = "destination-in"; wx.drawImage(wm, 0, 0, W, H);
      wx.globalCompositeOperation = "destination-out"; wx.drawImage(actors, 0, 0, W, H);
      ctx.drawImage(water, 0, 0, W, H);
    }
    drawWheel(frame);
    drawFire(t, dt, fs, flick, dark);
    drawFlyingLogs(t);
    drawScraps(t);
    ctx.restore();
    if (fs > 0.45) { // heat shimmer: the air above a big fire wobbles
      const sxz = (v: number) => FIRE.x + (v - FIRE.x) * ZOOM, syz = (v: number) => H + (v - H) * ZOOM;
      const x0 = Math.round(sxz(PIT.x - 170)), x1 = Math.round(sxz(PIT.x + 170)), y0 = Math.max(0, Math.round(syz(flameTop(fs) - 140))), y1 = Math.round(syz(PIT.y - 110));
      const w = x1 - x0, hh = y1 - y0;
      if (w > 0 && hh > 0) {
        const hw = Math.round(w * R), hh2 = Math.round(hh * R);
        if (haze.width !== hw || haze.height !== hh2) { haze.width = hw; haze.height = hh2; }
        hx.clearRect(0, 0, hw, hh2); hx.drawImage(world, x0 * R, y0 * R, hw, hh2, 0, 0, hw, hh2);
        const amp = 2.2 * (fs - 0.45) / 0.55 * ZOOM;
        for (let y = 0; y < hh; y += 3) { const k = Math.sin(y * 0.07 - t * 5) * Math.sin(y * 0.023 + t * 1.7); ctx.drawImage(haze, 0, y * R, hw, 3 * R, x0 + k * amp, y0 + y, w, 3); }
      }
    }
    // rain: three depths of drops, a gusting slant, splashes on the ground; and the lightning flash
    const r = ost.rainA;
    if (r > 0) {
      const I = ost.vis; gust += ((Math.sin(ost.f * 0.013) + Math.sin(ost.f * 0.031) * 0.5) * 0.5 * I - gust) * 0.02; const slant = 0.10 * I + gust * 0.12, groundY = H * 0.62;
      const n = Math.floor(drops.length * r * (0.3 + I * 0.7)); ctx.lineCap = "round";
      for (let i = 0; i < n; i++) { const d = drops[i]; d.y += d.v * (0.8 + I * 0.6);
        if (d.y > 1.0) { if (d.z === 1) { const sp = splashes[(i * 7) % splashes.length]; sp.x = (d.x + slant) * W; sp.y = groundY + Math.random() * (H - groundY); sp.age = 0; } d.y = -0.05 - Math.random() * 0.1; d.x = Math.random() * 1.6 - 0.3; }
        const px = (d.x + d.y * slant) * W, py = d.y * H; ctx.strokeStyle = `rgba(200,214,240,${(0.12 + I * 0.25) * d.z})`; ctx.lineWidth = d.z > 0.9 ? 2.4 : d.z > 0.5 ? 1.6 : 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - slant * d.l * H, py + d.l * H * (0.8 + I * 0.5)); ctx.stroke(); }
      ctx.strokeStyle = `rgba(200,214,240,${0.35 * r})`; ctx.lineWidth = 1.5;
      for (const sp of splashes) { if (sp.age > 12) continue; sp.age++; ctx.globalAlpha = (1 - sp.age / 12) * 0.6; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 4 + sp.age * 1.6, 1.4 + sp.age * 0.5, 0, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1; if (I > 0.5) { ctx.fillStyle = `rgba(180,195,225,${(I - 0.5) * 0.2 * r})`; ctx.fillRect(0, 0, W, H); }
    }
    if (ost.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${ost.flash})`; ctx.fillRect(0, 0, W, H); }
    blit(tNow, sdt);
  }

  function resize() {
    const rc = canvas.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    cw = Math.round(rc.width * dpr); ch = Math.round(rc.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  }
  resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);
  // browsers only start audio after a click or tap: every gesture tries, the first that works wins
  const gesture = () => { if (!inp.sound) return; audio(); void loadThunder(); };
  document.addEventListener("pointerdown", gesture); document.addEventListener("keydown", gesture);
  const vis = () => { if (!ac) return; if (document.hidden) void ac.suspend(); else if (inp.sound) void ac.resume(); };
  document.addEventListener("visibilitychange", vis);
  raf = requestAnimationFrame(render);
  return {
    update(next: SceneInput) { inp = next; if (inp.sound && !amb) { audio(); } },
    visitor,
    destroy() {
      stopped = true; cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      document.removeEventListener("pointerdown", gesture); document.removeEventListener("keydown", gesture); document.removeEventListener("visibilitychange", vis);
      void ac?.close();
    },
  };
}
