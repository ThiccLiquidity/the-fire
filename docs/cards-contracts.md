# Card contracts: packs, cards, opening

`contracts/src/cards/`. The card rules match `docs/card-studio.md`; the sale and PDA economics are in
`docs/omni-economy.md`.

**Naming.** The contracts are named `Fire*` for historical reasons: `Fire*` is the card system. In identifiers
(`fire`, `configureFire`, `lockFire`, `fires`), "fire" is a Series number. This doc says "Series" in prose.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155 ("Omni Card Packs", `OMNIPACK`): one stackable token type per Series (token id = Series number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp` (the base is text-checked like names). Royalty (ERC-2981). |
| `FireCards` | The cards, ERC-721 ("Omni Cards", `OMNICARD`; token id = global serial). Closes Series, opens packs, deals cards, on-chain metadata. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `FireSale` | Sells the packs (`docs/omni-economy.md`): per-drop settings, PLANK-only first packs, PAPER per pack burned, 30% to the PLANK burn, press-holder starters, free pack credits (42 cards burned or a picked suggestion), suggestions. Closes the Series when a drop sells out. Never holds funds. |
| `FirePsa` | The PDA reveal: a holder burns PAPER (the most whole PAPER at or under $0.25; 1 PAPER up to $1 a PAPER; $1 worth past that; a set number before the feed has a price) to reveal up to 10 cards; drand picks each grade on the Series' odds (default, grade 10 down to 1: 1/17/24/25/18/7/3.5/2/1.5/1%), and the card switches to that grade's image. The only contract that can set a grade, once per card. |
| `CardRules` | The rarity rules, ported exactly from the Card Studio: pool sizes for one Series from its packs and Diamond setting (`computePool`), holo rolls (Diamond always holo, 1/3 each), the pack floor. |

## The flow

1. **Before a Series:** the owner (the `OWNER` multisig) calls `configureFire(fire, names, categories, imagesBase)`:
   the Series' character names and categories in the studio's order (1 to 255 characters), and the folder its card
   images live in (IPFS or Arweave). Names are at most 64 bytes of UTF-8 (`MAX_NAME_BYTES`). Categories are free text,
   one per character, set in the studio (no preset list): 1 to 32 bytes of UTF-8 (`MAX_CATEGORY_BYTES`). Names,
   categories and the folder may not contain `"`, `\` or control characters, since they go into the token JSON
   as-is. The studio's `fire.json` carries these arguments. `setDiamonds(fire, n)` sets how many Diamonds it makes
   (1 to 1000, default 1, never more than one per pack). `configureFire` and `setDiamonds` work until the Series is
   locked (`lockFire`) or its first pack is minted, whichever comes first. `setImagesBase(fire, base)` can still move
   the image folder after that, until `lockFire` (it emits `ImagesBaseSet` and an ERC-4906 `BatchMetadataUpdate`).
2. **During the drop:** the seller (`FireSale`) mints packs to buyers. They're tradeable sealed.
3. **When the drop ends:** the seller calls `closeFire(fire)`. The pack count freezes and the pool is worked out from the
   Series' own packs and Diamond setting. Each Series stands alone: no carry-over. The pool is public (`poolOf`).
4. **Opening:** a holder calls `open(fire, count)` (up to 10). Their packs are burned and drand randomness is
   requested. **Nothing about the pack exists before this**: which cards it gets is decided by randomness that
   doesn't exist yet. (The Series' leftover pool is public, so the odds of a pack shift as others open, and the very
   last unopened pack of a Series gets exactly what's left. That comes with exact totals.)
5. **Dealing:** when the randomness arrives, anyone calls `process(maxOpens)` (the live site is planned to call it right away).
   Packs are dealt strictly in the order they were opened. Each draws slot 6 from the Fire-or-better cards left, slot 5 from the flexible pile
   (Fire-or-better not needed for later packs plus spare Wood), then character and holo per card. The six are minted
   in shuffled order so a serial says nothing about its slot. The Series' totals come out exactly as the pool said.
6. **Metadata:** `tokenURI` is built on-chain. The image is `<imagesBase>` + `imageFile(card)`:
   `c<character>-<material>-<holo>-<grade>.webp`, where `material` is `paper`, `wood`, `fire`, `coal` or `diamond`,
   `holo` is `none`, `frame`, `picture` or `full`, and `grade` is `u` (unrevealed) or `1` to `10`. Each grade has its
   own image (wear frame and PDA seal number included), so a Series' folder holds 209 WEBP images per character (19
   looks x 11 grade states), the same names the studio exports. When a card is graded, its image switches to that
   grade's file. Traits: Character, Category, Material, Holo, Series, Edition ("k", then "k of N" once every pack of
   the Series is dealt), Serial, PDA.

