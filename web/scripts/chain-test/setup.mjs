// A local test chain for the live chain layer (src/lib/chain): anvil, the testnet stand-ins (DevStack), the real deploy
// scripts (DeployTwap, DeployInfra, DeployCards, each recorded by ops/deploy/record.mjs), the owner accepting
// ownership, randomness switched to the dev drand router (accepts any signature), and Series 7 set up with the real
// ConfigureSeries (batch A, then batch B with the drop opening in 10 minutes). Anvil's public test accounts only.
//
// Used by run.mjs; on its own: node scripts/chain-test/setup.mjs (leaves anvil running, prints the deployments file).
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, http, getAddress, encodeFunctionData, parseEther, toHex, zeroHash } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
const CONTRACTS = resolve(REPO, "contracts");
const FOUNDRY = ["/root/.foundry/bin", resolve(process.env.HOME ?? "/root", ".foundry/bin")].find((d) => existsSync(resolve(d, "forge"))) ?? "";
const bin = (n) => (FOUNDRY ? resolve(FOUNDRY, n) : n);
const SOLC = [resolve(process.env.HOME ?? "/root", ".foundry/solc/solc-0.8.28"), "/root/.foundry/solc/solc-0.8.28"].find(existsSync);
export const MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public test accounts
export const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
export const FIRE = 7n;
export const OWNER = getAddress("0x1edfe11e1edfe11e1edfe11e1edfe11e1edfe11e"); // a stand-in hardware wallet: nobody holds its key

