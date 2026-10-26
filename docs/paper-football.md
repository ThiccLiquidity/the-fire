# Paper Football

The mini-game for the drand wait (pack opening, grading), playable any time. Source of the owner's intent:
the Oct 26 handoff (talked through with another assistant). Engine: `web/art/factory/forge/paperfb.js`. Every change
after this gets a numbered line under Decisions, so nothing settled is argued again.

## Decisions (locked)

1. **The game:** childhood paper football. A folded triangle on a paperclip tee is flicked through pencil uprights on
   a workshop table, seen low at table height. Warm, dim workshop. WIND (mph and an arrow) and DISTANCE (in.) shown
   before every kick.
2. **The football is seen edge-on:** its thin folded strike edge faces the kicker, not a broad flat triangle.
3. **No hand.** A paperclip tee holds the paper.
4. **The kick:** phone flicks up (speed = power, slant = aim); desktop presses on the paper, pulls back and lets go
   (length = power, the opposite of the pull = aim). Both make the same `{ power, aim, contact }`, so neither has an
   edge. No power meter: power is learned by feel.
5. **Where you touch the strike edge matters.** The centre hits clean and the paper tumbles end over end. Off-centre
   wobbles, curves toward that side and loses distance. A dashed line under the paper shows the edge, with the clean
   part in green.
6. **Difficulty:** each make raises the next kick's difficulty. It is spent at random across distance (12-38 in),
   wind (±9 mph), post gap, post offset and, from streak 4, posts riding a little RC car. Every condition is shown
   before the kick; nothing changes unannounced.
7. **Plank** stands behind the posts. A make bounces off his face with a wooden thunk. Misses fly past him. He has
   no scoring role.
8. **A make** flashes a quick word ("POW!", "Nice kick!") with a sound, then play goes on. No voice.
9. **Free play:** kick on through makes and misses. A miss only resets the streak. No prizes.
10. **The pack or grade is never held up.** It goes on in the background, and a banner says when the cards are ready,
    without stopping a kick.
11. **Paid competitive play launches with the site (owner's call, Oct 26).** The owner's kill switch can pause it at
    any time:
    - 1 PAPER per run, burned, with up to 3 optional practice kicks; the first miss ends the run.
    - One leaderboard place per wallet, its best streak this Series; a tie goes to whoever got there first.
    - At the end of the Series: 3, 2 and 1 free packs for the top three, to open in the next Series.
    - Kicks are checked on the server (each shot's conditions come from a seed; the server replays the inputs).
12. **Built mechanics first.** Payments, leaderboard and prizes come after the feel is right, but before launch.
    The server-side kick check is part of the launch work, since packs are on the line.
13. **A run is always exactly 1 PAPER, forever (owner, Oct 26).** One PAPER buys one piece of paper to fold into a
    football and play one run. A player pays with PAPER they hold, or buys that 1 PAPER with ETH, USDG or PLANK in
    the same step. The contract has no way to change the price.

## On chain (designed Oct 26, tests in `contracts/test/cards/Kicks.t.sol`)

- **`FireKicks`** (new, `contracts/src/cards/FireKicks.sol`): `payRun(runId, series)` burns exactly 1 PAPER (`ENTRY`,
  a constant) to the dead address and records who paid that run id, once. The game server starts a paid run only
  after it sees `RunPaid` for its run id from the player's wallet.
  - The owner's switches: `setPaused` (the kill switch) and `setSeries` (the competition new runs go into, moved on
    at each Series launch, 0 = closed). There is no price setting.
  - The player names the competition, so a run paid during a switch can't land in the wrong one.
  - Holds no funds. Ownership can't be renounced.
- **`FireCredits.awardPrizes(series, winners, counts)`** gives the top three their free pack credits. Only the
  owner or the `prizeAwarder` the owner sets (the server's wallet) can call it.
  - Hard cap: at most `MAX_PRIZE_CREDITS = 6` per Series, however many calls, fixed forever. Even a stolen server
    key can't print more than 6 packs a Series.
  - Only for a Series whose drop has started, so made-up Series numbers can't add more.
  - Prize credits are ordinary free-pack credits, spent the usual way in the next Series.
- **Still to do:** wire both into `DeployCards` and `VerifyDeploy`; the server (run ids, shot seeds, replaying kicks,
  the leaderboard); the site's paid-run flow; then the final audit covers them.

## Rounds

- **Round 1** (Oct 26): the playable prototype with placeholder art and the tuning panel.
  Link: https://claude.ai/artifact/5pZAPiYf2cXfrMmFp9HQ4q
- **Round 2:** the owner's tuning numbers and notes, plus the generated art.
- **Round 3:** polish: sounds, the Plank thunk, streak feel.
- **Round 4:** into the site behind its switch: the "Play while you wait" button and the cards-ready banner. Then tests.

## Open (to decide later)

- Badges: 100 and 500 makes (free and paid); streaks of 10 and 15 (paid only).
- Gold, silver and bronze profile marks for the Series' top three, plus a trophy shelf in the showcase.
- How prizes are given on chain (credits to the winners): check FireCredits.
- The server and anti-cheat design for paid runs.
