// Any-token swap on the Uniswap V2 router that hosts the PLANK/WETH pool. Works with any injected wallet.
// Token list is a starting point; users can paste any ERC-20 address. Replace with the community aggregator later
// by swapping this component out (App.tsx renders <Swap/> in one place).

import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, formatUnits, parseUnits, parseAbi, type Address, isAddress } from "viem";
import { robinhood } from "../data/chain";

export const ROUTER: Address = "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba";
export const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const PAPER = (import.meta.env.VITE_PAPER_ADDRESS as Address | undefined) || undefined;
const USDG = (import.meta.env.VITE_USDG_ADDRESS as Address | undefined) || undefined;

type Tok = { symbol: string; address: Address | "ETH"; decimals: number };
const BASE: Tok[] = [
  { symbol: "ETH", address: "ETH", decimals: 18 },
  { symbol: "PLANK", address: "0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc", decimals: 18 },
  ...(PAPER ? [{ symbol: "PAPER", address: PAPER, decimals: 18 } as Tok] : []),
  ...(USDG ? [{ symbol: "USDG", address: USDG, decimals: 6 } as Tok] : []),
];

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

function Sel({ tokens, v, set }: { tokens: Tok[]; v: Tok; set: (t: Tok) => void }) {
  return (
    <select value={v.address} onChange={(e) => set(tokens.find((t) => t.address === e.target.value)!)} aria-label="Token">
      {tokens.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
    </select>
  );
}

export function Swap() {
  const [tokens, setTokens] = useState<Tok[]>(BASE);
  const [from, setFrom] = useState<Tok>(BASE[0]);
  const [to, setTo] = useState<Tok>(BASE[1]);
  const [amt, setAmt] = useState("0.01");
  const [out, setOut] = useState<string>("");
  const [custom_, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const pub = createPublicClient({ chain: robinhood, transport: http() });

  const path = (a: Tok, b: Tok): Address[] => {
    const A = a.address === "ETH" ? WETH : a.address, B = b.address === "ETH" ? WETH : b.address;
    return A === WETH || B === WETH ? [A, B] : [A, WETH, B];
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const n = Number(amt); if (!n || from.address === to.address) { setOut(""); return; }
        const amounts = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [parseUnits(amt, from.decimals), path(from, to)] });
        if (!dead) setOut(formatUnits(amounts[amounts.length - 1], to.decimals));
      } catch { if (!dead) setOut(""); }
    })();
    return () => { dead = true; };
  }, [amt, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCustom() {
    if (!isAddress(custom_)) { setMsg("That's not a token address."); return; }
    try {
      const [sym, dec] = await Promise.all([
        pub.readContract({ address: custom_, abi: erc20, functionName: "symbol" }),
        pub.readContract({ address: custom_, abi: erc20, functionName: "decimals" }),
      ]);
      const t: Tok = { symbol: sym, address: custom_, decimals: Number(dec) };
      setTokens((ts) => ts.some((x) => x.address === t.address) ? ts : [...ts, t]);
      setTo(t); setCustom(""); setMsg("");
    } catch { setMsg("Couldn't read that token. Is it an ERC-20 on Robinhood Chain?"); }
  }

  async function swap() {
    setBusy(true); setMsg("");
    try {
      if (!window.ethereum) throw new Error("No wallet found. Install MetaMask.");
      const wc = createWalletClient({ chain: robinhood, transport: custom(window.ethereum) });
      const [acct] = await wc.requestAddresses();
      try { await wc.switchChain({ id: robinhood.id }); } catch { await wc.addChain({ chain: robinhood }); }
      const amountIn = parseUnits(amt, from.decimals);
      const p = path(from, to);
      const amounts = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [amountIn, p] });
      const minOut = (amounts[amounts.length - 1] * 97n) / 100n; // 3% slippage
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      let hash: `0x${string}`;
      if (from.address === "ETH") {
        hash = await wc.writeContract({ address: ROUTER, abi: routerAbi, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, p, acct, deadline], value: amountIn, account: acct, chain: robinhood });
      } else {
        const allowance = await pub.readContract({ address: from.address, abi: erc20, functionName: "allowance", args: [acct, ROUTER] });
        if (allowance < amountIn) { const h = await wc.writeContract({ address: from.address, abi: erc20, functionName: "approve", args: [ROUTER, amountIn], account: acct, chain: robinhood }); await pub.waitForTransactionReceipt({ hash: h }); }
        const fn = to.address === "ETH" ? "swapExactTokensForETHSupportingFeeOnTransferTokens" : "swapExactTokensForTokensSupportingFeeOnTransferTokens";
        hash = await wc.writeContract({ address: ROUTER, abi: routerAbi, functionName: fn, args: [amountIn, minOut, p, acct, deadline], account: acct, chain: robinhood });
      }
      await pub.waitForTransactionReceipt({ hash });
      setMsg(`Swapped. ${hash.slice(0, 10)}…`);
    } catch (e) { setMsg((e as Error).message.split("\n")[0].slice(0, 160)); }
    finally { setBusy(false); }
  }

  return (
    <div className={"swap" + (open ? " open" : "")}>
      <button className="swap-toggle" onClick={() => setOpen(!open)}>
        <span>Need PLANK? <b>Swap</b> ETH or any token for it</span><small>{open ? "close" : "open"}</small>
      </button>
      {open && (
        <div className="swap-body">
          <div className="swap-row"><span>Pay</span><input type="number" min="0" step="any" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" /><Sel tokens={tokens} v={from} set={setFrom} /></div>
          <div className="swap-row"><span>Get</span><input readOnly value={out ? Number(out).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"} aria-label="You get" /><Sel tokens={tokens} v={to} set={setTo} /></div>
          <div className="swap-actions">
            <button className="flip" onClick={() => { const f = from; setFrom(to); setTo(f); }} aria-label="Flip">⇅</button>
            <button className="cta" disabled={busy || !out} onClick={swap}>{busy ? "Swapping…" : `Swap ${from.symbol} → ${to.symbol}`}</button>
          </div>
          <div className="swap-custom"><input placeholder="Other token address (0x…)" value={custom_} onChange={(e) => setCustom(e.target.value)} /><button onClick={addCustom}>Add</button></div>
          {msg && <p className="fine">{msg}</p>}
          <p className="fine muted">Uniswap V2 on Robinhood Chain · 3% max slippage · routes through WETH.</p>
        </div>
      )}
    </div>
  );
}
