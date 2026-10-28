# Spit-Wad Sniper: Build Plan (draft for owner approval)

> Built from `docs/spitwad-brief.md` and seven specialist reports, then revised after an adversarial review. Nothing here changes Fold and Flick except its displayed name and the shared selection pieces. Where reports disagreed, the choice and the reason are marked **Decided:**.

## 1. Verdict in brief

1. **Units are inches and seconds, the same as game 1.** Plank is 16 in tall. 1 PL (one Plank-length) = 16 in. Hiding spots are 3 to 30 PL away.
2. **The view:** you crouch on a balcony above the press floor. The stage is one portrait 2:3 frame on every device, so phone and desktop see the same view.
3. **Pressure is a 3.0 s soft-triangle breath on real time.** Targets ask for pressures between 0.3 and 0.9, so no shot needs a rushed release and none sits on the steady top. Gravity is 0.5 g and the straw points 6° above the crosshair. With those settings, full pressure misses most targets, so each distance needs its own pressure.
4. **Sniper mode keeps the same controls and adds a fixed 2.5× zoom.** The world slows to 6/16 speed. Breath and sway stay on real time.
5. **The round clock runs on world time.**
6. **The sim is deterministic.** `spitwad-sim.js` runs at 480 Hz in integer ticks, with its own trig and quantized input. The server replays every shot, and its verdict is final.
7. **Canvas 2D for v1.** WebGL only comes in if the phone frame-rate test fails.
8. **Prizes:** game 2 gets a real mix (packs, gradings, cases). Fold and Flick keeps 3/2/1 packs unless you say otherwise. Coupons must be added to FirePsa before FirePsa is deployed.

## 2. The scene and hiding spots

- **Viewpoint:** a balcony 4 PL above the floor, tilted down 10°, with a 50° vertical field of view. The horizon is at y ≈ 31%. On a 390 px wide stage (585 px tall), Plank is about 614/d px tall (d in PL), which is 38/d px per inch.
- **Plate:** `ui/spitwad/hall.webp`, 1024×1536.
  - Phone portrait: fit to width.
  - Landscape or desktop: fit to height, with mirrored, blurred, darkened side wings (the same trick as `paperfb.js` `backdrop()`).
  - The Game Room tile uses the band from y 18% to 56%.
- **Bands:** foreground 3 to 7 PL, midground 8 to 16 PL, background 18 to 30 PL.
- **Keep-out zone:** the full width below y = 80%. On a phone the crosshair can't reach that strip, and the straw lives there.
- **Spots:** the plate prompt names 13. The aim is 15 or more after fitting, with at least 15 required.
  - Foreground: crate gap, tool chest, open drawer, cabinet edge, carton pile.
  - Midground: press platen, under the press, card-stock shelf, flywheel gaps (a still wheel), boiler, pipe run.
  - Background: loading arch (slide), catwalk (slide), paper-roll gap, wall hatch.
  - Spots are refitted to the plate that comes back. Any spot that fails `cut_layers.py --check` is moved or dropped.
- **How Plank appears:** Pop, Drop, Lean, Slide, Peek.
- **Exposure tiers:** Full (80% or more visible), Half (40 to 60%), Sliver (12 to 25%). h means the exposed *vertical* height. A side-lean sliver is narrow but tall, so it has Full-like pressure tolerance; a top-peek sliver is 3 in tall.
- **Size rule** (at 390 px stage width): the narrow side must be at least 4 px and the long side at least 8 px, and the narrow side at least 12 px in the scope. The distance limits come from this rule: side slivers work out to about 24 PL and top-peek slivers to about 15 PL. `--check` enforces both.
- **Occluders are cut from the plate itself.** The outlines are traced in `web/art/spitwad-src/masks.json`, and `cut_layers.py` writes the `occ-*.webp` cut-outs and the hit masks.
- **Moving in code:** conveyor slats (the belt is painted plain) and steam (visual only, 30% opacity or less). **The flywheel stays still** apart from a glint, because spinning a cut-out over painted spokes doesn't work.
- **Far Planks** are drawn at 0.85 brightness with a warm haze. His outline keeps him readable.

## 3. Controls: aim, pressure, sway

**Aim**
- **Where the crosshair appears:** 0.12·H above the press point (H = stage height) on **both phone and desktop**. On desktop the cursor is hidden while the button is held.
- **Drag:** `target = anchor + 0.60·(pointer − pointerAtPress)` in stage-height units, which is 30° per full-height drag.
- **Weight:** the crosshair follows a critically damped spring with ω = 60 rad/s, which reaches 95% in 79 ms.
- **Release:**
  - The release time comes from `event.timeStamp`, so 60 Hz and 120 Hz screens get the same precision.
  - Pointer samples from the last 30 ms before release are ignored.
  - A hold under 120 ms is a tap and cancels.
- **The aim never locks.**
- **Pointer handling** is copied from game 1: `touch-action:none`, one pointer, `setPointerCapture`, `-webkit-touch-callout:none`, `user-select:none`. `pointercancel` means no shot.

