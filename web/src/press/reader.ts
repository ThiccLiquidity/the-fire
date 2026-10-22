// The Morning Wood's reader: an issue you flip like a newspaper. One page on a phone (or any tall screen), a two-page
// spread on a tablet in landscape or a desktop (the front page alone on the right, like a real paper). Turn pages by
// swiping (the page follows your finger), with the arrow keys, by clicking the edges, or with the buttons; pinch,
// double-tap or ctrl+wheel to zoom into a page, drag to move around it. Contents jumps to a section.
//
// Smooth: the page turn moves one "leaf" with transform and opacity only (Web Animations, so it runs on the
// compositor), and the pages themselves are never re-laid out mid-turn: the same page elements move between the
// slots and the leaf. With reduced motion, pages swap with a short fade.
import { esc, sectionOf, shortDate, type Issue } from "./issue.ts";
import { renderPage, type PageOpts } from "./render.ts";
import { reducedMotion } from "../site/mode.ts";

export interface ReaderOpts {
  issue: Issue;
  preview: boolean;
  start?: number;
  pageOpts: PageOpts;
  onClose(): void;
  onBuy(): void;
  onLetter(form: HTMLFormElement): void;
}

interface Flip {
  to: number; leaf: HTMLElement; shades: [HTMLElement, HTMLElement];
  a0: number; a1: number; p: number; anims: Animation[];
}

const ICON = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  toc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8.5 11h5"/></svg>',
};

export class Reader {
  readonly dlg: HTMLDialogElement;
  private o: ReaderOpts;
  private stage!: HTMLElement; private zoomEl!: HTMLElement; private book!: HTMLElement;
  private label!: HTMLElement; private live!: HTMLElement; private toc!: HTMLDialogElement;
  private n: number;
  private page = 0;
  private spread = false;
  private pw = 0; private ph = 0;
  private cache = new Map<number, HTMLElement>();
  private flip: Flip | null = null;
  private z = 1; private tx = 0; private ty = 0;
  private ro: ResizeObserver;
  private sized = "";
  private onKey: (e: KeyboardEvent) => void = () => {};

  constructor(o: ReaderOpts) {
    this.o = o;
    this.n = o.preview ? Math.min(2, o.issue.pages.length) : o.issue.pages.length;
    this.page = Math.max(0, Math.min(this.n - 1, o.start ?? 0));
    const d = this.dlg = document.createElement("dialog");
    d.className = "reader";
    d.setAttribute("aria-label", `The Morning Wood, No. ${o.issue.number ?? ""}, ${shortDate(o.issue.date)}`);
    d.innerHTML = `
      <header class="rbar">
        <button class="rbtn" type="button" data-act="close" aria-label="Close the paper">${ICON.close}<span>Close</span></button>
        <div class="rtitle"><b>The Morning Wood</b><span>No. ${o.issue.number ?? "—"} · ${esc(shortDate(o.issue.date))}${o.preview ? " · Front page" : ""}</span></div>
        <button class="rbtn" type="button" data-act="toc" aria-haspopup="dialog">${ICON.toc}<span>Contents</span></button>
      </header>
      <div class="stage" tabindex="-1">
        <div class="zoom"><div class="book"></div></div>
        <button class="edge prev" type="button" data-act="prev" aria-label="Previous page">${ICON.prev}</button>
        <button class="edge next" type="button" data-act="next" aria-label="Next page">${ICON.next}</button>
      </div>
      <footer class="rfoot">
        <button class="rbtn" type="button" data-act="prev" aria-label="Previous page">${ICON.prev}</button>
        <p class="plabel" aria-hidden="true"></p>
        <button class="rbtn zoom-reset" type="button" data-act="unzoom" aria-label="Zoom out" hidden>${ICON.zoom}</button>
        <button class="rbtn" type="button" data-act="next" aria-label="Next page">${ICON.next}</button>
      </footer>
      <p class="sr-only" aria-live="polite"></p>
      <dialog class="toc" aria-label="Contents">
        <h2>Contents</h2>
        <ol>${(o.preview ? o.issue.pages.slice(0, 1) : o.issue.pages).map((p, i) => `<li><button type="button" data-page="${i}"><span>${esc(sectionOf(p.section).name)}</span><small>${esc(p.stories[0]?.headline ?? "")}</small><b>${i + 1}</b></button></li>`).join("")}</ol>
        <button class="btn ghost" type="button" data-act="toc-close">Close</button>
      </dialog>`;
    this.stage = d.querySelector(".stage")!; this.zoomEl = d.querySelector(".zoom")!; this.book = d.querySelector(".book")!;
    this.label = d.querySelector(".plabel")!; this.live = d.querySelector("[aria-live]")!; this.toc = d.querySelector(".toc")!;
    this.wire();
    this.ro = new ResizeObserver(() => this.layout());
  }

