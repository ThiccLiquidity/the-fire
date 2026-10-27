# Spit-Wad Sniper: the owner's brief (game 2)

The owner's brief from the brainstorm (Oct 27, 2026), kept as written so later work can check against it. The
research plan built from it is `docs/spitwad-plan.md`. Paper Football is now called **Fold and Flick**.

## The brief

**1. Overview.** A second arcade game for the Game Room. First-person, skill-based: fire spit wads through a plastic
straw at Plank, who appears briefly from hiding spots throughout the factory. Find him, aim, manage breathing
pressure, fire before he disappears. Progressively harder 60-second rounds, difficulty-based scoring, cinematic
slow-motion sniper shots. Fold and Flick (Paper Football) is built and approved: don't redesign it; only its name and
the shared game-selection pieces may change.

**2. Setting.** Inside the same warm, dim steampunk card factory, but a different viewpoint and section from Fold and
Flick. Same visual style: realistic materials, warm amber light, dark industrial shadows, slightly stylized miniature
workshop. Designed around gameplay: many hiding spots at different depths and heights.
- Foreground: crates, drawers, workbenches, cabinets.
- Midground: pipes, shelves, gears, machinery.
- Background: distant platforms, openings, narrow gaps.
- Clear pathways for moving animals and distractions.

Plank appears at many distances, sizes, heights and exposure levels, not the same few obvious spots.
- **Art workflow:** Claude doesn't generate the artwork. Claude designs the layout and the asset list (hiding spots,
  depth and interactive geometry planned before the background prompt), writes the ChatGPT prompts, and integrates
  what the owner returns. The owner approves the art. Use the factory and Fold and Flick art as references.

**3. Shooter.** First person. A plastic fast-food-style soda straw, no visible hand, a small paper spit wad.
Playful, family-friendly, not gross. No real brands.

**4. Shooting (critical).** It should feel like an archery shot: aim, manage power, handle slight natural sway,
release at exactly the right moment.
- **Phone:** touch and hold; a crosshair appears slightly above the thumb; dragging moves it; air pressure starts
  cycling at the touch; keep correcting aim while it rises and falls; releasing fires at once.
- **Desktop:** click and hold, move to aim, pressure cycles, release to fire.
- **Fairness:** equivalent on phone and desktop.
- **Pressure** is a breathing cycle while held: rise, max, fall, rise again, until release. No breathing button, no
  reload, no pause. Time the release for the pressure you want.
  - Higher pressure: faster, flatter, less drop.
  - Lower pressure: slower, more arc, more drop.
  - Different distances reward different pressures.
- **Sway:** subtle natural movement or momentum that the player compensates for. Predictable, fair, skill-based, not
  random. A rushed release can miss.
- **Aim never locks** before firing.
- **For Claude:** research and prototype the cycle timing, sway, sensitivity and physics.

**5. Projectile.** The wad visibly leaves the straw, flies, arcs and drops, then hits Plank or the scene. Distance
and pressure set the trajectory. **No wind.** Deterministic and server-verifiable: the same input under the same
conditions always gives the same result. Randomness may pick which target appears where, never whether a well-aimed
shot hits.

**6. Plank.** He pops out of many spots, stays a limited time, then ducks or slides back.
- **Appearances:** fully exposed, partly hidden, barely peeking, close, far, high, low.
- **Movement:** early rounds he stays still; later rounds he moves (one more difficulty factor).
- **On a hit:** the wad visibly hits and flattens into a cartoon splat, Plank makes a shocked or dizzy face, and he
  slides back down. Reuse the existing face art where it fits.