**Pressure** (the breath, on real time)
- **Shape:** a soft triangle with a 3.0 s period, rising 0→1 over 1.5 s, with cosine-rounded corners (0.12 s) only at 0 and 1.
- **Target pressure:** `p* = 0.3 + (16·d − 48)/720` (d in PL). That gives 0.30 at 3 PL and 0.90 at 30 PL. The soonest any target can be released is 0.45 s after the press.
- **Sight zero:** `Z(p) = max(12, 48 + 720·(p − 0.3))` in. The straw points α = 6° above the crosshair.
- **Launch speed:** `v = sqrt(g·Z / sin 12°)`: 211 in/s at Z = 48, 668 in/s at Z = 480.
- **Flight time to the zero distance:** `sqrt(2·Z·tan 6° / g)`: 0.23 s at 3 PL, 0.51 s at 15 PL, 0.72 s at 30 PL.
- **Tolerance:** `Δp = ±(h + 0.8)/(2·75.4)`. The 0.8 in comes from the mask growth.

| Exposure | h | Δp | Time window |
|---|---|---|---|
| Full | 16 in | ±0.111 | ±167 ms |
| Half | 8 in | ±0.058 | ±88 ms |
| Top-peek sliver | 3 in | ±0.025 | ±38 ms |

- **Full pressure:**
  - Full pressure overshoots a Full target by more than 8 in from 6 to 28 PL, and overshoots a Half target at every distance.
  - Foreground Full targets (3 to 6 PL) stay forgiving on the high side. This is deliberate: they are the 6-to-8-point easy shots.
- **Sim test:**
  - For every Half and sliver target, and every Full target beyond 6 PL, no more than 40% of the breath may hit.
  - If phone tests show ±38 ms is too hard, top-peek slivers get a minimum height of 4 in (±45 ms).
- **Gauge:**
  - A 270° breathing ring (22 to 30 px radius) with a notch at p*, as wide as that target's window.
  - The notch is green and has bracket ticks (a shape, for colour-blind players).
  - It never fills and stays full.

**Sway** (real time, the same every press)
- **Formulas:**
  - `x = Ax·cos(2πt/3.0)`
  - `y = Ay·(2p − 1) + settle(t)`
  - `Ax = min(0.25° + 0.04°·(r − 1), 0.65°)`, `Ay = 0.6·Ax`
  - `settle = −1.2°·(1 − t/0.5)²·cos(8πt)` for t under 0.5 s
- **What it looks like:** one sway per breath, tracing a shallow tilted S back and forth. The sight is stillest at empty and full breath and moves fastest at mid-breath.
- **Why a rushed release misses:** the settle bounce, the spring lag and mid-cycle motion, all visible on screen.

## 4. Physics and hit testing

- **Flight:**
  - Gravity is 193 in/s² (0.5 g), with semi-implicit Euler at 480 Hz of world time.
  - The wad is a sphere of radius 0.3 in.
  - No drag, no wind.
- **Starting point:** the physics starts at the eye. The drawn wad blends from the straw tip onto the real path over 80 ms. It is drawn at least 3 px across with a short trail (drawing only).
- **Hit test:**
  - The scene is a 2.5D stack of flat cards at fixed depths. Each depth crossing is interpolated to the exact point.
  - Cards are tested near to far, and the first solid one wins.
  - The masks are 0.25 in cells, grown by the wad radius plus 0.1 in.
- **Plank's masks** come from a single body silhouette (`plank.webp`), never from the face art. The hit result can't depend on which face is showing.
- **Storage:** everything goes into one generated file, `web/art/factory/forge/spitwad-scene.js`. Its SHA-256 is part of the sim's `VERSION`.
- **Plank's slide:** in 0.15 s, hold, out 0.20 s, in 1/16 in steps. Each appearance takes one hit.
- **Clock:** all input is in real 480 Hz ticks. World ticks come from an integer accumulator: +16 per real tick normally, +6 in slow motion, and the world steps each time the accumulator reaches 16.
- **Code:** `spitwad-sim.js` and `.mjs`. The trig is copied from `paperfb-sim.js` and checked by a parity test. The sim never calls `Math.sin`, `exp`, `pow` or `random`.

## 5. Sniper mode

- **Trigger:** at 120 ms after the press (so a tap never zooms), if the crosshair is within 6% of H of an appearance that:
  - is at least 15 PL away;
  - has at least 1.5 s of world time left (that covers reaching p*, the flight and a 0.15 s margin).
- **Dealer rules:**
  - Only one qualifying appearance at a time, and at most 8 per round.
  - Round 1 always has one, in its second half.
  - Qualifying appearances show a spyglass on their tag.
- **Zoom:** fixed 2.5× over 0.30 s (ease-out cubic). In the scope the crosshair stays at the centre and dragging pans the view, at 0.6 / 2.5 per screen distance.
- **Slow motion:** the world speed eases 16→6 over 96 *real* ticks.
  - What slows: Plank, his timer, the round clock, critters, the wad and the splat.
  - What doesn't slow: breath and sway.
