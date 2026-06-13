/**
 * Professional terminal UI for the Pharos Skill Engine CLI.
 */

const WIDTH = 64;

export const BRAND = {
  name: 'Pharos Inter-Agent Revenue Fabric',
  tagline: 'Agents paying agents · x402 USDC · Skill Economy Graph',
  version: '1.1.0',
};

export function printBanner() {
  console.log('');
  console.log('╔' + '═'.repeat(WIDTH) + '╗');
  console.log('║' + center(BRAND.name, WIDTH) + '║');
  console.log('║' + center(BRAND.tagline, WIDTH) + '║');
  console.log('║' + center(`v${BRAND.version} · Pharos Skill Engine`, WIDTH) + '║');
  console.log('╚' + '═'.repeat(WIDTH) + '╝');
  console.log('');
}

export function printWelcome(command) {
  printBanner();
  if (command) {
    console.log(`  → Running: ${command}`);
    console.log('');
  }
}

export function printTip(message) {
  console.log(`  💡 Tip: ${message}`);
  console.log('');
}

export function printSuccess(message) {
  console.log(`  ✓ ${message}`);
}

export function printError(message, hint) {
  console.log('');
  console.log('  ✗ Error: ' + message);
  if (hint) console.log(`    Hint: ${hint}`);
  console.log('');
}

export function printDivider(label) {
  const line = label ? `── ${label} ` : '──';
  console.log('  ' + line + '─'.repeat(Math.max(0, WIDTH - line.length - 2)));
}

export function printTable(headers, rows) {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );

  const headerLine = headers
    .map((h, i) => pad(h, colWidths[i]))
    .join('  ');
  const sep = colWidths.map((w) => '─'.repeat(w)).join('  ');

  console.log('  ' + headerLine);
  console.log('  ' + sep);
  for (const row of rows) {
    console.log('  ' + row.map((c, i) => pad(String(c ?? ''), colWidths[i])).join('  '));
  }
}

export function printKeyValue(pairs) {
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  for (const [key, value] of pairs) {
    console.log(`  ${key.padEnd(maxKey)}  ${value}`);
  }
}

export function printHelp() {
  printBanner();
  console.log('  USAGE');
  printDivider();
  console.log('    node scripts/trace-fabric.js <command> [options]');
  console.log('');
  console.log('  COMMANDS');
  printDivider();
  const cmds = [
    ['trace', 'Trace revenue mesh and route x402 USDC royalties'],
    ['register', 'Register skill with contribution weights'],
    ['graph', 'View public Skill Economy Graph'],
    ['balance', 'Query PHRS + USDC wallet balances'],
    ['verify', 'Verify payment provenance proof'],
    ['sign-stack', 'Sign a call stack for signature verification demos'],
    ['inherit', 'Set successor for revenue inheritance'],
    ['networks', 'List configured Pharos networks'],
  ];
  printTable(['Command', 'Description'], cmds);
  console.log('');
  console.log('  QUICK START (no wallet required)');
  printDivider();
  console.log('    npm run demo          # 4-skill royalty simulation');
  console.log('    npm run graph         # Skill Economy Graph');
  console.log('');
  printTip('Import via: npx skills add pharos-inter-agent-revenue-fabric');
}

function center(text, width) {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text + ' '.repeat(width - pad - text.length);
}

function pad(str, width) {
  return str.length >= width ? str.slice(0, width) : str + ' '.repeat(width - str.length);
}
