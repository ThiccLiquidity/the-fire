// VerifySeries: the read-back between the two owner signings of a Series (docs/deploy.md, step 6).
//
// After batch A (recipe, characters, dealer, images) is on chain and BEFORE batch B (configureDrop, which locks
// the Series), this reads everything back from the chain and checks it, read-only:
//   - the on-chain recipe, characters, dealer and image folder equal the studio's recipe.json, field by field; FirePsa's
//     fixed fresh PDA odds are the published ones (docs/grading.md)
//   - imagesBase is ipfs://<CID>/ (a real CID, ending in /)
//   - every image the contract can ever point a card at (CardsRenderer.imageName for each character x card type x holo
//     look its odds and slots allow x 12 states) loads through at least two IPFS gateways (HEAD, or a 1-byte GET)
//   - the images folder's manifest.json (written by the studio) lists them all and names this recipe
//   - with --snapshot, the holder Merkle root recomputed from the snapshot file equals the one batch B will set
// It prints one line per check and GREEN or RED. Only sign batch B when it's GREEN.
//
//   cd ops; npm install
//   $env:RPC = Read-Host "RPC URL"
//   node series/verify-series.mjs --recipe ..\contracts\series\recipe-fire-7.json [--snapshot fire-7-holders.json]
//
// Options: --gateways <url>,<url> (default ipfs.io, dweb.link, Pinata's and Filebase's public gateways; each URL is
//   followed by <CID>/<file>), --holder-root 0x... (else HOLDER_ROOT, else the JSON's sale.holderRoot),
//   --sample N (check only N random images: a quick look, never GREEN), --concurrency 24, --report out.json.
// Addresses come from deployments/<chainId>.json (DEPLOYMENTS_FILE to use another file).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicClient, http, getAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const abi = (name) => JSON.parse(readFileSync(resolve(REPO, "web/src/lib/abi", `${name}Abi.json`), "utf8"));
const dealerAbi = abi("recipeDealer");
const cardsAbi = abi("fireCards");
const psaAbi = abi("firePsa");
const rendererAbi = abi("cardsRenderer");
const packsAbi = abi("firePacks");
const saleAbi = abi("fireSale");

export const DEFAULT_GATEWAYS = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://ipfs.filebase.io/ipfs/"];
export const STATES = ["u", "c", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const HOLO = ["none", "frame", "picture", "full"];
const ONE = 10n ** 18n;
const U32 = 4294967295n;
const SUPPLY = { filler: 0, share: 1, perPack: 2, count: 3, perCharacter: 4 };
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

/** The recipe.json the studio exports, normalized the way ConfigureSeries.s.sol parses it (contract units). */
export function recipeFromJson(j) {
  return {
    types: j.types.map((t) => ({
      name: t.name, slug: t.slug, rank: BigInt(t.rank), supply: SUPPLY[t.supply],
      amount: t.supply === "filler" ? 0n : BigInt(t.amount ?? 0), maxPerPack: BigInt(t.maxPerPack ?? 0),
      holoMode: t.holo.mode === "independent" ? 0 : 1,
      holo: t.holo.mode === "independent" ? [BigInt(t.holo.frame), BigInt(t.holo.picture), 0n, 0n] : t.holo.weights.map(BigInt),
    })),
    slots: j.slots.map((s) => {
      const types = (s.types ?? []).map(BigInt);
      return {
        count: BigInt(s.count), types, minRank: BigInt(s.minRank ?? 0),
        maxRank: s.maxRank !== undefined ? BigInt(s.maxRank) : types.length === 0 ? U32 : 0n, mustHolo: !!s.mustHolo,
      };
    }),
  };
}

/** The holo looks a type's cards can come out as, exactly as RecipeDealer deals them (and the studio's holoLooksFor). */
export function looksFor(recipe, t) {
  const ty = recipe.types[t];
  const [h0, h1, h2, h3] = ty.holo.map(BigInt);
  const exact = ty.holoMode === 0
    ? { none: h0 < ONE && h1 < ONE, frame: h0 > 0n && h1 < ONE, picture: h0 < ONE && h1 > 0n, full: h0 > 0n && h1 > 0n }
    : { none: h0 > 0n, frame: h1 > 0n, picture: h2 > 0n, full: h3 > 0n };
  const has = (s) => (s.types.length ? s.types.map(Number).includes(t) : BigInt(s.minRank) <= BigInt(ty.rank) && BigInt(ty.rank) <= BigInt(s.maxRank));
  const plain = recipe.slots.some((s) => !s.mustHolo && has(s));
  return HOLO.filter((h) => (h === "none" ? exact.none && plain : exact[h]));
}

/** CardsRenderer.imageName. */
export const imageName = (character, slug, holo, state) => `c${character}-${slug}-${holo}-${state}.webp`;

/** Every image file the contract can point a card of this Series at. */
export function allImageNames(recipe, characters) {
  const out = [];
  for (let c = 0; c < characters; c++) {
    recipe.types.forEach((ty, t) => {
      for (const h of looksFor(recipe, t)) for (const s of STATES) out.push(imageName(c, ty.slug, h, s));
    });
  }
  return out;
}

/** FirePsa's fresh PDA odds, grade 1 first, out of 10,000: fixed forever, the same for every Series. */
export const FRESH_PDA_ODDS = [0n, 0n, 0n, 0n, 1000n, 2000n, 2700n, 2500n, 1700n, 100n];

/** The recipe fingerprint the studio puts in the images folder's manifest.json. */
export function recipeHash(j) {
  return createHash("sha256").update(JSON.stringify({ fire: j.fire, types: j.types, slots: j.slots, characters: j.characters })).digest("hex");
}

/** HEAD (falling back to a 1-byte GET when a gateway refuses HEAD) with retries. */
async function loads(url, fetchFn, timeoutMs = 20_000, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      let r = await fetchFn(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 405 || r.status === 501) r = await fetchFn(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok || r.status === 206) return true;
      if (r.status === 404 || r.status === 410) return false;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * 2 ** i));
  }
  return false;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

