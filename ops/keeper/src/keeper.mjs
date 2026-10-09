// Omni Cardworks keeper. Runs forever (two Railway services: KEEPER_ROLE=main, and KEEPER_ROLE=backup in another
// region with its own wallet), or one pass with ONCE=1 (by hand, or the optional GitHub Actions extra).
// Settings: see ops/keeper/README.md and config.mjs. The key comes only from KEEPER_PRIVATE_KEY (a Railway variable).
import { createPublicClient, createWalletClient, defineChain, fallback, http } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { loadConfig, loadKey } from "./config.mjs";
import { createKeeper } from "./core.mjs";
import { errMsg } from "./tx.mjs";
import { labelOf, pingHeartbeat, postWebhook } from "./alerts.mjs";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"; // the same address on every chain that has it
const once = process.env.ONCE === "1" || process.env.ONCE === "true";

/** A keeper that can't start must still be heard: post to the webhook, fail the dead-man's switch, then exit. A
 *  long-running service waits a few minutes first, so a restart loop doesn't flood the webhook. */
async function startupFailed(what, e, cfg) {
  const msg = `${what}: ${errMsg(e)}`;
  log(msg);
  const env = process.env;
  const label = cfg ? labelOf(cfg) : `[${env.KEEPER_LABEL ?? (env.KEEPER_ROLE === "backup" ? "backup" : "keeper")}${env.CHAIN_ID && env.CHAIN_ID !== "4663" ? ` chain ${env.CHAIN_ID}` : ""}]`;
  await postWebhook(env.ALERT_WEBHOOK_URL, `${label} can't start, so it is NOT keeping: ${msg}`, { log });
  await pingHeartbeat(env.HEARTBEAT_URL, true, `can't start: ${msg}`);
  if (!once) {
    const waitSec = Number(env.STARTUP_FAIL_WAIT_SEC ?? 300);
    log(`exiting in ${waitSec} s (the host restarts it)`);
    await new Promise((r) => { const t = setTimeout(r, waitSec * 1000); for (const s of ["SIGINT", "SIGTERM"]) process.once(s, () => { clearTimeout(t); r(); }); });
  }
  process.exit(1);
}

let cfg;
let account;
try {
  cfg = loadConfig();
  account = privateKeyToAccount(loadKey(), { nonceManager });
} catch (e) {
  await startupFailed("config", e, cfg);
}

// every RPC (RPC_URL and the fallback) must be on the expected chain: the fallback transport could otherwise send to
// another chain when the first one is down
const rpcProblems = [];
let answered = 0;
for (const [i, u] of cfg.rpcUrls.entries()) {
  const which = i === 0 ? "RPC_URL" : "FALLBACK_RPC_URL";
  try {
    const id = await createPublicClient({ transport: http(u, { timeout: 15_000, retryCount: 1 }) }).getChainId();
    if (id !== cfg.chainId) await startupFailed("startup", new Error(`${which} is on chain ${id}, expected ${cfg.chainId} (CHAIN_ID)`), cfg);
    answered++;
  } catch (e) {
    rpcProblems.push(`${which} didn't answer (${errMsg(e)})`);
  }
}
if (!answered) await startupFailed("startup", new Error(`no RPC answered: ${rpcProblems.join("; ")}`), cfg);

const transport = cfg.rpcUrls.length > 1 ? fallback(cfg.rpcUrls.map((u) => http(u))) : http(cfg.rpcUrls[0]);
const chain0 = { id: cfg.chainId, name: `chain ${cfg.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: cfg.rpcUrls } } };
let pub = createPublicClient({ transport });
let multicall = false;
try {
  if (!(await pub.getCode({ address: cfg.contracts.cards }))) throw new Error(`no contract at FireCards ${cfg.contracts.cards}`);
  multicall = cfg.multicall && !!(await pub.getCode({ address: MULTICALL3 }));
} catch (e) {
  await startupFailed("startup", e, cfg);
}
// reads made together are sent as one Multicall3 call when the chain has it
const chain = defineChain(multicall ? { ...chain0, contracts: { multicall3: { address: MULTICALL3 } } } : chain0);
pub = createPublicClient({ chain, transport, ...(multicall ? { batch: { multicall: { wait: 0 } } } : {}) });
const wallet = createWalletClient({ account, chain, transport });
const keeper = createKeeper({ cfg, pub, wallet, account, log });

log(`${cfg.label} (${cfg.role}) ${account.address} on chain ${cfg.chainId}; FireCards ${cfg.contracts.cards}; ${cfg.rpcUrls.length > 1 ? "with fallback RPC" : "no fallback RPC"}; ${multicall ? "Multicall3 reads" : "plain reads"}${cfg.actAfterSec > 0n ? `; acts only on work left ${cfg.actAfterSec}s` : ""}`);
if (!cfg.webhookUrl) log("WARNING ALERT_WEBHOOK_URL is not set: nobody hears about problems.");
if (!cfg.heartbeatUrl) log("WARNING HEARTBEAT_URL is not set: nobody notices if this keeper dies.");
for (const p of rpcProblems) {
  log(`WARNING ${p}`);
  await keeper.notifier.post(`${labelOf(cfg)} starting with one RPC down: ${p}`);
}
try {
  const s = await keeper.startup();
  if (s.filled) await keeper.notifier.post(`${labelOf(cfg)} replaced ${s.filled} transaction(s) an earlier run left waiting`);
} catch (e) {
  log(`start-up checks failed: ${errMsg(e)} (carrying on)`);
}

if (cfg.once) {
  try {
    const r = await keeper.tick();
    log(`pass done: ${r.sent.length} tx, ${r.alerts.filter((a) => !a.quiet).length} alert(s)`);
  } catch (e) {
    log(`pass failed: ${errMsg(e)}`);
    await keeper.notifier.post(`${labelOf(cfg)} pass failed: ${errMsg(e)}`);
    process.exitCode = 1;
  }
} else {
  let stopping = false;
  let wake;
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; log(`${sig}: stopping after this pass`); wake?.(); });
  while (!stopping) {
    const t = Date.now();
    try { await keeper.tick(); } catch (e) {
      log(`pass failed: ${errMsg(e)}`);
      await keeper.notifier.report([{ key: "pass", text: `pass failed: ${errMsg(e)}` }]);
    }
    const wait = Math.max(1000, cfg.intervalSec * 1000 - (Date.now() - t));
    await new Promise((r) => { wake = r; setTimeout(r, wait); });
  }
}
