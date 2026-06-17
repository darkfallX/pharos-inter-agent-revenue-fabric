---
name: pharos-inter-agent-revenue-fabric
version: 1.1.0
description: >
  The Spotify royalty system for the Pharos agent economy. Traces recursive
  skill dependency trees via X-Pharos-Call-Stack, verifies signed call-stack
  frames, calculates depth-decayed contribution-weighted royalties, routes
  x402 USDC micropayments to skill creators, records Merkle provenance proofs,
  and exposes a public Skill Economy Graph. Works with Claude Code, OpenClaw,
  and Codex via the Pharos Skill Engine.
---

# pharos-inter-agent-revenue-fabric

## INSTALL

Official Pharos Skill Engine format, works with Claude Code, OpenClaw, and Codex:

```bash
npx skills add https://github.com/darkfallX/pharos-inter-agent-revenue-fabric
```

## DESCRIPTION

Most skills charge end-users. This skill makes **agents pay each other**.

When a song plays on Spotify, five parties get paid simultaneously, artist, songwriter, producer, label, publisher. Right now in the agent economy, when ten skills collaborate, only the top-level caller gets paid. This skill is the Spotify royalty system for the Pharos agent economy.

It traces a recursive skill invocation graph, computes contribution-weighted royalties, simulates or settles x402 USDC payments, records verifiable provenance, and exposes a public Skill Economy Graph showing reuse, value flow, top earners, and proof activity.

This is infrastructure for a composable Pharos agent economy: useful skills can keep earning when other agents depend on them.

## CAPABILITIES

Agent-callable functions:

- **`traceRevenueMesh`** - Parse `X-Pharos-Call-Stack`, build an A->B->C->D dependency tree, verify optional creator signatures, calculate royalty splits, route/simulate x402 USDC payments, and return a full trace report.
- **`registerSkill`** - Register a skill on-chain or in the local demo registry with `contributionWeight`, dependencies, and perpetual `royaltyBps`.
- **`getSkillEconomyGraph`** - Query foundational skills, top earners, gross volume, creator earnings, settled volume, value flow, and recent proof activity.
- **`verifyPaymentProof`** - Verify Merkle provenance proofs from a proof bundle, graph event, transaction hash, or deployed registry record.
- **`setRevenueSuccessor`** - Route future revenue to a successor skill when a skill is deprecated or replaced.
- **`claimSkill`** - Bind a payout wallet to a skillId by signing a claim message, to collect royalties accrued against an unclaimed skill.
- **`getWalletBalances`** - Query PHRS native and USDC balances before live routing.
- **`listNetworks`** - Return configured Pharos networks from `networks.json`.

### Integrations

- **MCP server** (`mcp/server.js`): exposes `trace_revenue_mesh`, `get_economy_graph`, `verify_payment`, `register_skill`, `claim_skill`, `list_networks` as native tools for Claude Code / OpenClaw / Codex, zero dependencies, stdio.
- **Drop-in middleware** (`pharos-inter-agent-revenue-fabric/integration`): any Pharos skill becomes royalty-aware in three lines, propagating `X-Pharos-Call-Stack` and reporting invocations.
- **Registry seeding** (`npm run seed -- --github owner/repo`): imports real `SKILL.md` manifests from GitHub so the Skill Economy Graph maps the actual ecosystem.
- **Signatures**: call-stack frames support `personal_sign` (default) and **EIP-712** typed data (`sigType: "eip712"`), chain-bound to Pharos.

### Natural language

The skill is driven in plain English three ways: by an MCP-connected agent
(Claude Code / OpenClaw / Codex) that maps a request to the tools above; by the
`ask` CLI command; or by the `/ask` endpoint and the dashboard's Ask box.

```bash
npm run ask -- "trace a 0.10 USDC payment through pharos-yield-pilot and pharos-realfi-security-scout"
npm run ask -- "show me the top earners"
curl localhost:4020/ask -H 'content-type: application/json' -d '{"text":"who is earning the most?"}'
```

Example phrasings → action:

- "Trace a 0.10 USDC payment through A and B" → splits & routes royalties across the chain
- "Show the economy graph / who is earning the most?" → returns the live graph
- "Verify proof_abc…" → verifies a provenance proof
- "Claim pharos-realfi-security-scout" → guides the wallet-signature claim
- "Register my skill with weight 8000" → registers a skill

