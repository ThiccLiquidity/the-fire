// The markets page's numbers, from the chain (Uniswap V2 pools on Robinhood Chain + Chainlink ETH/USD), the explorer
// (holders) and CoinGecko (majors). Code only: the writers never type a number, they use {{tokens}} (see inject.mjs).
import { DEAD, SEL, TOPIC, addrWord, asAddr, blockAt, decodeLog, logsChunked, rpc, toNum, word } from "./chain.mjs";
import { env, fetchJson, soft } from "./util.mjs";

const PLANK_PER_MILL = 88_842_006_942.0888; // docs/addresses.md: total supply / 10,000
const ZERO = "0x0000000000000000000000000000000000000000";

async function ethUsdAt(r, feed, block) {
  const h = await r.eth_call(feed, SEL.latestRoundData, block);
  return toNum(word(h, 1), 8);
}

async function reserves(r, pair, block) {
  const h = await r.eth_call(pair, SEL.getReserves, block);
  return [word(h, 0), word(h, 1)];
}

async function token0(r, pair) {
  return asAddr(word(await r.eth_call(pair, SEL.token0), 0)).toLowerCase();
}

async function balanceOf(r, token, who, block) {
  return word(await r.eth_call(token, SEL.balanceOf + addrWord(who), block), 0);
}

async function holders(token, notes) {
  return soft(`holders ${token}`, async () => {
    const j = await fetchJson(`${env("EXPLORER_API", "https://robinhoodchain.blockscout.com/api/v2")}/tokens/${token}`);
    const n = j.holders_count ?? j.holders;
    return n === undefined ? null : Number(n);
  }, null, notes);
}

/**
 * One pool's view of `token`: its USD price (quote side valued at `quoteUsd`), liquidity (both sides), and 24h volume
 * (the quote side of every Swap). Decimals: 18 for PAPER/PLANK/WETH, `quoteDec` for the quote.
 */
async function poolView(r, { pair, token, quoteUsd, quoteDec = 18, oldBlock, oldQuoteUsd, fromBlock, toBlock, notes }) {
  const t0 = await token0(r, pair);
  const tokenIs0 = t0 === token.toLowerCase();
  const read = async (b) => {
    const [r0, r1] = await reserves(r, pair, b);
    const [rt, rq] = tokenIs0 ? [r0, r1] : [r1, r0];
    return { rt: toNum(rt), rq: toNum(rq, quoteDec) };
  };
  const now = await read();
  const price = now.rt ? (now.rq / now.rt) * quoteUsd : 0;
  const old = oldBlock ? await soft("old reserves", () => read(oldBlock), null, notes) : null;
  const oldPrice = old?.rt ? (old.rq / old.rt) * (oldQuoteUsd ?? quoteUsd) : null;
  const volume = await soft(`volume ${pair}`, async () => {
    const logs = await logsChunked(r, { address: pair, topics: [TOPIC.Swap], fromBlock, toBlock });
    let q = 0;
    for (const l of logs) {
      const { amount0In: a0in, amount1In: a1in, amount0Out: a0out, amount1Out: a1out } = decodeLog("Swap", l); // throws on a malformed log
      q += tokenIs0 ? toNum(a1in + a1out, quoteDec) : toNum(a0in + a0out, quoteDec);
    }
    return { usd: q * quoteUsd, trades: logs.length };
  }, null, notes);
  return { pair, price, oldPrice, liquidityUsd: 2 * now.rq * quoteUsd, volumeUsd: volume?.usd ?? null, trades: volume?.trades ?? null };
}

const pct = (now, old) => (now && old ? +(((now - old) / old) * 100).toFixed(2) : null);
const round = (x, sig = 4) => (x === null || x === undefined ? null : Number(x.toPrecision(sig)));

