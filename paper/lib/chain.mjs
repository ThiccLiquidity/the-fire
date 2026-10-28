// Minimal JSON-RPC + ABI helpers (no dependencies). Selectors and topics are computed from their signatures
// (keccak.mjs), so a changed event shows up here as a changed signature, never as a stale hash.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO, env, fetchText, readJson } from "./util.mjs";
import { selectorOf, topicOf } from "./keccak.mjs";

/** Function signatures the paper calls. */
export const SIG = {
  getReserves: "getReserves()",
  token0: "token0()",
  balanceOf: "balanceOf(address)",
  totalSupply: "totalSupply()",
  latestRoundData: "latestRoundData()",
  getPair: "getPair(address,address)",
  profileOf: "profileOf(address)", // FireProfiles
};
export const SEL = Object.fromEntries(Object.entries(SIG).map(([k, s]) => [k, selectorOf(s)]));

/** Event signatures the paper reads (as the contracts declare them; enums are uint8) and what each log's data holds
 *  (its non-indexed fixed-size fields, one 32-byte word each, in order). */
export const EVENT = {
  // MorningWood.Letter(uint256 indexed issue, address indexed from, string text): data is the string (decodeString)
  Letter: { sig: "Letter(uint256,address,string)", data: [] },
  // MorningWood.Bought(uint256 indexed issue, address indexed buyer, uint256 qty, Pay pay, uint256 cost, uint256 paper)
  Bought: { sig: "Bought(uint256,address,uint256,uint8,uint256,uint256)", data: ["qty", "pay", "cost", "paper"] },
  // FireSale.PacksBought(uint256 indexed fire, uint256 indexed group, address indexed buyer, uint256 count, uint8 pay,
  //   uint256 paid, uint256 toLiquidity)
  PacksBought: { sig: "PacksBought(uint256,uint256,address,uint256,uint8,uint256,uint256)", data: ["count", "pay", "paid", "toLiquidity"] },
  // LiquidityBurner.LiquidityBurned(uint256 paper, uint256 plank, uint256 lp): PAPER and PLANK locked in burned pool tokens
  LiquidityBurned: { sig: "LiquidityBurned(uint256,uint256,uint256)", data: ["paper", "plank", "lp"] },
  // LiquidityBurner.OverCap(Side indexed side, uint256 amount): a side's excess over $100 burned outright (side 0: PAPER)
  OverCap: { sig: "OverCap(uint8,uint256)", data: ["amount"] },
  // UniswapV2Pair.Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out,
  //   uint256 amount1Out, address indexed to)
  Swap: { sig: "Swap(address,uint256,uint256,uint256,uint256,address)", data: ["amount0In", "amount1In", "amount0Out", "amount1Out"] },
};
export const TOPIC = Object.fromEntries(Object.entries(EVENT).map(([k, e]) => [k, topicOf(e.sig)]));

/** A log's fixed-size data fields by name (EVENT[name].data), checked: the log must be that event and carry every
 *  word. Throws instead of reading a missing word as 0, so a changed event is noticed rather than counted as nothing. */
export function decodeLog(name, log) {
  const e = EVENT[name];
  if (!e) throw new Error(`unknown event ${name}`);
  if (String(log.topics?.[0] ?? "").toLowerCase() !== TOPIC[name]) throw new Error(`${name}: a log with topic ${log.topics?.[0]} isn't ${e.sig}`);
  const h = String(log.data ?? "0x").replace(/^0x/, "");
  if (h.length < e.data.length * 64) throw new Error(`${name}: ${h.length / 2} bytes of data, ${e.data.length * 32} expected (${e.sig})`);
  return Object.fromEntries(e.data.map((f, i) => [f, BigInt("0x" + h.slice(i * 64, i * 64 + 64))]));
}

export const DEAD = "0x000000000000000000000000000000000000dEaD";

export const word = (hex, i) => BigInt("0x" + (hex.replace(/^0x/, "").slice(i * 64, i * 64 + 64) || "0"));
export const addrWord = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
export const u256Word = (n) => BigInt(n).toString(16).padStart(64, "0");
export const asAddr = (w) => "0x" + w.toString(16).padStart(40, "0").slice(-40);

/** Decodes an ABI string at byte offset `off` (from the head) of `hex`. */
export function decodeString(hex, off = Number(word(hex, 0))) {
  const h = hex.replace(/^0x/, "");
  const len = Number(BigInt("0x" + h.slice(off * 2, off * 2 + 64)));
  return Buffer.from(h.slice(off * 2 + 64, off * 2 + 64 + len * 2), "hex").toString("utf8");
}

export const toNum = (x, decimals = 18) => Number(x) / 10 ** decimals;

export function rpc(url = env("RPC_URL", "https://rpc.mainnet.chain.robinhood.com")) {
  let id = 0;
  const call = async (method, params) => {
    const j = JSON.parse(await fetchText(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), timeoutMs: 20000 }));
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
  const tag = (b) => (b === undefined || b === "latest" ? "latest" : "0x" + BigInt(b).toString(16));
  return {
    call,
    blockNumber: async () => BigInt(await call("eth_blockNumber", [])),
    block: async (n) => call("eth_getBlockByNumber", [tag(n), false]),
    eth_call: (to, data, block) => call("eth_call", [{ to, data }, tag(block)]),
    logs: (filter) => call("eth_getLogs", [filter]),
  };
}

/** The block at (or just before) unix time `ts`, by binary search. */
export async function blockAt(r, ts) {
  let hi = await r.blockNumber();
  const top = await r.block(hi);
  if (Number(top.timestamp) <= ts) return hi;
  let lo = 0n;
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    const b = await r.block(mid);
    if (Number(b.timestamp) <= ts) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** getLogs over a long range, in chunks. */
export async function logsChunked(r, { address, topics, fromBlock, toBlock, chunk = 200_000n }) {
  const out = [];
  for (let a = BigInt(fromBlock); a <= BigInt(toBlock); a += chunk) {
    const b = a + chunk - 1n < BigInt(toBlock) ? a + chunk - 1n : BigInt(toBlock);
    out.push(...(await r.logs({ address, topics, fromBlock: "0x" + a.toString(16), toBlock: "0x" + b.toString(16) })));
  }
  return out;
}

/** deployments/<chainId>.json (DEPLOYMENTS_FILE overrides). */
export function deployments(chainId = env("CHAIN_ID", "4663")) {
  const f = env("DEPLOYMENTS_FILE", resolve(REPO, "deployments", `${chainId}.json`));
  return existsSync(f) ? readJson(f) : { inputs: {}, contracts: {} };
}
