// The live chain layer (src/lib/chain) end to end on a local chain (setup.mjs): suggestions (theme + style in one
// transaction) and the owner's picks, the drop's groups (docs/drop-groups.md): buying from Everyone with ETH, PLANK,
// USDG and ETH alone (PAPER burned each time), a free pack from the credit group, the Press group's pack with a Paper
// Press, the after-sell-out group's rising price (and a buy refused when someone else's moved it), the idle end and
// the close by anyone, opening, delivering randomness and dealing, reading the cards, casing and grading (delivered and
// finished), burning, and every read the site uses. Run by run.mjs.

import { concat, encodeFunctionData, erc20Abi, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import type { Net } from "../../src/lib/net";
import { creditsAbi } from "../../src/lib/cards";

type Ctx = {
  RPC: string; deployment: Net["deployment"]; C: Record<string, Address>; start: bigint;
  D: Record<string, { address: Address; abi: unknown[] }>;
  warp: (sec: number) => Promise<void>; now: () => Promise<bigint>;
  tx: (account: unknown, address: Address, abi: unknown[], fn: string, args?: unknown[]) => Promise<{ logs: { topics: Hex[]; data: Hex; address: Address }[] }>;
  asOwner: (to: Address, data: Hex) => Promise<unknown>;
  rpc: (method: string, params?: unknown[]) => Promise<unknown>;
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
  };
  // a browser's localStorage (tx.ts keeps sent transactions there until they land)
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) };
  // every RPC request the layer makes (to check the log scans are incremental)
  const rpcLog: { method: string; params: unknown[] }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
  check(gx.unlimited && gx.name === "After sell-out" && gx.capacity === null && gx.left === null && gx.coins.join() === "ETH" && gx.perTx === 1 && gx.taxBps === 400 && gx.idle === 300 && gx.afterGroup === 1 && gx.opensAt === 0,
    "group 3: After sell-out, no limit, ETH only, 1 per purchase, 4% rising, ends 5 minutes after its last sale, opens when Everyone ends");
  check(gx.next?.usd === "2.60" && gx.next.tax === "0.10" && gx.after.map((x) => x.usd).join() === "2.70,2.81,2.92", `its next packs: $${gx.next?.usd} ($2.50 + $${gx.next?.tax} tax), then ${gx.after.map((x) => "$" + x.usd).join(", ")}`);
  check(s.creditGroup === 1 && s.status.left === null && !s.closing, "free packs come from Everyone; with an unlimited group ahead, no end to what can sell");
  check(s.cards.cardsPerPack === 6 && s.cards.characters === 3, `${s.cards.cardsPerPack} cards a pack, ${s.cards.characters} characters`);

  console.log("\n== suggestions: theme + art style in one transaction, then the owner picks");
  const rules = await L.suggestionRules();
  check(rules.many && rules.perTx === 3 && rules.paperEach.text === "1", `suggestMany is there (up to ${rules.perTx} per transaction), ${rules.paperEach.text} PAPER each`);
  const paperBefore = BigInt((await L.balances(me)).PAPER!.raw);
  const sg = await L.suggest({ texts: ["Theme: Haunted diner", "Art style: Old woodcut print"] }, o);
  check(sg.receipts.length === 1 && !sg.oneByOne, "both sent in one transaction (suggestMany)");
  check(paperBefore - BigInt((await L.balances(me)).PAPER!.raw) === 2n * 10n ** 18n, "2 PAPER burned (1 each)");
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
    "live: the Press and Everyone groups are open (the Press for an hour); After sell-out waits");
  const q = await L.quoteGroup(fire, 1, 2);
  check(q.quotes.length === 3 && q.quotes.every((x) => x.available) && q.paper.text === "2" && q.usd === "5.00" && q.tax === "0.00", `quotes for 2 Everyone packs ($${q.usd}): ${q.quotes.map((x) => `${x.cost?.text} ${x.pay}`).join(", ")} + ${q.paper.text} PAPER`);
  check(q.ethAlone && q.paperEth != null && BigInt(q.paperEth.raw) > 0n, `ETH alone: the 2 PAPER cost ${q.paperEth?.text} ETH on the market`);
  const paperHeld = BigInt((await L.balances(me)).PAPER!.raw);
  const qe = q.quotes.find((x) => x.pay === "ETH")!;
  await L.buyPacks({ fire, group: 1, n: 2, pay: "ETH", paperInEth: true, quote: { cost: qe.cost!.raw, paperEth: q.paperEth!.raw } }, o);
  check(BigInt((await L.balances(me)).PAPER!.raw) === paperHeld, "2 packs with ETH alone (buyWithEthAll): the sale bought and burned their PAPER, none of the wallet's own");
  await L.buyPacks({ fire, group: 1, n: 1, pay: "ETH" }, o);
  await L.buyPacks({ fire, group: 1, n: 1, pay: "PLANK" }, o);
  await L.buyPacks({ fire, group: 1, n: 1, pay: "USDG" }, o);
  check((await L.myGroupStanding(fire, me)).bought.join() === "0,5,0", "5 packs from Everyone (2 ETH alone, 1 ETH, 1 PLANK, 1 USDG), each step approved and confirmed");
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
  check(s.groups[2].state === "upcoming" && s.state === "live", "After sell-out still waits; the Series is still on sale");

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
    "the Press and Everyone have ended; After sell-out is open; the Series stays open (no limit)");

  console.log("\n== After sell-out: 2 extra packs, the price rising 4% each");
  const t1 = await L.quoteGroup(fire, 2, 1);
  check(t1.quotes.map((x) => x.pay).join() === "ETH" && t1.usd === "2.60" && t1.tax === "0.10", `extra pack #1: $${t1.usd} ($2.50 + $${t1.tax} tax), ETH only`);
  let txMsg = "";
  try { await L.buyPacks({ fire, group: 2, n: 2, pay: "ETH" }, o); } catch (e) { txMsg = (e as Error).message; }
  check(/one purchase/.test(txMsg), `2 at once is refused (1 per purchase): "${txMsg}"`);
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
  check(s.groups[2].state === "ended" && s.status.left === 0 && s.closing && s.state === "live" && !s.cards.closed, "5 quiet minutes: After sell-out ended, nothing left, \"Closing…\" (not closed yet)");
  W.setLocalSigner(privateKeyToAccount(toHex(other.getHdKey().privateKey!)));
  await L.closeDrop({ fire }, o);
  W.setLocalSigner(buyer);
  s = (await L.currentSeries())!;
  check(s.state === "closed" && s.cards.closed && s.cards.packs === 9 && !s.closing, "closed by another wallet: 9 packs (6 Everyone + 1 Press + 2 extra)");
  check(JSON.stringify(await L.packsOf(me)) === JSON.stringify([{ fire: 7, count: 9 }]), "9 sealed packs held");

  console.log("\n== open, deliver randomness, deal");
  const op = await L.openPacks({ fire, n: 9 }, o);
  check(op.index === 0, "opened 9 packs (open #0)");
  let opens = await L.opensOf(me);
  check(opens.length === 1 && opens[0].status === "waiting" && opens[0].round !== null, `waiting for drand round ${opens[0].round}`);
  const st0 = await L.openStatus(fire, op.index);
  check(st0.status === "waiting" && st0.round === opens[0].round && st0.now < st0.roundAt!, "openStatus (by index, no log scan) agrees: waiting, with the round and the chain's clock");
  check((await L.deliverAndDeal({ fire, index: op.index }, o)).delivered === 0, "before the round is out: nothing delivered");
  await ctx.warp(100);
  opens = await L.opensOf(me);
  check(opens[0].status === "deliverable" && (await L.openStatus(fire, op.index)).status === "deliverable", "the round is out: deliverable");
  const sent0 = steps.length;
  const dd = await L.deliverAndDeal({ fire, index: op.index }, o);
  check(dd.delivered === 1 && dd.dealt && dd.reached && !dd.keeper, "delivered (the router took the signature) and dealt the buyer's open");
  check(steps.length - sent0 === 2 && steps.slice(sent0).join(" / ") === "Deliver the draw / Deal the cards", `in exactly 2 transactions: ${steps.slice(sent0).join(" / ")}`);
  check((await L.opensOf(me))[0].status === "dealt" && (await L.openStatus(fire, op.index)).status === "dealt", "the open reads as dealt");

  console.log("\n== cards");
  const cards = await L.cardsOf(me);
  check(cards.length === 54, "54 cards found by scanning the chain (no explorer on a local chain)");
  const c0 = cards[0];
  check(c0.name.includes(c0.character) && c0.image.startsWith("ipfs://") && c0.image.endsWith("-u.webp") && c0.grade === null && !c0.cased, `a card: "${c0.name}", ${c0.material}, holo ${c0.holo}, image ${c0.image.split("/").pop()}`);
  check(["Character", "Category", "Material", "Holo", "Series", "Edition", "PDA"].every((k) => k in c0.traits), "its traits are the metadata's");

  console.log("\n== case one card, grade two");
  const pr = await L.psaPrices();
  check(pr.caseUsd === "0.05" && pr.gradeUsd === "1.00" && pr.maxBatch === 20, `prices: case $${pr.caseUsd}, grade $${pr.gradeUsd}, up to ${pr.maxBatch} cards`);
  const pq2 = await L.quoteProtect(1, 2, "ETH");
  check(BigInt(pq2.raw) > 0n, `1 case + 2 grades = ${pq2.text} ETH`);
  const [ca, g1, g2] = [cards[1].serial, cards[2].serial, cards[3].serial];
  const pt = await L.protect({ caseIds: [ca], gradeIds: [g1, g2], pay: "ETH", quote: pq2.raw }, o);
  check(pt.gradingIndex === 0, "cased and sent for grading in one transaction (grading #0), capped at the price shown");
  check((await L.card(ca)).cased && (await L.card(g1)).gradePending, "the case shows; the graded cards are pending (they can't move)");
  check((await L.gradingsOf(me))[0].status === "waiting" && (await L.gradingStatus(0)).status === "waiting", "grading waits for its round");
  check((await L.gradingIds(0, [g1, g2])).join() === [g1, g2].join() && (await L.gradingIds(0)).join() === [g1, g2].join(), "the grading's card list: the page's own (checked against idsHash) or from its event");
  await ctx.warp(100);
  check(await L.deliverAndFinish({ index: 0, ids: [g1, g2] }, o), "delivered and finished: grades set");
  const [x1, x2] = [await L.card(g1), await L.card(g2)];
  check(x1.grade !== null && x2.grade !== null && !x1.gradePending && x1.image.endsWith(`-${x1.grade}.webp`), `grades: PDA ${x1.grade} and PDA ${x2.grade}; the image is the slab's`);
  check((await L.gradingsOf(me))[0].status === "done", "grading reads as done");
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
