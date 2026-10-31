# The village: art prompts (built in pieces)

The landing page is a village: five buildings around a plaza, and two empty lots for later. It's made in pieces, not
as one picture: one background with empty foundation pads, then each building on its own, at the same camera angle and
light. Claude puts the buildings on the pads, so each is already its own layer (it glows and lifts when tapped), and the
names and live news go on top as site text.

| Pad | Building | Opens |
|---|---|---|
| Top center (biggest) | **Workshop** | the workshop scene (buy, open, burn, case and grade, suggest) |
| Left | **Arcade** | the Game room |
| Right | **Marketplace** | the market |
| Lower left | **Morning Wood** print shop | the daily paper |
| Lower right | **Trophy Hall** | showcase, binder, badges, pop report |
| Far left, far right | two **empty lots** | buildings added later |
| Center | the plaza and its **infinity monument** | the burn tally sits on it |

## Tips

- **Use a style reference.** If the tool takes a reference image, give it the copper-boiler village picture we liked
  the look of (and, for the buildings, the finished background), so the light and materials match.
- **Same settings for every piece:** the same camera line and light line (below), and the same tool and model.
- Make a few of each and pick. Blank or garbled signs are fine; the site writes the names.
- Send me the background and the buildings as you go; I'll put a test version together early so we can see it working.

## The two lines every prompt uses

**Look:**
> Cozy steampunk fantasy, polished 3D game-art render, warm dusk lamplight from the upper left, dark weathered timber,
> aged copper and brass, glowing amber windows, mossy cobblestone, rich warm color, crisp detail.

**Camera:**
> High isometric camera looking down at about 45 degrees, like a city-builder game. Everything in sharp focus, no blur,
> no depth of field, no horizon.

## 1. The background, desktop (16:9, 3840 x 2160 or the largest you can get)

> [Look] [Camera] An empty village square with no buildings. In the center, a round cobblestone plaza with a bronze
> infinity-symbol sculpture (a figure-eight) on a low stone plinth. Five empty cobblestone foundation pads around it,
> each joined to the plaza by a short cobbled path: one large pad at the top center, one on the left, one on the right,
> one lower left, one lower right. Two small empty fenced grass lots at the far left and far right edges. A cobbled path
> enters from the bottom over a small stone bridge across a stream. Iron lamp posts along the paths, flower beds,
> benches. Dense trees and forest fill every edge of the picture. No buildings, no houses, no people, no text.

## 2. The background, phone (9:16, 1440 x 2560 or larger)

> [Look] [Camera] An empty village square with no buildings, arranged for a tall picture. From top to bottom: one large
> empty cobblestone foundation pad at the top center; below it a round cobblestone plaza with a bronze infinity-symbol
> sculpture on a low stone plinth; an empty pad left of the plaza and one right of it; below those, an empty pad lower
> left and one lower right; two small empty fenced grass lots in the bottom corners; a cobbled path entering from the
> bottom over a small stone bridge. Lamp posts, flower beds, short cobbled paths joining every pad to the plaza. Dense
> trees fill the edges. No buildings, no houses, no people, no text.

## 3. The buildings (one picture each, square 2048 x 2048)

The background came out looking straight down the middle (not diagonal), with the pads already in it, so each building
is front-facing with no pad of its own. Each one ends with this line:
> Seen from the front and above, facing straight toward the viewer, camera looking down at about 45 degrees, perfectly
> symmetrical framing. Shown alone and centered, standing on flat ground with no foundation pad and nothing around it,
> filling about 80% of the picture, on a plain flat light-grey background. Blank wooden signboard over the door. No
> text, letters or numbers.

**Workshop:**
> [Look] [Camera] A two-storey timber-and-brick workshop, the grandest building in the village: big copper boilers and
> brass pipes climbing one side, a tall chimney with smoke, a large brass gear emblem on the front gable, warm forge
> glow through tall windows and wide open double doors, stacked paper rolls and timber by the door. [ending line]

**Arcade:**
> [Look] [Camera] A small arcade hall of dark timber with a little bell tower, a glowing purple neon game-controller
> shape on the front (just the shape), purple and amber light spilling from the windows, a brass coin slot by the door.
> [ending line]

**Marketplace:**
> [Look] [Camera] An open market hall with a red-and-cream striped awning over wooden stalls, crates of trading cards
> and wrapped card packs on the counters, hanging brass scales, lanterns, a small cart with barrels beside it.
> [ending line]

**Morning Wood (print shop):**
> [Look] [Camera] A narrow newspaper print shop: a rolled-paper printing press visible through a big front window,
> bundles of newspapers tied with string on the step, a small newsboy stand by the door, a brass weather vane on the
> roof. [ending line]

**Trophy Hall:**
> [Look] [Camera] A small stone-and-timber trophy hall with columns and a brass dome, tall glass display windows lit
> from inside showing framed trading cards on stands, a red carpet at the door. [ending line]

## 4. A new building later

> [Look] [Camera] [describe it, e.g. "a harbor master's office with a lighthouse lamp on its roof"] [ending line]

## 5. Seasons (later)

Edits of the finished background and of each building, same size and layout:
- **Winter:** "Same picture at night in winter: snow on roofs and trees, paths swept clear, icicles, windows glowing
  brighter, light snowfall, wreaths on the doors. No text."
- **Festival:** "Same picture at sunset during a festival: bunting, lanterns, small striped tents, confetti. No text."
