// {{tokens}}: how numbers get into prose. Writers type {{PLANK.priceUsd}}, {{PAPER.change24hPct}}, {{mills.backingUsd}},
// {{majors.bitcoin.priceUsd}}, {{ethUsd}}, {{site.packsSold24h}}, {{weather.London.highF}} ...; inject.mjs swaps in the
// gathered number, formatted by its field name. A token with no number prints as "[n/a]" and check.mjs flags it.

export const TOKEN_RE = /\{\{\s*([A-Za-z0-9_.\- ]+?)\s*\}\}/g;

const usd = (x) => {
  if (Math.abs(x) >= 1000) return "$" + Math.round(x).toLocaleString("en-US");
  if (Math.abs(x) >= 1) return "$" + x.toFixed(2);
  if (x === 0) return "$0";
  // tiny prices: 4 significant digits, plain decimals (PLANK is around a billionth of a dollar)
  const dec = Math.min(20, 3 - Math.floor(Math.log10(Math.abs(x))));
  return "$" + Number(x.toPrecision(4)).toFixed(dec).replace(/\.?0+$/, "");
};

export function format(field, x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "[n/a]";
  if (typeof x !== "number") return String(x);
  if (/Pct$/.test(field)) return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}%`;
  if (/Usd$|^ethUsd$/.test(field)) return usd(x);
  if (/F$/.test(field)) return `${Math.round(x)}°F`;
  if (/Eth$/.test(field)) return `${x} ETH`;
  if (Number.isInteger(x)) return x.toLocaleString("en-US");
  return Number(x.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** The value for a token path, from { markets, site, weather }. */
export function lookup(path, { markets, site, weather }) {
  const parts = path.split(".");
  const field = parts[parts.length - 1];
  let v;
  if (parts[0] === "PAPER" || parts[0] === "PLANK") v = markets?.tokens?.[parts[0]]?.[field];
  else if (parts[0] === "mills") v = markets?.mills?.[field];
  else if (parts[0] === "majors") v = markets?.majors?.[parts[1]]?.[field];
  else if (parts[0] === "ethUsd") v = markets?.ethUsd;
  else if (parts[0] === "site") v = site?.[field];
  else if (parts[0] === "weather") v = (weather ?? []).find((w) => w.city.toLowerCase() === parts.slice(1, -1).join(".").toLowerCase())?.[field];
  return { field, value: v };
}

export function fill(text, ctx, missing = []) {
  return text.replace(TOKEN_RE, (_, path) => {
    const { field, value } = lookup(path.trim(), ctx);
    const out = format(field, value);
    if (out === "[n/a]") missing.push(path.trim());
    return out;
  });
}
