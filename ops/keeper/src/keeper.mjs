// The Omni Forge keeper. Runs forever (Railway), or one pass with ONCE=1 (the GitHub Actions backup).
// Settings: see ops/keeper/README.md and config.mjs. The key comes only from KEEPER_PRIVATE_KEY (a Railway variable
// or a GitHub secret).
import { createPublicClient, createWalletClient, defineChain, fallback, http } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { loadConfig, loadKey } from "./config.mjs";
import { createKeeper } from "./core.mjs";
import { errMsg } from "./tx.mjs";

const log = (...a) => console.log(new Date().toISOString(), ...a);

let cfg;
let account;
try {
  cfg = loadConfig();
  account = privateKeyToAccount(loadKey(), { nonceManager });
} catch (e) {
  log(`config: ${errMsg(e)}`);
  process.exit(1);
}

const transport = cfg.rpcUrls.length > 1 ? fallback(cfg.rpcUrls.map((u) => http(u))) : http(cfg.rpcUrls[0]);
const pub = createPublicClient({ transport });
try {
  const id = await createPublicClient({ transport: http(cfg.rpcUrls[0]) }).getChainId();
  if (id !== cfg.chainId) throw new Error(`RPC_URL is on chain ${id}, expected ${cfg.chainId} (CHAIN_ID)`);
  if (!(await pub.getCode({ address: cfg.contracts.cards }))) throw new Error(`no contract at FireCards ${cfg.contracts.cards}`);
} catch (e) {
  log(`startup failed: ${errMsg(e)}`);
  process.exit(1);
}
const chain = defineChain({ id: cfg.chainId, name: `chain ${cfg.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: cfg.rpcUrls } } });
const wallet = createWalletClient({ account, chain, transport });
const keeper = createKeeper({ cfg, pub, wallet, account, log });

log(`${cfg.label} ${account.address} on chain ${cfg.chainId}; FireCards ${cfg.contracts.cards}; ${cfg.rpcUrls.length > 1 ? "with fallback RPC" : "no fallback RPC"}${cfg.actAfterSec > 0n ? `; acts after ${cfg.actAfterSec}s` : ""}`);
if (!cfg.webhookUrl) log("WARNING ALERT_WEBHOOK_URL is not set: nobody hears about problems.");

if (cfg.once) {
  try {
    const r = await keeper.tick();
    log(`pass done: ${r.sent.length} tx, ${r.alerts.filter((a) => !a.quiet).length} alert(s)`);
  } catch (e) {
    log(`pass failed: ${errMsg(e)}`);
    await keeper.notifier.post(`[${cfg.label}] pass failed: ${errMsg(e)}`);
    process.exitCode = 1;
  }
} else {
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; log(`${sig}: stopping after this pass`); });
  while (!stopping) {
    const t = Date.now();
    try { await keeper.tick(); } catch (e) {
      log(`pass failed: ${errMsg(e)}`);
      await keeper.notifier.report([{ key: "pass", text: `pass failed: ${errMsg(e)}` }]);
    }
    const wait = Math.max(1000, cfg.intervalSec * 1000 - (Date.now() - t));
    await new Promise((r) => setTimeout(r, wait));
  }
}
