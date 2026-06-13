/**
 * On-chain skill registry client (Layer 2 + Layer 3).
 * Reads/writes SkillRevenueFabric on Pharos mainnet.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  isAddress,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { activeChain, FABRIC_REGISTRY_ADDRESS, BLOCK_EXPLORER } from './chains.js';
import { SKILL_REVENUE_FABRIC_ABI } from './abi.js';

dotenv.config();

const CACHE_PATH =
  process.env.REGISTRY_CACHE_PATH || './data/registry-cache.json';

/** Convert human skill ID to bytes32 (keccak256 of normalized string). */
export function skillIdToBytes32(skillId) {
  const normalized = skillId.trim().toLowerCase().replace(/\s+/g, '-');
  return keccak256(toBytes(normalized));
}

/** Demo registry for dry-run / pre-deployment usage. */
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
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  } catch {
    /* ignore corrupt cache */
  }
  return { ...DEMO_REGISTRY };
}

function saveCache(cache) {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

export function getPublicClient() {
  return createPublicClient({
    chain: activeChain,
    transport: http(),
  });
}

export function getWalletClient() {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error('PRIVATE_KEY not set');
  const formatted = key.startsWith('0x') ? key : `0x${key}`;
  const account = privateKeyToAccount(formatted);
  return createWalletClient({
    account,
    chain: activeChain,
    transport: http(),
  });
}

export function isRegistryDeployed() {
  return Boolean(
    FABRIC_REGISTRY_ADDRESS &&
    isAddress(FABRIC_REGISTRY_ADDRESS) &&
    FABRIC_REGISTRY_ADDRESS !== zeroAddress
  );
}

/**
 * Fetch skill metadata — on-chain first, then local cache, then demo registry.
 */
export async function getSkill(skillId) {
  const cache = loadCache();

  if (isRegistryDeployed()) {
    try {
      const client = getPublicClient();
      const id = skillIdToBytes32(skillId);
      const [creator, weight, royaltyBps, successor, active] =
        await client.readContract({
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
          /* use direct creator */
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
      // Fall through to cache on RPC/contract errors
      if (!cache[skillId] && !DEMO_REGISTRY[skillId]) {
        throw err;
      }
    }
  }

  const local = cache[skillId] || DEMO_REGISTRY[skillId];
  if (!local) {
    return null;
  }

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

/**
 * Register skill on-chain (Layer 2 perpetual + Layer 3 weights).
 */
export async function registerSkill({
  skillId,
  contributionWeight,
  dependencies = [],
  royaltyBps = 500,
  creator,
}) {
  if (contributionWeight < 1 || contributionWeight > 10000) {
    throw new Error('contributionWeight must be 1–10000 basis points');
  }
  if (royaltyBps < 0 || royaltyBps > 2000) {
    throw new Error('royaltyBps must be 0–2000 (max 20%)');
  }

  const cache = loadCache();
  const wallet = getWalletClient();
  const account = wallet.account;

  const entry = {
    creator: creator || account.address,
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
      message: 'FABRIC_REGISTRY_ADDRESS not set — saved to local cache only',
      ...entry,
    };
  }

  const depHashes = dependencies.map((d) => skillIdToBytes32(d));
  const hash = await wallet.writeContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'registerSkill',
    args: [
      skillIdToBytes32(skillId),
      BigInt(contributionWeight),
      depHashes,
      BigInt(royaltyBps),
    ],
  });

  const client = getPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash });

  return {
    skillId,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    mode: 'on-chain',
    explorerUrl: BLOCK_EXPLORER ? `${BLOCK_EXPLORER}/tx/${hash}` : null,
    ...entry,
  };
}

/**
 * Set successor for revenue inheritance.
 */
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

/**
 * Record a settled royalty batch proof on-chain for later verification.
 */
export async function recordPaymentProof({
  invocationId,
  rootSkillId,
  royaltyBreakdown,
  merkleRoot,
}) {
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

  if (!recipients.length) {
    throw new Error('No valid royalty recipients to record');
  }

  const wallet = getWalletClient();
  const hash = await wallet.writeContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'recordRoyaltyPayment',
    args: [
      skillIdToBytes32(invocationId),
      skillIdToBytes32(rootSkillId),
      recipients,
      amounts,
      merkleRoot,
    ],
  });

  const client = getPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash });

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

/** Verify a recorded payment proof against the deployed registry. */
export async function verifyRecordedPaymentProof({ invocationId, merkleRoot }) {
  if (!isRegistryDeployed()) {
    return {
      checked: false,
      valid: null,
      mode: 'not-deployed',
      message: 'FABRIC_REGISTRY_ADDRESS not set',
    };
  }

  const client = getPublicClient();
  const valid = await client.readContract({
    address: FABRIC_REGISTRY_ADDRESS,
    abi: SKILL_REVENUE_FABRIC_ABI,
    functionName: 'verifyPaymentProof',
    args: [skillIdToBytes32(invocationId), merkleRoot],
  });

  return {
    checked: true,
    valid,
    mode: 'on-chain',
  };
}

/**
 * Expand full dependency tree from on-chain registry (Layer 1 + Layer 2).
 */
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

    if (parentId) {
      edges.push({ from: parentId, to: skillId, depth });
    }

    for (const dep of skill.dependencies) {
      await walk(dep, depth + 1, skillId);
    }
  }

  await walk(rootSkillId, 0);
  return { nodes, edges, rootSkillId };
}

export { DEMO_REGISTRY };
