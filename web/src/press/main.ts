// The Printing Press (/press/): today's issue of The Morning Wood on sale for 24 hours, your shelf of papers, your
// streak badges, and the reader. Demo by default (a demo wallet in this browser); live wiring waits for the paper's
// contract (live.ts). Prices show here; where the money goes is only in Info.
import "../site/fonts.css";
import "./press.css";
import "./paper.css";
import "./reader.css";
import { homeUrl, liveNet, markDoors, withMode } from "../site/mode.ts";
import { cacheIssue, esc, isCached, nyMorning, loadIndex, loadIssue, shortDate, longDate, type IndexEntry, type Issue } from "./issue.ts";
import { renderCover, type PageOpts } from "./render.ts";
import { Reader } from "./reader.ts";
import { BADGES, bestStreak, demo, demoName, resetDemo, save, streak } from "./store.ts";
import { pressLive, wallet } from "./live.ts";

const LIVE = liveNet();
const DAY = 86_400_000;
const PRICE = { PAPER: 1, USD: 0.05, ETH_USD: 2500 }; // demo: what $0.05 is in ETH
markDoors();

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const app = $("#app");
let index: IndexEntry[] = [];
let today: Issue | null = null;
let reader: Reader | null = null;
let saleEnd = 0;

// ---------- shell
app.innerHTML = `
<header class="topbar">
  <a class="home" href="${esc(withMode(homeUrl()))}" aria-label="Home: the two doors"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10"/></svg><span>Home</span></a>
  <div class="brand"><b>The Printing Press</b><small>The Morning Wood</small></div>
  <div class="grow"></div>
  <button class="chip" type="button" data-act="info" aria-haspopup="dialog">Info</button>
  <button class="chip wallet" type="button" data-act="wallet"></button>
</header>
${LIVE ? "" : '<div class="demo-note" role="note"><b>Demo</b><span>Nothing here is real.</span><button type="button" data-act="reset">Start over</button></div>'}
<main id="main" tabindex="-1">
  <section class="sale" id="sale" aria-labelledby="sale-h"><h1 id="sale-h" class="sr-only">Today's paper</h1><div class="sale-in"><p class="loading-line">Warming up the press…</p></div></section>
  <section class="streak" id="streak" aria-labelledby="streak-h"></section>
  <section class="shelf" id="shelf" aria-labelledby="shelf-h"></section>
</main>
<footer class="foot">
  <p><span class="satire-chip">SATIRE</span> The Morning Wood is satire. Every story is made up.</p>
  <p><a href="${esc(withMode("/forge/"))}">Cardworks</a> · <button type="button" class="linkish" data-act="info">How it works</button></p>
</footer>
<dialog class="sheet" id="sheet-buy" aria-labelledby="buy-h"></dialog>
<dialog class="sheet" id="sheet-info" aria-labelledby="info-h">
  <h2 id="info-h">How the Printing Press works</h2>
  <ul class="info-list">
    <li><b>One issue a day.</b> Written overnight, out in the morning. The whole issue is one NFT, read right here: flip it like a paper.</li>
    <li><b>Today only.</b> Each issue sells for 24 hours, then closes for good. After that, old issues only come from other holders.</li>
    <li><b>Price.</b> 1 PAPER plus $0.05 in ETH or USDG.</li>
    <li><b>Where it goes.</b> The PAPER is burned. The $0.05 buys PAPER on the market, and that's burned too. The paper isn't here to make money.</li>
    <li><b>Streaks.</b> Buy 7 days in a row for the Subscriber badge, 30 for Paperboy. They show on your profile.</li>
    <li><b>Letters and classifieds.</b> Holders of today's issue can send one line for tomorrow's paper (1 PAPER). The best are printed under your profile name.</li>
    <li><b>Satire.</b> Every page is stamped SATIRE. Nothing in it is news.</li>
    ${LIVE ? "" : "<li><b>Demo.</b> Nothing here is real: a demo wallet, no payments.</li>"}
  </ul>
  <button class="btn" type="button" data-act="close">Close</button>
</dialog>
<div class="toasts" aria-live="polite"></div>`;

function toast(html: string, kind: "good" | "bad" | "" = "", ms = 3800): HTMLElement {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = html;
  // the reader is a modal dialog (the top layer): while it's open, toasts go inside it
  const rd = document.querySelector("dialog.reader[open]");
  let box = rd?.querySelector<HTMLElement>(".toasts");
  if (rd && !box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("aria-live", "polite"); rd.append(box); }
  (box ?? $(".toasts")).append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
  return t;
}

