// Live implementation of FireApi against Fire.sol via viem. Selected when VITE_FIRE_ADDRESS is set.
// Reads poll every 8s; writes go through the injected wallet (MetaMask etc.).
// Safety rules: approve exactly what a buy needs; cap every buy at the price the user was shown; check every
// receipt's status; stop if the wallet switches accounts mid-flow.

import {
  createPublicClient, http, formatUnits, parseAbi, zeroAddress, type Abi, type Address, type Hex, type WalletClient,
} from "viem";
import fireAbi from "./fireAbi.json";
import profilesAbi from "./profilesAbi.json";
import { bytesToHex, hexToBytes } from "viem";
import { type Buy, type FireApi, type Pay, type FireState, type PastFire, type Snapshot, CEREMONY, DAILY_CAP, ETH_HEADROOM, fireLook, nextRollTime, stormOdds, stormLook, titleFor } from "./types";
import { robinhood, connectWallet, waitOk, PRICE_MOVED } from "./wallet";

export { robinhood };

const PROFILES = import.meta.env.VITE_PROFILES_ADDRESS as Address | undefined;
const PROFILES_FROM = BigInt(import.meta.env.VITE_PROFILES_FROM_BLOCK || 0); // Profiles deploy block
// The Fire's deploy block: past fires, burns, presses eaten and buyer titles are counted from here. Unset: the last 50k blocks only.
const FIRE_FROM = import.meta.env.VITE_FIRE_FROM_BLOCK ? BigInt(import.meta.env.VITE_FIRE_FROM_BLOCK) : undefined;
const LOG_CHUNK = 50_000n;
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

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

