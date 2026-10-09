// The launch rehearsal: the whole life of a Series on a local chain, with the real deploy and owner scripts, the real
// snapshot, VerifySeries, VerifyDeploy and the real keeper code.
//
//   deploy (DeployTwap, DeployInfra, DeployCards) -> VerifyDeploy -> the owner accepts ownership (AcceptOwnership,
//   the owner wallet impersonated) -> keeper: PLANK checkpoint, PAPER candidate -> batch A sent from the owner
//   (ConfigureSeries) -> snapshot -> VerifySeries (RED with a missing image, then GREEN) -> batch B -> buy (one buy with the PLANK swap failing: its burn share waits in
//   PlankBurner) -> sold out, closed -> open -> keeper delivers drand (fulfillMany) and deals (process) -> case and
//   grade (protect) -> keeper delivers and finishes the grading (finish(index, ids) from the Protected event)
//   -> keeper flushes PlankBurner; PaperBurner waits (no PAPER price) and alerts -> 40 h later the PAPER feed is live
//   and the keeper flushes PaperBurner -> VerifyDeploy again.
//
// Two modes:
//   node rehearsal/rehearse.mjs                 plain anvil with stand-ins (script/dev/DevContracts.sol), no network
//       needed. The first open is timed to drand round 1000 and proved through the REAL OpenDrandRouter with drand's
//       real signature (BLS verified on-chain); then the owner switches FireCards and FirePsa to DevDrandRouter
//       adapters (any signature) so the rest runs without drand. Local servers stand in for drand, two IPFS gateways
//       and the alert webhook.
//   node rehearsal/rehearse.mjs --fork <RPC>    an anvil fork of Robinhood Chain (needs the RPC and drand reachable):
//       real tokens, Uniswap pools, Chainlink and drand; the owner is OWNER (impersonated) or a stand-in. The PAPER feed
//       leg is skipped (a fork's Chainlink doesn't update across 40 hours).
// Options: --keep (leave anvil running at the end), --port 8546.
// Needs: forge and anvil (PATH or ~/.foundry/bin), npm install in ops/, ops/keeper and ops/snapshot.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, getAddress, encodeFunctionData, zeroHash, keccak256, toHex,
} from "viem";
import { mnemonicToAccount, nonceManager } from "viem/accounts";
import { drandServer, gatewayServer, webhookServer } from "./servers.mjs";
import { createKeeper } from "../keeper/src/core.mjs";
import { loadConfig } from "../keeper/src/config.mjs";
import { roundTime, DRAND_GENESIS } from "../keeper/src/drand.mjs";
import { verifySeries, allImageNames, recipeFromJson, recipeHash } from "../series/verify-series.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const CONTRACTS = resolve(REPO, "contracts");
const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith("--")) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true; });
const FORK = typeof args.fork === "string" ? args.fork : undefined;
const PORT = Number(args.port ?? 8546);
const RPC = `http://127.0.0.1:${PORT}`;
const bin = (n) => { for (const d of [resolve(homedir(), ".foundry/bin"), "/root/.foundry/bin"]) if (existsSync(resolve(d, n))) return resolve(d, n); return n; };
const SOLC = [resolve(homedir(), ".foundry/solc/solc-0.8.28")].find(existsSync);
const MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public test accounts
const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const deployer = acct(0);
const revenue = acct(1);
const royalty = acct(2);
const buyer1 = acct(3);
const buyer2 = acct(4);
const holder3 = acct(5);
const keeperA = mnemonicToAccount(MNEMONIC, { addressIndex: 8, nonceManager });
const keeperB = mnemonicToAccount(MNEMONIC, { addressIndex: 9, nonceManager });
const FIRE = 7n;
const DEP_FILE = resolve(REPO, "deployments", `rehearsal-${FORK ? "fork" : "anvil"}.json`);
const RECIPE_PATH = resolve(CONTRACTS, "series", `rehearsal-fire-${FIRE}.json`);
const OUT = resolve(REPO, "ops/rehearsal/out");
const G = DRAND_GENESIS;

const t0 = Date.now();
const say = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const step = (s) => console.log(`\n=== ${s}`);
const fail = (m) => { throw new Error(m); };
const check = (cond, what) => { if (!cond) fail(`CHECK FAILED: ${what}`); say(`ok: ${what}`); };