- **Cap:** only the hold is capped, at 3 s of real time. After that the world eases back to normal speed while you keep holding. A wad in flight always finishes in slow motion.
- **Exit:** starts 0.25 s after the wad resolves and eases over 0.25 s.
- **Round length:** a typical round runs about 12 s longer in real time; the worst case is about 27 s.
- **Server:** it rebuilds the clock from the press and release ticks. The client never says it was in sniper mode.
- **Scope look:** a brass ring (92% of the short side, `ironPlate` gradient), a vignette and an amber wash, a thinner reticle, and a 3% heartbeat breathing on the vignette.
- **Reduced motion:** a 0.12 s crossfade and no vignette breathing. Slow motion stays.

## 6. Scoring and rounds

```
points = max(5, round(10 · Ft · Fs · Fr · Fm))
Ft = (2.0 / e)^0.8      e = hittable window (world s), 0.5–4.0, 0.05 s steps
Fs = (1 / v)^0.6        v = sqrt(f) · 3 / d
Fr = 1 + 0.033 · (d − 3)
Fm = 1 + 0.4 · min(s, 1.25)
```

- **Lookup:** values come from a fixed-point table per spot. The tag shows the value when he appears and it never changes.
- **No** headshot bonus, golden targets or miss penalty.
- **Feasibility (dealer):**
  - Every window must be at least `0.35 + time to reach p* (world, slow motion included) + flight(d) + 0.15` s.
  - Outside sniper mode that is about 1.1 s at 3 PL and about 2.6 s at 30 PL.
  - The flat 0.9 s floor becomes `max(0.9, feasibility)`. `spitwad-tune.mjs` checks every dealt round.
- **Typical values:** 6 to 8 for a close Full. About 150 at the top (a moving side sliver at 24 PL in sniper mode). Far values are lower than in the draft because far windows can no longer be short.
- **Minimums:** `minimum(r) = 5·round((50 + 14r + r²)/5)` from round 4. Rounds 1 to 3 use 65/70/85 (see Q3). After round 20 the step is about +55 per round.
- **Re-run in build round 3:** the minimums are re-tuned against the new value table there.

| Round | Appearances | Window (avg) | Distance (PL) | Moving | Minimum |
|---|---|---|---|---|---|
| 1 | 14 | 2.6 s | 3–8 | 0% | 65 |
| 3 | 15 | 2.45 s | 3–10 | 0% | 85 |
| 6 | 16 | 2.2 s | 3–13 | 10% | 170 |
| 10 | 19 | 1.9 s | 4–17 | 50% | 290 |
| 15 | 23 | 1.55 s | 5–23 | 60% | 485 |
| 20 | 28 | 0.9–1.6 s | 6–30 | 65% | 730 |

- **Expected run length:** casual about 3 rounds, average about 8, expert about 18.
- **Competitive re-deal:** a round more than ±5% off its target total is re-dealt from the same seed, up to 3 tries. After that the closest deal is used.
- **Rounds always run the full 60 s.**

## 7. Distractions

- **Fixed paths in `spitwad-scene.js`:**
  - roaches on the roof truss, the pipe top and the floor (on a straight path, because the art is side view);
  - the cat on the catwalk (grooms for 1.5 s) or on the balcony crates;
  - a mouse along the skirting;
  - conveyor cargo.
- **The seed picks** the path, direction, start, speed (one of 3) and pauses.
- **How often one crosses Plank:** 5% + 1% per round, capped at 25%.
- **Fairness:**
  - A critter is on screen at least 1.0 s before it reaches a live spot.
  - Plank stays clear for at least 60% of each appearance.
  - Hits are judged at the impact tick.
- **Hitting one** gets a gag. There is no penalty.

## 8. HUD and screens

- **Top bar** (8 px from the top, at most 52 px tall), in flip digits:
  - ROUND on the left.
  - TIME in the centre, with a brass bar. The last 10 s turn `#ffb07a` and tick; the last 3 s pulse.
  - SCORE on the right.
- **Goal rail:** `ROUND 120 / GOAL 300`. Once met, a lamp lights and it reads `GOAL MET · 340` with a ✓ icon.
- **Value tag:** a brass tag showing `+45`, plus the spyglass when the appearance qualifies.
- **In the scope:** everything but TIME fades to 30%.
- **Hint line:** "Hold to aim · let go to spit" on phones, "Click and hold · release to fire" on desktop.
- **Between rounds:** the summary. Free play continues on a button, or automatically after 8 s, but the timer doesn't start while the pack banner is up.
- **Run over:** score, total, board place, Play again, Back.
- **Timing cues:** sound and vibration carry no timing information; the ring carries everything.
- **Reduced motion:** stops the pulse, the digit flips and the vignette breathing. Sway stays, because it is gameplay.
- **Hidden tab:** cancels a held press. Free play pauses. In competitive play, coming back fast-forwards to server time and missed appearances simply pass. Audio resumes on return.
- **Settings:** a visual offset of −60 to +60 ms that moves only the drawn needle.
- **No fund-flow text.**

## 9. Server, anti-cheat, leaderboard

- **`_lib/games.js` kinds:** `paperfb` is `streak` (untouched); `spitwad` is `rounds`. The round logic goes in `_lib/rounds.js`.
- **Endpoints:**
  - `round`: returns the spots, a token, t0, the first 5 s of appearances and the shots already judged.
  - `ping` (every 1 s) and `fire` replies reveal the next 5 s.
  - `close`.
