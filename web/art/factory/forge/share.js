/* Omni Cardworks (fun layer): pictures to share. The pack recap (after an opening: your pulls from one pack as one
   1080 x 1350 image, the best card big, the rest fanned under it) and the sell-out recap (when a Series sells out: a
   card with how fast it went, the packs and the top pulls, as an image too). Canvas to PNG; the share sheet where the
   phone has one (Web Share with files), else a download. */
(() => {
  const { h, mem } = Fun;
  const LIVE = window.Live?.on;
  const S = Store.state;
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); if (/^https?:/.test(src)) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const rarity = (c) => Store.trueOdds(c).n;
  const GLOW = { paper: '#ffd98a', wood: '#ff9f2e', fire: '#ff5a12', charcoal: '#e0260c', diamond: '#bfe6ff', gold: '#ffb81c', fullart: '#ffd27a' };
  const kind = (c) => [Store.MAT_LABEL[c.material], c.holo && c.holo !== 'none' && !Store.ALWAYS_HOLO[c.material] ? { frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' }[c.holo] : '', c.grade != null ? 'PDA ' + c.grade : ''].filter(Boolean).join(' · ');

  async function fonts() { await Promise.all(['400 64px "Russo One"', '800 36px Nunito', '600 30px Nunito'].map((f) => document.fonts.load(f).catch(() => {}))); }
  function backdrop(g, W, H, glow = 'rgba(255,150,60,.42)') {
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3b2614'); gr.addColorStop(0.55, '#22150b'); gr.addColorStop(1, '#0d0805');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = 88; x < W; x += 180) g.fillRect(x, 0, 3, H);
    gr = g.createRadialGradient(W / 2, H * 0.36, 40, W / 2, H * 0.36, H * 0.5); gr.addColorStop(0, glow); gr.addColorStop(0.5, 'rgba(255,120,40,.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.6)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  /** One card's picture: drawn sharp from its parts at the studio's still angle (holo.js), else from its image (a strip
   *  of 12 states in the old demo art; one image live). */
  async function cardPic(c) {
    const cv = await window.Holo?.picture?.(c, 720).catch(() => null);
    if (cv) return { im: cv, sx: 0, sw: cv.width, sh: cv.height };
    const im = await loadImg(Store.cardImg(c)).catch(() => loadImg('ui/card-back.webp'));
    const strip = im.naturalWidth / im.naturalHeight > 2, sw = strip ? im.naturalWidth / Store.STATES : im.naturalWidth;
    return { im, sx: strip ? Store.stateIdx(c) * sw : 0, sw, sh: im.naturalHeight };
  }
  function drawCard(g, p, cx, cy, hgt, rot = 0, glow = null) {
    const w = hgt * p.sw / p.sh;
    g.save(); g.translate(cx, cy); g.rotate(rot); g.imageSmoothingQuality = 'high';
    g.shadowColor = glow || 'rgba(0,0,0,.8)'; g.shadowBlur = glow ? 60 : 30; g.shadowOffsetY = glow ? 0 : 12;
    g.drawImage(p.im, p.sx, 0, p.sw, p.sh, -w / 2, -hgt / 2, w, hgt); g.shadowColor = 'transparent';
    g.drawImage(p.im, p.sx, 0, p.sw, p.sh, -w / 2, -hgt / 2, w, hgt); g.restore();
  }
  function fit(g, txt, font, px, max) { let s = px; do g.font = font.replace('{}', s + 'px'); while (g.measureText(txt).width > max && (s -= 2) > 18); }
  async function wordmark(g, W, y) {
    const word = await loadImg('ui/omni-wordmark.webp').catch(() => null), tail = word ? 'CARDWORKS' : 'OMNI CARDWORKS';
    g.font = '400 40px "Russo One", sans-serif'; const fw = g.measureText(tail).width, wh = 46, ww = word ? wh * word.naturalWidth / word.naturalHeight : 0, gap = word ? 12 : 0, x0 = (W - ww - gap - fw) / 2;
    if (word) g.drawImage(word, x0, y - wh + 6, ww, wh);
    g.textAlign = 'left'; g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#0d141c'; g.strokeText(tail, x0 + ww + gap, y); g.fillStyle = '#f9e2b4'; g.fillText(tail, x0 + ww + gap, y);
  }
  const toBlob = (cv) => new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/png'));
  /** Share a PNG: the share sheet if the device has one, else a download. */
  async function sharePng(blob, name, title, text, from) {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title, text }); } catch (e) { if (e?.name !== 'AbortError') toast('Couldn’t share it', 'bad'); } return; }
    const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name, hidden: true });
    (from?.closest('dialog') || document.body).append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Saved', 'good');
  }
  const busyBtn = async (b, fn) => { if (b.getAttribute('aria-busy') === 'true') return; b.setAttribute('aria-busy', 'true'); try { await fn(); } catch { toast('Couldn’t make the image', 'bad'); } finally { b.removeAttribute('aria-busy'); } };

  // ---------- the pack recap: one pack's pulls as one image
  async function packImage(cards, series) {
    const W = 1080, H = 1350, sorted = [...cards].sort((a, b) => rarity(b) - rarity(a)), top = sorted[0], rest = sorted.slice(1, 6);
    await fonts();
    const pics = await Promise.all(sorted.slice(0, 6).map(cardPic));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    backdrop(g, W, H, (GLOW[top.material] || '#ff9650') + '99');
    // the rest fanned behind and under, the best on top
    const n = rest.length;
    rest.forEach((c, i) => { const t = n > 1 ? i / (n - 1) - 0.5 : 0; drawCard(g, pics[i + 1], W / 2 + t * 760, 850 + Math.abs(t) * 80, 330, t * 0.55); });
    drawCard(g, pics[0], W / 2, 430, 640, 0, GLOW[top.material]);
    g.textAlign = 'center'; g.fillStyle = '#f6e8cf'; g.shadowColor = '#000'; g.shadowOffsetY = 4;
    fit(g, `${top.character}, ${kind(top)}`, '400 {} "Russo One", sans-serif', 52, W - 120); g.fillText(`${top.character}, ${kind(top)}`, W / 2, 1150);
    g.shadowOffsetY = 0;
    const odds = Store.trueOdds(top).label;
    g.font = '800 34px Nunito, sans-serif'; g.fillStyle = '#ffd27a'; g.fillText(`My Series ${series} pack${odds ? ' · best ' + odds : ''}`, W / 2, 1200);
    await wordmark(g, W, 1280);
    return toBlob(cv);
  }
  Fun.packShare = (cards, series) => {
    if (!cards?.length || cards.length > 6) return null; // one pack
    const b = h('button', { type: 'button', class: 'btn small share-b fun-packshare', text: 'Share this pack', onclick: () => busyBtn(b, async () => {
      const blob = await packImage(cards, series);
      const top = [...cards].sort((x, y) => rarity(y) - rarity(x))[0]; // the same best card the image leads with
      const look = [{ frame: 'Holo frame', picture: 'Holo picture', full: 'Full holo' }[!Store.ALWAYS_HOLO[top.material] && top.holo] || '', Store.MAT_LABEL[top.material], top.character].filter(Boolean).join(' ');
      await sharePng(blob, `omni-cardworks-series-${series}-pack.png`, `My Series ${series} pack`, `Ripped a Series ${series} pack at Omni Cardworks. Best pull: ${look}! ${Store.shareLink(cards.map((c) => c.id))}`, b);
    }) });
    return b;
  };

  // ---------- the sell-out recap
  const dur = (s) => { s = Math.max(60, Math.round(s)); const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.round((s % 3600) / 60);
    return d ? `${d} day${d > 1 ? 's' : ''}${hh ? ` ${hh} h` : ''}` : hh ? `${hh} h ${m} min` : `${m} min`; };
  const closedAt = {}; // Series -> when this page saw it sell out (seconds)
  async function recapData(no) {
    const top = (await (Fun.feedTop?.(no) || Promise.resolve([])).catch(() => [])).slice(0, 3);
    if (LIVE) {
      const L = window.Live.chain, r = await L.seriesRecap(no);
      return { no, secs: (r.closedAt || Fun.now()) - r.start, packs: r.packs, buyers: r.buyers, top };
    }
    // DEMO: the groups' own numbers (the first opening to the sell-out), the buyers made up
    const gs = S.series.groups, start = gs[2]?.opensAt || Math.min(...gs.map((g) => g.opensAt).filter((x) => x > 0)), end = closedAt[no] || Fun.now(); // from Everyone's opening
    const packs = gs.reduce((a, g) => a + (g.sold || 0), 0) || S.series.total;
    if (no !== S.series.no) return { no, secs: 2460, packs: 167, buyers: 64, top }; // an older demo Series: made-up numbers
    return { no, secs: Number.isFinite(start) ? end - start : 2460, packs, buyers: Math.max(1, Math.round(packs / 2.6)), top };
  }
  async function recapImage(d) {
    const W = 1080, H = 1350; await fonts();
    const pics = await Promise.all(d.top.map(cardPic));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    backdrop(g, W, H);
    g.textAlign = 'center'; g.fillStyle = '#ffb357'; g.font = '400 44px "Russo One", sans-serif'; g.fillText(`SERIES ${d.no}`, W / 2, 150);
    g.fillStyle = '#f6e8cf'; fit(g, `Sold out in ${dur(d.secs)}`, '400 {} "Russo One", sans-serif', 88, W - 100); g.fillText(`Sold out in ${dur(d.secs)}`, W / 2, 260);
    g.font = '800 40px Nunito, sans-serif'; g.fillStyle = '#d4bd98'; g.fillText(`${d.packs.toLocaleString('en-US')} packs · ${d.buyers.toLocaleString('en-US')} collectors`, W / 2, 330);
    const n = pics.length;
    pics.forEach((p, i) => drawCard(g, p, W / 2 + (i - (n - 1) / 2) * 320, 690, 470, (i - (n - 1) / 2) * 0.08, GLOW[d.top[i].material]));
    if (n) { g.font = '800 34px Nunito, sans-serif'; g.fillStyle = '#ffd27a'; g.fillText('Top pulls', W / 2, 1010);
      g.font = '600 30px Nunito, sans-serif'; g.fillStyle = '#f6e8cf'; d.top.forEach((c, i) => g.fillText(`${c.character}, ${kind(c)}`, W / 2, 1060 + i * 42)); }
    await wordmark(g, W, 1280);
    return toBlob(cv);
  }
  Fun.open.recap = async (no = S.series.no) => {
    const root = h('div', { class: 'st recap' }, h('p', { class: 'muted', text: 'Counting the packs…' }));
    Sheet.open('recap', { title: `Series ${no} sold out`, body: root });
    let d; try { d = await recapData(no); } catch { Fun.put(root, h('p', { class: 'warn', text: 'Couldn’t load the numbers. Try again.' })); return; }
    const face = (c) => h('div', { class: `cface m-${c.material} hd-${Store.holder(c)}` }, h('img', { class: 'cframe', src: Store.cardImg(c), style: `object-position:${Store.cardPos(c)}`, alt: '', loading: 'lazy' }));
    const b = h('button', { type: 'button', class: 'btn primary', text: 'Share', onclick: () => busyBtn(b, async () => sharePng(await recapImage(d), `omni-cardworks-series-${no}.png`, `Series ${no} sold out`, `Series ${no} sold out in ${dur(d.secs)}. ${Store.shareLink()}`, b)) });
    Fun.put(root, 
      h('p', { class: 'rc-big fun-noterms' }, `Series ${no} sold out in `, h('b', { text: dur(d.secs) })),
      h('dl', { class: 'rc-stats' }, h('div', {}, h('dt', { text: 'Packs' }), h('dd', { text: d.packs.toLocaleString('en-US') })), h('div', {}, h('dt', { text: 'Collectors' }), h('dd', { text: d.buyers.toLocaleString('en-US') }))),
      d.top.length ? [h('h3', { text: 'Top pulls' }), h('div', { class: 'rc-top' }, d.top.map((c) => h('figure', {}, face(c), h('figcaption', { text: `${c.character}, ${kind(c)}` }))))] : null,
      h('div', { class: 'row' }, b, h('button', { type: 'button', class: 'btn', text: 'Close', onclick: () => Sheet.close('recap') })),
      LIVE ? null : h('p', { class: 'demo-line', text: 'Demo numbers' }));
  };
  // a small note (never a pop-up over what you're doing): "Series 7 sold out · See the recap", gone after 15 s
  function nudge(no) {
    const el = h('div', { class: 'fun-nudge', role: 'status' }, h('span', { text: `Series ${no} sold out!` }),
      h('button', { type: 'button', class: 'btn small primary', text: 'See the recap', onclick: () => { el.remove(); Fun.open.recap(no); } }),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Close', text: '×', onclick: () => el.remove() }));
    document.body.append(el); setTimeout(() => el.remove(), 15000);
  }
  // a Series selling out while you watch: a note with its recap, once, after the sold-out show
  let was = { no: S.series.no, phase: S.series.phase };
  Store.on(() => {
    const now = { no: S.series.no, phase: S.series.phase };
    if (now.no && now.no === was.no && was.phase < 4 && now.phase >= 4 && !(S.series.left > 0) && (!LIVE || S.series.loaded) && !mem('omni.recap.' + now.no)) { // ended unsold: no sell-out recap
      closedAt[now.no] = Fun.now(); mem('omni.recap.' + now.no, 1);
      const show = () => (Sheet.covering ? setTimeout(show, 2000) : nudge(now.no));
      setTimeout(show, 7500);
    }
    was = now;
  });
})();
