#!/usr/bin/env node
// Seed an empty Skill Economy Graph with dry-run traces so a fresh/ephemeral
// deploy shows data on first load. Idempotent; disable with SEED_ON_START=false.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'skills-seed.json');
const CACHE_PATH = process.env.REGISTRY_CACHE_PATH || path.join(ROOT, 'data', 'registry-cache.json');

// Resolve from the local cache only (no RPC), this runs as a separate prestart
// process, so clearing these here keeps boot fast without affecting the server.
delete process.env.FABRIC_REGISTRY_ADDRESS;
process.env.DRY_RUN = 'true';

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

/** Seed the registry cache from skills-seed.json (so real skills resolve). */
async function seedRegistry() {
  const { DEMO_REGISTRY } = await import('../src/chain/registry.js');
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  } catch {
    return;
  }
  const cache = { ...DEMO_REGISTRY };
  for (const s of seed.skills || []) {
    cache[s.skillId] = {
      creator: s.creator || null,
      contributionWeight: s.contributionWeight ?? 5000,
      royaltyBps: s.royaltyBps ?? 500,
      dependencies: s.dependencies || [],
      successor: s.successor || null,
      active: s.active !== false,
      source: s.source || 'imported',
      claimed: s.claimed === true,
      repo: s.repo || null,
    };
  }
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function main() {
  if (process.env.SEED_ON_START === 'false') return;

  await seedRegistry();

  const { getGraphSnapshot } = await import('../src/core/graph.js');
  const existing = getGraphSnapshot({ topN: 1 });
  if (existing.totalInvocations > 0) {
    console.log(`[bootstrap] graph already has ${existing.totalInvocations} invocations, skipping seed`);
    return;
  }

  const { traceAndRoute } = await import('../src/core/fabric.js');

  let seeded = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < CHAINS.length; i++) {
      const chain = CHAINS[i];
      const amount = (0.03 + ((i * 7 + pass * 13) % 47) / 100).toFixed(4);
      try {
        await traceAndRoute({
          rootSkillId: chain[0],
          amountUsdc: amount,
          callStack: {
            version: '1',
            frames: chain.map((id, d) => ({
              skillId: id,
              creator: creatorFor(id),
              contributionWeight: 10000 - d * 800,
              depth: d,
              parentSkillId: d ? chain[d - 1] : null,
            })),
          },
          dryRun: true,
        });
        seeded++;
      } catch (err) {
        console.error(`[bootstrap] trace failed for ${chain[0]}: ${err.message}`);
      }
    }
  }

  const snap = getGraphSnapshot({ topN: 5 });
  console.log(`[bootstrap] seeded ${seeded} dry-run traces · ${snap.foundationalSkills.length} skills · ${snap.valueFlow.length} edges · ${snap.totalInvocations} invocations`);
}

main()
  .catch((err) => console.error('[bootstrap] non-fatal:', err.message))
  .finally(() => process.exit(0));
