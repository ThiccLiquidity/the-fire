import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draw, entries, kindOf, sameIdea } from './draw.mjs'

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
