// "How the fire works": the whole game and where every dollar goes, in plain words, as an overlay.
import { useEffect } from "react";
import { DAILY_CAP, TX_CAP } from "../data/types";

export function HowItWorks({ onClose }: { onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="how-back" onClick={onClose} role="presentation">
      <div className="how" role="dialog" aria-modal="true" aria-labelledby="how-title" onClick={(e) => e.stopPropagation()}>
        <button className="how-close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="how-title">How the fire works</h2>
        <p className="how-lede">A campfire that runs on PAPER and PLANK. Throw logs on it, keep it alive through the nightly storms, and when it finally goes out one log wins the pot. Every log is a ticket to win.</p>

        <ol className="how-steps">
          <li><b>Throw logs.</b> A log is 1 PAPER (or $0.33 worth, whichever is less) plus $0.90 of PLANK at the live price (it follows the PLANK pool within about an hour, so a pump means fewer PLANK per log). Up to {TX_CAP} per throw, {DAILY_CAP} per wallet per day. Throw {TX_CAP} and get free logs: 3 on a fire's first day, 2 on its second, 1 after that (free logs count toward the {DAILY_CAP}). No PAPER? Pay $1 in ETH or USDG instead of the PAPER. Same log either way.</li>
          <li><b>PAPER burns, PLANK feeds the fire.</b> The PAPER is destroyed. All the PLANK goes into the fire's pot. Dollars paid in place of PAPER go to the press fund (below).</li>
          <li><b>Every log feeds the fire.</b> Each one makes the fire 1 bigger. Overnight the fire burns down a little (it keeps 85%), so a fire nobody feeds shrinks and a fire people pile into grows. The fire burns down, but your logs never leave the draw: every one stays in until the fire goes out.</li>
          <li><b>Every night at 8 PM MST, a storm hits</b> and knocks the fire down. If the storm is bigger than the fire, the fire goes out.
            <ul className="how-sub">
              <li><b>How big?</b> Every storm is one of 20 fixed sizes, from 5 logs up to 25,000. Storms never get stronger. What changes is the odds: early on it's almost always a small storm, and every night the odds tilt a little toward the big ones. Nothing on night 1; night 24 always puts the fire out.</li>
              <li><b>Big fires last.</b> The storm is a real number of logs, so size is what counts. A 50-log fire can't ride out a 180-log storm; a 5,000-log fire barely notices it. A fire that people keep feeding can go deep. One nobody feeds goes out in a night or two.</li>
              <li><b>Example:</b> on night 2 most storms are 5 to 30 logs. By night 12 most are 180 to 1,000. By night 20 most are over 1,700. At about 100 logs a day a fire usually lasts around 9 nights; at 1,000 a day, around 17.</li>
            </ul></li>
          <li><b>When the fire goes out, one log wins.</b> Every log in that fire has the same chance. The winner gets 40% of the pot. 25% is destroyed, 5% goes to the Paper Press royalty pool, and 30% lights the next fire. If nobody threw a log, nothing burns and the whole pot lights the next fire. Then it starts again.</li>
        </ol>

        <h3>Where the money goes</h3>
        <div className="flow">
          <div className="flow-col">
            <div className="flow-box fb-in">1 log</div>
            <div className="flow-sub">1 PAPER (max $0.33) + $0.90 PLANK<br />or $1 + $0.90 PLANK</div>
          </div>
          <div className="flow-arrows" aria-hidden="true">→</div>
          <div className="flow-col">
            <div className="flow-box fb-burn">PAPER → burned</div>
            <div className="flow-box fb-pot">All the PLANK → the pot</div>
            <div className="flow-box fb-fund">$1 → press fund</div>
          </div>
          <div className="flow-arrows" aria-hidden="true">→</div>
          <div className="flow-col">
            <div className="flow-box fb-pot">Pot, when the fire dies:<br /><small>40% winner · 25% burned · 5% Paper Press royalty pool · 30% next fire</small></div>
            <div className="flow-box fb-fund">Press fund buys the cheapest press on OpenSea and burns it.<br /><small>The PLANK inside goes to the Paper Press royalty pool.</small></div>
          </div>
        </div>

        <h3>Your odds</h3>
        <p>Your chance of winning is your logs divided by all logs in the fire, shown live on the page. Logs stay in the draw for the whole fire and don't carry to the next one. Buying pauses for about 30 seconds each night while the storm's number arrives, so nobody can buy after the result is known.</p>

        <h3>What nobody controls</h3>
        <ul>
          <li>The contract has no owner and no withdraw, and nobody can switch it off. One safety valve: if a storm's number never arrives for 7 days, anyone can end the game, and the last fire's log holders split its pot. PLANK only leaves through these rules; the press fund only leaves by buying a listed press and burning it in the same transaction.</li>
          <li>The random number comes from drand, a public randomness beacon, checked on-chain. Anyone can deliver it; nobody can pick it.</li>
          <li>The nightly roll, the press buying, and the price checkpoints are all public functions. We run a bot that calls them on time; if it's down, anyone else can, and the page has a button for it.</li>
          <li>Names and pictures live on-chain too. Only your wallet can set yours.</li>
        </ul>
        <p className="fine">Contract, tests and sims are open source. Read the code before you trust the summary.</p>
      </div>
    </div>
  );
}
