// The Morning Wood's pages as DOM: the front page is a classic broadsheet, the inside pages are tabloid. Every page
// carries a small SATIRE mark (the front page a big stamp too). Pictures load lazily, in boxes with a fixed shape, so
// nothing jumps when they arrive.
import { esc, longDate, markdown, sectionOf, shortDate, type Issue, type Line, type MarketRow, type Page, type Story } from "./issue.ts";

/** Black or white type on a section's accent colour. */
const inkOn = (hex: string) => { const n = parseInt(hex.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 150 ? "#111" : "#fff"; };

export interface PageOpts {
  /** The reader shows the whole issue, or just the front page and a "buy to read on" page. */
  preview: boolean;
  /** The back page's letters box: "open" for holders of today's issue, "closed" (today's issue, not a holder), or none. */
  letterBox: "open" | "locked" | null;
  /** The demo writes letters into this browser; shown to the writer under the box. */
  sent: { kind: string; text: string }[];
}

const STAMP = '<span class="satire-mark" aria-label="Satire">SATIRE</span>';

function picture(s: Story, cls = "", stamp = false): string {
  if (!s.image) return "";
  const im = s.image, tag = im.kind === "meme" ? "Meme" : im.kind === "staff" ? "Staff photo" : "Illustration";
  const pic = im.src ? `<img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy" decoding="async" draggable="false">`
    : `<div class="ph-standin" role="img" aria-label="${esc(im.alt || im.standIn)}"><span>${esc(im.standIn)}</span></div>`; // the picture isn't made yet
  return `<figure class="ph ph-${im.kind} ${cls}">
    <div class="ph-box">${pic}${stamp ? '<span class="satire-stamp" aria-hidden="true">Satire</span>' : ""}</div>
    <figcaption>${im.caption ? `${esc(im.caption)} ` : ""}<span class="ph-kind">${tag}</span>${im.credit ? ` ${esc(im.credit)}` : ""}</figcaption>
  </figure>`;
}

function storyHtml(s: Story, level: 2 | 3, cls: string, withPic = true): string {
  const h = `h${level}`;
  return `<section class="story ${cls}">
    ${s.kicker ? `<p class="kicker">${esc(s.kicker)}</p>` : ""}
    <${h} class="hed">${esc(s.headline)}</${h}>
    ${s.deck ? `<p class="deck">${esc(s.deck)}</p>` : ""}
    ${s.byline ? `<p class="byline">By ${esc(s.byline)}</p>` : ""}
    ${withPic ? picture(s) : ""}
    <div class="body">${markdown(s.body)}</div>
    ${s.pullQuote ? `<blockquote class="pull">${esc(s.pullQuote)}</blockquote>` : ""}
  </section>`;
}

function foot(issue: Issue, n: number, label: string): string {
  return `<footer class="pfoot"><span>The Morning Wood · ${esc(shortDate(issue.date))} · ${esc(label)}</span><span class="pno">${n}</span>${STAMP}</footer>`;
}

function front(issue: Issue, page: Page): string {
  const [lead, ...rest] = page.stories;
  const weather = issue.weatherEar ? null : rest.find((s) => /^weather/i.test(s.headline));
  const others = rest.filter((s) => s !== weather);
  const ear = issue.weatherEar ? `<b>Weather</b><br>${esc(issue.weatherEar)}`
    : weather ? `<b>${esc(weather.headline.replace(/^weather:\s*/i, ""))}</b><br>${esc(weather.body.split(/\.\s/)[0])}.` : "Price:<br>1 PAPER + 5¢";
  return `
  <header class="mast">
    <div class="ears">
      <p class="ear">Satire.<br>All of it.<br>Every word.</p>
      <p class="ear ear-r">${ear}</p>
    </div>
    <h1 class="title">The Morning Wood</h1>
    <p class="motto">${esc(issue.motto)}</p>
    <div class="dateline"><span>${esc(issue.edition || `Vol. I · No. ${issue.number ?? "—"}`)}</span><span>${esc(longDate(issue.date))}</span><span>1 PAPER + 5¢</span></div>
  </header>
  ${lead?.image ? "" : '<div class="satire-stamp" aria-hidden="true">Satire</div>'}
  ${lead ? `<section class="story lead">
    ${lead.kicker ? `<p class="kicker">${esc(lead.kicker)}</p>` : ""}
    <h2 class="hed">${esc(lead.headline)}</h2>
    ${lead.deck ? `<p class="deck">${esc(lead.deck)}</p>` : ""}
    ${picture(lead, "lead-ph", true)}
    ${lead.byline ? `<p class="byline">By ${esc(lead.byline)}</p>` : ""}
    <div class="body cols">${markdown(lead.body)}</div>
    ${lead.pullQuote ? `<blockquote class="pull">${esc(lead.pullQuote)}</blockquote>` : ""}
  </section>` : ""}
  ${others.length ? `<div class="seconds">${others.map((s) => storyHtml(s, 3, "second")).join("")}</div>` : ""}
  ${foot(issue, 1, "Front Page")}`;
}

const fmtNum = (v: number | null, dollars = false): string => {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = a >= 1e9 ? (v / 1e9).toFixed(2) + "B" : a >= 1e6 ? (v / 1e6).toFixed(2) + "M" : a >= 1e4 ? (v / 1e3).toFixed(1) + "K" : a >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : a === 0 ? "0" : v.toPrecision(3);
  return (dollars ? "$" : "") + s;
};

function spark(r: MarketRow): string {
  if (r.spark.length < 2) return "";
  const lo = Math.min(...r.spark), hi = Math.max(...r.spark), span = hi - lo || 1, n = r.spark.length - 1;
  const pts = r.spark.map((v, i) => `${((i / n) * 100).toFixed(1)},${(28 - ((v - lo) / span) * 26).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

function markets(issue: Issue): string {
  const rows = issue.markets.rows;
  if (!rows.length) return "";
  return `${issue.markets.sample ? '<p class="sample-note">SAMPLE NUMBERS: not real market data</p>' : ""}<div class="tickers">${rows.map((r) => {
    const ch = r.change24h, dir = ch == null ? "" : ch >= 0 ? "up" : "down";
    return `<div class="ticker ${dir}">
      <div class="tk-top"><b class="tk-sym">${esc(r.symbol)}</b><span class="tk-ch">${ch == null ? "" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%`}</span></div>
      ${r.stats ? "" : `<div class="tk-price">${fmtNum(r.price, true)}</div>`}
      ${spark(r)}
      <dl class="tk-stats">${(r.stats ?? [["Volume 24h", fmtNum(r.volume24h, true)], ["Liquidity", fmtNum(r.liquidity, true)], ["Burned 24h", fmtNum(r.burned24h)], ["Holders", fmtNum(r.holders)]])
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    </div>`;
  }).join("")}</div>
  ${issue.markets.asOf ? `<p class="asof">Numbers as of ${esc(new Date(issue.markets.asOf).toUTCString().replace(/:\d\d GMT/, " UTC"))}. Filled in by code, not by the writers.</p>` : ""}`;
}

function backMatter(issue: Issue, page: Page, o: PageOpts): string {
  const lines = (title: string, cls: string, xs: Line[]) => (xs.length ? `<section class="box ${cls}"><h3>${title}</h3><ul>${xs.map((l) => `<li>${l.heading ? `<b class="cl-h">${esc(l.heading)}</b> ` : ""}${esc(l.text)}${l.by ? ` <span class="by">— ${esc(l.by)}</span>` : ""}${l.reply ? `<span class="reply">Ed.: ${esc(l.reply)}</span>` : ""}</li>`).join("")}</ul></section>` : "");
  const horo = issue.horoscopes.length ? `<section class="box horo"><h3>Horoscopes <small>by Kurt Vonneplank</small></h3><dl>${issue.horoscopes.map((h) => `<div>${h.sign ? `<dt>${esc(h.sign)}</dt>` : ""}<dd>${esc(h.text)}</dd></div>`).join("")}</dl></section>` : "";
  const weather = issue.weather.length ? `<section class="box weather"><h3>Weather <small>by Mark Twine</small></h3><ul>${issue.weather.map((w) => `<li><b>${esc(w.city)}</b> ${w.highF ?? "—"}°/${w.lowF ?? "—"}° ${esc(w.sky)}${w.quip ? ` <i>${esc(w.quip)}</i>` : ""}</li>`).join("")}</ul></section>` : "";
  const parts: Record<string, string> = { letters: lines("Letters to the Editor", "letters", issue.letters), classifieds: lines("Classifieds", "classifieds", issue.classifieds), horoscopes: horo, weather };
  const order = page.blocks.filter((b) => b in parts);
  let box = "";
  if (o.letterBox === "open") {
    box = `<form class="letterbox" data-letter novalidate>
      <h3>Write to the paper</h3>
      <p>One line for tomorrow's paper. The best are printed under your profile name.</p>
      <fieldset class="lb-kind"><legend class="sr-only">Kind</legend>
        <label><input type="radio" name="kind" value="letter" checked> Letter</label>
        <label><input type="radio" name="kind" value="classified"> Classified</label>
      </fieldset>
      <label class="sr-only" for="lb-text">Your line</label>
      <input id="lb-text" name="text" maxlength="120" autocomplete="off" placeholder="Dear Editor, …" required>
      <button class="lb-send" type="submit">Send · 1 PAPER</button>
      ${o.sent.length ? `<ul class="lb-sent">${o.sent.map((s) => `<li><b>${s.kind === "classified" ? "Classified" : "Letter"}:</b> ${esc(s.text)}</li>`).join("")}</ul>` : ""}
    </form>`;
  } else if (o.letterBox === "locked") {
    box = `<div class="letterbox locked"><h3>Write to the paper</h3><p>Holders of today's paper can send a letter or a classified for tomorrow.</p></div>`;
  }
  return `<div class="back-grid">${(order.length ? order : ["letters", "classifieds", "horoscopes", "weather"]).map((b) => parts[b]).join("")}</div>${box}`;
}

function tabloid(issue: Issue, page: Page, n: number, o: PageOpts): string {
  const sec = sectionOf(page.section);
  const [top, ...rest] = page.stories;
  return `
  <header class="flag"><span class="flag-name">${esc(page.title || sec.name)}</span><span class="flag-meta">The Morning Wood · No. ${issue.number ?? "—"}</span></header>
  ${top ? storyHtml(top, 2, "top") : ""}
  ${page.section === "markets" || page.blocks.includes("markets") ? markets(issue) : ""}
  ${rest.map((s) => storyHtml(s, 3, "more")).join("")}
  ${page.section === "back" || page.blocks.some((b) => b !== "markets" && b !== "staff") ? backMatter(issue, page, page.section === "back" ? o : { ...o, letterBox: null }) : ""}
  ${foot(issue, n, page.title || sec.name)}`;
}

function paywall(issue: Issue): string {
  return `<header class="flag"><span class="flag-name">Inside</span><span class="flag-meta">The Morning Wood · No. ${issue.number ?? "—"}</span></header>
  <div class="paywall">
    <h2 class="hed">The rest is for holders</h2>
    <p>${issue.pages.slice(1).map((p) => esc(sectionOf(p.section).name)).join(" · ")}</p>
    <button class="btn buy" type="button" data-buy>Buy today's paper</button>
  </div>
  ${foot(issue, 2, "Inside")}`;
}

/** Page i of the issue (or of its preview) as an <article>. */
export function renderPage(issue: Issue, i: number, o: PageOpts): HTMLElement {
  const el = document.createElement("article");
  el.className = "pg";
  if (o.preview && i >= 1) {
    el.classList.add("tabloid", "sec-inside");
    el.style.setProperty("--sec", "#1b1712"); el.style.setProperty("--sec-ink", "#f4ecd8");
    el.innerHTML = `<div class="pg-in">${paywall(issue)}</div>`;
    el.setAttribute("aria-label", "Inside pages");
    return el;
  }
  const page = issue.pages[i];
  const sec = sectionOf(page.section);
  el.dataset.section = page.section;
  el.setAttribute("aria-label", `Page ${i + 1}: ${sec.name}`);
  if (page.layout === "broadsheet") { el.classList.add("broadsheet"); el.innerHTML = `<div class="pg-in">${front(issue, page)}</div>`; }
  else {
    el.classList.add("tabloid", `sec-${page.section}`);
    el.style.setProperty("--sec", page.accent || sec.color); el.style.setProperty("--sec-ink", page.accent ? inkOn(page.accent) : sec.ink);
    el.innerHTML = `<div class="pg-in">${tabloid(issue, page, i + 1, o)}</div>`;
  }
  return el;
}

/** A small copy of the front page for the shelf and the sale: masthead, lead headline, its picture. */
export function renderCover(issue: Issue, size: "sale" | "shelf"): string {
  const lead = issue.pages[0]?.stories[0];
  return `<div class="cover cover-${size}" aria-hidden="true">
    <div class="cv-mast">The Morning Wood</div>
    <div class="cv-line"><span>No. ${issue.number ?? "—"}</span><span>${esc(shortDate(issue.date))}</span></div>
    ${lead ? `<div class="cv-hed">${esc(lead.headline)}</div>` : ""}
    ${lead?.image ? `<div class="cv-ph">${lead.image.src ? `<img src="${esc(lead.image.src)}" alt="" loading="lazy" decoding="async">` : '<span class="cv-standin"></span>'}</div>` : ""}
    <span class="cv-satire">SATIRE</span>
  </div>`;
}
