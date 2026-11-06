// The transaction lifecycle for the live Forge, one step at a time: check the network -> simulate (so a call that
// would revert never reaches the wallet, and the reason is shown in plain English) -> confirm in the wallet -> wait
// for the receipt. A sent transaction is kept in localStorage until it lands, so a reload picks it back up
// (resumePending). This is the only waiting path: everything that sends goes through sendTx. Nothing here runs in
// the demo.
//
// How a saved transaction ends:
//   success   its receipt (or its speed-up's) succeeded
//   reverted  its receipt says it failed on chain: the only "failed"
//   replaced     cancelled or replaced in the wallet: another transaction used its nonce, and it never landed
//   unsupported  the wallet's "hash" was never a transaction (a smart-contract wallet such as Safe hands back its own
//                id): nothing on chain knows it a minute later and the account has code
// Anything else (the RPC timing out or erroring) leaves it pending and saved: it may still land.

import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { explain, revertOf } from "./errors";
import { checkCall } from "./guard";
import { NET } from "./net";
import { assertRobinhood } from "./network";
import { getAccount, getPublicClient, getWalletClient, isNoFunds, robinhood, txUrl } from "./wallet";

export type TxStep = "check" | "simulate" | "confirm" | "pending" | "done";
/** For a stepper: what the user sees at each step. */
export const STEP_LABEL: Record<TxStep, string> = {
  check: "Checking…",
  simulate: "Checking…",
  confirm: "Confirm in your wallet",
  pending: "Pending",
  done: "Done",
};

export type TxOutcome = "success" | "reverted" | "replaced" | "unsupported";

/** What a smart-contract wallet is told (the sale, the test kit and the regular-wallets window refuse contracts). */
export const CONTRACT_WALLET = NET.testnet
  ? "Smart-contract wallets (like Safe) don't work on the testnet yet. Use a regular wallet."
  : "Smart-contract wallets (like Safe) don't work here yet. Use a regular wallet.";
/** No ETH at all: the network fee can't be paid (said before the wallet opens, not the wallet's own error). */
export const NO_ETH = NET.testnet
  ? "You need a little ETH for the network fee. Get free test ETH from the faucet (Testnet sheet, step 1)."
  : "You need a little ETH for the network fee.";

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

/** A failed step, with a plain-English reason. `hash` is set once it was sent. `code`: the contract error's name when
 *  the call was refused by one (e.g. "PriceMoved"), so the page can handle a known case its own way. */
export class TxError extends Error {
  step: TxStep; hash?: Hex; outcome?: TxOutcome; code?: string;
  constructor(message: string, step: TxStep, cause?: unknown, hash?: Hex, outcome?: TxOutcome) {
    super(message, { cause }); this.name = "TxError"; this.step = step; this.hash = hash; this.outcome = outcome;
    this.code = cause === undefined ? undefined : revertOf(cause)?.name;
  }
}
/** Sent but not landed yet (the wait timed out, or the RPC didn't answer): it stays saved, and `later` settles with
 *  its outcome when it lands. `tx` is always the current transaction, so after a speed-up it has the new hash. */
