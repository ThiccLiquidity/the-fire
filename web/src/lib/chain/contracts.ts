// The card contracts on the chosen network (net.ts), their ABIs, and the shared plumbing the reads and writes use:
// amounts for people, log scans from the deploy block, and the bytecode check for features an older deploy lacks.

import { erc20Abi, formatUnits, getAddress, toFunctionSelector, type Abi, type AbiEvent, type Address, type Log } from "viem";
import { burnerAbi, cardsAbi, creditsAbi, dealerAbi, packsAbi, psaAbi, rendererAbi, saleAbi } from "../cards";
import { NET } from "../net";
import type { ContractName } from "../config";
import { getPublicClient } from "../wallet";

export { burnerAbi, cardsAbi, creditsAbi, dealerAbi, packsAbi, psaAbi, rendererAbi, saleAbi };

/** Thrown by everything here when the network has no card contracts (mainnet before the deploy). */
export class NotDeployedError extends Error {
  constructor(what: string) { super(`${what} isn't deployed on ${NET.label} yet.`); this.name = "NotDeployedError"; }
}

/** A deployed contract's address on this network. */
export function addr(name: ContractName): Address {
  const a = NET.deployment.contracts?.[name];
  if (!a) throw new NotDeployedError(name);
  return getAddress(a);
}

/** A token or other input the contracts were deployed with (PAPER, PLANK, USDG, WETH, MILL = the Paper Press). */
export function input(name: "PAPER" | "PLANK" | "USDG" | "WETH" | "MILL"): Address | undefined {
  const a = NET.deployment.inputs?.[name];
  return a ? getAddress(a) : undefined;
}

export const pub = () => getPublicClient();

/** A token amount: raw units as a decimal string (safe in JSON and plain JS), and the same for people. */
export type Amount = { raw: string; text: string };
export function amount(raw: bigint, decimals = 18, digits = 4): Amount {
  const [i, f = ""] = formatUnits(raw, decimals).split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  return { raw: raw.toString(), text: BigInt(i).toLocaleString("en-US") + (frac ? "." + frac : "") };
}

const decimalsCache = new Map<string, Promise<number>>();
/** An ERC-20's decimals (cached). */
export function decimalsOf(token: Address): Promise<number> {
  let p = decimalsCache.get(token);
  if (!p) {
    p = pub().readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).then(Number).catch(() => 18);
    decimalsCache.set(token, p);
  }
  return p;
}

/** One call on a card contract, typed loosely (the ABIs are JSON): the caller says what comes back. */
export async function read<T>(name: ContractName, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await pub().readContract({ address: addr(name), abi, functionName, args })) as T;
}

/** An event from one of the ABIs, by name. */
export function eventOf(abi: Abi, name: string): AbiEvent {
  const e = abi.find((x) => x.type === "event" && x.name === name);
  if (!e) throw new Error(`No event ${name} in the ABI`);
  return e as AbiEvent;
}

/** The first block worth scanning: the deploy's (deployments file), else 0. */
export const startBlock = (): bigint => BigInt(NET.deployment.startBlock ?? 0);

/** Logs of one event from one contract since the deploy, newest block last. Scans in chunks and shrinks a chunk when
 *  the RPC refuses a range as too big. `args` filters on indexed arguments. */
export async function scanLogs(address: Address, event: AbiEvent, args?: Record<string, unknown>, from = startBlock()): Promise<Log[]> {
  const client = pub();
  const latest = await client.getBlockNumber({ cacheTime: 0 }); // not the 4-second cache: a scan right after a send must see it
  const out: Log[] = [];
  let span = 50_000n;
  for (let b = from; b <= latest;) {
    const to = b + span - 1n > latest ? latest : b + span - 1n;
    try {
      out.push(...(await client.getLogs({ address, event, args, fromBlock: b, toBlock: to } as Parameters<typeof client.getLogs>[0])));
      b = to + 1n;
    } catch (e) {
      if (span <= 500n) throw e;
      span /= 4n; // "range too large" or a slow node: smaller pieces
    }
  }
  return out;
}

/** Decoded event arguments (viem puts them on the log when an event was given). */
export const argsOf = <T>(l: Log): T => (l as unknown as { args: T }).args;

const codeCache = new Map<string, Promise<string>>();
/** Does the deployed contract have this function? (its selector appears in the bytecode's dispatcher) For features an
 *  older deploy lacks, e.g. FireCredits.suggestMany on the first testnet deploy. */
export async function hasFunction(name: ContractName, signature: string): Promise<boolean> {
  const a = addr(name);
  let p = codeCache.get(a);
  if (!p) { p = pub().getCode({ address: a }).then((c) => (c ?? "").toLowerCase()); codeCache.set(a, p); }
  const sel = toFunctionSelector(signature).slice(2).toLowerCase();
  return (await p).includes(`63${sel}`); // PUSH4 <selector> in the dispatcher
}

/** Seconds since the epoch, by the chain's clock (the latest block). */
export async function chainNow(): Promise<number> {
  return Number((await pub().getBlock()).timestamp);
}
