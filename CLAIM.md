# Is your skill in the graph? Claim your royalties.

The **Inter-Agent Revenue Fabric** maps the real Pharos Agent Center skill ecosystem, including **your** skill if you submitted one in the preseason. Every time another agent composes your skill into a chain, a contribution-weighted royalty accrues against your skill ID.

Right now those earnings are **unclaimed**, they're waiting for you to bind a payout wallet. No wallet means the royalty is recorded but not routed. Claiming takes ~30 seconds, costs no gas, and never moves your funds.

## Claim in three steps

1. Open the live dashboard and find your skill in **Foundational Skills** (or any node in the graph).
2. Click **claim ↗** next to it, or open the **Claim a skill** button and type your skill ID.
3. Connect your EVM wallet and **sign the claim message**. That's it, future royalties route to that wallet.

> A claim is just a signature over:
> ```
> Pharos Revenue Fabric
> Claim skill: <your-skill-id>
> Wallet: <your-wallet>
> Chain: 1672
> ```
> It proves you control the wallet. It is **not** a transaction, nothing is spent, nothing is approved.

## Or claim from the API / an agent

```bash
curl -X POST https://<fabric-host>/claim \
  -H 'content-type: application/json' \
  -d '{"skillId":"your-skill-id","wallet":"0xYourWallet","signature":"0x..."}'
```

Or via the MCP tool `claim_skill` from Claude Code / OpenClaw / Codex.

## How the royalty is calculated

When a chain like `A → B → your-skill → D` runs, one payment is split across **every** skill in it, weighted by each skill's declared contribution and decayed by depth, then boosted by its perpetual royalty rate. Foundational skills that many others depend on earn the most. Every split is committed to a Merkle root you can independently verify.

## Why this exists

Composability without compensation is a dead end, if upstream skills earn nothing, nobody builds the primitives everyone else needs. This is the Spotify royalty model for the Pharos agent economy: **every skill in the chain earns, forever.**

Built for the Pharos AI Agent Carnival · Phase 1 · MIT-0
