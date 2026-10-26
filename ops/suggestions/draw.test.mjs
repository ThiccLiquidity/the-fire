import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draw, entries, kindOf, sameIdea, sessionWarning } from './draw.mjs'

test('kinds: theme, art style, character', () => {
  assert.deepEqual(kindOf('Theme: Haunted diner'), { kind: 'theme', title: 'Haunted diner' })
  assert.deepEqual(kindOf('art style:  Woodcut'), { kind: 'style', title: 'Woodcut' })
  assert.deepEqual(kindOf('Character: A sleepy volcano\nPersonality: grumpy'), { kind: 'character', title: 'A sleepy volcano' })
  assert.deepEqual(kindOf('Ember Fox'), { kind: 'character', title: 'Ember Fox' })
})

test('one per wallet per kind; the same idea merged', () => {
  const A = '0x00000000000000000000000000000000000000aa', B = '0x00000000000000000000000000000000000000bb'
  const list = [
    { id: 0, by: A, kind: 'theme', title: 'The Haunted Diner!' },
    { id: 1, by: A, kind: 'theme', title: 'Space pirates' }, // A's second theme: ignored
    { id: 2, by: A, kind: 'style', title: 'Woodcut' }, // a style is another kind: kept
    { id: 3, by: B, kind: 'theme', title: 'haunted diner' }, // same idea as #0: merged into it
  ]
  const e = entries(list)
  assert.deepEqual(e.map((x) => x.id), [0, 2])
  assert.deepEqual(e[0].alsoBy, [B])
  assert.equal(sameIdea('The Haunted  Diner!'), 'haunted diner')
})

test('the draw is fair-shaped and repeatable from its seed', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ id: i }))
  const a = draw(list, 'abc', 10), b = draw(list, 'abc', 10), c = draw(list, 'abd', 10)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.equal(new Set(a.map((x) => x.id)).size, 10)
  assert.equal(draw(list.slice(0, 4), 'abc', 10).length, 4) // fewer than 10: all of them
  // every entry gets drawn first about equally often
  const first = new Array(30).fill(0)
  for (let s = 0; s < 3000; s++) first[draw(list, 'seed' + s, 1)[0].id]++
  assert.ok(Math.min(...first) > 50 && Math.max(...first) < 160, first.join(','))
})

test('ideas in any script are kept, never dropped; each keys as itself', () => {
  const A = '0x00000000000000000000000000000000000000aa', B = '0x00000000000000000000000000000000000000bb', C = '0x00000000000000000000000000000000000000cc'
  assert.equal(sameIdea('幽霊'), '幽霊')
  assert.equal(sameIdea('🔥🔥'), '🔥🔥')
  const e = entries([
    { id: 0, by: A, kind: 'theme', title: '幽霊' },
    { id: 1, by: B, kind: 'theme', title: '猫' },
    { id: 2, by: C, kind: 'theme', title: '幽霊!' }, // the same idea as #0
  ])
  assert.deepEqual(e.map((x) => x.id), [0, 1])
  assert.deepEqual(e[0].alsoBy, [C])
  assert.equal(entries([{ id: 5, by: A, kind: 'theme', title: '' }]).length, 1) // even an empty one is in the draw
  assert.equal(sameIdea('Café Nights'), 'cafe nights') // accents still fold; Latin works as before
})

test('zero-width and bidi characters do not make one idea look like two', () => {
  assert.equal(sameIdea('Haunted\u200B diner'), sameIdea('Haunted diner'))
  assert.equal(sameIdea('\uFEFFHaunted\u2060 di\u200Dner'), 'haunted diner')
  assert.equal(sameIdea('\u202EHaunted diner'), 'haunted diner')
  assert.deepEqual(kindOf('\u200BTheme: Haunted diner'), { kind: 'theme', title: 'Haunted diner' })
  assert.deepEqual(kindOf('Art\u200C style: Woodcut'), { kind: 'style', title: 'Woodcut' })
})

