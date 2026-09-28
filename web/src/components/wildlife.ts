// The press, the stream, and the visitors. Pure canvas, no images. Used by scene.ts.
// World coordinates: the fire sits at (600, 600); +x is right, +y is toward the viewer.

type Ctx = CanvasRenderingContext2D;

/** Shade a color toward night (0 day … 1 night), with a little warmth from the fire. */
export function sh(c: number[], night: number, warm = 0) { const k = 0.32 + 0.68 * (1 - night) + warm * 0.3; return `rgb(${c.map((v) => Math.min(255, Math.round(v * k))).join(",")})`; }
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- the stream: from under the wheel, toward the viewer, then along the bottom and off the right edge.
// Cut into the ground (mud edge, bank, shallow sides, deeper middle), noise ripples drifting downstream.
const RIVER_V1 = [[1093, 566], [1088, 592], [1072, 622], [1062, 652], [1082, 682], [1130, 702], [1200, 716], [1290, 728], [1420, 744], [1700, 790], [2200, 900]];
const RIVER_V2 = [[1124, 582], [1112, 606], [1088, 632], [1070, 660], [1086, 686], [1130, 704], [1200, 716], [1290, 728], [1420, 744], [1700, 790], [2200, 900]];
let riverPts = RIVER_V1;
let poolAt: [number, number] = [1093, 574];
/** pick the stream head that matches the press being drawn */
export function useRiver(v2: boolean) { riverPts = v2 ? RIVER_V2 : RIVER_V1; poolAt = v2 ? [1124, 586] : [1093, 574]; }
export function riverAt(u: number): [number, number, number] {
  const P = riverPts, n = P.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const dcr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t * t);
  return [cr(p0[0], p1[0], p2[0], p3[0], f), cr(p0[1], p1[1], p2[1], p3[1], f), Math.atan2(dcr(p0[1], p1[1], p2[1], p3[1], f), dcr(p0[0], p1[0], p2[0], p3[0], f))];
}
const rw = (u: number) => Math.min(44, 7 + u * u * 34 + u * 10);
const NP = new Uint8Array(512); for (let i = 0; i < 256; i++) NP[i] = i; for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [NP[i], NP[j]] = [NP[j], NP[i]]; } for (let i = 0; i < 256; i++) NP[i + 256] = NP[i];
function vnoise(xx: number, yy: number) { const X = Math.floor(xx) & 255, Y = Math.floor(yy) & 255; const fx = xx - Math.floor(xx), fy = yy - Math.floor(yy); const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const h = (a: number, b: number) => NP[NP[a] + b] / 255; return lerp(lerp(h(X, Y), h(X + 1, Y), u), lerp(h(X, Y + 1), h(X + 1, Y + 1), u), v); }
function riverOutline(x: Ctx, pad: number) {
  x.beginPath();
  for (let i = 0; i <= 60; i++) { const [px, py, ang] = riverAt(i / 60); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(i / 60) + pad; if (i === 0) x.moveTo(px + nx * w, py + ny * w); else x.lineTo(px + nx * w, py + ny * w); }
  for (let i = 60; i >= 0; i--) { const [px, py, ang] = riverAt(i / 60); const nx = -Math.sin(ang), ny = Math.cos(ang), w = rw(i / 60) + pad; x.lineTo(px - nx * w, py - ny * w); }
  x.closePath();
}
export function drawRiver(x: Ctx, t: number, night: number, warm: number) {
  x.fillStyle = sh([58, 52, 38], night); x.beginPath(); x.ellipse(poolAt[0], poolAt[1], 46, 15, 0, 0, 7); x.fill();
  x.fillStyle = sh([150, 146, 134], night); x.beginPath(); x.ellipse(poolAt[0], poolAt[1] - 2, 42, 12, 0, 0, 7); x.fill();
  x.fillStyle = sh([70, 118, 140], night); x.beginPath(); x.ellipse(poolAt[0], poolAt[1], 38, 9, 0, 0, 7); x.fill();
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

// ---------- the press, v2: matched to the Plank Press reference (front view, drum wheel on the right)
export function drawMill2(x: Ctx, t: number, px: number, py: number, sc: number, night: number, warm: number) {
  x.save(); x.translate(px, py); x.scale(sc, sc);
  const C = {
    roof: sh([46, 104, 92], night), roofD: sh([32, 78, 70], night), roofL: sh([88, 150, 132], night),
    beam: sh([122, 78, 40], night), beamD: sh([84, 52, 26], night), wall: sh([214, 176, 118], night, warm), wallD: sh([186, 146, 92], night),
    plaster: sh([236, 218, 170], night, warm), cream: sh([244, 232, 196], night), gold: sh([222, 176, 78], night), goldD: sh([170, 128, 50], night),
    green: sh([36, 92, 82], night), greenD: sh([24, 66, 60], night), stone: sh([214, 208, 190], night), stoneG: sh([170, 176, 168], night), stoneD: sh([150, 146, 132], night),
    steel: sh([150, 190, 196], night), steelD: sh([98, 140, 150], night), paper: sh([248, 244, 232], night), paperD: sh([220, 212, 196], night),
    water: sh([88, 190, 200], night), waterD: sh([54, 140, 156], night),
  };
  const wg = night > 0.4 ? `rgba(255,200,110,${0.9 * night})` : C.cream;
  const R = (xx: number, yy: number, w: number, h: number, c: string) => { x.fillStyle = c; x.fillRect(xx, yy, w, h); };
  const RR = (xx: number, yy: number, w: number, h: number, r: number, c: string) => { x.fillStyle = c; x.beginPath(); x.roundRect(xx, yy, w, h, r); x.fill(); };

  // ---- ground shadow, footing
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(10, 6, 250, 16, 0, 0, 7); x.fill();
  R(-190, -14, 380, 18, C.beamD); R(-186, -18, 372, 6, C.beam);

  // ---- main box: timber frame, tan plank infill
  const L = -150, Rt = 150, top = -200, bot = -12;
  R(L, top, Rt - L, bot - top, C.wall);
  x.strokeStyle = C.wallD; x.lineWidth = 1.5; for (let vx = L + 12; vx < Rt; vx += 12) { x.beginPath(); x.moveTo(vx, top); x.lineTo(vx, bot); x.stroke(); } // vertical planks
  R(L - 8, top, 12, bot - top, C.beam); R(Rt - 4, top, 12, bot - top, C.beam); // corner posts
  R(L - 8, top - 4, Rt - L + 16, 10, C.beam); // eave beam

  // sign band
  R(L + 6, -190, Rt - L - 12, 34, C.plaster);
  RR(-112, -186, 224, 26, 4, C.green); x.strokeStyle = C.gold; x.lineWidth = 2; x.beginPath(); x.roundRect(-112, -186, 224, 26, 4); x.stroke();
  x.fillStyle = C.gold; x.font = '800 15px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PLANK & PAPER', 0, -173);
  R(L + 6, -156, Rt - L - 12, 6, C.beam); // beam under the sign

  // windows: two big 2x3 grid windows, gold frames
  for (const wx of [-134, 64]) {
    R(wx - 4, -140, 78, 76, C.beam); R(wx, -136, 70, 68, wg);
    x.strokeStyle = C.gold; x.lineWidth = 4; x.strokeRect(wx, -136, 70, 68);
    x.lineWidth = 3; x.beginPath(); x.moveTo(wx + 35, -136); x.lineTo(wx + 35, -68); x.moveTo(wx, -102); x.lineTo(wx + 70, -102); x.stroke();
    R(wx - 8, -68, 86, 6, C.beam); // sill
  }
  // central bay: an open panel of vertical slats (the workshop), darker
  R(-56, -146, 112, 134, C.wallD); x.strokeStyle = C.beamD; x.lineWidth = 1.5; for (let vx = -50; vx < 56; vx += 8) { x.beginPath(); x.moveTo(vx, -146); x.lineTo(vx, -12); x.stroke(); }
  R(-60, -150, 120, 6, C.beam); R(-60, -150, 6, 138, C.beam); R(54, -150, 6, 138, C.beam);

  // ---- gable: cream plaster with timber frame, round window
  x.fillStyle = C.plaster; x.beginPath(); x.moveTo(L - 8, top); x.lineTo(0, -360); x.lineTo(Rt + 8, top); x.closePath(); x.fill();
  x.strokeStyle = C.beam; x.lineWidth = 8; x.beginPath(); x.moveTo(L - 2, top - 2); x.lineTo(0, -354); x.lineTo(Rt + 2, top - 2); x.stroke();
  x.lineWidth = 6; x.beginPath(); x.moveTo(-110, -240); x.lineTo(110, -240); x.moveTo(-110, -240); x.lineTo(-60, top); x.moveTo(110, -240); x.lineTo(60, top); x.stroke();
  R(L - 8, top - 6, Rt - L + 16, 10, C.beam);
  // round window
  x.fillStyle = C.goldD; x.beginPath(); x.arc(0, -284, 30, 0, 7); x.fill();
  x.fillStyle = wg; x.beginPath(); x.arc(0, -284, 24, 0, 7); x.fill();
  x.strokeStyle = C.gold; x.lineWidth = 5; x.beginPath(); x.arc(0, -284, 27, 0, 7); x.stroke();
  x.lineWidth = 4; x.beginPath(); x.moveTo(0, -308); x.lineTo(0, -260); x.moveTo(-24, -284); x.lineTo(24, -284); x.stroke();

  // ---- chimney: stacked stone blocks, green cap, smoke (left of the ridge, behind the roof)
  const cx = -80, cw = 46;
  for (let i = 0; i < 12; i++) { const yy = -420 + i * 16; R(cx, yy, cw, 14, i % 2 ? C.stone : C.stoneG); x.strokeStyle = C.stoneD; x.lineWidth = 1; x.strokeRect(cx, yy, cw, 14); }
  R(cx - 6, -432, cw + 12, 14, C.green); R(cx - 4, -444, cw + 8, 12, C.roof); R(cx - 8, -448, cw + 16, 6, C.greenD);
  for (let i = 0; i < 5; i++) { const u = (t * 0.003 + i * 0.2) % 1; x.fillStyle = `rgba(215,215,225,${(0.22 - u * 0.2) * (1 - night * 0.4)})`; x.beginPath(); x.arc(cx + cw / 2 + Math.sin(u * 6 + i) * 10 + u * 18, -456 - u * 90, 6 + u * 16, 0, 7); x.fill(); }

  // ---- roof: thick, overhangs, lighter edge, shingle rows
  const RY = -372, OV = 44, TH = 26; // ridge y, overhang, slab thickness
  // underside / dark slab
  x.fillStyle = C.roofD; x.beginPath(); x.moveTo(L - OV, top + 10); x.lineTo(0, RY); x.lineTo(Rt + OV, top + 10); x.lineTo(Rt + OV, top + 10 + TH); x.lineTo(0, RY + TH); x.lineTo(L - OV, top + 10 + TH); x.closePath(); x.fill();
  // top face with shingle rows
  x.save(); x.beginPath(); x.moveTo(L - OV, top + 10); x.lineTo(0, RY); x.lineTo(Rt + OV, top + 10); x.lineTo(Rt + OV, top + 24); x.lineTo(0, RY + 14); x.lineTo(L - OV, top + 24); x.closePath(); x.clip();
  x.fillStyle = C.roof; x.fillRect(-300, -420, 600, 320);
  x.fillStyle = C.roofD; for (let r = 0; r < 24; r++) { const yy = top + 22 - r * 8; for (let i = 0; i < 44; i++) x.fillRect(-300 + i * 14 + (r & 1) * 7, yy - 4, 12, 2.5); }
  x.restore();
  x.strokeStyle = C.roofL; x.lineWidth = 6; x.beginPath(); x.moveTo(L - OV, top + 10); x.lineTo(0, RY); x.lineTo(Rt + OV, top + 10); x.stroke(); // bright edge
  x.strokeStyle = C.greenD; x.lineWidth = 3; x.beginPath(); x.moveTo(L - OV, top + 10 + TH); x.lineTo(0, RY + TH); x.lineTo(Rt + OV, top + 10 + TH); x.stroke();

  // ---- the water wheel: a real cylinder, axle running into the wall, seen from slightly to the right and above.
  // Points on the drum: angle th around the axle -> y = cy + r sin(th), depth z = r cos(th) (toward the viewer).
  // The view yaw shifts screen x by z * YAW, so paddles at the front bulge right and the rims are thin ellipses.
  const W = { xL: Rt - 2, xR: Rt + 118, cy: -124, r: 112, rin: 84 };
  const YAW = 0.19, PITCH = 0.10; // sin of the viewing angles
  const axle = t * 0.012, N = 16;
  const P = (xx: number, th: number, rr: number): [number, number] => [xx + rr * Math.cos(th) * YAW, W.cy + rr * Math.sin(th) - rr * Math.cos(th) * PITCH];
  const paddle = (i: number, front: boolean) => {
    const th = (i / N) * Math.PI * 2 + axle, c = Math.cos(th);
    if (front ? c < 0 : c >= 0) return;
    const a1 = P(W.xL, th, W.rin), a2 = P(W.xR, th, W.rin), b2 = P(W.xR, th, W.r), b1 = P(W.xL, th, W.r);
    const k = front ? 0.55 + 0.45 * c : 0.28 + 0.12 * (1 + c);
    x.fillStyle = `rgb(${Math.round(222 * k)},${Math.round(176 * k)},${Math.round(100 * k)})`;
    x.beginPath(); x.moveTo(a1[0], a1[1]); x.lineTo(a2[0], a2[1]); x.lineTo(b2[0], b2[1]); x.lineTo(b1[0], b1[1]); x.closePath(); x.fill();
    x.strokeStyle = `rgba(60,36,14,${front ? 0.7 : 0.4})`; x.lineWidth = 1.5; x.stroke();
    // a lighter lip along the outer edge where the light catches it
    x.strokeStyle = `rgba(255,236,190,${front ? 0.35 * k : 0})`; x.lineWidth = 2; x.beginPath(); x.moveTo(b1[0], b1[1]); x.lineTo(b2[0], b2[1]); x.stroke();
  };
  const order = (front: boolean) => Array.from({ length: N }, (_, i) => i).sort((i, j) => { const ci = Math.cos((i / N) * Math.PI * 2 + axle), cj = Math.cos((j / N) * Math.PI * 2 + axle); return front ? ci - cj : cj - ci; });
  const rim = (xx: number, near: boolean) => {
    const rx = W.r * YAW, ry = W.r;
    x.save(); x.translate(xx, W.cy); x.rotate(-PITCH * 0.5);
    x.strokeStyle = near ? C.green : C.greenD; x.lineWidth = near ? 11 : 8; x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, 7); x.stroke();
    x.strokeStyle = C.goldD; x.lineWidth = 2; x.beginPath(); x.ellipse(0, 0, rx * 0.8, ry - 7, 0, 0, 7); x.stroke();
    if (near) { x.strokeStyle = C.beam; x.lineWidth = 4; for (let i = 0; i < 8; i++) { const th = i * Math.PI / 8 + axle; x.beginPath(); x.moveTo(0, 0); x.lineTo(rx * Math.cos(th), ry * Math.sin(th)); x.moveTo(0, 0); x.lineTo(-rx * Math.cos(th), -ry * Math.sin(th)); x.stroke(); }
      x.fillStyle = C.gold; x.beginPath(); x.ellipse(0, 0, rx * 0.35, 12, 0, 0, 7); x.fill(); }
    x.restore();
  };
  // shadow on the wall behind the wheel, then far rim, back paddles, hub shaft, front paddles, near rim
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse((W.xL + W.xR) / 2 - 6, W.cy + 10, (W.xR - W.xL) / 2 + 30, W.r + 16, 0, 0, 7); x.fill();
  rim(W.xL, false);
  for (const i of order(false)) paddle(i, false);
  x.strokeStyle = C.beamD; x.lineWidth = 10; x.beginPath(); x.moveTo(W.xL, W.cy); x.lineTo(W.xR + 30, W.cy); x.stroke();
  for (const i of order(true)) paddle(i, true);
  rim(W.xR, true);
  // axle end and bearing post to the ground
  x.fillStyle = C.greenD; x.beginPath(); x.roundRect(W.xR + 14, W.cy - 9, 30, 18, 4); x.fill();
  R(W.xR + 36, W.cy, 10, W.r + 12, C.green); R(W.xR + 28, W.cy + W.r + 6, 26, 6, C.greenD);
  // water: the flume drops a sheet onto the top of the drum; it sheets down the front face and off the bottom
  const fl = { x: W.xL + 10, y: W.cy - W.r - 46, w: W.xR - W.xL - 20 };
  R(fl.x - 2, fl.y, fl.w + 4, 12, C.beamD); x.fillStyle = C.water; x.fillRect(fl.x, fl.y + 2, fl.w, 6);
  x.fillStyle = `rgba(160,225,235,${0.75 - night * 0.25})`;
  for (let i = 0; i < 14; i++) { const u = (t * 0.045 + i * 0.071) % 1; const xx = fl.x + 4 + (i * 13) % (fl.w - 8); x.fillRect(xx, fl.y + 10 + u * 34, 3, 10); }
  for (let i = 0; i < 18; i++) { const u = (t * 0.03 + i * 0.055) % 1; const th = -Math.PI / 2 + u * Math.PI; const [px, py] = P(W.xL + 6 + (i * 17) % (W.xR - W.xL - 12), th, W.r + 5); x.globalAlpha = (0.7 - night * 0.2) * Math.sin(u * Math.PI); x.beginPath(); x.arc(px, py, 2, 0, 7); x.fill(); }
  x.globalAlpha = 1;
  // tailrace: stone channel running out toward the viewer
  const ty = W.cy + W.r + 4;
  x.fillStyle = C.stoneG; x.beginPath(); x.moveTo(W.xL - 6, ty); x.lineTo(W.xR + 16, ty); x.lineTo(W.xR + 36, ty + 44); x.lineTo(W.xL - 26, ty + 44); x.closePath(); x.fill();
  x.fillStyle = C.waterD; x.beginPath(); x.moveTo(W.xL + 2, ty + 4); x.lineTo(W.xR + 8, ty + 4); x.lineTo(W.xR + 24, ty + 36); x.lineTo(W.xL - 14, ty + 36); x.closePath(); x.fill();
  for (let i = 0; i < 5; i++) { const yy = ty + 6 + i * 6; x.fillStyle = i % 2 ? C.water : C.waterD; x.fillRect(W.xL - 2 - i * 2, yy, W.xR - W.xL + 12 + i * 4, 4); }
  x.fillStyle = `rgba(230,250,255,${0.6 - night * 0.2})`; for (let i = 0; i < 12; i++) { const u = (t * 0.03 + i * 0.083) % 1; x.fillRect(W.xL + ((i * 17) % (W.xR - W.xL + 8)) - u * 6, ty + 4 + u * 30, 4, 2); }
  x.fillStyle = C.stone; x.fillRect(W.xL - 28, ty + 40, W.xR - W.xL + 68, 8); x.fillRect(W.xL - 10, ty - 4, 10, 46); x.fillRect(W.xR + 10, ty - 4, 10, 46);

  // ---- the paper machine out front, kept to shapes that read at half size: two green posts, a steel roller,
  // and a big white sheet coming off a roll and hanging to the ground
  const M = { x: -150, y: -12, w: 250 };
  for (const pxx of [M.x, M.x + M.w - 14]) { R(pxx, M.y - 98, 14, 98, C.green); R(pxx - 10, M.y - 8, 34, 8, C.greenD); R(pxx + 4, M.y - 98, 3, 98, C.roofL); }
  R(M.x - 4, M.y - 106, M.w + 8, 12, C.green); R(M.x - 4, M.y - 106, M.w + 8, 3, C.roofL);
  // steel roller across the top
  x.fillStyle = C.steelD; x.beginPath(); x.roundRect(M.x + 16, M.y - 94, M.w - 32, 34, 17); x.fill();
  x.fillStyle = C.steel; x.beginPath(); x.roundRect(M.x + 18, M.y - 92, M.w - 36, 14, 7); x.fill();
  x.fillStyle = C.gold; for (const gx of [M.x + 16, M.x + M.w - 16]) { x.beginPath(); x.arc(gx, M.y - 77, 8, 0, 7); x.fill(); }
  // the sheet: wide, white, outlined, curling at the floor
  x.beginPath(); x.moveTo(M.x + 40, M.y - 78); x.lineTo(M.x + 170, M.y - 78); x.lineTo(M.x + 170, M.y - 14); x.quadraticCurveTo(M.x + 170, M.y + 4, M.x + 150, M.y + 4); x.lineTo(M.x + 52, M.y + 4); x.quadraticCurveTo(M.x + 36, M.y + 4, M.x + 40, M.y - 14); x.closePath();
  x.fillStyle = C.paper; x.fill(); x.strokeStyle = C.paperD; x.lineWidth = 2; x.stroke();
  x.fillStyle = C.paperD; x.fillRect(M.x + 40, M.y - 78, 130, 3); x.fillRect(M.x + 165, M.y - 74, 4, 72);
  // the roll itself over the roller, with its end showing
  x.fillStyle = C.paper; x.beginPath(); x.roundRect(M.x + 34, M.y - 96, 142, 34, 17); x.fill(); x.strokeStyle = C.paperD; x.lineWidth = 2; x.stroke();
  x.fillStyle = C.paperD; x.beginPath(); x.ellipse(M.x + 176, M.y - 79, 8, 16, 0, 0, 7); x.fill(); x.fillStyle = C.paper; x.beginPath(); x.ellipse(M.x + 176, M.y - 79, 3.5, 7, 0, 0, 7); x.fill();
  // one gear on the left post, brass
  x.fillStyle = C.gold; x.beginPath(); x.arc(M.x + 7, M.y - 50, 13, 0, 7); x.fill(); x.fillStyle = C.goldD; for (let i = 0; i < 8; i++) { x.save(); x.translate(M.x + 7, M.y - 50); x.rotate(i * Math.PI / 4 + t * 0.03); x.fillRect(11, -3, 6, 6); x.restore(); } x.fillStyle = C.greenD; x.beginPath(); x.arc(M.x + 7, M.y - 50, 3.5, 0, 7); x.fill();

  // ---- a little pine and grass to the left, like the reference
  x.fillStyle = C.roof; x.beginPath(); x.moveTo(-262, -12); x.lineTo(-228, -150); x.lineTo(-194, -12); x.closePath(); x.fill();
  x.fillStyle = C.roofD; x.beginPath(); x.moveTo(-262, -12); x.lineTo(-228, -150); x.lineTo(-228, -12); x.closePath(); x.fill();
  R(-231, -12, 6, 8, C.beamD);
  x.fillStyle = C.roofL; for (const [gx, gy] of [[-236, -6], [-170, -4], [230, -6]] as [number, number][]) { x.beginPath(); x.ellipse(gx, gy, 8, 4, 0, 0, 7); x.fill(); }
  x.restore();
}

