# Card contracts: packs, cards, opening

`contracts/src/cards/`. The sale and fee economics are in `docs/omni-economy.md`; cases, grading, wear and slabs in
`docs/grading.md`. The Standard recipe matches `docs/card-studio.md`.

**Naming.** The contracts are named `Fire*` for historical reasons: `Fire*` is the card system. In identifiers
(`fire`, `lockFire`, `fires`), "fire" is a Series number. This doc says "Series" in prose.

**The idea.** Every rule about what a Series' cards are is a per-Series setting: card types, how many of each, holo
odds, cards per pack, what each slot may hold, characters, card images. The only limits left are
technical (type widths and block gas), and big work is split into batches instead of capped. Every setting locks when
the Series' drop is set up (`configureDrop`), before anyone can buy, so buyers can trust the odds, and all of it can be
read on-chain. PDA grading is the exception the other way: its fresh odds and wear rules are fixed forever in
`FirePsa`, the same for every Series (`docs/grading.md`); only case and grading prices (and the PAPER discount) can
change.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155 ("Omni Card Packs", `OMNIPACK`): one stackable token type per Series (token id = Series number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp`. The description reads the Series' cards per pack from `FireCards`. Royalty (ERC-2981). |
| `FireCards` | The permanent core. The cards, ERC-721 ("Omni Cards", `OMNICARD`; token id = global serial), one opening queue per Series, randomness (drand router and adapter), serials, editions, each card's wear (age uncased, moves, cased) and PDA grade. Per Series it keeps the dealer, the image folder, the frozen pack count and progress. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `CardsRenderer` | Builds each card's `tokenURI` JSON and image name (`imageName`, `imageFile`) from `FireCards` and the dealer. No owner, no settings; set once on `FireCards`. |
| `IDealer` | What `FireCards` asks of a Series' dealer: `ready`, `cardsPerPack`, `characterCount`, `deal(fire, seed, fromCard, count)` and `cardText`. The owner picks a dealer per Series. Future dealers can add mechanics (their own state, 32 bits of per-card "extra" data, extra metadata attributes) without touching `FireCards`. |
| `RecipeDealer` | The first dealer: deals each Series from its own recipe (below). Owned by the owner (the hardware wallet). |
| `RecipeCompiler` | The recipe checker, compiler and pool maths, split out of `RecipeDealer` for contract size. Pure: no state, no owner. |
| `StandardRecipe` | The original Omni rules as a recipe (library). |
| `FireSale` | Sells the packs (`docs/omni-economy.md`, `docs/drop-groups.md`): a purchase names its group (`buy(fire, group, n, pay, maxCost, maxPaper, access)`) and pays the group's dollar price in PLANK, ETH or USDG (the coins the group takes), or ETH alone (`buyWithEthAll`: it also buys the packs' PAPER on the market and burns it), plus the group's PAPER. Every product rule is a per-drop setting (total packs and its groups, PAPER dollar ceiling, PLANK and PAPER burn shares, regular-wallets rule, packs per purchase, credits per picked suggestion and credit caps). Closes the Series the moment nothing can still sell, or when the drop is ended. The owner can pause buying (`setPaused`). Never holds funds. |
| `FireGroups` | Each drop's groups (split out of `FireSale` for contract size): config, timing (opens with the drop or after another group; ends sold out, at its duration, or after `idle` with no sale), unlimited groups, the rising tax, per-purchase limits, capacity with rolled-in leftovers, gates (open, NFT with packs per NFT id, Merkle snapshot with a per-wallet allowance), wallet limits, and the views the site reads (`groupsOf`, `boughtBy`, `remaining`, `openLeft`, `scheduleEnd`). Only `FireSale` writes to it (set once at deploy); no owner. |
| `FireCredits` | Free pack credits, card burning (42 cards = 1 credit, fixed forever) and character suggestions, split out of `FireSale` for contract size (same rules). It spends credits, burns cards and takes suggestion PAPER through `FireSale` hooks only it can call (`creditPacks`, `burnCardsFor`, `burnPaperFor`), so PAPER is approved to `FireSale` alone. Owned by the owner (picks, suggestion rules). |
| `PlankBurner` | Gets the sale's PLANK burn share when the swap can't run (a stale PLANK price or a failed swap). No owner, no withdraw: anyone calls `flush`, which buys PLANK (95% TWAP guard, halving for a backlog) and sends it to the dead address. |
| `FirePsa` | Cases and PDA grading (`docs/grading.md`): `protect(caseIds, gradeIds, pay, maxCost)` cases and/or sends for grading up to `maxBatch` cards (20; owner setting, at most 100) in one transaction, priced in dollars (cases flat, grading per card rank: `quoteFor(caseIds, gradeIds, pay)`), paid in ETH, USDG, PLANK or PAPER (`Pay` PLANK 0, ETH 1, USDG 2, PAPER 3; PAPER at the 20-hour PAPER price less an owner-set 0-20% discount, burned straight to the dead address). drand picks each grade (1 to 10) from the fresh odds and the card's frozen wear (both fixed forever, the same for every Series); the card is slabbed. The only contract that can case a card or set a grade, once per card. |
| `PaperBurner` | Gets FireSale's PAPER share of every sale (20% in the Standard drop) and 100% of every case and grading fee paid in ETH, PLANK or USDG, buys PAPER with it on owner-set routes and burns it. Only flushers the owner names (FirePsa and the keepers, `setFlusher`) can flush it. FirePsa burns only the fee it just took (`flushLight(pay, fee)`), so wrapping a case in a buy and a sell can't make it spend the backlog; the keepers' `flush` (its own transaction; Robinhood Chain's sequencer is first-come with no public mempool) drains the rest. A PAPER price from a window over 30 hours makes it wait. No withdraw; the router is fixed at deploy. |
| `FireProfiles` | Each wallet's public profile: a name and a profile picture cut from one of its own cards. No owner, no fees, no admin, no upgrade; it only reads `FireCards` (fixed at deploy). Details below. |

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
  "sale": {
    "start": 1900000000, "packs": 167, "plankBurnBps": 1000, "paperBurnBps": 2000, "paperCapUsd": "100000000",
    "maxPerTx": 50, "regularWalletsFor": 172800,
    "creditsPerPick": 1, "creditPacksMax": 16, "creditPacksPerWallet": 3, "creditGroup": 2,
    "groups": [
      { "name": "Paper Press holders", "packs": 50, "gate": "nft", "nft": "press", "perNft": 1,
        "priceUsd": "0", "paper": "1000000000000000000", "coins": 0, "perWallet": 0,
        "afterGroup": 255, "startDelay": 0, "duration": 21600, "rollTo": 2 },
      { "name": "PLANK holders", "packs": 40, "gate": "snapshot", "root": "0x...",
        "priceUsd": "250000000", "paper": "1000000000000000000", "coins": 1, "perWallet": 5,
        "afterGroup": 255, "startDelay": 0, "duration": 86400, "rollTo": 2 },
      { "name": "Everyone", "packs": 77, "gate": "open",
        "priceUsd": "250000000", "paper": "1000000000000000000", "coins": 7, "perWallet": 5,
        "afterGroup": 1, "startDelay": 0, "duration": 0, "rollTo": 255 },
      { "name": "After sell-out", "packs": 0, "unlimited": true, "gate": "open", "taxBps": 400, "idle": 900, "perTx": 1,
        "priceUsd": "250000000", "paper": "1000000000000000000", "coins": 2, "perWallet": 0,
        "afterGroup": 2, "startDelay": 0, "duration": 0, "rollTo": 255 }
    ]
  }
}
```

`supply`: `filler` | `share` (ppb of the Series' cards) | `perPack` | `count` | `perCharacter`. `holo.mode`:
`independent` (`frame`, `picture` out of 1e18) | `distribution` (`weights`: none, frame, picture, full). A slot has
`types` (indexes) or a rank range (`minRank`, default 0; `maxRank`, default "no top"). `imagesBase` is optional. There
are no PDA odds in it: they are fixed in `FirePsa` for every Series. The JSON is read strictly: unknown keys (a
`pdaOdds` key included), numbers too big for their field and a drop start more than 365 days away are refused.

`sale` (optional; the studio's Sale tab) is `FireSale.DropConfig` by name, in contract units: seconds, dollars with 8
decimals, PAPER in wei, burn shares in basis points. Every key is required unless said otherwise.

- Drop-wide: `start`, `packs` (the total; the groups' `packs` must add up to it), `plankBurnBps` + `paperBurnBps`
  (together at most 10000), `paperCapUsd` (0 = no ceiling), `maxPerTx` (0 = 50), `regularWalletsFor` (at most 30
  days; 0 = off), `creditsPerPick`, `creditPacksMax` and `creditPacksPerWallet` (0 = no limit), `creditGroup` (the
  index of the group credit packs come from, 0 = the first; 255 = no credit packs), `groups` (1 to 6, in order: a
  group's index is its place in the list).
- Each group (`FireGroups.Group`): `name` (optional; the studio's label, not sent on chain), `packs` (its own; leftovers
  rolled in come on top; 0 allowed for a group that only takes leftovers), `gate` (`"open"`, `"nft"` or `"snapshot"`),
  `priceUsd` (0 = no dollar price), `paper` (PAPER per pack, 0 = none; both 0 = free, never for an open group),
  `coins` (for the dollar price: PLANK 1 + ETH 2 + USDG 4, so 7 = any; at least one when there is a price; ETH includes
  `buyWithEthAll`), `perWallet` (0 = no limit), `afterGroup` (255 = opens with the drop; else an EARLIER group's
  index: opens when that group ends), `startDelay` (seconds after the drop's start or that group's end, at most 30
  days), `duration` (longest it stays open, at most 30 days; 0 = until its packs are gone), `rollTo` (where its
  unsold packs go when it ends: a LATER group's index, or 255 = nowhere, never made), and three optional keys (0 /
  false when left out): `taxBps` (at most 5000: a rising tax, below), `idle` (seconds, at most 30 days: the group also
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
Series' final pack count is whatever was minted (`FireCards.closeFire` freezes `FirePacks.minted`), and the dealer's
pool is the recipe worked out for that count at close, so a Series larger than its base total deals like any other
(per-character types like Gold and Full Art stay at their fixed counts, so extra packs make them rarer per pack).

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
   fixed. Every lock (`lockForSale`, `lockFire`) and `ready` check again that the Series has an image folder and that
   its dealer's cards per pack is 1 to `MAX_CARDS_PER_PACK` (a recipe changed after `setDealer` isn't otherwise
   rechecked), so a locked Series can always be dealt.
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
   graded; `FirePsa.protect` cases and grades. A card being graded can't be transferred. A move that counts emits
   `Moved` and an ERC-4906 `MetadataUpdate` (its Moves trait changed). Rules in `docs/grading.md`.

## What is set per Series, and when it locks

| Setting | Where | Locks |
|---|---|---|
| Dealer | `FireCards.setDealer` | drop set up (`configureDrop` -> `lockForSale`), first pack minted, `lockFire`, or close |
| Card types, slots, cards per pack, supply, caps, holo | `RecipeDealer.setRecipe` | same |
| Characters | `setCharacters`, `appendCharacters` | same |
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
| Per wallet | `Group.perWallet` | per group | - / 5 / 5 | 0 = no limit; credit packs don't count |
| When it opens | `Group.afterGroup`, `startDelay` | per group | with the drop / with the drop / after group 2 | `afterGroup` an earlier group or 255; delay <= 30 days |
| How long it stays open | `Group.duration` | per group | 6h / 24h / until sold | <= 30 days; 0 = until its packs are gone. It ends sold out (once no leftovers can still arrive) or at its duration |
| Where its unsold packs go | `Group.rollTo` | per group | group 3 / group 3 / nowhere / nowhere | a later group or 255 (never made: the Series closes smaller) |
| Rising tax | `Group.taxBps` | per group | 4% a pack on "After sell-out" | 0 = off; at most 50%; needs a price; nothing rolls into it; any pack at most 1e9 x the base (safety bound). The whole tax buys and burns PAPER |
| Ends after no sale for | `Group.idle` | per group | 15 min on "After sell-out" | 0 = off; <= 30 days |
| Most packs per purchase in the group | `Group.perTx` | per group | 1 on "After sell-out" | 0 = the drop's `maxPerTx`; credits ignore it |
| No pack count | `Group.unlimited` | per group | "After sell-out" | packs 0, needs `taxBps` and `idle`, rolls nowhere; adds on top of the total |
| PAPER ceiling per pack | `paperCapUsd` (8 dec.) | per Series | $1 | any, 0 = no ceiling. A pack's PAPER (every group's and credit packs) is never worth more than this at the `PAPER_USD` feed's price; while the feed is late the last good price holds (`lastPaperUsd`); before its first price, the set PAPER |
| PLANK burn share | `plankBurnBps` | per Series | 10% | 0 to 100%, with the PAPER share |
| PAPER buy & burn share (to `PaperBurner`) | `paperBurnBps` | per Series | 20% | 0 to 100%, with the PLANK share |
| Most packs per purchase / credit spend | `maxPerTx` | per Series | 50 (0 = 50) | < 2^32. Gas is flat: 100 packs cost about what 1 does |
| Regular wallets only for | `regularWalletsFor` | per Series | 48h | <= 30 days; 0 = off. Every group; not credits |
| Credit group | `creditGroup` | per Series | group 3 | a group index, or 255 = no credit packs. Credits spend its packs while it is open, for its PAPER only (its gate, price, coins and wallet limit don't apply) |
| Credits per picked suggestion | `creditsPerPick` | per Series | 1 | < 2^16; 0 = none |
| Free (credit) packs in the drop, at most | `creditPacksMax` | per Series | 10% of the drop's packs (the studio sets a percent and exports the count, rounded down, at least 1) | < 2^64; 0 = no limit; `CreditCapReached` past it |
| Free (credit) packs per wallet, at most | `creditPacksPerWallet` | per Series | 3 | < 2^64; 0 = no limit; `CreditWalletLimit` past it |
| Cards per free pack credit | `FireCredits.CARDS_PER_CREDIT` | constant | 42 | **fixed forever**: burn progress carries over between Series, so changing it would move the goalposts. Credits can't be spent on a Series whose packs hold 42 cards or more (`FireCredits.useCredits` reverts `BadConfig`): a burned pack would earn a free pack of itself |
| Suggestion cost, longest text | `FireCredits.setSuggestionRules` | global (suggestions aren't tied to a drop) | 1 PAPER, 280 bytes | any cost incl. 0 (each `suggest` names its most PAPER), never more than $1 of PAPER (`SUGGESTION_PAPER_CAP_USD`, fixed); text 1 to 1,024 bytes (event size). **Set the longest text to about 1,000 bytes** (`setSuggestionRules(paper, 1000)`): the site packs a character, its personality and its background into one text (format below) |
| Cards per case/grading batch | `FirePsa.setMaxBatch` | global | 20 | 1 to 100 (gas guard: `finish` grades a batch in one tx) |
| Case and grading prices | `FirePsa.setPrices` | global | $0.05, $1 | above 0, at most $100 each (typo guard; each batch names its most) |
| Grading price per card rank | `FirePsa.setGradePrice(rank, usd18)` | global | 0 for every rank (= the default grading price) | at most $100; 0 = the default. Rank = `FireCards.rankOf(serial)`, the type's rank in its recipe (Standard: Paper 0, Wood 1, Fire 2, Coal 3, Gold 4, Full Art 5) |
| PAPER payment discount | `FirePsa.setPaperDiscount(bps)` | global | 0 | 0 to 2,000 (20%) |
| Fee burn routes | `PaperBurner.setRoutes` | global | set at deploy | each route starts at the currency and ends at PAPER, passing only through WETH, PLANK or USDG (2-4 tokens, at most 4 routes); the 95% guard checks every buy. The router is fixed and the burner's price feeds (`setFeeds`) can be set only once |
| Fresh PDA odds and wear rules | `FirePsa` constants (`FRESH_*`, `WEAR_*`; `freshOdds`, `oddsFor`) | constant | 7-10 table (`docs/grading.md`) | **fixed forever**, the same for every Series; no setter |
| Revenue wallet and PlankBurner, feeds, router | `setWallets`, `setFeeds` | global | - | only between drops (unchanged) |
| Pause | `FireSale.setPaused`, `FirePsa.setPaused` | global | off | blocks every buy (every group), credit spending, paid suggestions (`FireSale`) and case/grading payments (`FirePsa`). Never opening, dealing, transfers, ending or closing a drop, burning cards, finishing or cancelling a grading, or keeper calls. No expiry. `PaperBurner.setFlusher(FirePsa, false)` also stops case and grading payments in ETH, PLANK and USDG (PAPER payments still work) |
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
and every unlimited group that opened has idled out, and at least a day after the start; by anyone a week later); no re-request, and cancel after a week for randomness; royalty at most 10%; ownership can't
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
| Royalty <= 10%, group delays and durations <= 30 days, end grace 7 days, price-feed ages, 90% swap floor | buyer-protection guards (kept) |
| At most 6 groups per drop | every buy works out the groups' timing (a loop over them, about 2 storage reads each) |

## Safety

- Results depend only on the random words and the open order, not on who calls `process(fire, maxCards)`, when, or
  how the work is split.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- One open, one randomness request: there is no re-request (it could act as a re-roll once a drand round is public).
  After 7 days with no answer (randomness gone for good), anyone can `cancelOpen(fire, index)`: the packs go back to
  the holder, sealed (minted back without the ERC-1155 receiver hook, so a wallet that refuses them can't block the
  cancel and freeze the queue; same for `skipStuck`). Each open remembers its randomness source and only that source can answer it, so switching the
  source never strands or re-rolls an open. If a ready open sits at the head of its queue undealt for 7 days (a dealer
  that can't deal it), anyone can `skipStuck(fire)`: its unstarted packs go back, sealed, and the queue moves on. Each
  Series' queue stands alone, so one stuck Series never blocks another.
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

| | Before | Now |
|---|---|---|
| `open` 1 pack | ~101.9k | ~102.8k (the open now also stores its randomness source, packed with the request id) |
| `process` 1 pack (6 cards) | ~345.8k | ~370.9k (+7.3%) |
| `process` a 10-pack open | ~3.26M | ~3.49M (+7.1%) |

The extra is the call to the dealer and reading the compiled recipe (stored as contract code, read in one copy).

## Tests

`contracts/test/cards/` (`Cards.t.sol`, `Recipe.t.sol`, `Sale.t.sol`, `Groups.t.sol`, `Psa.t.sol`, `Burner.t.sol`,
`PlankBurner.t.sol`, `SaleFork.t.sol`, `ImageParity.t.sol`, `SeriesCheck.t.sol`, `Profiles.t.sol`) and
`contracts/test/invariant/` (fuzz and invariant suites, including `RecipeFuzz.t.sol` and `GroupsFuzz.t.sol`). They cover:
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
recipe, characters, dealer, images base) and, after `ops/series/verify-series.mjs` is green, `BATCH=B`
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

See `docs/audit-2026-10.md` ("Per-Series recipes"). Every guarantee is kept; a few are widened or moved.

## Money and the economy

See `docs/omni-economy.md`. The sale never holds funds: whatever is paid for packs is forwarded or burned in the same
transaction. Case and grading fees go to `PaperBurner`, which only buys and burns PAPER (a fee waits there if the
price guard says no).

## Still open

See `docs/roadmap.md`.
