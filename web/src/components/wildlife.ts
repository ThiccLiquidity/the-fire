// The press, the stream, and the visitors. Pure canvas, no images. Used by scene.ts.
// World coordinates: the fire sits at (600, 600); +x is right, +y is toward the viewer.

type Ctx = CanvasRenderingContext2D;

/** Shade a color toward night (0 day … 1 night), with a little warmth from the fire. */
export function sh(c: number[], night: number, warm = 0) { const k = 0.32 + 0.68 * (1 - night) + warm * 0.3; return `rgb(${c.map((v) => Math.min(255, Math.round(v * k))).join(",")})`; }
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- the stream: from under the wheel, toward the viewer, then along the bottom and off the right edge
const riverPts = [[1150, 572], [1122, 596], [1070, 626], [1022, 656], [1032, 684], [1090, 700], [1180, 706], [1320, 710]];
export function riverAt(u: number): [number, number, number] {
  const n = riverPts.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i; const a = riverPts[i], b = riverPts[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), Math.atan2(b[1] - a[1], b[0] - a[0])];
}
const rw = (u: number) => 10 + u * 30;
export function drawRiver(x: Ctx, t: number, night: number, warm: number) {
  x.beginPath();
  for (let i = 0; i <= 48; i++) { const [px, py, ang] = riverAt(i / 48); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(i / 48); if (i === 0) x.moveTo(px + nx * w, py + ny * w); else x.lineTo(px + nx * w, py + ny * w); }
  for (let i = 48; i >= 0; i--) { const [px, py, ang] = riverAt(i / 48); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(i / 48); x.lineTo(px - nx * w, py - ny * w); }
  x.closePath();
  x.fillStyle = sh([64, 118, 140], night, warm * 0.3); x.fill();
  x.save(); x.clip();
  // flow: soft light ribbons drifting downstream, wobbling across the width
  for (let k = 0; k < 22; k++) {
    const u = (t * 0.0022 + k / 22) % 1; const [px, py, ang] = riverAt(u); const w = rw(u), nx = -Math.sin(ang), ny = Math.cos(ang), dx = Math.cos(ang), dy = Math.sin(ang);
    const a = (0.28 - night * 0.12) * Math.sin(u * Math.PI); x.strokeStyle = `rgba(210,235,248,${a})`; x.lineWidth = 2.2;
    x.beginPath();
    for (let j = -1; j <= 1; j += 0.25) { const wob = Math.sin(j * 4 + t * 0.06 + k) * 4; const cx = px + nx * w * j * 0.9 + dx * wob, cy = py + ny * w * j * 0.9 + dy * wob; if (j === -1) x.moveTo(cx, cy); else x.lineTo(cx, cy); }
    x.stroke();
  }
  // foam along the banks and under the wheel
  x.fillStyle = `rgba(235,245,250,${0.5 - night * 0.2})`;
  for (let k = 0; k < 30; k++) { const u = (t * 0.0015 + k * 0.033) % 1; const [px, py, ang] = riverAt(u); const w = rw(u), nx = -Math.sin(ang), ny = Math.cos(ang), side = k & 1 ? 1 : -1; const r = 1 + Math.abs(Math.sin(t * 0.05 + k)) * 1.4; x.beginPath(); x.arc(px + nx * w * 0.86 * side, py + ny * w * 0.86 * side, r, 0, 7); x.fill(); }
  for (let k = 0; k < 10; k++) { const [px, py] = riverAt(0.02 + k * 0.012); x.beginPath(); x.arc(px + Math.sin(t * 0.1 + k * 2) * 8, py + Math.cos(t * 0.13 + k) * 4, 1.5 + (k % 3), 0, 7); x.fill(); }
  if (night > 0.5) { x.fillStyle = `rgba(255,255,230,${0.45 * night})`; for (let k = 0; k < 8; k++) { const u = (t * 0.001 + k * 0.125) % 1; const [px, py] = riverAt(u); x.fillRect(px + Math.sin(k * 3) * rw(u) * 0.5, py, 2.5, 1.2); } }
  x.restore();
  x.strokeStyle = sh([62, 84, 58], night); x.lineWidth = 2.5; x.stroke();
}

