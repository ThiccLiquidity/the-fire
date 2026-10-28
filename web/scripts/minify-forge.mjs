// Minifies the served copy of the Forge (web/public/forge, written by art/factory/sync_forge.sh): every page script
// and stylesheet, in place. The source in art/factory/forge stays readable (and is what the e2e tests serve).
// Scripts are classic scripts sharing globals (window.Store, window.Sheet...), so top-level names are never renamed.
// Skipped: the wallet bundle (vendor/, Vite already minified it) and the .mjs wrappers. node scripts/minify-forge.mjs [dir]
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { minifySync } from "rolldown/experimental";
import { transform as cssTransform } from "lightningcss";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, "../public/forge"));
let before = 0, after = 0, n = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "vendor") walk(p); continue; }
    const ext = extname(name);
    if (ext !== ".js" && ext !== ".css") continue;
    const src = readFileSync(p, "utf8");
    let out;
    if (ext === ".js") {
      const r = minifySync(name, src, { compress: { target: "es2022" }, mangle: { toplevel: false }, codegen: { removeWhitespace: true } });
      if (r.errors?.length) throw new Error(`${p}: ${r.errors.map((e) => e.message).join("; ")}`);
      out = r.code;
    } else {
      out = cssTransform({ filename: name, code: Buffer.from(src), minify: true }).code.toString();
    }
    writeFileSync(p, out); before += src.length; after += out.length; n++;
  }
}
walk(root);
console.log(`Minified ${n} files in ${root}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
