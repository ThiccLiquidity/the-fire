/* PLANK and PAPER, the workshop's two coins (owner-approved brand placements). Brand.coin('PAPER') is the coin's logo
   as an inline <img> for a line of text that already says the coin's name (so it's hidden from screen readers);
   Brand.amt('PAPER', '1 PAPER') puts it before a price. Only PLANK and PAPER have a logo: other coins get nothing. */
(() => {
  const HAS = { PLANK: 'plank', PAPER: 'paper' };
  const coin = (t, cls = '') => { const k = HAS[String(t).toUpperCase()]; if (!k) return '';
    return `<img class="coin${cls ? ' ' + cls : ''}" src="ui/brand/${k}-coin-64.webp" srcset="ui/brand/${k}-coin-32.webp 1x, ui/brand/${k}-coin-64.webp 2x" width="18" height="18" alt="" aria-hidden="true" decoding="async" draggable="false">`; };
  /** "<coin>1 PAPER": the coin glued to its amount (no line break between them). */
  const amt = (t, html) => (HAS[String(t).toUpperCase()] ? `<span class="coin-amt">${coin(t)}${html}</span>` : html);
  /** "1 PAPER" / "1.25M PLANK" anywhere in a line of html: each gets its coin. */
  const tag = (html) => String(html).replace(/(\d[\d.,]*[KMBT]?)\s(PLANK|PAPER)\b/g, (m, n, t) => amt(t, `${n} ${t}`));
  window.Brand = { coin, amt, tag, img: (k) => `ui/brand/${k}-256.webp` };
})();
