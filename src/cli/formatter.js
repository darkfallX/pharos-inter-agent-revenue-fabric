/**
 * Beautiful human-readable CLI summary formatter.
 */

export function formatCliSummary(report) {
  if (report.mode === 'graph') {
    return formatGraphSummary(report.graphSnapshot || report);
  }
  if (report.rootSkillId) {
    return formatTraceSummary(report);
  }
  if (report.graphSnapshot && !report.invocationId) {
    return formatGraphSummary(report.graphSnapshot);
  }
  return formatTraceSummary(report);
}

function formatTraceSummary(report) {
  const lines = [];
  const w = 62;

  lines.push('');
  lines.push('═'.repeat(w));
  lines.push('  PHAROS INTER-AGENT REVENUE FABRIC');
  lines.push('  Recursive Dependency Royalties · x402 USDC · Pharos Mainnet');
  lines.push('═'.repeat(w));
  lines.push('');

  lines.push(`  Invocation:  ${report.invocationId}`);
  lines.push(`  Root Skill:  ${report.rootSkillId}`);
  lines.push(`  Total Paid:  ${report.totalPaid?.usdc} USDC`);
  lines.push(`  Payer:       ${report.payer || '(simulated)'}`);
  lines.push(`  Mode:        ${report.dryRun ? 'DRY RUN (no payments sent)' : 'LIVE'}`);
  lines.push(`  Chain:       Pharos Mainnet (${report.chainId})`);
  if (report.paymentSettlement?.mode) {
    lines.push(`  Settlement:  ${report.paymentSettlement.mode}`);
  }
  if (report.callStackVerification) {
    const sig = report.callStackVerification;
    lines.push(
      `  Signatures:  ${sig.validFrames}/${sig.frameCount} valid` +
        (sig.required ? ' (required)' : ' (advisory)')
    );
  }
  lines.push('');

  // Layer status
  lines.push('  UPGRADE LAYERS');
  lines.push('  ─────────────────────────────────────────────────────────────');
  lines.push('  [✓] Layer 1, Full Dependency Tree Tracking');
  lines.push(`       ${report.dependencyTree?.nodeCount || 0} skills in provenance graph`);
  lines.push('  [✓] Layer 2, Perpetual Royalties (on-chain registry)');
  lines.push('  [✓] Layer 3, Contribution-Weighted Splits');
  lines.push('  [✓] Layer 4, Public Skill Economy Graph');
  lines.push('');

  // Dependency tree
  if (report.dependencyTree?.nodes?.length) {
    lines.push('  DEPENDENCY TREE (A → B → C → D)');
    lines.push('  ─────────────────────────────────────────────────────────────');
    for (const node of report.dependencyTree.nodes) {
      const indent = '  '.repeat(node.depth + 2);
      const arrow = node.depth > 0 ? '└─ ' : '● ';
      lines.push(
        `${indent}${arrow}${node.skillId} (depth ${node.depth}, weight ${node.contributionWeight}bps)`
      );
    }
    lines.push('');
  }

  // Royalty breakdown
  if (report.royaltyBreakdown?.length) {
    lines.push('  ROYALTY BREAKDOWN');
    lines.push('  ─────────────────────────────────────────────────────────────');
    lines.push('  Skill                              Share      USDC');
    lines.push('  ─────────────────────────────────────────────────────────────');
    for (const entry of report.royaltyBreakdown) {
      const name = entry.skillId.padEnd(34).slice(0, 34);
      const share = `${(entry.normalizedShareBps / 100).toFixed(2)}%`.padStart(6);
      const usdc = entry.amountUsdc.padStart(10);
      lines.push(`  ${name}  ${share}  ${usdc}`);
      lines.push(`    → ${entry.creator} (depth ${entry.depth})`);
    }
    lines.push('');
  }

  // Payments
  if (report.payments?.length) {
    lines.push('  PAYMENTS');
    lines.push('  ─────────────────────────────────────────────────────────────');
    for (const p of report.payments) {
      const status = p.status === 'settled' ? '✅' : '⏳';
      lines.push(`  ${status} ${p.amountUsdc} USDC → ${p.recipient} [${p.skillId}]`);
      if (p.txHash) lines.push(`     tx: ${p.txHash}`);
    }
    lines.push('');
  }

  // Provenance
  if (report.provenanceProof) {
    lines.push('  PROVENANCE PROOF');
    lines.push('  ─────────────────────────────────────────────────────────────');
    lines.push(`  Proof ID:    ${report.provenanceProof.proofId}`);
    lines.push(`  Merkle Root: ${report.provenanceProof.merkleRoot}`);
    if (report.provenanceProof.recordTxHash) {
      lines.push(`  Record Tx:   ${report.provenanceProof.recordTxHash}`);
    }
    if (report.proofRecordError) {
      lines.push(`  Record Err:  ${report.proofRecordError}`);
    }
    lines.push('');
  }

  if (report.paymentError) {
    lines.push(`  ⚠ Payment error: ${report.paymentError}`);
    lines.push('');
  }

  lines.push('═'.repeat(w));
  lines.push('');

  return lines.join('\n');
}

function formatGraphSummary(snapshot) {
  const lines = [];
  const w = 62;

  lines.push('');
  lines.push('═'.repeat(w));
  lines.push('  PUBLIC SKILL ECONOMY GRAPH');
  lines.push('  Real-time value flow · foundational skills · top earners');
  lines.push('═'.repeat(w));
  lines.push('');
  lines.push(`  Total Invocations: ${snapshot.totalInvocations}`);
  lines.push(`  Gross Volume:      ${snapshot.totalGrossVolumeUsdc || snapshot.totalVolumeUsdc} USDC`);
  lines.push(`  Creator Earnings:  ${snapshot.totalCreatorEarningsUsdc || '0.000000'} USDC`);
  lines.push(`  Settled Volume:    ${snapshot.totalSettledVolumeUsdc || '0.000000'} USDC`);
  lines.push(`  Events Recorded:   ${snapshot.totalEvents}`);
  lines.push('');

  if (snapshot.foundationalSkills?.length) {
    lines.push('  FOUNDATIONAL SKILLS (most depended-upon)');
    lines.push('  ─────────────────────────────────────────────────────────────');
    for (const s of snapshot.foundationalSkills) {
      lines.push(
        `  ${s.skillId.padEnd(40)} deps:${String(s.dependencyReferences).padStart(4)}  vol:${s.totalVolumeUsdc}`
      );
    }
    lines.push('');
  }

  if (snapshot.topEarners?.length) {
    lines.push('  TOP EARNERS');
    lines.push('  ─────────────────────────────────────────────────────────────');
    for (const e of snapshot.topEarners) {
      lines.push(`  ${e.creator}  ${e.totalEarnedUsdc} USDC`);
    }
    lines.push('');
  }

  if (snapshot.valueFlow?.length) {
    lines.push('  VALUE FLOW');
    lines.push('  ─────────────────────────────────────────────────────────────');
    for (const f of snapshot.valueFlow.slice(0, 8)) {
      lines.push(`  ${f.from} → ${f.to}  (${f.flowCount} invocations)`);
    }
    lines.push('');
  }

  lines.push('═'.repeat(w));
  lines.push('');

  return lines.join('\n');
}