// ---------- visitors
export type Kind = "deer" | "rabbit" | "skunk" | "bear" | "squirrel" | "birds" | "heron" | "frog";
export interface Animal { kind: Kind; age: number; dead: boolean; dir: 1 | -1; phase: "in" | "pause" | "out"; pauseT: number; pauseLen: number; x: number; y: number; v: number; stopAt: number; n?: number; climb?: number; fly?: boolean }
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
  /** afterEach: called after each animal is drawn, with its feet's y (world units), so the scene can redraw anything
   *  nearer the viewer on top of it — e.g. a tree the animal is walking behind. */
  function draw(x: Ctx, t: number, night: number, layer: "back" | "front", afterEach?: (a: Animal, footY: number) => void) {
    if (layer === "front" && night > 0.6) { x.fillStyle = "#d9ff7a"; for (const f of fireflies) { const a = Math.max(0, Math.sin(t * 0.05 + f.p)) ** 3 * night; if (a < 0.05) continue; x.globalAlpha = a * 0.9; x.beginPath(); x.arc(600 + f.x + Math.sin(t * 0.01 + f.p) * 18, 520 + f.y + Math.cos(t * 0.013 + f.p) * 10, 1.6 * f.s, 0, 7); x.fill(); } x.globalAlpha = 1; }
    for (const a of animals) {
      if (back(a) !== (layer === "back")) continue;
      x.save();
      const wy = a.kind === "heron" ? (a.phase === "pause" ? riverAt(0.3)[1] + 6 : riverAt(0.3)[1] + 6 - Math.min(160, Math.abs(a.x - a.stopAt) * 0.5) + a.y) : GROUND + a.y;
      x.translate(600 + a.x, wy); x.scale(a.dir, 1);
      DRAW[a.kind](x, a, night);
      x.restore();
      if (!a.fly) afterEach?.(a, wy);
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
