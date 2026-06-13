/**
 * Network configuration loader.
 * Reads networks.json — the single source of truth for Pharos chain definitions.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineChain } from 'viem';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NETWORKS_PATH = path.join(__dirname, '../../networks.json');

let _cache = null;

/** Load and parse networks.json */
export function loadNetworksConfig() {
  if (_cache) return _cache;
  const raw = fs.readFileSync(NETWORKS_PATH, 'utf8');
  _cache = JSON.parse(raw);
  return _cache;
}

/** Resolve active network key from env or default */
export function getActiveNetworkKey() {
  return process.env.PHAROS_NETWORK || loadNetworksConfig().defaultNetwork;
}

/** Get network definition by key (e.g. pharos-mainnet, pharos-atlantic) */
export function getNetwork(key = getActiveNetworkKey()) {
  const config = loadNetworksConfig();
  const net = config.networks[key];
  if (!net) {
    throw new Error(`Unknown network "${key}". Available: ${Object.keys(config.networks).join(', ')}`);
  }
  return { key, ...net };
}

/** Build a viem chain definition from networks.json */
export function toViemChain(key = getActiveNetworkKey()) {
  const net = getNetwork(key);
  const rpc = process.env.PHAROS_RPC || net.rpcUrl;

  return defineChain({
    id: net.chainId,
    name: net.name,
    network: key,
    nativeCurrency: net.nativeCurrency,
    rpcUrls: {
      default: { http: [rpc] },
      public: { http: [rpc] },
    },
    blockExplorers: net.explorer
      ? { default: { name: net.name, url: net.explorer } }
      : undefined,
  });
}

/** Chain metadata for API / CLI display */
export function getChainMeta(key = getActiveNetworkKey()) {
  const net = getNetwork(key);
  return {
    key,
    chainId: net.chainId,
    name: net.name,
    rpc: process.env.PHAROS_RPC || net.rpcUrl,
    explorer: net.explorer || null,
    usdc: process.env.USDC_ADDRESS || net.usdc || null,
    registry: process.env.FABRIC_REGISTRY_ADDRESS || null,
  };
}

export function listNetworks() {
  const config = loadNetworksConfig();
  return Object.entries(config.networks).map(([key, net]) => ({
    key,
    name: net.name,
    chainId: net.chainId,
    isDefault: key === config.defaultNetwork,
  }));
}