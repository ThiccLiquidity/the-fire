// The card contracts on the chosen network (net.ts), their ABIs, and the shared plumbing the reads and writes use:
// amounts for people, log scans from the deploy block (incremental, cached per tab), and the bytecode check for
// features an older deploy lacks.

import { erc20Abi, formatUnits, getAddress, toFunctionSelector, type Abi, type AbiEvent, type Address, type Log } from "viem";
import { burnerAbi, cardsAbi, creditsAbi, dealerAbi, groupsAbi, packsAbi, psaAbi, rendererAbi, saleAbi } from "../cards";
import { NET } from "../net";
import type { ContractName } from "../config";
import { getPublicClient } from "../wallet";

export { burnerAbi, cardsAbi, creditsAbi, dealerAbi, groupsAbi, packsAbi, psaAbi, rendererAbi, saleAbi };

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

let groupsAt: Promise<Address> | null = null;
/** FireGroups: from the deployments file, else the one FireSale names (FireSale.GROUPS, fixed at its deploy). */
export function groupsAddr(): Promise<Address> {
  const a = NET.deployment.contracts?.FireGroups;
  if (a) return Promise.resolve(getAddress(a));
  return (groupsAt ??= pub().readContract({ address: addr("FireSale"), abi: saleAbi, functionName: "GROUPS" })
    .then((x) => getAddress(x as Address)).catch((e) => { groupsAt = null; throw e; }));
}

/** One call on FireGroups (see groupsAddr). */
export async function readGroups<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await pub().readContract({ address: await groupsAddr(), abi: groupsAbi, functionName, args })) as T;
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

/** The latest block, fresh (not viem's 4-second cache: a scan right after a send must see it). Calls made while one is
 *  out share it. */
let latestOut: Promise<bigint> | null = null;
function latestBlock(): Promise<bigint> {
  return (latestOut ??= pub().getBlockNumber({ cacheTime: 0 }).finally(() => { latestOut = null; }));
}

let span = 50_000n; // blocks per getLogs; shrinks (and stays shrunk) when the RPC refuses a range as too big
async function getRange(address: Address, event: AbiEvent, args: Record<string, unknown> | undefined, from: bigint, to: bigint): Promise<Log[]> {
  const client = pub(), out: Log[] = [];
  for (let b = from; b <= to;) {
    const end = b + span - 1n > to ? to : b + span - 1n;
    try {
      out.push(...(await client.getLogs({ address, event, args, fromBlock: b, toBlock: end } as Parameters<typeof client.getLogs>[0])));
      b = end + 1n;
    } catch (e) {
      if (span <= 500n) throw e;
      span /= 4n; // "range too large" or a slow node: smaller pieces
    }
  }
  return out;
}

/** Scans already done, per contract + event + filter: the logs up to `to`, kept for the tab's life. Blocks newer than
 *  TAIL below the head are read again every time (never cached), so a reorg near the head can't leave a stale log. */
type Scan = { to: bigint; logs: Log[]; queue: Promise<unknown> };
const scans = new Map<string, Scan>();
const TAIL = 64n;
const keyOf = (address: Address, event: AbiEvent, args: Record<string, unknown> | undefined, from: bigint) =>
  JSON.stringify([address, event.name, event.inputs.map((i) => i.type), from.toString(), args ?? null], (_, v) => (typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.toLowerCase() : v));

/** Logs of one event from one contract since the deploy (or `from`), newest block last. `args` filters on indexed
 *  arguments. Incremental: a scan already done in this tab is only extended from the last block it covered, so a sync
 *  every few seconds costs one getLogs over the new blocks, not the whole history again. */
export async function scanLogs(address: Address, event: AbiEvent, args?: Record<string, unknown>, from = startBlock()): Promise<Log[]> {
  const key = keyOf(address, event, args, from);
  let s = scans.get(key);
  if (!s) scans.set(key, (s = { to: from - 1n, logs: [], queue: Promise.resolve() }));
  const scan = s;
  const run = scan.queue.then(async () => { // one at a time per scan, so two syncs can't both append the same blocks
    const latest = await latestBlock();
    const settled = latest - TAIL;
    if (settled > scan.to) {
      const got = await getRange(address, event, args, scan.to + 1n, settled);
      scan.logs.push(...got); scan.to = settled;
    }
    const tail = scan.to < latest ? await getRange(address, event, args, scan.to + 1n, latest) : [];
    return [...scan.logs, ...tail];
  });
  scan.queue = run.catch(() => {});
  return run;
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