  open(): void {
    document.body.append(this.dlg);
    this.dlg.showModal();
    document.documentElement.classList.add("reading");
    this.layout();
    this.ro.observe(this.stage);
    document.addEventListener("keydown", this.onKey); // on the document: keys still turn pages when focus was lost
    this.stage.focus({ preventScroll: true });
  }

  close(): void {
    this.ro.disconnect();
    document.removeEventListener("keydown", this.onKey);
    this.dlg.close();
    this.dlg.remove();
    document.documentElement.classList.remove("reading");
    this.o.onClose();
  }

  // ---------- where we are
  private get pos(): number { return this.spread ? this.spreadOf(this.page) : this.page; }
  private get maxPos(): number { return this.spread ? this.spreadOf(this.n - 1) : this.n - 1; }
  private spreadOf(p: number): number { return p === 0 ? 0 : Math.floor((p + 1) / 2); }
  private pagesAt(pos: number): number[] {
    if (!this.spread) return [pos];
    return pos === 0 ? [-1, 0] : [2 * pos - 1, 2 * pos < this.n ? 2 * pos : -1];
  }
  private firstOf(pos: number): number { return this.spread ? (pos === 0 ? 0 : 2 * pos - 1) : pos; }

  private pageEl(i: number): HTMLElement | null {
    if (i < 0 || i >= this.n) return null;
    let el = this.cache.get(i);
    if (!el) { el = renderPage(this.o.issue, i, { ...this.o.pageOpts, preview: this.o.preview }); this.cache.set(i, el); }
    return el;
  }
  /** Re-render one page (the letters box after sending). */
  refreshPage(i: number, pageOpts: PageOpts): void {
    this.o.pageOpts = pageOpts;
    const old = this.cache.get(i);
    if (!old) return;
    this.cache.delete(i);
    const el = this.pageEl(i)!;
    const hadFocus = old.contains(document.activeElement);
    old.replaceWith(el);
    this.fit(el);
    if (hadFocus) this.stage.focus({ preventScroll: true });
  }

  // ---------- layout: page size, one page or a spread
  private layout(): void {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const spread = W >= 880 && W > H * 1.1;
    const key = `${W}x${H}:${spread}`;
    if (key === this.sized && !this.flip) return;
    this.sized = key;
    this.cancelFlip();
    this.spread = spread;
    const RATIO = 0.7; // a newspaper page, width : height
    if (spread) { this.ph = Math.floor(Math.min(H - 20, (W - 40) / 2 / RATIO)); this.pw = Math.floor(this.ph * RATIO); }
    else { this.ph = H - 12; this.pw = Math.floor(Math.min(W - 12, Math.max(this.ph * 0.78, Math.min(W - 12, 560)))); }
    this.book.style.setProperty("--pw", this.pw + "px");
    this.book.style.setProperty("--ph", this.ph + "px");
    this.book.style.setProperty("--fs", Math.max(12.5, Math.min(17, this.pw * 0.027)).toFixed(2) + "px");
    this.book.classList.toggle("spread", spread);
    this.setZoom(1, 0, 0);
    for (const el of this.cache.values()) delete el.dataset.fit;
    this.renderStatic();
  }

  private slot(cls: string, i: number): HTMLElement {
    const s = document.createElement("div");
    s.className = `slot ${cls}`;
    const el = this.pageEl(i);
    if (el) s.append(el); else s.classList.add("empty");
    return s;
  }

  /** A spread with one page: slide the book so that page sits in the middle (transform only). */
  private center(pos: number): void {
    const [l, r] = this.pagesAt(pos);
    this.book.classList.toggle("alone-r", this.spread && l < 0);
    this.book.classList.toggle("alone-l", this.spread && r < 0 && l >= 0);
  }

