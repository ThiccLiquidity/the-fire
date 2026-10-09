// The transaction lifecycle for the live Forge, one step at a time: check the network -> simulate (so a call that
// would revert never reaches the wallet, and the reason is shown in plain English) -> confirm in the wallet -> wait
// for the receipt. A sent transaction is kept in localStorage until it lands, so a reload picks it back up
// (resumePending). This is the only waiting path: everything that sends goes through sendTx. Nothing here runs in
// the demo.
//
// How a saved transaction ends:
//   success   its receipt (or its speed-up's) succeeded
//   reverted  its receipt says it failed on chain: the only "failed"
//   replaced  cancelled or replaced in the wallet: another transaction used its nonce, and it never landed
// Anything else (the RPC timing out or erroring) leaves it pending and saved: it may still land.

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

export type TxOutcome = "success" | "reverted" | "replaced";

export type TxCall = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
export type PendingTx = {
  /** The current hash: after a speed-up, the new one. */
  hash: Hex;
  /** What it was, for people: "Buy 3 packs", "Approve 1,250 USDG". */
  label: string;
  /** "approve" or anything the page wants to group by ("buy", "open", "grade"...). */
  kind: string;
  chainId: number;
  from: Address;
  /** The account nonce it was sent with. Once the account's nonce is past it and there's no receipt for it, it was
   *  replaced. Undefined only while it couldn't be read yet (it's read again on resume). */
  nonce?: number;
  /** When it was sent (ms). */
  at: number;
};
export type TxOptions = {
  label: string;
  kind?: string;
  /** "pending" comes again with the new hash after a speed-up. */
  onStep?: (step: TxStep, hash?: Hex) => void;
  /** How long to wait for the receipt before handing back a TxStillPending (default 3 minutes). */
  waitMs?: number;
};

/** A failed step, with a plain-English reason. `hash` is set once it was sent. */
export class TxError extends Error {
  step: TxStep; hash?: Hex; outcome?: TxOutcome;
  constructor(message: string, step: TxStep, cause?: unknown, hash?: Hex, outcome?: TxOutcome) {
    super(message, { cause }); this.name = "TxError"; this.step = step; this.hash = hash; this.outcome = outcome;
  }
}
/** Sent but not landed yet (the wait timed out, or the RPC didn't answer): it stays saved, and `later` settles with
 *  its outcome when it lands. `tx` is always the current transaction, so after a speed-up it has the new hash. */
