// The Forge in live mode, end to end in a real browser against a local chain: node scripts/forge-e2e/run.mjs
//
// Starts anvil with everything deployed (../chain-test/setup.mjs), serves web/art/factory (the Forge source, with its
// wallet bundle: run npm run build:wallet first), and drives the page with Playwright at ?live=testnet. The page is
// pointed at the local chain by the test hook (globalThis.__FORGE_NET__, name "local", and __FORGE_TEST__ with an anvil
// dev key: "Connect" signs with it, and drand is stood in for). Nothing on the site sets these, so the hook can't be
// active in production. Then checks that the plain page is still the demo, with no console errors, desktop and phone.
//
// Walks: connect, suggest a theme and an art style (the owner picks them: 2 free packs), the drop opens and the buy box
// lists its groups, buy from Everyone with ETH, PLANK and USDG (PAPER burned each time), a free pack (Everyone sold
// out: "more may come"), the Press group's pack, the after-sell-out group (its panel, the confirm step, a race with
// another buyer: "Someone just bought it"), the idle end ("Closing…") and the keeper's close, open, deliver the draw,
// deal, reveal, case + grade (the draw, the grades), burn, a profile (name + picture), the results; in the demo, the
// profile editor (pick, pinch / wheel, save). Screenshots go to $SHOTS (default ./shots).
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
// ?build-live=testnet: the page as a live build writes it (<meta name="forge-live" content="testnet">, vite.wallet.config.ts)
const server = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = normalize(join(FACTORY, p));
  if (!f.startsWith(FACTORY) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
  const flag = u.searchParams.get("build-live");
  res.end(flag && f.endsWith("index.html") ? readFileSync(f, "utf8").replace('<meta name="forge-live" content="">', `<meta name="forge-live" content="${flag}">`) : readFileSync(f));
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
  await page.waitForTimeout(500); // the connect's own wallet sheet can open again just after: close whatever is open
  await page.evaluate(() => document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close()));

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

  console.log("\n== the drop opens: the buy box lists the groups");
  await ctx.warp(Number(ctx.start - (await ctx.now())) + 1);
  await sync();
  check(await page.evaluate(() => Store.state.wallet.credits === 2), "2 free packs from the picks");
  check(/7 left/.test(await page.locator("#seriesChip").textContent()), `on sale: ${await page.locator("#seriesChip").textContent()}`);
  const box = async () => (await page.locator("#buybox").innerText()).replace(/\s+/g, " ");
  let bx = await box();
  check(/Everyone/.test(bx) && /\$2\.50 \+ 1 PAPER/.test(bx) && /6 left/.test(bx), `Everyone: $2.50 + 1 PAPER, 6 left (${bx})`);
  check(/Paper Press holders/.test(bx) && /1 PAPER/.test(bx) && /ends in/.test(bx), "Paper Press holders: 1 PAPER, with its end countdown");
  check(/Next: Extra packs · after Everyone/.test(bx), "what opens next: Extra packs, after Everyone");
  await shot("04-on-sale");
  const buy = async (n, coin) => {
    await page.click('#buybox [data-buy="g1"]');
    await page.locator("#sheet-buy[open] .go:not([disabled])").waitFor({ timeout: 30_000 });
    for (let i = 1; i < n; i++) await page.click('#sheet-buy [data-q="1"]');
    await page.click(`#sheet-buy [data-c="${coin}"]`);
    await page.waitForFunction(() => /≈/.test(document.querySelector("#sheet-buy .sum dd")?.textContent || ""), null, { timeout: 30_000 });
    await page.locator("#sheet-buy .go:not([disabled])").waitFor({ timeout: 30_000 });
    if (n === 2 && coin === "ETH") {
      await shot("05-checkout");
      check(/Price moves over 3%\? Nothing is charged\./.test(await page.locator("#sheet-buy .fine").textContent()) && !/burn/i.test(await page.locator("#sheet-buy").innerText()), "ETH checkout: price moves over 3%, nothing charged; no fund flows on the buy screen");
      check((await page.locator("#sheet-buy [data-c]").count()) === 3 && (await page.locator("#sheet-buy [data-all]").count()) === 1, "Everyone takes PLANK, ETH and USDG; ETH offers to pay the PAPER too");
    }
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
  check(await page.evaluate(() => Store.state.sealed[7] === 5 && Store.state.wallet.boughtIn[1] === 5), "5 sealed packs from Everyone (2 ETH, 2 PLANK, 1 USDG)");

  console.log("\n== a free pack: Everyone sells out, but more may come from the Press group");
  await page.click('#buybox [data-buy="free"]');
  await page.click("#sheet-free .go");
  await txDone(); await toastSeen(/Free pack/);
  await sync();
  bx = await box();
  check(/Everyone/.test(bx) && /Sold out · more may come in/.test(bx) && (await page.locator('#buybox [data-buy="g1"].off').count()) === 1, `Everyone greyed: "Sold out · more may come in …"`);
  await shot("06b-more-may-come");

  console.log("\n== the Press group: a pack with a Paper Press");
  await page.click('#buybox [data-buy="g0"]');
  await page.locator("#sheet-press[open]").waitFor(); // the dev Press can't list tokens: the holder types its number
  await page.fill("#pressno", "1");
  await shot("07a-press-number");
  await page.click("#sheet-press button[type=submit]");
  await page.locator("#sheet-buy[open] .go:not([disabled])").waitFor({ timeout: 30_000 });
  check(/Claim 1 pack/.test(await page.locator("#sheet-buy .go").textContent()) && (await page.locator("#sheet-buy [data-c]").count()) === 0, "the Press group: no coins (1 PAPER only): Claim 1 pack");
  await page.click("#sheet-buy .go");
  await txDone(); await toastSeen(/bought/);
  await sync();
  check(await page.evaluate(() => Store.state.sealed[7] === 7 && Store.state.series.phase === 3 && Store.state.series.groups[2].state === "open"), "7 sealed packs; the Press and Everyone ended; Extra packs are open");

  console.log("\n== extra packs: the rising price, a clear confirm, a race");
  bx = await box();
  check(/Extra packs/i.test(bx) && /Extra pack\b/.test(bx) && /\$2\.60 \+ 1 PAPER/.test(bx) && /\+4% each/.test(bx) && /ends in/.test(bx), `the buy box: ${bx}`);
  check(/Extra packs/.test(await page.locator("#seriesChip").textContent()), `the chip: ${await page.locator("#seriesChip").textContent()}`);
  await shot("07b-after-sellout-buybox");
  await page.click('#buybox [data-buy="g2"]');
  await page.locator("#sheet-buy[open] .go:not([disabled])").waitFor({ timeout: 30_000 });
  const panel = (await page.locator("#sheet-buy .xpanel").innerText()).replace(/\s+/g, " ");
  check(/Extra pack: \$2\.60/.test(panel) && /\+4% each sale\. Sales end 5 minutes after the last buy\./.test(panel) && !/burn|tax/i.test(panel), `its panel (a price, no fund flows): ${panel}`);
  check(/Ends in \d+m \d+s if nobody buys/.test(panel), "a live countdown to the idle end");
  await shot("07c-after-sellout-panel");
  await page.click("#sheet-buy .go");
  await page.locator("#sheet-buy .xconfirm").waitFor();
  check(await page.locator("#sheet-buy .go[disabled]").count() === 1, "the confirm step: nothing reaches the wallet until \"Got it\" is ticked");
  const xc = await page.locator("#sheet-buy .xconfirm").textContent();
  check(/\$2\.60 \+ 1 PAPER/.test(xc) && /Next one costs \$2\.70/.test(xc) && /after the last buy/.test(xc) && !/burn|tax/i.test(xc), `it says the price, the next price and the timer, no fund flows: ${xc.replace(/\s+/g, " ")}`);
  await page.click("#sheet-buy [data-ok]");
  await shot("07d-after-sellout-confirm");
  await page.click("#sheet-buy .go:not([disabled])");
  await txDone(); await toastSeen(/bought/);
  await sync();
  check(await page.evaluate(() => Store.state.sealed[7] === 8 && Store.state.series.groups[2].sold === 1), "extra pack #1 bought");
  // the race: the sheet shows pack #2 at $2.70; someone else buys it first
  await page.click('#buybox [data-buy="g2"]');
  await page.locator("#sheet-buy[open] .go:not([disabled])").waitFor({ timeout: 30_000 });
  check(/Extra pack: \$2\.70/.test(await page.locator("#sheet-buy .xpanel").innerText()), "the next one: an extra pack at $2.70");
  const saleAbi = JSON.parse(readFileSync(resolve(here, "../../src/lib/abi/fireSaleAbi.json"), "utf8"));
  await ctx.tx(acct(5), ctx.C.FireSale, saleAbi, "buyWithEthAll", [7n, 2n, 1n, { nftIds: [], allowance: 0n, proof: [] }], 10n ** 18n);
  await page.click("#sheet-buy .go");
  await page.click("#sheet-buy [data-ok]");
  await page.click("#sheet-buy .go:not([disabled])");
  await page.locator("#sheet-buy .xmoved").waitFor({ timeout: 30_000 });
  const movedTxt = await page.locator("#sheet-buy .xmoved").textContent();
  check(/Someone beat you to it\. Next one: \$2\.81/.test(movedTxt) && !(await page.locator("#sheet-tx[open]").count()), `a race: "${movedTxt}", no error and nothing sent`);
  await page.waitForFunction(() => /Extra pack: \$2\.81/.test(document.querySelector("#sheet-buy .xpanel")?.textContent || ""), null, { timeout: 30_000 });
  check(/Ends in [0-5]m \d+s if nobody buys/.test(await page.locator("#sheet-buy .xpanel").innerText()), "the panel moves on to the next extra pack, and the idle countdown (on the chain's clock) is under 5 minutes");
  await shot("07e-someone-bought-it");
  await page.keyboard.press("Escape");

  console.log("\n== nobody buys for 5 minutes: the group ends, the keeper closes the Series");
  await ctx.warp(301);
  await sync();
  check(/Closing…/.test(await page.locator("#seriesChip").textContent()) && /Sales over/i.test(await box()) && (await page.locator("#buybox [data-buy]").count()) === 0, "\"Closing…\": no buttons, nothing asked of the wallet");
  await shot("07f-closing");
  await ctx.tx(acct(6), ctx.C.FireSale, saleAbi, "close", [7n]);
  await sync();
  check(await page.evaluate(() => Store.state.sealed[7] === 8 && Store.state.series.phase === 4), "8 sealed packs; Series 7 closed (closed by the keeper)");
  await shot("07-closed");

  console.log("\n== open: wait for the draw, deliver it, deal, reveal");
  await page.evaluate(() => Stations.open("cards"));
  await page.click('#sheet-table [data-key="openN-7"]');
  await page.waitForFunction(() => /draw/i.test(document.querySelector("#sheet-table .op-wait .stage-msg")?.textContent || ""), null, { timeout: 60_000 });
  await shot("08-waiting-for-draw");
  await ctx.warp(150); // the draw is out (~90 s) and the keeper is about a minute late (there is none here)
  await page.waitForFunction(() => /longer than usual/.test(document.querySelector("#sheet-table .op-wait .stage-msg")?.textContent || ""), null, { timeout: 60_000 });
  check(!(await page.locator("#sheet-tx").isVisible().catch(() => false)) && !(await page.locator('#sheet-table [data-key="diy"]').count()), "keeper late: a calm line, no wallet request and no button yet");
  await ctx.warp(90); // over two minutes late: the page offers, the buyer chooses
  await page.locator('#sheet-table [data-key="diy"]').waitFor({ timeout: 60_000 });
  check(/Skip the wait\. Same cards\./.test(await page.locator("#sheet-table .stage-act small").textContent()), "the offer says in one line what it does");
  await shot("08b-keeper-late");
  await page.click('#sheet-table [data-key="diy"]');
  await page.locator("#sheet-table .op").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  await shot("09-reveal");
  await page.click("#sheet-table .skip-b");
  await page.locator("#sheet-table .op-sum .cel, #sheet-table .op-sum .wz").first().waitFor({ timeout: 30_000 });
  if (await page.locator('#sheet-table [data-key="protect"]').count()) await page.click('#sheet-table [data-key="protect"]'); // the pulls first, then "Case & grade them"
  await page.locator("#sheet-table .op-sum .wz").waitFor({ timeout: 30_000 });
  const dealt = await page.evaluate(() => Store.state.cards.length);
  check(dealt === 48, `48 cards dealt and revealed (${dealt})`);
  await shot("10-after-open");

  console.log("\n== case one card, grade two (one payment), then the draw sets the grades");
  const tiles = page.locator("#sheet-table .wz-grid .ctile:not(.off)");
  await tiles.nth(0).click(); await tiles.nth(1).click();
  await page.click('#sheet-table .wz .foot .btn.primary'); // Next: cases
  await page.locator("#sheet-table .wz-grid .ctile:not(.off)").nth(0).click();
  await page.click('#sheet-table .wz .foot .btn.primary'); // Next: review
  check(await page.locator('#sheet-table .wz-coin [aria-pressed="true"]').textContent() === "ETH", "the review pays in ETH by default");
  check(/Grades are random and final\. No regrades, no refunds\. Nothing you pay raises the odds\./.test(await page.locator("#sheet-table .wz-final").textContent()) && !/burn/i.test(await page.locator("#sheet-table .wz-pay").innerText()), "where grades are paid for: random and final, no regrades, no refunds; no fund flows");
  check(await page.locator("#sheet-table .wz-thumbs .gt-odds").count() === 2, "each card to the grader shows its own odds (PDA 10 %)");
  // PAPER: no PAPER price on this chain yet (the PaperUsdTwap needs its first window): the option turns off with a reason
  await page.click('#sheet-table .wz-coin [data-coin="PAPER"]');
  await page.waitForFunction(() => document.querySelector('#sheet-table .wz-coin [data-coin="PAPER"]')?.disabled, null, { timeout: 30_000 });
  check(/PAPER unavailable right now/.test(await page.locator("#sheet-table .wz-coin .warn").textContent()) && await page.locator('#sheet-table .wz-coin [aria-pressed="true"]').textContent() === "ETH",
    "PAPER while its price can't be read (FeedUnavailable): turned off with a short reason, back to ETH");
  await page.click('#sheet-table .wz-coin [aria-pressed]:text("ETH")');
  await page.waitForFunction(() => /≈ .* ETH/.test(document.querySelector("#sheet-table .wz-pay .price")?.textContent || ""), null, { timeout: 30_000 });
  const quoted = await page.evaluate(async () => { const ids = Store.state.cards.filter((c) => c.grade == null && !c.cased).map((c) => c.id); return (await window.Live.quoteProtect(ids.slice(0, 1), ids.slice(1, 3), "ETH")).text; });
  check((await page.locator("#sheet-table .wz-pay .price").textContent()).includes(`≈ ${quoted} ETH`), `the review shows FirePsa's quote (${quoted} ETH), not an estimate`);
  await shot("11-review");
  await page.click('#sheet-table .wz .foot .btn.primary'); // Pay
  await txDone();
  await page.waitForFunction(() => /grading/i.test(document.querySelector("#sheet-table .wz-work .stage-msg")?.textContent || ""), null, { timeout: 60_000 });
  await ctx.warp(240); // the keeper is late: the buyer chooses to reveal the grades themselves
  await page.locator('#sheet-table [data-key="diy"]').waitFor({ timeout: 60_000 });
  await page.click('#sheet-table [data-key="diy"]');
  await page.waitForFunction(() => /graded/.test(document.querySelector("#sheet-table .wz-work .stage-msg")?.textContent || ""), null, { timeout: 120_000 });
  await shot("12-graded");
  const res = await page.locator("#sheet-table .gres").allTextContents();
  check(res.length === 2 && res.every((t) => /PDA \d+(GEM MINT|MINT|NM-MT|NEAR MINT|EX-MT|EXCELLENT|VG-EX|VERY GOOD|GOOD|POOR)/.test(t)), `the grades stay in view: ${res.join(" / ")}`);
  await sync();
  const graded = await page.evaluate(() => Store.state.cards.filter((c) => c.grade != null).map((c) => c.grade));
  const cased = await page.evaluate(() => Store.state.cards.filter((c) => c.cased && c.grade == null).length);
  check(graded.length === 2 && cased === 1, `2 graded (PDA ${graded.join(", ")}), 1 cased`);
  const ages = await page.evaluate(async () => { const c = Store.state.cards.find((x) => x.cased && x.grade == null); const r = await window.Live.chain.card(c.id); return { site: c.frozenAge, chain: r.age }; });
  check(ages.chain > 0 && ages.site === ages.chain * 1000, `a cased card's frozen age is the chain's (${ages.chain} s), not 0`);
  await page.evaluate(() => Stations.open("pop"));
  await page.locator("#sheet-pop .pop-t").waitFor({ timeout: 30_000 });
  const popAll = await page.locator("#sheet-pop td.all").allTextContents();
  check(popAll.reduce((a, t) => a + +t, 0) === 2, `the pop report counts the 2 slabs from the Graded events (${popAll.join(", ")})`);
  await shot("12b-pop-report");
  await page.keyboard.press("Escape");
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
  check(await page.evaluate(() => Store.state.cards.length === 45 && Store.state.wallet.burnCount === 3), "3 burned: 45 cards left, 3 / 42 toward a free pack");

  console.log("\n== profile: a name and one of the cards as the picture (FireProfiles, one transaction)");
  {
    // the card images live on IPFS (aborted above): here a local card stands in, so the picture can be cut
    await page.unroute(/ipfs\.io/);
    await page.route(/ipfs\.io/, (r) => r.fulfill({ contentType: "image/webp", body: readFileSync(join(FACTORY, "forge/cards/bowling/wood-plain.webp")) }));
    check(await page.evaluate(async () => { await window.Live.chain; return window.Profiles.on && !!window.Live.chain.profilesOn(); }), "profiles are on (FireProfiles in the deployments file)");
    await page.waitForTimeout(1000); // anything the reveal opens after it (a recap) first
    await page.evaluate(() => { document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close()); window.Live.openWallet(); });
    await page.locator("#sheet-wallet[open]").waitFor();
    await page.click("#sheet-wallet [data-w=name]");
    await page.locator("#sheet-profile[open]").waitFor();
    await page.click("#sheet-profile [data-p=pick]");
    const serial = await page.evaluate(() => Store.state.cards[0].id);
    await page.locator("#sheet-profile .pf-tile").first().click();
    await page.locator("#sheet-profile .pf-art").waitFor();
    const b = await page.locator("#sheet-profile .pf-crop").boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
    await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 10, { steps: 4 }); await page.mouse.up();
    await page.fill("#sheet-profile .pf-name input", "Fire Kid");
    await page.waitForTimeout(500);
    await shot("13b-profile-editor");
    await page.click("#sheet-profile [data-p=save]");
    await txDone(); await toastSeen(/Saved/);
    const pf = await page.evaluate(async (a) => window.Live.chain.profile(a, true), me);
    check(pf?.name === "Fire Kid" && pf.pfpCard === serial && pf.crop.zoom > 1.2, `saved on chain in one transaction: "${pf?.name}", card #${pf?.pfpCard}, zoom ${pf?.crop.zoom.toFixed(2)}`);
    await page.waitForFunction(() => /Fire Kid/.test(document.querySelector("#walletBtn").textContent) && !!document.querySelector("#walletBtn .pf-av canvas"), null, { timeout: 15_000 });
    check(true, `the wallet chip shows the picture and the name (${await page.locator("#walletBtn").textContent()})`);
    await shot("13c-profile-chip");
    await page.unroute(/ipfs\.io/);
    await page.route(/ipfs\.io/, (r) => r.abort());
  }

  console.log("\n== the fun layer, live: the pulls feed, the board, a showcase, a practice pack (all read-only)");
  {
    await page.evaluate(() => document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close()));
    await page.waitForFunction(() => window.Fun?.loaded, null, { timeout: 30_000 });
    const dealtN = await page.evaluate(async () => (await window.Live.chain.dealtCards(7, 500)).length);
    check(dealtN === 48, `the feed reads every card dealt in Series 7 from CardDealt (${dealtN})`);
    const holder = await page.evaluate(async () => (await window.Live.chain.dealtCards(7, 1))[0]?.holder);
    check(holder?.toLowerCase() === me.toLowerCase(), "each pull names the wallet that opened its pack (PacksOpened)");
    const row = await page.evaluate(async (a) => (await window.Live.chain.fuelBoard(7)).find((r) => r.wallet.toLowerCase() === a.toLowerCase()), me);
    check(row && row.packs + row.free === 8 && row.cased === 1 && row.graded === 2, `the board: this wallet took 8 packs, cased 1, graded 2 (${JSON.stringify(row)})`);
    const others = await page.evaluate(async () => (await window.Live.chain.fuelBoard(7)).length);
    check(others === 2, `the board lists both buyers of Series 7 (${others})`);
    await page.evaluate(() => Fun.go("feed", { tab: "pulls" }));
    await page.locator("#sheet-feed .fd-row, #sheet-feed .fd-panel p.muted").first().waitFor({ timeout: 30_000 });
    await page.click('#sheet-feed [data-v="board"]');
    await page.locator("#sheet-feed .fd-board tbody tr").first().waitFor({ timeout: 30_000 });
    check((await page.locator("#sheet-feed .fd-board tbody tr").count()) === 2 && (await page.locator("#sheet-feed .fd-board tr.you").count()) === 1, "Top stokers: 2 wallets, this one marked as you");
    await shot("13d-top-burners");
    await page.keyboard.press("Escape");
    await page.evaluate((a) => Fun.open.showView({ addr: a, ids: [] }), me);
    await page.locator("#sheet-show .sv-shelf .sc-slot").first().waitFor({ timeout: 30_000 });
    check((await page.locator("#sheet-show .sv-shelf .sc-slot").count()) === 6, "a showcase reads the wallet's cards: its best 6");
    await page.keyboard.press("Escape");
    const n0 = await page.evaluate(() => Store.state.cards.length);
    await page.evaluate(() => Fun.go("practice"));
    await page.locator("#sheet-table .pk2").waitFor();
    await page.click("#sheet-table .pk2"); await page.waitForTimeout(1500);
    await page.click("#sheet-table .skip-b");
    await page.locator("#sheet-table .prac-sum").waitFor({ timeout: 20_000 });
    check((await page.locator("#sheet-table .prac-c").count()) === 6 && (await page.evaluate(() => Store.state.cards.length)) === n0 && !(await page.locator("#sheet-tx[open]").count()),
      "live: a practice pack opens 6 sample cards, asks nothing of the wallet and saves nothing");
    await page.keyboard.press("Escape");
  }

  console.log("\n== My cards, the results");
  await page.evaluate(() => Stations.open("cards"));
  await page.waitForTimeout(600);
  await shot("14-my-cards");
  await page.keyboard.press("Escape");
  await page.evaluate(() => Stations.open("results"));
  await page.waitForTimeout(600);
  await shot("15-results");
  await page.keyboard.press("Escape");
  console.log("\n== the network down: the page says the data may be out of date, then recovers");
  await page.route(ctx.RPC + "/**", (r) => r.abort());
  await page.route(ctx.RPC, (r) => r.abort());
  await page.evaluate(() => window.Live.sync());
  await page.locator(".live-bar .stale").waitFor({ timeout: 30_000 });
  check(/out of date/.test(await page.locator(".live-bar").textContent()), "sync failed: \"may be out of date\" shows");
  await shot("15b-stale");
  await page.unroute(ctx.RPC + "/**"); await page.unroute(ctx.RPC);
  await sync();
  check(await page.locator(".live-bar").isHidden(), "the next sync works: the notice is gone");
  check(await page.evaluate(() => Store.state.wallet.pending.length === 0), "nothing left waiting for the network");
  check(errors.length === 0, `no page errors in live mode${errors.length ? ": " + errors.join(" | ") : ""}`);
  await page.close();

  console.log("\n== the live switch and links");
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p.addInitScript(([n, k]) => { globalThis.__FORGE_NET__ = n; globalThis.__FORGE_TEST__ = { key: k }; }, [net, key]);
    await p.goto(`${SITE}help.html?live=testnet`);
    const back = await p.locator("header a.back").getAttribute("href");
    check(/live=testnet/.test(back) && /live=testnet/.test(await p.locator('.page-foot a[href^="terms"]').getAttribute("href")), `Help keeps ?live on its links (${back})`);
    // the build's VITE_LIVE, written into <meta name="forge-live">: live with no ?live=
    await p.goto(`${SITE}?build-live=testnet`);
    await p.waitForFunction(() => /Series 7/.test(document.querySelector("#seriesChip")?.textContent || ""), null, { timeout: 60_000 });
    check(await p.evaluate(() => window.Live.on && window.Live.net === "testnet" && !Store.state.demo), "a live build (meta forge-live) runs live without ?live=");
    await p.goto(`${SITE}?build-live=testnet&live=off`);
    await p.locator("#loading.done").waitFor({ state: "attached", timeout: 30_000 });
    check(await p.evaluate(() => window.Live.on === false && Store.state.demo), "?live=off is the demo, whatever the build says");
    // the live code fails to load: an error with Retry, not a silent switch to the demo
    await p.route(/vendor\/wallet\//, (r) => r.abort());
    await p.goto(`${SITE}?live=testnet&wave=characters&results=won`);
    await p.locator("#sheet-chainerr[open]").waitFor({ timeout: 30_000 });
    check(new URL(p.url()).searchParams.get("live") === "testnet" && (await p.locator("#sheet-chainerr .go").textContent()) === "Retry", "the chain code didn't load: \"Retry\", still live");
    check(await p.evaluate(() => Store.SUGGEST_WAVE.wave === "look" && Store.SUGGEST_RESULTS.length === 0 && Store.state.suggestions.length === 0), "live ignores the demo's ?wave and ?results");
    await p.unroute(/vendor\/wallet\//);
    await p.click("#sheet-chainerr .go");
    await p.waitForFunction(() => /Series 7/.test(document.querySelector("#seriesChip")?.textContent || ""), null, { timeout: 60_000 });
    check(await p.evaluate(() => window.Live.on && !!window.Live.chain), "Retry loads it");
    await p.close();
  }

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
    const f = join(SHOTS, `16-demo-${name}.png`); await p.screenshot({ path: f }); console.log(`  shot ${f}`);

    // a profile (profile.js): the demo keeps it in this browser. Edit from the wallet, pick a card, frame it, save
    await p.click("#walletBtn"); await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close()));
    await p.click("#walletBtn"); await p.locator("#sheet-wallet[open]").waitFor();
    await p.click("#sheet-wallet [data-w=name]");
    await p.locator("#sheet-profile[open]").waitFor();
    check(await p.locator("#sheet-profile .pf-crop.empty").isVisible(), `${name}: the profile editor opens (no picture yet)`);
    await p.click("#sheet-profile [data-p=pick]");
    const gi = await p.evaluate(() => Store.state.cards.filter((c) => c.material !== "diamond").findIndex((c) => c.material === "gold"));
    await p.locator("#sheet-profile .pf-tile").nth(gi).click();
    await p.locator("#sheet-profile .pf-art").waitFor();
    const z0 = await p.evaluate(() => +document.querySelector("#sheet-profile .pf-zoom").value);
    const cb = await p.locator("#sheet-profile .pf-crop").boundingBox(), mx = cb.x + cb.width / 2, my = cb.y + cb.height / 2;
    if (w < 500) { // a pinch: two touch pointers moving apart
      await p.evaluate(([x, y]) => {
        const el = document.querySelector("#sheet-profile .pf-crop"), ev = (t, id, dx) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x + dx, clientY: y, bubbles: true }));
        el.setPointerCapture = () => {};
        ev("pointerdown", 1, -20); ev("pointerdown", 2, 20);
        for (let k = 1; k <= 8; k++) { ev("pointermove", 1, -20 - k * 6); ev("pointermove", 2, 20 + k * 6); }
        ev("pointerup", 1, -68); ev("pointerup", 2, 68);
      }, [mx, my]);
    } else { await p.mouse.move(mx, my); for (let i = 0; i < 4; i++) await p.mouse.wheel(0, -120); }
    await p.mouse.move(mx, my); await p.mouse.down(); await p.mouse.move(mx + 25, my + 30, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(100);
    const z1 = await p.evaluate(() => +document.querySelector("#sheet-profile .pf-zoom").value);
    check(z1 > z0 + 0.3, `${name}: ${w < 500 ? "a pinch" : "the wheel"} zooms the picture (${z0} -> ${z1.toFixed(2)}), a drag moves it`);
    await p.fill("#sheet-profile .pf-name input", " Fire  Kid");
    check(await p.locator("#sheet-profile [data-p=save]").isDisabled(), `${name}: a double space can't be saved ("${await p.locator("#sheet-profile .pf-hint").textContent()}")`);
    await p.fill("#sheet-profile .pf-name input", "Fire Kid");
    const sf = join(SHOTS, `17-profile-${name}.png`); await p.screenshot({ path: sf }); console.log(`  shot ${sf}`);
    await p.click("#sheet-profile [data-p=save]");
    await p.waitForFunction(() => !!document.querySelector("#walletBtn .pf-av canvas"), null, { timeout: 10_000 });
    const saved = await p.evaluate(async () => { const x = await window.Profiles.get(Store.state.wallet.full); return { name: x?.name, gold: x?.material === "gold", zoom: x?.crop.zoom, chip: document.querySelector("#walletBtn").textContent, label: window.Profiles.label(Store.state.wallet.full) }; });
    check(saved.name === "Fire Kid" && saved.gold && saved.zoom > 1.2 && saved.label === "Fire Kid" && (w < 500 || /Fire Kid/.test(saved.chip)), `${name}: saved (demo): the chip shows the Gold picture${w < 500 ? "" : " and the name"}`);
    const cf = join(SHOTS, `18-profile-chip-${name}.png`); await p.screenshot({ path: cf }); console.log(`  shot ${cf}`);

    // the full-screen card viewer (zoom.js): from a card's detail, closed by X, Esc and Back, the detail still open under it
    await p.evaluate(() => Stations.open("cards"));
    const slabId = await p.evaluate(() => Store.state.cards.find((c) => c.grade != null && c.material !== "diamond").id);
    await p.locator(`#sheet-table .cgrid .ctile[data-id="${slabId}"]`).click();
    await p.locator("#sheet-card[open] .big .cface").waitFor();
    const zv = "dialog.zv";
    const settled = () => p.waitForFunction(() => { const c = document.querySelector("dialog.zv .zv-card"); return c && !c.classList.contains("moving"); }, null, { timeout: 10_000 });
    const gone = () => p.locator(zv).waitFor({ state: "detached", timeout: 10_000 });
    const stillDetail = () => p.evaluate(() => !!document.querySelector("#sheet-card[open]") && !!document.querySelector("#sheet-table[open]"));
    if (w < 500) await p.locator("#sheet-card .big .cwrap").tap({ position: { x: 40, y: 90 } }); else await p.click("#sheet-card .big .zv-open");
    await p.locator(`${zv}[open]`).waitFor(); await settled();
    const v1 = await p.evaluate(() => { const d = document.querySelector("dialog.zv"), r = d.querySelector(".zv-card").getBoundingClientRect();
      return { modal: d.matches(":modal"), label: d.getAttribute("aria-label"), focus: d.contains(document.activeElement), w: r.width, h: r.height, slab: !!d.querySelector(".cface.hd-slab"), hist: !!history.state?.zv }; });
    check(v1.modal && v1.focus && /^.+, .*PDA \d+$/.test(v1.label) && v1.slab && v1.hist, `${name}: ${w < 500 ? "tapping the card" : "the expand button"} opens the viewer (modal, "${v1.label}", focus inside, the slab in its slab)`);
    check(w < 500 ? v1.w >= w * 0.9 : v1.h >= h * 0.9, `${name}: the card fills the screen (${Math.round(v1.w)} x ${Math.round(v1.h)} of ${w} x ${h})`);
    // zoom in: a double tap (phone) or double click, then back out
    if (w < 500) { await p.touchscreen.tap(w / 2, h / 2); await p.touchscreen.tap(w / 2, h / 2); } else await p.mouse.dblclick(w / 2, h / 2);
    await p.waitForFunction(() => /scale\((2\.[3-9]|2\.5)/.test(document.querySelector("dialog.zv .zv-card").style.transform), null, { timeout: 10_000 });
    await settled();
    check(true, `${name}: double ${w < 500 ? "tap" : "click"} zooms in`);
    await p.click(`${zv} .zv-x`); await gone();
    check(await stillDetail() && await p.evaluate(() => document.activeElement?.classList.contains("zv-open") && !history.state?.zv), `${name}: X closes it, back on the card's detail (focus on the expand button)`);
    await p.click("#sheet-card .big .zv-open"); await p.locator(`${zv}[open]`).waitFor(); await settled();
    await p.keyboard.press("Escape"); await gone();
    check(await stillDetail(), `${name}: Esc closes only the viewer`);
    await p.click("#sheet-card .big .zv-open"); await p.locator(`${zv}[open]`).waitFor(); await settled();
    const url = p.url(); await p.evaluate(() => history.back()); await gone();
    check(await stillDetail() && p.url() === url, `${name}: Back closes the viewer and stays on the page`);
    await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
    check(errs.length === 0, `${name}: no console errors${errs.length ? ": " + errs.join(" | ") : ""}`);
    await p.close();
  }
  // ---------- the fun layer in the demo (fun.js): tour, practice pack, binder, badges, showcase link, feed
  console.log("\n== the fun layer (demo)");
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(SITE);
    await p.waitForFunction(() => window.Fun?.loaded, null, { timeout: 30_000 });
    await p.locator(".fun-tour .ft-card").waitFor({ timeout: 15_000 });
    check(/furnace/i.test(await p.locator(".fun-tour .ft-t").textContent()), "first visit: the workshop tour starts at the furnace");
    await p.click(".fun-tour .ft-next"); await p.waitForTimeout(300);
    check(/press/i.test(await p.locator(".fun-tour .ft-t").textContent()), "Next: the press");
    await p.click(".fun-tour .ft-skip");
    check(await p.locator(".fun-tour").count() === 0, "Skip ends it");
    await p.reload(); await p.waitForFunction(() => window.Fun?.loaded, null, { timeout: 30_000 }); await p.waitForTimeout(3500);
    check(await p.locator(".fun-tour").count() === 0, "shown once: no tour on the next visit");
    await p.evaluate(() => Fun.go("tour")); await p.locator(".fun-tour .ft-card").waitFor();
    check(true, "the tour opens again on request (Help, menu, New here?)");
    await p.click(".fun-tour .ft-skip");

    await p.evaluate(() => Fun.go("practice"));
    await p.locator("#sheet-table .pk2").waitFor();
    check(await p.locator("#sheet-table.sheet .st-table.practice").count() === 1 && /Practice pack/.test(await p.locator("#sheet-table h2").textContent()), "practice pack: its own table, titled Practice pack");
    await p.click("#sheet-table .pk2"); await p.waitForTimeout(1500);
    await p.click("#sheet-table .skip-b");
    await p.locator("#sheet-table .prac-sum").waitFor({ timeout: 20_000 });
    const prac = await p.evaluate(() => ({ cards: Store.state.cards.length, any: Store.state.cards.some((c) => c.practice), sealed: Store.state.sealed[6], shown: document.querySelectorAll("#sheet-table .prac-c").length }));
    check(prac.shown === 6 && prac.cards === 46 && !prac.any && prac.sealed === 3, `practice: 6 cards shown, nothing saved (still 46 cards, 3 sealed packs) ${JSON.stringify(prac)}`);
    await p.keyboard.press("Escape");

    await p.evaluate(() => Fun.go("binder", { series: 6 }));
    await p.locator("#sheet-binder .bd-row").first().waitFor();
    const bd = await p.evaluate(async () => { const f = await Fun.binderStats(6); return { rows: document.querySelectorAll("#sheet-binder .bd-row").length, slots: document.querySelectorAll("#sheet-binder .bd-slot").length, empty: document.querySelectorAll("#sheet-binder .bd-slot.empty").length, common: f.common, master: f.master, filled: f.slots.size }; });
    check(bd.rows === 3 && bd.slots === 18 && bd.empty === 18 - bd.filled && bd.common > 0 && bd.master <= bd.common, `binder: Series 6, 3 characters x 6 types, ${bd.filled} filled, Common ${Math.round(bd.common * 100)}%, Master ${Math.round(bd.master * 100)}%`);
    await p.keyboard.press("Escape");

    // a real open earns the first badge (and a practice one never does)
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem("omni.badges.demo") || "{}"));
    check(!before["first-open"], "no badge before the first real open (the practice pack didn't count)");
    await p.evaluate(() => Stations.open("open"));
    await p.locator("#sheet-table .pk2").waitFor();
    await p.click("#sheet-table .pk2"); await p.waitForTimeout(1500);
    await p.click("#sheet-table .skip-b");
    await p.locator("#sheet-table .op-sum").waitFor({ timeout: 20_000 });
    check(await p.locator("#sheet-table .fun-packshare").count() === 1, "after an opening: Share this pack");
    await p.waitForFunction(() => JSON.parse(localStorage.getItem("omni.badges.demo") || "{}")["first-open"], null, { timeout: 5000 });
    check(true, "badge: First rip, kept per wallet in this browser");
    await p.evaluate(() => document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close()));

    await p.evaluate(() => Fun.go("feed", { tab: "pulls" }));
    await p.locator("#sheet-feed .fd-row").first().waitFor();
    check((await p.locator("#sheet-feed .fd-row").count()) >= 10 && (await p.locator("#sheet-feed .fd-row .fd-card .cframe").count()) >= 10, "the feed: rare pulls with their card pictures (demo pulls)");
    await p.locator("#sheet-feed .fd-row .fd-card").first().click();
    await p.locator("dialog.zv[open]").waitFor();
    check(true, "tapping a pull opens the full-screen viewer");
    await p.keyboard.press("Escape"); await p.locator("dialog.zv").waitFor({ state: "detached" });
    await p.click('#sheet-feed [data-v="board"]');
    check((await p.locator("#sheet-feed .fd-board tbody tr").count()) >= 5, "Top stokers: a board per Series");
    await p.keyboard.press("Escape");

    await p.goto(`${SITE}?show=0x7a3f2b9c41d0e5a6b8f9c0d1e2f3a4b5c6d7c91e&c=1000.1001`);
    await p.locator("#sheet-show .sv-shelf .sc-slot").first().waitFor({ timeout: 30_000 });
    check((await p.locator("#sheet-show .sv-shelf .sc-slot").count()) === 2 && (await p.locator(".fun-tour").count()) === 0, "a showcase link (?show=&c=) opens that wallet's picked cards, no tour over it");
    await p.close();
    check(errs.length === 0, `the fun layer: no page errors${errs.length ? ": " + errs.join(" | ") : ""}`);
  }
  console.log(`\nPASS: ${checks} checks`);
} catch (e) {
  console.error(`\nFAIL: ${e?.stack ?? e}`);
  code = 1;
} finally {
  await browser.close(); ctx.stop(); server.close();
}
process.exit(code);
