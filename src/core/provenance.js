import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  hashMessage,
  recoverMessageAddress,
  recoverTypedDataAddress,
  isAddress,
  zeroAddress,
} from 'viem';
import crypto from 'crypto';
import { PHAROS_CHAIN_ID } from '../chain/chains.js';

// EIP-712 typed data binds a frame signature to the chainId, so a frame signed
// for Pharos can't be replayed elsewhere. Opt in per frame with sigType:'eip712'.
const FRAME_712_TYPES = {
  CallStackFrame: [
    { name: 'invocationId', type: 'string' },
    { name: 'skillId', type: 'string' },
    { name: 'creator', type: 'address' },
    { name: 'contributionWeight', type: 'uint256' },
    { name: 'depth', type: 'uint256' },
    { name: 'parentSkillId', type: 'string' },
  ],
};

export function buildFrameTypedData(frame, invocationId, chainId = PHAROS_CHAIN_ID) {
  return {
    domain: { name: 'PharosRevenueFabric', version: '1', chainId: Number(chainId) },
    types: FRAME_712_TYPES,
    primaryType: 'CallStackFrame',
    message: {
      invocationId: invocationId || '',
      skillId: frame.skillId || '',
      creator: frame.creator && isAddress(frame.creator) ? frame.creator : zeroAddress,
      contributionWeight: BigInt(frame.contributionWeight ?? 0),
      depth: BigInt(frame.depth ?? 0),
      parentSkillId: frame.parentSkillId || '',
    },
  };
}

export async function signCallStackFrameTyped(walletClient, frame, invocationId, chainId = PHAROS_CHAIN_ID) {
  return walletClient.signTypedData(buildFrameTypedData(frame, invocationId, chainId));
}

export function generateProofId() {
  return `proof_${crypto.randomBytes(12).toString('hex')}`;
}

export function generateInvocationId() {
  return `inv_${crypto.randomBytes(12).toString('hex')}`;
}

function leafHash(entry) {
  const creator = isAddress(entry.creator) ? entry.creator : zeroAddress;
  return keccak256(
    encodeAbiParameters(parseAbiParameters('string, address, uint256, uint256'), [
      entry.skillId,
      creator,
      BigInt(entry.amountAtomic || '0'),
      BigInt(entry.normalizedShareBps || 0),
    ])
  );
}

export function buildCallStackFrameMessage(frame, invocationId) {
  return JSON.stringify({
    domain: 'pharos-inter-agent-revenue-fabric',
    version: '1',
    invocationId,
    skillId: frame.skillId,
    creator: frame.creator || null,
    contributionWeight: frame.contributionWeight ?? null,
    depth: frame.depth ?? 0,
    parentSkillId: frame.parentSkillId || null,
  });
}

// Must match the string the dashboard / CLI builds for a claim signature.
export function buildClaimMessage(skillId, wallet, chainId) {
  return ['Pharos Revenue Fabric', 'Claim skill: ' + skillId, 'Wallet: ' + wallet, 'Chain: ' + chainId].join('\n');
}

export async function signCallStackFrame(walletClient, frame, invocationId) {
  return walletClient.signMessage({ message: buildCallStackFrameMessage(frame, invocationId) });
}

export async function verifyCallStackFrame(frame, invocationId) {
  const issues = [];

  if (!frame?.skillId) issues.push('missing skillId');
  if (!frame?.creator || !isAddress(frame.creator)) issues.push('missing or invalid creator');
  if (!frame?.signature) issues.push('missing signature');
  if (frame?.signature && /^0x0+$/i.test(frame.signature)) issues.push('placeholder signature');

  let recovered = null;
  if (!issues.length) {
    try {
      if (frame.sigType === 'eip712') {
        recovered = await recoverTypedDataAddress({
          ...buildFrameTypedData(frame, invocationId, frame.chainId || PHAROS_CHAIN_ID),
          signature: frame.signature,
        });
      } else {
        recovered = await recoverMessageAddress({
          message: buildCallStackFrameMessage(frame, invocationId),
          signature: frame.signature,
        });
      }
      if (recovered.toLowerCase() !== frame.creator.toLowerCase()) {
        issues.push('signature does not match creator');
      }
    } catch {
      issues.push('signature recovery failed');
    }
  }

  return {
    skillId: frame?.skillId,
    creator: frame?.creator || null,
    recovered,
    sigType: frame?.sigType === 'eip712' ? 'eip712' : 'personal_sign',
    valid: issues.length === 0,
    issues,
  };
}

