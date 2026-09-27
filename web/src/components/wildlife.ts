// The press, the stream, and the visitors. Pure canvas, no images. Used by scene.ts.
// World coordinates: the fire sits at (600, 600); +x is right, +y is toward the viewer.

type Ctx = CanvasRenderingContext2D;

/** Shade a color toward night (0 day … 1 night), with a little warmth from the fire. */
export function sh(c: number[], night: number, warm = 0) { const k = 0.32 + 0.68 * (1 - night) + warm * 0.3; return `rgb(${c.map((v) => Math.min(255, Math.round(v * k))).join(",")})`; }
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- the stream: from under the wheel, toward the viewer, then along the bottom and off the right edge.
// Cut into the ground (mud edge, bank, shallow sides, deeper middle), noise ripples drifting downstream.
const riverPts = [[1093, 566], [1088, 592], [1072, 622], [1062, 652], [1082, 682], [1130, 702], [1200, 716], [1290, 728], [1400, 740]];
export function riverAt(u: number): [number, number, number] {
  const P = riverPts, n = P.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const dcr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t * t);
  return [cr(p0[0], p1[0], p2[0], p3[0], f), cr(p0[1], p1[1], p2[1], p3[1], f), Math.atan2(dcr(p0[1], p1[1], p2[1], p3[1], f), dcr(p0[0], p1[0], p2[0], p3[0], f))];
}
const rw = (u: number) => 7 + u * u * 34 + u * 10;
const NP = new Uint8Array(512); for (let i = 0; i < 256; i++) NP[i] = i; for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [NP[i], NP[j]] = [NP[j], NP[i]]; } for (let i = 0; i < 256; i++) NP[i + 256] = NP[i];
function vnoise(xx: number, yy: number) { const X = Math.floor(xx) & 255, Y = Math.floor(yy) & 255; const fx = xx - Math.floor(xx), fy = yy - Math.floor(yy); const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const h = (a: number, b: number) => NP[NP[a] + b] / 255; return lerp(lerp(h(X, Y), h(X + 1, Y), u), lerp(h(X, Y + 1), h(X + 1, Y + 1), u), v); }
function riverOutline(x: Ctx, pad: number) {
  x.beginPath();
  for (let i = 0; i <= 60; i++) { const [px, py, ang] = riverAt(i / 60); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(i / 60) + pad; if (i === 0) x.moveTo(px + nx * w, py + ny * w); else x.lineTo(px + nx * w, py + ny * w); }
  for (let i = 60; i >= 0; i--) { const [px, py, ang] = riverAt(i / 60); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(i / 60) + pad; x.lineTo(px - nx * w, py - ny * w); }
  x.closePath();
}
export function drawRiver(x: Ctx, t: number, night: number, warm: number) {
  x.fillStyle = sh([58, 52, 38], night); x.beginPath(); x.ellipse(1093, 574, 46, 15, 0, 0, 7); x.fill();
  x.fillStyle = sh([150, 146, 134], night); x.beginPath(); x.ellipse(1093, 572, 42, 12, 0, 0, 7); x.fill();
  x.fillStyle = sh([70, 118, 140], night); x.beginPath(); x.ellipse(1093, 574, 38, 9, 0, 0, 7); x.fill();
  riverOutline(x, 7); x.fillStyle = sh([58, 52, 38], night); x.fill();
  riverOutline(x, 3); x.fillStyle = sh([96, 84, 58], night); x.fill();
  riverOutline(x, 0); x.save(); x.clip();
  const g = x.createLinearGradient(1060, 560, 1300, 740); g.addColorStop(0, sh([88, 138, 150], night)); g.addColorStop(1, sh([62, 112, 138], night)); x.fillStyle = g; x.fillRect(900, 500, 600, 400);
  x.strokeStyle = sh([44, 92, 120], night); x.lineCap = "round";
  for (let i = 0; i < 60; i++) { const [px, py] = riverAt(i / 60), [qx, qy] = riverAt((i + 1) / 60); x.lineWidth = rw(i / 60) * 0.9; x.beginPath(); x.moveTo(px, py); x.lineTo(qx, qy); x.stroke(); }
  const nightA = 1 - night * 0.45;
  for (let i = 0; i < 60; i++) { const u = i / 60; const [px, py, ang] = riverAt(u); const w = rw(u), nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let j = -0.8; j <= 0.8; j += 0.2) { const n1 = vnoise(u * 40 - t * 0.05, j * 6 + u * 3), n2 = vnoise(u * 90 - t * 0.09 + 7, j * 9); const v = n1 * 0.6 + n2 * 0.4; if (v < 0.58) continue;
      x.fillStyle = `rgba(214,236,246,${(v - 0.58) * 1.6 * nightA})`; x.beginPath(); x.ellipse(px + nx * w * j, py + ny * w * j, 2.2 + w * 0.06, 1 + w * 0.02, ang, 0, 7); x.fill(); } }
  x.fillStyle = `rgba(240,248,252,${0.7 - night * 0.25})`; for (let k = 0; k < 12; k++) { const [px, py] = riverAt(0.01 + (k % 4) * 0.012); x.beginPath(); x.arc(px + Math.sin(t * 0.09 + k * 2.1) * 7, py + Math.cos(t * 0.11 + k) * 3, 1.2 + (k % 3) * 0.7, 0, 7); x.fill(); }
  if (night > 0.3) { const rg = x.createRadialGradient(600, 600, 20, 600, 600, 720); rg.addColorStop(0, `rgba(255,140,40,${0.35 * night * (0.6 + warm)})`); rg.addColorStop(1, "rgba(255,140,40,0)"); x.fillStyle = rg; x.fillRect(900, 500, 600, 400);
    x.fillStyle = `rgba(255,255,235,${0.5 * night})`; for (let k = 0; k < 9; k++) { const u = ((t * 0.0012 + k * 0.11) % 1); const [px, py, ang] = riverAt(u); const nx = -Math.sin(ang), ny = Math.cos(ang); const off = Math.sin(k * 2.3) * rw(u) * 0.5; x.fillRect(px + nx * off, py + ny * off, 3, 1.2); } }
  x.restore();
  for (let i = 4; i < 58; i += 4) { const u = i / 60; const [px, py, ang] = riverAt(u); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(u) + 5, side = (i % 8 ? 1 : -1);
    const gx = px + nx * w * side, gy = py + ny * w * side, k = 0.6 + u;
    x.fillStyle = sh([74, 108, 54], night); x.beginPath(); x.ellipse(gx, gy + 1, 7 * k, 3.2 * k, 0, 0, 7); x.fill();
    x.fillStyle = sh([96, 134, 66], night); x.beginPath(); x.ellipse(gx - 2 * k, gy - 1, 3.5 * k, 2.4 * k, 0, 0, 7); x.fill();
    if (i % 3 === 0) { x.fillStyle = sh([150, 146, 134], night); x.beginPath(); x.ellipse(gx + 8 * k * side, gy + 3, 2.6 * k, 1.6 * k, 0, 0, 7); x.fill(); } }
}

