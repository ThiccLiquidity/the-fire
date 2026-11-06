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
  "function packsFor(address who) view returns (uint256)",
  "function gotPacks(address who) view returns (bool)",
  "function packsLeft() view returns (uint256)",
  "function packFire() view returns (uint256)",
  "function packsFirst() view returns (uint256)",
  "function packsDaily() view returns (uint256)",
]);
const kit = (): Address | null => (NET.testnet && NET.deployment.inputs?.TESTKIT ? (NET.deployment.inputs.TESTKIT as Address) : null);

/** Is there a test kit on this network (the testnet, once deployed with it)? */
export const testKitOn = (): boolean => !!kit();

/** When `who` can claim again (0 = now; unix seconds), whether it already got its Paper Press, and the kit's sealed
 *  packs: how many its claim now brings (`packs`), whether it had its first ones, how many are left, which Series, and
 *  how many a first claim and each later day bring (`packsFirst`, `packsDaily`). */
export async function testKitState(who: Address): Promise<{ next: number; hasPress: boolean; packs: number; gotPacks: boolean; packsLeft: number; packsFirst: number; packsDaily: number; packFire: number }> {
  const a = kit(); if (!a) return { next: 0, hasPress: false, packs: 0, gotPacks: false, packsLeft: 0, packsFirst: 0, packsDaily: 0, packFire: 0 };
  const r = (functionName: "nextClaim" | "hasPress" | "packsFor" | "gotPacks", args: [Address]) => pub().readContract({ address: a, abi: kitAbi, functionName, args } as never) as Promise<unknown>;
  const r0 = (functionName: "packsLeft" | "packFire" | "packsFirst" | "packsDaily") => pub().readContract({ address: a, abi: kitAbi, functionName }) as Promise<bigint>;
  // a kit deployed before packs (no packsFor) reads as one with none
  const [next, hasPress, packs, gotPacks, left, fire, first, daily] = await Promise.all([
    r("nextClaim", [who]), r("hasPress", [who]), r("packsFor", [who]).catch(() => 0n), r("gotPacks", [who]).catch(() => false),
    r0("packsLeft").catch(() => 0n), r0("packFire").catch(() => 0n), r0("packsFirst").catch(() => 0n), r0("packsDaily").catch(() => 0n),
  ]);
  return { next: Number(next), hasPress: hasPress as boolean, packs: Number(packs), gotPacks: gotPacks as boolean, packsLeft: Number(left), packsFirst: Number(first), packsDaily: Number(daily), packFire: Number(fire) };
}

/** Claim the test kit: 25 test PAPER, about $1,000 of test PLANK, $50 test USDG, a Paper Press the first time, and the
 *  kit's sealed packs (a few the first time, then one a day) while they last. */
export async function claimTestKit(o: WriteOpts = {}): Promise<TransactionReceipt> {
  const a = kit(); if (!a) throw new Error("There's no test kit on this network.");
  const label = "Get the test kit";
  return sendTx({ address: a, abi: kitAbi, functionName: "claim", args: [] }, { label, kind: "testkit", onStep: (s, h) => o.onStep?.(s, label, h) });
}