- **Shot body:** `{token, cap, i, kind, downTick, releaseTick, samples}`. `kind` is `shot` or `cancel`: every press is sent, taps included, so the server clock never drifts.
- **Judging:** the server replays the shot twice. If the two replays ever disagree, judging switches off.
- **Timing checks:**
  - The release must be within 250 ms of `arrival − rtt/2 − 50`.
  - At most 4 fires per second.
  - `close` is accepted at or after the rebuilt round end, minus 250 ms.
  - An unclosed round auto-closes at t0 + 210 s. An idle run ends after 24 h.
- **Late shots:**
  - A shot up to 2 s late marks the run `timing:unverified`: it stays on the board but is **held from prizes until you review it**.
  - Game 1 rejects late shots outright. Game 2 is looser because one dropped packet in a 20-minute run shouldn't erase the run.
- **Storage:** `game_rounds`, `game_fires` (append-only), and a `score` column. The board updates at round close and at run end, not on every hit.
- **Review flags (never an automatic ban):**
  - reaction under 180 ms, consistently;
  - releases dead on p*, consistently;
  - sway cancelled almost perfectly;
  - a hit rate over 90% after round 8.
- **Replay viewer:** you can watch top runs before `award.mjs`.
- **Plainly:** screen-reading bots can't be fully stopped. The 5 s reveal, the review flags and the prize caps limit what they can gain.

## 10. Site integration

- **`games.js`:**
  - The new entry: `{id:'spitwad', gameId:2, kind:'rounds', name:'Spit-Wad Sniper', entry:'1 PAPER', rules, scoreLabel:'Score', statsLine}`.
  - `Comp.play` stays as it is. A new `playRounds` is added and picked by `kind`.
  - The board shows `score ?? streak`.
- **`wait.js`:** two equal tiles, last-played game on the left. Waits are free play.
- **Banner:**
  - When the pack or grade is ready, the amber `gm-bar` sits below the 52 px HUD and plays `fire-flare` (held until the scope closes).
  - It offers **Rip your cards →** or **See your grades →**, plus **Keep playing**. Keep playing stops `onGo: stopGame` from ending the run.
  - Nothing pauses and nothing is delayed.
- **Rename to "Fold and Flick":** display text only, in `games.js`, `ui.js`, the aria-label in `paperfb.js`, `_lib/games.js`, `info.js` and the docs. The slug, files, keys and API path stay `paperfb`. No alias.
- **Chain:** `addGame(2, 1e18, 10_000_000)` (1 PAPER, at most $0.10) opens the game at once, so it is followed straight away by `setGameOpen(2, false)`. Pack prizes also need `FireCredits.setPrizeGame(2, true)`.

## 11. Prizes across both games

**Recommendation.** Prices used: pack $2.50, grading $1, case $0.05.

| Place | Spit-Wad Sniper | Fold and Flick |
|---|---|---|
| 1st | 2 packs + 2 gradings + 2 cases ($7.10) | 3 packs (unchanged) |
| 2nd | 1 pack + 2 gradings + 2 cases ($4.60) | 2 packs |
| 3rd | 1 pack + 1 grading + 1 case ($3.55) | 1 pack |
| 4th–5th | 1 grading + 1 case each ($2.10) | none |
| 6th–10th | 1 grading each ($5) | none |

- **Cost:** game 2 about $22.35 per Series (4 packs, 12 gradings, 7 cases). Fold and Flick stays $15. Total about $37.35. The 6-pack cap holds.
- **Fold and Flick:** gets the same mix only with your OK.
- **FirePsa contract change, required before FirePsa deploys** (`setPsa` can be set only once):
  - non-transferable `gradeCoupons` and `caseCoupons`;
  - `awardCoupons`, which works only on closed Series and is capped at 12 gradings and 20 cases per game per Series;
  - `protectWithCoupons`, sharing `_protect`;
  - no refund of a coupon on cancel.
  - About 80 lines, Foundry tests and an audit-prep row.
- **Shipping:**
  - Game 2 can launch on packs only (2/1/1) if the coupons aren't ready.
  - The coupon decision is needed before FirePsa deploys, not before game 2.
- **Abuse:** one person with several wallets can farm places 4 to 10. Each run costs 1 PAPER, the prizes there are small, and the review flags and eligibility rules apply. Even so, the risk is real and is reviewed by hand before `award.mjs`.
- **Rejected:** coupons in FireCredits, server-signed vouchers.

## 12. Art: ChatGPT prompts and workflow

**Workflow**
- Use one ChatGPT chat for the set, and attach `ui/paperfb/bench.webp` first.
- Claude makes `layout-guide.png` (grey boxes) to attach with P1.
- Masters go in `web/art/spitwad-src/`, graded with a copy of `grade.py`, and ship as WebP q80 in `ui/spitwad/`.
- **Grading checks** reject fake transparency (a painted checkerboard or no partial alpha) before you ever see the image.
- **Lock the plate before tracing.**
- Sprite frames are aligned by the bottom-centre of each alpha box.
- You see every image before it is committed.

