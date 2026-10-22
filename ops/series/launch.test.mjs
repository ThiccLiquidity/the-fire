// Unit tests for launch.mjs' helpers (the whole launch runs on anvil in launch-e2e.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync, createDecipheriv } from "node:crypto";
import { keccak256, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseStart, batchACalls, planHash, keystoreV3, readDotEnv, lastError, usd8, snapshotSpecs, snapshotArgs, holdersFile } from "./launch.mjs";
import { buildTree, verify } from "../snapshot/merkle.mjs";

test("parseStart: local time, unix seconds, bad input", () => {
  const local = parseStart("2026-11-01 18:00");
  assert.equal(local, BigInt(new Date(2026, 10, 1, 18, 0).getTime() / 1000));
  assert.equal(parseStart("2026-11-01T18:00"), local);
  assert.equal(parseStart("2026-11-01 18:00", { utc: true }), 1793556000n);
  assert.equal(parseStart("1793556000"), 1793556000n);
  assert.throws(() => parseStart("1 Nov 2026"), /YYYY-MM-DD HH:MM/);
  assert.throws(() => parseStart("2026-02-30 10:00"), /isn't a real date/);
});

test("batchACalls: setRecipe, characters in 200s, setDealer, setImagesBase", () => {
  const chars = (n) => Array.from({ length: n }, (_, i) => ({ name: `c${i}`, category: "x" }));
  assert.equal(batchACalls({ characters: chars(3), imagesBase: "ipfs://x/" }), 4);
  assert.equal(batchACalls({ characters: chars(401), imagesBase: "ipfs://x/" }), 6);
  assert.equal(batchACalls({ characters: chars(200) }), 3);
});

test("planHash changes with the recipe, start and any snapshot root", () => {
  const h = planHash("{}", 1n, { 1: "0xAA" });
  assert.equal(h, planHash("{}", 1n, { 1: "0xaa" }), "case doesn't matter");
  for (const other of [planHash("{ }", 1n, { 1: "0xaa" }), planHash("{}", 2n, { 1: "0xaa" }), planHash("{}", 1n, { 1: "0xab" }), planHash("{}", 1n, { 1: "0xaa", 3: "0x1" }), planHash("{}", 1n)]) assert.notEqual(h, other);
});

const GROUPS = [{ name: "Press", gate: "nft" }, { name: "PLANK holders", gate: "snapshot" }, { name: "Everyone", gate: "open" }, { gate: "snapshot" }];

test("the snapshots side file: every snapshot group by its index, nothing else, known keys only", () => {
  const side = { 1: { token: "plank", minUsd: 69, days: 7 }, 3: { token: "0x1234567890123456789012345678901234567890", min: "1000000", tiers: "1000000:1,10000000:2" } };
  assert.deepEqual(Object.keys(snapshotSpecs(side, GROUPS)), ["1", "3"]);
  assert.throws(() => snapshotSpecs({ 1: side[1] }, GROUPS), /group 4 is a snapshot group: say whose wallets it takes under its index, e.g. "3"/);
  assert.throws(() => snapshotSpecs({ ...side, 2: side[1] }, GROUPS), /"2": group 3 \(Everyone\) isn't a snapshot group/);
  assert.throws(() => snapshotSpecs({ ...side, 9: side[1] }, GROUPS), /no group of index 9/);
  assert.throws(() => snapshotSpecs({ ...side, 1: { ...side[1], minimum: 3 } }, GROUPS), /unknown key\(s\) minimum/);
  assert.throws(() => snapshotSpecs({ ...side, 1: { minUsd: 69 } }, GROUPS), /no token/);
  assert.throws(() => snapshotSpecs({ ...side, 1: { token: "plank" } }, GROUPS), /give min/);
  assert.throws(() => snapshotSpecs({ ...side, 1: { token: "plank", min: 1, minUsd: 2 } }, GROUPS), /not both/);
  assert.deepEqual(Object.keys(snapshotSpecs({ ...side, 1: { file: "g1.json" } }, GROUPS)), ["1", "3"], "a file taken by hand");
});

test("snapshotArgs: the side file's spec as ops/snapshot flags; the run's defaults for days and blocks", () => {
  assert.deepEqual(snapshotArgs({ token: "plank", minUsd: 69 }, { out: "o.json", days: "0.02" }), ["--token", "plank", "--out", "o.json", "--min-usd", "69", "--days", "0.02"]);
  assert.deepEqual(snapshotArgs({ token: "press", min: 1, allowance: 2, days: 3, blocks: 4 }, { out: "o", days: "9", blocks: "9" }), ["--token", "press", "--out", "o", "--min", "1", "--allowance", "2", "--days", "3", "--blocks", "4"]);
  assert.deepEqual(snapshotArgs({ token: "0xab", tiers: [{ min: "5", allowance: 1 }, { min: "50", allowance: 3 }] }, { out: "o" }), ["--token", "0xab", "--out", "o", "--tiers", "5:1,50:3"]);
});

test("holdersFile: { groups: { <index>: { root, wallets: { <lowercase address>: { allowance, proof } } } } }", () => {
  const W1 = getAddress("0x00000000000000000000000000000000000000a1");
  const W2 = getAddress("0x00000000000000000000000000000000000000b2");
  const t = buildTree([{ wallet: W1, allowance: 1 }, { wallet: W2, allowance: 3 }]);
  const snap = { root: t.root, token: "0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc", kind: "erc20", symbol: "PLANK", block: "77", wallets: { [W1]: { allowance: 1, proof: t.proofs[W1] }, [W2]: { allowance: 3, proof: t.proofs[W2] } } };
  const f = holdersFile({ fire: 7, chainId: 4663, groups: GROUPS, snaps: { 1: snap }, now: new Date(0) });
  assert.deepEqual(Object.keys(f), ["series", "chainId", "updated", "groups"]);
  assert.equal(f.series, 7);
  assert.deepEqual(Object.keys(f.groups), ["1"]);
  const g = f.groups["1"];
  assert.equal(g.root, t.root);
  assert.equal(g.name, "PLANK holders");
  assert.equal(g.count, 2);
  assert.deepEqual(Object.keys(g.wallets), [W1.toLowerCase(), W2.toLowerCase()]);
  for (const [w, a] of [[W1, 1], [W2, 3]]) {
    const x = g.wallets[w.toLowerCase()];
    assert.equal(x.allowance, a);
    assert.ok(verify(x.proof, g.root, w, x.allowance), "a buyer's allowance and proof verify against the root");
  }
});

test("keystoreV3 decrypts back to the key (standard scrypt / aes-128-ctr / keccak mac)", () => {
  const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const ks = keystoreV3(pk, "pw", { n: 1024 });
  const k = ks.crypto.kdfparams;
  const dk = scryptSync(Buffer.from("pw"), Buffer.from(k.salt, "hex"), 32, { N: k.n, r: k.r, p: k.p });
  const ct = Buffer.from(ks.crypto.ciphertext, "hex");
  assert.equal(keccak256(Buffer.concat([dk.subarray(16, 32), ct])).slice(2), ks.crypto.mac);
  const d = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(ks.crypto.cipherparams.iv, "hex"));
  assert.equal(`0x${Buffer.concat([d.update(ct), d.final()]).toString("hex")}`, pk);
  assert.equal(`0x${ks.address}`, privateKeyToAccount(pk).address.toLowerCase());
  assert.ok(!JSON.stringify(ks).includes(pk.slice(2)));
});

test("readDotEnv strips quotes and skips empty values", () => {
  const f = join(mkdtempSync(join(tmpdir(), "launch-")), ".env");
  writeFileSync(f, "# c\nOWNER_HD_PATH=\"m/44'/60'/1'/0/0\"\r\nRPC=\nPLANK=0xabc\n");
  assert.deepEqual(readDotEnv(f), { OWNER_HD_PATH: "m/44'/60'/1'/0/0", PLANK: "0xabc" });
  assert.deepEqual(readDotEnv(join(tmpdir(), "no-such-env")), {});
});

test("lastError picks the revert line; usd8", () => {
  assert.equal(lastError("Compiling...\nError: script failed: simulation: FireSale.configureDrop reverts\n"), "script failed: simulation: FireSale.configureDrop reverts.");
  assert.equal(usd8("250000000"), "$2.50");
});
