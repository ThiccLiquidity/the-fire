# Card contracts: packs, cards, opening

`contracts/src/cards/`. Built Oct 3 2026 on the decisions in `docs/card-studio.md` (Packs and opening). Not deployed.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155: one stackable token type per Series (token id = Series number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp`. Royalty (ERC-2981). |
| `FireCards` | The cards, ERC-721 (token id = global serial). Closes Series, opens packs, deals cards, on-chain metadata. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `FireSale` | Sells the packs (`docs/omni-economy.md`): per-drop settings, PLANK-only first packs, PAPER per pack burned, 30% to the PLANK burn, press-holder starters, free pack credits (42 cards burned or a picked suggestion), suggestions. Closes the Series when a drop sells out. Never holds funds. |
| `FirePsa` | The PDA reveal: a holder burns PAPER (the most whole PAPER at or under $0.25; 1 PAPER up to $1 a PAPER; $1 worth past that; a set number before the feed has a price) to reveal up to 10 cards; drand picks each grade on the Series' odds (default, grade 10 down to 1: 1/17/24/25/18/7/3.5/2/1.5/1%), and the card switches to that wear frame. The only contract that can set a grade, once per card. |
| `CardRules` | The rarity rules, ported exactly from the Card Studio: pool sizes for one Series from its packs and Diamond setting (`computePool`), holo rolls (Diamond always holo, 1/3 each), the pack floor. |

## The flow

1. **Before a Series:** the owner calls `configureFire(fire, names, categories, imagesBase)`: the Series' characters in the
   studio's order and the folder its card images live in (IPFS or Arweave). `setDiamonds(fire, n)` sets how many
   Diamonds it makes (1 to 1000, default 1, never more than one per pack). `lockFire` freezes it; so does the first
   pack sold.
2. **While it burns:** the seller (`FireSale`) mints packs to buyers. They're tradeable sealed.
3. **It goes out:** the seller calls `closeFire(fire)`. The pack count freezes and the pool is worked out from the
   Series' own packs and Diamond setting. Each Series stands alone: no carry-over. The pool is public (`poolOf`).
4. **Opening:** a holder calls `open(fire, count)` (up to 10). Their packs are burned and drand randomness is
   requested. **Nothing about the pack exists before this**: which cards it gets is decided by randomness that
   doesn't exist yet. (The Series' leftover pool is public, so the odds of a pack shift as others open, and the very
   last unopened pack of a Series gets exactly what's left. That comes with exact totals.)
5. **Dealing:** when the randomness arrives, anyone calls `process()` (the site does it). Packs are dealt strictly in
   the order they were opened. Each draws slot 6 from the Fire-or-better cards left, slot 5 from the flexible pile
   (Fire-or-better not needed for later packs plus spare Wood), then character and holo per card. The six are minted
   in shuffled order so a serial says nothing about its slot. The Series' totals come out exactly as the pool said.
6. **Metadata:** `tokenURI` is built on-chain. The image is `<imagesBase>c<character>-<material>-<holo>-<wear>.webp`,
   the same names the studio exports. Traits: Character, Category, Material, Holo, Fire, Edition ("k", then "k of N"
   once every pack of the Series is dealt), Serial, PDA.

## Safety

- Results depend only on the random words and the open order, not on who calls `process()` or when.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- If an open's randomness never arrives (a day, and the router has no answer), anyone can `rerequest` it. After 7
  days with no answer (randomness gone for good), anyone can `cancelOpen`: the packs go back to the holder, sealed.
- The owner can't change a Series' characters or Diamonds once its packs are selling.
- The owner can't change a dealt card. It can change a Series' names and image folder until `lockFire`.

## Tests

`contracts/test/cards/Cards.t.sol` (16 tests, all passing with the other 126):
- the pool math matches the studio's own code over 344 Series sizes and Diamond settings (`pool-fixture.json`,
  written by `studio/scripts/pool-fixture.test.ts` with `WRITE_POOL_FIXTURE=1`)
- Diamonds per Series: default 1, set, locks after the first pack, bounds, the effect on the pool
- every pack keeps the guarantees, and a Series' totals are exact
- the same words give the same cards however processing is split, and out-of-order randomness waits its turn
- holo rates converge (Diamond always holo)
- a contract that refuses NFTs can't stall the queue
- permissions, burns, royalties, metadata

## Deploying

`contracts/script/DeployCards.s.sol` deploys and wires everything in one run:
- the contracts: FirePacks, FireCards, FireSale and FirePsa
- two drand adapters, one for FireCards and one for FirePsa
- the royalty

It hands ownership to the multisig (`OWNER`). The multisig must then call `acceptOwnership()` on FirePacks,
FireCards and FirePsa; FireSale is its own from the start. The script checks every input first and refuses a plain
wallet as owner unless told otherwise. A test runs the same steps.

- **Settings:** `.env.example` (card contracts section). No keys in `.env`: sign with the Foundry keystore or a Ledger.
- **Right after the deploy:** the multisig calls `acceptOwnership()` on FirePacks, FireCards and FirePsa, then checks
  the wiring it now owns: the seller is FireSale on packs and cards, cards point at packs, the PDA is FirePsa,
  randomness points at the two adapters, no Fire is configured or locked yet, and the royalty is what was set.
  Until it accepts, the deployer key controls those three contracts.
- **Keeper:** checkpoints the PLANK price every 30 minutes, delivers drand numbers, and calls `FirePsa.pokePrice()`
  now and then.
- **Before deploy day:** run the real-chain gas test from PowerShell:
  `$env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"; forge test --match-path test/cards/SaleFork.t.sol -vv`

The site has the ABIs: `web/src/data/fireCardsAbi.json`, `firePacksAbi.json`, `fireSaleAbi.json`, `firePsaAbi.json`.

## Money and the economy

Decided Oct 3. See `docs/omni-economy.md`. The contracts never hold funds: whatever is paid is forwarded or
burned in the same transaction.

## Still open

- **Run the real-chain gas test** (above). It couldn't reach Robinhood Chain from the build machine.
- **PAPER:** `0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6`. Confirm on chain that it has 18 decimals.
- **The site:** the sale, starter, credits, burn and PDA screens (comes with the redesign).
- **Before launch:** a second internal audit round, fuzz and invariant tests, and a testnet run. No professional audit
  (owner's call). The first audit is in `docs/audit-2026-10.md`.
