#!/usr/bin/env node
// MCP server (stdio, JSON-RPC 2.0) exposing the fabric as tools for Claude Code /
// OpenClaw / Codex. Configure with: { "command": "node", "args": ["mcp/server.js"] }

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import {
  traceAndRoute,
  verifyPayment,
  registerSkill,
  claimSkill,
  getGraphSnapshot,
} from '../src/core/fabric.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VERSION = '1.1.0';

const TOOLS = [
  {
    name: 'trace_revenue_mesh',
    description:
      'Trace a skill invocation chain, split the payment across every creator in the dependency graph (contribution + depth weighted), route x402 USDC, and return a full report with a Merkle provenance proof. Dry-run by default (no wallet needed).',
    inputSchema: {
      type: 'object',
      required: ['rootSkillId', 'amountUsdc'],
      properties: {
        rootSkillId: { type: 'string', description: 'The root skill being invoked, e.g. "pharos-yield-pilot".' },
        amountUsdc: { type: 'string', description: 'Total USDC paid by the end user, as a decimal string e.g. "0.10".' },
        callStack: { type: 'object', description: 'Optional { version, frames:[{skillId, creator, contributionWeight, depth, parentSkillId}] } describing the A→B→C chain.' },
        dryRun: { type: 'boolean', description: 'Simulate without sending real payments. Default true.' },
      },
    },
  },
  {
    name: 'get_economy_graph',
    description: 'Return the public Skill Economy Graph: foundational skills, top earning creators, value flow edges, gross/settled volume, and recent proof activity.',
    inputSchema: {
      type: 'object',
      properties: { topN: { type: 'integer', description: 'Entries per category (default 10).' } },
    },
  },
  {
    name: 'verify_payment',
    description: 'Verify a Merkle provenance proof. Provide a full proof bundle (+optional royaltyBreakdown), or a proofId / txHash to look up in the graph history.',
    inputSchema: {
      type: 'object',
      properties: {
        proofId: { type: 'string' },
        txHash: { type: 'string' },
        proof: { type: 'object' },
        royaltyBreakdown: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'register_skill',
    description: 'Register a skill with a contribution weight (1, 10000 bps), dependencies, and a perpetual royalty rate (0, 2000 bps). Writes to the on-chain registry if deployed, else the local cache.',
    inputSchema: {
      type: 'object',
      required: ['skillId', 'contributionWeight'],
      properties: {
        skillId: { type: 'string' },
        contributionWeight: { type: 'integer' },
        dependencies: { type: 'array', items: { type: 'string' } },
        royaltyBps: { type: 'integer' },
        creator: { type: 'string' },
      },
    },
  },
  {
    name: 'claim_skill',
    description: 'Bind a payout wallet to a skillId by proving control of that wallet with a signed claim message. Lets a creator collect royalties accrued against their skill.',
    inputSchema: {
      type: 'object',
      required: ['skillId', 'wallet', 'signature'],
      properties: {
        skillId: { type: 'string' },
        wallet: { type: 'string' },
        signature: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
  {
    name: 'list_networks',
    description: 'Return the configured Pharos networks (chain IDs, RPCs, USDC addresses) from networks.json.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'trace_revenue_mesh':
      return traceAndRoute({
        rootSkillId: args.rootSkillId,
        amountUsdc: args.amountUsdc,
        callStack: args.callStack,
        dryRun: args.dryRun !== false,
      });
    case 'get_economy_graph':
      return getGraphSnapshot({ topN: args.topN || 10 });
    case 'verify_payment':
      return verifyPayment({
        proofId: args.proofId,
        txHash: args.txHash,
        proof: args.proof,
        royaltyBreakdown: args.royaltyBreakdown,
      });
    case 'register_skill':
      return registerSkill({
        skillId: args.skillId,
        contributionWeight: args.contributionWeight,
        dependencies: args.dependencies || [],
        royaltyBps: args.royaltyBps ?? 500,
        creator: args.creator,
      });
    case 'claim_skill':
      return claimSkill({
        skillId: args.skillId,
        wallet: args.wallet,
        signature: args.signature,
        message: args.message,
      });
    case 'list_networks':
      return JSON.parse(fs.readFileSync(path.join(ROOT, 'networks.json'), 'utf8'));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'pharos-revenue-fabric', version: VERSION },
        },
      });
    }
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }
    if (method === 'tools/call') {
      const result = await callTool(params.name, params.arguments);
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    }
    if (method === 'ping') {
      return send({ jsonrpc: '2.0', id, result: {} });
    }
    if (isNotification) return;
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (err) {
    if (isNotification) return;
    if (method === 'tools/call') {
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'Error: ' + (err.message || String(err)) }], isError: true },
      });
    }
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message || 'internal error' } });
  }
}

function start() {
  // stdout is the protocol channel, so log to stderr only
  console.error(`pharos-revenue-fabric MCP server v${VERSION} ready (stdio), ${TOOLS.length} tools`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    handle(msg);
  });
  rl.on('close', () => process.exit(0));
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('server.js');
}

if (isMainModule()) start();

export { TOOLS, callTool };