// ---------- wallet chip
function walletChip(): void {
  const b = $<HTMLButtonElement>('[data-act="wallet"]');
  if (!LIVE) {
    const d = today ? demo(today.date) : null;
    b.innerHTML = `<span class="dot"></span><span>Demo wallet</span>${d ? `<b>${d.paper} PAPER</b>` : ""}`;
    b.setAttribute("aria-label", d ? `Demo wallet: ${d.paper} PAPER` : "Demo wallet");
    return;
  }
  const w = window.ForgeWallet?.state();
  b.innerHTML = w?.connected ? `<span class="dot on"></span><span>${esc(w.short)}</span>${w.paper ? `<b>${esc(w.paper)} PAPER</b>` : ""}` : "<span>Connect</span>";
}

// ---------- the sale: today's issue
function saleWindow(issue: Issue): { start: number; end: number } {
  // on sale at 6am New York time (the issue's nft.opensAt when it has one), for 24 hours
  let start = issue.saleStart ?? nyMorning(issue.date), end = issue.saleEnd ?? start + DAY;
  if (!LIVE && (end <= Date.now() || start > Date.now())) { // the demo: today's issue is always this morning's
    const todayNy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    start = nyMorning(todayNy); if (start > Date.now()) start -= DAY;
    end = start + DAY;
  }
  return { start, end };
}

const pad = (n: number) => String(n).padStart(2, "0");
function left(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function renderSale(): void {
  const el = $("#sale .sale-in");
  if (LIVE && !pressLive.contract) {
    el.innerHTML = `<div class="sale-copy"><p class="kicker">The Printing Press</p><h2 class="sale-title">Not open yet</h2><p class="lede">The Morning Wood starts printing soon. Connect now and you're ready for the first issue.</p></div>`;
    return;
  }
  if (!today) { el.innerHTML = `<p class="lede">No paper today. The press is resting.</p>`; return; }
  const d = demo(today.date), owned = d.bought.includes(today.date);
  const { end } = saleWindow(today);
  saleEnd = end;
  const open = Date.now() < end;
  el.innerHTML = `
    <button class="cover-btn" type="button" data-act="${owned ? "read" : "peek"}" aria-label="${owned ? "Read today's paper" : "Peek at the front page"}">${renderCover(today, "sale")}<span class="peek">${owned ? "Read" : "Peek"}</span></button>
    <div class="sale-copy">
      <p class="kicker">Today's paper · No. ${today.number ?? "—"}</p>
      <h2 class="sale-title">${esc(longDate(today.date))}</h2>
      <p class="price" aria-label="Price: 1 PAPER plus 5 cents"><b>1 PAPER</b><span>+ $0.05</span></p>
      <p class="clock" ${open ? "" : 'data-closed=""'}><span class="clock-label">${open ? "Closes in" : "Closed for good"}</span> <time class="clock-time">${open ? left(end - Date.now()) : ""}</time></p>
    </div>
    <div class="sale-actions">
        ${owned ? `<button class="btn buy" type="button" data-act="read">Read today's paper</button><p class="owned">✓ On your shelf</p>`
          : open ? `<button class="btn buy" type="button" data-act="buy">Buy</button><button class="btn ghost" type="button" data-act="peek">Peek at the front page</button>`
          : `<p class="lede">Old issues only come from other holders.</p>`}
    </div>`;
}

function tick(): void {
  const t = document.querySelector<HTMLElement>(".clock-time");
  if (!t || !saleEnd) return;
  const ms = saleEnd - Date.now();
  if (ms <= 0) { renderSale(); return; }
  t.textContent = left(ms);
}
setInterval(tick, 1000);

// ---------- buying (demo)
function openBuy(): void {
  if (!today) return;
  const d = demo(today.date), dlg = $<HTMLDialogElement>("#sheet-buy");
  const ethPart = PRICE.USD / PRICE.ETH_USD;
  dlg.innerHTML = `
    <h2 id="buy-h">Buy today's paper</h2>
    <div class="buy-row">${renderCover(today, "shelf")}<div><p class="kicker">The Morning Wood · No. ${today.number ?? "—"}</p><p class="buy-date">${esc(shortDate(today.date))}</p></div></div>
    <fieldset class="pay"><legend>Pay the $0.05 with</legend>
      <label><input type="radio" name="pay" value="ETH" checked> ETH <small>≈ ${ethPart.toFixed(5)}</small></label>
      <label><input type="radio" name="pay" value="USDG"> USDG <small>0.05</small></label>
    </fieldset>
    <dl class="total"><div><dt>Price</dt><dd>1 PAPER + $0.05</dd></div><div><dt>You have</dt><dd>${d.paper} PAPER</dd></div></dl>
    ${d.paper < PRICE.PAPER ? `<p class="warn">You need 1 PAPER. <a href="${esc(withMode("/forge/"))}">Get PAPER</a></p>` : ""}
    <div class="sheet-actions"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn buy" type="button" data-act="confirm-buy" ${d.paper < PRICE.PAPER ? "disabled" : ""}>Buy</button></div>`;
  dlg.showModal();
}

