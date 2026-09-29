import { useEffect, useRef, useState } from "react";
import { type FireApi, type FireState, CEREMONY as C, KEEP, fireLook, localClock, localHour, nameOf, prizeOf, short } from "./data/types";
import { friendly, TESTNET } from "./data/wallet";
import { TestnetFaucet } from "./components/TestnetFaucet";
import { fmtAmt, fmtCount, fmtPlank, usdOf } from "./format";
import { makeMockApi } from "./data/mock";
import { makeChainApi } from "./data/chain";
import { Scene } from "./components/Scene";
import { Playground } from "./components/Playground";
import { WalletChip } from "./components/WalletChip";
import { PlankIcon } from "./components/PlankIcon";
import { HowItWorks } from "./components/HowItWorks";
import { BuyPanel } from "./components/BuyPanel";
import { Swap } from "./components/Swap";
import { Avatar } from "./components/Avatar";
import { ProfileEditor } from "./components/ProfileEditor";

const FIRE_ADDRESS = import.meta.env.VITE_FIRE_ADDRESS as `0x${string}` | undefined;
const api: FireApi = FIRE_ADDRESS ? makeChainApi(FIRE_ADDRESS) : makeMockApi();
const LIVE = !!FIRE_ADDRESS;
if (!LIVE) (window as unknown as { __fire?: FireApi }).__fire = api; // demo: lets the playground/tests poke the mock

