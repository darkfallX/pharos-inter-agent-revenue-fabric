#!/usr/bin/env node
/**
 * Deploy SkillRevenueFabric to Pharos Mainnet (Chain ID 1672).
 *
 * Usage:
 *   node deploy/deploy.js
 *   npm run deploy
 *
 * Requires:
 *   PRIVATE_KEY in .env
 *
 * On success, updates FABRIC_REGISTRY_ADDRESS in .env automatically.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pharosMainnet, PHAROS_CHAIN_ID, PHAROS_RPC } from '../src/chain/chains.js';
import { compileSkillRevenueFabric } from './compile.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

function requirePrivateKey() {
  const key = process.env.PRIVATE_KEY;
  if (!key || key.includes('YOUR_PRIVATE_KEY')) {
    console.error('Error: Set a valid PRIVATE_KEY in .env before deploying.');
    process.exit(1);
  }
  return key.startsWith('0x') ? key : `0x${key}`;
}

/** Patch or append FABRIC_REGISTRY_ADDRESS in .env */
function updateEnvAddress(address) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } else if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  }

  const line = `FABRIC_REGISTRY_ADDRESS=${address}`;
  if (/^FABRIC_REGISTRY_ADDRESS=.*/m.test(content)) {
    content = content.replace(/^FABRIC_REGISTRY_ADDRESS=.*/m, line);
  } else {
    content += `\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, content.trim() + '\n');
  console.log(`\n✅ Updated ${ENV_PATH}`);
  console.log(`   FABRIC_REGISTRY_ADDRESS=${address}`);
}

async function main() {
  console.log('SkillRevenueFabric — Pharos Mainnet Deploy');
  console.log('───────────────────────────────────────────');
  console.log(`Chain ID: ${PHAROS_CHAIN_ID}`);
  console.log(`RPC:      ${PHAROS_RPC}`);

  const privateKey = requirePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: pharosMainnet,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: pharosMainnet,
    transport: http(),
  });

  // Preflight checks
  const block = await publicClient.getBlockNumber();
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`\nWallet:  ${account.address}`);
  console.log(`Block:   ${block}`);
  console.log(`Balance: ${balance} wei (PHRS)`);

  if (balance === 0n) {
    console.warn('\n⚠ Warning: wallet has zero PHRS — deployment may fail without gas.');
  }

  console.log('\nCompiling SkillRevenueFabric.sol...');
  const { abi, bytecode } = compileSkillRevenueFabric();
  console.log(`Bytecode: ${bytecode.length} chars`);

  console.log('\nDeploying to Pharos Mainnet...');
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [],
  });

  console.log(`Tx hash: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success' || !receipt.contractAddress) {
    console.error('Deployment failed:', receipt);
    process.exit(1);
  }

  const address = receipt.contractAddress;

  console.log('\n🎉 Deployment successful!');
  console.log(`   Contract: ${address}`);
  console.log(`   Block:    ${receipt.blockNumber}`);
  console.log(`   Explorer: https://pharosscan.xyz/address/${address}`);

  updateEnvAddress(address);

  // Write artifact for reference
  const artifactDir = path.join(ROOT, 'deploy', 'artifacts');
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'SkillRevenueFabric.json'),
    JSON.stringify({ address, abi, blockNumber: Number(receipt.blockNumber), txHash: hash }, null, 2)
  );
  console.log(`   Artifact: deploy/artifacts/SkillRevenueFabric.json`);
}

main().catch((err) => {
  console.error('\nDeploy failed:', err.message || err);
  process.exit(1);
});