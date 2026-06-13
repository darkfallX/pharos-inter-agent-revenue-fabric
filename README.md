# pharos-inter-agent-revenue-fabric

**Pharos Skill Engine - Phase 1 - Agents Paying Agents**

[![Pharos Skill Engine Tutorial](https://img.shields.io/badge/Pharos-Skill%20Engine-blue)](https://x.com/pharos_network/status/2064912380824551502)
[![License: MIT-0](https://img.shields.io/badge/License-MIT--0-teal)](LICENSE)

## Live Demo

- **API + Dashboard:** https://pharos-revenue-fabric.up.railway.app
- **Dashboard:** https://pharos-revenue-fabric.up.railway.app/dashboard
- **Economy Graph (JSON):** https://pharos-revenue-fabric.up.railway.app/graph

## Demo Video

[Watch Demo on YouTube](YOUR_LINK_HERE)

## The Problem

Most Pharos skills charge end-users through x402. This skill makes **agents pay each other** by tracing recursive skill composability, splitting USDC royalties by contribution weight, generating Merkle provenance proofs, and exposing a public Skill Economy Graph.

## Why This Wins

When a song plays on Spotify, five parties get paid simultaneously: the artist, the songwriter, the producer, the label, and the publisher. Right now in the agent economy, when ten skills collaborate to answer one request, only the top-level caller gets paid. Every upstream skill that did real work earns nothing.

**This skill is the Spotify royalty system for the Pharos agent economy.** Every invocation traces the full recursive dependency chain, splits the payment across every creator in it — weighted by contribution and depth — and produces a Merkle provenance proof so each payout is verifiable forever. Foundational skills keep earning every time anyone builds on them, which is exactly the incentive a composable skill ecosystem needs.

## Try It Now

```bash
npm install
npm run demo
npm run graph
```

No wallet and no contract deployment are required. `DEMO_REGISTRY` handles the zero-setup path.

> **Note:** `pharos-yield-pilot` and the other skills in [examples/call-stack.json](examples/call-stack.json) are fictional demo skills seeded in `DEMO_REGISTRY` so judges can run the full pipeline with zero setup. For a self-referential demo where this skill itself participates in the royalty chain, use [examples/call-stack-registered.json](examples/call-stack-registered.json).

## Proof Demo

```bash
node scripts/trace-fabric.js trace \
  --root-skill pharos-yield-pilot \
  --amount 0.10 \
  --call-stack ./examples/call-stack.json \
  --dry-run \
  --proof-file ./report.proof.json

node scripts/trace-fabric.js verify --proof-file ./report.proof.json
```

## Self-Referential Demo

This skill can participate in its own royalty chain — agents that compose revenue tracing into their stack pay the fabric itself:

```bash
node scripts/trace-fabric.js trace \
  --root-skill pharos-yield-pilot \
  --amount 0.10 \
  --call-stack ./examples/call-stack-registered.json \
  --dry-run
```

## Signed Call Stack Demo

```bash
cp .env.example .env
# Set PRIVATE_KEY in .env first.

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

`sign-stack` signs every frame with the current wallet for local demos. In production, each skill creator signs its own frame before handing execution to the next agent.

## Install as a Skill

Official Pharos Skill Engine install:

```bash
npx skills add https://github.com/darkfallX/pharos-inter-agent-revenue-fabric
```

Works with Claude Code, OpenClaw, and Codex. Full agent manifest: [SKILL.md](SKILL.md)

## Security — CertiK Skill Scanner

This skill is designed to pass the CertiK Skill Scanner security requirements:

- No remote code execution paths — the skill never `eval`s or executes fetched content.
- No secret exfiltration — `PRIVATE_KEY` is read only from local `.env`, never logged or transmitted.
- Default-safe — without a wallet configured the skill runs in `DRY_RUN` mode and cannot move funds.
- Payment caps — `royaltyBps` is capped at 2000 (20%) both in the contract and in the JS registry.
- Verifiable outputs — every payment produces a Merkle proof that third parties can independently verify via `/verify-payment`.

## Project Layout

| Path | Role |
| --- | --- |
| `SKILL.md` | Skill definition, capabilities, prerequisites, and campaign pitch |
| `networks.json` | `pharos-mainnet` and `pharos-atlantic` chain config |
| `contracts/` + `foundry.toml` | On-chain `SkillRevenueFabric` registry |
| `src/chain/` | viem clients, registry, x402 payment routing, balances |
| `src/core/` | Revenue fabric engine, graph aggregation, provenance proofs |
| `src/cli/` | Terminal UI and formatters |
| `src/server/` | Express API for Anvita Flow / Railway |
| `public/dashboard.html` | Skill Economy Graph dashboard |
| `scripts/trace-fabric.js` | CLI entry point |
| `script/Deploy.s.sol` | Foundry deploy script (Solidity) |

> **`script/` vs `scripts/`:** these are two different directories by convention. `script/` (singular) is the standard Foundry location and contains only the Solidity deploy script. `scripts/` (plural) contains the Node.js CLI (`trace-fabric.js`). Day-to-day usage only touches `scripts/`.

## CLI

```bash
node scripts/trace-fabric.js trace -r pharos-yield-pilot -a 0.10 -c ./examples/call-stack.json --dry-run
node scripts/trace-fabric.js trace -r pharos-yield-pilot -a 0.10 -c ./examples/call-stack.json --dry-run --proof-file ./report.proof.json
node scripts/trace-fabric.js verify --proof-file ./report.proof.json
node scripts/trace-fabric.js graph --top 10
node scripts/trace-fabric.js balance --address 0x...
node scripts/trace-fabric.js networks
node scripts/trace-fabric.js register --skill-id my-skill --weight 8000
node scripts/trace-fabric.js sign-stack --call-stack ./examples/call-stack.json --output ./examples/call-stack.signed.json
```

## API + Anvita Flow

```bash
npm start
# Health:   GET  http://localhost:4020/health
# Trace:    POST http://localhost:4020/trace
# Graph:    GET  http://localhost:4020/graph
# Verify:   POST http://localhost:4020/verify-payment
# OpenAPI:  GET  http://localhost:4020/openapi.yaml
# Dashboard http://localhost:4020/dashboard
```

Import `openapi.yaml` into Anvita Flow as an HTTP tool/action source.

## Live Settlement Modes

- `DRY_RUN=true`: simulated `x402-exact` payments, no wallet required.
- `DRY_RUN=false`: sends live payments.
- `X402_FACILITATOR_URL=...`: attempts x402 facilitator settlement first.
- `X402_STRICT=true`: fails if x402 facilitator settlement is unavailable instead of falling back to direct USDC transfer.
- `FABRIC_REGISTRY_ADDRESS=...`: records Merkle proof roots on-chain after live settlement.
- `REQUIRE_FRAME_SIGNATURES=true`: rejects unsigned or invalid call-stack frames.

## Deploy Contract

```bash
forge install foundry-rs/forge-std --no-commit
forge build
forge script script/Deploy.s.sol:DeploySkillRevenueFabric \
  --rpc-url pharos-mainnet --private-key $PRIVATE_KEY --broadcast
```

Or use the viem + solc fallback:

```bash
npm run deploy
```

## Tests

```bash
npm test
```

## License

MIT-0
