/** The suggestion draw files (ops/suggestions/draw.mjs) as the Suggestions screen reads them: the drand check (the same
 *  as draw.mjs checkSavedRound: quicknet's signature, randomness = sha256(signature), the seed is that randomness, the
 *  round came out after the closing block) and the commands that announce and pick. A full re-run of the draw needs
 *  the chain (draw.mjs --verify); this checks what the file itself can prove. */
import { bls12_381 as bls } from '@noble/curves/bls12-381'
import { sha256 } from '@noble/hashes/sha2'

export type DrawKind = 'theme' | 'style' | 'character'
export interface DrawEntry { id: number; by: string; title: string; text?: string; alsoBy: string[] }
export interface DrawFile {
  chainId: number; credits: string; round: number; kind: 'look' | 'character'; fromBlock: string; toBlock: string
  toBlockHash?: string; toBlockTime?: number; seed: string; seedSource?: string; test?: boolean
  drand?: { round: number | string; signature: string; randomness: string; relay?: string }
  count: number; at: string; suggestions: number; pools: Partial<Record<DrawKind, number>>
  shortlists: Partial<Record<DrawKind, DrawEntry[]>>
}

export const QUICKNET = {
  publicKey: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesis: 1692803367n,
  period: 3n,
}
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_'
const hex = (s: string) => String(s).replace(/^0x/, '').toLowerCase()
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => Uint8Array.from(hex(h).match(/../g) ?? [], (x) => parseInt(x, 16))

export const roundTime = (round: number | string | bigint) => QUICKNET.genesis + (BigInt(round) - 1n) * QUICKNET.period
/** What a quicknet round signs: sha256 of the round as 8 bytes, big-endian. */
export function roundMessage(round: number | string | bigint): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, BigInt(round))
  return sha256(b)
}
export function verifyRound(round: number | string | bigint, signature: string, publicKey = QUICKNET.publicKey): boolean {
  try {
    // the point hashed with quicknet's DST, as drand's clients and ops/suggestions/beacon.mjs do
    const msg = bls.G1.hashToCurve(roundMessage(round), { DST }) as unknown as Parameters<typeof bls.verifyShortSignature>[1]
    return bls.verifyShortSignature(hex(signature), msg, hex(publicKey))
  } catch {
    return false
  }
}
export const randomnessOf = (signature: string) => toHex(sha256(fromHex(signature)))

/** What's wrong with a draw file, in words; empty when the file's own proof holds. */
export function checkDraw(d: DrawFile, publicKey = QUICKNET.publicKey): string[] {
  const p: string[] = []
  if (!d || typeof d !== 'object' || !d.shortlists) return ['This isn\'t a draw file (ops/suggestions/draw.mjs makes them).']
  if (d.test || !d.drand) return ['A TEST draw (made with --seed): not a real one. Make the real draw with its announced drand round.']
  if (!verifyRound(d.drand.round, d.drand.signature, publicKey)) p.push(`The drand signature isn't quicknet's for round ${d.drand.round}.`)
  if (randomnessOf(d.drand.signature) !== hex(d.drand.randomness)) p.push('The randomness isn\'t sha256 of the signature.')
  if (hex(d.seed) !== hex(d.drand.randomness)) p.push('The seed isn\'t the drand round\'s randomness.')
  if (d.toBlockTime !== undefined && roundTime(d.drand.round) <= BigInt(d.toBlockTime)) p.push(`drand round ${d.drand.round} came out before the wave closed.`)
  return p
}

export const kindsOf = (d: DrawFile): DrawKind[] => (Object.keys(d.shortlists) as DrawKind[]).filter((k) => d.shortlists[k]?.length)
export const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

/** The command that announces a wave's picks on the results page (ops/suggestions/publish.mjs). */
export const publishCommand = (file: string, series: number, ids: number[]) =>
  `cd C:\\Users\\DubT1\\the-fire\\ops\nnode suggestions\\publish.mjs --draw "${file}" --series ${series} --picks ${ids.join(',')}`

/** The Ledger transaction that marks every pick of a Series at once (the authors' free packs). */
export const pickCommand = (series: number, ids: number[], chainId: number) =>
  `$credits = (Get-Content C:\\Users\\DubT1\\the-fire\\deployments\\${chainId}.json | ConvertFrom-Json).contracts.FireCredits\n` +
  `cast send $credits "pickSuggestions(uint256,uint256[])" ${series} "[${ids.join(',')}]" --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC`
