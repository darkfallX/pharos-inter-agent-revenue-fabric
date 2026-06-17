#!/usr/bin/env node
// One real onchain settlement: transfer USDC to a recipient and record the proof.
//   node scripts/settle-demo.js --skill <id> --to 0x<recipient> --amount 0.05
//   (set PHAROS_NETWORK, PRIVATE_KEY, FABRIC_REGISTRY_ADDRESS, USDC_ADDRESS, DRY_RUN=false)

import { traceAndRoute } from '../src/core/fabric.js';
import { BLOCK_EXPLORER, CHAIN_META, PHAROS_CHAIN_ID } from '../src/chain/chains.js';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const skillId = arg('--skill', 'pharos-realfi-security-scout');
const to = arg('--to');
const amount = arg('--amount', '0.05');

if (!to) {
  console.error('Error: --to <recipient wallet> is required');
  process.exit(1);
}
if (process.env.DRY_RUN === 'true') {
  console.error('Refusing to run: DRY_RUN=true. Set DRY_RUN=false for a real settlement.');
  process.exit(1);
}

const link = (h) => (BLOCK_EXPLORER ? `${BLOCK_EXPLORER}/tx/${h}` : h);

async function main() {
  console.log(`Real settlement on ${CHAIN_META.name} (chain ${PHAROS_CHAIN_ID})`);
  console.log(`  skill:  ${skillId}`);
  console.log(`  payer:  (PRIVATE_KEY wallet)`);
  console.log(`  → to:   ${to}`);
  console.log(`  amount: ${amount} USDC\n`);

  const report = await traceAndRoute({
    rootSkillId: skillId,
    amountUsdc: amount,
    callStack: {
      version: '1',
      frames: [{ skillId, creator: to, contributionWeight: 10000, depth: 0 }],
    },
    dryRun: false,
  });

  console.log('Settlement mode :', report.paymentSettlement?.mode);
  console.log('Dry run         :', report.dryRun);
  if (report.paymentError) console.log('Payment error   :', report.paymentError);

  console.log('\nPayments:');
  for (const p of report.payments) {
    console.log(`  ${p.status.toUpperCase()} ${p.amountUsdc} USDC → ${p.recipient}`);
    if (p.txHash) console.log(`    tx: ${link(p.txHash)}`);
  }

  if (report.provenanceProof?.recordTxHash) {
    console.log('\nProof recorded on-chain:');
    console.log(`  merkleRoot: ${report.provenanceProof.merkleRoot}`);
    console.log(`  tx:         ${link(report.provenanceProof.recordTxHash)}`);
  } else if (report.proofRecordError) {
    console.log('\nProof record error:', report.proofRecordError);
  }

  console.log('\ninvocationId:', report.invocationId);
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nSettlement failed:', err.message || err);
  process.exit(1);
});
