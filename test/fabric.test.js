/**
 * Pharos Inter-Agent Revenue Fabric — unit tests
 */

import assert from 'assert';
import {
  parseCallStack,
  buildDependencyTree,
  calculateRoyaltyBreakdown,
  traceAndRoute,
} from '../src/fabric.js';
import {
  computeMerkleRoot,
  buildProvenanceProof,
  signCallStackFrame,
  verifyCallStackFrames,
  verifyProvenanceProof,
} from '../src/provenance.js';
import { getGraphSnapshot, recordEvent, loadEvents } from '../src/graph.js';
import { skillIdToBytes32 } from '../src/registry.js';
import { toAtomicUsdc } from '../src/x402.js';
import { privateKeyToAccount } from 'viem/accounts';

process.env.GRAPH_DATA_PATH = './data/test-graph.jsonl';
try {
  await import('node:fs').then((fs) => fs.unlinkSync(process.env.GRAPH_DATA_PATH));
} catch {
  /* no prior test graph */
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

console.log('\nPharos Inter-Agent Revenue Fabric — Tests\n');

// Layer 1: Call stack parsing
test('parseCallStack handles JSON object', () => {
  const stack = parseCallStack({ version: '1', frames: [{ skillId: 'a', depth: 0 }] });
  assert.strictEqual(stack.frames.length, 1);
  assert.strictEqual(stack.frames[0].skillId, 'a');
});

test('parseCallStack handles base64 header', () => {
  const raw = { version: '1', frames: [{ skillId: 'b', depth: 1 }] };
  const b64 = Buffer.from(JSON.stringify(raw)).toString('base64');
  const stack = parseCallStack(b64);
  assert.strictEqual(stack.frames[0].skillId, 'b');
});

test('skillIdToBytes32 is deterministic', () => {
  const a = skillIdToBytes32('pharos-yield-pilot');
  const b = skillIdToBytes32('pharos-yield-pilot');
  assert.strictEqual(a, b);
  assert.ok(a.startsWith('0x'));
});

// Layer 3: Royalty calculation
test('calculateRoyaltyBreakdown sums to total', () => {
  const tree = {
    nodes: [
      { skillId: 'a', creator: '0x1', contributionWeight: 10000, royaltyBps: 500, depth: 0 },
      { skillId: 'b', creator: '0x2', contributionWeight: 7500, royaltyBps: 600, depth: 1 },
      { skillId: 'c', creator: '0x3', contributionWeight: 8200, royaltyBps: 450, depth: 2 },
    ],
  };
  const total = toAtomicUsdc('1.00');
  const breakdown = calculateRoyaltyBreakdown(tree, total);
  const sum = breakdown.reduce((s, e) => s + BigInt(e.amountAtomic), 0n);
  assert.strictEqual(sum, total);
  assert.strictEqual(breakdown.length, 3);
});

test('depth decay reduces deeper skill shares', () => {
  const tree = {
    nodes: [
      { skillId: 'root', creator: '0x1', contributionWeight: 10000, royaltyBps: 0, depth: 0 },
      { skillId: 'child', creator: '0x2', contributionWeight: 10000, royaltyBps: 0, depth: 3 },
    ],
  };
  const breakdown = calculateRoyaltyBreakdown(tree, toAtomicUsdc('1.00'));
  const root = breakdown.find((e) => e.skillId === 'root');
  const child = breakdown.find((e) => e.skillId === 'child');
  assert.ok(Number(root.amountAtomic) > Number(child.amountAtomic));
});

// Provenance
test('computeMerkleRoot is stable', () => {
  const entries = [
    { skillId: 'a', creator: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amountAtomic: '500000', normalizedShareBps: 5000 },
    { skillId: 'b', creator: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', amountAtomic: '500000', normalizedShareBps: 5000 },
  ];
  const root1 = computeMerkleRoot(entries);
  const root2 = computeMerkleRoot(entries);
  assert.strictEqual(root1, root2);
});

test('buildProvenanceProof includes proofId and merkleRoot', () => {
  const proof = buildProvenanceProof({
    invocationId: 'inv_test',
    rootSkillId: 'test-skill',
    payer: '0x1',
    royaltyBreakdown: [],
    totalAtomic: '1000000',
    chainId: 1672,
  });
  assert.ok(proof.proofId.startsWith('proof_'));
  assert.ok(proof.merkleRoot.startsWith('0x'));
});

await testAsync('call-stack frame signatures verify', async () => {
  const account = privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f094538854a96d1b2c6f9d6f675b40d8f171650b'
  );
  const invocationId = 'inv_signed_test';
  const frame = {
    skillId: 'signed-demo-skill',
    creator: account.address,
    contributionWeight: 9000,
    depth: 0,
    parentSkillId: null,
  };
  frame.signature = await signCallStackFrame(account, frame, invocationId);

  const result = await verifyCallStackFrames([frame], invocationId);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.validFrames, 1);
});

await testAsync('trace can require signed call-stack frames', async () => {
  const account = privateKeyToAccount(
    '0x59c6995e998f97a5a0044966f094538854a96d1b2c6f9d6f675b40d8f171650b'
  );
  const invocationId = 'inv_required_signature_test';
  const frame = {
    skillId: 'signed-demo-skill',
    creator: account.address,
    contributionWeight: 9000,
    depth: 0,
    parentSkillId: null,
  };
  frame.signature = await signCallStackFrame(account, frame, invocationId);

  const report = await traceAndRoute({
    rootSkillId: 'signed-demo-skill',
    amountUsdc: '0.01',
    callStack: { version: '1', invocationId, frames: [frame] },
    dryRun: true,
    requireFrameSignatures: true,
  });

  assert.strictEqual(report.callStackVerification.valid, true);
  assert.strictEqual(report.royaltyBreakdown.length, 1);
});

await testAsync('direct proof verification succeeds with proof bundle', async () => {
  const royaltyBreakdown = [
    {
      skillId: 'a',
      creator: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amountAtomic: '100000',
      normalizedShareBps: 10000,
    },
  ];
  const proof = buildProvenanceProof({
    invocationId: 'inv_proof_bundle',
    rootSkillId: 'a',
    payer: '0x0000000000000000000000000000000000000000',
    royaltyBreakdown,
    totalAtomic: '100000',
    chainId: 1672,
  });
  const result = await verifyProvenanceProof(proof, royaltyBreakdown);
  assert.strictEqual(result.valid, true);
});

// Layer 1 async: dependency tree
await testAsync('buildDependencyTree resolves demo skills', async () => {
  const stack = parseCallStack({
    version: '1',
    frames: [
      { skillId: 'pharos-yield-pilot', depth: 0 },
      { skillId: 'pharos-realfi-security-scout', depth: 1, parentSkillId: 'pharos-yield-pilot' },
    ],
  });
  const tree = await buildDependencyTree('pharos-yield-pilot', stack);
  assert.ok(tree.nodes.length >= 2);
  assert.ok(tree.edges.length >= 1);
});

// Layer 4: Economy graph
test('getGraphSnapshot returns valid structure', () => {
  const snap = getGraphSnapshot({ topN: 5 });
  assert.ok('totalInvocations' in snap);
  assert.ok('foundationalSkills' in snap);
  assert.ok('topEarners' in snap);
  assert.ok('valueFlow' in snap);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
try {
  await import('node:fs').then((fs) => fs.unlinkSync(process.env.GRAPH_DATA_PATH));
} catch {
  /* ignore cleanup errors */
}
process.exit(failed > 0 ? 1 : 0);
