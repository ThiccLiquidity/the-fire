// Capped approvals: before a call that takes an ERC-20 (PAPER for every pack and suggestion, PLANK or USDG for a paid
// pack, the case and grade fee), the spender is approved for the most that call may take: its own cap (maxCost,
// maxPaper), never the quote and never "unlimited". Approving the quote would make a price move inside the cap fail
// with an allowance error; the cap is what the contract checks against. If the allowance already covers it, nothing
// is sent.

import { erc20Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { sendTx, type TxStep } from "./tx";
import { getPublicClient } from "./wallet";

export type ApproveOptions = {
  token: Address;
  /** The contract that will take the payment (FireSale, FirePsa...). */
  spender: Address;
  owner: Address;
  /** The most the next call may take, in the token's raw units: the same maxCost / maxPaper passed to that call. */
  max: bigint;
  /** For people: "Approve 1,250,000 PLANK". */
  label: string;
  onStep?: (step: TxStep, hash?: Hex) => void;
};

/** The current allowance (raw units). */
export function allowanceOf(token: Address, owner: Address, spender: Address): Promise<bigint> {
  return getPublicClient().readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

/** Approve the call's cap (`max`) unless the allowance already covers it. Returns the receipt, or null when nothing
 *  was needed. Some tokens refuse to change a non-zero allowance straight to another: then it's set to 0 first. */
export async function approveMax(o: ApproveOptions): Promise<TransactionReceipt | null> {
  if (o.max <= 0n) return null;
  const current = await allowanceOf(o.token, o.owner, o.spender);
  if (current >= o.max) return null;
  const approve = (amount: bigint, label: string) =>
    sendTx({ address: o.token, abi: erc20Abi, functionName: "approve", args: [o.spender, amount] }, { label, kind: "approve", onStep: o.onStep });
  try {
    return await approve(o.max, o.label);
  } catch (e) {
    if (current === 0n || (e as { step?: string })?.step !== "simulate") throw e;
    await approve(0n, "Reset the approval");
    return approve(o.max, o.label);
  }
}
