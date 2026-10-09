// Records a deploy in deployments/<chainId>.json, after the broadcast, from what really landed on chain.
//
// forge runs a deploy script's code before it broadcasts anything, and a broadcast can fail or stop half way, so the
// scripts (DeployTwap, DeployInfra, DeployCards, DevStack) never write the deployments file themselves: with --broadcast
// they leave what they mean to record in deployments/<chainId>.json.pending. This checks every new address in it:
//   - there is contract code at it on the chain, now
//   - if a broadcast in contracts/broadcast/*/<chainId>/run-latest.json created it, that transaction's receipt (read
//     from the chain, not the file) is a success
//   - the new inputs that must be contracts (tokens, pools, feeds, router, press) have code
// and only then merges it into deployments/<chainId>.json and removes the .pending file. Anything wrong: nothing is
// written, the .pending file stays, and it says what. Then run VerifyDeploy before committing the file.
//
//   cd contracts
//   forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast ...
//   node ..\ops\deploy\record.mjs --rpc $env:RPC
//
// Options: --rpc <url> (else RPC or RPC_URL), --file <deployments file> (else DEPLOYMENTS_FILE, else
// deployments/<chainId>.json), --broadcast-dir <dir> (else contracts/broadcast), --dry-run (check only).
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicClient, getAddress, http } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");

/** Inputs that must be contracts (the others are wallets). */
export const CONTRACT_INPUTS = ["PAPER", "PLANK", "USDG", "WETH", "MILL", "ETH_USD_FEED", "PLANK_WETH_V2_PAIR", "UNIV2_FACTORY", "V2_ROUTER"];

/** address (lowercase) -> { hash, script } for every contract the broadcasts on this chain created. */
export function broadcastIndex(dir, chainId) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const script of readdirSync(dir)) {
    const f = resolve(dir, script, String(chainId), "run-latest.json");
    if (!existsSync(f)) continue;
    let j;
    try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    for (const t of j.transactions ?? []) {
      if (!t.hash) continue;
      if (t.contractAddress) out.set(t.contractAddress.toLowerCase(), { hash: t.hash, script });
      for (const a of t.additionalContracts ?? []) if (a.address) out.set(a.address.toLowerCase(), { hash: t.hash, script });
    }
  }
  return out;
}

/** The file as the scripts write it: chainId, startBlock, deployer, owner, inputs, contracts (in that order). */
export function merge(main, pending, startBlock) {
  const m = main ?? {};
  const out = { chainId: pending.chainId ?? m.chainId };
  const sb = m.startBlock ?? startBlock ?? pending.startBlock;
  if (sb !== undefined) out.startBlock = Number(sb);
  const deployer = m.deployer ?? pending.deployer;
  if (deployer) out.deployer = deployer;
  const owner = pending.owner ?? m.owner;
  if (owner) out.owner = owner;
  out.inputs = { ...(m.inputs ?? {}), ...(pending.inputs ?? {}) };
  out.contracts = { ...(m.contracts ?? {}), ...(pending.contracts ?? {}) };
  return out;
}

/**
 * Checks `pendingPath` against the chain and merges it into `file`. Returns { ok, problems, notes, merged }.
 * `client` is a viem public client on the chain.
 */
export async function record({ client, file, broadcastDir = resolve(REPO, "contracts/broadcast"), dryRun = false, log = console.log }) {
  const chainId = await client.getChainId();
  const pendingPath = `${file}.pending`;
  if (!existsSync(pendingPath)) return { ok: false, problems: [`nothing to record: no ${pendingPath} (did the script run with --broadcast?)`], notes: [] };
  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  const main = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  const problems = [];
  const notes = [];
  if (Number(pending.chainId) !== chainId) problems.push(`${pendingPath} is for chain ${pending.chainId}, the RPC is on chain ${chainId}`);
  if (main && main.chainId !== undefined && Number(main.chainId) !== chainId) problems.push(`${file} is for chain ${main.chainId}, the RPC is on chain ${chainId}`);
  const index = broadcastIndex(broadcastDir, chainId);
  const blocks = [];
  const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

  for (const [name, a] of Object.entries(pending.contracts ?? {})) {
    if (same(main?.contracts?.[name], a)) continue;
    const addr = getAddress(a);
    const code = await client.getCode({ address: addr });
    if (!code || code === "0x") { problems.push(`${name} ${addr}: no contract code on chain (the broadcast didn't land, or not yet)`); continue; }
    const b = index.get(addr.toLowerCase());
    if (b) {
      try {
        const r = await client.getTransactionReceipt({ hash: b.hash });
        if (r.status !== "success") { problems.push(`${name} ${addr}: its transaction ${b.hash} (${b.script}) reverted`); continue; }
        blocks.push(r.blockNumber);
        notes.push(`${name} ${addr}: deployed in ${b.hash} (block ${r.blockNumber}, ${b.script})`);
      } catch {
        problems.push(`${name} ${addr}: has code, but its transaction ${b.hash} (${b.script}) isn't on this chain (a stale broadcast file?)`);
      }
    } else {
      notes.push(`${name} ${addr}: has code; not created by a broadcast here (an existing contract given as an input)`);
    }
  }
  for (const [name, a] of Object.entries(pending.inputs ?? {})) {
    if (same(main?.inputs?.[name], a) || !CONTRACT_INPUTS.includes(name)) continue;
    const code = await client.getCode({ address: getAddress(a) });
    if (!code || code === "0x") problems.push(`input ${name} ${a}: no contract code on chain`);
  }
  for (const n of notes) log(`ok    ${n}`);
  for (const p of problems) log(`FAIL  ${p}`);
  if (problems.length) return { ok: false, problems, notes };
  // the first block a log scan needs: the earliest of the script's own block and the deploy receipts
  const firsts = [...blocks, ...(pending.startBlock !== undefined ? [BigInt(pending.startBlock)] : [])];
  const merged = merge(main, pending, firsts.length ? firsts.reduce((x, y) => (y < x ? y : x)) : undefined);
  if (!dryRun) {
    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
    rmSync(pendingPath);
  }
  return { ok: true, problems, notes, merged };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = {};
  process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith("--")) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true; });
  const rpc = typeof args.rpc === "string" ? args.rpc : process.env.RPC ?? process.env.RPC_URL;
  if (!rpc) {
    console.error("usage: node ops/deploy/record.mjs --rpc <RPC URL> [--file deployments/<chainId>.json] [--dry-run]");
    process.exit(2);
  }
  try {
    const client = createPublicClient({ transport: http(rpc) });
    const chainId = await client.getChainId();
    const file = resolve(typeof args.file === "string" ? args.file : process.env.DEPLOYMENTS_FILE ?? resolve(REPO, "deployments", `${chainId}.json`));
    const r = await record({
      client, file, dryRun: !!args["dry-run"],
      broadcastDir: typeof args["broadcast-dir"] === "string" ? resolve(args["broadcast-dir"]) : undefined,
    });
    if (!r.ok) {
      console.error(`\nNOT RECORDED: ${r.problems.length} problem(s). ${file} is unchanged; the .pending file stays.`);
      process.exit(1);
    }
    console.log(`\n${args["dry-run"] ? "would record" : "recorded"} ${file}${args["dry-run"] ? "" : " (the .pending file is removed)"}.`);
    console.log("Next: run VerifyDeploy (forge script script/VerifyDeploy.s.sol --rpc-url <RPC>), then commit the file.");
  } catch (e) {
    console.error(`record failed: ${e?.shortMessage ?? e?.message ?? e}`);
    process.exit(1);
  }
}
