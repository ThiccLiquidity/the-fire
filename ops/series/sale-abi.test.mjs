// The hand-written FireSale / FireGroups ABI slices (sale-abi.mjs) against the compiled contracts (contracts/out,
// `forge build`): every item has the same inputs and outputs. Skipped when the contracts aren't built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { saleAbi, groupsAbi } from "./sale-abi.mjs";

const out = (n) => new URL(`../../contracts/out/${n}.sol/${n}.json`, import.meta.url);
const built = existsSync(out("FireSale")) && existsSync(out("FireGroups"));

/** "(uint64,uint8,...)[]": a parameter list with tuples spelled out, names and indexing left out. */
export const canon = (ps = []) => ps.map((p) => (p.type.startsWith("tuple") ? `(${canon(p.components)})${p.type.slice(5)}` : p.type)).join(",");

for (const [name, slice] of [["FireSale", saleAbi], ["FireGroups", groupsAbi]]) {
  test(`${name}: the ops ABI slice matches contracts/out`, { skip: !built && "contracts not built (forge build)" }, () => {
    const full = JSON.parse(readFileSync(out(name), "utf8")).abi;
    for (const item of slice.filter((x) => x.type === "function" || x.type === "event")) {
      const got = full.find((x) => x.type === item.type && x.name === item.name);
      assert.ok(got, `${name}.${item.name} isn't in the contract`);
      assert.equal(canon(item.inputs), canon(got.inputs), `${name}.${item.name} inputs`);
      assert.equal(canon(item.outputs), canon(got.outputs), `${name}.${item.name} outputs`);
      if (item.type === "event") assert.deepEqual(item.inputs.map((i) => !!i.indexed), got.inputs.map((i) => !!i.indexed), `${name}.${item.name} indexed`);
      if (item.type === "function") assert.equal(item.stateMutability, got.stateMutability, `${name}.${item.name} mutability`);
    }
  });
}
