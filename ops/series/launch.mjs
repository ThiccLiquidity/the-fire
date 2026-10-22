// Launch a Series in one command: docs/deploy.md step 6 (snapshot -> fork rehearsal -> batch A on the hardware wallet
// -> VerifySeries GREEN -> "LOCK" -> batch B), one short line per check, OK / WARN / STOP.
//
//   PowerShell, from the repo:
//   $env:RPC = Read-Host "RPC URL"                     (or run ops\series\launch.ps1, which asks for it)
//   node ops\series\launch.mjs --recipe contracts\series\recipe-fire-7.json --start "2026-11-01 18:00" [--chain 46630]
//
// Steps: 0 preflight (chain, deployments, Series not locked, the Ledger is the owner, keeper alive, pack art, start
// time), 1 holder snapshot (only with a holder window), 2 fork rehearsal (batches A and B as the owner on a fork,
// nothing sent), 3 batch A (Ledger), 4 VerifySeries until GREEN, 5 confirm (type LOCK), 6 batch B (Ledger) and a
// read-back of the drop, 7 done.
//
// Run it again after any STOP: finished steps are skipped. Batch A and batch B are judged by the chain, not only by
// the state file (ops/series/out/series-<N>.state.json), so neither is ever sent twice. Everything it prints, and
// forge's output, goes to ops/series/out/series-<N>.log (on chains other than 4663: series-<N>.<chainId>.*).
//
// Options:
//   --recipe <file>      the studio's recipe.json (copied into contracts/series/ if it's elsewhere: forge reads only there)
//   --start "<time>"     when the sale opens, local time "YYYY-MM-DD HH:MM" (or unix seconds); else the state file's,
//                        else the recipe's sale.start
//   --chain <id>         4663 (default, mainnet) or 46630 (testnet)
//   --no-holders         the holder window lets only presses in (no snapshot); NO_HOLDERS=true for batch B
//   --new-snapshot       take a new snapshot even if one was taken for this Series already
//   --min-usd 69         the snapshot's minimum PLANK holding
//   --snapshot-blocks 5 --snapshot-days 7   the snapshot takes each wallet's smallest holding over that many blocks
//                        in that many days (ops/snapshot)
//   --allow <rule>,...   sale settings outside the policy that are meant (ops/series/sale-policy.mjs: price,
//                        burn-total, paper-burn, paper-per-pack, no-paper, paper-cap, wallet-limit, holder-window);
//                        anything else outside it stops the launch before batch A and again before LOCK
//   --gateways a,b       IPFS gateways for VerifySeries and the pack art check (default VerifySeries' list)
//   --verify-tries 4 --verify-wait 90   VerifySeries retries (seconds between) while images don't load yet
//   --key-env <VAR>      testnet/anvil only: sign with the private key in env var VAR instead of the Ledger (never
//                        printed; handed to forge as a throwaway encrypted keystore in a temp folder, deleted after)
//   --yes                tests only (refused on 4663): skip the LOCK question
//   --out-dir <dir>      where the state and log go (default ops/series/out)
// Settings: RPC (else RPC in contracts/.env), OWNER_HD_PATH (else contracts/.env), DEPLOYMENTS_FILE (rehearsals).
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash, randomBytes, randomUUID, scryptSync, createCipheriv } from "node:crypto";
import { dirname, resolve, relative, basename, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { createPublicClient, http, getAddress, keccak256, zeroHash, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifySeries, recipeFromJson, DEFAULT_GATEWAYS } from "./verify-series.mjs";
import { salePolicy, saleWallets, parseAllow, describeSale } from "./sale-policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const CONTRACTS = resolve(REPO, "contracts");
const SERIES_DIR = resolve(CONTRACTS, "series");
const MAINNET = 4663;
const CHARACTER_BATCH = 200;
const MIN_LEAD_SEC = 15 * 60; // the start must leave time to sign batch B
const MAX_AHEAD_SEC = 365 * 86400; // ConfigureSeries refuses more (a typo)
const KEEPER_STALE_SEC = 90 * 60; // the keeper alerts at 90 min; FireSale stops PLANK pricing at 2 h

const abi = (name) => JSON.parse(readFileSync(resolve(REPO, "web/src/lib/abi", `${name}Abi.json`), "utf8"));
const ABI = {
  dealer: abi("recipeDealer"), cards: abi("fireCards"), sale: abi("fireSale"), packs: abi("firePacks"),
  twap: [{ type: "function", name: "latestRoundData", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }], stateMutability: "view" }],
  ownable: [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
};

// ------------------------------------------------------------------ small pure helpers (unit-tested)

