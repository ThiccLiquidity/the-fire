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
          <li><b>Buy tickets.</b> A ticket is 1 PAPER (or $0.33 worth, whichever is less) plus about $0.90 of PLANK. Up to {TX_CAP} per buy, {DAILY_CAP} per wallet per day; buy {TX_CAP}, get 1 free (the free one counts toward the {DAILY_CAP}). No PAPER? Pay $1 in ETH or USDG instead of the PAPER. Same ticket either way.</li>
          <li><b>PAPER burns, PLANK feeds the fire.</b> The PAPER is destroyed. All the PLANK goes into the fire's pot. Dollars paid in place of PAPER go to the mill fund (below).</li>
          <li><b>Every ticket is a log on the fire.</b> Each one makes the fire 1 bigger. Overnight the fire burns down a little (it keeps 85%), so a fire nobody feeds shrinks and a fire people pile into grows. Your tickets never shrink: they all stay in until the fire goes out.</li>
          <li><b>Every night at 8 PM MST, a storm hits</b> and knocks tickets off the fire. If the storm is bigger than the fire, the fire goes out.
            <ul className="how-sub">
              <li><b>How big?</b> It's sized to a normal night of buying, and it grows with the fire's age: nothing on night 1, about an eighth of a normal night on night 2, a full normal night by night 9, about two by night 17. Night 24 always puts the fire out.</li>
              <li><b>A big fire has a real shot.</b> The storm's "normal night" catches up slowly when buying jumps and drops quickly when it slows. So when people pile in, the fire gets far bigger than the storm expects and can ride that for weeks.</li>
              <li><b>Then luck.</b> Most nights are near normal, but about 1 night in 5 the storm is 3 times normal or worse. A fire nobody feeds can go out early.</li>
              <li><b>Example:</b> at about 100 tickets a day, a normal night-9 storm knocks off about 100. A fire that's been fed well shrugs it off; one nobody's fed goes out.</li>
            </ul></li>
          <li><b>When the fire goes out, one ticket wins.</b> Every ticket in that fire has the same chance. The winner gets 40% of the pot. 25% is destroyed, 5% goes to the Paper Mill royalty pool, and 30% lights the next fire. If nobody bought a ticket, nothing burns and the whole pot lights the next fire. Then it starts again.</li>
        </ol>

        <h3>Where the money goes</h3>
        <div className="flow">
          <div className="flow-col">
            <div className="flow-box fb-in">1 ticket</div>
            <div className="flow-sub">1 PAPER (max $0.33) + $0.90 PLANK<br />or $1 + $0.90 PLANK</div>
          </div>
          <div className="flow-arrows" aria-hidden="true">→</div>
          <div className="flow-col">
            <div className="flow-box fb-burn">PAPER → burned</div>
            <div className="flow-box fb-burn">PAPER → burned</div>
            <div className="flow-box fb-pot">All the PLANK → the pot</div>
            <div className="flow-box fb-fund">$1 → mill fund</div>
          </div>
          <div className="flow-arrows" aria-hidden="true">→</div>
          <div className="flow-col">
            <div className="flow-box fb-pot">Pot, when the fire dies:<br /><small>40% winner · 25% burned · 5% Paper Mill royalty pool · 30% next fire</small></div>
            <div className="flow-box fb-fund">Mill fund buys the cheapest mill on OpenSea and burns it.<br /><small>The PLANK inside goes to the Paper Mill royalty pool.</small></div>
          </div>
        </div>

        <h3>Your odds</h3>
        <p>Your chance of winning is your tickets divided by all tickets in the fire, shown live on the page. Tickets never expire within a fire and don't carry to the next one. Buying pauses for about 30 seconds each night while the storm's number arrives, so nobody can buy after the result is known.</p>

        <h3>What nobody controls</h3>
        <ul>
          <li>The contract has no owner and no withdraw, and nobody can switch it off. One safety valve: if a storm's number never arrives for 7 days, anyone can end the game, and the last fire's ticket holders split its pot. PLANK only leaves through these rules; the mill fund only leaves by buying a listed mill and burning it in the same transaction.</li>
          <li>The random number comes from drand, a public randomness beacon, checked on-chain. Anyone can deliver it; nobody can pick it.</li>
          <li>The nightly roll, the mill buying, and the price checkpoints are all public functions. We run a bot that calls them on time; if it's down, anyone else can, and the page has a button for it.</li>
          <li>Names and pictures live on-chain too. Only your wallet can set yours.</li>
        </ul>
        <p className="fine">Contract, tests and sims are open source. Read the code before you trust the summary.</p>
      </div>
    </div>
  );
}
