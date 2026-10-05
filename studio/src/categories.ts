/** Text that goes on-chain with a Series (character names and categories) follows the contract's rules
 *  (FireCards._checkText): no double quote, backslash or control character (it goes into the token's JSON as-is), plus
 *  a length limit in bytes of UTF-8. textProblem checks both; nameProblem and categoryProblem use it.
 *
 *  A character's category is free text, typed per character in the Library. There is no preset list: the
 *  suggestions are the categories already in use, so the list builds up as categories are added. It goes on the
 *  card, into the metadata, and on-chain with the Series (FireCards.configureFire), so it follows the contract's
 *  rules: 1 to 32 bytes of UTF-8, no double quote, backslash or control characters (it goes into the token's JSON
 *  as-is). */

import type { Character } from './types'

/** Longest category, in bytes of UTF-8 (the contract's MAX_CATEGORY_BYTES). */
export const MAX_CATEGORY_BYTES = 32
/** Longest character name, in bytes of UTF-8 (the contract's MAX_NAME_BYTES). */
export const MAX_NAME_BYTES = 64

/** Why `s` can't go on-chain, or null if it can: empty (`emptyMessage`), over `maxBytes` bytes of UTF-8, or holding a
 *  double quote, backslash or control character (below 0x20), like the contract's _checkText. */
export function textProblem(s: string, maxBytes: number, emptyMessage: string): string | null {
  if (!s) return emptyMessage
  const bytes = new TextEncoder().encode(s).length
  if (bytes > maxBytes) return `Too long: ${bytes} bytes, at most ${maxBytes} (letters like é count as 2).`
  if (/["\\]/.test(s)) return 'No double quotes or backslashes.'
  if (/[\u0000-\u001f]/.test(s)) return 'No control characters.'
  return null
}

/** Why a (trimmed) character name can't be used, or null if it can. */
export function nameProblem(s: string): string | null {
  return textProblem(s, MAX_NAME_BYTES, 'Give the character a name.')
}

/** The name as saved: trimmed. */
export function normalizeName(s: string): string {
  return s.trim()
}

export function hasValidName(c: Pick<Character, 'name'>): boolean {
  return nameProblem(normalizeName(c.name)) === null
}

/** Trim and collapse runs of whitespace to one space. Capitalisation is kept: it is the label on the card. */
export function normalizeCategory(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Why a (normalised) category can't be used, or null if it can. */
export function categoryProblem(s: string): string | null {
  return textProblem(s, MAX_CATEGORY_BYTES, 'Give the character a category.')
}

/** Same category regardless of capitalisation. */
export function categoryKey(s: string): string {
  return normalizeCategory(s).toLowerCase()
}

/** The categories already in use, once each (case-insensitive; the first spelling seen wins), sorted. */
export function categorySuggestions(used: (string | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const u of used) {
    const c = normalizeCategory(u ?? '')
    if (c && !seen.has(categoryKey(c))) seen.set(categoryKey(c), c)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Older saves and backups stored one of eight fixed ids; they become the label that was shown for them. */
const LEGACY_CATEGORY: Record<string, string> = {
  person: 'Person', animal: 'Animal', plant: 'Plant', place: 'Place', sports: 'Sports', object: 'Object', element: 'Element', idea: 'Idea',
}
export function migrateLegacyCategory(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const c = normalizeCategory(v)
  return LEGACY_CATEGORY[c] ?? (c || undefined)
}

export function hasCategory(c: Character): boolean {
  return !!c.category && categoryProblem(normalizeCategory(c.category)) === null
}

/** A character from an older save, with its fixed category id turned into a label. */
export function migrateCharacterCategory(c: Character): Character {
  const category = migrateLegacyCategory(c.category)
  const next = { ...c }
  if (category) next.category = category
  else delete next.category
  return next
}
