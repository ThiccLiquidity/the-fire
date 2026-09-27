import { useState } from "react";
import { DAILY_CAP, TX_CAP, quote } from "../data/types";

const OPENSEA = "https://opensea.io/collection/the-plank-press";
const fmtPlank = (p: number) => p >= 1e9 ? `${(p / 1e9).toFixed(2)}B` : `${(p / 1e6).toFixed(0)}M`;

export function BuyPanel({
  you, plankPerTicket, ethUsd, onBuy, onConnect, paused,
}: {
  you: { address?: string; paper: number; plank: number; eth: number; remainingToday: number };
  plankPerTicket: number; ethUsd: number;
  onBuy: (n: number, withEth: boolean, note: string) => Promise<void>;
  onConnect?: () => Promise<void>;
  paused?: boolean;
}) {
  const [n, setN] = useState(10);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const q = quote(n, plankPerTicket, ethUsd);
  const off = Math.round((1 - q.paper / n) * 100);
  const canPaper = you.paper >= q.paper && you.plank >= q.plank;
  const canEth = you.eth >= q.eth && you.plank >= q.plank;
  const overCap = n > you.remainingToday;
  const affordable = Math.min(Math.floor(you.paper), Math.floor(you.plank / plankPerTicket));
  const maxNow = Math.max(0, Math.min(affordable, you.remainingToday, TX_CAP));

  async function go(withEth: boolean) {
    setBusy(true); setErr("");
    try { await onBuy(n, withEth, note.trim()); setNote(""); }
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
      <p className="fine">1 ticket = 1 PAPER + about $0.90 of PLANK. PAPER burns. Half the PLANK burns, half feeds the pot. Up to {TX_CAP} per buy, {DAILY_CAP} per wallet per day.</p>
    </aside>
  );

  return (
    <aside className="buy">
      <div className="wallet">
        <div><b>{you.paper.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b><span>PAPER</span></div>
        <div><b>{you.plank >= 1e9 ? `${(you.plank / 1e9).toFixed(1)}B` : `${(you.plank / 1e6).toFixed(0)}M`}</b><span>PLANK</span></div>
        <div><b>{affordable}</b><span>tickets you can buy now</span></div>
      </div>

      <div className="tiers" role="radiogroup" aria-label="How many tickets">
        {[1, 5, 10].map((t) => (
          <button key={t} role="radio" aria-checked={n === t} className={"tier" + (n === t ? " on" : "")} onClick={() => setN(t)}>
            <b>{t}</b><small>{t === 1 ? "ticket" : t === 10 ? "3% off" : "tickets"}</small>
          </button>
        ))}
        <button role="radio" aria-checked={n === maxNow && maxNow > 0} className={"tier max" + (n === maxNow && maxNow > 0 ? " on" : "")} disabled={maxNow === 0} onClick={() => setN(maxNow)}>
          <b>Max</b><small>{maxNow} now</small>
        </button>
      </div>
      <input className="note" maxLength={32} placeholder="Burn note — 32 characters, drifts over the fire" value={note} onChange={(e) => setNote(e.target.value)} />

      {paused && <p className="hint strong">The storm is rolling in. Buying reopens as soon as tonight's result lands, usually within seconds.</p>}
      {/* Path A: real PAPER */}
      <div className="path">
        <div className="path-head"><b>With your PAPER</b><span>{q.paper.toLocaleString()} PAPER + {fmtPlank(q.plank)} PLANK{off > 0 ? ` · ${off}% off` : ""}</span></div>
        <button className="cta" disabled={busy || paused || !canPaper || overCap} onClick={() => go(false)}>
          {busy ? "Throwing…" : `Throw ${n} ${n === 1 ? "ticket" : "tickets"} in`}
        </button>
        {!canPaper && you.paper < q.paper && (
          <p className="hint">
            Not enough PAPER. Mills print it daily — <a href={OPENSEA} target="_blank" rel="noreferrer">get a mill on OpenSea</a>
            <span className="info" tabIndex={0}>ⓘ<span className="tip">A Paper Mill is an NFT with about 89 billion PLANK (~$90 at today's price) locked inside. It prints 1 PAPER a day, forever, to whoever holds it. Burn the mill (allowed from Oct 1, 2026) and the PLANK comes back to you.</span></span>
            {" "}— or buy paper from the fire below.
          </p>
        )}
        {!canPaper && you.plank < q.plank && <p className="hint">Not enough PLANK. Swap for some in the box below.</p>}
        {overCap && <p className="hint">Max {DAILY_CAP} tickets per wallet per day — you have {you.remainingToday} left today.</p>}
      </div>

      {/* Path B: paper from the fire */}
      <div className="path eth">
        <div className="path-head"><b>No PAPER? Buy paper from the fire</b><span>{q.eth.toFixed(4)} ETH + {fmtPlank(q.plank)} PLANK</span></div>
        <p className="hint strong">You're paying with ETH instead of PAPER — same ticket, at a premium (${(q.eth * ethUsd / n).toFixed(2)} a ticket for the paper leg, roughly 3× what real PAPER costs). The ETH goes to buying mills and burning them.</p>
        <button className="cta ghost" disabled={busy || paused || !canEth || overCap} onClick={() => go(true)}>Buy {n} with ETH</button>
      </div>

      {err && <p className="hint">{err}</p>}
      <p className="fine">1 ticket = 1 PAPER + about $0.90 of PLANK (right now {fmtPlank(plankPerTicket)}). PAPER burns. Half the PLANK burns, half feeds the pot. Every ticket counts until the fire goes out. Up to {TX_CAP} per buy, {DAILY_CAP} per wallet per day.</p>
    </aside>
  );
}