test('the session check: a round that can no longer be picked for the Series', () => {
  assert.equal(sessionWarning({ series: 8n, round: 3, sessionFire: 7n, sessionRound: 2, picks: 0n }), null) // not picked yet
  assert.equal(sessionWarning({ series: 8n, round: 3, sessionFire: 8n, sessionRound: 3, picks: 0n }), null)
  assert.match(sessionWarning({ series: 8n, round: 4, sessionFire: 8n, sessionRound: 3, picks: 12n }), /can no longer be picked/)
  assert.match(sessionWarning({ series: 8n, round: 3, sessionFire: 8n, sessionRound: 3, picks: 12n }), /already made/)
})

// ------------------------------------------------------------------ the closing block and the drand seed
import { bls12_381 as bls } from '@noble/curves/bls12-381'
import { createHash } from 'node:crypto'
import { checkDrawSource, checkSavedRound, compareDraws, drawRound, runDraw } from './draw.mjs'
import { QUICKNET, fetchRound, firstRoundAfter, randomnessOf, roundMessage, roundTime, verifyRound } from './beacon.mjs'

// a stand-in drand network (its own key): the same scheme as quicknet (BLS12-381 short signatures, RFC 9380 hash to G1)
const sk = bls.utils.randomPrivateKey()
const NET = { ...QUICKNET, publicKey: Buffer.from(bls.getPublicKeyForShortSignatures(sk)).toString('hex') }
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_'
const sign = (round) => bls.signShortSignature(bls.G1.hashToCurve(roundMessage(round), { DST }), sk).toHex(true)

test('quicknet rounds: times, the first round after a moment, the message signed', () => {
  assert.equal(roundTime(1n), 1692803367n)
  assert.equal(roundTime(11n), 1692803367n + 30n)
  const ts = 1692803367n + 100n
  const r = firstRoundAfter(ts)
  assert.ok(roundTime(r) > ts && roundTime(r - 1n) <= ts, 'strictly after, and the first')
  assert.equal(firstRoundAfter(roundTime(50n)), 51n, 'a round out exactly at the moment is not after it')
  // drand's unchained message: sha256 of the round as 8 bytes, big-endian
  assert.equal(roundMessage(1000).toString('hex'), createHash('sha256').update(Buffer.from('00000000000003e8', 'hex')).digest('hex'))
})

test('a round\'s signature is checked against the network\'s public key; the seed is sha256(signature)', () => {
  const sig = sign(1234n)
  assert.equal(verifyRound(1234n, sig, NET.publicKey), true)
  assert.equal(verifyRound(1235n, sig, NET.publicKey), false, 'another round')
  assert.equal(verifyRound(1234n, sig), false, 'not quicknet\'s key')
  assert.equal(verifyRound(1234n, 'zz', NET.publicKey), false)
  assert.equal(randomnessOf(sig).length, 64)
  assert.equal(randomnessOf('0x' + sig), randomnessOf(sig))
})

