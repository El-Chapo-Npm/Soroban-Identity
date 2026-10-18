import { hash } from '@stellar/stellar-sdk';

export interface MerkleProofStep {
  position: 'left' | 'right';
  data: string;
}

export type MerkleProof = MerkleProofStep[];

export interface MerkleBatchRoot {
  batchId: string;
  root: string;
  count: number;
}

export interface MerkleTree {
  leaves: string[];
  levels: string[][];
  root: string;
}

export function hashLeaf(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'hex') : data;
  return Buffer.from(hash(buf)).toString('hex');
}

export function hashNodes(left: string, right: string): string {
  const leftBuf = Buffer.from(left, 'hex');
  const rightBuf = Buffer.from(right, 'hex');
  return Buffer.from(hash(Buffer.concat([leftBuf, rightBuf]))).toString('hex');
}

export function buildMerkleTree(credentialIds: string[]): MerkleTree {
  if (credentialIds.length === 0) {
    throw new Error('Cannot build tree with 0 leaves');
  }
  const leaves = credentialIds.map((id) => (id.length === 64 ? id : hashLeaf(id)));
  const levels: string[][] = [leaves];

  let currentLevel = leaves;
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hashNodes(left, right));
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  return {
    leaves,
    levels,
    root: levels[levels.length - 1][0],
  };
}

export function generateMerkleProof(tree: MerkleTree, leafHashOrId: string): MerkleProof {
  let index = tree.leaves.indexOf(leafHashOrId);
  if (index === -1) {
    const hashed = hashLeaf(leafHashOrId);
    index = tree.leaves.indexOf(hashed);
  }
  if (index === -1) {
    throw new Error(`Leaf not found in Merkle tree: ${leafHashOrId}`);
  }

  const proof: MerkleProof = [];
  let currentIndex = index;

  for (let i = 0; i < tree.levels.length - 1; i++) {
    const level = tree.levels[i];
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

    if (siblingIndex < level.length) {
      proof.push({
        position: isRight ? 'left' : 'right',
        data: level[siblingIndex],
      });
    } else {
      proof.push({
        position: 'right',
        data: level[currentIndex],
      });
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
}

export function verifyMerkleProof(leafHashOrId: string, proof: MerkleProof, expectedRoot: string): boolean {
  let currentHash = leafHashOrId.length === 64 ? leafHashOrId : hashLeaf(leafHashOrId);

  for (const step of proof) {
    if (step.position === 'left') {
      currentHash = hashNodes(step.data, currentHash);
    } else {
      currentHash = hashNodes(currentHash, step.data);
    }
  }

  return currentHash.toLowerCase() === expectedRoot.toLowerCase();
}
