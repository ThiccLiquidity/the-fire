// Unit tests for launch.mjs' helpers (the whole launch runs on anvil in launch-e2e.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync, createDecipheriv } from "node:crypto";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseStart, batchACalls, planHash, dropDiffs, keystoreV3, readDotEnv, lastError, usd8 } from "./launch.mjs";

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

test("planHash changes with the recipe, start, root and no-holders", () => {
  const h = planHash("{}", 1n, "0x1", false);
  assert.equal(h, planHash("{}", 1n, "0x1", false));
  for (const other of [planHash("{ }", 1n, "0x1", false), planHash("{}", 2n, "0x1", false), planHash("{}", 1n, "0x2", false), planHash("{}", 1n, "0x1", true)]) assert.notEqual(h, other);
});

test("dropDiffs names what differs", () => {
  const drop = { start: 10n, packs: 117n, starters: 50n, priceUsd: 250000000n, paperPerPack: 10n ** 18n, holderWindow: 86400n, holderRoot: "0xAB" };
  assert.deepEqual(dropDiffs(drop, { start: "10", packs: 117, starters: 50, priceUsd: "250000000", paperPerPack: "1000000000000000000", holderWindow: 86400, holderRoot: "0xab" }), []);
  assert.match(dropDiffs(drop, { start: "11", priceUsd: "1" }).join(), /start 10 \(meant 11\).*priceUsd/);
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
