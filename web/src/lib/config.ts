// Site-wide settings for the live Forge.

/** Swap fee: 0.5% of what the buyer pays, sent by KyberSwap straight to SWAP_FEE_WALLET in the same transaction. */
export const SWAP_FEE_BPS = 50;
/** Swap fee wallet (public address only). Until it's set, swaps run with no fee: set it before the mainnet build. */
export const SWAP_FEE_WALLET: `0x${string}` | undefined = undefined;
