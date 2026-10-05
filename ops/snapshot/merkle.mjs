// The Merkle tree FireSale checks (OpenZeppelin MerkleProof: sorted-pair hashing). A leaf is
// keccak256(bytes.concat(keccak256(abi.encode(wallet)))), the same as FireSale._checkHolder.
import { keccak256, encodeAbiParameters, concat, getAddress } from 'viem'

export function leafOf(addr) {
  return keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [getAddress(addr)])))
}

function hashPair(a, b) {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]))
}

/** Builds the tree. Returns { root, proofs: { [address]: bytes32[] } }. */
export function buildTree(addresses) {
  const wallets = [...new Set(addresses.map((a) => getAddress(a)))]
  if (wallets.length === 0) throw new Error('no wallets in the snapshot')
  const leaves = wallets.map((w) => ({ w, h: leafOf(w) })).sort((x, y) => (BigInt(x.h) < BigInt(y.h) ? -1 : 1))
  const layers = [leaves.map((l) => l.h)]
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1]
    const next = []
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i])
    layers.push(next)
  }
  const proofs = {}
  leaves.forEach((l, idx) => {
    const proof = []
    let i = idx
    for (let d = 0; d < layers.length - 1; d++) {
      const sib = i ^ 1
      if (sib < layers[d].length) proof.push(layers[d][sib])
      i >>= 1
    }
    proofs[l.w] = proof
  })
  return { root: layers[layers.length - 1][0], proofs }
}

export function verify(proof, root, addr) {
  let h = leafOf(addr)
  for (const p of proof) h = hashPair(h, p)
  return h === root
}
