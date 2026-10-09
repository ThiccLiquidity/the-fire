// Unit tests for VerifySeries' pure parts (node --test). The whole check runs against a chain in ops/rehearsal; the
// image names are also cross-checked against the studio and the contract (studio/scripts/image-parity.test.ts,
// contracts/test/cards/ImageParity.t.sol).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allImageNames, imageName, loads, looksFor, recipeFromJson, recipeHash, retryAfterMs, STATES } from "./verify-series.mjs";

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
  // the same constant is asserted in studio/src/manifest.test.ts (the studio writes it into manifest.json)
  assert.equal(a, "6acc2a38b47895668716cef8bff923f37c125f86412b6604aa238db6b6e30ce1");
  assert.equal(recipeHash({ ...standard, imagesBase: "ipfs://other/", sale: { start: 1 } }), a);
  assert.notEqual(recipeHash({ ...standard, characters: standard.characters.slice(1) }), a);
});

test("Retry-After: seconds or an HTTP date", () => {
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs(undefined), undefined);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(retryAfterMs("soon"), undefined);
});

test("loads: a 429 pauses the gateway for its Retry-After and doesn't use up the tries; 404 is a miss", async () => {
  const res = (status, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers) });
  const waits = [];
  const sleepFn = async (ms) => { waits.push(ms); };
  let n = 0;
  const gw = { pauseUntil: 0, throttled: 0 };
  const ok = await loads("https://g/x", async () => (++n <= 4 ? res(429, { "retry-after": "2" }) : res(200)), gw, { tries: 2, sleepFn });
  assert.equal(ok, true);
  assert.equal(n, 5, "four 429s, then it loads: the 429s didn't count as failed tries");
  assert.equal(gw.throttled, 4);
  assert.ok(gw.pauseUntil > Date.now(), "the whole gateway is paused");
  assert.ok(waits.some((w) => w > 1000), "waited about the Retry-After");
  assert.equal(await loads("https://g/y", async () => res(404), { pauseUntil: 0, throttled: 0 }, { sleepFn }), false);
  let m = 0;
  assert.equal(await loads("https://g/z", async () => { m++; return res(429); }, { pauseUntil: 0, throttled: 0 }, { tries: 2, maxThrottle: 3, sleepFn }), false);
  assert.equal(m, 5, "gives up after maxThrottle 429s plus its tries");
});