export async function majors(ids, notes) {
  return soft("coingecko", async () => {
    const j = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`);
    return Object.fromEntries(ids.map((id) => [id, { priceUsd: j[id]?.usd ?? null, change24hPct: j[id]?.usd_24h_change != null ? +j[id].usd_24h_change.toFixed(2) : null }]));
  }, {}, notes);
}

/** The whole markets block. `dep`: the deployments file. */
export async function gatherMarkets(dep, cfg, notes) {
  const I = dep.inputs ?? {};
  const r = rpc();
  const now = Math.floor(Date.now() / 1000);
  const latest = await r.blockNumber();
  const oldBlock = await soft("block 24h ago", () => blockAt(r, now - 86_400), null, notes);
  const fromBlock = oldBlock ?? latest - 1n;
  const ethUsd = await ethUsdAt(r, I.ETH_USD_FEED);
  const oldEth = oldBlock ? await soft("old eth", () => ethUsdAt(r, I.ETH_USD_FEED, oldBlock), ethUsd, notes) : ethUsd;

  // PLANK: the main V2 pair (WETH/PLANK)
  const plankPool = await poolView(r, { pair: I.PLANK_WETH_V2_PAIR, token: I.PLANK, quoteUsd: ethUsd, oldBlock, oldQuoteUsd: oldEth, fromBlock, toBlock: latest, notes });
  // PAPER: every V2 pool it has against WETH, PLANK or USDG; price from the deepest
  const paperPools = [];
  for (const [q, usd, oldUsd, dec] of [[I.WETH, ethUsd, oldEth, 18], [I.PLANK, plankPool.price, plankPool.oldPrice, 18], [I.USDG, 1, 1, 6]]) {
    if (!q) continue;
    const pair = asAddr(word(await r.eth_call(I.UNIV2_FACTORY, SEL.getPair + addrWord(I.PAPER) + addrWord(q)), 0));
    if (pair === ZERO) continue;
    paperPools.push(await soft(`PAPER pool ${pair}`, () => poolView(r, { pair, token: I.PAPER, quoteUsd: usd, quoteDec: dec, oldBlock, oldQuoteUsd: oldUsd, fromBlock, toBlock: latest, notes }), null, notes));
  }
  const pp = paperPools.filter(Boolean).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  const deepest = pp[0];

  const token = async (sym, addr, pools, mainPrice, oldPrice) => {
    const dead = toNum(await balanceOf(r, addr, DEAD));
    const deadOld = oldBlock ? await soft(`${sym} burned 24h`, async () => toNum(await balanceOf(r, addr, DEAD, oldBlock)), null, notes) : null;
    const supply = toNum(word(await r.eth_call(addr, SEL.totalSupply), 0));
    return {
      symbol: sym,
      address: addr,
      priceUsd: round(mainPrice, 6),
      change24hPct: pct(mainPrice, oldPrice),
      volume24hUsd: round(pools.reduce((s, p) => s + (p.volumeUsd ?? 0), 0)),
      trades24h: pools.reduce((s, p) => s + (p.trades ?? 0), 0),
      liquidityUsd: round(pools.reduce((s, p) => s + p.liquidityUsd, 0)),
      marketCapUsd: round((supply - dead) * mainPrice),
      burnedTotal: round(dead, 6),
      burned24h: deadOld === null ? null : round(dead - deadOld, 6),
      holders: await holders(addr, notes),
      pools: pools.map((p) => p.pair),
    };
  };

  const plank = await token("PLANK", I.PLANK, [plankPool], plankPool.price, plankPool.oldPrice);
  const paper = deepest ? await token("PAPER", I.PAPER, pp, deepest.price, deepest.oldPrice) : { symbol: "PAPER", address: I.PAPER, priceUsd: null, note: "no PAPER pool yet" };
  const mills = await soft("mills", async () => {
    const live = I.MILL ? Number(word(await r.eth_call(I.MILL, SEL.totalSupply), 0)) : null;
    return { name: "Paper Mills", address: I.MILL, live, holders: await holders(I.MILL, notes), plankPerMill: PLANK_PER_MILL, backingUsd: round(PLANK_PER_MILL * plank.priceUsd), floorEth: null };
  }, { name: "Paper Mills", address: I.MILL }, notes);

  return {
    asOf: new Date().toISOString(),
    source: "chain",
    sample: false,
    block: Number(latest),
    ethUsd: round(ethUsd, 6),
    tokens: { PAPER: paper, PLANK: plank },
    mills,
    majors: await majors(cfg.majors ?? ["bitcoin", "ethereum"], notes),
  };
}

/** Clearly fake numbers for rehearsals (--mock): every field present, `sample: true`. */
export function mockMarkets() {
  return {
    asOf: new Date().toISOString(),
    source: "mock",
    sample: true,
    block: 0,
    ethUsd: 2377.12,
    tokens: {
      PAPER: { symbol: "PAPER", address: "SAMPLE", priceUsd: 0.000412, change24hPct: -7.3, volume24hUsd: 3120, trades24h: 214, liquidityUsd: 41200, marketCapUsd: 412000, burnedTotal: 1840221.5, burned24h: 3311.2, holders: 1312, pools: [] },
      PLANK: { symbol: "PLANK", address: "SAMPLE", priceUsd: 0.00000000094, change24hPct: -11.6, volume24hUsd: 18450, trades24h: 902, liquidityUsd: 133000, marketCapUsd: 835000, burnedTotal: 4120000000000, burned24h: 61000000000, holders: 611, pools: [] },
    },
    mills: { name: "Paper Mills", address: "SAMPLE", live: 9310, holders: 1204, plankPerMill: PLANK_PER_MILL, backingUsd: 83.51, floorEth: null },
    majors: { bitcoin: { priceUsd: 81176, change24hPct: -4.0 }, ethereum: { priceUsd: 2377, change24hPct: -5.4 }, solana: { priceUsd: null, change24hPct: null } },
  };
}
