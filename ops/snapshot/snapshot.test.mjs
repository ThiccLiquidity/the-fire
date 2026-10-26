// Unit tests for the snapshot (node --test): what counts (LP share, EIP-7702 wallets, the smallest holding over the
// blocks), any ERC-20 or ERC-721, allowance tiers, the leaves FireGroups checks, and the verify mode, against a fake
// chain. The whole snapshot runs on anvil in ops/rehearsal, where a proof from it buys in a snapshot group on the real
// FireGroups.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getAddress } from 'viem'
import { buildTree, leafOf, verify } from './merkle.mjs'
import { isWallet, lpShare, blockTimes, minBalances, checkLogSource, takeSnapshot, verifySnapshot, compareSnapshots, parseTiers, allowanceFor, usdToRaw, SELFTEST, MULTICALL3 } from './snapshot.mjs'

const E = 10n ** 18n
const A = (n) => getAddress(`0x${n.toString(16).padStart(40, '0')}`)
const PLANK = A(0x1000), FEED = A(0x1001), PAIR = A(0x1002), WETH = A(0x1003), FACTORY = A(0x1004), NFT = A(0x1005)
const HOLDER = A(0xa1), LPER = A(0xa2), DELEGATED = A(0xa3), CONTRACT = A(0xa4), BORROWER = A(0xa5), SMALL = A(0xa6), WHALE = A(0xa7)
const DEAD = '0x000000000000000000000000000000000000dEaD'
const LAST = 100n

/** A chain of 101 blocks, 12 s apart. PLANK balances and the pool's LP per block; px $1 a PLANK. An NFT: HOLDER has
 *  2, SMALL 1, CONTRACT 3. */
