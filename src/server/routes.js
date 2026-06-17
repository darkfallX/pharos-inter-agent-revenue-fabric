import path from 'path';
import { fileURLToPath } from 'url';
import { traceAndRoute, verifyPayment, registerSkill, claimSkill, getGraphSnapshot } from '../core/fabric.js';
import { getPublicClient, isRegistryDeployed } from '../chain/registry.js';
import { CHAIN_META, PHAROS_CHAIN_ID } from '../chain/chains.js';
import { parseIntent, buildCallStackFromSkills } from '../cli/nl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.1.0';

export function registerRoutes(app) {
  app.get('/health', healthHandler);
  app.post('/trace', traceHandler);
  app.get('/graph', graphHandler);
  app.post('/verify-payment', verifyHandler);
  app.post('/register', registerHandler);
  app.post('/claim', claimHandler);
  app.post('/ask', askHandler);
  app.get('/openapi.yaml', openApiHandler);
  app.get('/dashboard', dashboardHandler);
}

async function healthHandler(_req, res) {
  let blockNumber = null;
  let rpcOk = false;
  let rpcError = null;

  try {
    const client = getPublicClient();
    blockNumber = Number(await client.getBlockNumber());
    rpcOk = true;
  } catch (err) {
    rpcError = err?.message || 'RPC unreachable';
  }

  res.status(200).json({
    status: rpcOk ? 'ok' : 'degraded',
    skill: 'pharos-inter-agent-revenue-fabric',
    version: VERSION,
    chainId: PHAROS_CHAIN_ID,
    chain: CHAIN_META.name,
    rpc: CHAIN_META.rpc,
    blockNumber,
    rpcOk,
    rpcError,
    registryDeployed: isRegistryDeployed(),
    registryAddress: CHAIN_META.registry,
    dryRun: process.env.DRY_RUN !== 'false',
    demoRegistry: !isRegistryDeployed(),
    timestamp: new Date().toISOString(),
  });
}

async function traceHandler(req, res) {
  try {
    const {
      rootSkillId,
      amountUsdc,
      callStack,
      header,
      payer,
      dryRun,
      signProof = false,
      requireFrameSignatures = false,
    } = req.body;

    if (!rootSkillId) return res.status(400).json({ error: 'rootSkillId is required' });
    if (amountUsdc === undefined || amountUsdc === null || amountUsdc === '') {
      return res.status(400).json({ error: 'amountUsdc is required' });
    }

    const report = await traceAndRoute({
      rootSkillId,
      amountUsdc,
      callStack: callStack || header,
      payer,
      dryRun: dryRun !== undefined ? Boolean(dryRun) : process.env.DRY_RUN !== 'false',
      signProof,
      requireFrameSignatures,
    });

    res.json(report);
  } catch (err) {
    console.error('[POST /trace]', err);
    res.status(500).json({ error: err.message || 'Trace failed' });
  }
}

function graphHandler(req, res) {
  try {
    const topN = parseInt(req.query.top || '10', 10);
    const sinceHours = req.query.sinceHours ? parseFloat(req.query.sinceHours) : null;
    const snapshot = getGraphSnapshot({
      topN,
      sinceMs: sinceHours ? sinceHours * 3600 * 1000 : null,
    });
    res.json({
      schemaVersion: '1.1.0',
      skill: 'pharos-inter-agent-revenue-fabric',
      layer: 4,
      description: 'Public Skill Economy Graph, real-time value flow',
      ...snapshot,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Graph query failed' });
  }
}

async function verifyHandler(req, res) {
  try {
    const { proofId, txHash, royaltyBreakdown, proof } = req.body;
    if (!proof && !proofId && !txHash) {
      return res.status(400).json({ error: 'proof, proofId, or txHash required' });
    }
    res.json(await verifyPayment({ proofId, txHash, royaltyBreakdown, proof }));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Verification failed' });
  }
}

async function registerHandler(req, res) {
  try {
    const { skillId, contributionWeight, dependencies = [], royaltyBps = 500, creator } = req.body;
    if (!skillId || contributionWeight === undefined) {
      return res.status(400).json({ error: 'skillId and contributionWeight are required' });
    }
    res.json(await registerSkill({ skillId, contributionWeight, dependencies, royaltyBps, creator }));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
}

async function claimHandler(req, res) {
  try {
    const { skillId, wallet, signature, message } = req.body;
    if (!skillId || !wallet || !signature) {
      return res.status(400).json({ error: 'skillId, wallet, and signature are required' });
    }
    res.json(await claimSkill({ skillId, wallet, signature, message }));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Claim failed' });
  }
}

async function askHandler(req, res) {
  try {
    const { text, dryRun } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const known = getGraphSnapshot({ topN: 50 }).foundationalSkills.map((s) => s.skillId);
    const intent = parseIntent(text, known);

    let result = null;
    if (intent.action === 'trace') {
      result = await traceAndRoute({
        rootSkillId: intent.rootSkillId,
        amountUsdc: intent.amountUsdc,
        callStack: buildCallStackFromSkills(intent.skills),
        dryRun: dryRun !== undefined ? Boolean(dryRun) : process.env.DRY_RUN !== 'false',
      });
    } else if (intent.action === 'graph') {
      result = getGraphSnapshot({ topN: 10 });
    } else if (intent.action === 'verify' && (intent.proofId || intent.txHash)) {
      result = await verifyPayment({ proofId: intent.proofId, txHash: intent.txHash });
    }

    res.json({ interpreted: intent, result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Ask failed' });
  }
}

function openApiHandler(_req, res) {
  res.type('application/yaml');
  res.sendFile(path.join(__dirname, '../../openapi.yaml'), (err) => {
    if (err) res.status(404).json({ error: 'openapi.yaml not found' });
  });
}

function dashboardHandler(_req, res) {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'), (err) => {
    if (err) res.status(404).json({ error: 'Dashboard not found' });
  });
}
