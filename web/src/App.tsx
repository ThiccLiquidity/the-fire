import { useEffect, useState } from "react";
import { type FireApi, type FireState, CEREMONY as C, FULL_DAYS, nameOf, phoenixHour, prizeOf, short } from "./data/types";
import { friendly } from "./data/wallet";
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
function countdown(ms: number) {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function weather(threat: number, hoursLeft: number) {
  if (hoursLeft > 12) return "Clear for now.";
  if (threat < 0.3) return "Light rain possible tonight.";
  if (threat < 0.6) return "Storm building for tonight.";
  if (threat < 0.85) return "Heavy storm coming tonight.";
  return "A monster is rolling in tonight.";
}
const nights = (n: number) => `${n} ${n === 1 ? "night" : "nights"}`;
const NOBODY = /^0x0{40}$/i; // a fire that went out with no tickets has no winner

export default function App() {
  const [s, setS] = useState<FireState>(api.state());
  const [now, setNow] = useState(Date.now());
  const [demoHour, setDemoHour] = useState<number | null>(null);
  const [press2, setPress2] = useState(false);
  const [how, setHow] = useState(false);
  // Sound is on unless the visitor turned it off (remembered per browser). Browsers still wait for a first click.
  const [sound, setSound] = useState(() => { try { return localStorage.getItem("the-fire-sound") !== "off"; } catch { return true; } });
  const toggleSound = () => setSound((v) => { try { localStorage.setItem("the-fire-sound", v ? "off" : "on"); } catch { /* private mode */ } return !v; });
  useEffect(() => api.subscribe(setS), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const msToRoll = s.nextRollAt - now;
  const hour = demoHour ?? phoenixHour(now);
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
  const toSize = (fs: number) => Math.min(1, fs / (s.trailingAvg * FULL_DAYS)); // 1 = a fire worth 2.5 days of buys
  const size = b && age < C.RAIN ? toSize(b.fireSize) : wake ? 0 : toSize(s.fireSize);

  // pot header: during the wake, keep showing the fire that died
  const potPlank = wake ? st!.potPlank ?? v.potPlank : v.potPlank;
  const fireId = wake ? st!.fireId : v.fireId;
  const potSub = s.abandoned ? "the game has ended"
    : wake ? `went out on night ${st!.night}${st!.tickets ? ` · ${fmtCount(st!.tickets)} logs` : ""}`
    : v.night === 0 ? (st && !st.survived && age < C.DONE ? "just lit" : "lit today") : `${nights(v.night)} survived`;

  let forecast: [string, string];
  if (s.abandoned) forecast = ["The game has ended.", "No more storms"];
  else if (!inCeremony && s.rollPending) forecast = ["The storm is on its way.", `Night ${s.night + 1} · buying reopens when it lands`];
  else if (!inCeremony && s.night + 1 >= 24) forecast = ["Tonight's storm can't be survived — last night to get in.", `Storm rolls in ${countdown(msToRoll)} · 8:00 PM MST`];
  else if (!inCeremony) forecast = [weather(s.threat, msToRoll / 3_600_000), `Storm rolls in ${countdown(msToRoll)} · 8:00 PM MST`];
  else if (age < C.IN) forecast = ["Storm rolling in.", `Night ${st!.night}`];
  else if (age < C.STRIKE) forecast = ["It's here.", `Night ${st!.night}`];
  else if (age < C.RAIN) forecast = [st!.survived ? "Pouring." : "Pouring. The fire is losing.", `Night ${st!.night}`];
  else if (st!.survived) forecast = ["Storm passing.", `Night ${st!.night}`];
  else if (age < C.RELIGHT) forecast = ["Ashes.", `Fire #${st!.fireId} is out`];
  else forecast = ["Clearing.", `Fire #${s.fireId}`];

  let card: React.ReactNode = null;
  if (st && inCeremony) {
    if (st.survived && age >= C.VERDICT && age < C.VERDICT_END) {
      card = <div className="verdict ok" role="alert"><b>The fire survived night {st.night}.</b> The storm took {Math.min(99, Math.round(st.strength / Math.max(1, st.size) * 100))}% of it.</div>;
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
          <div className="winner-sub"><PlankIcon />{mPlank(st.paidPlank ?? 0)} PLANK · Fire #{st.fireId} · {nights(st.night)} · {fmtCount(st.tickets ?? 0)} logs</div>
          <div className="winner-foot">{Math.max(0, Math.ceil((C.RELIGHT - age) / 1000))}s until the next fire is lit</div>
        </div>
      );
    } else if (!st.survived && age >= C.RELIGHT) {
      card = <div className="verdict lit" role="alert"><b>Fire #{s.fireId} is lit.</b> {usd(s.potPlank, s.plankUsd)} carried over. The first night is always calm.</div>;
    }
  }
  const lastWinner = s.past[0];
  const [rolling, setRolling] = useState(false);
  const [rollErr, setRollErr] = useState("");
  async function rollStorm() {
    setRolling(true); setRollErr("");
    try { await api.rollStorm!(); } catch (e) { setRollErr(friendly(e)); } finally { setRolling(false); }
  }
  const rollLabel = s.rollAction === "settle" || s.rollAction === "deliver" ? "Bring in tonight's storm" : s.rollAction === "reroll" ? "The storm is late. Roll it again" : "Roll the storm";
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
      <div className="hero">
      <Scene size={size} hour={hour} threat={s.threat} storm={s.storm} lastBuyAt={last?.at ?? 0} lastBuyBig={!!last && last.tickets >= 10} wild press2={press2} sound={sound} />

      <div className="hud">
      <header className="top">
        <div className="brand">The Fire{!LIVE && <span className="demo-tag">demo</span>}<button className="how-link" onClick={() => setHow(true)}>How it works</button>
          <button className="how-link sound-btn" onClick={toggleSound} aria-pressed={sound} title={sound ? "Sound on: the forest, the fire and the storm. Click to mute." : "Sound off. Click for the forest, the fire and the storm."}>{sound ? "🔊" : "🔇"}<span className="sound-label">{sound ? " Sound" : " Muted"}</span></button></div>
        <div className="top-right">
        <WalletChip address={s.you.address} profile={s.you.address ? prof(s.you.address) : undefined} onConnect={api.connect} onSwitch={api.switchWallet} onDisconnect={api.disconnect} demo={!LIVE} />
        <div className="forecast" role="status"><span className="fc-text">{forecast[0]}</span><span className="fc-when">{forecast[1]}</span>
          {api.rollStorm && s.rollAction && !inCeremony && <button className="roll-btn" disabled={rolling} onClick={rollStorm}>{rolling ? "Rolling…" : rollLabel}</button>}
          {rollErr && <span className="fc-when">{rollErr}</span>}
        </div>
        </div>
      </header>

      <div className={"pot" + (wake ? " wake" : "")}>
        <span className="pot-row"><PlankIcon big /><span className="pot-usd">{usd(potPlank, s.plankUsd)}</span></span>
        {!wake && !s.abandoned && (() => { const prize = prizeOf(potPlank, s.potCarriedIn, v.ticketsTotal), full = potPlank * 0.4; return v.ticketsTotal === 0 ? <span className="pot-take">first ticket in starts the prize</span> : <span className="pot-take">winner takes <b>{usd(prize, s.plankUsd)}</b>{prize < full * 0.999 && <small className="pot-grow"> · grows with this fire, up to {usd(full, s.plankUsd)}</small>}</span>; })()}
        <span className="pot-sub"><PlankIcon />{mPlank(potPlank)} PLANK · Fire #{fireId} · {potSub}</span>
        {!wake && v.night === 0 && !b && lastWinner && !NOBODY.test(lastWinner.winner) && (
          <span className="pot-last"><Avatar addr={lastWinner.winner} profile={prof(lastWinner.winner)} size={18} /> {name(lastWinner.winner)} won {usd(lastWinner.potPlank * 0.4, s.plankUsd)} last night</span>
        )}
      </div>
      </div>

      {card}
      </div>
      {how && <HowItWorks onClose={() => setHow(false)} />}

      <main className="stage">
        <div className="left">
          <div className="you">
            <div><b>{connected ? fmtCount(v.youTickets) : "—"}</b><span>{connected ? "your logs in this fire" : "connect to see your logs"}</span></div>
            <div><b>{connected ? `${odds === 0 ? "0" : odds < 0.01 ? "<0.01" : odds.toFixed(2)}%` : "—"}</b><span>your odds if it goes out tonight</span></div>
            <div title="Fire size is what keeps the fire alive: every log adds 1, storms knock it down, and it burns down to 85% each night. Your logs never leave the draw."><b>{fmtCount(Math.round(v.fireSize))}</b><span>fire size · {fmtCount(v.ticketsToday)} added today</span><span className="you-fine">burns down each night; tickets don't</span></div>
          </div>

          <div className="ticker" aria-label="Recent buys">
            {s.feed.slice(0, 8).map((f) => f.kind === "mill" ? (
              <span key={f.id} className="tick">🔥 The fire bought a press off the floor and burned it</span>
            ) : (
              <span key={f.id} className="tick">
                <Avatar addr={f.who} profile={prof(f.who)} size={18} /> <span className="tick-name" title={f.who}>{name(f.who)}</span> <em>{f.title}</em> {f.tickets} {f.tickets === 1 ? "log" : "logs"}{f.fromFire ? " · paid in dollars" : ""}
              </span>
            ))}
          </div>

          <div className="small-grid">
            <div className="burn">
              {LIVE ? (
                <>
                  <h2>So far</h2>
                  <dl>
                    <dt>{fmtCount(v.ticketsTotal)}</dt><dd>tickets in this fire</dd>
                    <dt>{fmtCount(Math.max(0, v.fireId - 1))}</dt><dd>fires gone out</dd>
                  </dl>
                </>
              ) : (
                <>
                  <h2>Gone forever</h2>
                  <dl>
                    <dt>{fmtCount(s.burnedPaperAllTime)}</dt><dd>PAPER burned</dd>
                    <dt>{mPlank(s.burnedPlankAllTime)}</dt><dd>PLANK burned</dd>
                    <dt>{fmtCount(s.millsEaten)}</dt><dd>presses eaten</dd>
                  </dl>
                </>
              )}
              <p className="fine">Every $1 paid in ETH or USDG goes toward buying presses off the floor and burning them. The PLANK inside goes to the Paper Press royalty pool. Next press: the fire bids ${fmtCount(s.millBidUsd)}, and has {fmtAmt(s.millFundEth)} ETH{s.usdgEnabled ? ` + $${fmtCount(s.millFundUsdg)} USDG` : ""} saved.</p>
            </div>
            <div className="archive">
              <h2>Past fires</h2>
              <ol>
                {s.past.slice(0, 5).map((f) => (
                  <li key={f.id}><span className="pf-name">Fire #{f.id}</span><span className="pf-meta">{NOBODY.test(f.winner) ? <>no logs · {nights(f.nights)} · pot carried</> : <><Avatar addr={f.winner} profile={prof(f.winner)} size={16} /> <span title={f.winner}>{name(f.winner)}</span> won {usd(f.prizePlank ?? f.potPlank * 0.4, s.plankUsd)} · {nights(f.nights)}</>}</span></li>
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
          <BuyPanel you={shownYou} plankPerTicket={s.plankPerTicket} paperPerTicket={s.paperPerTicket} paperUsd={s.paperUsd} plankUsd={s.plankUsd} ethUsd={s.ethUsd} onBuy={api.buy} onConnect={api.connect} paused={s.rollPending} usdgEnabled={s.usdgEnabled}
            raw={s.raw} abandoned={s.abandoned} night={v.night} hold={b ? "The storm is here. Buying reopens once it passes." : undefined} demo={!LIVE} />
          <Swap demo={api.demo} s={s} />
        </div>
      </main>

      <footer className="foot">
        <p><button className="how-link inline" onClick={() => setHow(true)}>How the fire works</button> · Throw logs on the fire with PAPER and PLANK; every log is a ticket to win. PAPER burns. All the PLANK goes into the fire's pot. Every night at 8 PM MST a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one log wins 40% of the pot; 25% burns; 5% goes to the Paper Press royalty pool; 30% lights the next fire.</p>
        {api.demo && <Playground s={s} d={api.demo} hour={demoHour} onHour={setDemoHour} onSceneOpt={(k, on) => { if (k === "press2") setPress2(on); }} />}
      </footer>
    </div>
  );
}
