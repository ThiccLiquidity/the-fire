#!/usr/bin/env node
// Preview and publish.
//   node paper/publish.mjs --date YYYY-MM-DD --preview      pin the issue folder to IPFS, print the preview link (no chain)
//   node paper/publish.mjs --date YYYY-MM-DD                 + pin metadata, print the publish command (dry run)
//   node paper/publish.mjs --date YYYY-MM-DD --send          + run it: cast send ... --account editor (Foundry keystore)
// The editor key never touches this script: cast asks for the keystore password itself. Publishing at night with
// opensAt = OPENS_HOUR the next morning leaves the owner the veto (MorningWood.unpublish) until it opens.
// Refuses unless check.mjs --publish passes (no sample numbers, no placeholder pictures).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { PAPER_DIR, args, env, issueDate, loadEnv, readJson, writeJson } from "./lib/util.mjs";
import { check } from "./check.mjs";
import { deployments } from "./lib/chain.mjs";

const PIN = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PUBLISH_FILES = /\.(json|svg|html|png|jpe?g|webp|gif)$/i;

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = resolve(dir, f);
    return statSync(p).isDirectory() ? files(p) : PUBLISH_FILES.test(f) && f !== "newspack.json" && f !== "draft.json" ? [p] : [];
  });
}

/** Pins `paths` (relative to `base`) as one folder named `name`. Returns the folder CID. */
export async function pin(jwt, base, paths, name) {
  const form = new FormData();
  for (const p of paths) form.append("file", new Blob([readFileSync(p)]), `${name}/${relative(base, p)}`);
  form.append("pinataMetadata", JSON.stringify({ name }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  const r = await fetch(PIN, { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: form });
  const j = await r.json();
  if (!r.ok) throw new Error(`pinata ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.IpfsHash;
}

/** Unix seconds of `date` at `hour`:00 in America/New_York. */
export function opensAt(date, hour = 6) {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const ny = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.floor((guess + (utc - ny)) / 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const a = args();
  const date = issueDate(a.date);
  const dir = a.dir ?? resolve(PAPER_DIR, "out", date);
  const issue = readJson(resolve(dir, "issue.json"));
  const { errors } = check(issue, { publish: !a.preview, dir });
  if (errors.length) { for (const e of errors) console.log(`ERROR: ${e}`); process.exit(1); }
  const jwt = env("PINATA_JWT");
  if (!jwt) { console.log("PINATA_JWT is not set (type it into the environment, never chat)."); process.exit(1); }

  const name = `morning-wood-${issue.number}-${date}`;
  const cid = await pin(jwt, dir, files(dir).filter((p) => !p.endsWith("metadata.json")), name);
  const gw = env("IPFS_GATEWAY", "https://gateway.pinata.cloud/ipfs");
  console.log(`pinned issue folder: ipfs://${cid}`);
  console.log(`preview: ${env("PREVIEW_BASE", "<PREVIEW_BASE>")}?src=${encodeURIComponent(`ipfs://${cid}/issue.json`)}`);
  console.log(`         ${gw}/${cid}/preview.html`);
  if (a.preview) process.exit(0);

  const meta = readJson(resolve(dir, "metadata.json"));
  Object.assign(meta, { image: `ipfs://${cid}/front.svg`, animation_url: `ipfs://${cid}/preview.html`, properties: { ...meta.properties, issue: `ipfs://${cid}/issue.json` } });
  writeJson(resolve(dir, "metadata.json"), meta);
  const metaCid = await pin(jwt, dir, [resolve(dir, "metadata.json")], `${name}-meta`);
  const uri = `ipfs://${metaCid}/metadata.json`;
  const press = env("MORNING_WOOD", deployments().contracts?.MorningWood);
  const at = opensAt(date, Number(env("OPENS_HOUR", "6")));
  const cmd = ["send", press ?? "<MorningWood>", "publish(uint256,string,uint64)", String(issue.number), uri, String(at), "--account", env("EDITOR_ACCOUNT", "editor"), "--rpc-url", env("RPC_URL", "https://rpc.mainnet.chain.robinhood.com")];
  console.log(`metadata: ${uri}\nopens: ${new Date(at * 1000).toISOString()} (sells 24h)\n\ncast ${cmd.map((c) => (/[\s()]/.test(c) ? `"${c}"` : c)).join(" ")}`);
  if (!a.send) { console.log("\n(dry run: add --send to publish; the owner can still MorningWood.unpublish before it opens)"); process.exit(0); }
  if (!press) { console.log("no MorningWood address (deployments file or MORNING_WOOD)"); process.exit(1); }
  const r = spawnSync("cast", cmd, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
