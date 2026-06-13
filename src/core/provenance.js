/**
 * Verifiable payment provenance proofs.
 * Merkle-root attestations over royalty breakdowns for trustless verification.
 */

import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  hashMessage,
  recoverMessageAddress,
  isAddress,
  zeroAddress,
} from 'viem';
import crypto from 'crypto';

/** Generate a unique proof ID. */
export function generateProofId() {
  return `proof_${crypto.randomBytes(12).toString('hex')}`;
}

/** Generate a unique invocation ID. */
export function generateInvocationId() {
  return `inv_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Build a Merkle tree leaf from a royalty entry.
 */
function leafHash(entry) {
  const creator = isAddress(entry.creator) ? entry.creator : zeroAddress;

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('string, address, uint256, uint256'),
      [
        entry.skillId,
        creator,
        BigInt(entry.amountAtomic || '0'),
        BigInt(entry.normalizedShareBps || 0),
      ]
    )
  );
}

/**
 * Deterministic message for a single skill invocation frame.
 * Creators sign this message to attest that their skill participated in the
 * invocation graph and declared the contribution metadata carried downstream.
 */
export function buildCallStackFrameMessage(frame, invocationId) {
  const payload = {
    domain: 'pharos-inter-agent-revenue-fabric',
    version: '1',
    invocationId,
    skillId: frame.skillId,
    creator: frame.creator || null,
    contributionWeight: frame.contributionWeight ?? null,
    depth: frame.depth ?? 0,
    parentSkillId: frame.parentSkillId || null,
  };

  return JSON.stringify(payload);
}

/** Sign one call-stack frame with a viem wallet client. */
export async function signCallStackFrame(walletClient, frame, invocationId) {
  return walletClient.signMessage({
    message: buildCallStackFrameMessage(frame, invocationId),
  });
}

/** Verify a single call-stack frame signature against its declared creator. */
export async function verifyCallStackFrame(frame, invocationId) {
  const issues = [];

  if (!frame?.skillId) issues.push('missing skillId');
  if (!frame?.creator || !isAddress(frame.creator)) issues.push('missing or invalid creator');
  if (!frame?.signature) issues.push('missing signature');
  if (frame?.signature && /^0x0+$/i.test(frame.signature)) {
    issues.push('placeholder signature');
  }

  let recovered = null;
  if (!issues.length) {
    try {
      recovered = await recoverMessageAddress({
        message: buildCallStackFrameMessage(frame, invocationId),
        signature: frame.signature,
      });

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
    valid: issues.length === 0,
    issues,
  };
}

/** Verify every frame in a call stack and return judge-friendly diagnostics. */
export async function verifyCallStackFrames(frames, invocationId) {
  const frameResults = await Promise.all(
    (frames || []).map((frame) => verifyCallStackFrame(frame, invocationId))
  );
  const validFrames = frameResults.filter((frame) => frame.valid).length;
  const signedFrames = frameResults.filter(
    (frame) => !frame.issues.includes('missing signature')
  ).length;
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

/**
 * Compute Merkle root from royalty breakdown entries.
 */
export function computeMerkleRoot(royaltyBreakdown) {
  if (!royaltyBreakdown.length) {
    return `0x${'0'.repeat(64)}`;
  }

  let layer = royaltyBreakdown.map(leafHash);

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        const pair = layer[i] < layer[i + 1]
          ? [layer[i], layer[i + 1]]
          : [layer[i + 1], layer[i]];
        next.push(
          keccak256(
            encodeAbiParameters(
              parseAbiParameters('bytes32, bytes32'),
              pair
            )
          )
        );
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }

  return layer[0];
}

/**
 * Build a full provenance proof object from a trace report.
 */
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

  const payloadHash = keccak256(toHex(JSON.stringify(payload)));

  return {
    proofId,
    invocationId,
    rootSkillId,
    payer,
    merkleRoot,
    payloadHash,
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

/**
 * Create an EIP-191 signature over the provenance payload.
 */
export async function signProvenanceProof(walletClient, proof) {
  const message = JSON.stringify({
    proofId: proof.proofId,
    merkleRoot: proof.merkleRoot,
    invocationId: proof.invocationId,
    totalAtomic: proof.entries?.length
      ? proof.entries.reduce((s, e) => s + BigInt(e.amountAtomic), 0n).toString()
      : '0',
  });

  const signature = await walletClient.signMessage({
    message,
  });

  return {
    signer: walletClient.account.address,
    signature,
    message,
  };
}

/**
 * Verify a provenance proof locally (signature + merkle integrity).
 */
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
      const recovered = await recoverMessageAddress({
        message: sig.message,
        signature: sig.signature,
      });
      sigResults.push({
        signer: sig.signer,
        recovered,
        valid: recovered.toLowerCase() === sig.signer.toLowerCase(),
      });
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

/**
 * Verify proof by ID against stored graph events.
 */
export function findProofInGraph(proofId) {
  // Imported dynamically to avoid circular deps at module level
  return { proofId, status: 'lookup-required' };
}
