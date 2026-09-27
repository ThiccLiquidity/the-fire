import { useEffect, useState } from "react";
import { type FireApi, type FireState, CEREMONY as C, FULL_DAYS, nameOf, phoenixHour, short } from "./data/types";
import { makeMockApi } from "./data/mock";
import { makeChainApi } from "./data/chain";
import { Scene } from "./components/Scene";
import { BuyPanel } from "./components/BuyPanel";
import { Swap } from "./components/Swap";
import { Avatar } from "./components/Avatar";
import { ProfileEditor } from "./components/ProfileEditor";

const FIRE_ADDRESS = import.meta.env.VITE_FIRE_ADDRESS as `0x${string}` | undefined;
const api: FireApi = FIRE_ADDRESS ? makeChainApi(FIRE_ADDRESS) : makeMockApi();
const LIVE = !!FIRE_ADDRESS;

function usd(plank: number, px: number) {
  const v = plank * px;
  return `$${Math.round(v).toLocaleString()}`;
}
function mPlank(p: number) { return p >= 1e12 ? `${(p / 1e12).toFixed(2)}T` : p >= 1e9 ? `${(p / 1e9).toFixed(1)}B` : `${(p / 1e6).toFixed(0)}M`; }
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

export default function App() {
  const [s, setS] = useState<FireState>(api.state());
  const [now, setNow] = useState(Date.now());
  const [demoHour, setDemoHour] = useState<number | null>(null);
  useEffect(() => api.subscribe(setS), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const msToRoll = s.nextRollAt - now;
  const hour = demoHour ?? phoenixHour(now);
  const last = s.feed[0];
  const odds = s.ticketsTotal ? (s.you.tickets / s.ticketsTotal) * 100 : 0;
  const name = (a: string) => nameOf(a, s.profiles);
  const prof = (a: string) => s.profiles[a.toLowerCase()];

  // ---- the ceremony: what the page shows in the minutes after a roll
  const st = s.storm;
  const age = st ? now - st.at : Infinity;
  const inCeremony = !!st && age < C.DONE;
  const wake = !!st && !st.survived && age < C.RELIGHT; // the old fire is still on screen
  const youWon = !!st && !st.survived && !!s.you.address && st.winner?.toLowerCase() === s.you.address.toLowerCase();
  const size = wake ? 0 : Math.min(1, s.fireSize / (s.trailingAvg * FULL_DAYS)); // 1 = a fire worth 5 days of buys

  // pot header: during the wake, keep showing the fire that died
  const potPlank = wake ? st!.potPlank ?? s.potPlank : s.potPlank;
  const fireId = wake ? st!.fireId : s.fireId;
  const potSub = wake
    ? `went out on night ${st!.night}`
    : s.night === 0 ? (st && !st.survived && age < C.DONE ? "just lit" : "lit today") : `${nights(s.night)} survived`;

  let forecast: [string, string];
  if (!inCeremony) forecast = [weather(s.threat, msToRoll / 3_600_000), `Storm rolls in ${countdown(msToRoll)} · 8:00 PM Arizona`];
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
      card = <div className="verdict out" role="alert"><b>The fire went out.</b> Fire #{st.fireId} burned for {nights(st.night)} with {(st.tickets ?? 0).toLocaleString()} tickets in it. One of them wins.</div>;
    } else if (!st.survived && age >= C.WINNER && age < C.RELIGHT) {
      const w = st.winner ?? "";
      card = (
        <div className={"winner" + (youWon ? " you" : "")} role="alert" style={{ animationDelay: "0s" }}>
          <div className="winner-kicker">{youWon ? "YOU WON" : "The winner"}</div>
          <Avatar addr={w} profile={prof(w)} size={84} />
          <div className="winner-name">{youWon ? "You" : name(w)}</div>
          {name(w) !== short(w) && <div className="winner-addr">{short(w)}</div>}
          <div className="winner-amt">{usd(st.paidPlank ?? 0, s.plankUsd)}</div>
          <div className="winner-sub">{mPlank(st.paidPlank ?? 0)} PLANK · Fire #{st.fireId} · {nights(st.night)} · {(st.tickets ?? 0).toLocaleString()} tickets</div>
          <div className="winner-foot">{Math.max(0, Math.ceil((C.RELIGHT - age) / 1000))}s until the next fire is lit</div>
        </div>
      );
    } else if (!st.survived && age >= C.RELIGHT) {
      card = <div className="verdict lit" role="alert"><b>Fire #{s.fireId} is lit.</b> {usd(s.potPlank, s.plankUsd)} carried over. The first night is always calm.</div>;
    }
  }
  const lastWinner = s.past[0];

  return (
    <div className="page">
      <Scene size={size} hour={hour} threat={s.threat} storm={s.storm} lastBuyAt={last?.at ?? 0} lastBuyBig={!!last && last.tickets >= 10} />

      <header className="top">
        <div className="brand">The Fire{!LIVE && <span className="demo-tag">demo</span>}</div>
        <div className="forecast" role="status"><span className="fc-text">{forecast[0]}</span><span className="fc-when">{forecast[1]}</span></div>
      </header>

      <div className={"pot" + (wake ? " wake" : "")}>
        <span className="pot-usd">{usd(potPlank, s.plankUsd)}</span>
        <span className="pot-sub">{mPlank(potPlank)} PLANK · Fire #{fireId} · {potSub}</span>
        {!wake && s.night === 0 && lastWinner && (
          <span className="pot-last"><Avatar addr={lastWinner.winner} profile={prof(lastWinner.winner)} size={18} /> {name(lastWinner.winner)} won {usd(lastWinner.potPlank * 0.38, s.plankUsd)} last night</span>
        )}
      </div>

      {card}

      <main className="stage">
        <div className="left">
          <div className="you">
            <div><b>{s.you.tickets.toLocaleString()}</b><span>your tickets in this fire</span></div>
            <div><b>{odds === 0 ? "0" : odds < 0.01 ? "<0.01" : odds.toFixed(2)}%</b><span>your odds if it goes out tonight</span></div>
            <div><b>{Math.round(s.fireSize).toLocaleString()}</b><span>fire size (tickets) · {s.ticketsToday.toLocaleString()} added today</span></div>
          </div>

          <div className="ticker" aria-label="Recent buys">
            {s.feed.slice(0, 8).map((b) => (
              <span key={b.id} className="tick">
                <Avatar addr={b.who} profile={prof(b.who)} size={18} /> <span className="tick-name" title={b.who}>{name(b.who)}</span> <em>{b.title}</em> {b.tickets} {b.tickets === 1 ? "ticket" : "tickets"}{b.withEth ? " (ETH)" : ""}
              </span>
            ))}
          </div>

          <div className="small-grid">
            <div className="burn">
              <h2>Gone forever</h2>
              <dl>
                <dt>{Math.round(s.burnedPaperAllTime).toLocaleString()}</dt><dd>PAPER burned</dd>
                <dt>{mPlank(s.burnedPlankAllTime)}</dt><dd>PLANK burned</dd>
                <dt>{s.millsEaten}</dt><dd>mills eaten</dd>
              </dl>
              <p className="fine">ETH from "paper from the fire" buys mills off the floor and burns them. The PLANK inside goes to every mill holder. Next mill: {s.millBidEth.toFixed(4)} ETH bid, {s.millFundEth.toFixed(4)} saved.</p>
            </div>
            <div className="archive">
              <h2>Past fires</h2>
              <ol>
                {s.past.slice(0, 5).map((f) => (
                  <li key={f.id}><span className="pf-name">Fire #{f.id}</span><span className="pf-meta"><Avatar addr={f.winner} profile={prof(f.winner)} size={16} /> <span title={f.winner}>{name(f.winner)}</span> · {nights(f.nights)} · {usd(f.potPlank * 0.38, s.plankUsd)}</span></li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="right">
          <ProfileEditor addr={s.you.address} profile={s.you.address ? prof(s.you.address) : undefined} onSave={api.setProfile} />
          <BuyPanel you={s.you} plankPerTicket={s.plankPerTicket} ethUsd={s.ethUsd} onBuy={api.buy} />
          <Swap />
        </div>
      </main>

      <footer className="foot">
        <p>Buy tickets with PAPER and PLANK. PAPER burns. Half the PLANK burns, half feeds the fire. Every night a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one ticket wins 40% of the pot; 30% burns; 30% lights the next fire.</p>
        <div className="demo-row">
          {api.demoStorm && <button className="demo" onClick={api.demoStorm}>Demo: roll tonight's storm now</button>}
          <label className="demo">Demo time of day <input type="range" min={0} max={24} step={0.25} value={demoHour ?? hour} onChange={(e) => setDemoHour(Number(e.target.value))} /> {demoHour !== null && <button onClick={() => setDemoHour(null)}>real</button>}</label>
        </div>
      </footer>
    </div>
  );
}
