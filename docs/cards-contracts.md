# Card contracts: packs, cards, opening

`contracts/src/cards/`. The sale and PDA economics are in `docs/omni-economy.md`. The Standard recipe (the original
Omni rules) matches `docs/card-studio.md`.

**Naming.** The contracts are named `Fire*` for historical reasons: `Fire*` is the card system. In identifiers
(`fire`, `lockFire`, `fires`), "fire" is a Series number. This doc says "Series" in prose.

**The idea.** Every rule about what a Series' cards are is a per-Series setting: card types, how many of each, holo
odds, cards per pack, what each slot may hold, characters, PDA odds. The only limits left are technical (type widths
and block gas), and big work is split into batches instead of capped. Every setting locks when the Series' first pack
is minted, so buyers can trust the odds, and all of it can be read on-chain.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155 ("Omni Card Packs", `OMNIPACK`): one stackable token type per Series (token id = Series number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp`. The description reads the Series' cards per pack from `FireCards`. Royalty (ERC-2981). |
| `FireCards` | The permanent core. The cards, ERC-721 ("Omni Cards", `OMNICARD`; token id = global serial), the opening queue, randomness (drand router and adapter), serials, editions, PDA grades, on-chain metadata. Per Series it keeps the dealer, the image folder, the frozen pack count and progress. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `IDealer` | What `FireCards` asks of a Series' dealer: `ready`, `cardsPerPack`, `characterCount`, `deal(fire, seed, fromCard, count)` and `cardText`. The owner picks a dealer per Series. Future dealers can add mechanics (their own state, 32 bits of per-card "extra" data, extra metadata attributes) without touching `FireCards`. |
| `RecipeDealer` | The first dealer: deals each Series from its own recipe (below). Owned by the multisig. |
| `StandardRecipe` | The original Omni rules as a recipe (library). |
| `FireSale` | Sells the packs (`docs/omni-economy.md`): per-drop settings, PLANK-only first packs, PAPER per pack burned, the PLANK burn share, press-holder starters, free pack credits, suggestions. Closes the Series when a drop sells out or ends. Never holds funds. |
| `FirePsa` | The PDA reveal: a holder burns PAPER to reveal up to 10 cards; drand picks each grade (1 to 10) on the Series' odds; the card switches to that grade's image. The only contract that can set a grade, once per card. |

## A Series' recipe (RecipeDealer)

`setRecipe(fire, recipe)`, `setCharacters(fire, names, categories)` and `appendCharacters(...)`, by the owner, until
the Series' first pack is minted (or it is locked or closed). `check(recipe)` validates a recipe without storing it and
reverts with the reason; `previewPool(recipe, packs)` gives its pool for any pack count. The studio can call both.

### Card types

A list, any length (index stored in 32 bits). Each type has:

| Field | Meaning |
|---|---|
| `name` | The "Material" trait and the first word of the card's name. 1 to 64 bytes, no `"`, `\` or control characters. |
| `slug` | Used in image file names. 1 to 32 bytes of `[a-z0-9-]`, unique in the recipe. |
| `rank` | For rank-range slots ("Fire-or-better" = rank 2 and up). Ties allowed. |
| `supply`, `amount` | `Share`: `amount` parts per billion of the Series' cards, rounded half up. `PerPack`: `amount` per pack. `Count`: exactly `amount`. `Filler`: whatever is left (exactly one type). |
| `maxPerPack` | 0 = no cap; else at most `maxPerPack` x packs (Standard Diamond: 1, "never more than one per pack's worth"). |
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
categories 1 to 32 bytes, both free text with the same JSON rules as type names. `setCharacters` replaces the list
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
| Diamond | 4 | count (as set, default 1), at most 1 per pack's worth | always: frame / picture / full, a third each |

Slots: 3 x Paper, 1 x Wood, 1 x rank 1 and up (Wood-or-better), 1 x rank 2 and up (Fire-or-better). Example: 167 packs
and 1 Diamond make 501 Paper, 301 Wood, 150 Fire, 49 Coal, 1 Diamond. Adding a type above Diamond (say Gold, rank 5)
needs no slot change: the "or better" ranges take it.

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
    { "name": "Diamond", "slug": "diamond", "rank": 4, "supply": "count", "amount": 1, "maxPerPack": 1,
      "holo": { "mode": "distribution", "weights": ["0", "1", "1", "1"] } }
  ],
  "slots": [
    { "count": 3, "types": [0] },
    { "count": 1, "minRank": 1 },
    { "count": 1, "minRank": 2, "maxRank": 4, "mustHolo": true }
  ],
  "characters": [ { "name": "Ember Fox", "category": "Animals" } ],
  "pdaOdds": ["100", "150", "200", "350", "700", "1800", "2500", "2400", "1700", "100"]
}
```

`supply`: `filler` | `share` (ppb of the Series' cards) | `perPack` | `count`. `holo.mode`: `independent` (`frame`,
`picture` out of 1e18) | `distribution` (`weights`: none, frame, picture, full). A slot has `types` (indexes) or a
rank range (`minRank`, default 0; `maxRank`, default "no top"). `imagesBase` and `pdaOdds` (a weight per grade, 1
first) are optional.

## The flow

1. **Before a Series** (the owner, the `OWNER` multisig; `ConfigureSeries.s.sol` builds these calls from the JSON):
   `RecipeDealer.setRecipe`, `setCharacters` (+ `appendCharacters`), `FireCards.setDealer(fire, dealer)` (the dealer
   must already have the Series ready), `FireCards.setImagesBase(fire, base)`, optionally `FirePsa.setOdds`. Then
   `FireSale.configureDrop` (it requires `FireCards.ready(fire)`).
2. **During the drop:** the seller (`FireSale`) mints packs. They're tradeable sealed. From the first pack minted,
   the dealer, recipe, characters and PDA odds are fixed.
3. **When the drop ends:** the seller calls `closeFire(fire)`. The pack count freezes. Closing never calls the dealer.
   The pool (`poolOf`) is worked out from the recipe and that count; the dealer lays it out at the first deal.
4. **Opening:** a holder calls `open(fire, count)` (any number of packs). The packs are burned and drand randomness
   is requested. **Nothing about the packs exists before this.** (The leftover pool is public, so the last pack of a
   Series gets exactly what's left. That comes with exact totals.)
5. **Dealing:** when the randomness arrives, anyone calls `process(maxCards)` (the live site is planned to call it
   right away). Opens are dealt strictly in order, up to `maxCards` cards per call; a pack can be split across calls
   (a 1,000-card pack is ~63M gas, so a few calls of ~300 cards each). Each pack gets the next block of serials, in a
   shuffled order (Fisher-Yates for packs up to 256 cards, a keyed Feistel permutation above), so a serial says nothing
   about its slot. Results depend only on the words and the open order, never on who processes or how it is split.
6. **Metadata:** `tokenURI` is built on-chain. Name `<type name> <character> #<serial>`; image `<imagesBase>` +
   `c<character>-<type slug>-<holo>-<grade>.webp` (`imageName`; `holo` is `none`, `frame`, `picture` or `full`, `grade`
   `u` or `1` to `10`). Traits: Character, Category, Material (the type name), Holo, Series, Edition ("k", then "k of
   N" once every pack of the Series is dealt), Serial, PDA, plus any the dealer adds. A Standard Series' images are
   named exactly as before (`c0-coal-full-7.webp`).

## What is set per Series, and when it locks

| Setting | Where | Locks |
|---|---|---|
| Dealer | `FireCards.setDealer` | first pack minted, `lockFire`, or close |
| Card types, slots, cards per pack, supply, caps, holo | `RecipeDealer.setRecipe` | same |
| Characters | `setCharacters`, `appendCharacters` | same |
| PDA odds (any weights for grades 1-10) | `FirePsa.setOdds` | first pack minted or close |
| Image folder | `FireCards.setImagesBase` | `lockFire` only (moving the images never changes a card) |
| Drop settings, incl. `maxPerTx` | `FireSale.configureDrop` | the drop's start |
| Cards per free credit (global) | `FireSale.setCardsPerCredit` | changeable only while no drop is set up or running |

## Technical ceilings (not product rules)

| Ceiling | Why |
|---|---|
| Series number < 2^64 | stored in 64 bits in every card (was 2^32) |
| Packs per Series < 2^64 (`FirePacks` refuses more) | the frozen count is 64-bit |
| Cards per pack < 2^32, types < 2^32, characters < 2^32 | per-card fields are 32-bit; a card is one storage word |
| Cards of one type per Series < 2^128 | dealing counts are packed two per slot |
| Editions < 2^64 | per-card field |
| Name 64 bytes, category 32, slug 32 | metadata size; same rules as the studio |
| Recipe size | owner gas per transaction (stored as contract code in 24,000-byte chunks, so no hard size) |
| Dealing | block gas: `process(maxCards)` splits any pack; a card costs ~60k gas |
| PDA reveal: 10 cards per call | gas guard on `finish` (kept) |
| Royalty <= 10%, drop windows <= 30 days, end grace 7 days, price-feed ages, 90% swap floor | buyer-protection guards (kept) |

## Safety

- Results depend only on the random words and the open order, not on who calls `process(maxCards)`, when, or how
  the work is split.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- If an open's randomness never arrives (a day, and the router has no answer), anyone can `rerequest` it. After 7
  days with no answer (randomness gone for good), anyone can `cancelOpen`: the packs go back to the holder, sealed.
- The owner can't change a Series' dealer, recipe, characters or PDA odds once its first pack is minted. Closing
  doesn't depend on the dealer, so a drop can always close.
- The owner can't change a dealt card. It can move a Series' image folder until `lockFire`.
- Trust: the dealer is code the owner chooses per Series (before its first pack). `RecipeDealer` is the one in this
  repo, covered by the tests; a future dealer is trusted like the owner's other settings, and must deal only from its
  own state and the seed and keep its text JSON-safe.

## Gas (Standard recipe, `forge test --match-test test_gas -vv`)

| | Before | Now |
|---|---|---|
| `open` 1 pack | ~101.9k | ~99.3k |
| `process` 1 pack (6 cards) | ~345.8k | ~365.4k (+5.7%) |
| `process` a 10-pack open | ~3.26M | ~3.47M (+6.4%) |

The extra is the call to the dealer and reading the compiled recipe (stored as contract code, read in one copy).

## Tests

`contracts/test/cards/` (`Cards.t.sol`, `Recipe.t.sol`, `Sale.t.sol`, `Psa.t.sol`, `SaleFork.t.sol`) and
`contracts/test/invariant/` (fuzz and invariant suites, including `RecipeFuzz.t.sol`). They cover:
- the Standard pool matches the studio's own code over 344 Series sizes and Diamond settings (`pool-fixture.json`,
  written by `studio/scripts/pool-fixture.test.ts` with `WRITE_POOL_FIXTURE=1`; format unchanged), and the Standard
  odds match a re-implementation of the previous contract's dealing
