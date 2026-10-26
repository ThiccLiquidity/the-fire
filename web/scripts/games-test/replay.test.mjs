// Browser kicks replayed in Node: real pointer input (a desktop mouse pull and a phone touch flick) goes through the
// actual game (paperfb-sim.js + paperfb.js) in Chromium; every kick's raw input, tick and verdict is recorded, then
// Node maps and replays it with the same sim and must get the same kick (bit for bit) and the same result. A bulk
// check compares whole flights (every tick's state) between the browser and Node.
// Needs Playwright (PLAYWRIGHT=<path to the playwright package>, default /opt/node22/lib/node_modules/playwright);
// skipped without it. Run: npm run test:games (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import S from '../../art/factory/forge/paperfb-sim.mjs';

const require = createRequire(import.meta.url);
let pw = null;
try { pw = require(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright'); } catch { /* skipped below */ }
const forge = (f) => fileURLToPath(new URL(`../../art/factory/forge/${f}`, import.meta.url));
const SKIP = pw ? false : 'Playwright not found (set PLAYWRIGHT)';

// uncapped frames, so touch moves arrive about every 16 ms as on a phone (headless otherwise paces them at ~50 ms)
const ARGS = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
async function launch() {
  try { return await pw.chromium.launch({ args: ARGS }); } catch { return pw.chromium.launch({ args: ARGS, executablePath: '/opt/pw-browsers/chromium' }); }
}
async function gamePage(browser, touch) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#222}#f{width:390px;height:700px;position:relative}.pf-canvas{width:100%;height:100%;display:block}</style><div id="f"></div>');
  await page.addScriptTag({ path: forge('paperfb-sim.js') });
  await page.addScriptTag({ path: forge('paperfb.js') });
  await page.evaluate(() => {
    const rec = window.__rec = [];
    // harder levels (wind, gap, the RC car) so the release time matters; slow 4 just speeds up the watching
    window.__game = PaperFootball.mount(document.getElementById('f'), {
      seed: 4242, tuning: { slow: 4 }, mute: () => true, haptic: () => {},
      shotFor: (n) => PaperFBSim.shotFor(4242, n, 4 + (n % 5)),
      onEvent(type, d) {
        if (type === 'kick') rec.push({ input: d.input, kick: d.kick, kickTick: d.kickTick, shot: d.shot, events: [] });
        else if (type === 'make') rec.at(-1).result = 'good';
        else if (type === 'miss') rec.at(-1).result = d.why;
        else rec.at(-1)?.events.push(type);
      },
    });
  });
  return { page, errors };
}
const waitReady = (page) => page.waitForFunction(() => window.__game.ready(), null, { timeout: 15000, polling: 20 });
async function edgeOnPage(page) {
  return page.evaluate(() => { const e = window.__game.strikeEdge(), r = window.__game.canvas.getBoundingClientRect(); return { x: r.left + e.x, y: r.top + e.y, half: e.half }; });
}
let r = 99; const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };

