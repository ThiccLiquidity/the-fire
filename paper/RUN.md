# The nightly run

The Morning Wood is written the night before by a **scheduled Claude Code task** on the owner's plan (no API bill).
Code does the gathering, the numbers, the pictures, the layout and the publishing; Claude does the editing and the
writing, with each writer as its own subagent so the voices don't blend.

```
gather (code) -> editor: budget + assign (Claude) -> writers pitch ~10 headlines each (subagents) -> editor picks
-> writers write (subagents) -> copy desk (subagent) -> draft.json -> inject numbers (code) -> images (code)
-> check (code) -> layout (code) -> pin + preview link (code) -> owner veto window -> on sale at 6am for 24h
-> remember (code)
```

| Step | Command | Output (paper/out/<date>/) |
|---|---|---|
| Gather | `node paper/gather.mjs --date <date>` (`--mock` for a dry run, no network) | `newspack.json` |
| Inject numbers | `node paper/inject.mjs --date <date>` | `issue.json` (from `draft.json`) |
| Images | `node paper/images.mjs --date <date>` | `img/*`, `issue.json` updated |
| Check | `node paper/check.mjs paper/out/<date>/issue.json` (`--draft` on the draft, `--publish` before publishing) | errors / ok |
| Layout | `node paper/layout.mjs --date <date>` | `front.svg` (NFT image), `preview.html`, `metadata.json` |
| Preview | `node paper/publish.mjs --date <date> --preview` | IPFS folder + preview link |
| Publish | `node paper/publish.mjs --date <date>` (dry run) then `--send` | `MorningWood.publish(number, uri, opensAt)` via `cast --account editor` |
| Remember | `node paper/remember.mjs --date <date>` | `paper/memory/*` |

`<date>` is the morning the paper is sold (tomorrow, when run at night). Issue number = days since 2026-10-22, plus 1
(`LAUNCH_DATE` to change). The format is `paper/schema/issue.schema.json`; the site renders it.

## Setup (once, by the owner)
- Keys go into the scheduled task's environment settings (or `paper/.env`, git-ignored), never chat:
  `TWITTERAPI_IO_KEY`, `IMAGE_PROVIDER=openai` + `IMAGE_API_KEY` (any OpenAI-compatible image API),
  `IMGFLIP_USERNAME`/`IMGFLIP_PASSWORD` (free account), `PINATA_JWT`, `RPC_URL` (Alchemy recommended). See
  `paper/.env.example`.
- The editor key: `cast wallet import editor --interactive` on the machine that publishes; then the owner calls
  `MorningWood.setEditor(<editor address>)`. The editor key can only publish/re-publish unopened issues.
- Schedule: every night ~22:30 America/New_York. The task needs network access to the feeds, TwitterAPI.io, the image
  API, Imgflip, Pinata, Open-Meteo, CoinGecko, the Robinhood Chain RPC and Blockscout.
- Publishing on chain from the scheduled task is **off until the owner says so** (step 10 stops at the preview link
  until `PUBLISH_FROM_TASK=1` is set).

## The prompt the scheduled task runs

