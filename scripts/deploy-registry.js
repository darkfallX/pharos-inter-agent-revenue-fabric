#!/usr/bin/env node
/**
 * @deprecated Use `npm run deploy` instead.
 * Forwards to deploy/deploy.js
 */
console.log('Redirecting to npm run deploy...\n');
await import('../deploy/deploy.js');