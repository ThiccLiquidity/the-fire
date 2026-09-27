// Live implementation of FireApi against Fire.sol via viem. Selected when VITE_FIRE_ADDRESS is set.
// Reads poll every 8s; writes go through the injected wallet (MetaMask etc.).

import {
  createPublicClient, createWalletClient, custom, http, formatUnits, parseAbi, type Abi, type Address, type Hex, defineChain,
} from "viem";
import fireAbi from "./fireAbi.json";
import profilesAbi from "./profilesAbi.json";
import { type Buy, type FireApi, type FireState, type PastFire, DAILY_CAP, FULL_DAYS, nextRollTime, stormBase, titleFor } from "./types";

const PROFILES = import.meta.env.VITE_PROFILES_ADDRESS as Address | undefined;
export const MILL: Address = "0x8DaA534c13C8b6164D73163F521fE3c94889dFC9";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const erc721 = parseAbi(["function tokenURI(uint256) view returns (string)", "function ownerOf(uint256) view returns (address)"]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

type EthereumProvider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global { interface Window { ethereum?: EthereumProvider } }

export function makeChainApi(fireAddress: Address): FireApi {
  const pub = createPublicClient({ chain: robinhood, transport: http() });
  const abi = fireAbi as unknown as Abi;
  let account: Address | undefined;
  let paperAddr: Address | undefined, plankAddr: Address | undefined;
  let s: FireState = empty();
  const subs = new Set<(s: FireState) => void>();
  const emit = () => subs.forEach((f) => f(s));
  const lifetime = new Map<string, number>();
  let lastBlock = 0n, lastProfileBlock = 0n;

  async function wallet() {
    if (!window.ethereum) throw new Error("No wallet found. Install MetaMask.");
    const wc = createWalletClient({ chain: robinhood, transport: custom(window.ethereum) });
    const [addr] = await wc.requestAddresses();
    account = addr;
    try { await wc.switchChain({ id: robinhood.id }); } catch { await wc.addChain({ chain: robinhood }); }
    return wc;
  }

  async function readAll() {
    const r = (fn: string, args: unknown[] = []) => pub.readContract({ address: fireAddress, abi, functionName: fn, args }) as Promise<bigint>;
    const [fireId, night, pot, ticketsToday, ticketsTotal, fireSize, trailingAvg, nextRollAt, plankPerTicket, millBid, millFund, dayIndex] = await Promise.all([
      r("fireId"), r("night"), r("pot"), r("ticketsToday"), r("ticketsTotal"), r("fireSize"), r("trailingAverage"), r("nextRollAt"), r("plankPerTicket"), r("millBid"), r("millFund"), r("dayIndex"),
    ]);
    if (!paperAddr) { paperAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "PAPER" })) as Address; plankAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "PLANK" })) as Address; }
    let ethPerTicket = 0n; try { ethPerTicket = await r("ethPerTicket"); } catch { /* stale feed */ }
    let you = s.you;
    if (account) {
      const [paper, plank, eth, mine, bought] = await Promise.all([
        pub.readContract({ address: paperAddr!, abi: erc20, functionName: "balanceOf", args: [account] }),
        pub.readContract({ address: plankAddr!, abi: erc20, functionName: "balanceOf", args: [account] }),
        pub.getBalance({ address: account }),
        pub.readContract({ address: fireAddress, abi, functionName: "ticketsOf", args: [fireId, account] }) as Promise<bigint>,
        pub.readContract({ address: fireAddress, abi, functionName: "boughtOnDay", args: [dayIndex, account] }) as Promise<bigint>,
      ]);
      you = { address: account, tickets: Number(mine), paper: Number(formatUnits(paper, 18)), plank: Number(formatUnits(plank, 18)), eth: Number(formatUnits(eth, 18)), remainingToday: DAILY_CAP - Number(bought), isWinner: s.you.isWinner, profile: s.profiles[account.toLowerCase()] };
    }
    const trailing = Number(trailingAvg) || 1;
    const n = Number(night);
    s = {
      ...s, fireId: Number(fireId), night: n, potPlank: Number(formatUnits(pot, 18)), plankPerTicket: Number(formatUnits(plankPerTicket, 18)),
      ethUsd: ethPerTicket > 0n ? 1 / Number(formatUnits(ethPerTicket, 18)) : s.ethUsd,
      ticketsToday: Number(ticketsToday), ticketsTotal: Number(ticketsTotal), fireSize: Number(fireSize), trailingAvg: trailing,
      threat: Math.max(0.1, Math.min(1, stormBase(n + 1, trailing) / (trailing * 2))),
      nextRollAt: Number(nextRollAt) * 1000 || nextRollTime(), millBidEth: Number(formatUnits(millBid, 18)), millFundEth: Number(formatUnits(millFund, 18)), you,
    };
  }

  async function readEvents() {
    const head = await pub.getBlockNumber();
    const from = lastBlock ? lastBlock + 1n : (head > 50_000n ? head - 50_000n : 0n);
    if (from > head) return;
    const logs = await pub.getContractEvents({ address: fireAddress, abi, fromBlock: from, toBlock: head });
    lastBlock = head;
    const feed: Buy[] = [...s.feed]; const past: PastFire[] = [...s.past]; let storm = s.storm;
    let burnedPaper = s.burnedPaperAllTime, burnedPlank = s.burnedPlankAllTime, mills = s.millsEaten;
    for (const l of logs) {
      const a = (l as unknown as { args: Record<string, unknown>; eventName: string; blockNumber: bigint; transactionHash: Hex }).args;
      const ev = (l as unknown as { eventName: string }).eventName;
      const at = Date.now(); // block timestamps would need another call; fine for a feed
      if (ev === "TicketsBought") {
        const who = String(a.buyer), n = Number(a.tickets), withEth = Boolean(a.withEth);
        const life = (lifetime.get(who) ?? 0) + n; lifetime.set(who, life);
        feed.unshift({ id: feed.length + 1, who, tickets: n, withEth, note: String(a.note ?? ""), title: titleFor(life, withEth), at });
        if (!withEth) burnedPaper += n;
        burnedPlank += n * s.plankPerTicket * 0.5;
      } else if (ev === "Survived") {
        const size = Number(a.fireSize), strength = Number(a.storm);
        storm = { at, fireId: Number(a.fireId), night: Number(a.night), strength, size, survived: true, intensity: Math.max(0.15, Math.min(1, strength / Math.max(1, s.trailingAvg * FULL_DAYS) * 2.5)), sizeAfter: Math.max(0, (size - strength) * 0.6) / (s.trailingAvg * FULL_DAYS) };
      } else if (ev === "WentOut") {
        const size = Number(a.fireSize), strength = Number(a.storm), winner = String(a.winner), paid = Number(formatUnits(a.paid as bigint, 18));
        storm = { at, fireId: Number(a.fireId), night: Number(a.night), strength, size, survived: false, intensity: 1, winner, paidPlank: paid, potPlank: paid / 0.38, tickets: s.ticketsTotal };
        past.unshift({ id: Number(a.fireId), nights: Number(a.night), potPlank: paid / 0.38, winner, peakSize: size });
        if (account && winner.toLowerCase() === account.toLowerCase()) s = { ...s, you: { ...s.you, isWinner: true } };
      } else if (ev === "MillEaten") { mills += 1; }
    }
    s = { ...s, feed: feed.slice(0, 40), past: past.slice(0, 10), storm, burnedPaperAllTime: burnedPaper, burnedPlankAllTime: burnedPlank, millsEaten: mills };
  }

  async function readProfiles() {
    if (!PROFILES) return;
    const head = await pub.getBlockNumber();
    const from = lastProfileBlock ? lastProfileBlock + 1n : 0n;
    if (from > head) return;
    const logs = await pub.getContractEvents({ address: PROFILES, abi: profilesAbi as unknown as Abi, eventName: "ProfileSet", fromBlock: from, toBlock: head });
    lastProfileBlock = head;
    if (!logs.length) return;
    const profiles = { ...s.profiles };
    for (const l of logs) { const a = (l as unknown as { args: Record<string, unknown> }).args; profiles[String(a.who).toLowerCase()] = { name: String(a.name ?? ""), pfp: String(a.pfp ?? "") }; }
    s = { ...s, profiles };
  }

  async function refresh() { try { await readAll(); await readEvents(); await readProfiles(); emit(); } catch (e) { console.warn("refresh failed", e); } }
  void refresh(); setInterval(refresh, 8000);

  async function ensureAllowance(wc: ReturnType<typeof createWalletClient>, token: Address, amount: bigint) {
    const cur = (await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account!, fireAddress] })) as bigint;
    if (cur < amount) { const h = await wc.writeContract({ address: token, abi: erc20, functionName: "approve", args: [fireAddress, amount * 10n], account: account!, chain: robinhood }); await pub.waitForTransactionReceipt({ hash: h }); }
  }

  return {
    state: () => s,
    subscribe(fn) { subs.add(fn); fn(s); return () => subs.delete(fn); },
    async setProfile(name, pfp) {
      if (!PROFILES) throw new Error("Profiles aren't live yet.");
      const wc = await wallet();
      const pabi = profilesAbi as unknown as Abi;
      const m = /^mill:(\d+)$/.exec(pfp);
      const h = m
        ? await wc.writeContract({ address: PROFILES, abi: pabi, functionName: "setWithMill", args: [name, BigInt(m[1])], account: account!, chain: robinhood })
        : await wc.writeContract({ address: PROFILES, abi: pabi, functionName: "set", args: [name, pfp], account: account!, chain: robinhood });
      await pub.waitForTransactionReceipt({ hash: h }); await refresh();
    },
    async buy(n, withEth, note) {
      const wc = await wallet();
      const [paperCost, plankCost, ethCost] = (await pub.readContract({ address: fireAddress, abi, functionName: "quote", args: [BigInt(n)] })) as [bigint, bigint, bigint];
      await ensureAllowance(wc, plankAddr!, plankCost);
      let h: Hex;
      if (withEth) h = await wc.writeContract({ address: fireAddress, abi, functionName: "buyTicketsWithEth", args: [BigInt(n), note], value: ethCost, account: account!, chain: robinhood });
      else { await ensureAllowance(wc, paperAddr!, paperCost); h = await wc.writeContract({ address: fireAddress, abi, functionName: "buyTickets", args: [BigInt(n), note], account: account!, chain: robinhood }); }
      await pub.waitForTransactionReceipt({ hash: h }); await refresh();
    },
  };
}