**7. Sniper mode.** Every long-enough appearance triggers it when the player starts aiming: the camera zooms in, a
scope appears, a heartbeat starts, and everything goes slow motion (Plank's movement, his timer, the scene). The same
controls aim and fire, and the wad is still seen flying. Then back to normal view and speed. It's not a random bonus
or a separate minigame. Claude sets the distance threshold and the timing.

**8. Scoring.** Points come from shot difficulty: shorter exposure, smaller visible size and greater distance are each
worth more, and they combine. Each target's potential value is shown.
- No headshot bonus: anywhere on the exposed target counts.
- No golden or bonus targets.
- A miss costs nothing but time.
- Claude designs and balances the formula.

**9. Rounds.** 60 seconds each, always played in full even when the minimum is met early.
- **Each round has its own minimum.** Meet it and you advance; miss it and the run ends.
- **Every point counts** toward the cumulative leaderboard score, but extra points don't carry over to the next
  round's minimum.
- **Later rounds** bring shorter appearances, smaller exposure, greater distance, harder spots and moving Plank, with
  higher-value shots to match. Many rounds must be supported.
- **Claude** balances the thresholds and the target mixes.
- **Pack waits:** the game can run longer than a pack wait. Don't shorten the rounds or cap progression without
  approval. Research letting play continue on its own while the pack or grade becomes ready.

**10. Distractions.** The factory feels alive from round 1: cockroaches scurrying, a cat wandering, other small
creatures and factory movement. They sometimes pass in front of Plank.
- Shooting one gets a funny response, no penalty; it wastes the shot and the time.
- Their paths can vary, but hit detection stays deterministic and fair: a distraction must never randomly spoil an
  otherwise good shot.

**11. Modes.**
- **Free play:** no cost, any time, in the Game Room and during pack and grade waits, no prizes.
- **Competitive:**
  - exactly 1 PAPER per run, a fixed entry, the same gameplay;
  - the score goes on the Series leaderboard, one place per wallet, and ties go to whoever got there first;
  - eligibility rules and a per-game kill switch apply;
  - the run ends when a round's minimum is missed; the board ranks the total score.
- **Prizes:** Claude recommends a mix across both games (free packs, free grading coupons, free card cases) instead
  of 3/2/1 packs everywhere, weighing cost, motivation, redemption and contract limits.
  - Keep the 6-free-packs-per-Series-per-game cap.
  - Don't change Fold and Flick's prize contract or behaviour without approval.
  - New grading or case coupons must prevent double redemption and abuse.

**12. Integration.**
- **Game Room:** both games listed, each with Free and Competitive.
- **Pack waits and grading waits:** both games offered as choices.
- **Never in the way:** the game never blocks or delays pack or grading completion; the player is told when it's done
  and can go back.
- **Reuse:** the existing integration and game-selection pieces; don't rebuild Fold and Flick.

**13. Art.** ChatGPT prompts for every asset:
- the main factory background, and any depth or interactive layers;
- the straw and the aiming look;
- the wad, and the flattened splat;
- Plank's expressions and poses;
- the hiding-spot elements;
- the moving distractions;
- a sniper scope, if it needs an image.

The background must give real depth and many usable target spots, in Fold and Flick's style. No placeholder art
treated as final; the owner approves the generated art.

**14. Sound.** Claude recommends and implements, subject to owner review:
- air pressure and breathing, the straw firing, the wad in flight;
- a cartoon splat, Plank's reactions;
- the sniper heartbeat and slow-motion audio;
- quiet factory ambience, round transitions and qualifying sounds.

Satisfying, playful, in the factory's mood, never too loud.

**15. Technical.**
- **Priorities:** mobile-first performance, fair controls on phone and desktop, deterministic physics, server-verified
  competitive scores, anti-cheat, reliable rounds and leaderboard, smooth pack and grade waits, predictable targets and
  distractions, clear conditions and scoring.
- **Rules that stay:** age and geo rules; no token flow or burn talk on play screens (Info only); never ask for keys,
  seed phrases or passwords.

**16. Rejected (not without discussing with the owner).**
- Wind.
- Headshot bonuses.
- Golden Planks.
- First-miss-ends-the-run.
- Point deductions for misses or for distractions.
- A single 60 s game with no rounds.
- Auto-advancing before 60 s.
- Locked aim.
- A meter that fills and stays full.
- A separate sniper mechanic.
- Random hit outcomes.
- A setting outside the factory.
- Visible hands.
- Rebuilding Fold and Flick.

**17. For Claude Code.** Review Fold and Flick and the Game Room, then research and plan. Focus on:
1. the aim, sway and pressure feel and fairness;
2. scoring and round difficulty;
3. a convincing factory scene with many spots;
4. the sniper-mode transition;
5. server-verified competitive scoring;
6. Game Room and wait integration;
7. a combined prize recommendation for both games;
8. detailed ChatGPT prompts.

Explain conflicts and risks in plain English. Fun, polished, skill-based, no needless complexity. Nothing goes live,
merges to main, leaves demo mode or changes the finished football game beyond approved integration without the
owner's OK. Present the plan and the open decisions for approval before major implementation.
