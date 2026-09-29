// Swap for PLANK or PAPER, or anything. ETH, PLANK, PAPER and USDG are the presets; any other token by address.
// Live: KyberSwap's aggregator (best price across every pool, The Fire's 0.5% fee), every transaction checked by
// checkSwap() before the wallet sees it; if KyberSwap can't quote, the Uniswap V2 router that hosts the PLANK/WETH pool
// (no fee). Demo: the same panel on pretend pools with play money: it never touches a wallet or an RPC.

import { useEffect, useRef, useState } from "react";
import { createPublicClient, http, formatUnits, parseUnits, parseAbi, type Address, type PublicClient, isAddress } from "viem";
import type { DemoControls, DemoToken, FireState } from "../data/types";
import { fmtAmt, fmtUsd } from "../format";
import { robinhood, connectWallet, waitOk, txUrl, TxPending, friendly } from "../data/wallet";
import { kyberRoute, kyberBuild, checkSwap, KYBER_ROUTER, type KyberRoute } from "../data/kyber";
import { SWAP_FEE_BPS, SWAP_FEE_WALLET } from "../data/types";

export const ROUTER: Address = "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba";
export const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const PLANK_FALLBACK: Address = "0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc";
const STALE_MS = 20_000; // a quote older than this can't be swapped on
const IMPACT_WARN = 0.03;
const GAS_RESERVE = 500_000_000_000_000n; // 0.0005 ETH left for gas when "use all" spends ETH

type Tok = { symbol: string; address: Address | "ETH"; decimals: number; unverified?: boolean };

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);
const erc20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

// Live only: created on first use, never in the demo.
let pubClient: PublicClient | undefined;
async function livePub() {
  return (pubClient ??= createPublicClient({ chain: robinhood, transport: http() }) as PublicClient);
}

function baseTokens(demo: boolean, t?: FireState["tokens"]): Tok[] {
  if (demo) return (["ETH", "PLANK", "PAPER", "USDG"] as const).map((s, i) => ({ symbol: s, address: (s === "ETH" ? "ETH" : `0x${String(i).repeat(40)}`) as Tok["address"], decimals: 18 }));
  return [
    { symbol: "ETH", address: "ETH", decimals: 18 },
    { symbol: "PLANK", address: (t?.plank as Address) || PLANK_FALLBACK, decimals: 18 },
    ...(t?.paper ? [{ symbol: "PAPER", address: t.paper as Address, decimals: 18 }] : []),
    ...(t?.usdg ? [{ symbol: "USDG", address: t.usdg as Address, decimals: t.usdgDecimals }] : []),
  ];
}

/** A play-money amount as a plain decimal string ("0.0000005", never "5e-7"). */
function plain(v: number) { return v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 18 }); }

function Sel({ tokens, v, set, label }: { tokens: Tok[]; v: Tok; set: (t: Tok) => void; label: string }) {
  return (
    <select value={v.address} onChange={(e) => set(tokens.find((t) => t.address === e.target.value)!)} aria-label={label}>
      {tokens.map((t) => <option key={t.address} value={t.address}>{t.symbol}{t.unverified ? " (unverified)" : ""}</option>)}
    </select>
  );
}

type Quote = { key: string; at: number; out: number; outRaw?: bigint; path?: Address[]; impact: number; kyber?: KyberRoute; fee: number };
const FEE = SWAP_FEE_BPS / 10_000;

