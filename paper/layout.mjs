#!/usr/bin/env node
// Layout (code): from issue.json, next to it,
//   front.svg      the front page as one image (masthead, motto, SATIRE stamp, lead headline, the huge photo
//                  embedded): the NFT image
//   preview.html   a plain, self-contained read of the whole issue for the owner's night-before veto (the real
//                  reading experience is the site's /press, which renders issue.json)
//   metadata.json  ERC-1155 metadata for MorningWood.uri(number) (image/animation filled with ipfs:// by publish.mjs)
//   node paper/layout.mjs --date YYYY-MM-DD   |   node paper/layout.mjs <issue.json>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PAPER_DIR, args, issueDate, readJson, writeJson } from "./lib/util.mjs";

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** Markdown, the little we use: paragraphs, **bold**, *italic*, [links](url), "- " lists, "> " quotes. */
export function md(src = "") {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  return src.split(/\n{2,}/).map((b) => {
    if (/^\s*- /.test(b)) return `<ul>${b.split(/\n/).map((l) => `<li>${inline(l.replace(/^\s*- /, ""))}</li>`).join("")}</ul>`;
    if (/^\s*> /.test(b)) return `<blockquote>${inline(b.replace(/^\s*> /gm, ""))}</blockquote>`;
    return `<p>${inline(b.replace(/\n/g, " "))}</p>`;
  }).join("\n");
}

const dataUri = (dir, src) => {
  const f = resolve(dir, src);
  if (!src || /^(ipfs|https?):/.test(src) || !existsSync(f)) return null;
  return `data:${MIME[extname(f).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(f).toString("base64")}`;
};

const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Greedy word wrap for SVG text. */
const wrap = (text, perLine) => text.split(" ").reduce((lines, w) => {
  const last = lines[lines.length - 1];
  if (last && (last + " " + w).length <= perLine) lines[lines.length - 1] = last + " " + w;
  else lines.push(w);
  return lines;
}, []);