/**
 * Runs every check. Returns { green, lines, problems }. `log` gets each line as it's decided.
 * opts: { rpc | client, recipePath | recipe, deployments, gateways, snapshotPath, holderRoot, sample, concurrency, fetchFn, log }
 */
export async function verifySeries(opts) {
  const log = opts.log ?? console.log;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const lines = [];
  const problems = [];
  const ok = (cond, text) => { const l = `${cond ? "OK  " : "FAIL"}  ${text}`; lines.push(l); log(l); if (!cond) problems.push(text); return cond; };
  const info = (text) => { const l = `INFO  ${text}`; lines.push(l); log(l); };

  const client = opts.client ?? createPublicClient({ transport: http(opts.rpc) });
  const chainId = await client.getChainId();
  const depPath = opts.deploymentsFile ?? process.env.DEPLOYMENTS_FILE ?? resolve(REPO, "deployments", `${chainId}.json`);
  if (!existsSync(depPath)) throw new Error(`no deployments file ${depPath}`);
  const dep = JSON.parse(readFileSync(depPath, "utf8")).contracts ?? {};
  const A = (n) => { if (!dep[n]) throw new Error(`${n} missing from ${depPath}`); return getAddress(dep[n]); };
  const [dealer, cards, psa, renderer, packs, sale] = ["RecipeDealer", "FireCards", "FirePsa", "CardsRenderer", "FirePacks", "FireSale"].map(A);
  const read = (address, abi_, functionName, args = []) => client.readContract({ address, abi: abi_, functionName, args });

  const json = opts.recipe ?? JSON.parse(readFileSync(opts.recipePath, "utf8"));
  const fire = BigInt(json.fire);
  const want = recipeFromJson(json);
  info(`Series ${fire} on chain ${chainId} (RecipeDealer ${dealer})`);

  // ---- recipe
  const got = await read(dealer, dealerAbi, "recipeOf", [fire]);
  ok(got.types.length === want.types.length, `card types: ${got.types.length} on chain, ${want.types.length} in recipe.json`);
  want.types.forEach((w, i) => {
    const g = got.types[i];
    if (!g) return;
    const diffs = [];
    for (const k of ["name", "slug"]) if (g[k] !== w[k]) diffs.push(`${k} ${JSON.stringify(g[k])} != ${JSON.stringify(w[k])}`);
    for (const k of ["rank", "amount", "maxPerPack"]) if (BigInt(g[k]) !== w[k]) diffs.push(`${k} ${g[k]} != ${w[k]}`);
    if (Number(g.supply) !== w.supply) diffs.push(`supply ${g.supply} != ${w.supply}`);
    if (Number(g.holoMode) !== w.holoMode) diffs.push(`holo mode ${g.holoMode} != ${w.holoMode}`);
    if (g.holo.some((x, k) => BigInt(x) !== w.holo[k])) diffs.push(`holo ${g.holo.join("/")} != ${w.holo.join("/")}`);
    ok(diffs.length === 0, `type ${i} (${w.name}) ${diffs.length ? diffs.join("; ") : "matches"}`);
  });
  ok(got.slots.length === want.slots.length, `slot groups: ${got.slots.length} on chain, ${want.slots.length} in recipe.json`);
  want.slots.forEach((w, i) => {
    const g = got.slots[i];
    if (!g) return;
    const same = BigInt(g.count) === w.count && g.types.map(BigInt).join() === w.types.join() && BigInt(g.minRank) === w.minRank
      && BigInt(g.maxRank) === w.maxRank && g.mustHolo === w.mustHolo;
    ok(same, `slot group ${i} ${same ? "matches" : `differs (chain ${g.count}x types[${g.types.join(",")}] ranks ${g.minRank}-${g.maxRank} holo ${g.mustHolo})`}`);
  });

  // ---- characters
  const n = Number(await read(dealer, dealerAbi, "characterCount", [fire]));
  ok(n === json.characters.length, `characters: ${n} on chain, ${json.characters.length} in recipe.json`);
  let charDiffs = 0;
  for (let from = 0; from < Math.min(n, json.characters.length); from += 200) {
    const [names, cats] = await read(dealer, dealerAbi, "charactersOf", [fire, BigInt(from), 200n]);
    names.forEach((nm, k) => {
      const w = json.characters[from + k];
      if (nm !== w.name || cats[k] !== w.category) {
        if (charDiffs++ < 5) ok(false, `character ${from + k}: chain "${nm}" (${cats[k]}), recipe.json "${w.name}" (${w.category})`);
      }
    });
  }
  ok(charDiffs === 0, `every character's name and category in order${charDiffs ? ` (${charDiffs} differ)` : ""}`);

  // ---- dealer, images base, fixed PDA odds, lock state
  ok(getAddress(await read(cards, cardsAbi, "dealerOf", [fire])) === dealer, "FireCards' dealer for the Series is RecipeDealer");
  const base = await read(cards, cardsAbi, "imagesBase", [fire]);
  ok(json.imagesBase !== undefined, "recipe.json has imagesBase (the images are uploaded)");
  ok(base === json.imagesBase, `imagesBase on chain ${JSON.stringify(base)} ${base === json.imagesBase ? "matches" : `!= recipe.json ${JSON.stringify(json.imagesBase)}`}`);
  const m = /^ipfs:\/\/([^/]+)\/$/.exec(base);
  ok(!!m && CID_RE.test(m[1]), `imagesBase is ipfs://<CID>/ with a valid CID and a trailing /`);
  const cid = m?.[1];
  ok(json.pdaOdds === undefined, "recipe.json has no pdaOdds (PDA odds are fixed in FirePsa for every Series)");
  const [o, total] = await read(psa, psaAbi, "freshOdds", []);
  const fixed = total === 10_000n && o.every((x, g) => BigInt(x) === FRESH_PDA_ODDS[g]);
  ok(fixed, `FirePsa's fixed fresh PDA odds ${fixed ? "are the published ones" : `differ: chain ${o.join(",")} / ${total}`}`);
  const [, closed, locked] = await read(cards, cardsAbi, "fires", [fire]);
  const minted = await read(packs, packsAbi, "minted", [fire]);
  if (locked || closed || minted > 0n) info(`the Series is already locked${closed ? " and closed" : ""} (${minted} packs minted): checking only`);
  else ok(await read(cards, cardsAbi, "ready", [fire]), "FireCards.ready: the Series can be locked (batch B)");
  const perPack = await read(dealer, dealerAbi, "cardsPerPack", [fire]);
  info(`${perPack} cards per pack`);

  // ---- every image name
  const names = allImageNames(got, n);
  info(`${names.length.toLocaleString()} images the contract can point at (${n} characters x ${got.types.map((t, i) => `${t.slug} ${looksFor(got, i).length}`).join(", ")} looks x ${STATES.length} states)`);
  // the contract builds the same names
  let crossed = 0;
  for (let t = 0; t < got.types.length; t++) {
    for (const h of looksFor(got, t)) {
      for (const [s, grade, cased] of [["u", 0n, false], ["c", 0n, true], ["10", 10n, false]]) {
        const onChain = await read(renderer, rendererAbi, "imageName", [0n, got.types[t].slug, h === "frame" || h === "full", h === "picture" || h === "full", grade, cased]);
        if (onChain !== imageName(0, got.types[t].slug, h, s)) ok(false, `CardsRenderer.imageName gives ${onChain}, expected ${imageName(0, got.types[t].slug, h, s)}`);
        else crossed++;
      }
    }
  }
  ok(crossed > 0, `CardsRenderer.imageName agrees on ${crossed} sample names`);

  // ---- manifest.json and the gateways
  const gateways = opts.gateways ?? DEFAULT_GATEWAYS;
  ok(gateways.length >= 2, `${gateways.length} gateways (at least 2)`);
  if (cid) {
    let manifest;
    for (const g of gateways) {
      try {
        const r = await fetchFn(`${g}${cid}/manifest.json`, { signal: AbortSignal.timeout(30_000) });
        if (r.ok) { manifest = await r.json(); break; }
      } catch { /* next */ }
    }
    if (!manifest) info("no manifest.json in the images folder (uploads before the studio wrote one)");
    else {
      const listed = new Set((manifest.files ?? []).map((f) => f.name));
      const missing = names.filter((x) => !listed.has(x));
      ok(missing.length === 0, `manifest.json lists every image (${listed.size} files${missing.length ? `; missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}` : ""})`);
      ok(manifest.recipeHash === recipeHash(json), `manifest.json's recipe hash ${manifest.recipeHash === recipeHash(json) ? "matches recipe.json" : "is for another recipe"}`);
      ok(Number(manifest.fire) === Number(fire), `manifest.json is for Series ${manifest.fire}`);
    }
    let list = names;
    if (opts.sample) list = [...names].sort(() => Math.random() - 0.5).slice(0, opts.sample);
    const failed = new Map(gateways.map((g) => [g, []]));
    let done = 0;
    await pool(list.flatMap((name) => gateways.map((g) => [g, name])), opts.concurrency ?? 24, async ([g, name]) => {
      if (!(await loads(`${g}${cid}/${name}`, fetchFn))) failed.get(g).push(name);
      if (++done % 2000 === 0) log(`  ... ${done.toLocaleString()} / ${(list.length * gateways.length).toLocaleString()} fetched`);
    });
    for (const [g, f] of failed) ok(f.length === 0, `${new URL(g).host}: ${list.length - f.length} / ${list.length} images load${f.length ? ` (first missing: ${f.slice(0, 3).join(", ")})` : ""}`);
    if (opts.sample) ok(false, `only ${list.length} of ${names.length} images checked (--sample): run without it before signing`);
  }

  // ---- holder root
  const root = (opts.holderRoot ?? process.env.HOLDER_ROOT ?? json.sale?.holderRoot)?.toLowerCase();
  if (opts.snapshotPath) {
    const snap = JSON.parse(readFileSync(opts.snapshotPath, "utf8"));
    const { buildTree } = await import(pathToFileURL(resolve(REPO, "ops/snapshot/merkle.mjs")).href);
    const again = buildTree(snap.holders.map((h) => h.wallet)).root.toLowerCase();
    ok(again === String(snap.root).toLowerCase(), `snapshot root recomputed from ${snap.holders.length} wallets: ${again}`);
    ok(!!root && again === root, `the holder root batch B sets (${root ?? "none"}) is the snapshot's`);
    const drop = await read(sale, saleAbi, "dropOf", [fire]);
    if (drop.start !== 0n) ok(drop.holderRoot.toLowerCase() === again, "the configured drop's holderRoot is the snapshot's");
  } else if (root && BigInt(root) !== 0n) info(`holder root ${root} not checked (no --snapshot)`);

  const green = problems.length === 0;
  const verdict = green ? "GREEN: batch B (configureDrop) can be signed." : `RED: ${problems.length} problem(s). Don't sign batch B.`;
  lines.push(verdict);
  log(verdict);
  return { green, lines, problems, images: names.length, cid };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = {};
  process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith("--")) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true; });
  const rpc = process.env.RPC ?? process.env.RPC_URL;
  if (!rpc || !args.recipe) {
    console.error("usage: RPC=... node series/verify-series.mjs --recipe recipe.json [--snapshot holders.json] [--holder-root 0x..] [--gateways a,b] [--sample N] [--report out.json]");
    process.exit(2);
  }
  try {
    const r = await verifySeries({
      rpc, recipePath: args.recipe, snapshotPath: args.snapshot === true ? undefined : args.snapshot,
      holderRoot: typeof args["holder-root"] === "string" ? args["holder-root"] : undefined,
      gateways: typeof args.gateways === "string" ? args.gateways.split(",").map((s) => s.trim()) : undefined,
      sample: args.sample ? Number(args.sample) : undefined, concurrency: args.concurrency ? Number(args.concurrency) : undefined,
    });
    if (typeof args.report === "string") writeFileSync(args.report, JSON.stringify(r, null, 2));
    process.exit(r.green ? 0 : 1);
  } catch (e) {
    console.error(`VerifySeries failed: ${e?.shortMessage ?? e?.message ?? e}`);
    process.exit(1);
  }
}
