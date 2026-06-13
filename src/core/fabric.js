/**
 * Pharos Inter-Agent Revenue Fabric — Core Engine
 *
 * Layer 1: Full dependency tree tracking via call-stack headers
 * Layer 2: Perpetual royalties from on-chain registry
 * Layer 3: Contribution-weighted dynamic splits
 * Layer 4: Economy graph recording
 */

import dotenv from 'dotenv';
import { PHAROS_CHAIN_ID } from '../chain/chains.js';
import {
  getSkill,
  expandDependencyTree,
  registerSkill,
  setSuccessor,
  getWalletClient,
  recordPaymentProof,
  verifyRecordedPaymentProof,
} from '../chain/registry.js';
import { routeRoyaltyPayments, toAtomicUsdc, fromAtomicUsdc } from '../chain/x402.js';
import {
  buildProvenanceProof,
  signProvenanceProof,
  verifyProvenanceProof,
  verifyCallStackFrames,
  generateInvocationId,
} from './provenance.js';
import { getGraphSnapshot, recordTraceResult, loadEvents } from './graph.js';

dotenv.config();

const DEPTH_DECAY = parseFloat(process.env.DEPTH_DECAY || '0.85');
const SCHEMA_VERSION = '1.1.0';

/**
 * Parse call stack from JSON object, file contents, or base64 header.
 */
export function parseCallStack(input) {
  if (!input) return { version: '1', frames: [] };

  if (typeof input === 'string') {
    // Try base64 header decode
    try {
      const decoded = Buffer.from(input, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed.frames) return normalizeCallStack(parsed);
    } catch {
      /* not base64 */
    }

    // Try inline JSON
    try {
      const parsed = JSON.parse(input);
      return normalizeCallStack(parsed);
    } catch {
      throw new Error('Invalid call stack: expected JSON object or base64 header');
    }
  }

  return normalizeCallStack(input);
}

function normalizeCallStack(stack) {
  const frames = (stack.frames || []).map((f, idx) => ({
    skillId: f.skillId,
    creator: f.creator || null,
    contributionWeight: f.contributionWeight ?? null,
    depth: f.depth ?? idx,
    parentSkillId: f.parentSkillId || null,
    signature: f.signature || null,
  }));

  return {
    version: stack.version || '1',
    invocationId: stack.invocationId || generateInvocationId(),
    timestamp: stack.timestamp || Date.now(),
    frames,
  };
}

/**
 * Merge call-stack frames with on-chain registry data to build full dependency tree.
 * Layer 1: recursive composability chain resolution.
 */
export async function buildDependencyTree(rootSkillId, callStack) {
  const onChainTree = await expandDependencyTree(rootSkillId);

  const nodes = [];
  const seen = new Set();

  // Include call-stack frames first (live invocation context)
  for (const frame of callStack.frames) {
    if (seen.has(frame.skillId)) continue;
    seen.add(frame.skillId);

    const onChain = await getSkill(frame.skillId);
    nodes.push({
      skillId: frame.skillId,
      creator: frame.creator || onChain?.creator || null,
      contributionWeight:
        frame.contributionWeight ?? onChain?.contributionWeight ?? 5000,
      royaltyBps: onChain?.royaltyBps ?? 500,
      depth: frame.depth,
      parentSkillId: frame.parentSkillId,
      source: frame.creator ? 'call-stack' : onChain?.source || 'unknown',
      signature: frame.signature,
    });
  }

  // Augment with on-chain dependency tree
  for (const node of onChainTree.nodes) {
    if (seen.has(node.skillId)) continue;
    seen.add(node.skillId);
    nodes.push({
      ...node,
      parentSkillId: onChainTree.edges.find((e) => e.to === node.skillId)?.from || null,
      source: node.source || 'on-chain',
    });
  }

  // Ensure root is present
  if (!seen.has(rootSkillId)) {
    const root = await getSkill(rootSkillId);
    if (root) {
      nodes.unshift({
        skillId: rootSkillId,
        creator: root.creator,
        contributionWeight: root.contributionWeight,
        royaltyBps: root.royaltyBps,
        depth: 0,
        parentSkillId: null,
        source: root.source,
      });
    }
  }

  nodes.sort((a, b) => a.depth - b.depth);

  const edges = [];
  for (const node of nodes) {
    if (node.parentSkillId) {
      edges.push({ from: node.parentSkillId, to: node.skillId, depth: node.depth });
    }
  }
  for (const e of onChainTree.edges) {
    const key = `${e.from}->${e.to}`;
    if (!edges.some((x) => `${x.from}->${x.to}` === key)) {
      edges.push(e);
    }
  }

  return {
    rootSkillId,
    nodes,
    edges,
    depth: Math.max(...nodes.map((n) => n.depth), 0),
    nodeCount: nodes.length,
  };
}

