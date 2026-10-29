# Testnet test run: the playbook

The owner's plan for the weekend test with friends: who does what, in what order, and a checklist that touches every
part of the site once. The deploy itself is `docs/testnet-runbook.md` (steps 1-14); this is the day itself.
Play money only (Robinhood Chain testnet). Nothing here touches mainnet or `main`.

## The shape of it

| When | What | Who |
|---|---|---|
| 2+ days before | Runbook steps 1-13b (deploy, keepers, site, games setup). The PAPER price needs ~40 h after step 12. | Owner |
| 1 day before | Testers send wallet addresses; owner mints PLANK / Paper Presses; a tester suggests a theme; Series 1 launched with a start time on test day (runbook step 14). | Owner + testers |
| Test day, ~2-3 h | Series 1: buy through every group, sell out, open, case, grade, burn, play. | Everyone |
| Same day or next | Series 2: burn credits, a second pack art, game prizes for Series 1. | Owner + 1-2 testers |

## Roles (5 testers is plenty; fewer is fine, double up)

| Tester | Gets before | Tests |
|---|---|---|
| **A, Press holder** | 1 Paper Press, test ETH | Press group (PAPER only), then Everyone |
| **B, Press holder** | 1 Paper Press, test ETH | Press group, the suggestion pick (free pack) |
| **C, PLANK holder** | ~$1,000 test PLANK, test ETH | PLANK group (snapshot), paying in PLANK |
| **D, phone only** | test ETH | Connect on a phone, Everyone, paying in ETH, the whole site on a small screen |
| **E, latecomer** | nothing | Faucet from scratch, a gated group refusing them, extra packs after sell-out |
| **Owner** | the Ledger | Pause/unpause, keepers, endDrop if needed, buys what's left so it sells out |

Wallets: MetaMask, Rabby or Coinbase Wallet. On a phone, open the test link inside the wallet app's browser (or use
Connect → WalletConnect). One wallet per tester; nobody uses a wallet that holds real money.

## Day before (owner)

1. Collect each tester's address (a chat message is fine: addresses are public).
2. Faucet: testers get their own test ETH at https://faucet.testnet.chain.robinhood.com. Top up anyone who can't
   (`cast send <address> --value 0.02ether --account testnet-deployer --rpc-url $env:RPC`).
3. Mint test PLANK to C (and yourself), a Paper Press to A and B (runbook step 14 commands). Before the snapshot.
4. Tester B suggests a theme on the site (Menu → Suggest). You pick it after `LOCK`, before the start (step 14).
5. Launch Series 1 (step 14, the Test run preset) with the start at the agreed test time. Push the holders file.
6. Send testers the **tester guide** below and the preview link (`...vercel.app/?live=testnet` if needed).

## Test day: Series 1, in order

Times are from the start (T). Each line: who, what, and what "good" looks like. Tick it in the chat or a shared note.

**Before T (everyone, ~15 min early)**
- [ ] All: open the link, **Connect**. Good: "Robinhood Chain Testnet" asked/added, the header shows the Testnet badge.
- [ ] All: Menu → **New here?** Good: "Get test ETH" ticked (or the faucet button), the next step highlighted.
- [ ] All: **Get PAPER** with ETH (a few PAPER). D also gets USDG, C gets a little PLANK. Good: balances update.
- [ ] All: the home page countdown says when Series 1 opens; Info shows the odds (Full Art "1 each").
- [ ] E: try a **Practice pack** (Menu): the rip works with sample cards, nothing saved.

**T+0: Press + PLANK groups open together**
- [ ] A, B: buy in **Paper Press holders** (PAPER only, 1 per Press). Good: 1 pack each; a second is refused.
- [ ] C: buy in **PLANK holders**, paying PLANK, up to the allowance. Good: the allowance shown matches; one more is refused.
- [ ] E: try the PLANK group. Good: greyed with why ("not on the list").
- [ ] B: the **free pack** from the picked suggestion appears; it opens once Everyone opens (credit group).
- [ ] Everyone: the **feed** shows the buys; the Series bar counts down packs left.
- [ ] Watch: each group ends 3 min after its last sale (or when sold). Good: Everyone opens right after the PLANK group.

**~T+5-15: Everyone**
- [ ] D (phone): buy 1 pack with ETH ("Pay the PAPER in ETH too" on). Good: one approval at most, then the pack.
- [ ] A: buy with USDG. C: buy with PLANK. Good: each coin works, the cost shown matches what the wallet asks.
- [ ] B: claim the **free pack** (still costs its PAPER).
- [ ] Anyone: try a 4th pack. Good: refused (3 per wallet).
- [ ] Owner: **Pause** the sale from the Ledger for a minute, someone tries to buy (refused, "Paused" shows), unpause.
- [ ] Owner: buy what's left so the 12 sell out. Good: "Sold out", the sell-out show, the recap note.

