import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../lib/util.mjs";
import { keccak256, selectorOf, topicOf } from "../lib/keccak.mjs";
import { EVENT, SEL, TOPIC, decodeLog, u256Word } from "../lib/chain.mjs";

test("keccak256: Ethereum's hash (empty input, a multi-block input, a known topic and selector)", () => {
  assert.equal(keccak256(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256("a".repeat(300)), "0x5b7e0e47a96f32a88b4f14ca177982790807c40e1a105742ba0fc1babe1ef826");
  assert.equal(topicOf("Transfer(address,address,uint256)"), "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  assert.equal(selectorOf("balanceOf(address)"), "0x70a08231");
  assert.equal(SEL.getReserves, "0x0902f1ac");
  assert.equal(TOPIC.Swap, "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822");
});

/** An event's signature as the compiled ABI has it (the site's copies in web/src/lib/abi). */
function abiSig(file, name) {
  const abi = JSON.parse(readFileSync(resolve(REPO, "web/src/lib/abi", file), "utf8"));
  const e = abi.find((x) => x.type === "event" && x.name === name);
  assert.ok(e, `${name} isn't in ${file}`);
  return `${name}(${e.inputs.map((i) => i.type).join(",")})`;
}

test("the events the paper reads match the contracts' current ABIs", () => {
  assert.equal(EVENT.PacksBought.sig, abiSig("fireSaleAbi.json", "PacksBought"));
  assert.equal(EVENT.LiquidityBurned.sig, abiSig("liquidityBurnerAbi.json", "LiquidityBurned"));
  assert.equal(EVENT.OverCap.sig, abiSig("liquidityBurnerAbi.json", "OverCap"));
  assert.equal(EVENT.Bought.sig, abiSig("morningWoodAbi.json", "Bought"));
  assert.equal(EVENT.Letter.sig, abiSig("morningWoodAbi.json", "Letter"));
});

test("decodeLog: named fields, and a wrong or short log throws instead of reading 0", () => {
  const data = "0x" + [3n, 1n, 10n ** 15n, 7n].map(u256Word).join("");
  const log = { topics: [TOPIC.PacksBought, "0x" + u256Word(7)], data };
  assert.deepEqual(decodeLog("PacksBought", log), { count: 3n, pay: 1n, paid: 10n ** 15n, toLiquidity: 7n });
  assert.throws(() => decodeLog("PacksBought", { ...log, data: data.slice(0, 2 + 64 * 3) }), /bytes of data/);
  assert.throws(() => decodeLog("PacksBought", { ...log, topics: [TOPIC.LiquidityBurned] }), /isn't PacksBought/);
  assert.throws(() => decodeLog("Burned", log), /unknown event/);
});
