// The live chain layer: reads and writes on the card contracts of the chosen network (net.ts). Loaded only when the
// page runs live (?live=testnet / ?live=mainnet, or VITE_LIVE): the demo never loads it.

export * from "./reads";
export * from "./writes";
export { NotDeployedError, amount, type Amount } from "./contracts";
export { NET, isDeployed } from "../net";
export * from "./swap";
// Sent transactions that haven't landed yet (kept across reloads): the page shows and resumes them.
export { pendingTxs, resumePending, TxStillPending, type PendingTx, type TxOutcome } from "../tx";