/**
 * Calculate contribution-weighted, depth-decayed royalty splits.
 * Layer 2 (perpetual royaltyBps) + Layer 3 (contributionWeight).
 */
export function calculateRoyaltyBreakdown(dependencyTree, totalAtomic) {
  const total = BigInt(totalAtomic);
  const { nodes } = dependencyTree;

  if (!nodes.length) {
    return [];
  }

  // Compute raw weights: depthDecay * contributionFactor * (1 + perpetualRoyalty)
  const rawWeights = nodes.map((node) => {
    const depthWeight = Math.pow(DEPTH_DECAY, node.depth);
    const contributionFactor = (node.contributionWeight || 5000) / 10000;
    const perpetualBoost = 1 + (node.royaltyBps || 0) / 10000;
    const raw = depthWeight * contributionFactor * perpetualBoost;
    return { node, raw, depthWeight, contributionFactor, perpetualBoost };
  });

  const sumRaw = rawWeights.reduce((s, w) => s + w.raw, 0) || 1;

  const breakdown = rawWeights.map(({ node, raw, depthWeight }) => {
    const shareBps = Math.round((raw / sumRaw) * 10000);
    const amount = (total * BigInt(shareBps)) / 10000n;

    return {
      skillId: node.skillId,
      creator: node.creator,
      depth: node.depth,
      contributionWeight: node.contributionWeight,
      royaltyBps: node.royaltyBps,
      depthWeight: Math.round(depthWeight * 10000) / 10000,
      normalizedShareBps: shareBps,
      amountAtomic: amount.toString(),
      amountUsdc: fromAtomicUsdc(amount),
      perpetualRoyaltyBps: node.royaltyBps,
    };
  });

  // Distribute rounding dust to root skill creator
  const distributed = breakdown.reduce(
    (s, e) => s + BigInt(e.amountAtomic),
    0n
  );
  const dust = total - distributed;
  if (dust > 0n && breakdown.length) {
    breakdown[0].amountAtomic = (BigInt(breakdown[0].amountAtomic) + dust).toString();
    breakdown[0].amountUsdc = fromAtomicUsdc(breakdown[0].amountAtomic);
  }

  return breakdown;
}

/**
 * Full trace + optional payment routing pipeline.
 */
export async function traceAndRoute({
  rootSkillId,
  amountUsdc,
  callStack: callStackInput,
  payer: payerOverride,
  dryRun = process.env.DRY_RUN === 'true',
  signProof = false,
  requireFrameSignatures = process.env.REQUIRE_FRAME_SIGNATURES === 'true',
}) {
  const callStack = parseCallStack(callStackInput);
  const invocationId = callStack.invocationId || generateInvocationId();
  const totalAtomic = toAtomicUsdc(amountUsdc);

  if (totalAtomic <= 0n) {
    throw new Error('amountUsdc must be greater than zero');
  }

  const callStackVerification = await verifyCallStackFrames(
    callStack.frames,
    invocationId
  );
  callStackVerification.required = Boolean(requireFrameSignatures);
  if (requireFrameSignatures && !callStackVerification.valid) {
    throw new Error(
      `Call-stack signature verification failed: ${callStackVerification.issues.join('; ')}`
    );
  }

  const dependencyTree = await buildDependencyTree(rootSkillId, callStack);
  const royaltyBreakdown = calculateRoyaltyBreakdown(dependencyTree, totalAtomic);

  let payer = payerOverride || null;
  let payments = [];
  let paymentError = null;
  let effectiveDryRun = dryRun;
  let paymentSettlement = null;

  if (!effectiveDryRun) {
    try {
      const result = await routeRoyaltyPayments(royaltyBreakdown, { dryRun: false });
      payer = result.payer;
      payments = result.payments;
      paymentSettlement = {
        mode: result.settlementMode,
        x402Strict: result.x402Strict,
        facilitatorConfigured: result.facilitatorConfigured,
        totalPaidAtomic: result.totalPaidAtomic,
      };
    } catch (err) {
      paymentError = err.message;
      effectiveDryRun = true;
      const result = await routeRoyaltyPayments(royaltyBreakdown, { dryRun: true });
      payer = payerOverride || result.payer || '0x0000000000000000000000000000000000000000';
      payments = result.payments;
      paymentSettlement = {
        mode: result.settlementMode,
        x402Strict: result.x402Strict,
        facilitatorConfigured: result.facilitatorConfigured,
        totalPaidAtomic: result.totalPaidAtomic,
        fallbackReason: paymentError,
      };
    }
  } else {
    const result = await routeRoyaltyPayments(royaltyBreakdown, { dryRun: true });
    payer = payerOverride || result.payer || '0x0000000000000000000000000000000000000000';
    payments = result.payments;
    paymentSettlement = {
      mode: result.settlementMode,
      x402Strict: result.x402Strict,
      facilitatorConfigured: result.facilitatorConfigured,
      totalPaidAtomic: result.totalPaidAtomic,
    };
  }

  let provenanceProof = buildProvenanceProof({
    invocationId,
    rootSkillId,
    payer,
    royaltyBreakdown,
    totalAtomic: totalAtomic.toString(),
    chainId: PHAROS_CHAIN_ID,
  });

  if (signProof && !effectiveDryRun && process.env.PRIVATE_KEY) {
    try {
      const wallet = getWalletClient();
      const sig = await signProvenanceProof(wallet, provenanceProof);
      provenanceProof.signatures = [sig];
    } catch {
      /* signing optional */
    }
  }

  let onChainProofRecord = null;
  let proofRecordError = null;
  if (!effectiveDryRun && !paymentError && payments.some((p) => p.status === 'settled')) {
    try {
      onChainProofRecord = await recordPaymentProof({
        invocationId,
        rootSkillId,
        royaltyBreakdown,
        merkleRoot: provenanceProof.merkleRoot,
      });
      provenanceProof.blockNumber = onChainProofRecord.blockNumber || null;
      provenanceProof.recordTxHash = onChainProofRecord.txHash || null;
    } catch (err) {
      proofRecordError = err.message;
    }
  }

  let graphSnapshot = null;

  const report = {
    schemaVersion: SCHEMA_VERSION,
    skill: 'pharos-inter-agent-revenue-fabric',
    chainId: PHAROS_CHAIN_ID,
    invocationId,
    timestamp: new Date().toISOString(),
    rootSkillId,
    callStack: callStack.frames,
    callStackVerification,
    dependencyTree,
    royaltyBreakdown,
    totalPaid: {
      usdc: amountUsdc.toString(),
      atomic: totalAtomic.toString(),
    },
    payer,
    payments,
    paymentSettlement,
    paymentError,
    provenanceProof,
    onChainProofRecord,
    proofRecordError,
    graphSnapshot,
    layers: {
      dependencyTracking: true,
      perpetualRoyalties: true,
      contributionWeights: true,
      economyGraph: true,
    },
    dryRun: effectiveDryRun || !!paymentError,
    depthDecay: DEPTH_DECAY,
  };

  recordTraceResult(report);
  report.graphSnapshot = getGraphSnapshot({ topN: 10 });
  return report;
}

