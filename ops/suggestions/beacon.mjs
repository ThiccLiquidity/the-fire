// drand quicknet: the public randomness that seeds the suggestion draw. The round is announced when a wave opens and
// comes out after the wave closes, so nobody (the owner included) knows the seed while entries can still change.
// Every round is signed by the drand network: a signature is checked here against quicknet's public key (BLS12-381,
// RFC 9380 hash to G1), so a relay can't hand out a made-up number. The randomness is sha256(signature).
// Relays: the keeper's (ops/keeper/src/drand.mjs), DRAND_URLS to override. Same scheme as drand's own clients:
// https://drand.love (chain info at <relay>/<chain hash>/info).
import { bls12_381 as bls } from '@noble/curves/bls12-381'
import { createHash } from 'node:crypto'
import { DEFAULT_DRAND_URLS } from '../keeper/src/drand.mjs'

export const QUICKNET = {
  chain: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicKey: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesis: 1692803367n,
  period: 3n,
}
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_'
const hex = (s) => String(s).replace(/^0x/, '').toLowerCase()

/** When `round` comes out (unix seconds). */
export const roundTime = (round, net = QUICKNET) => net.genesis + (BigInt(round) - 1n) * net.period
/** The first round that comes out strictly after `ts`. */
export const firstRoundAfter = (ts, net = QUICKNET) => (BigInt(ts) < net.genesis ? 1n : (BigInt(ts) - net.genesis) / net.period + 2n)

/** What a quicknet round signs: sha256 of the round as 8 bytes, big-endian. */
export function roundMessage(round) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(round))
  return createHash('sha256').update(b).digest()
}

/** The signature is drand's for this round (checked against `publicKey`, quicknet's by default). */
export function verifyRound(round, signature, publicKey = QUICKNET.publicKey) {
  try {
    return bls.verifyShortSignature(hex(signature), bls.G1.hashToCurve(roundMessage(round), { DST }), hex(publicKey))
  } catch {
    return false
  }
}

/** The round's random value: sha256(signature), hex. */
export const randomnessOf = (signature) => createHash('sha256').update(Buffer.from(hex(signature), 'hex')).digest('hex')

/**
 * Fetches `round` from the relays (in turn) and keeps the first answer whose signature verifies. Returns
 * { chain, round, signature, randomness, relay }; throws with each relay's reason when none has it (yet).
 */
export async function fetchRound(round, { urls, fetchFn = globalThis.fetch, net = QUICKNET, timeoutMs = 15_000 } = {}) {
  const relays = (urls ?? (process.env.DRAND_URLS ? process.env.DRAND_URLS.split(',') : DEFAULT_DRAND_URLS)).map((u) => u.trim().replace(/\/$/, '')).filter(Boolean)
  const why = []
  for (const r of relays) {
    try {
      const res = await fetchFn(`${r}/${net.chain}/public/${round}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) { why.push(`${r}: HTTP ${res.status}`); continue }
      const j = await res.json()
      if (String(j.round) !== String(round)) { why.push(`${r}: answered round ${j.round}`); continue }
      if (!verifyRound(round, j.signature, net.publicKey)) { why.push(`${r}: the signature doesn't verify against quicknet's public key`); continue }
      const randomness = randomnessOf(j.signature)
      if (j.randomness && hex(j.randomness) !== randomness) { why.push(`${r}: its randomness isn't sha256(signature)`); continue }
      return { chain: net.chain, round: Number(round), signature: hex(j.signature), randomness, relay: r }
    } catch (e) {
      why.push(`${r}: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e}`)
    }
  }
  throw new Error(`drand quicknet round ${round} not available (${why.join('; ')})`)
}