export function frontSvg(issue, dir) {
  const front = issue.pages.find((p) => p.section === "front");
  const lead = front.stories.find((s) => s.size === "lead") ?? front.stories[0];
  const photo = lead.image ? dataUri(dir, lead.image.src) : null;
  const W = 1200, H = 1600;
  const head = wrap(lead.headline.toUpperCase(), 26).slice(0, 4);
  const others = front.stories.filter((s) => s !== lead).slice(0, 3);
  const y0 = 330 + head.length * 74;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 0.06 0"/></filter></defs>
<rect width="${W}" height="${H}" fill="#f3ead6"/>
<rect width="${W}" height="${H}" filter="url(#grain)"/>
<text x="600" y="150" text-anchor="middle" font-family="'UnifrakturMaguntia','Old English Text MT','Times New Roman',serif" font-size="128" fill="#16120c">The Morning Wood</text>
<line x1="60" y1="180" x2="1140" y2="180" stroke="#16120c" stroke-width="4"/>
<text x="60" y="214" font-family="Georgia,serif" font-size="24" fill="#16120c">No. ${issue.number}</text>
<text x="600" y="214" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="28" fill="#16120c">“${esc(issue.motto)}”</text>
<text x="1140" y="214" text-anchor="end" font-family="Georgia,serif" font-size="24" fill="#16120c">${esc(longDate(issue.date))}</text>
<line x1="60" y1="232" x2="1140" y2="232" stroke="#16120c" stroke-width="1.5"/>
<g transform="translate(1010 270) rotate(-12)"><rect x="-95" y="-34" width="190" height="62" fill="none" stroke="#c0281e" stroke-width="5" rx="6"/><text x="0" y="12" text-anchor="middle" font-family="Impact,'Arial Black',sans-serif" font-size="40" fill="#c0281e" letter-spacing="4">SATIRE</text></g>
${head.map((l, i) => `<text x="60" y="${320 + i * 74}" font-family="'Playfair Display',Georgia,serif" font-weight="900" font-size="68" fill="#16120c">${esc(l)}</text>`).join("\n")}
${photo ? `<image href="${photo}" x="60" y="${y0}" width="1080" height="720" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="60" y="${y0}" width="1080" height="720" fill="#d8ccb2"/><text x="600" y="${y0 + 370}" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#5a4c36">[ photo: ${esc((lead.image?.alt ?? "").slice(0, 60))} ]</text>`}
<text x="60" y="${y0 + 750}" font-family="Georgia,serif" font-style="italic" font-size="20" fill="#3a3024">${esc((lead.image?.caption ?? lead.image?.alt ?? "").slice(0, 110))} — ${esc(lead.image?.credit ?? "")}</text>
<line x1="60" y1="${y0 + 775}" x2="1140" y2="${y0 + 775}" stroke="#16120c" stroke-width="1.5"/>
${others.map((s, i) => { const x = 60 + i * 370; return wrap(s.headline, 24).slice(0, 4).map((l, k) => `<text x="${x}" y="${y0 + 820 + k * 34}" font-family="Georgia,serif" font-weight="700" font-size="28" fill="#16120c">${esc(l)}</text>`).join("\n"); }).join("\n")}
</svg>
`;
}

export function previewHtml(issue) {
  const story = (s) => `<article class="${s.size ?? "minor"}">${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}<h2>${esc(s.headline)}</h2>${s.deck ? `<h3>${esc(s.deck)}</h3>` : ""}<div class="by">By ${esc(s.byline)}</div>${
    s.image ? `<figure>${s.image.src && !s.image.placeholder ? `<img src="${esc(s.image.src)}" alt="${esc(s.image.alt)}">` : `<div class="ph ${s.image.kind}">${s.image.kind === "meme" ? `<b>${esc(s.image.template ?? "meme")}</b>${(s.image.captions ?? []).map((c) => `<span>${esc(c)}</span>`).join("")}` : `<b>AI PHOTO (to make)</b><span>${esc(s.image.prompt ?? s.image.alt)}</span>`}</div>`}<figcaption>${esc(s.image.caption ?? s.image.alt)} <i>${esc(s.image.credit)}</i></figcaption></figure>` : ""
  }${md(s.body)}</article>`;
  const m = issue.markets;
  const t = (k) => m.tokens[k];
  const block = (b) => {
    if (b === "markets") return `<table class="mk"><tr><th></th><th>Price</th><th>24h</th><th>Volume</th><th>Liquidity</th><th>Burned</th><th>Holders</th></tr>${["PAPER", "PLANK"].map((k) => `<tr><td>${k}</td><td>${t(k).priceUsd ?? "–"}</td><td>${t(k).change24hPct ?? "–"}%</td><td>${t(k).volume24hUsd ?? "–"}</td><td>${t(k).liquidityUsd ?? "–"}</td><td>${t(k).burnedTotal ?? "–"}</td><td>${t(k).holders ?? "–"}</td></tr>`).join("")}<tr><td>Paper Mills</td><td colspan="6">${m.mills.live ?? "–"} live · ${m.mills.holders ?? "–"} holders · backing $${m.mills.backingUsd ?? "–"} per mill</td></tr></table>${m.sample ? '<p class="sample">SAMPLE NUMBERS — not real market data</p>' : ""}`;
    if (b === "letters") return `<h2>Letters</h2>${issue.letters.map((l) => `<p class="letter">“${esc(l.text)}” — <b>${esc(l.name)}</b>${l.reply ? `<br><i>Ed.: ${esc(l.reply)}</i>` : ""}</p>`).join("")}`;
    if (b === "classifieds") return `<h2>Classifieds</h2>${issue.classifieds.map((c) => `<p class="ad">${c.heading ? `<b>${esc(c.heading)}.</b> ` : ""}${esc(c.text)}${c.name ? ` — ${esc(c.name)}` : ""}</p>`).join("")}`;
    if (b === "horoscopes") return `<h2>Horoscopes</h2>${issue.horoscopes.map((h) => `<p><b>${h.sign}:</b> ${esc(h.text)}</p>`).join("")}`;
    if (b === "weather") return `<h2>Weather</h2>${(issue.weather ?? []).map((w) => `<p><b>${esc(w.city)}</b> ${w.highF}°/${w.lowF}° ${esc(w.sky)}${w.quip ? ` — ${esc(w.quip)}` : ""}</p>`).join("")}`;
    if (b === "staff") return `<h2>Staff</h2>${(issue.staff ?? []).map((s) => `<p><b>${esc(s.name)}</b>, ${esc(s.beat)}</p>`).join("")}`;
    return "";
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Morning Wood No. ${issue.number} (preview)</title>
<style>
body{margin:0;background:#e9e2d0;color:#16120c;font:17px/1.5 Georgia,serif}
.page{max-width:980px;margin:24px auto;padding:24px 28px;background:#f6efdf;box-shadow:0 2px 10px #0003;position:relative}
.page.tabloid{background:#fffdf6;border-top:14px solid var(--a,#e8442e)}
.stamp{position:absolute;right:20px;top:18px;transform:rotate(-10deg);color:#c0281e;border:3px solid #c0281e;padding:2px 10px;font:900 20px Impact,sans-serif;letter-spacing:3px}
.mast{text-align:center;font:400 64px 'Old English Text MT','Times New Roman',serif;margin:0}
.motto{text-align:center;font-style:italic;border-top:3px solid;border-bottom:1px solid;padding:4px;margin-bottom:16px}
.flag{font:900 44px Impact,'Arial Black',sans-serif;text-transform:uppercase;color:var(--a,#e8442e);margin:0 0 8px}
h2{margin:.2em 0;font:900 30px Georgia,serif}.lead h2{font-size:46px}.tabloid h2{font-family:Impact,'Arial Black',sans-serif;font-weight:400;font-size:34px}
h3{margin:0 0 .3em;font-weight:400;font-style:italic}.by{font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.kicker{font:700 12px sans-serif;letter-spacing:2px;color:#c0281e}
article{border-bottom:1px solid #0002;padding:12px 0}figure{margin:8px 0}img{max-width:100%;display:block}
figcaption{font-size:13px;color:#4a4030}.ph{background:#ddd2b8;padding:28px;text-align:center;display:flex;flex-direction:column;gap:6px;font-size:14px}
.ph.meme{background:#222;color:#fff;font:700 18px Impact,sans-serif;text-transform:uppercase}
table.mk{width:100%;border-collapse:collapse;font:14px monospace}table.mk td,table.mk th{border-bottom:1px solid #0002;padding:4px;text-align:right}table.mk td:first-child{text-align:left;font-weight:700}
.sample{color:#c0281e;font-weight:700}.ad{font:14px/1.4 'Courier New',monospace}
</style></head><body>
${issue.sample ? '<p style="text-align:center;color:#c0281e;font-weight:700">SAMPLE ISSUE — rehearsal, not for sale</p>' : ""}
${issue.pages.map((p) => `<section class="page ${p.layout}" style="${p.accent ? `--a:${p.accent}` : ""}"><div class="stamp">SATIRE</div>${p.section === "front" ? `<h1 class="mast">The Morning Wood</h1><div class="motto">No. ${issue.number} · “${esc(issue.motto)}” · ${esc(longDate(issue.date))}${issue.weatherEar ? ` · ${esc(issue.weatherEar)}` : ""}</div>` : `<h1 class="flag">${esc(p.title ?? p.section)}</h1>`}${(p.stories ?? []).map(story).join("")}${(p.blocks ?? []).map(block).join("")}</section>`).join("\n")}
</body></html>`;
}

