/**
 * Viem chain clients derived from networks.json.
 */

import dotenv from 'dotenv';
import {
  toViemChain,
  getChainMeta,
  getNetwork,
  getActiveNetworkKey,
  listNetworks,
} from '../config/networks.js';

dotenv.config();

export { listNetworks, getActiveNetworkKey };

/** Active network key (pharos-mainnet | pharos-atlantic) */
export const ACTIVE_NETWORK = getActiveNetworkKey();

/** Primary Pharos mainnet chain (Chain ID 1672) */
export const pharosMainnet = toViemChain('pharos-mainnet');

/** Atlantic testnet chain (Chain ID 688689) */
export const pharosAtlantic = toViemChain('pharos-atlantic');

/** Active chain based on PHAROS_NETWORK env */
export const activeChain = toViemChain(ACTIVE_NETWORK);

const activeNetwork = getNetwork(ACTIVE_NETWORK);

export const PHAROS_CHAIN_ID = activeNetwork.chainId;
export const PHAROS_RPC = process.env.PHAROS_RPC || activeNetwork.rpcUrl;
export const BLOCK_EXPLORER = activeNetwork.explorer || null;

export const USDC_ADDRESS = (
  process.env.USDC_ADDRESS || activeNetwork.usdc
);

export const FABRIC_REGISTRY_ADDRESS = process.env.FABRIC_REGISTRY_ADDRESS;

export const CHAIN_META = getChainMeta(ACTIVE_NETWORK);

export const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];