// ---------- the press
export function drawMill(x: Ctx, t: number, px: number, py: number, sc: number, night: number, warm: number) {
  x.save(); x.translate(px, py); x.scale(sc, sc);
  const wg = night > 0.4 ? `rgba(255,196,96,${0.9 * night})` : sh([250, 236, 190], night);
  const wood = sh([176, 124, 72], night, warm), woodD = sh([124, 84, 46], night), cream = sh([232, 214, 168], night, warm), teal = sh([44, 108, 96], night), tealD = sh([30, 82, 74], night), gold = sh([230, 186, 92], night), stone = sh([200, 196, 182], night), stoneD = sh([160, 154, 140], night);
  const R = (xx: number, yy: number, ww: number, hh: number, c: string) => { x.fillStyle = c; x.fillRect(xx, yy, ww, hh); };
  x.fillStyle = "rgba(0,0,0,0.22)"; x.beginPath(); x.ellipse(-10, 8, 200, 14, 0, 0, 7); x.fill();
  x.fillStyle = sh([104, 92, 62], night); x.beginPath(); x.moveTo(-40, 6); x.quadraticCurveTo(-140, 26, -360, 56); x.lineTo(-360, 70); x.quadraticCurveTo(-140, 44, -8, 12); x.closePath(); x.fill();
  R(-170, -12, 320, 20, stoneD); R(-166, -14, 312, 8, stone);
  R(-150, -134, 260, 122, wood);
  R(-150, -134, 260, 6, woodD); R(-150, -134, 8, 122, woodD); R(102, -134, 8, 122, woodD); R(-150, -18, 260, 6, woodD);
  R(-138, -122, 236, 44, cream);
  x.strokeStyle = woodD; x.lineWidth = 1.2; for (let yy = -74; yy < -20; yy += 9) { x.beginPath(); x.moveTo(-142, yy); x.lineTo(102, yy); x.stroke(); }
  R(-118, -118, 196, 24, teal); x.strokeStyle = gold; x.lineWidth = 2; x.strokeRect(-118, -118, 196, 24);
  x.fillStyle = gold; x.font = "800 13px Nunito, sans-serif"; x.textAlign = "center"; x.fillText("PLANK & PAPER", -20, -101);
  for (const wx of [-134, 42]) { R(wx, -84, 52, 50, wg); x.strokeStyle = woodD; x.lineWidth = 3; x.strokeRect(wx, -84, 52, 50); x.beginPath(); x.moveTo(wx + 26, -84); x.lineTo(wx + 26, -34); x.moveTo(wx, -59); x.lineTo(wx + 52, -59); x.stroke(); R(wx - 4, -32, 60, 5, woodD); }
  R(-40, -70, 40, 54, woodD); R(-34, -64, 28, 44, wood); x.fillStyle = gold; x.beginPath(); x.arc(-14, -42, 2.2, 0, 7); x.fill();
  x.fillStyle = wood; x.beginPath(); x.moveTo(-160, -134); x.lineTo(-20, -232); x.lineTo(120, -134); x.closePath(); x.fill();
  x.fillStyle = cream; x.beginPath(); x.moveTo(-132, -140); x.lineTo(-20, -218); x.lineTo(92, -140); x.closePath(); x.fill();
  x.strokeStyle = woodD; x.lineWidth = 4; x.beginPath(); x.moveTo(-20, -218); x.lineTo(-20, -140); x.moveTo(-90, -168); x.lineTo(50, -168); x.stroke();
  x.fillStyle = wg; x.beginPath(); x.arc(-20, -180, 17, 0, 7); x.fill(); x.strokeStyle = gold; x.lineWidth = 4; x.stroke(); x.lineWidth = 2.5; x.beginPath(); x.moveTo(-20, -197); x.lineTo(-20, -163); x.moveTo(-37, -180); x.lineTo(-3, -180); x.stroke();
  x.save(); x.beginPath(); x.moveTo(-178, -126); x.lineTo(-20, -246); x.lineTo(138, -126); x.lineTo(118, -126); x.lineTo(-20, -230); x.lineTo(-158, -126); x.closePath(); x.clip();
  R(-190, -260, 340, 150, teal);
  x.fillStyle = tealD; for (let r = 0; r < 12; r++) { const yy = -126 - r * 10; for (let i = 0; i < 26; i++) x.fillRect(-190 + i * 14 + (r & 1) * 7, yy - 6, 12, 4); }
  x.restore();
  x.strokeStyle = sh([90, 160, 140], night); x.lineWidth = 3; x.beginPath(); x.moveTo(-178, -126); x.lineTo(-20, -246); x.lineTo(138, -126); x.stroke();
  R(-30, -252, 20, 8, tealD);
  R(56, -262, 30, 90, stone); x.fillStyle = stoneD; for (let r = 0; r < 8; r++) x.fillRect(58 + (r & 1) * 6, -258 + r * 11, 20, 5);
  R(50, -270, 42, 10, teal); R(50, -274, 42, 4, tealD);
  for (let i = 0; i < 5; i++) { const u = (t * 0.003 + i * 0.2) % 1; x.fillStyle = `rgba(215,215,225,${(0.22 - u * 0.2) * (1 - night * 0.4)})`; x.beginPath(); x.arc(71 + Math.sin(u * 6 + i) * 10 + u * 18, -282 - u * 90, 6 + u * 16, 0, 7); x.fill(); }
  // wheel
  x.save(); x.translate(150, -66); x.rotate(t * 0.011);
  x.strokeStyle = wood; x.lineWidth = 5; for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(i * Math.PI / 4) * 64, Math.sin(i * Math.PI / 4) * 64); x.stroke(); }
  x.lineWidth = 10; x.strokeStyle = teal; x.beginPath(); x.arc(0, 0, 66, 0, 7); x.stroke();
  x.lineWidth = 3; x.strokeStyle = gold; x.beginPath(); x.arc(0, 0, 60, 0, 7); x.stroke();
  for (let i = 0; i < 12; i++) { x.save(); x.rotate(i * Math.PI / 6); R(50, -10, 24, 20, wood); R(50, -10, 24, 4, woodD); R(50, 6, 24, 4, woodD); x.restore(); }
  x.fillStyle = tealD; x.beginPath(); x.arc(0, 0, 10, 0, 7); x.fill(); x.fillStyle = gold; x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill();
  x.restore();
  R(112, -70, 76, 8, tealD);
  R(196, -150, 8, 150, woodD); R(150, -150, 8, 22, woodD);
  R(118, -150, 100, 10, woodD); x.fillStyle = sh([140, 190, 210], night); x.fillRect(120, -148, 96, 4); R(118, -154, 100, 4, wood);
  x.fillStyle = `rgba(170,215,235,${0.6 - night * 0.2})`; for (let i = 0; i < 6; i++) { const u = (t * 0.05 + i * 0.17) % 1; x.fillRect(128 + Math.sin(i) * 3, -140 + u * 30, 3, 9); }
  x.fillStyle = `rgba(210,238,250,${0.6 - night * 0.25})`; for (let i = 0; i < 8; i++) { const u = (t * 0.04 + i * 0.12) % 1; x.beginPath(); x.arc(168 + u * 30 - i * 3, -8 + u * 16 - Math.sin(u * 3) * 10, 1.8 - u, 0, 7); x.fill(); }
  // paper machine
  R(-112, -46, 8, 44, teal); R(-40, -46, 8, 44, teal); R(-116, -50, 84, 6, tealD);
  x.fillStyle = sh([190, 200, 210], night); x.beginPath(); x.ellipse(-76, -40, 30, 9, 0, 0, 7); x.fill(); x.fillStyle = sh([150, 160, 172], night); x.beginPath(); x.ellipse(-76, -40, 30, 4, 0, 0, 7); x.fill();
  x.fillStyle = sh([246, 240, 226], night); x.beginPath(); x.ellipse(-102, -20, 12, 12, 0, 0, 7); x.fill(); x.beginPath(); x.moveTo(-102, -32); x.lineTo(-44, -32); x.lineTo(-44, -6); x.lineTo(-102, -8); x.closePath(); x.fill();
  x.fillStyle = sh([226, 218, 200], night); x.fillRect(-102, -31, 58, 2);
  x.fillStyle = teal; x.beginPath(); x.arc(-52, -8, 8, 0, 7); x.fill(); x.fillStyle = gold; x.beginPath(); x.arc(-52, -8, 3, 0, 7); x.fill();
  x.restore();
}