export function makeChainApi(fireAddress: Address): FireApi {
  const pub = createPublicClient({ chain: robinhood, transport: http(undefined, { batch: true }) });
  const abi = fireAbi as unknown as Abi;
  let account: Address | undefined;
  let accountEpoch = 0; // bumps whenever the wallet's account changes; a flow started under an older epoch stops
  let paperAddr: Address | undefined, plankAddr: Address | undefined, adapterAddr: Address | undefined, usdgAddr: Address | undefined, usdgDec = 6;
  let pendingId = 0n, routerAddr: Address | undefined, plankFeedAddr: Address | undefined, paperFeedAddr: Address | undefined;
  let s: FireState = { ...empty(), historyLoading: true };
  const subs = new Set<(s: FireState) => void>();
  const emit = () => subs.forEach((f) => f(s));
  const lifetime = new Map<string, number>();
  const paperBuyers = new Set<string>();
  const ticketsSeen = new Map<number, number>(); // fireId → the last ticketsTotal this page read for it
  let lastBlock: bigint | undefined, lastProfileBlock = 0n, feedId = 0;
  let burnedPaper = 0n, burnedPlank = 0n; // wei sent to 0x…dEaD by the game, summed by the history scan
  let prev: FireState | undefined; // the state as shown before the last roll landed: what a storm's ceremony holds on screen

  async function wallet(): Promise<WalletClient> {
    const { wc, account: a } = await connectWallet();
    if (account?.toLowerCase() !== a.toLowerCase()) accountEpoch++;
    account = a;
    return wc;
  }
  /** One account for a whole flow; stops if the wallet switches accounts part-way. */
  async function flow() {
    const wc = await wallet();
    const acct = account!, epoch = accountEpoch;
    const check = () => { if (epoch !== accountEpoch) throw new Error("Your wallet switched accounts part-way. Nothing more was sent. Start again."); };
    return { wc, acct, check };
  }
  // follow the wallet: switching accounts in MetaMask re-reads as the new account; disconnecting there clears it
  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", (accs: unknown) => { const a = (accs as string[])[0]; accountEpoch++; account = a ? (a as Address) : undefined; if (!account) s = { ...s, you: { ...empty().you } }; void refresh(); });
    window.ethereum.on("chainChanged", () => void refresh());
  }

  async function readAll() {
    const acct = account, epoch = accountEpoch; // one account for the whole read; a switch part-way drops the result
    const r = (fn: string, args: unknown[] = []) => pub.readContract({ address: fireAddress, abi, functionName: fn, args }) as Promise<bigint>;
    const [fireId, night, pot, ticketsToday, ticketsTotal, fireSize, trailingAvg, nextRollAt, plankPerTicket, millBid, millFund, dayIndex, pending, pendingSince, rerollAfter, potCarriedIn] = await Promise.all([
      r("fireId"), r("night"), r("pot"), r("ticketsToday"), r("ticketsTotal"), r("fireSizeMilli"), r("trailingAverage"), r("nextRollAt"), r("plankPerTicket"), r("millBid"), r("millFund"), r("dayIndex"),
      r("pendingRequest"), r("pendingSince"), r("REROLL_AFTER"), r("potCarriedIn"),
    ]);
    const abandoned = (await pub.readContract({ address: fireAddress, abi, functionName: "abandoned" })) as boolean;
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
    const paperWei = await r("paperPerTicket");
    const paperPerTicket = Number(formatUnits(paperWei, 18));
    let paperUsd = 0;
    try { const [, px] = await pub.readContract({ address: paperFeedAddr!, abi: feedAbi, functionName: "latestRoundData" }); if (px > 0n) paperUsd = Number(formatUnits(px, 18)); } catch { /* no PAPER market yet */ }
    pendingId = pending;
    const nowSec = (await pub.getBlock()).timestamp; // the contract judges time by the chain's clock
    let rollAction: FireState["rollAction"];
    if (abandoned) rollAction = undefined;
    else if (pending === 0n) { if (nowSec >= nextRollAt) rollAction = "roll"; }
    else if (await pub.readContract({ address: adapterAddr, abi: adapterAbi, functionName: "answered", args: [pending] })) { if (nowSec >= pendingSince + 60n) rollAction = "settle"; }
    else {
      // Anyone may deliver drand's number once its round is out; re-roll only if it still isn't there after REROLL_AFTER.
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
    // A stale ETH/USD feed makes ethPerTicket revert: the ETH path is closed, and the page says so.
    let ethPerTicket = 0n; try { ethPerTicket = await r("ethPerTicket"); } catch { /* stale feed */ }
    let you: FireState["you"] = { ...empty().you };
    if (acct) {
      const [paper, plank, eth, mine, bought, usdg, claimable] = await Promise.all([
        pub.readContract({ address: paperAddr!, abi: erc20, functionName: "balanceOf", args: [acct] }),
        pub.readContract({ address: plankAddr!, abi: erc20, functionName: "balanceOf", args: [acct] }),
        pub.getBalance({ address: acct }),
        pub.readContract({ address: fireAddress, abi, functionName: "ticketsOf", args: [fireId, acct] }) as Promise<bigint>,
        pub.readContract({ address: fireAddress, abi, functionName: "boughtOnDay", args: [dayIndex, acct] }) as Promise<bigint>,
        usdgAddr ? pub.readContract({ address: usdgAddr, abi: erc20, functionName: "balanceOf", args: [acct] }) : Promise.resolve(0n),
        pub.readContract({ address: fireAddress, abi, functionName: "claimable", args: [acct] }) as Promise<readonly [bigint, bigint]>,
      ]);
      you = {
        address: acct, tickets: Number(mine), paper: Number(formatUnits(paper, 18)), plank: Number(formatUnits(plank, 18)), eth: Number(formatUnits(eth, 18)), usdg: Number(formatUnits(usdg, usdgDec)),
        remainingToday: Math.max(0, DAILY_CAP - Number(bought)), isWinner: s.you.address === acct && s.you.isWinner, profile: s.profiles[acct.toLowerCase()],
        prize: Number(formatUnits(claimable[0], 18)), refund: Number(formatUnits(claimable[1], 18)),
        raw: { eth, plank, paper, usdg },
      };
    }
    if (epoch !== accountEpoch) return; // the wallet switched mid-read: the queued pass reads the new account
    const trailing = Number(trailingAvg) || 1;
    const n = Number(night);
    ticketsSeen.set(Number(fireId), Number(ticketsTotal));
    if (s.fireId > 0 && (Number(fireId) !== s.fireId || n !== s.night)) prev = s; // a roll landed: keep what was on screen before it
    s = {
      ...s, fireId: Number(fireId), night: n, potPlank: Number(formatUnits(pot, 18)), potCarriedIn: Number(formatUnits(potCarriedIn, 18)), plankPerTicket: Number(formatUnits(plankPerTicket, 18)),
      ethUsd: ethPerTicket > 0n ? 1 / Number(formatUnits(ethPerTicket, 18)) : 0,
      ticketsToday: Number(ticketsToday), ticketsTotal: Number(ticketsTotal), fireSize: Number(fireSize) / 1000, trailingAvg: trailing,
      threat: Math.max(0.1, Math.min(1, stormOdds(n + 1, Number(fireSize) / 1000) * 1.5)), // the chance tonight's storm beats the fire
      nextRollAt: Number(nextRollAt) * 1000 || nextRollTime(), millBidUsd: Number(formatUnits(millBid, 8)), millFundEth: Number(formatUnits(millFund, 18)), millFundUsdg: Number(formatUnits(fundUsdg, usdgDec)), usdgEnabled: !!usdgAddr, you,
      rollPending: pending !== 0n, rollAction, plankUsd, paperPerTicket, paperUsd, abandoned,
      raw: { plankPerTicket, paperPerTicket: paperWei, ethPerTicket },
      tokens: { paper: paperAddr!, plank: plankAddr!, usdg: usdgAddr, usdgDecimals: usdgDec },
    };
  }

  /** One chunk of the Fire's history, in order: buys, storms, presses, and the game's burns (PLANK the Fire sent to
   *  0x…dEaD, PAPER a buyer sent there in a buy). The Fire emits no burn amounts, so they're read off the token transfers. */
  async function readEvents(from: bigint, to: bigint, headBlock: { number: bigint; timestamp: bigint }) {
    const head = headBlock.number;
    type Log = { args: Record<string, unknown>; eventName: string; blockNumber: bigint; logIndex: number; transactionHash: Hex; token?: "paper" | "plank" };
    const [fireLogs, plankBurns, paperBurns] = (await Promise.all([
      pub.getContractEvents({ address: fireAddress, abi, fromBlock: from, toBlock: to }),
      pub.getContractEvents({ address: plankAddr!, abi: transferAbi, eventName: "Transfer", args: { from: fireAddress, to: DEAD }, fromBlock: from, toBlock: to }),
      pub.getContractEvents({ address: paperAddr!, abi: transferAbi, eventName: "Transfer", args: { to: DEAD }, fromBlock: from, toBlock: to }),
    ])) as unknown as [Log[], Log[], Log[]];
    const paperBuyTx = new Set(fireLogs.filter((l) => l.eventName === "TicketsBought" && !l.args.paperFromFire).map((l) => l.transactionHash));
    const all = [...fireLogs, ...plankBurns.map((l) => ({ ...l, token: "plank" as const })), ...paperBurns.filter((l) => paperBuyTx.has(l.transactionHash)).map((l) => ({ ...l, token: "paper" as const }))]
      .sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
    // When each event happened, by the chain's clock, mapped onto this browser's clock. Using "now" instead made
    // every page load replay the last storm as if it were happening live. Only the events the page animates need it,
    // and only near the head: an old chunk of the backfill never animates.
    const buys = all.filter((l) => l.eventName === "TicketsBought").slice(-8);
    const near = to + 5_000n >= head;
    const wanted = new Set(near ? all.filter((l) => l.eventName === "Survived" || l.eventName === "WentOut" || l.eventName === "MillEaten").concat(buys).map((l) => l.blockNumber) : []);
    const blockTime = new Map<bigint, bigint>();
    await Promise.all([...wanted].map(async (n) => { blockTime.set(n, (await pub.getBlock({ blockNumber: n })).timestamp); }));
    const nowMs = Date.now();
    const whenMs = (n: bigint) => { const t = blockTime.get(n); return t === undefined ? 0 : nowMs - Number(headBlock.timestamp - t) * 1000; };
    // State just before a block (needs the RPC to serve recent history; undefined if it can't).
    const atBlock = async (fn: string, bn: bigint, args: unknown[] = []) => {
      try { return (await pub.readContract({ address: fireAddress, abi, functionName: fn, args, blockNumber: bn - 1n })) as bigint; } catch { return undefined; }
    };
    const feed: Buy[] = [...s.feed]; const past: PastFire[] = [...s.past]; let storm = s.storm;
    let mills = s.millsEaten;
    const before = prev && prev.fireId > 0 ? prev : undefined;
    const plankNum = (x: bigint) => Number(formatUnits(x, 18));
    const snap = async (fireId: number, night: number, size: number, bn: bigint, pot: number, tickets: number | undefined, burnPlank: bigint): Promise<Snapshot> => {
      const burns = { burnedPaperAllTime: plankNum(burnedPaper), burnedPlankAllTime: plankNum(burnPlank) }; // the totals before this storm
      if (before && before.fireId === fireId && before.night === night - 1) {
        return { fireId, night: night - 1, potPlank: before.potPlank, fireSize: before.fireSize, ticketsTotal: before.ticketsTotal, ticketsToday: before.ticketsToday, youTickets: before.you.tickets, youPlank: before.you.plank, potCarriedIn: before.potCarriedIn, ...burns };
      }
      const today = await atBlock("ticketsToday", bn);
      const carried = await atBlock("potCarriedIn", bn);
      const mine = account ? await atBlock("ticketsOf", bn, [BigInt(fireId), account]) : 0n;
      return { fireId, night: night - 1, potPlank: pot, fireSize: size, ticketsTotal: tickets ?? s.ticketsTotal, ticketsToday: today !== undefined ? Number(today) : 0, youTickets: Number(mine ?? 0n), youPlank: s.you.plank,
        potCarriedIn: carried !== undefined ? plankNum(carried) : undefined, ...burns };
    };
    for (const l of all) {
      const a = l.args, ev = l.eventName;
      if (l.token) { if (l.token === "plank") burnedPlank += a.value as bigint; else burnedPaper += a.value as bigint; continue; }
      const at = whenMs(l.blockNumber);
      const live = nowMs - at < CEREMONY.DONE; // only a storm still playing needs what the page showed before it
      if (ev === "TicketsBought") {
        const who = String(a.buyer), n = Number(a.tickets), fromFire = Boolean(a.paperFromFire);
        const life = (lifetime.get(who) ?? 0) + n; lifetime.set(who, life);
        if (!fromFire) paperBuyers.add(who.toLowerCase());
        feed.unshift({ id: ++feedId, who, tickets: n, fromFire, note: String(a.note ?? ""), title: titleFor(life, !paperBuyers.has(who.toLowerCase())), at });
      } else if (ev === "Survived") {
        const size = Number(a.fireSizeMilli) / 1000, strength = Number(a.stormMilli) / 1000, fid = Number(a.fireId), night = Number(a.night);
        const tickets = live ? await atBlock("ticketsTotal", l.blockNumber) : undefined;
        storm = { at, fireId: fid, night, strength, size, survived: true, intensity: stormLook(strength), sizeAfter: fireLook(Math.max(0, (size - strength) * 0.85)),
          before: live ? await snap(fid, night, size, l.blockNumber, s.potPlank, tickets !== undefined ? Number(tickets) : undefined, burnedPlank) : undefined };
      } else if (ev === "WentOut") {
        const size = Number(a.fireSizeMilli) / 1000, strength = a.stormMilli === 2n ** 256n - 1n ? Infinity : Number(a.stormMilli) / 1000, winner = String(a.winner), fid = Number(a.fireId), night = Number(a.night);
        const inTx = all.filter((x) => x.transactionHash === l.transactionHash);
        const owed = inTx.find((x) => x.eventName === "PayoutOwed");
        const lit = inTx.find((x) => x.eventName === "Lit");
        const nobody = /^0x0{40}$/i.test(winner);
        // this storm's burn landed just before WentOut: the snapshot shows the totals from before it
        const txBurn = inTx.filter((x) => x.token === "plank").reduce((t, x) => t + (x.args.value as bigint), 0n);
        // the pot and ticket count the fire died with: read just before the storm, else work them back from the relight
        const potWei = await atBlock("pot", l.blockNumber);
        const pot = potWei !== undefined ? plankNum(potWei) : lit ? plankNum(lit.args.carried as bigint) / (nobody ? 1 : 0.3) : 0;
        const tWei = await atBlock("ticketsTotal", l.blockNumber);
        const tickets = tWei !== undefined ? Number(tWei) : ticketsSeen.get(fid) ?? all.filter((x) => x.eventName === "TicketsBought" && Number(x.args.fireId) === fid).reduce((t, x) => t + Number(x.args.tickets), 0);
        const prize = owed ? plankNum(owed.args.amount as bigint) : plankNum(a.paid as bigint);
        storm = { at, fireId: fid, night, strength, size, survived: false, intensity: stormLook(strength), winner, paidPlank: prize, prizeOwed: !!owed, potPlank: pot, tickets,
          before: live ? await snap(fid, night, size, l.blockNumber, pot, tickets, burnedPlank - txBurn) : undefined };
        past.unshift({ id: fid, nights: night, potPlank: pot, prizePlank: prize, winner, peakSize: size });
        if (account && winner.toLowerCase() === account.toLowerCase()) s = { ...s, you: { ...s.you, isWinner: true } };
      } else if (ev === "MillEaten") {
        mills += 1;
        feed.unshift({ id: ++feedId, who: zeroAddress, tickets: 0, fromFire: false, note: "", title: "", at, kind: "mill" });
      }
    }
    s = { ...s, feed: feed.slice(0, 40), past: past.slice(0, 10), storm, millsEaten: mills, burnedPaperAllTime: plankNum(burnedPaper), burnedPlankAllTime: plankNum(burnedPlank) };
  }

  /** Walks the Fire's logs from its deploy block to the head in chunks, in the background; each chunk shows as it lands. */
  let scanning = false, scanAgain = false;
  async function scan() {
    if (!plankAddr || !paperAddr) return; // readAll hasn't found the tokens yet
    if (scanning) { scanAgain = true; return; }
    scanning = true;
    try {
      do {
        scanAgain = false;
        const head = await pub.getBlock();
        if (lastBlock === undefined && FIRE_FROM === undefined) console.warn("VITE_FIRE_FROM_BLOCK is unset: history covers only the last 50,000 blocks");
        let from = lastBlock !== undefined ? lastBlock + 1n : FIRE_FROM ?? (head.number > 50_000n ? head.number - 50_000n : 0n);
        while (from <= head.number) {
          const to = from + LOG_CHUNK - 1n < head.number ? from + LOG_CHUNK - 1n : head.number;
          await readEvents(from, to, head);
          lastBlock = to; from = to + 1n;
          emit();
        }
        if (s.historyLoading) { s = { ...s, historyLoading: false }; emit(); }
      } while (scanAgain);
    } catch (e) { console.warn("refresh: history scan failed", e); }
    finally { scanning = false; }
  }

  let profScanning = false;
  async function readProfiles() {
    if (!PROFILES || profScanning) return;
    profScanning = true;
    try {
      const head = await pub.getBlockNumber();
      let from = lastProfileBlock ? lastProfileBlock + 1n : PROFILES_FROM;
      // RPCs cap eth_getLogs ranges, so walk the history in chunks; each chunk is shown as it lands.
      while (from <= head) {
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
        const logs = await pub.getContractEvents({ address: PROFILES, abi: profilesAbi as unknown as Abi, eventName: "ProfileSet", fromBlock: from, toBlock: to });
        if (logs.length) {
          const profiles = { ...s.profiles };
          for (const l of logs) { const a = (l as unknown as { args: Record<string, unknown> }).args; profiles[String(a.who).toLowerCase()] = { name: String(a.name ?? ""), pfp: imageUrl(String(a.image ?? "0x")) }; }
          s = { ...s, profiles, you: s.you.address ? { ...s.you, profile: profiles[s.you.address.toLowerCase()] } : s.you };
          emit();
        }
        lastProfileBlock = to; from = to + 1n;
      }
    } catch (e) { console.warn("refresh: profile scan failed", e); }
    finally { profScanning = false; }
  }

  // The live numbers go out as soon as readAll lands; the history scan and the profile names run in the background
  // (the first visit's backfill can take a while) and show chunk by chunk. A failed log query never holds back the numbers.
  // One refresh at a time. A call made mid-refresh — e.g. right after a buy lands — gets one more pass once the
  // current one finishes, so it sees the new state.
  let running: Promise<void> | null = null, again = false;
  async function refresh(): Promise<void> {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await readAll(); } catch (e) { console.warn("refresh: readAll failed", e); }
        emit();
        void scan(); void readProfiles();
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

  /** Approve exactly `amount` if the current allowance is short. Stops the flow if the approve fails. */
  async function ensureAllowance(wc: WalletClient, acct: Address, check: () => void, token: Address, amount: bigint, what: string) {
    const cur = (await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [acct, fireAddress] })) as bigint;
    if (cur >= amount) return;
    check();
    const h = await wc.writeContract({ address: token, abi: erc20, functionName: "approve", args: [fireAddress, amount], account: acct, chain: robinhood });
    await waitOk(pub, h, `approving ${what}`, "approve"); // pending past 3 min: the buy itself was never sent
  }
  /** Simulate first (a revert shows its reason instead of costing gas), then send from the flow's account. */
  async function send(wc: WalletClient, acct: Address, check: () => void, fn: string, args: unknown[], what: string, value?: bigint) {
    check();
    await pub.simulateContract({ address: fireAddress, abi, functionName: fn, args, account: acct, value });
    check();
    const h = await wc.writeContract({ address: fireAddress, abi, functionName: fn, args, account: acct, chain: robinhood, value });
    await waitOk(pub, h, what);
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
    disconnect() { account = undefined; accountEpoch++; s = { ...s, you: { ...empty().you } }; emit(); },
    async rollStorm() {
      const { wc, acct, check } = await flow();
      const a = s.rollAction;
      if (!a) return;
      let h: Hex;
      check();
      if (a === "settle") h = await wc.writeContract({ address: adapterAddr!, abi: adapterAbi, functionName: "settle", args: [pendingId], account: acct, chain: robinhood });
      else if (a === "deliver" || a === "reroll") {
        // A number from drand always beats a re-roll: try it first.
        const [, round] = await pub.readContract({ address: routerAddr!, abi: routerAbi, functionName: "requests", args: [pendingId] });
        const sig = await drandSignature(round);
        check();
        if (sig) h = await wc.writeContract({ address: routerAddr!, abi: routerAbi, functionName: "fulfill", args: [pendingId, sig], account: acct, chain: robinhood });
        else if (a === "reroll") h = await wc.writeContract({ address: fireAddress, abi, functionName: "reroll", args: [], account: acct, chain: robinhood });
        else throw new Error("Couldn't reach drand for the storm's number. Try again in a moment.");
      } else h = await wc.writeContract({ address: fireAddress, abi, functionName: "roll", args: [], account: acct, chain: robinhood });
      await waitOk(pub, h, "bringing in the storm"); await refresh();
    },

    subscribe(fn) { subs.add(fn); fn(s); return () => subs.delete(fn); },
    async setProfile(name, image) {
      if (!PROFILES) throw new Error("Profiles aren't live yet.");
      const { wc, acct, check } = await flow();
      let bytes = image;
      if (!bytes) { // keep the current picture: re-send its bytes (the contract stores only the hash)
        const cur = s.profiles[acct.toLowerCase()]?.pfp;
        bytes = cur && cur.startsWith("data:") ? hexToBytes(("0x" + dataUrlHex(cur)) as Hex) : new Uint8Array();
      }
      check();
      const h = await wc.writeContract({ address: PROFILES, abi: profilesAbi as unknown as Abi, functionName: "set", args: [name, bytesToHex(bytes)], account: acct, chain: robinhood });
      await waitOk(pub, h, "saving your profile"); await refresh();
    },
    async buy(n, pay: Pay, note, seen) {
      if (s.abandoned) throw new Error("The game has ended. Buying is closed.");
      const raw = seen.raw;
      if (!raw) throw new Error("Prices are still loading. Try again in a moment.");
      const { wc, acct, check } = await flow();
      const N = BigInt(n);
      // Never pay more than the price the buyer was shown.
      const maxPaper = N * raw.paperPerTicket, maxPlank = N * raw.plankPerTicket;
      const [paperCost, plankCost, ethCost] = (await pub.readContract({ address: fireAddress, abi, functionName: "quote", args: [N] })) as [bigint, bigint, bigint];
      if (plankCost > maxPlank || (pay === "paper" && paperCost > maxPaper)) throw new Error(PRICE_MOVED);
      // ETH: send 1% over the quote shown; the contract takes the live price and refunds the rest in the same tx.
      const ethMax = (N * raw.ethPerTicket * BigInt(Math.round(ETH_HEADROOM * 10_000))) / 10_000n;
      if (pay === "eth" && ethCost > ethMax) throw new Error("The ETH price just changed. Check the new price and try again.");
      await ensureAllowance(wc, acct, check, plankAddr!, maxPlank, "PLANK");
      if (pay === "usdg") {
        const cost = (await pub.readContract({ address: fireAddress, abi, functionName: "usdgCost", args: [N] })) as bigint;
        await ensureAllowance(wc, acct, check, usdgAddr!, cost, "USDG");
        await send(wc, acct, check, "buyTicketsWithUsdg", [N, maxPlank, note], "the buy");
      } else if (pay === "eth") {
        if (raw.ethPerTicket === 0n) throw new Error("ETH is paused (price feed late). Pay with PAPER or USDG.");
        // Up to 1% over the price shown (the review screen says so); anything above the live price comes straight back.
        await send(wc, acct, check, "buyTicketsWithEth", [N, maxPlank, note], "the buy", ethMax);
      } else {
        await ensureAllowance(wc, acct, check, paperAddr!, maxPaper, "PAPER");
        await send(wc, acct, check, "buyTickets", [N, maxPaper, maxPlank, note], "the buy");
      }
      await refresh();
    },
    async claim() {
      const { wc, acct, check } = await flow();
      await send(wc, acct, check, "claim", [acct], "claiming your prize");
      await refresh();
    },
    async refund() {
      const { wc, acct, check } = await flow();
      await send(wc, acct, check, "refund", [], "claiming your refund");
      await refresh();
    },
  };
}

function empty(): FireState {
  return { fireId: 0, night: 0, potPlank: 0, plankUsd: 0, paperUsd: 0, paperPerTicket: 1, ethUsd: 0, plankPerTicket: 852_000_000, ticketsToday: 0, ticketsTotal: 0, fireSize: 0, trailingAvg: 1, threat: 0.2, nextRollAt: nextRollTime(),
    potCarriedIn: 0, you: { tickets: 0, paper: 0, plank: 0, eth: 0, usdg: 0, remainingToday: DAILY_CAP, isWinner: false }, profiles: {}, burnedPaperAllTime: 0, burnedPlankAllTime: 0, millsEaten: 0, millFundEth: 0, millFundUsdg: 0, millBidUsd: 0, usdgEnabled: false, feed: [], past: [] };
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
function dataUrlHex(dataUrl: string): string {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  let out = ""; for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}
