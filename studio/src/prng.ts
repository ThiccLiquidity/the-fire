/** Deterministic randomness for the sample deal: SHA-256 in counter mode.
 *
 *  block(i) = SHA-256(utf8(seed) || ":" || utf8(stream) || ":" || decimal(i)); each 32-byte block yields eight
 *  big-endian uint32 words. A separate named stream is used for every purpose (pool shuffle, serials, characters,
 *  holo) so changing one step never shifts the randomness of another. The seed string stands in for a drand round's
 *  randomness; the real contract will use its own derivation, and its result replaces the sample deal wholesale.
 *
 *  SHA-256 is implemented here synchronously (WebCrypto is async-only) so dealFire stays a pure, sync function. */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const enc = new TextEncoder()

/** SHA-256 of a byte array, returned as eight uint32 words (big-endian word order). */
export function sha256Words(msg: Uint8Array): Uint32Array {
  const bitLen = msg.length * 8
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6)
  padded.set(msg)
  padded[msg.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  dv.setUint32(padded.length - 4, bitLen >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7]
    for (let i = 0; i < 64; i++) {
      const S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7))
      const ch = (E & F) ^ (~E & G)
      const t1 = (H + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10))
      const maj = (A & B) ^ (A & C) ^ (B & C)
      const t2 = (S0 + maj) >>> 0
      H = G; G = F; F = E; E = (D + t1) >>> 0; D = C; C = B; B = A; A = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + A) >>> 0; h[1] = (h[1] + B) >>> 0; h[2] = (h[2] + C) >>> 0; h[3] = (h[3] + D) >>> 0
    h[4] = (h[4] + E) >>> 0; h[5] = (h[5] + F) >>> 0; h[6] = (h[6] + G) >>> 0; h[7] = (h[7] + H) >>> 0
  }
  return h
}

export function sha256Hex(s: string): string {
  return Array.from(sha256Words(enc.encode(s)), (x) => x.toString(16).padStart(8, '0')).join('')
}

/** A named random stream derived from the seed. */
export class Stream {
  private counter = 0
  private buf: Uint32Array = new Uint32Array(0)
  private pos = 0
  private readonly prefix: string
  constructor(seed: string, name: string) {
    this.prefix = `${seed}:${name}:`
  }

  /** Next uniform uint32. */
  u32(): number {
    if (this.pos >= this.buf.length) {
      this.buf = sha256Words(enc.encode(this.prefix + this.counter++))
      this.pos = 0
    }
    return this.buf[this.pos++]
  }

  /** Uniform float in [0, 1) with 53 bits of precision. */
  float(): number {
    const hi = this.u32() >>> 5 // 27 bits
    const lo = this.u32() >>> 6 // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992
  }

  /** Uniform integer in [0, n) by rejection sampling (no modulo bias). n must be in [1, 2^32]. */
  int(n: number): number {
    if (!(n >= 1 && n <= 0x100000000 && Number.isInteger(n))) throw new Error(`Stream.int: bad range ${n}`)
    const limit = 0x100000000 - (0x100000000 % n)
    for (;;) {
      const x = this.u32()
      if (x < limit) return x % n
    }
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }
}

/** A fresh random seed string for the "randomize" button (stands in for a drand round). */
export function randomSeed(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
