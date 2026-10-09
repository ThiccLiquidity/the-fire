// Unit tests for ops/deploy/record.mjs (node --test). The whole flow runs in ops/rehearsal against a real anvil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { broadcastIndex, merge, record } from "./record.mjs";

const a = (n) => `0x${String(n).repeat(40)}`;
const H = (n) => `0x${String(n).repeat(64)}`;

function setup({ main, pending, runs = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "record-"));
  const file = join(dir, "46630.json");
  if (main) writeFileSync(file, JSON.stringify(main));
  if (pending) writeFileSync(`${file}.pending`, JSON.stringify(pending));
  const bdir = join(dir, "broadcast");
  for (const [script, txs] of Object.entries(runs)) {
    mkdirSync(join(bdir, script, "46630"), { recursive: true });
    writeFileSync(join(bdir, script, "46630", "run-latest.json"), JSON.stringify({ transactions: txs }));
  }
  return { file, bdir };
}

/** A fake chain: `code` addresses have code; `receipts` hash -> status. */
const fakeClient = ({ code = [], receipts = {} } = {}) => ({
  getChainId: async () => 46630,
  getCode: async ({ address }) => (code.map((x) => x.toLowerCase()).includes(address.toLowerCase()) ? "0x60" : undefined),
  getTransactionReceipt: async ({ hash }) => {
    if (!(hash in receipts)) throw new Error("not found");
    return { status: receipts[hash], blockNumber: 50n };
  },
});

test("broadcastIndex: CREATE addresses and contracts created inside a call", () => {
  const { bdir } = setup({ runs: { "DeployTwap.s.sol": [{ hash: H(1), contractAddress: a(1) }, { hash: H(2), additionalContracts: [{ address: a(2) }] }] } });
  const idx = broadcastIndex(bdir, 46630);
  assert.equal(idx.get(a(1)).hash, H(1));
  assert.equal(idx.get(a(2)).hash, H(2));
  assert.equal(broadcastIndex(bdir, 4663).size, 0, "only this chain's broadcasts");
});

test("merge: keeps what's there, adds the new, keeps the first deployer and start block", () => {
  const m = merge({ chainId: 1, startBlock: 5, deployer: a(9), inputs: { PAPER: a(1) }, contracts: { PlankUsdTwap: a(2) } },
    { chainId: 1, startBlock: 9, deployer: a(8), owner: a(7), inputs: { PLANK: a(3) }, contracts: { FireCards: a(4) } }, 7n);
  assert.deepEqual(Object.keys(m), ["chainId", "startBlock", "deployer", "owner", "inputs", "contracts"]);
  assert.equal(m.startBlock, 5);
  assert.equal(m.deployer, a(9));
  assert.deepEqual(m.inputs, { PAPER: a(1), PLANK: a(3) });
  assert.deepEqual(m.contracts, { PlankUsdTwap: a(2), FireCards: a(4) });
  assert.equal(merge(undefined, { chainId: 1, startBlock: 9, contracts: {} }, 7n).startBlock, 7);
});

test("record: a landed broadcast is merged and the .pending file removed", async () => {
  const { file, bdir } = setup({
    main: { chainId: 46630, inputs: {}, contracts: {} },
    pending: { chainId: 46630, startBlock: 60, inputs: { PLANK: a(5), REVENUE_WALLET: a(6) }, contracts: { PlankUsdTwap: a(1) } },
    runs: { "DeployTwap.s.sol": [{ hash: H(1), contractAddress: a(1) }] },
  });
  const r = await record({ client: fakeClient({ code: [a(1), a(5)], receipts: { [H(1)]: "success" } }), file, broadcastDir: bdir, log: () => {} });
  assert.equal(r.ok, true, r.problems.join("; "));
  const j = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(j.contracts.PlankUsdTwap, a(1));
  assert.equal(j.inputs.REVENUE_WALLET, a(6), "wallet inputs need no code");
  assert.equal(j.startBlock, 50, "the earliest of the script's block and the receipts");
  assert.equal(existsSync(`${file}.pending`), false);
});

test("record: refuses a broadcast that didn't land, a reverted one, a stale file, the wrong chain", async () => {
  const pending = { chainId: 46630, inputs: {}, contracts: { PlankUsdTwap: a(1) } };
  const runs = { "DeployTwap.s.sol": [{ hash: H(1), contractAddress: a(1) }] };
  let s = setup({ pending, runs });
  let r = await record({ client: fakeClient(), file: s.file, broadcastDir: s.bdir, log: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /no contract code/);
  assert.equal(existsSync(`${s.file}.pending`), true, "the .pending file stays");
  assert.equal(existsSync(s.file), false, "nothing written");
  s = setup({ pending, runs });
  r = await record({ client: fakeClient({ code: [a(1)], receipts: { [H(1)]: "reverted" } }), file: s.file, broadcastDir: s.bdir, log: () => {} });
  assert.match(r.problems[0], /reverted/);
  s = setup({ pending, runs });
  r = await record({ client: fakeClient({ code: [a(1)] }), file: s.file, broadcastDir: s.bdir, log: () => {} });
  assert.match(r.problems[0], /isn't on this chain/);
  s = setup({ pending: { ...pending, chainId: 4663 }, runs });
  r = await record({ client: fakeClient({ code: [a(1)], receipts: { [H(1)]: "success" } }), file: s.file, broadcastDir: s.bdir, log: () => {} });
  assert.match(r.problems[0], /chain 4663/);
  s = setup({ pending: { chainId: 46630, inputs: { PAPER: a(3) }, contracts: {} } });
  r = await record({ client: fakeClient(), file: s.file, broadcastDir: s.bdir, log: () => {} });
  assert.match(r.problems[0], /input PAPER/);
  s = setup({});
  r = await record({ client: fakeClient(), file: s.file, broadcastDir: s.bdir, log: () => {} });
  assert.match(r.problems[0], /nothing to record/);
});

test("record: an existing contract given as an input (not broadcast here) only needs code", async () => {
  const { file, bdir } = setup({ pending: { chainId: 46630, inputs: {}, contracts: { OpenDrandRouter: a(4) } } });
  const r = await record({ client: fakeClient({ code: [a(4)] }), file, broadcastDir: bdir, log: () => {} });
  assert.equal(r.ok, true);
  assert.match(r.notes[0], /not created by a broadcast here/);
});