  private renderStatic(): void {
    const ps = this.pagesAt(this.pos);
    this.center(this.pos);
    this.book.replaceChildren(...(this.spread ? [this.slot("left", ps[0]), this.slot("right", ps[1])] : [this.slot("single", ps[0])]));
    for (const i of ps) { const el = this.cache.get(i); if (el) this.fit(el); }
    this.updateChrome();
    this.prefetch();
  }

  /** Shrink a page's type a little (to 82%) when its stories run long; past that the page scrolls. Once per size. */
  private fit(el: HTMLElement): void {
    const key = `${this.pw}x${this.ph}`;
    if (el.dataset.fit === key || !el.isConnected) return;
    el.dataset.fit = key;
    el.classList.remove("scrolls");
    let f = 1;
    el.style.setProperty("--fit", "1");
    while (el.scrollHeight > el.clientHeight + 2 && f > 0.83) { f -= 0.06; el.style.setProperty("--fit", f.toFixed(2)); }
    el.classList.toggle("scrolls", el.scrollHeight > el.clientHeight + 2);
  }

  /** The next and previous pages' pictures, fetched ahead so a turn never shows an empty box. */
  private prefetch(): void {
    const near = [...this.pagesAt(this.pos + 1), ...this.pagesAt(this.pos - 1)].filter((i) => i >= 0 && i < this.n);
    for (const i of near) this.pageEl(i)?.querySelectorAll("img").forEach((im) => { const pre = new Image(); pre.decoding = "async"; pre.src = im.src; });
  }

