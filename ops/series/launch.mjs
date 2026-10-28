// Launch a Series in one command: docs/deploy.md step 6 (snapshot -> fork rehearsal -> batch A on the hardware wallet
// -> VerifySeries GREEN -> "LOCK" -> batch B), one short line per check, OK / WARN / STOP.
//
//   PowerShell, from the repo:
//   $s = Read-Host "RPC URL" -AsSecureString; $env:RPC = [System.Net.NetworkCredential]::new("", $s).Password
//   (typed hidden: an Alchemy URL holds a key; or run ops\series\launch.ps1, which asks for it)
//   node ops\series\launch.mjs --recipe contracts\series\recipe-fire-7.json --start "2026-11-01 18:00" [--chain 46630]
//
// Steps: 0 preflight (chain, deployments, Series not locked, the Ledger is the owner, keeper alive, pack art, start
// time, the sale policy), 1 holder snapshots (one per snapshot group), 2 fork rehearsal (batches A and B as the owner
// on a fork, nothing sent), 3 batch A (Ledger), 4 VerifySeries until GREEN, 5 confirm (type LOCK), 6 batch B (Ledger),
// a read-back of the drop and its groups, and the holders file for the site, 7 done.
//
// Snapshot groups: their snapshots are described in a small side file next to the recipe, fire-<N>-snapshots.json
// (--snapshots <file> for another), keyed by the group's index in sale.groups (0 is the first group, as GROUP_ROOT_<i>):
//   { "1": { "token": "plank", "minUsd": 69, "days": 7 },
//     "4": { "token": "0x...", "min": "1000000", "tiers": "1000000:1,10000000:2", "allowance": 1, "blocks": 5 } }
//   token: an address, "plank" or "press" (the deployments file's PLANK / MILL); min (whole tokens or NFTs) or minUsd
//   (PLANK only, dollars; then the tiers are dollars too); tiers "<min>:<packs>,..."; allowance (default 1); days
//   (default 7, or --snapshot-days); blocks (default 5, or --snapshot-blocks); or "file": a snapshot taken by hand
//   with ops/snapshot (VerifySeries rebuilds it from the chain all the same). The recipe JSON's own keys are strict
//   (ConfigureSeries), so these live here. Each snapshot's root goes to batch B as GROUP_ROOT_<i>, and after the lock
//   every group's wallets, allowances and proofs go to the site: web/art/factory/forge/holders/series-<N>.json
//   (--holders-out <file> for another place; format in ops/README.md).
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
//   --snapshots <file>   the snapshot groups' side file (default fire-<N>-snapshots.json next to the recipe)
//   --new-snapshot       take new snapshots even if they were taken for this Series already
//   --snapshot-blocks 5 --snapshot-days 7   defaults for the side file: each wallet's smallest holding over that many
//                        blocks in that many days (ops/snapshot)
//   --holders-out <file> where the site's holders file goes (default web/art/factory/forge/holders/series-<N>.json)
//   --allow <rule>,...   sale settings outside the policy that are meant (ops/series/sale-policy.mjs: price,
//                        burn-total, paper-per-pack, no-paper, paper-cap, wallet-limit, limit-lifts, tax, idle);
//                        anything else outside it stops the launch before batch A and again before LOCK
//   --gateways a,b       IPFS gateways for VerifySeries and the pack art check (default VerifySeries' list)
//   --verify-tries 4 --verify-wait 90   VerifySeries retries (seconds between) while images don't load yet
//   --skip-image-check   testnet only (refused on 4663): VerifySeries doesn't load the images through the gateways
//   --image-sample N     testnet only (refused on 4663): VerifySeries loads N random images instead of all of them
//                        (public gateways can throttle a full check for an hour; the studio read every image back)
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
import { createPublicClient, http, getAddress, keccak256, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifySeries, recipeFromJson, characterWeightsFromJson, DEFAULT_GATEWAYS } from "./verify-series.mjs";
import { salePolicy, saleWallets, parseAllow, describeSale, normSale, nftCodeOf, dropDiffs } from "./sale-policy.mjs";
import { saleAbi, groupsAbi } from "./sale-abi.mjs";
import { requirePatchedNode } from "../keeper/src/node-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const CONTRACTS = resolve(REPO, "contracts");
const SERIES_DIR = resolve(CONTRACTS, "series");
const MAINNET = 4663;
const CHARACTER_BATCH = 200;
// every vm.env* name ConfigureSeries (and Deployments.sol under it) reads; each forge run sets all of them (see forge)
const FORGE_ENV = ["BATCH", "SIMULATE", "FIRE_SALE", "RECIPE_DEALER", "FIRE_CARDS", "CHARACTER_BATCH", "DROP_START", "MILL",
  ...Array.from({ length: 8 }, (_, i) => `GROUP_ROOT_${i}`)];