function empty(): FireState {
  return { fireId: 0, night: 0, potPlank: 0, plankUsd: 1.06e-9, ethUsd: 3333, plankPerTicket: 852_000_000, ticketsToday: 0, ticketsTotal: 0, fireSize: 0, trailingAvg: 1, threat: 0.2, nextRollAt: nextRollTime(),
    you: { tickets: 0, paper: 0, plank: 0, eth: 0, remainingToday: DAILY_CAP, isWinner: false }, profiles: {}, burnedPaperAllTime: 0, burnedPlankAllTime: 0, millsEaten: 0, millFundEth: 0, millBidEth: 0, feed: [], past: [] };
}

/** Resolve "mill:<id>" to an image URL by reading the mill's tokenURI (data: JSON, ipfs:// or https://). Cached. */
const millImg = new Map<string, Promise<string>>();
export function millImage(tokenId: string): Promise<string> {
  let p = millImg.get(tokenId);
  if (!p) {
    p = (async () => {
      const pub = createPublicClient({ chain: robinhood, transport: http() });
      let uri = await pub.readContract({ address: MILL, abi: erc721, functionName: "tokenURI", args: [BigInt(tokenId)] });
      uri = ipfs(uri);
      let meta: { image?: string };
      if (uri.startsWith("data:application/json;base64,")) meta = JSON.parse(atob(uri.slice(29)));
      else if (uri.startsWith("data:application/json,")) meta = JSON.parse(decodeURIComponent(uri.slice(22)));
      else meta = await (await fetch(uri)).json();
      return ipfs(meta.image ?? "");
    })().catch(() => "");
    millImg.set(tokenId, p);
  }
  return p;
}
function ipfs(u: string) { return u.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + u.slice(7) : u; }
