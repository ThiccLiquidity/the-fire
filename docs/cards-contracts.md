# Card contracts: packs, cards, opening

`contracts/src/cards/`. The sale and fee economics are in `docs/omni-economy.md`; cases, grading, wear and slabs in
`docs/grading.md`. The Standard recipe matches `docs/card-studio.md`.

**Naming.** The contracts are named `Fire*` for historical reasons: `Fire*` is the card system. In identifiers
(`fire`, `lockFire`, `fires`), "fire" is a Series number. This doc says "Series" in prose.

**The idea.** Every rule about what a Series' cards are is a per-Series setting: card types, how many of each, holo
odds, cards per pack, what each slot may hold, characters, fresh PDA odds, card images. The only limits left are
technical (type widths and block gas), and big work is split into batches instead of capped. Every setting locks when
the Series' drop is set up (`configureDrop`), before anyone can buy, so buyers can trust the odds, and all of it can be
read on-chain.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155 ("Omni Card Packs", `OMNIPACK`): one stackable token type per Series (token id = Series number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp`. The description reads the Series' cards per pack from `FireCards`. Royalty (ERC-2981). |
| `FireCards` | The permanent core. The cards, ERC-721 ("Omni Cards", `OMNICARD`; token id = global serial), one opening queue per Series, randomness (drand router and adapter), serials, editions, each card's wear (age uncased, moves, cased) and PDA grade. Per Series it keeps the dealer, the image folder, the frozen pack count and progress. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `CardsRenderer` | Builds each card's `tokenURI` JSON and image name (`imageName`, `imageFile`) from `FireCards` and the dealer. No owner, no settings; set once on `FireCards`. |
| `IDealer` | What `FireCards` asks of a Series' dealer: `ready`, `cardsPerPack`, `characterCount`, `deal(fire, seed, fromCard, count)` and `cardText`. The owner picks a dealer per Series. Future dealers can add mechanics (their own state, 32 bits of per-card "extra" data, extra metadata attributes) without touching `FireCards`. |
| `RecipeDealer` | The first dealer: deals each Series from its own recipe (below). Owned by the multisig. |
| `RecipeCompiler` | The recipe checker, compiler and pool maths, split out of `RecipeDealer` for contract size. Pure: no state, no owner. |
| `StandardRecipe` | The original Omni rules as a recipe (library). |
| `FireSale` | Sells the packs (`docs/omni-economy.md`): every product rule is a per-drop setting (pack counts, prices, PAPER and its dollar ceiling, burn share, PLANK-only packs, press packs, holder window, wallet limit, regular-wallets rule, packs per purchase, credits per picked suggestion). Closes the Series when a drop sells out or ends. The owner can pause buying (`setPaused`). Never holds funds. |
| `FireCredits` | Free pack credits, card burning (42 cards = 1 credit, fixed forever) and character suggestions, split out of `FireSale` for contract size (same rules). It spends credits, burns cards and takes suggestion PAPER through `FireSale` hooks only it can call (`creditPacks`, `burnCardsFor`, `burnPaperFor`), so PAPER is approved to `FireSale` alone. Owned by the multisig (picks, suggestion rules). |
| `PlankBurner` | Gets the sale's PLANK burn share when the swap can't run (a stale PLANK price or a failed swap). No owner, no withdraw: anyone calls `flush`, which buys PLANK (95% TWAP guard, halving for a backlog) and sends it to the dead address. |
| `FirePsa` | Cases and PDA grading (`docs/grading.md`): `protect(caseIds, gradeIds, pay, maxCost)` cases and/or sends for grading up to `maxBatch` cards (20; owner setting, at most 100) in one transaction, priced in dollars, paid in ETH, USDG or PLANK. drand picks each grade (1 to 10) from the Series' fresh odds and the card's frozen wear (fixed rules); the card is slabbed. The only contract that can case a card or set a grade, once per card. |
| `PaperBurner` | Gets 100% of every case and grading fee, buys PAPER with it on owner-set routes and burns it. No withdraw; the router is fixed at deploy. |

Every owned contract refuses `renounceOwnership` (control can't be lost by mistake); ownership moves only in two
steps (`transferOwnership`, then `acceptOwnership`). `FirePacks` and `FireCards` have an owner-set `contractURI`
(ERC-7572, `ContractURIUpdated`) for collection pages on marketplaces.

## A Series' recipe (RecipeDealer)

`setRecipe(fire, recipe)`, `setCharacters(fire, names, categories)` and `appendCharacters(...)`, by the owner, until
the Series is locked (its drop is set up, or `lockFire`), its first pack is minted or it closes. `check(recipe)`
validates a recipe without storing it and reverts with the reason; `previewPool(recipe, packs)` gives its pool for any pack count. The studio can call both.

### Card types

A list, any length (index stored in 32 bits). Each type has:

| Field | Meaning |
|---|---|
| `name` | The "Material" trait and the first word of the card's name. 1 to 64 bytes of valid UTF-8, no `"`, `\` or control characters. |
| `slug` | Used in image file names. 1 to 32 bytes of `[a-z0-9-]`, unique in the recipe. |
| `rank` | For rank-range slots ("Fire-or-better" = rank 2 and up). Ties allowed. |
| `supply`, `amount` | `Share`: `amount` parts per billion of the Series' cards, rounded half up. `PerPack`: `amount` per pack. `Count`: exactly `amount`. `PerCharacter`: exactly `amount` of each character (at most 65,535). `Filler`: whatever is left (exactly one type). |
| `maxPerPack` | 0 = no cap; else at most `maxPerPack` x packs (Standard Gold and Full Art: 1, "never more than one per pack's worth"). A Series total, not checked per pack. |
| `holoMode`, `holo[4]` | `Independent`: frame and picture rolled separately, chances out of 1e18 in `holo[0]`, `holo[1]` (two 100% = always full holo). `Distribution`: weights for none, frame, picture, full (any total). |

### Slots

The pack, as groups of slots. Each group: `count` cards (at least 1) that may be any type in a set, given either as
an explicit list `types` (one type = a guaranteed type) or, when the list is empty, as a rank range
`minRank..maxRank` (inclusive; `maxRank = 2^32 - 1` for "or better"). `mustHolo` makes the group's cards always holo,
using the type's own holo odds given it is holo. Cards per pack = the sum of the counts (any number from 1).

Two groups' sets must be **nested or disjoint** (one inside the other, or no type in common), and every type must fit
some group. Overlapping sets (say "Paper or Wood" with "Wood or Fire") are refused (`NotNested`), because with
nesting the guarantee below is exact and cheap to keep. Rank ranges like "X-or-better" and single types always nest.

### Characters

Names and categories, in image order (`c0`, `c1`, ...), any number (index stored in 32 bits). Names 0 to 64 bytes,
categories 1 to 32 bytes, both free text with the same rules as type names (valid UTF-8, JSON-safe). `setCharacters` replaces the list
(a fresh list, so a long one can always be replaced); `appendCharacters` adds batches for long lists.

### The pool

When the Series closes with P packs (N = P x cards per pack), the pool is:
1. Each type's rule, cap applied; the filler takes the rest of N.
2. **The floor.** Every slot set must hold at least P x (slots per pack inside it) cards:
   - sets without the filler, deepest first: if short, top up their lowest-ranked type from the filler;
   - sets holding the filler, from the filler up: if short (or the filler below 0), take cards back into the filler
     from types outside the set that have more than their own sets need: rule-by-share and per-pack types first,
     exact counts last, lowest rank first.

This always works, for every P (a fuzz test checks it over random recipes), so a Series can never close into a pool
that can't fill its packs. A guarantee beats a count: a guaranteed type set to fewer cards than packs is raised. For
the Standard recipe it is exactly the studio's `computePool` (pack floor P <= Fire-or-better <= 2P; parity test
against `pool-fixture.json`).