export function Swap({ demo, s }: { demo?: DemoControls; s: FireState }) {
  const isDemo = !!demo;
  const [extra, setExtra] = useState<Tok[]>([]);
  const tokens = [...baseTokens(isDemo, s.tokens), ...extra];
  const [fromSym, setFromSym] = useState<string>("ETH");
  const [toSym, setToSym] = useState<string>("PLANK");
  const from = tokens.find((t) => t.address === fromSym || t.symbol === fromSym) ?? tokens[0];
  const to = tokens.find((t) => t.address === toSym || t.symbol === toSym) ?? tokens[1];
  const [amt, setAmt] = useState("0.01");
  const [q, setQ] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [custom_, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<React.ReactNode>("");
  const [open, setOpen] = useState(false);
  const [slip, setSlip] = useState(0.01);
  const [impactOk, setImpactOk] = useState(false);
  const [pendingHash, setPendingHash] = useState("");
  const [now, setNow] = useState(Date.now());
  const key = `${from.address}|${to.address}|${amt}`;
  const seq = useRef(0);
  const keepMsg = useRef(false); // the next amount change comes with its own message: don't clear it

  // PAPER (or any token) may be paired with WETH, USDG or PLANK, so try every route through up to two of those and
  // keep the one that gives the most out. Routes that don't exist just fail their quote and drop out.
  const hub = (t?: string) => t as Address | undefined;
  const routes = (a: Tok, b: Tok): Address[][] => {
    const A = a.address === "ETH" ? WETH : a.address, B = b.address === "ETH" ? WETH : b.address;
    const hops = [WETH, hub(s.tokens?.usdg), hub(s.tokens?.plank) ?? PLANK_FALLBACK].filter((h): h is Address => !!h && h.toLowerCase() !== A.toLowerCase() && h.toLowerCase() !== B.toLowerCase());
    const two = hops.flatMap((x) => hops.filter((y) => y !== x).map((y) => [A, x, y, B]));
    return [[A, B], ...hops.map((h) => [A, h, B]), ...two];
  };
  async function bestRoute(a: Tok, b: Tok, amountIn: bigint, only?: Address[]): Promise<{ path: Address[]; out: bigint } | undefined> {
    const pub = await livePub();
    const quotes = await Promise.all((only ? [only] : routes(a, b)).map(async (path) => {
      try { const am = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [amountIn, path] }); return { path, out: am[am.length - 1] }; }
      catch { return undefined; }
    }));
    return quotes.filter((x): x is { path: Address[]; out: bigint } => !!x && x.out > 0n).sort((x, y) => (y.out > x.out ? 1 : y.out < x.out ? -1 : 0))[0];
  }

  async function getQuote(): Promise<Quote | null> {
    const n = Number(amt);
    if (!(n > 0) || from.address === to.address) return null;
    if (demo) {
      const r = demo.swapQuote(from.symbol as DemoToken, to.symbol as DemoToken, n);
      return r && Number.isFinite(r.out) && Number.isFinite(r.impact) && Number.isFinite(n * FEE) ? { key, at: Date.now(), out: r.out, impact: r.impact, fee: n * FEE } : null;
    }
    let amountIn: bigint;
    try { amountIn = parseUnits(amt, from.decimals); } catch { return null; }
    // KyberSwap first (8s at most); the direct V2 route if it has nothing.
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8_000);
      const k = await kyberRoute(from.address, to.address, amountIn, ac.signal).finally(() => clearTimeout(t));
      if (k) {
        const sm = k.summary as { amountInUsd?: string; amountOutUsd?: string };
        const inUsd = Number(sm.amountInUsd), outUsd = Number(sm.amountOutUsd);
        const impact = inUsd > 0 && outUsd > 0 ? Math.max(0, 1 - outUsd / (inUsd * (SWAP_FEE_WALLET ? 1 - FEE : 1))) : 0;
        return { key, at: Date.now(), out: Number(formatUnits(k.amountOut, to.decimals)), outRaw: k.amountOut, impact, kyber: k, fee: SWAP_FEE_WALLET ? n * FEE : 0 };
      }
    } catch { /* fall through to the V2 route */ }
    const best = await bestRoute(from, to, amountIn);
    if (!best) return null;
    // price impact: this amount's rate vs a tiny amount's rate on the same route
    const tiny = amountIn / 1000n > 0n ? amountIn / 1000n : 1n;
    const spot = await bestRoute(from, to, tiny, best.path);
    const rate = Number(best.out) / Number(amountIn), spotRate = spot ? Number(spot.out) / Number(tiny) : rate;
    return { key, at: Date.now(), out: Number(formatUnits(best.out, to.decimals)), outRaw: best.out, path: best.path, impact: spotRate > 0 ? Math.max(0, 1 - rate / spotRate) : 0, fee: 0 };
  }
  async function requote() {
    const id = ++seq.current;
    setLoading(true);
    try { const r = await getQuote(); if (id === seq.current) setQ(r); }
    catch { if (id === seq.current) setQ(null); }
    finally { if (id === seq.current) setLoading(false); }
  }

  // Quotes only while the panel is open. Live: never on page load, refreshed every 15s so it can't go stale.
  useEffect(() => {
    if (!open) return;
    setImpactOk(false);
    const t0 = setTimeout(requote, 250);
    const t = setInterval(requote, isDemo ? 5_000 : 15_000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) return; const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, [open]);
  // a new pair or amount: the last swap's message no longer applies (a pending tx keeps its notice)
  useEffect(() => { if (keepMsg.current) keepMsg.current = false; else if (!pendingHash) setMsg(""); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const stale = !q || q.key !== key || now - q.at > STALE_MS;
  const bigImpact = !!q && q.impact > IMPACT_WARN;
  const unverified = [from, to].find((t) => t.unverified);
  const have = (t: Tok) => (t.symbol === "ETH" && !t.unverified ? s.you.eth : t.symbol === "PLANK" && !t.unverified ? s.you.plank : t.symbol === "PAPER" && !t.unverified ? s.you.paper : t.symbol === "USDG" && !t.unverified ? s.you.usdg : undefined);
  /** live: the exact balance in the token's smallest unit, so "use all" and "Not enough" never round */
  const haveRaw = (t: Tok) => { const r = s.you.raw; return !r || t.unverified ? undefined : t.symbol === "ETH" ? r.eth : t.symbol === "PLANK" ? r.plank : t.symbol === "PAPER" ? r.paper : t.symbol === "USDG" ? r.usdg : undefined; };
  const parsedAmt = (() => { try { return parseUnits(amt, from.decimals); } catch { return undefined; } })();

  async function addCustom() {
    if (!isAddress(custom_)) { setMsg("That's not a token address."); return; }
    try {
      const pub = await livePub();
      const [sym, dec] = await Promise.all([
        pub.readContract({ address: custom_, abi: erc20, functionName: "symbol" }),
        pub.readContract({ address: custom_, abi: erc20, functionName: "decimals" }),
      ]);
      if (tokens.some((x) => x.address !== "ETH" && x.address.toLowerCase() === custom_.toLowerCase())) { setMsg("Already in the list."); return; }
      // anyone can deploy a token called PLANK: a pasted token may never pass as one of ours
      if (["ETH", "WETH", "PLANK", "PAPER", "USDG"].includes(String(sym).trim().toUpperCase())) { setMsg(`That token calls itself ${sym}, but it isn't the real one. Not added.`); return; }
      const t: Tok = { symbol: String(sym).slice(0, 12), address: custom_, decimals: Number(dec), unverified: true };
      setExtra((ts) => [...ts, t]);
      setToSym(t.address); setCustom(""); setMsg("");
    } catch { setMsg("Couldn't read that token. Is it an ERC-20 on Robinhood Chain?"); }
  }

  async function swap() {
    if (!q || stale) return;
    if (bigImpact && !impactOk) { setImpactOk(true); return; } // first press shows the warning; the second one swaps
    setBusy(true); setMsg("");
    const seen = q;
    try {
      if (demo) {
        const got = await demo.swap(from.symbol as DemoToken, to.symbol as DemoToken, Number(amt), seen.out * (1 - slip));
        setMsg(`Swapped (play money). You got ${fmtAmt(got)} ${to.symbol}.`);
      } else {
        const { wc, account: acct } = await connectWallet();
        const pub = await livePub();
        let amountIn = parseUnits(amt, from.decimals);
        // never ask for more than the wallet holds right now (ETH keeps a little for gas), before any approval is sent
        const bal = from.address === "ETH" ? await pub.getBalance({ address: acct }) : await pub.readContract({ address: from.address, abi: erc20, functionName: "balanceOf", args: [acct] });
        const spendable = from.address === "ETH" ? (bal > GAS_RESERVE ? bal - GAS_RESERVE : 0n) : bal;
        if (spendable === 0n) throw new Error(`You have no ${from.symbol} to swap.`);
        if (amountIn > spendable) {
          if (seen.kyber || amountIn - spendable > amountIn / 1000n) { const all = formatUnits(spendable, from.decimals); keepMsg.current = all !== amt; setAmt(all); throw new Error(`That's more ${from.symbol} than you have. The amount is now your balance: check the new quote.`); }
          amountIn = spendable; // a rounding hair over: swap exactly the balance
        }
        // minOut comes from the quote you saw; if the market has already moved past your slippage, stop here.
        const slipBps = BigInt(Math.round(slip * 10_000));
        const quotedIn = parseUnits(amt, from.decimals);
        const minOut = (seen.outRaw! * (10_000n - slipBps) * amountIn) / (10_000n * quotedIn); // scaled if amountIn was trimmed to the balance
        if (seen.kyber) {
          const tx = await kyberBuild(seen.kyber, acct, Number(slipBps));
          checkSwap(tx, { from: from.address, to: to.address, amountIn, minOut, account: acct }); // throws before the wallet sees anything wrong
          if (from.address !== "ETH") {
            const allowance = await pub.readContract({ address: from.address, abi: erc20, functionName: "allowance", args: [acct, KYBER_ROUTER] });
            if (allowance < amountIn) { // exactly this swap's amount, never unlimited
              const h = await wc.writeContract({ address: from.address, abi: erc20, functionName: "approve", args: [KYBER_ROUTER, amountIn], account: acct, chain: robinhood });
              await waitOk(pub, h, `approving ${from.symbol}`, "approve");
            }
          }
          const hash = await wc.sendTransaction({ to: KYBER_ROUTER, data: tx.data, value: tx.value, account: acct, chain: robinhood });
          await waitOk(pub, hash, "the swap");
          setMsg(<>Swapped. <a href={txUrl(hash)} target="_blank" rel="noreferrer">View on explorer</a></>);
          setImpactOk(false);
          void requote();
          return;
        }
        const fresh = await bestRoute(from, to, amountIn, seen.path);
        if (!fresh || fresh.out < minOut) throw new Error(`The price moved more than your ${slip * 100}% slippage. Check the new quote.`);
        const p = seen.path!;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
        let hash: `0x${string}`;
        if (from.address === "ETH") {
          hash = await wc.writeContract({ address: ROUTER, abi: routerAbi, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, p, acct, deadline], value: amountIn, account: acct, chain: robinhood });
        } else {
          const allowance = await pub.readContract({ address: from.address, abi: erc20, functionName: "allowance", args: [acct, ROUTER] });
          if (allowance < amountIn) {
            const h = await wc.writeContract({ address: from.address, abi: erc20, functionName: "approve", args: [ROUTER, amountIn], account: acct, chain: robinhood });
            await waitOk(pub, h, `approving ${from.symbol}`, "approve");
          }
          const fn = to.address === "ETH" ? "swapExactTokensForETHSupportingFeeOnTransferTokens" : "swapExactTokensForTokensSupportingFeeOnTransferTokens";
          hash = await wc.writeContract({ address: ROUTER, abi: routerAbi, functionName: fn, args: [amountIn, minOut, p, acct, deadline], account: acct, chain: robinhood });
        }
        await waitOk(pub, hash, "the swap");
        setMsg(<>Swapped. <a href={txUrl(hash)} target="_blank" rel="noreferrer">View on explorer</a></>);
      }
      setImpactOk(false);
      void requote();
    } catch (e) {
      if (!demo) {
        if (e instanceof TxPending) {
          setPendingHash(e.hash);
          setMsg(<>Still pending. <a href={txUrl(e.hash)} target="_blank" rel="noreferrer">Check it on the explorer</a>.</>);
          // a late approval only allowed the spend: the swap itself was never sent
          if (e.kind === "approve") void e.later.then((ok) => { setPendingHash(""); setMsg(ok ? "Approval landed. Press Swap again to swap." : "The approval failed on-chain. Nothing was swapped."); });
          else void e.later.then((ok) => { setPendingHash(""); setMsg(ok ? "Your swap landed." : "Your swap failed on-chain. Nothing was swapped."); });
        } else setMsg(friendly(e));
      } else setMsg((e as Error).message);
    } finally { setBusy(false); }
  }

  const fromHave = have(from), fromRaw = haveRaw(from);
  // live: compare in the token's own units; the demo's play balances are plain numbers
  const short = !!s.you.address && (fromRaw !== undefined ? parsedAmt !== undefined && parsedAmt > fromRaw : fromHave !== undefined && Number(amt) > fromHave);
  const useAll = () => {
    if (fromRaw !== undefined) setAmt(formatUnits(from.symbol === "ETH" ? (fromRaw > GAS_RESERVE ? fromRaw - GAS_RESERVE : 0n) : fromRaw, from.decimals));
    else if (fromHave !== undefined) setAmt(plain(from.symbol === "ETH" ? Math.max(0, fromHave - 0.0005) : fromHave));
  };
  return (
    <div className={"swap" + (open ? " open" : "")}>
      <button className="swap-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Need PLANK or PAPER? <b>Swap for it</b>{isDemo ? " (play money)" : ""}</span><small>{open ? "close" : "open"}</small>
      </button>
      {open && (
        <div className="swap-body">
          <div className="swap-row"><span>Pay</span><input type="number" min="0" step="any" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" /><Sel tokens={tokens} v={from} set={(t) => setFromSym(t.address)} label="Pay with token" /></div>
          {fromHave !== undefined && s.you.address && <p className="fine swap-have">You have {fmtAmt(fromHave)} {from.symbol} <button className="linkish" onClick={useAll}>use all</button></p>}
          <div className="swap-row"><span>Get</span><input readOnly value={loading && !q ? "…" : q && q.key === key ? fmtAmt(q.out) : "—"} aria-label="You get" /><Sel tokens={tokens} v={to} set={(t) => setToSym(t.address)} label="Get token" /></div>
          {q && q.key === key && (
            <p className={"fine" + (bigImpact ? " warn" : "")}>Price impact {q.impact < 0.001 ? "<0.1" : (q.impact * 100).toFixed(1)}%{bigImpact ? " — high. You'd get noticeably less than the market price." : ""}</p>
          )}
          {!loading && !q && Number(amt) > 0 && from.address !== to.address && <p className="fine">No pool trades {from.symbol} for {to.symbol} yet.</p>}
          {unverified && <p className="fine warn">⚠ Unverified token: {unverified.address}. Anyone can make a token with any name. Check this address before you swap.</p>}
          <div className="swap-slip" role="radiogroup" aria-label="Max slippage">
            <span>Max slippage</span>
            {[0.005, 0.01, 0.03].map((v) => <button key={v} role="radio" aria-checked={slip === v} className={slip === v ? "on" : ""} onClick={() => setSlip(v)}>{v * 100}%</button>)}
          </div>
          <div className="swap-actions">
            <button className="flip" onClick={() => { const f = from.address; setFromSym(to.address); setToSym(f); }} aria-label="Flip">⇅</button>
            <button className={"cta" + (bigImpact && impactOk ? " danger" : "")} disabled={busy || loading || stale || short || !!pendingHash} onClick={swap}>
              {busy ? "Swapping…" : short ? `Not enough ${from.symbol}` : loading && stale ? "Getting a price…" : stale ? "Swap" : bigImpact && impactOk ? `Swap anyway (${(q!.impact * 100).toFixed(1)}% impact)` : `Swap ${from.symbol} → ${to.symbol}`}
            </button>
          </div>
          {q && q.key === key && q.fee > 0 && <p className="fine muted">Swap fee {SWAP_FEE_BPS / 100}% ({fmtAmt(q.fee)} {from.symbol}) goes to The Fire.</p>}
          {q && q.key === key && !stale && <p className="fine muted">You get at least {fmtAmt(q.out * (1 - slip))} {to.symbol}{isDemo && to.symbol === "PLANK" ? ` (${fmtUsd(q.out * s.plankUsd)})` : ""}, or it doesn't go through.</p>}
          {!isDemo && <div className="swap-custom"><input placeholder="Other token address (0x…)" value={custom_} onChange={(e) => setCustom(e.target.value)} /><button onClick={addCustom}>Add</button></div>}
          {msg && <p className="fine">{msg}{pendingHash && <> <button className="linkish" onClick={() => { setPendingHash(""); setMsg(""); }}>Dismiss</button></>}</p>}
          <p className="fine muted">{isDemo ? "Demo swap: pretend pools, play money. " : q?.kyber ? "Best price across every pool on Robinhood Chain, by KyberSwap. Your wallet only approves this swap's exact amount. " : "Uniswap V2 on Robinhood Chain, no fee (KyberSwap had no route). "}{isDemo || !q?.kyber ? "Routes through WETH, USDG or PLANK, whichever gives the most." : ""}</p>
        </div>
      )}
    </div>
  );
}
