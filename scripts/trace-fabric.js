#!/usr/bin/env node
// CLI: trace | register | graph | balance | verify | sign-stack | inherit | networks

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  traceAndRoute,
  verifyPayment,
  registerSkill,
  setSuccessor,
  getGraphSnapshot,
} from '../src/core/fabric.js';
import { parseIntent, buildCallStackFromSkills } from '../src/cli/nl.js';
import { getWalletBalances } from '../src/chain/balances.js';
import { CHAIN_META } from '../src/chain/chains.js';
import { isRegistryDeployed } from '../src/chain/registry.js';
import { listNetworks } from '../src/config/networks.js';
import { formatCliSummary } from '../src/cli/formatter.js';
import { signCallStackFrame } from '../src/core/provenance.js';
import {
  printWelcome,
  printTip,
  printError,
  printSuccess,
  printDivider,
  printTable,
  printKeyValue,
  printHelp,
} from '../src/cli/ui.js';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const [, , command, ...args] = process.argv;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1)) {
      const key = arg.replace(/^-+/, '').replace(/,.*/, '');
      const alias = {
        r: 'root-skill',
        a: 'amount',
        c: 'call-stack',
        o: 'output',
        j: 'json',
        p: 'proof-file',
      };
      const name = alias[key] || key;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        opts[name] = next;
        i++;
      } else {
        opts[name] = true;
      }
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

function loadCallStack(pathOrJson) {
  if (!pathOrJson) return null;
  if (pathOrJson.startsWith('{')) return JSON.parse(pathOrJson);
  return JSON.parse(fs.readFileSync(path.resolve(pathOrJson), 'utf8'));
}

function resolveWalletAddress(opts) {
  if (opts.address) return opts.address;
  const key = process.env.PRIVATE_KEY;
  if (!key || key.includes('YOUR_PRIVATE_KEY')) return null;
  const formatted = key.startsWith('0x') ? key : `0x${key}`;
  return privateKeyToAccount(formatted).address;
}

async function cmdTrace(opts) {
  printWelcome('trace');
  const rootSkill = opts['root-skill'] || opts._[0];
  const amount = opts.amount || opts._[1];
  const callStack = opts.header ? opts.header : loadCallStack(opts['call-stack']);
  const dryRun = opts['dry-run'] || process.env.DRY_RUN === 'true';

  if (!rootSkill) {
    printError('Missing --root-skill', 'Example: --root-skill pharos-yield-pilot');
    process.exit(1);
  }
  if (!amount) {
    printError('Missing --amount', 'Example: --amount 0.10');
    process.exit(1);
  }

  if (dryRun) {
    printTip('Dry-run mode, no USDC sent. Remove --dry-run + set PRIVATE_KEY for live x402 routing.');
  }

  const report = await traceAndRoute({
    rootSkillId: rootSkill,
    amountUsdc: amount,
    callStack,
    payer: opts.payer,
    dryRun,
    signProof: opts['sign-proof'] === true || opts['sign-proof'] === 'true',
    requireFrameSignatures:
      opts['require-frame-signatures'] === true ||
      opts['require-frame-signatures'] === 'true',
  });

  if (opts.output) {
    fs.writeFileSync(opts.output, JSON.stringify(report, null, 2));
    printSuccess(`Report saved → ${opts.output}`);
  }

  if (opts['proof-file']) {
    const proofDoc = {
      proof: report.provenanceProof,
      royaltyBreakdown: report.royaltyBreakdown,
      invocationId: report.invocationId,
      rootSkillId: report.rootSkillId,
    };
    fs.writeFileSync(opts['proof-file'], JSON.stringify(proofDoc, null, 2));
    printSuccess(`Proof saved -> ${opts['proof-file']}`);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, opts.pretty ? 2 : 0));
  } else {
    console.log(formatCliSummary(report));
  }
}

