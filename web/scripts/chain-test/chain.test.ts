// The live chain layer (src/lib/chain) end to end on a local chain (setup.mjs): suggestions (theme + style in one
// transaction) and the owner's picks, the drop's groups (docs/drop-groups.md): buying from Everyone with ETH, PLANK,
// USDG and ETH alone (PAPER to the liquidity fire each time), a free pack from the credit group, the Press group's pack
// with a Paper Press, the after-sell-out group's rising price (and a buy refused when someone else's moved it), the
// idle end and the close by anyone, opening, delivering randomness and dealing, reading the cards, casing and grading
// (delivered and finished), burning, the liquidity fire (a keeper's LiquidityBurner run burning real pool tokens), profiles (FireProfiles: set, rename, a name unique in any case, the picture falling back once its
// card is sold, clear), and every read the site uses. Run by run.mjs.

import { concat, decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import type { Net } from "../../src/lib/net";
import { cardsAbi, creditsAbi, packsAbi } from "../../src/lib/cards";

type Ctx = {
  RPC: string; deployment: Net["deployment"]; C: Record<string, Address>; start: bigint;
  D: Record<string, { address: Address; abi: unknown[] }>;
  warp: (sec: number) => Promise<void>; now: () => Promise<bigint>;
  tx: (account: unknown, address: Address, abi: unknown[], fn: string, args?: unknown[]) => Promise<{ logs: { topics: Hex[]; data: Hex; address: Address }[] }>;
  asOwner: (to: Address, data: Hex) => Promise<unknown>;
  rpc: (method: string, params?: unknown[]) => Promise<unknown>;
  pub: PublicClient;
};

const MNEMONIC = "test test test test test test test test test test test junk";
let checks = 0;
function check(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`CHECK FAILED: ${what}`);
  checks++;
  console.log(`  ok  ${what}`);
}

