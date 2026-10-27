# Handoff: brainstorm the spit-wad game (Omni Cards game room, game 2)

You're brainstorming a mini-game with the owner of Omni Cards (Omni Cardworks). They're on their phone and like short,
direct answers. Ask one question at a time. At the end, hand the owner the filled-in **Spit-wad game brief** (bottom)
to paste back to Claude Code, which will research and build it.

Don't promise anything technical; just capture what the owner wants. If an idea clashes with a rule below, say so and
note it in the brief.

## What exists already

- **Omni Cards:** trading-card NFTs on Robinhood Chain.
  - Packs are bought with PAPER (the site's token) and open after a short random draw (~90 s).
  - The look is a warm, dim steampunk card factory.
  - The mascot is **Plank**, a yellow cartoon wooden plank. His faces are already drawn: resting, blink, surprised and dizzy.
- **The Game room:** a station on the site. It's built for many games, each with:
  - free play (any time, also during pack waits);
  - **competitive runs**: a fixed entry in PAPER per run, set once and never changed;
  - a leaderboard per Series (one place per wallet; ties go to whoever got there first);
  - prizes of up to **6 free packs per Series per game** (Paper Football gives 3/2/1 to the top three);
  - a kill switch per game.
- **Game 1, Paper Football:** done, and the owner loves it.
  - You flick a folded paper football off a paperclip tee through pencil uprights on a workbench, with a painted
    workshop and furnace behind.
  - Wind, distance and a moving goal grow with your streak, and the first miss ends a competitive run.
  - Kick into the furnace and it burns.
- **The new idea (owner's words):** "a sniper game with spit wads, sniping Plank popping out from different spots
  around the shop".
  - The owner wants a **different background** from the football bench.
  - Claude's first mock: aiming a paper straw, Plank popping out from behind things for a moment, the wad arcing and
    dropping with distance, SPLAT on a hit, far hits worth double.

## Rules every game must follow (keep these)

- **Skill, not luck:**
  - every condition is shown before the shot;
  - the same input always gives the same result, because the game server replays each shot to judge it;
  - no hidden randomness in whether a shot hits.
- **Phone first:** one-thumb controls that feel good on a phone, and it also works with a mouse.
- **Short:** a run should fit roughly inside a 90-second pack wait, and start fast.
- **Fair for phone and desktop:** neither gets an edge.
- **Competitive play:**
  - 18+ only, and blocked in some US states (free play is open to all);
  - prizes come only from the leaderboard;
  - never explain where the entry money goes on the play screen (that goes behind Info).
- **No real brands**, nothing gross beyond cartoon spit-wad fun, and family-friendly.

## Brainstorm with the owner (one question at a time)

1. **The setting.** Where are we? Which part of the factory or shop, or somewhere else? Seen from where (lying on a
   desk, behind a crate, up in the rafters)? Day or night, what lighting, and what's lying around?
2. **The shooter.** A paper straw? A pen tube? A rubber-band slingshot? First person, or do we see a hand?
3. **Plank's hiding spots.** Where does he pop out (drawers, crates, behind machines, through a hatch, on a conveyor)?
   How many spots? Does he move, peek, taunt, or duck?
4. **The controls.** Drag to aim and release to shoot? Hold to charge power? Does the wad arc and drop? Is there
   wind, or a fan?
5. **Scoring and the end.**
   - A timed round (e.g. 45 s) or "first miss ends it"?
   - Points for a hit, a headshot, a far shot, a fast shot?
   - Streak multipliers?
   - Decoys (something you must NOT hit), like a cat or the foreman?
6. **Difficulty.** What gets harder as you go: faster pops, smaller or further targets, more decoys, moving targets?
7. **The fun bits.** Plank's reactions (SPLAT, dizzy, angry), wads sticking to things, a hidden bonus target, a
   "golden Plank", combo sounds?
8. **Competitive.**
   - The entry in PAPER (football is 1 PAPER, fixed forever).
   - What makes a run end.
   - How many prize packs (up to 6 per Series) and how they split.
9. **The name.** Spit-wad sniper? Something punchier?
10. **The look and the sounds, in words.** What the scene should feel like, and what the owner wants to hear. Don't
   write image prompts: those come later, after Claude's research round.

## Spit-wad game brief (fill in and hand to the owner to paste to Claude Code)

```
SPIT-WAD GAME BRIEF
Name:
Setting / background (where, from what viewpoint, lighting, what's around):
The shooter (straw / tube / other; hand visible?):
Plank's hiding spots (list) and how he behaves:
Controls (aim, power, release; arc/drop; wind?):
How a run works (timed or first-miss; how it ends):
Scoring (hits, headshots, far shots, speed, streaks, decoys):
Difficulty over time:
Fun extras (reactions, bonuses, golden Plank, etc.):
Competitive: entry (PAPER):        prize packs per Series (max 6) and split:
The look, in words (no image prompts):
Sounds wanted, in words:
Anything the owner said NOT to do:
Other notes:
```
