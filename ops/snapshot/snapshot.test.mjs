// Unit tests for the snapshot (node --test): what counts (LP share, EIP-7702 wallets, the smallest holding over the
// blocks) and the verify mode, against a fake chain. The whole snapshot runs on anvil in ops/rehearsal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import { buildTree } from './merkle.mjs'
import { isWallet, lpShare, blockTimes, minBalances, takeSnapshot, verifySnapshot, compareSnapshots, MULTICALL3 } from './snapshot.mjs'

const E = 10n ** 18n
const A = (n) => getAddress(`0x${n.toString(16).padStart(40, '0')}`)
const PLANK = A(0x1000), FEED = A(0x1001), PAIR = A(0x1002), WETH = A(0x1003), FACTORY = A(0x1004)
const HOLDER = A(0xa1), LPER = A(0xa2), DELEGATED = A(0xa3), CONTRACT = A(0xa4), BORROWER = A(0xa5), SMALL = A(0xa6)
const DEAD = '0x000000000000000000000000000000000000dEaD'
const LAST = 100n

/** A chain of 101 blocks, 12 s apart. PLANK balances and the pool's LP per block; px $1 a PLANK. */
function fakeChain({ multicall = true, extraPlank = {} } = {}) {
  const plank = (w, b) => {
    if (extraPlank[w]) return extraPlank[w](b)
    if (w === HOLDER || w === DELEGATED || w === CONTRACT) return 100n * E
    if (w === BORROWER) return b === LAST ? 1000n * E : 0n // borrowed for the last block only
    if (w === SMALL) return 50n * E
    if (w === getAddress(DEAD)) return 10n ** 6n * E
    if (w === PAIR) return 300n * E
    return 0n
  }
  const lp = (w) => (w === LPER ? 50n * E : w === A(0) ? 1000n : 0n) // LPER holds half the LP: 150 PLANK of the 300 in the pool
  const code = { [DELEGATED]: `0xef0100${'ab'.repeat(20)}`, [CONTRACT]: '0x6080604052', [PAIR]: '0x60', [MULTICALL3]: multicall ? '0x60' : '0x' }
  const reads = { calls: 0, multicalls: 0 }
  const readContract = async ({ address, functionName, args = [], blockNumber }) => {
    reads.calls++
    const b = blockNumber ?? LAST
    if (address === FEED && functionName === 'latestRoundData') return [0n, E, 0n, 1000n + 12n * b - 60n, 0n]
    if (address === FEED && functionName === 'prev') return [0n, Number(1000n + 12n * b - 1800n)]
    if (address === PLANK && functionName === 'balanceOf') return plank(getAddress(args[0]), b)
    if (address === PAIR) {
      if (functionName === 'token0') return PLANK
      if (functionName === 'token1') return WETH
      if (functionName === 'totalSupply') return 100n * E
      if (functionName === 'getReserves') return [300n * E, 1n * E, 0]
      if (functionName === 'balanceOf') return lp(getAddress(args[0]))
    }
    if (address === FACTORY && functionName === 'getPair') return PAIR
    throw new Error(`no fake for ${address}.${functionName}`)
  }
  const transfers = (address) => {
    if (address === PLANK) return [HOLDER, DELEGATED, CONTRACT, BORROWER, SMALL, DEAD, PAIR]
    if (address === PAIR) return [A(0), LPER]
    return []
  }
  return {
    reads,
    getBlockNumber: async () => LAST,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, timestamp: 1000n + 12n * blockNumber }),
    getCode: async ({ address }) => code[getAddress(address)],
    getLogs: async ({ address, fromBlock }) => (fromBlock === 0n ? transfers(getAddress(address)).map((to) => ({ args: { to } })) : []),
    readContract,
    multicall: async ({ contracts, blockNumber }) => {
      reads.multicalls++
      return Promise.all(contracts.map((c) => readContract({ ...c, blockNumber }).then((result) => ({ status: 'success', result }), () => ({ status: 'failure' }))))
    },
  }
}
const opts = (client, more = {}) => ({ client, plank: PLANK, feed: FEED, minUsd: 69, blocks: 5, days: 0.01, seed: 'ab12', discover: { pair: PAIR, factory: FACTORY, quotes: [WETH] }, ...more })

test('a regular wallet: no code, or an EIP-7702 delegation', () => {
  assert.equal(isWallet('0x'), true)
  assert.equal(isWallet(undefined), true)
  assert.equal(isWallet(`0xef0100${'12'.repeat(20)}`), true)
  assert.equal(isWallet(`0xEF0100${'Ab'.repeat(20)}`), true)
  assert.equal(isWallet('0x6080604052'), false)
  assert.equal(isWallet(`0xef0100${'12'.repeat(19)}`), false, 'not a whole delegation')
  assert.equal(isWallet(`0xef0100${'12'.repeat(20)}00`), false)
})