## Safety

- Results depend only on the random words and the open order, not on who calls `process(maxOpens)` or when.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- If an open's randomness never arrives (a day, and the router has no answer), anyone can `rerequest` it. After 7
  days with no answer (randomness gone for good), anyone can `cancelOpen`: the packs go back to the holder, sealed.
- The owner can't change a Series' characters, names, categories or Diamonds once its first pack is minted
  (`configureFire` and `setDiamonds` stop at the first pack sold or at `lockFire`).
- The owner can't change a dealt card. It can move a Series' image folder (`setImagesBase`) until `lockFire`, for
  example to re-pin the images elsewhere; that changes where the images live, not what a card is.

## Tests

`contracts/test/cards/` (`Cards.t.sol`, `Sale.t.sol`, `Psa.t.sol`, `SaleFork.t.sol`) and the fuzz and invariant
suites in `contracts/test/invariant/`. The card tests cover:
- the pool math matches the studio's own code over 344 Series sizes and Diamond settings (`pool-fixture.json`,
  written by `studio/scripts/pool-fixture.test.ts` with `WRITE_POOL_FIXTURE=1`)
- Diamonds per Series: default 1, set, locks after the first pack, bounds, the effect on the pool
- every pack keeps the guarantees, and a Series' totals are exact
- the same words give the same cards however processing is split, and out-of-order randomness waits its turn
- holo rates converge (Diamond always holo)
- a contract that refuses NFTs can't stall the queue
- permissions, burns, royalties, metadata
- image file names for every material, holo type and grade, and moving the image folder until the lock

## Deploying

`contracts/script/DeployCards.s.sol` deploys and wires everything in one run:
- the contracts: FirePacks, FireCards, FireSale and FirePsa
- two drand adapters, one for FireCards and one for FirePsa
- the royalty

It hands ownership to the multisig (`OWNER`). The multisig must then call `acceptOwnership()` on FirePacks,
FireCards and FirePsa; FireSale is owned by `OWNER` from deployment. The script checks every input first and refuses a plain
wallet as owner unless told otherwise. A test runs the same steps.

- **Settings:** `.env.example` (card contracts section). No keys in `.env`: sign with the Foundry keystore or a Ledger.
- **Right after the deploy:** the multisig calls `acceptOwnership()` on FirePacks, FireCards and FirePsa, then checks
  the wiring it now owns: the seller is FireSale on packs and cards, cards point at packs, the PDA is FirePsa,
  randomness points at the two adapters, no Series is configured or locked yet, and the royalty is what was set.
  Until it accepts, the deployer key controls those three contracts.
- **Keeper** (not built yet; every call is permissionless):
  - `PlankUsdTwap.checkpoint()` every 30 minutes
  - `PaperUsdTwap.checkpoint()` when `due()`
  - `FirePsa.pokePrice()` now and then
  - delivering drand numbers to the router (`OpenDrandRouter.fulfill`; `adapter.settle` if a callback didn't land)
  - `FireCards.process(maxOpens)` and `FirePsa.finish(index)` if the site doesn't call them
- **Before deploy day:** run the real-chain gas test (PowerShell, from `contracts`):
  ```powershell
  $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"
  forge test --match-path test/cards/SaleFork.t.sol -vv
  ```

The site has the ABIs: `web/src/lib/abi/` (`fireCardsAbi.json`, `firePacksAbi.json`, `fireSaleAbi.json`, `firePsaAbi.json`), exported by `web/src/lib/cards.ts`.

## Money and the economy

See `docs/omni-economy.md`. The contracts never hold funds: whatever is paid is forwarded or
burned in the same transaction.

## Still open

See `docs/roadmap.md`.
