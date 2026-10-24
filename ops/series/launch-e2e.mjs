// End-to-end test of ops/series/launch.mjs on a local anvil chain: the rehearsal's setup (DevStack stand-ins, the real
// deploy scripts recorded with ops/deploy/record.mjs, the owner accepting), then launch.mjs for the studio-format
// recipe (contracts/test/cards/recipe-studio-sale.json: the Standard preset's four groups, scaled to 5 packs; its PLANK
// group a snapshot group described in the side file fire-7-snapshots.json) run as the owner would, key mode:
//   1. the wrong chain: STOP in preflight, nothing sent
//   2. an image missing on both gateways: the snapshot group's snapshot (allowance tiers), fork rehearsal, batch A sent,
//      VerifySeries RED -> STOP (between A and B)
//   3. the image re-pinned, LOCK answered "no": GREEN, then STOP at the question, batch B not sent
//   4. run again: batch A not re-sent (judged by the chain), GREEN, LOCK, batch B (GROUP_ROOT_1 from the snapshot), the
//      drop and its groups read back, the site's holders file written
//   5. the state file deleted, run again: "already locked", nothing sent, the holders file left alone
//   6. the drop opens: a holder buys in the snapshot group with the allowance and proof from the holders file
//   7. through the groups: Everyone sells out but stays open while press packs may still roll in; the press group's
//      6 hours run out, its packs roll into Everyone and sell; the unlimited group opens, sells one pack, idles out;
//      the keeper's drops job sees nothing can still sell and closes the Series (FireSale.close)
//
//   cd ops; npm ci; cd snapshot; npm ci; cd ..
//   node series/launch-e2e.mjs
// Needs forge and anvil (PATH or ~/.foundry/bin). Output in ops/series/out/e2e/.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, parseEther, getAddress, toHex, parseEventLogs } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { gatewayServer } from "../rehearsal/servers.mjs";
import { record } from "../deploy/record.mjs";
import { allImageNames, recipeFromJson, recipeHash } from "./verify-series.mjs";
import { batchACalls } from "./launch.mjs";
import { saleAbi, groupsAbi, PAY } from "./sale-abi.mjs";
import { verify as verifyProof } from "../snapshot/merkle.mjs";
import { createKeeper } from "../keeper/src/core.mjs";
import { loadConfig } from "../keeper/src/config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const CONTRACTS = resolve(REPO, "contracts");
const OUT = resolve(here, "out/e2e");
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const DEP_FILE = resolve(REPO, "deployments", "rehearsal-launch.json");
const RECIPE_PATH = resolve(CONTRACTS, "series", "rehearsal-launch-fire-7.json");
const SNAP_PATH = resolve(CONTRACTS, "series", "fire-7-group-1.json");
const SIDE_PATH = resolve(CONTRACTS, "series", "fire-7-snapshots.json");
const HOLDERS_OUT = resolve(OUT, "holders-series-7.json");
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const bin = (n) => { for (const d of [resolve(homedir(), ".foundry/bin"), "/root/.foundry/bin"]) if (existsSync(resolve(d, n))) return resolve(d, n); return n; };
const SOLC = [resolve(homedir(), ".foundry/solc/solc-0.8.28")].find(existsSync);
const MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public test accounts
const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const deployer = acct(0);
const owner = acct(6); // the owner: an anvil account whose key the test hands launch.mjs in an env var (key mode)
const OWNER_KEY = toHex(owner.getHdKey().privateKey);

const t0 = Date.now();
const say = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const fail = (m) => { throw new Error(m); };
const check = (cond, what) => { if (!cond) fail(`CHECK FAILED: ${what}`); say(`ok: ${what}`); };

const pub = createPublicClient({ transport: http(RPC), pollingInterval: 100 });
const rpc = (method, params = []) => pub.request({ method, params });
let chain;

