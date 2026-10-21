import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResults, fillPickTx, mergeResults } from './publish.mjs'

const A = '0x00000000000000000000000000000000000000aa', B = '0x00000000000000000000000000000000000000bb'
const draw = {
  chainId: 46630, credits: '0x0000000000000000000000000000000000000c0c', round: 3, kind: 'look', seed: 'abc', at: '2026-10-21T00:00:00.000Z',
  suggestions: 40, pools: { theme: 18, style: 15 },
  shortlists: {
    theme: [{ id: 4, by: A, title: 'Haunted diner', text: 'Theme: Haunted diner', alsoBy: [B] }, { id: 9, by: B, title: 'Space pirates', text: 'Theme: Space pirates', alsoBy: [] }],
    style: [{ id: 5, by: A, title: 'Woodcut', text: 'Art style: Woodcut', alsoBy: [] }],
  },
}

test('the picks are marked and listed as winners, with their transactions', () => {
  const r = buildResults(draw, [{ id: 4, tx: '0x01' }, { id: 5 }], { series: 8, next: 'Characters next', publishedAt: 'now' })
  assert.equal(r.wave, 'look')
  assert.equal(r.series, 8)
  assert.deepEqual(r.kinds.map((k) => [k.kind, k.label, k.pool]), [['theme', 'Theme', 18], ['style', 'Art style', 15]])
  assert.deepEqual(r.kinds[0].shortlist.map((s) => s.picked), [true, false])
  assert.deepEqual(r.winners.map((w) => [w.kind, w.id, w.tx]), [['theme', 4, '0x01'], ['style', 5, null]])
  assert.equal(r.next, 'Characters next')
})

test('a pick outside the shortlist is refused', () => {
  assert.throws(() => buildResults(draw, [{ id: 77 }], { series: 8 }), /not in the shortlist/)
  assert.throws(() => buildResults(draw, [], { series: 0 }), /series/i)
})

test('a character draw is the characters wave', () => {
  const r = buildResults({ ...draw, kind: 'character', shortlists: { character: [{ id: 1, by: A, title: 'Ember Fox', text: 'Character: Ember Fox' }] } }, [{ id: 1 }], { series: 8 })
  assert.equal(r.wave, 'characters')
  assert.equal(r.winners[0].title, 'Ember Fox')
})

test('publishing the same wave again replaces it; waves stay in order', () => {
  const look = buildResults(draw, [{ id: 4 }], { series: 8 })
  const chars = { ...look, wave: 'characters' }
  let f = mergeResults(null, chars)
  f = mergeResults(f, look)
  f = mergeResults(f, { ...look, next: 'again' })
  assert.deepEqual(f.waves.map((w) => [w.series, w.wave, w.next]), [[8, 'look', 'again'], [8, 'characters', '']])
  assert.equal(f.version, 1)
})

test('the one on-chain pick fills in the transaction for every wave of that Series', () => {
  const look = buildResults(draw, [{ id: 4 }, { id: 5 }], { series: 8 })
  const f = fillPickTx(mergeResults(null, look), 8, [{ id: 4, tx: '0xaa' }, { id: 5, tx: '0xaa' }, { id: 77, tx: '0xaa' }])
  assert.deepEqual(f.waves[0].winners.map((w) => w.tx), ['0xaa', '0xaa'])
  const other = buildResults(draw, [{ id: 4 }, { id: 5 }], { series: 8 })
  assert.deepEqual(fillPickTx(mergeResults(null, other), 9, [{ id: 4, tx: '0xbb' }]).waves[0].winners.map((w) => w.tx), [null, null]) // another Series
})
