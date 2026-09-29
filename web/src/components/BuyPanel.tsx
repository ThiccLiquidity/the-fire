import { PlankIcon } from "./PlankIcon";
import { useState } from "react";
import { DAILY_CAP, ETH_HEADROOM, TX_CAP, type FireState, type Pay, type PriceSeen, freeLogs, quote, ticketsFor } from "../data/types";
import { TxPending, friendly, txUrl } from "../data/wallet";
import { fmtAmt, fmtCount, fmtPlank, fmtUsd } from "../format";

const OPENSEA = "https://opensea.io/collection/the-plank-press";
const GAS_ETH = 0.0003; // left in the wallet for gas when paying with ETH

type Frozen = { n: number; pay: Pay; seen: PriceSeen; q: ReturnType<typeof quote> };

export function BuyPanel({
  you, plankPerTicket, paperPerTicket = 1, paperUsd = 0, plankUsd, ethUsd, onBuy, onConnect, paused, usdgEnabled, raw, abandoned, hold, demo, night = 2,
}: {
  you: FireState["you"];
  plankPerTicket: number; paperPerTicket?: number; paperUsd?: number; plankUsd: number; ethUsd: number;
  onBuy: (n: number, pay: Pay, note: string, seen: PriceSeen) => Promise<void>;
  usdgEnabled?: boolean;
  onConnect?: () => Promise<void>;
  paused?: boolean;
  raw?: FireState["raw"];
  abandoned?: boolean;
  /** the storm is mid-ceremony: buying waits until the result is shown */
  hold?: string;
  demo?: boolean;
  /** nights the fire has survived: free logs are 3 on its first day, 2 on its second, 1 after */
  night?: number;
}) {
  const [qty, setQty] = useState("1"); // the box's text as typed; parsed below, clamped on blur
  const typed = Number(qty);
  const qtyOk = qty.trim() !== "" && Number.isInteger(typed) && typed >= 1 && typed <= TX_CAP;
  const n = qtyOk ? typed : Math.max(1, Math.min(TX_CAP, Math.floor(typed) || 1)); // prices show for the nearest valid amount
  const [note, setNoteRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ n: number; total: number } | null>(null);
  const [why, setWhy] = useState(false);
  const [payPick, setPay] = useState<Pay | null>(null); // null = the sensible default below
  const [confirming, setConfirming] = useState<Frozen | null>(null); // ETH/USDG: a review step before real money moves
  const [pending, setPending] = useState<string>(""); // a tx hash still waiting after 3 minutes: the panel stays locked
  const touched = () => { setDone(null); setErr(""); setConfirming(null); };
  const setN = (v: number) => { setQty(String(Math.max(1, Math.min(TX_CAP, Math.floor(v) || 1)))); touched(); };
  const clampQty = () => { if (qty.trim() !== "" && Number.isFinite(typed)) setQty(String(n)); }; // blur: "15" → 10, "2.7" → 2; empty stays empty
  const setNote = (v: string) => { setNoteRaw(v); setDone(null); };

  const q = quote(n, plankPerTicket, ethUsd, paperPerTicket);
  const fmtPaper = (p: number) => fmtAmt(p);
  const usdOrDash = (v: number, px: number) => (px > 0 ? fmtUsd(v) : "$—");
  const ethOn = ethUsd > 0;
  const ethNeed = q.eth * ETH_HEADROOM + GAS_ETH;
  const plankShort = you.plank < q.plank;
  const canPaper = !plankShort && you.paper >= q.paper;
  const canEth = !plankShort && ethOn && you.eth >= ethNeed;
  const canUsdg = !plankShort && !!usdgEnabled && you.usdg >= q.usdg;
  // Default to PAPER when you have it, else the first dollar option you can use.
  const pay: Pay = payPick ?? (you.paper >= paperPerTicket ? "paper" : ethOn && you.eth >= (1 / ethUsd) * ETH_HEADROOM + GAS_ETH ? "eth" : usdgEnabled && you.usdg >= 1 ? "usdg" : ethOn ? "eth" : usdgEnabled ? "usdg" : "paper");
  const canPay = pay === "paper" ? canPaper : pay === "eth" ? canEth : canUsdg;
  const dollars = pay !== "paper";

  // how many tickets you could pay for today, the way you've chosen to pay
  const byPlank = Math.floor(you.plank / plankPerTicket + 1e-9);
  const byMethod = pay === "paper" ? Math.floor(you.paper / paperPerTicket + 1e-9)
    : pay === "eth" ? (ethOn ? Math.floor(Math.max(0, you.eth - GAS_ETH) / ((1 / ethUsd) * ETH_HEADROOM)) : 0)
    : usdgEnabled ? Math.floor(you.usdg + 1e-9) : 0;
  const affordable = Math.max(0, Math.min(byPlank, byMethod));
  const canToday = Math.min(affordable, you.remainingToday);
  // the free logs count toward the daily cap, so 10 only fits with room for all of them
  const maxNow = Math.max(0, Math.min(affordable, TX_CAP, you.remainingToday >= ticketsFor(TX_CAP, night) ? TX_CAP : Math.min(you.remainingToday, TX_CAP - 1)));
  const got = ticketsFor(n, night); // logs you'll hold for this throw
  const bonus = got > n;
  const overCap = got > you.remainingToday;
  const legText = (x: ReturnType<typeof quote>, p: Pay) => (p === "paper" ? `${fmtPaper(x.paper)} PAPER` : p === "eth" ? `${fmtAmt(x.eth)} ETH` : `${fmtAmt(x.usdg)} USDG`);
  const totalOf = (x: ReturnType<typeof quote>, p: Pay) => (p !== "paper" ? x.usdg : x.paper * paperUsd) + x.plank * plankUsd;
  const total = totalOf(q, pay);
  const showTotal = plankUsd > 0 && (dollars || paperUsd > 0);
  const choose = (p: Pay) => { setPay(p); touched(); };
  const deadEnd = !ethOn && !usdgEnabled && you.paper < paperPerTicket;
  const seenNow = (): PriceSeen => ({ plankPerTicket, paperPerTicket, ethUsd, raw });

  async function go(f: Frozen) {
    setBusy(true); setErr(""); setDone(null); setConfirming(null);
    try { await onBuy(f.n, f.pay, note.trim(), f.seen); setNoteRaw(""); setDone({ n: ticketsFor(f.n, night), total: you.tickets + ticketsFor(f.n, night) }); }
    catch (e) {
      if (e instanceof TxPending) {
        setPending(e.hash);
        // a late approval only allowed the spend: the buy itself was never sent
        if (e.kind === "approve") void e.later.then((ok) => { setPending(""); setErr(ok ? "Approval landed. Press Throw again to buy." : "The approval failed on-chain. Nothing was bought."); });
        else void e.later.then((ok) => { setPending(""); if (ok) setDone({ n: ticketsFor(f.n, night), total: you.tickets + ticketsFor(f.n, night) }); else setErr("That transaction failed on-chain. Nothing more was sent."); });
      } else setErr(friendly(e));
    }
    finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setErr("");
    try { await onConnect!(); } catch (e) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  const rules = <p className="fine">1 log = 1 PAPER (once PAPER trades above $0.33, the PAPER amount drifts toward $0.33 worth, at most 5% a day) + about $0.90 of PLANK, and every log is a ticket to win. No PAPER? Pay $1 in ETH or USDG instead. Up to {TX_CAP} a throw, {DAILY_CAP} a day. Throw {TX_CAP} and get free logs: 3 on a fire's first day, 2 on its second, 1 after that.</p>;

  if (abandoned) return (
    <aside className="buy">
      <p className="hint strong"><b>The game has ended. Buying is closed.</b></p>
      <p className="fine">The storm never arrived for 7 days, so the fire was ended for good. If you had logs in the last fire, take your share of its pot above.</p>
    </aside>
  );

  if (!you.address && onConnect) return (
    <aside className="buy">
      <button className="cta" disabled={busy} onClick={connect}>{busy ? "Connecting…" : demo ? "Connect the demo wallet to play" : "Connect wallet to throw logs"}</button>
      {err && <p className="hint">{err}</p>}
      {rules}
    </aside>
  );

  const locked = busy || !!paused || !!hold || !!pending;
  const hints: string[] = [];
  if (plankShort) hints.push(plankUsd > 0 ? `You're ${fmtUsd((q.plank - you.plank) * plankUsd)} short on PLANK.` : `You need ${fmtPlank(q.plank - you.plank)} more PLANK.`);
  if (pay === "paper" && you.paper < q.paper) hints.push(`Not enough PAPER (you have ${fmtPaper(you.paper)}, this needs ${fmtPaper(q.paper)}).`);
  if (pay === "eth" && ethOn && you.eth < ethNeed) hints.push(`Not enough ETH (this needs about ${fmtAmt(ethNeed)} with gas).`);
  if (pay === "usdg" && you.usdg < q.usdg) hints.push(`Not enough USDG (you have ${fmtAmt(you.usdg)}).`);

  return (
    <aside className="buy">
      <div className="wallet">
        <div><b>{fmtPaper(you.paper)}</b><span>PAPER{paperUsd > 0 ? ` · ${fmtUsd(you.paper * paperUsd)}` : ""}</span></div>
        <div><b><PlankIcon />{fmtPlank(you.plank)}</b><span>PLANK · {usdOrDash(you.plank * plankUsd, plankUsd)}</span></div>
        <div><b>{fmtCount(canToday)}</b><span>logs you can throw today with {pay === "paper" ? "PAPER" : pay.toUpperCase()}</span></div>
      </div>

      <div className="qty">
        <button className="qty-btn" aria-label="One fewer" disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
        <input className="qty-in" type="number" inputMode="numeric" min={1} max={TX_CAP} value={qty} aria-label="Logs" aria-invalid={!qtyOk}
          onChange={(e) => { setQty(e.target.value); touched(); }} onBlur={clampQty} onKeyDown={(e) => { if (e.key === "Enter") clampQty(); }} />
        <button className="qty-btn" aria-label="One more" disabled={n >= TX_CAP} onClick={() => setN(n + 1)}>+</button>
        <button className="qty-max" disabled={maxNow === 0} onClick={() => setN(maxNow)}>Max <small>{maxNow}</small></button>
        {!qtyOk && <span className="qty-hint">{qty.trim() === "" ? "How many logs?" : `1 to ${TX_CAP} logs a throw.`}</span>}
        {bonus
          ? <span className="bonus on">🎁 {n} + {freeLogs(night)} free = <b>{got} logs</b></span>
          : <button className="bonus" onClick={() => setN(TX_CAP)}>🎁 Throw {TX_CAP}, get {freeLogs(night)} free{night === 0 ? " (first-day bonus)" : night === 1 ? " (second-day bonus)" : ""}</button>}
      </div>
      <input className="note" maxLength={32} placeholder="Burn note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

      {paused && <p className="hint strong">The storm is rolling in. Buying reopens as soon as the result lands.</p>}
      {hold && !paused && <p className="hint strong">{hold}</p>}
      {done && !busy && <p className="done">🔥 {done.n} {done.n === 1 ? "log" : "logs"} on the fire. You hold {fmtCount(done.total)} in this fire.</p>}
      {pending && (
        <p className="hint strong">Still pending. <a href={txUrl(pending)} target="_blank" rel="noreferrer">Check it on the explorer</a>. Buying stays locked until it lands. <button className="linkish" onClick={() => setPending("")}>Dismiss</button></p>
      )}

      {/* 1. choose how to pay for the PAPER part (nothing is spent here) */}
      <div className="payfor">
        <div className="payfor-head"><span>Pay with</span><button className="info-btn" onClick={() => setWhy(!why)} aria-expanded={why}>why $1?</button></div>
        {why && <p className="fine">No PAPER? Pay $1 a log in ETH or USDG instead. That $1 goes toward buying presses off the floor and burning them, which sends the PLANK inside to the Paper Press royalty pool. Same log, same PLANK.</p>}
        <div className="seg" role="radiogroup" aria-label="Pay with">
          <button role="radio" aria-checked={pay === "paper"} className={pay === "paper" ? "on" : ""} onClick={() => choose("paper")}>PAPER<small>{fmtPaper(paperPerTicket)} a log</small></button>
          <button role="radio" aria-checked={pay === "eth"} className={pay === "eth" ? "on" : ""} disabled={!ethOn} onClick={() => choose("eth")}>ETH<small>{ethOn ? "$1 a log" : "paused (price feed late)"}</small></button>
          {usdgEnabled && <button role="radio" aria-checked={pay === "usdg"} className={pay === "usdg" ? "on" : ""} onClick={() => choose("usdg")}>USDG<small>$1 a log</small></button>}
        </div>
      </div>

      {/* 2. exactly what leaves your wallet, then one button */}
      <div className="path">
        <div className="spend">
          <span className="spend-label">You pay</span>
          <span className="spend-items">{legText(q, pay)}{dollars ? <small> ({fmtUsd(q.usdg)})</small> : paperUsd > 0 ? <small> ({fmtUsd(q.paper * paperUsd)})</small> : null} + <PlankIcon />{fmtPlank(q.plank)} PLANK <small>({usdOrDash(q.plank * plankUsd, plankUsd)})</small></span>
          {showTotal && <span className="spend-total">{fmtUsd(total)} total</span>}
        </div>
        {!confirming && (
          <button className="cta" disabled={locked || !qtyOk || !canPay || overCap} onClick={() => { if (!qtyOk) return; const f: Frozen = { n, pay, seen: seenNow(), q }; if (dollars) setConfirming(f); else void go(f); }}>
            {busy ? "Throwing…" : `Throw ${got} ${got === 1 ? "log" : "logs"} on the fire`}
          </button>
        )}
        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Confirm payment">
            <p>You're spending <b>{plankUsd > 0 ? fmtUsd(totalOf(confirming.q, confirming.pay)) : legText(confirming.q, confirming.pay)}</b>: {legText(confirming.q, confirming.pay)} and {fmtPlank(confirming.q.plank)} PLANK, for {ticketsFor(confirming.n, night)} {ticketsFor(confirming.n, night) === 1 ? "log" : "logs"}{ticketsFor(confirming.n, night) > confirming.n ? ` (${confirming.n} + ${freeLogs(night)} free)` : ""}.
              {confirming.pay === "eth" && ` Up to ${fmtAmt(confirming.q.eth * ETH_HEADROOM)} ETH is sent, in case the price ticks; any extra comes back.`}
              {demo ? " Play money." : " Your wallet asks you to approve it next."}</p>
            <div className="confirm-row">
              <button className="cta ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="cta" disabled={locked} onClick={() => go(confirming)}>{busy ? "Throwing…" : `Pay ${plankUsd > 0 ? fmtUsd(totalOf(confirming.q, confirming.pay)) : ""}`.trim()}</button>
            </div>
          </div>
        )}
        {deadEnd ? (
          <p className="hint">You have no PAPER, ETH is paused (price feed late){usdgEnabled ? "" : " and USDG is off"}. Swap for PAPER below, or come back when ETH reopens.</p>
        ) : hints.length > 0 && (
          <p className="hint">{hints.join(" ")} {plankShort || pay !== "paper" ? "Swap for some below." : <>Pick ETH or USDG above, swap for PAPER below, or <a href={OPENSEA} target="_blank" rel="noreferrer">get a press</a> (it prints 1 PAPER a day).</>}</p>
        )}
        {overCap && (
          <p className="hint">{you.remainingToday === 0 ? `You've hit today's ${DAILY_CAP}. More after the next storm.` : n === TX_CAP && you.remainingToday >= TX_CAP ? `A buy of ${TX_CAP} gives ${ticketsFor(TX_CAP, night)} — pick ${TX_CAP - 1} or fewer today.` : `${you.remainingToday} left today (cap ${DAILY_CAP} a wallet).`}</p>
        )}
      </div>

      {err && <p className="hint">{err}</p>}
      <p className="fine muted">PAPER burns. All the PLANK goes into the fire's pot. Every log is a ticket to win, and it stays in the draw until the fire goes out.</p>
    </aside>
  );
}