**STYLE:**
> "Stylized 3D render of a cozy miniature diorama, high-end toy-scale Blender/Cycles look: warm dim steampunk workshop palette of honey oak, dark walnut, copper, brass and cream paper; soft global illumination; a single warm 2700K brass desk lamp as key light from the upper left front, faint ember-orange rim light from the right, deep warm-brown shadows (never pure black, never blue); clean readable shapes, crisp edges, no outlines, no text, no logos, no people, no hands, no lemon or saturated yellow."

**P1 `hall.webp`** (attach `web/art/spitwad-src/layout-guide.png` and `ui/paperfb/bench.webp`; 3 variations). The guide is
drawn from the game's own camera (`layout-guide.html`; `layout-guide-labelled.png` numbers the 14 places and shows
16 in Plank boxes):
> STYLE + "Paint over the attached grey block-out exactly: keep every object where it is, at the same size, and the
> same camera. Match the look of the other attached render. Portrait 1024x1536. A miniature toy-scale card factory
> seen from a balcony, looking down at its floor. Left, nearest: two stacked wooden ream crates with a narrow dark gap
> between the top two. Just behind them, left: a small open tool chest with its lid propped up. Right, nearest: an
> oak cabinet with its top drawer pulled open and empty, and a low pile of twine-tied cardboard cartons in front of
> it. Across the middle: a conveyor with a plain smooth dark belt. Centre right, behind it: a brass card press with a
> flat platen on four open legs. Left middle: a still cast-iron flywheel with open spokes on a dark iron stand. Right
> middle: a tall shelf of cream card-stock reams with gaps between them. Far right: a riveted copper boiler. High
> right: a copper pipe run. Far wall, softer and hazier: a wide amber-lit arched doorway in the centre, an iron
> catwalk across the whole wall with a solid toe-board, two tall stacks of paper rolls on the catwalk at the left with
> a dark gap between them, and a small open dark hatch high on the right. The bottom fifth is plain floor, then a
> copper handrail across the very bottom. Warm, dim, everything in focus. No characters, animals, people, signs, text,
> numbers or labels."
- **The full P1 as sent to the owner (Oct 27)** adds the positions of every object as percent of the image (measured
  from the guide's camera): arch x 39-61% y 23-44%; catwalk y 35-38%; paper rolls x 3-28% y 21-35%; hatch x 78-84%
  y 21-24%; pipes x 61-100% y 23-25%; ream shelf x 67-92% y 27-45%; boiler x 84-100% y 34-51%; flywheel x 3-30%
  y 37-59%; press x 56-84% y 54-65%; conveyor x 3-97% y 65-75%; tool chest x 3-19% y 64-73%; crates x 0-35%
  y 70-80%; cabinet and cartons x 64-97% y 68-80%; plain floor y 80-100%, handrail y 92-100%; horizon 31%, wall
  meets floor 44%.

- **Added clutter (owner, Oct 27: "more clutter, nothing moving but Plank and critters; he pops out from all over"):**
  ceiling truss y 4-6%; hanging lamp x 16-22% y 2-7%; crate hung on a chain x 46-54% y 12-17%; mail cubbies (6x3)
  high on the wall x 0-31% y 13-21%; pallets x 32-40% y 45-49%; barrel x 37-45% y 50-57%; sacks x 37-49% y 57-61%;
  ink drums x 63-71% y 47-54%; ladder against the shelf x 61-67% y 26-62%; twine spool x 87-99% y 59-68%; scrap bin
  with crumpled paper x 31-45% y 70-82%. About 30 hiding spots in all (the cubbies alone give several).

- **Plate chosen (owner, Oct 27): version 1 of 3,** kept as `web/art/spitwad-src/hall-master.png` (1024x1536). It
  follows the guide closely and has every object (catwalk railing, paper-roll gap, hatch, boiler, ladder, drums,
  spool, cubbies, hung crate, open drawer), plus a lamp in the arch, two wall lanterns and a few paper balls on the
  floor. Spots are refitted to it next.

**P2–P5: Plank's faces only** (attach `plank.webp`):
> "Draw only a cartoon face for the attached character, at exactly the same scale and position as his face: thick black marker lines, red ring eyes with dot pupils, a thin teal-blue mouth. Nothing else: no body, no outline, transparent background. Face: [FACE]"

- **The [FACE] values:** peek (pupils hard left, sly smile), slide (narrowed eyes looking left, flat mouth), duck (eyes squeezed shut, wobbly grimace with teeth), dizzy (one spiral eye and one x, wavy smile, tongue out).
- Each face is composited onto the existing body. `plank-hit` and `plank-surprised` are reused.

**P6 `straw.webp`:**
> STYLE + "A plain plastic soda straw seen first-person: its mouth end leaves the image at the bottom-centre edge, and it runs foreshortened up and to the right, its open tip ending about 80% down and 70% across. It stays inside the bottom-right quarter. White with two thin red spiral stripes. No hand, lips, cup, logo. Transparent background, no shadow."

- The pivot point is measured from the returned image.

**P7 wad, P8 splat, P9 roach sheet (2×2), P10 cat sheet (3×2), P11 mouse sheet (3):** the same texts as the draft, with "same ground line" kept and the frames aligned in code.

**Drawn in code:** the scope ring, crosshair, gauge, tags, HUD, slats, steam, trail and stars.

## 13. Sound list

**Now (Oct 29): synthesized in the game itself (spitwad.js, WebAudio, no files):** breath in, spit "pft" with the wad
whistling off, splat + boing on a hit, wooden tok on a miss, a pop when Plank shows, "nyah-nyah" when he gets away,
cat "mreow" and mouse squeak, a sparkle on a streak, ticks in the last 10 s, the round whistle, a bell run for the
goal and a sad "wah-wah" at time. Any of them can be swapped for a recorded file later. The list below was the
original plan with Pixabay files.


- **WebAudio:** pressure hiss, heartbeat locked to the breath, last-10 s tick, slow-motion muffle. All of it is decoration; none of it carries timing.
- **Pixabay** (`sw-`, credited in `credits.json`):
  - puff, whiz, splat, boing, dizzy, pop, duck, tap-wood, tink;
  - roach, cat-hiss, meow, squeak;
  - slowin, slowout, whistle, steam, roll;
  - **spy** (qualifying appearance) and **ding** (goal met), now two separate sounds.
- **Reused:** `press-loop` 0.35, `conveyor-loop` 0.4, `forge-fire-loop` 0.2, `grade-stamp`, `card-flip`, `ui-click`, `fire-flare`.
- **Levels:** one-shots at −16 to −23 LUFS, loops quieter.

## 14. Build order (you test each round on your phone, then "Push?")

1. **Grey-box feel prototype:** straw, crosshair, ring, sway, targets at 4, 12 and 25 PL, debug readout.
2. **Sim and tests:** golden vectors, Node/Chromium parity, the 40% hit-share test, the feasibility test, and the touch-vs-mouse bot (within 3 points). The layout guide and P1 go to you in parallel.
3. **The plate:** masks, `--check`, spots, appearances, tags, one free-play round, and the scoring re-tune.
4. **Sniper mode.**
5. **Full rounds,** distractions, sounds.
6. **Game Room,** wait tiles, banner, rename.
7. **Server rounds and competitive** (demo, chain switch off), plus the replay viewer.
8. **Prize work, if approved.**

## 15. Risks and conflicts in plain English

- **Phone vs desktop:** both use the same offset, and release times come from the event. The bot gap must be within 3 points, and live data is retuned if it goes over 5.
- **Top-peek slivers are hard** (±38 ms). The knob is a 4 in minimum height.
- **ChatGPT won't match the guide exactly.** If fewer than 15 spots pass, the plate is re-rolled.
- **Sniper mode stretches a round** by about 12 s in real time (27 s at worst). Server deadlines allow for it.
- **Bots that read the screen can't be fully stopped.**
- **`addGame` opens game 2 at once.** Close it in the same step.
- **FirePsa coupons must be added before FirePsa deploys,** or never.
- **Canvas 2D at 2.5× zoom could drop frames.** Under 50 fps means WebGL.

## 16. Open questions for you

1. Round clock on world time? (Recommend: yes.)
2. Should a moving Plank pay up to +50%? (Recommend: yes.)
3. Rounds 1 to 3 at 65/70/85 instead of the formula's 65/80/100? (Recommend: yes.)
4. Free play pauses only when the tab is hidden? (Recommend: yes.)
5. An expert run of about 20 minutes? (Recommend: keep.)
6. Plank 16 in tall, gravity 0.5 g, straw 6° above the sight? (Recommend: yes; these fix every tolerance.)
7. The prize mix for game 2, with Fold and Flick unchanged, plus the FirePsa coupons? (Recommend: yes; the fallback is packs only.)
8. Re-deal competitive rounds that are off target, up to 3 tries? (Recommend: yes.)

## Owner decisions (Oct 27, 2026)

1. **The round clock slows in sniper mode**, with the world and Plank. Breath and sway stay real-time.
2. **A moving Plank pays about +25%** (not +50%). Keep it simple; tune during balancing.
3. **Rounds 1-3 minimums are 65 / 70 / 85.**
4. **Free play pauses only when the tab or app is hidden.** No pause button. Competitive never pauses (server time).
5. **No round cap.** Every round's minimum must stay realistically achievable: balance and test the late rounds.
6. **Physics starting values approved:** Plank 16 in, gravity 0.5 g, straw 6° above the sight (tune in testing).
7. **~~Prizes become a ticket system~~ — reversed the same day (Oct 27):** no tickets and no prize shop. Paying back
   less than people spend per run felt scammy. Spit-Wad Sniper gets a **top-three leaderboard like Fold and Flick:
   3, 2 and 1 free packs** per Series. The ticket research is kept for the record in `docs/ticket-economy.md`.
   - **Prizes are modular (Oct 27):** the owner sets each place's prizes per game per Series (packs, grading coupons,
     cases, any mix), locked when the Series starts and shown on the leaderboard. Fixed ceilings in code.
   - **6 prize packs per Series in total, across all games** (replaces 6 per game). Coupons and cases go in FirePsa
     before it deploys.
   - **Prize types: pack credits, grading coupons and cases only (Oct 27).** No airdrops of current packs or cards.
   - **Hard ceilings per Series, across all games, fixed in code:** 6 pack credits, 20 grading coupons, 50 cases.
   - **Prize split approved (Oct 27), per game, each Series:** 1st 2 packs + 4 gradings + 10 cases; 2nd 1 pack +
     3 gradings + 8 cases; 3rd 3 gradings + 7 cases. Both games together use the full 6 / 20 / 50. Set in
     `ops/games/prizes.json` and shown from `places` in `games.js`.