### Dealing

A pack's groups are dealt most specific (deepest set) first (`dealOrder(fire)` lists each position's slot). A card for
a group is drawn by walking down the nested sets: at each level a part is chosen with weight equal to its cards not
held back for later packs (sets) or its cards left (types in no smaller set). So every later pack can still be filled,
the Series' totals are exact, and nothing is dealt beyond the pool. For the Standard recipe the odds are exactly the
previous contract's (slot 6 uniform over Fire-or-better left; slot 5 Fire-or-better with weight "Fire-or-better not
needed for slot 6 of later packs" against "spare Wood"). Then holo (two drand-derived words) and a character
(uniform). All from the pack's randomness: `keccak256(word, pack index)`, per card `keccak256(packSeed, position)`.

### The Standard recipe

| Type | Rank | Supply | Holo |
|---|---|---|---|
| Paper | 0 | 3 per pack | independent, each roll 1 - sqrt(0.95) (5% any holo) |
| Wood | 1 | filler | 10% |
| Fire | 2 | 15% (150,000,000 ppb) | 50% |
| Coal | 3 | 4.9% (49,000,000 ppb) | 90% |
| Gold | 4 | per character (default 2, so always twice Full Art), at most 1 per pack's worth | always full holo |
| Full Art | 5 | 1 per character, at most 1 per pack's worth | always full holo |

