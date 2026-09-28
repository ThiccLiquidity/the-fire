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
        <p className="how-lede">A campfire that runs on PAPER and PLANK. Feed it, keep it alive through the nightly storms, and when it finally goes out one ticket wins the pot.</p>

        <ol className="how-steps">
          <li><b>Buy tickets.</b> A ticket is 1 PAPER plus about $0.90 of PLANK. Up to {TX_CAP} per buy, {DAILY_CAP} per wallet per day; a full {TX_CAP} is 3% off. No PAPER? Pay $1 for the paper leg in ETH or USDG instead. Same ticket either way.</li>
          <li><b>Everything burns or feeds the pot.</b> The PAPER is destroyed. Half the PLANK is destroyed, the other half goes into the pot. Dollars paid in place of PAPER go to the mill fund (below).</li>
          <li><b>Every ticket makes the fire bigger.</b> Fire size is the number of tickets it has taken in. Each night it burns down to 60% of itself, so a fire nobody feeds shrinks.</li>
          <li><b>Every night at 8 PM Arizona, a storm hits.</b> Its strength is random, scaled to how busy the fire has been over the last week, and it grows with the fire's age: night 1 never kills, by night 10 it takes a fire the size of a normal week's buys, and no fire survives night 24. If the storm is bigger than the fire, the fire goes out.</li>
          <li><b>When the fire goes out, one ticket wins.</b> Every ticket in that fire has the same chance. 40% of the pot goes to the winner (5% of that to the mill holders' pool), 30% is destroyed, 30% lights the next fire. Then it starts again.</li>
        </ol>

        <h3>Where the money goes</h3>
        <div className="flow">
          <div className="flow-col">
            <div className="flow-box fb-in">1 ticket</div>
            <div className="flow-sub">1 PAPER + $0.90 PLANK<br />or $1 + $0.90 PLANK</div>
          </div>
          <div className="flow-arrows" aria-hidden="true">→</div>
          <div className="flow-col">
            <div className="flow-box fb-burn">PAPER → burned</div>
            <div className="flow-box fb-burn">½ PLANK → burned</div>
            <div className="flow-box fb-pot">½ PLANK → the pot</div>
            <div className="flow-box fb-fund">$1 → mill fund</div>
          </div>
          <div className="flow-arrows" aria-hidden="true">→</div>
          <div className="flow-col">
            <div className="flow-box fb-pot">Pot, when the fire dies:<br /><small>40% winner · 30% burned · 30% next fire</small></div>
            <div className="flow-box fb-fund">Mill fund buys the cheapest mill on OpenSea and burns it.<br /><small>The PLANK inside goes to every mill holder.</small></div>
          </div>
        </div>

        <h3>Your odds</h3>
        <p>Your chance of winning is your tickets divided by all tickets in the fire, shown live on the page. Tickets never expire within a fire and don't carry to the next one. Buying pauses for a few seconds each night while the storm is rolling, so nobody can buy after the result is known.</p>

        <h3>What nobody controls</h3>
        <ul>
          <li>The contract has no owner, no pause, and no withdraw. PLANK only leaves through the rules above; the mill fund only leaves by buying a listed mill and burning it in the same transaction.</li>
          <li>The random number comes from drand, a public randomness beacon, checked on-chain. Anyone can deliver it; nobody can pick it.</li>
          <li>The nightly roll, the mill buying, and the price checkpoints are all public functions. We run a bot that calls them on time; if it's down, anyone else can, and the page has a button for it.</li>
          <li>Names and pictures live on-chain too. Only your wallet can set yours.</li>
        </ul>
        <p className="fine">Contract, tests and sims are open source. Read the code before you trust the summary.</p>
      </div>
    </div>
  );
}
