import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  isAddress,
  zeroAddress,
  recoverMessageAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { activeChain, FABRIC_REGISTRY_ADDRESS, BLOCK_EXPLORER, PHAROS_CHAIN_ID } from './chains.js';
import { SKILL_REVENUE_FABRIC_ABI } from './abi.js';
import { buildClaimMessage } from '../core/provenance.js';

dotenv.config();

// resolved lazily so REGISTRY_CACHE_PATH can be set after import (tests, tooling)
function cachePath() {
  return process.env.REGISTRY_CACHE_PATH || './data/registry-cache.json';
}

export function skillIdToBytes32(skillId) {
  const normalized = skillId.trim().toLowerCase().replace(/\s+/g, '-');
  return keccak256(toBytes(normalized));
}

// Fallback skills for dry-run / pre-deployment usage.
const DEMO_REGISTRY = {
  'pharos-yield-pilot': {
    creator: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    contributionWeight: 10000,
    royaltyBps: 500,
    dependencies: [],
    successor: null,
    active: true,
  },
  'pharos-realfi-security-scout': {
    creator: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    contributionWeight: 7500,
    royaltyBps: 600,
    dependencies: ['pharos-yield-pilot'],
    successor: null,
    active: true,
  },
  'pharos-cross-chain-rwa-distribution-oracle': {
    creator: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    contributionWeight: 8200,
    royaltyBps: 450,
    dependencies: ['pharos-realfi-security-scout', 'pharos-yield-pilot'],
    successor: null,
    active: true,
  },
  'pharos-intent-yield-rebalancer': {
    creator: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    contributionWeight: 6800,
    royaltyBps: 400,
    dependencies: ['pharos-yield-pilot'],
    successor: null,
    active: true,
  },
};

function loadCache() {
  const p = cachePath();
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore corrupt cache
  }
  return { ...DEMO_REGISTRY };
}

function saveCache(cache) {
  const p = cachePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cache, null, 2));
}

export function getPublicClient() {
  return createPublicClient({ chain: activeChain, transport: http() });
}

export function getWalletClient() {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error('PRIVATE_KEY not set');
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  return createWalletClient({ account, chain: activeChain, transport: http() });
}

export function isRegistryDeployed() {
  return Boolean(
    FABRIC_REGISTRY_ADDRESS && isAddress(FABRIC_REGISTRY_ADDRESS) && FABRIC_REGISTRY_ADDRESS !== zeroAddress
  );
}

// on-chain first when a registry is deployed, otherwise local cache / demo registry
export async function getSkill(skillId) {
  const cache = loadCache();

  if (isRegistryDeployed()) {
    try {
      const client = getPublicClient();
      const id = skillIdToBytes32(skillId);
      const [creator, weight, royaltyBps, successor, active] = await client.readContract({
        address: FABRIC_REGISTRY_ADDRESS,
        abi: SKILL_REVENUE_FABRIC_ABI,
        functionName: 'getSkill',
        args: [id],
      });

      const deps = await client.readContract({
        address: FABRIC_REGISTRY_ADDRESS,
        abi: SKILL_REVENUE_FABRIC_ABI,
        functionName: 'getDependencies',
        args: [id],
      });

      const depIds = await Promise.all(
        deps.map(async (depHash) => {
          for (const [name] of Object.entries({ ...cache, ...DEMO_REGISTRY })) {
            if (skillIdToBytes32(name) === depHash) return name;
          }
          return depHash;
        })
      );

      let resolvedCreator = creator;
      if (successor && successor !== `0x${'0'.repeat(64)}`) {
        try {
          resolvedCreator = await client.readContract({
            address: FABRIC_REGISTRY_ADDRESS,
            abi: SKILL_REVENUE_FABRIC_ABI,
            functionName: 'resolveCreator',
            args: [id],
          });
        } catch {
          // fall back to the direct creator
        }
      }

      return {
        skillId,
        creator: resolvedCreator,
        contributionWeight: Number(weight),
        royaltyBps: Number(royaltyBps),
        dependencies: depIds.filter((d) => typeof d === 'string' && !d.startsWith('0x')),
        successor: successor === `0x${'0'.repeat(64)}` ? null : successor,
        active,
        source: 'on-chain',
      };
    } catch (err) {
      if (!cache[skillId] && !DEMO_REGISTRY[skillId]) throw err;
    }
  }

  const local = cache[skillId] || DEMO_REGISTRY[skillId];
  if (!local) return null;

  return {
    skillId,
    creator: local.creator,
    contributionWeight: local.contributionWeight,
    royaltyBps: local.royaltyBps,
    dependencies: local.dependencies || [],
    successor: local.successor || null,
    active: local.active !== false,
    source: 'cache',
  };
}

export async function registerSkill({ skillId, contributionWeight, dependencies = [], royaltyBps = 500, creator }) {
  if (contributionWeight < 1 || contributionWeight > 10000) {
    throw new Error('contributionWeight must be 1, 10000 basis points');
  }
  if (royaltyBps < 0 || royaltyBps > 2000) {
    throw new Error('royaltyBps must be 0, 2000 (max 20%)');
  }

  const cache = loadCache();
  const wallet = getWalletClient();

  const entry = {
    creator: creator || wallet.account.address,
    contributionWeight,
    royaltyBps,
    dependencies,
    successor: null,
    active: true,
  };

  cache[skillId] = entry;
  saveCache(cache);

  if (!isRegistryDeployed()) {
    return {
      skillId,
      txHash: null,
      mode: 'cache-only',
      message: 'FABRIC_REGISTRY_ADDRESS not set, saved to local cache only',
      ...entry,
    };
  }

  const hash = await wallet.writeContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'registerSkill',
    args: [
      skillIdToBytes32(skillId),
      BigInt(contributionWeight),
      dependencies.map((d) => skillIdToBytes32(d)),
      BigInt(royaltyBps),
    ],
  });

  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });

  return {
    skillId,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    mode: 'on-chain',
    explorerUrl: BLOCK_EXPLORER ? `${BLOCK_EXPLORER}/tx/${hash}` : null,
    ...entry,
  };
}

