// The Merkle tree FireGroups checks for a snapshot group (OpenZeppelin MerkleProof: sorted-pair hashing). A leaf is
// keccak256(bytes.concat(keccak256(abi.encode(wallet, allowance)))), exactly FireGroups._admit's (OpenZeppelin
// StandardMerkleTree leaves of ["address", "uint256"]): the buyer passes its allowance and its proof.
import { keccak256, encodeAbiParameters, concat, getAddress } from 'viem'

export function leafOf(addr, allowance) {
  return keccak256(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [getAddress(addr), BigInt(allowance)])))
}

function hashPair(a, b) {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]))
}

/** Builds the tree from [{ wallet, allowance }]. Returns { root, proofs: { [checksummed address]: bytes32[] } }. */
export function buildTree(entries) {
  if (entries.length === 0) throw new Error('no wallets in the snapshot')
  const seen = new Set()
  const leaves = entries.map((e) => {
    const w = getAddress(e.wallet)
    if (seen.has(w)) throw new Error(`${w} is in the snapshot twice`)
    seen.add(w)
    return { w, h: leafOf(w, e.allowance) }
  }).sort((x, y) => (BigInt(x.h) < BigInt(y.h) ? -1 : 1))
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

/** MerkleProof.verify for (addr, allowance). */
export function verify(proof, root, addr, allowance) {
  let h = leafOf(addr, allowance)
  for (const p of proof) h = hashPair(h, p)
  return h.toLowerCase() === String(root).toLowerCase()
}
