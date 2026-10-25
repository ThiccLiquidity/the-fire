// The weekly dependency check: npm audit in every package, failing on any high or critical advisory that isn't in
// accepted.json (or whose review date has passed). Run locally: node .github/security/audit.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["web", "studio", "ops", "ops/keeper", "ops/snapshot", "paper"];
const accepted = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "accepted.json"), "utf8")).accepted;
const today = new Date().toISOString().slice(0, 10);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let bad = 0;

for (const dir of DIRS) {
  const cwd = join(ROOT, dir);
  if (!existsSync(join(cwd, "package-lock.json"))) continue;
  let out;
  try { out = execFileSync(npm, ["audit", "--json"], { cwd, encoding: "utf8", maxBuffer: 64 << 20, shell: process.platform === "win32" }); }
  catch (e) { out = e.stdout; } // npm audit exits 1 when it finds anything
  const found = new Map();
  for (const v of Object.values(JSON.parse(out || "{}").vulnerabilities ?? {})) {
    for (const via of v.via) {
      if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
      found.set(via.url.split("/").pop(), { pkg: via.name, sev: via.severity, title: via.title, url: via.url });
    }
  }
  for (const [id, a] of found) {
    const ok = accepted.find((x) => x.id === id);
    if (ok && ok.review >= today) { console.log(`accepted  ${dir}: ${a.pkg} ${id} (${a.sev}), review by ${ok.review}`); continue; }
    bad++;
    console.log(`${ok ? "REVIEW DUE" : "NEW"}  ${dir}: ${a.pkg} ${id} (${a.sev}) ${a.title} ${a.url}`);
  }
  if (!found.size) console.log(`clean     ${dir}`);
}
console.log(bad ? `\n${bad} high/critical advisory(ies) need a look.` : "\nNo new high or critical advisories.");
process.exit(bad ? 1 : 0);
