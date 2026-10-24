#!/usr/bin/env node
// The image step: makes every placeholder picture in an issue and saves it next to the issue (img/).
//   node paper/images.mjs --date YYYY-MM-DD        (paper/out/<date>/issue.json, in place)
//   node paper/images.mjs <issue.json>
// kind ai    -> the image provider (lib/images: openai-compatible | none), house style prepended to the prompt.
// kind meme  -> Imgflip caption_image (IMGFLIP_USERNAME/PASSWORD), captions inside the picture.
// kind staff -> must already be a file (card characters, workshop scenes); only checked.
// A picture that can't be made keeps placeholder: true (the site draws a stand-in; publish refuses it).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PAPER_DIR, args, env, issueDate, loadEnv, readJson, writeJson } from "./lib/util.mjs";
import { HOUSE_STYLE, provider } from "./lib/images/index.mjs";
import { caption } from "./lib/images/imgflip.mjs";

export async function makeImages(issue, dir, { log = console.log } = {}) {
  const gen = provider();
  const imgflip = env("IMGFLIP_USERNAME") && env("IMGFLIP_PASSWORD") ? { username: env("IMGFLIP_USERNAME"), password: env("IMGFLIP_PASSWORD") } : null;
  mkdirSync(resolve(dir, "img"), { recursive: true });
  let made = 0, left = 0;
  for (const page of issue.pages) {
    for (const [i, s] of (page.stories ?? []).entries()) {
      const im = s.image;
      if (!im) continue;
      const id = s.id ?? `${page.section}-${i}`;
      if (im.kind === "staff") {
        if (im.src && !/^(ipfs|https?):/.test(im.src) && !existsSync(resolve(dir, im.src))) log(`  staff photo missing: ${im.src}`);
        continue;
      }
      if (!im.placeholder) continue;
      try {
        let out = null;
        if (im.kind === "ai") out = await gen.generate({ prompt: HOUSE_STYLE + im.prompt, size: page.section === "front" ? "1536x1024" : env("IMAGE_SIZE", "1536x1024") });
        if (im.kind === "meme" && imgflip) out = await caption(im, imgflip);
        if (!out) { left++; continue; }
        const rel = `img/${id}.${out.ext}`;
        writeFileSync(resolve(dir, rel), out.bytes);
        Object.assign(im, { src: rel, placeholder: false });
        made++;
        log(`  ${im.kind}: ${rel}`);
      } catch (e) {
        left++;
        log(`  ${im.kind} for "${s.headline}": ${e.message}`);
      }
    }
  }
  return { made, left, provider: gen.name, imgflip: Boolean(imgflip) };
}

// main module (pathToFileURL: on Windows argv[1] is C:\..., and a path may have spaces)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadEnv();
  const a = args();
  const file = a._[0] ?? resolve(PAPER_DIR, "out", issueDate(a.date), "issue.json");
  const issue = readJson(file);
  const r = await makeImages(issue, dirname(file));
  writeJson(file, issue);
  console.log(`images: ${r.made} made, ${r.left} still placeholders (provider ${r.provider}, imgflip ${r.imgflip ? "on" : "off"})`);
}
