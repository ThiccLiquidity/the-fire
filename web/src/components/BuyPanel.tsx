import { useState } from "react";
import { DAILY_CAP, TX_CAP, type Pay, quote } from "../data/types";

const OPENSEA = "https://opensea.io/collection/the-plank-press";
const fmtPlank = (p: number) => p >= 1e9 ? `${(p / 1e9).toFixed(2)}B` : `${(p / 1e6).toFixed(0)}M`;
const $ = (v: number) => `$${v.toFixed(2)}`;

export function BuyPanel({
  you, plankPerTicket, paperPerTicket = 1, paperUsd = 0, plankUsd, ethUsd, onBuy, onConnect, paused, usdgEnabled,
}: {
  you: { address?: string; tickets: number; paper: number; plank: number; eth: number; usdg: number; remainingToday: number };
  plankPerTicket: number; paperPerTicket?: number; paperUsd?: number; plankUsd: number; ethUsd: number;
  onBuy: (n: number, pay: Pay, note: string) => Promise<void>;
  usdgEnabled?: boolean;
  onConnect?: () => Promise<void>;
  paused?: boolean;
}) {
  const [n, setNRaw] = useState(1);
  const setN = (v: number) => setNRaw(Math.max(1, Math.min(TX_CAP, Math.floor(v) || 1)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ n: number; total: number } | null>(null);
  const [why, setWhy] = useState(false);
  const [payPick, setPay] = useState<Pay | null>(null); // null = the sensible default below
  const [confirming, setConfirming] = useState(false); // ETH/USDG: a review step before real money moves

  const q = quote(n, plankPerTicket, ethUsd, paperPerTicket);
  const fmtPaper = (p: number) => (p >= 1 || p === 0 ? p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.toPrecision(2));
  const paperUsdCost = q.paper * paperUsd; // 0 when PAPER has no price yet
  const plankUsdCost = q.plank * plankUsd;
  const havePlank = you.plank >= q.plank;
  const canPaper = havePlank && you.paper >= q.paper;
  const canEth = havePlank && ethUsd > 0 && you.eth >= q.eth;
  const canUsdg = havePlank && !!usdgEnabled && you.usdg >= q.usdg;
  const overCap = n > you.remainingToday;
  // how many tickets you could buy right now, by whichever way you can pay for the paper leg
  const byPlank = Math.floor(you.plank / plankPerTicket);
  const byPaperLeg = Math.max(Math.floor(you.paper / paperPerTicket), ethUsd > 0 ? Math.floor(you.eth * ethUsd) : 0, usdgEnabled ? Math.floor(you.usdg) : 0);
  const affordable = Math.max(0, Math.min(byPlank, byPaperLeg));
  const maxNow = Math.max(0, Math.min(affordable, you.remainingToday, TX_CAP));
  // Default to PAPER when you have it, else the first dollar option you can use.
  const pay: Pay = payPick ?? (you.paper >= paperPerTicket ? "paper" : ethUsd > 0 ? "eth" : usdgEnabled ? "usdg" : "paper");
  const canPay = pay === "paper" ? canPaper : pay === "eth" ? canEth : canUsdg;
  const dollars = pay !== "paper";
  const legText = pay === "paper" ? `${fmtPaper(q.paper)} PAPER` : pay === "eth" ? `${q.eth.toFixed(4)} ETH` : `${q.usdg.toFixed(2)} USDG`;
  const total = (dollars ? q.usdg : paperUsdCost) + plankUsdCost;
  const choose = (p: Pay) => { setPay(p); setConfirming(false); setDone(null); setErr(""); };

  async function go(pay: Pay) {
    setBusy(true); setErr(""); setDone(null); setConfirming(false);
    try { await onBuy(n, pay, note.trim()); setNote(""); setDone({ n, total: you.tickets + n }); }
    catch (e) { setErr((e as Error).message.split("\n")[0].slice(0, 160)); }
    finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setErr("");
    try { await onConnect!(); } catch (e) { setErr((e as Error).message.split("\n")[0].slice(0, 160)); } finally { setBusy(false); }
  }

  if (!you.address && onConnect) return (
    <aside className="buy">
      <button className="cta" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect wallet to buy tickets"}</button>
      {err && <p className="hint">{err}</p>}
      <p className="fine">1 ticket = 1 PAPER + about $0.90 of PLANK. Up to {TX_CAP} a buy, {DAILY_CAP} a day.</p>
    </aside>
  );

  return (
    <aside className="buy">
      <div className="wallet">
        <div><b>{you.paper.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b><span>PAPER{paperUsd > 0 ? ` · ${$(you.paper * paperUsd)}` : ""}</span></div>
        <div><b>{fmtPlank(you.plank)}</b><span>PLANK · {$(you.plank * plankUsd)}</span></div>
        <div><b>{affordable}</b><span>tickets you can buy now</span></div>
      </div>

      <div className="qty">
        <button className="qty-btn" aria-label="One fewer" disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
        <input className="qty-in" type="number" inputMode="numeric" min={1} max={TX_CAP} value={n} aria-label="Tickets" onChange={(e) => setN(Number(e.target.value))} />
        <button className="qty-btn" aria-label="One more" disabled={n >= TX_CAP} onClick={() => setN(n + 1)}>+</button>
        <button className="qty-max" disabled={maxNow === 0} onClick={() => setN(maxNow)}>Max <small>{maxNow}</small></button>
        <span className="qty-hint">{n === 1 ? "ticket" : "tickets"} · up to {TX_CAP} a buy{n >= TX_CAP ? " · 3% off" : ""}</span>
      </div>
      <input className="note" maxLength={32} placeholder="Burn note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

      {paused && <p className="hint strong">The storm is rolling in. Buying reopens as soon as tonight's result lands.</p>}
      {done && !busy && <p className="done">🔥 {done.n} {done.n === 1 ? "ticket" : "tickets"} in. You hold {done.total.toLocaleString()} in this fire.</p>}

      {/* 1. choose how to pay for the PAPER part (nothing is spent here) */}
      <div className="payfor">
        <div className="payfor-head"><span>Pay with</span><button className="info-btn" onClick={() => setWhy(!why)} aria-expanded={why}>why $1?</button></div>
        {why && <p className="fine">No PAPER? Pay $1 a ticket in ETH or USDG instead. That $1 goes toward buying mills off the floor and burning them, which sends the PLANK inside to the Paper Mill royalty pool. Same ticket, same PLANK.</p>}
        <div className="seg" role="radiogroup" aria-label="Pay with">
          <button role="radio" aria-checked={pay === "paper"} className={pay === "paper" ? "on" : ""} onClick={() => choose("paper")}>PAPER<small>{fmtPaper(paperPerTicket)} a ticket</small></button>
          <button role="radio" aria-checked={pay === "eth"} className={pay === "eth" ? "on" : ""} disabled={!(ethUsd > 0)} onClick={() => choose("eth")}>ETH<small>{ethUsd > 0 ? "$1 a ticket" : "price feed stale"}</small></button>
          {usdgEnabled && <button role="radio" aria-checked={pay === "usdg"} className={pay === "usdg" ? "on" : ""} onClick={() => choose("usdg")}>USDG<small>$1 a ticket</small></button>}
        </div>
      </div>

      {/* 2. exactly what leaves your wallet, then one button */}
      <div className="path">
        <div className="spend">
          <span className="spend-label">You pay</span>
          <span className="spend-items">{legText}{dollars ? <small> ({$(q.usdg)})</small> : paperUsd > 0 ? <small> ({$(paperUsdCost)})</small> : null} + {fmtPlank(q.plank)} PLANK <small>({$(plankUsdCost)})</small></span>
          {(dollars || paperUsd > 0) && <span className="spend-total">{$(total)} total</span>}
        </div>
        {!confirming && (
          <button className="cta" disabled={busy || paused || !canPay || overCap} onClick={() => (dollars ? setConfirming(true) : go("paper"))}>
            {busy ? "Throwing…" : `Throw ${n} ${n === 1 ? "ticket" : "tickets"} in`}
          </button>
        )}
        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Confirm payment">
            <p>You're spending <b>{$(total)}</b>: {legText} and {fmtPlank(q.plank)} PLANK, for {n} {n === 1 ? "ticket" : "tickets"}. Your wallet asks you to approve it next.</p>
            <div className="confirm-row">
              <button className="cta ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="cta" disabled={busy} onClick={() => go(pay)}>{busy ? "Throwing…" : `Pay ${$(total)}`}</button>
            </div>
          </div>
        )}
        {!havePlank && <p className="hint">You're {$((q.plank - you.plank) * plankUsd)} short on PLANK. Swap for some below.</p>}
        {havePlank && pay === "paper" && you.paper < q.paper && <p className="hint">Not enough PAPER. Pick ETH or USDG above, or <a href={OPENSEA} target="_blank" rel="noreferrer">get a mill</a> (it prints 1 PAPER a day).</p>}
        {havePlank && pay === "eth" && ethUsd > 0 && you.eth < q.eth && <p className="hint">Not enough ETH for this.</p>}
        {havePlank && pay === "usdg" && you.usdg < q.usdg && <p className="hint">Not enough USDG for this.</p>}
        {overCap && <p className="hint">{you.remainingToday} left today (cap {DAILY_CAP} a wallet).</p>}
      </div>

      {err && <p className="hint">{err}</p>}
      <p className="fine muted">PAPER burns. Half the PLANK burns, half feeds the fire. Every ticket stays in until the fire goes out.</p>
    </aside>
  );
}
