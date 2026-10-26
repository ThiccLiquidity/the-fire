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

### Owner's answers to the research plan (Oct 26; plan: `docs/paper-football-plan.md`)

14. **No top on the goal.** Anything between the uprights and over the bar is good, at any height. The pencil
    uprights are drawn taller so a make reads clearly. The football really collides with the pencils, the bar and
    Plank: it bounces, deflects or drops, and never passes through anything.
15. **The kick:** where you hit the strike edge, high or low, sets loft and spin. The swipe's slant sets the sideways
    curve.
16. **Doink and in counts** ("DOINK… GOOD!").
17. **The fold:** a 2 s fold animation starts every paid run. Free play can skip it.
18. **Difficulty unlocks gradually** (distance, offset, wind, gap, then the car). Claude may pick another scheme if it
    plays better.
19. **Every run starts at level 0,** free or paid. The best streak sets the leaderboard place. (This replaces the
    plan's "paid starts at L3".)
20. **Free and paid runs can both start from the pack/grade wait,** as well as from the game's own page. The pack is
    never held up, and the player can close the game and go straight to the ready pack.
21. **No daily cap on paid runs.** Each run is exactly 1 PAPER (decision 13).
22. **Prizes go out automatically.** When a new Series launches, the previous Series' top three get 3, 2 and 1 free
    pack credits, straight to their wallets. They never expire and are spent whenever the winner likes. There's no
    manual step: the game server's wallet is the `prizeAwarder`, and the contract's 6-per-Series cap stays.
23. **Server-signed `payRun` on Vercel** (the team is already on a paid plan): OK if it works and the owner approves
    the result.
24. **Plank keeps his look.** There's no lawyer review (owner's call): the legal risks are listed in the plan, §12, and
    this isn't legal clearance.
25. **No fake wait in the demo.** During a real pack/grade wait, show an inviting Paper Football preview with a play
    button. It offers free and paid play, with simple explanations of the controls, the rules and the prizes. Where
    the PAPER goes stays behind Info/Help.
26. **Keep it simple:** a straightforward, fun game. Any new infrastructure, contract change or cost is explained in
    plain English before it's built. The finished game still needs the owner's review and approval, and none of this
    authorizes going live.
27. **Game room:** games are added to FireGames with a fixed entry each; prizes are capped at 6 per game per Series.

## On chain (game room added Oct 26, tests in `contracts/test/cards/Games.t.sol`)

- **`FireGames`** (`contracts/src/cards/FireGames.sol`) takes the entries for every game in the game room.
  - The owner adds a game once with `addGame(gameId, entry)`. Its entry is fixed forever: nothing can change it.
    Paper football is game 1 at 1 PAPER (`DeployCards` adds it).
  - `payRun(gameId, runId, series, deadline, sig)` burns exactly that game's entry from the player to the dead
    address and records who paid that run id, once. It needs the game server's EIP-712 approval (`signer`) of that
    game, run id, player, Series and deadline, so the server's checks (state, 18+) come first. The server starts a
    paid run only after it sees `RunPaid` for its run id from the player's wallet.
  - The owner's switches: `setPaused` (every game), `setGameOpen` (one game), `setSeries` (the competition new runs go
    into, moved on at each Series launch, 0 = closed) and `setSigner`. The deploy leaves the signer and Series unset,
    so paid play stays closed until the owner sets both.
  - The player names the competition, so a run paid during a switch can't land in the wrong one.
  - Holds no funds, and moves nothing but the entry from the caller. Ownership can't be renounced.
- **`FireCredits.awardPrizes(series, gameId, winners, counts)`** gives a game's winners their free pack credits. Only
  the owner or the `prizeAwarder` the owner sets (the server's wallet) can call it.
  - Only for games the owner allows (`setPrizeGame`; the deploy allows game 1), so a stolen server key can't make up
    games.
  - Hard cap: at most `MAX_PRIZE_CREDITS = 6` per game per Series, however many calls, fixed forever.
  - Only for a Series whose drop has started, so made-up Series numbers can't add more.
  - Prize credits are ordinary free-pack credits, spent the usual way in the next Series.
- **Wired:** `DeployCards`, `AcceptOwnership` (FireGames is the eighth owned contract) and `VerifyDeploy`.
- **Still to do:** the server (run ids, approvals, shot seeds, replaying kicks, the leaderboard); the site's paid-run
  flow; then the final audit covers them.

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
