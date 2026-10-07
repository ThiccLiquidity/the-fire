// The transaction lifecycle for the live Forge, one step at a time: check the network -> simulate (so a call that
// would revert never reaches the wallet, and the reason is shown in plain English) -> confirm in the wallet -> wait
// for the receipt. A sent transaction is kept in localStorage until it lands, so a reload picks it back up
// (resumePending). Nothing here runs in the demo.

import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { explain } from "./errors";
import { assertRobinhood } from "./network";
import { getAccount, getPublicClient, getWalletClient, robinhood, txUrl } from "./wallet";

export type TxStep = "check" | "simulate" | "confirm" | "pending" | "done";
/** For a stepper: what the user sees at each step. */
export const STEP_LABEL: Record<TxStep, string> = {
  check: "Checking your wallet",
  simulate: "Checking it will go through",
  confirm: "Confirm in your wallet",
  pending: "Waiting for the network",
  done: "Done",
};

export type TxCall = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
export type PendingTx = {
  hash: Hex;
  /** What it was, for people: "Buy 3 packs", "Approve 1,250 USDG". */
  label: string;
  /** "approve" or anything the page wants to group by ("buy", "open", "grade"...). */
  kind: string;
  chainId: number;
  from: Address;
  /** When it was sent (ms). */
  at: number;
};
export type TxOptions = {
  label: string;
  kind?: string;
  onStep?: (step: TxStep, hash?: Hex) => void;
  /** How long to wait for the receipt before handing back a TxStillPending (default 3 minutes). */
  waitMs?: number;
};

/** A failed step, with a plain-English reason. `hash` is set once it was sent. */
export class TxError extends Error {
  step: TxStep; hash?: Hex;
  constructor(message: string, step: TxStep, cause?: unknown, hash?: Hex) {
    super(message, { cause }); this.name = "TxError"; this.step = step; this.hash = hash;
  }
}
/** Sent but not landed yet: it stays saved, and `later` settles when it lands (true = success). */
export class TxStillPending extends Error {
  tx: PendingTx; later: Promise<boolean>;
  constructor(tx: PendingTx, later: Promise<boolean>) {
    super(`Still waiting: ${tx.label}. It's saved, so you can reload safely.`); this.name = "TxStillPending"; this.tx = tx; this.later = later;
  }
  get url() { return txUrl(this.tx.hash); }
}

// ---------- pending transactions, kept across reloads

const KEY = "forge.pendingTx.v1";
const MAX_AGE = 7 * 86_400_000; // forget anything older than a week (it landed or was dropped long ago)

function load(): PendingTx[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((t) => t && typeof t.hash === "string" && Date.now() - t.at < MAX_AGE) : [];
  } catch { return []; }
}
function save(list: PendingTx[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: it just won't survive a reload */ }
}
const remember = (t: PendingTx) => save([...load().filter((x) => x.hash !== t.hash), t]);
const forget = (hash: Hex) => save(load().filter((x) => x.hash !== hash));

/** Transactions sent from this browser that haven't landed yet (this chain only; optionally one wallet). */
export function pendingTxs(from?: Address): PendingTx[] {
  return load().filter((t) => t.chainId === robinhood.id && (!from || t.from.toLowerCase() === from.toLowerCase()));
}

/** Wait for a hash, following a speed-up (same transaction, new hash) and saving the new hash. ok is false when it
 *  reverted, or was cancelled or replaced by another transaction in the wallet. */
async function settle(t: PendingTx, timeout?: number): Promise<{ receipt: TransactionReceipt; ok: boolean }> {
  let cur = t, other = false;
  const r = await getPublicClient().waitForTransactionReceipt({
    hash: t.hash, timeout,
    onReplaced: (rep) => {
      forget(cur.hash);
      // a speed-up keeps going under the new hash; a cancel (or another transaction in its place) ends it here
      if (rep.reason === "repriced") { cur = { ...cur, hash: rep.transaction.hash }; remember(cur); } else other = true;
    },
  });
  forget(cur.hash); forget(t.hash);
  return { receipt: r, ok: !other && r.status === "success" };
}

/** After a reload: wait on every saved transaction; onSettled reports each as it lands. Returns how many there were. */
export function resumePending(onSettled: (tx: PendingTx, ok: boolean) => void, from?: Address): number {
  const list = pendingTxs(from);
  for (const t of list) {
    settle(t).then((r) => onSettled(t, r.ok), () => { /* dropped or unreachable: try again on the next load */ });
  }
  return list.length;
}

// ---------- the lifecycle

/** Simulate, send and wait for one contract call. Resolves with the receipt of a successful transaction; throws a
 *  TxError with a plain reason (or TxStillPending if it hasn't landed within waitMs). */
export async function sendTx(call: TxCall, opts: TxOptions): Promise<TransactionReceipt> {
  const step = (s: TxStep, hash?: Hex) => opts.onStep?.(s, hash);
  step("check");
  const account = getAccount();
  try { assertRobinhood(account); } catch (e) { throw new TxError((e as Error).message, "check", e); }
  const from = account.address!;

  step("simulate");
  const pub = getPublicClient();
  let request: unknown;
  try {
    ({ request } = await pub.simulateContract({ ...call, account: from } as Parameters<typeof pub.simulateContract>[0]));
  } catch (e) { throw new TxError(explain(e), "simulate", e); }

  step("confirm");
  let hash: Hex;
  try {
    const wallet = await getWalletClient();
    hash = await wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
  } catch (e) { throw new TxError(explain(e), "confirm", e); }

  const tx: PendingTx = { hash, label: opts.label, kind: opts.kind ?? "tx", chainId: robinhood.id, from, at: Date.now() };
  remember(tx);
  step("pending", hash);
  let res: { receipt: TransactionReceipt; ok: boolean };
  try { res = await settle(tx, opts.waitMs ?? 180_000); }
  catch (e) {
    if ((e as Error)?.name === "WaitForTransactionReceiptTimeoutError") {
      throw new TxStillPending(tx, settle(tx).then((r) => r.ok, () => false));
    }
    forget(hash);
    throw new TxError(explain(e), "pending", e, hash);
  }
  if (!res.ok) {
    const why = res.receipt.status === "success" ? "was cancelled or replaced in your wallet" : "failed on the network. Only the network fee was spent";
    throw new TxError(`${opts.label} ${why}.`, "pending", undefined, hash);
  }
  step("done", hash);
  return res.receipt;
}
