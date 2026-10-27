# Card contracts: packs, cards, opening

`contracts/src/cards/`. The sale and fee economics are in `docs/omni-economy.md`; cases, grading, wear and slabs in
`docs/grading.md`. The Standard recipe matches `docs/card-studio.md`.

**Naming.** The contracts are named `Fire*` for historical reasons: `Fire*` is the card system. In identifiers
(`fire`, `lockFire`, `fires`), "fire" is a Series number. This doc says "Series" in prose.

**The idea.** Every rule about what a Series' cards are is a per-Series setting: card types, holo odds, the pack's
shape (its **slots**, each a number of cards with its own odds per type), characters (and optionally their odds), card
images. Every pack has the same shape and every card is rolled on its own from its slot's fixed odds, so the first and
the last pack of a Series have exactly the same odds (no pool, no caps, no guarantees beyond what the slots say). The only limits left are technical (type widths and block gas), and big work
is split into batches instead of capped. Every setting locks when the Series' drop is set up (`configureDrop`), before
anyone can buy, so buyers can trust the odds, and all of it can be read on-chain. PDA grading is the exception the
other way: its fresh odds and wear rules are fixed forever in `FirePsa`, the same for every Series
(`docs/grading.md`); only the case and grading prices can change.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155 ("Omni Card Packs", `OMNIPACK`): one stackable token type per Series (token id = Series number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp`. The description reads the Series' cards per pack from `FireCards`. Royalty (ERC-2981). |
| `FireCards` | The permanent core. The cards, ERC-721 ("Omni Cards", `OMNICARD`; token id = global serial), one opening queue per Series, randomness (drand router and adapter), serials, print numbers, each card's wear (age uncased, moves, cased) and PDA grade. Per Series it keeps the dealer, the image folder, the frozen pack count and progress. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `CardsRenderer` | Builds each card's `tokenURI` JSON and image name (`imageName`, `imageFile`) from `FireCards` and the dealer. No owner, no settings; set once on `FireCards`. |
| `IDealer` | What `FireCards` asks of a Series' dealer: `ready`, `cardsPerPack`, `characterCount`, `deal(fire, seed, fromCard, count)` and `cardText`. The owner picks a dealer per Series. Future dealers can add mechanics (their own state, 32 bits of per-card "extra" data, extra metadata attributes) without touching `FireCards`. |
| `RecipeDealer` | The first dealer: deals each Series from its own recipe, slot by slot (below). It keeps no dealing state: `deal` is a view of the seed, so anyone can check a pack. Owned by the owner (the hardware wallet). |
| `RecipeCompiler` | The recipe checker and compiler (the plan the dealer reads: the types' holo odds, and per slot its end in the pack and cumulative type weights), its own contract. Pure: no state, no owner. |
| `StandardRecipe` | The Standard Omni odds as a recipe (library). |
| `FireSale` | Sells the packs (`docs/omni-economy.md`, `docs/drop-groups.md`): a purchase names its group (`buy(fire, group, n, pay, maxCost, maxPaper, access)`) and pays the group's dollar price in PLANK, ETH or USDG (the coins the group takes), or ETH alone (`buyWithEthAll`: it also buys the packs' PAPER on the market and burns it), plus the group's PAPER. Every product rule is a per-drop setting (total packs and its groups, each with its own PLANK and PAPER burn shares; PAPER dollar ceiling, regular-wallets rule, packs per purchase, credits per picked suggestion and credit caps). Closes the Series the moment nothing can still sell, or when the drop is ended. The owner can pause buying (`setPaused`). Never holds funds. |
| `FireGroups` | Each drop's groups (split out of `FireSale` for contract size): config, timing (opens with the drop or after another group; ends sold out, at its duration, or after `idle` with no sale), unlimited groups, the rising tax, per-purchase limits, capacity with rolled-in leftovers, gates (open, NFT with packs per NFT id, Merkle snapshot with a per-wallet allowance), wallet limits (optionally lifting on a timer, `limitFor`), and the views the site reads (`groupsOf`, `boughtBy`, `remaining`, `openLeft`, `scheduleEnd`). Only `FireSale` writes to it (set once at deploy); no owner. |
| `FireCredits` | Free pack credits, card burning (42 cards = 1 credit, fixed forever) and character suggestions, split out of `FireSale` for contract size (same rules). It spends credits, burns cards and takes suggestion PAPER through `FireSale` hooks only it can call (`creditPacks`, `burnCardsFor`, `burnPaperFor`), so PAPER is approved to `FireSale` alone. Owned by the owner (picks, suggestion rules). |
| `PlankBurner` | Gets the sale's PLANK burn share when the swap can't run (a stale PLANK price or a failed swap). No owner, no withdraw: anyone calls `flush`, which buys PLANK (95% TWAP guard, halving for a backlog) and sends it to the dead address. |
| `FirePsa` | Cases and PDA grading (`docs/grading.md`): `protect(caseIds, gradeIds, pay, maxCost)` cases and/or sends for grading up to `maxBatch` cards (20; owner setting, at most 100) in one transaction, priced in dollars (one case price and one grading price for every card: `quote(cases, grades, pay)`), paid in PLANK, ETH or USDG (`Pay` PLANK 0, ETH 1, USDG 2); every fee buys PAPER and burns it. drand picks each grade (1 to 10) from the fresh odds and the card's frozen wear (both fixed forever, the same for every Series); the card is slabbed. The only contract that can case a card or set a grade, once per card. |
| `PaperBurner` | Gets FireSale's PAPER share of every sale (20% in the Standard drop) and 100% of every case and grading fee (paid in PLANK, ETH or USDG), buys PAPER with it on owner-set routes and burns it. Only flushers the owner names (FirePsa and the keepers, `setFlusher`) can flush it. FirePsa burns only the fee it just took (`flushLight(pay, fee)`), so wrapping a case in a buy and a sell can't make it spend the backlog; the keepers' `flush` (its own transaction; Robinhood Chain's sequencer is first-come with no public mempool) drains the rest. A PAPER price from a window over 30 hours makes it wait. No withdraw; the router is fixed at deploy. |
| `FireProfiles` | Each wallet's public profile: a name and a profile picture cut from one of its own cards. No owner, no fees, no admin, no upgrade; it only reads `FireCards` (fixed at deploy). Details below. |

Every owned contract refuses `renounceOwnership` (control can't be lost by mistake); ownership moves only in two
steps (`transferOwnership`, then `acceptOwnership`). `FirePacks` and `FireCards` have an owner-set `contractURI`
(ERC-7572, `ContractURIUpdated`) for collection pages on marketplaces.

## A Series' recipe (RecipeDealer)

`setRecipe(fire, recipe)`, `setCharacters(fire, names, categories)`, `appendCharacters(...)` and
`setCharacterWeights(fire, weights)`, by the owner, until the Series is locked (its drop is set up, or `lockFire`), its
first pack is minted or it closes. `check(recipe)` validates a recipe without storing it and reverts with the reason
(the studio can call it).

A recipe is a list of card types and the pack's slots:

```solidity
struct CardType { string name; string slug; uint32 rank; HoloMode holoMode; uint64[4] holo; }
struct Slot { uint32 count; uint64[] weights; } // one weight per card type (recipe order); 0 = never in this slot
struct Recipe { CardType[] types; Slot[] slots; }
```

### Card types

A list, any length (index stored in 32 bits). Each type has:

| Field | Meaning |
|---|---|
| `name` | The "Material" trait and the first word of the card's name. 1 to 64 bytes of valid UTF-8, no `"`, `\` or control characters. |
| `slug` | Used in image file names. 1 to 32 bytes of `[a-z0-9-]`, unique in the recipe. |
| `rank` | Rarity order for display (higher = rarer; the site sorts by it). Ties allowed. Dealing doesn't use it. |
| `holoMode`, `holo[4]` | `Independent`: frame and picture rolled separately, chances out of 1e18 in `holo[0]`, `holo[1]` (two 100% = always full holo). `Distribution`: weights for none, frame, picture, full (any total above 0). |

### Slots

The pack's shape, in pack order: slot 1's cards come first, then slot 2's, and so on. Each slot has:

| Field | Meaning |
|---|---|
| `count` | Cards in the slot, at least 1. Cards per pack = the slots' counts added up, 1 to 1,000 (`MAX_CARDS_PER_PACK`). |
| `weights` | One weight per card type, in recipe order (`uint64`). A card of this slot is type t with chance `weights[t] / (the slot's total)`. 0 = never in this slot; the total must be above 0. |

A slot can allow every type, some, or one (one = that type, every pack). Nothing is shared between slots: no pool,
no caps, no guarantees beyond what the weights say.

Checks (`RecipeCompiler.compile`, in this order; errors `BadRecipe(why)`, `BadType(index, why)`, `BadSlot(index, why)`,
`BadText`): at least one type (`"no types"`), at least one slot (`"no slots"`), then per type: name length and text,
slug length, characters and uniqueness, holo chances at most 100% and `holo[2..3]` zero in `Independent` mode (`"holo
chances"`), holo weights above 0 in `Distribution` mode (`"holo weights"`); then per slot: a count of at least 1
(`BadSlot(s, "count")`), one weight per type (`"one weight per type"`), cards per pack so far at most 1,000
(`BadRecipe("cards per pack")`), a total above 0 (`BadSlot(s, "weights")`); then every type in at least one slot
(`BadType(t, "in no slot")`: a type listed but never dealt is refused).

### Characters

Names and categories, in image order (`c0`, `c1`, ...), any number (index stored in 32 bits). Names 0 to 64 bytes,
categories 1 to 32 bytes, both free text with the same rules as type names (valid UTF-8, JSON-safe). `setCharacters`
replaces the list (a fresh list, so a long one can always be replaced); `appendCharacters` adds batches for long lists.

**Character odds (optional).** `setCharacterWeights(fire, weights)`: one weight per character, in character order,
each at least 1 (`BadWeights` otherwise); a character's chance is its weight over the total. An empty list = every
character equally likely: the default, and Series 7's. Weights belong to the character list: `setCharacters` starts a
new list with equal odds, and after `appendCharacters` the Series isn't `ready` (nor lockable) until the weights match
the longer list again. They lock with the Series like everything else. Stored as cumulative weights in code storage;
dealing reads them once per `deal` call and binary-searches each card.

### Dealing

Slot by slot. For each card (per pack seed `keccak256(word, pack index)`, per card `r = keccak256(packSeed,
position)`): its slot is the one its position falls in; its type is the first type whose cumulative weight in that
slot is above `r % (the slot's total)` (a binary search over the slot's cumulative weights, compiled ahead); then its
holo from
`keccak256(r, 1)` and `keccak256(r, 2)` by the type's holo rule; then its character from `keccak256(r, 3)`: uniform
(`% characters`) or, with weights, the first character whose cumulative weight is above it (equal weights give exactly
the uniform result). A card's chance = its slot's type odds x holo odds x character odds; a type's expected cards per
pack = the sum over the slots of count x the slot's odds for it.

No pool, caps or holdbacks: nothing depends on what was dealt before or how many packs there are, so the first and the
last pack of a Series have exactly the same odds, and a card type or a character can come up any number of times (or
not at all) in a Series, within what the slots allow. `deal` is a view: it depends only on the seed and the Series' fixed
settings, so anyone can call it to check a pack (FireCards passes the same seeds).

### The Standard recipe

Six cards a pack, in four slots ("3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better", the old pool's shape):

| Slot | Cards | Weights |
|---|---|---|
| 1 | 3 | Paper 1 (always Paper) |
| 2 | 1 | Wood 1 (always Wood) |
| 3, Wood or better | 1 | of 1,000: Wood 449, Fire 300, Coal 120, Gold 86, Full Art 45 |
| 4, Fire or better | 1 | of 10,000: Fire 5,982, Coal 1,734, Gold 1,534, Full Art 750 |

| Type | Rank | Per pack (average) | Share of cards | Holo |
|---|---|---|---|---|
| Paper | 0 | 3 | 50% | independent, each roll 1 - sqrt(0.95) (5% any holo) |
| Wood | 1 | 1.449 | 24.15% | 10% |
| Fire | 2 | 0.8982 | 14.97% | 50% |
| Coal | 3 | 0.2934 | 4.89% | 90% |
| Gold | 4 | 0.2394 | 3.99% | always full holo |
| Full Art | 5 | 0.12 | 2% | always full holo |

Characters: equal odds. Slots 3 and 4 were set so the per-pack averages are exactly the straight odds' they replace
(50 / 24.15 / 14.97 / 4.89 / 3.99 / 2% of 6 cards; slots 3 + 4 together: Wood 0.449, Fire 0.8982, Coal 0.2934, Gold
0.2394, Full Art 0.12), which kept the old pool dealing's expected share of each type for the example Series this doc
always used (167 packs, 20 characters: 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full Art of 1,002). So
every exact card is as rare as before (with 20 characters one exact Full Art is 1 in 1,000 cards; with 10, 1 in 500),
and every pack has 3 Paper, a Wood and a Fire or better. Nothing caps the rest: two Full Arts in a pack (4.5% x 7.5%,
about 1 in 300 packs) or two Golds (about 1 in 76) happen.

### Views

`recipeOf(fire)` (the whole recipe), `slotsOf(fire)` (per slot, in pack order: its count, its weight for each type and
its total), `characterOddsOf(fire)` (each
character's weight and the total; all 1 with no weights), `holoOdds(fire, type)` (none / frame / picture / full out of
1e18), `deal(fire, seed, fromCard, count)` (a view), `characterOf`, `charactersOf(fire, from, count)`,
`characterCount`, `cardsPerPack`, `check(recipe)`.

### Recipe JSON (for the studio)

`script/ConfigureSeries.s.sol` reads this shape (example: `contracts/test/cards/recipe-standard.json`). Numbers above
2^53 (holo chances) go as strings; any number may.

```json
{
  "fire": 7,
  "imagesBase": "ipfs://<images CID>/",
  "types": [
    { "name": "Paper", "slug": "paper", "rank": 0,
      "holo": { "mode": "independent", "frame": "25320565519103609", "picture": "25320565519103609" } },
    { "name": "Wood", "slug": "wood", "rank": 1,
      "holo": { "mode": "independent", "frame": "51316701949486200", "picture": "51316701949486200" } },
    { "name": "Fire", "slug": "fire", "rank": 2,
      "holo": { "mode": "independent", "frame": "292893218813452475", "picture": "292893218813452475" } },
    { "name": "Coal", "slug": "coal", "rank": 3,
      "holo": { "mode": "independent", "frame": "683772233983162066", "picture": "683772233983162066" } },
    { "name": "Gold", "slug": "gold", "rank": 4,
      "holo": { "mode": "distribution", "weights": ["0", "0", "0", "1"] } },
    { "name": "Full Art", "slug": "fullart", "rank": 5,
      "holo": { "mode": "distribution", "weights": ["0", "0", "0", "1"] } }
  ],
  "slots": [
    { "count": 3, "weights": { "paper": 1 } },
    { "count": 1, "weights": { "wood": 1 } },
    { "count": 1, "weights": { "wood": 449, "fire": 300, "coal": 120, "gold": 86, "fullart": 45 } },
    { "count": 1, "weights": { "fire": 5982, "coal": 1734, "gold": 1534, "fullart": 750 } }
  ],
  "characters": [ { "name": "Ember Fox", "category": "Animals" } ],
  "sale": {
    "start": 1900000000, "packs": 167, "paperCapUsd": "100000000",
    "maxPerTx": 50, "regularWalletsFor": 172800,
    "creditsPerPick": 1, "creditPacksMax": 16, "creditPacksPerWallet": 3, "creditGroup": 2,
    "groups": [
      { "name": "Paper Press holders", "packs": 50, "gate": "nft", "nft": "press", "perNft": 1,
        "priceUsd": "0", "paper": "1000000000000000000", "coins": 0, "plankBurnBps": 1000, "paperBurnBps": 2000, "perWallet": 2,
        "afterGroup": 255, "startDelay": 0, "duration": 21600, "rollTo": 2 },
      { "name": "PLANK holders", "packs": 40, "gate": "snapshot", "root": "0x...",
        "priceUsd": "250000000", "paper": "1000000000000000000", "coins": 1, "plankBurnBps": 1000, "paperBurnBps": 2000, "perWallet": 5,
        "afterGroup": 255, "startDelay": 0, "duration": 86400, "rollTo": 2 },
      { "name": "Everyone", "packs": 77, "gate": "open",
        "priceUsd": "250000000", "paper": "1000000000000000000", "coins": 7, "plankBurnBps": 1000, "paperBurnBps": 2000,
        "perWallet": 5, "limitFor": 86400,
        "afterGroup": 1, "startDelay": 0, "duration": 0, "rollTo": 255 },
      { "name": "After sell-out", "packs": 0, "unlimited": true, "gate": "open", "taxBps": 400, "idle": 900, "perTx": 1,
        "priceUsd": "250000000", "paper": "1000000000000000000", "coins": 2, "plankBurnBps": 1000, "paperBurnBps": 2000, "perWallet": 0,
        "afterGroup": 2, "startDelay": 0, "duration": 0, "rollTo": 255 }
    ]
  }
}
```

`slots` is required, in pack order: each slot's `count` and its `weights` by type slug (a type left out has weight 0
in that slot; a slug that isn't one of the types is refused); cards per pack is the counts added up. `holo.mode`: `independent` (`frame`, `picture` out of 1e18) |
`distribution` (`weights`: none, frame, picture, full). A character may have a `weight` (character odds): every
character or none (equal odds); each at least 1; the script then sends `setCharacterWeights` after the characters.
`imagesBase` is optional. There are no PDA odds in it: they are fixed in `FirePsa` for every Series. The JSON is read
strictly: unknown keys (a `pdaOdds` key, the straight-odds keys `cardsPerPack` and a type's `weight`, and the old pool
keys `supply`, `amount`, `maxPerPack`, `minRank`, included),
numbers too big for their field and a drop start more than 365 days away are refused.

`sale` (optional; the studio's Sale tab) is `FireSale.DropConfig` by name, in contract units: seconds, dollars with 8
decimals, PAPER in wei, burn shares in basis points. Every key is required unless said otherwise.

- Drop-wide: `start`, `packs` (the total; the groups' `packs` must add up to it), `paperCapUsd` (0 = no ceiling), `maxPerTx` (0 = 50), `regularWalletsFor` (at most 30
  days; 0 = off), `creditsPerPick`, `creditPacksMax` and `creditPacksPerWallet` (0 = no limit), `creditGroup` (the
  index of the group credit packs come from, 0 = the first; 255 = no credit packs), `groups` (1 to 6, in order: a
  group's index is its place in the list).
- Each group (`FireGroups.Group`): `name` (optional; the studio's label, not sent on chain), `packs` (its own; leftovers
  rolled in come on top; 0 allowed for a group that only takes leftovers), `gate` (`"open"`, `"nft"` or `"snapshot"`),
  `priceUsd` (0 = no dollar price), `paper` (PAPER per pack, 0 = none; both 0 = free, never for an open group),
  `coins` (for the dollar price: PLANK 1 + ETH 2 + USDG 4, so 7 = any; at least one when there is a price; ETH includes
  `buyWithEthAll`), `plankBurnBps` + `paperBurnBps` (the group's burn shares of its dollar price, together at most
  10000; the rest goes to the revenue wallet; Standard 1000 + 2000 in every group; a group with no dollar price has
  nothing to split but still sets them), `perWallet` (0 = no limit), `afterGroup` (255 = opens with the drop; else an EARLIER group's
  index: opens when that group ends), `startDelay` (seconds after the drop's start or that group's end, at most 30
  days), `duration` (longest it stays open, at most 30 days; 0 = until its packs are gone), `rollTo` (where its
  unsold packs go when it ends: a LATER group's index, or 255 = nowhere, never made), and optional keys (0 /
  false when left out): `limitFor` (seconds, at most 30 days, needs a `perWallet`: the per-wallet limit lifts this long
  after the group opened, then no limit; the studio's "limit lifts after (hours)", blank = never), `taxBps` (at most 5000: a rising tax, below), `idle` (seconds, at most 30 days: the group also
  ends once nothing has sold in it for this long, counted from when it opened, then from each sale, exactly as if its
  duration had run out: its leftovers roll and the group after it opens then), `perTx` (most packs in one purchase in
  this group; 0 = the drop's `maxPerTx`; credit packs ignore it), `unlimited` (below).
  - `"nft"` groups also have `nft` (the ERC-721's address, or `"press"` for the Paper Press: `MILL` from the
    environment or the deployments file) and `perNft` (packs per NFT id per drop, at least 1).
  - `"snapshot"` groups have `root` (the Merkle root from `ops/snapshot`), or leave it out and set `GROUP_ROOT_<i>`
    when the script runs (the snapshot is taken just before the drop). The leaves are OpenZeppelin StandardMerkleTree
    leaves of `["address", "uint256"]` (wallet, allowance): `keccak256(bytes.concat(keccak256(abi.encode(wallet,
    allowance))))`. A buyer passes its allowance and proof.
  - `nft`/`perNft` on a non-NFT group, or `root` on a non-snapshot group, are refused.
  - **Rising tax** (`taxBps`): the k-th pack sold in the group (k = 1 for its first sale, credit packs counted) costs
    `priceUsd * (1 + taxBps/10000)^k`. The part above `priceUsd` is the tax: ALL of it goes to PaperBurner (buys PAPER
    and burns it), in the coin paid; the base price splits like any sale. Buying n packs prices packs sold+1 .. sold+n
    (closed form, 18-decimal fixed point, rounded up); `quote` includes it and `maxCost` guards it. It needs a dollar
    price; no group may roll leftovers into a taxed group (its capacity is its own `packs`); and the last pack may cost
    at most 1e9 times the base (`(1 + taxBps/10000)^k <= 1e9`). That is a safety bound for the maths, not a sales cap:
    at 4% it's pack ~528, by which point a $2.50 pack costs ~$2.5 billion. A finite taxed group must fit it whole (at
    most 528 packs at 4%); an unlimited one refuses buys past it (`PriceTooHigh`) and simply idles out.
  - **Unlimited** (`"unlimited": true`, `"packs": 0`): a group with no pack count (an "after sell-out" group: demand is
    capped by its rising price, not by a count or a time limit). It needs `taxBps` and `idle` (so it always ends on its
    own, once nobody has bought for `idle`), rolls nowhere (`rollTo` 255), and nothing rolls into it. `duration` may be
    0 (no time limit). While it is open (or yet to open) `remaining`/`status(fire).left`/`openLeft` read
    `type(uint256).max`, its view shows capacity and left as `type(uint256).max`, and the Series stays open; it closes
    once the group has idled out (`close`, by anyone, if nothing else is left).

**Total packs.** `packs` is the base Series: the sum of the finite groups' packs. Packs a finite group doesn't sell
that roll nowhere are simply never made (the Series ends smaller); an unlimited group adds what it sells on top. The
Series' final pack count is whatever was minted (`FireCards.closeFire` freezes `FirePacks.minted`). Dealing doesn't
depend on it: every pack of a Series larger than its base total deals at the same odds as any other.

`DROP_START` overrides `start` and `GROUP_ROOT_<i>` group i's root. The script checks every rule the contract checks
and names the field that is wrong (`sale.groups: the groups' packs add up to 168, not sale.packs (167)`,
`.sale.groups[2].afterGroup: an earlier group's index, or 255 to open with the drop`, unknown keys by name...). The
studio's sample export is `contracts/test/cards/recipe-studio-sale.json` (the Standard preset; written by
`studio/scripts/sale-sample.test.ts`; `Sale.t.sol` runs it through the script and `configureDrop`).

## The flow

1. **Before a Series** (the owner, the `OWNER` hardware wallet; `ConfigureSeries.s.sol` sends these calls from the JSON):
   `RecipeDealer.setRecipe`, `setCharacters` (+ `appendCharacters`), `FireCards.setDealer(fire, dealer)` (the dealer
   must already have the Series ready), `FireCards.setImagesBase(fire, base)`. Then
   `FireSale.configureDrop` (it requires `FireCards.ready(fire)`; the script adds it last from the `sale` block).
   `configureDrop` calls `FireCards.lockForSale(fire)`: from then the dealer, recipe, characters and image folder are
   fixed. Every lock (`lockForSale`, `lockFire`) and `ready` check again that the Series has an image folder, that
   its dealer's cards per pack is 1 to `MAX_CARDS_PER_PACK` and that the dealer has it `ready` (character weights
   matching the characters; a dealer setting changed after `setDealer` isn't otherwise rechecked), so a locked Series
   can always be dealt.
2. **During the drop:** the seller (`FireSale`) mints packs. They're tradeable sealed.
3. **When the drop ends:** the seller calls `closeFire(fire)`. The pack count freezes. Closing never calls the dealer.
4. **Opening:** a holder calls `open(fire, count)` (any number of packs). The packs are burned and drand randomness
   is requested. Each Series has its own queue. **Nothing about the packs exists before this.** Every card is rolled
   from the Series' fixed odds, so no pack (the last included) can be predicted from what was opened before.
5. **Dealing:** when the randomness arrives, anyone calls `process(fire, maxCards)` (the live site is planned to call it
   right away). A Series' opens are dealt strictly in order, up to `maxCards` cards per call; a pack can be split across
   calls (a 1,000-card pack, the most allowed (`MAX_CARDS_PER_PACK`), is ~63M gas, so a few calls of ~300 cards each). Each pack gets the next block of serials, in a
   shuffled order (Fisher-Yates for packs up to 256 cards, a keyed Feistel permutation above), so a serial says nothing
   about its position. Results depend only on the words and the open order, never on who processes or how it is split.
6. **Metadata:** `tokenURI` is built on-chain by `CardsRenderer`. Name `<type name> <character> #<serial>`; image
   `<imagesBase>` + `c<character>-<type slug>-<holo>-<state>.webp` (`imageName`; `holo` is `none`, `frame`, `picture` or
   `full`, `state` `u` (ungraded), `c` (cased) or `1` to `10` (slabbed)). Traits: Character, Category, Material (the type
   name), Holo, Series, Print number (a number: this is the k-th of this exact card, i.e. the same Series, character, type
   and holo look, in the order dealt; the first one opened is #1; final the moment it is dealt, no "of N"), Serial,
   plus any the dealer adds. Ungraded: PDA "Ungraded", Cased, Dealt (a `date` trait), Moves, and once cased Age when cased (days), frozen
   (the condition is never shown; nothing changes just because time passes). Graded: "PDA N" only. Example: `c0-coal-full-7.webp`.
7. **Wear, cases and grading:** each card wears with time uncased and with moves between wallets until it is cased or
   graded; `FirePsa.protect` cases and grades. A card being graded can't be transferred. A move that counts emits
   `Moved` and an ERC-4906 `MetadataUpdate` (its Moves trait changed). Rules in `docs/grading.md`.

## What is set per Series, and when it locks

| Setting | Where | Locks |
|---|---|---|
| Dealer | `FireCards.setDealer` | drop set up (`configureDrop` -> `lockForSale`), first pack minted, `lockFire`, or close |
| Card types, holo, the pack's slots (cards and weights per slot) | `RecipeDealer.setRecipe` | same |
| Characters and their odds | `setCharacters`, `appendCharacters`, `setCharacterWeights` | same |
| Image folder | `FireCards.setImagesBase` | same (the art people buy can never be swapped) |
| Drop settings (all of them, below) | `FireSale.configureDrop` | the drop's start |

## Every sale and economy setting

Per Series = set in `configureDrop` for that drop, locked at its start. Global = one owner setting for everything.

| Setting | Where | Scope | Default (Standard) | Bound, and why |
|---|---|---|---|---|
| Total packs | `DropConfig.packs` | per Series | 167 (the base Series: the finite groups' sum; an unlimited group adds on top) | < 2^64, > 0; the groups' packs add up to it |
| Groups | `DropConfig.groups` (`FireGroups.Group`) | per Series | 4 (Standard preset, `docs/drop-groups.md`) | 1 to 6 |
| A group's packs | `Group.packs` | per group | 50 / 40 / 77 | < 2^64; leftovers rolled in come on top |
| Who can buy | `Group.gate` (+ `nft`, `perNft` / `root`) | per group | Press holders (1 per press), PLANK snapshot, everyone | NFT: a contract with code, `perNft` >= 1 per NFT id per drop (an NFT passed on never buys again). Snapshot: a root; each leaf carries the wallet's allowance. Open: no gate data |
| Price per pack | `Group.priceUsd` (8 dec.) | per group | $0 / $2.50 / $2.50 | any; 0 = PAPER only (or free) |
| PAPER per pack | `Group.paper` | per group | 1 PAPER | any; price and PAPER both 0 = free, refused for an open group (a $0 typo would give packs away) |
| Coins taken | `Group.coins` | per group | - / PLANK / any | PLANK 1, ETH 2, USDG 4 (mask); at least one with a price |
| Per wallet | `Group.perWallet` | per group | 2 / 5 / 5 | 0 = no limit; credit packs don't count |
| Per-wallet limit lifts after | `Group.limitFor` | per group | - / - / 24h on Everyone (placeholder) | seconds after the group opened; 0 = the limit holds the whole time; needs `perWallet`; <= 30 days; `groupsOf().limitUntil` is when it lifts |
| When it opens | `Group.afterGroup`, `startDelay` | per group | with the drop / with the drop / after group 2 | `afterGroup` an earlier group or 255; delay <= 30 days |
| How long it stays open | `Group.duration` | per group | 6h / 24h / until sold | <= 30 days; 0 = until its packs are gone. It ends sold out (once no leftovers can still arrive) or at its duration |
| Where its unsold packs go | `Group.rollTo` | per group | group 3 / group 3 / nowhere / nowhere | a later group or 255 (never made: the Series closes smaller) |
| Rising tax | `Group.taxBps` | per group | 4% a pack on "After sell-out" | 0 = off; at most 50%; needs a price; nothing rolls into it; any pack at most 1e9 x the base (safety bound). The whole tax buys and burns PAPER |
| Ends after no sale for | `Group.idle` | per group | 15 min on "After sell-out" | 0 = off; <= 30 days |
| Most packs per purchase in the group | `Group.perTx` | per group | 1 on "After sell-out" | 0 = the drop's `maxPerTx`; credits ignore it |
| No pack count | `Group.unlimited` | per group | "After sell-out" | packs 0, needs `taxBps` and `idle`, rolls nowhere; adds on top of the total |
| PAPER ceiling per pack | `paperCapUsd` (8 dec.) | per Series | $1 | any, 0 = no ceiling. A pack's PAPER (every group's and credit packs) is never worth more than this at the `PAPER_USD` feed's price; while the feed is late the last good price holds (`lastPaperUsd`); before its first price, the set PAPER |
| PLANK burn share | `Group.plankBurnBps` | per group | 10% in every group | 0 to 100%, with the group's PAPER share (`BadGroup(i)` over 100%). The PLANK holders' group could burn 100% of the PLANK it takes |
| PAPER buy & burn share (to `PaperBurner`) | `Group.paperBurnBps` | per group | 20% in every group | 0 to 100%, with the group's PLANK share |
| Most packs per purchase / credit spend | `maxPerTx` | per Series | 50 (0 = 50) | < 2^32. Gas is flat: 100 packs cost about what 1 does |
| Regular wallets only for | `regularWalletsFor` | per Series | 48h | <= 30 days; 0 = off. Every group; not credits |
| Credit group | `creditGroup` | per Series | group 3 | a group index, or 255 = no credit packs. Credits spend its packs while it is open, for its PAPER only (its gate, price, coins and wallet limit don't apply) |
| Credits per picked suggestion | `creditsPerPick` | per Series | 1 | < 2^16; 0 = none |
| Free (credit) packs in the drop, at most | `creditPacksMax` | per Series | 10% of the drop's packs (the studio sets a percent and exports the count, rounded down, at least 1) | < 2^64; 0 = no limit; `CreditCapReached` past it |
| Free (credit) packs per wallet, at most | `creditPacksPerWallet` | per Series | 3 | < 2^64; 0 = no limit; `CreditWalletLimit` past it |
| Cards per free pack credit | `FireCredits.CARDS_PER_CREDIT` | constant | 42 | **fixed forever**: burn progress carries over between Series, so changing it would move the goalposts. Credits can't be spent on a Series whose packs hold 42 cards or more (`FireCredits.useCredits` reverts `BadConfig`): a burned pack would earn a free pack of itself |
| Suggestion cost, longest text | `FireCredits.setSuggestionRules` | global (suggestions aren't tied to a drop) | 1 PAPER, 280 bytes | any cost incl. 0 (each `suggest` names its most PAPER), never more than $1 of PAPER (`SUGGESTION_PAPER_CAP_USD`, fixed); text 1 to 1,024 bytes (event size). **Set the longest text to about 1,000 bytes** (`setSuggestionRules(paper, 1000)`): the site packs a character, its personality and its background into one text (format below) |
| Cards per case/grading batch | `FirePsa.setMaxBatch` | global | 20 | 1 to 100 (gas guard: `finish` grades a batch in one tx) |
| Case and grading prices | `FirePsa.setPrices` | global | $0.05, $1 (one grading price for every card) | above 0, at most $100 each (typo guard; each batch names its most) |
| Fee burn routes | `PaperBurner.setRoutes` | global | set at deploy | each route starts at the currency and ends at PAPER, passing only through WETH, PLANK or USDG (2-4 tokens, at most 4 routes); the 95% guard checks every buy. The router is fixed and the burner's price feeds (`setFeeds`) can be set only once |
| Fresh PDA odds and wear rules | `FirePsa` constants (`FRESH_*`, `WEAR_*`; `freshOdds`, `oddsFor`) | constant | 7-10 table (`docs/grading.md`) | **fixed forever**, the same for every Series; no setter |
| Revenue wallet and PlankBurner, feeds, router | `setWallets`, `setFeeds` | global | - | only between drops (unchanged) |
| Pause | `FireSale.setPaused`, `FirePsa.setPaused` | global | off | blocks every buy (every group), credit spending, paid suggestions (`FireSale`) and case/grading payments (`FirePsa`). Never opening, dealing, transfers, ending or closing a drop, burning cards, finishing or cancelling a grading, or keeper calls. No expiry. `PaperBurner.setFlusher(FirePsa, false)` also stops case and grading payments |
| Randomness source | `FireCards.setRandomness`, `FirePsa.setRandomness` | global | the drand adapters | any time, no delay (announced first); only new requests use it, each pending request keeps its source (`docs/randomness.md`) |
| Collection metadata | `FirePacks.setContractURI`, `FireCards.setContractURI` | global | empty | any (ERC-7572) |

**Suggestion text format.** `suggest` takes one string; the site packs the form into it as plain lines, only the
filled ones, in this order:

```
Character: A sleepy volcano
Personality: Grumpy until noon, then very generous.
Background: Has been napping since the last ice age.
```

Each line is `Label: value` (labels `Character`, `Personality`, `Background`; line breaks inside a value become spaces).
Text with no `Character:` line is read as the character alone. The site counts UTF-8 bytes against
`suggestionMaxBytes`, so that setting should be about 1,000 (the 280 default fits a character only).

**Two waves per Series.** First its look: a theme and an art style, one line each, `Theme: A haunted diner` and
`Art style: Old woodcut print`, each its own suggestion. The site sends either alone with `suggest`, or both in one
transaction with `suggestMany(texts, maxPaper)` (1 to `MAX_SUGGESTIONS_PER_TX` = 3 texts, `suggestionPaper` each, at most
$1 each). Once the theme and style are announced, the character wave asks for characters in that theme and style.
Everything is chosen by the owner from a random shortlist (`ops/suggestions/draw.mjs`: one per wallet per kind, the
same idea merged, 10 drawn). The draw reads entries up to a closing block and is seeded by a drand quicknet round that
comes out after it, both announced when the wave opens, so nobody knows the shortlist while entries can still change;
anyone can re-run it (`draw.mjs --verify`).

- **Announced off chain, picked on chain once.** The theme and the art style are announced straight after the look wave
  (`ops/suggestions/publish.mjs --picks`, shown on the site's Suggestion results). On chain, a Series is picked ONCE, at
  its drop setup (`pickSuggestions` needs a configured drop that hasn't started): the theme, the style and the
  characters together, in one picking session. That's when the free packs are given. Both waves sit in the same round,
  because a round only moves on when a picking session starts.
- **Open the next look wave only after the picks.** Anything suggested before a Series' picking session lands in the
  round that session takes, and can never be picked: open the next Series' look wave after the current Series' picks
  are done. `draw.mjs --series <n>` warns when the round being drawn can no longer be picked for that Series.
- **One pack per idea.** Picks per Series: its characters plus `EXTRA_PICKS` (2), so exactly one theme and one art
  style can earn the free pack. When several wallets sent the same idea (merged by the draw, listed as "had it too"),
  only the first to suggest it can be credited: the first suggester wins the pack.
- **Results.** `ops/suggestions/publish.mjs` writes each wave's results (the 10 drawn per kind, the picks, the closing
  block, the drand round and its signature, what's next; an on-chain pick off the shortlist is warned about and shown
  marked off-list) into `web/art/factory/forge/suggestions/results.json`; the site shows them, with a one-time reveal and
  "You won a free pack" for a winner's wallet. After the on-chain pick, publishing with `--rpc` fills in the pick
  transaction.

Guards that stay fixed (safety, not product): settings lock at the drop's start; one drop at a time; every purchase
names its most PLANK/USDG/ETH and PAPER; the PAPER ceilings (per drop for packs, $1 for suggestions; the last good
price holds while the PAPER feed is late); the swap floors (`SWAP_MIN_BPS`: 90% in `FireSale`, 95% in `PaperBurner`
and `PlankBurner`); the wear rules and 100% fee burn (`docs/grading.md`); feed freshness (`ETH_FEED_MAX_AGE`
25h, `PLANK_FEED_MAX_AGE` and `PLANK_WINDOW_MAX` 2h, `PAPER_FEED_MAX_AGE` 2 days); every group delay and duration and
the regular-wallets rule at most 30 days (`MAX_WINDOW`) and `END_GRACE` 7 days, so a stalled drop can always be ended
(by the owner once its schedule is over: every timed group has run its full time, every until-sold group has opened
and every unlimited group that opened has idled out, and at least a day after the start; by anyone a week later); no re-request, and cancel after 24 hours for randomness (`CANCEL_AFTER`); royalty at most 10%; ownership can't
be renounced.

## Technical ceilings (not product rules)

| Ceiling | Why |
|---|---|
| Series number < 2^64 | stored in 64 bits in every card (was 2^32) |
| Packs per Series < 2^64 (`FirePacks` refuses more) | the frozen count is 64-bit |
| Cards per pack at most 1,000 (`MAX_CARDS_PER_PACK`) | one pack's shuffle and dealing fit in a block |
| Types < 2^32, characters < 2^32 | per-card fields are 32-bit; a card is one storage word |
| Slot weights < 2^64 each, character weights < 2^64 each | stored and summed in 256-bit words |
| Print numbers < 2^40 per exact card | per-card field (40 bits; `BadDeal` past it) |
| Name 64 bytes, category 32, slug 32 | metadata size; same rules as the studio |
| Recipe size | owner gas per transaction (stored as contract code in 24,000-byte chunks, so no hard size) |
| Dealing | block gas: `process(fire, maxCards)` splits any pack; a card costs ~60k gas (almost all of it the mint) |
| Cases and grading: at most 100 cards per batch (`maxBatch`, 20 to start) | gas guard on `finish` |
| Royalty <= 10%, group delays and durations <= 30 days, end grace 7 days, price-feed ages, 90% swap floor | buyer-protection guards (kept) |
| At most 6 groups per drop | every buy works out the groups' timing (a loop over them, about 2 storage reads each) |

## Safety

- Results depend only on the random words and the open order, not on who calls `process(fire, maxCards)`, when, or
  how the work is split.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- One open, one randomness request: there is no re-request (it could act as a re-roll once a drand round is public).
  After 24 hours with no answer (`CANCEL_AFTER`; randomness gone for good), anyone can `cancelOpen(fire, index)`: the packs go back to
  the holder, sealed (minted back without the ERC-1155 receiver hook, so a wallet that refuses them can't block the
  cancel and freeze the queue; same for `skipStuck`). Each open remembers its randomness source and only that source can answer it, so switching the
  source never strands or re-rolls an open. If a ready open sits at the head of its queue undealt for 7 days (`SKIP_AFTER`; a
  dealer that can't deal it), anyone can `skipStuck(fire)`: its unstarted packs go back, sealed, and the queue moves on. Each
  Series' queue stands alone, so one stuck Series never blocks another.
- Why 24 hours for a cancel: drand rounds are public once out, so a cancel only works while nobody has delivered the
  word, and the holder can see it first. A holder could sit on a word they don't like and cancel for a re-roll only if
  every keeper (main and backup, which alert at 10 minutes and again at 6 hours) stays down for the whole window, since
  anyone can deliver the word (`docs/randomness.md`). The same holds for `FirePsa.cancelGrading`.
- The owner can't change a Series' dealer, recipe, characters or image folder once its drop is set up, and can never
  change the PDA fresh odds or wear rules (constants in `FirePsa`).
  Closing doesn't depend on the dealer, so a drop can always close.
- The owner can't change a dealt card. A card being graded can't be transferred (it can be burned); grades are final.
- `PaperBurner` and `PlankBurner` have no withdraw: what they hold only ever leaves as a PAPER (or PLANK) buy sent to
  the dead address.
- Trust: the dealer is code the owner chooses per Series (before its first pack). `RecipeDealer` is the one in this
  repo, covered by the tests; a future dealer is trusted like the owner's other settings, and must deal only from its
  own state and the seed and keep its text JSON-safe.

## Profiles (FireProfiles)

A wallet's name and profile picture, written by the wallet itself in one transaction. No owner, no fees, no admin, no
upgrade, no word filter (the owner's call).

- `setProfile(string name, uint256 pfpCard, uint64 crop)` sets or changes all three. `clear()` removes the profile.
- **Name:** 1 to 20 bytes of printable ASCII (`0x21`-`0x7E`) plus single spaces between words (none leading,
  trailing or doubled), else `BadName`. Unique ignoring case (A-Z = a-z), so a name can't be copied with other
  capitals (`NameTaken`); changing your name or `clear` frees the old one for anyone. `ownerOfName(name)` (any case)
  and `validName(name)` for the site.
- **Picture:** `pfpCard` is a FireCards token id the caller holds when setting it (0 = none), else `NotYourCard`. The
  card can be sold later: the profile keeps the id, and `pfpValid(user)` / `profilesOf` say whether the wallet still
  holds it. The site shows the picture only while it does, otherwise the wallet's fallback.
- **Crop:** `uint64`, packed: x (bits 0-15) and y (16-31) of the circle's centre, 0..65535 = 0..1 across the card's
  art; zoom (32-47), 0..65535 = 1x..4x; 16 reserved bits. Stored as given. The art is the frame's square window
  (`FRAME_GEOMETRY.art`, 128, 296, 1244 x 1244 of 1500 x 2100, the same on every framed material); Full Art is the
  whole card.
- **Reads:** `profileOf(user)` returns `(name, pfpCard, crop, updated)`; `profilesOf(address[])` many at once, each
  with `pfpOk` (the ownerOf check), so the site reads a page of wallets in one call.
- **Events:** `ProfileSet(user indexed, name, pfpCard, crop)`, `ProfileCleared(user indexed)`.
- **Gas:** about 103k for a first `setProfile` with a picture (three new storage slots: the packed picture + crop +
  time, the name, the name's owner), about 40k to change the crop or picture under the same name.
- **Storage:** the picture id is kept in 128 bits next to the crop and the time (one slot); the name's key is its
  lower-cased bytes in one word (names are at most 20 nonzero bytes, so no hash is needed).

The site (`web/art/factory/forge/profile.js`, chain layer `web/src/lib/chain/profiles.ts`) hides profiles on a network
whose deployments file has no `FireProfiles` (mainnet and testnet until it is deployed).

## Gas (Standard recipe, `forge test --match-test gas -vv`, measured 2026-10)

| | Pool dealing (2026-10) | Straight odds (2026-10) |
|---|---|---|
| `open` 1 pack | ~102.8k | ~102.8k |
| `process` 1 pack (6 cards) | ~370.9k | ~376.4k |
| `process` a 10-pack open | ~3.49M | ~3.47M |
| the dealer's part of a pack (`deal`, 6 cards) | ~41.2k | ~20.2k |
| `process(300)` of a 1,000-card pack (most in one call) | ~19.2M | ~18.2M |

Slots (2026-10, measured on the same tests): `open` ~102.8k; `process` 1 pack ~380.3k (+1.0%); a 10-pack open ~3.50M
(+0.8%); the dealer's part of a pack ~23.3k (+3.1k, about 0.5k a card: finding the card's slot and its weights); a
1,000-card pack's `process(300)` ~18.3M. (The straight-odds column was re-measured after print numbers: 376.4k, 3.47M,
20.2k.)

Almost all of a pack's gas is minting the cards (owner, balance, the card word, its print-number counter). The dealer
reads the compiled recipe (one code copy), walks to each card's slot (its end is the first word of its record) and does
a binary search over that slot's cumulative weights, with no storage writes.

## Tests

`contracts/test/cards/` (`Cards.t.sol`, `Recipe.t.sol`, `Sale.t.sol`, `Groups.t.sol`, `Psa.t.sol`, `Burner.t.sol`,
`PlankBurner.t.sol`, `SaleFork.t.sol`, `ImageParity.t.sol`, `SeriesCheck.t.sol`, `Profiles.t.sol`) and
`contracts/test/invariant/` (fuzz and invariant suites, including `RecipeFuzz.t.sol` and `GroupsFuzz.t.sol`). They cover:
- slots: over 4,000 Standard packs every slot's types converge to its own weights (positions 1-3 always Paper, 4
  always Wood, 5 and 6 at their slot's odds, 5 standard deviations), the per-pack averages are exactly 3 / 1.449 /
  0.8982 / 0.2934 / 0.2394 / 0.12, and holo rates (Gold and Full Art always full holo) and characters converge; a whole
  opened Series follows its odds; the shape is the only guarantee (3 Paper and a Fire or better in every pack) and
  nothing caps the rest (two Full Arts or two Golds in a pack, any number per character); the last pack of a 300-pack
  Series and the only pack of a 1-pack Series get the same cards from the same word; print numbers count each exact
  card (character, type, holo look) #1, #2, ... in deal order, per Series
- character weights converge to their weights, independent of type; equal weights deal exactly what no weights deal;
  one weight per character, each at least 1, lock with the Series, and a list that grew needs its weights again
- new shapes: 3-card all-holo packs, 100 characters in batches, 1,000 weighted characters, 1-card packs, a 1,000-card
  pack in 10 calls (same cards as one call), recipes spanning several storage chunks
- bad recipes refused with the reason (no types, no slots, a slot's count or weights, one weight per type, cards per
  pack over several slots, a type in no slot, slugs, names, holo)
- every setting locks at the first pack, and a dealer can't be swapped after it
- fuzz: random slot recipes (1-12 types, 1-6 slots of 1-8 cards, weights up to 2^64 with gaps, both holo modes) and
  random character weights; every card is a type its slot can deal and a character of the Series, holo only as its type
  allows, the same however a pack is split (across slot boundaries too); `slotsOf` reads back every slot
- the same words give the same cards however processing is split; out-of-order randomness waits its turn
- permissions, burns, royalties, metadata, image names, the image folder lock, the JSON configure path
- image names match the studio's files for every look a recipe can deal (`ImageParity.t.sol`, `image-parity/`), and
  batch B is refused unless the chain holds batch A exactly (`SeriesCheck.t.sol`)
- the wear odds match `wear-model.py` (`wear-vectors.json`); the fresh odds are the fixed constants with no setter;
  cases and grades freeze wear; grades are final; the
  burner's best route, split, 95% guard, piece-by-piece backlog, set-once feeds and known-token routes
- drop groups (`Groups.t.sol`, `GroupsFuzz.t.sol`): groups one after another (the next opens the moment the first sells
  out, or when its time runs out) and side by side; leftovers adding capacity, passing through a group that has ended,
  or rolling nowhere (the Series closes smaller); the Series closing the instant its last makeable pack is minted, and
  the hype case (press leftovers still sell after Everyone sells out); NFT gates (per-id allowance, live ownership,
  passed-on NFTs), snapshot gates (per-leaf allowance, wallet cap, the leaf encoding), coins, free and PAPER-only
  groups, every config check, the views; a fuzz of random group shapes and buys checking capacity, counts, timing and
  closing after every step
- the strategic review: what pause blocks and never blocks, a randomness switch (old requests answered only by their
  own source, or cancelled), the per-drop PAPER ceiling on every group's packs and credit packs, PlankBurner (no withdraw,
  flush, guard, halvings), renounce refused, the Dealt date trait, contractURI, a buy refreshing the PLANK price
- profiles (`Profiles.t.sol`): the name rules, names unique ignoring case, a rename or clear freeing the name, the
  picture must be the caller's card (and goes invalid when sold), the batch read, events, gas, and fuzzes of raw and
  printable names against a plain re-implementation of the rules

## Deploying

`contracts/script/DeployCards.s.sol` deploys and wires everything in one run: FirePacks, FireCards, CardsRenderer,
RecipeDealer and RecipeCompiler, PlankBurner, FireCredits, FireGroups, FireSale (wired to both; `FireCredits.setSale`
and `FireGroups.setSale` are set once and check the sale points back; only the deployer can wire FireGroups), PaperBurner (its feeds and default routes: direct to PAPER or through PLANK/WETH),
FirePsa, two drand adapters (FireCards, FirePsa), FireProfiles, the royalty. It needs `PAPER_USD_FEED` (the `PaperUsdTwap`). It
hands ownership to `OWNER`, one hardware wallet (Ledger or Trezor; no multisig: nothing holds funds, the risk is key
theft), which then accepts FirePacks, FireCards, RecipeDealer, FireCredits, FireSale, FirePsa and PaperBurner in one
run of `contracts/script/AcceptOwnership.s.sol` signed on the device (until then the deployer owns them, so a mistyped
`OWNER` owns nothing); PlankBurner, FireGroups and FireProfiles have no owner. A deploy made before FireProfiles
existed adds it on its own with `contracts/script/DeployProfiles.s.sol` (reads FireCards from the deployments file). The script runs only on chain 4663 (`EXPECTED_CHAIN_ID` for the testnet,
46630, or a rehearsal), checks every input first and refuses an `OWNER` equal to the deployer (a throwaway hot wallet that only
pays gas). A test runs the same steps.

Every deploy script writes what it deployed to `deployments/<chainId>.json` (repository root), the address file every
tool reads; `contracts/script/VerifyDeploy.s.sol` checks the wiring listed below from it.

`contracts/script/ConfigureSeries.s.sol` sets up a Series from a recipe JSON in two batches sent from the owner's hardware wallet: `BATCH=A` (content:
recipe, characters, character weights if the JSON has them, dealer, images base) and, after `ops/series/verify-series.mjs` is green, `BATCH=B`
(`configureDrop`, the lock; refused unless the chain holds batch A exactly). It checks the recipe against the dealer,
prints each call and sends it from the owner (`--ledger`/`--trezor`; any other signer is refused); `SIMULATE=true` runs
a batch as the impersonated owner on a fork (`BATCH=AB` only there). It rejects unknown JSON keys (`pdaOdds` too) and a drop start more than 365 days away. Inputs: `RECIPE_JSON` (under `contracts/series/`), `BATCH`,
`DROP_START` and `GROUP_ROOT_<i>` (override the block's start and a snapshot group's root), `MILL` (for `"nft": "press"`),
`CHARACTER_BATCH` (characters per call, default 200);
`RECIPE_DEALER`, `FIRE_CARDS`, `FIRE_SALE` from the deployments file unless set.

- **Settings:** `.env.example` (card contracts section). No keys in `.env`: the deployer signs with the Foundry keystore, the owner on its hardware wallet.
- **Right after the deploy:** the hardware wallet accepts ownership (`AcceptOwnership.s.sol`), then
  `VerifyDeploy.s.sol` checks the owner and the wiring: the seller is FireSale on packs
  and cards, cards point at packs, the dealer points at cards and packs, FireSale and FireCredits point at each other,
  FireSale and FireGroups point at each other,
  FireSale's `paperBurner` is the deployed PaperBurner, its `plankBurner` is the deployed PlankBurner (same router and PLANK/ETH feeds), the PDA is FirePsa, the
  renderer is CardsRenderer, FirePsa pays PaperBurner, randomness points at the two adapters, no Series is configured or locked yet,
  the royalty is what was set, and FireProfiles reads FireCards (a WAIT, not a FAIL, while it isn't deployed).
- **Keeper** (`ops/keeper`; every call is permissionless):
  - `PlankUsdTwap.checkpoint()` every 30 minutes and `PaperUsdTwap.checkpoint()` when `due()`
  - delivering drand numbers to the router (`OpenDrandRouter.fulfillMany`; `adapter.settle` if a callback didn't
    land)
  - `FireCards.process(fire, maxCards)` and `FirePsa.finish(index, ids)` (ids from the `Protected` event)
  - `PaperBurner.flush(pay)` when a fee is waiting (`Waiting` events) and `PlankBurner.flush(pay)` when it holds ETH,
    USDG or PLANK
  - `FireSale.close(fire)` when a live drop has nothing left that can sell (`status(fire).left == 0`, not closed): a
    group's time ran out with its leftovers rolling nowhere, so no purchase closed it
- **Before deploy day:** run the real-chain gas test (PowerShell, from `contracts`):
  ```powershell
  $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"
  forge test --match-path test/cards/SaleFork.t.sol -vv
  ```

The site has the ABIs: `web/src/lib/abi/` (`fireCardsAbi.json`, `firePacksAbi.json`, `fireSaleAbi.json`,
`fireCreditsAbi.json`, `fireGroupsAbi.json` (to add with the site's groups update), `firePsaAbi.json`, `recipeDealerAbi.json`, `paperBurnerAbi.json`, `plankBurnerAbi.json`,
`cardsRendererAbi.json`, `fireProfilesAbi.json`), exported by `web/src/lib/cards.ts`. Each file is the `abi` field of
`contracts/out/<Contract>.sol/<Contract>.json` after `forge build`, written as 2-space JSON.

## Past review fixes after the redesign

See `docs/audit-2026-10.md` ("Per-Series recipes"). Pool dealing (slots, per-pack guarantees, exact totals) was
replaced by straight odds in 2026-10 (owner decision: "straight odds for all cards, no guarantees and no caps"); then
the pack shape came back as slots with their own fixed odds (owner decision, 2026-10: each slot rolled from its own
odds, no shared pool, no caps, so the last pack is exactly as random as the first).

## Money and the economy

See `docs/omni-economy.md`. The sale never holds funds: whatever is paid for packs is forwarded or burned in the same
transaction. Case and grading fees go to `PaperBurner`, which only buys and burns PAPER (a fee waits there if the
price guard says no).

## Still open

See `docs/roadmap.md`.
