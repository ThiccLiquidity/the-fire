// The launch rehearsal: the whole life of a Series on a local chain, with the real deploy and owner scripts, the real
// snapshot, VerifySeries, VerifyDeploy and the real keeper code.
//
//   stand-ins (DevStack, the testnet kit) -> deploy (DeployTwap, DeployInfra, DeployCards; each recorded after its
//   broadcast by ops/deploy/record.mjs) -> VerifyDeploy -> the owner accepts ownership (AcceptOwnership,
//   the owner wallet impersonated) -> keeper: PLANK checkpoint, PAPER candidate -> batch A sent from the owner
//   (ConfigureSeries) -> snapshots (PLANK with allowance tiers for the snapshot group; the Paper Press, an ERC-721) ->
//   VerifySeries (RED with a missing image, then GREEN) -> batch B: a drop of four groups (the Standard preset scaled
//   small: Press holders, PLANK snapshot holders, everyone, an unlimited "after sell-out" group with a rising price and
//   a 5-minute idle) -> buy through the groups (a snapshot proof from the real script; one buy with the PLANK swap
//   failing: its burn share waits in PlankBurner) -> the finite groups sell out, the taxed group sells two packs at a
//   rising price and idles out -> the keeper closes the Series (FireSale.close) -> open -> keeper delivers drand
//   (fulfillMany) and deals (process) -> case and
//   grade (protect) -> keeper delivers and finishes the grading (finish(index, ids) from the Protected event)
//   -> keeper flushes PlankBurner; PaperBurner waits (no PAPER price) and alerts -> 40 h later the PAPER feed is live
//   and the keeper flushes PaperBurner -> a case and a grade paid in PAPER (to the dead address) -> VerifyDeploy again.
//
// Two modes:
//   node rehearsal/rehearse.mjs                 plain anvil with stand-ins (script/DevStack.s.sol), no network
//       needed. The first open is timed to drand round 1000 and proved through the REAL OpenDrandRouter with drand's
//       real signature (BLS verified on-chain); then the owner switches FireCards and FirePsa to DevDrandRouter
//       adapters (any signature) so the rest runs without drand. Local servers stand in for drand, two IPFS gateways
//       and the alert webhook.
//   node rehearsal/rehearse.mjs --fork <RPC>    an anvil fork of Robinhood Chain (needs the RPC and drand reachable):
//       real tokens, Uniswap pools, Chainlink and drand; the owner is OWNER (impersonated) or a stand-in. The PAPER feed
//       leg is skipped (a fork's Chainlink doesn't update across 40 hours).
// Options: --keep (leave anvil running at the end), --port 8546, --chain-id 31337 (46630: the testnet's id, to run the
//   testnet kit exactly as on the testnet).
// The two keepers race for real: automine off, a block every second, the main keeper and the backup each in their own
// loop; every transaction they sent must succeed and do something, and no drand request may be delivered twice.
// Everything printed also goes to ops/rehearsal/out/rehearsal.log (CI keeps it when the rehearsal fails).
// Needs: forge and anvil (PATH or ~/.foundry/bin), npm install in ops/, ops/keeper and ops/snapshot.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, getAddress, encodeFunctionData, zeroHash, toHex, decodeFunctionData,
} from "viem";
import { mnemonicToAccount, nonceManager } from "viem/accounts";
import { drandServer, gatewayServer, webhookServer } from "./servers.mjs";
import { createKeeper } from "../keeper/src/core.mjs";
import { loadConfig } from "../keeper/src/config.mjs";
import { roundTime, DRAND_GENESIS } from "../keeper/src/drand.mjs";
import { verifySeries, allImageNames, recipeFromJson, recipeHash } from "../series/verify-series.mjs";
import { verifySnapshot } from "../snapshot/snapshot.mjs";
import { buildTree } from "../snapshot/merkle.mjs";
import { PAY } from "../series/sale-abi.mjs";
import { record } from "../deploy/record.mjs";
import { routerAbi as keeperRouterAbi, twapAbi as keeperTwapAbi, cardsAbi as keeperCardsAbi, psaAbi as keeperPsaAbi, burnerAbi as keeperBurnerAbi, adapterAbi as keeperAdapterAbi } from "../keeper/src/abis.mjs";

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
const holder7702 = acct(6); // an EIP-7702 delegated wallet (code 0xef0100 + an address): counts as a wallet
const borrower = acct(7); // holds PLANK only at the snapshot's last block: doesn't count
const keeperA = mnemonicToAccount(MNEMONIC, { addressIndex: 8, nonceManager });
const keeperB = mnemonicToAccount(MNEMONIC, { addressIndex: 9, nonceManager });
const FIRE = 7n;
const DEP_FILE = resolve(REPO, "deployments", `rehearsal-${FORK ? "fork" : "anvil"}.json`);
const RECIPE_PATH = resolve(CONTRACTS, "series", `rehearsal-fire-${FIRE}.json`);
const OUT = resolve(REPO, "ops/rehearsal/out");
const LOG = resolve(OUT, "rehearsal.log");
const G = DRAND_GENESIS;
const CHAIN_ID = Number(args["chain-id"] ?? 31337);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// everything printed also goes to the log file (to find a flake after the fact)
mkdirSync(OUT, { recursive: true });
writeFileSync(LOG, "");
const consoleLog = console.log.bind(console);
const consoleErr = console.error.bind(console);
console.log = (...a) => { consoleLog(...a); try { appendFileSync(LOG, `${a.join(" ")}\n`); } catch { /* best effort */ } };
console.error = (...a) => { consoleErr(...a); try { appendFileSync(LOG, `${a.join(" ")}\n`); } catch { /* best effort */ } };

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
const saleArtifact = artifact("FireSale", "FireSale").abi;
const groupsArtifact = artifact("FireGroups", "FireGroups").abi;
const ABI = {
  // FireSale and FireGroups from the compiled contracts (the drop groups; web/src/lib/abi may lag behind). FireSale's
  // carries FireGroups' errors too: they come back through FireSale's calls.
  sale: [...saleArtifact, ...groupsArtifact.filter((x) => x.type === "error" && !saleArtifact.some((y) => y.type === "error" && y.name === x.name))],
  groups: groupsArtifact, cards: webAbi("fireCards"), psa: webAbi("firePsa"), packs: webAbi("firePacks"), dealer: webAbi("recipeDealer"),
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
  let hash;
  try { hash = await walletOf(account).writeContract({ address, abi, functionName, args, value, chain }); } catch (e) {
    const why = e?.cause?.data?.errorName ?? e?.walk?.((x) => x?.data?.errorName)?.data?.errorName ?? e?.cause?.reason;
    throw new Error(`${functionName} reverted${why ? `: ${why}` : ""} (${e?.shortMessage ?? e?.message})`);
  }
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

// an RPC hiccup between forge and anvil is retried once (and logged); a real failure fails at once
const TRANSIENT = /error sending request|connection (refused|reset|closed)|timed? ?out|EOF while parsing|nonce too low|replacement transaction|already known/i;
function forge(script, env, extra = [], sender = deployer.address) {
  const argv = ["script", script, "--rpc-url", RPC, "--unlocked", "--sender", sender, "--broadcast", "--slow", "--offline", ...(SOLC ? ["--use", SOLC] : []), ...extra];
  say(`forge ${argv.slice(0, 2).join(" ")} ...`);
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync(bin("forge"), argv, {
        cwd: CONTRACTS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
        env: { ...process.env, DEPLOYMENTS_FILE: DEP_FILE, EXPECTED_CHAIN_ID: String(chain.id), FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
      });
    } catch (e) {
      const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      writeFileSync(resolve(OUT, `forge-${script.replace(/\W+/g, "_")}-${attempt}.log`), out);
      if (attempt === 1 && TRANSIENT.test(out)) {
        say(`${script}: transient RPC error, retrying once (log in ops/rehearsal/out/): ${(TRANSIENT.exec(out) ?? [""])[0]}`);
        rmSync(`${DEP_FILE}.pending`, { force: true });
        argv.push("--resume");
        continue;
      }
      console.error(String(e.stdout ?? "").split("\n").slice(-40).join("\n"), String(e.stderr ?? "").slice(-3000));
      throw new Error(`${script} failed`);
    }
  }
}
function forgeRead(script, env) {
  try {
    return execFileSync(bin("forge"), ["script", script, "--rpc-url", RPC, "--offline", ...(SOLC ? ["--use", SOLC] : [])], {
      cwd: CONTRACTS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
      env: { ...process.env, DEPLOYMENTS_FILE: DEP_FILE, EXPECTED_CHAIN_ID: String(chain.id), FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
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
/** After a deploy script's broadcast: the deployments file is untouched until ops/deploy/record.mjs checks the
 *  broadcast against the chain and records it (exactly as on mainnet). */
async function recordDeploy(what, before) {
  const now = existsSync(DEP_FILE) ? readFileSync(DEP_FILE, "utf8") : undefined;
  if (now !== before) fail(`${what} wrote the deployments file itself (it must only leave a .pending file)`);
  if (!existsSync(`${DEP_FILE}.pending`)) fail(`${what} left no .pending file`);
  const r = await record({ client: pub, file: DEP_FILE, broadcastDir: resolve(CONTRACTS, "broadcast"), log: () => {} });
  if (!r.ok) fail(`record after ${what}: ${r.problems.join("; ")}`);
  say(`recorded ${what}: ${r.notes.filter((n) => /deployed in/.test(n)).length} new contract(s) checked against their receipts`);
}
async function forgeDeploy(script, env) {
  const before = existsSync(DEP_FILE) ? readFileSync(DEP_FILE, "utf8") : undefined;
  const out = forge(script, env);
  await recordDeploy(script.replace(/^script\//, ""), before);
  return out;
}
const logLines = (out, re) => out.split("\n").map((l) => l.trim()).filter((l) => re.test(l)).map((l) => `    ${l}`).join("\n");

// ------------------------------------------------------------------ the keeper, as deployed (config from env)
const keeperLogs = [];
let keeperPub; // the keepers' client: reads batched through Multicall3 as keeper.mjs does on a chain that has it
function keeperFor(account, env, wallNow) {
  const cfg = loadConfig(env); // exactly what the deployed keeper reads from its environment
  const log = (...a) => { const l = `    [${cfg.label}] ${a.join(" ")}`; keeperLogs.push(l); console.log(l); };
  return createKeeper({ cfg: { ...cfg, receiptTimeoutMs: 30_000 }, pub: keeperPub ?? pub, wallet: walletOf(account), account, log, wallNow });
}

// ------------------------------------------------------------------ main
async function main() {
  rmSync(DEP_FILE, { force: true });
  rmSync(`${DEP_FILE}.pending`, { force: true });
  const startTs = G + 2905n - 7200n; // two hours before the 3 s window whose requests use drand round 1000
  step(FORK ? `anvil fork of ${FORK.replace(/\/\/([^/]+).*/, "//$1/...")}` : `anvil (plain, genesis ${new Date(Number(startTs) * 1000).toISOString()})`);
  anvil = spawn(bin("anvil"), ["--port", String(PORT), "--silent", ...(FORK ? ["--fork-url", FORK] : ["--timestamp", String(startTs), "--chain-id", String(CHAIN_ID)])], { stdio: "ignore" });
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
    step(`stand-ins: DevStack.s.sol, the testnet kit (tokens, ETH/USD, Uniswap V2 with PLANK/WETH and PAPER/WETH pools, router, Paper Press) on chain ${id}`);
    await forgeDeploy("script/DevStack.s.sol", {});
    const d = JSON.parse(readFileSync(DEP_FILE, "utf8")).inputs;
    const at = (address, name) => ({ address: getAddress(address), abi: artifact("DevContracts", name).abi });
    dev = {
      paper: at(d.PAPER, "DevToken"), plank: at(d.PLANK, "DevToken"), usdg: at(d.USDG, "DevToken"), weth: at(d.WETH, "DevToken"),
      eth: at(d.ETH_USD_FEED, "DevFeed"), router: at(d.V2_ROUTER, "DevRouter"), press: at(d.MILL, "DevPress"), factory: at(d.UNIV2_FACTORY, "DevFactory"),
      plankPair: at(d.PLANK_WETH_V2_PAIR, "DevPair"),
      devDrand: await deploy(deployer, "DevContracts", "DevDrandRouter"),
    };
    inputs = Object.fromEntries(["PAPER", "PLANK", "USDG", "WETH", "MILL", "ETH_USD_FEED", "PLANK_WETH_V2_PAIR", "UNIV2_FACTORY", "V2_ROUTER"].map((k) => [k, getAddress(d[k])]));
    // a stranger can't break the testnet: every setter is the deployer's
    const stranger = buyer1;
    for (const [c, fn, a] of [[dev.paper, "mint", [stranger.address, 1n]], [dev.paper, "setMinter", [stranger.address, true]], [dev.eth, "set", [1n]],
      [dev.plankPair, "setReserves", [inputs.WETH, 1n, 1n]], [dev.router, "setFail", [true]], [dev.press, "mint", [stranger.address]], [dev.factory, "createPair", [inputs.PAPER, inputs.USDG]]]) {
      let refused = false;
      try { await pub.simulateContract({ account: stranger, address: c.address, abi: c.abi, functionName: fn, args: a }); } catch (e) { refused = /owner only/.test(e?.shortMessage + e?.message); }
      if (!refused) fail(`a stranger could call ${fn} on a stand-in`);
    }
    say("ok: a stranger can't mint, set the price, set reserves, break the router, mint a press or add a pool");
    const ethRound = await pub.readContract({ address: dev.eth.address, abi: dev.eth.abi, functionName: "latestRoundData" });
    check(ethRound[3] === (await chainNow()), "the ETH/USD stand-in never goes stale (updatedAt is now)");
    // Multicall3 where the real chains have it, so the keepers' batched reads run as on Robinhood Chain
    const mc = await deploy(deployer, "DevContracts", "DevMulticall3");
    await rpc("anvil_setCode", [MULTICALL3, await pub.getCode({ address: mc.address })]);
    say(`stand-ins recorded in the deployments file; the owner (hardware wallet stand-in) is ${owner}`);
  } else {
    const env = Object.fromEntries(readFileSync(resolve(CONTRACTS, ".env.example"), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=0x/.test(l)).map((l) => l.split("=")));
    inputs = { PAPER: env.PAPER, PLANK: env.PLANK, USDG: env.USDG, WETH: env.WETH, MILL: env.MILL, ETH_USD_FEED: env.ETH_USD_FEED, PLANK_WETH_V2_PAIR: env.PLANK_WETH_V2_PAIR, UNIV2_FACTORY: env.UNIV2_FACTORY, V2_ROUTER: env.V2_ROUTER };
  }
  await rpc("anvil_setBalance", [owner, toHex(parseEther("10"))]);
  keeperPub = createPublicClient({
    chain: { ...chain, contracts: { multicall3: { address: MULTICALL3 } } }, transport: http(RPC), pollingInterval: 100,
    ...(!args["no-multicall"] && (await pub.getCode({ address: MULTICALL3 })) ? { batch: { multicall: { wait: 0 } } } : {}),
  });

  // ---------------- deploy with the real scripts
  step("deploy: DeployTwap, DeployInfra, DeployCards (the real scripts), each recorded after its broadcast (ops/deploy/record.mjs)");
  const env = { ...inputs, OWNER: owner, ROYALTY_RECEIVER: royalty.address, ROYALTY_BPS: "500", REVENUE_WALLET: revenue.address, KEEPERS: `${keeperA.address},${keeperB.address}`, PACK_IMAGE_BASE: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/" };
  forgeRead("script/DeployTwap.s.sol", env);
  check(!existsSync(`${DEP_FILE}.pending`), "a dry run (no --broadcast) leaves nothing to record");
  await forgeDeploy("script/DeployTwap.s.sol", env);
  await forgeDeploy("script/DeployInfra.s.sol", env);
  await forgeDeploy("script/DeployCards.s.sol", env);
  const dep = JSON.parse(readFileSync(DEP_FILE, "utf8"));
  const C = Object.fromEntries(Object.entries(dep.contracts).map(([k, v]) => [k, getAddress(v)]));
  check(Object.keys(C).length === 17 && C.FireProfiles, `deployments file has all 17 contracts, FireProfiles included (${DEP_FILE.replace(REPO + "/", "")})`);

  step("VerifyDeploy before the owner accepts (expect WAIT on seven owners)");
  let vd = forgeRead("script/VerifyDeploy.s.sol", {});
  console.log(logLines(vd, /^(OK|WAIT|FAIL|INFO)|FAIL, /));
  const pendingAccepts = (vd.match(/acceptOwnership/g) ?? []).length;
  check(/0 FAIL/.test(vd) && pendingAccepts === 7, `VerifyDeploy: nothing wrong, ${pendingAccepts} acceptOwnership() pending`);

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
    MIN_FLUSH_USD: "0.25", // the rehearsal's burners hold well under the $1 default (PlankBurner: a $0.50 burn share)
  };
  const main = await keeperFor(keeperA, { ...keeperEnv, KEEPER_LABEL: "keeper" }, wallNow);
  const pass = async (k = main, label = "keeper pass") => {
    clockNow = await chainNow();
    say(`${label} at chain time ${new Date(Number(clockNow) * 1000).toISOString()}`);
    return k.tick();
  };

  let pressId = 0n;
  if (!FORK) {
    // the snapshot's holders hold PLANK all through its window (the smallest holding over its blocks counts)
    for (const [a, n] of [[buyer1, 100n], [buyer2, 500n], [holder3, 30n], [holder7702, 200n]]) await tx(deployer, dev.plank.address, dev.plank.abi, "mint", [a.address, n * 10n ** 9n * 10n ** 18n]);
    await rpc("anvil_setCode", [holder7702.address, `0xef0100${MULTICALL3.slice(2).toLowerCase()}`]);
    // buyer 1 holds a Paper Press (the press group's NFT; and the ERC-721 snapshot's one holder)
    await tx(deployer, dev.press.address, dev.press.abi, "mint", [buyer1.address]);
    pressId = (await pub.readContract({ address: dev.press.address, abi: dev.press.abi, functionName: "next" })) - 1n;
  }
  step("31 minutes later: the keeper checkpoints PLANK/USD (first price) and records the PAPER pool as candidate");
  await warp(31 * 60);
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
  // the Standard preset's shape, scaled small: 1 press pack, 2 for PLANK holders (by snapshot allowance), 1 for
  // everyone (opens when the PLANK group ends), then an unlimited group at a rising 4% a pack that ends 5 minutes
  // after its last sale. Leftovers of the first two roll into Everyone.
  const E18 = "1000000000000000000";
  const saleBlock = {
    start: 0, packs: 4, plankBurnBps: 1000, paperBurnBps: 2000, paperCapUsd: "100000000", maxPerTx: 0, regularWalletsFor: 0,
    creditsPerPick: 0, creditPacksMax: 0, creditPacksPerWallet: 0, creditGroup: 255,
    groups: [
      { name: "Paper Press holders", packs: 1, gate: "nft", nft: "press", perNft: 1, priceUsd: "0", paper: E18, coins: 0, perWallet: 0, afterGroup: 255, startDelay: 0, duration: 3600, rollTo: 2 },
      { name: "PLANK holders", packs: 2, gate: "snapshot", priceUsd: "250000000", paper: E18, coins: 3, perWallet: 5, afterGroup: 255, startDelay: 0, duration: 3600, rollTo: 2 },
      { name: "Everyone", packs: 1, gate: "open", priceUsd: "250000000", paper: E18, coins: 7, perWallet: 5, afterGroup: 1, startDelay: 0, duration: 0, rollTo: 255 },
      { name: "After sell-out", packs: 0, unlimited: true, gate: "open", taxBps: 400, idle: 300, perTx: 1, priceUsd: "250000000", paper: E18, coins: 2, perWallet: 0, afterGroup: 2, startDelay: 0, duration: 0, rollTo: 255 },
    ],
  };
  recipe.sale = saleBlock;
  writeFileSync(RECIPE_PATH, JSON.stringify(recipe, null, 1));
  const ROOT_STANDIN = `0x${"ab".repeat(32)}`; // the snapshot comes after batch A; any root for the dry runs
  const simA = forgeRead("script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "AB", SIMULATE: "true", DROP_START: String(clockNow + 600n), GROUP_ROOT_1: ROOT_STANDIN });
  check(/simulated OK: RecipeDealer.setRecipe/.test(simA) && /simulated OK: FireSale.configureDrop/.test(simA), "SIMULATE=true runs batches A then B as the owner (nothing sent)");
  const outBearly = forgeRead("script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "B", DROP_START: String(clockNow + 600n), GROUP_ROOT_1: ROOT_STANDIN });
  check(/on chain: the recipe differs/.test(outBearly), "batch B is refused before batch A is on chain");
  const outNotOwner = forgeRead("script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "A" });
  check(/sign as the owner/.test(outNotOwner), "batch A refuses any signer but the owner");
  const outA = await forgeAsOwner(owner, "script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "A" });
  console.log(logLines(outA, /^(RecipeDealer|FireCards|FirePsa)\./));
  const dealt = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "fires", args: [FIRE] });
  check(getAddress(dealt[0]) === C.RecipeDealer, "batch A is on chain (FireCards' dealer for the Series is RecipeDealer)");

  // ---------------- snapshots
  step("snapshots with ops/snapshot: PLANK holders ($69+, $300+ = 2 packs) over 5 blocks in the last 28 minutes; Paper Press holders (an ERC-721)");
  if (!FORK) await tx(deployer, dev.plank.address, dev.plank.abi, "mint", [borrower.address, 1000n * 10n ** 9n * 10n ** 18n]); // a whale for the last block only
  const snapPath = resolve(OUT, `fire-${FIRE}-group-1.json`);
  const snapshot = (more, out) => execFileSync(process.execPath, [resolve(REPO, "ops/snapshot/snapshot.mjs"), ...more, "--blocks", "5", "--days", "0.02", "--out", out], {
    cwd: resolve(REPO, "ops/snapshot"), stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, RPC, PLANK: inputs.PLANK, PLANK_USD_FEED: C.PlankUsdTwap, DEPLOYMENTS_FILE: DEP_FILE },
  });
  snapshot(["--token", "plank", "--min-usd", "69", "--tiers", "69:1,300:2"], snapPath);
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));
  const allowanceOf = (a) => snap.wallets[a.address]?.allowance;
  check(FORK || (snap.count === 3 && allowanceOf(holder7702) === 1 && allowanceOf(buyer1) === 1 && allowanceOf(buyer2) === 2 && !allowanceOf(borrower) && !allowanceOf(holder3)),
    `snapshot: ${snap.count} wallets qualify (the EIP-7702 wallet in; the last-block whale and the $30 holder out; $500 of PLANK: 2 packs) over blocks ${snap.blocks.join(", ")}, root ${snap.root}`);
  const tampered = structuredClone(snap);
  tampered.holders.push({ wallet: holder3.address, balance: "30000000000000000000000000000", allowance: 1 });
  const tt = buildTree(tampered.holders);
  Object.assign(tampered, { root: tt.root, count: tampered.holders.length, wallets: Object.fromEntries(tampered.holders.map((h) => [h.wallet, { allowance: h.allowance, proof: tt.proofs[h.wallet] }])) });
  const vt = await verifySnapshot({ client: pub, snap: tampered });
  check(!vt.ok && vt.problems.some((p) => p.includes(holder3.address)), `snapshot verify: a wallet added by hand is RED (${vt.problems[0]})`);
  if (!FORK) {
    const pressSnapPath = resolve(OUT, `fire-${FIRE}-press-holders.json`);
    snapshot(["--token", "press", "--min", "1"], pressSnapPath);
    const ps = JSON.parse(readFileSync(pressSnapPath, "utf8"));
    check(ps.kind === "erc721" && ps.count === 1 && ps.wallets[buyer1.address]?.allowance === 1 && (await verifySnapshot({ client: pub, snap: ps })).ok,
      "ERC-721 snapshot of the Paper Press: detected, its one holder in, GREEN when rebuilt");
  }

  // ---------------- VerifySeries
  const names = allImageNames(recipeFromJson(recipe), recipe.characters.length);
  const manifest = () => ({ fire: Number(FIRE), recipeHash: recipeHash(recipe), files: names.map((name) => ({ name })) });
  const gwA2 = await gatewayServer({ manifest });
  const verify = (gateways) => verifySeries({
    client: pub, recipe, deploymentsFile: DEP_FILE, gateways, snapshots: { 1: snapPath }, roots: { 1: snap.root }, concurrency: 32,
    log: (l) => { if (!/^OK/.test(l) || /images load|imageName|manifest|snapshot|sale:|FireSale\./.test(l)) console.log(`    ${l}`); },
  });
  step("VerifySeries with one image missing on one gateway (expect RED)");
  let v = await verify([gwA2.url, gwB.url]);
  check(!v.green && v.problems.some((p) => p.includes(missing)), "RED: the missing image is caught");
  step("VerifySeries after the image is re-pinned (expect GREEN)");
  missing = undefined;
  v = await verify([gwA2.url, gwB.url]);
  check(v.green, `GREEN: ${v.images} images x 2 gateways, recipe, characters, fixed PDA odds, images base, the snapshot group's root (rebuilt from the chain) and the press group's NFT`);

  // ---------------- batch B
  step("batch B (lock): configureDrop sent from the owner (after reading batch A back)");
  const start = (await chainNow()) + 300n;
  const outB = await forgeAsOwner(owner, "script/ConfigureSeries.s.sol", { RECIPE_JSON: RECIPE_PATH, BATCH: "B", DROP_START: String(start), GROUP_ROOT_1: snap.root });
  check(/FireSale.configureDrop/.test(outB), "batch B sent");
  const drop = await pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "dropOf", args: [FIRE] });
  const groupsOf = () => pub.readContract({ address: C.FireGroups, abi: ABI.groups, functionName: "groupsOf", args: [FIRE] });
  let gv = await groupsOf();
  check(drop.start === start && drop.packs === 4n && gv.length === 4 && gv[1].config.root === snap.root && getAddress(gv[0].config.nft) === inputs.MILL && gv[3].config.unlimited,
    "the drop is set: 4 groups, the snapshot's root on the PLANK group, the Paper Press (MILL) on the press group, an unlimited last group");

  // ---------------- buy through the groups
  step("the drop opens: buy through the groups (the snapshot group with the script's proof; the first paid buy while the PLANK swap is down)");
  await mine(start);
  const MAX = 2n ** 256n - 1n;
  const status = () => pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "status", args: [FIRE] });
  const access = (o = {}) => ({ nftIds: [], allowance: 0n, proof: [], ...o });
  const snapAccess = (a, allowance = allowanceOf(a)) => access({ allowance: BigInt(allowance), proof: snap.wallets[a.address].proof });
  const quote = async (group, n) => pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "quote", args: [FIRE, group, n, PAY.ETH] });
  /** Buy `n` packs in `group` with ETH; the buyer's PAPER minted and approved (on a fork: buyWithEthAll buys it). */
  const buy = async (b, group, n, acc = access()) => {
    const [cost, paper] = await quote(group, n);
    if (FORK) {
      const extra = await pub.readContract({ address: C.FireSale, abi: ABI.sale, functionName: "quotePaperInEth", args: [paper] });
      return tx(b, C.FireSale, ABI.sale, "buyWithEthAll", [FIRE, group, n, acc], ((cost + extra) * 105n) / 100n);
    }
    await tx(deployer, dev.paper.address, dev.paper.abi, "mint", [b.address, paper]);
    await tx(b, dev.paper.address, dev.paper.abi, "approve", [C.FireSale, paper]);
    const most = (cost * 101n) / 100n; // maxCost: the most ETH agreed to (the price may tick up a little); the rest comes back
    return tx(b, C.FireSale, ABI.sale, "buy", [FIRE, group, n, PAY.ETH, most, paper, acc], most);
  };
  const refused = async (b, fn, a, value, re) => {
    try { await pub.simulateContract({ account: b, address: C.FireSale, abi: ABI.sale, functionName: fn, args: a, value }); return false; } catch (e) {
      const why = `${e?.shortMessage} ${e?.message}`;
      if (!re.test(why)) say(`refused, but not as expected: ${e?.shortMessage ?? why.slice(0, 300)}`);
      return re.test(why);
    }
  };
  const [c1] = await quote(1n, 1n);
  check(await refused(buyer2, "buy", [FIRE, 1n, 2n, PAY.ETH, 0n, MAX, snapAccess(buyer2, 3)], c1 * 3n, /NotAllowed/), "the snapshot group refuses a proof with a raised allowance (NotAllowed)");
  check(await refused(buyer1, "buy", [FIRE, 1n, 2n, PAY.ETH, 0n, MAX, snapAccess(buyer1)], c1 * 3n, /WalletLimit/), "the snapshot group holds a wallet to its allowance (1 pack: WalletLimit for 2)");
  check(await refused(revenue, "buy", [FIRE, 2n, 1n, PAY.ETH, 0n, MAX, access()], c1 * 2n, /GroupNotOpen/), "Everyone isn't open yet (it opens when the PLANK group ends)");
  if (!FORK) await tx(deployer, dev.router.address, dev.router.abi, "setFail", [true]);
  await buy(buyer2, 1n, 2n, snapAccess(buyer2));
  if (!FORK) await tx(deployer, dev.router.address, dev.router.abi, "setFail", [false]);
  const pbEth = await pub.getBalance({ address: C.PlankBurner });
  check(FORK || pbEth > 0n, `PlankBurner holds ${formatEther(pbEth)} ETH (the burn share it couldn't swap)`);
  say("buyer 2 took the PLANK group's 2 packs with its snapshot allowance (2) and proof");
  if (!FORK) {
    await buy(buyer1, 0n, 1n, access({ nftIds: [pressId] }));
    check(await refused(buyer1, "buy", [FIRE, 0n, 1n, PAY.ETH, 0n, MAX, access({ nftIds: [pressId] })], 0n, /GroupNotOpen|SoldOut|NftUsed/), "buyer 1 claimed the press pack with its Paper Press (PAPER only); the press group is done");
  } else {
    await warp(3601); // no press here: the press group's time runs out and its pack rolls into Everyone
  }
  gv = await groupsOf();
  check(gv[0].state === 2 && gv[1].state === 2 && gv[2].state === 1, "the press and PLANK groups ended (sold out); Everyone is open");
  await buy(buyer1, 2n, FORK ? 2n : 1n);
  let st = await status();
  gv = await groupsOf();
  check(gv[2].state === 2 && gv[3].state === 1 && st.left === MAX && !st.closed, "Everyone sold out: the 4-pack base Series is sold, the unlimited group opened, and the Series stays open (status.left: no limit)");

  step("the after sell-out group: one pack a purchase, the price rising 4% a pack; then 5 minutes without a sale");
  const [q1] = await quote(3n, 1n);
  check(await refused(buyer2, "buy", [FIRE, 3n, 2n, PAY.ETH, 0n, MAX, access()], q1 * 3n, /PerTxLimit/), "two packs in one purchase refused (perTx 1)");
  await buy(buyer2, 3n, 1n);
  const [q2] = await quote(3n, 1n);
  check(q2 > q1, `the next pack costs more: ${formatEther(q1)} -> ${formatEther(q2)} ETH`);
  await buy(buyer1, 3n, 1n);
  let fires = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "fires", args: [FIRE] });
  check(fires[1] === false, "6 packs minted and the Series still open while the taxed group sells");
  await warp(301);
  st = await status();
  check(st.left === 0n && !st.closed, "the taxed group idled out (5 minutes, no sale): nothing can still sell, but nothing closed it yet (status.left 0)");

  step("the keeper sees status.left 0 and closes the Series (FireSale.close)");
  r = await pass();
  check(r.sent.some((x) => /^close /.test(x)), `the keeper sent close (sent: ${r.sent.map((x) => x.split(" ")[0]).join(", ")})`);
  fires = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "fires", args: [FIRE] });
  check(fires[1] === true && fires[4] === 6n, "the Series closed with 6 packs (the 4-pack base + 2 after sell-out)");
  check(hook.posts.some((p) => /this keeper closed it/.test(p)), "the webhook heard the keeper closed it");

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
    step("open: buyer 1 opens 2 packs, buyer 2 opens 3 packs");
    await tx(buyer1, C.FireCards, ABI.cards, "open", [FIRE, 2n]);
    await tx(buyer2, C.FireCards, ABI.cards, "open", [FIRE, 3n]);
  } else {
    step("open: buyer 1 opens 1 pack, buyer 2 opens 3 packs");
    await tx(buyer1, C.FireCards, ABI.cards, "open", [FIRE, 1n]);
    await tx(buyer2, C.FireCards, ABI.cards, "open", [FIRE, 3n]);
  }

  if (!FORK) {
    step("the backup (one pass, KEEPER_ROLE=backup) right after drand publishes: it leaves the work to the main keeper");
    await warp(100);
    const backupOnce = await keeperFor(keeperB, { ...keeperEnv, ONCE: "1", KEEPER_ROLE: "backup" }, wallNow);
    r = await pass(backupOnce, "backup pass");
    check(r.sent.length === 0, "the backup sent nothing");
    step("the two keepers race for real (automine off, a block a second): the main keeper was away 37 min, so the PLANK checkpoint and both drand deliveries are overdue for the backup too");
    await warp(37 * 60);
    const backup = await keeperFor(keeperB, { ...keeperEnv, KEEPER_ROLE: "backup", MAIN_KEEPER_ADDRESS: keeperA.address, BACKUP_YIELD_MS: "1500" }, wallNow);
    const done = async () => {
      const [h, n, due] = await Promise.all([
        pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "headOf", args: [FIRE] }),
        pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "openCount", args: [FIRE] }),
        pub.readContract({ address: C.PlankUsdTwap, abi: keeperTwapAbi, functionName: "due" }),
      ]);
      return h === n && !due;
    };
    const raced = await race([[main, keeperA], [backup, keeperB]], done, 90_000, (t) => { clockNow = t; });
    check(raced.finished, `the work got done during the race (${raced.txs.length} tx: ${raced.txs.map((t) => `${t.who} ${t.fn}`).join(", ")})`);
    check(raced.reverted.length === 0, `no keeper transaction reverted${raced.reverted.length ? `: ${raced.reverted.join("; ")}` : ""}`);
    check(raced.noops.length === 0, `every keeper transaction did something (no wasted duplicates)${raced.noops.length ? `: ${raced.noops.join("; ")}` : ""}`);
    check(raced.doubleIds.length === 0, `no drand request delivered twice${raced.doubleIds.length ? `: ${raced.doubleIds.join(", ")}` : ""}`);
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
  check(next - 1n === 36n, `${next - 1n} cards dealt (6 packs x 6)`);

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
    step("20 hours pass with the main keeper down: a keeper that won't act still sees the stale PLANK price");
    await warp(20 * 3600);
    const lazy = await keeperFor(keeperB, { ...keeperEnv, ONCE: "1", ACT_AFTER_SEC: "999999999", KEEPER_LABEL: "watcher" }, wallNow);
    r = await pass(lazy, "watcher pass");
    check(r.alerts.some((a) => /PLANK price stale/.test(a.text) && /can't heal/.test(a.text)), "stale PLANK feed alert (over 90 min)");
    step("the backup steps in: it checkpoints the late PLANK feed and says so on the webhook");
    const backup2 = await keeperFor(keeperB, { ...keeperEnv, KEEPER_ROLE: "backup", MAIN_KEEPER_ADDRESS: keeperA.address, BACKUP_YIELD_MS: "500" }, wallNow);
    r = await pass(backup2, "backup pass");
    check(r.sent.some((x) => /^checkpoint/.test(x)), `the backup checkpointed (sent: ${r.sent.map((x) => x.split(" ")[0]).join(", ")})`);
    check(hook.posts.some((p) => /had to step in/.test(p)), "the webhook heard that the backup stepped in");
    step("the owner pauses FireSale, switches FirePsa's randomness back and sets FireSale's wallets: the keeper posts all three");
    await asImpersonated(owner, C.FireSale, encodeFunctionData({ abi: ABI.sale, functionName: "setPaused", args: [true] }));
    await asImpersonated(owner, C.FireSale, encodeFunctionData({ abi: ABI.sale, functionName: "setWallets", args: [revenue.address, C.PlankBurner, C.PaperBurner] }));
    await asImpersonated(owner, C.FirePsa, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [C.PsaAdapter] }));
    step("the main keeper is back: PAPER pool adopted");
    r = await pass();
    check(hook.posts.some((p) => /FireSale is PAUSED/.test(p)), "the pause reached the webhook");
    check(hook.posts.some((p) => /FirePsa's randomness source was SWITCHED/.test(p)), "the randomness switch reached the webhook");
    check(hook.posts.filter((p) => new RegExp(`FireSale's wallets were CHANGED by the owner \\(WalletsSet\\): revenue ${revenue.address}`).test(p)).length === 1, "FireSale's WalletsSet reached the webhook, once");
    await asImpersonated(owner, C.FireSale, encodeFunctionData({ abi: ABI.sale, functionName: "setPaused", args: [false] }));
    step("another 20 hours: the PAPER feed reports its first price; the keeper flushes PaperBurner");
    await warp(20 * 3600);
    r = await pass();
    const paperPx = (await pub.readContract({ address: C.PaperUsdTwap, abi: twapAbi, functionName: "latestRoundData" }))[1];
    check(paperPx > 0n, `PAPER/USD live: $${(Number(paperPx) / 1e18).toFixed(4)}`);
    check((await pub.getBalance({ address: C.PaperBurner })) === 0n, "PaperBurner flushed: the fee bought PAPER and burned it");
    r = await pass();
    check(hook.posts.some((p) => /resolved: PaperBurner holds/.test(p)), "the webhook got the 'resolved' line");

    step("buyer 2 cases one card and grades one paying in PAPER (straight to the dead address; PaperBurner untouched)");
    const free = [];
    for (let s = 1n; s < next; s++) {
      const o = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "ownerOf", args: [s] }).catch(() => undefined);
      if (!o || getAddress(o) !== buyer2.address) continue;
      const c = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "cardOf", args: [s] });
      if (!c.cased && c.grade === 0n) free.push(s);
    }
    check(free.length >= 2, `buyer 2 has ${free.length} cards neither cased nor graded`);
    const payPaper = 3; // FirePsa.Pay.PAPER
    const costP = await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "quoteFor", args: [[free[0]], [free[1]], payPaper] });
    const DEAD = "0x000000000000000000000000000000000000dEaD";
    const bal = (a) => pub.readContract({ address: dev.paper.address, abi: dev.paper.abi, functionName: "balanceOf", args: [a] });
    await tx(deployer, dev.paper.address, dev.paper.abi, "mint", [buyer2.address, costP]);
    await tx(buyer2, dev.paper.address, dev.paper.abi, "approve", [C.FirePsa, costP]);
    const dead0 = await bal(DEAD);
    const burnerEth0 = await pub.getBalance({ address: C.PaperBurner });
    // FirePsa is back on the real drand router (the stand-in relay only has round 1000's real signature): this grading
    // takes its randomness through the stand-in router, then FirePsa goes back
    const pa2 = await deploy(deployer, "OpenVRFAdapter", "OpenVRFAdapter", [dev.devDrand.address, C.FirePsa]);
    await asImpersonated(owner, C.FirePsa, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [pa2.address] }));
    await tx(buyer2, C.FirePsa, ABI.psa, "protect", [[free[0]], [free[1]], payPaper, costP]);
    check((await bal(DEAD)) - dead0 === costP, `${formatEther(costP)} PAPER went to the dead address`);
    check((await pub.getBalance({ address: C.PaperBurner })) === burnerEth0, "PaperBurner untouched by a PAPER payment");
    const gp = (await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "gradingCount" })) - 1n;
    await warp(100);
    r = await pass();
    check((await pub.readContract({ address: C.FirePsa, abi: ABI.psa, functionName: "gradingOf", args: [gp] })).done, "the PAPER-paid grading finished");
    const cp = await pub.readContract({ address: C.FireCards, abi: ABI.cards, functionName: "cardOf", args: [free[1]] });
    check(cp.grade > 0n, `card ${free[1]} graded PDA ${cp.grade}`);
    await asImpersonated(owner, C.FirePsa, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [C.PsaAdapter] }));
  }

  step("VerifyDeploy at the end");
  vd = forgeRead("script/VerifyDeploy.s.sol", { SERIES: "7" });
  console.log(logLines(vd, /^(OK|WAIT|FAIL|INFO)|FAIL, /));
  check(/ 0 FAIL/.test(vd) || /^0 FAIL/m.test(vd), "VerifyDeploy: no FAIL");

  step("webhook messages");
  for (const p of hook.posts) console.log(p.split("\n").map((l) => `    | ${l}`).join("\n"));
  summary = { chainId: id, contracts: C, webhook: hook.posts };
  console.log(`\nREHEARSAL PASSED in ${((Date.now() - t0) / 1000).toFixed(0)} s (log: ops/rehearsal/out/summary.json)`);
  for (const s of [drand, gwA2, gwB, hook]) await s.close().catch(() => {});
}

