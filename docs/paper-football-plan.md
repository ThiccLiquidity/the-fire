# Paper Football v1: Build Plan (revised)

## 1. Verdict in brief

1. **Copy the real game first.** The football is a right isosceles triangle flag-folded from a strip of notebook paper. On the lunch table, one kid held it upright with a fingertip and flicked it with the other hand. The goal was the other kid's hands: thumbs touching made the crossbar, index fingers pointed up made the uprights, and there was no top. We copy that exactly. A paperclip tee stands in for the holding finger (decision 3). Pencil uprights match the finger goal's size: a 5.0 in gap, a 2.5 in bar and tips at 5.5 in. Plank's face sits right behind the goal, just like the face behind the real hands. The score is kept as pencil tally marks on a torn scrap.
2. **Fix "too far away" with the camera and the ball size, not with art.** Put the eye 4.0 in behind the ball and 1.9 in up (just over the ball's top). Make the ball 1.6 in on the long edge, so it fills about 37% of the screen height (0.50H to 0.87H). Set the horizon from where the tee touches the table (0.93H), not from the ball's base. Today the eye is 6.8 in away, the ball is 1.0 in, and it fills 8-10% of a phone screen.
3. **Stay on Canvas 2D for v1.** Map the paper faces with an affine transform, draw the stacked-crease edge in code, and draw the table and backdrop once and cache them. Physics goes into a pure module (`paperfb-sim.js`) so a three.js view can replace the renderer later.
4. **Make the sim deterministic now.** Use fixed 1/480 s integer ticks, integer-quantized raw input samples, our own polynomial trig (sin, cos, atan2), and no `Math.random`, `Math.exp` or `Math.hypot` anywhere in the sim. Ghosts, clips and the paid-run server check all depend on this.
5. **Make power a real skill without inventing a top.** The real goal has no top, so it stays open-topped. Power costs accuracy instead: curve grows with v²·offset, the sweet spot shrinks with power (down to a fixed floor), and loft drops to 34° so short kicks need a soft touch.
6. **Make phone and desktop fair.** Remove the mouse-only aim line. Give the clean band a floor of 7 mm (about 45 CSS px). Calibrate every shot against separate touch and mouse noise models. The server picks the mapping from the shape of the gesture, never from what the client says. Also fix the phone flick: `touch-action:none`, one pointer only, a least-squares velocity, and no `400/H` scaling.
7. **Measure difficulty by predicted make rate.** Build a shot bank for every level up to L40 and set a target make-rate curve that falls to about 5% by L35. Factors unlock in the order kids made the game harder (needs the owner's OK; see §14). Paid runs start at L3.
8. **Paid server: Vercel Functions plus Neon Postgres only.**
   - Each shot comes from an HMAC seed. The server derives the kick from the raw gesture and replays it, and its verdict is final.
   - Real-time timing checks stop anyone from picking the moment the moving posts are centred.
   - A server failure resumes the same paid run; it never hands out a new one.
   - No prize key lives on the server: the owner sends `awardPrizes` from the Foundry keystore.
9. **Legal:**
   - Geo-block 11 states for paid runs, with the list in a config file.
   - Add an 18+ gate.
   - The server signs each `payRun`.
   - Cap paid runs at 10 per wallet per day.
   - Get one lawyer review before the switch is turned on.
10. **No fund-flow wording** on any play or pay screen. Show "1 PAPER" and "a fresh sheet", never where the PAPER goes.

## 1b. The real game, faithfully

**How it was played.**
- Two kids sat across a table and took turns sliding the football with a flick.
- A **touchdown** meant the football stopped hanging over the far edge without falling off.
- A **field goal** or extra point was a kick through the other kid's finger goal: the football stood on one corner, held by a fingertip, and was flicked off the thumb.
- Our mini-game is that field-goal moment, played over and over. The touchdown "hanger" is kept for later (§11).

**The football up close.**
- **The fold:** a notebook sheet torn in half the long way, folded the long way twice into a strip about 1.1 in wide, flag-folded in 45° triangles, with the tail tucked into the last pocket.
- **Shape:** a right isosceles triangle. Long edge 1.6 in, short edges 1.13 in (√2 ratio).
- **Thickness:** 0.09 in at the tuck, tapering to 0.06 in.
- **The edge facing the camera:** 6-8 stacked **rounded crease loops** (U-shaped folds with soft shading) plus a few raw layer edges. No hard dark gaps: a flag fold's edges are folds, not cut sheets.
- **Ruling:** blue wide-ruled lines 11/32 in apart.
  - The lines run across the strip, so on the folded triangle they lie parallel to a short edge: +45° to the long edge on one face and −45° on the other.
- **Margin:** one red margin segment on one face only.
- **Tuck:** a slit on one short edge, with a 0.5 mm shadow.
- **Marks:** a ballpoint doodle of Plank's face (ring eyes and a smile). Ink initials come later (§11).
- **Imperfections:** a 2-3% bow, and corners rounded by 0.04 in.
- **Wear grows with the streak, as decoration only:** streak 3 softens the corners, 5 dog-ears the front point, 8 adds a graphite smudge, 12+ fans the crease loops.

**The fold.** A paid run starts with a fresh sheet (decision 13: 1 PAPER buys one piece of paper). The fold plays over 2.0 s:
1. Tear the half-sheet (rrrip, spiral-binding fringe visible).
2. Fold it the long way twice.
3. Make 5 flag folds at about 250 ms each ("fft").
4. Tuck the tail.
5. Drop the football onto the tee.

Free play can skip the fold with a tap. The fold intro needs the owner's OK (§14).

**The flick.** It feels like a fingernail snapping off the thumb.
- **Phone:** a fast snap kicks; a slow push does nothing.
- **Desktop:** pulling back is cocking the finger, and releasing is the snap.
- **Clean hit:** a crisp end-over-end turn in the paper's own plane: about 1 turn on a short chip and about 3 on a long kick. The ruled face is seen turning at a slight angle (§3). It does not flash.
- **Off-centre hits:** these wobble and roll, showing first one face and then the other.
- **Miss words, in the kids' own terms:** "Wide left" / "Wide right", "Shanked it", "Doink!", "Short", "Duck!". Write them in Kalam handwriting at 18 px or larger. There is no "Skyed it": with no top, a high kick between the uprights is good.

**The uprights.** Pencils sized like the finger goal:
- Crossbar: a pencil lashed level at 2.5 in (the thumbs) with two red rubber bands.
- Uprights: sharpened #2 pencils (the index fingers) with eraser tips at about 5.5 in, standing in a small oak block. Pencils are 0.28 in across the flats.
- Clear gap between pencil surfaces: 5.0 in at the start (thumb-tip to thumb-tip), closing to 2.8 in at L20 and never below 2.4 in.
- **No top:** anything between the uprights and over the bar is good, at any height, as with the real finger goal.

**Plank.**
- He stands 4.5 in behind the posts with his face centred about 4 in up, filling the window above the bar. This is "hit him in the face", the best-remembered part of the game.
- His hit box covers the whole gap (§5), so every make bounces off him (decision 7).
- He has no scoring role (decision 7): no signals and no arms.

**The sounds.**
- Fingernail "tk".
- Paper whisper that pulses twice per turn.
- Light table tick, then a "shhh" slide.
- Woody pencil "tok" for a doink.
- A deeper wooden thunk on Plank.
- Background: quiet room tone only (the forge loop at −26 dB).

**The setting.** The warm workshop bench carries kid-table marks:
- pencil scribbles and a ballpoint tally box;
- masking-tape scrimmage lines;
- eraser crumbs and a coffee ring;
- a couple of forge scorch marks.

Distance zones are named only in inches, because decision 1 shows a distance number anyway.

**Recognisable extras.**
- Distance runs out on a yellow tape measure with inch ticks.
- Wind shows as a notebook-paper streamer taped to the left pencil, plus a small brass dial.
- On a make, Plank only reacts with his face (§10). He never signals.

## 1c. Art direction bible

**North star:** "The paper football you folded at the lunch table, flicked across a lamp-lit workbench inside the Omni Cardworks."

**Palette (site tokens first).**

| Use | Colours |
|---|---|
| Panel | `#15100c`, `#1f1710` |
| Lines | `#4a3626`, `#6b4a2a` |
| Ink | `#f6e8cf` |
| Muted / dim | `#b9a385` / `#8a775e` |
| Brass | `#e9b45a` |
| Ember | `#ff7a2e` |
| Gold | `#ffd27a` |
| Bad | `#ff6b5a` |
| Deepest shadow | `#140905` (never pure black) |

**Paper** reuses `.sg-paper`:
- Paper gradient `#fcf8ee → #f6efdf → #ece0c6`.
- Rules `rgba(84,122,186,.32–.45)`, margin `rgba(214,92,84,.5)`.
- Ballpoint ink `#1c2a6b`, pencil `#8b7a5c`, graphite `#3a3a3a`.
- Edge crease loops are shaded from `#fffaf0` (the lit top of each loop) through `#f1e9d8` to `#cfc3ad` (the underside). There is a soft `#b7a98f` occlusion where loops meet, and no dark gaps.

**Table:** near-to-far `#c9853e → #9a5f2a → #5a3618 → #2a1b10`.

**Pencils:**
- Lacquer `#f2b81d`, shadow facet `#d99a12`, ferrule `#b8a06a`.
- Eraser `#ef8fa6`, cut wood `#e6c08a`.
- Rubber band `#c0392b`.

**RC car:** body `#b23a2a`, tyres `#1d1a17`.

**Plank (brand art, unchanged):**
- Yellow `#f8ea5f`, outline about `#1e190f`, eyes `#cf2d03`, smile `#298f95`.
- Keep the exact plank-256 silhouette in every pose: no arms, no props on him.

**Lighting** (one rig for every asset and every prompt):
- Key: a brass desk lamp at 2700 K (`#ffc478`), upper-left front, lighting a pool about 18 in across centred between the tee and the posts.
- Rim: ember `#ff7a2e` at 30% from the right and behind.
- Fill: cool `#8fa6c8` at 8%.
- Shadows fall back-right. Vignette to `rgba(0,0,0,.45)`.

**Lines.** The scene has no outlines. The only heavy outline is the flat vector Plank. To seat him in the scene, give him a contact shadow `rgba(20,10,4,.5)` and a 2 px ember rim at 40%.

**Depth cues** (all baked; never a per-frame `ctx.filter`):
- **Gameplay objects are never blurred:** the football, pencils, crossbar, rubber bands, RC car and tape.
- Plank: at most 1 px.
- Backdrop: 10-14 px with warm bokeh.
- Table: only the bottom 6% is pre-blurred (below 0.94H, under the tee contact at 0.93H). The ball base and tee stay sharp.
- A sharp contact shadow under the football.
- Depth comes from scale, the warm-to-dark table gradient and the lamp pool, not from blur.

**HUD** (in the scene where possible):
- **Distance:** tape measure plus a brass tag (Russo One `#f6e8cf`).
- **Wind:** a 56-64 px copy of the wait.js gauge (ring `#2a1c10`/`#6b4a2a`, face `#1f1710`, ember needle), with mph underneath.
- **Streak:** pencil tally marks drawn in code on a torn notebook scrap, top-left. Each group is four uprights and a slash, in graphite `#3a3a3a`, 2 px strokes with a slight jitter from the seed. Kalam is used only for words.
- **Labels:** Russo 11-13 px `#b9a385`, letter-spacing .08em.
- **Panels:** `rgba(21,16,12,.82)`, 1 px `#6b4a2a` border, `#e9b45a` inner hairline, 8 px radius.

**POW.**
- A 12-point starburst torn from notebook paper, rotated ±6°.
- Russo One at max(36 px, 0.11H), fill `#fff0d6`, glow `0 0 18px #ff9f2e`, hard shadow `0 3px 0 #2a1405` (the same values as `.bigm`).
- Miss words in Kalam 700 graphite, at least 18 px, on a paper tag. Graphite on paper is about 10:1 contrast, which passes AA.

**Photosensitivity (WCAG 2.3.1).**
- While the football is taller than 15% of the stage, the brightness difference between the faces and the edge stays under 10%. Both faces use the same paper tone.
- Off-centre rolls that flip the faces never create a flash.
- Under `prefers-reduced-motion`, cut face contrast by a further half.
- The make glow (120 ms) and POW are single events, never repeated.

**Particles** (at most 60 alive, all pooled):
- Make: 12 paper confetti bits plus 6 wood chips.
- Doink: 3 pencil shavings.
- Landing: 5 sawdust motes.
- Ambient: 8 embers and 15 dust motes drifting at wind × 4 px/s.
- Under `prefers-reduced-motion`, drop the ambient particles.

**Clutter rule:** the football is always the brightest, sharpest object on screen.

## 2. Camera & scale

Numbers below are for a 390×654 CSS px phone stage, where F ≈ 551 and the posts plane scale at 38 in is 13.1 px/in. They come from the real `proj()`, and a unit test checks them (§7).

| | Now | v1 |
|---|---|---|
| Eye to ball centre (`CAM_DB`) | 6.8 in | **4.0 in** (about 2.5 ball-heights, chin on the table) |
| Eye height `CAM_H` | 1.0 | **1.9 in** (just over the ball's top, so the fold edge reads) |
| `F` | min(1.72H, 1.2W) | **min(0.85H, (W/2 − 16)/tan 18°)** |
| Horizon (`EYE`) | 61-74% | **`0.93H − CAM_H·F/(CAM_DB − 0.26)` ≈ 0.50H** (the tee's table contact sits at 0.93H) |
| Ball on screen | 8-10% H (phone) | **about 37% H: top ≈ 0.50H, base ≈ 0.87H** (the bottom corner is 3.7 in from the eye) |
| Tee / contact shadow | — | **0.93H** (about 46 px above the stage bottom) |
| Pencil tips (5.5 in) at 12 / 38 in | — | **0.31H / 0.43H** |
| Crossbar (2.5 in) at 12 / 38 in | — | **0.47H / 0.49H**, just above the ball's top, so the kick reads as "up through the bar" |
| Clear gap at 38 in | — | 5.0 in → **66 px**; 2.8 in (L20) → **37 px**; 2.4 in floor → **31 px** |

- **Projection:** `s = F/(z − TEE_Z + CAM_DB)`. The camera stays level and centred on the ball's line. Vertical framing comes only from `EYE`, so pencils stay vertical.
- **Near plane:** cull or clamp anything closer than 0.5 in to the eye. This covers a football bouncing back off a pencil or off Plank.
- **Aspect cap:** limit the play area to 16:10 and fill the sides with the blurred wall. A 1280×720 view would otherwise reach a 92° horizontal field of view.
- **Offset limited by angle:**
  - `offset = side·x·tan(6°)·(dist + 4)`, which gives ±1.7 in at 12 in and ±4.4 in at 38 in.
  - Add a lens shift `CX = W/2 − clamp(0.5·postsScreenX, ±0.15W)`, eased between shots.
- **During the kick the camera is fixed.**
  - It holds still for 150 ms, then may push in at most 3% over 250 ms.
  - No chase cam: it is not what a kid's eye does, and a fixed view keeps paid replays readable.
- **Rejected:** the physics specialist's follow-cam and zoom. The verdict stays readable because of the post sizes above, the never-blurred posts, and the 0.25× near-miss slow motion.
- **Shake:** 2-6 px on a thunk.
- **Phone safety:**
  - The ball's base must sit at least max(56 px, safe-area-inset-bottom + 40 px) above the bottom edge. At 0.87H on a 654 px stage this is 85 px.
  - The ball must sit at least 24 px from the left edge.
  - If the stage is under 420 px tall (phone landscape), go full-sheet. Under 320 px, show "Turn your phone upright".

## 3. The football model & look

**Shape conflict resolved.** Specialists proposed long edges of 1.6, 2.0 and 2.8 in. **v1 uses 1.6 in**, a half-sheet strip folded the long way twice. A bigger ball at the same on-screen size pushes the camera back and shrinks the posts, because the ball-to-post ratio is fixed by on-screen size.

- **`TRI`** (in, origin at the centroid): a right-angle corner at the front point, with the long edge nearly vertical facing the kicker.
  - Example corners: bottom (−0.30, −0.78), top of the long edge (−0.14, 0.82), front point (0.44, 0.02).
  - Normalise to exactly 1.6 / 1.13 / 1.13, then re-derive `EDGE_MID`, `EDGE_HALF` and `REST_Y` (using our own sqrt helper, not `Math.hypot`).
- **`THICK`:** 0.09 in.
- **Yaw at rest:** keep `YAW0` at 0.22 rad, so a wedge of the face (2-3 rule segments) peeks through.
- **Showing the broad side in flight.** In today's `rotate()`, the end-over-end turn is pitch about x. The face normal lies along x, so a clean tumble alone keeps the face edge-on to the centred camera.
  - **Fix:** on every kick, yaw eases from `YAW0` to **0.45 rad** within 60 ms of the strike. The sign follows the aim side, or the seed when aim is straight.
  - This shows about 0.35 in of the 0.8 in-deep face turning end over end.
  - Off-centre hits add roll on top, which flips the faces.
  - **Fallback**, if the R1a screenshot strip still reads as a sliver: move the eye 0.6 in to one side and yaw it 8° back in.
- **For physics it stays a point** against the posts' plane and Plank.
  - For the pencil-doink test it has a sideways half-width of `0.045 + 0.4·|sin roll|`.
  - Wear and initials are texture only.

**Rendering.**
- Pre-render a 512 px atlas once per run seed: two faces plus an edge strip, with paper grain noise at 4%.
- Each face: clip, then `setTransform` from 3 projected vertices, then `drawImage`.
- The edge strip: 6-8 rounded crease loops with soft shading (§1c).
- Squash 0.88 across the thickness for **30 ms** at the strike (a time, not a frame count).
- Two ghost copies trail it at 1/240 s and 1/120 s, at alpha 0.22 and 0.10.
- Edge-on, it is never drawn narrower than 1.2 px.
- Paid runs show a faint brass PAPER-scroll stamp at 35% on the inner layer. It only shows while the football tumbles, and has no text.
- **Check in R1a:** a screenshot strip of one clean flight and one off-centre flight (8 frames each), before any art work.

## 4. Input

**Shared module:** `paperfb-input.js` (no DOM), loaded by the client and the server.
- The forge files are classic `<script>` IIFEs with no bundler (index.html, `sync_forge.sh`), so the module uses a UMD-style wrapper: it sets `globalThis.PaperFBInput`.
- A 2-line ESM shim (`paperfb-input.mjs`: `import './paperfb-input.js'; export default globalThis.PaperFBInput;`) serves Node.
- `paperfb-sim.js` uses the same pattern.

**Raw samples.** Quantize before any maths:
- x and y in 1/8 CSS px, as integers;
- time in 1/16 ms, as integers;
- the stage size in CSS px.

All mapping maths after that uses integer or polynomial helpers. The server receives exactly these integers.

**Phone and desktop mappings.**

| | Phone flick | Desktop pull |
|---|---|---|
| Measure | Velocity over 80 ms, weighted least squares, ending at the **last move** (ignore pointerup) | Distance from press to release |
| Dead zone | < 0.35 px/ms, or under 14 px of travel, or no move for more than 40 ms before the up (60 ms on iOS) → no kick, "Flick it!" | Pull < 0.03H |
| Power | `clamp((v − 0.35)/2.25, 0, 1)`, with **no `400/H` scaling** | `clamp((pull − 0.03)/0.35, 0, 1)` |
| Aim | Polynomial `atan2(vx, −vy)` over the 100 ms chord; 1.5° dead zone, 1:1 after it, clamp 22°; reject more than 60° off vertical | Opposite of the pull, same constants |
| Contact | `c = (y − edgeMid)/half`, clamped to [−1, 1]; clean if \|c·half_px\| ≤ cleanBand_px (below) | Same |

**Which mapping is used is decided by the gesture shape, not by the client.**
- A **flick** starts on the paper and moves up fast, ending with a release while the pointer is still moving.
- A **pull** starts on the paper, moves back (down), and releases after a hold of 40 ms or more.
- The server runs the same classifier. The client's `inputKind` is logged as a telemetry hint only.

**Pointer handling.**
- Use `getCoalescedEvents` with `e.timeStamp`. Coalesced events lack `pointerId` on iOS 18.2, so take the ID from the parent event.
- Track one pointer only: ignore `!isPrimary`, and check `pointerId` on move and up.
- Treat `pointercancel` and `lostpointercapture` as no kick. In a paid run this is never a miss.
- On the canvas: `touch-action:none`, `user-select:none`, `-webkit-touch-callout:none`, and `preventDefault` on `contextmenu`. On the container: `overscroll-behavior:contain`.

**Touch fairness.**
- The strike edge must be at least 64 CSS px tall. The new camera gives about 220 px.
- **Clean band:** half-width = max(45 CSS px, sweetEff·half_px), which is at least ±7 mm at every power (§5).
- Accept pointerdown within ±max(28 px, b.s) horizontally.

**Mouse vs touch fairness.**
- **Remove `aimGuide()` and `aimLine`** for paid and free play alike. Nobody gets a drawn aim or power line.
- **Rejected:** hidden random scatter for mouse players. Hidden random noise is chance, which is a legal risk in a paid contest.
- **Noise models**, published on the Rules page:

  | Input | Power σ | Aim σ | Contact σ |
  |---|---|---|---|
  | Touch | 0.12 | 4° | 3 mm |
  | Mouse | 0.04 | 1° | 0.5 mm |

- **Calibration:** the shot bank is calibrated with both models. A level passes only when pRef(touch) and pRef(mouse) are within 3 points.
  - If they are not, tune the desktop mapping without randomness: aim gain, `pullFull`, and a slower pull-to-power curve.
- **Live check:** log the classified input kind with every kick. If mouse make-rates beat touch by more than 5 points at d = 0.3, 0.6 or 0.9 (with 300 or more kicks each), retune the same way.
- Choose the hint text from the last pointer type used.

**Keyboard and assistive play.**
- Focus lands on the paper (it is a `button` with role and label).
- ← / → set aim in 1° steps, and ↑ / ↓ move the contact point.
- Hold and release Space for power: power rises over 0.6 s and is shown only as a growing pencil-line wobble on the tee (no number).
- The keyboard mapping is a third noise model with the same ±3-point fairness gate. Until it passes, keyboard kicks are free-play only, and paid runs say so.
- An `aria-live="polite"` region reads the conditions before each kick ("Wind 4 mph left, 26 inches, posts moving") and the verdict after it ("Good!", "Wide left").

**Feel without a meter.**
- A pencil "x" marks where you hit on the dashed strike line; the last 3 fade like eraser smudges.
- The clean band is a highlighter stroke, and every hit mark carries a shape as well as a colour: a ✓ inside the band, a × outside.
- Haptics go through `Fun.haptics` in fx.js, which respects the Menu's Vibration toggle, with an 8 ms buzz on the flick (cosmetic only). Never raw `navigator.vibrate`.

## 5. Physics constants and feel

All values live in the pure sim, at a fixed `DT = 1/480` s in integer ticks.
- Moving posts read `tick·DT`.
- The sim has its own polynomial sin, cos and atan2.
- Square roots use one shared helper. It is `Math.sqrt` (IEEE correctly rounded in every engine), and the replay test confirms this.

**Gravity and launch.**
- G 386 in/s².
- **Loft 34°.** With no drag the range is 7.3-74 in. A 12 in chip needs about 68 in/s and a 38 in kick about 126 in/s, so short kicks need a soft touch.
- vMin 55 in/s, vMax 175 in/s.
- **Power costs accuracy:**
  - Sweet spot, as a fraction of the half-edge: `sweetEff = 0.6·(1 − 0.3p²)`. On screen it is floored at 45 CSS px (§4), and the floor wins.
  - Sideways curve: `curve = 28·(v₀/vMax)²·c` in/s², where `c` is the contact offset (−1..1). A slightly off strike at full power drifts about 1.5 in over 38 in; at half power it drifts about 0.4 in.
  - Off-centre distance loss: `offPenalty` 0.15·|c| (was 0.32).
- **Result:** full power reaches everything but is unforgiving. The best kick at each distance is about 10-25% above the minimum power, and touch noise (σ 0.12) makes that a real judgment.

**Drag and wind.**
- Drag: `a −= k|v|v` with `k = 0.003 + 0.003·wob` per inch, so a fluttering ball loses distance.
- Wind is relative-air drag (sideways air speed = mph × 17.6 in/s), about 6-8 in/s² per mph. Start with the existing `windK` 7 as a fallback; the shot bank calibrates the final value.

**Spin and wobble.**
- Tumble: `ω = −(0.3·v₀ + 12)` rad/s. That is about 33 rad/s on a 12 in chip (about 1 turn in its 0.2 s flight) and about 50 rad/s on a 38 in kick (about 3 turns).
- In-flight yaw eases to 0.45 rad (§3).
- **Off-centre:**
  - ω × 0.6;
  - roll `0.7·off·sin(2π·6t + φ)`;
  - yaw `0.45 + 0.9·off·sin(2π·4.5t)`.

  φ comes from the seed (it replaces today's `Math.random` `wobPhase`).

**Collisions.**
- **Table:** restitution e 0.25, μ 0.4, then a slide at μG to rest. In free play only, it sometimes ends standing on an edge. This is cosmetic and decided from the seed.
- **Pencils:** radius 0.14 in, swept test, e 0.35, pencil wobble `4°·e^(−t/0.35)·sin(2π·9t)`. The exp decay is view-only and never in the sim.
- **No top:** above the 5.5 in tips, anything inside the uprights' lines counts as good.
- **Plank:**
  - Hit box: `|x − postX(tick)| < half + 0.2` and 0.5 < y < 8.0, at his plane 4.5 in behind the posts. Every make that passes under 8 in hits him.
  - His art is 5.5 in wide. A make near a pencil at the widest gaps gets a glancing thunk off the edge of his board.
  - On a hit: vz × −0.3, vx × 0.5, vy = max(vy, 35), spin × −0.5.
  - A make above 8 in sails over him; POW shows at crossing + 0.15 s.

**Time scale on screen.**
- 30 ms freeze at the strike.
- 0.6× for the first 60 ms of sim time.
- 0.38× for the rest of the flight.
- 0.25× within 2 in of the posts' plane on a near miss (within 0.8 in of a pencil).
- 0.8× after the verdict.
- Result: about 0.6-1.2 s of visible flight and about a 5 s kick cycle, so about 18 kicks fit a 90 s draw wait.

**Make sequence.**
1. At the crossing, the pencils glow `#ffd27a` for 120 ms.
2. The thunk on Plank: 70 ms hit-stop, shake trauma +0.35 (`shake = trauma²`, max 6 px / 1.5°, decaying 1.8 per second).
3. Plank squashes to 0.92/1.06 for 60 ms, then springs at 6 Hz with damping 0.25.
4. POW slams in on the thunk frame: 0 → 1.25 in 80 ms, settle 80 ms, hold 300 ms, fade 150 ms. The word is picked from the seed.
5. One pencil tally stroke is added, with a pencil scratch sound.
6. If there is no thunk, POW shows at crossing + 0.15 s.

**Sounds** (WebAudio, routed through `Sound.ctx/out` so the site's mute works).

| Event | Recipe |
|---|---|
| Flick | 6 ms noise burst through a 4 kHz bandpass (Q 1.2) plus a 2.8 kHz tick decaying in 15 ms |
| Flutter | Bandpass noise centred at 600 + 6\|v\| Hz, gain about 0.04, amplitude modulated at 2× the tumble rate |
| Landing tap | 4-10 ms tick at about 1.2-1.4 kHz |
| Slide | 250 ms noise low-passed at 3 kHz |
| Doink | 1.1 kHz + 3.0 kHz, 150 ms, 9 Hz pitch wobble |
| Thunk | Wood modes at 220 / 607 / 1188 Hz, decaying in 120 / 60 / 30 ms |
| Miss | Paper skid (no buzz) |
| Run start | `paper-fold.mp3` |
| Tally stroke | 300 ms of `pen-scratch-loop` |

- Schedule every sound against `AudioContext.currentTime`, with the time scale applied.
- Under `prefers-reduced-motion`: no shake or zoom, hit-stop at most 30 ms, and lower face contrast (§1c). Slow motion stays.

## 6. Difficulty

**Measure each shot by predicted make rate.**
- `pRef = √(pAvg·pSkilled)`, from 400 seeded simulated flights with two player models (average and skilled).
- Each model is run under **both** the touch and mouse noise models (§4). A shot is accepted only if the two pRef values are within 3 points.

**Target curve:**

`target(L) = 1/(1 + e^−z)`, with `z = 3.6 − 0.17·L − 0.04·max(0, L − 20) + 0.25·[1≤L≤4]`

- The extra 0.25 on unlock levels gives a breather when each new factor arrives.
- The curve gives 55% at L20, 30% at L25, 13% at L30, 5% at L35 and 2% at L40.

**Generator.**
1. Draw split weights `w_f = −ln(1−u)` for the unlocked factors. This runs offline in the bank builder, so `Math.log` is fine there.
2. Set each factor to `x_f = min(cap_f, λ·w_f/Σw)`.
3. Bisect λ for 10 steps until pRef meets the target.
4. Redraw (up to 8 times) if any of these hold:
   - at L20 and below, pSkilled < max(0.5, target − 0.15);
   - above L20, pSkilled < 1.5·target;
   - the needed power is above 0.92;
   - the needed aim is above 17.6°.

**Mapping.**
- Distance = 12 + 26x in, never above 38 (decision 6).
- Wind = ±9x mph, never above 9 (decision 6).
- Half-gap = 2.5 − 1.1x in for x ≤ 1 (gap 5.0 → 2.8 in). Above L20, x may reach 1.25, with a floor half-gap of 1.2 in (gap 2.4 in, 31 px at 38 in on a phone).
- Offset = angle-limited (§2).
- Car: amplitude 4x in (5 in past L20), speed 0.6 + 1.4x (up to 2.2 past L20).

**Caps.** Distance x ≤ 0.25 + 0.05L. Every other factor ≤ 0.15·(L − unlock + 1). Past L20, only the gap and the car can still grow, because distance and wind are at decision 6's limits.

**Unlock order, named for the playground moves** (this staggers decision 6; needs the owner's OK, §14):
- L0 "Chip shot" (distance)
- L1 "Over here" (offset)
- L2 "Fan's on" (wind)
- L3 "Squeeze it" (gap)
- L4 "Hands on the move" (the RC car, from streak 4 as decision 6 says)

Each is announced on a notebook scrap the first time it appears.

**Paid runs start at L3** (needs the owner's OK). Free play and the wait panel start at L0. Practice kicks in a paid run use L3, L5 and L7.

**Telegraphing.**
- Tape-measure ticks are labelled in inches only: 12, 18, 24, 30, 38.
- The car drives during aiming between chalk end-stops.
- Nothing changes once the press starts.

**Level table** (simulated per-kick make rate, %; recalibrate from R3 telemetry).

| L | Target | Avg | Skilled | | L | Target | Avg | Skilled |
|---|---|---|---|---|---|---|---|---|
| 0 | 97 | 96 | 100 | | 11 | 85 | 74 | 96 |
| 1 | 98 | 96 | 100 | | 12 | 83 | 71 | 95 |
| 2 | 97 | 95 | 100 | | 13 | 80 | 67 | 93 |
| 3 | 97 | 94 | 100 | | 14 | 77 | 65 | 92 |
| 4 | 96 | 93 | 100 | | 15 | 74 | 61 | 90 |
| 5 | 94 | 89 | 100 | | 16 | 71 | 57 | 88 |
| 6 | 93 | 88 | 100 | | 17 | 67 | 53 | 84 |
| 7 | 92 | 86 | 99 | | 18 | 63 | 49 | 77 |
| 8 | 90 | 83 | 99 | | 19 | 59 | 45 | 76 |
| 9 | 89 | 80 | 98 | | 20 | 55 | 41 | 69 |
| 10 | 87 | 78 | 98 | | 25 / 30 / 35 / 40 | 30 / 13 / 5 / 2 | sim TBD | sim TBD |

- **Expected runs from L0:** an average player makes about 9 kicks, a skilled player about 18 (about one draw wait). A skilled player reaches L20 about 20% of the time, so the board is decided in L18-35, and the bank must cover it.
- **Shot bank:** 256 balanced shots per level for **L0-40**, built offline (about 85 KB) and frozen per Series. Shots at the same level vary by ±3 points or less, against ±15 today.
- **Repeat runs:** a player's best streak grows roughly with log(number of runs bought). The 10-per-day paid cap (§8) limits this, and it goes in the lawyer brief (§12).

## 7. Rendering tech decision and migration

**Decision: Canvas 2D now.** three.js **0.186.1** is the planned v2 renderer, used only if the owner, after Round 2, says the paper doesn't look real enough.
- That version is npm `latest`, published 2026-09-24, so it is more than 2 weeks old.
- Before adopting it: vendor `three.module.min.js`, measure its gzip size, and run it under the site's `script-src 'self'` CSP.
- Rejected: Pixi (needs `unsafe-eval`), Babylon and PlayCanvas (oversized, use blob workers).
- OGL is plan B if three.js is ever vetoed.

**Steps.**
1. **Split out `paperfb-sim.js`.** A pure UMD module (`shotFor`, `launch`, `step`, `simulate(shot, kick, kickTick) → {events, result, path}`) with integer ticks, seeded RNG, polynomial trig and the shared sqrt helper. Remove every `Math.random` from `kick()` (`wobPhase`) and `settle()` (the POW word); both come from the seed.
2. **Add `web/scripts/paperfb-replay/run.mjs`.**
   - It replays the same kick log at 30, 60, 90, 120 and 144 Hz and at slow-motion 0.55 and 1, and asserts identical results.
   - It also runs in Node and in headless WebKit, Chromium **and Firefox (Gecko)** over 10⁵ quantized inputs.
   - A **real-device gesture corpus** (iPhone at 60 and 120 Hz, an Android phone at 240 Hz touch sampling, mouse) checks that `paperfb-input` maps real gestures fairly, not only that the sim agrees with itself.
   - This test gates paid mode.
3. **Camera unit test.** It reprojects every screen number quoted in §2 from the real `proj()` at 390×654, 430×740 and 1280×800 (aspect-capped). Pair it with Playwright screenshot regression for the same three sizes.
4. **Turn `paperfb.js` into the view** (`paperfb-view2d.js`). It only reads sim state and draws a blend of the last two states.
5. **Cache static layers.**
   - Drawn once per resize into an offscreen canvas: the table, the lamp pool, the vignette and the pre-blurred backdrop. Each table row samples a seamless top-down wood texture at `z = CAM_H·F/(y − EYE)`.
   - Resize redraws are debounced by 150 ms, because dvh changes when the URL bar shows and hides.
   - Per-shot layers (posts, tape, Plank) are cached once per shot.
   - Remove the per-frame `ctx.filter` and gradient rebuilding.
6. **Move the HUD to DOM over the canvas** so it uses the site fonts and carries the `aria-live` region.
7. **Frame budget:** under 8 ms of drawing, with device pixel ratio capped at 2.

## 8. Server, anti-cheat, leaderboard

**Stack.**
- Vercel Pro (Hobby bars commercial use; about $20 a month).
- Node Functions in `web/api/kicks/`.
- **Neon Postgres only**, holding:
  - runs and an append-only kick log;
  - a unique (run_id, n) constraint as the per-shot lock;
  - rate-limit rows;
  - an indexed board table.

  Redis can be added later if load ever needs it.
- Edge Config flags `kicks.paidOpen` and `kicks.judging`, plus the contract's `setPaused`. Together these are the two kill switches.

**Flow.**
1. **`POST /create {wallet}`.** No wallet signature is needed.
   - Checks geo from `x-vercel-ip-country` and `x-vercel-ip-country-region`, the 18+ and residency attestation, and the flags.
   - Rate-limited **per IP only** (20 per 10 min). Per-wallet limits count only **confirmed (paid) runs**: at most 10 per wallet per day. A stranger creating runs for someone else's wallet costs that wallet nothing.
   - Returns the `runId` (keccak of wallet, series and 16 random bytes), an HMAC capability cookie, and an **EIP-712 approval** over (runId, wallet, series, expiry ≤ 10 min).
   - This needs a contract change: `payRun` requires the server signature. FireKicks is not deployed yet, so the change is cheap.
2. **Client:** approve 1 PAPER, then `payRun`.
3. **`POST /confirm {runId, txHash}`.**
   - Reads the receipt with viem and requires a `RunPaid` log from the FireKicks address with the right runId, player and series.
   - Commits `sha256(serverSeed)`.
   - Unconfirmed runs stay claimable for 24 h.
4. **`GET /shot`.**
   - Returns the next shot's conditions and a signed shot token.
   - Stamps the server delivery time t0 and measures RTT with a ping on the same connection.
   - Shot = bank[level][HMAC(serverSeed, n) mod 256].
   - Practice kicks use n = −1..−3 on a separate stream, at L3, L5 and L7, and are allowed only before the first scored kick.
5. **`POST /kick {token, samples[≤48] (quantized integers), kickTick, fieldAspect}`.**
   - The server classifies the gesture (§4), then runs `paperfb-input` and `simulate` itself.
   - **Plausibility:**
     - at least 3 samples and at least 30 ms for a flick; at most 400 ms for a flick and 2000 ms for a pull;
     - the speed rises then falls.
   - **Real-time timing** (this guards the moving posts):
     - The server estimates the release as t_arrival − t0 − RTT/2 − display latency (fixed at 50 ms).
     - The claimed `kickTick` must be within ±150 ms of that estimate.
     - The kick must arrive within RTT + 250 ms of the claimed release.
     - The car's phase runs on server time from t0, so posts can only be "picked" by releasing at that real moment, which is the skill itself.
   - **Shot clock:** 15 s plus 3 s grace, or "DELAY OF GAME".
   - The server's verdict is final. The client animates its own prediction straight away and re-animates if the server differs.
   - **A client-vs-server difference never switches anything off.** It is logged with both inputs, then the client re-animates and an alert goes to the owner. `judging` turns off automatically only if the server's own second Node replay of the kick disagrees with its first, which means the server is broken, not the player.
6. **Run end.** Reveal `serverSeed`.
   - **Server failure mid-run:** the run is **resumed**, not replaced. The client calls `/shot` again with the same `runId` and gets shot `n` from Neon (same conditions, same shot clock reset).
   - No new unpaid run is ever issued.
   - If the server can't resume within 24 h, the owner decides the refund case by hand.

**Board.**
- Table `board(series, wallet, streak, reached_at)`, one row per (series, wallet).
- It is updated only when a judged make beats the stored streak. The tie-break is the server time of the judged make that reached the streak: `ORDER BY streak DESC, reached_at ASC`.
- If a Redis ZSET is added later, use score = `streak·1e12 + (1e12 − 1 − msSinceSeriesStart)`, which is good for 31 years and stays under 2^53.
- `GET /board` with `s-maxage=5, stale-while-revalidate=30`; clients poll every 10 s.

**Anti-cheat, stated plainly.**
- The sim is public, and every shot is shown before the kick, so a script can solve the best kick offline. The checks do not prevent that.
- **The real defences are:**
  - the real-time timing check;
  - rate limits (IP on create, 2 kicks per second per run);
  - the 10 paid runs per wallet per day cap;
  - human review of the top 10 replays before prizes;
  - the 6-credit hard cap per Series in FireCredits.
- **Flags for the reviewer:** run likelihood under the human free-play model below 1e-6, contact within 0.02 of centre on 10+ straight shots, or gesture-duration CV under 5%.
- Flags never auto-ban. Every run stores its tuning hash and core version.

**Prizes.** The board freezes, then the owner reviews at `/kicks/review` (deployment-protected).
- `ops/kicks/award.mjs` re-replays the winners' runs and prints `cast send … awardPrizes(series,[w1,w2,w3],[3,2,1])` for the **owner's Foundry keystore**.
- `prizeAwarder` stays unset (changes the doc; decision 15).
- The `payRun` signer key is the only server key. The owner types it into the Vercel dashboard as a Sensitive variable. A leak only lets someone approve runs that a wallet still has to pay for itself.

**Telemetry (free play, from R3).**
- `POST /api/kicks/telemetry`: anonymous kicks with input kind, quantized samples and result, sampled at 25%, stored in Neon.
- The privacy line goes behind Info/Help ("anonymous kick data to tune difficulty").
- Testers can also use an "Export kicks" button in the tuning panel.

## 9. Site integration

**`wait.js`.**
- `Wait.GAME` stays the switch. The play button shows only when it is true.
- Delete the old `game()` only after migrating `omni.paperfb.<wallet>` localStorage stats (`goals` → `makes`, plus `best`, `kicks` and `points`) into the new key.
- `panel()` lazy-loads `paperfb.js` as soon as it is created.
- Mount with `PaperFootball.mount(stage, {seed, art, audio: window.Sound, mute, onEvent})`.
- Add `destroy()`. Call it from screens.js `openLive` (when `!got?.length`), from grading's cancelled and null branches, and on dialog close. This fixes the leak.
- **Keeper buttons:**
  - Do not clone them, because clones lose their click handlers.
  - Re-parent `msg` into `.pfb-bar` behind a comment anchor, the way the grading branch already does (screens.js around lines 1381-1384: `anchor`, `anchor.replaceWith(msg)`), and put it back on stop.
  - This fixes the hidden-buttons bug (Deal now, Get my packs back, Reveal now, Return ungraded, Try again).

**Cards ready.**
- A DOM banner styled as a folded passed note ("Your cards are ready!" / "Your grades are in!"), plus a go button.
- It waits until any in-flight result settles (at most 1.35 s), never pauses the sim, and pulses the button once after 20 s.
- Keep the existing `free()` contract.

**Classes and layout.**
- Rename `pf-` to `pfb-` (`profile.css` owns `pf-`).
- CSS: `.pfb-stage{height:min(62dvh,520px);touch-action:none;overscroll-behavior:contain}`; on portrait phones `calc(100dvh − 190px)`.
- In landscape, or below 420 px, go full-sheet; below 320 px, ask to rotate.
- Add a ResizeObserver (debounced), and pause when `document.hidden`.

**Entry points.**
- Replace the 🏈 button with an SVG of the folded notebook triangle, labelled "Flick a few while you wait".
- Standalone `Sheet('kicks')` from the Menu (`fun:paperfb`).

**Chain code.**
- `config.ts`: add FireKicks.
- `writes.ts`: `payRun()` = approve 1e18, then `send` with the server signature.
- `reads.ts`: `kicksState()`. `NotDeployedError` means "Board closed for now".
- `live.js`: `payRun()` with the `getPaper` continuation.

**Pay sheet "Kick for the board".**
- Text: "1 PAPER per run · up to 3 warm-up kicks · first miss ends it".
- Button: "Fold a sheet · 1 PAPER".
- If keyboard is not yet fair (§4): "Paid runs need touch or mouse".
- An e2e test asserts that "burn" never appears.

**Board.**
- A notebook-page tab in the sheet plus a "Kickers" tab in `feed.js`.
- Streaks are drawn as pencil tally marks, and the player's own row is circled in pencil.

**Medals.**
- `Profiles.medal()` reads FireCredits `PrizeAwarded` logs (3/2/1 credits = gold/silver/bronze) and shows a foil star sticker on the avatar.
- Trophy shelf in the showcase.

**Badges.**
- `fb-100`, `fb-500`, `fb-10`, `fb-15`.
- Paid streaks come only from server results.
- Remove the dangling `fg` badge calls.

**Demo.**
- The menu game works fully.
- A simulated paid run takes demo PAPER and plays against a demo board of 6 seeded rivals.

## 10. Art pipeline

**Drawn in code:**
- The football and its atlas (crease-loop edge).
- The paperclip tee: silver `#c3c7cc` wire, 0.033 in thick, with a specular line.
- Pencils as a hex prism with 2 faces shown, so the gap can move freely.
- Rubber bands and the wind streamer.
- Tape measure, tally scrap and pencil tally strokes.
- POW burst, shadows, particles, wind dial, and the table projection.

**AI images.**
- Masters are kept in `web/art/paperfb-src/` with `prompts.md` and `grade.py` (PIL: blacks clamped to `#140905`, highlights to `#fff0d6`, midtones warmed toward `#9a5f2a`).
- Shipped as WebP q80 in `forge/ui/paperfb/`, about 650 KB in total.
- Generate the whole set in one ChatGPT thread, attaching `plate-1280.webp` for the scene assets or `plank-256.webp` for Plank.
- The owner sees every image before it is committed.

**Style block** (start every scene and prop prompt with this): "Stylized 3D render of a cozy miniature diorama, high-end toy-scale Blender/Cycles look: warm dim steampunk workshop palette of honey oak, dark walnut, copper, brass and cream paper; soft global illumination; a single warm 2700K brass desk lamp as key light from the upper left front, faint ember-orange rim light from the right, deep warm-brown shadows (never pure black, never blue); clean readable shapes, crisp edges, no outlines, no text, no logos, no people, no hands."

**Prompts.**
1. **Backdrop** (1536×1024, opaque; crop to 1280×720, pre-blur 14 px, brightness 0.5): STYLE + "Camera resting on a long wooden workbench, lens one inch above the tabletop, looking straight down the bench at the far wall of a small steampunk card factory. Left: a riveted iron forge with glowing orange coals and stacked logs. Centre: a brass-and-iron paper press holding three large cream paper rolls. Right: an arched wooden window glowing warm amber; timber framing and copper pipes. The far room is softly out of focus. The tabletop fills the bottom 50% of the frame, empty, with the vanishing point at the image centre 50% from the top."
2. **Wood texture** (1024×1024, seamless): "Seamless tileable top-down photo texture of worn honey-oak workbench planks, 5.5-inch boards running vertically with darker seams, faint pencil scribbles, a ballpoint tally box, a coffee-ring stain, a strip of torn masking tape, a few pink eraser crumbs, light sawdust in the grain, two small scorch marks, even flat lighting, no perspective, no objects."
3. **RC car** (1536×1024, transparent; mirror it in code): STYLE + "A tiny toy remote-control flatbed truck about 4 inches long, glossy deep red enamel body, brass trim and bolts, chunky black rubber tyres with grey hubs, a bent wire antenna with a red bead, an empty flat wooden bed with two brass mounting clamps. Pure side view facing left, camera at wheel height, isolated on a transparent background, no shadow."
4. **Plank reactions** (1024×1536, transparent, attach `plank-256.webp`; never name any show): "Redraw exactly this character in exactly this style and exactly this silhouette: a flat vector cartoon of a tall yellow wooden plank with a jagged broken top, thick uniform black outlines, flat yellow fill (#f8ea5f) with simple olive-yellow shading on the left, wood-grain lines and two knots, a marker-drawn face of two red ring eyes with dot pupils and a thin teal-blue smile. No arms, no legs, no props. Same line weight, proportions and tilt; no background." Then one of:
   - **A:** "eyes closed mid-blink".
   - **B:** "eyes as red spirals, mouth a wobbly zigzag, a small yellow wood chip flying off the top right" (the squash is applied in code).
   - **D:** "eyes wide looking right, mouth a small round 'o'" (the lean is applied in code as a rotation).

   Pose C (the arms-up "it's good" signal) is removed.
5. **Later, a desk fan** (1024×1024, transparent): STYLE + "A small vintage brass desk fan with a cage grill and a strip of lined notebook paper taped to the grill, front three-quarter view at table height, transparent background."

## 11. Fun features ranked

**v1 (by impact over effort):**
1. Notebook-paper football with the stacked-crease edge.
2. Deterministic sim (the enabler for everything else).
3. Camera and scale fix.
4. Plank face reactions with hit-stop and shake.
5. Pencil tally-mark scoreboard.
6. Milestones:
   - 3: "Hat trick!"
   - 5: a star doodled on the football
   - 10: a gold star sticker on the tally scrap
   - 15: "Lunch-table legend" with confetti
   - 20: a gold pencil
7. Sound pass.
8. Fold intro (pending the owner's OK).
9. Kids' miss words.
10. Wear that grows with the streak.
11. Streak PNG card (via share.js).
12. Haptics via `Fun.haptics`.

**Later:**
- Ink initials (3 characters, A-Z and 0-9, blocklisted).
- Re-simulated streak clip (clip.js).
- Daily "Lunch Table" challenge (10 shared shots, free).
- Ghost of your best kick.
- "Hanger" touchdown bonus: slide the football so it hangs over the table edge, as in the real game.
- Desk fan.
- Paper-stock skins by material owned (needs the owner's OK under the "never for luck" rule).
- Leaderboard drama.
- Finger-goal throwback skin.

**Skip:** chat, music, head-to-head, XP.

## 12. Legal and risk notes (not legal advice)

- **Chance:** keep every condition shown before the kick, use balanced banks (±3 points, equal for touch and mouse), no hidden noise, and deterministic replay. The skill story rests on this.
- **Repeat entries:** best-of-N grows with runs bought (about log N). The 10 paid runs per wallet per day cap limits it. It goes in the lawyer brief.
- **Paid runs:** geo-block AZ, AR, CT, DE, LA, MT, SC, SD and TN, plus IN and ME, from a config file. Free play stays open everywhere.
- **Age:** the paid path requires 18+ (19 in AL and NE, 21 in MS), attested at the first paid run and re-checked at prize time.
- **Direct contract calls:** a server-signed `payRun` closes this gap. Without the contract change, the Terms must say: "no server-issued id = void, no refund".
- **Official Rules page** behind Info/Help, versioned per Series. It includes the published input noise models.
- **Prizes:** about $2.50 per pack, cap 6. That is well under the $2,000 reporting threshold for a 1099, so no reporting applies.
- **Entry price:** use the kill switch if 1 PAPER is worth more than $2.50.
- **IP:**
  - Never use NFL marks, "Super Bowl", "Paper Football League" or real brands (Mead, Ticonderoga).
  - Plank resembles the Plank character from a well-known cartoon. Never name the show in prompts, and the owner should weigh this before the paid launch.
- **COPPA:** pitch the look as grown-up nostalgia, never "for kids".
- **Accessibility:** keyboard play, aria-live verdicts, shape-plus-colour feedback, and the photosensitivity limit (§1c, §4).
- **Before the switch:** one fixed-fee review by a gaming lawyer, covering:
  - blocked states and material-element states;
  - the 2025-26 sweepstakes-casino laws in CA, NY, TN and ME;
  - the Rules wording;
  - repeat-entry and per-day caps.

## 13. Build order (what the owner tests on their phone)

**R1a (1 day).**
- Build: new camera with EYE set from the tee contact, the 1.6 in 45-45-90 football, in-flight yaw, removal of `aimGuide()`, the touch fixes, the velocity estimator, and the camera unit test.
- *Test:* the football sits right at the lens and flicks never scroll the page. Show the screenshot strip of a clean flight and an off-centre flight first.

**R1b (2 days).**
- Build: sim split (UMD), fixed ticks, quantized inputs, polynomial trig, no `Math.random`, drag, the new spin formula, loft 34°, the power-vs-accuracy cost, open top, finger-goal post sizes, Plank at +4.5 in with the full-gap hit box, angle-limited offsets, near-plane clamp, and the replay test (incl. Firefox).
- *Test:* full power no longer always wins, and every make bonks Plank.

**R2 (3 days plus art).**
- Build: paper atlas and crease-loop edge, wood table, baked backdrop, code pencils (never blurred), Plank composited into the scene, tape, dial and pencil-tally HUD, the photosensitivity limit, screenshot regression. Generate and grade the art.
- *Test:* does it look like the lunch-table football? Approve each image.

**R3 (2-3 days).**
- Build: sounds, hit-stop, shake and POW, particles, fold intro, milestones, the shot bank to L40 with touch and mouse models, the level curve, keyboard play and aria-live text, the telemetry endpoint (Neon) with its privacy line plus the export button, and the real-device gesture corpus.
- *Test:* feel, whether ~18 kicks fit a wait, and phone-vs-desktop parity.

**R4 (2 days).**
- Build: wait-panel integration behind `Wait.GAME`, the banner, re-parenting `msg`, `destroy()`, the stats migration, the standalone sheet, landscape handling, demo, e2e tests.
- *Test:* open a pack mid-kick, leave, and go straight to the rip.

**R5 (4 days).**
- Build: FireKicks with the signature check, the API on Neon only, the timing checks, resume-on-failure, the board, the per-day cap, the review page and the award script, all on testnet.
- *Test:* a full paid run on testnet, a forced server failure (it must resume), then the board.

**R6.**
- Rules page, geo and age gate, kill-switch drill, lawyer review. Nothing goes live without the owner's OK.

## 14. Open questions for the owner

1. No top, like the finger goal: a kick above the pencil tips but between them is good. OK?
2. Decision 5: may a high or low hit on the edge set loft and spin (as with a real flick), with the sideways curve coming from the swipe's slant?
3. Does a doink that still goes through count as "DOINK… GOOD!"?
4. Paid runs only from the standalone sheet, never during a pack-opening wait. OK?
5. OK to change FireKicks so `payRun` needs the server's signature (geo and age gate), and to start Vercel Pro?
6. Factors unlock one at a time (distance, offset, wind, gap, then the car at streak 4) instead of all at random from the start, and paid runs start at L3. OK?
7. Cap paid runs at 10 per wallet per day?
8. The fold intro at the start of a paid run (2 s, skippable in free play). OK?
9. Demo: add a short 15 s fake draw wait so visitors can see "Play while you wait"?

**Decisions to record once answered** (the doc's rule: every change gets a numbered line):
- **14.** Ties go to the server time of the judged make that reached the streak.
- **15.** `prizeAwarder` stays unset; the owner awards prizes from the Foundry keystore.
- **16.** Paid runs only from the standalone sheet.
- **17.** `payRun` requires a server signature.
- **18.** Staggered unlocks, paid runs start at L3, and 10 paid runs per wallet per day.
- **19.** Fold intro, and the open-topped finger-goal sizes (5.0 in gap, 2.5 in bar, 5.5 in tips).

## Critique notes

All 20 points were valid and have been applied. These were partly adjusted or already handled:

- **#1:** I took the "raise in-flight yaw" option (0.45 rad), not the side-offset camera, which is kept as a fallback. A centred camera keeps the posts symmetric and paid replays easy to read. "Strobe" is also dropped as wrong: a pure end-over-end tumble turns in the paper's own plane, so it never flips faces. Only off-centre roll does. This also covers most of #13.
- **#2:** Confirmed against the real `proj()`. With the finger-goal sizes from #11, the post numbers are now 0.31H/0.43H for the tips and 0.47H/0.49H for the bar. I also cut the table pre-blur from 12% to 6%. Under the new framing, 12% would have blurred the tee and the ball's base.
- **#4 vs #5:** these conflict. #4 asks for a sweet spot that shrinks with power; #5 asks for a fixed ±7 mm clean-band floor. Both are applied: the band shrinks with power but never below 45 CSS px, and the extra cost of power comes mainly from `curve ∝ v²·c`.
- **#5:** "derive input type from samples" is applied as a gesture-shape classifier (flick vs pull). A determined forger can fake either shape, so the real protection is the ±3-point parity gate on the bank: with it, the choice of mapping gives no edge.
- **#7:** atan2, exp and hypot are removed from the sim. `Math.sqrt` stays, because IEEE 754 requires a correctly rounded square root and all three engines provide one. The cross-engine replay test checks it.
- **#11:** the tuck slit was already on a short edge, so no change there. I also corrected the strip to "folded the long way twice" so that it really gives a 1.6 in football.
- **#15:** I chose the "rate-limit by IP before payment" option over SIWE. It adds no extra wallet prompt, and the per-wallet limits count only paid runs. With Redis dropped, the board uses SQL ordering. The 1e12 packed score is kept only for a future ZSET.
- **#20:** checked on npm: three 0.186.1 is `latest`, published 2026-09-24, more than 2 weeks old. The unverified "134 KB gzip" figure was removed, and the CSP check stays as a step.