# Share previews

When someone shares cards ("Share this pack", or "Share" on a showcase), the link is
`https://<the site>/s?show=<wallet>&c=<card numbers>&live=testnet`. Pasted into X, Discord, iMessage, Telegram or a
text, it shows a picture of those cards on the workshop backdrop (the best one in front, up to three) and a title like
"Gold Pigeon · PDA 9". Anyone who taps it lands on that wallet's showcase on the site.

How: `/s` is the small page in `web/api/share` (vercel.json rewrite). It reads each card from the chain (only cards the
wallet still holds), writes the preview tags, and sends people on to `/forge/?show=...`. The picture is
`/api/share/img`, made with sharp from the card images on IPFS. Both are cached on Vercel's CDN for an hour. Demo links
(no `?live`) and anything that fails get the site's own preview picture (`forge/ui/og.jpg`).

## Setup

None. It uses the public RPC. Optional, if the public RPC is slow: Vercel → Environment Variables
`SHARE_RPC_TESTNET` / `SHARE_RPC_MAINNET` = a read RPC (Alchemy).

**Check** (after a deploy): `https://<the site>/s?show=<a wallet with cards>&c=<one of its card numbers>&live=testnet`
opens the showcase; paste the same link into https://www.opengraph.xyz to see the preview.