/** "2026-11-01 18:00" (local time), "2026-11-01T18:00", or unix seconds -> unix seconds (BigInt). */
export function parseStart(s, { utc = false } = {}) {
  const t = String(s).trim();
  if (/^\d{9,11}$/.test(t)) return BigInt(t);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) throw new Error(`start "${t}": use "YYYY-MM-DD HH:MM" (your local time) or unix seconds`);
  const [y, mo, d, h, mi, sec] = m.slice(1).map((x) => Number(x ?? 0));
  const date = utc ? new Date(Date.UTC(y, mo - 1, d, h, mi, sec)) : new Date(y, mo - 1, d, h, mi, sec);
  if (date.getFullYear() !== y && !utc) throw new Error(`start "${t}" isn't a real date`);
  if ((utc ? date.getUTCMonth() : date.getMonth()) !== mo - 1 || (utc ? date.getUTCDate() : date.getDate()) !== d) throw new Error(`start "${t}" isn't a real date`);
  return BigInt(Math.floor(date.getTime() / 1000));
}

/** Unix seconds -> "Sun 1 Nov 2026 18:00 local (18:00 UTC)". */
export function showTime(ts) {
  const d = new Date(Number(ts) * 1000);
  const local = d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const utc = d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${local} your time (${utc} UTC)`;
}

/** Owner confirmations batch A needs: setRecipe, setCharacters (+ appendCharacters), setDealer, setImagesBase. */
export const batchACalls = (json) => 1 + Math.ceil(json.characters.length / CHARACTER_BATCH) + 1 + (json.imagesBase ? 1 : 0);

/** Dollars with 8 decimals -> "$2.50". */
export const usd8 = (v) => `$${(Number(BigInt(v)) / 1e8).toFixed(2)}`;

/** What must stay the same for a finished step to count: the recipe, the start and the holder root. */
export function planHash(recipeText, start, root, noHolders) {
  return createHash("sha256").update(JSON.stringify([recipeText, String(start), root, !!noHolders])).digest("hex").slice(0, 16);
}

/** The differences between batch A on chain and the recipe (empty: batch A is on chain exactly). */
export async function batchADiffs(read, json, C) {
  const fire = BigInt(json.fire);
  const want = recipeFromJson(json);
  const diffs = [];
  const got = await read(C.RecipeDealer, ABI.dealer, "recipeOf", [fire]);
  const norm = (r) => JSON.stringify({
    types: r.types.map((t) => [t.name, t.slug, String(t.rank), Number(t.supply), String(t.amount), String(t.maxPerPack), Number(t.holoMode), t.holo.map(String)]),
    slots: r.slots.map((s) => [String(s.count), s.types.map(String), String(s.minRank), String(s.maxRank), !!s.mustHolo]),
  });
  if (norm(got) !== norm(want)) diffs.push("the recipe");
  const n = Number(await read(C.RecipeDealer, ABI.dealer, "characterCount", [fire]));
  if (n !== json.characters.length) diffs.push(`the characters (${n} on chain, ${json.characters.length} in the recipe)`);
  else {
    for (let from = 0; from < n; from += 200) {
      const [names, cats] = await read(C.RecipeDealer, ABI.dealer, "charactersOf", [fire, BigInt(from), 200n]);
      if (names.some((nm, k) => nm !== json.characters[from + k].name || cats[k] !== json.characters[from + k].category)) { diffs.push("a character's name or category"); break; }
    }
  }
  if (getAddress(await read(C.FireCards, ABI.cards, "dealerOf", [fire])) !== getAddress(C.RecipeDealer)) diffs.push("FireCards' dealer");
  if (json.imagesBase && (await read(C.FireCards, ABI.cards, "imagesBase", [fire])) !== json.imagesBase) diffs.push("the images folder");
  return diffs;
}

/** Every FireSale.DropConfig number (the recipe's sale block). */
export const DROP_FIELDS = ["start", "packs", "starters", "plankOnly", "walletLimit", "starterWindow", "liftAfter", "plankBurnBps", "paperBurnBps",
  "priceUsd", "paperPerPack", "paperCapUsd", "holderWindow", "maxPerTx", "plankOnlyFor", "regularWalletsFor", "starterPerPress",
  "starterWalletLimit", "starterPriceUsd", "starterPaper", "creditsPerPick", "creditPacksMax", "creditPacksPerWallet"];

/** The drop on chain against what batch B was meant to set (every field given in `want`). Returns the differences. */
export function dropDiffs(drop, want) {
  const d = [];
  for (const k of DROP_FIELDS) {
    if (want[k] === undefined || drop[k] === undefined) continue;
    const meant = k === "maxPerTx" && BigInt(want[k]) === 0n ? 50n : BigInt(want[k]); // FireSale stores 0 as its default, 50
    if (BigInt(drop[k]) !== meant) d.push(`${k} ${drop[k]} (meant ${meant})`);
  }
  if (want.holderRoot !== undefined && drop.holderRoot.toLowerCase() !== want.holderRoot.toLowerCase()) d.push(`holderRoot ${drop.holderRoot} (meant ${want.holderRoot})`);
  return d;
}

/** A standard (V3, scrypt) encrypted keystore for `privateKey`, so forge can sign without the key on its command line. */
export function keystoreV3(privateKey, password, { n = 8192 } = {}) {
  const key = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const dk = scryptSync(Buffer.from(password), salt, 32, { N: n, r: 8, p: 1, maxmem: 256 * n * 8 + 1024 });
  const c = createCipheriv("aes-128-ctr", dk.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([c.update(key), c.final()]);
  const mac = keccak256(Buffer.concat([dk.subarray(16, 32), ciphertext])).slice(2);
  return {
    version: 3, id: randomUUID(), address: privateKeyToAccount(`0x${key.toString("hex")}`).address.slice(2).toLowerCase(),
    crypto: { cipher: "aes-128-ctr", cipherparams: { iv: iv.toString("hex") }, ciphertext: ciphertext.toString("hex"), kdf: "scrypt", kdfparams: { dklen: 32, n, r: 8, p: 1, salt: salt.toString("hex") }, mac },
  };
}

/** KEY=value lines (quotes stripped) from a .env file; {} if it isn't there. */
export function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const l of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (!m || !m[2]) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

// ------------------------------------------------------------------ the launcher

class Stop extends Error {}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith("--")) { a[k] = v; i++; } else a[k] = true;
  }
  return a;
}

const bin = (n) => {
  for (const d of [resolve(homedir(), ".foundry/bin"), "/root/.foundry/bin"]) for (const f of [n, `${n}.exe`]) if (existsSync(resolve(d, f))) return resolve(d, f);
  return n;
};

export async function launch(argv, { env = process.env, stdout = console.log, ask } = {}) {
  const args = parseArgs(argv);
  if (!args.recipe || args.help) {
    stdout('usage: node ops\\series\\launch.mjs --recipe <recipe.json> [--start "YYYY-MM-DD HH:MM"] [--chain 4663|46630] [--no-holders] [--key-env VAR (testnet)]');
    return 2;
  }
  const chainWanted = Number(args.chain ?? MAINNET);
  const dotEnv = readDotEnv(resolve(CONTRACTS, ".env"));
  const outDir = resolve(typeof args["out-dir"] === "string" ? args["out-dir"] : resolve(here, "out"));
  const show = (p) => relative(process.cwd(), p) || ".";
  let logFile;
  const toLog = (text) => { if (logFile) try { appendFileSync(logFile, `${new Date().toISOString()}  ${text}\n`); } catch { /* best effort */ } };
  const print = (text) => { stdout(text); toLog(text); };
  const ok = (t) => print(`   OK    ${t}`);
  const warn = (t) => print(`   WARN  ${t}`);
  const note = (t) => print(`         ${t}`);
  const stop = (t) => { throw new Stop(t); };
  const head = (n, t) => print(`\n${n}  ${t}`);

  let state;
  let stateFile;
  const save = () => { if (stateFile) writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`); };
  let keyDir;

  try {
    // ---------------------------------------------------------------- 0. preflight
    const recipeArg = resolve(args.recipe);
    if (!existsSync(recipeArg)) stop(`No recipe at ${show(recipeArg)}.`);
    const recipeText = readFileSync(recipeArg, "utf8");
    let json;
    try { json = JSON.parse(recipeText); } catch (e) { stop(`${show(recipeArg)} isn't valid JSON: ${e.message}`); }
    if (!Number.isInteger(json.fire) || json.fire < 1) stop("The recipe has no Series number (\"fire\").");
    if (!json.sale) stop("The recipe has no sale block: set the sale up in the studio and export again.");
    if (!json.imagesBase) stop("The recipe has no imagesBase: upload the images in the studio and export again.");
    if (!Array.isArray(json.characters) || json.characters.length === 0) stop("The recipe has no characters.");
    const N = json.fire;
    const tag = chainWanted === MAINNET ? `series-${N}` : `series-${N}.${chainWanted}`;
    mkdirSync(outDir, { recursive: true });
    logFile = resolve(outDir, `${tag}.log`);
    stateFile = resolve(outDir, `${tag}.state.json`);
    toLog(`---- launch ${argv.join(" ")}`);
    print(`Launch Series ${N} on chain ${chainWanted}. Log: ${show(logFile)}`);
    head(0, "Preflight");

    const keyMode = typeof args["key-env"] === "string";
    if (chainWanted === MAINNET && keyMode) stop("--key-env is for testnet and anvil only. On mainnet the Ledger signs.");
    if (chainWanted === MAINNET && args.yes) stop("--yes is for tests only. On mainnet you type LOCK.");

    // the recipe must be under contracts/series/ (the only folder forge may read)
    let recipePath = recipeArg;
    const rel = relative(SERIES_DIR, recipeArg);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      recipePath = resolve(SERIES_DIR, basename(recipeArg));
      if (existsSync(recipePath) && readFileSync(recipePath, "utf8") !== recipeText) stop(`${show(recipePath)} exists and differs from ${show(recipeArg)}. Move one away.`);
      copyFileSync(recipeArg, recipePath);
      ok(`Recipe copied to ${show(recipePath)} (forge reads only contracts${sep}series).`);
    }
    ok(`Recipe: Series ${N}, ${json.types.length} card types, ${json.characters.length} characters.`);

    const rpc = env.RPC ?? env.RPC_URL ?? dotEnv.RPC;
    if (!rpc) stop('No RPC. Set it first: $env:RPC = Read-Host "RPC URL" (or run ops\\series\\launch.ps1).');
    const client = createPublicClient({ transport: http(rpc, { retryCount: 3, timeout: 30_000 }) });
    let chainId;
    try { chainId = await client.getChainId(); } catch (e) { stop(`The RPC doesn't answer: ${e?.shortMessage ?? e?.message}`); }
    if (chainId !== chainWanted) stop(`The RPC is chain ${chainId}, not ${chainWanted}. Check $env:RPC or --chain.`);
    ok(`RPC answers on chain ${chainId}.`);
    const read = (address, abi_, functionName, args_ = []) => client.readContract({ address, abi: abi_, functionName, args: args_ });

    const depFile = env.DEPLOYMENTS_FILE ? resolve(env.DEPLOYMENTS_FILE) : resolve(REPO, "deployments", `${chainId}.json`);
    if (!existsSync(depFile)) stop(`No ${show(depFile)}: deploy first.`);
    const dep = JSON.parse(readFileSync(depFile, "utf8"));
    const C = {};
    for (const n of ["RecipeDealer", "FireCards", "FireSale", "FirePacks", "PlankUsdTwap"]) {
      if (!dep.contracts?.[n]) stop(`${n} is missing from ${show(depFile)}.`);
      C[n] = getAddress(dep.contracts[n]);
    }
    if (dep.contracts.PaperUsdTwap) C.PaperUsdTwap = getAddress(dep.contracts.PaperUsdTwap);
    if (!dep.owner) stop(`${show(depFile)} has no owner.`);
    const owner = getAddress(dep.owner);
    for (const n of ["FireCards", "RecipeDealer", "FireSale"]) {
      const o = getAddress(await read(C[n], ABI.ownable, "owner"));
      if (o !== owner) stop(`${n} is owned by ${o}, not the owner ${owner} in ${show(depFile)}. Finish AcceptOwnership first.`);
    }
    ok(`Contracts from ${show(depFile)}; the owner ${owner} holds them.`);
    if (existsSync(`${depFile}.pending`)) warn(`${show(depFile)}.pending is waiting: a deploy isn't recorded yet.`);

    const fire = BigInt(N);
    const fireInfo = await read(C.FireCards, ABI.cards, "fires", [fire]);
    const dropNow = await read(C.FireSale, ABI.sale, "dropOf", [fire]);
    const launched = fireInfo[2] && dropNow.start !== 0n;
    if (fireInfo[2] && !launched) stop(`Series ${N} is locked but has no drop. Check it by hand.`);

    // state (from an earlier run)
    state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
    if (state.chainId !== undefined && state.chainId !== chainId) stop(`${show(stateFile)} is for chain ${state.chainId}.`);
    state = { chainId, fire: N, recipe: show(recipePath), steps: {}, ...state };
    if (Object.keys(state.steps).length) ok(`Resuming: done before: ${Object.keys(state.steps).join(", ")}.`);

    if (launched) {
      ok(`Series ${N} is already locked with a drop: nothing to send. Checking the drop.`);
    } else {
      const active = await read(C.FireSale, ABI.sale, "activeDrops");
      if (active !== 0n) stop("Another drop is still open. FireSale takes the next one only after it closes.");
      ok(`Series ${N} isn't locked yet, and no other drop is open.`);
    }

    // the signer
    let signerArgs;
    if (keyMode && !launched) {
      const pk = env[args["key-env"]];
      if (!pk || !/^(0x)?[0-9a-fA-F]{64}$/.test(pk.trim())) stop(`$env:${args["key-env"]} doesn't hold a private key.`);
      const account = privateKeyToAccount(`0x${pk.trim().replace(/^0x/, "")}`);
      if (getAddress(account.address) !== owner) stop(`The key in $env:${args["key-env"]} is ${account.address}, not the owner ${owner}.`);
      keyDir = mkdtempSync(resolve(tmpdir(), "launch-"));
      const password = randomBytes(24).toString("hex");
      const ks = resolve(keyDir, "owner.json");
      writeFileSync(ks, JSON.stringify(keystoreV3(pk.trim(), password)), { mode: 0o600 });
      writeFileSync(resolve(keyDir, "pass"), password, { mode: 0o600 });
      signerArgs = ["--keystore", ks, "--password-file", resolve(keyDir, "pass"), "--sender", owner];
      ok(`Signing with the key in $env:${args["key-env"]} (the owner). Testnet/anvil mode.`);
    } else if (!launched) {
      const hd = env.OWNER_HD_PATH ?? dotEnv.OWNER_HD_PATH;
      if (!hd) stop(`No OWNER_HD_PATH. Set it: $env:OWNER_HD_PATH = "m/44'/60'/1'/0/0" (your Ledger account).`);
      note("Ledger: close Ledger Live, unlock the device, open the Ethereum app, Blind signing on.");
      let addr;
      try {
        addr = execFileSync(bin("cast"), ["wallet", "address", "--ledger", "--hd-path", hd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim();
      } catch (e) {
        toLog(String(e.stderr ?? e.message));
        if (e.code === "ENOENT") stop("cast isn't installed (Foundry). Install it with foundryup, then run again.");
        stop("Can't read the Ledger. Unlock it, open the Ethereum app, close Ledger Live, and run again.");
      }
      if (getAddress(addr) !== owner) stop(`The Ledger account at ${hd} is ${addr}, not the owner ${owner}. Check OWNER_HD_PATH.`);
      signerArgs = ["--ledger", "--hd-paths", hd, "--sender", owner];
      ok(`The Ledger account at ${hd} is the owner.`);
    }
    if (!launched) {
      const bal = await client.getBalance({ address: owner });
      if (bal === 0n) stop(`The owner ${owner} has no ETH for gas.`);
      if (bal < 10n ** 15n) warn(`The owner has only ${formatEther(bal)} ETH for gas.`);
    }

    // keeper alive: the PLANK checkpoint is recent; the PAPER feed live
    const chainNow = async () => (await client.getBlock()).timestamp;
    const now0 = await chainNow();
    try {
      const [, px, , updated] = await read(C.PlankUsdTwap, ABI.twap, "latestRoundData");
      const age = now0 - updated;
      if (px > 0n && age <= KEEPER_STALE_SEC) ok(`Keeper alive: PLANK price checkpointed ${age / 60n} min ago.`);
      else warn(px === 0n ? "No PLANK price yet: is the keeper running?" : `PLANK price is ${age / 60n} min old: is the keeper running? (FireSale stops PLANK pricing at 2 h)`);
    } catch { warn("Couldn't read the PLANK price feed."); }
    if (C.PaperUsdTwap) {
      try {
        const [, px] = await read(C.PaperUsdTwap, ABI.twap, "latestRoundData");
        if (px > 0n) ok("PAPER price feed is live.");
        else warn("PAPER price feed isn't live yet: packs take the set PAPER, no dollar ceiling.");
      } catch { warn("Couldn't read the PAPER price feed."); }
    }

    // pack art
    const gateways = typeof args.gateways === "string" ? args.gateways.split(",").map((s) => s.trim()) : DEFAULT_GATEWAYS;
    const packBase = await read(C.FirePacks, ABI.packs, "packImageBase");
    if (!packBase) warn("FirePacks has no pack art folder (setPackImageBase).");
    else {
      const file = `${packBase}fire${N}.webp`;
      const url = file.startsWith("ipfs://") ? `${gateways[0]}${file.slice(7)}` : file;
      let found = false;
      try { const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) }); found = r.ok; } catch { /* not found */ }
      if (found) ok(`Pack art is there: ${file}`);
      else warn(`Pack art not found at ${url}. Upload fire${N}.webp before the sale.`);
    }

    // start time
    let start;
    if (args.start !== undefined && args.start !== true) {
      try { start = parseStart(args.start); } catch (e) { stop(e.message); }
    } else if (state.start) start = BigInt(state.start);
    else if (Number(json.sale.start) > 0) start = BigInt(json.sale.start);
    else stop('No start time. Add --start "YYYY-MM-DD HH:MM" (your local time).');
    const wall = BigInt(Math.floor(Date.now() / 1000));
    const nowMax = now0 > wall ? now0 : wall;
    if (launched) {
      start = dropNow.start;
    } else {
      if (start <= nowMax + BigInt(MIN_LEAD_SEC)) stop(`The start (${showTime(start)}) must be at least 15 minutes from now.`);
      if (start >= now0 + BigInt(MAX_AHEAD_SEC)) stop(`The start (${showTime(start)}) is more than a year away: a typo?`);
      ok(`Sale opens ${showTime(start)} (unix ${start}).`);
    }

    // sale settings: the policy and the wallets, before anything is sent (and again before LOCK)
    const holderWindow = Number(json.sale.holderWindow ?? 0);
    const noHolders = !!args["no-holders"];
    let allow;
    try { allow = parseAllow(args.allow); } catch (e) { stop(e.message); }
    const saleGate = async (root_) => {
      const pol = salePolicy(json.sale, { allow, holderRoot: root_, noHolders });
      const wallets = await saleWallets(read, C.FireSale, dep);
      for (const p of pol) if (p.level === "warn") warn(`Sale: ${p.text}.`);
      for (const p of pol) if (p.level === "allowed") warn(`Sale: ${p.text}.`);
      const red = [...pol.filter((p) => p.level === "red").map((p) => p.text), ...wallets.filter((w) => !w.ok).map((w) => w.text)];
      if (red.length) stop(`The sale settings are outside the policy or the wallets are wrong: ${red.join("; ")}. Fix the recipe's sale block (or the wallets) and run again.`);
      return wallets;
    };
    if (!launched) {
      // the snapshot (step 1) gives the root; a presses-only window needs --no-holders
      const w = await saleGate(holderWindow > 0 && !noHolders ? "0x01" : undefined);
      ok(`Sale settings inside the policy; revenue wallet and burners are the deployments file's (${w.length} checked).`);
    }

    // ---------------------------------------------------------------- 1. holder snapshot
    head(1, "Holder snapshot");
    let root = zeroHash;
    let snapPath;
    if (launched) {
      ok("Skipped: the drop is already set.");
    } else if (holderWindow === 0) {
      ok("No holder window in this sale: no snapshot needed.");
      state.steps.snapshot = { none: true };
    } else if (noHolders) {
      warn("--no-holders: during the holder window only presses can buy.");
      state.steps.snapshot = { none: true, noHolders: true };
    } else {
      snapPath = resolve(dirname(recipePath), `fire-${N}-holders.json`);
      const prev = state.steps.snapshot;
      if (prev?.root && prev.file && existsSync(resolve(REPO, prev.file)) && !args["new-snapshot"]) {
        snapPath = resolve(REPO, prev.file);
        root = prev.root;
        ok(`Using the snapshot taken ${prev.at}: ${prev.count} wallets, root ${root}.`);
      } else {
        note("Taking the PLANK-holder snapshot (a few minutes on mainnet)...");
        const minUsd = String(args["min-usd"] ?? 69);
        const extra = [];
        for (const k of ["blocks", "days"]) if (typeof args[`snapshot-${k}`] === "string") extra.push(`--${k}`, args[`snapshot-${k}`]);
        const r = await run(process.execPath, [resolve(REPO, "ops/snapshot/snapshot.mjs"), "--min-usd", minUsd, "--out", snapPath, ...extra], {
          cwd: resolve(REPO, "ops/snapshot"), env: { ...env, RPC: rpc, DEPLOYMENTS_FILE: depFile },
        }, (t) => toLog(t.split(rpc).join("<RPC>")));
        if (r.code !== 0) stop(`The snapshot failed: ${lastError(r.out)}`);
        const snap = JSON.parse(readFileSync(snapPath, "utf8"));
        root = snap.root;
        state.steps.snapshot = { file: relative(REPO, snapPath).split(sep).join("/"), root, count: snap.count, block: snap.block, blocks: snap.blocks, at: new Date().toISOString() };
        save();
        ok(`${snap.count} wallets hold $${minUsd}+ of PLANK. Root ${root}. Saved ${show(snapPath)}.`);
      }
    }
    const bEnv = { DROP_START: String(start), HOLDER_ROOT: root, ...(noHolders ? { NO_HOLDERS: "true" } : {}) };
    const plan = planHash(recipeText, start, root, noHolders);
    if (state.plan && state.plan !== plan && !launched) {
      for (const k of ["rehearsal", "verify"]) delete state.steps[k];
      note("The recipe, start or holder root changed since the last run: rehearsing and verifying again.");
    }
    if (!launched) { state.plan = plan; state.start = String(start); state.holderRoot = root; save(); }

    // forge, from contracts/ (the RPC URL is shown as <RPC> in the log: it can hold an API key)
    const forgeExtra = (env.LAUNCH_FORGE_ARGS ?? "").split(" ").filter(Boolean); // tests only (--offline --use <solc>)
    const forge = (extra, extraEnv) => run(bin("forge"), ["script", "script/ConfigureSeries.s.sol", ...extra, ...forgeExtra], {
      cwd: CONTRACTS,
      env: { ...env, ...extraEnv, RECIPE_JSON: recipePath, DEPLOYMENTS_FILE: depFile, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
    }, (t) => toLog(t.split(rpc).join("<RPC>")));

    // ---------------------------------------------------------------- 2. fork rehearsal
    head(2, "Fork rehearsal (batches A and B as the owner on a copy of the chain; nothing is sent)");
    if (launched) ok("Skipped: the drop is already set.");
    else if (state.steps.rehearsal?.plan === plan) ok("Passed before for this recipe and start.");
    else {
      const r = await forge(["--fork-url", rpc], { BATCH: "AB", SIMULATE: "true", ...bEnv });
      if (r.code !== 0 || !/simulated OK: FireSale\.configureDrop/.test(r.out)) stop(`The rehearsal failed: ${lastError(r.out)}`);
      state.steps.rehearsal = { plan, at: new Date().toISOString() };
      save();
      ok(`Batch A (${batchACalls(json)} calls) and batch B (configureDrop) pass as the owner.`);
    }

    // ---------------------------------------------------------------- 3. batch A
    head(3, "Batch A: the content (recipe, characters, dealer, images; nothing locks yet)");
    if (launched) ok("Skipped: the drop is already set.");
    else {
      const diffs = await batchADiffs(read, json, C);
      if (diffs.length === 0) {
        ok("Batch A is already on chain exactly as the recipe says: not sent again.");
      } else {
        const n = batchACalls(json);
        if (keyMode) note(`Sending ${n} transactions from the owner key...`);
        else note(`Confirm ${n} transactions on the Ledger, one by one. Each goes to RecipeDealer ${C.RecipeDealer} or FireCards ${C.FireCards}.`);
        const r = await forge(["--rpc-url", rpc, ...signerArgs, "--slow", "--broadcast"], { BATCH: "A" });
        if (r.code !== 0) stop(`Batch A failed: ${lastError(r.out)} Run again to retry (what landed is re-set, harmless).`);
        const after = await batchADiffs(read, json, C);
        if (after.length) stop(`Batch A was sent but the chain differs in ${after.join(", ")}. Run again.`);
        ok(`Batch A is on chain (${n} transactions).`);
        delete state.steps.verify;
      }
      state.steps.batchA = { at: state.steps.batchA?.at ?? new Date().toISOString() };
      save();
    }

    // ---------------------------------------------------------------- 4. VerifySeries
    head(4, "VerifySeries (reads it all back; loads every image through the gateways)");
    if (launched) ok("Skipped: the drop is already set.");
    else if (state.steps.verify?.plan === plan) ok(`GREEN before (${state.steps.verify.at}).`);
    else {
      const tries = Number(args["verify-tries"] ?? 4);
      const waitSec = Number(args["verify-wait"] ?? 90);
      for (let i = 1; ; i++) {
        let v;
        try {
          v = await verifySeries({
            client, recipe: json, deploymentsFile: depFile, gateways, snapshotPath: snapPath, holderRoot: root === zeroHash ? undefined : root,
            allow, noHolders, log: (l) => toLog(`verify: ${l}`),
          });
        } catch (e) {
          v = { green: false, problems: [`VerifySeries couldn't run: ${e?.shortMessage ?? e?.message ?? e}`], warnings: [], retry: true };
        }
        if (v.green) {
          for (const w of v.warnings) warn(w);
          ok(`GREEN: ${v.images} images load from ${gateways.length >= 2 ? "two or more" : "the"} gateways; recipe, characters, images folder${snapPath ? ", holder root" : ""} match.`);
          state.steps.verify = { plan, at: new Date().toISOString(), images: v.images };
          save();
          break;
        }
        const retryable = v.retry || v.problems.every((p) => /image loads from at least/.test(p));
        for (const p of v.problems.slice(0, 5)) print(`   RED   ${p}`);
        if (v.problems.length > 5) note(`(${v.problems.length - 5} more in the log)`);
        if (!retryable || i >= tries) stop(retryable ? `VerifySeries is RED after ${i} tries: some images don't load. Pin them, then run again.` : "VerifySeries is RED. Fix the recipe or the images, then run again. Don't lock.");
        note(`Some images don't load yet (new pins take a while). Trying again in ${waitSec} s (${i + 1} of ${tries}).`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      }
    }

    // ---------------------------------------------------------------- 5. confirm
    const sale = json.sale;
    if (!launched) {
      head(5, "Confirm");
      // the policy and the wallets again, read fresh (the owner could have changed a wallet since)
      const wallets = await saleGate(root === zeroHash ? undefined : root);
      note(`Series ${N}, every sale setting:`);
      for (const l of describeSale(sale, { start: showTime(start), holderRoot: root === zeroHash ? undefined : root, noHolders })) note(`  ${l}`);
      for (const w of wallets) note(`  ${w.text}`);
      const now1 = await chainNow();
      const wall1 = BigInt(Math.floor(Date.now() / 1000));
      if (start <= (now1 > wall1 ? now1 : wall1) + 120n) stop("The start is less than 2 minutes away now. Run again with a later --start.");
      const question = `Lock Series ${N} and open sales at ${showTime(start)}? Type LOCK to continue: `;
      let answer;
      if (args.yes) { answer = "LOCK"; note("--yes (test run): answered LOCK."); }
      else answer = await (ask ?? askLine)(question);
      toLog(`asked: ${question} answer: ${answer}`);
      if (String(answer).trim() !== "LOCK") stop("Not locked. Nothing more was sent. Run again when ready.");
    }

    // ---------------------------------------------------------------- 6. batch B
    head(6, "Batch B: the lock (configureDrop)");
    let drop = dropNow;
    if (!launched) {
      const already = await read(C.FireSale, ABI.sale, "dropOf", [fire]);
      if (already.start !== 0n) ok("The drop is already on chain: not sent again.");
      else {
        if (keyMode) note("Sending 1 transaction from the owner key...");
        else note(`Confirm 1 transaction on the Ledger: FireSale ${C.FireSale}.`);
        const r = await forge(["--rpc-url", rpc, ...signerArgs, "--slow", "--broadcast"], { BATCH: "B", ...bEnv });
        if (r.code !== 0) stop(`Batch B failed: ${lastError(r.out)}`);
      }
      drop = await read(C.FireSale, ABI.sale, "dropOf", [fire]);
    }
    const want = { ...Object.fromEntries(DROP_FIELDS.map((k) => [k, sale[k]])), start: state.start ?? start, holderRoot: state.holderRoot };
    const locked = (await read(C.FireCards, ABI.cards, "fires", [fire]))[2];
    const dd = dropDiffs(drop, want);
    if (!locked || drop.start === 0n) stop("The drop isn't on chain. Run again.");
    if (dd.length) stop(`The drop on chain differs: ${dd.join("; ")}. Check it before the sale opens.`);
    ok(`FireSale's drop for Series ${N}: opens ${showTime(drop.start)}, ${drop.packs} + ${drop.starters} packs, ${usd8(drop.priceUsd)}. Series locked.`);
    state.steps.batchB = { at: state.steps.batchB?.at ?? new Date().toISOString() };
    state.done = true;
    save();

    // ---------------------------------------------------------------- 7. done
    head(7, "Done");
    note(`The sale opens by itself at ${showTime(drop.start)}.`);
    note("The keeper does the rest: price checkpoints, drand, dealing opened packs, gradings, burns.");
    note("Next: FireCredits.pickSuggestions as usual, and give the site the holder snapshot file.");
    note(`Log: ${show(logFile)}`);
    return 0;
  } catch (e) {
    if (e instanceof Stop) {
      print(`   STOP  ${e.message}`);
      if (logFile) print(`\nStopped. Fix that and run the same command again: finished steps are skipped. Log: ${show(logFile)}`);
      return 1;
    }
    print(`   STOP  Unexpected error: ${e?.shortMessage ?? e?.message ?? e}`);
    toLog(String(e?.stack ?? e));
    return 1;
  } finally {
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  }
}

async function askLine(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(q); } finally { rl.close(); }
}

/** Runs a command; its output goes only to the log. Resolves { code, out }. */
function run(cmd, argv, { cwd, env }, log) {
  log(`$ ${basename(cmd)} ${argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
  return new Promise((res) => {
    let out = "";
    const p = spawn(cmd, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const take = (d) => { const s = d.toString(); out += s; log(s.replace(/\n$/, "")); };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    p.on("error", (e) => { out += `\nError: ${e.message}`; res({ code: 1, out }); });
    p.on("close", (code) => res({ code, out }));
  });
}

/** The most useful line of a failed command's output. */
export function lastError(out) {
  const lines = String(out).split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = lines.find((l) => /SIMULATION FAILED|revert(ed)?:|script failed|Error:/i.test(l)) ?? lines.at(-1) ?? "no output";
  return `${pick.replace(/^Error:\s*/i, "").slice(0, 300)}.`.replace(/\.\.$/, ".");
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = await launch(process.argv.slice(2));
  process.exit(code);
}
