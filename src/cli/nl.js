// Lightweight natural-language intent parser for the fabric's actions.
// Maps a plain-English sentence to a structured action (trace / graph / verify /
// claim / register / networks). It's keyword + pattern based, not a full LLM, 
// the rich NL experience comes from an MCP-connected agent; this lets the skill
// understand direct requests on its own for demos and quick use.

const DEFAULT_SKILLS = [
  'pharos-inter-agent-revenue-fabric',
  'pharos-realfi-security-scout',
  'pharos-x402-skill',
  'pharos-wallet-intel',
  'pharos-contract-intelligence',
  'pharos-contract-auditor',
  'pharos-token-analytics',
  'pharos-aml-sentinel',
  'pharos-rwa-engine',
  'pharos-strategy-composer',
  'pharos-autonomous-execution-engine',
  'pharospay',
  'splitra',
  'pharos-yield-pilot',
];

function parseAmount(text) {
  const cents = text.match(/(\d+(?:\.\d+)?)\s*(?:cents?|¢)\b/i);
  if (cents) return (parseFloat(cents[1]) / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const usd = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?|\$)?/i);
  if (usd && /\$|\busdc\b|\busd\b|dollar|\d\.\d|cent/i.test(text)) return usd[1];
  return null;
}

function findSkills(text, known) {
  const lower = text.toLowerCase();
  const found = [];
  for (const id of known) {
    const pattern = id.replace(/-/g, '[\\s-]');
    const re = new RegExp(`\\b${pattern}\\b`, 'i');
    const m = lower.match(re);
    if (m) found.push({ id, index: m.index });
  }
  return found.sort((a, b) => a.index - b.index).map((s) => s.id);
}

export function parseIntent(text, knownSkills = DEFAULT_SKILLS) {
  const t = (text || '').trim();
  const lower = t.toLowerCase();
  const catalog = [...new Set([...(knownSkills || []), ...DEFAULT_SKILLS])];
  const skills = findSkills(t, catalog);
  const amountUsdc = parseAmount(t);

  if (/\b(verify|check|validate)\b.*\b(proof|payment|receipt)\b|\bverify\b/.test(lower)) {
    const proofId = (t.match(/\b(proof_[a-z0-9]+|inv_[a-z0-9]+)\b/i) || [])[1] || null;
    const txHash = (t.match(/\b0x[a-f0-9]{64}\b/i) || [])[0] || null;
    return { action: 'verify', proofId, txHash, explanation: `Verify the provenance proof ${proofId || txHash || '(none provided)'}.` };
  }

  if (/\b(graph|economy|who(?:'s| is)? earning|top earners?|foundational|leaderboard|biggest)\b/.test(lower)) {
    return { action: 'graph', explanation: 'Show the live Skill Economy Graph (top skills, earners, value flow).' };
  }

  if (/\b(claim)\b/.test(lower)) {
    return { action: 'claim', skills, explanation: `Claim ${skills[0] || 'a skill'}, needs a wallet signature (use the dashboard or POST /claim).` };
  }

  if (/\b(register|publish|add)\b.*\bskill\b/.test(lower)) {
    const weight = (t.match(/weight\s*(\d{1,5})/i) || [])[1];
    return { action: 'register', skills, contributionWeight: weight ? Number(weight) : undefined, explanation: `Register ${skills[0] || 'a skill'}${weight ? ` at weight ${weight}` : ''}.` };
  }

  if (/\b(network|chain)s?\b/.test(lower)) {
    return { action: 'networks', explanation: 'List the configured Pharos networks.' };
  }

  if (/\b(trace|pay|route|split|settle|send|invoke|run)\b/.test(lower) || (skills.length && amountUsdc)) {
    const amount = amountUsdc || '0.10';
    const chain = skills.length ? skills : ['pharos-yield-pilot', 'pharos-realfi-security-scout'];
    return {
      action: 'trace',
      rootSkillId: chain[0],
      amountUsdc: amount,
      skills: chain,
      explanation: `Trace a ${amount} USDC payment through ${chain.join(' → ')} and split the royalties.`,
    };
  }

  return { action: 'help', explanation: 'Try: "trace a 0.10 USDC payment through pharos-yield-pilot and pharos-realfi-security-scout", "show the economy graph", or "verify proof_…".' };
}

export function buildCallStackFromSkills(skills) {
  return {
    version: '1',
    frames: skills.map((id, depth) => ({ skillId: id, depth, parentSkillId: depth ? skills[depth - 1] : null })),
  };
}
