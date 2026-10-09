// Sending transactions safely from a keeper that may run as two instances (the main keeper and the backup, each a
// Railway service with its own wallet).
//
// - Every call is checked first, against the PENDING state (so a transaction another keeper already sent counts):
//   `precheck` (is the work still there?), then a simulation. If the contract says no, or the call would do nothing
//   (`accept`), it is skipped quietly. Every keeper call is permissionless and idempotent on-chain, so a race costs at
//   most one wasted transaction's gas, never a double result.
// - The backup (`yieldMs`) waits a moment before each send and checks again, and stands down while the main keeper's
//   wallet (`mainKeeper`) has a transaction waiting, so the main keeper wins a tie.
// - One transaction in flight per job. reconcile() runs at the start of every pass: a receipt means done; a transaction
//   that was dropped or is stuck is re-sent at the SAME nonce with a higher fee (the original call if it would still
//   succeed, else a 0-ETH transfer to ourselves to fill the nonce), so nothing is done twice and later transactions
//   aren't stuck behind a gap.
// - fillNonceGaps() at start-up: transactions a previous run left waiting (it crashed, or a one-pass run ended before
//   they were mined) are replaced by 0-ETH transfers to ourselves at a higher fee, so new work isn't stuck behind them.
// - Nonce errors (another instance used our nonce) reset the nonce manager; the job is retried next pass.

export const errMsg = (e) => e?.shortMessage ?? String(e?.message ?? e).split("\n")[0]; // never the full error: it can carry the RPC URL

