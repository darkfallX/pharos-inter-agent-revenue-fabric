import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { registerRoutes } from './routes.js';
import { isRegistryDeployed } from '../chain/registry.js';
import { CHAIN_META, PHAROS_CHAIN_ID } from '../chain/chains.js';
import { seedGraphIfEmpty } from '../core/seed-graph.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(__filename) || process.argv[1].endsWith('api.js');
}

// default to dry-run when no wallet is configured, so the server is safe to run as-is
if (process.env.DRY_RUN === undefined && !process.env.PRIVATE_KEY) {
  process.env.DRY_RUN = 'true';
}

const app = express();
const PORT = parseInt(process.env.PORT || '4020', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pharos-Call-Stack');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (_req, res) => {
  res.json({
    skill: 'pharos-inter-agent-revenue-fabric',
    version: '1.1.0',
    status: 'live',
    description: 'Inter-agent revenue mesh for the Pharos AI economy, agents paying agents via x402 USDC royalties.',
    chainId: PHAROS_CHAIN_ID,
    chain: CHAIN_META.name,
    dashboard: '/dashboard',
    endpoints: {
      health: 'GET /health',
      trace: 'POST /trace',
      graph: 'GET /graph',
      verifyPayment: 'POST /verify-payment',
      register: 'POST /register',
      claim: 'POST /claim',
      ask: 'POST /ask',
      openapi: 'GET /openapi.yaml',
    },
    repository: 'https://github.com/darkfallX/pharos-inter-agent-revenue-fabric',
  });
});

registerRoutes(app);
app.use('/public', express.static(path.join(__dirname, '../../public')));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('[express]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    console.log('Pharos Inter-Agent Revenue Fabric API');
    console.log(`  Chain:    ${CHAIN_META.name} (${PHAROS_CHAIN_ID})`);
    console.log(`  Listen:   http://${HOST}:${PORT}`);
    console.log(`  Health:   http://127.0.0.1:${PORT}/health`);
    console.log(`  OpenAPI:  http://127.0.0.1:${PORT}/openapi.yaml`);
    console.log(`  Dry-run:  ${process.env.DRY_RUN !== 'false'}`);
    console.log(`  Registry: ${isRegistryDeployed() ? CHAIN_META.registry : 'DEMO_REGISTRY'}`);
    // populate an empty graph in the background so fresh deploys aren't blank
    setImmediate(() => {
      const r = seedGraphIfEmpty();
      if (r.seeded) console.log(`  Seeded:   ${r.seeded} demo invocations into an empty graph`);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} in use. Set PORT in .env or stop the other process.`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (isMainModule()) {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
  startServer();
}

export default app;
