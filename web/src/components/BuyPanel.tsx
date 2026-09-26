import { useState } from "react";
import { ETH_PER_TICKET, PLANK_PER_TICKET, quote } from "../data/types";

export function BuyPanel({
  yourPaper,
  onBuy,
  onStoke,
}: {
  yourPaper: number;
  onBuy: (n: number, withEth: boolean, note: string) => Promise<void>;
  onStoke: (plank: number) => Promise<void>;
}) {
  const [n, setN] = useState(10);
  const [withEth, setWithEth] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [stokeAmt, setStokeAmt] = useState(50);
  const q = quote(n);
  const savings = Math.round((1 - q.paper / n) * 100);

  async function go() {
    setBusy(true);
    try { await onBuy(n, withEth, note.trim()); setNote(""); } finally { setBusy(false); }
  }
  async function stoke() {
    setBusy(true);
    try { await onStoke(stokeAmt * 1_000_000); } finally { setBusy(false); }
  }

  return (
    <aside className="buy">
      <h2>Feed the fire</h2>
      <div className="tiers" role="radiogroup" aria-label="How many tickets">
        {[1, 10, 100, 1000].map((t) => (
          <button key={t} role="radio" aria-checked={n === t} className={"tier" + (n === t ? " on" : "")} onClick={() => setN(t)}>
            <b>{t.toLocaleString()}</b>
            <small>{t === 1 ? "ticket" : t === 10 ? "9 for 10" : t === 100 ? "80 for 100" : "700 for 1,000"}</small>
          </button>
        ))}
      </div>

      <div className="legs">
        <div className="leg">
          <span className="leg-label">Paper</span>
          {withEth ? (
            <span className="leg-val">{q.eth.toFixed(4)} ETH <small>bought from the fire</small></span>
          ) : (
            <span className="leg-val">{q.paper.toLocaleString()} PAPER</span>
          )}
        </div>
        <div className="leg">
          <span className="leg-label">Plank</span>
          <span className="leg-val">{(q.plank / 1_000_000).toLocaleString()}M PLANK</span>
        </div>
        {savings > 0 && <p className="save">Bundle price — {savings}% off both legs.</p>}
      </div>

      <label className="switch">
        <input type="checkbox" checked={withEth} onChange={(e) => setWithEth(e.target.checked)} />
        <span>I don't have PAPER — buy it from the fire with ETH</span>
      </label>
      {!withEth && yourPaper < q.paper && (
        <p className="warn">You have {yourPaper} PAPER. Claim from your mills, or buy from the fire with ETH.</p>
      )}

      <input className="note" maxLength={32} placeholder="Burn note (32 characters, shows on the fire)" value={note} onChange={(e) => setNote(e.target.value)} />

      <button className="cta" disabled={busy || (!withEth && yourPaper < q.paper)} onClick={go}>
        {busy ? "Throwing…" : `Throw ${n.toLocaleString()} ${n === 1 ? "ticket" : "tickets"} in`}
      </button>
      <p className="fine">PAPER burns. Half the PLANK burns, half feeds the pot. Every ticket counts until the fire goes out.</p>

      <details className="stoke">
        <summary>Just want a bigger fire? Stoke it with PLANK</summary>
        <div className="stoke-row">
          <input type="number" min={1} value={stokeAmt} onChange={(e) => setStokeAmt(Number(e.target.value))} aria-label="Million PLANK" />
          <span>M PLANK</span>
          <button className="cta small" disabled={busy} onClick={stoke}>Stoke</button>
        </div>
        <p className="fine">No ticket. Half burns, half goes in the pot.</p>
      </details>

      <p className="fine muted">1 ticket = 1 PAPER + {(PLANK_PER_TICKET / 1e6).toLocaleString()}M PLANK, or {ETH_PER_TICKET} ETH + PLANK. Fixed forever.</p>
    </aside>
  );
}
