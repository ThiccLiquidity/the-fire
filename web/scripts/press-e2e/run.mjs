// The doors and The Morning Wood (demo), end to end in a real browser: node scripts/press-e2e/run.mjs (after npm run build).
//
// Serves web/dist the way Vercel does (vercel.json's headers, so the CSP applies, and its redirects: /cards), then
// walks: the doors → the Printing Press door → /press/ → buy today's paper → open the reader → turn pages (keys, edge
// clicks, a mouse drag) → contents → the back page's letters box → close → Home → the doors; on a phone (touch:
// swipe to turn, a drag held half-way) and a tablet in landscape (a two-page spread). No console errors anywhere,
// no CSP violations. Screenshots of each step go to $SHOTS (default ./shots).
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "../../dist");
const SHOTS = resolve(process.env.SHOTS ?? join(here, "shots"));
mkdirSync(SHOTS, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright");
if (!existsSync(join(DIST, "press/index.html"))) throw new Error("No build: run npm run build first");

// ---------- web/dist as Vercel serves it
const vercel = JSON.parse(readFileSync(resolve(here, "../../vercel.json"), "utf8"));
// each header rule only on the paths its source matches (":path*" is "(.*)" in Vercel's syntax)
const HEADERS = vercel.headers.map((h) => ({ re: new RegExp(`^${h.source.replace(":path*", "(.*)")}$`), headers: h.headers }));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let p = decodeURIComponent(u.pathname);
  const redirect = vercel.redirects.find((r) => r.source === p || (r.source.endsWith("/:path*") && p.startsWith(r.source.slice(0, -7) + "/")));
  if (redirect) { res.writeHead(307, { location: redirect.destination.replace(":path*", p.slice(redirect.source.length - 6)) + u.search }); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  let f = normalize(join(DIST, p));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html"); // /press → /press/index.html
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  const h = { "content-type": TYPES[extname(f)] ?? "application/octet-stream" };
  for (const { re, headers } of HEADERS) if (re.test(p)) for (const { key, value } of headers) if (key !== "Strict-Transport-Security") h[key] = value;
  res.writeHead(200, h);
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://127.0.0.1:${server.address().port}`;

let checks = 0;
const check = (cond, what) => { if (!cond) throw new Error(`CHECK FAILED: ${what}`); checks++; console.log(`  ok  ${what}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let code = 0;

async function newPage(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return { ctx, page, errors };
}
const settled = (page) => page.waitForFunction(() => !document.querySelector(".reader .leaf"), null, { timeout: 5000 });
const label = (page) => page.locator(".reader .plabel").textContent();

/** A touch drag through CDP (Playwright's touchscreen only taps): from (x0,y0) by dx, optionally held half-way. */
async function touchDrag(page, x0, y0, dx, { hold = null, steps = 8 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const tp = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(x0, y0) });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(x0 + (dx * i) / steps, y0 + i) }); await page.waitForTimeout(16); }
  if (hold) await hold();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

try {
  // ---------- desktop: the whole walk
  console.log("\n== desktop 1280x800");
  {
    const { ctx, page, errors } = await newPage({ viewport: { width: 1280, height: 800 } });
    const shot = (n) => page.screenshot({ path: join(SHOTS, `desktop-${n}.png`) });
    await page.goto(`${SITE}/doors/`);
    await page.locator(".door.paper").waitFor();
    await page.evaluate(() => document.fonts.ready);
    check(await page.locator(".door").count() === 2, "the doors: two doors");
    check(/Card Press/.test(await page.locator(".door.cards").textContent()) && /Printing Press/.test(await page.locator(".door.paper").textContent()), "the Card Press and the Printing Press");
    check(await page.locator(".door.cards").getAttribute("href") === "/forge/" && await page.locator(".door.paper").getAttribute("href") === "/press/", "doors link to /forge/ and /press/");
    await shot("1-landing");

    await page.click(".door.paper");
    await page.waitForURL(/\/press\/$/);
    await page.locator(".sale .btn.buy").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const sale = await page.locator(".sale").innerText();
    check(/1 PAPER/.test(sale) && /\$0\.05/.test(sale), "the sale: 1 PAPER + $0.05");
    check(/Closes in\s+\d\d:\d\d:\d\d/.test(sale), `a 24h countdown (${/\d\d:\d\d:\d\d/.exec(sale)?.[0]})`);
    check(!/burn|buy-?back|split/i.test(sale), "no fund flows on the sale (only in Info)");
    check(/6/.test(await page.locator(".streak-n").textContent()), "demo streak: 6 days");
    check(await page.locator(".papers li").count() === 0 && /No papers yet/.test(await page.locator(".shelf").textContent()), "My papers: empty for a new visitor");
    await shot("2-press-sale");

    await page.click('[data-act="info"] >> nth=0');
    check(/liquidity fire/.test(await page.locator("#sheet-info").innerText()), "Info explains where the money goes");
    await page.click('#sheet-info [data-act="close"]');

    await page.click(".sale .btn.buy");
    await page.locator("#sheet-buy[open]").waitFor();
    check(!/burn/i.test(await page.locator("#sheet-buy").innerText()), "the buy sheet: price, no fund flows");
    await page.click('#sheet-buy [data-act="confirm-buy"]');
    await page.locator(".toast.good", { hasText: "Printed" }).waitFor();
    await page.locator(".toast", { hasText: "Subscriber" }).waitFor();
    check(true, "bought: Printed!, and the 7-day Subscriber badge");
    check(await page.locator(".papers li").count() === 1 && /23 PAPER/.test(await page.locator(".wallet").textContent()), "on the shelf; 1 PAPER spent");
    check(await page.locator(".badge.got").count() === 1, "Subscriber shows as earned");

    await page.click('.sale [data-act="read"].btn');
    await page.locator("dialog.reader[open]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    check(/Page 1 of 7 · Front Page/.test(await label(page)), `reader opens on the front page: ${await label(page)}`);
    check(await page.locator(".reader .book.spread").count() === 1, "desktop: a two-page spread");
    check(/The Morning Wood/.test(await page.locator(".reader .title").textContent()) && /Hard News, Every Morning/.test(await page.locator(".reader .motto").textContent()), "masthead and motto");
    check(await page.locator(".reader .satire-stamp").count() === 1 && await page.locator(".reader .satire-mark").count() >= 1, "SATIRE stamp and mark");
    await page.waitForFunction(() => [...document.querySelectorAll(".reader img")].every((i) => i.complete));
    await shot("3-reader-front");

    await page.keyboard.press("ArrowRight");
    await settled(page);
    check(/Pages 2–3 of 7/.test(await label(page)), `ArrowRight: ${await label(page)}`);
    await page.waitForFunction(() => [...document.querySelectorAll(".reader img")].every((i) => i.complete));
    await page.waitForTimeout(150);
    await shot("4-inside-tabloid");

    // a mouse drag held half-way: the leaf mid-turn
    const box = await page.locator(".reader .book").boundingBox();
    await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 30 - i * (box.width / 2 * 0.42) / 10, box.y + box.height / 2);
    check(await page.locator(".reader .leaf").count() === 1, "dragging lifts the page (a leaf)");
    await page.waitForTimeout(100);
    await shot("5-mid-turn");
    await page.mouse.up();
    await settled(page);
    check(/Pages 4–5 of 7/.test(await label(page)), `let go past a third: turned (${await label(page)})`);

    await page.locator(".reader .edge.prev").click();
    await settled(page);
    check(/Pages 2–3 of 7/.test(await label(page)), "click the left edge: back");

    await page.click('.reader [data-act="toc"]');
    await page.locator(".reader dialog.toc[open]").waitFor();
    check(await page.locator(".reader dialog.toc li").count() === 7, "contents: 7 sections");
    await page.locator(".reader dialog.toc li button", { hasText: "Back Page" }).click();
    await page.waitForTimeout(250);
    check(/Page 7 of 7 · Back Page/.test(await label(page)) || /Pages 6–7 of 7/.test(await label(page)), `contents → the back page: ${await label(page)}`);
    check(await page.locator(".reader .sec-markets .ticker").count() === 3 && await page.locator(".reader .sample-note").count() === 1, "markets: PAPER, PLANK, Paper Mills (marked SAMPLE)");
    await page.fill(".reader #lb-text", "Dear Editor, the stamp says satire but my portfolio says news.");
    await page.click(".reader .lb-send");
    await page.locator(".reader .toast", { hasText: "Sent to the desk" }).waitFor();
    check(/22 PAPER/.test(await page.locator(".wallet").textContent()) && await page.locator(".reader .lb-sent li").count() === 1, "a letter for tomorrow: 1 PAPER, listed under the box");

    await page.keyboard.press("Home"); await page.waitForTimeout(250);
    check(/Page 1 of 7/.test(await label(page)), "Home key: the front page");
    await page.click('.reader [data-act="close"]');
    await page.locator("dialog.reader").waitFor({ state: "detached" });
    check(new URL(page.url()).search === "", "closed: back on /press/");

    await page.click(".topbar .home");
    await page.waitForURL(/\/doors\/$/);
    check(await page.locator(".door").count() === 2, "Home: back at the doors");

    // the card side: /cards goes to Cardworks, which has a Home button for visitors who came through the doors
    await page.goto(`${SITE}/cards`);
    await page.waitForURL(/\/forge\/$/);
    await page.locator(".topbar .home-btn").waitFor({ timeout: 20_000 });
    check(await page.locator(".topbar .home-btn").getAttribute("href") === "/doors/", "/cards → Cardworks, with a Home button to the doors");
    await page.click(".topbar .home-btn");
    await page.waitForURL(/\/doors\/$/);
    check(true, "Cardworks Home → the doors");
    check(errors.length === 0, `desktop: no console errors or CSP violations${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();

    // a fresh visitor straight to Cardworks: no Home button (Cardworks unchanged until the doors are "/")
    const fresh = await newPage({ viewport: { width: 1280, height: 800 } });
    await fresh.page.goto(`${SITE}/forge/`);
    await fresh.page.locator(".topbar #walletBtn").waitFor();
    await fresh.page.waitForTimeout(300);
    check(await fresh.page.locator(".home-btn").count() === 0, "Cardworks opened directly: no Home button yet");
    await fresh.ctx.close();
  }

  // ---------- phone and tablet: touch
  for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["tablet", { width: 1024, height: 768 }]]) {
    console.log(`\n== ${name} ${vp.width}x${vp.height} (touch)`);
    const { ctx, page, errors } = await newPage({ viewport: vp, hasTouch: true, isMobile: name === "phone", deviceScaleFactor: 2 });
    const shot = (n) => page.screenshot({ path: join(SHOTS, `${name}-${n}.png`) });
    await page.goto(`${SITE}/doors/`);
    await page.locator(".door.paper").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await shot("1-landing");
    await page.locator(".door.paper").tap();
    await page.waitForURL(/\/press\/$/);
    await page.locator(".sale .btn.buy").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");
    await shot("2-press-sale");
    await page.locator(".sale .btn.buy").tap();
    await page.locator('#sheet-buy [data-act="confirm-buy"]').tap();
    await page.locator(".toast.good", { hasText: "Printed" }).waitFor();
    await page.locator('.sale [data-act="read"].btn').tap();
    await page.locator("dialog.reader[open]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll(".reader img")].every((i) => i.complete));
    await page.waitForTimeout(250);
    check((await page.locator(".reader .book.spread").count()) === (name === "tablet" ? 1 : 0), name === "tablet" ? "tablet landscape: a spread" : "phone: one page");
    await shot("3-reader-front");

    const box = await page.locator(".reader .stage").boundingBox();
    const y = box.y + box.height * 0.45;
    await touchDrag(page, box.x + box.width * 0.85, y, -box.width * 0.6);
    await settled(page);
    check(/Page 2 of 7|Pages 2–3 of 7/.test(await label(page)), `swipe left: ${await label(page)}`);
    await page.waitForFunction(() => [...document.querySelectorAll(".reader img")].every((i) => i.complete));
    await page.waitForTimeout(150);
    await shot("4-inside-tabloid");
    await touchDrag(page, box.x + box.width * 0.85, y, -box.width * (name === "phone" ? 0.32 : 0.24), {
      hold: async () => { check(await page.locator(".reader .leaf").count() === 1, "a held swipe: the page follows the finger"); await shot("5-mid-turn"); },
    });
    await settled(page);
    await touchDrag(page, box.x + box.width * 0.2, y, box.width * 0.6);
    await settled(page);
    check(/Page 2 of 7|Pages 2–3 of 7/.test(await label(page)), `swipe right: back (${await label(page)})`);
    // pinch: two fingers apart zoom the page, a double-tap zooms back out
    const cdp = await page.context().newCDPSession(page);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const two = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: two(30) });
    for (let d = 40; d <= 110; d += 10) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: two(d) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    const z = await page.evaluate(() => getComputedStyle(document.querySelector(".reader .zoom")).transform);
    check(/matrix\((\d\.\d+|[2-4])/.test(z) && !/matrix\(1, /.test(z), `pinch zooms the page (${z})`);
    await page.locator('.reader [data-act="unzoom"]').tap();
    await page.locator('.reader [data-act="close"]').tap();
    await page.locator("dialog.reader").waitFor({ state: "detached" });
    await page.locator(".topbar .home").tap();
    await page.waitForURL(/\/doors\/$/);
    check(true, `${name}: Home → the doors`);
    check(errors.length === 0, `${name}: no console errors or CSP violations${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
  }

  // ---------- reduced motion: no flip animation, the page still turns
  console.log("\n== reduced motion");
  {
    const { ctx, page, errors } = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", hasTouch: true });
    await page.goto(`${SITE}/press/?read=2026-10-22`);
    await page.locator("dialog.reader[open]").waitFor();
    check(/Page 1 of 2/.test(await label(page)), "a shared link (?read=) to a paper you don't own: the front page and a buy page");
    await page.keyboard.press("ArrowRight");
    check(await page.locator(".reader .leaf").count() === 0 && /Page 2 of 2/.test(await label(page)), "reduced motion: turns without the leaf");
    check(await page.locator(".reader [data-buy]").count() === 1, "the preview's last page: Buy today's paper");
    await page.keyboard.press("Escape");
    await page.locator("dialog.reader").waitFor({ state: "detached" });
    check(/\/press\/$/.test(page.url()), "Escape closes a shared link's reader and stays on /press/");
    check(errors.length === 0, `reduced motion: no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
  }
  console.log(`\nPASS: ${checks} checks. Screenshots in ${SHOTS}`);
} catch (e) {
  console.error(`\nFAIL: ${e?.stack ?? e}`);
  code = 1;
} finally {
  await browser.close(); server.close();
}
process.exit(code);