const ABI = {
  ownable: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
  setRandomness: [{ type: "function", name: "setRandomness", inputs: [{ name: "s", type: "address" }], outputs: [], stateMutability: "nonpayable" }],
  checkpoint: [{ type: "function", name: "checkpoint", inputs: [], outputs: [], stateMutability: "nonpayable" }],
};
const artifact = (file, name) => {
  const j = JSON.parse(readFileSync(resolve(CONTRACTS, "out", `${file}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
};

/** Start anvil and deploy everything. Returns the RPC, the deployments file and helpers; stop() ends anvil. */
export async function setupChain({ port = 8547, log = console.log } = {}) {
  const RPC = `http://127.0.0.1:${port}`;
  const DEP_FILE = resolve(REPO, "deployments", "rehearsal-chaintest.json") /* gitignored */;
  const OUT = resolve(here, "out");
  mkdirSync(OUT, { recursive: true });
  rmSync(DEP_FILE, { force: true });
  rmSync(`${DEP_FILE}.pending`, { force: true });
  const anvil = spawn(bin("anvil"), ["--port", String(port), "--silent", "--chain-id", "31337"], { stdio: "ignore" });
  const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
  const pub = createPublicClient({ transport: http(RPC), pollingInterval: 100 });
  const rpc = (method, params = []) => pub.request({ method, params });
  for (let i = 0; ; i++) { try { await pub.getChainId(); break; } catch { if (i > 100) { stop(); throw new Error("anvil didn't start"); } await new Promise((r) => setTimeout(r, 200)); } }
  const chain = { id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
  const deployer = acct(0);
  const walletOf = (a) => createWalletClient({ account: a, chain, transport: http(RPC) });
  const tx = async (a, address, abi, functionName, args = [], value) => {
    const hash = await walletOf(a).writeContract({ address, abi, functionName, args, value, chain });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
    return r;
  };
  const asOwner = async (to, data) => {
    await rpc("anvil_impersonateAccount", [OWNER]);
    const hash = await pub.request({ method: "eth_sendTransaction", params: [{ from: OWNER, to, data, gas: toHex(15_000_000n) }] });
    const r = await pub.waitForTransactionReceipt({ hash });
    await rpc("anvil_stopImpersonatingAccount", [OWNER]);
    if (r.status !== "success") throw new Error(`owner transaction to ${to} reverted`);
    return r;
  };
  const warp = async (sec) => { await rpc("evm_increaseTime", [toHex(BigInt(sec))]); await rpc("evm_mine"); };
  const now = async () => (await pub.getBlock()).timestamp;
  await rpc("anvil_setBalance", [OWNER, toHex(parseEther("10"))]);

  const { record } = await import(pathToFileURL(resolve(REPO, "ops/deploy/record.mjs")).href);
  const forge = (script, env, sender = deployer.address) => {
    const argv = ["script", script, "--rpc-url", RPC, "--unlocked", "--sender", sender, "--broadcast", "--slow", "--offline", ...(SOLC ? ["--use", SOLC] : [])];
    try {
      return execFileSync(bin("forge"), argv, {
        cwd: CONTRACTS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
        env: { ...process.env, DEPLOYMENTS_FILE: DEP_FILE, EXPECTED_CHAIN_ID: "31337", FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
      });
    } catch (e) {
      writeFileSync(resolve(OUT, `forge-${script.replace(/\W+/g, "_")}.log`), `${e.stdout ?? ""}\n${e.stderr ?? ""}`);
      throw new Error(`${script} failed (log in web/scripts/chain-test/out/)`);
    }
  };
  const deploy = async (script, env) => {
    forge(script, env);
    const r = await record({ client: pub, file: DEP_FILE, broadcastDir: resolve(CONTRACTS, "broadcast"), log: () => {} });
    if (!r.ok) throw new Error(`record after ${script}: ${r.problems.join("; ")}`);
  };
  const asOwnerForge = async (script, env) => {
    await rpc("anvil_impersonateAccount", [OWNER]);
    try { return forge(script, env, OWNER); } finally { await rpc("anvil_stopImpersonatingAccount", [OWNER]); }
  };

  log("stand-ins (DevStack: tokens, ETH/USD, Uniswap V2 pools and router, Paper Press)");
  await deploy("script/DevStack.s.sol", { EXPECTED_CHAIN_ID: "31337" });
  const inputs = JSON.parse(readFileSync(DEP_FILE, "utf8")).inputs;
  const dev = (name, a) => ({ address: getAddress(a), abi: artifact("DevContracts", name).abi });
  const D = {
    paper: dev("DevToken", inputs.PAPER), plank: dev("DevToken", inputs.PLANK), usdg: dev("DevToken", inputs.USDG), press: dev("DevPress", inputs.MILL),
  };
  const deployC = async (file, name, args) => {
    const { abi, bytecode } = artifact(file, name);
    const hash = await walletOf(deployer).deployContract({ abi, bytecode, args, chain });
    return getAddress((await pub.waitForTransactionReceipt({ hash })).contractAddress);
  };
  const devDrand = await deployC("DevContracts", "DevDrandRouter", []);

  log("deploy: DeployTwap, DeployInfra, DeployCards (the real scripts)");
  const env = {
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)])), OWNER, ROYALTY_RECEIVER: acct(2).address, ROYALTY_BPS: "500",
    REVENUE_WALLET: acct(1).address, PACK_IMAGE_BASE: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/",
  };
  await deploy("script/DeployTwap.s.sol", env);
  await deploy("script/DeployInfra.s.sol", env);
  await deploy("script/DeployCards.s.sol", env);
  const dep = JSON.parse(readFileSync(DEP_FILE, "utf8"));
  const C = Object.fromEntries(Object.entries(dep.contracts).map(([k, v]) => [k, getAddress(v)]));

  log("the owner accepts ownership (AcceptOwnership, owner impersonated)");
  await asOwnerForge("script/AcceptOwnership.s.sol", {});
  for (const n of ["FireSale", "FireCards", "FireCredits", "FirePsa"]) {
    if (getAddress(await pub.readContract({ address: C[n], abi: ABI.ownable, functionName: "owner" })) !== OWNER) throw new Error(`${n} isn't the owner's`);
  }

  log("randomness: FireCards and FirePsa on the dev drand router (any 64-byte signature)");
  const ca = await deployC("OpenVRFAdapter", "OpenVRFAdapter", [devDrand, C.FireCards]);
  const pa = await deployC("OpenVRFAdapter", "OpenVRFAdapter", [devDrand, C.FirePsa]);
  await asOwner(C.FireCards, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [ca] }));
  await asOwner(C.FirePsa, encodeFunctionData({ abi: ABI.setRandomness, functionName: "setRandomness", args: [pa] }));

  log("PLANK price: 31 minutes, then a checkpoint (PlankUsdTwap)");
  await warp(31 * 60);
  await tx(deployer, C.PlankUsdTwap, ABI.checkpoint, "checkpoint");

  log(`Series ${FIRE}: ConfigureSeries batch A, then B (the drop opens in 10 minutes)`);
  const recipe = JSON.parse(readFileSync(resolve(CONTRACTS, "test/cards/recipe-standard.json"), "utf8"));
  recipe.fire = Number(FIRE);
  // 6 paid packs and 1 press pack: the test sells them all, so the drop closes and the packs can be opened
  recipe.sale = {
    start: 0, packs: 6, starters: 1, plankOnly: 0, walletLimit: 0, starterWindow: 3600, liftAfter: 0, plankBurnBps: 3000, priceUsd: 250000000,
    paperPerPack: "1000000000000000000", paperCapUsd: 100000000, holderWindow: 0, holderRoot: zeroHash, maxPerTx: 0, plankOnlyFor: 0, regularWalletsFor: 0,
    starterPerPress: 1, starterWalletLimit: 1, starterPriceUsd: 0, starterPaper: "1000000000000000000", creditsPerPick: 1, creditPacksMax: 0, creditPacksPerWallet: 0,
  };
  const recipePath = resolve(CONTRACTS, "series", `rehearsal-chaintest-fire-${FIRE}.json`); // forge may read contracts/series only (gitignored name)
  writeFileSync(recipePath, JSON.stringify(recipe, null, 1));
  await asOwnerForge("script/ConfigureSeries.s.sol", { RECIPE_JSON: recipePath, BATCH: "A" });
  const start = (await now()) + 600n;
  await asOwnerForge("script/ConfigureSeries.s.sol", { RECIPE_JSON: recipePath, BATCH: "B", DROP_START: String(start), NO_HOLDERS: "true" });

  const deployment = { ...dep, chainId: 31337, startBlock: 0 };
  writeFileSync(DEP_FILE, JSON.stringify(deployment, null, 2));
  return { RPC, DEP_FILE, deployment, C, D, start, pub, rpc, warp, now, tx, asOwner, stop, chain };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const s = await setupChain();
  console.log(`ready: ${s.RPC}, deployments ${s.DEP_FILE}. Ctrl-C to stop.`);
}
