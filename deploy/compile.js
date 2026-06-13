/**
 * Compile SkillRevenueFabric.sol using solc (no Foundry required).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import solc from 'solc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'contracts', 'SkillRevenueFabric.sol');

export function compileSkillRevenueFabric() {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');

  const input = {
    language: 'Solidity',
    sources: {
      'SkillRevenueFabric.sol': { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const compiled = JSON.parse(solc.compile(JSON.stringify(input), { version: 'v0.8.24+commit.e11b9ed9' }));

  const errors = (compiled.errors || []).filter(
    (e) => e.severity === 'error'
  );
  if (errors.length) {
    throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  }

  const contract = compiled.contracts['SkillRevenueFabric.sol']?.SkillRevenueFabric;
  if (!contract?.abi || !contract?.evm?.bytecode?.object) {
    throw new Error('Compilation failed — no bytecode produced');
  }

  const bytecode = `0x${contract.evm.bytecode.object}`;

  return {
    abi: contract.abi,
    bytecode,
  };
}