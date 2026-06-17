#!/usr/bin/env node
// Seed the registry from data/skills-seed.json. Import real skills from GitHub with
// `npm run seed -- --github owner/repo`; list the registry with `--list`.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEMO_REGISTRY } from '../src/chain/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'skills-seed.json');
const CACHE_PATH = process.env.REGISTRY_CACHE_PATH || path.join(ROOT, 'data', 'registry-cache.json');

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

/** Parse the `name` and `description` from a SKILL.md YAML frontmatter block. */
function parseSkillManifest(md) {
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const block = fm[1];
  const nameMatch = block.match(/^\s*name:\s*(.+)\s*$/m);
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : null;
  return name ? { name } : null;
}

/** Fetch a repo's SKILL.md from GitHub, trying HEAD/main/master. */
async function fetchSkillManifest(repoRef) {
  const clean = repoRef
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const [owner, repo] = clean.split('/');
  if (!owner || !repo) throw new Error(`bad repo ref: ${repoRef}`);

  for (const ref of ['HEAD', 'main', 'master']) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/SKILL.md`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const md = await res.text();
        const parsed = parseSkillManifest(md);
        if (parsed) return { ...parsed, repo: `https://github.com/${owner}/${repo}` };
      }
    } catch {
      /* try next ref */
    }
  }
  throw new Error(`no parseable SKILL.md found for ${clean}`);
}

function toCacheEntry(s) {
  return {
    creator: s.creator || null,
    contributionWeight: s.contributionWeight ?? 5000,
    royaltyBps: s.royaltyBps ?? 500,
    dependencies: s.dependencies || [],
    successor: s.successor || null,
    active: s.active !== false,
    source: s.source || 'imported',
    claimed: s.claimed === true,
    repo: s.repo || null,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const cache = readJson(CACHE_PATH, null);
    const reg = cache || { ...DEMO_REGISTRY };
    console.log(`\nRegistry (${Object.keys(reg).length} skills), ${cache ? CACHE_PATH : 'DEMO_REGISTRY (no cache yet)'}\n`);
    for (const [id, v] of Object.entries(reg)) {
      const claimed = v.claimed === false ? 'UNCLAIMED' : (v.creator || 'no-wallet');
      console.log(`  • ${id}`);
      console.log(`      weight ${v.contributionWeight}bps · royalty ${v.royaltyBps}bps · source ${v.source || 'demo'} · ${claimed}`);
    }
    console.log('');
    return;
  }

  const seed = readJson(SEED_PATH, { skills: [] });
  const cache = readJson(CACHE_PATH, null) || { ...DEMO_REGISTRY };

  // 1) merge the static seed
  let added = 0;
  for (const s of seed.skills || []) {
    cache[s.skillId] = toCacheEntry(s);
    added++;
  }

  // 2) import real SKILL.md manifests from GitHub
  const ghIdx = args.indexOf('--github');
  const imported = [];
  if (ghIdx !== -1) {
    const repos = args.slice(ghIdx + 1).filter((a) => !a.startsWith('--'));
    for (const repoRef of repos) {
      try {
        const m = await fetchSkillManifest(repoRef);
        cache[m.name] = toCacheEntry({
          skillId: m.name,
          source: 'imported',
          claimed: false,
          repo: m.repo,
        });
        imported.push(m.name);
        console.log(`  ✓ imported ${m.name}  (${m.repo})`);
      } catch (err) {
        console.error(`  ✗ ${repoRef}: ${err.message}`);
      }
    }

    // persist imported skills back into the seed file so they survive
    if (imported.length) {
      const existing = new Set((seed.skills || []).map((s) => s.skillId));
      for (const name of imported) {
        if (!existing.has(name)) {
          seed.skills.push({
            skillId: name,
            creator: null,
            contributionWeight: 5000,
            royaltyBps: 500,
            dependencies: [],
            source: 'imported',
            repo: cache[name].repo,
            claimed: false,
          });
        }
      }
      writeJson(SEED_PATH, seed);
    }
  }

  writeJson(CACHE_PATH, cache);

  console.log(`\nSeeded ${added} skill(s) + ${imported.length} imported → ${CACHE_PATH}`);
  console.log(`Registry now holds ${Object.keys(cache).length} skills. Run \`npm run graph\` or open the dashboard.\n`);
}

function isMainModule() {
  return Boolean(process.argv[1] && process.argv[1].endsWith('seed-registry.js'));
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseSkillManifest, fetchSkillManifest };
