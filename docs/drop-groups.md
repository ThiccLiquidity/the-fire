# Drop groups (spec, Oct 22 2026)

The owner sets a Series' drop as a total pack count split into **groups**. Each group says who can buy, how many,
at what price, when, and where its unsold packs go. Replaces the fixed press-pack / holder-window / PLANK-only /
wallet-limit timers of the old `DropConfig`. Built before the testnet card redeploy.

## What the owner sets (per Series)

- **Total packs.**
- **1 to 6 groups.** Each group:
  - **packs**: how many (the studio lets the owner type a % or a count; the counts must add up to the total).
  - **who** (`gate`):
    - `OPEN`: anyone.
    - `NFT`: holders of one ERC-721 collection (the Paper Press, or any other), checked live at purchase.
      `perNft` packs per NFT id per Series (an NFT can't be passed around to buy again: each id is spent once its
      allowance is used, whoever holds it).
    - `SNAPSHOT`: wallets in a Merkle snapshot (any coin or NFT, any minimum, minimum balance over N days, LPs
      counted; built off-chain by `ops/snapshot`). Each leaf carries the wallet's own allowance (so tiers like "1M
      PLANK = 2 packs, 10M = 5" are possible); `perWallet` still caps it.
  - **price**: dollars per pack (`priceUsd`, 8 decimals, 0 = none) and/or PAPER per pack (`paper`, wei, 0 = none).
    Both 0 = free (holders' claims). PAPER is capped by the drop's `paperCapUsd` as today.
  - **coins** accepted for the dollar price: bit mask PLANK=1, ETH=2, USDG=4 (ETH includes `buyWithEthAll`).
  - **perWallet**: most packs one wallet can take in this group (0 = no limit).
  - **limitFor** (owner-approved): a timer on the per-wallet limit, in seconds (0 = the limit holds the whole time).
    The limit only applies until `limitFor` after the group actually opened; from that second on a wallet buys as
    many as it likes (`perTx`, `maxPerTx` and the gate still apply). Needs a `perWallet`; at most 30 days. Set in
    advance and locked with the drop like everything else. `groupsOf` shows it (`config.limitFor`) and when it lifts
    (`limitUntil` = `opensAt` + `limitFor`; 0 until the group's opening time is known).
  - **start**: `afterGroup` = 255 → opens with the drop (`start` + `startDelay`); otherwise it opens when group
    `afterGroup` ends (+ `startDelay`). So groups run side by side or one after another.
  - **duration**: longest it stays open (seconds, 0 = until its packs are gone). It ends the moment its packs are
    gone, or when the duration runs out, whichever is first.
  - **rollTo**: where its unsold packs go when it ends: another group's index (added to that group's packs), or
    255 = nowhere (they're never made; the Series is smaller).
- **Free packs (credits)**: `creditPacksMax` (in all) and `creditPacksPerWallet`, spent from `creditGroup` (a
  group index; its packs and timing; credits ignore its gate, price and coins: a credit pays only the group's PAPER).
- Drop-wide, as today: `start`, `plankBurnBps`, `paperBurnBps`, `paperCapUsd`, `maxPerTx`, `regularWalletsFor`
  (bots guard), `creditsPerPick`.

## Rules the contract enforces

- Settings lock at `start` (as today). Validation at `configureDrop`: 1-6 groups; packs sum = total; every
  `afterGroup` / `rollTo` / `creditGroup` index valid, no cycles (a group may only follow or roll to a group with a
  LOWER index for `afterGroup`, and to any other group for `rollTo` as long as the roll graph has no cycle; simplest
  rule: `rollTo` must be a HIGHER index or 255, `afterGroup` a LOWER index or 255); every duration and delay at most
  MAX_WINDOW (30 days) so every group always ends; gate fields consistent (NFT needs a token with code, SNAPSHOT
  needs a root); a group with a dollar price needs at least one coin.
- A group's **capacity** = its packs + the unsold packs rolled into it from groups that have ended. Ended groups
  report what they rolled.
- **Close**: the moment the last pack that can still be made is minted (nothing left in any group that is open or
  yet to open), the Series closes — however early. A drop whose groups have all ended can be ended by the owner, and
  by anyone END_GRACE (7 days) later, as today (`endDrop`).
- Buying names the group: `buy(fire, group, n, pay, maxCost, maxPaper, Access)` style (plus the ETH-alone path that
  buys the PAPER on the market). `Access` = `{ nftIds[], allowance, proof[] }`.
- Payment split, PAPER burn and its ceiling, PLANK burn share, PAPER buy & burn share, the 90% PLANK swap floor,
  PlankBurner fallback, refunds, pause, never holding funds, one drop at a time, credits via FireCredits only: all as
  today.

## Contract layout

FireSale is at the 24 KB limit. Group bookkeeping (config, capacity, timing, gate checks, per-wallet / per-NFT
counts) goes in a new contract **FireGroups** that only FireSale can write to; FireSale keeps payments, minting,
pricing and closing. Views for the site: each group's state (open / upcoming / ended, capacity, sold, opens at,
ends at, price, coins, gate) and a wallet's standing in each group.

## The studio and the site

- Studio: a Groups editor (total packs; add a group from a template: "Press holders", "PLANK holders", "Any NFT",
  "Any coin snapshot", "Everyone"; % or count; who; price; per wallet; start: with the drop / after group X;
  max time; leftovers to), a timeline picture and a plain-English summary line per group, presets (Standard, Hype
  drop), and the totals checked live.
- Site: the buy box lists the open groups the wallet can use, with what each costs and how many are left, and
  what opens next; one Buy flow per group.
- ops: `snapshot` generalized to any ERC-20 or ERC-721 + minimum + tiers → leaves with allowances; VerifySeries and
  the launch policy check the groups.

## The Standard preset (what today's Standard drop becomes)

167 packs (as today), 3 groups:
1. Paper Press holders: 50 packs, 1 PAPER, 1 per Press, 2 per wallet, opens with the drop, up to 6 h, leftovers to group 3.
2. PLANK holders (snapshot, $69+ held for 7 days): 40 packs, $2.50 + 1 PAPER, PLANK only, 5 per wallet, opens with
   the drop, up to 24 h, leftovers to group 3.
3. Everyone: 77 packs (+ leftovers), $2.50 + 1 PAPER, any coin, 5 per wallet for its first 24 h (`limitFor` 86400; a
   placeholder until the owner confirms the number: `EVERYONE_LIMIT_HOURS` in `studio/src/sale.ts`), then no limit,
   opens when group 2 ends, until sold.
4. After sell-out (owner-approved addition): no pack count (`unlimited`), $2.50 rising 4% a pack (`taxBps` 400) +
   1 PAPER, ETH only, 1 per purchase (`perTx`), no wallet limit, opens when group 3 ends (sells out), no time limit,
   ends 15 minutes after its last sale (`idle` 900), rolls nowhere.
Free packs: up to 10% (16), 3 per wallet, from group 3. PLANK 10% / PAPER 20% burn shares, $1 PAPER ceiling,
contracts (bots) kept out for the first 48 h. Total packs 167: the base Series (the finite groups); whatever the
unlimited group sells adds on top.

## As built (contracts, Oct 22 2026)

`contracts/src/cards/FireGroups.sol` (new, no owner; only FireSale writes to it, wired once at deploy by the
deployer) and `FireSale.sol` (groups replace the press packs, holder window, PLANK-only packs and wallet limit). JSON
shape and every bound: `docs/cards-contracts.md`.

- **Rising tax** (`taxBps`, owner-approved addition): the k-th pack sold in a group (k = 1 for its first) costs
  `priceUsd * (1 + taxBps/10000)^k`. The base price splits as any sale; the whole tax goes to PaperBurner in the coin
  paid. Bounds: at most 5000 (50%), needs a price, no group may roll into a taxed group (its capacity is its own
  packs), and any pack at most 1e9 times the base (see the price safety bound below). Credit packs from a taxed group count as sold (they raise the next price).
- **When a group ends.** Its duration runs out, or its packs are gone **for good**: sold out AND no group that rolls
  into it (directly, or through a group that has already ended) is still open or yet to open. Until then a sold-out
  group stays "open" with 0 left, waiting for leftovers, and a group set to open after it waits too. The end time is
  the later of its last sale and the end of the last group rolling into it, so the next group opens at once.
- **The hype case (Standard).** Press holders have claimed 10 of 50, the PLANK group and Everyone sell out in the
  first hour. The Series does NOT close: 40 press packs can still be made. Press holders keep claiming until the press
  group's 6 hours are up; then its unclaimed packs roll into Everyone, which reopens with them and sells them; the
  Series closes with the last one. If the press holders claim all 50 first, the Series closes at that claim. (Before
  the press group ends, Everyone shows "open, 0 left"; the site should say "more may come from the Press group at
  <its endsAt>".) Meanwhile the After sell-out group stays shut: it opens only when Everyone has ended, i.e. after the
  press leftovers are sold.
- **`idle`** (owner-approved follow-up): a group also ends once nothing has sold in it for `idle` seconds, counted
  from when it opened, then from each sale; its end = the earliest of opened + duration, last sale (or opening) +
  idle, and the sell-out time. Leftovers roll and the next group opens at that moment, with no keeper poke. Its
  `endsAt` view is when it ends if nothing more sells. `scheduleEnd`/`endableAt` ignore idle for finite groups (it
  only ever ends a group sooner, so the fixed-by-config time stays a safe latest).
- **`perTx`**: most packs in one purchase in that group (0 = the drop's `maxPerTx`, which also always applies).
  Credits ignore it, like the group's other buy limits.
- **Unlimited groups** (owner decision): `unlimited` with `packs` 0, needing `taxBps` > 0 AND `idle` > 0 (an untaxed
  or never-idling unlimited group would mint forever; both refused), rolling nowhere, and nothing may roll into it.
  Demand is capped by the rising price, not by a count or a time limit. The drop's `packs` is the sum of the finite
  groups (the base Series); the unlimited group adds on top. While it is open or yet to open, `remaining`,
  `status.left` and `openLeft` read `type(uint256).max` and the Series stays open; it closes once the group has idled
  out and nothing else is left (`close`, by anyone; the keeper calls it at `status.left == 0`). `endDrop`: an
  unlimited group that has opened pushes `scheduleEnd`/`endableAt` to its current idle deadline, so the owner can end
  the drop only once it has ended (always reachable: idle ends it once sales stop, and the price safety bound stops
  sales). One that never opened (its group before never ended) doesn't hold `endDrop` back.
- **The overflow group keeps the Series open** while it sells: in the Standard preset a Series that sold its 167
  packs stays open (its packs unopenable) until 15 minutes pass without an extra sale.
- **Price safety bound:** any pack of a taxed group costs at most 1e9 times its base price (`MAX_TAX_GROWTH`). A
  finite taxed group must fit it whole; past it an unlimited group's buys and quotes revert `PriceTooHigh` and the
  group idles out. A safety bound for the maths, not a sales cap: at 4% it's pack ~528, ~$2.5 billion a pack.
- **Card side, checked:** nothing in FirePacks, FireCards or RecipeDealer is tied to the configured `packs`.
  `FirePacks.mint` caps only at 2^64; `FireCards.closeFire` freezes `FirePacks.minted`; the dealer works out the pool
  from that frozen count at close. So a Series larger than its base total closes and deals normally (tested: 62 packs
  on a base of 2, opened and dealt). Effect to know: per-character types (Gold 2, Full Art 1 per character) are fixed
  counts, so extra packs make them rarer per pack; share types (Fire, Coal) scale with the packs.
- **Leftovers passing an ended group.** Packs rolled into a group whose time has already run out pass straight on to
  where that group rolls (or are never made if it rolls nowhere).
- **Closing.** A buy (or credit spend) that takes the last pack that can still sell closes the Series in the same
  transaction. When the last sellable packs vanish because a group's time ran out (leftovers rolling nowhere), no
  transaction happens then: anyone calls `FireSale.close(fire)`.
- **Ending a drop.** The owner can `endDrop` once the schedule is over at the latest: every timed group has run its
  full time and every until-sold group has opened (fixed by the config: `FireGroups.scheduleEnd`; 24 h for the
  Standard preset, later only while its unlimited group is open: see below), and at least `MIN_DROP_TIME` (1 day) after the start; anyone `END_GRACE` (7 days) later.
- **Credits** spend packs from `creditGroup` only while it is open (not at any time as before); its gate, price,
  coins and wallet limit and the regular-wallets rule don't apply; they don't count toward the group's wallet limit.
  `creditGroup` 255 = no credit packs.
- **NFT gate:** `perNft` packs per NFT id per group per drop (two groups gated on the same collection count
  separately). A buyer names its ids; packs are taken from them in order, each checked with `ownerOf` live.
- **Snapshot gate:** leaf = `keccak256(bytes.concat(keccak256(abi.encode(wallet, allowance))))` (OpenZeppelin
  StandardMerkleTree of `["address","uint256"]`). The old holder snapshot's leaf had no allowance: `ops/snapshot` must
  write the new leaves.
- **Free packs open to everyone are refused** (an open group needs a price or PAPER): a `$0` typo can't give packs
  away. Stray gate data (an `nft` on a snapshot group, say) is refused too.
- **Paper Press in FireSale:** gone (`FireSale.Config` has no `press`; the NFT gates name their collection). The
  deploy still records `MILL`; ConfigureSeries resolves `"nft": "press"` to it.

