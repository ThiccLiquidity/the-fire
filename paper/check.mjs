#!/usr/bin/env node
// Checks an issue: the schema (paper/schema/issue.schema.json) and the house rules.
//   node paper/check.mjs <issue.json> [--draft] [--publish]
// --draft: a writers' draft (tokens allowed; markets prose must hold no digits outside {{tokens}}).
// --publish: also refuses sample numbers, placeholder images and anything marked sample (what publish.mjs runs).
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PAPER_DIR, args, readJson } from "./lib/util.mjs";
import { TOKEN_RE } from "./lib/tokens.mjs";

const SECTIONS = ["front", "plank", "tanggang", "crypto", "trending", "markets", "back"];

/** A small JSON Schema subset validator (type, const, enum, pattern, required, properties, additionalProperties,
 *  items, minItems, maxLength, minimum, $ref to #/$defs). Enough for our schema. */
export function validate(schema, value, root = schema, path = "$", errors = []) {
  if (schema.$ref) return validate(root.$defs[schema.$ref.split("/").pop()], value, root, path, errors);
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) return errors.push(`${path}: expected ${types.join("|")}, got ${t}`), errors;
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in ${schema.enum.join("|")}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: doesn't match ${schema.pattern}`);
  if (schema.maxLength && typeof value === "string" && Buffer.byteLength(value) > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems}`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, root, `${path}[${i}]`, errors));
  } else if (value && typeof value === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) validate(schema.properties[k], v, root, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown field ${k}`);
      else if (typeof schema.additionalProperties === "object") validate(schema.additionalProperties, v, root, `${path}.${k}`, errors);
    }
  }
  return errors;
}

export function check(issue, { draft = false, publish = false, dir } = {}) {
  const schema = readJson(resolve(PAPER_DIR, "schema/issue.schema.json"));
  // a draft leaves markets and the weather numbers to inject.mjs
  const errors = validate(schema, issue).filter((e) => !draft || !(/^\$\.markets/.test(e) || /^\$\.weather\[\d+\]: missing (highF|lowF|sky)$/.test(e)));
  const warnings = [];
  const pages = issue.pages ?? [];
  for (const s of SECTIONS) if (!pages.some((p) => p.section === s)) errors.push(`missing section: ${s} (every section, every day)`);
  for (const p of pages) {
    if (p.section === "front" && p.layout !== "broadsheet") errors.push("front page must be broadsheet");
    if (p.section !== "front" && p.layout !== "tabloid") warnings.push(`${p.section}: inside pages are tabloid`);
    if (!p.stories?.length && !(p.blocks?.length)) errors.push(`${p.section}: empty (a slow section is one short story or a meme)`);
  }
  const front = pages.find((p) => p.section === "front");
  const lead = front?.stories?.find((s) => s.size === "lead") ?? front?.stories?.[0];
  if (!lead?.image) errors.push("front lead needs the huge photo");
  const all = pages.flatMap((p) => (p.stories ?? []).map((s) => ({ ...s, section: p.section })));
  for (const s of all) {
    const text = [s.headline, s.deck, s.body, s.pullQuote].filter(Boolean).join("\n");
    if (!draft && TOKEN_RE.test(text)) errors.push(`${s.section} "${s.headline}": unfilled {{token}} (run inject.mjs)`);
    TOKEN_RE.lastIndex = 0;
    if (text.includes("[n/a]")) warnings.push(`${s.section} "${s.headline}": a number was missing ([n/a])`);
    if (draft && s.section === "markets" && /\d/.test(text.replace(TOKEN_RE, ""))) errors.push(`markets "${s.headline}": digits outside {{tokens}} (numbers come from code only)`);
    if (s.image?.kind === "meme" && !s.image.captions?.length) errors.push(`${s.section} "${s.headline}": meme without captions`);
    if (s.image?.kind === "ai" && !s.image.prompt && s.image.placeholder) errors.push(`${s.section} "${s.headline}": AI photo without a prompt`);
    if (s.image?.src && dir && !/^(ipfs|https?):/.test(s.image.src) && !existsSync(resolve(dir, s.image.src))) errors.push(`${s.section} "${s.headline}": image file missing: ${s.image.src}`);
  }
  if ((issue.horoscopes ?? []).length !== 12) warnings.push(`horoscopes: ${issue.horoscopes?.length ?? 0} of 12 signs`);
  if (publish) {
    if (issue.sample) errors.push("issue is marked sample");
    if (issue.markets?.sample) errors.push("markets are SAMPLE numbers (not real): gather again with the chain reachable");
    for (const s of all) if (s.image?.placeholder) errors.push(`${s.section} "${s.headline}": image still a placeholder (run images.mjs)`);
    for (const l of [...(issue.letters ?? []), ...(issue.classifieds ?? [])]) if (l.sample) errors.push(`letter/classified marked sample: "${l.text.slice(0, 40)}"`);
  }
  return { errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const file = a._[0];
  if (!file) { console.error("usage: node paper/check.mjs <issue.json> [--draft] [--publish]"); process.exit(2); }
  const { errors, warnings } = check(readJson(file), { draft: Boolean(a.draft), publish: Boolean(a.publish), dir: dirname(resolve(file)) });
  for (const w of warnings) console.log(`warn: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : "ok");
  process.exit(errors.length ? 1 : 0);
}