  private updateChrome(): void {
    const ps = this.pagesAt(this.pos).filter((i) => i >= 0);
    const names = ps.map((i) => (this.o.preview && i > 0 ? "Inside" : sectionOf(this.o.issue.pages[i].section).name));
    const nums = ps.map((i) => i + 1).join("–");
    this.label.textContent = `${ps.length > 1 ? "Pages" : "Page"} ${nums} of ${this.n} · ${[...new Set(names)].join(" / ")}`;
    this.live.textContent = this.label.textContent;
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-act="prev"]').forEach((b) => (b.disabled = this.pos <= 0));
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-act="next"]').forEach((b) => (b.disabled = this.pos >= this.maxPos));
    this.toc.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((b) => b.toggleAttribute("aria-current", ps.includes(+b.dataset.page!)));
  }

  // ---------- turning pages
  next(): void { this.turn(1); }
  prev(): void { this.turn(-1); }
  goTo(page: number): void {
    if (this.flip) this.cancelFlip();
    this.page = Math.max(0, Math.min(this.n - 1, page));
    this.setZoom(1, 0, 0);
    this.renderStatic();
    if (!reducedMotion()) this.book.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }

  private turn(dir: 1 | -1): void {
    if (this.flip) return;
    if (this.z > 1) this.setZoom(1, 0, 0);
    if (reducedMotion()) {
      const to = this.pos + dir;
      if (to < 0 || to > this.maxPos) return;
      this.page = this.firstOf(to); this.renderStatic();
      this.book.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
      return;
    }
    const f = this.startFlip(dir);
    if (f) this.endFlip(true, 0);
  }

  /** Set up a turn: the pages under it in the slots, the turning page on a leaf. Null at either end. */
  private startFlip(dir: 1 | -1): Flip | null {
    const from = this.pos, to = from + dir;
    if (to < 0 || to > this.maxPos) return null;
    const A = this.pagesAt(from), B = this.pagesAt(to);
    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.setAttribute("aria-hidden", "true");
    const face = (cls: string, i: number | null) => {
      const f = document.createElement("div");
      f.className = `face ${cls}`;
      const el = i == null ? null : this.pageEl(i);
      if (el) f.append(el); else f.classList.add("blank");
      const sh = document.createElement("div"); sh.className = "shade"; f.append(sh);
      return f;
    };
    let front: HTMLElement, back: HTMLElement, a0: number, a1: number;
    if (this.spread) {
      if (dir > 0) { // the right page turns over to the left
        this.book.replaceChildren(this.slot("left", A[0]), this.slot("right", B[1]));
        front = face("front", A[1]); back = face("back", B[0]); leaf.classList.add("at-right"); a0 = 0; a1 = -180;
      } else { // the left page turns back over to the right
        this.book.replaceChildren(this.slot("left", B[0]), this.slot("right", A[1]));
        front = face("front", A[0]); back = face("back", B[1]); leaf.classList.add("at-left"); a0 = 0; a1 = 180;
      }
    } else if (dir > 0) { // the page lifts off to the left, the next one is under it
      this.book.replaceChildren(this.slot("single", B[0]));
      front = face("front", A[0]); back = face("back", null); leaf.classList.add("at-single"); a0 = 0; a1 = -180;
    } else { // the previous page comes back from the left, over this one
      this.book.replaceChildren(this.slot("single", A[0]));
      front = face("front", B[0]); back = face("back", null); leaf.classList.add("at-single"); a0 = -180; a1 = 0;
    }
    leaf.append(front, back);
    this.book.append(leaf);
    for (const i of [...A, ...B]) { const el = this.cache.get(i); if (el) this.fit(el); }
    const shades: [HTMLElement, HTMLElement] = [front.querySelector(".shade")!, back.querySelector(".shade")!];
    this.center(to); // the book slides to where the new spread sits while the page turns
    this.flip = { to, leaf, shades, a0, a1, p: 0, anims: [] };
    this.setFlip(0);
    return this.flip;
  }

  private angle(f: Flip, p: number) { return f.a0 + (f.a1 - f.a0) * p; }
  /** How far the turn is (0 to 1), while a finger or the mouse holds it. Transform and opacity only. */
  private setFlip(p: number): void {
    const f = this.flip;
    if (!f) return;
    f.p = Math.max(0, Math.min(1, p));
    const a = this.angle(f, f.p), t = Math.abs(a) / 180; // 0 flat, 1 flat on the other side
    f.leaf.style.transform = `rotateY(${a.toFixed(2)}deg)`;
    f.shades[0].style.opacity = (t * 0.55).toFixed(3);
    f.shades[1].style.opacity = ((1 - t) * 0.55).toFixed(3);
  }

  /** Let go: finish the turn (or fall back), then settle the pages in their slots. */
  private endFlip(complete: boolean, velocity: number): void {
    const f = this.flip;
    if (!f) return;
    const target = complete ? 1 : 0, dist = Math.abs(target - f.p);
    const duration = Math.max(140, Math.min(620, (velocity > 0.6 ? 300 : 560) * dist));
    const easing = "cubic-bezier(.25,.6,.3,1)";
    const ta = Math.abs(this.angle(f, f.p)) / 180, tb = Math.abs(this.angle(f, target)) / 180;
    f.anims = [
      f.leaf.animate([{ transform: `rotateY(${this.angle(f, f.p)}deg)` }, { transform: `rotateY(${this.angle(f, target)}deg)` }], { duration, easing, fill: "forwards" }),
      f.shades[0].animate([{ opacity: ta * 0.55 }, { opacity: tb * 0.55 }], { duration, easing, fill: "forwards" }),
      f.shades[1].animate([{ opacity: (1 - ta) * 0.55 }, { opacity: (1 - tb) * 0.55 }], { duration, easing, fill: "forwards" }),
    ];
    f.anims[0].finished.then(() => {
      if (this.flip !== f) return;
      this.flip = null;
      if (complete) this.page = this.firstOf(f.to);
      this.renderStatic();
    }, () => { /* cancelled */ });
  }

  private cancelFlip(): void {
    const f = this.flip;
    if (!f) return;
    f.anims.forEach((a) => a.cancel());
    this.flip = null;
    this.renderStatic();
  }

  // ---------- zoom
  private setZoom(z: number, tx: number, ty: number): void {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    this.z = Math.max(1, Math.min(4, z));
    if (this.z <= 1.01) { this.z = 1; tx = 0; ty = 0; }
    this.tx = Math.min(0, Math.max(W - W * this.z, tx));
    this.ty = Math.min(0, Math.max(H - H * this.z, ty));
    this.zoomEl.style.transform = this.z === 1 ? "" : `translate(${this.tx}px,${this.ty}px) scale(${this.z})`;
    this.stage.classList.toggle("zoomed", this.z > 1);
    this.dlg.querySelector<HTMLElement>(".zoom-reset")!.hidden = this.z === 1;
  }
  private zoomAt(cx: number, cy: number, z: number, z0 = this.z, tx0 = this.tx, ty0 = this.ty): void {
    const nz = Math.max(1, Math.min(4, z));
    this.setZoom(nz, cx - ((cx - tx0) / z0) * nz, cy - ((cy - ty0) / z0) * nz);
  }
  private local(x: number, y: number) { const r = this.stage.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; }

  // ---------- input
  private wire(): void {
    const d = this.dlg;
    d.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "close") this.close();
      else if (act === "prev") this.prev();
      else if (act === "next") this.next();
      else if (act === "unzoom") this.setZoom(1, 0, 0);
      else if (act === "toc") this.toc.showModal();
      else if (act === "toc-close") this.toc.close();
      const pg = t.closest<HTMLElement>("[data-page]");
      if (pg) { this.toc.close(); this.goTo(+pg.dataset.page!); this.stage.focus({ preventScroll: true }); }
      if (t.closest("[data-buy]")) { this.close(); this.o.onBuy(); }
    });
    d.addEventListener("submit", (e) => {
      const form = (e.target as HTMLElement).closest<HTMLFormElement>("form[data-letter]");
      if (form) { e.preventDefault(); this.o.onLetter(form); }
    });
    d.addEventListener("cancel", (e) => { // Escape: the contents first, then the paper
      if (this.toc.open) return;
      e.preventDefault(); this.close();
    });
    this.onKey = (e: KeyboardEvent) => {
      if (!this.dlg.open || this.toc.open || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "PageDown" || (k === " " && !e.shiftKey)) { e.preventDefault(); this.next(); }
      else if (k === "ArrowLeft" || k === "PageUp" || (k === " " && e.shiftKey)) { e.preventDefault(); this.prev(); }
      else if (k === "Home") { e.preventDefault(); this.goTo(0); }
      else if (k === "End") { e.preventDefault(); this.goTo(this.n - 1); }
      else if (k === "+" || k === "=") this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, this.z * 1.5);
      else if (k === "-") this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, this.z / 1.5);
      else if (k === "0") this.setZoom(1, 0, 0);
    };
    this.wireTouch();
    this.wireMouse();
  }

  /** Touch: swipe to turn (the page follows), pinch to zoom, drag to move when zoomed, double-tap to zoom, tap an
   *  edge to turn. Vertical drags scroll a long page (touch-action: pan-y while not zoomed). */
  private wireTouch(): void {
    const st = this.stage;
    let mode: "" | "flip" | "scroll" | "pan" | "pinch" | "none" = "";
    let x0 = 0, y0 = 0, t0 = 0, lastX = 0, lastT = 0, vx = 0, dir: 1 | -1 = 1;
    let pinch = { d0: 1, z0: 1, tx0: 0, ty0: 0, cx: 0, cy: 0 };
    let lastTap = { t: 0, x: 0, y: 0 };
    const mid = (a: Touch, b: Touch) => this.local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    const onForm = (e: TouchEvent) => !!(e.target as HTMLElement).closest("input, textarea, select, button, label, a");

    st.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        if (this.flip) this.endFlip(false, 0);
        const [a, b] = [e.touches[0], e.touches[1]], m = mid(a, b);
        pinch = { d0: dist(a, b), z0: this.z, tx0: this.tx, ty0: this.ty, cx: m.x, cy: m.y };
        mode = "pinch"; return;
      }
      if (e.touches.length !== 1 || this.flip) { mode = "none"; return; }
      const t = e.touches[0];
      x0 = lastX = t.clientX; y0 = t.clientY; t0 = lastT = e.timeStamp; vx = 0;
      mode = this.z > 1 ? "pan" : "";
      pinch = { ...pinch, tx0: this.tx, ty0: this.ty };
      if (mode === "" && onForm(e)) mode = "none";
    }, { passive: true });

    st.addEventListener("touchmove", (e) => {
      if (mode === "pinch" && e.touches.length >= 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]], m = mid(a, b);
        this.zoomAt(pinch.cx, pinch.cy, pinch.z0 * (dist(a, b) / pinch.d0), pinch.z0, pinch.tx0 + (m.x - pinch.cx), pinch.ty0 + (m.y - pinch.cy));
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (e.timeStamp > lastT) { vx = (t.clientX - lastX) / (e.timeStamp - lastT); lastX = t.clientX; lastT = e.timeStamp; }
      if (mode === "pan") { e.preventDefault(); this.setZoom(this.z, pinch.tx0 + dx, pinch.ty0 + dy); return; }
      if (mode === "") {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          dir = dx < 0 ? 1 : -1;
          mode = this.startFlip(dir) ? "flip" : "none";
        } else if (Math.abs(dy) > 10) mode = "scroll";
      }
      if (mode === "flip") {
        e.preventDefault();
        const w = this.spread ? this.pw : this.pw * 0.85;
        this.setFlip(((dir > 0 ? -dx : dx) - 10) / w);
      }
    }, { passive: false });

    const end = (e: TouchEvent) => {
      if (e.touches.length) return;
      const moved = Math.hypot(lastX - x0, 0) > 8;
      if (mode === "flip") {
        const fling = Math.abs(vx) > 0.35 && Math.sign(-vx) === dir;
        this.endFlip((this.flip?.p ?? 0) > 0.3 || fling, Math.abs(vx));
      } else if ((mode === "" || mode === "pan") && !moved && e.timeStamp - t0 < 300 && e.type === "touchend") {
        const p = this.local(x0, y0), now = e.timeStamp;
        if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) { // double-tap: zoom in / out
          if (this.z > 1) this.setZoom(1, 0, 0); else this.zoomAt(p.x, p.y, 2.5);
          lastTap.t = 0;
        } else {
          lastTap = { t: now, x: p.x, y: p.y };
          const W = st.clientWidth;
          if (this.z === 1 && !(e.target as HTMLElement).closest("button, a, input, label, form")) { // tap an edge: turn
            if (p.x < W * 0.14) this.prev(); else if (p.x > W * 0.86) this.next();
          }
        }
      }
      mode = "";
    };
    st.addEventListener("touchend", end);
    st.addEventListener("touchcancel", (e) => { if (mode === "flip") this.endFlip(false, 0); end(e); });
  }

  /** Mouse and pen: drag a page to turn it, drag to move when zoomed, ctrl+wheel (or a trackpad pinch) to zoom,
   *  a sideways trackpad swipe to turn, double-click to zoom. */
  private wireMouse(): void {
    const st = this.stage;
    let down: { x: number; y: number; tx: number; ty: number; id: number } | null = null, mode: "" | "flip" | "pan" | "none" = "", dir: 1 | -1 = 1;
    st.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0 || this.flip) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, button, label, a")) return;
      down = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, id: e.pointerId };
      mode = this.z > 1 ? "pan" : "";
    });
    st.addEventListener("pointermove", (e) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (mode === "pan") { this.setZoom(this.z, down.tx + dx, down.ty + dy); st.setPointerCapture(e.pointerId); return; }
      if (mode === "" && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        dir = dx < 0 ? 1 : -1;
        mode = this.startFlip(dir) ? "flip" : "none";
        if (mode === "flip") { st.setPointerCapture(e.pointerId); st.classList.add("dragging"); getSelection()?.removeAllRanges(); }
      }
      if (mode === "flip") this.setFlip(((dir > 0 ? -dx : dx) - 12) / (this.spread ? this.pw : this.pw * 0.85));
    });
    const up = () => {
      if (mode === "flip") this.endFlip((this.flip?.p ?? 0) > 0.3, 0);
      st.classList.remove("dragging");
      down = null; mode = "";
    };
    st.addEventListener("pointerup", up);
    st.addEventListener("pointercancel", up);
    st.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("input, textarea, button, label, a, form")) return;
      const p = this.local(e.clientX, e.clientY);
      if (this.z > 1) this.setZoom(1, 0, 0); else this.zoomAt(p.x, p.y, 2.2);
    });
    let swipe = 0, swipeT = 0, fired = false;
    st.addEventListener("wheel", (e) => {
      if (e.ctrlKey) { // pinch on a trackpad, or ctrl + wheel
        e.preventDefault();
        const p = this.local(e.clientX, e.clientY);
        this.zoomAt(p.x, p.y, this.z * Math.exp(-e.deltaY * 0.01));
        return;
      }
      if (this.z > 1) { e.preventDefault(); this.setZoom(this.z, this.tx - e.deltaX, this.ty - e.deltaY); return; }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) { // a sideways swipe on a trackpad: one turn per gesture
        e.preventDefault();
        if (e.timeStamp - swipeT > 400) { swipe = 0; fired = false; }
        swipeT = e.timeStamp; swipe += e.deltaX;
        if (Math.abs(swipe) > 60 && !fired) { fired = true; if (swipe > 0) this.next(); else this.prev(); }
      }
    }, { passive: false });
  }
}