const notFound = (e) => e?.name === "TransactionNotFoundError" || e?.name === "TransactionReceiptNotFoundError";
const nonceTrouble = (e) => /nonce|replacement transaction underpriced|already known/i.test(errMsg(e));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSender({
  pub, wallet, account, log, maxFeeGwei, receiptTimeoutMs = 90_000, stuckMs = 10 * 60_000, dropGraceMs = 60_000,
  yieldMs = 0, mainKeeper, blockTag = "pending",
}) {
  const inflight = new Map();
  const MAX_FEE = maxFeeGwei ? BigInt(Math.round(maxFeeGwei * 1e9)) : undefined;
  const nonceKey = () => ({ address: account.address, chainId: wallet.chain.id });
  const resetNonce = () => account.nonceManager?.reset(nonceKey());
  let lock = Promise.resolve();
  const serial = (fn) => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };
  let sentThisPass = [];

  async function fees(prev) {
    const est = await pub.estimateFeesPerGas().catch(async () => ({ maxFeePerGas: await pub.getGasPrice(), maxPriorityFeePerGas: 0n }));
    let prio = est.maxPriorityFeePerGas ?? 0n;
    let max = est.maxFeePerGas ?? 0n;
    if (prev) {
      const bump = (x) => (x * 5n) / 4n + 1n;
      if (bump(prev.maxPriorityFeePerGas) > prio) prio = bump(prev.maxPriorityFeePerGas);
      if (bump(prev.maxFeePerGas) > max) max = bump(prev.maxFeePerGas);
    }
    if (max < prio) max = prio;
    if (MAX_FEE && max > MAX_FEE) {
      if (prev) return undefined; // can't outbid the stuck one under the cap
      max = MAX_FEE;
      if (prio > max) prio = max;
    }
    return { maxFeePerGas: max, maxPriorityFeePerGas: prio };
  }

  const write = (c, nonce, fee, gas) =>
    wallet.writeContract({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args, value: c.value, nonce, gas, ...fee });

  /** The work is still there and the call would do something: { ok, sim, reason }. */
  async function check(call, precheck, accept) {
    if (precheck) {
      let still;
      try { still = await precheck(blockTag); } catch (e) { return { ok: false, reason: `precheck: ${errMsg(e)}` }; }
      if (!still) return { ok: false, reason: "already done" };
    }
    let sim;
    try { sim = await pub.simulateContract({ account, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, value: call.value, blockTag }); }
    catch (e) { return { ok: false, reason: errMsg(e) }; }
    if (accept && !accept(sim.result)) return { ok: false, reason: "nothing to do", sim };
    return { ok: true, sim };
  }

  /** The main keeper has a transaction waiting to be mined (it is alive and on it). */
  async function mainBusy() {
    if (!mainKeeper) return false;
    const [p, l] = await Promise.all([
      pub.getTransactionCount({ address: mainKeeper, blockTag: "pending" }),
      pub.getTransactionCount({ address: mainKeeper, blockTag: "latest" }),
    ]);
    return p > l;
  }

  /**
   * Check, then send `call` ({ address, abi, functionName, args, value }) and wait for its receipt.
   * Returns { status: "done" | "reverted" | "skipped" | "waiting", result, hash, reason }.
   * `precheck(blockTag)` says whether the work is still there (e.g. a checkpoint still due); `accept(result)` may veto
   * the send after simulating (e.g. a flush that would burn nothing).
   */
  async function send(call, { job, accept, precheck } = {}) {
    const key = job ?? `${call.address}:${call.functionName}`;
    const prev = inflight.get(key);
    if (prev) { log(`${call.functionName}: still waiting on ${prev.hashes.at(-1)} (nonce ${prev.nonce})`); return { status: "waiting" }; }
    let c = await check(call, precheck, accept);
    if (!c.ok) return { status: "skipped", reason: c.reason, result: c.sim?.result };
    if (yieldMs > 0) {
      // the backup: give the main keeper a moment, then look again
      await sleep(yieldMs);
      try { if (await mainBusy()) { log(`${call.functionName}: left to the main keeper (it has a transaction waiting)`); return { status: "skipped", reason: "the main keeper has a transaction waiting" }; } }
      catch (e) { return { status: "skipped", reason: errMsg(e) }; }
      c = await check(call, precheck, accept);
      if (!c.ok) { log(`${call.functionName}: left to the main keeper (${c.reason})`); return { status: "skipped", reason: c.reason, result: c.sim?.result }; }
    }
    const sim = c.sim;
    let gas;
    try { gas = ((await pub.estimateContractGas({ account, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, value: call.value, blockTag })) * 13n) / 10n; }
    catch (e) { return { status: "skipped", reason: errMsg(e) }; }
    let entry;
    try {
      entry = await serial(async () => {
        const fee = await fees();
        const nonce = account.nonceManager
          ? await account.nonceManager.consume({ ...nonceKey(), client: pub })
          : await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
        let hash;
        try { hash = await write(call, nonce, fee, gas); }
        catch (e) { resetNonce(); throw e; } // the nonce wasn't used: re-read it next time
        const t = Date.now();
        const en = { ...call, precheck, accept, gas, hashes: [hash], cancels: new Set(), nonce, fee, firstSentAt: t, sentAt: t };
        inflight.set(key, en);
        return en;
      });
    } catch (e) {
      if (nonceTrouble(e)) log(`${call.functionName}: nonce clash (another keeper on this key?); retrying next pass`);
      else log(`${call.functionName}: send failed: ${errMsg(e)}`);
      return { status: "skipped", reason: errMsg(e) };
    }
    const hash = entry.hashes[0];
    sentThisPass.push(`${call.functionName} ${hash}`);
    const r = await pub.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs }).catch(() => undefined);
    if (!r) { log(`${call.functionName}: sent ${hash} (nonce ${entry.nonce}), no receipt yet`); return { status: "waiting", hash }; }
    inflight.delete(key);
    log(`${call.functionName} ${r.status} ${hash}`);
    return { status: r.status === "success" ? "done" : "reverted", hash, result: sim.result };
  }

  async function receiptOf(hashes) {
    for (const hash of hashes) {
      try { return await pub.getTransactionReceipt({ hash }); } catch (e) { if (!notFound(e)) throw e; }
    }
    return undefined;
  }
  async function knownAny(hashes) {
    for (const hash of hashes) {
      try { await pub.getTransaction({ hash }); return true; } catch (e) { if (!notFound(e)) throw e; }
    }
    return false;
  }

  /** Settle, re-send or cancel whatever is still in flight from earlier passes. */
  async function reconcile() {
    sentThisPass = [];
    for (const [job, e] of inflight) {
      const last = e.hashes.at(-1);
      try {
        const r = await receiptOf(e.hashes);
        if (r) {
          inflight.delete(job);
          log(e.cancels.has(r.transactionHash) ? `${e.functionName}: nonce ${e.nonce} filled by cancel ${r.transactionHash}` : `${e.functionName} ${r.status} ${r.transactionHash} (late receipt)`);
          continue;
        }
        const age = Date.now() - e.sentAt;
        const known = await knownAny(e.hashes);
        if (known ? age < stuckMs : age < dropGraceMs) continue;
        const why = known ? `stuck ${Math.round(age / 60_000)} min` : "dropped";
        const used = await pub.getTransactionCount({ address: account.address, blockTag: "latest" });
        if (used > e.nonce) {
          const r2 = await receiptOf(e.hashes);
          inflight.delete(job);
          resetNonce();
          log(r2 ? `${e.functionName} ${r2.status} ${r2.transactionHash} (late receipt)` : `${e.functionName}: ${why}; nonce ${e.nonce} was used by another transaction; will re-send if still needed`);
          continue;
        }
        const fee = await fees(e.fee);
        if (!fee) { log(`${e.functionName}: ${why} tx ${last} needs a fee above MAX_FEE_GWEI to replace; still waiting`); continue; }
        let still = !e.cancelOnly;
        // against the mined state: the pending one includes this very transaction
        if (still && e.precheck) {
          try { still = !!(await e.precheck("latest")); } catch { still = false; }
        }
        if (still) {
          try {
            const sim = await pub.simulateContract({ account, address: e.address, abi: e.abi, functionName: e.functionName, args: e.args, value: e.value, blockTag: "latest" });
            if (e.accept && !e.accept(sim.result)) still = false;
          } catch { still = false; }
        }
        const hash = await serial(() => (still ? write(e, e.nonce, fee, e.gas) : wallet.sendTransaction({ to: account.address, value: 0n, nonce: e.nonce, ...fee })));
        e.hashes.push(hash);
        e.fee = fee;
        e.sentAt = Date.now();
        if (!still) e.cancels.add(hash);
        log(`${e.functionName}: ${why} tx ${last}; ${still ? "re-sent" : "no longer needed, cancelled"} at nonce ${e.nonce} as ${hash}`);
      } catch (err) { log(`${e.functionName}: couldn't check/replace ${last}: ${errMsg(err)}`); }
    }
  }

  /**
   * Start-up: transactions from an earlier run still waiting (pending nonce above the mined one) are replaced by 0-ETH
   * transfers to ourselves at twice today's fee (more if refused), and tracked like any in-flight transaction.
   * Returns how many nonces it filled.
   */
  async function fillNonceGaps() {
    const [pending, latest] = await Promise.all([
      pub.getTransactionCount({ address: account.address, blockTag: "pending" }),
      pub.getTransactionCount({ address: account.address, blockTag: "latest" }),
    ]);
    let filled = 0;
    for (let nonce = latest; nonce < pending; nonce++) {
      if ([...inflight.values()].some((e) => e.nonce === nonce)) continue;
      const base = await fees();
      let fee = { maxFeePerGas: base.maxFeePerGas * 2n, maxPriorityFeePerGas: base.maxPriorityFeePerGas * 2n + 1n };
      let hash;
      for (let i = 0; i < 4 && !hash; i++) {
        if (MAX_FEE && fee.maxFeePerGas > MAX_FEE) fee = { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: fee.maxPriorityFeePerGas > MAX_FEE ? MAX_FEE : fee.maxPriorityFeePerGas };
        try { hash = await serial(() => wallet.sendTransaction({ to: account.address, value: 0n, nonce, ...fee })); }
        catch (e) {
          if (!/underpriced|too low|replacement/i.test(errMsg(e)) || (MAX_FEE && fee.maxFeePerGas >= MAX_FEE)) { log(`nonce ${nonce}: couldn't replace the waiting transaction: ${errMsg(e)}`); break; }
          fee = { maxFeePerGas: fee.maxFeePerGas * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas * 2n + 1n };
        }
      }
      if (!hash) continue;
      const t = Date.now();
      inflight.set(`nonce-gap:${nonce}`, { functionName: "nonce-gap fill", cancelOnly: true, address: account.address, hashes: [hash], cancels: new Set([hash]), nonce, fee, firstSentAt: t, sentAt: t });
      log(`nonce ${nonce}: a transaction from an earlier run was still waiting; replaced by a 0-ETH transfer ${hash}`);
      filled++;
    }
    if (filled) resetNonce();
    return filled;
  }

  return {
    send,
    reconcile,
    fillNonceGaps,
    inflight,
    /** Transactions sent since the last reconcile() (the start of this pass). */
    sent: () => sentThisPass,
  };
}
