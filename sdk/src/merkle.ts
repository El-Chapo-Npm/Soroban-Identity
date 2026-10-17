import { hash } from "@stellar/stellar-sdk";
import { SorobanIdentityError } from "./errors";
import type { MerkleProof, MerkleBatchRoot } from "./types";

export type { MerkleProof, MerkleBatchRoot };

export interface MerkleProofStep {
  hash: string;
  position: "left" | "right";
  siblingOnLeft?: boolean;
  index?: number;
}

export interface MerkleTree {
  root: string;
  leaves: string[];
  levels: string[][];
}

const MERKLE_LEAF_PREFIX = Buffer.from([0x00]);
const MERKLE_NODE_PREFIX = Buffer.from([0x01]);

export function normalizeCredentialIdHex(credentialId: string): string {
  const hex = credentialId.startsWith("0x") ? credentialId.slice(2) : credentialId;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new SorobanIdentityError(
      "InvalidCredentialId: credential ID must be a 64-character hex string (32 bytes)",
      "VALIDATION_ERROR"
    );
  }
  return hex.toLowerCase();
}

export function hashLeaf(credentialIdHex: string): string {
  const idBytes = Buffer.from(normalizeCredentialIdHex(credentialIdHex), "hex");
  return hash(Buffer.concat([MERKLE_LEAF_PREFIX, idBytes])).toString("hex");
}

export function hashNodes(leftHex: string, rightHex: string): string {
  return hash(
    Buffer.concat([
      MERKLE_NODE_PREFIX,
      Buffer.from(leftHex, "hex"),
      Buffer.from(rightHex, "hex"),
    ])
  ).toString("hex");
}

export function buildMerkleTree(credentialIds: string[]): MerkleTree {
  if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
    throw new SorobanIdentityError(
      "InvalidBatch: at least one credential ID is required to build a merkle tree",
      "VALIDATION_ERROR"
    );
  }
  const leaves = credentialIds.map(hashLeaf);
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashNodes(current[i]!, current[i + 1]!));
      } else {
        next.push(current[i]!);
      }
    }
    levels.push(next);
    current = next;
  }
  return { root: current[0]!, leaves, levels };
}

export function updateMerkleTree(tree: MerkleTree, index: number, newLeaf: string): MerkleTree {
  if (index < 0 || index >= tree.leaves.length) {
    throw new SorobanIdentityError(
      `InvalidIndex: index ${index} out of bounds for leaf count ${tree.leaves.length}`,
      "VALIDATION_ERROR"
    );
  }
  const newLeaves = [...tree.leaves];
  newLeaves[index] = hashLeaf(newLeaf);
  return buildMerkleTree(newLeaves);
}

export function generateMerkleProof(
  credentialIds: string[],
  credentialId: string
): MerkleProof {
  const target = normalizeCredentialIdHex(credentialId);
  const normalized = credentialIds.map(normalizeCredentialIdHex);
  const index = normalized.indexOf(target);
  if (index === -1) {
    throw new SorobanIdentityError(
      `InvalidProof: credential ${credentialId} is not part of the batch`,
      "VALIDATION_ERROR"
    );
  }

  const tree = buildMerkleTree(normalized);
  const siblings: any[] = [];
  let idx = index;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level]!;
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    if (siblingIdx < nodes.length) {
      siblings.push({
        hash: nodes[siblingIdx]!,
        index: siblingIdx,
        siblingOnLeft: isRightNode,
        position: isRightNode ? "left" : "right",
      });
    }
    idx = Math.floor(idx / 2);
  }

  return {
    leaf: hashLeaf(target),
    credentialId: target,
    siblings,
    path: siblings,
    root: tree.root,
    index,
    leafIndex: index,
    leafCount: normalized.length,
  } as any;
}

export function verifyMerkleProof(proof: any, root?: string): boolean {
  if (!proof) return false;
  const path = proof.siblings || proof.path;
  if (!Array.isArray(path)) return false;
  let current: string;
  try {
    current = proof.leaf || (proof.credentialId ? hashLeaf(proof.credentialId) : "");
  } catch {
    return false;
  }
  if (!current) return false;
  for (const node of path) {
    if (!node || !/^[0-9a-fA-F]{64}$/.test(node.hash)) return false;
    const sibling = node.hash.toLowerCase();
    const isLeft = node.siblingOnLeft ?? node.position === "left";
    current = isLeft ? hashNodes(sibling, current) : hashNodes(current, sibling);
  }
  const expected = (root ?? proof.root).toLowerCase();
  return current === expected;
}
