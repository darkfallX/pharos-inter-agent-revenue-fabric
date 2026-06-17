// Seed the graph with dry-run demo activity when empty, so a fresh/ephemeral
// deploy shows data on first load. Registry-free (no RPC), so it can run in the
// server process without blocking boot. Idempotent; disable with SEED_ON_START=false.

import { calculateRoyaltyBreakdown } from './fabric.js';
import { buildProvenanceProof, generateInvocationId } from './provenance.js';
import { recordTraceResult, getGraphSnapshot } from './graph.js';
import { toAtomicUsdc } from '../chain/x402.js';
import { PHAROS_CHAIN_ID } from '../chain/chains.js';

const ZERO = '0x0000000000000000000000000000000000000000';

const CREATORS = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
];

const CHAINS = [
  ['pharos-autonomous-execution-engine', 'pharos-strategy-composer', 'pharos-realfi-security-scout'],
  ['pharospay', 'pharos-x402-skill', 'pharos-aml-sentinel'],
  ['pharos-rwa-yield-router', 'pharos-rwa-engine', 'pharos-contract-intelligence'],
  ['pharos-realfi-security-scout', 'pharos-contract-auditor', 'pharos-contract-intelligence'],
  ['pharos-inter-agent-revenue-fabric', 'pharos-x402-skill'],
  ['splitra', 'pharos-x402-skill'],
  ['pharos-agent-transaction-firewall', 'wallet-risk-intelligence', 'pharos-wallet-intel'],
  ['pharos-strategy-composer', 'pharos-dex-swap', 'pharos-tx-decoder'],
];

function creatorFor(skillId) {
  let n = 0;
  for (let i = 0; i < skillId.length; i++) n = (n * 31 + skillId.charCodeAt(i)) % 997;
  return CREATORS[n % CREATORS.length];
}

export function seedGraphIfEmpty() {
  try {
    if (process.env.SEED_ON_START === 'false') return { seeded: 0, skipped: true };
    if (getGraphSnapshot({ topN: 1 }).totalInvocations > 0) return { seeded: 0, skipped: true };

    let seeded = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < CHAINS.length; i++) {
        const chain = CHAINS[i];
        const amount = (0.03 + ((i * 7 + pass * 13) % 47) / 100).toFixed(4);
        const totalAtomic = toAtomicUsdc(amount);

        const nodes = chain.map((id, d) => ({
          skillId: id,
          creator: creatorFor(id),
          contributionWeight: 10000 - d * 800,
          royaltyBps: 450,
          depth: d,
        }));
        const edges = [];
        for (let d = 1; d < chain.length; d++) edges.push({ from: chain[d - 1], to: chain[d], depth: d });

        const tree = { rootSkillId: chain[0], nodes, edges, depth: nodes.length - 1, nodeCount: nodes.length };
        const royaltyBreakdown = calculateRoyaltyBreakdown(tree, totalAtomic);
        const invocationId = generateInvocationId();
        const provenanceProof = buildProvenanceProof({
          invocationId,
          rootSkillId: chain[0],
          payer: ZERO,
          royaltyBreakdown,
          totalAtomic: totalAtomic.toString(),
          chainId: PHAROS_CHAIN_ID,
        });

        recordTraceResult({
          invocationId,
          rootSkillId: chain[0],
          provenanceProof,
          callStackVerification: null,
          paymentSettlement: null,
          onChainProofRecord: null,
          timestamp: new Date().toISOString(),
          totalPaid: { atomic: totalAtomic.toString(), usdc: amount },
          royaltyBreakdown,
          dependencyTree: { edges },
          payer: ZERO,
          dryRun: true,
          payments: [],
        });
        seeded++;
      }
    }
    return { seeded, skipped: false };
  } catch (err) {
    console.error('[seed-graph] non-fatal:', err.message);
    return { seeded: 0, error: err.message };
  }
}

export default seedGraphIfEmpty;