export class TxStillPending extends Error {
  private ref: Tracked; later: Promise<TxOutcome>;
  constructor(ref: Tracked, later: Promise<TxOutcome>) {
    super(`Still waiting: ${ref.tx.label}. It's saved, so you can reload safely.`); this.name = "TxStillPending"; this.ref = ref; this.later = later;
  }
  get tx(): PendingTx { return this.ref.tx; }
  get url() { return txUrl(this.ref.tx.hash); }
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
const forget = (...hashes: Hex[]) => save(load().filter((x) => !hashes.includes(x.hash)));

/** Transactions sent from this browser that haven't landed yet (this chain only; optionally one wallet). */
export function pendingTxs(from?: Address): PendingTx[] {
  return load().filter((t) => t.chainId === robinhood.id && (!from || t.from.toLowerCase() === from.toLowerCase()));
}

// ---------- following one transaction

/** One saved transaction being followed: `tx` moves to the new hash on a speed-up (saved, and onHash told). */
type Tracked = { tx: PendingTx; hashes: Hex[]; onHash?: (hash: Hex) => void };
const track = (tx: PendingTx, onHash?: (hash: Hex) => void): Tracked => ({ tx, hashes: [tx.hash], onHash });
function moveTo(ref: Tracked, hash: Hex) {
  if (hash === ref.tx.hash) return;
  forget(ref.tx.hash);
  ref.tx = { ...ref.tx, hash }; ref.hashes.push(hash); remember(ref.tx);
  ref.onHash?.(hash);
}
function end(ref: Tracked, outcome: TxOutcome): TxOutcome { forget(...ref.hashes); return outcome; }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Its nonce, read from the chain if it wasn't saved (and saved now). */
async function nonceOf(ref: Tracked): Promise<number | undefined> {
  if (ref.tx.nonce !== undefined) return ref.tx.nonce;
  try {
    const t = await getPublicClient().getTransaction({ hash: ref.tx.hash });
    ref.tx = { ...ref.tx, nonce: t.nonce }; remember(ref.tx);
  } catch { /* not seen by this RPC (yet) */ }
  return ref.tx.nonce;
}

/** One look, no waiting: landed (its outcome), replaced (the account's nonce is past it with no receipt), or still
 *  pending (undefined). RPC errors throw: the caller keeps it pending. */
async function check(ref: Tracked): Promise<TxOutcome | undefined> {
  const pub = getPublicClient();
  const receipt = () => pub.getTransactionReceipt({ hash: ref.tx.hash }).catch((e) => {
    if ((e as Error)?.name === "TransactionReceiptNotFoundError") return undefined;
    throw e;
  });
  let r = await receipt();
  if (r) return r.status === "success" ? "success" : "reverted";
  const nonce = await nonceOf(ref);
  if (nonce === undefined) return undefined;
  const next = await pub.getTransactionCount({ address: ref.tx.from, blockTag: "latest" });
  if (next <= nonce) return undefined;
  r = await receipt(); // it may have landed between the two reads
  return r ? (r.status === "success" ? "success" : "reverted") : "replaced";
}

/** Wait for the receipt, following a speed-up (same transaction, new hash). Throws on timeout or an RPC error: the
 *  transaction stays saved and pending. */
async function settle(ref: Tracked, timeout?: number): Promise<{ outcome: TxOutcome; receipt?: TransactionReceipt }> {
  const now = await check(ref);
  if (now) return { outcome: end(ref, now) };
  let replaced = false;
  const r = await getPublicClient().waitForTransactionReceipt({
    hash: ref.tx.hash, timeout,
    onReplaced: (rep) => {
      // a speed-up keeps going under the new hash; a cancel (or another transaction in its place) ends it
      if (rep.reason === "repriced") moveTo(ref, rep.transaction.hash); else replaced = true;
    },
  });
  if (!replaced) moveTo(ref, r.transactionHash);
  return { outcome: end(ref, replaced ? "replaced" : r.status === "success" ? "success" : "reverted"), receipt: r };
}

/** Keep following it until it lands (or is replaced), however long the RPC takes; errors just mean "try again". */
async function follow(ref: Tracked): Promise<TxOutcome> {
  for (let i = 0; ; i++) {
    try { return (await settle(ref, 10 * 60_000)).outcome; }
    catch { await wait(Math.min(60_000, 5_000 * 2 ** Math.min(i, 4))); }
  }
}

/** After a reload: follow every saved transaction; onSettled reports each as it ends (`tx` has its final hash).
 *  Returns how many there were. */
export function resumePending(onSettled: (tx: PendingTx, outcome: TxOutcome) => void, from?: Address): number {
  const list = pendingTxs(from);
  for (const t of list) {
    const ref = track(t);
    follow(ref).then((outcome) => onSettled(ref.tx, outcome));
  }
  return list.length;
}

// ---------- the lifecycle

/** Simulate, send and wait for one contract call. Resolves with the receipt of a successful transaction; throws a
 *  TxError with a plain reason (reverted, replaced, or a step before sending), or TxStillPending if it hasn't landed
 *  within waitMs or the RPC couldn't say. */
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

  const ref = track({ hash, label: opts.label, kind: opts.kind ?? "tx", chainId: robinhood.id, from, at: Date.now() }, (h) => step("pending", h));
  remember(ref.tx);
  step("pending", hash);
  void nonceOf(ref); // saved with the transaction, so a reload can tell "replaced" from "still pending"
  let res: Awaited<ReturnType<typeof settle>>;
  try { res = await settle(ref, opts.waitMs ?? 180_000); }
  catch { throw new TxStillPending(ref, follow(ref)); } // a timeout or an RPC error: it may still land
  if (res.outcome === "replaced") throw new TxError(`${opts.label} was cancelled or replaced in your wallet.`, "pending", undefined, ref.tx.hash, "replaced");
  if (res.outcome === "reverted") throw new TxError(`${opts.label} failed on the network. Only the network fee was spent.`, "pending", undefined, ref.tx.hash, "reverted");
  step("done", ref.tx.hash);
  return res.receipt ?? await pub.getTransactionReceipt({ hash: ref.tx.hash });
}