async function pullKick(page) {
  const e = await edgeOnPage(page), x = e.x + (rnd() - 0.5) * 20, y = e.y - (rnd() - 0.6) * e.half * 1.4;
  const len = 40 + rnd() * 260, slant = (rnd() - 0.5) * 0.6;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + slant * len * i / 8, y + len * i / 8); await page.waitForTimeout(12); }
  await page.waitForTimeout(rnd() * 400); // hold, then let go (the moving posts' timing)
  await page.mouse.up();
}
async function flickKick(page, cdp) {
  const e = await edgeOnPage(page), x = e.x + (rnd() - 0.5) * 20, y = e.y - (rnd() - 0.6) * e.half * 1.4;
  const speed = 0.8 + rnd() * 3, slant = (rnd() - 0.5) * 0.7, steps = 4, gap = 16; // moves land ~16 ms apart
  const pt = (px, py) => [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
  await page.waitForTimeout(rnd() * 300);
  let px = x, py = y;
  for (let i = 0; i < steps; i++) { px += slant * speed * gap; py -= speed * gap; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(px, py) }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function replayInNode(rec) {
  let moving = 0;
  for (const k of rec) {
    assert.ok(k.result, 'every recorded kick got a verdict');
    assert.equal(S.checkInput(k.input), null, `the server would accept this real input: ${JSON.stringify(k.input).slice(0, 200)}`);
    const m = S.kickFromInput(k.input, S.DEFAULT_TUNING);
    assert.deepEqual(m.kick, k.kick, 'Node maps the raw input to the same kick, bit for bit');
    const v = S.simulate(k.shot, m.kick, S.DEFAULT_TUNING, { kickTick: k.kickTick });
    assert.equal(v.result, k.result, `same verdict (${JSON.stringify({ kick: k.kick, kickTick: k.kickTick })})`);
    assert.equal(v.furnace, k.events.includes('furnace'));
    assert.equal(v.thunked, k.events.includes('plank'));
    if (k.shot.move) moving++;
  }
  return moving;
}

test('desktop pulls in Chromium replay identically in Node', { skip: SKIP, timeout: 180000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await gamePage(browser, false);
    for (let i = 0; i < 14; i++) { await waitReady(page); await pullKick(page); await page.waitForTimeout(30); }
    await waitReady(page);
    const rec = await page.evaluate(() => window.__rec);
    assert.deepEqual(errors, []);
    assert.ok(rec.length >= 10, `recorded ${rec.length} kicks`);
    assert.ok(rec.every((k) => k.input.kind === 'pull'));
    const moving = replayInNode(rec);
    console.log(`pull: ${rec.length} kicks, ${moving} with moving posts, results ${JSON.stringify(rec.map((k) => k.result))}`);
  } finally { await browser.close(); }
});

test('phone flicks in Chromium replay identically in Node', { skip: SKIP, timeout: 180000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await gamePage(browser, true), cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < 14; i++) { await waitReady(page); await flickKick(page, cdp); await page.waitForTimeout(30); }
    await waitReady(page);
    const rec = await page.evaluate(() => window.__rec);
    assert.deepEqual(errors, []);
    assert.ok(rec.length >= 8, `recorded ${rec.length} kicks`);
    assert.ok(rec.every((k) => k.input.kind === 'flick'));
    const moving = replayInNode(rec);
    console.log(`flick: ${rec.length} kicks, ${moving} with moving posts, results ${JSON.stringify(rec.map((k) => k.result))}`);
  } finally { await browser.close(); }
});

/** every tick's state of many flights, hashed over the doubles' exact bits */
function flightsHash(Sim, count) {
  let r = 7; const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  let h = 2166136261 >>> 0, ticks = 0;
  const mix = (v) => { f64[0] = v; for (const w of u32) h = Math.imul(h ^ w, 16777619) >>> 0; };
  const results = [];
  for (let i = 0; i < count; i++) {
    const shot = Sim.shotFor((rnd() * 2 ** 31) | 0, (rnd() * 30) | 0, (rnd() * 12) | 0);
    const k = { power: rnd(), aim: (rnd() - 0.5) * 0.8, contact: rnd() * 2 - 1, sweetMin: rnd() * 0.3 };
    const out = Sim.simulate(shot, k, Sim.DEFAULT_TUNING, { kickTick: (rnd() * 5000) | 0, frames: true });
    for (const fr of out.frames) for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'pitch', 'yaw', 'roll', 'wob']) mix(fr[key]);
    ticks += out.frames.length; results.push(out.result);
  }
  return { hash: h, ticks, results: results.join(',') };
}

test('whole flights are bit-identical in the browser and Node', { skip: SKIP, timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: forge('paperfb-sim.js') });
    const inBrowser = await page.evaluate(`(${flightsHash.toString()})(PaperFBSim, 400)`);
    const inNode = flightsHash(S, 400);
    assert.ok(inNode.ticks > 100000);
    assert.deepEqual(inBrowser, inNode);
  } finally { await browser.close(); }
});