async function confirmBuy(btn: HTMLButtonElement): Promise<void> {
  if (!today) return;
  const d = demo(today.date), pay = ($<HTMLInputElement>('#sheet-buy input[name="pay"]:checked')).value;
  btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Printing…';
  await new Promise((r) => setTimeout(r, 900)); // the demo's "transaction"
  const before = bestStreak(d.bought);
  d.paper -= PRICE.PAPER;
  if (pay === "USDG") d.usdg -= PRICE.USD; else d.eth -= PRICE.USD / PRICE.ETH_USD;
  if (!d.bought.includes(today.date)) d.bought.push(today.date);
  save();
  $<HTMLDialogElement>("#sheet-buy").close();
  cacheIssue(today);
  renderAll(today.date);
  const t = toast(`<b>Printed!</b> It's on your shelf. <button class="linkish" type="button" data-act="read">Read it</button>`, "good", 6000);
  t.querySelector("button")?.addEventListener("click", () => read(today!.date));
  const after = bestStreak(d.bought);
  const won = BADGES.find((b) => before < b.days && after >= b.days);
  if (won) setTimeout(() => toast(`<span class="badge-mini">★</span> <b>New badge: ${won.name}.</b> ${won.blurb}.`, "good", 6000), 700);
}

// ---------- streak and badges
function renderStreak(): void {
  const el = $("#streak");
  if (LIVE || !today) { el.hidden = true; return; }
  const d = demo(today.date), n = streak(d.bought, today.date), best = bestStreak(d.bought), boughtToday = d.bought.includes(today.date);
  el.innerHTML = `
    <h2 id="streak-h">Your streak</h2>
    <p class="streak-n"><b>${n}</b> ${n === 1 ? "day" : "days"} in a row</p>
    <p class="streak-hint">${boughtToday ? "See you tomorrow morning." : n ? `Buy today's paper to make it ${n + 1}.` : "Buy today's paper to start one."}</p>
    <ul class="badges">${BADGES.map((b) => {
      const got = best >= b.days, have = Math.min(b.days, got ? b.days : n);
      return `<li class="badge ${got ? "got" : ""}">
        <span class="badge-seal" aria-hidden="true">${b.days}</span>
        <span class="badge-txt"><b>${b.name}</b><small>${got ? "Earned · on your profile" : `${have} of ${b.days} days`}</small></span>
        <span class="bar" role="progressbar" aria-label="${b.name}" aria-valuemin="0" aria-valuemax="${b.days}" aria-valuenow="${have}"><i style="transform:scaleX(${(have / b.days).toFixed(3)})"></i></span>
      </li>`;
    }).join("")}</ul>`;
}

// ---------- my papers
async function renderShelf(fresh?: string): Promise<void> {
  const el = $("#shelf");
  if (LIVE) { el.innerHTML = `<h2 id="shelf-h">My papers</h2><p class="empty">Your papers show here once the Printing Press opens.</p>`; return; }
  if (!today) { el.innerHTML = ""; return; }
  const d = demo(today.date);
  const mine = index.filter((e) => d.bought.includes(e.date));
  el.innerHTML = `<h2 id="shelf-h">My papers <small>${mine.length}</small></h2>${mine.length ? '<ul class="papers"></ul>' : `<p class="empty">No papers yet. Today's is right up there.</p>`}`;
  const ul = el.querySelector("ul");
  if (!ul) return;
  const issues = await Promise.all(mine.map((e) => loadIssue(e.date).catch(() => null)));
  ul.innerHTML = issues.map((is, i) => (is ? `<li class="${mine[i].date === fresh ? "fresh" : ""}"><button type="button" class="paper-btn" data-read="${is.date}" aria-label="Read No. ${is.number ?? ""}, ${esc(shortDate(is.date))}">${renderCover(is, "shelf")}<span class="paper-meta"><b>${esc(shortDate(is.date))}</b><small class="off" data-off="${is.date}" hidden>Saved offline</small></span></button></li>` : "")).join("");
  for (const is of issues) if (is) { cacheIssue(is).then(() => isCached(is)).then((ok) => { const s = el.querySelector<HTMLElement>(`[data-off="${is.date}"]`); if (s) s.hidden = !ok; }); }
}

function renderAll(fresh?: string): void { walletChip(); renderSale(); renderStreak(); renderShelf(fresh); }

// ---------- reading
function pageOpts(issue: Issue): PageOpts {
  const isToday = !!today && issue.date === today.date, d = today ? demo(today.date) : null;
  const holder = !!d && d.bought.includes(issue.date);
  return { preview: false, letterBox: isToday && !LIVE ? (holder ? "open" : "locked") : null, sent: d ? d.letters.filter((l) => l.date === issue.date) : [] };
}

async function read(date: string, preview = false, push = true): Promise<void> {
  let issue: Issue;
  try { issue = await loadIssue(date); } catch { toast("Couldn't load that paper. Check your connection.", "bad"); return; }
  const owned = !LIVE && !!today && demo(today.date).bought.includes(date);
  if (!owned) preview = true;
  reader?.close();
  const r = reader = new Reader({
    issue, preview, pageOpts: pageOpts(issue),
    start: +(new URLSearchParams(location.search).get("p") ?? 1) - 1 || 0,
    onClose: () => {
      if (reader === r) reader = null;
      if (push && history.state?.read) history.back(); // opened from this page: Back is where we were
      else if (history.state?.read) history.replaceState(null, "", location.pathname + (LIVE ? `?live=${LIVE}` : "")); // a shared link
      ($<HTMLElement>(`[data-read="${date}"]`) ?? $<HTMLElement>(".cover-btn") ?? $("#main")).focus({ preventScroll: true });
    },
    onBuy: () => openBuy(),
    onLetter: (form) => sendLetter(form, issue, r),
  });
  if (push) history.pushState({ read: date, preview }, "", `?${new URLSearchParams({ ...(LIVE ? { live: LIVE } : {}), read: date }).toString()}`);
  r.open();
}

addEventListener("popstate", (e) => {
  if (reader && !e.state?.read) { const r = reader; reader = null; r.close(); }
});

function sendLetter(form: HTMLFormElement, issue: Issue, r: Reader): void {
  if (!today) return;
  const d = demo(today.date), input = form.querySelector<HTMLInputElement>('input[name="text"]')!, text = input.value.trim().replace(/\s+/g, " ");
  const kind = form.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ?? "letter";
  if (!text) { input.focus(); toast("Write one line first.", "bad"); return; }
  if (d.paper < 1) { toast("You need 1 PAPER to send it.", "bad"); return; }
  d.paper -= 1;
  d.letters.push({ date: issue.date, kind, text: text.slice(0, 120) });
  save();
  walletChip();
  r.refreshPage(issue.pages.findIndex((p) => p.section === "back"), pageOpts(issue));
  toast(`<b>Sent to the desk</b> as ${esc(demoName())}. The best ones print tomorrow.`, "good");
}

// ---------- clicks
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  const rd = t.closest<HTMLElement>("[data-read]")?.dataset.read;
  if (rd) return read(rd);
  if (t.closest(".reader")) return; // the reader handles its own
  switch (act) {
    case "info": $<HTMLDialogElement>("#sheet-info").showModal(); break;
    case "close": t.closest("dialog")?.close(); break;
    case "buy": openBuy(); break;
    case "confirm-buy": confirmBuy(t.closest("button")!); break;
    case "read": if (today) read(today.date); break;
    case "peek": if (today) read(today.date, true); break;
    case "reset": resetDemo(); renderAll(); toast("Demo reset: a fresh wallet and a 6-day streak."); break;
    case "wallet":
      if (!LIVE) { toast(`Demo wallet: ${today ? demo(today.date).paper : 0} PAPER. Nothing here is real.`); break; }
      try { const w = await wallet(); w.onChange(() => walletChip()); await w.open(); } catch (err) { toast(esc((err as Error).message), "bad"); }
      break;
  }
});

// ---------- offline: a small service worker keeps the page and owned papers (press-sw.js)
if ("serviceWorker" in navigator && isSecureContext) {
  navigator.serviceWorker.register("/press-sw.js", { scope: "/press" }).catch(() => { /* offline reading is a bonus */ });
}

// ---------- start
(async () => {
  walletChip();
  if (LIVE) { renderAll(); return; }
  try { index = await loadIndex(); } catch { $("#sale .sale-in").innerHTML = '<p class="lede">Couldn\'t reach the press. Check your connection.</p>'; return; }
  if (index.length) today = await loadIssue(index[0].date).catch(() => null);
  renderAll();
  const q = new URLSearchParams(location.search).get("read");
  if (q) { history.replaceState({ read: q }, ""); read(q, false, false); }
})();