async function cmdRegister(opts) {
  printWelcome('register');
  const skillId = opts['skill-id'] || opts._[0];
  const weight = parseInt(opts.weight || opts._[1], 10);
  const deps = (opts.deps || '').split(',').map((d) => d.trim()).filter(Boolean);
  const royaltyBps = parseInt(opts['royalty-bps'] || '500', 10);

  if (!skillId || !weight) {
    printError('Missing --skill-id or --weight', 'Example: register --skill-id my-skill --weight 8000');
    process.exit(1);
  }

  const result = await registerSkill({
    skillId,
    contributionWeight: weight,
    dependencies: deps,
    royaltyBps,
    creator: opts.creator,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDivider('Registration Result');
  printKeyValue([
    ['Skill ID', skillId],
    ['Creator', result.creator],
    ['Weight', `${result.contributionWeight} bps`],
    ['Royalty', `${result.royaltyBps} bps (perpetual)`],
    ['Dependencies', deps.join(', ') || '(none)'],
    ['Mode', result.mode],
  ]);
  if (result.txHash) printSuccess(`On-chain tx → ${result.explorerUrl}`);
  else printTip(result.message || 'Saved to local DEMO_REGISTRY cache.');
  console.log('');
}

async function cmdGraph(opts) {
  printWelcome('graph');
  const topN = parseInt(opts.top || '10', 10);
  const snapshot = getGraphSnapshot({ topN });

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(formatCliSummary({ graphSnapshot: snapshot, mode: 'graph' }));
    printTip('Open the live dashboard: npm start → http://localhost:4020/dashboard');
  }
}

async function cmdBalance(opts) {
  printWelcome('balance');
  const address = resolveWalletAddress(opts);
  if (!address) {
    printError(
      'No wallet address',
      'Pass --address 0x... or set PRIVATE_KEY in .env'
    );
    process.exit(1);
  }

  try {
    const balances = await getWalletBalances(address);
    printDivider('Wallet Balances');
    printKeyValue([
      ['Network', `${balances.network} (${balances.chainId})`],
      ['Address', balances.address],
      ['PHRS', `${balances.native.amount} ${balances.native.symbol}`],
      ['USDC', `${balances.usdc.amount} ${balances.usdc.symbol}`],
    ]);
    console.log('');
    if (parseFloat(balances.usdc.amount) === 0) {
      printTip('Zero USDC, use dry-run mode (npm run demo) or fund wallet for live x402 routing.');
    }
  } catch (err) {
    printError(err.message, 'Check PHAROS_RPC in .env or networks.json');
    process.exit(1);
  }
}

async function cmdVerify(opts) {
  printWelcome('verify');
  const proofId = opts['proof-id'] || opts._[0];
  const txHash = opts['tx-hash'] || opts._[1];
  let proof = null;
  let royaltyBreakdown = null;

  if (opts['proof-file']) {
    const proofDoc = JSON.parse(
      fs.readFileSync(path.resolve(opts['proof-file']), 'utf8')
    );
    proof = proofDoc.proof || proofDoc.provenanceProof || proofDoc;
    royaltyBreakdown = proofDoc.royaltyBreakdown || null;
  }

  const result = await verifyPayment({ proofId, txHash, proof, royaltyBreakdown });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDivider('Payment Verification');
  printKeyValue([
    ['Valid', result.valid ? 'YES ✓' : 'NO ✗'],
    ['Proof ID', result.proofId || proofId || ', '],
    ['Issues', result.issues?.join(', ') || 'none'],
  ]);
  console.log('');
}

async function cmdSignStack(opts) {
  printWelcome('sign-stack');
  const input = opts['call-stack'] || opts._[0];
  if (!input) {
    printError('Missing --call-stack', 'Example: sign-stack --call-stack ./examples/call-stack.json --output ./examples/call-stack.signed.json');
    process.exit(1);
  }

  const key = process.env.PRIVATE_KEY;
  if (!key || key.includes('YOUR_PRIVATE_KEY')) {
    printError('PRIVATE_KEY is required to sign a call stack');
    process.exit(1);
  }

  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  const stack = loadCallStack(input);
  const invocationId = stack.invocationId || `inv_${Date.now()}`;
  const preserveCreators =
    opts['preserve-creators'] === true || opts['preserve-creators'] === 'true';

  const frames = [];
  for (const [idx, frame] of (stack.frames || []).entries()) {
    const next = {
      ...frame,
      depth: frame.depth ?? idx,
      creator: preserveCreators && frame.creator ? frame.creator : account.address,
    };
    next.signature = await signCallStackFrame(account, next, invocationId);
    frames.push(next);
  }

  const signed = {
    ...stack,
    invocationId,
    timestamp: stack.timestamp || Date.now(),
    frames,
  };

  if (opts.output) {
    fs.writeFileSync(opts.output, JSON.stringify(signed, null, 2));
    printSuccess(`Signed call stack saved -> ${opts.output}`);
  } else {
    console.log(JSON.stringify(signed, null, 2));
  }
}

async function cmdInherit(opts) {
  printWelcome('inherit');
  const skillId = opts['skill-id'] || opts._[0];
  const successor = opts.successor || opts._[1];
  if (!skillId || !successor) {
    printError('Missing --skill-id or --successor');
    process.exit(1);
  }
  const result = await setSuccessor(skillId, successor);
  console.log(JSON.stringify(result, null, 2));
}

function cmdNetworks() {
  printWelcome('networks');
  const nets = listNetworks();
  printTable(
    ['Key', 'Name', 'Chain ID', 'Default'],
    nets.map((n) => [n.key, n.name, n.chainId, n.isDefault ? 'yes' : ''])
  );
  console.log('');
  printKeyValue([
    ['Active', process.env.PHAROS_NETWORK || 'pharos-mainnet'],
    ['Registry', isRegistryDeployed() ? CHAIN_META.registry : 'DEMO_REGISTRY (demo mode)'],
  ]);
  console.log('');
  printTip('Switch network: PHAROS_NETWORK=pharos-atlantic node scripts/trace-fabric.js ...');
}

async function cmdAsk(opts) {
  printWelcome('ask');
  const text = (opts._.join(' ') || opts.text || '').trim();
  if (!text) {
    printError('Ask what?', 'Example: ask "trace a 0.10 USDC payment through pharos-yield-pilot and pharos-realfi-security-scout"');
    process.exit(1);
  }

  const known = getGraphSnapshot({ topN: 50 }).foundationalSkills.map((s) => s.skillId);
  const intent = parseIntent(text, known);
  printTip(`Understood → ${intent.explanation}`);

  if (intent.action === 'trace') {
    const report = await traceAndRoute({
      rootSkillId: intent.rootSkillId,
      amountUsdc: intent.amountUsdc,
      callStack: buildCallStackFromSkills(intent.skills),
      dryRun: opts['dry-run'] || process.env.DRY_RUN === 'true',
    });
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatCliSummary(report));
  } else if (intent.action === 'graph') {
    console.log(formatCliSummary({ graphSnapshot: getGraphSnapshot({ topN: 10 }), mode: 'graph' }));
  } else if (intent.action === 'verify' && (intent.proofId || intent.txHash)) {
    console.log(JSON.stringify(await verifyPayment({ proofId: intent.proofId, txHash: intent.txHash }), null, 2));
  } else {
    printTip('Run without arguments for the full command list.');
  }
}

async function main() {
  const opts = parseArgs(args);

  try {
    switch (command) {
      case 'trace': await cmdTrace(opts); break;
      case 'ask': await cmdAsk(opts); break;
      case 'register': await cmdRegister(opts); break;
      case 'graph': await cmdGraph(opts); break;
      case 'balance': await cmdBalance(opts); break;
      case 'verify': await cmdVerify(opts); break;
      case 'sign-stack': await cmdSignStack(opts); break;
      case 'inherit': await cmdInherit(opts); break;
      case 'networks': cmdNetworks(); break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      default:
        printError(`Unknown command: ${command}`, 'Run without arguments for help.');
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    printError(err.message, 'Run with --json for raw error details or check .env');
    if (opts.json) console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
