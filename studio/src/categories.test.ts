import { describe, expect, it } from 'vitest'
import {
  MAX_CATEGORY_BYTES, MAX_NAME_BYTES, categoryKey, hasValidName, nameProblem, normalizeName, categoryProblem, categorySuggestions, hasCategory, migrateCharacterCategory, migrateLegacyCategory,
  normalizeCategory,
} from './categories'
import type { Character } from './types'

const char = (category?: string): Character => ({ id: 'a', name: 'A', shortId: '', category, images: {}, createdAt: 0, updatedAt: 0 })

describe('categories', () => {
  it('normalises: trims, collapses spaces, keeps capitalisation', () => {
    expect(normalizeCategory('  Rock   Stars \t')).toBe('Rock Stars')
    expect(normalizeCategory('sea\ncreatures')).toBe('sea creatures')
    expect(categoryKey(' Rock  STARS')).toBe('rock stars')
  })

  it('validates like the contract: non-empty, at most 32 bytes of UTF-8, no quote, backslash or control characters', () => {
    expect(categoryProblem('Animal')).toBeNull()
    expect(categoryProblem('x'.repeat(MAX_CATEGORY_BYTES))).toBeNull()
    expect(categoryProblem('')).toMatch(/category/)
    expect(categoryProblem('x'.repeat(MAX_CATEGORY_BYTES + 1))).toMatch(/Too long: 33 bytes/)
    expect(categoryProblem('é'.repeat(16))).toBeNull() // 32 bytes
    expect(categoryProblem('é'.repeat(17))).toMatch(/Too long: 34 bytes/)
    expect(categoryProblem('Say "hi"')).toMatch(/quotes/)
    expect(categoryProblem('back\\slash')).toMatch(/backslash/)
    expect(categoryProblem('bell\u0007')).toMatch(/control/)
    expect(hasCategory(char('Animal'))).toBe(true)
    expect(hasCategory(char())).toBe(false)
    expect(hasCategory(char('a"b'))).toBe(false)
  })

  it('suggests the categories in use once each, case-insensitively, first spelling wins', () => {
    expect(categorySuggestions(['Sports', undefined, 'sports', ' Animal ', 'Rock  Stars', '', 'animal'])).toEqual(['Animal', 'Rock Stars', 'Sports'])
    expect(categorySuggestions([])).toEqual([])
  })

  it('turns the old fixed ids from saves and backups into labels', () => {
    expect(migrateLegacyCategory('sports')).toBe('Sports')
    expect(migrateLegacyCategory('idea')).toBe('Idea')
    expect(migrateLegacyCategory('Rock Stars')).toBe('Rock Stars')
    expect(migrateLegacyCategory('')).toBeUndefined()
    expect(migrateLegacyCategory(3)).toBeUndefined()
    const old = { ...char(), category: 'animal' }
    expect(migrateCharacterCategory(old).category).toBe('Animal')
    expect('category' in migrateCharacterCategory(char(''))).toBe(false)
    expect(migrateCharacterCategory(char()).name).toBe('A')
  })

  it('validates names like the contract: non-empty, at most 64 bytes of UTF-8, no quote, backslash or control characters', () => {
    expect(MAX_NAME_BYTES).toBe(64)
    expect(nameProblem('Rabbit')).toBeNull()
    expect(nameProblem("Rock 'n' Roll Rabbit")).toBeNull()
    expect(nameProblem('x'.repeat(64))).toBeNull()
    expect(nameProblem('é'.repeat(32))).toBeNull() // 64 bytes
    expect(nameProblem('é'.repeat(33))).toMatch(/Too long: 66 bytes, at most 64/)
    expect(nameProblem('x'.repeat(65))).toMatch(/Too long: 65 bytes/)
    expect(nameProblem('')).toMatch(/name/)
    expect(nameProblem('The "Rabbit"')).toMatch(/quotes/)
    expect(nameProblem('a\\b')).toMatch(/backslash/)
    expect(nameProblem('tab\there')).toMatch(/control/)
    expect(nameProblem('line\nbreak')).toMatch(/control/)
    expect(nameProblem('\u001f')).toMatch(/control/)
    expect(nameProblem('del\u007f')).toMatch(/control/)
    expect(categoryProblem('del\u007f')).toMatch(/control/)
    expect(normalizeName('  Rabbit ')).toBe('Rabbit')
    expect(hasValidName({ name: '  ' })).toBe(false)
    expect(hasValidName({ name: ' Fox ' })).toBe(true)
  })
})
