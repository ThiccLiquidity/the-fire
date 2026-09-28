// Live implementation of FireApi against Fire.sol via viem. Selected when VITE_FIRE_ADDRESS is set.
// Reads poll every 8s; writes go through the injected wallet (MetaMask etc.).

import {
  createPublicClient, createWalletClient, custom, http, formatUnits, parseAbi, zeroAddress, type Abi, type Address, type Hex, defineChain,
} from "viem";
import fireAbi from "./fireAbi.json";
import profilesAbi from "./profilesAbi.json";
import { bytesToHex, hexToBytes } from "viem";
import { type Buy, type FireApi, type Pay, type FireState, type PastFire, DAILY_CAP, FULL_DAYS, nextRollTime, stormBase, titleFor } from "./types";

const PROFILES = import.meta.env.VITE_PROFILES_ADDRESS as Address | undefined;
const PROFILES_FROM = BigInt(import.meta.env.VITE_PROFILES_FROM_BLOCK || 0); // Profiles deploy block
const LOG_CHUNK = 50_000n;

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const adapterAbi = parseAbi(["function answered(uint256) view returns (bool)", "function settle(uint256)", "function ROUTER() view returns (address)"]);
const routerAbi = parseAbi([
  "function requests(uint256) view returns (address consumer, uint64 round, uint32 callbackGasLimit, bool fulfilled, bool delivered, uint256 randomWord, uint256 fee)",
  "function fulfill(uint256 id, bytes signature)",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);
// drand evmnet: the chain OpenDrandRouter verifies. Public relays; the router checks every signature on-chain.
const DRAND_CHAIN = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
const DRAND_GENESIS = 1727521075n, DRAND_PERIOD = 3n;
const DRAND_URLS = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh"];
async function drandSignature(round: bigint): Promise<Hex | undefined> {
  for (const base of DRAND_URLS) {
    try {
      const r = await fetch(`${base}/${DRAND_CHAIN}/public/${round}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const b = (await r.json()) as { round: number; signature: string };
      if (String(b.round) === String(round) && /^[0-9a-f]{128}$/i.test(b.signature)) return `0x${b.signature}`;
    } catch { /* next relay */ }
  }
  return undefined;
}

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

type EthereumProvider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (ev: string, fn: (arg: unknown) => void) => void };
declare global { interface Window { ethereum?: EthereumProvider } }

export function makeChainApi(fireAddress: Address): FireApi {
  const pub = createPublicClient({ chain: robinhood, transport: http(undefined, { batch: true }) });
  const abi = fireAbi as unknown as Abi;
  let account: Address | undefined;
  let paperAddr: Address | undefined, plankAddr: Address | undefined, adapterAddr: Address | undefined, usdgAddr: Address | undefined, usdgDec = 6;
  let pendingId = 0n, routerAddr: Address | undefined, plankFeedAddr: Address | undefined, paperFeedAddr: Address | undefined;
  let s: FireState = empty();
  const subs = new Set<(s: FireState) => void>();
  const emit = () => subs.forEach((f) => f(s));
  const lifetime = new Map<string, number>();
  let lastBlock = 0n, lastProfileBlock = 0n, feedId = 0;

  async function wallet() {
    if (!window.ethereum) throw new Error("No wallet found. Install MetaMask.");
    const wc = createWalletClient({ chain: robinhood, transport: custom(window.ethereum) });
    const [addr] = await wc.requestAddresses();
    account = addr;
    try { await wc.switchChain({ id: robinhood.id }); } catch { await wc.addChain({ chain: robinhood }); }
    return wc;
  }
  // follow the wallet: switching accounts in MetaMask re-reads as the new account; disconnecting there clears it
  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", (accs: unknown) => { const a = (accs as string[])[0]; account = a ? (a as Address) : undefined; if (!account) s = { ...s, you: { ...empty().you } }; void refresh(); });
    window.ethereum.on("chainChanged", () => void refresh());
  }
  // silently pick up an already-authorized account on load (no prompt)
  void (async () => { try { const accs = (await window.ethereum?.request({ method: "eth_accounts" })) as string[] | undefined; if (accs?.[0]) { account = accs[0] as Address; await refresh(); } } catch { /* no wallet */ } })();

  async function readAll() {
    const r = (fn: string, args: unknown[] = []) => pub.readContract({ address: fireAddress, abi, functionName: fn, args }) as Promise<bigint>;
    const [fireId, night, pot, ticketsToday, ticketsTotal, fireSize, trailingAvg, nextRollAt, plankPerTicket, millBid, millFund, dayIndex, pending, pendingSince, rerollAfter] = await Promise.all([
      r("fireId"), r("night"), r("pot"), r("ticketsToday"), r("ticketsTotal"), r("fireSize"), r("trailingAverage"), r("nextRollAt"), r("plankPerTicket"), r("millBid"), r("millFund"), r("dayIndex"),
      r("pendingRequest"), r("pendingSince"), r("REROLL_AFTER"),
    ]);
    if (!adapterAddr) {
      adapterAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "randomness" })) as Address;
      routerAddr = (await pub.readContract({ address: adapterAddr, abi: adapterAbi, functionName: "ROUTER" })) as Address;
      plankFeedAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "PLANK_USD" })) as Address;
      paperFeedAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "PAPER_USD" })) as Address;
    }
    // USD per PLANK from the Fire's own PLANK/USD feed (18 decimals). 0 = no price yet: the page shows "$—", never a guess.
    let plankUsd = 0;
    try { const [, px] = await pub.readContract({ address: plankFeedAddr!, abi: feedAbi, functionName: "latestRoundData" }); if (px > 0n) plankUsd = Number(formatUnits(px, 18)); } catch { /* feed unavailable */ }
    // PAPER: how much a ticket takes right now (1, or less once PAPER trades above $0.33), and its price if it has one.
    const paperPerTicket = Number(formatUnits(await r("paperPerTicket"), 18));
    let paperUsd = 0;
    try { const [, px] = await pub.readContract({ address: paperFeedAddr!, abi: feedAbi, functionName: "latestRoundData" }); if (px > 0n) paperUsd = Number(formatUnits(px, 18)); } catch { /* no PAPER market yet */ }
    pendingId = pending;
    const nowSec = (await pub.getBlock()).timestamp; // the contract judges time by the chain's clock
    let rollAction: FireState["rollAction"];
    if (pending === 0n) { if (nowSec >= nextRollAt) rollAction = "roll"; }
    else if (await pub.readContract({ address: adapterAddr, abi: adapterAbi, functionName: "answered", args: [pending] })) { if (nowSec >= pendingSince + 60n) rollAction = "settle"; }
    else {
      // Anyone may deliver drand's number once its round is out; re-roll only if it still isn't there after 30 min.
      const [, round] = await pub.readContract({ address: routerAddr!, abi: routerAbi, functionName: "requests", args: [pending] });
      if (nowSec >= DRAND_GENESIS + (round - 1n) * DRAND_PERIOD + 5n) rollAction = nowSec >= pendingSince + rerollAfter ? "reroll" : "deliver";
    }
    if (!paperAddr) {
      paperAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "PAPER" })) as Address;
      plankAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "PLANK" })) as Address;
      usdgAddr = (await pub.readContract({ address: fireAddress, abi, functionName: "USDG" })) as Address;
      if (usdgAddr === zeroAddress) usdgAddr = undefined;
      else usdgDec = Number(await pub.readContract({ address: usdgAddr, abi: erc20, functionName: "decimals" }));
    }
    const fundUsdg = usdgAddr ? await r("millFundUsdg") : 0n;
    let ethPerTicket = 0n; try { ethPerTicket = await r("ethPerTicket"); } catch { /* stale feed */ }
    let you = s.you;
    if (account) {
      const [paper, plank, eth, mine, bought, usdg] = await Promise.all([
        pub.readContract({ address: paperAddr!, abi: erc20, functionName: "balanceOf", args: [account] }),
        pub.readContract({ address: plankAddr!, abi: erc20, functionName: "balanceOf", args: [account] }),
        pub.getBalance({ address: account }),
        pub.readContract({ address: fireAddress, abi, functionName: "ticketsOf", args: [fireId, account] }) as Promise<bigint>,
        pub.readContract({ address: fireAddress, abi, functionName: "boughtOnDay", args: [dayIndex, account] }) as Promise<bigint>,
        usdgAddr ? pub.readContract({ address: usdgAddr, abi: erc20, functionName: "balanceOf", args: [account] }) : Promise.resolve(0n),
      ]);
      you = { address: account, tickets: Number(mine), paper: Number(formatUnits(paper, 18)), plank: Number(formatUnits(plank, 18)), eth: Number(formatUnits(eth, 18)), usdg: Number(formatUnits(usdg, usdgDec)), remainingToday: DAILY_CAP - Number(bought), isWinner: s.you.isWinner, profile: s.profiles[account.toLowerCase()] };
    }
    const trailing = Number(trailingAvg) || 1;
    const n = Number(night);
    s = {
      ...s, fireId: Number(fireId), night: n, potPlank: Number(formatUnits(pot, 18)), plankPerTicket: Number(formatUnits(plankPerTicket, 18)),
      ethUsd: ethPerTicket > 0n ? 1 / Number(formatUnits(ethPerTicket, 18)) : s.ethUsd,
      ticketsToday: Number(ticketsToday), ticketsTotal: Number(ticketsTotal), fireSize: Number(fireSize), trailingAvg: trailing,
      threat: Math.max(0.1, Math.min(1, stormBase(n + 1, trailing) / (trailing * 2))),
      nextRollAt: Number(nextRollAt) * 1000 || nextRollTime(), millBidUsd: Number(formatUnits(millBid, 8)), millFundEth: Number(formatUnits(millFund, 18)), millFundUsdg: Number(formatUnits(fundUsdg, usdgDec)), usdgEnabled: !!usdgAddr, you,
      rollPending: pending !== 0n, rollAction, plankUsd, paperPerTicket, paperUsd,
    };
  }

  async function readEvents() {
    const headBlock = await pub.getBlock();
    const head = headBlock.number;
    const from = lastBlock ? lastBlock + 1n : (head > 50_000n ? head - 50_000n : 0n);
    if (from > head) return;
    const logs = await pub.getContractEvents({ address: fireAddress, abi, fromBlock: from, toBlock: head });
    lastBlock = head;
    // When each event happened, by the chain's clock, mapped onto this browser's clock. Using "now" instead made
    // every page load replay the last storm as if it were happening live. Only the events the page animates need it.
    const named = logs as unknown as { eventName: string; blockNumber: bigint }[];
    const buys = named.filter((l) => l.eventName === "TicketsBought").slice(-8);
    const wanted = new Set(named.filter((l) => l.eventName === "Survived" || l.eventName === "WentOut").concat(buys).map((l) => l.blockNumber));
    const blockTime = new Map<bigint, bigint>();
    await Promise.all([...wanted].map(async (n) => { blockTime.set(n, (await pub.getBlock({ blockNumber: n })).timestamp); }));
    const nowMs = Date.now();
    const whenMs = (n: bigint) => { const t = blockTime.get(n); return t === undefined ? 0 : nowMs - Number(headBlock.timestamp - t) * 1000; };
    const feed: Buy[] = [...s.feed]; const past: PastFire[] = [...s.past]; let storm = s.storm;
    let burnedPaper = s.burnedPaperAllTime, burnedPlank = s.burnedPlankAllTime, mills = s.millsEaten;
    for (const l of logs) {
      const a = (l as unknown as { args: Record<string, unknown>; eventName: string; blockNumber: bigint; transactionHash: Hex }).args;
      const ev = (l as unknown as { eventName: string }).eventName;
      const at = whenMs((l as unknown as { blockNumber: bigint }).blockNumber);
      if (ev === "TicketsBought") {
        const who = String(a.buyer), n = Number(a.tickets), fromFire = Boolean(a.paperFromFire);
        const life = (lifetime.get(who) ?? 0) + n; lifetime.set(who, life);
        feed.unshift({ id: ++feedId, who, tickets: n, fromFire, note: String(a.note ?? ""), title: titleFor(life, fromFire), at });
        if (!fromFire) burnedPaper += n;
        burnedPlank += n * s.plankPerTicket * 0.5;
      } else if (ev === "Survived") {
        const size = Number(a.fireSize), strength = Number(a.storm);
        storm = { at, fireId: Number(a.fireId), night: Number(a.night), strength, size, survived: true, intensity: Math.max(0.15, Math.min(1, strength / Math.max(1, s.trailingAvg * FULL_DAYS) * 2.5)), sizeAfter: Math.max(0, (size - strength) * 0.6) / (s.trailingAvg * FULL_DAYS) };
      } else if (ev === "WentOut") {
        const size = Number(a.fireSize), strength = Number(a.storm), winner = String(a.winner), paid = Number(formatUnits(a.paid as bigint, 18));
        storm = { at, fireId: Number(a.fireId), night: Number(a.night), strength, size, survived: false, intensity: 1, winner, paidPlank: paid, potPlank: paid / 0.4, tickets: s.ticketsTotal };
        past.unshift({ id: Number(a.fireId), nights: Number(a.night), potPlank: paid / 0.4, winner, peakSize: size });
        if (account && winner.toLowerCase() === account.toLowerCase()) s = { ...s, you: { ...s.you, isWinner: true } };
      } else if (ev === "MillEaten") { mills += 1; }
    }
    s = { ...s, feed: feed.slice(0, 40), past: past.slice(0, 10), storm, burnedPaperAllTime: burnedPaper, burnedPlankAllTime: burnedPlank, millsEaten: mills };
  }

  async function readProfiles() {
    if (!PROFILES) return;
    const head = await pub.getBlockNumber();
    let from = lastProfileBlock ? lastProfileBlock + 1n : PROFILES_FROM;
    // RPCs cap eth_getLogs ranges, so walk the history in chunks; each chunk is applied as it lands.
    while (from <= head) {
      const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
      const logs = await pub.getContractEvents({ address: PROFILES, abi: profilesAbi as unknown as Abi, eventName: "ProfileSet", fromBlock: from, toBlock: to });
      if (logs.length) {
        const profiles = { ...s.profiles };
        for (const l of logs) { const a = (l as unknown as { args: Record<string, unknown> }).args; profiles[String(a.who).toLowerCase()] = { name: String(a.name ?? ""), pfp: imageUrl(String(a.image ?? "0x")) }; }
        s = { ...s, profiles };
      }
      lastProfileBlock = to; from = to + 1n;
    }
  }

  // Each step is independent: a failed log query must not hold back the live numbers.
  // One refresh at a time (a slow first profile scan must not stack up polls). A call made mid-refresh — e.g.
  // right after a buy lands — gets one more pass once the current one finishes, so it sees the new state.
  let running: Promise<void> | null = null, again = false;
  async function refresh(): Promise<void> {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        for (const step of [readAll, readEvents, readProfiles]) {
          try { await step(); } catch (e) { console.warn(`refresh: ${step.name} failed`, e); }
        }
        emit();
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }
  // Pick up an already-authorized wallet without a prompt, so returning players see their balances.
  void (async () => {
    try { const [a] = ((await window.ethereum?.request({ method: "eth_accounts" })) ?? []) as Address[]; if (a) account = a; } catch { /* no wallet */ }
    await refresh();
  })();
  setInterval(refresh, 8000);

  async function ensureAllowance(wc: ReturnType<typeof createWalletClient>, token: Address, amount: bigint) {
    const cur = (await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account!, fireAddress] })) as bigint;
    if (cur < amount) { const h = await wc.writeContract({ address: token, abi: erc20, functionName: "approve", args: [fireAddress, amount * 10n], account: account!, chain: robinhood }); await pub.waitForTransactionReceipt({ hash: h }); }
  }

  return {
    state: () => s,
    async connect() { await wallet(); await refresh(); },
    async switchWallet() {
      if (!window.ethereum) throw new Error("No wallet found.");
      // asks MetaMask to show the account picker again; the accountsChanged listener does the rest
      await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      await wallet(); await refresh();
    },
    disconnect() { account = undefined; s = { ...s, you: { ...empty().you } }; emit(); },
    async rollStorm() {
      const wc = await wallet();
      const a = s.rollAction;
      if (!a) return;
      let h: Hex;
      if (a === "settle") h = await wc.writeContract({ address: adapterAddr!, abi: adapterAbi, functionName: "settle", args: [pendingId], account: account!, chain: robinhood });
      else if (a === "deliver" || a === "reroll") {
        // A number from drand always beats a re-roll: try it first.
        const [, round] = await pub.readContract({ address: routerAddr!, abi: routerAbi, functionName: "requests", args: [pendingId] });
        const sig = await drandSignature(round);
        if (sig) h = await wc.writeContract({ address: routerAddr!, abi: routerAbi, functionName: "fulfill", args: [pendingId, sig], account: account!, chain: robinhood });
        else if (a === "reroll") h = await wc.writeContract({ address: fireAddress, abi, functionName: "reroll", args: [], account: account!, chain: robinhood });
        else throw new Error("Couldn't reach drand for tonight's number. Try again in a moment.");
      } else h = await wc.writeContract({ address: fireAddress, abi, functionName: "roll", args: [], account: account!, chain: robinhood });
      await pub.waitForTransactionReceipt({ hash: h }); await refresh();
    },

    subscribe(fn) { subs.add(fn); fn(s); return () => subs.delete(fn); },
    async setProfile(name, image) {
      if (!PROFILES) throw new Error("Profiles aren't live yet.");
      const wc = await wallet();
      let bytes = image;
      if (!bytes) { // keep the current picture: re-send its bytes (the contract stores only the hash)
        const cur = s.profiles[account!.toLowerCase()]?.pfp;
        bytes = cur && cur.startsWith("data:") ? hexToBytes(("0x" + Buffer_from(cur)) as Hex) : new Uint8Array();
      }
      const h = await wc.writeContract({ address: PROFILES, abi: profilesAbi as unknown as Abi, functionName: "set", args: [name, bytesToHex(bytes)], account: account!, chain: robinhood });
      await pub.waitForTransactionReceipt({ hash: h }); await refresh();
    },
    async buy(n, pay: Pay, note) {
      const wc = await wallet();
      const [paperCost, plankCost, ethCost] = (await pub.readContract({ address: fireAddress, abi, functionName: "quote", args: [BigInt(n)] })) as [bigint, bigint, bigint];
      await ensureAllowance(wc, plankAddr!, plankCost);
      let h: Hex;
      if (pay === "usdg") {
        const cost = (await pub.readContract({ address: fireAddress, abi, functionName: "usdgCost", args: [BigInt(n)] })) as bigint;
        await ensureAllowance(wc, usdgAddr!, cost);
        h = await wc.writeContract({ address: fireAddress, abi, functionName: "buyTicketsWithUsdg", args: [BigInt(n), note], account: account!, chain: robinhood });
      } else if (pay === "eth") {
        if (ethCost === 0n) throw new Error("The ETH price feed is stale, so buying with ETH is paused. Use PAPER, or try again shortly.");
        // 1% headroom in case the feed ticks before the tx lands; the fire refunds anything over the price.
        h = await wc.writeContract({ address: fireAddress, abi, functionName: "buyTicketsWithEth", args: [BigInt(n), note], value: ethCost * 101n / 100n, account: account!, chain: robinhood });
      }
      else { await ensureAllowance(wc, paperAddr!, paperCost); h = await wc.writeContract({ address: fireAddress, abi, functionName: "buyTickets", args: [BigInt(n), note], account: account!, chain: robinhood }); }
      await pub.waitForTransactionReceipt({ hash: h }); await refresh();
    },
  };
}

function empty(): FireState {
  return { fireId: 0, night: 0, potPlank: 0, plankUsd: 0, paperUsd: 0, paperPerTicket: 1, ethUsd: 3333, plankPerTicket: 852_000_000, ticketsToday: 0, ticketsTotal: 0, fireSize: 0, trailingAvg: 1, threat: 0.2, nextRollAt: nextRollTime(),
    you: { tickets: 0, paper: 0, plank: 0, eth: 0, usdg: 0, remainingToday: DAILY_CAP, isWinner: false }, profiles: {}, burnedPaperAllTime: 0, burnedPlankAllTime: 0, millsEaten: 0, millFundEth: 0, millFundUsdg: 0, millBidUsd: 0, usdgEnabled: false, feed: [], past: [] };
}

/** Event bytes → a data: URL the <img> can show. Sniffs the format from the magic bytes. */
function imageUrl(hex: string): string {
  if (!hex || hex === "0x") return "";
  const b = hexToBytes(hex as Hex);
  const mime = b[0] === 0x52 && b[8] === 0x57 ? "image/webp" : b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : b[0] === 0x47 ? "image/gif" : "";
  if (!mime) return "";
  let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}
/** data: URL → hex string of its bytes (without 0x). */
function Buffer_from(dataUrl: string): string {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  let out = ""; for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}
