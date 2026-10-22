// End-to-end test of ops/series/launch.mjs on a local anvil chain: the rehearsal's setup (DevStack stand-ins, the real
// deploy scripts recorded with ops/deploy/record.mjs, the owner accepting), then launch.mjs for the studio-format
// recipe (contracts/test/cards/recipe-studio-sale.json, with a holder window) run as the owner would, key mode:
//   1. the wrong chain: STOP in preflight, nothing sent
//   2. an image missing on both gateways: snapshot, fork rehearsal, batch A sent, VerifySeries RED -> STOP (between A and B)
//   3. the image re-pinned, LOCK answered "no": GREEN, then STOP at the question, batch B not sent
//   4. run again: batch A not re-sent (judged by the chain), GREEN, LOCK, batch B, the drop read back
//   5. the state file deleted, run again: "already locked", nothing sent
//
//   cd ops; npm ci; cd snapshot; npm ci; cd ..
//   node series/launch-e2e.mjs
// Needs forge and anvil (PATH or ~/.foundry/bin). Output in ops/series/out/e2e/.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, parseEther, getAddress, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { gatewayServer } from "../rehearsal/servers.mjs";
import { record } from "../deploy/record.mjs";
import { allImageNames, recipeFromJson, recipeHash } from "./verify-series.mjs";
import { batchACalls } from "./launch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const CONTRACTS = resolve(REPO, "contracts");
const OUT = resolve(here, "out/e2e");
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const DEP_FILE = resolve(REPO, "deployments", "rehearsal-launch.json");
const RECIPE_PATH = resolve(CONTRACTS, "series", "rehearsal-launch-fire-7.json");
const SNAP_PATH = resolve(CONTRACTS, "series", "fire-7-holders.json");
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
    "--gateways", gateways.join(","), "--verify-tries", "2", "--verify-wait", "1", "--out-dir", OUT, "--snapshot-days", "0.02", ...extra];
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
  for (const f of [DEP_FILE, `${DEP_FILE}.pending`, RECIPE_PATH, SNAP_PATH, resolve(OUT, "series-7.31337.state.json"), resolve(OUT, "series-7.31337.log")]) rmSync(f, { force: true });
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

  say("two PLANK holders for the snapshot (holding all through its window); keeper stand-in: 31 minutes on, the PLANK feed checkpointed");
  const twapAbi = [{ type: "function", name: "checkpoint", inputs: [], outputs: [], stateMutability: "nonpayable" }];
  const mintAbi = [{ type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" }];
  for (const [a, n] of [[acct(3), 100n], [acct(4), 500n]]) {
    await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: inputs.PLANK, abi: mintAbi, functionName: "mint", args: [a.address, n * 10n ** 27n] }) });
  }
  await rpc("evm_increaseTime", [toHex(31n * 60n)]);
  await rpc("evm_mine");
  await pub.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: C.PlankUsdTwap, abi: twapAbi, functionName: "checkpoint" }) });
  await rpc("anvil_setBalance", [owner.address, toHex(parseEther("10"))]);

  // the studio-format recipe, with real-looking images, and two local gateways
  const recipe = JSON.parse(readFileSync(resolve(CONTRACTS, "test/cards/recipe-studio-sale.json"), "utf8"));
  recipe.imagesBase = `ipfs://${CID}/`;
  writeFileSync(RECIPE_PATH, JSON.stringify(recipe, null, 1));
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
  const saleAbi = JSON.parse(readFileSync(resolve(REPO, "web/src/lib/abi/fireSaleAbi.json"), "utf8"));

  say("1. the wrong chain");
  let r = await launch(["--start", startLocal, "--chain", "46630"]);
  check(r.code === 1 && /STOP .*not 46630/.test(r.out), "STOP: the RPC isn't the chain asked for");

  say("2. an image missing on both gateways: batch A goes out, VerifySeries RED, STOP before batch B");
  let n0 = await nonce();
  r = await launch(["--start", startLocal]);
  check(r.code === 1, "exit code 1");
  check(/OK +\d+ wallets hold \$69\+ of PLANK/.test(r.out) && existsSync(SNAP_PATH), "the snapshot was taken and saved next to the recipe");
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
  check(/OK +Using the snapshot taken/.test(r.out) && /OK +Passed before/.test(r.out), "the snapshot and the rehearsal reused (start from the state file)");
  check(/OK +GREEN/.test(r.out), "VerifySeries GREEN");
  check((await nonce()) === n0, "nothing sent");

  say("4. run again and type LOCK: batch B, the drop read back");
  r = await launch([], { input: "LOCK" });
  check(r.code === 0, "exit code 0");
  check(/OK +GREEN before/.test(r.out), "VerifySeries not re-run (GREEN for this plan)");
  check((await nonce()) === n0 + 1, "exactly one transaction: configureDrop");
  drop = await pub.readContract({ address: C.FireSale, abi: saleAbi, functionName: "dropOf", args: [7n] });
  const snap = JSON.parse(readFileSync(SNAP_PATH, "utf8"));
  check(drop.start === startUnix && drop.packs === 117n && drop.starters === 50n && drop.priceUsd === 250000000n && drop.holderRoot === snap.root,
    `the drop: start ${drop.start}, 117 + 50 packs, $2.50, the snapshot's root`);
  check(/OK +FireSale's drop for Series 7/.test(r.out) && /7  Done/.test(r.out), "read back OK and done");

  say("5. the state file deleted, run again: the chain says it's launched, nothing sent");
  rmSync(resolve(OUT, "series-7.31337.state.json"));
  n0 = await nonce();
  r = await launch(["--yes"]);
  check(r.code === 0 && /already locked with a drop/.test(r.out), "already launched");
  check((await nonce()) === n0, "nothing sent");

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
  for (const f of [RECIPE_PATH, SNAP_PATH]) rmSync(f, { force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