const artifact = (file, name) => {
  const j = JSON.parse(readFileSync(resolve(CONTRACTS, "out", `${file}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
};
const webAbi = (n) => JSON.parse(readFileSync(resolve(REPO, "web/src/lib/abi", `${n}Abi.json`), "utf8"));
const ABI = {
  sale: webAbi("fireSale"), cards: webAbi("fireCards"), psa: webAbi("firePsa"), packs: webAbi("firePacks"), dealer: webAbi("recipeDealer"),
  burner: webAbi("paperBurner"), plankBurner: webAbi("plankBurner"),
  ownable: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
  setRandomness: [{ type: "function", name: "setRandomness", inputs: [{ name: "s", type: "address" }], outputs: [], stateMutability: "nonpayable" }],
};

// ------------------------------------------------------------------ chain plumbing
let anvil;
const pub = createPublicClient({ transport: http(RPC), pollingInterval: 100 });
const rpc = (method, params = []) => pub.request({ method, params });
const chainNow = async () => (await pub.getBlock()).timestamp;
const mine = async (ts) => { if (ts !== undefined) await rpc("evm_setNextBlockTimestamp", [toHex(ts)]); await rpc("evm_mine"); };
const warp = async (sec) => { await rpc("evm_increaseTime", [toHex(BigInt(sec))]); await rpc("evm_mine"); };
let chain;
const walletOf = (account) => createWalletClient({ account, chain, transport: http(RPC) });
async function tx(account, address, abi, functionName, args = [], value) {
  const hash = await walletOf(account).writeContract({ address, abi, functionName, args, value, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") fail(`${functionName} reverted (${hash})`);
  return r;
}
async function deploy(account, file, name, args = []) {
  const { abi, bytecode } = artifact(file, name);
  const hash = await walletOf(account).deployContract({ abi, bytecode, args, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  return { address: getAddress(r.contractAddress), abi };
}
/** Send as an address whose key isn't here (the owner's hardware wallet), anvil-impersonated. */
async function asImpersonated(from, to, data, value = 0n) {
  await rpc("anvil_impersonateAccount", [from]);
  const hash = await pub.request({ method: "eth_sendTransaction", params: [{ from, to, data, value: toHex(value), gas: toHex(15_000_000n) }] });
  const r = await pub.waitForTransactionReceipt({ hash });
  await rpc("anvil_stopImpersonatingAccount", [from]);
  if (r.status !== "success") fail(`owner transaction to ${to} reverted (${hash})`);
  return r;
}

function forge(script, env, extra = [], sender = deployer.address) {
  const argv = ["script", script, "--rpc-url", RPC, "--unlocked", "--sender", sender, "--broadcast", "--slow", ...(SOLC ? ["--use", SOLC] : []), ...extra];
  say(`forge ${argv.slice(0, 2).join(" ")} ...`);
  try {
    return execFileSync(bin("forge"), argv, {
      cwd: CONTRACTS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
      env: { ...process.env, DEPLOYMENTS_FILE: DEP_FILE, EXPECTED_CHAIN_ID: String(chain.id), FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
    });
  } catch (e) {
    console.error(String(e.stdout ?? "").split("\n").slice(-40).join("\n"), String(e.stderr ?? "").slice(-3000));
    throw new Error(`${script} failed`);
  }
}
function forgeRead(script, env) {
  try {
    return execFileSync(bin("forge"), ["script", script, "--rpc-url", RPC, ...(SOLC ? ["--use", SOLC] : [])], {
      cwd: CONTRACTS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
      env: { ...process.env, DEPLOYMENTS_FILE: DEP_FILE, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
    });
  } catch (e) {
    return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
  }
}
/** A forge script signed by the owner: on mainnet the hardware wallet (--ledger --hd-paths ... --sender <owner>), here
 *  the same address impersonated (--unlocked). */
async function forgeAsOwner(owner, script, env) {
  await rpc("anvil_impersonateAccount", [owner]);
  try { return forge(script, env, [], owner); } finally { await rpc("anvil_stopImpersonatingAccount", [owner]); }
}
const logLines = (out, re) => out.split("\n").map((l) => l.trim()).filter((l) => re.test(l)).map((l) => `    ${l}`).join("\n");

// ------------------------------------------------------------------ the keeper, as deployed (config from env)
const keeperLogs = [];
function keeperFor(account, env, wallNow) {
  const cfg = loadConfig(env); // exactly what the deployed keeper reads from its environment
  const log = (...a) => { const l = `    [${cfg.label}] ${a.join(" ")}`; keeperLogs.push(l); console.log(l); };
  return createKeeper({ cfg: { ...cfg, receiptTimeoutMs: 30_000 }, pub, wallet: walletOf(account), account, log, wallNow });
}

// ------------------------------------------------------------------ main
async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(DEP_FILE, { force: true });
  const startTs = G + 2905n - 7200n; // two hours before the 3 s window whose requests use drand round 1000
  step(FORK ? `anvil fork of ${FORK.replace(/\/\/([^/]+).*/, "//$1/...")}` : `anvil (plain, genesis ${new Date(Number(startTs) * 1000).toISOString()})`);
  anvil = spawn(bin("anvil"), ["--port", String(PORT), "--silent", ...(FORK ? ["--fork-url", FORK] : ["--timestamp", String(startTs), "--chain-id", "31337"])], { stdio: "ignore" });
  for (let i = 0; ; i++) { try { await pub.getChainId(); break; } catch { if (i > 100) fail("anvil didn't start"); await new Promise((r) => setTimeout(r, 200)); } }
  const id = await pub.getChainId();
  chain = { id, name: "rehearsal", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
  for (const a of [keeperA, keeperB, buyer1, buyer2, deployer]) await rpc("anvil_setBalance", [a.address, toHex(parseEther("100"))]);
  let clockNow = await chainNow();
  const wallNow = () => clockNow; // the keeper's "real time" is the chain's here (anvil's clock is set to 2024)

  // ---------------- inputs: stand-ins on plain anvil, the real addresses on a fork
  let inputs;
  // the owner: one hardware wallet (a plain address); nobody here holds its key
  const owner = getAddress(args.owner ?? process.env.OWNER ?? "0x1edfe11e1edfe11e1edfe11e1edfe11e1edfe11e");
  let dev = {};
  if (!FORK) {
    step("stand-ins: tokens, ETH/USD, Uniswap V2 (PLANK/WETH and PAPER/WETH pools), Paper Press, DevDrandRouter");
    const token = (n, s, d) => deploy(deployer, "DevContracts", "DevToken", [n, s, d]);
    const [paper, plank, usdg, weth] = [await token("PAPER", "PAPER", 18), await token("PLANK", "PLANK", 18), await token("Global Dollar", "USDG", 6), await token("Wrapped Ether", "WETH", 18)];
    const eth = await deploy(deployer, "DevContracts", "DevFeed", [3333n * 10n ** 8n]);
    const factory = await deploy(deployer, "DevContracts", "DevFactory");
    await tx(deployer, factory.address, factory.abi, "createPair", [plank.address, weth.address]);
    await tx(deployer, factory.address, factory.abi, "createPair", [paper.address, weth.address]);
    const pairAbi = artifact("DevContracts", "DevPair").abi;
    const plankPair = await pub.readContract({ address: factory.address, abi: factory.abi, functionName: "getPair", args: [plank.address, weth.address] });
    const paperPair = await pub.readContract({ address: factory.address, abi: factory.abi, functionName: "getPair", args: [paper.address, weth.address] });
    // PLANK $1e-9 (28 WETH : 93.3T PLANK at $3,333 ETH); PAPER $0.01 (1 WETH : 333,300 PAPER)
    await tx(deployer, plankPair, pairAbi, "setReserves", [weth.address, parseEther("28"), parseEther("28") * 3_333_000_000_000n]);
    await tx(deployer, paperPair, pairAbi, "setReserves", [weth.address, parseEther("1"), parseEther("333300")]);
    const router = await deploy(deployer, "DevContracts", "DevRouter", [weth.address, factory.address]);
    const press = await deploy(deployer, "DevContracts", "DevPress");
    dev = { paper, plank, usdg, weth, eth, router, devDrand: await deploy(deployer, "DevContracts", "DevDrandRouter") };
    inputs = {
      PAPER: paper.address, PLANK: plank.address, USDG: usdg.address, WETH: weth.address, MILL: press.address, ETH_USD_FEED: eth.address,
      PLANK_WETH_V2_PAIR: plankPair, UNIV2_FACTORY: factory.address, V2_ROUTER: router.address,
    };
    say(`stand-ins deployed; the owner (hardware wallet stand-in) is ${owner}`);
  } else {
    const env = Object.fromEntries(readFileSync(resolve(CONTRACTS, ".env.example"), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=0x/.test(l)).map((l) => l.split("=")));
    inputs = { PAPER: env.PAPER, PLANK: env.PLANK, USDG: env.USDG, WETH: env.WETH, MILL: env.MILL, ETH_USD_FEED: env.ETH_USD_FEED, PLANK_WETH_V2_PAIR: env.PLANK_WETH_V2_PAIR, UNIV2_FACTORY: env.UNIV2_FACTORY, V2_ROUTER: env.V2_ROUTER };
  }
  await rpc("anvil_setBalance", [owner, toHex(parseEther("10"))]);

  // ---------------- deploy with the real scripts
  step("deploy: DeployTwap, DeployInfra, DeployCards (the real scripts; they write the deployments file)");
  const env = { ...inputs, OWNER: owner, ROYALTY_RECEIVER: royalty.address, ROYALTY_BPS: "500", REVENUE_WALLET: revenue.address, PACK_IMAGE_BASE: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/" };
  forge("script/DeployTwap.s.sol", env);
  forge("script/DeployInfra.s.sol", env);
  forge("script/DeployCards.s.sol", env);
  const dep = JSON.parse(readFileSync(DEP_FILE, "utf8"));
  const C = Object.fromEntries(Object.entries(dep.contracts).map(([k, v]) => [k, getAddress(v)]));
  check(Object.keys(C).length === 15, `deployments file has all 15 contracts (${DEP_FILE.replace(REPO + "/", "")})`);

  step("VerifyDeploy before the owner accepts (expect WAIT on seven owners)");
  let vd = forgeRead("script/VerifyDeploy.s.sol", {});
  console.log(logLines(vd, /^(OK|WAIT|FAIL|INFO)|FAIL, /));
  check(/0 FAIL/.test(vd) && (vd.match(/acceptOwnership/g) ?? []).length === 7, "VerifyDeploy: nothing wrong, seven acceptOwnership() pending");

  step("the owner accepts ownership: AcceptOwnership.s.sol signed by the owner (impersonated)");
  const outRefused = forgeRead("script/AcceptOwnership.s.sol", {});
  check(/sign as the owner/.test(outRefused), "AcceptOwnership refuses any signer but the owner");
  await forgeAsOwner(owner, "script/AcceptOwnership.s.sol", {});
  for (const n of ["FirePacks", "FireCards", "RecipeDealer", "FireCredits", "FirePsa", "PaperBurner", "FireSale"]) {
    const o = await pub.readContract({ address: C[n], abi: ABI.ownable, functionName: "owner" });
    if (getAddress(o) !== owner) fail(`${n} is owned by ${o}, not the owner`);
  }
  say("the owner holds FirePacks, FireCards, RecipeDealer, FireCredits, FirePsa, PaperBurner and FireSale");

  // ---------------- keeper: first checkpoints
  const drand = await drandServer(() => clockNow, { real: !!FORK });
  let missing = "c1-coal-full-7.webp";
  const gwB = await gatewayServer({ has: (n) => n !== missing });
  const hook = await webhookServer();
  const keeperEnv = {
    RPC_URL: RPC, FALLBACK_RPC_URL: "none", CHAIN_ID: String(id), DEPLOYMENTS_FILE: DEP_FILE, ALERT_WEBHOOK_URL: hook.url,
    DRAND_URLS: FORK ? "https://api.drand.sh,https://api2.drand.sh,https://api3.drand.sh" : drand.url, SERIES_SCAN: "8", WAITING_ALERT_MIN: "0",
    CLOCK_SKEW_SEC: FORK ? "120" : "0", ETH_STALE_HOURS: "24", LOW_BALANCE_ETH: "0.01",
  };
  const main = await keeperFor(keeperA, { ...keeperEnv, KEEPER_LABEL: "keeper" }, wallNow);
  const pass = async (k = main, label = "keeper pass") => {
    clockNow = await chainNow();
    say(`${label} at chain time ${new Date(Number(clockNow) * 1000).toISOString()}`);
    return k.tick();
  };

  step("31 minutes later: the keeper checkpoints PLANK/USD (first price) and records the PAPER pool as candidate");
  await warp(31 * 60);
  if (!FORK) await tx(deployer, dev.eth.address, dev.eth.abi, "set", [3333n * 10n ** 8n]); // Chainlink would have updated
  let r = await pass();
  const twapAbi = [{ type: "function", name: "latestRoundData", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }], stateMutability: "view" },
    { type: "function", name: "candidate", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }];
  const plankPx = (await pub.readContract({ address: C.PlankUsdTwap, abi: twapAbi, functionName: "latestRoundData" }))[1];
  check(plankPx > 0n, `PLANK/USD live: $${Number(plankPx) / 1e18}`);
  if (!FORK) check((await pub.readContract({ address: C.PaperUsdTwap, abi: twapAbi, functionName: "candidate" })) !== "0x0000000000000000000000000000000000000000", "PaperUsdTwap has a candidate pool (adopted after 20 h)");
  check(hook.posts.some((p) => /heartbeat/.test(p)), "the keeper posted its start-up heartbeat to the webhook");

  // ---------------- Series: batch A
  step("Series 7, batch A (content): ConfigureSeries sent from the owner (impersonated)");
  const recipe = JSON.parse(readFileSync(resolve(CONTRACTS, "test/cards/recipe-standard.json"), "utf8"));
  recipe.imagesBase = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/";
  const saleBlock = {
    start: 0, packs: 4, starters: 0, plankOnly: 0, walletLimit: 0, starterWindow: 0, liftAfter: 0, plankBurnBps: 3000, priceUsd: 250000000,
    paperPerPack: "1000000000000000000", paperCapUsd: 100000000, holderWindow: 0, holderRoot: zeroHash, maxPerTx: 0, plankOnlyFor: 0, regularWalletsFor: 0,
    starterPerPress: 0, starterWalletLimit: 0, starterPriceUsd: 0, starterPaper: 0, creditsPerPick: 0, creditPacksMax: 0, creditPacksPerWallet: 0,
  };
  recipe.sale = saleBlock;
  writeFileSync(RECIPE_PATH, JSON.stringify(recipe, null, 1));
  const simA = forgeRead("script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "AB", SIMULATE: "true", DROP_START: String(clockNow + 600n) });
  check(/simulated OK: RecipeDealer.setRecipe/.test(simA) && /simulated OK: FireSale.configureDrop/.test(simA), "SIMULATE=true runs batches A then B as the owner (nothing sent)");
  const outBearly = forgeRead("script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "B", DROP_START: String(clockNow + 600n) });
  check(/on chain: the recipe differs/.test(outBearly), "batch B is refused before batch A is on chain");
  const outNotOwner = forgeRead("script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "A" });
  check(/sign as the owner/.test(outNotOwner), "batch A refuses any signer but the owner");
  const outA = await forgeAsOwner(owner, "script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "A" });
  console.log(logLines(outA, /^(RecipeDealer|FireCards|FirePsa)\./));
  const dealt = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "fires", args: [FIRE] });
  check(getAddress(dealt[0]) === C.RecipeDealer, "batch A is on chain (FireCards' dealer for the Series is RecipeDealer)");

  // ---------------- snapshot
  step("snapshot of PLANK holders ($69+) with ops/snapshot");
  if (!FORK) {
    for (const [a, n] of [[buyer1, 100n], [buyer2, 500n], [holder3, 30n]]) await tx(deployer, dev.plank.address, dev.plank.abi, "mint", [a.address, n * 10n ** 9n * 10n ** 18n]);
  }
  const snapPath = resolve(OUT, `fire-${FIRE}-holders.json`);
  execFileSync(process.execPath, [resolve(REPO, "ops/snapshot/snapshot.mjs"), "--min-usd", "69", "--out", snapPath], {
    cwd: resolve(REPO, "ops/snapshot"), stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, RPC, PLANK: inputs.PLANK, PLANK_USD_FEED: C.PlankUsdTwap },
  });
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));
  check(FORK || snap.count === 2, `snapshot: ${snap.count} wallets qualify, root ${snap.root}`);

  // ---------------- VerifySeries
  const names = allImageNames(recipeFromJson(recipe), recipe.characters.length);
  const manifest = () => ({ fire: Number(FIRE), recipeHash: recipeHash(recipe), files: names.map((name) => ({ name })) });
  const gwA2 = await gatewayServer({ manifest });
  const verify = (gateways) => verifySeries({
    client: pub, recipe, deploymentsFile: DEP_FILE, gateways, snapshotPath: snapPath, holderRoot: snap.root, concurrency: 32,
    log: (l) => { if (!/^OK/.test(l) || /images load|imageName|manifest/.test(l)) console.log(`    ${l}`); },
  });
  step("VerifySeries with one image missing on one gateway (expect RED)");
  let v = await verify([gwA2.url, gwB.url]);
  check(!v.green && v.problems.some((p) => p.includes(missing)), "RED: the missing image is caught");
  step("VerifySeries after the image is re-pinned (expect GREEN)");
  missing = undefined;
  v = await verify([gwA2.url, gwB.url]);
  check(v.green, `GREEN: ${v.images} images x 2 gateways, recipe, characters, fixed PDA odds, images base and the holder root`);

  // ---------------- batch B
  step("batch B (lock): configureDrop sent from the owner (after reading batch A back)");
  const start = (await chainNow()) + 300n;
  const outB = await forgeAsOwner(owner, "script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "B", DROP_START: String(start), HOLDER_ROOT: snap.root });
  check(/FireSale.configureDrop/.test(outB), "batch B sent");
  const drop = await pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "dropOf", args: [FIRE] });
  check(drop.start === start && drop.holderRoot === snap.root, "the drop is set with the snapshot's holder root");

  // ---------------- buy
  step("the drop opens: two buyers take all 4 packs with ETH (the first while the PLANK swap is down)");
  await mine(start);
  const access = { pressId: 0n, proof: [] };
  const buy = async (b, n) => {
    const [eth, paper] = await Promise.all([
      pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "quoteEth", args: [FIRE, n] }),
      pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "paperFor", args: [FIRE, n] }),
    ]);
    if (!FORK) {
      await tx(deployer, dev.paper.address, dev.paper.abi, "mint", [b.address, paper]);
      await tx(b, dev.paper.address, dev.paper.abi, "approve", [C.FireSale, paper]);
    }
    return tx(b, C.FireSale, ABI.sale, "buyWithEth", [FIRE, n, paper, access], (eth * 101n) / 100n);
  };
  if (!FORK) await tx(deployer, dev.router.address, dev.router.abi, "setFail", [true]);
  await buy(buyer1, 2n);
  if (!FORK) await tx(deployer, dev.router.address, dev.router.abi, "setFail", [false]);
  const pbEth = await pub.getBalance({ address: C.PlankBurner });
  check(FORK || pbEth > 0n, `PlankBurner holds ${formatEther(pbEth)} ETH (the burn share it couldn't swap)`);
  await buy(buyer2, 2n);
  const fires = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "fires", args: [FIRE] });
  check(fires[1] === true && fires[4] === 4n, "sold out: the Series closed with 4 packs");

  // ---------------- open #1: drand round 1000 through the real router
  step(FORK ? "open: buyer 1 opens 2 packs (real drand)" : "open: buyer 1 opens 1 pack, timed so its request uses drand round 1000 (the real OpenDrandRouter)");
  const routerAbi = [{ type: "function", name: "requests", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }, { type: "uint64" }, { type: "uint32" }, { type: "bool" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "view" }];
  if (!FORK) await rpc("evm_setNextBlockTimestamp", [toHex(G + 2906n)]);
  await tx(buyer1, C.FireCards, ABI.cards, "open", [FIRE, FORK ? 2n : 1n]);
  const open0 = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "openOf", args: [FIRE, 0n] });
  const req0 = await pub.readContract({ address: C.OpenDrandRouter, abi: routerAbi, functionName: "requests", args: [open0.requestId] });
  say(`open 0 -> router request ${open0.requestId}, drand round ${req0[1]} (published ${new Date(Number(roundTime(req0[1])) * 1000).toISOString()})`);
  if (!FORK) check(req0[1] === 1000n, "the request is committed to drand round 1000");

  step("the keeper delivers it once drand publishes: fulfillMany (BLS-verified on-chain), then process deals the cards");
  if (!FORK) await mine(roundTime(1000n) + 3n);
  for (let i = 0; i < (FORK ? 40 : 1); i++) {
    r = await pass();
    const o = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "openOf", args: [FIRE, 0n] });
    if (o.ready) break;
    await new Promise((res) => setTimeout(res, 5000)); // a fork waits for real drand
  }
  let head = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "headOf", args: [FIRE] });
  check(head === 1n, `open 0 delivered and dealt (sent: ${r.sent.map((s) => s.split(" ")[0]).join(", ")})`);
  if (!FORK) check(drand.served.includes(1000n), "the signature came from the (stand-in) drand relay: round 1000's real signature");

  // ---------------- switch randomness (plain anvil only)
  if (!FORK) {
    step("the owner switches FireCards and FirePsa to DevDrandRouter adapters (only new requests use them)");
    const ca = await deploy(deployer, "OpenVRFAdapter", "OpenVRFAdapter", [dev.devDrand.address, C.FireCards]);
    const pa = await deploy(deployer, "OpenVRFAdapter", "OpenVRFAdapter", [dev.devDrand.address, C.FirePsa]);
    await asImpersonated(owner, C.FireCards, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [ca.address] }));
    await asImpersonated(owner, C.FirePsa, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [pa.address] }));
    say(`cards -> ${ca.address}, PDA -> ${pa.address}`);
    step("open: buyer 1 opens 1 pack, buyer 2 opens 2 packs");
    await tx(buyer1, C.FireCards, ABI.cards, "open", [FIRE, 1n]);
    await tx(buyer2, C.FireCards, ABI.cards, "open", [FIRE, 2n]);
  } else {
    step("open: buyer 2 opens 2 packs");
    await tx(buyer2, C.FireCards, ABI.cards, "open", [FIRE, 2n]);
  }

  if (!FORK) {
    step("the backup (one pass, ACT_AFTER_SEC=300) right after drand publishes: it leaves the work to the main keeper");
    await warp(100);
    const backup = await keeperFor(keeperB, { ...keeperEnv, ONCE: "1", ACT_AFTER_SEC: "300", KEEPER_LABEL: "backup" }, wallNow);
    r = await pass(backup, "backup pass");
    check(r.sent.length === 0, "the backup sent nothing");
    step("two keepers at once on the same work (keeper A and a second instance with its own key): no double delivery");
    const second = await keeperFor(keeperB, { ...keeperEnv, KEEPER_LABEL: "keeper-2" }, wallNow);
    clockNow = await chainNow();
    const [ra, rb] = await Promise.all([main.tick(), second.tick()]);
    say(`keeper A sent ${ra.sent.length} tx, keeper B sent ${rb.sent.length} tx`);
  } else {
    for (let i = 0; i < 40; i++) {
      r = await pass();
      if ((await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "headOf", args: [FIRE] })) >= 2n) break;
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
  r = await pass();
  head = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "headOf", args: [FIRE] });
  const openCount = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "openCount", args: [FIRE] });
  check(head === openCount, `every open delivered and dealt (${openCount} opens)`);
  const next = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "nextSerial" });
  check(next - 1n === 24n, `${next - 1n} cards dealt (4 packs x 6)`);

  // ---------------- case and grade
  step("buyer 2 cases one card and sends two for grading (pays ETH; the fee goes to PaperBurner)");
  const owned = [];
  for (let s = 1n; s < next; s++) {
    const o = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "ownerOf", args: [s] });
    if (getAddress(o) === buyer2.address) owned.push(s);
  }
  const [caseIds, gradeIds] = [[owned[0]], [owned[1], owned[2]]];
  const cost = await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "quote", args: [1n, 2n, 1] });
  await tx(buyer2, C.FirePsa, ABI.psa, "protect", [caseIds, gradeIds, 1, cost * 2n], (cost * 105n) / 100n);
  const gi = (await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "gradingCount" })) - 1n;
  say(`grading ${gi}: cards ${gradeIds.join(", ")}; case: ${caseIds[0]}; paid ${formatEther(cost)} ETH`);

  step("the keeper delivers the grading's randomness and finishes it (ids from the Protected event)");
  if (!FORK) await warp(100);
  for (let i = 0; i < (FORK ? 40 : 1); i++) {
    r = await pass();
    if ((await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "gradingOf", args: [gi] })).done) break;
    await new Promise((res) => setTimeout(res, 5000));
  }
  const g = await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "gradingOf", args: [gi] });
  check(g.done, "grading finished");
  for (const s of gradeIds) {
    const c = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "cardOf", args: [s] });
    check(c.grade > 0n, `card ${s} graded PDA ${c.grade}`);
  }

  // ---------------- burners
  step("burners: PlankBurner flushed by the keeper; PaperBurner waits for a PAPER price and alerts");
  const pbLeft = await pub.getBalance({ address: C.PlankBurner });
  check(pbLeft === 0n, `PlankBurner emptied (it held ${formatEther(pbEth)} ETH)`);
  const paperBurnerEth = await pub.getBalance({ address: C.PaperBurner });
  check(paperBurnerEth > 0n, `PaperBurner holds ${formatEther(paperBurnerEth)} ETH`);
  check(r.alerts.some((a) => /PaperBurner holds/.test(a.text)) && hook.posts.some((p) => /PaperBurner holds/.test(p)), "the 'fees waiting' alert reached the webhook");

  if (!FORK) {
    step("20 hours pass with the keeper down: the backup notices the stale PLANK price but leaves it to the main keeper");
    await warp(20 * 3600);
    await tx(deployer, dev.eth.address, dev.eth.abi, "set", [3333n * 10n ** 8n]);
    const lazy = await keeperFor(keeperB, { ...keeperEnv, ONCE: "1", ACT_AFTER_SEC: "999999999", KEEPER_LABEL: "backup" }, wallNow);
    r = await pass(lazy, "backup pass");
    check(r.alerts.some((a) => /PLANK price stale/.test(a.text)), "stale PLANK feed alert");
    step("the main keeper is back: PLANK checkpoint, PAPER pool adopted");
    r = await pass();
    step("another 20 hours: the PAPER feed reports its first price; the keeper flushes PaperBurner");
    await warp(20 * 3600);
    await tx(deployer, dev.eth.address, dev.eth.abi, "set", [3333n * 10n ** 8n]);
    r = await pass();
    const paperPx = (await pub.readContract({ address: C.PaperUsdTwap, abi: twapAbi, functionName: "latestRoundData" }))[1];
    check(paperPx > 0n, `PAPER/USD live: $${(Number(paperPx) / 1e18).toFixed(4)}`);
    check((await pub.getBalance({ address: C.PaperBurner })) === 0n, "PaperBurner flushed: the fee bought PAPER and burned it");
    r = await pass();
    check(hook.posts.some((p) => /resolved: PaperBurner holds/.test(p)), "the webhook got the 'resolved' line");
  }

  step("VerifyDeploy at the end");
  vd = forgeRead("script/VerifyDeploy.s.sol", { SERIES: "7" });
  console.log(logLines(vd, /^(OK|WAIT|FAIL|INFO)|FAIL, /));
  check(/ 0 FAIL/.test(vd) || /^0 FAIL/m.test(vd), "VerifyDeploy: no FAIL");

  step("webhook messages");
  for (const p of hook.posts) console.log(p.split("\n").map((l) => `    | ${l}`).join("\n"));
  writeFileSync(resolve(OUT, "summary.json"), JSON.stringify({ chainId: id, contracts: C, webhook: hook.posts, keeperLog: keeperLogs }, null, 2));
  console.log(`\nREHEARSAL PASSED in ${((Date.now() - t0) / 1000).toFixed(0)} s (log: ops/rehearsal/out/summary.json)`);
  for (const s of [drand, gwA2, gwB, hook]) await s.close().catch(() => {});
}

try {
  await main();
} catch (e) {
  console.error(`\nREHEARSAL FAILED: ${e?.shortMessage ?? e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  if (anvil && !args.keep) anvil.kill();
  if (args.keep) console.log(`anvil left running on ${RPC}`);
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
