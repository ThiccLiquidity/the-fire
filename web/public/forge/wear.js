/* Omni Forge (demo mode): cases, slabs and wear (docs/grading.md), plus the "How does this work?" window.
   Wear.odds is the same model FirePsa.oddsFor runs on chain (contracts/test/cards/wear-model.py): the fresh odds,
   time damage D ~ Poisson(1.45 x years^0.68) read from the same 32-point table and blended between points, 20% per
   move to lose a grade (first 10 moves count, never below 5 from moves), and grades 1-4 fading in with time. */
(() => {
  const DAY = 86400, YEAR = 365 * DAY, FREE = DAY;
  // fresh odds, grade 1..10 (FirePsa defaults, out of 10,000): fresh cards grade 5 to 10 only
  const FRESH = [0, 0, 0, 0, 1000, 2000, 2700, 2500, 1700, 100];
  const MOVE_CAP = 10, DMAX = 9;
  const FADE = { 4: YEAR / 12, 3: YEAR / 2, 2: YEAR, 1: 2 * YEAR }; // grade -> opens at (fully open at twice that)
  const BREAK_DAYS = [0, 1, 2, 4, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 300, 365, 456, 548, 730, 913, 1095, 1460,
    1825, 2190, 2555, 2920, 3650, 4380, 5475, 7300, 10950];
  const BREAKS = BREAK_DAYS.map((d) => d * DAY);
  const fact = (k) => (k < 2 ? 1 : k * fact(k - 1));
  const TABLE = BREAKS.map((t) => { // P(D <= k), k = 0..8, at each break
    const lam = t > 0 ? 1.45 * Math.pow(t / YEAR, 0.68) : 0; let acc = 0;
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
    return out;
  }
  function draw(ageSec, moves, rand = Math.random) {
    const o = odds(ageSec, moves); let u = rand() * o.reduce((a, b) => a + b, 0);
    for (let g = 0; g < 10; g++) { if (u < o[g]) return g + 1; u -= o[g]; }
    return 10;
  }
  const avg = (o) => o.reduce((a, p, i) => a + p * (i + 1), 0) / o.reduce((a, b) => a + b, 0);

  // ---- the card's own wear ----
  const S = () => Store.state;
  const ageSecOf = (c) => Store.ageMs(c) / 1000;
  const freshLeft = (c) => (c.grade == null && !c.cased ? Math.max(0, FREE * 1000 - Store.ageMs(c)) : 0); // ms of the free first day left
  const hhmm = (ms) => { const m = Math.ceil(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const ageTxt = (ms) => { const d = ms / 86400000; return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : d < 60 ? `${Math.round(d)} days` : d < 730 ? `${Math.round(d / 30.4)} months` : `${(d / 365).toFixed(1)} years`; };

  // ---- paying: dollars, in ETH, USDG or PLANK (demo balances) ----
  const COINS = ['ETH', 'USDG', 'PLANK'];
  const inCoin = (usd, coin) => { const P = Store.PRICES; return coin === 'ETH' ? usd / P.ETH_USD : coin === 'USDG' ? usd : usd / P.PLANK_USD; };
  const fmtCoin = (v, coin) => coin === 'ETH' ? v.toFixed(v < 0.01 ? 6 : 4) : coin === 'USDG' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US');
  const usd = (v) => '$' + v.toFixed(2);

  // ---- "How does this work?": one window, over whatever is open ----
  const BURN_LINE = 'Cases and grading fees buy and burn PAPER. 100% of every fee buys PAPER from the market and burns it. None of it goes to us.';
  function howBody() {
    const P = Store.PRICES;
    const rows = [['Fresh', 0], ['1 month', 30], ['6 months', 182], ['1 year', 365], ['3 years', 3 * 365], ['10 years', 3650]].map(([l, d]) => {
      const o = odds((d + 1) * DAY, 0), top = (p) => (p * 100 >= 0.5 ? Math.round(p * 100) + '%' : p > 0.0005 ? '<1%' : '—');
      return `<tr><th>${l}</th><td>${top(o[9])}</td><td>${top(o[8] + o[7])}</td><td>${top(o[6] + o[5] + o[4])}</td><td>${top(o[3] + o[2] + o[1] + o[0])}</td></tr>`;
    }).join('');
    const el = document.createElement('div'); el.className = 'how';
    el.innerHTML = `
      <section><h3><span class="how-n">1</span>Case or grade?</h3>
        <div class="how-two">
          <div class="how-opt case"><b>Case · ${usd(P.CASE_USD)}</b><p>A clear case stops wear. The card stays ungraded, so you can trade it or grade it later with the odds it has today.</p></div>
          <div class="how-opt slab"><b>Grade · ${usd(P.GRADE_USD)}</b><p>The grader reveals its PDA grade, 1 to 10, and seals it in a slab with the grade on the label.</p></div>
        </div></section>
      <section><h3><span class="how-n">2</span>Fresh for 24 hours</h3>
        <p>New cards don't wear for their first day. Case or grade them inside those 24 hours and they never take a hit.</p></section>
      <section><h3><span class="how-n">3</span>How cards wear</h3>
        <ul><li>A raw card (no case) slowly loses condition over time.</li>
          <li>Each move to another wallet can knock a grade off. Only the first 10 moves count, and moves alone never take it below 5.</li>
          <li>Grades 1 to 4 only happen to cards left raw for a long time.</li>
          <li>Condition is hidden. Nobody can see it, us included, until the card is graded.</li></ul>
        <table class="how-t"><caption>Grade odds for a raw card, never moved</caption>
          <thead><tr><th>Held raw</th><th>PDA 10</th><th>9–8</th><th>7–5</th><th>4–1</th></tr></thead><tbody>${rows}</tbody></table></section>
      <section><h3><span class="how-n">4</span>What a slab means</h3>
        <p>Graded cards live in a slab for good. The grade is final: no regrades. A slab shows only its PDA grade.</p></section>
      <section><h3><span class="how-n">5</span>Prices</h3>
        <dl class="how-p"><dt>Case</dt><dd>${usd(P.CASE_USD)} a card</dd><dt>Grade</dt><dd>${usd(P.GRADE_USD)} a card</dd><dt>Pay with</dt><dd>ETH, USDG or PLANK</dd></dl>
        <p class="muted small">Pick cards to case and to grade, then pay once for all of them.</p></section>
      <section class="how-burn"><h3><span class="how-n">6</span>Where the money goes</h3><p>${BURN_LINE}</p></section>`;
    return el;
  }
  function openHow() { Sheet.open('how', { title: 'How cases and grading work', body: howBody() }); }
  // the pill: big, labelled, and part of every step it sits in
  function howPill() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'how-pill';
    b.innerHTML = '<span class="how-q" aria-hidden="true">?</span>How does this work?';
    b.onclick = openHow; return b;
  }

  window.Wear = { DAY, YEAR, FRESH, odds, draw, avg, ageSecOf, freshLeft, hhmm, ageTxt, COINS, inCoin, fmtCoin, usd, openHow, howPill, BURN_LINE };
})();
