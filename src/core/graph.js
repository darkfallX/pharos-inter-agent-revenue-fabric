import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_GRAPH_PATH = './data/graph.jsonl';

function graphPath() {
  return process.env.GRAPH_DATA_PATH || DEFAULT_GRAPH_PATH;
}

function ensureGraphFile() {
  const p = graphPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, '');
}

export function recordEvent(event) {
  ensureGraphFile();
  const line = JSON.stringify({ ...event, recordedAt: new Date().toISOString() });
  fs.appendFileSync(graphPath(), `${line}\n`);
}

export function loadEvents() {
  ensureGraphFile();
  const raw = fs.readFileSync(graphPath(), 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function getGraphSnapshot({ topN = 10, sinceMs = null } = {}) {
  let events = loadEvents();

  if (sinceMs) {
    const cutoff = Date.now() - sinceMs;
    events = events.filter((e) => new Date(e.recordedAt || e.timestamp).getTime() >= cutoff);
  }

  const skillStats = new Map();
  const creatorEarnings = new Map();
  const edges = new Map();
  let totalGrossVolumeAtomic = 0n;
  let totalSettledVolumeAtomic = 0n;
  let totalEarnedAtomic = 0n;
  let invocationCount = 0;
  let settledPaymentCount = 0;

  for (const event of events) {
    if (event.type === 'invocation') {
      invocationCount += 1;
      totalGrossVolumeAtomic += BigInt(event.totalAtomic || '0');
    }

    if (event.type === 'payment') {
      settledPaymentCount += 1;
      totalSettledVolumeAtomic += BigInt(event.totalAtomic || '0');
    }

    if (event.type === 'payment' || event.type === 'invocation') {
      const volume = BigInt(event.totalAtomic || event.amountAtomic || '0');

      if (event.rootSkillId) {
        const s = skillStats.get(event.rootSkillId) || {
          skillId: event.rootSkillId,
          invocations: 0,
          grossVolumeAtomic: 0n,
          earnedAtomic: 0n,
          asDependency: 0,
        };
        if (event.type === 'invocation') {
          s.invocations += 1;
          s.grossVolumeAtomic += volume;
        }
        skillStats.set(event.rootSkillId, s);
      }

      // only invocations count as earnings, payment events would double-count
      for (const entry of event.royaltyBreakdown || []) {
        const sid = entry.skillId;
        const amt = BigInt(entry.amountAtomic || '0');
        const countAsEarning = event.type === 'invocation';
        if (countAsEarning) totalEarnedAtomic += amt;

        const skill = skillStats.get(sid) || {
          skillId: sid,
          invocations: 0,
          grossVolumeAtomic: 0n,
          earnedAtomic: 0n,
          asDependency: 0,
        };
        if (countAsEarning) {
          skill.earnedAtomic += amt;
          skill.asDependency += 1;
        }
        skillStats.set(sid, skill);

        if (entry.creator && countAsEarning) {
          creatorEarnings.set(entry.creator, (creatorEarnings.get(entry.creator) || 0n) + amt);
        }
      }

      for (const edge of event.edges || []) {
        const key = `${edge.from}->${edge.to}`;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
  }

  const foundationalSkills = [...skillStats.values()]
    .sort((a, b) => {
      const depDelta = b.asDependency - a.asDependency;
      if (depDelta !== 0) return depDelta;
      if (b.earnedAtomic === a.earnedAtomic) return 0;
      return b.earnedAtomic > a.earnedAtomic ? 1 : -1;
    })
    .slice(0, topN)
    .map((s) => ({
      skillId: s.skillId,
      dependencyReferences: s.asDependency,
      totalVolumeUsdc: formatUsdc(s.earnedAtomic),
      earnedUsdc: formatUsdc(s.earnedAtomic),
      grossInvocationVolumeUsdc: formatUsdc(s.grossVolumeAtomic),
      invocations: s.invocations,
    }));

  const topEarners = [...creatorEarnings.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, topN)
    .map(([creator, atomic]) => ({
      creator,
      totalEarnedUsdc: formatUsdc(atomic),
      totalEarnedAtomic: atomic.toString(),
    }));

  const valueFlow = [...edges.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN * 2)
    .map(([key, count]) => {
      const [from, to] = key.split('->');
      return { from, to, flowCount: count };
    });

  return {
    totalInvocations: invocationCount,
    settledPaymentCount,
    totalEvents: events.length,
    totalVolumeUsdc: formatUsdc(totalGrossVolumeAtomic),
    totalVolumeAtomic: totalGrossVolumeAtomic.toString(),
    totalGrossVolumeUsdc: formatUsdc(totalGrossVolumeAtomic),
    totalGrossVolumeAtomic: totalGrossVolumeAtomic.toString(),
    totalSettledVolumeUsdc: formatUsdc(totalSettledVolumeAtomic),
    totalSettledVolumeAtomic: totalSettledVolumeAtomic.toString(),
    totalCreatorEarningsUsdc: formatUsdc(totalEarnedAtomic),
    totalCreatorEarningsAtomic: totalEarnedAtomic.toString(),
    foundationalSkills,
    topEarners,
    valueFlow,
    recentEvents: events.slice(-20).reverse(),
    generatedAt: new Date().toISOString(),
  };
}

function formatUsdc(atomic) {
  return (Number(atomic) / 1e6).toFixed(6);
}

export function recordTraceResult(report) {
  recordEvent({
    type: 'invocation',
    invocationId: report.invocationId,
    rootSkillId: report.rootSkillId,
    proofId: report.provenanceProof?.proofId,
    merkleRoot: report.provenanceProof?.merkleRoot,
    payloadHash: report.provenanceProof?.payloadHash,
    signatures: report.provenanceProof?.signatures || [],
    paymentSettlement: report.paymentSettlement || null,
    callStackVerification: report.callStackVerification || null,
    onChainProofRecord: report.onChainProofRecord || null,
    timestamp: report.timestamp,
    totalAtomic: report.totalPaid.atomic,
    royaltyBreakdown: report.royaltyBreakdown,
    edges: (report.dependencyTree?.edges || []).map((e) => ({ from: e.from, to: e.to })),
    payer: report.payer,
    dryRun: report.dryRun,
  });

  if (!report.dryRun && report.payments?.length) {
    recordEvent({
      type: 'payment',
      invocationId: report.invocationId,
      proofId: report.provenanceProof?.proofId,
      txHashes: report.payments.map((p) => p.txHash).filter(Boolean),
      merkleRoot: report.provenanceProof?.merkleRoot,
      payloadHash: report.provenanceProof?.payloadHash,
      signatures: report.provenanceProof?.signatures || [],
      paymentSettlement: report.paymentSettlement || null,
      onChainProofRecord: report.onChainProofRecord || null,
      totalAtomic: report.totalPaid.atomic,
      royaltyBreakdown: report.royaltyBreakdown,
      timestamp: report.timestamp,
    });
  }
}
