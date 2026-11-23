import { concat, keccak256, type Hex } from "viem";

/*
 * The tree OpenZeppelin's MerkleProof verifies: keccak256 of each pair, the smaller hash first, and an odd node
 * moved up a level unchanged. Leaves keep the order they are given in.
 * TrustScoreRegistry.verifyScore and the season data root (SPEC §6.5) both use it.
 */

const hashPair = (a: Hex, b: Hex): Hex => (a.toLowerCase() < b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

function levels(leaves: readonly Hex[]): Hex[][] {
  if (leaves.length === 0) throw new Error("a Merkle tree needs at least one leaf");
  const all: Hex[][] = [[...leaves]];
  while (all.at(-1)!.length > 1) {
    const level = all.at(-1)!;
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    all.push(next);
  }
  return all;
}

export function merkleRoot(leaves: readonly Hex[]): Hex {
  return levels(leaves).at(-1)![0]!;
}

/** The sibling hashes from leaf `index` up, as `MerkleProof.verify` takes them. */
export function merkleProof(leaves: readonly Hex[], index: number): Hex[] {
  if (index < 0 || index >= leaves.length) throw new RangeError(`no leaf ${index}`);
  const proof: Hex[] = [];
  let at = index;
  for (const level of levels(leaves).slice(0, -1)) {
    const sibling = at % 2 === 0 ? at + 1 : at - 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    at = Math.floor(at / 2);
  }
  return proof;
}

/** What `MerkleProof.verify` computes. */
export function verifyMerkleProof(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  return proof.reduce(hashPair, leaf).toLowerCase() === root.toLowerCase();
}
