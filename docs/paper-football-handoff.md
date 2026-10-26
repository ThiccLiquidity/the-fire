# Handoff: Paper Football decisions (Omni Cards)

**For the agent reading this:** you are talking with the owner of Omni Cards (Omni Cardworks). They're on their phone.
Your job:
1. Explain the game and the research below in plain words, as briefly as they want.
2. Ask the questions in "Questions" **one at a time**. The owner likes short, direct answers.
3. At the end, give them the filled-in **Answer sheet** (bottom of this doc) to paste back to Claude Code, which is
   building the game.

Rules to keep while you talk:
- **Don't design new mechanics or change locked decisions.** If the owner wants to change one, just note it in
  the answer sheet.
- **Never ask for or accept keys, seed phrases or passwords.**
- **On play and pay screens, show prices only.** Never say where the money goes (burns, splits). That belongs behind Info/Help.
- **Nothing goes live, merges to main or leaves demo mode** without the owner's explicit OK. Questions here are about
  the plan, not about going live.

---

## What Omni Cards is (one paragraph)

Omni Cards sells trading-card NFTs on Robinhood Chain.
- **Buying and opening:** people buy packs with PAPER (the site's token). Packs open after a short random-number wait (drand, about 90 s).
- **Cards:** cards come in materials: Paper, Wood, Fire, Coal and Gold, with drawn holo effects. They can be cased and graded.
- **Look:** the site looks like a warm, dim steampunk workshop or card factory.
- **Plank:** the mascot is Plank, a yellow cartoon wooden plank.
- **Status:** the whole thing is on testnet now, in demo mode.

## What Paper Football is

It's the lunch-table game from childhood, turned into a mini-game on the site.
- **The kick:** you flick a folded paper triangle off a paperclip tee, through pencil goalposts, on a workbench.
- **Controls:** phone players flick up; desktop players pull back and let go.
- **Streaks:** every make raises the difficulty. Distance, wind, a narrower goal, an offset goal and, from streak 4, goalposts riding a little toy car all come in. Every condition is shown before the kick. A miss ends the streak.
- **Free play:** any time, including while a pack or grade waits on drand. The pack is never held up; a banner says when the cards are ready.
- **Paid competitive runs (launch with the site; the owner can switch them off any time):**
  - Exactly **1 PAPER per run, forever**. "One PAPER buys one piece of paper to fold a football from."
  - The first miss ends the run.
  - One leaderboard spot per wallet per Series.
  - The top three get 3, 2 and 1 free packs. Hard cap: 6 packs per Series, enforced in the contract.
  - The server replays and judges every kick.

**Already done:**
- The two contracts, FireKicks (pay for a run) and FireCredits.awardPrizes (prize packs), with tests.
- A Round 1 playable prototype.

**The owner's last feedback:** "the perspective is off, the football is way out in the middle of the table." That's what
the research fixes.

## Research highlights (15 specialist agents; full plan: https://claude.ai/artifact/Fefx65bE34rYda9gZ3SqAd)

1. **Faithful to the real game.**
   - **The football:** a strip of notebook paper flag-folded into a right triangle. Long edge 1.6 in, short edges
     1.13 in, very thin.
   - **What you see:** the long edge faces you, showing stacked rounded crease loops; blue lines run across at 45°, a red margin is on
     one face, the tail is tucked, and there's a ballpoint Plank doodle.
   - **Wear:** it gets more worn as your streak grows (soft corners, then a dog-ear, then a smudge).
2. **"Too far away" fixed with the camera, not the art.** The eye sits 4 in behind the football and just above its top
   ("chin on the table"). The football fills about 37% of the screen height, up from about 9% now. The camera
   holds still during the kick (no chase cam), like a kid's eye.
3. **Goalposts sized like the finger goal.**
   - **Pencils:** standing in an oak block, tips at 5.5 in, with a pencil crossbar at 2.5 in tied on with red rubber bands.
   - **Gap:** 5 in at the start, shrinking to 2.8 in by level 20.
   - **No top**, like the real hands.
4. **Plank stands right behind the goal**, so every make bounces off his face with a wooden thunk. That's the
   best-remembered part of the game ("hit him in the face"). His face reacts; he never signals.
5. **Power is a real skill.** Kicking harder makes the ball curve more and shrinks the sweet spot, so a soft chip
   beats blasting it.
6. **The fold.** A paid run opens with tearing a fresh notebook sheet and folding the football (2 s). That makes "1 PAPER =
   one piece of paper" something you see.
7. **Sounds:** the fingernail "tk", a paper whisper as it spins, a woody "tok" on a pencil doink, a deeper thunk on Plank,
   and quiet room tone.
8. **Kids' miss words** in handwriting: "Wide left", "Shanked it", "Doink!", "Short", "Duck!".
9. **Milestones:** 3 "Hat trick!", 5 a star doodle, 10 a gold star sticker, 15 "Lunch-table legend", 20 a gold pencil.
   The score is kept as pencil tally marks.
10. **Difficulty is measured.** Each shot is rated by its predicted make rate. The target falls to about 5% by level 35,
    so an average player makes about 9 kicks and a good one about 18 (about one pack wait).
11. **Phone and desktop are made fair.** Both are calibrated, there is no mouse-only aim line, and the hit zone has a minimum size.
12. **Tech:** it stays Canvas 2D for v1. The physics is rewritten so the server can replay every kick exactly
    (anti-cheat, replays, ghosts).
13. **Paid-run safety:**
    - **Server:** Vercel Functions plus a Neon Postgres database.
    - **Anti-cheat:** the server's verdict is final, timing checks stop "picking the moment", and the top 10 replays are reviewed by a person before prizes.
    - **Failures:** a server failure resumes the same run; it never charges again.
    - **Prizes:** the owner sends them from their own hardware-wallet keystore, so no prize key sits on a server.
14. **Legal (not legal advice):**
    - Paid runs are blocked in 11 US states; you must be 18+.
    - Cap at 10 paid runs per wallet per day.
    - One fixed-fee review by a gaming lawyer before the paid switch is turned on.
    - Plank resembles a well-known cartoon character; worth weighing before paid launch.

**Build order:**
- R1a camera and football;
- R1b physics;
- R2 art (the owner approves every image);
- R3 sounds and feel;
- R4 into the site;
- R5 paid runs on testnet;
- R6 rules page, gates and lawyer.

---

## Questions (ask one at a time; Claude's recommendation in brackets)

**Game feel**

1. **No top on the goal.** The real finger goal has no top, so a kick above the pencil tips but still between them
   counts as good. OK? *[Yes, it's how the real game worked.]*
2. **Where you hit the paper.**
   - **Now:** the left/right of the hit curves the ball.
   - **Proposal:** hitting high or low on the edge sets how high it flies and how it spins (like a real flick), while the sideways curve comes from the slant of your swipe.
   - OK? *[Yes, it feels more real.]*
3. **Doink and in.** A ball that hits a pencil and still goes through shows "DOINK… GOOD!" and counts. OK? *[Yes.]*
4. **The fold intro.** Each paid run starts with a 2 s animation of tearing a sheet and folding the football. Free play can tap
   to skip it. OK? *[Yes.]*
5. **Difficulty unlocks one at a time** in playground order: distance, then off-centre goal, then wind, then narrower
   goal, then the moving toy car at streak 4. The alternative is everything mixing at random from the start. OK? *[Yes, one at a time.]*

**Paid mode**

6. **Where paid runs start.** Paid runs start at level 3, so the first kicks aren't free points. Free play starts at level 0. OK? *[Yes.]*
7. **Only from the game's own page.** Paid runs can be started only from the game's own page, never inside a pack-opening wait (the wait
   is always free play). OK? *[Yes.]*
8. **Daily limit.** Cap paid runs at 10 per wallet per day. This limits "buy your way up" and helps the legal case. OK, or a different
   number? *[10.]*
9. **Contract change plus Vercel Pro.**
   - **The change:** FireKicks isn't deployed yet. The proposal is that paying for a run needs a quick
     signature from the game server, so the state block and 18+ check can't be skipped by calling the contract directly.
   - **The cost:** this needs Vercel Pro (about $20/month; the free plan doesn't allow commercial use).
   - OK to both? *[Yes.]*
10. **Prizes from the hardware wallet.** The owner sends the prize packs from their own hardware wallet at the end of each Series (one
    command Claude prepares), instead of leaving a prize key on the server. OK? *[Yes, safer.]*
11. **Plank and the lawyer.**
    - **Plank:** he resembles a famous cartoon character. Keep him as is for the paid game, or tweak his look before paid launch?
    - **Lawyer:** are you OK with one fixed-fee gaming-lawyer review before the paid switch is turned on?
    *[Keep Plank for now and get the review.]*

**Demo**

12. **Demo wait.** Should the demo add a short 15 s fake "drawing…" wait when opening a pack, so visitors can see "Play while you
    wait"? *[Yes.]*

**Housekeeping (not the game)**

13. **Push?**
    - **What's waiting:** the new thin-triangle football shape and the research plan doc, not yet saved to GitHub.
    - **Where they'd go:** the testing branch only (`wip/pending-approval`), never main.
    - OK to push? *[Yes.]*
14. **Security fixes before mainnet.** The earlier audit found no critical issues. Claude proposed these fixes before mainnet. OK to do all 7?
    1. **Snapshot checks:** make sure the holder snapshot can't quietly miss wallets.
    2. **Suggestions draw:** verify the draw, and clean up file names in the Studio Suggestions screen (a command-injection risk).
    3. **Node version check:** on the ops scripts.
    4. **`.env` protection:** keep the launch script from leaking the `.env` file.
    5. **Audit script:** make it fail loudly instead of saying "clean" when it fails.
    6. **Contract comment:** fix one that still says 1% instead of 3% for a PDA 10.
    7. **Gas margin:** add 25% so transactions don't fail on gas.
    *[Yes to all.]*

---

## Answer sheet (give this back to the owner to paste to Claude Code)

```
PAPER FOOTBALL ANSWERS
1  No top: 
2  Hit height = loft/spin, slant = curve: 
3  Doink and in counts: 
4  Fold intro: 
5  One-at-a-time unlocks: 
6  Paid starts at L3: 
7  Paid only from the game page: 
8  Paid runs per wallet per day: 
9  payRun server signature + Vercel Pro: 
10 Prizes from hardware wallet: 
11 Plank look / lawyer review: 
12 Demo 15 s fake wait: 
13 Push: 
14 Audit fixes 1-7: 
Other notes / changes the owner wants:
```
