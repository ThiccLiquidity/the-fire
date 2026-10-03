# Card contracts: packs, cards, opening

`contracts/src/cards/`. Built Oct 3 2026 on the decisions in `docs/card-studio.md` (Packs and opening). Not deployed.

## The pieces

| Contract | What it is |
|---|---|
| `FirePacks` | Sealed packs, ERC-1155: one stackable token type per Fire (token id = Fire number). The seller mints; only `FireCards` burns, when a pack is opened. Pack art: `<packImageBase>fire<N>.webp`. Royalty (ERC-2981). |
| `FireCards` | The cards, ERC-721 (token id = global serial). Closes Fires, opens packs, deals cards, on-chain metadata. Royalty (ERC-2981), ERC-4906 metadata updates. |
| `CardRules` | The rarity rules, ported exactly from the Card Studio: pool sizes from the carried accumulators (`computePool`), holo rolls (Diamond always holo, 1/3 each), the pack floor. |

## The flow

1. **Before a Fire:** the owner calls `configureFire(fire, names, categories, imagesBase)`: the Fire's characters in the
   studio's order and the folder its card images live in (IPFS or Arweave). `lockFire` freezes it.
2. **While it burns:** the seller (the sale contract, still to build) mints packs to buyers. They're tradeable sealed.
3. **It goes out:** the seller calls `closeFire(fire)`. The pack count freezes and the pool is worked out from the
   rarity math and the carry-over. The pool is public (`poolOf`).
4. **Opening:** a holder calls `open(fire, count)` (up to 10). Their packs are burned and drand randomness is
   requested. **Nothing about the pack exists before this**, so a sealed pack can't be read in advance.
5. **Dealing:** when the randomness arrives, anyone calls `process()` (the site does it). Packs are dealt strictly in
   the order they were opened. Each draws slot 6 from the Fire-or-better cards left, slot 5 from the flexible pile
   (Fire-or-better not needed for later packs plus spare Wood), then character and holo per card. The six are minted
   in shuffled order so a serial says nothing about its slot. The Fire's totals come out exactly as the pool said.
6. **Metadata:** `tokenURI` is built on-chain. The image is `<imagesBase>c<character>-<material>-<holo>-<wear>.webp`,
   the same names the studio exports. Traits: Character, Category, Material, Holo, Fire, Edition ("k", then "k of N"
   once every pack of the Fire is dealt), Serial, PSA.

## Safety

- Results depend only on the random words and the open order, not on who calls `process()` or when.
- Cards are minted without the receiver callback, so a holder's contract can't stall the queue for everyone else.
- If an open's randomness never arrives (an hour, and the router has no answer), anyone can `rerequest` it.
- The owner can't change a dealt card. It can change a Fire's names and image folder until `lockFire`.

## Tests

`contracts/test/cards/Cards.t.sol` (16 tests, all passing with the other 126):
- the pool math matches the studio's own code over 300 chained Fires (`pool-fixture.json`, written by
  `studio/scripts/pool-fixture.test.ts` with `WRITE_POOL_FIXTURE=1`)
- every pack keeps the guarantees, and a Fire's totals are exact
- the same words give the same cards however processing is split, and out-of-order randomness waits its turn
- holo rates converge (Diamond always holo)
- a contract that refuses NFTs can't stall the queue
- permissions, burns, royalties, metadata

## Deploying

`contracts/script/DeployCards.s.sol` deploys FirePacks, FireCards and a drand adapter pointed at FireCards, wires them,
sets the royalty, and hands ownership to the multisig (`OWNER`), which must then call `acceptOwnership()` on both. It
checks every input first and refuses a plain wallet as owner unless told otherwise. Settings: `.env.example` (card
contracts section). No keys in `.env`: sign with the Foundry keystore or a Ledger. A test runs the same steps.

The site has the ABIs: `web/src/data/fireCardsAbi.json`, `firePacksAbi.json`.

## Money and the economy

Decided Oct 3. See `docs/omni-economy.md`. The contracts never hold funds: whatever is paid is forwarded or
burned in the same transaction.

## Still open

- **The sale contract:** build it to `docs/omni-economy.md`. It mints packs and calls `closeFire` when a drop sells
  out. It also needs per-wallet free-pack credits and the 42.0 burn count.
- **PSA reveal:** the fee and odds are decided (`docs/omni-economy.md`). Still to build: the reveal step, which sets
  the grade so the card's metadata and image switch to the right wear frame.
