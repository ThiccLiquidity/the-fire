// The live chain layer (src/lib/chain) end to end on a local chain (setup.mjs): suggestions (theme + style in one
// transaction) and the owner's picks, buying with ETH, PLANK and USDG (PAPER burned each time), a press pack, a free
// pack from a picked suggestion, the drop selling out, opening, delivering randomness and dealing, reading the cards,
// casing and grading (delivered and finished), burning, and every read the site uses. Run by run.mjs.

import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import type { Net } from "../../src/lib/net";
import { creditsAbi } from "../../src/lib/cards";

type Ctx = {
  RPC: string; deployment: Net["deployment"]; C: Record<string, Address>; start: bigint;
  D: Record<string, { address: Address; abi: unknown[] }>;
  warp: (sec: number) => Promise<void>; now: () => Promise<bigint>;
  tx: (account: unknown, address: Address, abi: unknown[], fn: string, args?: unknown[]) => Promise<{ logs: { topics: Hex[]; data: Hex; address: Address }[] }>;
  asOwner: (to: Address, data: Hex) => Promise<unknown>;
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
  const W = await import("../../src/lib/wallet");
  const L = await import("../../src/lib/chain");
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

  console.log("\n== the Series before it opens");
  check(JSON.stringify(await L.seriesNumbers()) === "[7]", "Series list from DropConfigured: [7]");
  let s = (await L.currentSeries())!;
  check(s.fire === fire && s.state === "upcoming" && s.packs === 6 && s.pressPacks === 1, `current Series 7: upcoming, 6 paid + 1 press pack, $${s.priceUsd} a pack, PAPER ${s.paperPerPack.text} a pack`);
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

  console.log("\n== the drop opens: buy with ETH, PLANK and USDG; a press pack; a free pack");
  await ctx.warp(Number(ctx.start - (await ctx.now())) + 1);
  s = (await L.currentSeries())!;
  check(s.state === "live" && s.phase.paidLeft === 6 && s.phase.pressOpen, "live: 6 paid packs left, press packs open");
  const q = await L.quotePacks(fire, 2);
  check(q.length === 3 && q.every((x) => x.available) && q[0].paper.text === "2", `quotes for 2 packs: ${q.map((x) => `${x.cost?.text} ${x.pay}`).join(", ")} + ${q[0].paper.text} PAPER`);
  check(q[1].pay === "ETH" && q[1].paperEth != null && BigInt(q[1].paperEth.raw) > 0n, `ETH alone: the 2 PAPER cost ${q[1].paperEth?.text} ETH on the market`);
  const paperHeld = BigInt((await L.balances(me)).PAPER!.raw);
  await L.buyPacks({ fire, n: 2, pay: "ETH", paperInEth: true }, o);
  check(BigInt((await L.balances(me)).PAPER!.raw) === paperHeld, "2 packs with ETH alone (buyWithEthAll): the sale bought and burned their PAPER, none of the wallet's own");
  await L.buyPacks({ fire, n: 2, pay: "PLANK" }, o);
  await L.buyPacks({ fire, n: 1, pay: "USDG" }, o);
  check((await L.walletInDrop(fire, me)).paidBought === 5, "5 paid packs bought (2 ETH alone, 2 PLANK, 1 USDG), each step approved and confirmed");
  const pq = await L.quotePress(fire, 1, "ETH");
  check(pq.cost.raw === "0" && pq.paper.text === "1", "press pack: no dollar price, 1 PAPER");
  await L.claimPressPacks({ fire, pressId, n: 1, pay: "ETH" }, o);
  await L.spendCredits({ fire, n: 1 }, o);
  s = (await L.currentSeries())!;
  check(s.state === "closed" && s.cards.closed && s.cards.packs === 7, "sold out: 5 paid + 1 credit + 1 press pack; the drop and the Series closed (7 packs)");
  check(JSON.stringify(await L.packsOf(me)) === JSON.stringify([{ fire: 7, count: 7 }]), "7 sealed packs held");

  console.log("\n== open, deliver randomness, deal");
  const op = await L.openPacks({ fire, n: 7 }, o);
  check(op.index === 0, "opened 7 packs (open #0)");
  let opens = await L.opensOf(me);
  check(opens.length === 1 && opens[0].status === "waiting" && opens[0].round !== null, `waiting for drand round ${opens[0].round}`);
  check((await L.deliverAndDeal({ fire }, o)).delivered === 0, "before the round is out: nothing delivered");
  await ctx.warp(100);
  opens = await L.opensOf(me);
  check(opens[0].status === "deliverable", "the round is out: deliverable");
  const dd = await L.deliverAndDeal({ fire, maxCards: 30 }, o);
  check(dd.delivered === 1 && dd.dealt, "delivered (the router took the signature) and dealt in steps of 30 cards");
  check((await L.opensOf(me))[0].status === "dealt", "the open reads as dealt");

  console.log("\n== cards");
  const cards = await L.cardsOf(me);
  check(cards.length === 42, "42 cards found by scanning the chain (no explorer on a local chain)");
  const c0 = cards[0];
  check(c0.name.includes(c0.character) && c0.image.startsWith("ipfs://") && c0.image.endsWith("-u.webp") && c0.grade === null && !c0.cased, `a card: "${c0.name}", ${c0.material}, holo ${c0.holo}, image ${c0.image.split("/").pop()}`);
  check(["Character", "Category", "Material", "Holo", "Series", "Edition", "PDA"].every((k) => k in c0.traits), "its traits are the metadata's");

  console.log("\n== case one card, grade two");
  const pr = await L.psaPrices();
  check(pr.caseUsd === "0.05" && pr.gradeUsd === "1.00" && pr.maxBatch === 20, `prices: case $${pr.caseUsd}, grade $${pr.gradeUsd}, up to ${pr.maxBatch} cards`);
  const pq2 = await L.quoteProtect(1, 2, "ETH");
  check(BigInt(pq2.raw) > 0n, `1 case + 2 grades = ${pq2.text} ETH`);
  const [ca, g1, g2] = [cards[1].serial, cards[2].serial, cards[3].serial];
  const pt = await L.protect({ caseIds: [ca], gradeIds: [g1, g2], pay: "ETH" }, o);
  check(pt.gradingIndex === 0, "cased and sent for grading in one transaction (grading #0)");
  check((await L.card(ca)).cased && (await L.card(g1)).gradePending, "the case shows; the graded cards are pending (they can't move)");
  check((await L.gradingsOf(me))[0].status === "waiting", "grading waits for its round");
  await ctx.warp(100);
  check(await L.deliverAndFinish({ index: 0 }, o), "delivered and finished: grades set");
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
  check((await L.cardsOf(me)).length === 39, "39 cards left");

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