## WHY IT FITS PHAROS AGENT CARNIVAL

This is a **Phase 1 Skill submission** for the [Pharos AI Agent Carnival](https://www.pharos.xyz/agent-carnival), built in the official [Pharos Skill Engine](https://www.pharos.xyz/agent-center) format.

- **Reusable Skill primitive:** Any Pharos agent can compose this into its monetization path.
- **Composability-first:** It rewards upstream dependencies instead of only the final user-facing agent.
- **Pharos-native economics:** It targets x402 USDC payments and a Pharos on-chain registry.
- **Verifiable provenance:** It produces Merkle roots, proof bundles, optional signatures, and on-chain registry records.
- **Anvita Flow ready:** `openapi.yaml` exposes trace, register, graph, verify, and health endpoints.

## PREREQUISITES

### Node.js

```bash
node --version   # must be >= 18
npm install
```

### Environment

Judges can run without `.env` because dry-run mode uses `DEMO_REGISTRY`.

For live payment routing:

```bash
cp .env.example .env
# PRIVATE_KEY=0x...
# DRY_RUN=false
# X402_FACILITATOR_URL=...
# FABRIC_REGISTRY_ADDRESS=0x...
```

### Foundry

Foundry is only required for the Solidity deploy path.

```bash
forge install foundry-rs/forge-std --no-commit
forge build
forge script script/Deploy.s.sol:DeploySkillRevenueFabric \
  --rpc-url pharos-mainnet \
  --private-key $PRIVATE_KEY \
  --broadcast
```

Alternative:

```bash
npm run deploy
```

## PROJECT STRUCTURE

```text
pharos-inter-agent-revenue-fabric/
|-- SKILL.md
|-- README.md
|-- networks.json
|-- openapi.yaml
|-- contracts/
|   `-- SkillRevenueFabric.sol
|-- scripts/
|   `-- trace-fabric.js
|-- src/
|   |-- chain/
|   |-- core/
|   |-- cli/
|   `-- server/
|-- public/
|   `-- dashboard.html
`-- examples/
    |-- call-stack.json
    `-- call-stack-registered.json
```

## USAGE

### Quick Demo

```bash
npm install
npm run demo
npm run graph
```

### Trace + Proof Bundle

```bash
node scripts/trace-fabric.js trace \
  --root-skill pharos-yield-pilot \
  --amount 0.10 \
  --call-stack ./examples/call-stack.json \
  --dry-run \
  --proof-file ./report.proof.json

node scripts/trace-fabric.js verify --proof-file ./report.proof.json
```

### Signed Call Stack

```bash
node scripts/trace-fabric.js sign-stack \
  --call-stack ./examples/call-stack.json \
  --output ./examples/call-stack.signed.json

node scripts/trace-fabric.js trace \
  --root-skill pharos-yield-pilot \
  --amount 0.10 \
  --call-stack ./examples/call-stack.signed.json \
  --dry-run \
  --require-frame-signatures
```

### HTTP API

```bash
npm start
# GET  /health
# POST /trace
# GET  /graph
# POST /verify-payment
# POST /register
# GET  /dashboard
# GET  /openapi.yaml
```

## NETWORKS

Defined in `networks.json`:

| Key | Chain ID | RPC |
| --- | --- | --- |
| `pharos-mainnet` | 1672 | `https://rpc.pharos.xyz` |
| `pharos-atlantic` | 688689 | `https://atlantic.dplabs-internal.com` |

Switch network:

```bash
PHAROS_NETWORK=pharos-atlantic node scripts/trace-fabric.js networks
```

## UPGRADE LAYERS

| Layer | Capability |
| --- | --- |
| 1 | Full dependency tree tracking via call-stack frames |
| 2 | Perpetual royalties via `SkillRevenueFabric` registry |
| 3 | Contribution-weighted, depth-decayed splits |
| 4 | Public Skill Economy Graph and dashboard |
| 5 | Signed call-stack verification |
| 6 | Merkle proof bundles and on-chain proof records |
| 7 | Strict x402 facilitator mode with explicit fallback reporting |

## LICENSE

MIT-0
