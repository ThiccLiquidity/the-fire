// Minimal JSON-RPC + ABI helpers (no dependencies). Selectors and topics are precomputed (cast sig / cast keccak).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO, env, fetchText, readJson } from "./util.mjs";

export const SEL = {
  getReserves: "0x0902f1ac",
  token0: "0x0dfe1681",
  balanceOf: "0x70a08231",
  totalSupply: "0x18160ddd",
  latestRoundData: "0xfeaf968c",
  getPair: "0xe6a43905",
  profileOf: "0x2f8eb9cb",
};

export const TOPIC = {
  Letter: "0x379b6f12f0662600b811133588e3244fa1d704ab76bd96a76617a0d29955cfce", // MorningWood.Letter(uint256,address,string)
  Bought: "0x30d88f11437310f9fcd1ecd088e0cefb0042e7202e4935bd01cc1ddfd2009cef", // MorningWood.Bought(...)
  Burned: "0x70843ddf930435e28d0c0954f526e247ef46e54d00bd8e93a58c8be65ac66566", // PaperBurner.Burned(uint8,uint256,uint256)
  PacksBought: "0x773ad1776c35e76f6b682a79dbabe0c1643267e4f8abff42b5fbb343bc8ce838", // FireSale.PacksBought(...)
  Swap: "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", // UniswapV2Pair.Swap
};

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