Slots: 3 x Paper, 1 x Wood, 1 x rank 1 and up (Wood-or-better), 1 x rank 2 and up (Fire-or-better). Example: 167 packs,
20 characters make 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full Art. Gold took Diamond's place
(`StandardRecipe.classic` is the first five types alone); Full Art needed no slot change: the "or better" ranges take
it.

### Views

`recipeOf(fire)` (the whole recipe), `poolOf(fire)` (after close), `poolFor(fire, packs)`, `previewPool(recipe,
packs)`, `remainingOf(fire)` (cards left per type, packs not yet started), `holoOdds(fire, type)` (none / frame /
picture / full out of 1e18), `characterOf`, `charactersOf(fire, from, count)`, `characterCount`, `cardsPerPack`,
`dealOrder`, `stateOf`, `check(recipe)`.

### Recipe JSON (for the studio)

`script/ConfigureSeries.s.sol` reads this shape (example: `contracts/test/cards/recipe-standard.json`). Numbers above
2^53 (holo chances) go as strings; any number may.

```json
{
  "fire": 7,
  "imagesBase": "ipfs://<images CID>/",
  "types": [
    { "name": "Paper", "slug": "paper", "rank": 0, "supply": "perPack", "amount": 3,
      "holo": { "mode": "independent", "frame": "25320565519103609", "picture": "25320565519103609" } },
    { "name": "Wood", "slug": "wood", "rank": 1, "supply": "filler",
      "holo": { "mode": "independent", "frame": "51316701949486200", "picture": "51316701949486200" } },
    { "name": "Gold", "slug": "gold", "rank": 4, "supply": "perCharacter", "amount": 2, "maxPerPack": 1,
      "holo": { "mode": "distribution", "weights": ["0", "0", "0", "1"] } },
    { "name": "Full Art", "slug": "fullart", "rank": 5, "supply": "perCharacter", "amount": 1, "maxPerPack": 1,
      "holo": { "mode": "distribution", "weights": ["0", "0", "0", "1"] } }
  ],
  "slots": [
    { "count": 3, "types": [0] },
    { "count": 1, "minRank": 1 },
    { "count": 1, "minRank": 2, "maxRank": 4, "mustHolo": true }
  ],
  "characters": [ { "name": "Ember Fox", "category": "Animals" } ],
  "pdaOdds": ["0", "0", "0", "0", "1000", "2000", "2700", "2500", "1700", "100"],
  "sale": {
    "start": 1900000000, "packs": 117, "starters": 50, "plankOnly": 50, "walletLimit": 5,
    "starterWindow": 86400, "liftAfter": 172800, "plankBurnBps": 3000,
    "priceUsd": "250000000", "paperPerPack": "1000000000000000000", "paperCapUsd": "100000000",
    "holderWindow": 86400, "holderRoot": "0x...", "maxPerTx": 50,
    "plankOnlyFor": 172800, "regularWalletsFor": 172800,
    "starterPerPress": 1, "starterWalletLimit": 1, "starterPriceUsd": "0", "starterPaper": "1000000000000000000",
    "creditsPerPick": 1, "creditPacksMax": 16, "creditPacksPerWallet": 3
  }
}
```

