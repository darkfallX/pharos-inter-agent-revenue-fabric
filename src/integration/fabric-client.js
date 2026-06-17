// Drop-in royalty client for any Pharos skill. Zero deps (Node 18+ fetch/Buffer).
//   import { fabric } from 'pharos-inter-agent-revenue-fabric/integration';
//   app.use(fabric.middleware({ skillId: 'my-skill', creator: '0xWallet', apiUrl: process.env.FABRIC_API_URL }));
//   await req.reportRevenue('0.05');

const HEADER = 'x-pharos-call-stack';

export function encodeCallStack(stack) {
  return Buffer.from(JSON.stringify(stack)).toString('base64');
}

export function decodeCallStack(header) {
  const empty = { version: '1', frames: [] };
  if (!header) return empty;
  const tryParse = (s) => {
    const p = JSON.parse(s);
    return { version: p.version || '1', invocationId: p.invocationId, frames: Array.isArray(p.frames) ? p.frames : [] };
  };
  try {
    return tryParse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    try {
      return tryParse(header);
    } catch {
      return empty;
    }
  }
}

export function appendFrame(stack, frame) {
  const frames = Array.isArray(stack.frames) ? stack.frames : [];
  const depth = frames.length;
  const parentSkillId = depth > 0 ? frames[depth - 1].skillId : null;
  return {
    version: stack.version || '1',
    invocationId: stack.invocationId,
    frames: [...frames, { depth, parentSkillId, signature: null, ...frame }],
  };
}

export function middleware(opts = {}) {
  const { skillId, creator = null, contributionWeight = 5000, apiUrl = process.env.FABRIC_API_URL, headerName = HEADER } = opts;
  if (!skillId) throw new Error('fabric.middleware requires { skillId }');

  return function pharosFabric(req, res, next) {
    const incoming = decodeCallStack(req.headers[headerName] || req.headers[headerName.toLowerCase()]);
    const stack = appendFrame(incoming, { skillId, creator, contributionWeight });

    req.pharosCallStack = stack;
    req.pharosCallStackHeader = encodeCallStack(stack);
    res.setHeader('X-Pharos-Call-Stack', req.pharosCallStackHeader);

    req.reportRevenue = (amountUsdc, extra = {}) =>
      reportInvocation({
        apiUrl,
        rootSkillId: stack.frames[0] ? stack.frames[0].skillId : skillId,
        amountUsdc,
        callStack: stack,
        dryRun: extra.dryRun !== false,
        ...extra,
      });

    next();
  };
}

// Wrap fetch so outbound calls to other skills carry the call stack, letting the fabric trace A→B→C.
export function wrapFetch(fetchImpl, getStack) {
  const f = fetchImpl || globalThis.fetch;
  return (url, init = {}) => {
    const stack = typeof getStack === 'function' ? getStack() : getStack;
    const headers = new Headers(init.headers || {});
    if (stack) headers.set('X-Pharos-Call-Stack', encodeCallStack(stack));
    return f(url, { ...init, headers });
  };
}

export async function reportInvocation({
  apiUrl = process.env.FABRIC_API_URL,
  rootSkillId,
  amountUsdc,
  callStack,
  dryRun = true,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiUrl) throw new Error('reportInvocation requires apiUrl (or FABRIC_API_URL env)');
  if (!rootSkillId) throw new Error('reportInvocation requires rootSkillId');
  const res = await fetchImpl(`${String(apiUrl).replace(/\/$/, '')}/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootSkillId, amountUsdc: String(amountUsdc), callStack, dryRun }),
  });
  if (!res.ok) throw new Error(`fabric /trace responded ${res.status}`);
  return res.json();
}

export const fabric = { middleware, wrapFetch, reportInvocation, encodeCallStack, decodeCallStack, appendFrame };

export default fabric;