export async function verifyCallStackFrames(frames, invocationId) {
  const frameResults = await Promise.all(
    (frames || []).map((frame) => verifyCallStackFrame(frame, invocationId))
  );
  const validFrames = frameResults.filter((frame) => frame.valid).length;
  const signedFrames = frameResults.filter((frame) => !frame.issues.includes('missing signature')).length;
  const issues = frameResults.flatMap((frame) =>
    frame.issues.map((issue) => `${frame.skillId || 'unknown'}: ${issue}`)
  );

  return {
    required: false,
    valid: issues.length === 0,
    frameCount: frameResults.length,
    signedFrames,
    validFrames,
    invalidFrames: frameResults.length - validFrames,
    issues,
    frames: frameResults,
  };
}

export function computeMerkleRoot(royaltyBreakdown) {
  if (!royaltyBreakdown.length) return `0x${'0'.repeat(64)}`;

  let layer = royaltyBreakdown.map(leafHash);

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        // sort the pair so the root is independent of leaf order
        const pair = layer[i] < layer[i + 1] ? [layer[i], layer[i + 1]] : [layer[i + 1], layer[i]];
        next.push(keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), pair)));
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }

  return layer[0];
}

export function buildProvenanceProof({
  invocationId,
  rootSkillId,
  payer,
  royaltyBreakdown,
  totalAtomic,
  chainId,
  signatures = [],
}) {
  const merkleRoot = computeMerkleRoot(royaltyBreakdown);
  const proofId = generateProofId();

  const payload = {
    proofId,
    invocationId,
    rootSkillId,
    payer,
    merkleRoot,
    totalAtomic: totalAtomic.toString(),
    chainId,
    entryCount: royaltyBreakdown.length,
    createdAt: new Date().toISOString(),
  };

  return {
    proofId,
    invocationId,
    rootSkillId,
    payer,
    merkleRoot,
    payloadHash: keccak256(toHex(JSON.stringify(payload))),
    totalAtomic: totalAtomic.toString(),
    chainId,
    blockNumber: null,
    signatures,
    entries: royaltyBreakdown.map((e) => ({
      skillId: e.skillId,
      creator: e.creator,
      amountAtomic: e.amountAtomic,
      leaf: leafHash(e),
    })),
    verifyEndpoint: '/verify-payment',
  };
}

export async function signProvenanceProof(walletClient, proof) {
  const message = JSON.stringify({
    proofId: proof.proofId,
    merkleRoot: proof.merkleRoot,
    invocationId: proof.invocationId,
    totalAtomic: proof.entries?.length
      ? proof.entries.reduce((s, e) => s + BigInt(e.amountAtomic), 0n).toString()
      : '0',
  });

  return {
    signer: walletClient.account.address,
    signature: await walletClient.signMessage({ message }),
    message,
  };
}

export async function verifyProvenanceProof(proof, royaltyBreakdown) {
  const issues = [];

  if (!proof?.proofId) issues.push('missing proofId');
  if (!proof?.merkleRoot) issues.push('missing merkleRoot');

  const recomputed = computeMerkleRoot(royaltyBreakdown || []);
  if (proof?.merkleRoot && recomputed !== proof.merkleRoot) {
    issues.push('merkle root mismatch');
  }

  const sigResults = [];
  for (const sig of proof?.signatures || []) {
    try {
      const recovered = await recoverMessageAddress({ message: sig.message, signature: sig.signature });
      sigResults.push({ signer: sig.signer, recovered, valid: recovered.toLowerCase() === sig.signer.toLowerCase() });
      if (recovered.toLowerCase() !== sig.signer.toLowerCase()) {
        issues.push(`invalid signature from ${sig.signer}`);
      }
    } catch {
      issues.push(`failed to recover signature from ${sig.signer}`);
      sigResults.push({ signer: sig.signer, valid: false });
    }
  }

  return {
    valid: issues.length === 0,
    proofId: proof?.proofId,
    merkleRoot: proof?.merkleRoot,
    recomputedMerkleRoot: recomputed,
    issues,
    signatures: sigResults,
    verifiedAt: new Date().toISOString(),
  };
}

export function findProofInGraph(proofId) {
  return { proofId, status: 'lookup-required' };
}