// ---------- visitors
export type Kind = "deer" | "rabbit" | "skunk" | "bear" | "squirrel" | "birds" | "heron" | "frog";
interface Animal { kind: Kind; age: number; dead: boolean; dir: 1 | -1; phase: "in" | "pause" | "out"; pauseT: number; pauseLen: number; x: number; y: number; v: number; stopAt: number; n?: number; climb?: number; fly?: boolean }
const GROUND = 600;

export function createWildlife(treeXs: number[]) {
  const animals: Animal[] = [];
  let nextVisit = Date.now() + rnd(4, 12) * 60_000; // first visitor a while after load
  const fireflies = Array.from({ length: 26 }, (_, i) => ({ x: rnd(-520, 520), y: rnd(-120, 60), p: i * 1.7, s: rnd(0.6, 1.4) }));

  function spawn(kind: Kind) {
    const a: Animal = { kind, age: 0, dead: false, dir: Math.random() < 0.5 ? 1 : -1, phase: "in", pauseT: 0, pauseLen: 0, x: 0, y: 0, v: 1, stopAt: 0 };
    switch (kind) {
      case "deer": a.v = 1.1; a.y = 22; a.stopAt = -rnd(150, 400); a.pauseLen = 480; break;
      case "rabbit": a.v = 1.6; a.y = 40; a.stopAt = rnd(-300, 300); a.pauseLen = 280; break;
      case "skunk": a.v = 0.7; a.y = 46; a.stopAt = rnd(-260, 260); a.pauseLen = 220; break;
      case "bear": a.v = 0.8; a.y = 26; a.dir = -1; a.stopAt = 300; a.pauseLen = 560; break;
      case "heron": a.v = 0.9; a.y = 0; a.dir = -1; a.x = 1200; a.stopAt = riverAt(0.3)[0] - 600; a.pauseLen = 700; a.fly = true; break;
      case "squirrel": { a.v = 2.2; a.y = 44; const tx = treeXs[Math.floor(Math.random() * treeXs.length)]; a.dir = tx > 0 ? 1 : -1; a.stopAt = tx - a.dir * 14; a.x = a.stopAt - a.dir * 300; a.pauseLen = 220; break; }
      case "frog": { a.v = 0; a.y = 0; const u = 0.1 + Math.random() * 0.2; const [fx, fy, ang] = riverAt(u); const side = Math.random() < 0.5 ? 1 : -1; a.x = fx + -Math.sin(ang) * (rw(u) + 12) * side - 600; a.y = fy + Math.cos(ang) * (rw(u) + 12) * side - GROUND; a.dir = side === 1 ? -1 : 1; a.stopAt = a.x; a.pauseLen = 500 + Math.random() * 400; break; }
      case "birds": a.v = 1.4; a.y = -320 - rnd(0, 120); a.n = 3 + Math.floor(rnd(0, 4)); a.stopAt = 9999 * a.dir; a.fly = true; break;
    }
    if (a.x === 0) a.x = a.dir < 0 ? 720 : -720;
    animals.push(a);
  }
  function step(night: number) {
    for (const a of animals) {
      a.age++;
      if (a.phase === "in") { a.x += a.v * a.dir; if ((a.dir > 0 && a.x >= a.stopAt) || (a.dir < 0 && a.x <= a.stopAt)) { a.phase = a.pauseLen ? "pause" : "out"; a.pauseT = 0; } }
      else if (a.phase === "pause") { a.pauseT++; if (a.pauseT > a.pauseLen) { a.phase = "out"; if (a.kind === "squirrel") a.climb = 0; if (a.kind === "bear" || a.kind === "heron") a.dir = a.dir === 1 ? -1 : 1; } }
      else if (a.kind === "frog") { a.climb = (a.climb ?? 0) + 1; if (a.climb > 110) a.dead = true; }
      else { if (a.kind === "squirrel") { a.climb = (a.climb ?? 0) + 2.4; if (a.climb > 150) a.dead = true; } else { a.x += a.v * (a.kind === "skunk" ? 1 : 1.3) * a.dir; if (a.kind === "heron") a.y -= 1.6; } }
      if (Math.abs(a.x) > 1500) a.dead = true;
    }
    for (let i = animals.length - 1; i >= 0; i--) if (animals[i].dead) animals.splice(i, 1);
    // a treat, not a fixture: one visitor every 15–40 minutes, never two at once; bears only after dark
    if (Date.now() > nextVisit && animals.length === 0) {
      nextVisit = Date.now() + rnd(15, 40) * 60_000;
      const pool: Kind[] = night > 0.6 ? ["bear", "deer", "skunk", "rabbit", "frog", "frog", "deer"] : ["deer", "rabbit", "squirrel", "birds", "heron", "skunk", "frog", "frog"];
      spawn(pool[Math.floor(Math.random() * pool.length)]);
    }
  }
  const back = (a: Animal) => a.kind === "bear" || a.kind === "heron";
  function draw(x: Ctx, t: number, night: number, layer: "back" | "front") {
    if (layer === "front" && night > 0.6) { x.fillStyle = "#d9ff7a"; for (const f of fireflies) { const a = Math.max(0, Math.sin(t * 0.05 + f.p)) ** 3 * night; if (a < 0.05) continue; x.globalAlpha = a * 0.9; x.beginPath(); x.arc(600 + f.x + Math.sin(t * 0.01 + f.p) * 18, 520 + f.y + Math.cos(t * 0.013 + f.p) * 10, 1.6 * f.s, 0, 7); x.fill(); } x.globalAlpha = 1; }
    for (const a of animals) {
      if (back(a) !== (layer === "back")) continue;
      x.save();
      const wy = a.kind === "heron" ? (a.phase === "pause" ? riverAt(0.3)[1] + 6 : riverAt(0.3)[1] + 6 - Math.min(160, Math.abs(a.x - a.stopAt) * 0.5) + a.y) : GROUND + a.y;
      x.translate(600 + a.x, wy); x.scale(a.dir, 1);
      DRAW[a.kind](x, a, night);
      x.restore();
    }
  }
  return { step, draw, spawn, count: () => animals.length };
}