```text
You are the night desk of The Morning Wood, a daily satirical newspaper (docs/morning-wood.md). Tonight you make
tomorrow's paper. Work in the repository root. Read CLAUDE.md, docs/morning-wood.md, paper/desk/house-style.md,
paper/desk/editor-in-chief.md and paper/desk/copy-desk.md first. DATE = tomorrow's date in America/New_York
(YYYY-MM-DD). OUT = paper/out/DATE.

1. GATHER. Run `node paper/gather.mjs --date DATE`. Read OUT/newspack.json in full. If meta.notes shows a source
   failed, carry on with what you have; if markets.sample is true, the chain could not be read: note it for the
   owner (the issue cannot be published with sample numbers).

2. BUDGET AND ASSIGN (you, as editor-in-chief). Follow paper/desk/editor-in-chief.md steps 1-2: the budget for all
   seven sections (front, plank, tanggang, crypto, trending, markets, back), each item with its news-pack source and
   a one-line angle, assigned to a writer.

3. PITCH. For each writer with items, start a separate subagent (one per writer, so voices don't blend). Give it:
   its persona file paper/staff/<writer>.md, paper/desk/house-style.md, its assigned items with the relevant
   news-pack excerpts (posts, headlines, summaries; for Hemingwood the markets block and the token list from
   paper/lib/tokens.mjs), and memory.runningJokes + memory.recentIssues. Ask for about 10 headlines with one-line
   decks, marking any roast.

4. PICK. Choose the best headlines per editor-in-chief.md step 2 (funniest first, then variety of tone and target,
   roughly one roast in three). Plan the front page (step 3): the lead and its huge picture.

5. WRITE. Send each writer (same subagent, or a fresh one with the same inputs) its picked headlines with the target
   length (house-style.md) and, for pictures it owns, ask for the image spec: kind ai (a scene prompt, never a real
   identifiable person), meme (exact Imgflip template name + caption boxes) or staff (a card character or workshop
   scene). Kurt Vonneplank also writes the editorial and all 12 horoscopes; Mark Twine the weather ear and the
   weather quips using {{weather.<City>.highF}} style tokens; Ernest Hemingwood the markets report using {{tokens}}
   only, never typed digits.

6. COPY DESK. Start a copy-desk subagent with paper/desk/copy-desk.md, house-style.md, all the persona files and
   every piece. It scores, punches up or kills, and returns final texts plus its note. Fill any section left empty
   with a brief or a meme. Read its note.

7. ASSEMBLE OUT/draft.json in the issue format (paper/schema/issue.schema.json): date, number (= newspack
   meta.number), title "The Morning Wood", motto "Hard News, Every Morning", edition, price {paper: 1, usd: 0.05},
   status "draft", weatherEar, pages[] in order front (broadsheet), plank, tanggang, crypto, trending, markets
   (blocks ["markets"]), back (blocks ["letters","classifieds","horoscopes","weather","staff"]) — all tabloid with an
   accent colour; stories with headline, deck, byline, size, body (markdown), image {src, alt, kind, credit,
   caption, prompt | template+captions, placeholder: true for ai/meme}; letters (from newspack.site.letters, keep
   `tx`; never invent reader letters), classifieds (readers' "AD:" letters, plus house ads marked house: true),
   horoscopes (12), weather (city + quip), staff (today's bylines), runningJokes (new ones born tonight).
   Staff pictures: copy the chosen card art into OUT/img/ (from web/art/factory/forge/cards/<character>/ — the
   sprite sheets are 12 frames of 360x504; crop frame 0 — or a workshop scene from web/art/factory/originals/) and
   set src "img/<file>". Leave markets: {} — code fills it.
   Run `node paper/check.mjs OUT/draft.json --draft` and fix every error.

8. NUMBERS AND PICTURES. Run `node paper/inject.mjs --date DATE`, then `node paper/images.mjs --date DATE`, then
   `node paper/check.mjs OUT/issue.json`. Fix errors (in draft.json, then re-run from inject). Look at every
   generated picture; regenerate (edit the prompt, set placeholder: true, re-run images) any that shows a real
   identifiable person, text gibberish or is just bad.

9. LAYOUT AND PREVIEW. Run `node paper/layout.mjs --date DATE`, then `node paper/publish.mjs --date DATE --preview`.
   Send the owner the preview link with five lines: the lead headline, the roasts (who and how hard), anything edgy
   to consider vetoing, whether the markets numbers are real, and anything that failed tonight.

10. PUBLISH (only if the environment has PUBLISH_FROM_TASK=1; otherwise stop after step 9 and say the issue is ready
    for the owner to publish). Run `node paper/check.mjs OUT/issue.json --publish`; if it passes, run
    `node paper/publish.mjs --date DATE --send`. It opens at OPENS_HOUR (6am New York) for 24 hours; until then the
    owner can veto with MorningWood.unpublish(number). Then run `node paper/remember.mjs --date DATE`.

Never print, ask for or write any key. Never commit or push. Never touch contracts/ or web/.
```
