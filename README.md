# pharos-inter-agent-revenue-fabric

**Pharos Skill Engine · Phase 1 · Agents Paying Agents**

[![Pharos Skill Engine Tutorial](https://img.shields.io/badge/Pharos-Skill%20Engine-blue)](https://x.com/pharos_network/status/2064912380824551502)
[![CI](https://github.com/darkfallX/pharos-inter-agent-revenue-fabric/actions/workflows/ci.yml/badge.svg)](https://github.com/darkfallX/pharos-inter-agent-revenue-fabric/actions/workflows/ci.yml)
[![License: MIT-0](https://img.shields.io/badge/License-MIT--0-teal)](LICENSE)

## Live Demo

- **API + Dashboard:** https://pharos-revenue-fabric.up.railway.app
- **Dashboard:** https://pharos-revenue-fabric.up.railway.app/dashboard
- **Economy Graph (JSON):** https://pharos-revenue-fabric.up.railway.app/graph

## Demo Video

[Watch Demo on YouTube](https://youtu.be/RgIqCiZqIi4?si=F0Tr5psTEmwDZE35)

## Live Onchain Proof (Pharos Atlantic Testnet)

Not simulated, a real royalty settlement executed on-chain (chain ID `688689`):

| Step | Transaction |
|------|-------------|
| Registry deployed | [`SkillRevenueFabric` → 0xe4e239…92e6d](https://pharos-testnet.socialscan.io/address/0xe4e239bf646533389fcd9e0fc6f592d477d92e6d) |
| USDC payment (0.05 → creator) | [0x8ff644cf…82af](https://pharos-testnet.socialscan.io/tx/0x8ff644cf3a9909273076ffb8470bd6defb612c6abeb806fef5ccf0776fb082af) |
| Merkle proof recorded on-chain | [0x749f6e85…618c](https://pharos-testnet.socialscan.io/tx/0x749f6e85394ec2081258d8d2032f57d16a9b1dea4fca20b48801b064fe15618c) |

The recorded proof reads back `verifyPaymentProof() == true` from the contract. Reproduce with `npm run deploy:testnet` then `node scripts/settle-demo.js --to <wallet> --amount 0.05` (see [`scripts/settle-demo.js`](scripts/settle-demo.js)).

## The Problem

Most Pharos skills charge end-users through x402. This skill makes **agents pay each other** by tracing recursive skill composability, splitting USDC royalties by contribution weight, generating Merkle provenance proofs, and exposing a public Skill Economy Graph.

## The Solution

When a song plays on Spotify, five parties get paid simultaneously: the artist, the songwriter, the producer, the label, and the publisher. Right now in the agent economy, when ten skills collaborate to answer one request, only the top-level caller gets paid. Every upstream skill that did real work earns nothing.

**This skill is the Spotify royalty system for the Pharos agent economy.** Every invocation traces the full recursive dependency chain, splits the payment across every creator in it, weighted by contribution and depth, and produces a Merkle provenance proof so each payout is verifiable forever. Foundational skills keep earning every time anyone builds on them, which is exactly the incentive a composable skill ecosystem needs.

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

This skill can participate in its own royalty chain, agents that compose revenue tracing into their stack pay the fabric itself:

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

## Map the Real Skill Economy

The graph is seeded from [`data/skills-seed.json`](data/skills-seed.json) with **21 real skills from the official Pharos Agent Center preseason submission index**, real repos, real builders, composed into a value graph (including this project's sibling skill, [RealFi Security Scout](https://github.com/darkfallX/Pharos-Realfi-Security-Scout)). Every node is `source:"carnival"` and `claimed:false` with no wallet: royalties accrue against the skillId until the real builder binds one via **Claim Royalties**. The dependency edges are an illustrative composition (cross-skill deps aren't declared on-chain yet); the skill identities and repos are real.

Point the importer at any Pharos skill repo to pull its `SKILL.md` straight from GitHub:

```bash
npm run seed                              # load the curated real-ecosystem seed
npm run seed -- --github owner/skill-repo # import a submission's SKILL.md by repo
npm run seed -- --list                    # inspect the registry (source + claim status)
```

Run a trace through the real chain in [`examples/call-stack-carnival.json`](examples/call-stack-carnival.json):

```bash
node scripts/trace-fabric.js trace --root-skill pharos-autonomous-execution-engine \
  --amount 0.10 --call-stack ./examples/call-stack-carnival.json --dry-run
```

`source` labels every entry (`self` / `carnival` / `imported` / `demo`) so the graph never passes fictional skills off as real.

## Add Royalties to Any Skill (3 lines)

Any Pharos skill becomes royalty-aware with a drop-in middleware, no dependency on the fabric core:

```js
import { fabric } from 'pharos-inter-agent-revenue-fabric/integration';
app.use(fabric.middleware({ skillId: 'my-skill', creator: '0xYourWallet', apiUrl: process.env.FABRIC_API_URL }));
await req.reportRevenue('0.05'); // splits across everyone in the call chain
```

It reads the inbound `X-Pharos-Call-Stack`, appends your frame, re-emits the header so skills you call inherit the chain, and gives you `req.reportRevenue()`. Full example: [`examples/integration-example.js`](examples/integration-example.js).

## Run as an MCP Server

Expose the fabric as native tools for Claude Code / OpenClaw / Codex (zero dependencies, stdio):

```bash
npm run mcp
```

```json
{ "mcpServers": { "revenue-fabric": { "command": "node", "args": ["mcp/server.js"] } } }
```

Tools: `trace_revenue_mesh`, `get_economy_graph`, `verify_payment`, `register_skill`, `claim_skill`, `list_networks`.

## Claim Royalties

A creator binds a payout wallet by signing a claim message (no gas), unclaimed skills can be claimed first; an already-claimed skill can only be re-bound by its own wallet:

```bash
POST /claim  { "skillId": "...", "wallet": "0x...", "signature": "0x...", "message": "..." }
```

The "Claim a skill" button on the dashboard does this via your browser wallet. On-chain binding uses `claimSkill(bytes32)` on the deployed registry.

## Fire a Trace (Dashboard)

The dashboard's **Fire a trace** button POSTs a real `/trace` through a composed skill chain and animates the new royalty flow into the live graph, judge-facing, no setup.

## Signed Call Stacks (EIP-712)

Frames can be signed with plain `personal_sign` (default) or **EIP-712 typed data** (set `sigType: "eip712"` on the frame). Typed signatures render legibly in wallets and bind to the Pharos chainId, preventing cross-chain replay.

## Security, CertiK Skill Scanner

This skill is designed to pass the CertiK Skill Scanner security requirements:

- No remote code execution paths, the skill never `eval`s or executes fetched content.
- No secret exfiltration, `PRIVATE_KEY` is read only from local `.env`, never logged or transmitted.
- Default-safe, without a wallet configured the skill runs in `DRY_RUN` mode and cannot move funds.
- Payment caps, `royaltyBps` is capped at 2000 (20%) both in the contract and in the JS registry.
- Verifiable outputs, every payment produces a Merkle proof that third parties can independently verify via `/verify-payment`.

## Project Layout

| Path | Role |
| --- | --- |
| `SKILL.md` | Skill definition, capabilities, prerequisites, and campaign pitch |
| `networks.json` | `pharos-mainnet` and `pharos-atlantic` chain config |
| `contracts/` + `foundry.toml` | On-chain `SkillRevenueFabric` registry |
| `src/chain/` | viem clients, registry, x402 payment routing, balances |
| `src/core/` | Revenue fabric engine, graph aggregation, provenance proofs |
| `src/integration/` | Drop-in middleware + fetch wrapper for any Pharos skill |
| `src/cli/` | Terminal UI and formatters |
| `src/server/` | Express API for Anvita Flow / Railway |
| `mcp/server.js` | MCP server exposing the fabric as agent tools |
| `public/dashboard.html` | Skill Economy Graph dashboard |
| `data/skills-seed.json` | Seed for the registry (self / demo / imported skills) |
| `scripts/trace-fabric.js` | CLI entry point |
| `scripts/seed-registry.js` | Seed loader + GitHub `SKILL.md` importer |
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
# Status:   GET  http://localhost:4020/
# Health:   GET  http://localhost:4020/health
# Trace:    POST http://localhost:4020/trace
# Graph:    GET  http://localhost:4020/graph
# Verify:   POST http://localhost:4020/verify-payment
# Register: POST http://localhost:4020/register
# Claim:    POST http://localhost:4020/claim
# Ask (NL): POST http://localhost:4020/ask    {"text":"trace 0.10 through A and B"}
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

Turnkey deploy (set `PRIVATE_KEY` in `.env` first):

```bash
npm run deploy:testnet   # Pharos Atlantic testnet
npm run deploy:mainnet   # Pharos Mainnet
```

Then set `FABRIC_REGISTRY_ADDRESS` in `.env` and run a live trace, `/trace` will record the Merkle root on-chain and the dashboard switches from `dry-run` to `settled`.

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
