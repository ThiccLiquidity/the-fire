# Paper Football: art prompts and sound list

The owner makes the images in ChatGPT and grabs the sounds from Pixabay. Claude grades and cuts them, and layers the
game on top. The football, pencils, flight, shadows and the furnace flames stay in code. Every image is shown to the
owner before it's committed.

## Images (ChatGPT)

Run all of them in one ChatGPT chat, so the style stays the same.

### 1. The background (the big one)

Size 1536×1024, landscape.

> Stylized 3D render of a cozy miniature diorama, high-end toy-scale Blender/Cycles look: warm dim steampunk workshop
> palette of honey oak, dark walnut, copper, brass and cream paper; soft global illumination; a single warm 2700K brass
> desk lamp as key light from the upper left front, faint ember-orange rim light from the right, deep warm-brown shadows
> (never pure black, never blue); clean readable shapes, crisp edges, no outlines, no text, no logos, no people, no hands.
>
> Camera: lying flat on a long wooden workbench, the lens two inches above the wood, looking straight down the bench.
> The horizon is exactly at the vertical middle of the image. The bench's oak planks run straight away from the camera,
> and the bench ends about four feet away.
>
> Right behind the far end of the bench stands a large cast-iron furnace with riveted bands and a brick arch around its
> mouth. Its heavy door is swung wide open to the left on its hinge. The mouth glows orange with coals and low flames,
> centred left to right, its bottom edge level with the bench top. Firelight spills across the far end of the bench.
>
> Keep the centre of the bench completely empty: a clear lane, a third of the image wide, running from the bottom
> centre to the furnace.
>
> On the left and right thirds, scattered naturally as if mid-job:
> - pine offcuts and a long ripped strip;
> - curled wood shavings and small piles of sawdust;
> - a chisel and a wooden mallet lying on their sides;
> - a steel square, a flat red carpenter's pencil and a few nails;
> - two crumpled sheets of lined notebook paper.
>
> Behind the furnace, softly out of focus: a tool wall with hanging saws and clamps, shelves of jars, a chain hoist.
> The bench is sharp; the background is soft.

### 2–4. Plank reactions

Attach `plank-256.webp` (on GitHub: `web/art/factory/forge/ui/brand/plank-256.webp`). Size 1024×1536, transparent
background.

> Redraw exactly this character in exactly this style and exactly this silhouette: a flat vector cartoon of a tall
> yellow wooden plank with a jagged broken top, thick uniform black outlines, flat yellow fill with simple olive-yellow
> shading on the left, wood-grain lines and two knots, a marker-drawn face. Full body, standing straight, facing the
> viewer, centred, transparent background, no text. Change only the face: [FACE]

Run it three times, putting one of these in place of [FACE]:
- **Hit:** "eyes as red spirals, mouth a wobbly zigzag, a small yellow wood chip flying off the top right".
- **Surprised:** "eyes wide looking right, mouth a small round 'o'".
- **Blink:** "eyes closed mid-blink, a calm smile".

## Sounds (Pixabay, free, same licence as the site's other sounds)

Download the MP3 of each. Any length is fine: Claude trims and levels them.

| # | For | Search Pixabay for |
|---|---|---|
| 1 | The flick | "paper flick" or "finger flick" (one sharp tap) |
| 2 | The football in the air | "paper flutter" or "paper whoosh" (light, airy) |
| 3 | A doink off a pencil | "wood knock" or "pencil tap" (dry, high "tok") |
| 4 | Hitting Plank | "wooden thud" or "wood hit" (deeper, hollow) |
| 5 | Landing on the bench | "paper drop" or "paper slide" (soft tick and slide) |
| 6 | A miss | "paper crumple" (short) |
| 7 | Big streaks (5, 10, 15) | "small crowd cheer" or "kids cheer" (short) |
| 8 | Room ambience | "workshop ambience" or "room tone" (quiet loop) |

Already on the site, so these get reused: `fire-flare.mp3` (into the furnace), `forge-fire-loop.mp3` (furnace crackle),
`paper-fold.mp3` and `pack-rip.mp3` (the fold intro).

**Getting files to Claude:**
- **Images:** attach them in the chat.
- **Sounds, if the chat won't take them:** in the GitHub app or on github.com on the phone, open the
  `wip/pending-approval` branch, go to `web/art/factory/forge/ui/sfx/`, choose "Add file → Upload files", and commit
  to that branch.
- **Or from PowerShell later:** copy them into that folder in `C:\Users\DubT1\the-fire`.