function forge(script, env, sender = deployer.address) {
  const argv = ["script", script, "--rpc-url", RPC, "--unlocked", "--sender", sender, "--broadcast", "--slow", "--offline", ...(SOLC ? ["--use", SOLC] : [])];
  try {
    return execFileSync(bin("forge"), argv, {
      cwd: CONTRACTS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
      env: { ...process.env, DEPLOYMENTS_FILE: DEP_FILE, EXPECTED_CHAIN_ID: "31337", FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
    });
  } catch (e) {
    console.error(String(e.stdout ?? "").slice(-3000), String(e.stderr ?? "").slice(-3000));
    throw new Error(`${script} failed`);
  }
}
async function forgeDeploy(script, env) {
  forge(script, env);
  const r = await record({ client: pub, file: DEP_FILE, broadcastDir: resolve(CONTRACTS, "broadcast"), log: () => {} });
  if (!r.ok) fail(`record after ${script}: ${r.problems.join("; ")}`);
  say(`deployed and recorded ${script}`);
}

/** Runs launch.mjs as the owner would; `input` is typed at the LOCK question. Returns { code, out }. */
function launch(extra, { input } = {}) {
  const argv = [resolve(here, "launch.mjs"), "--recipe", RECIPE_PATH, "--chain", "31337", "--key-env", "OWNER_TEST_KEY",
    "--gateways", gateways.join(","), "--verify-tries", "2", "--verify-wait", "1", "--out-dir", OUT, "--snapshot-days", "0.02", "--holders-out", HOLDERS_OUT, ...extra];
  return new Promise((res) => {
    const p = spawn(process.execPath, argv, {
      cwd: REPO, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RPC, DEPLOYMENTS_FILE: DEP_FILE, OWNER_TEST_KEY: OWNER_KEY, LAUNCH_FORGE_ARGS: `--offline${SOLC ? ` --use ${SOLC}` : ""}` },
    });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    if (input !== undefined) p.stdin.write(`${input}\n`);
    p.stdin.end();
    p.on("close", (code) => {
      console.log(out.split("\n").map((l) => `    | ${l}`).join("\n"));
      res({ code, out });
    });
  });
}