const usd = usdOf; // "$—" when there's no PLANK price yet: say so rather than guess
const mPlank = fmtPlank;
/** time to the storm, to the second: "6:54:58" */
function hms(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
/** the Playground's time-of-day slider as a clock: "7:05 PM" */
function hourClock(hour: number) {
  const d = new Date(); d.setHours(Math.floor(hour) % 24, Math.floor((hour % 1) * 60), 0, 0);
  return localClock(d.getTime());
}
function weather(threat: number, hoursLeft: number) {
  if (hoursLeft > 12) return "Clear for now.";
  if (threat < 0.3) return "Light rain possible.";
  if (threat < 0.6) return "Storm building.";
  if (threat < 0.85) return "Heavy storm coming.";
  return "A monster is rolling in.";
}
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const logs = (n: number) => `${fmtCount(n)} ${Math.round(n) === 1 ? "log" : "logs"}`;
const NOBODY = /^0x0{40}$/i; // a fire that went out with no tickets has no winner

export default function App() {
  const [s, setS] = useState<FireState>(api.state());
  const [now, setNow] = useState(Date.now());
  const [demoHour, setDemoHour] = useState<number | null>(null);
  const [how, setHow] = useState(false);
  // Sound is on unless the visitor turned it off (remembered per browser). Browsers still wait for a first click.
  const [sound, setSound] = useState(() => { try { return localStorage.getItem("the-fire-sound") !== "off"; } catch { return true; } });
  const toggleSound = () => setSound((v) => { try { localStorage.setItem("the-fire-sound", v ? "off" : "on"); } catch { /* private mode */ } return !v; });
  useEffect(() => api.subscribe(setS), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const msToRoll = s.nextRollAt - now;
  const hour = demoHour ?? localHour(now);
  const last = s.feed[0];
  const name = (a: string) => nameOf(a, s.profiles);
  const prof = (a: string) => s.profiles[a.toLowerCase()];
  const connected = !!s.you.address;

  // ---- the ceremony: what the page shows in the minutes after a roll
  const st = s.storm;
  const age = st ? now - st.at : Infinity;
  const inCeremony = !!st && age < C.DONE;
  // No spoilers: until the ceremony reveals the result, the page keeps showing the numbers from before the roll.
  const revealAt = st ? (st.survived ? C.VERDICT : C.RELIGHT) : 0;
  const b = inCeremony && age < revealAt ? st!.before : undefined;
  const v = b
    ? { fireId: b.fireId, night: b.night, potPlank: b.potPlank, fireSize: b.fireSize, ticketsTotal: b.ticketsTotal, ticketsToday: b.ticketsToday, youTickets: b.youTickets }
    : { fireId: s.fireId, night: s.night, potPlank: s.potPlank, fireSize: s.fireSize, ticketsTotal: s.ticketsTotal, ticketsToday: s.ticketsToday, youTickets: s.you.tickets };
  const shownYou = b && connected ? { ...s.you, tickets: b.youTickets, plank: b.youPlank } : s.you;
  const odds = v.ticketsTotal ? (v.youTickets / v.ticketsTotal) * 100 : 0;
  const wake = !!st && !st.survived && age >= C.OUT_CARD && age < C.RELIGHT; // the fire is out; its pot stays on screen
  const youWon = !!st && !st.survived && connected && st.winner?.toLowerCase() === s.you.address!.toLowerCase();
  // the fire is drawn for its size in logs: the same count always looks the same (fireLook)
  const size = b && age < C.RAIN ? fireLook(b.fireSize) : wake ? 0 : fireLook(s.fireSize);
  // the fire that went out, its winner and its burn stay off the lower panels until the winner card shows
  const hideOut = inCeremony && !st!.survived && age < C.WINNER;
  const past = hideOut ? s.past.filter((f) => f.id !== st!.fireId) : s.past;
  const pre = hideOut ? st!.before : undefined;
  const burnedPaper = pre?.burnedPaperAllTime ?? s.burnedPaperAllTime, burnedPlank = pre?.burnedPlankAllTime ?? s.burnedPlankAllTime;
  const lastPrize = (f: { potPlank: number; prizePlank?: number }) => f.prizePlank ?? f.potPlank * 0.4; // the prize paid (capped), not 40% of the pot

  // pot header: during the wake, keep showing the fire that died
  const potPlank = wake ? st!.potPlank ?? v.potPlank : v.potPlank;
  const fireId = wake ? st!.fireId : v.fireId;
  const potSub = s.abandoned ? "the game has ended"
    : wake ? `went out on day ${st!.night}${st!.tickets ? ` · ${logs(st!.tickets)}` : ""}`
    : v.night === 0 ? (st && !st.survived && age < C.DONE ? "just lit" : "lit today") : `${days(v.night)} survived`;

  // The clock line: the player's own time and the countdown to the storm (21:00 UTC, the same moment for everyone), or
  // what the storm is doing; under it the forecast with the storm's time on their clock. Orange in the last 10 minutes.
  const clock = demoHour === null ? localClock(now) : hourClock(hour);
  let timer: string, forecast: string;
  const tonight = (w: string) => `${w.replace(/\.$/, "")} · storm at ${localClock(s.nextRollAt)}`;
  if (s.abandoned) { timer = "The game has ended."; forecast = "No more storms"; }
  else if (!inCeremony && s.rollPending) { timer = "The storm is on its way."; forecast = `Day ${s.night + 1} · buying reopens when it lands`; }
  else if (!inCeremony) { timer = msToRoll > 0 ? `storm in ${hms(msToRoll)}` : "the storm is due"; forecast = s.night + 1 >= 24 ? "The next storm can't be survived: last day to get in" : tonight(weather(s.threat, msToRoll / 3_600_000)); }
  else if (age < C.IN) { timer = "Storm rolling in."; forecast = `Day ${st!.night} · buying reopens when it passes`; }
  else if (age < C.STRIKE) { timer = "It's here."; forecast = `Day ${st!.night}`; }
  else if (age < C.RAIN) { timer = st!.survived ? "Pouring." : "Pouring. The fire is losing."; forecast = `Day ${st!.night}`; }
  else if (st!.survived) { timer = "Storm passing."; forecast = `Day ${st!.night}`; }
  else if (age < C.RELIGHT) { timer = "Ashes."; forecast = `Fire #${st!.fireId} is out`; }
  else { timer = "Clearing."; forecast = `Fire #${s.fireId}`; }
  const hot = !s.abandoned && (inCeremony || s.rollPending || msToRoll < 10 * 60_000);
  const heroRef = useRef<HTMLDivElement>(null);

  let card: React.ReactNode = null;
  if (st && inCeremony) {
    if (st.survived && age >= C.VERDICT && age < C.VERDICT_END) {
      // the storm's bite, then the nightly burn-down to 85%: the same drop the fire-size tile shows
      card = <div className="verdict ok" role="alert"><b>The fire survived day {st.night}.</b> The storm took {logs(Math.min(st.strength, st.size))}, and overnight it burned down to {fmtCount(Math.max(0, (st.size - st.strength) * KEEP))}.</div>;
    } else if (!st.survived && age >= C.OUT_CARD && age < C.WINNER) {
      card = null; // the tickets rise out of the embers in the scene; the winner card follows
    } else if (!st.survived && age >= C.WINNER && age < C.RELIGHT && NOBODY.test(st.winner ?? "")) {
      card = <div className="verdict out" role="alert"><b>Nobody threw a log on fire #{st.fireId}.</b> The whole pot carries to the next fire.</div>;
    } else if (!st.survived && age >= C.WINNER && age < C.RELIGHT) {
      const w = st.winner ?? "";
      card = (
        <div className={"winner" + (youWon ? " mine" : "")} role="alert" style={{ animationDelay: "0s" }}>
          <div className="winner-kicker">{youWon ? "YOU WON" : "The winner"}</div>
          <Avatar addr={w} profile={prof(w)} size={84} />
          <div className="winner-name">{youWon ? "You" : name(w)}</div>
          {name(w) !== short(w) && <div className="winner-addr">{short(w)}</div>}
          <div className="winner-amt"><PlankIcon big />{usd(st.paidPlank ?? 0, s.plankUsd)}</div>
          {st.prizeOwed && <div className="winner-sub"><b>Prize waiting to be claimed</b></div>}
          <div className="winner-sub"><PlankIcon />{mPlank(st.paidPlank ?? 0)} PLANK · Fire #{st.fireId} · {days(st.night)} · {logs(st.tickets ?? 0)}</div>
          <div className="winner-foot">{Math.max(0, Math.ceil((C.RELIGHT - age) / 1000))}s until the next fire is lit</div>
        </div>
      );
    } else if (!st.survived && age >= C.RELIGHT) {
      card = <div className="verdict lit" role="alert"><b>Fire #{s.fireId} is lit.</b> {usd(s.potPlank, s.plankUsd)} carried over.</div>;
    }
  }
  const lastWinner = past[0];
  const [rolling, setRolling] = useState(false);
  const [rollErr, setRollErr] = useState("");
  async function rollStorm() {
    setRolling(true); setRollErr("");
    try { await api.rollStorm!(); } catch (e) { setRollErr(friendly(e)); } finally { setRolling(false); }
  }
  const rollLabel = s.rollAction === "settle" || s.rollAction === "deliver" ? "Bring in the storm" : s.rollAction === "reroll" ? "The storm is late. Roll it again" : "Roll the storm";
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");
  async function take(f?: () => Promise<void>) {
    if (!f) return;
    setClaimBusy(true); setClaimMsg("");
    try { await f(); } catch (e) { setClaimMsg(friendly(e)); } finally { setClaimBusy(false); }
  }
  const prize = s.you.prize ?? 0, refund = s.you.refund ?? 0;

  return (
    <div className="page">
      {!LIVE && <div className="demo-banner" role="note"><b>Demo</b> — play money. Nothing here touches a real wallet.</div>}
      {LIVE && TESTNET && <TestnetFaucet s={s} />}
      <div className="hero" ref={heroRef}>
      <Scene size={size} hour={hour} threat={s.threat} stormIn={msToRoll / 3_600_000} storm={s.storm} lastBuyAt={last?.at ?? 0} lastBuyBig={!!last && last.tickets >= 10} sound={sound}
        onView={(vw) => { const el = heroRef.current; if (el) { el.style.setProperty("--fire-x", `${vw.fireX}px`); el.style.setProperty("--scene-w", `${vw.width}px`); } }} />

      <div className="hud">
      <header className="top">
        <div className="brand"><span className="brand-name">The Fire</span>{!LIVE && <span className="demo-tag">demo</span>}
          <button className="chip how-chip" onClick={() => setHow(true)} aria-label="How it works"><span className="how-long">How it works</span><span className="how-short" aria-hidden="true">?</span></button></div>
        <div className="top-right">
          <div className="clock">
            <span className="clock-line"><span className="clock-now">{clock}</span> <span className={"clock-timer" + (hot ? " hot" : "")}>· {timer}</span></span>
            <span className="clock-sub" role="status">{forecast}</span>
            {api.rollStorm && s.rollAction && !inCeremony && <button className="roll-btn" disabled={rolling} onClick={rollStorm}>{rolling ? "Rolling…" : rollLabel}</button>}
            {rollErr && <span className="clock-sub">{rollErr}</span>}
          </div>
          <button className="chip sound-btn" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? "Sound on" : "Sound off"} title={sound ? "Sound on: the forest, the fire and the storm. Click to mute." : "Sound off. Click for the forest, the fire and the storm."}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" />{sound ? <><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></> : <path d="M17 9l5 6M22 9l-5 6" />}</svg></button>
          <WalletChip address={s.you.address} profile={s.you.address ? prof(s.you.address) : undefined} onConnect={api.connect} onSwitch={api.switchWallet} onDisconnect={api.disconnect} demo={!LIVE} />
        </div>
      </header>

      <div className={"pot" + (wake ? " wake" : "")}>
        <span className="pot-row"><span className="pot-usd"><PlankIcon big />{usd(potPlank, s.plankUsd)}</span></span>
        {!wake && !s.abandoned && (() => { const prize = prizeOf(potPlank, b?.potCarriedIn ?? s.potCarriedIn, v.ticketsTotal), full = potPlank * 0.4; return v.ticketsTotal === 0 ? <span className="pot-take">first ticket in starts the prize</span> : <span className="pot-take">winner takes <b>{usd(prize, s.plankUsd)}</b>{prize < full * 0.999 && <small className="pot-grow"> · grows with this fire, up to {usd(full, s.plankUsd)}</small>}</span>; })()}
        <span className="pot-sub"><PlankIcon />{mPlank(potPlank)} PLANK · Fire #{fireId} · {potSub}</span>
        {!wake && v.night === 0 && !b && lastWinner && !NOBODY.test(lastWinner.winner) && (
          <span className="pot-last"><Avatar addr={lastWinner.winner} profile={prof(lastWinner.winner)} size={18} /> {name(lastWinner.winner)} won {usd(lastPrize(lastWinner), s.plankUsd)} last fire</span>
        )}
      </div>
      </div>

      {card}
      </div>
      {/* phone: what floats over the scene on a big screen sits in a strip under it, so the scene stays clear */}
      <div className="strip">
        <span role="status">{forecast}</span>
        <span className="strip-sub">{mPlank(potPlank)} PLANK · Fire #{fireId} · {potSub}</span>
        {!wake && v.night === 0 && !b && lastWinner && !NOBODY.test(lastWinner.winner) && <span className="strip-last">{name(lastWinner.winner)} won {usd(lastPrize(lastWinner), s.plankUsd)} last fire</span>}
      </div>
      {how && <HowItWorks onClose={() => setHow(false)} />}

      <main className="stage">
        <div className="left">
          <div className="you">
            <div><b>{connected ? fmtCount(v.youTickets) : "—"}</b><span>{connected ? "your logs in this fire" : "connect to see your logs"}</span></div>
            <div><b>{connected ? `${odds === 0 ? "0" : odds < 0.01 ? "<0.01" : odds.toFixed(2)}%` : "—"}</b><span>your odds if it goes out next storm</span></div>
            <div title="Fire size is what keeps the fire alive: every log adds 1, storms knock it down, and it burns down to 85% each day. Your logs never leave the draw."><b>{fmtCount(Math.round(v.fireSize))}</b><span>fire size · {fmtCount(v.ticketsToday)} added today</span><span className="you-fine">burns down each night; tickets don't</span></div>
          </div>

          <div className="ticker" aria-label="Recent buys">
            {s.feed.slice(0, 8).map((f) => f.kind === "mill" ? (
              <span key={f.id} className="tick">🔥 The fire bought a press off the floor and burned it</span>
            ) : (
              <span key={f.id} className="tick">
                <Avatar addr={f.who} profile={prof(f.who)} size={18} /> <span className="tick-name" title={f.who}>{name(f.who)}</span> <em>{f.title}</em> {f.tickets} {f.tickets === 1 ? "log" : "logs"}{f.fromFire ? " · paid in dollars" : ""}{f.note?.trim() && <q className="tick-note">{f.note.trim().slice(0, 32)}</q>}
              </span>
            ))}
          </div>

          <div className="small-grid">
            <div className="burn">
              <h2>Gone forever</h2>
              <dl>
                <dt>{fmtCount(burnedPaper)}</dt><dd>PAPER burned</dd>
                <dt>{mPlank(burnedPlank)}</dt><dd>PLANK burned</dd>
                <dt>{fmtCount(s.millsEaten)}</dt><dd>presses eaten</dd>
              </dl>
              {s.historyLoading && <p className="fine">Still counting from the first fire…</p>}
              <p className="fine">Every $1 paid in ETH or USDG goes toward buying presses off the floor and burning them. The PLANK inside goes to the Paper Press royalty pool. Next press: the fire bids ${fmtCount(s.millBidUsd)}, and has {fmtAmt(s.millFundEth)} ETH{s.usdgEnabled ? ` + $${fmtCount(s.millFundUsdg)} USDG` : ""} saved.</p>
            </div>
            <div className="archive">
              <h2>Past fires</h2>
              <ol>
                {past.slice(0, 5).map((f) => (
                  <li key={f.id}><span className="pf-name">Fire #{f.id}</span><span className="pf-meta">{NOBODY.test(f.winner) ? <>no logs · {days(f.nights)} · pot carried</> : <><Avatar addr={f.winner} profile={prof(f.winner)} size={16} /> <span title={f.winner}>{name(f.winner)}</span> won {usd(lastPrize(f), s.plankUsd)} · {days(f.nights)}</>}</span></li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="right">
          {connected && (prize > 0 || (s.abandoned && refund > 0)) && (
            <div className="claim" role="region" aria-label="Claim">
              {prize > 0 && <>
                <p><b>You have a prize waiting:</b> {usd(prize, s.plankUsd)} (<PlankIcon />{mPlank(prize)} PLANK). It couldn't be sent when the fire went out, so it's held for you.</p>
                <button className="cta" disabled={claimBusy} onClick={() => take(api.claim)}>{claimBusy ? "Claiming…" : "Claim your prize"}</button>
              </>}
              {s.abandoned && refund > 0 && <>
                <p><b>The game has ended.</b> Your share of the last fire's pot: {usd(refund, s.plankUsd)} (<PlankIcon />{mPlank(refund)} PLANK).</p>
                <button className="cta" disabled={claimBusy} onClick={() => take(api.refund)}>{claimBusy ? "Claiming…" : "Claim your refund"}</button>
              </>}
              {claimMsg && <p className="hint">{claimMsg}</p>}
            </div>
          )}
          {connected && <ProfileEditor key={s.you.address} addr={s.you.address} profile={prof(s.you.address!)} onSave={api.setProfile} demo={!LIVE} />}
          <BuyPanel key={`buy-${s.you.address ?? ""}`} you={shownYou} plankPerTicket={s.plankPerTicket} paperPerTicket={s.paperPerTicket} paperUsd={s.paperUsd} plankUsd={s.plankUsd} ethUsd={s.ethUsd} onBuy={api.buy} onConnect={api.connect} paused={s.rollPending} usdgEnabled={s.usdgEnabled}
            raw={s.raw} abandoned={s.abandoned} night={v.night} hold={b ? "The storm is here. Buying reopens once it passes." : undefined} demo={!LIVE} />
          {!(LIVE && TESTNET) && <Swap demo={api.demo} s={s} />}
        </div>
      </main>

      <footer className="foot">
        <p><button className="how-link inline" onClick={() => setHow(true)}>How the fire works</button> · Throw logs on the fire with PAPER and PLANK; every log is a ticket to win. PAPER burns. All the PLANK goes into the fire's pot. Every day at 21:00 UTC ({localClock(s.nextRollAt)} your time) a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one log wins 40% of the pot; 25% burns; 5% goes to the Paper Press royalty pool; 30% lights the next fire.</p>
        {api.demo && <Playground s={s} d={api.demo} hour={demoHour} onHour={setDemoHour} />}
      </footer>
    </div>
  );
}