function O(x: Ctx, night: number) { x.strokeStyle = `rgba(20,14,10,${0.55 + night * 0.2})`; x.lineWidth = 2; x.lineJoin = "round"; }
function blob(x: Ctx, cx: number, cy: number, rx: number, ry: number, rot: number, fill: string) { x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, 7); x.fillStyle = fill; x.fill(); x.stroke(); }
function eye(x: Ctx, cx: number, cy: number, r = 2) { x.fillStyle = "#1a120c"; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.fillStyle = "#fff"; x.beginPath(); x.arc(cx + r * 0.35, cy - r * 0.35, r * 0.4, 0, 7); x.fill(); }

const DRAW: Record<Kind, (x: Ctx, a: Animal, night: number) => void> = {
  deer(x, a, night) {
    O(x, night); const walk = a.phase === "pause" ? 0 : Math.sin(a.age * 0.22), graze = a.phase === "pause" ? Math.min(1, a.pauseT / 40) * (0.75 + 0.25 * Math.sin(a.pauseT * 0.08)) : 0;
    const body = sh([172, 118, 70], night), belly = sh([222, 198, 158], night), dark = sh([84, 54, 28], night);
    x.fillStyle = body;
    for (const [lx, ph] of [[-22, 0], [-14, Math.PI], [14, Math.PI], [22, 0]]) { const sw = walk * Math.sin(ph + 1) * 8; x.beginPath(); x.moveTo(lx - 4, -44); x.lineTo(lx + 4, -44); x.lineTo(lx + 2.5 + sw, -2); x.lineTo(lx - 2.5 + sw, -2); x.closePath(); x.fill(); x.stroke(); x.fillStyle = dark; x.fillRect(lx - 3 + sw, -4, 6, 4); x.fillStyle = body; }
    x.save(); x.translate(24, -58); x.rotate(graze * 1.15);
    x.beginPath(); x.moveTo(-10, 10); x.bezierCurveTo(-6, -12, 0, -26, 9, -34); x.lineTo(18, -27); x.bezierCurveTo(12, -18, 10, -6, 12, 10); x.closePath(); x.fillStyle = body; x.fill(); x.stroke();
    blob(x, 12, -38, 12, 8, 0.35, body); blob(x, 22, -41, 6, 4, 0.3, belly);
    blob(x, 3, -48, 2.8, 6.5, -0.7, body); blob(x, 12, -50, 2.8, 6.5, 0.15, body);
    x.strokeStyle = dark; x.lineWidth = 2.4; x.beginPath(); x.moveTo(5, -47); x.lineTo(0, -64); x.moveTo(2, -56); x.lineTo(-6, -61); x.moveTo(11, -48); x.lineTo(16, -65); x.moveTo(14, -57); x.lineTo(21, -62); x.stroke();
    eye(x, 14, -41, 2); x.fillStyle = dark; x.beginPath(); x.arc(27, -42, 2.2, 0, 7); x.fill();
    x.restore();
    O(x, night); blob(x, 0, -54, 38, 17, 0, body);
    x.fillStyle = belly; x.beginPath(); x.ellipse(-2, -46, 24, 5, 0, 0, 7); x.fill();
    x.fillStyle = "#fff"; x.beginPath(); x.ellipse(-38, -58, 4, 6, 0.4, 0, 7); x.fill(); x.stroke();
  },
  rabbit(x, a, night) {
    O(x, night); const hop = a.phase === "pause" ? 0 : Math.abs(Math.sin(a.age * 0.18)) * 10, nib = a.phase === "pause" ? Math.sin(a.pauseT * 0.3) * 1.5 : 0;
    const body = sh([196, 176, 146], night), pink = sh([230, 170, 160], night);
    x.save(); x.translate(0, -hop);
    blob(x, 0, -14, 17, 12, 0, body); blob(x, -8, -8, 8, 7, 0, body); blob(x, 14, -22, 9, 8, 0, body);
    blob(x, 10, -36, 3.5, 10, -0.15, body); blob(x, 17, -35, 3.5, 10, 0.15, body); x.fillStyle = pink; x.beginPath(); x.ellipse(10, -36, 1.5, 6, -0.15, 0, 7); x.fill();
    blob(x, -17, -14, 4.5, 4.5, 0, "#fff"); eye(x, 17, -24, 1.8); x.fillStyle = pink; x.beginPath(); x.arc(22, -21 + nib, 1.5, 0, 7); x.fill();
    x.restore();
  },
  skunk(x, a, night) {
    O(x, night); const wob = Math.sin(a.age * 0.3) * 2, sniff = a.phase === "pause" ? Math.sin(a.pauseT * 0.25) * 2 : 0, walk = a.phase === "pause" ? 0 : Math.sin(a.age * 0.35) * 3;
    const blk = sh([44, 40, 48], night), wht = sh([242, 242, 246], night);
    x.fillStyle = blk; for (const lx of [-16, -6, 8, 18]) { x.beginPath(); x.roundRect(lx + (lx < 0 ? walk : -walk) - 3, -12, 6, 12, 2); x.fill(); x.stroke(); }
    x.beginPath(); x.moveTo(-18, -20); x.bezierCurveTo(-46, -30, -50, -66 + wob, -24, -68 + wob); x.bezierCurveTo(-8, -68 + wob, -14, -40, -10, -26); x.closePath(); x.fillStyle = blk; x.fill(); x.stroke();
    x.beginPath(); x.moveTo(-20, -30); x.bezierCurveTo(-38, -38, -40, -60 + wob, -24, -61 + wob); x.bezierCurveTo(-16, -60 + wob, -20, -44, -16, -32); x.closePath(); x.fillStyle = wht; x.fill();
    blob(x, 0, -18, 24, 13, 0, blk); blob(x, 22, -20 + sniff, 10, 8, 0, blk);
    x.fillStyle = wht; x.beginPath(); x.moveTo(-18, -27); x.quadraticCurveTo(4, -34, 24, -28 + sniff); x.lineTo(30, -21 + sniff); x.lineTo(22, -24 + sniff); x.quadraticCurveTo(4, -29, -14, -22); x.closePath(); x.fill();
    blob(x, 18, -27 + sniff, 2.6, 3, 0, blk); blob(x, 25, -27 + sniff, 2.6, 3, 0, blk);
    eye(x, 26, -21 + sniff, 1.5); x.fillStyle = "#1a120c"; x.beginPath(); x.arc(32, -18 + sniff, 1.7, 0, 7); x.fill();
  },
  bear(x, a, night) {
    O(x, night); const walk = a.phase === "pause" ? 0 : Math.sin(a.age * 0.16), sniff = a.phase === "pause" ? Math.sin(a.pauseT * 0.07) * 6 : 0;
    const body = sh([92, 60, 40], night), lite = sh([150, 108, 76], night);
    // legs: thick, with a hint of a paw
    x.fillStyle = body; for (const [lx, ph] of [[-30, 0], [-16, Math.PI], [14, Math.PI], [28, 0]]) { const sw = walk * Math.sin(ph + 1) * 8; x.beginPath(); x.roundRect(lx + sw - 8, -38, 16, 38, 6); x.fill(); x.stroke(); }
    // one body silhouette: shoulder hump up front, sloping back, round rump
    x.beginPath(); x.moveTo(30, -34); x.bezierCurveTo(50, -40, 58, -66, 44, -80); x.bezierCurveTo(30, -94, 4, -90, -10, -84); x.bezierCurveTo(-34, -80, -56, -70, -54, -50); x.bezierCurveTo(-52, -34, -30, -28, -10, -30); x.closePath(); x.fillStyle = body; x.fill(); x.stroke();
    // head with round ears, light muzzle
    blob(x, 34, -82 + sniff, 6.5, 6.5, 0, body); blob(x, 54, -84 + sniff, 6.5, 6.5, 0, body);
    x.fillStyle = lite; x.beginPath(); x.arc(34, -82 + sniff, 3, 0, 7); x.arc(54, -84 + sniff, 3, 0, 7); x.fill();
    blob(x, 46, -68 + sniff, 20, 16, 0.1, body);
    blob(x, 60, -63 + sniff, 10, 7, 0.1, lite); x.fillStyle = "#1a120c"; x.beginPath(); x.ellipse(67, -66 + sniff, 3.5, 2.5, 0, 0, 7); x.fill(); eye(x, 50, -72 + sniff, 2);
  },
  squirrel(x, a, night) {
    O(x, night); const body = sh([200, 108, 48], night), belly = sh([240, 212, 176], night), dk = sh([140, 70, 28], night);
    const hop = a.phase === "in" ? Math.abs(Math.sin(a.age * 0.35)) * 8 : 0, tw = Math.sin(a.age * 0.12) * 3;
    x.save();
    if (a.phase === "out") { x.translate(a.dir * 14, -(a.climb ?? 0)); x.rotate(-a.dir * Math.PI / 2); } else x.translate(0, -hop);
    x.beginPath(); x.moveTo(-10, -8); x.bezierCurveTo(-34, -10, -36, -46 + tw, -16, -48 + tw); x.bezierCurveTo(-4, -50 + tw, -4, -36, -12, -30); x.bezierCurveTo(-8, -22, -8, -14, -6, -10); x.closePath(); x.fillStyle = body; x.fill(); x.stroke();
    x.beginPath(); x.moveTo(-14, -14); x.bezierCurveTo(-26, -18, -26, -40 + tw, -16, -40 + tw); x.bezierCurveTo(-12, -38 + tw, -14, -26, -14, -14); x.closePath(); x.fillStyle = dk; x.fill();
    blob(x, 2, -13, 13, 10, 0, body); blob(x, 4, -10, 7, 5, 0, belly);
    blob(x, 14, -22, 8, 7, 0, body); blob(x, 9, -30, 2.6, 4, -0.3, body); blob(x, 16, -31, 2.6, 4, 0.3, body);
    eye(x, 16, -23, 1.6);
    const nib = a.phase === "pause" ? Math.sin(a.pauseT * 0.5) * 1.5 : 0; blob(x, 21, -12 + nib, 3.2, 3.2, 0, sh([150, 100, 50], night));
    x.fillStyle = body; x.fillRect(12, -14 + nib, 6, 3);
    x.restore();
  },
  frog(x, a, night) {
    O(x, night); const g1 = sh([92, 160, 78], night), g2 = sh([150, 200, 110], night);
    const hopT = a.phase === "out" ? (a.climb ?? 0) : 0, hopN = Math.floor(hopT / 30), hu = (hopT % 30) / 30, air = a.phase === "out" && hopN < 3 ? Math.sin(hu * Math.PI) * 14 : 0;
    if (a.phase === "out" && hopN >= 3) { // splash
      x.save(); x.scale(1.7, 1.7); x.translate(42, 0); const su = (hopT - 90) / 20; x.strokeStyle = `rgba(230,245,255,${Math.max(0, 1 - su)})`; x.lineWidth = 2; x.beginPath(); x.ellipse(0, 0, 6 + su * 18, 2.5 + su * 7, 0, 0, 7); x.stroke();
      x.fillStyle = `rgba(235,248,255,${Math.max(0, 0.9 - su)})`; for (let i = 0; i < 5; i++) { x.beginPath(); x.arc((i - 2) * 5, -su * 22 * Math.sin(i + 1) - 2, 1.5, 0, 7); x.fill(); } x.restore(); return;
    }
    const puff = a.phase === "pause" ? Math.max(0, Math.sin(a.pauseT * 0.12)) : 0;
    x.save(); x.scale(1.7, 1.7); x.translate(hopN * 14, -air);
    x.fillStyle = g1; x.beginPath(); x.moveTo(-9, -1); x.lineTo(-13, -8); x.lineTo(-6, -6); x.closePath(); x.fill(); x.stroke(); // back leg
    blob(x, 0, -6, 10, 6, 0, g1); blob(x, 7, -9, 6, 4.5, 0, g1); // body, head
    x.fillStyle = g2; x.beginPath(); x.ellipse(1, -4, 6, 2.5, 0, 0, 7); x.fill();
    if (puff > 0) { x.fillStyle = sh([215, 235, 200], night); x.beginPath(); x.ellipse(9, -5, 3 + puff * 3, 2 + puff * 2.5, 0, 0, 7); x.fill(); } // throat
    blob(x, 5, -13, 2.2, 2.2, 0, g1); blob(x, 10, -13, 2.2, 2.2, 0, g1); eye(x, 5, -13, 1); eye(x, 10, -13, 1);
    x.restore();
  },
  birds(x, a, night) {
    x.strokeStyle = sh([40, 36, 48], night); x.lineWidth = 2.2; x.lineCap = "round";
    for (let i = 0; i < (a.n ?? 3); i++) { const off = i - ((a.n ?? 3) - 1) / 2, bx = -Math.abs(off) * 28, by = off * 16, f = Math.sin(a.age * 0.3 + i) * 5; x.beginPath(); x.moveTo(bx - 9, by - f); x.quadraticCurveTo(bx - 4, by + 2, bx, by); x.quadraticCurveTo(bx + 4, by + 2, bx + 9, by - f); x.stroke(); }
  },
  heron(x, a, night) {
    O(x, night); const grey = sh([170, 180, 196], night), dk = sh([70, 76, 92], night), flap = a.fly && a.phase !== "pause" ? Math.sin(a.age * 0.2) * 22 : 0;
    const landed = a.phase === "pause", peck = landed ? Math.max(0, Math.sin(a.pauseT * 0.05)) * 0.9 : 0;
    x.strokeStyle = dk; x.lineWidth = 2; if (landed) { x.beginPath(); x.moveTo(-4, -34); x.lineTo(-4, 0); x.moveTo(4, -34); x.lineTo(4, 0); x.stroke(); }
    O(x, night); blob(x, 0, -40, 20, 9, 0, grey);
    if (!landed) { x.fillStyle = grey; x.beginPath(); x.moveTo(-6, -42); x.lineTo(-8, -42 - flap); x.lineTo(14, -44); x.closePath(); x.fill(); x.stroke(); x.beginPath(); x.moveTo(-6, -40); x.lineTo(-8, -40 + flap * 0.6); x.lineTo(14, -38); x.closePath(); x.fill(); x.stroke(); }
    x.save(); x.translate(14, -46); x.rotate(peck);
    x.strokeStyle = grey; x.lineWidth = 5; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(6, -18, 2, -30); x.stroke();
    O(x, night); blob(x, 2, -32, 5.5, 5.5, 0, grey); x.fillStyle = sh([236, 190, 80], night); x.beginPath(); x.moveTo(6, -34); x.lineTo(22, -29); x.lineTo(6, -28); x.closePath(); x.fill(); x.stroke(); eye(x, 3, -33, 1.2);
    x.restore();
  },
};
