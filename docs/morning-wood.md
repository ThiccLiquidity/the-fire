# The Morning Wood (brainstorm, not built)

A satirical daily newspaper NFT, in the style of The Onion, on the same site as Cardworks, with its own small contract.
Nothing here is decided until the owner says so.

## Agreed so far
- **What:** a daily issue, minted as an NFT. It's edgy and obviously satire, with a SATIRE stamp on every page.
  Guard rails are kept to a minimum.
- **Price:** about 1 PAPER plus $0.05 of ETH, both of which go to the liquidity contract (`LiquidityBurner`,
  `docs/liquidity-burn.md`). It isn't meant to make money.
- **Content:** real news turned into satire.
  - Crypto and world news.
  - Heavy on PLANK.
  - A Tang Gang section.
  - A markets page with real numbers for PAPER, PLANK and Paper Mills: price, moves, volume, liquidity, burns and
    holders. Code fills in the numbers; the AI never writes them.
  - A section about our own site: big pulls, sell-outs, burns.
- **Timing:** written the night before, like a real paper; the owner gets a preview link and can veto; the issue drops
  in the morning.
- **Writers:** AI personas with funny names, each copying a famous writer's style, each with a beat and a memory of
  past issues and running jokes. First ideas:

  | Writer | Style | Beat |
  |---|---|---|
  | Ernest Hemingwood | Hemingway | markets |
  | Hunter S. Timber | Hunter S. Thompson | crypto news |
  | Edgar Allan Pine | Poe | obituaries |
  | Dorothy Parquet | Dorothy Parker | Tang Gang |
  | Mark Twine | Mark Twain | world news and weather |
  | Kurt Vonneplank | Vonnegut | horoscopes and editorials |

## Decided (owner, Oct 2026)
- **Motto under the masthead:** "Hard News, Every Morning".
- **The NFT is the whole issue:** one per day. It's read on our site, and you flip it like a newspaper, with
  Kindle-style page turns on a tablet.
- **Two doors on the site:**
  - **The main link** opens a landing page with two big doors: the Card Press (Cardworks) and the Printing Press
    (The Morning Wood).
  - **Each side has its own clean link** (e.g. `/cards` and `/press`) that can be posted anywhere and opens that
    side directly, without going through the doors first.
  - **Each side has a small "Home" button** back to the doors, to switch sides.
- **The Printing Press:** open daily, with unlimited copies of the day's issue. Price: 1 PAPER plus $0.05 in ETH or
  USDG.
- **Today only:** each issue sells for 24 hours, then closes forever. After that, old issues can only be had from
  other holders.
- **Holders get:**
  - **Streak badges:** buying 7 or 30 days in a row puts a badge such as "Subscriber" or "Paperboy" on your profile.
  - **Letters and classifieds:** holders of today's issue can send in a one-line letter or classified for
    tomorrow's paper. The best ones are printed under the sender's profile name.
- **Separate from Cardworks:** for now the paper stands alone and only shares the site, PAPER and profiles (used for
  letters and badges). There's room for crossovers later (staff, Cardworks news, drop-day editions), so keep the
  design open to them.
- **Roasts:** anyone on the source list is fair game, the owner included. When a story is a roast, it's a full
  roast. Not every story is one, though: mix in playful pieces, so the tone changes from story to story.
- **Subjects:** PLANK, Tang Gang, crypto in general, and trending news, which brings in politics and culture. Markets
  (real numbers) and the fun page (horoscopes, letters, classifieds) round it out.
- **Every issue, every section:** Front page, PLANK, Tang Gang, Crypto, Trending, Markets and the Back page appear
  every day. A slow section can be one short story or a meme.
- **Look:** colourful and fun, with memes and photos. The stories are the point.
  - **Front page:** a classic broadsheet with old newspaper type, a proper masthead and one huge photo. It doubles as
    the NFT image.
  - **Inside pages:** tabloid style, with loud colour, big headlines and memes.
- **Pictures:** no real news photos, because they're copyrighted. Three sources:
  - AI-generated "press photos" for the front page and big stories, in one consistent paper style.
  - Meme templates with AI-written captions on the inside pages (Imgflip, free).
  - Card characters and workshop scenes as staff photos and spot art.

  That's about $10–15 a month in total with the X data. Check current image prices first.

## Pipeline (draft)
1. **Gather (code):** news feeds, X posts from Tang Gang accounts and big threads, DEX market data, and our own
   chain events. Everything goes into one news pack.
2. **Editor-in-chief (AI):** picks the stories, assigns writers and plans the front page.
3. **Writers (AI):** each writer pitches about 10 headlines, the best are kept, and the writers write them up.
4. **Copy desk (AI):** scores each piece for funny and in voice, then punches up or cuts.
5. **Layout (code):** a newspaper page image, uploaded to IPFS, with NFT metadata.
6. **Preview and publish:** the owner gets a preview link at night, and the edition goes on sale in the morning
   for 24 hours.
7. **Memory:** the issue and new running jokes are saved for later issues.

## Costs (target about $5 a month)
- **Writing:** a scheduled Claude task on the owner's existing plan, so there's no API bill. Each writer is its own
  subagent, so the voices don't blend.
- **X data:** TwitterAPI.io, about $0.15 per 1,000 posts, so about $5 a month at 1,000 posts a day. It's unofficial,
  against X's rules, and can break. The fallback is X's official API on the top accounts only.
- **Everything else:** news feeds, DEX data, GitHub Actions and the IPFS free tier cost $0.
- **Condition:** the paper goes ahead only if the X data really works at that price. Test it first. The owner types
  any keys into the environment settings, never in chat.

## Open questions
- Where in the site does it live, and what does the page look like?
