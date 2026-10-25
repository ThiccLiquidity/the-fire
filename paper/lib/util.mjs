// Small shared helpers: paths, .env loading (never printed), fetch with a timeout, dates.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PAPER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(PAPER_DIR, "..");

/** Loads paper/.env into process.env (keys already set win). Values are never logged. */
export function loadEnv(file = resolve(PAPER_DIR, ".env")) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// HTTP2Shell (CVE-2026-111497): Node unpacks Brotli replies for fetch, and builds before the fix could be attacked by a
// bad server; gather reads feeds from all over the web. Fixed in 22.23.4, 24.22.1 and 26.12.1 (the lines in between never got it).
const NODE_FIXED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
export function nodePatched(version = process.versions.node) {
  const v = version.split(".").map(Number), f = NODE_FIXED[v[0]];
  if (!f) return v[0] > 26;
  for (let i = 0; i < 3; i++) if (v[i] !== f[i]) return v[i] > f[i];
  return true;
}
export const env = (k, d = undefined) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

/** A URL safe to print or keep in notes: no query, and any key-like path part masked (an Alchemy RPC URL is
 *  https://<net>.g.alchemy.com/v2/<key>). */
export function redactUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname.replace(/[A-Za-z0-9_-]{16,}/g, "<key>")}`;
  } catch {
    return "<url>";
  }
}

export async function fetchText(url, { timeoutMs = 15000, headers = {}, method = "GET", body } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers: { "user-agent": "MorningWood/1.0 (+satire newspaper)", ...headers }, body, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${redactUrl(url)}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

export const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, opts));

/** YYYY-MM-DD of "tomorrow's paper" by default (the pipeline runs the night before), in America/New_York. */
export function issueDate(arg) {
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (ny.getHours() >= 12) ny.setDate(ny.getDate() + 1);
  return `${ny.getFullYear()}-${String(ny.getMonth() + 1).padStart(2, "0")}-${String(ny.getDate()).padStart(2, "0")}`;
}

/** Issue number: day 1 = LAUNCH_DATE (default 2026-10-22). */
export function issueNumber(date, launch = env("LAUNCH_DATE", "2026-10-22")) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${launch}T00:00:00Z`)) / 86_400_000) + 1;
}

export function writeJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Runs `fn`, returning `fallback` (and noting why) when it throws. */
export async function soft(label, fn, fallback, notes) {
  try {
    return await fn();
  } catch (e) {
    notes?.push(`${label}: ${e.message ?? e}`);
    return fallback;
  }
}