/**
 * Verify a payment proof by proofId or txHash against graph history.
 */
export async function verifyPayment({ proofId, txHash, royaltyBreakdown, proof }) {
  if (proof && royaltyBreakdown) {
    const local = await verifyProvenanceProof(proof, royaltyBreakdown);
    return {
      ...local,
      onChain: proof.invocationId && proof.merkleRoot
        ? await verifyRecordedPaymentProof({
            invocationId: proof.invocationId,
            merkleRoot: proof.merkleRoot,
          }).catch((err) => ({
            checked: false,
            valid: null,
            mode: 'error',
            message: err.message,
          }))
        : { checked: false, valid: null, mode: 'missing-invocation' },
    };
  }

  const events = loadEvents();

  let matchedEvent = null;
  if (proofId) {
    matchedEvent = events.find(
      (e) => e.proofId === proofId || e.invocationId === proofId
    );
  }
  if (!matchedEvent && txHash) {
    matchedEvent = events.find(
      (e) => e.txHashes?.includes(txHash) || e.txHash === txHash
    );
  }

  if (matchedEvent?.royaltyBreakdown) {
    const proof = {
      proofId: matchedEvent.proofId || proofId,
      invocationId: matchedEvent.invocationId,
      merkleRoot: matchedEvent.merkleRoot,
      signatures: matchedEvent.signatures || [],
    };
    const local = await verifyProvenanceProof(proof, matchedEvent.royaltyBreakdown);
    return {
      ...local,
      onChain: matchedEvent.merkleRoot
        ? await verifyRecordedPaymentProof({
            invocationId: matchedEvent.invocationId,
            merkleRoot: matchedEvent.merkleRoot,
          }).catch((err) => ({
            checked: false,
            valid: null,
            mode: 'error',
            message: err.message,
          }))
        : { checked: false, valid: null, mode: 'missing-merkle-root' },
    };
  }

  if (royaltyBreakdown && proofId) {
    return verifyProvenanceProof({ proofId, merkleRoot: null }, royaltyBreakdown);
  }

  return {
    valid: false,
    proofId,
    txHash,
    issues: ['proof not found in graph history'],
    verifiedAt: new Date().toISOString(),
  };
}

export {
  registerSkill,
  setSuccessor,
  getGraphSnapshot,
  SCHEMA_VERSION,
};