export async function setSuccessor(skillId, successorSkillId) {
  const cache = loadCache();
  if (cache[skillId]) {
    cache[skillId].successor = successorSkillId;
    saveCache(cache);
  }

  if (!isRegistryDeployed()) {
    return { skillId, successorSkillId, txHash: null, mode: 'cache-only' };
  }

  const wallet = getWalletClient();
  const hash = await wallet.writeContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'setSuccessor',
    args: [skillIdToBytes32(skillId), skillIdToBytes32(successorSkillId)],
  });

  return { skillId, successorSkillId, txHash: hash, mode: 'on-chain' };
}

// Bind a payout wallet by verifying a signed claim message. Unclaimed skills can
// be claimed first-come; a claimed skill can only be re-bound by its own wallet.
export async function claimSkill({ skillId, wallet, signature, message }) {
  if (!skillId) throw new Error('skillId is required');
  if (!isAddress(wallet)) throw new Error('invalid wallet address');
  if (!signature) throw new Error('signature is required');

  const expected = buildClaimMessage(skillId, wallet, PHAROS_CHAIN_ID);
  if (message && message !== expected) {
    throw new Error('claim message does not match expected format');
  }

  let recovered;
  try {
    recovered = await recoverMessageAddress({ message: expected, signature });
  } catch {
    throw new Error('could not recover signer from signature');
  }
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error('signature does not match the provided wallet');
  }

  const cache = loadCache();
  const existing = cache[skillId] || DEMO_REGISTRY[skillId];
  if (!existing) throw new Error(`unknown skillId: ${skillId}`);

  if (existing.claimed && existing.creator && existing.creator.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error('skill is already claimed by another wallet');
  }

  cache[skillId] = { ...existing, creator: wallet, claimed: true, active: existing.active !== false };
  saveCache(cache);

  return {
    skillId,
    wallet,
    claimed: true,
    signer: recovered,
    mode: isRegistryDeployed() ? 'cache-bound' : 'cache-only',
    onChain: isRegistryDeployed()
      ? 'Registry is deployed, send the on-chain claimSkill(bytes32) tx to bind permanently.'
      : 'FABRIC_REGISTRY_ADDRESS not set, bound in local registry cache.',
  };
}

export async function recordPaymentProof({ invocationId, rootSkillId, royaltyBreakdown, merkleRoot }) {
  if (!isRegistryDeployed()) {
    return {
      invocationId,
      rootSkillId,
      merkleRoot,
      txHash: null,
      mode: 'not-recorded',
      message: 'FABRIC_REGISTRY_ADDRESS not set',
    };
  }

  const recipients = [];
  const amounts = [];
  for (const entry of royaltyBreakdown || []) {
    if (!isAddress(entry.creator)) continue;
    const amount = BigInt(entry.amountAtomic || '0');
    if (amount <= 0n) continue;
    recipients.push(entry.creator);
    amounts.push(amount);
  }

  if (!recipients.length) throw new Error('No valid royalty recipients to record');

  const wallet = getWalletClient();
  const hash = await wallet.writeContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'recordRoyaltyPayment',
    args: [skillIdToBytes32(invocationId), skillIdToBytes32(rootSkillId), recipients, amounts, merkleRoot],
  });

  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });

  return {
    invocationId,
    rootSkillId,
    merkleRoot,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    mode: 'on-chain',
    explorerUrl: BLOCK_EXPLORER ? `${BLOCK_EXPLORER}/tx/${hash}` : null,
  };
}

export async function verifyRecordedPaymentProof({ invocationId, merkleRoot }) {
  if (!isRegistryDeployed()) {
    return { checked: false, valid: null, mode: 'not-deployed', message: 'FABRIC_REGISTRY_ADDRESS not set' };
  }

  const valid = await getPublicClient().readContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'verifyPaymentProof',
    args: [skillIdToBytes32(invocationId), merkleRoot],
  });

  return { checked: true, valid, mode: 'on-chain' };
}

export async function expandDependencyTree(rootSkillId, maxDepth = 12) {
  const visited = new Set();
  const nodes = [];
  const edges = [];

  async function walk(skillId, depth, parentId = null) {
    if (depth > maxDepth || visited.has(skillId)) return;
    visited.add(skillId);

    const skill = await getSkill(skillId);
    if (!skill) return;

    nodes.push({
      skillId,
      creator: skill.creator,
      contributionWeight: skill.contributionWeight,
      royaltyBps: skill.royaltyBps,
      depth,
      source: skill.source,
    });

    if (parentId) edges.push({ from: parentId, to: skillId, depth });

    for (const dep of skill.dependencies) {
      await walk(dep, depth + 1, skillId);
    }
  }

  await walk(rootSkillId, 0);
  return { nodes, edges, rootSkillId };
}

export { DEMO_REGISTRY };
