/* Omni Cardworks (demo mode): cases, slabs and wear (docs/grading.md), plus the "How does this work?" window.
   Wear.odds is the same model FirePsa.oddsFor runs on chain (contracts/test/cards/wear-model.py): the fresh odds,
   time damage D ~ Poisson(6 x years^0.6) read from the same 32-point table and blended between points, 20% per
   move to lose a grade (first 10 moves count, never below 5 from moves), grades 1-4 fading in with time, and no 10 after
   14 days uncased. Fresh cards grade 7-10. */
(() => {
  const DAY = 86400, YEAR = 365 * DAY, FREE = DAY;
  // fresh odds, grade 1..10 (FirePsa FRESH_*, out of 10,000; fixed forever, every Series): fresh cards grade 7 to 10 only
  const FRESH = [0, 0, 0, 0, 0, 0, 2700, 4000, 3000, 300];
  const MOVE_CAP = 10, DMAX = 9, NO_TEN_AFTER = 14 * DAY; // uncased longer than that since dealt: no 10 (it grades 9)
  const FADE = { 4: YEAR / 12, 3: YEAR / 2, 2: YEAR, 1: 2 * YEAR }; // grade -> opens at (fully open at twice that)
  const BREAK_DAYS = [0, 1, 2, 4, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 300, 365, 456, 548, 730, 913, 1095, 1460,
    1825, 2190, 2555, 2920, 3650, 4380, 5475, 7300, 10950];
  const BREAKS = BREAK_DAYS.map((d) => d * DAY);
  const fact = (k) => (k < 2 ? 1 : k * fact(k - 1));
  const TABLE = BREAKS.map((t) => { // P(D <= k), k = 0..8, at each break
    const lam = t > 0 ? 6 * Math.pow(t / YEAR, 0.6) : 0; let acc = 0;
    return Array.from({ length: DMAX }, (_, k) => (acc += Math.exp(-lam) * lam ** k / fact(k)));
  });
  function timePmf(t) { // distribution of D at t seconds past the free day (index 9 = 9 or more)
    let cdf;
    if (t >= BREAKS[BREAKS.length - 1]) cdf = TABLE[TABLE.length - 1];
    else {
      let i = 0; while (BREAKS[i + 1] <= t) i++;
      const f = (t - BREAKS[i]) / (BREAKS[i + 1] - BREAKS[i]);
      cdf = TABLE[i].map((a, k) => a * (1 - f) + TABLE[i + 1][k] * f);
    }
    return [cdf[0], ...cdf.slice(1).map((c, k) => c - cdf[k]), 1 - cdf[DMAX - 1]];
  }
  const open = (g, t) => (g >= 5 ? 1 : t <= FADE[g] ? 0 : t >= 2 * FADE[g] ? 1 : (t - FADE[g]) / FADE[g]);
  const choose = (n, k) => fact(n) / (fact(k) * fact(n - k));

  // chance of each grade 1..10 for a card `ageSec` seconds uncased since it was dealt, moved `moves` times uncased
  function odds(ageSec, moves = 0, weights = FRESH) {
    const t = Math.max(0, ageSec - FREE), m = Math.min(moves, MOVE_CAP), tp = timePmf(t);
    const total = weights.reduce((a, b) => a + b, 0), raw = new Array(11).fill(0);
    for (let g0 = 5; g0 <= 10; g0++) {
      const w = weights[g0 - 1]; if (!w) continue;
      const kmax = Math.min(m, g0 - 5);
      const bw = Array.from({ length: kmax + 1 }, (_, k) => choose(m, k) * 4 ** (m - k)), bsum = bw.reduce((a, b) => a + b, 0);
      for (let k = 0; k <= kmax; k++) {
        const pm = (w / total) * (bw[k] / bsum);
        for (let d = 0; d <= DMAX; d++) raw[Math.max(1, g0 - k - d)] += pm * tp[d];
      }
    }
    const out = []; let carry = 0;
    for (let g = 1; g <= 10; g++) { const mass = raw[g] + carry, keep = mass * open(g, t); out.push(keep); carry = mass - keep; }
    if (ageSec > NO_TEN_AFTER) { out[8] += out[9]; out[9] = 0; }
    return out;
  }
  function draw(ageSec, moves, rand = Math.random) {
    const o = odds(ageSec, moves); let u = rand() * o.reduce((a, b) => a + b, 0);
    for (let g = 0; g < 10; g++) { if (u < o[g]) return g + 1; u -= o[g]; }
    return 10;
  }
  const avg = (o) => o.reduce((a, p, i) => a + p * (i + 1), 0) / o.reduce((a, b) => a + b, 0);

  // ---- one set of grade bands everywhere (charts, keys, filters, pills and stamps): 10 / 9-8 / 7-6 / 5-4 / 3-2 / 1,
  // each with its colour (PDA 10 gold; the stamp and pill colour of every grade is its band's)
  const BANDS = [
    { g: '10', lo: 10, hi: 10, c: '#ffd36a' }, { g: '9–8', lo: 8, hi: 9, c: '#3fc1b0' }, { g: '7–6', lo: 6, hi: 7, c: '#5ab8f0' },
    { g: '5–4', lo: 4, hi: 5, c: '#4a7fe8' }, { g: '3–2', lo: 2, hi: 3, c: '#ff8a3a' }, { g: '1', lo: 1, hi: 1, c: '#ff5a4a' },
  ];
  const bandOf = (g) => BANDS.find((b) => g >= b.lo && g <= b.hi) || BANDS[BANDS.length - 1];
  /** grade odds (1..10) -> the six bands, each with its share p (0..1) */
  const bandOdds = (o) => { const tot = o.reduce((a, b) => a + b, 0) || 1; return BANDS.map((b) => ({ ...b, p: o.reduce((a, p, i) => a + (i + 1 >= b.lo && i + 1 <= b.hi ? p : 0), 0) / tot })); };
  /** several cards' odds together: the average chance of each grade (what one of them, picked at random, grades) */
  const mixOdds = (list) => { const out = new Array(10).fill(0); list.forEach((o) => { const t = o.reduce((a, b) => a + b, 0) || 1; o.forEach((p, i) => { out[i] += p / t / list.length; }); }); return out; };
  // "1%", "<1%", "—"
  const pct = (p) => (p >= 0.995 ? '100%' : p * 100 >= 0.5 ? Math.round(p * 100) + '%' : p > 0.0005 ? '<1%' : '—');
  // what a grade is called on its slab, and the line where people pay for grades
  const WORD = { 10: 'GEM MINT', 9: 'MINT', 8: 'NM-MT', 7: 'NEAR MINT', 6: 'EX-MT', 5: 'EXCELLENT', 4: 'VG-EX', 3: 'VERY GOOD', 2: 'GOOD', 1: 'POOR' };
  const FINAL_LINE = 'Grades are random and final. No regrades, no refunds. Nothing you pay raises the odds.';
  const TROPHY_LINE = 'A 1 is a patience trophy.';
  const NO_TEN_DAYS = NO_TEN_AFTER / DAY;
  const TEN_FRESH = '1 in ' + Math.round(FRESH.reduce((a, b) => a + b, 0) / FRESH[9]); // "1 in 33"
  const FRESH_ODDS = `Fresh cards grade 7+. A PDA 10 is ${TEN_FRESH}.`;
  // the PDA 10 chance of a raw card, never moved, at a few ages (days since it was dealt): the chart on "Fresh cards grade best"
  const tenAt = (d) => { const o = odds(d * DAY, 0); return o[9] / o.reduce((a, b) => a + b, 0); };
  const pct1 = (p) => (p ? (p * 100 >= 9.95 ? Math.round(p * 100) : (p * 100).toFixed(1)) + '%' : '0');
  /** Right after opening, over the Case & grade wizard: why sooner is better. A PDA 10's chance by day, falling to nothing at 14 days. */
  function nowOrNever() {
    const P = Store.PRICES, days = [[1, 'Today'], [3, 'Day 3'], [7, 'Day 7'], [NO_TEN_DAYS, 'Day ' + NO_TEN_DAYS], [NO_TEN_DAYS + 1, 'After']];
    const top = tenAt(1), el = document.createElement('div'); el.className = 'non'; el.dataset.key = 'how';
    el.innerHTML = `
      <h3 class="non-h">Fresh cards grade best.<span>The sooner you grade, the better your odds.</span></h3>
      <div class="non-chart" role="img" aria-label="Chance of a PDA 10 for a raw card: ${days.map(([d, l]) => `${l} ${pct1(tenAt(d))}`).join(', ')}">
        <span class="non-cap">PDA 10 chance, left raw</span>
        <div class="non-bars">${days.map(([d, l]) => { const p = tenAt(d);
          return `<div class="non-bar${p ? '' : ' gone'}"><b>${p ? pct1(p) : 'No 10'}</b><i style="height:${p ? Math.max(6, p / top * 64) : 0}px"></i><small>${l}</small></div>`; }).join('')}</div>
      </div>
      <ol class="non-l">
        <li><b>24 hours fresh.</b> Your best odds: ${TEN_FRESH} for a PDA 10.</li>
        <li><b>Then raw cards wear a little every day.</b> Just like real ones.</li>
        <li><b>Day ${NO_TEN_DAYS} is last call for a 10.</b> After that, the best a raw card can do is a 9.</li>
      </ol>
      <p class="non-fix"><span><b>Case · ${usd(P.CASE_USD)}</b> freezes it</span><span><b>Grade · ${usd(P.GRADE_USD)}</b> slabs it</span></p>`;
    return el;
  }

  // ---- the card's own wear ----
  const S = () => Store.state;
  const ageSecOf = (c) => Store.ageMs(c) / 1000;
  // ms of the fresh first day left (time doesn't wear it; moves still count)
  const freshLeft = (c) => (c.grade == null && !c.cased && !c.pending ? Math.max(0, FREE * 1000 - Store.ageMs(c)) : 0);
  const FRESH_LINE = "New cards don't wear for 24h. Moves still count.";
  const hhmm = (ms) => { const m = Math.max(1, Math.floor(ms / 60000)), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; }; // "23h 59m", not a clock
  const ageTxt = (ms) => { const d = ms / 86400000; return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : d < 60 ? `${Math.round(d)} days` : d < 730 ? `${Math.round(d / 30.4)} months` : `${(d / 365).toFixed(1)} years`; };

  // ---- paying for cases and grades: dollars, in ETH (the default), PLANK or USDG ----
  const COINS = ['ETH', 'PLANK', 'USDG'];
  const coins = () => COINS;
  const inCoin = (usd, coin) => {
    const P = Store.PRICES;
    return coin === 'ETH' ? usd / P.ETH_USD : coin === 'USDG' ? usd : usd / P.PLANK_USD;
  };
  const fmtCoin = (v, coin) => coin === 'ETH' ? v.toFixed(v < 0.01 ? 6 : 4) : coin === 'USDG' || coin === 'PAPER' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US');
  const usd = (v) => '$' + (Number.isInteger(+v.toFixed(2)) ? Math.round(v) : v.toFixed(2)); // $1, $0.05, $4.10

  // ---- "How it works": one window, over whatever is open (no fund flows here: Info › Grading says where fees go) ----
  function howBody() {
    const P = Store.PRICES;
    const rows = [['Fresh', 0], ['1 week', 7], ['1 month', 30], ['3 months', 91], ['1 year', 365], ['3 years', 3 * 365]].map(([l, d]) => {
      const b = bandOdds(odds((d + 1) * DAY, 0));
      return `<tr><th>${l}</th>${b.map((x) => `<td>${pct(x.p)}</td>`).join('')}</tr>`;
    }).join('');
    const el = document.createElement('div'); el.className = 'how';
    el.innerHTML = `
      <section><h3><span class="how-n">1</span>Case or grade?</h3>
        <div class="how-two">
          <div class="how-opt case"><b>Case · ${usd(P.CASE_USD)}</b><p>Stops wear. Grade it later at today's odds.</p></div>
          <div class="how-opt slab"><b>Grade · ${usd(P.GRADE_USD)}</b><p>See the grade (1 to 10), get a slab.</p></div>
        </div></section>
      <section><h3><span class="how-n">2</span>Fresh for 24 hours</h3>
        <p>No wear for 24h (moves still count). Case or grade by then.</p></section>
      <section><h3><span class="how-n">3</span>How cards wear</h3>
        <ul><li>Raw cards wear every day.</li>
          <li>After ${NO_TEN_DAYS} days raw, a PDA 10 is gone for good.</li>
          <li>Each move can cost a grade (first 10 only; never below 5).</li>
          <li>A PDA 1–4 takes months of raw wear. ${TROPHY_LINE}</li>
          <li>Condition is hidden, from us too, until the card is graded.</li></ul>
        <div class="how-tw"><table class="how-t"><caption>Grade odds for a raw card, never moved</caption>
          <thead><tr><th>Held raw</th>${BANDS.map((b) => `<th><span class="how-sw" style="background:${b.c}"></span>${b.g === '10' ? 'PDA 10' : b.g}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section>
      <section><h3><span class="how-n">4</span>What a slab means</h3>
        <p>Slabs are forever. ${FINAL_LINE}</p></section>
      <section><h3><span class="how-n">5</span>Prices</h3>
        <dl class="how-p"><dt>Case</dt><dd>${usd(P.CASE_USD)} a card</dd><dt>Grade</dt><dd>${usd(P.GRADE_USD)} a card</dd><dt>Pay with</dt><dd>${coins().join(', ').replace(/, ([^,]*)$/, ' or $1')}</dd></dl>
        <p class="muted small">Pay once for all your picks.</p></section>`;
    return el;
  }
  function openHow() { Sheet.open('how', { title: 'Cases & grading', body: howBody() }); }
  // the pill: big, labelled, and part of every step it sits in
  function howPill() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'how-pill';
    b.innerHTML = '<span class="how-q" aria-hidden="true">?</span><span class="how-txt">How it works</span>'; // phone, in the step row: the "?" alone (the words stay for screen readers)
    b.onclick = openHow; return b;
  }

  window.Wear = { DAY, YEAR, FRESH, odds, draw, avg, ageSecOf, freshLeft, hhmm, ageTxt, COINS, coins, inCoin, fmtCoin, usd, openHow, howPill,
    BANDS, bandOf, bandOdds, mixOdds, pct, WORD, FINAL_LINE, TROPHY_LINE, FRESH_LINE, FRESH_ODDS, TEN_FRESH, NO_TEN_DAYS, nowOrNever };
})();