const MIN_LEAD_SEC = 15 * 60; // the start must leave time to sign batch B
const MAX_AHEAD_SEC = 365 * 86400; // ConfigureSeries refuses more (a typo)
const KEEPER_STALE_SEC = 90 * 60; // the keeper alerts at 90 min; FireSale stops PLANK pricing at 2 h

const abi = (name) => JSON.parse(readFileSync(resolve(REPO, "web/src/lib/abi", `${name}Abi.json`), "utf8"));
const ABI = {
  dealer: abi("recipeDealer"), cards: abi("fireCards"), sale: saleAbi, groups: groupsAbi, packs: abi("firePacks"),
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

/** What must stay the same for a finished step to count: the recipe, the start and the snapshot groups' roots. */
export function planHash(recipeText, start, roots = {}) {
  const r = Object.keys(roots).sort((a, b) => Number(a) - Number(b)).map((k) => [k, String(roots[k]).toLowerCase()]);
  return createHash("sha256").update(JSON.stringify([recipeText, String(start), r])).digest("hex").slice(0, 16);
}

const SIDE_KEYS = ["token", "min", "minUsd", "tiers", "allowance", "days", "blocks", "file", "fromBlock", "step"];

/** The snapshot groups' side file (fire-<N>-snapshots.json): { "<group index>": spec }. Checked against the recipe's
 *  groups: every snapshot group has a spec, and nothing else does. Returns { [i]: spec }; throws a readable error. */
export function snapshotSpecs(side, groups) {
  const out = {};
  for (const [k, v] of Object.entries(side ?? {})) {
    if (!/^\d+$/.test(k)) throw new Error(`"${k}": the keys are group indexes ("0" is the first group)`);
    const g = groups[Number(k)];
    if (!g) throw new Error(`"${k}": the recipe has no group of index ${k} (${groups.length} groups; "0" is the first)`);
    if (g.gate !== "snapshot") throw new Error(`"${k}": group ${Number(k) + 1}${g.name ? ` (${g.name})` : ""} isn't a snapshot group (gate ${g.gate})`);
    const bad = Object.keys(v ?? {}).filter((x) => !SIDE_KEYS.includes(x));
    if (bad.length) throw new Error(`"${k}": unknown key(s) ${bad.join(", ")} (keys: ${SIDE_KEYS.join(", ")})`);
    if (!v.file) {
      if (!v.token) throw new Error(`"${k}": no token (an address, "plank" or "press")`);
      if (v.min !== undefined && v.minUsd !== undefined) throw new Error(`"${k}": min or minUsd, not both`);
      if (v.min === undefined && v.minUsd === undefined && v.tiers === undefined) throw new Error(`"${k}": give min (tokens or NFTs), minUsd (PLANK, dollars) or tiers`);
    }
    out[k] = v;
  }
  groups.forEach((g, i) => {
    if (g.gate === "snapshot" && !out[i]) throw new Error(`group ${i + 1}${g.name ? ` (${g.name})` : ""} is a snapshot group: say whose wallets it takes under its index, e.g. "${i}": { "token": "plank", "minUsd": 69, "days": 7 }`);
  });
  return out;
}

/** ops/snapshot's arguments for one spec. */
export function snapshotArgs(spec, { out, days, blocks }) {
  const a = ["--token", String(spec.token), "--out", out];
  if (spec.minUsd !== undefined) a.push("--min-usd", String(spec.minUsd));
  if (spec.min !== undefined) a.push("--min", String(spec.min));
  if (spec.tiers !== undefined) a.push("--tiers", Array.isArray(spec.tiers) ? spec.tiers.map((t) => `${t.min}:${t.allowance}`).join(",") : String(spec.tiers));
  if (spec.allowance !== undefined) a.push("--allowance", String(spec.allowance));
  const d = spec.days ?? days;
  const b = spec.blocks ?? blocks;
  if (d !== undefined) a.push("--days", String(d));
  if (b !== undefined) a.push("--blocks", String(b));
  // where the holder scan starts and how many blocks each log search covers (a free RPC plan can allow only a few)
  if (spec.fromBlock !== undefined) a.push("--from-block", String(spec.fromBlock));
  if (spec.step !== undefined) a.push("--step", String(spec.step));
  return a;
}

/** The site's holders file: { series, chainId, updated, groups: { "<i>": { name, root, token, kind, symbol, count,
 *  block, wallets: { "<lowercase address>": { allowance, proof } } } } }. `snaps`: { [i]: snapshot file content }. */
export function holdersFile({ fire, chainId, groups, snaps, now = new Date() }) {
  const out = { series: Number(fire), chainId: Number(chainId), updated: now.toISOString(), groups: {} };
  for (const [i, s] of Object.entries(snaps).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const wallets = {};
    for (const [w, x] of Object.entries(s.wallets ?? {})) wallets[w.toLowerCase()] = { allowance: Number(x.allowance), proof: x.proof };
    out.groups[String(i)] = {
      name: groups[Number(i)]?.name ?? "", root: s.root, token: s.token, kind: s.kind, symbol: s.symbol ?? "", count: Object.keys(wallets).length, block: s.block, wallets,
    };
  }
  return out;
}

/** The differences between batch A on chain and the recipe (empty: batch A is on chain exactly). */
export async function batchADiffs(read, json, C) {
  const fire = BigInt(json.fire);
  const want = recipeFromJson(json);
  const diffs = [];
  const got = await read(C.RecipeDealer, ABI.dealer, "recipeOf", [fire]);
  const norm = (r) => JSON.stringify({
    types: r.types.map((t) => [t.name, t.slug, String(t.rank), Number(t.holoMode), t.holo.map(String)]),
    slots: r.slots.map((s) => [String(s.count), s.weights.map(String)]),
    onePerCharacter: String(r.onePerCharacter ?? 0),
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
  const [cw] = await read(C.RecipeDealer, ABI.dealer, "characterOddsOf", [fire]);
  const wantW = characterWeightsFromJson(json);
  if (cw.length !== wantW.length || wantW.some((w, k) => BigInt(cw[k]) !== w)) diffs.push("the character odds");
  if (getAddress(await read(C.FireCards, ABI.cards, "dealerOf", [fire])) !== getAddress(C.RecipeDealer)) diffs.push("FireCards' dealer");
  if (json.imagesBase && (await read(C.FireCards, ABI.cards, "imagesBase", [fire])) !== json.imagesBase) diffs.push("the images folder");
  return diffs;
}

export { dropDiffs, DROP_FIELDS, GROUP_FIELDS } from "./sale-policy.mjs";

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
    stdout('usage: node ops\\series\\launch.mjs --recipe <recipe.json> [--start "YYYY-MM-DD HH:MM"] [--chain 4663|46630] [--snapshots <file>] [--key-env VAR (testnet)]');
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
    if (!rpc) stop('No RPC. Set it first, hidden: $s = Read-Host "RPC URL" -AsSecureString; $env:RPC = [System.Net.NetworkCredential]::new("", $s).Password (or run ops\\series\\launch.ps1).');
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
    const mill = env.MILL ?? dep.inputs?.MILL;
    const groups = json.sale.groups ?? [];
    const snapGroups = groups.map((g, i) => i).filter((i) => groups[i].gate === "snapshot");
    const gname = (i) => `group ${i + 1}${groups[i]?.name ? ` (${groups[i].name})` : ""}`;
    const nftCode = await nftCodeOf(normSale(json.sale, { mill }), (address) => client.getCode({ address }));
    let allow;
    try { allow = parseAllow(args.allow); } catch (e) { stop(e.message); }
    const saleGate = async (roots_) => {
      const pol = salePolicy(json.sale, { allow, roots: roots_, nftCode, mill });
      const wallets = await saleWallets(read, C.FireSale, dep);
      for (const p of pol) if (p.level === "warn") warn(`Sale: ${p.text}.`);
      for (const p of pol) if (p.level === "allowed") warn(`Sale: ${p.text}.`);
      const red = [...pol.filter((p) => p.level === "red").map((p) => p.text), ...wallets.filter((w) => !w.ok).map((w) => w.text)];
      if (red.length) stop(`The sale settings are outside the policy or the wallets are wrong: ${red.join("; ")}. Fix the recipe's sale block (or the wallets) and run again.`);
      return wallets;
    };
    if (!launched) {
      // the snapshots (step 1) give the snapshot groups' roots
      const w = await saleGate(Object.fromEntries(snapGroups.map((i) => [i, `0x${"0".repeat(63)}1`])));
      ok(`Sale settings inside the policy (${groups.length} groups); revenue wallet, burners and FireGroups are the deployments file's (${w.length} checked).`);
    }

    // ---------------------------------------------------------------- 1. holder snapshots
    head(1, "Holder snapshots");
    const roots = {}; // group index -> root (GROUP_ROOT_<i>)
    const snapPaths = {}; // group index -> snapshot file
    if (launched) {
      ok("Skipped: the drop is already set.");
    } else if (snapGroups.length === 0) {
      ok("No snapshot groups in this sale: no snapshot needed.");
      state.steps.snapshots = {};
    } else {
      const sidePath = typeof args.snapshots === "string" ? resolve(args.snapshots) : [dirname(recipeArg), dirname(recipePath)].map((d) => resolve(d, `fire-${N}-snapshots.json`)).find(existsSync);
      if (!sidePath || !existsSync(sidePath)) stop(`${snapGroups.map(gname).join(", ")}: snapshot group(s). Say whose wallets each takes in fire-${N}-snapshots.json next to the recipe (or --snapshots <file>), keyed by the group's index (0 is the first), e.g. { "${snapGroups[0]}": { "token": "plank", "minUsd": 69, "days": 7 } }.`);
      let specs;
      try { specs = snapshotSpecs(JSON.parse(readFileSync(sidePath, "utf8")), groups); } catch (e) { stop(`${show(sidePath)}: ${e.message}`); }
      ok(`Snapshot groups from ${show(sidePath)}: ${snapGroups.map(gname).join(", ")}.`);
      const done = state.steps.snapshots ?? {};
      for (const i of snapGroups) {
        const spec = specs[i];
        const label = gname(i);
        const prev = done[i];
        const same = prev && prev.spec === JSON.stringify(spec);
        let snapPath = spec.file ? resolve(dirname(sidePath), spec.file) : resolve(dirname(recipePath), `fire-${N}-group-${i}.json`);
        if (same && prev.root && prev.file && existsSync(resolve(REPO, prev.file)) && !args["new-snapshot"]) {
          snapPath = resolve(REPO, prev.file);
          ok(`${label}: using the snapshot taken ${prev.at}: ${prev.count} wallets, root ${prev.root}.`);
        } else if (spec.file) {
          if (!existsSync(snapPath)) stop(`${label}: no snapshot file ${show(snapPath)}.`);
          ok(`${label}: the snapshot file ${show(snapPath)} (taken by hand; VerifySeries rebuilds it from the chain).`);
        } else {
          note(`${label}: taking the snapshot (a few minutes on mainnet)...`);
          const argv = snapshotArgs(spec, { out: snapPath, days: typeof args["snapshot-days"] === "string" ? args["snapshot-days"] : undefined, blocks: typeof args["snapshot-blocks"] === "string" ? args["snapshot-blocks"] : undefined });
          const r = await run(process.execPath, [resolve(REPO, "ops/snapshot/snapshot.mjs"), ...argv], {
            cwd: resolve(REPO, "ops/snapshot"), env: { ...env, RPC: rpc, DEPLOYMENTS_FILE: depFile },
          }, (t) => toLog(t.split(rpc).join("<RPC>")));
          if (r.code !== 0) stop(`${label}: the snapshot failed: ${lastError(r.out)}`);
        }
        const snap = JSON.parse(readFileSync(snapPath, "utf8"));
        if (!(snap.version >= 3) || !snap.root) stop(`${label}: ${show(snapPath)} isn't a snapshot with allowances (ops/snapshot, version 3).`);
        if (!(same && prev?.root === snap.root)) {
          const packs = (snap.holders ?? []).reduce((t, h) => t + Number(h.allowance), 0);
          ok(`${label}: ${snap.count} wallets hold ${snap.unit === "usd" ? `$${snap.min}` : `${snap.min}`}+ of ${snap.symbol || snap.token} (${packs} packs of allowance). Root ${snap.root}. Saved ${show(snapPath)}.`);
        }
        roots[i] = snap.root;
        snapPaths[i] = snapPath;
        done[i] = { file: relative(REPO, snapPath).split(sep).join("/"), root: snap.root, count: snap.count, token: snap.token, block: snap.block, blocks: snap.blocks, spec: JSON.stringify(spec), at: same ? prev.at : new Date().toISOString() };
      }
      state.steps.snapshots = done;
      save();
    }
    const bEnv = { DROP_START: String(start), ...Object.fromEntries(Object.entries(roots).map(([i, r]) => [`GROUP_ROOT_${i}`, r])) };
    const plan = planHash(recipeText, start, roots);
    if (state.plan && state.plan !== plan && !launched) {
      for (const k of ["rehearsal", "verify"]) delete state.steps[k];
      note("The recipe, start or a snapshot root changed since the last run: rehearsing and verifying again.");
    }
    if (!launched) { state.plan = plan; state.start = String(start); state.roots = roots; save(); }

    // forge, from contracts/ (the RPC URL is shown as <RPC> in the log: it can hold an API key)
    const forgeExtra = (env.LAUNCH_FORGE_ARGS ?? "").split(" ").filter(Boolean); // tests only (--offline --use <solc>)
    // forge reads contracts/.env for any name not set here, so every name ConfigureSeries reads is set: the checked MILL,
    // the contracts from the deployments file, the rest blank (a stale or other-chain .env can't steer the batches)
    const pin = { ...Object.fromEntries(FORGE_ENV.map((k) => [k, ""])), MILL: mill ?? "", FIRE_SALE: C.FireSale, RECIPE_DEALER: C.RecipeDealer, FIRE_CARDS: C.FireCards };
    const forge = (extra, extraEnv) => run(bin("forge"), ["script", "script/ConfigureSeries.s.sol", ...extra, ...forgeExtra], {
      cwd: CONTRACTS,
      env: { ...env, ...pin, ...extraEnv, RECIPE_JSON: recipePath, DEPLOYMENTS_FILE: depFile, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
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
      const imageSample = args["image-sample"] !== undefined ? Number(args["image-sample"]) : 0;
      if (imageSample && chainId === 4663) stop("--image-sample is for the testnet only: on mainnet every image is checked.");
      if (imageSample && !(imageSample >= 1)) stop("--image-sample N: N is how many random images to check (1 or more).");
      if (imageSample) warn(`Checking ${imageSample} random images, not all of them (--image-sample, testnet only).`);
      const skipImages = !!args["skip-image-check"];
      if (skipImages && chainId === 4663) stop("--skip-image-check is for the testnet only: on mainnet every image is checked.");
      if (skipImages) warn("Not loading the images through the gateways (--skip-image-check, testnet only).");
      const waitSec = Number(args["verify-wait"] ?? 90);
      for (let i = 1; ; i++) {
        let v;
        try {
          v = await verifySeries({
            client, recipe: json, deploymentsFile: depFile, gateways, snapshots: snapPaths, roots,
            allow, log: (l) => toLog(`verify: ${l}`), ...(imageSample ? { sample: imageSample, sampleOk: true } : {}), ...(skipImages ? { skipImages: true } : {}),
          });
        } catch (e) {
          v = { green: false, problems: [`VerifySeries couldn't run: ${e?.shortMessage ?? e?.message ?? e}`], warnings: [], retry: true };
        }
        if (v.green) {
          for (const w of v.warnings) warn(w);
          ok(`GREEN: ${v.images} images load from ${gateways.length >= 2 ? "two or more" : "the"} gateways; recipe, characters, images folder${snapGroups.length ? ", snapshot roots" : ""} match.`);
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
      const wallets = await saleGate(roots);
      note(`Series ${N}, every sale setting:`);
      for (const l of describeSale(sale, { start: showTime(start), roots, mill })) note(`  ${l}`);
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
    const locked = (await read(C.FireCards, ABI.cards, "fires", [fire]))[2];
    if (!locked || drop.start === 0n) stop("The drop isn't on chain. Run again.");
    const groupsAddr = getAddress(await read(C.FireSale, ABI.sale, "GROUPS"));
    const views = await read(groupsAddr, ABI.groups, "groupsOf", [fire]);
    // the roots meant: this run's (or the state file's); with neither (state file gone) the chain's own are taken
    const rootsMeant = Object.keys(roots).length ? roots : state.roots ?? Object.fromEntries(views.map((v, i) => [i, v.config.root]).filter(([i]) => groups[i]?.gate === "snapshot"));
    const want = normSale(sale, { mill, roots: rootsMeant, start: state.start ?? start });
    const dd = dropDiffs(drop, views, want);
    if (dd.length) stop(`The drop on chain differs: ${dd.join("; ")}. Check it before the sale opens.`);
    ok(`FireSale's drop for Series ${N}: opens ${showTime(drop.start)}, ${drop.packs} packs in ${views.length} groups (${views.map((v, i) => `${gname(i)}: ${v.config.unlimited ? "no limit" : v.config.packs}`).join(", ")}), every field as meant. Series locked.`);
    state.steps.batchB = { at: state.steps.batchB?.at ?? new Date().toISOString() };
    state.done = true;
    save();

    // the site's holders file: every snapshot group's wallets, allowances and proofs
    const holdersOut = typeof args["holders-out"] === "string" ? resolve(args["holders-out"]) : resolve(REPO, "web/art/factory/forge/holders", `series-${N}.json`);
    const taken = state.steps.snapshots ?? {};
    let published;
    if (snapGroups.length && snapGroups.every((i) => taken[i]?.file && existsSync(resolve(REPO, taken[i].file)))) {
      const snaps = Object.fromEntries(snapGroups.map((i) => [i, JSON.parse(readFileSync(resolve(REPO, taken[i].file), "utf8"))]));
      const off = snapGroups.filter((i) => String(snaps[i].root).toLowerCase() !== String(views[i]?.config.root).toLowerCase());
      if (off.length) stop(`The snapshot file of ${off.map(gname).join(", ")} isn't the drop's root on chain: not publishing it. Check the state file's snapshots.`);
      mkdirSync(dirname(holdersOut), { recursive: true });
      writeFileSync(holdersOut, `${JSON.stringify(holdersFile({ fire: N, chainId, groups, snaps }), null, 1)}\n`);
      published = holdersOut;
      ok(`Holders file for the site: ${show(holdersOut)} (${snapGroups.map((i) => `${gname(i)}: ${snaps[i].count} wallets`).join(", ")}).`);
    } else if (snapGroups.length) warn(`No snapshot files in the state file: the site's holders file (${show(holdersOut)}) wasn't written. Write it from the snapshots by hand (ops/README.md).`);

    // ---------------------------------------------------------------- 7. done
    head(7, "Done");
    note(`The sale opens by itself at ${showTime(drop.start)}.`);
    note("The keeper does the rest: price checkpoints, drand, dealing opened packs, gradings, burns, and closing the Series once nothing can still sell.");
    note(`Next: FireCredits.pickSuggestions as usual${published ? `, and publish the site with ${show(published)} (buyers' snapshot proofs)` : ""}.`);
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
  requirePatchedNode(); // the Ledger is attached and it reads gateways, drand and RPCs: not on a Node with the Brotli bug
  const code = await launch(process.argv.slice(2));
  process.exit(code);
}