**Sell-out: extra packs**
- [ ] E: buy 2 **extra packs**. Good: 1 per purchase, the price rises each pack.
- [ ] Everyone: wait 5 min with no extra-pack sale. Good: the keeper closes the Series; toast "Series 1 is closed. Time to rip!"
- [ ] Everyone: **Open packs** appears only now, only for wallets with packs.

**Opening (~90 s per open)**
- [ ] A: open 1 pack and **wait**. Good: the gauge counts down, the **Play while you wait!** invite pops up.
- [ ] A: **No thanks**. Good: a small "Play while you wait" button stays; the rip starts when the draw lands.
- [ ] B: open, tap **Let's play** → the game list → Fold and Flick **Free play**. Good: the bar on top counts down,
      then turns green "Your cards are ready!" with a toast and buzz; **Rip your cards →** goes straight to the rip.
- [ ] C: open, then switch to another app/tab. Good: the tab title says "🔥 Your cards are ready!" when it lands.
- [ ] D (phone): open, **reload the page** mid-wait. Good: Open packs comes back to the same wait (not a new open);
      the rip shows only the new cards.
- [ ] Everyone: the **rip** (tear, cards, rare pulls), then **My cards**: the cards with images and traits.
- [ ] Anyone: share a pull (Share). The link/picture works.
- [ ] Owner: stop the **main keeper** in Railway for 10 min while someone opens. Good: the backup steps in (one webhook
      message, not a flood); start the main keeper again.

**Cards: case, grade, wear, transfers**
- [ ] A: **Case** a card (pay ETH). Good: the slab look, "Cased".
- [ ] B: **Grade** a card (pay USDG or PLANK; PAPER isn't offered). Good: the grade wait offers the games too; the grade
      shows; the explorer shows it after a refresh.
- [ ] C: send a card to D from the wallet app. Good: D sees it; its **wear** counts the trade (card page).
- [ ] D: send a **sealed pack** to E (packs are NFTs). Good: E can open it.
- [ ] A: set a **profile** (name + a card picture). Good: it shows next to A's pulls; after A sends that card away, the
      picture goes.
- [ ] Anyone: the **Series board** shows who fed the fire.

**Burn and games**
- [ ] Testers send spare cards to one wallet (say C) until it holds 42+, then C **burns 42**. Good: a free pack credit
      (spent in Series 2).
- [ ] Everyone: **Game room**: Fold and Flick and Spit-Wad free play; the **leaderboard**.
- [ ] Two testers: a **competitive run** of Fold and Flick (1 PAPER, 18+ box). Needs the PAPER price (2 days after the
      deploy): before that it says "That game isn't open". Testers in AZ, AR, CT, DE, LA, MT, SC, SD, TN, IN, ME can't.
- [ ] Anyone: **Suggest** a theme + style in one go; suggest a character.

**Checks after (owner)**
- [ ] Every pack opened: exactly **5 Full Arts**, one per character (runbook step 15's `onePerCharacterOwed` = `[]`).
- [ ] Explorer: packs and cards show the right images and traits.
- [ ] Home page: **Liquidity locked** in dollars after the keepers' first liquidity run.
- [ ] Help → explorer link opens the **testnet** explorer.
- [ ] No "(demo)", "Demo" or "soon" text anywhere it shouldn't be.
- [ ] Keeper webhook: no repeated floods; read what it posted.

## Series 2 (same day or next)

- [ ] Owner launches Series 2 (Gym Bros, Test run preset), its pack art showing.
- [ ] C spends the **burn credit** from Series 1 while Everyone is open.
- [ ] Game prizes for Series 1: `docs/game-server.md` section 4 (`award.mjs`, dry run, then `--send`). The winners see
      their prize packs/cases/gradings.
- [ ] A quick buy → sell out → open → grade loop to confirm nothing broke between Series.
- [ ] Morning Wood checks (runbook step 15), if there's time.

## If something breaks

Write in the chat: **what you did, what you saw, the time, your wallet's last 4 characters**, and a screenshot. A
transaction link (Help → explorer) is gold. Don't retry the same thing more than twice. The owner collects them; we
fix, then redo that line.

---

## Tester guide (send this to friends)

> **Omni Cardworks: testnet test**
> Thanks for helping! Everything here is play money on a test network: nothing costs real money.
>
> 1. **Wallet:** MetaMask, Rabby or Coinbase Wallet, a fresh one (never one with real funds). On a phone, open the
>    link below **inside your wallet app's browser**.
> 2. **Test ETH:** free at https://faucet.testnet.chain.robinhood.com (paste your address). Send me your address too.
> 3. **The site:** <preview link>. Tap **Connect**; let it add "Robinhood Chain Testnet".
> 4. **Menu → New here?** walks you through it: get PAPER, buy a pack, open it when the sale ends, case or grade.
> 5. We start at **<time>**. Packs sell in groups (holders first, then everyone), then open once all are sold.
> 6. While a pack opens (~90 s) there's a game to play. Try everything: case, grade, burn, the games, your profile.
> 7. Something odd? Screenshot + what you did + the time, in the chat.