// ------------------------------------------------------------------ the race
/**
 * Runs each [keeper, account] in its own loop with automine off and a block every second, until `done()` or the
 * timeout. Then reads every transaction the keepers' wallets sent in those blocks: it must have succeeded and done
 * something (emitted an event), and no drand request may appear in two deliveries.
 */
async function race(pairs, done, timeoutMs, setClock) {
  const fnAbi = [...keeperRouterAbi, ...keeperTwapAbi, ...keeperCardsAbi, ...keeperPsaAbi, ...keeperBurnerAbi, ...keeperAdapterAbi];
  const from = await pub.getBlockNumber();
  await rpc("evm_setAutomine", [false]);
  await rpc("evm_setIntervalMining", [1]);
  let stop = false;
  let finished = false;
  const loops = pairs.map(async ([k]) => {
    while (!stop) {
      try { await k.tick(); } catch (e) { say(`a keeper pass failed in the race: ${e?.shortMessage ?? e?.message ?? e}`); }
      await sleep(250);
    }
  });
  const clock = (async () => { while (!stop) { try { setClock(await chainNow()); } catch { /* next */ } await sleep(200); } })();
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (await done()) { finished = true; break; }
    await sleep(500);
  }
  // let both finish their pass (and anything they sent get mined) before looking
  await sleep(4000);
  stop = true;
  await Promise.all([...loops, clock]);
  await rpc("evm_setIntervalMining", [0]);
  await rpc("evm_setAutomine", [true]);
  await rpc("evm_mine");
  const to = await pub.getBlockNumber();
  const who = new Map(pairs.map(([k, a], i) => [a.address.toLowerCase(), i === 0 ? "main" : "backup"]));
  const txs = [];
  const reverted = [];
  const noops = [];
  const ids = new Map();
  for (let b = from + 1n; b <= to; b++) {
    const blk = await pub.getBlock({ blockNumber: b, includeTransactions: true });
    for (const x of blk.transactions) {
      const w = who.get(x.from.toLowerCase());
      if (!w) continue;
      let fn = "transfer";
      let a = [];
      try { const d = decodeFunctionData({ abi: fnAbi, data: x.input }); fn = d.functionName; a = d.args ?? []; } catch { /* a nonce fill */ }
      const rc = await pub.getTransactionReceipt({ hash: x.hash });
      txs.push({ who: w, fn, hash: x.hash });
      if (rc.status !== "success") reverted.push(`${w} ${fn} ${x.hash}`);
      else if (rc.logs.length === 0) noops.push(`${w} ${fn} ${x.hash} (no event: it did nothing)`);
      if (fn === "fulfillMany") for (const id of a[0]) ids.set(id, (ids.get(id) ?? 0) + 1);
    }
  }
  say(`race: blocks ${from + 1n}-${to}, ${txs.length} keeper tx (${["main", "backup"].map((w) => `${w} ${txs.filter((x) => x.who === w).length}`).join(", ")})`);
  return { finished, txs, reverted, noops, doubleIds: [...ids].filter(([, n]) => n > 1).map(([id]) => String(id)) };
}

let summary = {};
try {
  await main();
} catch (e) {
  console.error(`\nREHEARSAL FAILED: ${e?.shortMessage ?? e?.message ?? e}`);
  console.error("the keepers' last lines:");
  for (const l of keeperLogs.slice(-40)) console.error(l);
  console.error(`full log: ops/rehearsal/out/rehearsal.log`);
  process.exitCode = 1;
} finally {
  try { writeFileSync(resolve(OUT, "summary.json"), JSON.stringify({ ...summary, passed: !process.exitCode, keeperLog: keeperLogs }, null, 2)); } catch { /* best effort */ }
  if (anvil && !args.keep) anvil.kill();
  if (args.keep) console.log(`anvil left running on ${RPC}`);
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
