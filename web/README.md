# Site

Vite project deployed on Vercel (Root Directory `web`). Needs Node.js 20.19+ or 22.12+ (Vite 8).

- `public/forge/` is Cardworks: a static page (canvas workshop scene plus station screens) served at `/forge/`.
  `/` redirects there (`index.html` and `vercel.json`). Purchases are still demo: a demo banner under the top bar,
  demo balances and cards, no payments, and no wallet connection (Connect signs in a demo wallet).
- `src/lib/` holds the modules for the live version: chain and RPC config, the wallet connection (`wallet.ts`), the
  drand helper, the card contract ABIs (`abi/`, exported by `cards.ts`) and the KyberSwap swap guard. `npm run build`
  type-checks them.
- `vercel.json` sets the Content-Security-Policy (ready for the live site: the RPCs, Blockscout, drand, KyberSwap,
  Reown/WalletConnect, Coinbase Wallet and the IPFS gateways), HSTS and a Permissions-Policy. If `VITE_RPC_URL` is
  set, its host must be in `connect-src`; the production build fails otherwise (see `vite.config.ts`).

```sh
npm install
npm run dev           # http://localhost:5173
npm run build         # tsc -b && vite build
npm run build:wallet  # the wallet bundle (not used by the site yet; see below)
npm run lint          # oxlint
```

## Live-site helpers (ready, not wired in)

- `src/lib/data.ts` + `blockscout.ts`: the data adapter (`ForgeData`: packs and cards a wallet holds, recent
  activity) and its Blockscout v2 implementation (request timeout, 429 backoff, ERC-1155 batch transfers).
- `src/lib/tx.ts`: `sendTx` runs check network → simulate → confirm in wallet → wait, with a plain reason on
  failure. It's the one sending path. Sent transactions (with their nonce) are kept in localStorage until they end
  (`pendingTxs`, `resumePending` after a reload): success, reverted (the only "failed"), or replaced (the account's
  nonce moved past it with no receipt). An RPC error or timeout leaves it pending (`TxStillPending`, which follows a
  speed-up to its new hash).
- `src/lib/approve.ts`: `approveMax` approves the most a call may take (its `maxCost` / `maxPaper`), never the quote
  and never unlimited.
- `src/lib/network.ts`: the wrong-network check (`networkOf`, `watchNetwork` for the banner, `assertRobinhood`).
- `src/lib/errors.ts`: a plain-English message for every custom error the site can meet (`explain(e)`): the card
  ABIs, plus the randomness router and adapter and the standard ERC-20 errors from `src/lib/extraErrors.json`. The
  list of errors is generated: after regenerating the ABIs, run `npm run gen:errors`, then `npx tsc -b` names any
  error that still needs a message. `node scripts/gen-abi-errors.mjs --check` fails if the generated list is out of date.

## Wallet connection (ready, not wired in)

The wallet layer for the live site is built on the standard stack: [wagmi core](https://wagmi.sh/core) holds the
connection (restored on reload), [viem](https://viem.sh) reads the chain and
[Reown AppKit](https://docs.reown.com/appkit/javascript/core/installation) draws the Connect Wallet modal. Wallets:
installed extensions through EIP-6963, WalletConnect (QR code on desktop, deep links on phones) and Coinbase Wallet
(regular wallet only). Robinhood Chain (mainnet, or testnet with `VITE_CHAIN=testnet`) is the only network; on
connect the wallet is asked to add and switch to it (public RPC only).

Cardworks does not load it yet: the site stays a demo with no wallet connection.

- `src/lib/wallet.ts`: `initWallet()`, `connect()`, `disconnect()`, `getAccount()`, `watchAccount(cb)`,
  `switchToRobinhood()`, `getPublicClient()`, `getWalletClient()`, `readBalance(token, owner)`, `listWallets()` /
  `connectWith(id)` (fallback without a Reown project id), the chain constants, `friendly` and `hasCode`. Sending
  and waiting for transactions is `tx.ts` only.
- `src/forge-wallet.ts`: a small browser entry that puts `window.ForgeWallet` on the page (`open()`, `disconnect()`,
  `switchNetwork()`, `state()`, `onChange(cb)`); wagmi and AppKit load on the first click.
- `vite.wallet.config.ts` (`npm run build:wallet`) builds it into `art/factory/forge/vendor/`.

To wire it in later:
1. Create a Reown project (free, [dashboard.reown.com](https://dashboard.reown.com)), allow the site's domain, and set
   `VITE_REOWN_PROJECT_ID` in Vercel → Settings → Environment Variables (public, not a secret).
2. Build the bundle into the deploy (`vite build --config vite.wallet.config.ts --outDir dist/forge/vendor` after the
   main build), load `vendor/wallet.js` from `forge/index.html` as a module, and point the Connect button at
   `ForgeWallet.open()`.

The CSP in `vercel.json` already allows Reown/WalletConnect (`api.web3modal.org`, `rpc.walletconnect.org`,
`pulse.walletconnect.org`, the relay, the Verify and secure frames, `fonts.reown.com`) and Coinbase Wallet.

## Cardworks source and the served copy

`public/forge` is generated. Edit the source in `art/factory/forge`, then run:

```sh
art/factory/sync_forge.sh
```

It copies `art/factory/forge` and the scene art in `art/factory/build3`
to `public/forge`, placing the art in `public/forge/a/` and rewriting `../build3/` paths to `a/`. Commit both the
source and the regenerated copy.

## Scene art pipeline (`art/factory`)

| Step | Input | Output |
|---|---|---|
| `python3 cut_sprites.py` | `originals/sprites.png` (moving parts on #00FF00) | `build2/sprite-*.webp` |
| `python3 build_scene.py` | `originals/factory-full.png`, `originals/factory-clean.png`, `build2/`, and the studio's built-in frames (`studio/src/assets/frames`): Paper for the burned card, all five materials for the material pills | `build3/` (plate, belt, chain, rollers, sprites, `card.webp`, `mat-*.webp`, `scene.json`) |

Run both from `web/art/factory` (Python 3 with numpy, scipy and Pillow). `build3/pack.webp` is the pack art and is
not generated by the script. The page code in `art/factory/forge` draws the flames, glows, steam and text on top.
