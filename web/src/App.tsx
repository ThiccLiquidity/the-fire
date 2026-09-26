import { useEffect, useState } from "react";
import { type FireApi, type FireState, short } from "./data/types";
import { makeMockApi } from "./data/mock";
import { Fire } from "./components/Fire";
import { Sky } from "./components/Sky";
import { BuyPanel } from "./components/BuyPanel";

const api: FireApi = makeMockApi();

function usd(plank: number, px: number) {
  const v = plank * px;
  return v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(0)}`;
}
function mPlank(p: number) {
  return p >= 1e9 ? `${(p / 1e9).toFixed(1)}B` : `${(p / 1e6).toFixed(0)}M`;
}
function countdown(ms: number) {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export default function App() {
  const [s, setS] = useState<FireState>(api.state());
  const [now, setNow] = useState(Date.now());
  useEffect(() => api.subscribe(setS), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const msToRoll = s.nextRollAt - now;
  const mid = (s.forecastLow + s.forecastHigh) / 2;
  const size = s.ticketsToday / mid;
  const last = s.feed[0];
  const dead = !!s.storm && !s.storm.survived && now - s.storm.at < 9_000;
  const odds = s.ticketsTotal ? (s.yourTickets / s.ticketsTotal) * 100 : 0;
  const need = Math.max(0, Math.round(mid - s.ticketsToday));

  return (
    <div className="page">
      <Sky msToRoll={msToRoll} storm={s.storm} />

      <header className="top">
        <div className="brand">The Fire</div>
        <div className="forecast" role="status">
          <span className="fc-title">Tonight's storm</span>
          <span className="fc-range">{s.forecastLow.toLocaleString()}–{s.forecastHigh.toLocaleString()} tickets</span>
          <span className="fc-when">rolls in {countdown(msToRoll)} · 8:00 PM Arizona</span>
        </div>
      </header>

      <main className="stage">
        <section className="hero">
          <div className="pot">
            <span className="pot-usd">{usd(s.potPlank, s.plankUsd)}</span>
            <span className="pot-plank">{mPlank(s.potPlank)} PLANK in the pot</span>
            <span className="pot-fire">
              Fire #{s.fireId}{s.fireName ? ` · ${s.fireName}` : ""} · {s.night === 0 ? "lit today" : `${s.night} ${s.night === 1 ? "night" : "nights"} survived`}
            </span>
          </div>

          <Fire size={size} lastBuyId={last?.id ?? 0} lastBuyWasLog={last ? last.tickets >= 100 : false} dead={dead} />

          <div className={"size" + (size < 0.8 ? " low" : size > 1.2 ? " high" : "")}>
            <span className="size-num">{s.ticketsToday.toLocaleString()}</span>
            <span className="size-label">tickets today</span>
            <span className="size-hint">
              {need > 0 ? `${need.toLocaleString()} more to match the forecast` : "bigger than the forecast — looking good"}
            </span>
          </div>

          {s.storm && now - s.storm.at < 9_000 && (
            <div className={"verdict " + (s.storm.survived ? "ok" : "out")} role="alert">
              {s.storm.survived
                ? `Clouds rolled by. Night ${s.night} survived — fire ${s.storm.size.toLocaleString()} vs storm ${s.storm.strength.toLocaleString()}.`
                : `It rained. The fire went out — fire ${s.storm.size.toLocaleString()} vs storm ${s.storm.strength.toLocaleString()}. Winner: ${short(s.past[0]?.winner ?? "")}`}
            </div>
          )}
        </section>

        <BuyPanel yourPaper={s.yourPaper} onBuy={api.buy} onStoke={api.stoke} />
      </main>

      <section className="you">
        <div><b>{s.yourTickets.toLocaleString()}</b><span>your tickets this fire</span></div>
        <div><b>{odds < 0.01 && odds > 0 ? "<0.01" : odds.toFixed(2)}%</b><span>your odds tonight</span></div>
        <div><b>{s.yourPaper}</b><span>PAPER in your wallet</span></div>
        <div><b>{s.ticketsTotal.toLocaleString()}</b><span>tickets in this fire</span></div>
      </section>

      <section className="grid">
        <div className="feed">
          <h2>On the fire</h2>
          <ul>
            {s.feed.map((b) => (
              <li key={b.id}>
                <span className="who">{short(b.who)} <em>{b.title}</em></span>
                <span className="what">
                  {b.tickets >= 100 ? "🪵" : "📄"} {b.tickets.toLocaleString()} {b.tickets === 1 ? "ticket" : "tickets"}{b.withEth ? " · paper from the fire" : ""}
                </span>
                {b.note && <span className="note">"{b.note}"</span>}
                <span className="when">{ago(b.at)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="side">
          <div className="burn">
            <h2>Gone forever</h2>
            <dl>
              <dt>{s.burnedPaperAllTime.toLocaleString()}</dt><dd>PAPER burned</dd>
              <dt>{mPlank(s.burnedPlankAllTime)}</dt><dd>PLANK burned</dd>
              <dt>{s.millsEaten}</dt><dd>mills eaten by the fire</dd>
            </dl>
            <p className="fine">The fire buys mills with ETH from "paper" sales and burns them. The PLANK inside goes to every mill holder. Next mill: {s.millBidEth.toFixed(4)} ETH bid, {s.millFundEth.toFixed(4)} ETH saved.</p>
          </div>

          <div className="archive">
            <h2>Past fires</h2>
            <ol>
              {s.past.map((f) => (
                <li key={f.id}>
                  <span className="pf-name">#{f.id} {f.name}</span>
                  <span className="pf-meta">{f.nights} {f.nights === 1 ? "night" : "nights"} · {usd(f.potPlank, s.plankUsd)} · won by {short(f.winner)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <footer className="foot">
        <p>Buy tickets with PAPER and PLANK. PAPER burns. Half the PLANK burns, half feeds the fire. Every night a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one ticket wins 40% of the pot; 30% burns; 30% lights the next fire.</p>
        {api.demoStorm && <button className="demo" onClick={api.demoStorm}>Demo: roll tonight's storm now</button>}
      </footer>
    </div>
  );
}