- every Standard pack keeps its guarantees, totals are exact, holo rates converge (Diamond always holo, exact thirds)
- new shapes: 3-card all-holo packs, 100 characters in batches, a new Gold type, 1-card packs, a 1,000-card pack in
  10 calls (same cards as one call), recipes spanning several storage chunks, the floor topping up and taking back
- bad recipes refused with the reason (not nested, a type no slot takes, filler, never-holo in a must-holo slot, slots,
  slugs, shares, holo)
- every setting locks at the first pack, and a dealer can't be swapped after it
- fuzz: random nested recipes and Series sizes; every card fits its slot, must-holo slots are holo, totals exact,
  never beyond the pool, every slot set always has enough
- the same words give the same cards however processing is split; out-of-order randomness waits its turn
- permissions, burns, royalties, metadata, image names, moving the image folder until the lock, the JSON configure path

## Deploying

`contracts/script/DeployCards.s.sol` deploys and wires everything in one run: FirePacks, FireCards, RecipeDealer,
FireSale, FirePsa, two drand adapters (FireCards, FirePsa), the royalty. It hands ownership to the multisig (`OWNER`),
which must then call `acceptOwnership()` on FirePacks, FireCards, RecipeDealer and FirePsa; FireSale is owned by
`OWNER` from deployment. The script checks every input first and refuses a plain wallet as owner unless told
otherwise. A test runs the same steps.

