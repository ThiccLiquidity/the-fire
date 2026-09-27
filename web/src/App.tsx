import { useEffect, useState } from "react";
import { type FireApi, type FireState, phoenixHour, short } from "./data/types";
import { makeMockApi } from "./data/mock";
import { FIRE_NAMES } from "./data/names";
import { Scene } from "./components/Scene";
import { BuyPanel } from "./components/BuyPanel";

const api: FireApi = makeMockApi();
const SWAP_URL = ""; // TODO: community aggregator embed URL

function usd(plank: number, px: number) {
  const v = plank * px;
  return `$${Math.round(v).toLocaleString()}`;
}
function mPlank(p: number) { return p >= 1e9 ? `${(p / 1e9).toFixed(1)}B` : `${(p / 1e6).toFixed(0)}M`; }
function countdown(ms: number) {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function nameOf(id: number) { return id ? FIRE_NAMES[id - 1] : ""; }
function weather(threat: number, hoursLeft: number) {
  if (hoursLeft > 12) return "Clear for now.";
  if (threat < 0.3) return "Light rain possible tonight.";
  if (threat < 0.6) return "Storm building for tonight.";
  if (threat < 0.85) return "Heavy storm coming tonight.";
  return "A monster is rolling in tonight.";
}

export default function App() {
  const [s, setS] = useState<FireState>(api.state());
  const [now, setNow] = useState(Date.now());
  const [demoHour, setDemoHour] = useState<number | null>(null);
  useEffect(() => api.subscribe(setS), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const msToRoll = s.nextRollAt - now;
  const hour = demoHour ?? phoenixHour(now);
  const expected = 520 * ((s.night + 1) / 8); // rough "normal" size for the visual only
  const size = s.ticketsToday / expected;
  const dead = !!s.storm && !s.storm.survived && now - s.storm.at < 11_000;
  const showVerdict = !!s.storm && now - s.storm.at < 11_000 && now - s.storm.at > 3_500;
  const odds = s.ticketsTotal ? (s.you.tickets / s.ticketsTotal) * 100 : 0;

  return (
    <div className="page">
      <Scene size={size} hour={hour} threat={s.threat} storm={s.storm} recent={s.feed} dead={dead} />

      <header className="top">
        <div className="brand">The Fire</div>
        <div className="forecast" role="status">
          {s.storm && now - s.storm.at < 11_000
            ? <><span className="fc-text">{s.storm.survived ? "Storm passing." : "It's raining."}</span><span className="fc-when">Night {s.night}</span></>
            : <><span className="fc-text">{weather(s.threat, msToRoll / 3_600_000)}</span><span className="fc-when">Storm rolls in {countdown(msToRoll)} · 8:00 PM Arizona</span></>}
        </div>
      </header>

      <div className="pot">
        <span className="pot-usd">{usd(s.potPlank, s.plankUsd)}</span>
        <span className="pot-sub">{mPlank(s.potPlank)} PLANK · Fire #{s.fireId}{s.nameId ? ` "${nameOf(s.nameId)}"` : ""} · {s.night === 0 ? "lit today" : `${s.night} ${s.night === 1 ? "night" : "nights"} survived`}</span>
      </div>

      {showVerdict && s.storm && (
        <div className={"verdict " + (s.storm.survived ? "ok" : "out")} role="alert">
          {s.storm.survived
            ? <><b>The fire survived.</b> Night {s.night}. The clouds rolled by.</>
            : <><b>The fire went out.</b> {s.storm.winner === "0xYOU0000000000000000000000000000000000d00d" ? "You won" : `${short(s.storm.winner ?? "")} won`} {usd(s.storm.paidPlank ?? 0, s.plankUsd)}. Fire #{s.fireId} is lit.</>}
        </div>
      )}

      {s.you.isWinner && (
        <div className="namer">
          <b>You won. Name the fire your win lit:</b>
          <div className="name-grid">
            {FIRE_NAMES.map((nm, i) => <button key={nm} onClick={() => api.nameFire(i + 1)}>{nm}</button>)}
          </div>
        </div>
      )}

      <main className="stage">
        <div className="left">
          <div className="you">
            <div><b>{s.you.tickets.toLocaleString()}</b><span>your tickets in this fire</span></div>
            <div><b>{odds === 0 ? "0" : odds < 0.01 ? "<0.01" : odds.toFixed(2)}%</b><span>your odds if it goes out tonight</span></div>
            <div><b>{s.ticketsToday.toLocaleString()}</b><span>tickets on the fire today</span></div>
          </div>

          <div className="ticker" aria-label="Recent buys">
            {s.feed.slice(0, 8).map((b) => (
              <span key={b.id} className="tick">
                {b.stoke ? "🔥" : b.tickets >= 100 ? "🪵" : "📄"} {short(b.who)} <em>{b.title}</em> {b.stoke ? "burned PLANK for nothing" : `${b.tickets} ${b.tickets === 1 ? "ticket" : "tickets"}`}{b.withEth ? " (ETH)" : ""}
              </span>
            ))}
          </div>

          <div className="swap">
            <h2>Need PAPER or PLANK?</h2>
            {SWAP_URL
              ? <iframe title="Swap" src={SWAP_URL} />
              : <p className="fine">Swap widget goes here (community aggregator). Until then: PLANK and PAPER trade on the chain's DEX.</p>}
          </div>

          <div className="small-grid">
            <div className="burn">
              <h2>Gone forever</h2>
              <dl>
                <dt>{s.burnedPaperAllTime.toLocaleString()}</dt><dd>PAPER burned</dd>
                <dt>{mPlank(s.burnedPlankAllTime)}</dt><dd>PLANK burned</dd>
                <dt>{s.millsEaten}</dt><dd>mills eaten</dd>
              </dl>
              <p className="fine">ETH from "paper from the fire" buys mills off the floor and burns them. The PLANK inside goes to every mill holder. Next mill: {s.millBidEth.toFixed(4)} ETH bid, {s.millFundEth.toFixed(4)} saved.</p>
            </div>
            <div className="archive">
              <h2>Past fires</h2>
              <ol>
                {s.past.slice(0, 5).map((f) => (
                  <li key={f.id}><span className="pf-name">#{f.id} {nameOf(f.nameId) || "unnamed"}</span><span className="pf-meta">{f.nights} nights · {usd(f.potPlank, s.plankUsd)} · {short(f.winner)}</span></li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <BuyPanel you={s.you} plankPerTicket={s.plankPerTicket} plankUsd={s.plankUsd} ethUsd={s.ethUsd} onBuy={api.buy} onStoke={api.stoke} />
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