let gateways;
let anvil;
async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of [DEP_FILE, `${DEP_FILE}.pending`, RECIPE_PATH, SNAP_PATH, SIDE_PATH, HOLDERS_OUT, resolve(OUT, "series-7.31337.state.json"), resolve(OUT, "series-7.31337.log")]) rmSync(f, { force: true });
  anvil = spawn(bin("anvil"), ["--port", String(PORT), "--silent", "--chain-id", "31337"], { stdio: "ignore" });
  for (let i = 0; ; i++) { try { await pub.getChainId(); break; } catch { if (i > 100) fail("anvil didn't start"); await new Promise((r) => setTimeout(r, 200)); } }
  chain = { id: 31337, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
  const wallet = (a) => createWalletClient({ account: a, chain, transport: http(RPC) });

  say("setup: DevStack stand-ins, DeployTwap, DeployInfra, DeployCards (recorded), the owner accepts");
  await forgeDeploy("script/DevStack.s.sol", {});
  const inputs = JSON.parse(readFileSync(DEP_FILE, "utf8")).inputs;
  const env = {
    ...inputs, OWNER: owner.address, ROYALTY_RECEIVER: acct(2).address, ROYALTY_BPS: "500", REVENUE_WALLET: acct(1).address,
    PACK_IMAGE_BASE: `ipfs://${CID}/`,
  };
  await forgeDeploy("script/DeployTwap.s.sol", env);
  await forgeDeploy("script/DeployInfra.s.sol", env);
  await forgeDeploy("script/DeployCards.s.sol", env);
  forge("script/AcceptOwnership.s.sol", {}, owner.address); // anvil's accounts are unlocked: the owner signs
  const C = Object.fromEntries(Object.entries(JSON.parse(readFileSync(DEP_FILE, "utf8")).contracts).map(([k, v]) => [k, getAddress(v)]));

  say("two PLANK holders for the snapshot ($100 and $500, holding all through its window); keeper stand-in: 31 minutes on, the PLANK feed checkpointed");
  const twapAbi = [{ type: "function", name: "checkpoint", inputs: [], outputs: [], stateMutability: "nonpayable" }];
  const mintAbi = [{ type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" }];
  for (const [a, n] of [[acct(3), 100n], [acct(4), 500n]]) {
    await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: inputs.PLANK, abi: mintAbi, functionName: "mint", args: [a.address, n * 10n ** 27n] }) });
  }
  await rpc("evm_increaseTime", [toHex(31n * 60n)]);
  await rpc("evm_mine");
  await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: C.PlankUsdTwap, abi: twapAbi, functionName: "checkpoint" }) });
  await rpc("anvil_setBalance", [owner.address, toHex(parseEther("10"))]);

  // the studio-format recipe (the Standard preset scaled small: 2 press packs, 2 for PLANK holders, 1 for everyone,
  // then the unlimited group), with real-looking images; its snapshot group in the side file; two local gateways
  const recipe = JSON.parse(readFileSync(resolve(CONTRACTS, "test/cards/recipe-studio-sale.json"), "utf8"));
  recipe.imagesBase = `ipfs://${CID}/`;
  const scaled = [2, 2, 1];
  recipe.sale.groups.forEach((g, i) => { if (!g.unlimited) g.packs = scaled[i]; });
  recipe.sale.packs = scaled.reduce((a, b) => a + b, 0);
  recipe.sale.creditPacksMax = 1;
  check(recipe.sale.groups[1].gate === "snapshot" && recipe.sale.groups[0].nft === "press" && recipe.sale.groups[3].unlimited, "the studio's Standard groups: press, PLANK snapshot, everyone, after sell-out");
  writeFileSync(RECIPE_PATH, JSON.stringify(recipe, null, 1));
  writeFileSync(SIDE_PATH, JSON.stringify({ 1: { token: "plank", minUsd: 69, tiers: "69:1,300:2" } }, null, 1));
  const names = allImageNames(recipeFromJson(recipe), recipe.characters.length);
  const manifest = () => ({ fire: 7, recipeHash: recipeHash(recipe), files: names.map((name) => ({ name })) });
  let missing = "c1-coal-full-7.webp";
  check(names.includes(missing), `${names.length} images; ${missing} is one of them`);
  const gwA = await gatewayServer({ manifest, has: (n) => n !== missing });
  const gwB = await gatewayServer({ manifest, has: (n) => n !== missing });
  gateways = [gwA.url, gwB.url];

  const now = (await pub.getBlock()).timestamp;
  const startTs = now + 3n * 3600n;
  const d = new Date(Number(startTs) * 1000);
  const p2 = (x) => String(x).padStart(2, "0");
  const startLocal = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const startUnix = startTs - BigInt(d.getSeconds());
  const nonce = () => pub.getTransactionCount({ address: owner.address });

  say("1. the wrong chain");
  let r = await launch(["--start", startLocal, "--chain", "46630"]);
  check(r.code === 1 && /STOP .*not 46630/.test(r.out), "STOP: the RPC isn't the chain asked for");

  say("2. an image missing on both gateways: batch A goes out, VerifySeries RED, STOP before batch B");
  let n0 = await nonce();
  r = await launch(["--start", startLocal]);
  check(r.code === 1, "exit code 1");
  check(/OK +group 2 \(PLANK holders\): 2 wallets hold \$69\+ of PLANK \(3 packs of allowance\)/.test(r.out) && existsSync(SNAP_PATH), "the snapshot group's snapshot was taken (tiers: $500 = 2 packs) and saved next to the recipe");
  check(/OK +Batch A \(\d+ calls\) and batch B \(configureDrop\) pass as the owner/.test(r.out), "the fork rehearsal passed");
  check(/OK +Batch A is on chain/.test(r.out), "batch A sent");
  check(/RED .*c1-coal-full-7\.webp/.test(r.out) && /STOP +VerifySeries is RED after 2 tries/.test(r.out), "STOP on RED, naming the missing image");
  const sentA = (await nonce()) - n0;
  check(sentA === batchACalls(recipe), `${sentA} transactions from the owner (batch A only)`);
  let drop = await pub.readContract({ address: C.FireSale, abi: saleAbi, functionName: "dropOf", args: [7n] });
  check(drop.start === 0n, "no drop configured");

  say("3. the image re-pinned; the owner answers 'no' at the LOCK question");
  missing = undefined;
  n0 = await nonce();
  r = await launch([], { input: "no" });
  check(r.code === 1 && /Type LOCK to continue/.test(r.out) && /STOP +Not locked/.test(r.out), "STOP: not locked without LOCK");
  check(/OK +Batch A is already on chain exactly as the recipe says: not sent again/.test(r.out), "batch A not re-sent");
  check(/OK +group 2 \(PLANK holders\): using the snapshot taken/.test(r.out) && /OK +Passed before/.test(r.out), "the snapshot and the rehearsal reused (start from the state file)");
  check(/Group 2 "PLANK holders":/.test(r.out) && /Leftovers:  to group 3 \(Everyone\)/.test(r.out) && /rising 4% a pack/.test(r.out), "the LOCK screen lists every group in plain words");
  check(/OK +GREEN/.test(r.out), "VerifySeries GREEN");
  check((await nonce()) === n0, "nothing sent");

  say("4. run again and type LOCK: batch B, the drop read back");
  r = await launch([], { input: "LOCK" });
  check(r.code === 0, "exit code 0");
  check(/OK +GREEN before/.test(r.out), "VerifySeries not re-run (GREEN for this plan)");
  check((await nonce()) === n0 + 1, "exactly one transaction: configureDrop");
  drop = await pub.readContract({ address: C.FireSale, abi: saleAbi, functionName: "dropOf", args: [7n] });
  const views = await pub.readContract({ address: C.FireGroups, abi: groupsAbi, functionName: "groupsOf", args: [7n] });
  const snap = JSON.parse(readFileSync(SNAP_PATH, "utf8"));
  check(drop.start === startUnix && drop.packs === 5n && views.length === 4 && views[1].config.root === snap.root && views[1].config.root !== recipe.sale.groups[1].root
    && getAddress(views[0].config.nft) === getAddress(inputs.MILL) && views[2].config.priceUsd === 250000000n && views[3].config.taxBps === 400
    && views[2].config.perWallet === 5 && views[2].config.limitFor === 86400 && views[1].config.limitFor === 0 && views[0].config.limitFor === 0,
    `the drop: start ${drop.start}, 5 packs in 4 groups, the snapshot's root (not the recipe's placeholder) on group 2, the Paper Press on group 1, Everyone 5 per wallet for its first 24 h`);
  check(/OK +FireSale's drop for Series 7: .*every field as meant/.test(r.out) && /7  Done/.test(r.out), "read back OK and done");
  const holders = JSON.parse(readFileSync(HOLDERS_OUT, "utf8"));
  const h4 = holders.groups?.["1"]?.wallets?.[acct(4).address.toLowerCase()];
  check(holders.series === 7 && holders.groups["1"].root === snap.root && Object.keys(holders.groups).join() === "1" && h4?.allowance === 2
    && verifyProof(h4.proof, holders.groups["1"].root, acct(4).address, h4.allowance), "the site's holders file: the snapshot group (index 1)'s root, each wallet's allowance and a proof that verifies");

  say("5. the state file deleted, run again: the chain says it's launched, nothing sent");
  rmSync(resolve(OUT, "series-7.31337.state.json"));
  n0 = await nonce();
  r = await launch(["--yes"]);
  check(r.code === 0 && /already locked with a drop/.test(r.out), "already launched");
  check((await nonce()) === n0, "nothing sent");
  check(/WARN +No snapshot files in the state file/.test(r.out) && JSON.parse(readFileSync(HOLDERS_OUT, "utf8")).updated === holders.updated, "the holders file left as it was");

  say("6. the drop opens: the $500 holder buys its 2 packs in the snapshot group with the holders file's allowance and proof");
  // the keeper stand-in: PLANK checkpoints 32 minutes before the start and at it (the sale takes a price window of 2 h at most)
  for (const t of [startUnix - 1920n, startUnix]) {
    await rpc("evm_setNextBlockTimestamp", [toHex(t)]);
    await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: C.PlankUsdTwap, abi: twapAbi, functionName: "checkpoint" }) });
  }
  const buyer = acct(4);
  await rpc("anvil_setBalance", [buyer.address, toHex(parseEther("10"))]);
  const [cost, paperWei] = await pub.readContract({ address: C.FireSale, abi: saleAbi, functionName: "quote", args: [7n, 1n, 2n, PAY.PLANK] });
  const erc20 = [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }];
  await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: inputs.PAPER, abi: mintAbi, functionName: "mint", args: [buyer.address, paperWei] }) });
  const most = (cost * 101n) / 100n; // the most PLANK agreed to (a checkpoint in the buy may move the price a little)
  for (const [token, amount] of [[inputs.PAPER, paperWei], [inputs.PLANK, most]]) {
    await pub.waitForTransactionReceipt({ hash: await wallet(buyer).writeContract({ address: token, abi: erc20, functionName: "approve", args: [C.FireSale, amount] }) });
  }
  const access = { nftIds: [], allowance: BigInt(h4.allowance), proof: h4.proof };
  const rc = await pub.waitForTransactionReceipt({ hash: await wallet(buyer).writeContract({ address: C.FireSale, abi: saleAbi, functionName: "buy", args: [7n, 1n, 2n, PAY.PLANK, most, paperWei, access] }) });
  const bought = parseEventLogs({ abi: saleAbi, logs: rc.logs, eventName: "PacksBought" });
  check(rc.status === "success" && bought.length === 1 && bought[0].args.group === 1n && bought[0].args.count === 2n && getAddress(bought[0].args.buyer) === buyer.address,
    "PacksBought: 2 packs in group index 1 (PLANK holders), paid in PLANK, with the proof from the site's holders file");

  say("7. through the groups to the end: Everyone, the press leftovers, the unlimited group idling out, the keeper closing the Series");
  const status = () => pub.readContract({ address: C.FireSale, abi: saleAbi, functionName: "status", args: [7n] });
  const groupsNow = () => pub.readContract({ address: C.FireGroups, abi: groupsAbi, functionName: "groupsOf", args: [7n] });
  const other = acct(3);
  await rpc("anvil_setBalance", [other.address, toHex(parseEther("10"))]);
  const buyEth = async (b, group, n) => {
    const [c, pw] = await pub.readContract({ address: C.FireSale, abi: saleAbi, functionName: "quote", args: [7n, group, n, PAY.ETH] });
    await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: inputs.PAPER, abi: mintAbi, functionName: "mint", args: [b.address, pw] }) });
    await pub.waitForTransactionReceipt({ hash: await wallet(b).writeContract({ address: inputs.PAPER, abi: erc20, functionName: "approve", args: [C.FireSale, pw] }) });
    const m = (c * 101n) / 100n;
    const x = await pub.waitForTransactionReceipt({ hash: await wallet(b).writeContract({ address: C.FireSale, abi: saleAbi, functionName: "buy", args: [7n, group, n, PAY.ETH, m, pw, { nftIds: [], allowance: 0n, proof: [] }], value: m }) });
    if (x.status !== "success") fail(`buy in group ${group} reverted`);
  };
  let gs = await groupsNow();
  check(gs[1].state === 2 && gs[2].state === 1, "the PLANK group sold out and ended; Everyone opened");
  check(gs[2].opensAt !== 0n && gs[2].limitUntil === gs[2].opensAt + 86400n, "Everyone's per-wallet limit lifts 24 h after it opened (groupsOf.limitUntil)");
  await buyEth(other, 2n, 1n);
  gs = await groupsNow();
  let st = await status();
  check(gs[2].state === 1 && gs[2].left === 0n && gs[0].left === 2n && gs[3].state === 0 && st.left === 2n ** 256n - 1n,
    "Everyone sold out but stays open with 0 left: the press group's 2 packs may still roll in; the unlimited group waits (status.left: no limit while it's yet to open)");
  await rpc("evm_increaseTime", [toHex(6n * 3600n)]);
  await rpc("evm_mine");
  gs = await groupsNow();
  check(gs[0].state === 2 && gs[2].left === 2n, "the press group's 6 hours ran out unclaimed: its 2 packs rolled into Everyone");
  await buyEth(other, 2n, 2n);
  gs = await groupsNow();
  st = await status();
  check(gs[2].state === 2 && gs[3].state === 1 && st.left === 2n ** 256n - 1n, "Everyone sold the leftovers and ended; the unlimited group is open (status.left: no limit)");
  await buyEth(other, 3n, 1n);
  await rpc("evm_increaseTime", [toHex(901n)]);
  await rpc("evm_mine");
  st = await status();
  check(st.left === 0n && !st.closed, "15 minutes without a sale: the unlimited group idled out; nothing can still sell (status.left 0), not closed yet");
  const keeperAcct = acct(8);
  await rpc("anvil_setBalance", [keeperAcct.address, toHex(parseEther("1"))]);
  const kcfg = loadConfig({ RPC_URL: RPC, FALLBACK_RPC_URL: "none", CHAIN_ID: "31337", DEPLOYMENTS_FILE: DEP_FILE, SERIES: "7" });
  const keeper = createKeeper({ cfg: kcfg, pub, wallet: wallet(keeperAcct), account: keeperAcct, log: (...a) => say(`  [keeper] ${a.join(" ")}`) });
  const kr = await keeper.jobs.drops((await pub.getBlock()).timestamp);
  const fires = await pub.readContract({ address: C.FireCards, abi: [{ type: "function", name: "fires", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }, { type: "bool" }, { type: "bool" }, { type: "uint32" }, { type: "uint64" }, { type: "uint64" }], stateMutability: "view" }], functionName: "fires", args: [7n] });
  check(kr.events.some((e) => /this keeper closed it/.test(e.text)) && fires[1] === true && fires[4] === 6n, "the keeper closed the Series: 6 packs (the 5-pack base + 1 after sell-out)");

  const log = readFileSync(resolve(OUT, "series-7.31337.log"), "utf8");
  check(!log.includes(OWNER_KEY.slice(2)) && !log.includes(RPC), "the log holds neither the key nor the RPC URL");
  for (const s of [gwA, gwB]) await s.close();
  console.log(`\nLAUNCH TEST PASSED in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

try {
  await main();
} catch (e) {
  console.error(`\nLAUNCH TEST FAILED: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  anvil?.kill();
  for (const f of [RECIPE_PATH, SNAP_PATH, SIDE_PATH]) rmSync(f, { force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
