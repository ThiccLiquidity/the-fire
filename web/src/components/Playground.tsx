// Demo-only control deck: drive every state of the site without a chain. Rendered only when the site runs on the mock.
import { useState } from "react";
import { stormFor, type DemoControls, type FireState } from "../data/types";
import { sceneRef } from "./Scene";
import { KINDS } from "./scene";

export function Playground({ s, d, hour, onHour }: {
  s: FireState; d: DemoControls; hour: number | null; onHour: (h: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(50);
  const luck = Math.min(9999, pct * 100 + 50); // the random draw, 0..9,999
  const [crowd, setCrowd] = useState(6);
  const [ethStale, setEthStale] = useState(false);
  const usd = (plank: number) => Math.round(plank * s.plankUsd);
  const num = (v: string) => Number(v) || 0;

  return (
    <div className={"pg" + (open ? " open" : "")}>
      <button className="pg-toggle" onClick={() => setOpen(!open)}>
        <span><b>Playground</b> — make the storm come now, change prices, etc. (demo only)</span><small>{open ? "close" : "open"}</small>
      </button>
      {open && (
        <div className="pg-body">
          <section>
            <h3>The next storm</h3>
            <div className="pg-row">
              <button onClick={() => d.roll("random", luck)}>Roll (real formula)</button>
              <button onClick={() => d.roll("survive", luck)}>Force: survives</button>
              <button onClick={() => d.roll("out", luck)}>Force: fire goes out</button>
              <button className="hot" onClick={() => d.roll("you-win", luck)}>Force: you win</button>
            </div>
            <label>Storm draw {pct}% → {(() => { const n = stormFor(s.night + 1, luck); return Number.isFinite(n) ? n.toLocaleString() + " logs" : "infinite"; })()} vs a {Math.round(s.fireSize).toLocaleString()}-log fire <input type="range" min={0} max={99} value={pct} onChange={(e) => setPct(num(e.target.value))} /> <small>the contract's storm ladder; higher = a bigger next storm</small></label>
            <div className="pg-row">
              <label><input type="checkbox" checked={!!s.rollPending} onChange={(e) => d.setPending(e.target.checked)} /> Storm pending (buying paused, "Bring in the storm" shown)</label>
              <button onClick={() => d.skipNights(1)}>Skip 1 day</button>
              <button onClick={() => d.skipNights(7)}>Skip a week</button>
            </div>
            <div className="pg-row">
              <label><input type="checkbox" checked={!!s.abandoned} onChange={(e) => d.setAbandoned(e.target.checked)} /> Game abandoned (refunds)</label>
              <label><input type="checkbox" checked={(s.you.prize ?? 0) > 0} disabled={!s.you.address} onChange={(e) => d.setPrizeStuck(e.target.checked)} /> Prize stuck (claim)</label>
            </div>
          </section>

          <section>
            <h3>The fire</h3>
            <div className="pg-grid">
              <label>Day <input type="number" value={s.night} min={0} max={30} step={1} onChange={(e) => d.set({ night: Math.max(0, Math.min(30, Math.floor(num(e.target.value)))) })} /></label>
              <label>Fire size (logs) <input type="number" value={Math.round(s.fireSize)} onChange={(e) => d.set({ fireSize: num(e.target.value) })} /></label>
              <label>Pot ($) <input type="number" value={usd(s.potPlank)} onChange={(e) => d.set({ potPlank: num(e.target.value) / s.plankUsd })} /></label>
              <label>Tickets in this fire <input type="number" value={s.ticketsTotal} onChange={(e) => d.set({ ticketsTotal: num(e.target.value) })} /></label>
              <label>7-day avg (storm scale) <input type="number" value={Math.round(s.trailingAvg)} onChange={(e) => d.set({ trailingAvg: Math.max(1, num(e.target.value)) })} /></label>
              <label>Sky threat 0–1 <input type="number" step={0.05} min={0} max={1} value={s.threat} onChange={(e) => d.set({ threat: Math.max(0, Math.min(1, num(e.target.value))) })} /></label>
            </div>
          </section>

          <section>
            <h3>Prices and feeds</h3>
            <p className="fine">PAPER amounts move at most 5% a day; PLANK follows the live price.</p>
            <div className="pg-grid">
              <label>PLANK price ($ per 1B) <input type="number" step={0.1} value={+(s.plankUsd * 1e9).toFixed(3)} onChange={(e) => d.set({ plankUsd: Math.max(0.01, num(e.target.value)) / 1e9 })} /></label>
              <label>PAPER price ($, 0 = no market) <input type="number" step={0.01} min={0} value={s.paperUsd} onChange={(e) => d.set({ paperUsd: Math.max(0, num(e.target.value)) })} /></label>
              <label>ETH price ($) <input type="number" value={Math.round(s.ethUsd)} disabled={ethStale} onChange={(e) => d.set({ ethUsd: Math.max(1, num(e.target.value)) })} /></label>
              <label>Press bid ($) <input type="number" value={Math.round(s.millBidUsd)} onChange={(e) => d.set({ millBidUsd: num(e.target.value) })} /></label>
              <label>Press fund USDG ($) <input type="number" value={Math.round(s.millFundUsdg)} onChange={(e) => d.set({ millFundUsdg: num(e.target.value) })} /></label>
            </div>
            <div className="pg-row">
              <label><input type="checkbox" checked={ethStale} onChange={(e) => { setEthStale(e.target.checked); d.setEthFeedStale(e.target.checked); }} /> ETH/USD feed stale (ETH path closes)</label>
              <label><input type="checkbox" checked={s.usdgEnabled} onChange={(e) => d.set({ usdgEnabled: e.target.checked })} /> USDG path on</label>
              <button onClick={() => d.eatMill()}>The fire eats a press now</button>
            </div>
          </section>

          <section>
            <h3>Your wallet</h3>
            <div className="pg-grid">
              <label>PAPER <input type="number" value={s.you.paper} onChange={(e) => d.setYou({ paper: num(e.target.value) })} /></label>
              <label>PLANK (billions) <input type="number" step={0.1} value={+(s.you.plank / 1e9).toFixed(2)} onChange={(e) => d.setYou({ plank: num(e.target.value) * 1e9 })} /></label>
              <label>ETH <input type="number" step={0.01} value={s.you.eth} onChange={(e) => d.setYou({ eth: num(e.target.value) })} /></label>
              <label>USDG <input type="number" value={s.you.usdg} onChange={(e) => d.setYou({ usdg: num(e.target.value) })} /></label>
              <label>Your logs in this fire <input type="number" value={s.you.tickets} onChange={(e) => d.setYou({ tickets: num(e.target.value) })} /></label>
              <label>Left today (cap 500) <input type="number" value={s.you.remainingToday} onChange={(e) => d.setYou({ remainingToday: num(e.target.value) })} /></label>
            </div>
            <div className="pg-row">
              <label><input type="checkbox" checked={!!s.you.address} onChange={(e) => d.setConnected(e.target.checked)} /> Wallet connected</label>
            </div>
          </section>

          <section>
            <h3>The crowd</h3>
            <div className="pg-row">
              <label>Buys per minute {crowd} <input type="range" min={0} max={60} value={crowd} onChange={(e) => { setCrowd(num(e.target.value)); d.setCrowd(num(e.target.value)); }} /></label>
              <button onClick={() => d.crowdBuy(1)}>Someone buys 1</button>
              <button onClick={() => d.crowdBuy(10)}>Someone buys 10</button>
              <button onClick={() => d.crowdBuy(10, "usdg")}>Outsider buys 10 with USDG</button>
            </div>
          </section>

          <section>
            <h3>Scene</h3>
            <div className="pg-row">
              <label>Time of day <input type="range" min={0} max={24} step={0.25} value={hour ?? 12} onChange={(e) => onHour(num(e.target.value))} /> {hour !== null && <button onClick={() => onHour(null)}>real time</button>}</label>
              <label>Visitor {KINDS.map((k) => <button key={k} onClick={() => sceneRef.visitor?.(k)}>{k}</button>)}</label>
            </div>
          </section>

          <div className="pg-row"><button className="hot" onClick={() => d.reset()}>Reset everything</button></div>
        </div>
      )}
    </div>
  );
}