`contracts/script/ConfigureSeries.s.sol` sets up a Series from a recipe JSON: it checks the recipe against the dealer,
then prints each call (target and calldata) for the multisig, or sends them with `SEND=true` when the signer is the
owner (testnet). Inputs: `RECIPE_JSON`, `RECIPE_DEALER`, `FIRE_CARDS`, `FIRE_PSA` (if the JSON has `pdaOdds`),
`CHARACTER_BATCH` (characters per call, default 200).

- **Settings:** `.env.example` (card contracts section). No keys in `.env`: sign with the Foundry keystore or a Ledger.
- **Right after the deploy:** the multisig accepts ownership, then checks the wiring: the seller is FireSale on packs
  and cards, cards point at packs, the dealer points at cards and packs, the PDA is FirePsa, randomness points at the
  two adapters, no Series is configured or locked yet, and the royalty is what was set.
- **Keeper** (not built yet; every call is permissionless):
  - `PlankUsdTwap.checkpoint()` every 30 minutes
  - `PaperUsdTwap.checkpoint()` when `due()`
  - `FirePsa.pokePrice()` now and then
  - delivering drand numbers to the router (`OpenDrandRouter.fulfill`; `adapter.settle` if a callback didn't land)
  - `FireCards.process(maxCards)` and `FirePsa.finish(index)` if the site doesn't call them
- **Before deploy day:** run the real-chain gas test (PowerShell, from `contracts`):
  ```powershell
  $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"
  forge test --match-path test/cards/SaleFork.t.sol -vv
  ```

The site has the ABIs: `web/src/lib/abi/` (`fireCardsAbi.json`, `firePacksAbi.json`, `fireSaleAbi.json`,
`firePsaAbi.json`, `recipeDealerAbi.json`), exported by `web/src/lib/cards.ts`.

## Past review fixes after the redesign

See `docs/audit-2026-10.md` ("Per-Series recipes"). Every guarantee is kept; a few are widened or moved.

## Money and the economy

See `docs/omni-economy.md`. The contracts never hold funds: whatever is paid is forwarded or burned in the same
transaction.

## Still open

See `docs/roadmap.md`.
