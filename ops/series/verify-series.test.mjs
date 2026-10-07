// Unit tests for VerifySeries' pure parts (node --test). The whole check runs against a chain in ops/rehearsal; the
// image names are also cross-checked against the studio and the contract (studio/scripts/image-parity.test.ts,
// contracts/test/cards/ImageParity.t.sol).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allImageNames, imageName, looksFor, recipeFromJson, recipeHash, STATES } from "./verify-series.mjs";

const standard = JSON.parse(readFileSync(new URL("../../contracts/test/cards/recipe-standard.json", import.meta.url), "utf8"));

test("Standard recipe: 18 looks per character (4 types x 4 holo, Gold full, Full Art full) x 12 states", () => {
  const r = recipeFromJson(standard);
  assert.deepEqual(r.types.map((_, t) => looksFor(r, t).length), [4, 4, 4, 4, 1, 1]);
  assert.equal(STATES.length, 12);
  assert.equal(allImageNames(r, 3).length, 3 * 18 * 12);
  assert.equal(imageName(2, "coal", "full", "10"), "c2-coal-full-10.webp");
});

test("a rank range with no top means 'or better'; a list slot has no rank range", () => {
  const r = recipeFromJson(standard);
  assert.equal(r.slots[2].maxRank, 4294967295n);
  assert.equal(r.slots[0].maxRank, 0n);
});

test("holo looks follow the dealer: certain holo has no 'none'; a must-holo-only type has no 'none'", () => {
  const j = structuredClone(standard);
  j.types[0].holo = { mode: "independent", frame: "1000000000000000000", picture: "0" };
  let r = recipeFromJson(j);
  assert.deepEqual(looksFor(r, 0), ["frame"]);
  j.types[0].holo = { mode: "independent", frame: "5", picture: "7" };
  j.slots[0].mustHolo = true;
  r = recipeFromJson(j);
  assert.deepEqual(looksFor(r, 0), ["frame", "picture", "full"], "paper only sits in a must-holo slot");
  j.types[2].holo = { mode: "distribution", weights: ["3", "0", "2", "0"] };
  r = recipeFromJson(j);
  assert.deepEqual(looksFor(r, 2), ["none", "picture"]);
});

test("recipe hash: the studio's manifest fingerprint ignores imagesBase and the sale block", () => {
  const a = recipeHash(standard);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(recipeHash({ ...standard, imagesBase: "ipfs://other/", sale: { start: 1 } }), a);
  assert.notEqual(recipeHash({ ...standard, characters: standard.characters.slice(1) }), a);
});
