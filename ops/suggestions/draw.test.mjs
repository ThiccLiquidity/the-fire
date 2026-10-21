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