export async function runTest(ctx: Ctx): Promise<number> {
  // the network: a local chain with its own deployments file (no explorer: cards are found by scanning the chain)
  globalThis.__FORGE_NET__ = {
    name: "local", chainId: 31337, label: "Local test chain", readRpc: ctx.RPC, publicRpc: ctx.RPC, explorer: "",
    deployment: ctx.deployment, drandUrls: [], testnet: true,
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11", // setup.mjs puts DevMulticall3 there: reads batch as on the real chains
  };
  // a browser's localStorage (tx.ts keeps sent transactions there until they land)
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) };
  // every RPC request the layer makes (to check the log scans are incremental)
  const rpcLog: { method: string; params: unknown[] }[] = [];
  const realFetch = globalThis.fetch;
  // KyberSwap stand-in (the Get PAPER section): answers the aggregator's URLs while set
  let kyberMock: ((url: string, init?: RequestInit) => Response) | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (kyberMock && String(input).startsWith("https://aggregator-api.kyberswap.com/")) return kyberMock(String(input), init);
    try { const b = JSON.parse(String(init?.body ?? "")); for (const x of Array.isArray(b) ? b : [b]) rpcLog.push({ method: x.method, params: x.params ?? [] }); } catch { /* not JSON-RPC */ }
    return realFetch(input, init);
  }) as typeof fetch;
  const W = await import("../../src/lib/wallet");
  const L = await import("../../src/lib/chain");
  const T = await import("../../src/lib/tx");
  // drand stand-in: the dev router takes any 64-byte signature
  L.setSignatureSource(async (round) => (keccak256(toHex(`r${round}a`)) + keccak256(toHex(`r${round}b`)).slice(2)) as Hex);

  const deployer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
  const buyerHd = mnemonicToAccount(MNEMONIC, { addressIndex: 3 });
  const buyer = privateKeyToAccount(toHex(buyerHd.getHdKey().privateKey!));
  const other = mnemonicToAccount(MNEMONIC, { addressIndex: 4 });
  const me = buyer.address;
  const fire = 7;
  const steps: string[] = [];
  const o = { onStep: (s: string, label: string) => { if (s === "done") steps.push(label); } };

  console.log("\n== demo mode stays demo");
  check(L.NET.name === "local" && L.isDeployed(L.NET), "the layer is on the local chain, and its contracts are deployed");
  check(!L.isDeployed({ ...L.NET, deployment: { chainId: 4663, inputs: {}, contracts: {} } }), "a network with an empty deployments file counts as not deployed (mainnet before the deploy)");

  console.log("\n== wallet");
  W.setLocalSigner(buyer);
  check(W.getAccount().address === me && W.getAccount().onRobinhood, "the test account stands in for a connected wallet");
  // play money for the buyer (the stand-in tokens mint to anyone, by the deployer)
  for (const t of ["paper", "plank", "usdg"] as const) await ctx.tx(deployer, ctx.D[t].address, ctx.D[t].abi, "mint", [me, t === "usdg" ? 10_000n * 10n ** 6n : 10n ** 30n]);
  const pressMint = await ctx.tx(deployer, ctx.D.press.address, ctx.D.press.abi, "mint", [me]);
  const pressId = Number(BigInt(pressMint.logs.find((l) => l.address.toLowerCase() === ctx.D.press.address.toLowerCase())!.topics[3]));
  const bal = await L.balances(me);
  check(bal.PAPER && bal.PLANK && bal.USDG && BigInt(bal.USDG.raw) === 10_000n * 10n ** 6n, `balances: ETH ${bal.ETH?.text}, PAPER ${bal.PAPER?.text}, PLANK ${bal.PLANK?.text}, USDG ${bal.USDG?.text} (6 decimals read from the token)`);

  console.log("\n== the Series before it opens: its groups");
  check(JSON.stringify(await L.seriesNumbers()) === "[7]", "Series list from DropConfigured: [7]");
  let s = (await L.currentSeries())!;
  check(s.fire === fire && s.state === "upcoming" && s.packs === 7 && s.groups.length === 3, `current Series 7: upcoming, 7 packs in ${s.groups.length} groups`);
  const [gp, ge, gx] = s.groups;
  check(gp.gate === "nft" && gp.isPress && gp.name === "Paper Press holders" && gp.who === "Paper Press holders only" && gp.free === false && gp.coins.length === 0 && gp.paper.text === "1" && gp.perNft === 1 && gp.rollTo === 1,
    `group 1: ${gp.name}, ${gp.capacity} pack, ${gp.paper.text} PAPER, no dollar price, 1 per Press, leftovers to Everyone`);
  check(ge.gate === "open" && ge.name === "Everyone" && ge.priceUsd === "2.50" && ge.coins.join() === "PLANK,ETH,USDG" && ge.capacity === 6 && ge.left === 6 && ge.state === "upcoming",
    `group 2: ${ge.name}, ${ge.capacity} packs, $${ge.priceUsd} + ${ge.paper.text} PAPER in ${ge.coins.join(", ")}`);
  check(ge.perWallet === 3 && ge.limitFor === 600 && ge.limitUntil === Number(ctx.start) + 600 && gp.limitFor === 0 && gp.limitUntil === 0,
    "Everyone: 3 per wallet for its first 10 minutes, then no limit (limitUntil: 10 minutes after it opens); the Press group has no timer");
  check(gx.unlimited && gx.name === "Extra packs" && gx.capacity === null && gx.left === null && gx.coins.join() === "ETH" && gx.perTx === 1 && gx.taxBps === 400 && gx.idle === 300 && gx.afterGroup === 1 && gx.opensAt === 0,
    "group 3: Extra packs, no limit, ETH only, 1 per purchase, 4% rising, ends 5 minutes after its last sale, opens when Everyone ends");
  check(gx.next?.usd === "2.60" && gx.next.tax === "0.10" && gx.after.map((x) => x.usd).join() === "2.70,2.81,2.92", `its next packs: $${gx.next?.usd} ($2.50 + $${gx.next?.tax} tax), then ${gx.after.map((x) => "$" + x.usd).join(", ")}`);
  check(s.creditGroup === 1 && s.status.left === null && !s.closing, "free packs come from Everyone; with an unlimited group ahead, no end to what can sell");
  check(s.cards.cardsPerPack === 6 && s.cards.characters === 3, `${s.cards.cardsPerPack} cards a pack, ${s.cards.characters} characters`);

  console.log("\n== the practice pack: the Series' own cards at its recipe's fixed odds (read-only)");
  const ps = await L.practiceSet(fire);
  check(ps && ps.imagesBase === "ipfs://bafyexampleimages/" && ps.characters.join() === "Ember Fox,Ash Wolf,Cinder Queen" && ps.types.map((t) => t.slug).join() === "paper,wood,fire,coal,gold,fullart",
    `practice set: Series 7's image folder, characters and card types (${ps?.types.map((t) => `${t.slug} ${(t.share * 100).toFixed(2)}%`).join(", ")})`);
  check(Math.abs(ps.types.reduce((a, t) => a + t.share, 0) - 1) < 1e-9 && ps.types[0].share === 0.5 && ps.types[5].share === 0 && ps.onePerCharacter === 5 && ps.cardsPerPack === 6
    && ps.characterOdds.every((p) => Math.abs(p - 1 / 3) < 1e-12), "its odds: 6 cards a pack, Paper 50% of slot cards, Full Art one per character (in no slot), characters equally likely");
  check(ps.slots.map((x) => x.count).join() === "3,1,1,1" && ps.slots[0].odds[0] === 1 && ps.slots[1].odds[1] === 1
    && Math.abs(ps.slots[2].odds[1] - 0.494) < 1e-12 && Math.abs(ps.slots[3].odds[2] - 0.6732) < 1e-12 && ps.slots[3].odds[0] === 0 && ps.slots[3].odds[1] === 0,
    "its pack (RecipeDealer.slotsOf): 3 Paper · 1 Wood · 1 Wood or better (Wood 49.4%) · 1 Fire or better (Fire 67.32%)");
  const many = Array.from({ length: 400 }, () => L.practiceDeal(ps));
  const cardsAll = many.flat(), paperN = cardsAll.filter((c) => c.slug === "paper").length;
  const imgOk = cardsAll.every((c) => c.image === `ipfs://bafyexampleimages/c${c.characterIndex}-${c.slug}-${c.holo}-u.webp` && ps.characters[c.characterIndex] === c.character);
  const special = cardsAll.filter((c) => c.rank >= 4);
  const shaped = many.every((p) => p.length === 6 && p.slice(0, 3).every((c) => c.slug === "paper") && p[3].slug === "wood" && p[4].rank >= 1 && p[5].rank >= 2);
  const woodUp = many.filter((p) => p[4].slug === "wood").length;
  check(shaped && paperN === 1200 && Math.abs(woodUp - 198) < 55 && imgOk && special.every((c) => c.holo === "full"),
    `400 practice packs, slot by slot: 3 Paper, a Wood, a Wood or better (Wood ${woodUp} of 400), a Fire or better in every pack; each card's image is the Series' own (c<character>-<slug>-<holo>-u.webp); Gold and Full Art always full holo (${special.length} of them)`);
  const tight = Array.from({ length: 50 }, () => L.practiceDeal(ps, Math.random, 3)); // as many packs as characters: one each
  check(tight.every((p) => p[0].slug === "fullart" && p[0].holo === "full" && p.slice(1, 3).every((c) => c.slug === "paper")),
    "a practice pack's Full Art takes its first Paper's place, with the Series' chance (characters / packs)");

  console.log("\n== suggestions: theme + art style in one transaction, then the owner picks");
  const rules = await L.suggestionRules();
  check(rules.many && rules.perTx === 3 && rules.paperEach.text === "1", `suggestMany is there (up to ${rules.perTx} per transaction), ${rules.paperEach.text} PAPER each`);
  const paperBefore = BigInt((await L.balances(me)).PAPER!.raw);
  const sg = await L.suggest({ texts: ["Theme: Haunted diner", "Art style: Old woodcut print"] }, o);
  check(sg.receipts.length === 1 && !sg.oneByOne, "both sent in one transaction (suggestMany)");
  check(paperBefore - BigInt((await L.balances(me)).PAPER!.raw) === 2n * 10n ** 18n, "2 PAPER paid (1 each, to the liquidity fire)");
  await L.suggest({ texts: ["Character: A sleepy volcano\nPersonality: Grumpy before coffee"] }, o);
  const mine = await L.suggestions({ by: me });
  check(mine.length === 3 && mine[2].text === "Theme: Haunted diner" && mine.every((x) => x.round === 0 && !x.picked), "the wallet's 3 suggestions read back (texts, round 0, not picked)");
  const roundList = await L.suggestions({ round: 0 });
  check(roundList.length === 3, "the round's box lists all 3");
  // the scans are incremental: once a scan has covered the history, the next one reads only the newest blocks
  await ctx.rpc("anvil_mine", [toHex(300)]);
  await L.suggestions({ by: me });
  const head = await (await import("../../src/lib/wallet")).getPublicClient().getBlockNumber({ cacheTime: 0 });
  rpcLog.length = 0;
  check((await L.suggestions({ by: me })).length === 3, "the same 3 suggestions from the cached scan");
  const gl = rpcLog.filter((x) => x.method === "eth_getLogs").map((x) => BigInt((x.params[0] as { fromBlock: Hex }).fromBlock));
  check(gl.length === 1 && gl[0] >= head - 64n, `a sync's scan reads only the newest blocks (1 getLogs from block ${gl[0]}, head ${head}), not the history again`);
  // the owner picks the theme and the art style (before the drop opens): each gets the drop's 1 free pack credit
  const pickIds = mine.filter((x) => x.text.startsWith("Theme") || x.text.startsWith("Art")).map((x) => BigInt(x.id));
  await ctx.asOwner(ctx.C.FireCredits, encodeFunctionData({ abi: creditsAbi, functionName: "pickSuggestions", args: [7n, pickIds] }));
  const picks = await L.picks(fire);
  check(picks.length === 2 && picks.every((p) => p.by === me && p.credits === 1) && picks.some((p) => p.text === "Art style: Old woodcut print"), "results: 2 picks for Series 7, with their texts and the winner");
  check((await L.suggestions({ by: me })).filter((x) => x.picked).length === 2, "the picked ones read as picked");
  check((await L.credits(me)).credits === 2, "2 free pack credits");
  check((await L.suggestionRules()).round === 1, "the box moved on to round 1 for the next Series");

  console.log("\n== Get PAPER: exactly 5 PAPER for ETH, by the cheapest pool route");
  const pb = await L.quotePaperBuy("ETH", 5n * 10n ** 18n);
  check(pb.via === "pools" && pb.confirmations === 1 && BigInt(pb.maxIn) > 0n, `quote: ${pb.cost.text} ETH (${pb.via}), ${pb.confirmations} confirmation`);
  const p0 = BigInt((await L.balances(me)).PAPER!.raw);
  await L.buyPaper(pb, o);
  check(BigInt((await L.balances(me)).PAPER!.raw) - p0 === 5n * 10n ** 18n, "+5 PAPER exactly, into the buyer's own wallet");

  console.log("\n== the drop opens: buy from Everyone with ETH, PLANK and USDG; a free pack");
  await ctx.warp(Number(ctx.start - (await ctx.now())) + 1);
  s = (await L.currentSeries())!;
  check(s.state === "live" && s.groups[0].state === "open" && s.groups[1].state === "open" && s.groups[2].state === "upcoming" && s.groups[0].endsAt === Number(ctx.start) + 3600,
    "live: the Press and Everyone groups are open (the Press for an hour); Extra packs waits");
  const q = await L.quoteGroup(fire, 1, 2);
  check(q.quotes.length === 3 && q.quotes.every((x) => x.available) && q.paper.text === "2" && q.usd === "5.00" && q.tax === "0.00", `quotes for 2 Everyone packs ($${q.usd}): ${q.quotes.map((x) => `${x.cost?.text} ${x.pay}`).join(", ")} + ${q.paper.text} PAPER`);
  check(q.ethAlone && q.paperEth != null && BigInt(q.paperEth.raw) > 0n, `ETH alone: the 2 PAPER cost ${q.paperEth?.text} ETH on the market`);
  const paperHeld = BigInt((await L.balances(me)).PAPER!.raw);
  const qe = q.quotes.find((x) => x.pay === "ETH")!;
  await L.buyPacks({ fire, group: 1, n: 2, pay: "ETH", paperInEth: true, quote: { cost: qe.cost!.raw, paperEth: q.paperEth!.raw } }, o);
  check(BigInt((await L.balances(me)).PAPER!.raw) === paperHeld, "2 packs with ETH alone (buyWithEthAll): the sale bought their PAPER for the liquidity fire, none of the wallet's own");
  await L.buyPacks({ fire, group: 1, n: 1, pay: "ETH" }, o);
  // the per-wallet limit (3) holds for the group's first 10 minutes, then lifts
  let limMsg = "";
  try { await L.buyPacks({ fire, group: 1, n: 1, pay: "PLANK" }, o); } catch (e) { limMsg = (e as Error).message; }
  check(limMsg === "Wallet limit reached for this group." && (await L.myGroupStanding(fire, me)).bought[1] === 3, `a 4th pack while the limit is on is refused: "${limMsg}"`);
  await ctx.warp(Number(ctx.start) + 600 - Number(await ctx.now()));
  await L.buyPacks({ fire, group: 1, n: 1, pay: "PLANK" }, o);
  await L.buyPacks({ fire, group: 1, n: 1, pay: "USDG" }, o);
  check((await L.myGroupStanding(fire, me)).bought.join() === "0,5,0", "5 packs from Everyone (2 ETH alone, 1 ETH, then past the 3-per-wallet limit once it lifted: 1 PLANK, 1 USDG), each step approved and confirmed");
  // the cap is the price the buyer was shown + 3%: a buy shown a price far below the market's is refused, nothing charged
  let capMsg = "", capCode: string | undefined;
  try { await L.buyPacks({ fire, group: 1, n: 1, pay: "ETH", quote: { cost: "1000" } }, o); } catch (e) { capMsg = (e as Error).message; capCode = (e as { code?: string }).code; }
  check(capMsg.length > 0 && capCode === "PriceMoved" && (await L.myGroupStanding(fire, me)).bought[1] === 5, `a buy capped at a stale shown price is refused before the wallet (PriceMoved: "${capMsg}")`);
  let coinMsg = "";
  try { await L.buyPacks({ fire, group: 0, n: 1, pay: "ETH", access: {} }, o); } catch (e) { coinMsg = (e as Error).message; }
  check(/can't buy in this group/.test(coinMsg), `the Press group without a Press: "${coinMsg}"`);
  check((await L.status(fire)).creditPacksLeft === 1, "1 free pack can come from Everyone now");
  await L.spendCredits({ fire, n: 1 }, o);
  s = (await L.currentSeries())!;
  check(s.groups[1].state === "open" && s.groups[1].left === 0 && s.groups[1].waiting && s.groups[1].moreFrom === 0 && s.groups[1].moreAt === Number(ctx.start) + 3600,
    "Everyone sold out (5 bought + 1 free) but stays open: more may come from the Press group when it ends");
  check(s.groups[2].state === "upcoming" && s.state === "live", "Extra packs still waits; the Series is still on sale");

  console.log("\n== the Press group: a pack with a Paper Press");
  check(JSON.stringify(await L.nftUse(fire, 0, [pressId])) === JSON.stringify([{ id: pressId, used: 0 }]), "the Press hasn't been used in this group yet");
  check((await L.pressCount(me)) === 1 && (await L.ownsNft(ctx.D.press.address, me, pressId)) && (await L.nftsOf(ctx.D.press.address, me)).length === 0,
    "1 Press held (the dev Press can't list tokens: the holder types its number)");
  const pq = await L.quoteGroup(fire, 0, 1);
  check(pq.quotes.length === 0 && pq.usd === "0.00" && pq.paper.text === "1" && pq.ethAlone, "the Press pack: no dollar price, 1 PAPER (or its PAPER in ETH)");
  await L.buyPacks({ fire, group: 0, n: 1, access: { nftIds: [pressId] } }, o);
  check((await L.nftUse(fire, 0, [pressId]))[0].used === 1, "Press pack taken with the Press: it has used its 1 pack this drop");
  s = (await L.currentSeries())!;
  check(s.groups[0].state === "ended" && s.groups[1].state === "ended" && s.groups[2].state === "open" && s.status.left === null && s.state === "live",
    "the Press and Everyone have ended; Extra packs is open; the Series stays open (no limit)");

  console.log("\n== Extra packs: 2 extra packs, the price rising 4% each");
  const t1 = await L.quoteGroup(fire, 2, 1);
  check(t1.quotes.map((x) => x.pay).join() === "ETH" && t1.usd === "2.60" && t1.tax === "0.10", `extra pack #1: $${t1.usd} ($2.50 + $${t1.tax} tax), ETH only`);
  let txMsg = "";
  try { await L.buyPacks({ fire, group: 2, n: 2, pay: "ETH" }, o); } catch (e) { txMsg = (e as Error).message; }
  check(/Too many for one buy/.test(txMsg), `2 at once is refused (1 per purchase): "${txMsg}"`);
  await L.buyPacks({ fire, group: 2, n: 1, pay: "ETH", quote: { cost: t1.quotes[0].cost!.raw } }, o);
  // a second buyer shown the same price: the next pack costs 4% more, over the 3% cap: refused, nothing charged
  let race: { code?: string; message?: string } = {};
  try { await L.buyPacks({ fire, group: 2, n: 1, pay: "ETH", quote: { cost: t1.quotes[0].cost!.raw } }, o); } catch (e) { race = e as typeof race; }
  check(race.code === "PriceMoved", `a buy at the price before someone else's is refused (PriceMoved: "${race.message}")`);
  const t2 = await L.quoteGroup(fire, 2, 1);
  check(t2.usd === "2.70" && BigInt(t2.quotes[0].cost!.raw) > BigInt(t1.quotes[0].cost!.raw), `extra pack #2: $${t2.usd} ($2.50 + $${t2.tax} tax)`);
  await L.buyPacks({ fire, group: 2, n: 1, pay: "ETH", quote: { cost: t2.quotes[0].cost!.raw } }, o);
  s = (await L.currentSeries())!;
  check(s.groups[2].sold === 2 && s.groups[2].next?.usd === "2.81" && s.groups[2].endsAt > 0 && s.state === "live", `2 extra packs sold; the next is $${s.groups[2].next?.usd}; it ends ${s.groups[2].idle / 60} minutes after the last sale`);

  console.log("\n== it idles out; then anyone closes the Series");
  await ctx.warp(s.groups[2].endsAt - Number(await ctx.now()) + 1);
  s = (await L.currentSeries())!;
  check(s.groups[2].state === "ended" && s.status.left === 0 && s.closing && s.state === "live" && !s.cards.closed, "5 quiet minutes: Extra packs ended, nothing left, \"Closing…\" (not closed yet)");
  W.setLocalSigner(privateKeyToAccount(toHex(other.getHdKey().privateKey!)));
  await L.closeDrop({ fire }, o);
  W.setLocalSigner(buyer);
  s = (await L.currentSeries())!;
  check(s.state === "closed" && s.cards.closed && s.cards.packs === 9 && !s.closing, "closed by another wallet: 9 packs (6 Everyone + 1 Press + 2 extra)");
  check(JSON.stringify(await L.packsOf(me)) === JSON.stringify([{ fire: 7, count: 9 }]), "9 sealed packs held");

  console.log("\n== an open whose draw never comes: after 24 hours, the packs come back sealed");
  const stuck = await L.openPacks({ fire, n: 2 }, o);
  let opens = await L.opensOf(me);
  check(stuck.index === 0 && opens.length === 1 && opens[0].status === "waiting" && !opens[0].canCancel && opens[0].cancelAt === opens[0].requestedAt + 24 * 3600,
    "opened 2 packs (open #0): waiting for its draw, no cancel before 24 hours (cancelAt: asked + 24 h)");
  let cmsg = "";
  try { await L.cancelOpen({ fire, index: 0 }, o); } catch (e) { cmsg = (e as Error).message; }
  check(/24 hours/.test(cmsg) && JSON.stringify(await L.packsOf(me)) === JSON.stringify([{ fire: 7, count: 7 }]), `cancelling early is refused before the wallet (NotStuck: "${cmsg}")`);
  await ctx.warp(24 * 3600 + 1);
  // the day the test skipped: the price windows move on, as the keeper's would (two checkpoints: a short window again)
  for (const w of [0, 1801]) {
    if (w) await ctx.warp(w);
    for (const t of [ctx.C.PlankUsdTwap, ctx.C.PaperUsdTwap]) await ctx.tx(deployer, t, [{ type: "function", name: "checkpoint", inputs: [], outputs: [], stateMutability: "nonpayable" }], "checkpoint");
  }
  opens = await L.opensOf(me);
  const st24 = await L.openStatus(fire, 0);
  check(opens[0].canCancel && opens[0].status === "deliverable" && st24.canCancel, "24 hours with no answer: it can be cancelled (opensOf and openStatus agree)");
  await L.cancelOpen({ fire, index: 0, packs: 2 }, o);
  opens = await L.opensOf(me);
  check(opens[0].status === "cancelled" && !opens[0].canCancel && JSON.stringify(await L.packsOf(me)) === JSON.stringify([{ fire: 7, count: 9 }]), "cancelled: the 2 packs are back, sealed (9 held), and the open reads as cancelled");

  console.log("\n== open, deliver randomness, deal");
  const op = await L.openPacks({ fire, n: 9 }, o);
  check(op.index === 1, "opened 9 packs (open #1, behind the cancelled one)");
  opens = await L.opensOf(me);
  check(opens.length === 2 && opens[0].index === 1 && opens[0].status === "waiting" && opens[0].round !== null, `waiting for drand round ${opens[0].round}`);
  const st0 = await L.openStatus(fire, op.index);
  check(st0.status === "waiting" && st0.round === opens[0].round && st0.now < st0.roundAt!, "openStatus (by index, no log scan) agrees: waiting, with the round and the chain's clock");
  check((await L.deliverAndDeal({ fire, index: op.index }, o)).delivered === 0, "before the round is out: nothing delivered");
  await ctx.warp(100);
  opens = await L.opensOf(me);
  check(opens[0].status === "deliverable" && (await L.openStatus(fire, op.index)).status === "deliverable", "the round is out: deliverable");
  const sent0 = steps.length;
  const dd = await L.deliverAndDeal({ fire, index: op.index }, o);
  check(dd.delivered === 1 && dd.dealt && dd.reached && !dd.keeper, "delivered (the router took the signature) and dealt the buyer's open");
  check(steps.length - sent0 === 2 && steps.slice(sent0).join(" / ") === "Draw your cards / Deal your cards", `in exactly 2 transactions: ${steps.slice(sent0).join(" / ")}`);
  check((await L.opensOf(me))[0].status === "dealt" && (await L.openStatus(fire, op.index)).status === "dealt", "the open reads as dealt");

  console.log("\n== cards");
  const cards = await L.cardsOf(me);
  check(cards.length === 54, "54 cards found by scanning the chain (no explorer on a local chain)");
  const c0 = cards[0];
  check(c0.name.includes(c0.character) && c0.image.startsWith("ipfs://") && c0.image.endsWith("-u.webp") && c0.grade === null && !c0.cased, `a card: "${c0.name}", ${c0.material}, holo ${c0.holo}, image ${c0.image.split("/").pop()}`);
  check(["Character", "Category", "Material", "Holo", "Series", "Print number", "PDA"].every((k) => k in c0.traits), "its traits are the metadata's");
  check(c0.print >= 1 && String(c0.traits["Print number"]).replace(/^#/, "") === String(c0.print) && cards.every((c) => c.print >= 1), `its print number: #${c0.print} (the metadata's "Print number")`);
  await ctx.warp(3600); // an hour raw
  const nowA = Number(await ctx.now()), c0b = await L.card(c0.serial);
  check(c0b.age >= 3600 && Math.abs(nowA - c0b.dealtAt - c0b.age) <= 2, `a raw card's age is the chain's (wearOf): ${c0b.age} s since it was dealt, and running`);

  console.log("\n== case one card, grade two");
  const pr = await L.psaPrices();
  check(pr.caseUsd === "0.05" && pr.gradeUsd === "1.00" && pr.maxBatch === 20, `prices: case $${pr.caseUsd}, grade $${pr.gradeUsd} (every card), up to ${pr.maxBatch} cards`);
  const [ca, g1, g2] = [cards[1].serial, cards[2].serial, cards[3].serial];
  const pq2 = await L.quoteProtect([ca], [g1, g2], "ETH");
  check(BigInt(pq2.raw) > 0n, `1 case + 2 grades = ${pq2.text} ETH (FirePsa.quote: exactly what protect charges)`);
  check(L.PSA_PAY.join(",") === "PLANK,ETH,USDG", `cases and grading take ${L.PSA_PAY.join(", ")} (no PAPER)`);
  const pt = await L.protect({ caseIds: [ca], gradeIds: [g1, g2], pay: "ETH", quote: pq2.raw }, o);
  check(pt.gradingIndex === 0, "cased and sent for grading in one transaction (grading #0), capped at the price shown");
  check((await L.card(ca)).cased && (await L.card(g1)).gradePending, "the case shows; the graded cards are pending (they can't move)");
  const caseAge = (await L.card(ca)).age;
  check((await L.gradingsOf(me))[0].status === "waiting" && (await L.gradingStatus(0)).status === "waiting", "grading waits for its round");
  check((await L.gradingIds(0, [g1, g2])).join() === [g1, g2].join() && (await L.gradingIds(0)).join() === [g1, g2].join(), "the grading's card list: the page's own (checked against idsHash) or from its event");
  await ctx.warp(100);
  check(await L.deliverAndFinish({ index: 0, ids: [g1, g2] }, o), "delivered and finished: grades set");
  const [x1, x2] = [await L.card(g1), await L.card(g2)];
  check(x1.grade !== null && x2.grade !== null && !x1.gradePending && x1.image.endsWith(`-${x1.grade}.webp`), `grades: PDA ${x1.grade} and PDA ${x2.grade}; the image is the slab's`);
  check((await L.gradingsOf(me))[0].status === "done", "grading reads as done");
  check((await L.card(ca)).age === caseAge && caseAge > 0, `a cased card's age stays frozen at ${caseAge} s (not 0, not running)`);
  const pop = await L.gradedPop();
  check(pop.length === 2 && pop.every((x) => x.fire === fire && x.material) && pop.map((x) => x.grade).sort().join() === [x1.grade, x2.grade].sort().join(),
    `pop report from the Graded events: ${pop.map((x) => `${x.material} PDA ${x.grade}`).join(", ")}`);
  console.log("\n== the fun layer's reads (forge feed.js, share.js, binder.js): pulls, the board, the recap, the cast");
  const dealtAll = await L.dealtCards(fire, 500);
  check(dealtAll.length === 54 && dealtAll.every((d) => d.holder?.toLowerCase() === me.toLowerCase() && d.material && d.character && d.at),
    "dealtCards: all 54, newest first, each with the wallet that opened it (PacksOpened), its kind and time");
  const kinds = new Map(cards.map((c) => [c.serial, c]));
  check(dealtAll.every((d) => { const c = kinds.get(d.serial); return !!c && c.material === d.material && c.character === d.character && c.holo === d.holo; }), "each dealt card's kind (from CardDealt + cardText) matches its metadata");
  const board = await L.fuelBoard(fire), myRow = board.find((r) => r.wallet.toLowerCase() === me.toLowerCase());
  check(!!myRow && myRow.cased === 1 && myRow.graded === 2 && myRow.packs + myRow.free >= 1, `fuelBoard: ${board.map((r) => `${r.wallet.slice(0, 8)} ${r.packs}+${r.free} packs, ${r.cased} cased, ${r.graded} graded`).join(" / ")}`);
  const rc = await L.seriesRecap(fire);
  check(rc.packs === 9 && !!rc.closedAt && rc.closedAt > rc.start && rc.buyers >= 1, `seriesRecap: ${rc.packs} packs (bought + free), ${rc.buyers} buying wallets, closed ${rc.closedAt! - rc.start} s after the start`);
  const cast = await L.seriesCharacters(fire);
  check(cast.length > 0 && cards.every((c) => cast.includes(c.character)), `seriesCharacters: ${cast.join(", ")}`);
  // the same with PLANK (an ERC-20: approved first)
  const pt2 = await L.protect({ caseIds: [cards[4].serial], pay: "PLANK" }, o);
  check(pt2.gradingIndex === -1 && (await L.card(cards[4].serial)).cased, "a case paid in PLANK (approved, no grading)");

  console.log("\n== burn");
  await L.burnCards({ ids: [cards[5].serial, cards[6].serial, cards[7].serial] }, o);
  const cr = await L.credits(me);
  check(cr.burnedTowardNext === 3 && cr.cardsPerCredit === 42 && cr.credits === 1, "3 burned toward the next free pack (of 42); 1 credit left");
  check((await L.cardsOf(me)).length === 51, "51 cards left");

  console.log("\n== a snapshot group's proof (wallet, allowance)");
  const [la, lb] = [L.snapshotLeaf(me, 3), L.snapshotLeaf(other.address, 5)];
  const root = BigInt(la) < BigInt(lb) ? keccak256(concat([la, lb])) : keccak256(concat([lb, la]));
  check(L.verifySnapshotProof([lb], root, me, 3) && !L.verifySnapshotProof([lb], root, me, 4) && !L.verifySnapshotProof([lb], root, deployer.address, 3) && !L.verifySnapshotProof([lb], `0x${"0".repeat(64)}`, me, 3),
    "a snapshot proof checks out against the group's root, only for its own wallet and allowance");
  const files = [
    { root, wallets: { [me]: { allowance: 3, proof: [lb] }, [other.address]: { allowance: 5, proof: [la] } } },
    { root, wallets: [{ address: me.toLowerCase(), allowance: "3", proof: [lb] }] },
    { root, proofs: { [me]: [lb] }, holders: [{ wallet: me, allowance: 3 }] },
    { groups: [{ root: `0x${"ab".repeat(32)}`, wallets: {} }, { root, wallets: { [me]: { allowance: 3, proof: [lb] } } }] },
    // ops/snapshot's file: groups keyed by group index, lowercase wallet keys
    { series: 7, chainId: 31337, updated: "now", groups: { "0": { name: "Other", root: `0x${"ab".repeat(32)}`, wallets: {} },
      "1": { name: "PLANK holders", root, token: "0x", kind: "erc20", symbol: "PLANK", count: 2, block: "1", wallets: { [me.toLowerCase()]: { allowance: 3, proof: [lb] } } } } },
  ];
  check(files.every((f) => L.snapshotEntry(f, root, me)?.allowance === 3), "the snapshot file's entry is found in each shape (address map, list, proofs + holders, one of several groups, ops/snapshot's groups by index)");
  check(L.snapshotFor(files[4], root)?.name === "PLANK holders", "the holders file names its group (shown in the buy box)");
  check(L.snapshotEntry(files[0], root, deployer.address) === null && L.snapshotEntry({ root, wallets: { [me]: { allowance: 9, proof: [lb] } } }, root, me) === null && L.snapshotEntry(files[0], `0x${"cd".repeat(32)}`, me) === null,
    "not on it, a wrong allowance, or another group's root: no entry");

  console.log("\n== a transaction the network hasn't confirmed yet: saved, followed, resumed");
  await new Promise((ok) => setTimeout(ok, 300)); // any nonce reads still out from the sends above
  check(L.pendingTxs(me).length === 0, `every transaction that landed is forgotten (none left pending: ${L.pendingTxs(me).map((t) => t.label).join(", ") || "none"})`);
  const sale = ctx.C.FireSale, paperTok = ctx.D.paper.address;
  await ctx.rpc("evm_setAutomine", [false]);
  let late: unknown = null;
  try { await T.sendTx({ address: paperTok, abi: erc20Abi, functionName: "approve", args: [sale, 1n] }, { label: "Approve a little PAPER", kind: "approve", waitMs: 400 }); } catch (e) { late = e; }
  check(late instanceof L.TxStillPending && L.pendingTxs(me).length === 1 && L.pendingTxs(me)[0].kind === "approve", "not confirmed in time: TxStillPending (not a failure), and it's saved as pending");
  await ctx.rpc("evm_mine");
  check((await (late as InstanceType<typeof L.TxStillPending>).later) === "success" && L.pendingTxs(me).length === 0, "once mined, its `later` says success and it's no longer pending");
  try { await T.sendTx({ address: paperTok, abi: erc20Abi, functionName: "approve", args: [sale, 2n] }, { label: "Approve some more", kind: "approve", waitMs: 400 }); } catch { /* still pending */ }
  const resumed: string[] = [];
  const done = new Promise<void>((ok) => { L.resumePending((t, outcome) => { resumed.push(`${t.label}: ${outcome}`); ok(); }, me, (t) => t.label === "Approve some more"); });
  await ctx.rpc("evm_mine"); await ctx.rpc("evm_setAutomine", [true]);
  await done;
  check(resumed.join() === "Approve some more: success" && L.pendingTxs(me).length === 0, `a reload resumes it: ${resumed.join()}`);

  console.log("\n== a case paid in USDG, once the PAPER price is up (PaperUsdTwap: a pool qualifies for 20 h, then a window)");
  const cp = [{ type: "function", name: "checkpoint", inputs: [], outputs: [], stateMutability: "nonpayable" }];
  for (let k = 0; k < 3; k++) { await ctx.warp(20 * 3600 + 60); await ctx.tx(deployer, ctx.C.PlankUsdTwap, cp, "checkpoint"); await ctx.tx(deployer, ctx.C.PaperUsdTwap, cp, "checkpoint"); }
  const card9 = cards[9].serial, q5 = await L.quoteProtect([card9], [], "USDG");
  const usdgBefore = BigInt((await L.balances(me)).USDG!.raw);
  const pt3 = await L.protect({ caseIds: [card9], pay: "USDG", quote: q5.raw }, o);
  const spent = usdgBefore - BigInt((await L.balances(me)).USDG!.raw);
  check(BigInt(q5.raw) > 0n && pt3.gradingIndex === -1 && (await L.card(card9)).cased && spent === BigInt(q5.raw),
    `a case paid in USDG (approved to FirePsa; the fee goes to LiquidityBurner): ${q5.text} USDG, exactly the quote`);

  console.log("\n== the liquidity fire (LiquidityBurner): everything paid in so far is paired and burned as PAPER/PLANK liquidity");
  const LB = ctx.C.LiquidityBurner;
  const lbAbi = [
    { type: "function", name: "run", inputs: [], outputs: [], stateMutability: "nonpayable" },
    { type: "function", name: "setKeeper", inputs: [{ type: "address" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" },
    { type: "function", name: "held", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "lpBurned", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "PAIR", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  ] as const;
  const lbRead = <T,>(functionName: "held" | "lpBurned" | "PAIR") => ctx.pub.readContract({ address: LB, abi: lbAbi, functionName }) as Promise<T>;
  const usd = (x: bigint) => (Number(x) / 1e18).toFixed(2);
  check(BigInt(await ctx.pub.getBalance({ address: LB })) > 0n && BigInt(await ctx.pub.readContract({ address: paperTok, abi: erc20Abi, functionName: "balanceOf", args: [LB] })) > 0n,
    "sales, fees and suggestions paid LiquidityBurner (ETH and PAPER held; nothing went to the dead address at sale time)");
  // a short price window again (the run refuses a long one), as the keeper's checkpoints keep it; LiquidityBurner's own
  // 30-minute PAPER average (the PAPER/PLANK pool's) too: a checkpoint now, a run 31 minutes later
  await ctx.tx(deployer, LB, cp, "checkpoint");
  check(BigInt((await ctx.pub.readContract({ address: LB, abi: lbAbi, functionName: "held" }))[0]) === 0n, "LiquidityBurner's PAPER average is under 30 minutes old: held() shows no sides yet (a run would wait)");
  await ctx.warp(31 * 60);
  for (const t of [ctx.C.PlankUsdTwap, ctx.C.PaperUsdTwap]) await ctx.tx(deployer, t, cp, "checkpoint");
  const [hp, hk, hs] = await lbRead<[bigint, bigint, bigint]>("held");
  let refused = "";
  try { await ctx.tx(deployer, LB, lbAbi as unknown as unknown[], "run"); } catch (e) { refused = (e as Error).message; }
  check(refused.length > 0, "a wallet the owner hasn't named can't run it (keepers only: an open run could be sandwiched)");
  await ctx.asOwner(LB, encodeFunctionData({ abi: lbAbi, functionName: "setKeeper", args: [deployer.address, true] }));
  await ctx.tx(deployer, LB, lbAbi as unknown as unknown[], "run");
  const lp = await lbRead<bigint>("lpBurned");
  const pair = await lbRead<Address>("PAIR");
  const deadLp = await ctx.pub.readContract({ address: pair, abi: erc20Abi, functionName: "balanceOf", args: ["0x000000000000000000000000000000000000dEaD"] });
  const [ap, ak, as] = await lbRead<[bigint, bigint, bigint]>("held");
  check(lp > 0n && deadLp === lp, `a keeper's run: ${lp} pool tokens minted straight to the dead address (held before: PAPER side $${usd(hp)}, PLANK side $${usd(hk)}, $${usd(hs)} to spend)`);
  check(as < 10n ** 16n && ap <= 100n * 10n ** 18n && ak <= 100n * 10n ** 18n,
    `after the run: $${usd(as)} left to spend, PAPER side $${usd(ap)}, PLANK side $${usd(ak)} (each at most the $100 cap)`);
  const lt = await L.liquidityBurned();
  check(!!lt && BigInt(lt.lp.raw) === lp && BigInt(lt.PAPER.raw) > 0n && BigInt(lt.PLANK.raw) > 0n,
    `the burn tally's liquidity row: ${lt?.PAPER.text} PAPER and ${lt?.PLANK.text} PLANK held by the burned pool tokens`);

  console.log("\n== profiles (FireProfiles): a name and a card as the picture");
  const otherAcct = privateKeyToAccount(toHex(other.getHdKey().privateKey!));
  const pfp = cards[11].serial;
  check(L.profilesOn() && (await L.profile(me)) === null, "FireProfiles is deployed; no profile yet");
  check(L.validName("Fire Kid") && !L.validName(" Fire") && !L.validName("a  b") && !L.validName("x".repeat(21)) && !L.validName("café"), "name rules (1-20 printable ASCII, single inner spaces)");
  const crop = { x: 0.3, y: 0.62, zoom: 2.5 };
  const u = L.unpackCrop(L.packCrop(crop));
  check(Math.abs(u.x - 0.3) < 1e-4 && Math.abs(u.y - 0.62) < 1e-4 && Math.abs(u.zoom - 2.5) < 1e-3, "the crop packs into 64 bits and back");
  const setR = await L.setProfile({ name: "Fire Kid", pfpCard: pfp, crop }, o);
  let pf = await L.profile(me, true);
  check(pf?.name === "Fire Kid" && pf.pfpCard === pfp && Math.abs(pf.crop.zoom - 2.5) < 1e-3 && !!pf.image && pf.updated > 0, `set in one transaction (${setR.gasUsed} gas): "${pf?.name}", card #${pf?.pfpCard}, image ${pf?.image?.split("/").pop()}`);
  check((await L.nameOwner("FIRE KID")) === me && (await L.nameOwner("fire kid")) === me, "the name is found in any case");
  W.setLocalSigner(otherAcct);
  let pmsg = "";
  try { await L.setProfile({ name: "fIRE kID" }, o); } catch (e) { pmsg = (e as Error).message; }
  check(pmsg === "That name is taken.", `the same name in another case is refused: "${pmsg}"`);
  try { await L.setProfile({ name: "Other", pfpCard: pfp }, o); pmsg = ""; } catch (e) { pmsg = (e as Error).message; }
  check(pmsg === "That card isn't in your wallet.", `a picture from someone else's card is refused (NotYourCard): "${pmsg}"`);
  W.setLocalSigner(buyer);
  await L.setProfile({ name: "Ember", pfpCard: pfp, crop }, o);
  check((await L.nameOwner("fire kid")) === null && (await L.profile(me, true))?.name === "Ember", "renamed to Ember: the old name is free");
  W.setLocalSigner(otherAcct);
  await L.setProfile({ name: "FIRE KID" }, o);
  W.setLocalSigner(buyer);
  check((await L.nameOwner("Fire Kid")) === other.address, "another wallet took the freed name");
  L.forgetProfile();
  const both = await L.profiles([me, other.address]);
  check(both[me.toLowerCase()]?.name === "Ember" && both[other.address.toLowerCase()]?.name === "FIRE KID" && both[other.address.toLowerCase()]?.pfpCard === null, "two profiles in one read");
  await ctx.tx(buyer, ctx.C.FireCards, cardsAbi as unknown[], "transferFrom", [me, other.address, BigInt(pfp)]);
  pf = await L.profile(me, true);
  check(pf?.name === "Ember" && pf.pfpCard === null && pf.storedPfp === pfp && pf.image === null, "the picture card sold: the name stays, the picture falls back");
  await L.clearProfile(o);
  check((await L.profile(me, true)) === null && (await L.nameOwner("ember")) === null, "cleared: no profile, the name is free");

  console.log("\n== the market (FireMarket): list, buy, re-price, take off sale; packs too");
  {
    const mOther = privateKeyToAccount(toHex(other.getHdKey().privateKey!));
    const s1 = cards[12].serial, s2 = cards[13].serial;
    check(L.marketOn(), "FireMarket is deployed");
    const lr = await L.listCard({ serial: s1, priceEth: "0.01" }, o);
    check((await L.marketApproved(me)).cards, `listed card #${s1} at 0.01 ETH (${lr.gasUsed} gas), the market approved for cards once`);
    await L.listCard({ serial: s2, priceEth: "0.02" }, o);
    let ls = await L.listings();
    const mine = ls.cards.filter((x) => x.seller === me).map((x) => x.serial).sort();
    check(mine.length === 2 && mine.includes(s1) && mine.includes(s2) && ls.cards.find((x) => x.serial === s1)?.priceEth === "0.01", "both show in the listings, read from the market's events and checked on the chain");
    await L.listCard({ serial: s2, priceEth: "0.03" }, o);
    check((await L.offerOf(s2))?.priceEth === "0.03", "re-listed at a new price");
    W.setLocalSigner(mOther);
    const offer = (await L.offerOf(s1))!;
    let mm = "";
    try { await L.buyCard({ serial: s1, price: (BigInt(offer.price) / 2n).toString() }, o); } catch (e) { mm = (e as Error).message; }
    check(/price just changed/i.test(mm), `a buy at a price that isn't the listing's is refused: "${mm}"`);
    const sellerBefore = await ctx.pub.getBalance({ address: me });
    const br = await L.buyCard({ serial: s1, price: offer.price }, o);
    const owner = await ctx.pub.readContract({ address: ctx.C.FireCards, abi: cardsAbi as never, functionName: "ownerOf", args: [BigInt(s1)] }) as Address;
    const got = (await ctx.pub.getBalance({ address: me })) - sellerBefore;
    check(owner === other.address && got === 95n * 10n ** 14n, `bought by another wallet (${br.gasUsed} gas): the card moved, the seller got ${Number(got) / 1e18} ETH (5% royalty)`);
    check((await L.offerOf(s1)) === null, "sold: no longer for sale");
    try { await L.cancelCard({ serial: s2 }, o); mm = ""; } catch (e) { mm = (e as Error).message; }
    check(/only the seller/i.test(mm), `someone else can't take a live listing down: "${mm}"`);
    W.setLocalSigner(buyer);
    await L.cancelCard({ serial: s2 }, o);
    check((await L.offerOf(s2)) === null, "the seller took the other off sale");
    const packsHeld = await ctx.pub.readContract({ address: ctx.C.FirePacks, abi: packsAbi as never, functionName: "balanceOf", args: [me, BigInt(fire)] }) as bigint;
    if (packsHeld > 0n) {
      await L.listPacks({ series: fire, amount: 1, pricePerEth: "0.004" }, o);
      ls = await L.listings();
      const pk = ls.packs.find((p) => p.seller === me)!;
      check(!!pk && pk.amount === 1 && pk.series === fire, `listed 1 Series ${fire} pack at 0.004 ETH`);
      W.setLocalSigner(mOther);
      await L.buyMarketPacks({ id: pk.id, amount: 1, pricePer: pk.pricePer }, o);
      const op = await ctx.pub.readContract({ address: ctx.C.FirePacks, abi: packsAbi as never, functionName: "balanceOf", args: [other.address, BigInt(fire)] }) as bigint;
      check(op >= 1n, "another wallet bought the pack");
      W.setLocalSigner(buyer);
    } else console.log("  (no sealed packs left here to sell: pack listings are covered by the contract tests and the rehearsal)");
    await L.listCard({ serial: s2, priceEth: "0.05" }, o);
    await L.cancelAllListings(o);
    check((await L.offerOf(s2)) === null, "Take everything off sale: the listing is dead");

    // offers: paid in WETH, which stays in the buyer's wallet until a holder accepts
    const s3 = cards[15].serial, s4 = cards[16].serial;
    W.setLocalSigner(mOther);
    const before = await L.wethOf(other.address);
    await L.makeOffer({ serial: s3, priceEth: "0.02", days: 7 }, o);
    let w = await L.wethOf(other.address);
    check(BigInt(w.balance) - BigInt(before.balance) === 2n * 10n ** 16n && BigInt(w.allowance) >= 2n * 10n ** 16n && BigInt(w.committed) === 2n * 10n ** 16n,
      "an offer on one card: the ETH it needs is wrapped into WETH and approved to the market, still in the buyer's wallet");
    const c4 = await L.card(s4);
    await L.makeOffer({ rule: { fire, cardType: c4.cardType, character: c4.characterIndex, holo: "any", minGrade: 0 }, priceEth: "0.01", qty: 2, days: 30 }, o);
    w = await L.wethOf(other.address);
    check(BigInt(w.committed) === 4n * 10n ** 16n && BigInt(w.balance) - BigInt(before.balance) === 4n * 10n ** 16n, "a second offer (any card like #" + s4 + ", 2 wanted): only the new 0.02 is wrapped");
    W.setLocalSigner(buyer);
    ls = await L.listings();
    const oCard = ls.offers.find((x) => x.kind === "card" && x.serial === s3)!, oMatch = ls.offers.find((x) => x.kind === "match")!;
    check(!!oCard && !!oMatch && oMatch.qty === 2 && oMatch.rule?.character === c4.characterIndex, "both offers show, the match offer's rule read back");
    check(await L.matchesOffer(oMatch, s4), `card #${s4} matches the "any like it" offer (FireMarket.matches)`);
    const sb = await ctx.pub.getBalance({ address: me });
    const ar = await L.acceptOffer({ id: oCard.id, kind: "card", serial: s3, price: oCard.price }, o);
    const got3 = (await ctx.pub.getBalance({ address: me })) - sb + ar.gasUsed * ar.effectiveGasPrice; // the seller paid the gas
    const own3 = await ctx.pub.readContract({ address: ctx.C.FireCards, abi: cardsAbi as never, functionName: "ownerOf", args: [BigInt(s3)] }) as Address;
    check(own3 === other.address && got3 === 19n * 10n ** 15n, `accepted: card #${s3} went to the buyer and the seller got ${Number(got3) / 1e18} ETH (not WETH; 5% royalty)`);
    let am = "";
    try { await L.acceptOffer({ id: oMatch.id, kind: "match", serial: cards[17].serial, price: oMatch.price }, o); } catch (e) { am = (e as Error).message; }
    const c17 = await L.card(cards[17].serial);
    if (c17.cardType !== c4.cardType || c17.characterIndex !== c4.characterIndex) check(/doesn't match/i.test(am), `a card that doesn't match is refused: "${am}"`);
    await L.acceptOffer({ id: oMatch.id, kind: "match", serial: s4, price: oMatch.price }, o);
    const left = (await L.listings()).offers.find((x) => x.id === oMatch.id);
    check(left?.qty === 1, "a match offer for 2: one filled, one still wanted");
    W.setLocalSigner(mOther);
    await L.cancelOffer({ id: oMatch.id }, o);
    w = await L.wethOf(other.address);
    check(BigInt(w.committed) === 0n, "cancelled: nothing committed");
    const free = BigInt(w.balance) - BigInt(before.balance);
    await L.unwrapWeth({ amount: free.toString() }, o);
    check(BigInt((await L.wethOf(other.address)).balance) === BigInt(before.balance), "the leftover WETH turned back into ETH");
    const sales = await L.recentSales(10);
    check(sales.length >= 3 && sales[0].at > 0 && sales.some((x) => x.serial === s3), `Activity: ${sales.length} sales, newest first, with times (offers accepted included)`);
    W.setLocalSigner(buyer);
  }

  console.log("\n== a grading whose draw never comes: after 24 hours, the cards come back ungraded");
  const gc = cards[14].serial, gq = await L.quoteProtect([], [gc], "ETH");
  const gpt = await L.protect({ gradeIds: [gc], pay: "ETH", quote: gq.raw }, o);
  let gs = (await L.gradingsOf(me)).find((x) => x.index === gpt.gradingIndex)!;
  check(gpt.gradingIndex > 0 && gs.status === "waiting" && !gs.canCancel && (await L.card(gc)).gradePending, `sent for grading (#${gpt.gradingIndex}): waiting, can't be cancelled yet, the card is locked`);
  await ctx.warp(24 * 3600 + 1);
  gs = (await L.gradingsOf(me)).find((x) => x.index === gpt.gradingIndex)!;
  check(gs.canCancel && (await L.gradingStatus(gpt.gradingIndex)).canCancel, "24 hours with no answer: it can be cancelled");
  await L.cancelGrading({ index: gpt.gradingIndex, ids: gs.ids }, o);
  const gcard = await L.card(gc);
  check(!gcard.gradePending && gcard.grade === null && (await L.gradingsOf(me)).find((x) => x.index === gpt.gradingIndex)!.status === "done" && !(await L.gradingStatus(gpt.gradingIndex)).canCancel,
    "cancelled: the card is back, unlocked and ungraded; the grading reads as done");

  console.log("\n== amounts: numbers from raw, 4 significant digits under 1; the network fee reserve");
  const a1 = L.amount(750075007500751n), a2 = L.amount(1_234_567n * 10n ** 18n + 5n * 10n ** 13n), a3 = L.amount(2_500_000n, 6);
  check(a1.text === "0.00075" && Math.abs(a1.n - 0.000750075007500751) < 1e-18 && a2.text === "1,234,567" && a2.n > 1234567 && a3.text === "2.5" && a3.n === 2.5,
    `0.000750075 ETH reads "${a1.text}" (not 0.0007) and its number is exact; 1,234,567.00005 reads "${a2.text}"; 2.5 USDG`);
  const gr = await L.gasReserve();
  check(gr.n >= 0.00002 && gr.n < 0.01, `ETH kept for the network fee: ${gr.text} (gas price x 1M gas, at least 0.00002)`);

  console.log("\n== Get PAPER on mainnet: KyberSwap (a stand-in for its API), checked by the guard");
  {
    const K = await import("../../src/lib/kyber");
    const PAPER = ctx.deployment.inputs.PAPER as Address;
    let rate = 1000n; // PAPER (wei) per ETH (wei)
    const builds: number[] = [];
    kyberMock = (url, init) => {
      const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/routes?")) {
        const amountIn = BigInt(new URL(url).searchParams.get("amountIn")!);
        return json({ data: { routerAddress: K.KYBER_ROUTER, routeSummary: { amountIn: amountIn.toString(), amountOut: (amountIn * rate).toString() } } });
      }
      const b = JSON.parse(String(init?.body));
      builds.push(b.slippageTolerance);
      const amountIn = BigInt(b.routeSummary.amountIn), out = BigInt(b.routeSummary.amountOut);
      const desc = { srcToken: K.NATIVE, dstToken: PAPER, srcReceivers: [], srcAmounts: [], feeReceivers: [], feeAmounts: [], dstReceiver: b.recipient, amount: amountIn,
        minReturnAmount: (out * BigInt(10_000 - b.slippageTolerance)) / 10_000n, flags: 0n, permit: "0x" as Hex };
      const data = encodeFunctionData({ abi: K.kyberRouterAbi, functionName: "swapSimpleMode", args: [K.KYBER_ROUTER, desc, "0x", "0x"] });
      return json({ data: { data, routerAddress: K.KYBER_ROUTER, transactionValue: amountIn.toString() } });
    };
    try {
      const want = 5n * 10n ** 18n;
      const pools = (want + rate - 1n) / rate; // what the pools charge for `want` (the on-chain price it's held to)
      check((await L.quoteKyber("ETH", want, 100)) === undefined, "no pool price to check it against: no KyberSwap route");
      const kq = (await L.quoteKyber("ETH", want, 100, pools))!;
      const expected = BigInt(kq.maxIn) * rate;
      check(kq.via === "kyber" && expected >= want && expected <= (want * 10_101n) / 10_000n && expected >= (want * 10_099n) / 10_000n,
        `routed for about the PAPER asked + 1% (${Number(expected * 10_000n / want) / 100}% of it): room for the price to move`);
      const tx = await L.kyberTx(kq, me);
      const d = (decodeFunctionData({ abi: K.kyberRouterAbi, data: tx.data }).args as unknown as [Address, { minReturnAmount: bigint; amount: bigint }])[1];
      check(d.minReturnAmount >= want && d.minReturnAmount - want < want / 10_000n && d.amount === BigInt(kq.maxIn) && tx.value === BigInt(kq.maxIn) && builds.at(-1) === L.kyberSlipBps(expected, want),
        `the swap passes the guard: minimum return ${d.minReturnAmount} >= the ${want} asked (slippage ${builds.at(-1)} bps, the headroom), spends exactly the quote`);
      // what it did before: a flat 1% tolerance on a route sized at +1% leaves the minimum just under what was asked
      const flat = await K.kyberBuild((await K.kyberRoute("ETH", PAPER, BigInt(kq.maxIn)))!, me, 100);
      let blocked = "";
      try { K.checkSwap(flat, { from: "ETH", to: PAPER, amountIn: BigInt(kq.maxIn), minOut: want, account: me }); } catch (e) { blocked = (e as Error).message; }
      check(/blocked/.test(blocked), `a flat 1% slippage would be refused by the guard ("${blocked}")`);
      rate = 985n; // the price moved 1.5% against the buyer before the click
      let moved = "";
      try { await L.kyberTx(kq, me); } catch (e) { moved = (e as Error).message; }
      check(moved === "Price changed. Try again.", `the price moved past the room: "${moved}", nothing built`);
      rate = 1000n;
      check((await L.quoteKyber("ETH", want, 100, BigInt(kq.maxIn) / 2n)) === undefined, "dearer per PAPER than the pools: not chosen");
      // a lying API: it quotes a different (bigger) amount than asked, so the spend would be its number, not ours
      const honest = kyberMock;
      kyberMock = (url, init) => {
        if (!url.includes("/routes?")) return honest!(url, init);
        const asked = BigInt(new URL(url).searchParams.get("amountIn")!), amountIn = asked * 1000n;
        return new Response(JSON.stringify({ data: { routerAddress: K.KYBER_ROUTER, routeSummary: { amountIn: amountIn.toString(), amountOut: (amountIn * rate).toString() } } }), { status: 200, headers: { "content-type": "application/json" } });
      };
      check((await L.quoteKyber("ETH", want, 100, pools)) === undefined, "the API quotes more than asked (1,000x): refused, it never sets what you spend");
      kyberMock = honest;
      check(L.kyberSlipBps(1010n, 1000n) === 99 && L.kyberSlipBps(1000n, 1000n) === 0 && L.kyberSlipBps(900n, 1000n) === 0, "kyberSlipBps: the headroom, rounded down");
    } finally { kyberMock = null; }
  }

  console.log("\n== errors come back in plain words");
  W.setLocalSigner(privateKeyToAccount(toHex(other.getHdKey().privateKey!)));
  let msg = "";
  try { await L.burnCards({ ids: [cards[8].serial] }, o); } catch (e) { msg = (e as Error).message; }
  check(msg.length > 0 && !/0x[0-9a-f]{8}/i.test(msg), `burning someone else's card is refused before the wallet: "${msg}"`);
  try { await L.openPacks({ fire, n: 1 }, o); msg = ""; } catch (e) { msg = (e as Error).message; }
  check(msg.length > 0, `opening packs you don't have: "${msg}"`);
  W.setLocalSigner(undefined);
  try { await L.burnCards({ ids: [1] }, o); msg = ""; } catch (e) { msg = (e as Error).message; }
  check(/connect/i.test(msg), `no wallet: "${msg}"`);

  console.log(`\n${checks} checks passed. Transactions confirmed: ${steps.length}.`);
  return checks;
}
