import { useState } from "react";
import { DAILY_CAP, TX_CAP, type Pay, quote } from "../data/types";

const OPENSEA = "https://opensea.io/collection/the-plank-press";
const fmtPlank = (p: number) => p >= 1e9 ? `${(p / 1e9).toFixed(2)}B` : `${(p / 1e6).toFixed(0)}M`;
const $ = (v: number) => `$${v.toFixed(2)}`;

export function BuyPanel({
  you, plankPerTicket, plankUsd, ethUsd, onBuy, onConnect, paused, usdgEnabled,
}: {
  you: { address?: string; tickets: number; paper: number; plank: number; eth: number; usdg: number; remainingToday: number };
  plankPerTicket: number; plankUsd: number; ethUsd: number;
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

  const q = quote(n, plankPerTicket, ethUsd);
  const plankUsdCost = q.plank * plankUsd;
  const havePlank = you.plank >= q.plank;
  const canPaper = havePlank && you.paper >= q.paper;
  const canEth = havePlank && ethUsd > 0 && you.eth >= q.eth;
  const canUsdg = havePlank && !!usdgEnabled && you.usdg >= q.usdg;
  const overCap = n > you.remainingToday;
  // how many tickets you could buy right now, by whichever way you can pay for the paper leg
  const byPlank = Math.floor(you.plank / plankPerTicket);
  const byPaperLeg = Math.max(Math.floor(you.paper), ethUsd > 0 ? Math.floor(you.eth * ethUsd) : 0, usdgEnabled ? Math.floor(you.usdg) : 0);
  const affordable = Math.max(0, Math.min(byPlank, byPaperLeg));
  const maxNow = Math.max(0, Math.min(affordable, you.remainingToday, TX_CAP));

  async function go(pay: Pay) {
    setBusy(true); setErr(""); setDone(null);
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
        <div><b>{you.paper.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b><span>PAPER</span></div>
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

      {/* the buy */}
      <div className="path">
        <div className="cost"><span>{q.paper.toLocaleString()} PAPER</span><span>+</span><span>{fmtPlank(q.plank)} PLANK <small>({$(plankUsdCost)})</small></span></div>
        <button className="cta" disabled={busy || paused || !canPaper || overCap} onClick={() => go("paper")}>
          {busy ? "Throwing…" : `Throw ${n} ${n === 1 ? "ticket" : "tickets"} in`}
        </button>
        {!havePlank && <p className="hint">You're {$((q.plank - you.plank) * plankUsd)} short on PLANK. Swap for some below.</p>}
        {havePlank && you.paper < q.paper && <p className="hint">Not enough PAPER — pay dollars instead ↓, or <a href={OPENSEA} target="_blank" rel="noreferrer">get a mill</a> (it prints 1 PAPER a day).</p>}
        {overCap && <p className="hint">{you.remainingToday} left today (cap {DAILY_CAP} a wallet).</p>}
      </div>

      {/* no PAPER: pay $1 a ticket for the paper leg */}
      <div className="path alt">
        <div className="cost"><span>No PAPER? Pay <b>$1</b> a ticket instead</span><button className="info-btn" onClick={() => setWhy(!why)} aria-expanded={why}>why $1?</button></div>
        {why && <p className="fine">Real PAPER costs about a third of that. The extra buys mills off the floor and burns them, which sends the PLANK inside to every mill holder. You still put in the same PLANK and get the same ticket.</p>}
        <div className="pay-row">
          {ethUsd > 0
            ? <button className="cta ghost" disabled={busy || paused || !canEth || overCap} onClick={() => go("eth")}>ETH <small>{q.eth.toFixed(4)} · {$(q.usdg)}</small></button>
            : <button className="cta ghost" disabled>ETH price feed stale</button>}
          {usdgEnabled && <button className="cta ghost" disabled={busy || paused || !canUsdg || overCap} onClick={() => go("usdg")}>USDG <small>{$(q.usdg)}</small></button>}
        </div>
        <p className="fine muted">Total {$(q.usdg + plankUsdCost)}: {$(q.usdg)} for the paper leg + {$(plankUsdCost)} of PLANK.</p>
      </div>

      {err && <p className="hint">{err}</p>}
      <p className="fine muted">PAPER burns. Half the PLANK burns, half feeds the pot. Every ticket stays in until the fire goes out.</p>
    </aside>
  );
}