function fakeChain({ multicall = true, extraPlank = {} } = {}) {
  const plank = (w, b) => {
    if (extraPlank[w]) return extraPlank[w](b)
    if (w === HOLDER || w === DELEGATED || w === CONTRACT) return 100n * E
    if (w === WHALE) return 5000n * E
    if (w === BORROWER) return b === LAST ? 1000n * E : 0n // borrowed for the last block only
    if (w === SMALL) return 50n * E
    if (w === getAddress(DEAD)) return 10n ** 6n * E
    if (w === PAIR) return 300n * E
    return 0n
  }
  const nfts = { [HOLDER]: 2n, [SMALL]: 1n, [CONTRACT]: 3n }
  const lp = (w) => (w === LPER ? 50n * E : w === A(0) ? 1000n : 0n) // LPER holds half the LP: 150 PLANK of the 300 in the pool
  const code = { [DELEGATED]: `0xef0100${'ab'.repeat(20)}`, [CONTRACT]: '0x6080604052', [PAIR]: '0x60', [MULTICALL3]: multicall ? '0x60' : '0x' }
  const reads = { calls: 0, multicalls: 0 }
  const readContract = async ({ address, functionName, args = [], blockNumber }) => {
    reads.calls++
    const b = blockNumber ?? LAST
    if (address === FEED && functionName === 'latestRoundData') return [0n, E, 0n, 1000n + 12n * b - 60n, 0n]
    if (address === FEED && functionName === 'prev') return [0n, Number(1000n + 12n * b - 1800n)]
    if (address === PLANK && functionName === 'balanceOf') return plank(getAddress(args[0]), b)
    if (address === PLANK && functionName === 'decimals') return 18
    if (address === PLANK && functionName === 'symbol') return 'PLANK'
    if (address === NFT && functionName === 'supportsInterface') return args[0] === '0x80ac58cd'
    if (address === NFT && functionName === 'balanceOf') return nfts[getAddress(args[0])] ?? 0n
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
    if (address === PLANK) return [HOLDER, DELEGATED, CONTRACT, BORROWER, SMALL, WHALE, DEAD, PAIR]
    if (address === PAIR) return [A(0), LPER]
    if (address === NFT) return [HOLDER, SMALL, CONTRACT]
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
const discover = { pair: PAIR, factory: FACTORY, quotes: [WETH] }
const opts = (client, more = {}) => ({ client, token: PLANK, feed: FEED, minUsd: 69, blocks: 5, days: 0.01, seed: 'ab12', discover, ...more })
const holders = (s) => Object.fromEntries(s.holders.map((h) => [h.wallet, h.allowance]))

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

test('tiers: parsed lowest first; a holding gets the highest tier it reaches, else the flat allowance', () => {
  assert.deepEqual(parseTiers('10000000:2, 1000000:1,100000000:5'), [{ min: '1000000', allowance: 1 }, { min: '10000000', allowance: 2 }, { min: '100000000', allowance: 5 }])
  assert.deepEqual(parseTiers([{ min: '5', allowance: 3 }]), [{ min: '5', allowance: 3 }])
  assert.deepEqual(parseTiers(undefined), [])
  assert.throws(() => parseTiers('100:0'), /allowance/)
  assert.throws(() => parseTiers('x:1'), /minimum/)
  assert.throws(() => parseTiers('5:1,5:2'), /twice/)
  const tiers = [{ minRaw: '10', allowance: 1 }, { minRaw: '100', allowance: 2 }, { minRaw: '1000', allowance: 5 }]
  assert.equal(allowanceFor(5n, tiers, 1), 1)
  assert.equal(allowanceFor(10n, tiers, 7), 1)
  assert.equal(allowanceFor(999n, tiers, 1), 2)
  assert.equal(allowanceFor(10n ** 9n, tiers, 1), 5)
  assert.equal(usdToRaw(69, E, 18), 69n * E, '$69 at $1 a token')
  assert.equal(usdToRaw('0.5', 2n * E, 6), 250000n, '$0.50 of a 6-decimal $2 token')
})

test('leaves are FireGroups\': keccak256(bytes.concat(keccak256(abi.encode(wallet, allowance))))', () => {
  // computed with cast (an independent abi.encode + keccak): cast keccak $(cast keccak $(cast abi-encode "f(address,uint256)" <w> <a>))
  const want = {
    '0x00000000000000000000000000000000000000A1': '0xe0885c5bb4f13c6d7b7686bfaa660f1962fb129889f37cb020a8e19549fc16f9',
    '0x00000000000000000000000000000000000000C3': '0x5f2ab5dc675fb4fe03fb98fb41d1994213d32ec7c74e7773ca937e8bda2a4ed2',
    '0x00000000000000000000000000000000000000D4': '0x5533ebbb4def7408d7a928bbcdc67ec9597c42e27cc7c6f3a9e994cb922fb3a2',
  }
  for (const [w, a] of SELFTEST) assert.equal(leafOf(w, a), want[w])
  assert.notEqual(leafOf(SELFTEST[0][0], 2), want[SELFTEST[0][0]], 'the allowance is in the leaf')
  // and live, when Foundry's cast is installed
  const cast = [resolve(homedir(), '.foundry/bin/cast'), '/root/.foundry/bin/cast'].find(existsSync)
  if (cast) {
    for (const [w, a] of [[HOLDER, 3], [WHALE, 123456]]) {
      const enc = execFileSync(cast, ['abi-encode', 'f(address,uint256)', w, String(a)], { encoding: 'utf8' }).trim()
      const inner = execFileSync(cast, ['keccak', enc], { encoding: 'utf8' }).trim()
      assert.equal(execFileSync(cast, ['keccak', inner], { encoding: 'utf8' }).trim(), leafOf(w, a))
    }
  }
  // OpenZeppelin MerkleProof (sorted pairs): every proof verifies; a one-wallet tree's root is its leaf
  const t = buildTree(SELFTEST.map(([wallet, allowance]) => ({ wallet, allowance })))
  for (const [w, a] of SELFTEST) assert.ok(verify(t.proofs[getAddress(w)], t.root, w, a))
  assert.ok(!verify(t.proofs[getAddress(SELFTEST[1][0])], t.root, SELFTEST[1][0], 3), 'another allowance fails')
  assert.equal(buildTree([{ wallet: HOLDER, allowance: 1 }]).root, leafOf(HOLDER, 1))
  assert.throws(() => buildTree([{ wallet: HOLDER, allowance: 1 }, { wallet: HOLDER.toLowerCase(), allowance: 2 }]), /twice/)
})

for (const multicall of [true, false]) {
  test(`snapshot (${multicall ? 'Multicall3' : 'one read at a time'}): LP holders pro rata, 7702 wallets in, contracts, dead and a one-block loan out`, async () => {
    const client = fakeChain({ multicall })
    const s = await takeSnapshot(opts(client))
    assert.deepEqual(s.holders.map((h) => h.wallet).sort(), [HOLDER, LPER, DELEGATED, WHALE].sort())
    assert.equal(s.holders.find((h) => h.wallet === LPER).balance, String(150n * E), 'half the LP: half the pool\'s 300 PLANK')
    assert.equal(s.count, 4)
    assert.equal(s.root, buildTree(s.holders.map((h) => ({ wallet: h.wallet, allowance: 1 }))).root)
    assert.deepEqual(s.pairs, [{ pair: PAIR, tokenIs0: true }])
    assert.equal(s.blocks.at(-1), '100')
    assert.ok(s.blocks.length >= 2, `several blocks: ${s.blocks}`)
    assert.equal(s.seed, 'ab12')
    assert.equal(s.minRaw, String(69n * E))
    assert.equal(s.kind, 'erc20')
    assert.equal(s.unit, 'usd')
    for (const h of s.holders) {
      assert.equal(h.allowance, 1)
      assert.deepEqual(s.wallets[h.wallet], { allowance: 1, proof: buildTree(s.holders).proofs[h.wallet] })
      assert.ok(verify(s.wallets[h.wallet].proof, s.root, h.wallet, 1))
    }
    if (multicall) assert.ok(client.reads.multicalls > 0, 'reads went through Multicall3')
    else assert.equal(client.reads.multicalls, 0)
  })
}

test('tiers in tokens: any ERC-20 by --min; allowances by holding', async () => {
  const s = await takeSnapshot(opts(fakeChain(), { minUsd: undefined, feed: undefined, min: '100', tiers: '100:1,140:2,1000:5' }))
  assert.equal(s.unit, 'token')
  assert.deepEqual(holders(s), { [HOLDER]: 1, [LPER]: 2, [DELEGATED]: 1, [WHALE]: 5 })
  assert.deepEqual(s.tiers.map((t) => t.minRaw), [String(100n * E), String(140n * E), String(1000n * E)])
  for (const h of s.holders) assert.ok(verify(s.wallets[h.wallet].proof, s.root, h.wallet, h.allowance))
  const lowest = await takeSnapshot(opts(fakeChain(), { minUsd: undefined, min: undefined, tiers: '140:2' }))
  assert.deepEqual(holders(lowest), { [LPER]: 2, [WHALE]: 2 }, 'no --min: the lowest tier is the minimum')
  const flat = await takeSnapshot(opts(fakeChain(), { minUsd: undefined, min: '40', allowance: 3 }))
  assert.equal(flat.holders.find((h) => h.wallet === SMALL).allowance, 3)
  const usdTiers = await takeSnapshot(opts(fakeChain(), { tiers: '1000:4' }))
  assert.deepEqual(holders(usdTiers), { [HOLDER]: 1, [LPER]: 1, [DELEGATED]: 1, [WHALE]: 4 }, 'with --min-usd the tiers are dollars')
  await assert.rejects(takeSnapshot(opts(fakeChain(), { minUsd: undefined })), /give a minimum/)
})

test('an ERC-721: detected by ERC-165, counted by balanceOf, no pools; contracts out', async () => {
  const s = await takeSnapshot(opts(fakeChain(), { token: NFT, minUsd: undefined, feed: undefined, min: 1, tiers: '2:2' }))
  assert.equal(s.kind, 'erc721')
  assert.deepEqual(s.pairs, [])
  assert.deepEqual(holders(s), { [HOLDER]: 2, [SMALL]: 1 })
  await assert.rejects(takeSnapshot(opts(fakeChain(), { token: NFT })), /PLANK only/, 'no dollar minimum for an NFT')
})

test('a holding that dips in one of the blocks doesn\'t count', async () => {
  const s0 = await takeSnapshot(opts(fakeChain()))
  const dip = BigInt(s0.blocks[0])
  const s = await takeSnapshot(opts(fakeChain({ extraPlank: { [HOLDER]: (b) => (b === dip ? 0n : 100n * E) } })))
  assert.ok(!s.holders.some((h) => h.wallet === HOLDER))
})

test('verify: the same chain is GREEN; a wallet added by hand, a changed amount, allowance or other blocks are RED', async () => {
  const client = fakeChain()
  const snap = await takeSnapshot(opts(client, { tiers: '69:1,1000:3' }))
  let v = await verifySnapshot({ client, snap, discover })
  assert.deepEqual(v.problems, [])
  assert.equal(v.ok, true)

  // a wallet slipped in, the tree rebuilt so the file is self-consistent
  const added = structuredClone(snap)
  added.holders.push({ wallet: SMALL, balance: String(100n * E), allowance: 1 })
  const t = buildTree(added.holders)
  Object.assign(added, { root: t.root, count: added.holders.length, wallets: Object.fromEntries(added.holders.map((h) => [h.wallet, { allowance: h.allowance, proof: t.proofs[h.wallet] }])) })
  v = await verifySnapshot({ client, snap: added, discover })
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p.includes(SMALL) && /doesn't qualify on chain/.test(p)), v.problems.join('\n'))
  assert.ok(v.problems.some((p) => /^root/.test(p)))

  const amount = structuredClone(snap)
  amount.holders[0].balance = '1'
  assert.ok((await verifySnapshot({ client, snap: amount })).problems.some((p) => /file 1\/1 \(balance\/allowance\)/.test(p)))

  const more = structuredClone(snap)
  const w = more.holders.find((h) => h.wallet === HOLDER)
  w.allowance = 5
  const t2 = buildTree(more.holders)
  Object.assign(more, { root: t2.root, wallets: Object.fromEntries(more.holders.map((h) => [h.wallet, { allowance: h.allowance, proof: t2.proofs[h.wallet] }])) })
  assert.ok((await verifySnapshot({ client, snap: more })).problems.some((p) => p.includes(HOLDER) && /\/5/.test(p)), 'an allowance raised by hand')

  const blocks = structuredClone(snap)
  blocks.blocks[0] = '1'
  assert.ok((await verifySnapshot({ client, snap: blocks })).problems.some((p) => /^blocks/.test(p)), 'blocks must follow from the seed')

  const nopool = structuredClone(snap)
  nopool.pairs = []
  v = await verifySnapshot({ client, snap: nopool, discover })
  assert.ok(v.problems.some((p) => /pools/.test(p)) && v.problems.some((p) => p.includes(LPER)), 'an LP holder left out with its pool')

  assert.equal((await verifySnapshot({ client, snap: { ...snap, version: 2 } })).ok, false, 'an old file without allowances')
})

test('compareSnapshots: a proof or an allowance edited in the served wallets', () => {
  const hs = [{ wallet: HOLDER, balance: '1', allowance: 1 }, { wallet: LPER, balance: '1', allowance: 2 }]
  const t = buildTree(hs)
  const base = { root: t.root, count: 2, holders: hs, blocks: ['1'], block: '1', token: PLANK, kind: 'erc20', minRaw: '1', tiers: [], allowance: 1 }
  const wallets = Object.fromEntries(hs.map((h) => [h.wallet, { allowance: h.allowance, proof: t.proofs[h.wallet] }]))
  assert.deepEqual(compareSnapshots({ ...base, wallets }, { ...base, wallets }), [])
  assert.ok(compareSnapshots({ ...base, wallets: { ...wallets, [HOLDER]: { allowance: 1, proof: [] } } }, base).some((p) => /don't verify/.test(p)))
  assert.ok(compareSnapshots({ ...base, wallets: { ...wallets, [LPER]: { ...wallets[LPER], allowance: 9 } } }, base).some((p) => /don't verify/.test(p)))
})

test('the log searches: no --from-block after the token existed; LOGS_RPC on the same chain and caught up', async () => {
  const c = fakeChain()
  const deployed = (at) => ({ ...c, getChainId: async () => 4663, getCode: async ({ address, blockNumber }) => (getAddress(address) === PLANK && blockNumber >= at ? '0x60' : '0x') })
  const logs = (chainId, head) => ({ getChainId: async () => chainId, getBlockNumber: async () => head })
  await checkLogSource({ client: deployed(40n), token: PLANK, fromBlock: 0n, last: LAST })
  await checkLogSource({ client: deployed(40n), token: PLANK, fromBlock: 40n, last: LAST }) // the token's own block
  await assert.rejects(checkLogSource({ client: deployed(40n), token: PLANK, fromBlock: 41n, last: LAST }), /already existed at block 40/)
  await assert.rejects(takeSnapshot(opts(deployed(10n), { fromBlock: 50 })), /already existed/, 'and the snapshot refuses it')
  await checkLogSource({ client: deployed(40n), logsClient: logs(4663, LAST), token: PLANK, fromBlock: 0n, last: LAST })
  await assert.rejects(checkLogSource({ client: deployed(40n), logsClient: logs(46630, LAST + 5n), token: PLANK, fromBlock: 0n, last: LAST }), /LOGS_RPC is chain 46630, RPC is chain 4663/)
  await assert.rejects(checkLogSource({ client: deployed(40n), logsClient: logs(4663, LAST - 1n), token: PLANK, fromBlock: 0n, last: LAST }), /behind the last block/)
})
