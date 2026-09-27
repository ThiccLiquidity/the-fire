// Canvas scene: sky by Phoenix clock, treeline, ground, the fire (height = fire size), clouds that
// gather toward the roll, and the storm (clouds in → lightning + thunder → rain → fire beaten down).
// Ported from the design demo; kept as one self-contained module.

import type { Storm } from "../data/types";

export interface SceneInput {
  /** 0..1: fire height. 1 = reaching the pot text. */
  size: number;
  /** Phoenix hour 0..24 */
  hour: number;
  /** 0..1: how close/threatening tonight looks. Darkens sky, gathers clouds. */
  threat: number;
  storm?: Storm;
  /** ms timestamp of the most recent buy, for a paper-toss */
  lastBuyAt: number;
  lastBuyBig: boolean;
}

const THUNDER = ["clap1", "sr1", "sr2", "sr3", "sr4", "dry1", "dry2", "dry3", "dry4"];

export function createScene(canvas: HTMLCanvasElement) {
  const x = canvas.getContext("2d")!;
  let W = 1200, H = 700, dpr = 1;
  let inp: SceneInput = { size: 0.3, hour: 20, threat: 0.2, lastBuyAt: 0, lastBuyBig: false };
  let t = 0, raf = 0, stopped = false;

  // ---- noise
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
  const grad = (h: number, a: number, b: number) => { switch (h & 3) { case 0: return a + b; case 1: return -a + b; case 2: return a - b; default: return -a - b; } };
  function noise(xx: number, yy: number) {
    const X = Math.floor(xx) & 255, Y = Math.floor(yy) & 255; xx -= Math.floor(xx); yy -= Math.floor(yy);
    const u = fade(xx), v = fade(yy); const A = perm[X] + Y, B = perm[X + 1] + Y;
    return (1 + (grad(perm[A], xx, yy) * (1 - u) + grad(perm[B], xx - 1, yy) * u) * (1 - v) + (grad(perm[A + 1], xx, yy - 1) * (1 - u) + grad(perm[B + 1], xx - 1, yy - 1) * u) * v) / 2;
  }
  const fbm = (a: number, b: number) => noise(a, b) * .5 + noise(a * 2.1, b * 2.1) * .3 + noise(a * 4.3, b * 4.3) * .2;

  // ---- scenery
  const farPts: number[] = []; for (let i = 0; i <= 140; i++) farPts.push(0.45 + fbm(i * .35, 3) * 0.35);
  const trees: { x: number; s: number; y: number }[] = [];
  for (let i = 0; i < 48; i++) { const side = i % 2 ? 1 : -1; trees.push({ x: side * (330 + i * 52 + ((i * 37) % 50)), s: 0.85 + ((i * 7) % 6) * 0.11, y: (i * 13) % 30 }); }
  const stars = Array.from({ length: 90 }, () => [Math.random(), Math.random() * .55, .6 + Math.random() * 1.2, .3 + Math.random() * .6]);
  const clouds = Array.from({ length: 14 }, (_, i) => ({ x: (i / 14) * 1.6 - 0.3, y: 0.02 + ((i * 37) % 50) / 100 * 0.28, s: 0.7 + ((i * 13) % 7) * 0.12, v: 0.0006 + ((i * 7) % 5) * 0.0002 }));
  const embers = Array.from({ length: 220 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 }));
  const smoke = Array.from({ length: 60 }, () => ({ x: 0, y: 0, r: 0, life: 0, max: 1 }));
  const drops = Array.from({ length: 900 }, (_, i) => ({ x: Math.random() * 1.6 - 0.3, y: Math.random(), z: i < 300 ? 1 : i < 650 ? 0.6 : 0.35, v: 0, l: 0 }));
  for (const d of drops) { d.v = (0.018 + Math.random() * 0.012) * d.z * 1.6; d.l = (0.05 + Math.random() * 0.05) * d.z; }
  const splashes = Array.from({ length: 80 }, () => ({ x: 0, y: 0, age: 99 }));
  const scraps: { t0: number; big: boolean; x0: number }[] = [];
  let gust = 0;

  // ---- storm playback
  const st = { phase: "none" as "none" | "in" | "strike" | "rain" | "out", vis: 0.5, cover: 0, rainA: 0, start: 0, survived: true, dead: 0, bolts: [] as { x: number; cloud: boolean; age: number; life: number; pts: number[][] }[], nextBolt: 0, seen: 0, flash: 0, sizeFrom: 0, sizeTo: 0, sizeNow: 0 };
  let ac: AudioContext | null = null; const bufs: Record<string, AudioBuffer> = {}; let loading = false;
  async function loadThunder() {
    try { ac ??= new AudioContext(); if (ac.state === "suspended") void ac.resume(); if (loading) return; loading = true;
      for (const k of THUNDER) { if (bufs[k]) continue; const r = await fetch(`/thunder/${k}.mp3`); bufs[k] = await ac.decodeAudioData(await r.arrayBuffer()); }
    } catch { /* no audio */ }
  }
  function thunder(I: number, delay: number) {
    try { if (!ac) return; const keys = Object.keys(bufs); if (!keys.length) return;
      const pool = I > 0.6 ? keys : keys.filter((k) => !k.startsWith("clap")); const k = pool[Math.floor(Math.random() * pool.length)];
      const src = ac.createBufferSource(); src.buffer = bufs[k]; src.playbackRate.value = 0.92 + Math.random() * 0.16;
      const g = ac.createGain(); g.gain.value = 0.25 + I * 0.55; const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400 + I * 5000;
      src.connect(lp).connect(g).connect(ac.destination); src.start(ac.currentTime + delay);
    } catch { /* ignore */ }
  }
  function bolt() {
    const I = st.vis; const inCloud = Math.random() > I * 0.7; const cx = 0.15 + Math.random() * 0.7;
    const b = { x: cx, cloud: inCloud, age: 0, life: 8 + Math.random() * 10, pts: [] as number[][] };
    if (!inCloud) { let px = cx * W, py = H * 0.22; b.pts.push([px, py]); while (py < H * 0.78) { px += (Math.random() - .5) * 60; py += 20 + Math.random() * 30; b.pts.push([px, py]); } }
    st.bolts.push(b); thunder(I, 0.15 + (1 - I) * 1.4 + Math.random() * 0.4);
    st.flash = (inCloud ? 0.18 : 0.5) + I * 0.35; setTimeout(() => (st.flash = 0), 60 + Math.random() * 90);
  }
  function startStorm(s: Storm) {
    st.seen = s.at; st.phase = "in"; st.start = t; st.bolts = []; st.dead = 0; st.cover = Math.max(st.cover, 0.05);
    st.survived = s.survived; st.vis = s.intensity; st.sizeFrom = inp.size; st.sizeTo = s.survived ? s.sizeAfter ?? inp.size * 0.6 : 0; st.sizeNow = inp.size;
    void loadThunder();
  }
  function stepStorm() {
    const I = st.vis, age = t - st.start;
    if (st.phase === "in") { st.cover = Math.min(1, st.cover + 0.006 * (0.6 + I)); if (st.cover > 0.55 && Math.random() < 0.006 * (0.3 + I * 2)) bolt(); if (age > 170) st.phase = "strike"; }
    else if (st.phase === "strike") { st.cover = Math.min(1, st.cover + 0.01); if (t >= st.nextBolt) { bolt(); st.nextBolt = t + (20 + Math.random() * 60) * (1.3 - I); } if (age > 170 + 140 * (0.6 + I)) { st.phase = "rain"; st.nextBolt = t + 40; } }
    else if (st.phase === "rain") { st.rainA = Math.min(1, st.rainA + 0.02); if (Math.random() < 0.004 * (0.2 + I * 2)) bolt(); st.sizeNow += (st.sizeTo - st.sizeNow) * 0.03; if (!st.survived) st.dead = Math.min(1, st.dead + 0.012); if (age > 170 + 140 * (0.6 + I) + 520) st.phase = "out"; }
    else if (st.phase === "out") { st.rainA = Math.max(0, st.rainA - 0.012); st.cover = Math.max(0, st.cover - 0.004); if (st.rainA === 0 && st.cover === 0) { st.phase = "none"; st.dead = 0; } }
    for (const b of st.bolts) b.age++; st.bolts = st.bolts.filter((b) => b.age < b.life);
  }

  // ---- drawing helpers
  function pine(px: number, py: number, s: number, col: string) { x.fillStyle = col; x.beginPath(); x.moveTo(px, py - 150 * s); x.lineTo(px - 42 * s, py - 60 * s); x.lineTo(px - 22 * s, py - 60 * s); x.lineTo(px - 58 * s, py + 10 * s); x.lineTo(px - 12 * s, py + 10 * s); x.lineTo(px - 12 * s, py + 40 * s); x.lineTo(px + 12 * s, py + 40 * s); x.lineTo(px + 12 * s, py + 10 * s); x.lineTo(px + 58 * s, py + 10 * s); x.lineTo(px + 22 * s, py - 60 * s); x.lineTo(px + 42 * s, py - 60 * s); x.closePath(); x.fill(); }
  function flame(pts: number[][], fill: string | CanvasGradient, speed: number, ph: number, skewAmt: number) {
    const sk = Math.sin(t * speed + ph) * skewAmt, sy = 1 + Math.sin(t * speed * 1.3 + ph) * 0.06;
    x.save(); x.transform(1, 0, sk, sy, 0, 0); x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 3) x.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1]);
    x.closePath(); x.fillStyle = fill; x.fill(); x.restore();
  }
  const lerp = (a: number[], b: number[], u: number) => a.map((v, i) => Math.round(v + (b[i] - v) * u));
  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  function skyStops(hour: number) {
    const S: [number, number[], number[]][] = [[0, [7, 12, 30], [23, 33, 63]], [5.5, [26, 33, 64], [90, 74, 106]], [7, [122, 167, 224], [242, 201, 160]], [12, [111, 176, 255], [201, 230, 255]], [17.5, [127, 159, 224], [255, 178, 122]], [19, [44, 47, 94], [224, 100, 74]], [20.5, [11, 18, 48], [36, 50, 87]], [24, [7, 12, 30], [23, 33, 63]]];
    let i = 0; while (i < S.length - 2 && hour >= S[i + 1][0]) i++;
    const u = (hour - S[i][0]) / (S[i + 1][0] - S[i][0]);
    return { top: lerp(S[i][1], S[i + 1][1], u), bot: lerp(S[i][2], S[i + 1][2], u) };
  }

  function frame() {
    if (stopped) return;
    t++;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (inp.storm && inp.storm.at !== st.seen && Date.now() - inp.storm.at < 15000) startStorm(inp.storm);
    stepStorm();
    const hour = inp.hour;
    const night = hour < 6 || hour > 19.5 ? 1 : hour < 7 ? 7 - hour : hour > 18.5 ? hour - 18.5 : 0;
    const maxH = (H * 0.86 - 175) / 232;
    const size = st.phase === "rain" || st.phase === "out" ? st.sizeNow : inp.size;
    const fsH = (0.4 + (maxH - 0.4) * Math.max(0, Math.min(1, size))) * (1 - st.dead * 0.97);
    const fsW = 0.55 + fsH * 0.55;
    const flick = (0.85 + fbm(t * .05, 9) * 0.3) * (1 - st.dead * 0.9);
    const skyGlow = Math.max(0, (size - 0.45) * 1.7) * (1 - st.cover * 0.8) * night;

    // sky
    const sk = skyStops(hour);
    const dark = st.phase === "strike" || st.phase === "rain" ? 0.7 : st.cover * 0.5 + inp.threat * 0.35;
    const top = lerp(sk.top, [15, 18, 28], dark), bot = lerp(sk.bot, [38, 44, 59], dark);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgb(top)); g.addColorStop(.75, rgb(bot)); x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (skyGlow > 0) { const sg = x.createRadialGradient(W / 2, H, 0, W / 2, H, H * 1.1); sg.addColorStop(0, `rgba(255,110,30,${.7 * skyGlow * flick})`); sg.addColorStop(1, "rgba(255,110,30,0)"); x.fillStyle = sg; x.fillRect(0, 0, W, H); }
    for (const s of stars) { x.fillStyle = `rgba(255,255,255,${s[3] * night * (1 - skyGlow * .8) * (1 - st.cover) * (1 - inp.threat * 0.5)})`; x.fillRect(s[0] * W, s[1] * H, s[2], s[2]); }
    if (hour > 6 && hour < 19) { const u = (hour - 6) / 13; x.fillStyle = "rgba(255,214,107,0.9)"; x.beginPath(); x.arc(100 + u * (W - 200), H * 0.55 - Math.sin(u * Math.PI) * H * 0.45, 30, 0, 7); x.fill(); }
    if (hour < 5 || hour > 20) { x.fillStyle = "rgba(233,238,247,0.85)"; x.beginPath(); x.arc(W * 0.8, H * 0.17, 22, 0, 7); x.fill(); }
    // ambient clouds (threat) + storm clouds (cover)
    const cover = Math.max(st.cover, inp.threat * 0.45);
    if (cover > 0) {
      for (const cl of clouds) { cl.x += cl.v * (1 + st.vis); if (cl.x > 1.35) cl.x -= 1.7; const px = cl.x * W, py = cl.y * H, s = cl.s * (0.9 + cover * 0.6) * W / 1200; const shade = 40 - cover * 28; const a = Math.min(1, cover * 1.4) * (night ? 0.92 : 0.6);
        x.fillStyle = night ? `rgba(${shade + 10},${shade + 12},${shade + 22},${a})` : `rgba(${240 - cover * 120},${242 - cover * 120},${248 - cover * 110},${a})`;
        for (const b of [[0, 0, 90, 32], [-40, -14, 52], [20, -22, 64], [62, -8, 46], [-75, -2, 40], [95, 2, 34]]) { x.beginPath(); if (b.length === 4) x.ellipse(px + b[0] * s, py + b[1] * s, b[2] * s, b[3] * s, 0, 0, 7); else x.arc(px + b[0] * s, py + b[1] * s, b[2] * s, 0, 7); x.fill(); } }
      if (st.cover > 0.5) { x.fillStyle = `rgba(14,16,26,${(st.cover - 0.5) * 1.2})`; x.fillRect(0, 0, W, H * 0.45); }
      for (const b of st.bolts) { const a = 1 - b.age / b.life; const lg = x.createRadialGradient(b.x * W, H * 0.15, 0, b.x * W, H * 0.15, W * 0.35); lg.addColorStop(0, `rgba(220,225,255,${0.55 * a})`); lg.addColorStop(1, "rgba(220,225,255,0)"); x.fillStyle = lg; x.fillRect(0, 0, W, H * 0.55);
        if (!b.cloud) { x.strokeStyle = `rgba(240,245,255,${a})`; x.lineWidth = 2 + a * 2; x.shadowColor = "rgba(200,220,255,.9)"; x.shadowBlur = 18; x.beginPath(); x.moveTo(b.pts[0][0], b.pts[0][1]); for (const p of b.pts) x.lineTo(p[0], p[1]); x.stroke(); x.shadowBlur = 0; } }
    }

    // world
    const ox = W / 2, oy = H * 0.86; x.translate(ox, oy); x.translate(-600, -600);
    const base = 600; const lit = Math.min(1, fsH / 1.2) * (0.3 + night * 0.7);
    x.fillStyle = `rgb(${12 + lit * 30 + (1 - night) * 40},${18 + lit * 18 + (1 - night) * 60},${36 + (1 - night) * 30})`; x.beginPath(); x.moveTo(-3000, 3000); x.lineTo(-3000, 560);
    for (let i = 0; i <= 140; i++) x.lineTo(-3000 + i * (6000 / 140), base - 60 - farPts[i] * 140); x.lineTo(3000, 560); x.lineTo(3000, 3000); x.closePath(); x.fill();
    const lw = 0.9 + fsW * 0.25;
    const gg = x.createRadialGradient(600, base, 10, 600, base, 700 * Math.sqrt(fsW)); gg.addColorStop(0, `rgba(255,150,50,${.55 * flick})`); gg.addColorStop(.5, "rgba(70,60,30,.35)"); gg.addColorStop(1, "rgba(10,14,10,0)");
    x.fillStyle = night ? "#121a12" : "#2f3d26"; x.fillRect(-3000, base - 20, 6000, 3000); x.fillStyle = gg; x.fillRect(-3000, base - 20, 6000, 3000);
    for (const tr of trees) { const px = 600 + tr.x, py = base - 10 + tr.y; const d = Math.abs(tr.x) / 400; const warm = Math.max(0, lit * 1.2 - d * .4); pine(px, py, tr.s, night ? `rgb(${8 + warm * 70},${12 + warm * 30},${22})` : `rgb(${30 + warm * 40},${58 + warm * 20},${40})`); }
    x.save(); x.translate(600, 600); x.scale(lw, Math.min(lw, 1.6)); x.translate(-600, -600);
    x.fillStyle = "#3e424c"; for (const s of [[470, 600, 26, 10], [520, 612, 22, 9], [600, 618, 30, 10], [680, 612, 22, 9], [730, 600, 26, 10]]) { x.beginPath(); x.ellipse(s[0], s[1], s[2], s[3], 0, 0, 7); x.fill(); }
    x.fillStyle = "#5b3a1c"; x.fillRect(500, 570, 200, 22); x.save(); x.translate(600, 569); x.rotate(-.14); x.fillStyle = "#7d4f27"; x.fillRect(-80, -11, 160, 22); x.rotate(.3); x.fillStyle = "#4a2e14"; x.fillRect(-80, -11, 160, 22); x.restore(); x.restore();
    const eb = x.createRadialGradient(600, 575, 5, 600, 575, 110 * lw); eb.addColorStop(0, `rgba(255,120,30,${.9 * flick})`); eb.addColorStop(1, "rgba(255,60,10,0)"); x.fillStyle = eb; x.fillRect(600 - 130 * lw, 540, 260 * lw, 60);

    // flames
    if (st.dead < 0.98) {
      x.save(); x.translate(600, base - 38); x.scale(fsW, fsH);
      const G = (y0: number, y1: number, stops: [number, string][]) => { const gr = x.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr; };
      const gO = G(0, -230, [[0, "#c8330f"], [.5, "#ff7a1a"], [1, "#ffd166"]]), gI = G(0, -140, [[0, "#ff8c2a"], [1, "#fff2b8"]]);
      flame([[0, -232], [-40, -172], [-70, -132], [-80, -72], [-88, -32], [-60, -7], [0, 0], [60, -7], [88, -32], [80, -72], [70, -132], [40, -172], [0, -232]], gO, 0.09, 0, 0.06);
      flame([[-60, -162], [-85, -122], [-102, -87], [-95, -50], [-88, -22], [-52, -4], [0, 0], [-40, -17], [-45, -57], [-35, -92], [-28, -117], [-48, -137], [-60, -162]], gO, 0.11, 1.5, 0.08);
      flame([[62, -167], [85, -127], [102, -92], [93, -54], [86, -22], [50, -4], [0, 0], [40, -17], [46, -57], [36, -92], [28, -117], [48, -137], [62, -167]], gO, 0.1, 3, 0.08);
      flame([[0, -142], [-18, -110], [-32, -77], [-26, -47], [-21, -22], [-8, -6], [0, -4], [8, -6], [21, -22], [26, -47], [32, -77], [18, -110], [0, -142]], gI, 0.13, .7, 0.05);
      flame([[0, -82], [-8, -64], [-14, -47], [-11, -30], [-9, -16], [-4, -8], [0, -8], [4, -8], [9, -16], [11, -30], [14, -47], [8, -64], [0, -82]], "#fff9d6", 0.17, 2.2, 0.04);
      x.restore();
    }
    // paper / log tosses
    if (inp.lastBuyAt && (scraps.length === 0 || scraps[scraps.length - 1].t0 !== inp.lastBuyAt)) scraps.push({ t0: inp.lastBuyAt, big: inp.lastBuyBig, x0: (Math.random() - .5) * 200 });
    while (scraps.length && Date.now() - scraps[0].t0 > 1300) scraps.shift();
    for (const s of scraps) { const u = (Date.now() - s.t0) / 1300; const px = 600 + s.x0 * (1 - u), py = base + 120 - Math.sin(u * Math.PI) * 300 * fsH - u * 60; x.save(); x.translate(px, py); x.rotate(u * 6); x.globalAlpha = 1 - u * u; x.fillStyle = s.big ? "#a06a35" : "#f3e9d2"; if (s.big) x.fillRect(-20, -6, 40, 12); else x.fillRect(-8, -10, 16, 20); x.restore(); }

    // embers & smoke
    x.globalCompositeOperation = "lighter";
    const spawnRate = 0.15 + fsH * 0.12;
    for (const e of embers) {
      if (e.life <= 0) { if (Math.random() < spawnRate && st.dead < 0.5) { e.x = 600 + (Math.random() - .5) * 110 * fsW; e.y = base - 40 - Math.random() * 150 * fsH; e.vx = (Math.random() - .5) * .8; e.vy = -(1.5 + Math.random() * 2.5) * Math.sqrt(fsH); e.life = e.max = 50 + Math.random() * 90; } continue; }
      e.life--; e.x += e.vx + (fbm(e.y * .01, t * .02 + e.x * .001) - .5) * 2.5; e.y += e.vy; const a = e.life / e.max;
      x.fillStyle = `rgba(255,${150 + a * 90 | 0},60,${a})`; const r = 1.2 + a * 1.6 * Math.sqrt(fsH); x.fillRect(e.x - r / 2, e.y - r / 2, r, r);
    }
    x.globalCompositeOperation = "source-over";
    if (fsH > 1.2 || st.dead > 0.3) for (const s of smoke) {
      if (s.life <= 0) { if (Math.random() < 0.25) { s.x = 600 + (Math.random() - .5) * 120 * fsW; s.y = base - 40 - 225 * fsH; s.r = 20 * fsH + 10; s.life = s.max = 90 + Math.random() * 90; } continue; }
      s.life--; s.x += (fbm(s.y * .005, t * .01) - .5) * 3 + 0.6; s.y -= 1.4 * Math.sqrt(Math.max(0.2, fsH)); s.r += 0.6 * Math.max(0.3, fsH); const a = (s.life / s.max) * 0.25 * Math.max(Math.min(1, fsH - 1.2), st.dead);
      x.fillStyle = `rgba(90,90,100,${a})`; x.beginPath(); x.arc(s.x, s.y, s.r, 0, 7); x.fill();
    }

    // rain + flash
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = st.rainA; if (r > 0) {
      const I = st.vis; gust += ((Math.sin(t * 0.013) + Math.sin(t * 0.031) * 0.5) * 0.5 * I - gust) * 0.02; const slant = 0.10 * I + gust * 0.12; const groundY = H * 0.86;
      const n = Math.floor(drops.length * r * (0.3 + I * 0.7)); x.lineCap = "round";
      for (let i = 0; i < n; i++) { const d = drops[i]; d.y += d.v * (0.8 + I * 0.6);
        if (d.y > 1.0) { if (d.z === 1) { const sp = splashes[(i * 7) % splashes.length]; sp.x = (d.x + slant) * W; sp.y = groundY + Math.random() * (H - groundY); sp.age = 0; } d.y = -0.05 - Math.random() * 0.1; d.x = Math.random() * 1.6 - 0.3; }
        const px = (d.x + d.y * slant) * W, py = d.y * H; x.strokeStyle = `rgba(200,214,240,${(0.12 + I * 0.25) * d.z})`; x.lineWidth = d.z > 0.9 ? 1.6 : d.z > 0.5 ? 1.1 : 0.7; x.beginPath(); x.moveTo(px, py); x.lineTo(px - slant * d.l * H, py + d.l * H * (0.8 + I * 0.5)); x.stroke(); }
      x.strokeStyle = `rgba(200,214,240,${0.35 * r})`; x.lineWidth = 1;
      for (const sp of splashes) { if (sp.age > 12) continue; sp.age++; x.globalAlpha = (1 - sp.age / 12) * 0.6; x.beginPath(); x.ellipse(sp.x, sp.y, 3 + sp.age * 1.2, 1 + sp.age * 0.4, 0, 0, 7); x.stroke(); }
      x.globalAlpha = 1; if (I > 0.5) { x.fillStyle = `rgba(180,195,225,${(I - 0.5) * 0.2 * r})`; x.fillRect(0, 0, W, H); }
    }
    if (st.flash > 0) { x.fillStyle = `rgba(255,255,255,${st.flash})`; x.fillRect(0, 0, W, H); }
    raf = requestAnimationFrame(frame);
  }

  function resize() { const r = canvas.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); canvas.width = r.width * dpr; canvas.height = r.height * dpr; W = r.width; H = r.height; }
  resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);
  document.addEventListener("pointerdown", () => void loadThunder(), { once: true });
  frame();
  return {
    update(next: SceneInput) { inp = next; },
    destroy() { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