test('fetchRound: a relay with a bad signature or the wrong round is skipped; the first that verifies wins', async () => {
  const sig = sign(77n)
  const json = (status, body) => ({ ok: status === 200, status, json: async () => body })
  const urls = []
  const fetchFn = async (u) => {
    urls.push(u)
    if (u.startsWith('https://a')) return json(200, { round: 77, signature: sign(78n) }) // a forged / wrong signature
    if (u.startsWith('https://b')) return json(200, { round: 76, signature: sig })
    return json(200, { round: 77, signature: sig, randomness: randomnessOf(sig) })
  }
  const r = await fetchRound(77n, { urls: ['https://a', 'https://b/', 'https://c'], fetchFn, net: NET })
  assert.deepEqual([r.round, r.signature, r.randomness, r.relay], [77, sig, randomnessOf(sig), 'https://c'])
  assert.equal(urls[2], `https://c/${QUICKNET.chain}/public/77`)
  await assert.rejects(fetchRound(77n, { urls: ['https://a'], fetchFn, net: NET }), /doesn't verify/)
})

test('the drand round: an announced one must come out after the close; else the first after close + margin', () => {
  const close = roundTime(1000n) + 1n
  assert.equal(drawRound({ closeTs: close, margin: 60 }), firstRoundAfter(close + 60n))
  assert.equal(drawRound({ closeTs: close, announced: '1100' }), 1100n)
  assert.throws(() => drawRound({ closeTs: close, announced: 1000 }), /not after the closing block/)
  assert.throws(() => drawRound({ closeTs: roundTime(1000n), announced: 1000 }), /not after/)
})

test('a re-run with the same entries and seed gives the same shortlist; a changed entry list or seed shows', () => {
  const A = '0x00000000000000000000000000000000000000aa'
  const all = Array.from({ length: 40 }, (_, i) => ({ id: i, by: `0x${String(i + 1).padStart(40, '0')}`, kind: i % 2 ? 'theme' : 'style', title: `idea ${i}`, text: `x ${i}` }))
  const seed = randomnessOf(sign(5n))
  const saved = { ...runDraw(all, ['theme', 'style'], seed, 10), suggestions: 40 }
  assert.deepEqual(compareDraws(saved, { ...runDraw(all, ['theme', 'style'], seed, 10), suggestions: 40 }), [])
  const more = [...all, { id: 99, by: A, kind: 'theme', title: 'late entry', text: 'late' }]
  const p = compareDraws(saved, { ...runDraw(more, ['theme', 'style'], seed, 10), suggestions: 41 })
  assert.ok(p.some((x) => /suggestions read/.test(x)) && p.some((x) => /^theme: 20 in the draw in the file, 21 again/.test(x)), p.join('\n'))
  assert.ok(compareDraws(saved, { ...runDraw(all, ['theme', 'style'], seed + '0', 10), suggestions: 40 }).some((x) => /shortlist/.test(x)))
  assert.deepEqual(saved.entryIds.theme.length, 20)
})

test('a saved draw\'s round: the signature, the randomness and the seed must agree', () => {
  // quicknet's real key: a stand-in signature can't pass, whatever the file says
  const sig = sign(9n)
  const saved = { seed: randomnessOf(sig), drand: { round: 9, signature: sig, randomness: randomnessOf(sig) } }
  assert.ok(checkSavedRound(saved).some((x) => /isn't drand quicknet's/.test(x)))
  assert.ok(checkSavedRound({ ...saved, seed: 'ab' }).some((x) => /seed isn't/.test(x)))
  assert.ok(checkSavedRound({ ...saved, drand: { ...saved.drand, randomness: 'cd' } }).some((x) => /sha256/.test(x)))
  assert.ok(checkSavedRound({ ...saved, toBlockTime: Number(roundTime(9n)) }).some((x) => /before the closing block/.test(x)))
})

test('a saved draw\'s source: the deployments file\'s FireCredits, nothing left out before fromBlock, the announced close and round', () => {
  const credits = '0x00000000000000000000000000000000000000cc'
  const saved = { credits, round: 3, fromBlock: '0', toBlock: '500', drand: { round: 1100 } }
  assert.deepEqual(checkDrawSource(saved, { credits: '0x00000000000000000000000000000000000000CC', expectToBlock: '500', expectRound: 1100 }), [])
  assert.ok(checkDrawSource({ ...saved, credits: '0x00000000000000000000000000000000000000dd' }, { credits }).some((x) => /FireCredits: file/.test(x)), 'a fake contract')
  assert.ok(checkDrawSource({ ...saved, credits: undefined }, { credits }).some((x) => /FireCredits/.test(x)))
  assert.ok(checkDrawSource(saved, { credits: undefined }).some((x) => /deployments file none/.test(x)))
  assert.ok(checkDrawSource({ ...saved, fromBlock: '200' }, { credits, early: [{ id: 4 }, { id: 9 }] }).some((x) => /2 suggestion\(s\) of round 3 were mined before the draw's fromBlock 200.*#4/.test(x)))
  assert.ok(checkDrawSource(saved, { credits, expectToBlock: 501 }).some((x) => /closing block: file 500, announced 501/.test(x)))
  assert.ok(checkDrawSource(saved, { credits, expectRound: '1101' }).some((x) => /drand round: file 1100, announced 1101/.test(x)))
})