export class TxStillPending extends Error {
  private ref: Tracked; later: Promise<TxOutcome>;
  constructor(ref: Tracked, later: Promise<TxOutcome>) {
    super(`${ref.tx.label} is pending. Safe to reload.`); this.name = "TxStillPending"; this.ref = ref; this.later = later;
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

// ---------- "sending" markers: the wallet is open, no hash yet
// On a phone, confirming means leaving the browser for the wallet app, and the tab may be reloaded meanwhile: the
// transaction can go out without the page ever learning its hash. So a marker is saved before the wallet opens and
// replaced by the real entry when the hash comes back (dropped if the wallet says no). After a reload a marker under
// SENDING_AGE old means "it may still be on its way" (live.js stillSending waits); it's dropped once the account's
// nonce is past the one it was saved with (it, or something in its place, landed).

/** A send the wallet was asked for, with no hash yet. `nonce`: the account's pending nonce just before. */
export type SendingTx = { kind: string; label: string; chainId: number; from: Address; at: number; nonce?: number };
const SENDING_KEY = "forge.sendingTx.v1";
const SENDING_AGE = 10 * 60_000;
function loadSending(): SendingTx[] {
  try {
    const list = JSON.parse(localStorage.getItem(SENDING_KEY) || "[]");
    return Array.isArray(list) ? list.filter((t) => t && typeof t.from === "string" && typeof t.at === "number" && Date.now() - t.at < SENDING_AGE) : [];
  } catch { return []; }
}
function saveSending(list: SendingTx[]) {
  try { localStorage.setItem(SENDING_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}
const sameSend = (a: SendingTx, b: SendingTx) => a.at === b.at && a.from.toLowerCase() === b.from.toLowerCase() && a.label === b.label;
const unmark = (m: SendingTx) => saveSending(loadSending().filter((x) => !sameSend(x, m)));

/** Sends the wallet was asked for in the last 10 minutes whose hash never came back (this chain; optionally one
 *  wallet): they may still be on their way. */
export function sendingTxs(from?: Address): SendingTx[] {
  return loadSending().filter((t) => t.chainId === robinhood.id && (!from || t.from.toLowerCase() === from.toLowerCase()));
}
/** Read-only: drop the markers (of `from`) whose account nonce has moved past theirs. Resolves how many are left. */
export async function pruneSending(from?: Address): Promise<number> {
  const list = sendingTxs(from);
  if (!list.length) return 0;
  const pub = getPublicClient(), nonces = new Map<string, number>();
  let left = 0;
  for (const m of list) {
    if (m.nonce === undefined) { left++; continue; }
    const k = m.from.toLowerCase();
    try {
      if (!nonces.has(k)) nonces.set(k, await pub.getTransactionCount({ address: m.from, blockTag: "latest" }));
      if (nonces.get(k)! > m.nonce) unmark(m); else left++;
    } catch { left++; }
  }
  return left;
}

/** Transactions sent from this browser that haven't landed yet (this chain only; optionally one wallet). */
export function pendingTxs(from?: Address): PendingTx[] {
  return load().filter((t) => t.chainId === robinhood.id && (!from || t.from.toLowerCase() === from.toLowerCase()));
}

// ---------- following one transaction

/** One saved transaction being followed: `tx` moves to the new hash on a speed-up (saved, and onHash told). `ended`:
 *  it landed (or was replaced) and was forgotten; nothing may save it again. */
type Tracked = { tx: PendingTx; hashes: Hex[]; onHash?: (hash: Hex) => void; ended?: boolean };
const track = (tx: PendingTx, onHash?: (hash: Hex) => void): Tracked => ({ tx, hashes: [tx.hash], onHash });
function moveTo(ref: Tracked, hash: Hex) {
  if (hash === ref.tx.hash) return;
  forget(ref.tx.hash);
  ref.tx = { ...ref.tx, hash }; ref.hashes.push(hash); remember(ref.tx);
  ref.onHash?.(hash);
}
function end(ref: Tracked, outcome: TxOutcome): TxOutcome { ref.ended = true; forget(...ref.hashes); return outcome; }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Its nonce, read from the chain if it wasn't saved (and saved now). */
async function nonceOf(ref: Tracked): Promise<number | undefined> {
  if (ref.tx.nonce !== undefined) return ref.tx.nonce;
  try {
    const t = await getPublicClient().getTransaction({ hash: ref.tx.hash });
    ref.tx = { ...ref.tx, nonce: t.nonce };
    if (!ref.ended) remember(ref.tx); // it may have landed (and been forgotten) while this read was out
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

/** Code at an address that isn't an EIP-7702 delegation (0xef0100 + address): a smart-contract wallet. */
export const isContractCode = (code: string | undefined | null): boolean => !!code && code !== "0x" && !/^0xef0100[0-9a-f]{40}$/i.test(code);
/** Is `who` a smart-contract wallet (code that isn't a 7702 delegation)? Null when the RPC couldn't say. */
export async function isContractWallet(who: Address): Promise<boolean | null> {
  try { return isContractCode(await getPublicClient().getCode({ address: who })); } catch { return null; }
}

const NOT_A_TX_AFTER = 60_000;
/** The wallet's "hash" isn't a transaction: a minute after it was sent no node knows it (no nonce could be read) and
 *  the account is a smart-contract wallet (a Safe hands back its own safeTxHash). A regular wallet's transaction that
 *  this RPC hasn't seen yet is never this: it keeps being followed. */
async function notATx(ref: Tracked): Promise<boolean> {
  if (Date.now() - ref.tx.at < NOT_A_TX_AFTER) return false;
  if ((await nonceOf(ref)) !== undefined) return false;
  return (await isContractWallet(ref.tx.from)) === true;
}
/** `done` resolves once notATx is true (looked at from a minute after sending, then every 20 s while no nonce is known
 *  and the account may be a contract); it never resolves otherwise. `stop` ends the watch. */
function watchNotATx(ref: Tracked): { done: Promise<void>; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const done = new Promise<void>((ok) => {
    const look = async () => {
      if (stopped || ref.ended) return;
      if (await notATx(ref).catch(() => false)) return ok();
      // a known nonce: a real transaction. An account without code (a regular wallet): never this case.
      if (stopped || ref.ended || ref.tx.nonce !== undefined || (await isContractWallet(ref.tx.from)) === false) return;
      timer = setTimeout(look, 20_000);
    };
    timer = setTimeout(look, Math.max(0, ref.tx.at + NOT_A_TX_AFTER - Date.now()));
  });
  return { done, stop: () => { stopped = true; clearTimeout(timer); } };
}

/** Keep following it until it lands (or is replaced), however long the RPC takes; errors just mean "try again". A
 *  "hash" that was never a transaction (notATx) ends as "unsupported". */
async function follow(ref: Tracked): Promise<TxOutcome> {
  for (let i = 0; ; i++) {
    if (await notATx(ref).catch(() => false)) return end(ref, "unsupported");
    // while it's under a minute old, wait only until notATx can tell
    const young = Date.now() - ref.tx.at < NOT_A_TX_AFTER && ref.tx.nonce === undefined;
    try { return (await settle(ref, young ? NOT_A_TX_AFTER + 5_000 : 10 * 60_000)).outcome; }
    catch { await wait(Math.min(60_000, 5_000 * 2 ** Math.min(i, 4))); }
  }
}

/** After a reload: follow every saved transaction (of `from`; only those `only` picks, e.g. the ones the page isn't
 *  following yet); onSettled reports each as it ends (`tx` has its final hash, `at` stays the same). Returns how many
 *  there were. */
export function resumePending(onSettled: (tx: PendingTx, outcome: TxOutcome) => void, from?: Address, only?: (tx: PendingTx) => boolean): number {
  const list = pendingTxs(from).filter((t) => !only || only(t));
  for (const t of list) {
    const ref = track(t);
    follow(ref).then((outcome) => onSettled(ref.tx, outcome));
  }
  return list.length;
}

/** Read-only, no wallet needed: one look at each saved transaction (of `from`); the ones that landed or were replaced
 *  are forgotten. Resolves with how many are still on their way (an RPC that can't answer keeps them). */
export async function prunePending(from?: Address): Promise<number> {
  let left = 0;
  for (const t of pendingTxs(from)) {
    const ref = track(t);
    try { const outcome = await check(ref); if (outcome) end(ref, outcome); else left++; } catch { left++; }
  }
  return left;
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
  // the wallet gate (guard.ts): nothing the site doesn't do ever reaches the wallet
  try { checkCall(call, from, NET.deployment); } catch (e) { throw new TxError((e as Error).message, "check", e); }

  step("simulate");
  const pub = getPublicClient();
  // no ETH at all: say so (and where to get it) before anything else, not the wallet's own "insufficient funds"
  if ((await pub.getBalance({ address: from }).catch(() => undefined)) === 0n) throw new TxError(NO_ETH, "simulate");
  // not enough ETH: for the price itself (the value sent, its 3% cap included), or only for the network fee on top
  const why = async (e: unknown) => {
    if (!isNoFunds(e) || !call.value) return explain(e);
    const bal = await pub.getBalance({ address: from }).catch(() => undefined);
    return bal !== undefined && bal < call.value ? "Not enough ETH for the price." : "Not enough ETH for the network fee.";
  };
  let request: unknown;
  let gas: bigint;
  try {
    ({ request } = await pub.simulateContract({ ...call, account: from } as Parameters<typeof pub.simulateContract>[0]));
    // sent with a 25% margin over the estimate (the same for a browser wallet and the local signer), so a little state
    // change between the estimate and the block doesn't run it out of gas
    gas = (await pub.estimateContractGas({ ...call, account: from } as Parameters<typeof pub.estimateContractGas>[0])) * 125n / 100n;
  } catch (e) { throw new TxError(await why(e), "simulate", e); }

  step("confirm");
  // saved before the wallet opens (see "sending" markers): a reload while the wallet app confirms still knows
  const kind = opts.kind ?? "tx";
  const marker: SendingTx = { kind, label: opts.label, chainId: robinhood.id, from, at: Date.now(),
    nonce: await pub.getTransactionCount({ address: from, blockTag: "pending" }).catch(() => undefined) };
  saveSending([...loadSending(), marker]);
  let hash: Hex;
  try {
    const wallet = await getWalletClient();
    hash = await wallet.writeContract({ ...(request as object), gas } as Parameters<typeof wallet.writeContract>[0]);
  } catch (e) { unmark(marker); throw new TxError(await why(e), "confirm", e); }

  const ref = track({ hash, label: opts.label, kind, chainId: robinhood.id, from, at: Date.now() }, (h) => step("pending", h));
  remember(ref.tx); unmark(marker); // the real entry first, then the marker goes: never a moment with neither
  step("pending", hash);
  void nonceOf(ref); // saved with the transaction, so a reload can tell "replaced" from "still pending"
  let res: Awaited<ReturnType<typeof settle>> | "unsupported";
  const settling = settle(ref, opts.waitMs ?? 180_000);
  settling.catch(() => {}); // if the backstop below wins, this may still time out later, with nobody waiting on it
  // backstop: a smart-contract wallet's "hash" (a Safe's own id) is never a transaction: say so instead of "pending"
  const backstop = watchNotATx(ref);
  try { res = await Promise.race([settling, backstop.done.then(() => "unsupported" as const)]); }
  catch { throw new TxStillPending(ref, follow(ref)); } // a timeout or an RPC error: it may still land (follow checks too)
  finally { backstop.stop(); }
  if (res === "unsupported") { end(ref, "unsupported"); throw new TxError(CONTRACT_WALLET, "pending", undefined, ref.tx.hash, "unsupported"); }
  if (res.outcome === "replaced") throw new TxError(`${opts.label} was cancelled in your wallet.`, "pending", undefined, ref.tx.hash, "replaced");
  if (res.outcome === "reverted") throw new TxError(`${opts.label} failed. Only the network fee was spent.`, "pending", undefined, ref.tx.hash, "reverted");
  step("done", ref.tx.hash);
  return res.receipt ?? await pub.getTransactionReceipt({ hash: ref.tx.hash });
}
