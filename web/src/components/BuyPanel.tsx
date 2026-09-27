import { useState } from "react";
import { DAILY_CAP, TX_CAP, quote } from "../data/types";

const OPENSEA = "https://opensea.io/collection/paper-mills"; // TODO: real collection URL

export function BuyPanel({
  you, plankPerTicket, plankUsd, ethUsd, onBuy, onStoke,
}: {
  you: { paper: number; plank: number; eth: number; remainingToday: number };
  plankPerTicket: number; plankUsd: number; ethUsd: number;
  onBuy: (n: number, withEth: boolean, note: string) => Promise<void>;
  onStoke: (plank: number, note: string) => Promise<void>;
}) {
  const [n, setN] = useState(10);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pyro, setPyro] = useState(false);
  const [pyroAmt, setPyroAmt] = useState(50);
  const [pyroSure, setPyroSure] = useState(false);
  const q = quote(n, plankPerTicket, ethUsd);
  const off = Math.round((1 - q.paper / n) * 100);
  const canPaper = you.paper >= q.paper && you.plank >= q.plank;
  const canEth = you.eth >= q.eth && you.plank >= q.plank;
  const overCap = n > you.remainingToday;
  const affordable = Math.min(Math.floor(you.paper), Math.floor(you.plank / plankPerTicket));
  const maxNow = Math.max(0, Math.min(affordable, you.remainingToday, TX_CAP));

  async function go(withEth: boolean) {
    setBusy(true);
    try { await onBuy(n, withEth, note.trim()); setNote(""); } finally { setBusy(false); }
  }
  async function burn() {
    setBusy(true);
    try { await onStoke(pyroAmt * 1_000_000, note.trim() || "just here to burn plank"); setPyroSure(false); setNote(""); } finally { setBusy(false); }
  }

  return (
    <aside className="buy">
      <div className="wallet">
        <div><b>{you.paper.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b><span>PAPER</span></div>
        <div><b>{(you.plank / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}M</b><span>PLANK</span></div>
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

      {/* Path A: real PAPER */}
      <div className="path">
        <div className="path-head"><b>With your PAPER</b><span>{q.paper.toLocaleString()} PAPER + {(q.plank / 1e6).toFixed(0)}M PLANK{off > 0 ? ` · ${off}% off` : ""}</span></div>
        <button className="cta" disabled={busy || !canPaper || overCap} onClick={() => go(false)}>
          {busy ? "Throwing…" : `Throw ${n} ${n === 1 ? "ticket" : "tickets"} in`}
        </button>
        {!canPaper && you.paper < q.paper && (
          <p className="hint">
            Not enough PAPER. Mills print it daily — <a href={OPENSEA} target="_blank" rel="noreferrer">get a mill on OpenSea</a>
            <span className="info" tabIndex={0}>ⓘ<span className="tip">A Paper Mill is an NFT with ~$75 of PLANK locked inside. It prints 1 PAPER a day, forever, to whoever holds it. Burn the mill any time and the PLANK comes back to you.</span></span>
            {" "}— or buy paper from the fire below.
          </p>
        )}
        {!canPaper && you.plank < q.plank && <p className="hint">Not enough PLANK. Swap for some in the box below.</p>}
        {overCap && <p className="hint">Max {DAILY_CAP} tickets per wallet per day — you have {you.remainingToday} left today.</p>}
      </div>

      {/* Path B: paper from the fire */}
      <div className="path eth">
        <div className="path-head"><b>No PAPER? Buy paper from the fire</b><span>{q.eth.toFixed(4)} ETH + {(q.plank / 1e6).toFixed(0)}M PLANK</span></div>
        <p className="hint strong">You're paying with ETH instead of PAPER — same ticket, at a premium (${(q.eth * ethUsd / n).toFixed(2)} a ticket for the paper leg, roughly 3× what real PAPER costs). The ETH goes to buying mills and burning them.</p>
        <button className="cta ghost" disabled={busy || !canEth || overCap} onClick={() => go(true)}>Buy {n} with ETH</button>
      </div>

      {/* Pyro */}
      <div className={"pyro" + (pyro ? " open" : "")}>
        <button className="pyro-toggle" onClick={() => { setPyro(!pyro); setPyroSure(false); }}>
          <span className="pyro-tag">PYRO</span> I don't want a ticket. I just want to watch PLANK burn.
        </button>
        {pyro && (
          <div className="pyro-body">
            <p className="pyro-warn">
              <b>Read this twice.</b> There is no ticket. There are no odds. You will not win anything, ever, from this button.
              Half of your PLANK is sent to the dead address and is gone from the universe. The other half goes in the pot — for
              <em> someone else</em> to win. You get a "Pyro" tag next to your name and the warm feeling of having set money on fire.
            </p>
            <div className="stoke-row">
              <input type="number" min={1} value={pyroAmt} onChange={(e) => setPyroAmt(Number(e.target.value))} aria-label="Million PLANK" />
              <span>M PLANK (${(pyroAmt * 1e6 * plankUsd).toFixed(2)}) — {(pyroAmt / 2).toFixed(0)}M gone forever, {(pyroAmt / 2).toFixed(0)}M to the pot</span>
            </div>
            <label className="switch"><input type="checkbox" checked={pyroSure} onChange={(e) => setPyroSure(e.target.checked)} /><span>I understand I get absolutely nothing for this and I'm doing it anyway.</span></label>
            <button className="cta danger" disabled={busy || !pyroSure || you.plank < pyroAmt * 1e6} onClick={burn}>
              {busy ? "Burning…" : "Burn it. I'm a pyro. 🔥"}
            </button>
          </div>
        )}
      </div>

      <p className="fine">1 ticket = 1 PAPER + about $0.90 of PLANK (right now {(plankPerTicket / 1e6).toFixed(1)}M). PAPER burns. Half the PLANK burns, half feeds the pot. Every ticket counts until the fire goes out. Up to {TX_CAP} per buy, {DAILY_CAP} per wallet per day.</p>
    </aside>
  );
}
