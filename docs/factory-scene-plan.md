# Factory scene: plan

The site's main scene is the steampunk card workshop: the look stays, but the details and layout change to match the
mint, and the art is made so every part animates cleanly. This plan was built from three audits (Oct 4): the
minting story, art-for-animation, and the defects in the first prototype
(https://claude.ai/artifact/4ECANsMnUThsMHYKiKLDMu).

## 1. The story, left to right

Logs go down the chute into the furnace (PLANK is the wood). The fire drives a boiler, a piston and the flywheel; a
gearbox turns the press. PAPER feeds the press (the minter needs paper). The press stamps a sealed pack onto the
belt; at the end of the belt a brass pneumatic tube shoots it up and out of the room: delivered to the buyer's wallet.
Fuel comes in top-left, packs leave top-right.

## 2. Layout changes (art)

| Change | Why |
|---|---|
| **Remove the crate at the end of the belt.** Add a **brass pneumatic delivery tube** rising from the belt's end up through the top-right corner, with a capsule hatch at the belt and a blank brass tag. | Packs go straight to the buyer's wallet; a storage crate made no sense. A capsule whooshing up reads as "sent to you", even on a phone. |
| **Scrap crate becomes an iron ash bin** (same spot), with a **blank brass dial** on its rim. | A fire in a wooden crate is wrong. The dial shows "n / 42.0". |
| **Suggestion box off the wall; a freestanding brass pillar post box on the floor** where the crate was, at the end of the runner rug, with a small glass window. | Reachable. The rug becomes its path. |
| **One counter board:** replace the small wall plaque with a **framed blank chalkboard** right of the press. Remove the plate on the press. | Fire #, packs left, holders-first / open, sold out, drawn in code. |
| **A blank 24-hour drop dial on the furnace hood.** | Shows the holder window: an amber arc that empties, then "OPEN TO ALL". |
| **A real drive train, every visible gear moves:** a steam cylinder + piston drives a crank on the flywheel; the flywheel shaft goes into a gearbox beside the press with **3 face-on meshing gears** (16, 32, 32 teeth, same tooth size); a chain drives the belt's head pulley. **Remove every other gear** (beside the press, at its right shaft, by the window). | Nothing that looks like it should turn stands still. Face-on gears can be rotated cleanly; edge-on ones can't. |
| **A small paper feed tray on top of the press**, feeding the paper roll. | PAPER goes into the minter (logs into the fire). *To confirm with the owner.* |
| Keep everything else: walls, window, lanterns, shelves, plants, log piles, rugs, both desks, stools, the boiler and its gauge. | The look the owner loves. |

## 3. What players see

| Action | Animation |
|---|---|
| Buy | Logs slide down the chute (plus PAPER sheets into the press tray); the fire flares; the piston pumps, the flywheel and gears speed up; the rollers roll; the press stamps; a sealed pack drops onto the belt under the rollers; the board ticks down. |
| Delivery | The pack reaches the tube, drops into a capsule, whooshes up and out. A small "+1 in your wallet" toast. |
| Holder window | The drop dial's amber arc counts down 24h with "HOLDERS FIRST"; then "OPEN TO ALL". |
| PLANK-only packs | A tag on the chute "PLANK ONLY 12/50"; drops off after. |
| Sold out / closed | The last stamp, the belt stops, the fire banks to embers, the board reads SOLD OUT (or CLOSED), the open bench's padlock falls off. |
| Open (after the Fire closes) | Your sealed packs sit on the open bench (from your wallet), padlocked until then. Lamp on, a pack slides to the pad, tears open, 6 cards fan out. |
| PSA reveal | A card slides under the magnifier, the lens glows, a stamp comes down; the card shows its wear frame and grade colour. |
| Burn | A card flips into the ash bin with a puff; the dial ticks n/42.0; at 42 a brass free-pack token pops out. Your credits show on the open bench. |
| Suggest | A slip drops into the post box; its window fills. After a picking session the box empties. |
| Idle | Low fire, slow flywheel, belt still, lanterns sway. Between drops the board reads "Next Fire soon". |

The Buy button in the bar stays the main way to buy; clicking the furnace is a shortcut. Exact numbers also live in
the bar (chalk text is too small on a phone).

## 4. Art rules (so nothing looks transparent or static)

- **Every image is an edit of one master**, in the same ChatGPT chat. 3840×2160 PNG. The area outside the room is
  flat #1E2530. Each edit changes only what it lists; the rest stays pixel-identical (checked with a diff).
- **Moving parts come as separate sprites** on flat #00FF00, front-on, solid and opaque, no shadow or glow. No more
  cutting parts out by comparing two images (that's what left the see-through holes).
- **The clean plate** has a flat dark recess behind each moving part, no flames (dark firebox with embers), belt
  slats only, and keeps the warm room light (the code adds only a gentle flicker, not a second glow).
- Static parts in front of moving ones (the flywheel stand, press columns, belt rails, chute walls, the tube's
  hatch) are cut from the master with hand-drawn masks, which are exact because every image is aligned.

## 5. Code fixes for the rebuild (from the defect audit)

Fire: cap the flame size, clip to the real arch, keep the grate lip in front, render sharper. Rollers and belt: tile
only the flat paper face and the slats; rails, end caps and curves stay still. Flywheel: real rim fit, steel bars, no
spill. Gears: drawn in front of the machinery, all turning. Glows: about 60% weaker, no hard edges. Packs: about 80 px
wide (the art's size). Chute: fuel clipped to the chute, fading into the furnace. Load the plaque font properly. A soft
floor shadow under the machinery.

## 6. Steps (each shown before the next)

1. New master (prompt A). I check it.
2. Clean plate (prompt B). I check alignment and that nothing else changed.
3. Sprites (prompt C).
4. I build the scene from them and send a clip.
5. Stations' real screens, then the contracts.

## 7. Prompts for ChatGPT

**A. New master** (attach the current full image):

> Edit this image; don't redraw it. Keep the exact same camera, style, lighting and everything not listed. Output
> 3840×2160 PNG; the area outside the room flat #1E2530.
> 1. Remove the wooden crate at the right end of the conveyor. Put a brass pneumatic tube there: a capsule hatch at
>    the end of the belt, the tube rising up the right wall and out through the top-right corner of the frame, with a
>    small blank brass tag on it.
> 2. Replace the wooden crate with flames at the far left with an iron ash bin of the same size, with a small round
>    blank brass dial on its rim. Keep the flames.
> 3. Remove the wooden box from the wall by the window. Put a freestanding brass pillar post box on the floor at the
>    bottom right, at the end of the runner rug, with a small glass window and a mail slot.
> 4. Replace the small plaque area right of the press with a framed blank chalkboard on the wall. Remove the brass
>    plate on the front of the press.
> 5. Add a small round blank brass dial on the furnace hood, below the chute.
> 6. Rebuild the drive between the flywheel and the press: a horizontal steam cylinder with a piston rod driving a
>    crank pin on the flywheel; the flywheel's shaft goes into a gearbox on the left side of the press, which shows
>    three meshing gears facing the viewer (one small, two large, same tooth size). A chain from the gearbox to the
>    conveyor's first pulley. Remove all other gears in the room.
> 7. Add a small paper feed tray on top of the press, feeding the paper roll.
> Change nothing else.

**B. Clean plate** (attach the new master):

> Edit this image; don't redraw it. Same everything, 3840×2160. Make only these changes:
> 1. Remove the flywheel, the piston rod, the crank rod and the three gears in the gearbox; behind each, a flat dark
>    matte recess.
> 2. Furnace and ash bin: no flames, just a bed of glowing embers. Keep the warm light in the room.
> 3. Empty the chute and the paper tray. No packs anywhere. Conveyor slats only. Roller paper plain.
> 4. Chalkboard, tags and dials blank.
> Change nothing else.

**C. Sprites** (one image, items spaced apart, nothing touching):

> On a flat pure #00FF00 background, same art style, materials and lighting as the workshop: (1) the flywheel seen
> perfectly face-on: rim, 6 spokes, hub; (2) three gears face-on: 16 teeth, 32 teeth, 32 teeth, same tooth size;
> (3) the piston rod and the crank rod, side view; (4) a conveyor pulley disc face-on; (5) a brass delivery capsule;
> (6) a padlock with a short chain; (7) a brass coin token with a flame; (8) three split logs and three sheets of
> paper at different angles. Solid, opaque metal and wood, no transparency, no shadows, no glow, no background
> objects. Large and sharp.

## 8. Status (Oct 4): built

Built from ChatGPT's new master, clean plate and sprite sheet in `web/art/factory/originals/` (aligned, 3840×2160).

- `cut_sprites.py` keys the sprite sheet into `build2/`. `build_scene.py` makes `build3/`: the plate (clean plus
  the lit gauge copied from the master), the flywheel stand occluder, the chain-free belt, the chain strands, the
  roller print layers and the colour-matched sprites. Neither script draws anything.
- `scene.html` is the animated scene (open it from `web/art/factory/` with a local server). Published as the
  "Omni Forge" artifact.
- Mine, by agreement: the flames, glows, sparks, embers, steam, screen shake, chalk text and dial readings.
- Owner's calls since the plan:
  - logs slide down the hopper chute and vanish into the hood. The fire fills the opening and flares brighter (not
    bigger) as wood drops.
  - burning a card throws it from the open bench into the ash bin.
  - the sold-out show: a flash, a fire burst, steam from every vent, the board blinking SOLD OUT.
- Next: the buttons and logo, then the station screens wired to the contracts.
