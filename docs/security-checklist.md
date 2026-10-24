# Security checklist: your computer, wallets and accounts

Do this before mainnet. The contracts can be perfect and still lose everything if a wallet key or an account that
can change the site is taken. Tick each box; anything you can't tick, ask.

## 1. Wallets

- [ ] **Owner Ledger** (owns every contract, configures each Series): its 24-word recovery phrase is on paper or
      metal only, never typed into a computer, phone, photo, cloud note or password manager. Stored somewhere fire-
      and theft-safe, with a second copy in a different place.
- [ ] Ledger PIN set, firmware up to date (Ledger Live), and Ledger Live installed only from ledger.com.
- [ ] **Blind signing** is on only while you sign Omni transactions (it was turned on for the testnet deploy).
      Turn it off afterwards in the Ethereum app's settings.
- [ ] Before signing on the Ledger, the screen's contract address matches `deployments/4663.json` (or `46630.json`
      on the testnet). If the address on the device isn't one of ours, reject.
- [ ] The owner Ledger is used for nothing else (no airdrops, no mints on other sites, no token approvals).
- [ ] **Revenue wallet** (gets 70% of sales): a hardware wallet address, not a hot wallet. It can be the same Ledger
      on a different account.
- [ ] **Deployer** (throwaway hot wallet): after the deploy, move what's left of its ETH out. It has no powers once
      the owner accepts ownership; don't reuse it for anything.
- [ ] **Keeper wallets** (Railway): hold gas money only. Keep about 0.005-0.01 ETH each and top up when the
      low-balance alert fires (under 0.002 ETH). Never send them tokens. Their keys live only in Railway's variables.
- [ ] **Morning Wood editor** (Foundry keystore `editor`, on the machine that publishes the paper): a hot key that can
      only publish or re-publish issues that haven't opened, at least 1 hour ahead (it can't open one at once or swap
      one in its last hour). Keep only gas money on it. Its keystore password is never in the repo; if the scheduled
      task ever signs unattended, the password file that allows it lives outside the repo and makes the key hot. If
      it leaks: `MorningWood.setEditor(0x0)` (or a new editor) from the Ledger, and `unpublish` anything you didn't
      write.
- [ ] No seed phrase or private key has ever been pasted into a chat, email, Discord, Telegram, a website or a
      screenshot. If one has: move the funds to a new wallet now, then replace that wallet everywhere.

## 2. Your computer

- [ ] Windows fully updated, and Windows Defender (or another antivirus) on with real-time protection.
- [ ] Browser: only the extensions you need. Remove any you don't recognise or don't use, especially wallet
      look-alikes, "price trackers", PDF converters and coupon tools. One wallet extension, installed from the
      wallet's own site.
- [ ] Use a separate browser profile for crypto and the project's admin sites (GitHub, Vercel, Railway, Filebase,
      Pinata), with no other extensions in it.
- [ ] Don't run scripts or programs people send you ("try this airdrop checker", "the new build"). Our scripts come
      only from this repository.
- [ ] Downloads: no cracked software, no unknown `.exe`, `.scr`, `.bat` or `.ps1` files.
- [ ] Screen lock after a few minutes, a strong Windows password or PIN, and BitLocker drive encryption on.
- [ ] The repository clone (`C:\Users\DubT1\the-fire`) holds no keys: `git status` before every push shows nothing
      like `.env`, `*.key`, keystore files or JSON with `privateKey`. (`.gitignore` already blocks `.env` and the
      Foundry keystore lives in your user folder, not the repo.)

## 3. Accounts that can change the project

Each one: a strong unique password from a password manager, two-factor login with an **authenticator app or a
passkey** (not SMS), and the recovery codes saved offline.

| Account | Why it matters | Extra |
|---|---|---|
| **Email** (the one every account below resets to) | Whoever has it can reset everything else | Do this one first. Check its forwarding rules and recovery phone/email for anything you didn't set up. |
| **GitHub** | The code; Vercel and Railway build from it | Settings → Sessions: sign out sessions you don't recognise. Settings → Applications: remove apps you don't use. Keep the "Claude" app only while you use it. |
| **Vercel** (team traitfolio) | Serves the site; a changed site can trick buyers into signing the wrong thing | Members: only you. Turn on deployment protection for previews if you don't want them public. |
| **Railway** | Runs the keepers and holds their keys | Members: only you. |
| **Filebase** and **Pinata** | Hold the card images | Delete keys you no longer use (the old Pinata account). |
| **Reown** (wallet connect project id) | The project id is public; the account can change allowed domains | Allowed domains: only the site's. |
| **Telegram** (alerts) | Keeper alerts come here | Two-step verification password on. |
| **Domain registrar** (when you buy the domain) | Whoever controls DNS controls the site | Registrar lock on, 2FA on. |
| **X / Discord** (announcements) | A hacked account posting a fake mint link is the most common NFT scam | 2FA on; pin a post saying you'll never DM a mint link. |
| **Claude** (this account) | It has access to the GitHub repo and Vercel | Remove the GitHub and Vercel connections when you're done building, or keep them only as long as needed. |

## 4. Keys to replace (rotate)

- [ ] **Pinata** keys from the old account and the test key: delete them in Pinata. Make one new key only when
      you upload, give it upload rights only, and delete it after the upload.
- [ ] **Filebase**: same. A key with access to the one bucket, deleted or rotated after each Series upload.
- [ ] **Keeper keys**: if they were ever shown on screen in a shared place, make new keeper wallets and update
      Railway. Otherwise keep them.
- [ ] **RPC URL with an API key** (Alchemy or similar): it's in Railway's variables. If it was ever pasted
      anywhere public, regenerate it. Type it hidden (`Read-Host -AsSecureString`). Forge keeps it in
      `contracts/cache/*/<chain id>/run-latest.json` (and the broadcast files): git-ignored, but don't zip, upload or
      share the `contracts` folder.
- [ ] **The paper's keys** (scheduled task's environment or `paper/.env`, git-ignored): `PINATA_JWT` (pin-only scope),
      `TWITTERAPI_IO_KEY`, `IMAGE_API_KEY`, `IMGFLIP_USERNAME`/`IMGFLIP_PASSWORD`, and the `RPC_URL`. Never in chat or a
      commit. Rotate any that shows up in a task transcript.
- [ ] **Healthchecks URLs** (`HEARTBEAT_URL`, one per keeper): anyone with one can ping it and hide a dead keeper.
      Railway variables only; regenerate a check's URL if it leaks. Same for `ALERT_WEBHOOK_URL`.

Checked Oct 21, 2026: the repository's whole history holds no private keys, seed phrases or API keys (only public
addresses, the published AWS example key in a test, and Anvil's public dev keys).

## 5. On launch day

- [ ] Announce only the real site address. Pin it. Expect fake "Omni Cards" accounts and sites: warn people that
      there is no early mint, no DMs, no "airdrop claim".
- [ ] Keep the owner pause (`FireSale.setPaused`) ready: if anything looks wrong, pause the sale first and look second.
- [ ] Watch the keeper alerts and the first few opens end to end.
