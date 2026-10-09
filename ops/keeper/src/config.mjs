// Keeper settings: everything comes from the environment (Railway variables, GitHub Actions secrets/vars, or a shell).
// Contract addresses come from deployments/<chainId>.json (written by the deploy scripts); any of them can be
// overridden by an env var of the same name in UPPER_SNAKE (e.g. FIRE_CARDS=0x...).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getAddress } from "viem";
import { DEFAULT_DRAND_URLS } from "./drand.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

/** Contract name in the deployments file -> its env override. */
export const CONTRACT_ENV = {
  PlankUsdTwap: "PLANK_USD_FEED",
  PaperUsdTwap: "PAPER_USD_FEED",
  OpenDrandRouter: "DRAND_ROUTER",
  FireCards: "FIRE_CARDS",
  FirePsa: "FIRE_PSA",
  PaperBurner: "PAPER_BURNER",
  PlankBurner: "PLANK_BURNER",
};

/** Optional: watched for the pause and randomness-switch alerts when known. */
export const OPTIONAL_ENV = { FireSale: "FIRE_SALE", CardsAdapter: "CARDS_ADAPTER", PsaAdapter: "PSA_ADAPTER" };

/** Robinhood Chain's public RPCs: the default fallback behind RPC_URL. */
export const PUBLIC_RPC = { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com/rpc" };

/** KEEPER_ROLE: main (does the work at once) or backup (only work the main keeper left waiting ACT_AFTER_SEC). */
export const ROLES = ["main", "backup"];

/** Reads deployments/<chainId>.json (or `file`). Returns {} when it doesn't exist. */
export function loadDeployments(chainId, file) {
  const path = file ?? resolve(REPO_ROOT, "deployments", `${chainId}.json`);
  if (!existsSync(path)) return { path, contracts: {}, inputs: {} };
  const j = JSON.parse(readFileSync(path, "utf8"));
  return { path, ...j, contracts: j.contracts ?? {}, inputs: j.inputs ?? {} };
}

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

/** Builds the keeper's config from `env` (process.env by default). Throws with a readable message when something
 *  required is missing. Never returns or logs the key. */
export function loadConfig(env = process.env) {
  const e = (k, d) => (env[k] === undefined || env[k] === "" ? d : env[k]);
  const chainId = num(e("CHAIN_ID"), 4663);
  const dep = loadDeployments(chainId, e("DEPLOYMENTS_FILE"));
  const addr = (name) => {
    const v = e(CONTRACT_ENV[name] ?? OPTIONAL_ENV[name]) ?? dep.contracts[name];
    return v ? getAddress(v) : undefined;
  };
  const role = e("KEEPER_ROLE", "main").toLowerCase();
  if (!ROLES.includes(role)) throw new Error(`KEEPER_ROLE is "${role}": use main or backup.`);
  const backup = role === "backup";
  const production = e("NODE_ENV") === "production";
  const rpc = e("RPC_URL");
  if (!rpc) throw new Error("Set RPC_URL (the chain's RPC; on Railway a variable, in GitHub Actions a secret).");
  // a dead keeper must be noticed: in production (the Docker image sets NODE_ENV=production) both are required
  if (production && !e("HEARTBEAT_URL")) {
    throw new Error("Set HEARTBEAT_URL (a dead-man's switch, e.g. a healthchecks.io check, one per keeper service): in production a keeper that dies must raise an alarm by its silence.");
  }
  if (production && !e("ALERT_WEBHOOK_URL")) throw new Error("Set ALERT_WEBHOOK_URL (Discord / Slack / Telegram): in production somebody has to hear about problems.");
  const fallbackRpc = e("FALLBACK_RPC_URL", PUBLIC_RPC[chainId]);
  const mainKeeper = e("MAIN_KEEPER_ADDRESS");
  const cfg = {
    chainId,
    role,
    production,
    deploymentsPath: dep.path,
    startBlock: BigInt(e("START_BLOCK", dep.startBlock ?? 0)),
    rpcUrls: [rpc, ...(fallbackRpc && fallbackRpc !== "none" && fallbackRpc !== rpc ? [fallbackRpc] : [])],
    contracts: {
      plankTwap: addr("PlankUsdTwap"),
      paperTwap: addr("PaperUsdTwap"),
      cards: addr("FireCards"),
      psa: addr("FirePsa"),
      paperBurner: addr("PaperBurner"),
      plankBurner: addr("PlankBurner"),
    },
    ethUsdFeed: e("ETH_USD_FEED", dep.inputs.ETH_USD_FEED) ? getAddress(e("ETH_USD_FEED", dep.inputs.ETH_USD_FEED)) : undefined,
    drandUrls: e("DRAND_URLS") ? e("DRAND_URLS").split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_DRAND_URLS,
    // which Series to watch: SERIES=7,8 (else every Series found by probing ids 0..SERIES_SCAN and beyond)
    series: e("SERIES") ? e("SERIES").split(",").map((s) => BigInt(s.trim())) : undefined,
    seriesScan: num(e("SERIES_SCAN"), 64),
    optional: { sale: addr("FireSale"), cardsAdapter: addr("CardsAdapter"), psaAdapter: addr("PsaAdapter") },
    once: e("ONCE") === "1" || e("ONCE") === "true",
    label: e("KEEPER_LABEL", backup ? "backup" : "keeper"),
    intervalSec: num(e("INTERVAL_SEC"), backup ? 30 : 20),
    // only act on work that has waited this long (the backup: 5 min, so the main keeper normally does everything)
    actAfterSec: BigInt(num(e("ACT_AFTER_SEC"), backup ? 300 : 0)),
    // the backup: before each transaction, wait this long and check again (from the pending state) that the work is
    // still there, so a main keeper that just sent the same thing wins; and stand down while MAIN_KEEPER_ADDRESS (the
    // main keeper's wallet, optional) has a transaction waiting to be mined
    yieldMs: num(e("BACKUP_YIELD_MS"), backup ? 3000 : 0),
    mainKeeper: mainKeeper ? getAddress(mainKeeper) : undefined,
    // read-only calls batched through Multicall3 when the chain has it (auto), else one call each (off)
    multicall: e("MULTICALL", "auto") !== "off",
    // one-pass runs (ONCE=1): a file that keeps the alert memory between runs (the GitHub workflow caches it)
    stateFile: e("STATE_FILE"),
    onceAlertWindowMin: num(e("ONCE_ALERT_WINDOW_MIN"), 15),
    processMaxCards: BigInt(num(e("PROCESS_MAX_CARDS"), 120)),
    processCallsPerPass: num(e("PROCESS_CALLS_PER_PASS"), 10),
    fulfillBatch: num(e("FULFILL_BATCH"), 15),
    gradingLookback: num(e("GRADING_LOOKBACK"), 300),
    maxFeeGwei: e("MAX_FEE_GWEI") ? Number(e("MAX_FEE_GWEI")) : undefined,
    // alerts
    webhookUrl: e("ALERT_WEBHOOK_URL"),
    heartbeatUrl: e("HEARTBEAT_URL"),
    heartbeatHours: num(e("HEARTBEAT_HOURS"), 24),
    alertRepeatMin: num(e("ALERT_REPEAT_MIN"), 60),
    stuckMin: num(e("STUCK_MIN"), 10),
    plankStaleMin: num(e("PLANK_STALE_MIN"), 90),
    paperStaleHours: num(e("PAPER_STALE_HOURS"), 22),
    paperCandidateLateHours: num(e("PAPER_CANDIDATE_LATE_HOURS"), 3),
    ethStaleHours: num(e("ETH_STALE_HOURS"), 24),
    waitingAlertMin: num(e("WAITING_ALERT_MIN"), 60),
    drandLagRounds: BigInt(num(e("DRAND_LAG_ROUNDS"), 20)),
    clockSkewSec: num(e("CLOCK_SKEW_SEC"), 120),
    lowBalanceEth: num(e("LOW_BALANCE_ETH"), 0.01),
  };
  const missing = Object.entries(cfg.contracts).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`No address for ${missing.join(", ")}: deploy first (${dep.path}) or set the env overrides (${Object.values(CONTRACT_ENV).join(", ")}).`);
  }
  return cfg;
}

/** The key, from the environment only (a Railway variable or a GitHub secret). Accepts with or without 0x. */
export function loadKey(env = process.env) {
  const k = (env.KEEPER_PRIVATE_KEY ?? "").trim();
  if (!k) throw new Error("Set KEEPER_PRIVATE_KEY (the keeper's own gas-only wallet; a Railway variable or a GitHub secret, never in a file).");
  const hex = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("KEEPER_PRIVATE_KEY isn't a 32-byte hex key.");
  return hex;
}
