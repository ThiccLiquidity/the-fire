# Site

Vite project deployed on Vercel (Root Directory `web`). Needs Node.js 20.19+ or 22.12+ (Vite 8).

- `public/forge/` is the Forge: a static page (canvas workshop scene plus station screens) served at `/forge/`.
  `/` redirects there (`index.html` and `vercel.json`). Purchases are still demo: a demo banner under the top bar,
  demo balances and cards, no payments, and no wallet connection (Connect signs in a demo wallet).
- `src/lib/` holds the modules for the live version: chain and RPC config, the wallet connection (`wallet.ts`), the
  drand helper, the card contract ABIs (`abi/`, exported by `cards.ts`) and the KyberSwap swap guard. `npm run build`
  type-checks them.
- `vercel.json` sets the Content-Security-Policy. If `VITE_RPC_URL` is set, its host must be in `connect-src`; the
  production build fails otherwise (see `vite.config.ts`).

```sh
npm install
npm run dev           # http://localhost:5173
npm run build         # tsc -b && vite build
npm run build:wallet  # the wallet bundle (not used by the site yet; see below)
npm run lint          # oxlint
```

## Live-site helpers (ready, not wired in)

- `src/lib/data.ts` + `blockscout.ts`: the data adapter (`ForgeData`: packs and cards a wallet holds, recent
  activity) and its Blockscout v2 implementation. Wiring it in needs the explorer host in the CSP's `connect-src`.
- `src/lib/tx.ts`: `sendTx` runs check network → simulate → confirm in wallet → wait, with a plain reason on
  failure; sent transactions are kept in localStorage until they land (`pendingTxs`, `resumePending` after a reload).
- `src/lib/approve.ts`: `approveExact` approves exactly what a payment needs, never unlimited.
- `src/lib/network.ts`: the wrong-network check (`networkOf`, `watchNetwork` for the banner, `assertRobinhood`).
- `src/lib/errors.ts`: a plain-English message for every custom error in the ABIs (`explain(e)`). The list of
  errors is generated: after regenerating the ABIs, run `npm run gen:errors`, then `npx tsc -b` names any error that
  still needs a message. `node scripts/gen-abi-errors.mjs --check` fails if the generated list is out of date.

## Wallet connection (ready, not wired in)

The wallet layer for the live site is built on the standard stack: [wagmi core](https://wagmi.sh/core) holds the
connection (restored on reload), [viem](https://viem.sh) reads the chain and
[Reown AppKit](https://docs.reown.com/appkit/javascript/core/installation) draws the Connect Wallet modal. Wallets:
installed extensions through EIP-6963, WalletConnect (QR code on desktop, deep links on phones) and Coinbase Wallet
(regular wallet only). Robinhood Chain (mainnet, or testnet with `VITE_CHAIN=testnet`) is the only network; on
connect the wallet is asked to add and switch to it (public RPC only).

The Forge does not load it yet: the site stays a demo with no wallet connection.

- `src/lib/wallet.ts`: `initWallet()`, `connect()`, `disconnect()`, `getAccount()`, `watchAccount(cb)`,
  `switchToRobinhood()`, `getPublicClient()`, `getWalletClient()`, `readBalance(token, owner)`, `listWallets()` /
  `connectWith(id)` (fallback without a Reown project id), the chain constants, `waitOk`, `friendly` and `hasCode`.
- `src/forge-wallet.ts`: a small browser entry that puts `window.ForgeWallet` on the page (`open()`, `disconnect()`,
  `switchNetwork()`, `state()`, `onChange(cb)`); wagmi and AppKit load on the first click.
- `vite.wallet.config.ts` (`npm run build:wallet`) builds it into `art/factory/forge/vendor/`.

To wire it in later:
1. Create a Reown project (free, [dashboard.reown.com](https://dashboard.reown.com)), allow the site's domain, and set
   `VITE_REOWN_PROJECT_ID` in Vercel → Settings → Environment Variables (public, not a secret).
2. Build the bundle into the deploy (`vite build --config vite.wallet.config.ts --outDir dist/forge/vendor` after the
   main build), load `vendor/wallet.js` from `forge/index.html` as a module, and point the Connect button at
   `ForgeWallet.open()`.
3. Add to the CSP in `vercel.json`: `connect-src https://api.web3modal.org https://pulse.walletconnect.org
   https://rpc.walletconnect.org wss://relay.walletconnect.org` and
   `frame-src https://verify.walletconnect.org https://verify.walletconnect.com`.

## Forge source and the served copy

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
