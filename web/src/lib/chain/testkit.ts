// The testnet's test kit (DevKit, contracts/script/dev/DevContracts.sol): one transaction hands a tester test PAPER,
// PLANK and USDG (once a day) and a Paper Press (once per wallet). It exists only on the testnet (DevStack refuses
// mainnet), so on any other network testKitOn() is false and the site shows nothing for it.

import { parseAbi, type Address, type TransactionReceipt } from "viem";
import { NET } from "../net";
import { sendTx } from "../tx";
import { pub } from "./contracts";
import type { WriteOpts } from "./writes";

const kitAbi = parseAbi([
  "function claim()",
  "function nextClaim(address who) view returns (uint256)",
  "function hasPress(address who) view returns (bool)",
]);
const kit = (): Address | null => (NET.testnet && NET.deployment.inputs?.TESTKIT ? (NET.deployment.inputs.TESTKIT as Address) : null);

/** Is there a test kit on this network (the testnet, once deployed with it)? */
export const testKitOn = (): boolean => !!kit();

/** When `who` can claim again (0 = now; unix seconds) and whether it already got its Paper Press. */
export async function testKitState(who: Address): Promise<{ next: number; hasPress: boolean }> {
  const a = kit(); if (!a) return { next: 0, hasPress: false };
  const [next, hasPress] = await Promise.all([
    pub().readContract({ address: a, abi: kitAbi, functionName: "nextClaim", args: [who] }),
    pub().readContract({ address: a, abi: kitAbi, functionName: "hasPress", args: [who] }),
  ]);
  return { next: Number(next), hasPress };
}

/** Claim the test kit: 25 test PAPER, about $1,000 of test PLANK, $50 test USDG, and a Paper Press the first time. */
export async function claimTestKit(o: WriteOpts = {}): Promise<TransactionReceipt> {
  const a = kit(); if (!a) throw new Error("There's no test kit on this network.");
  const label = "Get the test kit";
  return sendTx({ address: a, abi: kitAbi, functionName: "claim", args: [] }, { label, kind: "testkit", onStep: (s, h) => o.onStep?.(s, label, h) });
}