test('LP share and the smallest holding over the blocks', () => {
  assert.equal(lpShare(50n, 100n, 300n), 150n)
  assert.equal(lpShare(5n, 0n, 300n), 0n)
  const m = minBalances([new Map([['a', 5n], ['b', 9n]]), new Map([['a', 7n], ['b', 2n]]), new Map([['a', 6n]])])
  assert.deepEqual([...m], [['a', 5n], ['b', 0n]], 'missing from a block: held 0 there')
})

test('the blocks come from the seed, inside the window', () => {
  const t = blockTimes('ab12', 10_000n, 1, 5)
  assert.equal(t.length, 4)
  assert.deepEqual(t, blockTimes('ab12', 10_000n, 1, 5))
  assert.notDeepEqual(t, blockTimes('ab13', 10_000n, 1, 5))
  for (const x of t) assert.ok(x < 10_000n && x >= 10_000n - 86_400n)
})

for (const multicall of [true, false]) {
  test(`snapshot (${multicall ? 'Multicall3' : 'one read at a time'}): LP holders pro rata, 7702 wallets in, contracts, dead and a one-block loan out`, async () => {
    const client = fakeChain({ multicall })
    const s = await takeSnapshot(opts(client))
    assert.deepEqual(s.holders.map((h) => h.wallet).sort(), [HOLDER, LPER, DELEGATED].sort())
    assert.equal(s.holders.find((h) => h.wallet === LPER).plank, String(150n * E), 'half the LP: half the pool\'s 300 PLANK')
    assert.equal(s.count, 3)
    assert.equal(s.root, buildTree([HOLDER, LPER, DELEGATED]).root)
    assert.deepEqual(s.pairs, [{ pair: PAIR, plankIs0: true }])
    assert.equal(s.blocks.at(-1), '100')
    assert.ok(s.blocks.length >= 2, `several blocks: ${s.blocks}`)
    assert.equal(s.seed, 'ab12')
    assert.equal(s.minPlank, String(69n * E))
    if (multicall) assert.ok(client.reads.multicalls > 0, 'reads went through Multicall3')
    else assert.equal(client.reads.multicalls, 0)
  })
}

test('a holding that dips in one of the blocks doesn\'t count', async () => {
  const s0 = await takeSnapshot(opts(fakeChain()))
  const dip = BigInt(s0.blocks[0])
  const s = await takeSnapshot(opts(fakeChain({ extraPlank: { [HOLDER]: (b) => (b === dip ? 0n : 100n * E) } })))
  assert.ok(!s.holders.some((h) => h.wallet === HOLDER))
})

test('verify: the same chain is GREEN; a wallet added by hand, a changed amount or other blocks are RED', async () => {
  const client = fakeChain()
  const snap = await takeSnapshot(opts(client))
  const discover = { pair: PAIR, factory: FACTORY, quotes: [WETH] }
  let v = await verifySnapshot({ client, snap, discover })
  assert.deepEqual(v.problems, [])
  assert.equal(v.ok, true)

  // a wallet slipped in, the tree rebuilt so the file is self-consistent
  const added = structuredClone(snap)
  added.holders.push({ wallet: SMALL, plank: String(100n * E) })
  const t = buildTree(added.holders.map((h) => h.wallet))
  Object.assign(added, { root: t.root, proofs: t.proofs, count: added.holders.length })
  v = await verifySnapshot({ client, snap: added, discover })
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p.includes(SMALL) && /doesn't qualify on chain/.test(p)), v.problems.join('\n'))
  assert.ok(v.problems.some((p) => /^root/.test(p)))

  const amount = structuredClone(snap)
  amount.holders[0].plank = '1'
  assert.ok((await verifySnapshot({ client, snap: amount })).problems.some((p) => /file 1 PLANK wei/.test(p)))

  const blocks = structuredClone(snap)
  blocks.blocks[0] = '1'
  assert.ok((await verifySnapshot({ client, snap: blocks })).problems.some((p) => /^blocks/.test(p)), 'blocks must follow from the seed')

  const nopool = structuredClone(snap)
  nopool.pairs = []
  v = await verifySnapshot({ client, snap: nopool, discover })
  assert.ok(v.problems.some((p) => /PLANK pools/.test(p)) && v.problems.some((p) => p.includes(LPER)), 'an LP holder left out with its pool')

  assert.equal((await verifySnapshot({ client, snap: { root: snap.root, holders: snap.holders } })).ok, false, 'an old single-block file')
})

test('compareSnapshots: a proof edited in the file', () => {
  const t = buildTree([HOLDER, LPER])
  const f = { root: t.root, proofs: { ...t.proofs, [HOLDER]: [] }, count: 2, holders: [{ wallet: HOLDER, plank: '1' }, { wallet: LPER, plank: '1' }], blocks: ['1'], block: '1', plank: PLANK, minPlank: '1', plankUsd: '1' }
  assert.ok(compareSnapshots(f, { ...f, proofs: t.proofs, blocks: ['1'] }).some((p) => /proof/.test(p)))
})