// ---------- the press
export function drawMill(x: Ctx, t: number, px: number, py: number, sc: number, night: number, warm: number) {
  x.save(); x.translate(px, py); x.scale(sc, sc);
  const wg = night > 0.4 ? `rgba(255,196,96,${0.9 * night})` : sh([250, 236, 190], night);
  const wood = sh([176, 124, 72], night, warm), woodD = sh([124, 84, 46], night), cream = sh([232, 214, 168], night, warm), teal = sh([44, 108, 96], night), tealD = sh([30, 82, 74], night), gold = sh([230, 186, 92], night), stone = sh([200, 196, 182], night), stoneD = sh([160, 154, 140], night);
  const R = (xx: number, yy: number, ww: number, hh: number, c: string) => { x.fillStyle = c; x.fillRect(xx, yy, ww, hh); };
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
  R(118, -150, 90, 10, woodD); x.fillStyle = sh([140, 190, 210], night); x.fillRect(120, -148, 86, 4);
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
export type Kind = "deer" | "rabbit" | "skunk" | "bear" | "squirrel" | "birds" | "heron";
interface Animal { kind: Kind; age: number; dead: boolean; dir: 1 | -1; phase: "in" | "pause" | "out"; pauseT: number; pauseLen: number; x: number; y: number; v: number; stopAt: number; n?: number; climb?: number; fly?: boolean }
const GROUND = 600;

export function createWildlife(treeXs: number[]) {
  const animals: Animal[] = [];
  let nextVisit = Date.now() + rnd(2, 6) * 60_000; // first visitor a few minutes after load
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
      else { if (a.kind === "squirrel") { a.climb = (a.climb ?? 0) + 2.4; if (a.climb > 150) a.dead = true; } else { a.x += a.v * (a.kind === "skunk" ? 1 : 1.3) * a.dir; if (a.kind === "heron") a.y -= 1.6; } }
      if (Math.abs(a.x) > 1500) a.dead = true;
    }
    for (let i = animals.length - 1; i >= 0; i--) if (animals[i].dead) animals.splice(i, 1);
    // real pacing: a visitor every 10–30 minutes; bears only after dark, birds/heron/squirrel by day
    if (Date.now() > nextVisit && animals.length === 0) {
      nextVisit = Date.now() + rnd(10, 30) * 60_000;
      const pool: Kind[] = night > 0.6 ? ["bear", "deer", "skunk", "rabbit", "skunk", "deer"] : ["deer", "rabbit", "squirrel", "birds", "birds", "heron", "skunk", "squirrel"];
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
    O(x, night); const walk = a.phase === "pause" ? 0 : Math.sin(a.age * 0.22), graze = a.phase === "pause" ? Math.min(1, a.pauseT / 40) * (0.7 + 0.3 * Math.sin(a.pauseT * 0.08)) : 0;
    const body = sh([176, 122, 74], night), belly = sh([228, 206, 168], night), dark = sh([90, 58, 30], night);
    x.fillStyle = body; for (const [lx, ph] of [[-24, 0], [-16, Math.PI], [12, Math.PI], [22, 0]]) { const sw = walk * Math.sin(ph + 1) * 9; x.beginPath(); x.moveTo(lx - 3 + sw * 0.2, -40); x.lineTo(lx + 3 + sw * 0.2, -40); x.lineTo(lx + 3 + sw, -2); x.lineTo(lx - 3 + sw, -2); x.closePath(); x.fill(); x.stroke(); x.fillStyle = dark; x.fillRect(lx - 3 + sw, -4, 6, 4); x.fillStyle = body; }
    blob(x, 0, -52, 36, 18, 0, body); blob(x, -2, -46, 26, 9, 0, belly); blob(x, -34, -54, 5, 8, 0.5, "#fff");
    x.save(); x.translate(28, -62); x.rotate(graze * 1.1);
    x.beginPath(); x.moveTo(-8, 4); x.lineTo(-4, -30); x.lineTo(10, -30); x.lineTo(8, 4); x.closePath(); x.fillStyle = body; x.fill(); x.stroke();
    blob(x, 6, -34, 13, 9, 0.25, body); blob(x, 17, -37, 7, 4.5, 0.15, belly); blob(x, -3, -44, 3, 7, -0.6, body); blob(x, 8, -46, 3, 7, 0.2, body);
    x.strokeStyle = dark; x.lineWidth = 2.5; x.beginPath(); x.moveTo(-1, -42); x.lineTo(-6, -58); x.moveTo(-4, -50); x.lineTo(-11, -55); x.moveTo(5, -42); x.lineTo(10, -59); x.moveTo(7, -51); x.lineTo(14, -57); x.stroke();
    eye(x, 9, -37, 2); x.fillStyle = dark; x.beginPath(); x.arc(23, -37, 2.2, 0, 7); x.fill();
    x.restore();
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
    const blk = sh([40, 36, 44], night), wht = sh([240, 240, 244], night);
    x.fillStyle = blk; for (const lx of [-14, -4, 8, 16]) x.fillRect(lx + (lx < 0 ? walk : -walk) - 2, -8, 4, 8);
    x.beginPath(); x.moveTo(-14, -14); x.quadraticCurveTo(-40, -50 + wob, -16, -54 + wob); x.quadraticCurveTo(-26, -30, -8, -18); x.closePath(); x.fillStyle = blk; x.fill(); x.stroke();
    x.beginPath(); x.moveTo(-18, -22); x.quadraticCurveTo(-32, -42 + wob, -20, -50 + wob); x.quadraticCurveTo(-24, -36, -13, -24); x.closePath(); x.fillStyle = wht; x.fill();
    blob(x, 0, -13, 21, 10, 0, blk); blob(x, 20, -15 + sniff, 8, 6.5, 0, blk);
    x.fillStyle = wht; x.beginPath(); x.moveTo(-14, -21); x.quadraticCurveTo(2, -26, 18, -20); x.lineTo(16, -17); x.quadraticCurveTo(2, -22, -12, -17); x.closePath(); x.fill();
    x.fillRect(22, -20 + sniff, 2, 6); blob(x, 16, -20 + sniff, 2.5, 2.5, 0, blk); eye(x, 23, -16 + sniff, 1.4); x.fillStyle = "#1a120c"; x.beginPath(); x.arc(28, -14 + sniff, 1.4, 0, 7); x.fill();
  },
  bear(x, a, night) {
    O(x, night); const walk = a.phase === "pause" ? 0 : Math.sin(a.age * 0.16), sniff = a.phase === "pause" ? Math.sin(a.pauseT * 0.07) * 6 : 0;
    const body = sh([96, 64, 42], night), lite = sh([140, 100, 70], night);
    x.fillStyle = body; for (const [lx, ph] of [[-32, 0], [-18, Math.PI], [16, Math.PI], [30, 0]]) { const sw = walk * Math.sin(ph + 1) * 8; x.beginPath(); x.roundRect(lx + sw - 7, -36, 14, 36, 5); x.fill(); x.stroke(); }
    blob(x, 0, -50, 48, 28, 0, body); blob(x, -30, -60, 18, 16, 0, body);
    blob(x, 44, -64 + sniff, 20, 17, 0, body); blob(x, 36, -80 + sniff, 6.5, 6.5, 0, body); blob(x, 54, -80 + sniff, 6.5, 6.5, 0, body);
    x.fillStyle = lite; x.beginPath(); x.arc(36, -80 + sniff, 3, 0, 7); x.arc(54, -80 + sniff, 3, 0, 7); x.fill();
    blob(x, 58, -60 + sniff, 10, 7, 0, lite); x.fillStyle = "#1a120c"; x.beginPath(); x.ellipse(64, -62 + sniff, 3.5, 2.5, 0, 0, 7); x.fill(); eye(x, 48, -68 + sniff, 2);
  },
  squirrel(x, a, night) {
    O(x, night); const body = sh([206, 116, 54], night), belly = sh([238, 208, 170], night);
    const hop = a.phase === "in" ? Math.abs(Math.sin(a.age * 0.35)) * 8 : 0;
    x.save();
    if (a.phase === "out") { x.translate(a.dir * 14, -(a.climb ?? 0)); x.rotate(-a.dir * Math.PI / 2); } else x.translate(0, -hop);
    x.beginPath(); x.moveTo(-8, -8); x.bezierCurveTo(-30, -14, -30, -40, -12, -38); x.bezierCurveTo(-4, -36, -6, -22, -4, -12); x.closePath(); x.fillStyle = body; x.fill(); x.stroke();
    blob(x, 0, -10, 11, 8, 0, body); blob(x, 2, -8, 6, 4, 0, belly); blob(x, 10, -16, 6, 5.5, 0, body); blob(x, 7, -22, 2, 3, -0.3, body); blob(x, 12, -22, 2, 3, 0.3, body);
    eye(x, 12, -17, 1.3);
    const nib = a.phase === "pause" ? Math.sin(a.pauseT * 0.5) * 1.5 : 0; blob(x, 15, -9 + nib, 2.8, 2.8, 0, sh([150, 100, 50], night));
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