export function metadata(issue) {
  const front = issue.pages.find((p) => p.section === "front");
  const lead = front.stories.find((s) => s.size === "lead") ?? front.stories[0];
  return {
    name: `The Morning Wood — No. ${issue.number}, ${longDate(issue.date)}`,
    description: `${lead.headline}. Satire. "${issue.motto}" Sold for 24 hours only; read it at /press.`,
    image: "front.svg",
    external_url: `/press/${issue.number}`,
    animation_url: "preview.html",
    attributes: [
      { trait_type: "Date", value: issue.date },
      { trait_type: "Issue", display_type: "number", value: issue.number },
      { trait_type: "Weekday", value: new Date(`${issue.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) },
      { trait_type: "Lead", value: lead.headline },
    ],
    properties: { issue: "issue.json", satire: true },
  };
}

export function layout(file) {
  const dir = dirname(resolve(file));
  const issue = readJson(file);
  writeFileSync(resolve(dir, "front.svg"), frontSvg(issue, dir));
  writeFileSync(resolve(dir, "preview.html"), previewHtml(issue));
  writeJson(resolve(dir, "metadata.json"), metadata(issue));
  return dir;
}

// main module (pathToFileURL: on Windows argv[1] is C:\..., and a path may have spaces)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const a = args();
  const file = a._[0] ?? resolve(PAPER_DIR, "out", issueDate(a.date), "issue.json");
  const dir = layout(file);
  console.log(`laid out -> ${dir}/front.svg, preview.html, metadata.json`);
}