10. **Leaderboards (Oct 27), for every game:**
    - **This Series:** best score per wallet, **from one Series' launch to the next** (so it covers the quiet
      suggestion stretch when nothing is printing). Its places win the prizes.
    - **All time:** a public board of each wallet's best ever per game, no prizes. Both show the player's profile
      name and picture, else the short wallet address. Server: `board?series=all`.
8. **Off-target competitive rounds are re-dealt** (more than 5% off: re-deal from the same seed, up to 3 tries;
   deterministic and server-verifiable).
9. **No exemption from the PAPER burn rule:** every priced group, the PLANK group included, sends at least 10% to
   buy and burn PAPER. A PLANK group can still burn up to 90% of its PLANK alongside that: the two shares must add up
   to at most 100%.

## Feel test results (Oct 27, 2026)

From the grey-box tests (feel: https://claude.ai/artifact/PkyjHtVkZaHh2gMZ3WDdpK, action:
https://claude.ai/artifact/MQNgfGmWQYKVjd7dqgdoD1). The owner played both and approved the direction.

1. **The crosshair sits up and left of the thumb** (about 95 px up, 55 px left; mirrored by a "Thumb: left" setting),
   and moves 1:1 with the thumb so the thumb never covers it. A mouse aims at the pointer. Smoothing is the stable
   kind (no spring that can blow up on a slow frame).
2. **A flatter, faster wad:** the straw points 3° above the sight (was 6°), about 22 m/s on a far shot. The breath
   maps twice as steeply (`SPAN = 1440`), so the timing window is the same width as before.
3. **More action:** several Planks up at once (2, then 3 late in the round), a Plank riding the conveyor (+25%),
   critters crossing (roaches, a cat; a gag, no penalty), hit-stop, screen shake, SPLAT text, dizzy stars, streak
   callouts (3/5/8/12 in a row; looks only, no points), Plank taunts when he gets away (the streak resets), steam,
   sparks, a flickering lamp and a moving belt.
4. **The shot looks like a spit-wad:** the straw kicks, a puff and spit droplets leave the tip, a lumpy creased wad
   tumbles out with a wet trail, and lands as a flattened wet splat with a damp ring and a drip.
5. **Fit the phone:** every hiding spot sits inside the view of a phone-width screen (the first grey box had the near
   spots off its sides).

## Build v1 (Oct 27, 2026): free play in the Game room

- **Art pipeline:** `web/art/spitwad-src/cut_layers.py` cuts the occluders out of `hall-master.png` (GrabCut, dark-pixel
  masks for the rail/flywheel/cubbies, straight rects for the truss/pipe/chest) and cleans the Plank faces (ChatGPT
  renders on black, all the same body as `plank-master-raw.png`; each is checked against it). It writes
  `web/art/factory/forge/ui/spitwad/` (hall.webp, occ-*.webp, plank-*.webp, scene.json; about 550 KB) and, with
  `--preview`, `preview-1/2.png` showing every spot. Spots live in `spots.json` (plate pixels plus depth).
- **23 spots**, the drawer dropped (it read as Plank standing on the cabinet): crate, chest, scrap bin, cabinet, belt
  (ride), press, spool, barrel, flywheel, ink drums, pallets, boiler, far crates, paper-roll gap, catwalk (walk),
  doorway (walk, a silhouette), wall hatch, three cubbies, hanging crate, truss (drop), pipe (drop). Every still spot
  hits when aimed right in a scripted test; moving ones need a lead.
- **Faces:** idle, blink, duck (a wad coming), splat (hit), dizzy (sinking after a hit), taunt (getting away). Sly
  and surprised aren't used yet.
- **Engine:** `web/art/factory/forge/spitwad.js`: hits are judged where you see them (each occluder's own pixels, then
  Plank's box, in depth order); a 2.2x scope while holding (the world pans under a still crosshair); 60 s rounds
  with the planned goals (65/70/85, then the formula); several Planks at once (2, up to 4 late); critters; the
  feel-test effects; placeholder synth sounds.
- **Game room:** Spit-Wad is game 2, free play only (`comp: false`); Paper Football is now shown as **Fold and Flick**.
- **Next:** the server's round judging and competitive runs (plan §9), the sound set, wait-panel tiles.

## Fixes (Oct 28, 2026): dead hits, the look of the spots, the straw, the edges

- **Cut-outs traced by hand.** The automatic cuts that went wrong (the flywheel's dark cut took the dark wall between
  its spokes, the rail's took the gap between the paper rolls, the rects drew wall over Plank under the pipe and the
  chest) are now polygons in `spots.json` (`"cut": "poly"`: polygons, ellipses and thick lines, drawn in order, `sub`
  cuts a hole): crate, chest, cabinet, press, spool, flywheel, far crates, pipe, rail and the hanging crate.
  `cut_layers.py --only a,b` rebuilds just those (GrabCut comes out a little different each run).
- **`cut_layers.py --check`** (also run after every build): at every spot, with Plank fully out, every visible pixel on
  a 2 px grid is shot with the breath in the green notch; at least 95% must hit him, or it fails. It is a port of the
  game's flight and hit test. Every spot passes (lowest: the paper-roll gap 96.6%, the pipe 96.9%; the far crates went
  from 39% to 100%). `web/scripts/games-test/spitwad.test.mjs` runs the same check in Chromium with the game's own code.
- **Hits are judged against what is drawn.** A wad only stops on a cut-out the game is drawing over a Plank or a
  critter right now (the same rule that draws it). Wads and splats are depth-sorted with everything else; a splat on
  a cut-out stays on its pixels, a splat on Plank stays on him. A miss at the Plank you aimed at says OVER or SHORT.
- **The shot goes where the crosshair is,** sway and all (the sway used to be dropped at the release), and a notch shot
  lands on the crosshair: the launch speed is solved so the arc comes back onto the aim ray at his depth (it used to
  land 1 to 5 px low). Releasing while a wad flies fires another one (it used to be ignored).
- **The spots:** the crate and the cabinet hide him behind their whole shape; the hanging crate has him pop up out of
  its top; the doorway's silhouette is lighter with a warm rim light; the cat walks the catwalk behind the rail.
- **Edges:** once the scope is on, the view eases the target toward the middle (it may pan into the side wings); near
  the screen's edge the thumb offset shrinks so the edge stays in reach; a Left/Right thumb button (phones) flips it;
  the scope's drag is 1.25x the thumb as meant (it was 0.8x); points tags stay clear of the top bar.
- **The straw** is a 3D striped paper straw (true perspective, helix stripes, shading), points more than halfway to
  the crosshair, and fades while you aim low.
- **Difficulty:** round 1 deals near spots (to 200 in), round 2 to 340 in, then all, with about 1 Plank in 5 from anywhere in rounds 1 and 2 (a few far shots early); points are 6 (near) to 26 (far
  and peeking), so a far hit is no longer most of a goal (goals 60/70/85, then 5·round((40 + 12r + 0.6r²)/5)); a
  Plank stays out at least long enough to aim, breathe to the notch and fly there.
- **Speed:** the blurred side wings are drawn once per resize, and Plank's shadow, haze and rim light are made once
  per face and spot instead of every frame. The desktop stage is 2:3 and as tall as the sheet allows.

## Re-audit fixes (Oct 28, 2026)

- **The hanging crate:** its cut-out is the crate body only (the chain stays in the plate, behind him), so Plank pops
  up out of the crate top in full instead of a yellow scrap behind the bottom chain link. `cut_layers.py --only
  hungCrate` rebuilt it; the check says 100% hittable.
- **The plate sits under the top bar** (38 px), so nothing up top (the hanging crate, his tag) hides under it.
- **Moving Planks are fair:** a riding or walking Plank stops dead and ducks while a wad aimed near him is on its way
  (he used to move further during a flight than half his width, so a dead-centre shot missed), and a wad also counts
  where he was at the release. The belt is a little slower (80, was 90). Tested in `spitwad.test.mjs`.
- **The scope at the edges:** the side wings are brighter and only lightly blurred, darken away from the plate, and
  melt into it (no hard seam); the back wall (500 in and more) zooms 3x (2.2x before); the reticle is four ticks
  around an open middle wider than the Plank you aim at, with a dot at the exact aim and the breath ring outside the
  ticks; his points tag moves above the ring instead of under it.
- **The straw** is shorter (3.8 in on a phone, 5.5 on a desktop) and points 85% of the way to the crosshair.
- **Reaching the bottom:** the crosshair sits 60 px above the thumb on a short (landscape) screen, 95 px otherwise,
  and less near the bottom edge, so the bottom of the view can be aimed at.

## Critique notes

- **Accepted in full or adapted:** points 1 to 35. Notes on the adapted ones:
  - **Point 1:** α went to 6°, not 8 to 10°. At 8 to 10° the Full window shrinks to about ±90 ms. Instead, gravity went to 0.5 g, pressure is limited to 0.3 to 0.9, and the breath is 3.0 s. Foreground Full targets (3 to 6 PL) stay forgiving on the high side, on purpose and stated openly.
  - **Point 3:** the trigger is 1.5 s rather than 1.4 s, because of the new flight times.
  - **Point 6:** I used both the proximity rule and one-qualifier-at-a-time.
  - **Point 16:** I did both: cancels are sent, and slow motion starts only after 120 ms.
- **Rejected:**
  - **Point 33's "cut the scope ring look":** only the engraving was cut. The ring itself is cheap Canvas and makes the sniper moment.
  - **Point 32's "ship option A first" as the default:** I kept the mix as the recommendation, with packs-only as the fallback. The timing pressure is FirePsa's deploy date, not game 2's.