import { PlankIcon } from "./PlankIcon";
import { useState } from "react";
import { DAILY_CAP, TX_CAP, type FireState, type Pay, type PriceSeen, quote, ticketsFor } from "../data/types";
import { TxPending, friendly, txUrl } from "../data/wallet";
import { fmtAmt, fmtCount, fmtPlank, fmtUsd } from "../format";

const OPENSEA = "https://opensea.io/collection/the-plank-press";
const GAS_ETH = 0.0003; // left in the wallet for gas when paying with ETH
const ETH_HEADROOM = 1.01; // an ETH buy sends up to 1% over the price; the fire refunds the rest

type Frozen = { n: number; pay: Pay; seen: PriceSeen; q: ReturnType<typeof quote> };

export function BuyPanel({
  you, plankPerTicket, paperPerTicket = 1, paperUsd = 0, plankUsd, ethUsd, onBuy, onConnect, paused, usdgEnabled, raw, abandoned, hold, demo,
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
}) {
  const [n, setNRaw] = useState(1);
  const [note, setNoteRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ n: number; total: number } | null>(null);
  const [why, setWhy] = useState(false);
  const [payPick, setPay] = useState<Pay | null>(null); // null = the sensible default below
  const [confirming, setConfirming] = useState<Frozen | null>(null); // ETH/USDG: a review step before real money moves
  const [pending, setPending] = useState<string>(""); // a tx hash still waiting after 3 minutes: the panel stays locked
  const touched = () => { setDone(null); setErr(""); setConfirming(null); };
  const setN = (v: number) => { setNRaw(Math.max(1, Math.min(TX_CAP, Math.floor(v) || 1))); touched(); };
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
  // the free 11th ticket counts toward the daily cap, so 10 only fits with room for 11
  const maxNow = Math.max(0, Math.min(affordable, TX_CAP, you.remainingToday >= ticketsFor(TX_CAP) ? TX_CAP : Math.min(you.remainingToday, TX_CAP - 1)));
  const got = ticketsFor(n); // tickets you'll hold for this buy
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
    try { await onBuy(f.n, f.pay, note.trim(), f.seen); setNoteRaw(""); setDone({ n: ticketsFor(f.n), total: you.tickets + ticketsFor(f.n) }); }
    catch (e) {
      if (e instanceof TxPending) {
        setPending(e.hash);
        void e.later.then((ok) => { setPending(""); if (ok) setDone({ n: ticketsFor(f.n), total: you.tickets + ticketsFor(f.n) }); else setErr("That transaction failed on-chain. Nothing more was sent."); });
      } else setErr(friendly(e));
    }
    finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setErr("");
    try { await onConnect!(); } catch (e) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  const rules = <p className="fine">1 ticket = 1 PAPER (or $0.33 worth, whichever is less) + about $0.90 of PLANK. No PAPER? Pay $1 in ETH or USDG instead. Up to {TX_CAP} a buy ({TX_CAP} gets you {ticketsFor(TX_CAP)}), {DAILY_CAP} a day.</p>;

  if (abandoned) return (
    <aside className="buy">
      <p className="hint strong"><b>The game has ended. Buying is closed.</b></p>
      <p className="fine">Tonight's storm never arrived for 7 days, so the fire was ended for good. If you held tickets in the last fire, take your share of its pot above.</p>
    </aside>
  );

  if (!you.address && onConnect) return (
    <aside className="buy">
      <button className="cta" disabled={busy} onClick={connect}>{busy ? "Connecting…" : demo ? "Connect the demo wallet to play" : "Connect wallet to buy tickets"}</button>
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
        <div><b>{fmtCount(canToday)}</b><span>tickets you can buy today with {pay === "paper" ? "PAPER" : pay.toUpperCase()}</span></div>
      </div>

      <div className="qty">
        <button className="qty-btn" aria-label="One fewer" disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
        <input className="qty-in" type="number" inputMode="numeric" min={1} max={TX_CAP} value={n} aria-label="Tickets" onChange={(e) => setN(Number(e.target.value))} />
        <button className="qty-btn" aria-label="One more" disabled={n >= TX_CAP} onClick={() => setN(n + 1)}>+</button>
        <button className="qty-max" disabled={maxNow === 0} onClick={() => setN(maxNow)}>Max <small>{maxNow}</small></button>
        {bonus
          ? <span className="bonus on">🎁 {n} + 1 free = <b>{got} tickets</b></span>
          : <button className="bonus" onClick={() => setN(TX_CAP)}>🎁 Buy {TX_CAP}, get 1 free</button>}
      </div>
      <input className="note" maxLength={32} placeholder="Burn note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

      {paused && <p className="hint strong">The storm is rolling in. Buying reopens as soon as tonight's result lands.</p>}
      {hold && !paused && <p className="hint strong">{hold}</p>}
      {done && !busy && <p className="done">🔥 {done.n} {done.n === 1 ? "ticket" : "tickets"} in. You hold {fmtCount(done.total)} in this fire.</p>}
      {pending && (
        <p className="hint strong">Still pending. <a href={txUrl(pending)} target="_blank" rel="noreferrer">Check it on the explorer</a>. Buying stays locked until it lands. <button className="linkish" onClick={() => setPending("")}>Dismiss</button></p>
      )}

      {/* 1. choose how to pay for the PAPER part (nothing is spent here) */}
      <div className="payfor">
        <div className="payfor-head"><span>Pay with</span><button className="info-btn" onClick={() => setWhy(!why)} aria-expanded={why}>why $1?</button></div>
        {why && <p className="fine">No PAPER? Pay $1 a ticket in ETH or USDG instead. That $1 goes toward buying mills off the floor and burning them, which sends the PLANK inside to the Paper Mill royalty pool. Same ticket, same PLANK.</p>}
        <div className="seg" role="radiogroup" aria-label="Pay with">
          <button role="radio" aria-checked={pay === "paper"} className={pay === "paper" ? "on" : ""} onClick={() => choose("paper")}>PAPER<small>{fmtPaper(paperPerTicket)} a ticket</small></button>
          <button role="radio" aria-checked={pay === "eth"} className={pay === "eth" ? "on" : ""} disabled={!ethOn} onClick={() => choose("eth")}>ETH<small>{ethOn ? "$1 a ticket" : "paused (price feed late)"}</small></button>
          {usdgEnabled && <button role="radio" aria-checked={pay === "usdg"} className={pay === "usdg" ? "on" : ""} onClick={() => choose("usdg")}>USDG<small>$1 a ticket</small></button>}
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
          <button className="cta" disabled={locked || !canPay || overCap} onClick={() => { const f: Frozen = { n, pay, seen: seenNow(), q }; if (dollars) setConfirming(f); else void go(f); }}>
            {busy ? "Throwing…" : `Throw ${got} ${got === 1 ? "ticket" : "tickets"} in`}
          </button>
        )}
        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Confirm payment">
            <p>You're spending <b>{plankUsd > 0 ? fmtUsd(totalOf(confirming.q, confirming.pay)) : legText(confirming.q, confirming.pay)}</b>: {legText(confirming.q, confirming.pay)} and {fmtPlank(confirming.q.plank)} PLANK, for {ticketsFor(confirming.n)} {ticketsFor(confirming.n) === 1 ? "ticket" : "tickets"}{ticketsFor(confirming.n) > confirming.n ? ` (${confirming.n} + 1 free)` : ""}.{confirming.pay === "eth" ? " Up to 1% more ETH is sent in case the price ticks; the rest comes straight back." : ""} {demo ? "Play money." : "Your wallet asks you to approve it next."}</p>
            <div className="confirm-row">
              <button className="cta ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="cta" disabled={locked} onClick={() => go(confirming)}>{busy ? "Throwing…" : `Pay ${plankUsd > 0 ? fmtUsd(totalOf(confirming.q, confirming.pay)) : ""}`.trim()}</button>
            </div>
          </div>
        )}
        {deadEnd ? (
          <p className="hint">You have no PAPER, ETH is paused (price feed late){usdgEnabled ? "" : " and USDG is off"}. Swap for PAPER below, or come back when ETH reopens.</p>
        ) : hints.length > 0 && (
          <p className="hint">{hints.join(" ")} {plankShort || pay !== "paper" ? "Swap for some below." : <>Pick ETH or USDG above, swap for PAPER below, or <a href={OPENSEA} target="_blank" rel="noreferrer">get a mill</a> (it prints 1 PAPER a day).</>}</p>
        )}
        {overCap && (
          <p className="hint">{you.remainingToday === 0 ? `You've hit today's ${DAILY_CAP}. More after tonight's storm.` : n === TX_CAP && you.remainingToday >= TX_CAP ? `A buy of ${TX_CAP} gives ${ticketsFor(TX_CAP)} — pick ${TX_CAP - 1} or fewer today.` : `${you.remainingToday} left today (cap ${DAILY_CAP} a wallet).`}</p>
        )}
      </div>

      {err && <p className="hint">{err}</p>}
      <p className="fine muted">PAPER burns. Half the PLANK burns, half feeds the fire. Every ticket stays in until the fire goes out.</p>
    </aside>
  );
}
