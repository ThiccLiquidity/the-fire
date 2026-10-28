// Keccak-256 (Ethereum's hash: the original Keccak padding, not NIST SHA3-256), no dependencies. Used to compute
// event topics and function selectors from their signatures instead of hard-coding them.

const RC = [
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000, 0x0000808b, 0x00000000,
  0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000, 0x0000008a, 0x00000000, 0x00000088, 0x00000000,
  0x80008009, 0x00000000, 0x8000000a, 0x00000000, 0x8000808b, 0x00000000, 0x0000008b, 0x80000000, 0x00008089, 0x80000000,
  0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x00000080, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a, 0x80000000,
  0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
];
// rotation offsets and lane order of the rho/pi step
const ROT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

/** keccak-f[1600] on 25 lanes held as 50 32-bit halves (lo, hi). */
function permute(s) {
  const c = new Array(10);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 10; x++) c[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const x1 = (x + 2) % 10, x4 = (x + 8) % 10;
      const lo = c[x4] ^ ((c[x1] << 1) | (c[x1 + 1] >>> 31));
      const hi = c[x4 + 1] ^ ((c[x1 + 1] << 1) | (c[x1] >>> 31));
      for (let y = 0; y < 50; y += 10) { s[y + x] ^= lo; s[y + x + 1] ^= hi; }
    }
    // rho and pi
    let lo = s[2], hi = s[3];
    for (let i = 0; i < 24; i++) {
      const j = PI[i] * 2, r = ROT[i];
      const tlo = s[j], thi = s[j + 1];
      if (r < 32) { s[j] = (lo << r) | (hi >>> (32 - r)); s[j + 1] = (hi << r) | (lo >>> (32 - r)); }
      else { s[j] = (hi << (r - 32)) | (lo >>> (64 - r)); s[j + 1] = (lo << (r - 32)) | (hi >>> (64 - r)); }
      lo = tlo; hi = thi;
    }
    // chi
    for (let y = 0; y < 50; y += 10) {
      const t = s.slice(y, y + 10);
      for (let x = 0; x < 10; x++) s[y + x] = t[x] ^ (~t[(x + 2) % 10] & t[(x + 4) % 10]);
    }
    // iota
    s[0] ^= RC[round * 2];
    s[1] ^= RC[round * 2 + 1];
  }
}

/** Keccak-256 of a string (UTF-8) or bytes, as 0x-prefixed hex. */
export function keccak256(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : Uint8Array.from(input);
  const rate = 136;
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(50).fill(0);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      s[i] ^= padded[off + i * 4] | (padded[off + i * 4 + 1] << 8) | (padded[off + i * 4 + 2] << 16) | (padded[off + i * 4 + 3] << 24);
    }
    permute(s);
  }
  let hex = "0x";
  for (let i = 0; i < 8; i++) for (let b = 0; b < 4; b++) hex += ((s[i] >>> (b * 8)) & 0xff).toString(16).padStart(2, "0");
  return hex;
}

/** An event's topic 0 from its signature, e.g. "Transfer(address,address,uint256)". */
export const topicOf = (signature) => keccak256(signature);
/** A function's selector from its signature, e.g. "balanceOf(address)". */
export const selectorOf = (signature) => keccak256(signature).slice(0, 10);
