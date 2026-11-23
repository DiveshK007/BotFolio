import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { merkleProof, merkleRoot, verifyMerkleProof } from "../../src/season/merkle";

// The reference vector in packages/contracts/test/TrustScoreRegistry.t.sol (#14).
const LEAF1 = "0x028f844c6dfc35b2e05a38c1999a513aa7a3c402baef24404f13b0040a57c664";
const LEAF2 = "0xf5fb168b0f752662c47d9dfaf40a64f885f554e0f3abdae613be2ba0379a6bef";
const LEAF3 = "0xcbdc486bb67594a46746fb4539742a812fb939ec676722dc7667f47e8f31cec7";
const LEFT = "0xba716959618cf137cb25b4039ec8e7528f56b459640af8d183276eb6e23ef6ba";
const ROOT = "0xc59ae547a0bb58564c2bef1213088509f23b9f3d74f4791aab9fca584ed6b446";

const leaf = (season: number, botId: bigint, f: [number, number, number, number], total: number): Hex =>
  keccak256(
    encodeAbiParameters(
      ["uint32", "uint256", "uint16", "uint16", "uint16", "uint16", "uint16"].map((type) => ({ type })),
      [season, botId, ...f, total],
    ),
  );

describe("the contract's Merkle vector", () => {
  it("leaves are abi.encode(season, botId, f1..f4, total)", () => {
    expect(leaf(3, 1n, [240, 200, 125, 250], 815)).toBe(LEAF1);
    expect(leaf(3, 2n, [250, 250, 250, 250], 1000)).toBe(LEAF2);
    expect(leaf(3, 3n, [0, 17, 99, 4], 120)).toBe(LEAF3);
  });

  it("gives the same root, and the proofs the contract test uses", () => {
    expect(merkleRoot([LEAF1, LEAF2, LEAF3])).toBe(ROOT);
    expect(merkleProof([LEAF1, LEAF2, LEAF3], 0)).toEqual([LEAF2, LEAF3]);
    expect(merkleProof([LEAF1, LEAF2, LEAF3], 1)).toEqual([LEAF1, LEAF3]);
    expect(merkleProof([LEAF1, LEAF2, LEAF3], 2)).toEqual([LEFT]);
  });
});

describe("merkleProof", () => {
  const leaves = Array.from({ length: 11 }, (_, i) => keccak256(`0x${(i + 1).toString(16).padStart(2, "0")}`));

  it("verifies for every leaf of an odd-sized tree, and only for that leaf", () => {
    const root = merkleRoot(leaves);
    leaves.forEach((l, i) => {
      expect(verifyMerkleProof(merkleProof(leaves, i), root, l)).toBe(true);
      expect(verifyMerkleProof(merkleProof(leaves, i), root, leaves[(i + 1) % leaves.length]!)).toBe(false);
    });
  });

  it("a single leaf is its own root", () => {
    expect(merkleRoot([LEAF1])).toBe(LEAF1);
    expect(merkleProof([LEAF1], 0)).toEqual([]);
  });

  it("refuses an empty tree", () => {
    expect(() => merkleRoot([])).toThrow();
  });
});