`supply`: `filler` | `share` (ppb of the Series' cards) | `perPack` | `count` | `perCharacter`. `holo.mode`:
`independent` (`frame`, `picture` out of 1e18) | `distribution` (`weights`: none, frame, picture, full). A slot has
`types` (indexes) or a rank range (`minRank`, default 0; `maxRank`, default "no top"). `imagesBase` and `pdaOdds` (the
fresh odds: a weight per grade, 1 first; grades 1-4 must be 0) are optional. The JSON is read strictly: unknown keys,
numbers too big for their field and a drop start more than 365 days away are refused.

`sale` (optional; the studio's Sale tab) is `FireSale.DropConfig` field by field, in contract units: times in seconds
after `start`, dollars with 8 decimals, PAPER in wei, the burn share in basis points. Every field is required except
`holderRoot` (0 = presses only). `DROP_START` and `HOLDER_ROOT` override `start` and `holderRoot` when the script runs
(the snapshot is taken just before the drop). The studio's sample export is `contracts/test/cards/recipe-studio-sale.json`
(written by `studio/scripts/sale-sample.test.ts`; `Sale.t.sol` runs it through the script and `configureDrop`).

## The flow

1. **Before a Series** (the owner, the `OWNER` multisig; `ConfigureSeries.s.sol` builds these calls from the JSON):
   `RecipeDealer.setRecipe`, `setCharacters` (+ `appendCharacters`), `FireCards.setDealer(fire, dealer)` (the dealer
   must already have the Series ready), `FireCards.setImagesBase(fire, base)`, optionally `FirePsa.setOdds`. Then
   `FireSale.configureDrop` (it requires `FireCards.ready(fire)`; the script adds it last from the `sale` block).
   `configureDrop` calls `FireCards.lockForSale(fire)`: from then the dealer, recipe, characters, fresh odds and image
   folder are fixed.
2. **During the drop:** the seller (`FireSale`) mints packs. They're tradeable sealed.
3. **When the drop ends:** the seller calls `closeFire(fire)`. The pack count freezes. Closing never calls the dealer.
   The pool (`poolOf`) is worked out from the recipe and that count; the dealer lays it out at the first deal.
4. **Opening:** a holder calls `open(fire, count)` (any number of packs). The packs are burned and drand randomness
   is requested. Each Series has its own queue. **Nothing about the packs exists before this.** (The leftover pool is public, so the last pack of a
   Series gets exactly what's left. That comes with exact totals.)
5. **Dealing:** when the randomness arrives, anyone calls `process(fire, maxCards)` (the live site is planned to call it
   right away). A Series' opens are dealt strictly in order, up to `maxCards` cards per call; a pack can be split across
   calls (a 1,000-card pack, the most allowed (`MAX_CARDS_PER_PACK`), is ~63M gas, so a few calls of ~300 cards each). Each pack gets the next block of serials, in a
   shuffled order (Fisher-Yates for packs up to 256 cards, a keyed Feistel permutation above), so a serial says nothing
   about its slot. Results depend only on the words and the open order, never on who processes or how it is split.
6. **Metadata:** `tokenURI` is built on-chain by `CardsRenderer`. Name `<type name> <character> #<serial>`; image
   `<imagesBase>` + `c<character>-<type slug>-<holo>-<state>.webp` (`imageName`; `holo` is `none`, `frame`, `picture` or
   `full`, `state` `u` (ungraded), `c` (cased) or `1` to `10` (slabbed)). Traits: Character, Category, Material (the type
   name), Holo, Series, Edition ("k", then "k of N" once every pack of the Series is dealt), Serial, plus any the dealer
   adds. Ungraded: PDA "Ungraded", Cased, Dealt (a `date` trait), Moves, and once cased Age when cased (days), frozen
   (the condition is never shown; nothing changes just because time passes). Graded: "PDA N" only. Example: `c0-coal-full-7.webp`.
7. **Wear, cases and grading:** each card wears with time uncased and with moves between wallets until it is cased or
   graded; `FirePsa.protect` cases and grades. A card being graded can't be transferred. Rules in `docs/grading.md`.

## What is set per Series, and when it locks

| Setting | Where | Locks |
|---|---|---|
| Dealer | `FireCards.setDealer` | drop set up (`configureDrop` -> `lockForSale`), first pack minted, `lockFire`, or close |
| Card types, slots, cards per pack, supply, caps, holo | `RecipeDealer.setRecipe` | same |
| Characters | `setCharacters`, `appendCharacters` | same |
| Fresh PDA odds (weights for grades 5-10; 1-4 must be 0) | `FirePsa.setOdds` | same |
| Image folder | `FireCards.setImagesBase` | same (the art people buy can never be swapped) |
| Drop settings (all of them, below) | `FireSale.configureDrop` | the drop's start |

## Every sale and economy setting

Per Series = set in `configureDrop` for that drop, locked at its start. Global = one owner setting for everything.

| Setting | Where | Scope | Default (Standard) | Bound, and why |
|---|---|---|---|---|
| Paid packs | `DropConfig.packs` | per Series | 117 | < 2^64; 0 allowed if there are press packs |
| Press packs (starters) in all | `starters` | per Series | 50 | < 2^64; 0 = off |
| Price per paid pack | `priceUsd` (8 dec.) | per Series | $2.50 | > 0 when there are paid packs (a $0 typo would give them away) |
| PAPER per paid / credit pack | `paperPerPack` | per Series | 1 PAPER | any, 0 = none |
| PAPER ceiling per pack | `paperCapUsd` (8 dec.) | per Series | $1 | any, 0 = no ceiling. A pack's PAPER (paid, press and credit packs) is never worth more than this at the `PAPER_USD` feed's price; while the feed is late the last good price holds (`lastPaperUsd`); before its first price, the set PAPER |
| PLANK burn share | `plankBurnBps` | per Series | 30% | 0 to 100% |
| PLANK-only packs | `plankOnly` | per Series | 50 | <= paid packs |
| PLANK-only opens to ETH/USDG after | `plankOnlyFor` | per Series | 48h | > 0 if `plankOnly` > 0 (a PLANK feed outage can't stall a drop); <= 30 days |
| Wallet limit (paid) | `walletLimit` | per Series | 5 | < 2^64; 0 = none (then `liftAfter` 0 too) |
| Wallet limit lifts after | `liftAfter` | per Series | 48h | <= 30 days; 0 only with no limit |
| Most packs per purchase / credit spend | `maxPerTx` | per Series | 50 (0 = 50) | < 2^32. Gas is flat: 100 packs cost the same as 1 (~96k) |
| Holder window | `holderWindow` | per Series | 24h | <= 30 days; 0 = open to all |
| Snapshot root | `holderRoot` | per Series | from `ops/snapshot` | 0 = presses only. The $69 minimum is the snapshot's `--min-usd` (off-chain, per drop) |
| Regular wallets only for | `regularWalletsFor` | per Series | 48h | <= 30 days; 0 = off (was tied to the wallet limit) |
| Press packs per press | `starterPerPress` | per Series | 1 | >= 1 if press packs are on. Each press counted per drop |
| Press packs per wallet | `starterWalletLimit` | per Series | 1 | >= 1 if press packs are on |
| Press claim window | `starterWindow` | per Series | 24h | > 0 if press packs are on; <= 30 days |
| Press pack dollar price | `starterPriceUsd` | per Series | $0 | any; paid in PLANK, ETH or USDG like a paid pack |
| Press pack PAPER | `starterPaper` | per Series | 1 PAPER | any; both price fields 0 = free |
| Credits per picked suggestion | `creditsPerPick` | per Series | 1 | < 2^16; 0 = none |
| Free (credit) packs in the drop, at most | `creditPacksMax` | per Series | 10% of the drop's packs (the studio sets a percent and exports the count, rounded down, at least 1) | < 2^64; 0 = no limit; `CreditCapReached` past it |
| Free (credit) packs per wallet, at most | `creditPacksPerWallet` | per Series | 3 | < 2^64; `CreditWalletLimit` past it |
| Cards per free pack credit | `FireCredits.CARDS_PER_CREDIT` | constant | 42 | **fixed forever**: burn progress carries over between Series, so changing it would move the goalposts |
| Suggestion cost, longest text | `FireCredits.setSuggestionRules` | global (suggestions aren't tied to a drop) | 1 PAPER, 280 bytes | any cost incl. 0 (each `suggest` names its most PAPER), never more than $1 of PAPER (`SUGGESTION_PAPER_CAP_USD`, fixed); text 1 to 1,024 bytes (event size) |
| Cards per case/grading batch | `FirePsa.setMaxBatch` | global | 20 | 1 to 100 (gas guard: `finish` grades a batch in one tx) |
| Case and grading prices | `FirePsa.setPrices` | global | $0.05, $1 | above 0, at most $100 each (typo guard; each batch names its most) |
| Fee burn routes | `PaperBurner.setRoutes` | global | set at deploy | each route starts at the currency and ends at PAPER, passing only through WETH, PLANK or USDG (2-4 tokens, at most 4 routes); the 95% guard checks every buy. The router is fixed and the burner's price feeds (`setFeeds`) can be set only once |
| Fresh PDA odds | `FirePsa.setOdds` | per Series | 5-10 table (`docs/grading.md`) | grades 1-4 must be 0 |
| Revenue wallet and PlankBurner, feeds, router | `setWallets`, `setFeeds` | global | - | only between drops (unchanged) |
| Pause | `FireSale.setPaused`, `FirePsa.setPaused` | global | off | blocks every buy, press packs, credit spending, paid suggestions (`FireSale`) and case/grading payments (`FirePsa`). Never opening, dealing, transfers, ending or closing a drop, burning cards, finishing or cancelling a grading, or keeper calls. No expiry |
| Randomness source | `FireCards.setRandomness`, `FirePsa.setRandomness` | global | the drand adapters | any time, no delay (announced first); only new requests use it, each pending request keeps its source (`docs/randomness.md`) |
| Collection metadata | `FirePacks.setContractURI`, `FireCards.setContractURI` | global | empty | any (ERC-7572) |

Guards that stay fixed (safety, not product): settings lock at the drop's start; one drop at a time; every purchase
names its most PLANK/USDG/ETH and PAPER; the PAPER ceilings (per drop for packs, $1 for suggestions; the last good
price holds while the PAPER feed is late); the swap floors (`SWAP_MIN_BPS`: 90% in `FireSale`, 95% in `PaperBurner`
and `PlankBurner`); the wear rules and 100% fee burn (`docs/grading.md`); feed freshness (`ETH_FEED_MAX_AGE`
25h, `PLANK_FEED_MAX_AGE` and `PLANK_WINDOW_MAX` 2h, `PAPER_FEED_MAX_AGE` 2 days); phases at most 30 days
(`MAX_WINDOW`) and `END_GRACE` 7 days, so a stalled drop can always be ended (by the owner once its last phase is over,
by anyone a week later); no re-request, and cancel after a week for randomness; royalty at most 10%; ownership can't
be renounced.

## Technical ceilings (not product rules)

| Ceiling | Why |
|---|---|
| Series number < 2^64 | stored in 64 bits in every card (was 2^32) |
| Packs per Series < 2^64 (`FirePacks` refuses more) | the frozen count is 64-bit |
| Cards per pack at most 1,000 (`MAX_CARDS_PER_PACK`) | one pack's shuffle and dealing fit in a block |
| Types < 2^32, characters < 2^32 | per-card fields are 32-bit; a card is one storage word |
| Cards of one type per Series < 2^128 | dealing counts are packed two per slot |
| Editions < 2^40 | per-card field |
| Name 64 bytes, category 32, slug 32 | metadata size; same rules as the studio |
| Recipe size | owner gas per transaction (stored as contract code in 24,000-byte chunks, so no hard size) |
| Dealing | block gas: `process(fire, maxCards)` splits any pack; a card costs ~60k gas |
| Cases and grading: at most 100 cards per batch (`maxBatch`, 20 to start) | gas guard on `finish` |
| Royalty <= 10%, drop phases <= 30 days, end grace 7 days, price-feed ages, 90% swap floor | buyer-protection guards (kept) |

## Safety

- Results depend only on the random words and the open order, not on who calls `process(fire, maxCards)`, when, or
  how the work is split.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- One open, one randomness request: there is no re-request (it could act as a re-roll once a drand round is public).
  After 7 days with no answer (randomness gone for good), anyone can `cancelOpen(fire, index)`: the packs go back to
  the holder, sealed. Each open remembers its randomness source and only that source can answer it, so switching the
  source never strands or re-rolls an open. If a ready open sits at the head of its queue undealt for 7 days (a dealer
  that can't deal it), anyone can `skipStuck(fire)`: its unstarted packs go back, sealed, and the queue moves on. Each
  Series' queue stands alone, so one stuck Series never blocks another.
- The owner can't change a Series' dealer, recipe, characters, fresh odds or image folder once its drop is set up.
  Closing doesn't depend on the dealer, so a drop can always close.
- The owner can't change a dealt card. A card being graded can't be transferred (it can be burned); grades are final.
- `PaperBurner` and `PlankBurner` have no withdraw: what they hold only ever leaves as a PAPER (or PLANK) buy sent to
  the dead address.
- Trust: the dealer is code the owner chooses per Series (before its first pack). `RecipeDealer` is the one in this
  repo, covered by the tests; a future dealer is trusted like the owner's other settings, and must deal only from its
  own state and the seed and keep its text JSON-safe.

## Gas (Standard recipe, `forge test --match-test test_gas -vv`)

| | Before | Now |
|---|---|---|
| `open` 1 pack | ~101.9k | ~102.8k (the open now also stores its randomness source, packed with the request id) |
| `process` 1 pack (6 cards) | ~345.8k | ~365.4k (+5.7%) |
| `process` a 10-pack open | ~3.26M | ~3.47M (+6.4%) |

The extra is the call to the dealer and reading the compiled recipe (stored as contract code, read in one copy).

## Tests

`contracts/test/cards/` (`Cards.t.sol`, `Recipe.t.sol`, `Sale.t.sol`, `Psa.t.sol`, `Burner.t.sol`, `PlankBurner.t.sol`,
`SaleFork.t.sol`) and
`contracts/test/invariant/` (fuzz and invariant suites, including `RecipeFuzz.t.sol`). They cover:
- the Standard pool (`classic`, Gold in Diamond's place) matches the studio's own code over 344 Series sizes and
  count settings (`pool-fixture.json`,
  written by `studio/scripts/pool-fixture.test.ts` with `WRITE_POOL_FIXTURE=1`; format unchanged), and the Standard
  odds match a re-implementation of the previous contract's dealing
- every Standard pack keeps its guarantees, totals are exact, holo rates converge (Gold and Full Art always full holo)
- new shapes: 3-card all-holo packs, 100 characters in batches, per-character types, 1-card packs, a 1,000-card pack in
  10 calls (same cards as one call), recipes spanning several storage chunks, the floor topping up and taking back
- bad recipes refused with the reason (not nested, a type no slot takes, filler, never-holo in a must-holo slot, slots,
  slugs, shares, holo)
- every setting locks at the first pack, and a dealer can't be swapped after it
- fuzz: random nested recipes and Series sizes; every card fits its slot, must-holo slots are holo, totals exact,
  never beyond the pool, every slot set always has enough
- the same words give the same cards however processing is split; out-of-order randomness waits its turn
- permissions, burns, royalties, metadata, image names, the image folder lock, the JSON configure path
- the wear odds match `wear-model.py` (`wear-vectors.json`); cases and grades freeze wear; grades are final; the
  burner's best route, split, 95% guard, piece-by-piece backlog, set-once feeds and known-token routes
- the strategic review: what pause blocks and never blocks, a randomness switch (old requests answered only by their
  own source, or cancelled), the per-drop PAPER ceiling on paid, press and credit packs, PlankBurner (no withdraw,
  flush, guard, halvings), renounce refused, the Dealt date trait, contractURI, a buy refreshing the PLANK price

## Deploying

`contracts/script/DeployCards.s.sol` deploys and wires everything in one run: FirePacks, FireCards, CardsRenderer,
RecipeDealer and RecipeCompiler, PlankBurner, FireCredits, FireSale (wired to both; `FireCredits.setSale` is set once
and checks the sale points back), PaperBurner (its feeds and default routes: direct to PAPER or through PLANK/WETH),
FirePsa, two drand adapters (FireCards, FirePsa), the royalty. It needs `PAPER_USD_FEED` (the `PaperUsdTwap`). It
hands ownership to the multisig (`OWNER`), which must then call `acceptOwnership()` on FirePacks, FireCards,
RecipeDealer, FireCredits, FirePsa and PaperBurner; FireSale is owned by `OWNER` from deployment; PlankBurner has no
owner. The script checks every input first and refuses a plain wallet as owner unless told
otherwise. A test runs the same steps.

Every deploy script writes what it deployed to `deployments/<chainId>.json` (repository root), the address file every
tool reads; `contracts/script/VerifyDeploy.s.sol` checks the wiring listed below from it.

`contracts/script/ConfigureSeries.s.sol` sets up a Series from a recipe JSON in two Safe batches: `BATCH=A` (content:
recipe, characters, dealer, images base, odds) and, after `ops/series/verify-series.mjs` is green, `BATCH=B`
(`configureDrop`, the lock; refused unless the chain holds batch A exactly). It checks the recipe against the dealer,
prints each call and writes a Safe Transaction Builder file per batch (`contracts/safe-tx/`); `SIMULATE=true` runs a
batch as the impersonated owner on a fork; `SEND=true` sends them when the signer is the owner (testnet). It rejects unknown JSON keys, fresh odds on grades 1-4 and a drop start more than 365 days away. Inputs: `RECIPE_JSON` (under `contracts/series/`), `BATCH`,
`DROP_START` and `HOLDER_ROOT` (override the block), `CHARACTER_BATCH` (characters per call, default 200);
`RECIPE_DEALER`, `FIRE_CARDS`, `FIRE_PSA`, `FIRE_SALE` from the deployments file unless set.

- **Settings:** `.env.example` (card contracts section). No keys in `.env`: sign with the Foundry keystore or a Ledger.
- **Right after the deploy:** the multisig accepts ownership, then checks the wiring: the seller is FireSale on packs
  and cards, cards point at packs, the dealer points at cards and packs, FireSale and FireCredits point at each other,
  FireSale's `plankBurner` is the deployed PlankBurner (same router and PLANK/ETH feeds), the PDA is FirePsa, the
  renderer is CardsRenderer, FirePsa pays PaperBurner, randomness points at the two adapters, no Series is configured or locked yet,
  and the royalty is what was set.
- **Keeper** (`ops/keeper`; every call is permissionless):
  - `PlankUsdTwap.checkpoint()` every 30 minutes and `PaperUsdTwap.checkpoint()` when `due()`
  - delivering drand numbers to the router (`OpenDrandRouter.fulfillMany`; `adapter.settle` if a callback didn't
    land)
  - `FireCards.process(fire, maxCards)` and `FirePsa.finish(index, ids)` (ids from the `Protected` event)
  - `PaperBurner.flush(pay)` when a fee is waiting (`Waiting` events) and `PlankBurner.flush(pay)` when it holds ETH,
    USDG or PLANK
- **Before deploy day:** run the real-chain gas test (PowerShell, from `contracts`):
  ```powershell
  $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"
  forge test --match-path test/cards/SaleFork.t.sol -vv
  ```

The site has the ABIs: `web/src/lib/abi/` (`fireCardsAbi.json`, `firePacksAbi.json`, `fireSaleAbi.json`,
`fireCreditsAbi.json`, `firePsaAbi.json`, `recipeDealerAbi.json`, `paperBurnerAbi.json`, `plankBurnerAbi.json`,
`cardsRendererAbi.json`), exported by `web/src/lib/cards.ts`. Each file is the `abi` field of
`contracts/out/<Contract>.sol/<Contract>.json` after `forge build`, written as 2-space JSON.

## Past review fixes after the redesign

See `docs/audit-2026-10.md` ("Per-Series recipes"). Every guarantee is kept; a few are widened or moved.

## Money and the economy

See `docs/omni-economy.md`. The sale never holds funds: whatever is paid for packs is forwarded or burned in the same
transaction. Case and grading fees go to `PaperBurner`, which only buys and burns PAPER (a fee waits there if the
price guard says no).

## Still open

See `docs/roadmap.md`.
