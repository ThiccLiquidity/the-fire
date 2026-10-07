// Exact-amount approvals: before paying in an ERC-20 (PLANK, USDG, PAPER), the spender is approved for exactly what
// this payment needs, never "unlimited". If the allowance already covers it, nothing is sent.

import { erc20Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { sendTx, type TxStep } from "./tx";
import { getPublicClient } from "./wallet";

export type ApproveOptions = {
  token: Address;
  /** The contract that will take the payment (FireSale, FirePsa...). */
  spender: Address;
  owner: Address;
  /** Exactly what the next call will take, in the token's raw units. */
  amount: bigint;
  /** For people: "Approve 1,250,000 PLANK". */
  label: string;
  onStep?: (step: TxStep, hash?: Hex) => void;
};

/** The current allowance (raw units). */
export function allowanceOf(token: Address, owner: Address, spender: Address): Promise<bigint> {
  return getPublicClient().readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

/** Approve exactly `amount` unless the allowance already covers it. Returns the receipt, or null when nothing was
 *  needed. Some tokens refuse to change a non-zero allowance straight to another: then it's set to 0 first. */
export async function approveExact(o: ApproveOptions): Promise<TransactionReceipt | null> {
  if (o.amount <= 0n) return null;
  const current = await allowanceOf(o.token, o.owner, o.spender);
  if (current >= o.amount) return null;
  const approve = (amount: bigint, label: string) =>
    sendTx({ address: o.token, abi: erc20Abi, functionName: "approve", args: [o.spender, amount] }, { label, kind: "approve", onStep: o.onStep });
  try {
    return await approve(o.amount, o.label);
  } catch (e) {
    if (current === 0n || (e as { step?: string })?.step !== "simulate") throw e;
    await approve(0n, "Reset the approval");
    return approve(o.amount, o.label);
  }
}
