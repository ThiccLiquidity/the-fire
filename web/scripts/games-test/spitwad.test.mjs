// Spit-Wad Sniper (web/art/factory/forge/spitwad.js) in Chromium: every bit of Plank you can see can be hit, the
// shot goes where the swaying crosshair is, and the wads and splats are drawn in depth order with everything else.
// The game's own flight and hit test are used (its probe/visibleAt test hooks), with the real scene files.
// Needs Playwright (as replay.test.mjs); skipped without it. Run: npm run test:games (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pw = null;
try { pw = require(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright'); } catch { /* skipped below */ }
const SKIP = pw ? false : 'Playwright not found (set PLAYWRIGHT)';
const FORGE = fileURLToPath(new URL('../../art/factory/forge/', import.meta.url));
const MIN_HIT = 95;

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.html': 'text/html' };
const PAGE = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}#h{position:relative;width:1024px;height:1250px}</style><div id="h"></div><script src="spitwad.js"></script>';
/** the forge folder over http (the game fetches its scene), plus a bare page that loads only the game */
async function serve() {
  const srv = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    const f = path.join(FORGE, url); if (!f.startsWith(FORGE)) { res.writeHead(403); return res.end(); }
    try { const b = await readFile(f); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return srv;
}
async function launch() {
  try { return await pw.chromium.launch(); } catch { return pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
}
async function withGame(fn) {
  const srv = await serve(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1250 } }), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.evaluate(async () => { await window.SpitWad.load(); window.__g = window.SpitWad.mount(document.getElementById('h'), { mute: () => true }); });
    await page.waitForTimeout(300);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
}

test('every spot: at least 95% of the Plank you can see is hittable with a notch shot', { skip: SKIP, timeout: 180000 }, async () => {
  await withGame(async (page) => {
    const rows = await page.evaluate(async () => {
      const scene = await window.SpitWad.load(), g = window.__g, out = [];
      for (const s of scene.spots) {
        g.pose(s.id, 1); const r = g.state().apps[0].rect;
        let vis = 0, hit = 0; const why = {};
        for (let y = r.y - 4; y <= r.y + r.h + 4; y += 2) for (let x = r.x - 12; x <= r.x + r.w + 12; x += 2) {
          if (!g.visibleAt(x, y)) continue; vis++;
          const v = g.probe(x, y); if (v === 'hit') hit++; else why[v] = (why[v] || 0) + 1;
        }
        out.push({ id: s.id, vis, pct: vis ? 100 * hit / vis : 0, why });
      }
      return out;
    });
    for (const r of rows) console.log(`${r.id.padEnd(10)} ${String(r.vis).padStart(5)} visible  ${r.pct.toFixed(1)}% hittable ${JSON.stringify(r.why)}`);
    assert.equal(rows.length, 22);
    for (const r of rows) { assert.ok(r.vis > 50, `${r.id}: some of him shows`); assert.ok(r.pct >= MIN_HIT, `${r.id}: ${r.pct.toFixed(1)}% hittable`); }
  });
});

test('a notch shot lands on the crosshair (the arc comes back onto the aim ray at his depth)', { skip: SKIP, timeout: 60000 }, async () => {
  await withGame(async (page) => {
    for (const id of ['crate', 'press', 'boiler', 'cubbyC', 'hatch']) {
      const res = await page.evaluate((id) => { const g = window.__g; g.pose(id, 1); const r = g.state().apps[0].rect; return g.probe(r.x + r.w / 2, r.y + r.h / 2); }, id);
      assert.equal(res, 'hit', `${id}: dead centre hits`);
    }
  });
});

test('a dead-centre notch shot at a moving Plank hits him (he stops while it flies)', { skip: SKIP, timeout: 60000 }, async () => {
  await withGame(async (page) => {
    for (const [id, x] of [['belt', 300], ['belt', 700], ['arch', 470], ['catwalk', 400]]) {
      const r = await page.evaluate(async ([id, x]) => {
        const g = window.__g, z = (await window.SpitWad.load()).spots.find((s) => s.id === id).z;
        g.pose(id, 1, x, true); const x0 = g.state().apps[0].rect.x;
        await new Promise((ok) => setTimeout(ok, 250));
        const a = g.state().apps[0], moved = a.rect.x - x0, hits = g.state().hits;
        g.fireAt(a.rect.x + a.rect.w / 2, a.rect.y + a.rect.h * 0.35, 0.3 + (z - 48) / 1440);
        await new Promise((ok) => setTimeout(ok, 1000));
        return { moved, hit: g.state().hits - hits };
      }, [id, x]);
      assert.ok(Math.abs(r.moved) > 2, `${id}: he was moving (${r.moved.toFixed(1)} px)`);
      assert.equal(r.hit, 1, `${id} from ${x}: the dead-centre shot hits`);
    }
  });
});

test('the shot goes where the swaying crosshair is, not where it was before the sway', { skip: SKIP, timeout: 60000 }, async () => {
  await withGame(async (page) => {
    await page.evaluate(() => window.__g.pose('belt', 1));
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + 500, box.y + 700); await page.mouse.down();
    await page.waitForTimeout(800); // the sway is well under way
    await page.mouse.up();
    await page.waitForTimeout(50);
    const st = await page.evaluate(() => window.__g.state());
    assert.ok(st.lastShot, 'a wad was fired');
    const d = Math.hypot(st.lastShot.aim.x - st.lastShot.P.x, st.lastShot.aim.y - st.lastShot.P.y);
    assert.ok(d > 0.5, `the sway moved the shot (${d.toFixed(2)} px)`);
    // and a release while a wad is still flying is a second wad, not lost
    await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
    const st2 = await page.evaluate(() => window.__g.state());
    assert.equal(st2.shots, 2);
  });
});

test('wads and splats are drawn in depth order with Planks and cut-outs', { skip: SKIP, timeout: 60000 }, async () => {
  await withGame(async (page) => {
    // barrel: Plank (262) behind his barrel and sacks (254); a wad short of him splats on the barrel
    await page.evaluate(() => { const g = window.__g; g.pose('barrel', 1); const r = g.state().apps[0].rect; g.fireAt(r.x + r.w / 2, r.y + r.h / 2, 0.3 + (262 - 48) / 1440); });
    const seen = [];
    for (let i = 0; i < 40; i++) {
      const o = await page.evaluate(() => window.__g.state().drawOrder);
      seen.push(o);
      for (let j = 1; j < o.length; j++) assert.ok(o[j - 1].z >= o[j].z, `far to near: ${JSON.stringify(o)}`);
      await page.waitForTimeout(15);
    }
    assert.ok(seen.some((o) => o.some((x) => x.kind === 'wad') && o.some((x) => x.kind.startsWith('occ:'))), 'the wad is sorted in among the cut-outs');
    // a short shot at the barrel's own pixels: the splat sits just in front of the barrel
    const bar = await page.evaluate(async () => { const s = await window.SpitWad.load(); const o = s.occ.barrel; return { x: o.x + o.w / 2, y: o.y + o.h * 0.6, z: s.occZ.barrel }; });
    await page.waitForTimeout(400);
    await page.evaluate((b) => window.__g.fireAt(b.x, b.y, 0.3 + (b.z - 48) / 1440), bar);
    await page.waitForTimeout(700);
    const o = await page.evaluate(() => window.__g.state().drawOrder);
    const sp = o.find((x) => x.kind === 'splat');
    assert.ok(sp && Math.abs(sp.z - (bar.z - 0.01)) < 1e-6, `a splat at the barrel's depth: ${JSON.stringify(o)}`);
  });
});
