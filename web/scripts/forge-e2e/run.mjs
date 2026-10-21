// The Forge in live mode, end to end in a real browser against a local chain: node scripts/forge-e2e/run.mjs
//
// Starts anvil with everything deployed (../chain-test/setup.mjs), serves web/art/factory (the Forge source, with its
// wallet bundle: run npm run build:wallet first), and drives the page with Playwright at ?live=testnet. The page is
// pointed at the local chain by the test hook (globalThis.__FORGE_NET__, name "local", and __FORGE_TEST__ with an anvil
// dev key: "Connect" signs with it, and drand is stood in for). Nothing on the site sets these, so the hook can't be
// active in production. Then checks that the plain page is still the demo, with no console errors, desktop and phone.
//
// Walks: connect, suggest a theme and an art style (the owner picks them: 2 free packs), the drop opens, buy with ETH,
// PLANK and USDG (PAPER burned each time), a press pack, a free pack, the drop closes, open, deliver the draw, deal,
// reveal, case + grade (the draw, the grades), burn, the results. Screenshots go to $SHOTS (default ./shots).
// Anvil's public test accounts only.
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { setupChain, MNEMONIC, acct } from "../chain-test/setup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FACTORY = resolve(here, "../../art/factory");
const SHOTS = resolve(process.env.SHOTS ?? join(here, "shots"));
mkdirSync(SHOTS, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright");
if (!existsSync(join(FACTORY, "forge/vendor/wallet.js"))) throw new Error("No wallet bundle: run npm run build:wallet first");

// ---------- a static server for web/art/factory (the page at /forge/, its scene art at /build3/)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = normalize(join(FACTORY, p));
  if (!f.startsWith(FACTORY) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://127.0.0.1:${server.address().port}/forge/`;

let checks = 0;
const check = (cond, what) => { if (!cond) throw new Error(`CHECK FAILED: ${what}`); checks++; console.log(`  ok  ${what}`); };

console.log("local chain: deploying");
const ctx = await setupChain({ port: 8548, log: (m) => console.log(`  ${m}`) });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let code = 0;
try {
  const deployer = acct(0);
  const buyerHd = mnemonicToAccount(MNEMONIC, { addressIndex: 3 });
  const key = toHex(buyerHd.getHdKey().privateKey);
  const me = buyerHd.address;
  for (const t of ["paper", "plank", "usdg"]) await ctx.tx(deployer, ctx.D[t].address, ctx.D[t].abi, "mint", [me, t === "usdg" ? 10_000n * 10n ** 6n : 10n ** 30n]);
  await ctx.tx(deployer, ctx.D.press.address, ctx.D.press.abi, "mint", [me]);

  // ---------- live mode
  const net = { name: "local", chainId: 31337, label: "Local test chain", readRpc: ctx.RPC, publicRpc: ctx.RPC, explorer: "", deployment: ctx.deployment, drandUrls: [], testnet: true };
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "warning" && !/WebGL|GL Driver/.test(m.text())) console.log(`  page warning: ${m.text()}`); if (m.type() === "error" && !/ipfs\.io|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route(/ipfs\.io/, (r) => r.abort()); // card images: no IPFS here (the page falls back to the card back)
  await page.addInitScript(([n, k]) => { globalThis.__FORGE_NET__ = n; globalThis.__FORGE_TEST__ = { key: k }; }, [net, key]);
  const shot = async (name) => { const f = join(SHOTS, `${name}.png`); await page.screenshot({ path: f }); console.log(`  shot ${f}`); };
  const sync = () => page.evaluate(() => window.Live.sync({ cards: true }));
  const toastSeen = (re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 60_000 });
  const txDone = () => page.waitForFunction(() => !document.querySelector("#sheet-tx[open]"), null, { timeout: 60_000 });

  console.log("\n== live mode: no demo");
  await page.goto(`${SITE}?live=testnet`);
  await page.waitForFunction(() => /Series 7/.test(document.querySelector("#seriesChip")?.textContent || ""), null, { timeout: 60_000 });
  check(await page.locator(".net-badge").isVisible(), "the Testnet badge shows");
  check(!(await page.locator(".demo-note").isVisible()) && !(await page.locator(".chip.demo").isVisible()), "no demo notice, no Demo button");
  check(await page.evaluate(() => Store.state.cards.length === 0 && !Store.state.demo), "no demo cards");
  check(/Series 7 · Opens in/.test(await page.locator("#seriesChip").textContent()), "Series 7 from the chain: opens soon");
  await page.locator("#loading.done").waitFor({ state: "attached" });
  await shot("01-live-before-connect");

  console.log("\n== connect");
  await page.click("#walletBtn");
  await page.waitForFunction(() => /[1-9].* PAPER/.test(document.querySelector("#walletBtn")?.textContent || ""), null, { timeout: 30_000 });
  check(/PAPER/.test(await page.locator("#walletBtn").textContent()), `connected: ${await page.locator("#walletBtn").textContent()}`);
  await page.click("#walletBtn");
  await page.locator("#sheet-wallet[open]").waitFor();
  await shot("02-wallet");
  await page.keyboard.press("Escape");

  console.log("\n== suggest a theme and an art style (one transaction)");
  await page.evaluate(() => Stations.open("suggest"));
  await page.fill("#sg-theme", "Haunted diner");
  await page.fill("#sg-style", "Old woodcut print");
  await page.click('#sheet-suggest [data-key="send"]');
  await toastSeen(/Sent/);
  await sync();
  const sg = await page.evaluate(() => Store.state.suggestions.map((x) => x.text));
  check(sg.length === 2, `2 suggestions on chain, listed under Your ideas (${sg.join(" / ")})`);
  await shot("03-suggested");
  await page.keyboard.press("Escape");
  // the owner picks both before the drop: 2 free packs
  const ids = await page.evaluate(async (a) => (await window.Live.chain.suggestions({ by: a })).map((x) => x.id), me);
  const pickAbi = [{ type: "function", name: "pickSuggestions", inputs: [{ type: "uint256" }, { type: "uint256[]" }], outputs: [], stateMutability: "nonpayable" }];
  await ctx.asOwner(ctx.C.FireCredits, encodeFunctionData({ abi: pickAbi, functionName: "pickSuggestions", args: [7n, ids.map(BigInt)] }));

  console.log("\n== the drop opens: buy with ETH, PLANK and USDG");
  await ctx.warp(Number(ctx.start - (await ctx.now())) + 1);
  await sync();
  check(await page.evaluate(() => Store.state.wallet.credits === 2), "2 free packs from the picks");
  check(/left/.test(await page.locator("#seriesChip").textContent()), `on sale: ${await page.locator("#seriesChip").textContent()}`);
  await shot("04-on-sale");
  const buy = async (n, coin) => {
    await page.click('#buybox [data-buy="buy"]');
    await page.locator("#sheet-buy[open] .go:not([disabled])").waitFor({ timeout: 30_000 });
    for (let i = 1; i < n; i++) await page.click('#sheet-buy [data-q="1"]');
    await page.click(`#sheet-buy [data-c="${coin}"]`);
    await page.waitForFunction(() => /≈/.test(document.querySelector("#sheet-buy .sum dd")?.textContent || ""), null, { timeout: 30_000 });
    if (n === 2 && coin === "ETH") await shot("05-checkout");
    await page.click("#sheet-buy .go:not([disabled])");
    await page.locator("#sheet-tx[open]").waitFor();
    if (coin === "PLANK") await shot("06-tx-steps");
    await txDone();
    await toastSeen(/bought/);
  };
  await buy(2, "ETH");
  await buy(2, "PLANK");
  await buy(1, "USDG");
  await sync();
  check(await page.evaluate(() => Store.state.sealed[7] === 5 && Store.state.wallet.bought === 5), "5 sealed packs (2 ETH, 2 PLANK, 1 USDG)");

  console.log("\n== a press pack and a free pack: the drop closes");
  await page.click('#buybox [data-buy="starter"]');
  await page.locator("#sheet-press[open]").waitFor(); // the dev Press can't list tokens: the holder types its number
  await page.fill("#pressno", "1");
  await shot("07a-press-number");
  await page.click("#sheet-press button[type=submit]");
  await page.locator("#sheet-starter .go").waitFor();
  await page.click("#sheet-starter .go");
  await txDone(); await toastSeen(/Press pack claimed/);
  await page.click('#buybox [data-buy="free"]');
  await page.click("#sheet-free .go");
  await txDone(); await toastSeen(/Free pack/);
  await sync();
  check(await page.evaluate(() => Store.state.sealed[7] === 7 && Store.state.series.phase === 4), "7 sealed packs; Series 7 closed");
  await shot("07-closed");

  console.log("\n== open: wait for the draw, deliver it, deal, reveal");
  await page.evaluate(() => Stations.open("cards"));
  await page.click('#sheet-table [data-key="openN-7"]');
  await page.waitForFunction(() => /draw/.test(document.querySelector("#sheet-table .op-wait .stage-msg")?.textContent || ""), null, { timeout: 60_000 });
  await shot("08-waiting-for-draw");
  await ctx.warp(100);
  await page.locator("#sheet-table .op").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  await shot("09-reveal");
  await page.click("#sheet-table .skip-b");
  await page.locator("#sheet-table .op-sum .wz").waitFor({ timeout: 30_000 });
  const dealt = await page.evaluate(() => Store.state.cards.length);
  check(dealt === 42, `42 cards dealt and revealed (${dealt})`);
  await shot("10-after-open");

  console.log("\n== case one card, grade two (one payment), then the draw sets the grades");
  const tiles = page.locator("#sheet-table .wz-grid .ctile:not(.off)");
  await tiles.nth(0).click(); await tiles.nth(1).click();
  await page.click('#sheet-table .wz .foot .btn.primary'); // Next: cases
  await page.locator("#sheet-table .wz-grid .ctile:not(.off)").nth(0).click();
  await page.click('#sheet-table .wz .foot .btn.primary'); // Next: review
  await page.click('#sheet-table .wz-coin [aria-pressed]:text("ETH")');
  await shot("11-review");
  await page.click('#sheet-table .wz .foot .btn.primary'); // Pay
  await txDone();
  await page.waitForFunction(() => /grader/i.test(document.querySelector("#sheet-table .wz-work .stage-msg")?.textContent || ""), null, { timeout: 60_000 });
  await ctx.warp(100);
  await page.waitForFunction(() => /graded/.test(document.querySelector("#sheet-table .wz-work .stage-msg")?.textContent || ""), null, { timeout: 120_000 });
  await shot("12-graded");
  await sync();
  const graded = await page.evaluate(() => Store.state.cards.filter((c) => c.grade != null).map((c) => c.grade));
  const cased = await page.evaluate(() => Store.state.cards.filter((c) => c.cased && c.grade == null).length);
  check(graded.length === 2 && cased === 1, `2 graded (PDA ${graded.join(", ")}), 1 cased`);
  await page.keyboard.press("Escape");

  console.log("\n== burn");
  await page.evaluate(() => Stations.open("burn"));
  const bt = page.locator("#sheet-burn .cgrid .ctile");
  await bt.nth(0).click(); await bt.nth(1).click(); await bt.nth(2).click();
  await page.click('#sheet-burn [data-key="burn"]');
  await page.locator("#sheet-burnwarn[open]").waitFor();
  if (await page.locator("#bw-type").count()) await page.fill("#bw-type", "BURN");
  await shot("13-burn-confirm");
  await page.click("#sheet-burnwarn .bw-act .btn.danger");
  await txDone(); await toastSeen(/Burned 3/);
  await sync();
  check(await page.evaluate(() => Store.state.cards.length === 39 && Store.state.wallet.burnCount === 3), "3 burned: 39 cards left, 3 / 42 toward a free pack");

  console.log("\n== My cards, the results");
  await page.evaluate(() => Stations.open("cards"));
  await page.waitForTimeout(600);
  await shot("14-my-cards");
  await page.keyboard.press("Escape");
  await page.evaluate(() => Stations.open("results"));
  await page.waitForTimeout(600);
  await shot("15-results");
  await page.keyboard.press("Escape");
  check(errors.length === 0, `no page errors in live mode${errors.length ? ": " + errors.join(" | ") : ""}`);
  await page.close();

  // ---------- the plain page: the demo, untouched
  console.log("\n== no ?live: the demo");
  for (const [w, h, name] of [[1280, 800, "desktop"], [390, 844, "phone"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    const errs = [], vendor = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    p.on("request", (r) => { if (/vendor\//.test(r.url())) vendor.push(r.url()); });
    await p.goto(SITE);
    await p.locator("#loading.done").waitFor({ state: "attached", timeout: 30_000 });
    await p.waitForTimeout(1500);
    const demo = await p.evaluate(() => ({ live: window.Live?.on, demo: Store.state.demo, cards: Store.state.cards.length, note: !!document.querySelector(".demo-note") && getComputedStyle(document.querySelector(".demo-note")).display !== "none" }));
    check(demo.live === false && demo.demo && demo.cards === 46 && demo.note, `${name}: the demo (46 demo cards, the demo notice)`);
    check(vendor.length === 0, `${name}: no wallet or chain code loaded`);
    check(errs.length === 0, `${name}: no console errors${errs.length ? ": " + errs.join(" | ") : ""}`);
    const f = join(SHOTS, `16-demo-${name}.png`); await p.screenshot({ path: f }); console.log(`  shot ${f}`);
    await p.close();
  }
  console.log(`\nPASS: ${checks} checks`);
} catch (e) {
  console.error(`\nFAIL: ${e?.stack ?? e}`);
  code = 1;
} finally {
  await browser.close(); ctx.stop(); server.close();
}
process.exit(code);
