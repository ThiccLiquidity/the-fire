// One set of number formatters for the whole site, so PLANK, ETH and dollars read the same everywhere.

const L = "en-US";

/** Big token amounts (PLANK, pots): 999 · 1.2K · 850M · 2.75B · 3.1T. Never "0M". */
export function fmtBig(v: number): string {
  if (!isFinite(v) || v <= 0) return "0";
  const u: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [d, s] of u) {
    if (v >= d) {
      const x = v / d;
      return `${x >= 100 ? Math.round(x).toLocaleString(L) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2).replace(/\.?0+$/, "")}${s}`;
    }
  }
  return v >= 1 ? Math.round(v).toLocaleString(L) : v.toPrecision(2);
}
export const fmtPlank = fmtBig;

/** Small token amounts (ETH, PAPER): enough significant digits that it never reads "0.0000". */
export function fmtAmt(v: number, maxDp = 4): string {
  if (!isFinite(v) || Math.abs(v) < 1e-18) return "0"; // below 1 wei: nothing a wallet can hold
  if (Math.abs(v) >= 1e6) return fmtBig(v);
  if (Math.abs(v) >= 1000) return v.toLocaleString(L, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toLocaleString(L, { maximumFractionDigits: 2 });
  // under 1: 3 significant digits, trailing zeros dropped
  const s = Number(v.toPrecision(3));
  return s.toLocaleString(L, { maximumFractionDigits: Math.min(20, Math.max(maxDp, 1 - Math.floor(Math.log10(Math.abs(s))) + 2)) }); // Intl throws past 100
}
export const fmtEth = (v: number) => `${fmtAmt(v)} ETH`;

/** Dollars: $0 · <$0.01 · $0.92 · $12.50 · $1,234 · $2.4M. */
export function fmtUsd(v: number): string {
  if (!isFinite(v)) return "$—";
  if (v === 0) return "$0";
  if (v < 0.01) return "<$0.01";
  if (v < 1000) return `$${v.toLocaleString(L, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v < 1e6) return `$${Math.round(v).toLocaleString(L)}`;
  return `$${fmtBig(v)}`;
}

/** Dollar value of some PLANK; "$—" when there's no PLANK price yet (say so rather than guess). */
export function usdOf(plank: number, px: number, round = true): string {
  if (!px) return "$—";
  const v = plank * px;
  return round && v >= 1 ? `$${Math.round(v).toLocaleString(L)}` : fmtUsd(v);
}

export const fmtCount = (n: number) => Math.round(n).toLocaleString(L);
