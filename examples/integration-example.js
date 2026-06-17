// Example: add inter-agent royalties to any Pharos skill in 3 lines.
//   FABRIC_API_URL=http://localhost:4020 node examples/integration-example.js

import express from 'express';
import { fabric } from '../src/integration/fabric-client.js';

const app = express();
app.use(express.json());

// ── the 3 lines ──────────────────────────────────────────────
app.use(fabric.middleware({
  skillId: 'my-analytics-skill',
  creator: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  apiUrl: process.env.FABRIC_API_URL || 'http://localhost:4020',
}));
// ─────────────────────────────────────────────────────────────

app.post('/run', async (req, res) => {
  // ... your skill does its work, charging the caller `amount` USDC ...
  const amount = req.body.amount || '0.05';

  // one call splits that revenue across every skill in the chain,
  // weighted by contribution + depth, and records a Merkle proof.
  const report = await req.reportRevenue(amount).catch((e) => ({ error: e.message }));

  res.json({ ok: true, amount, fabric: report });
});

const PORT = process.env.PORT || 5099;
app.listen(PORT, () => console.log(`example skill on http://localhost:${PORT} → reporting to ${process.env.FABRIC_API_URL || 'http://localhost:4020'}`));
