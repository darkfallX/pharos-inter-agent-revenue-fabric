import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  isAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import { activeChain, PHAROS_CHAIN_ID, BLOCK_EXPLORER, USDC_ADDRESS, USDC_ABI } from './chains.js';

dotenv.config();

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function getClients() {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error('PRIVATE_KEY required for payment routing');
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  return {
    publicClient: createPublicClient({ chain: activeChain, transport: http() }),
    walletClient: createWalletClient({ account, chain: activeChain, transport: http() }),
    account,
  };
}

function paymentNetwork() {
  return `eip155:${PHAROS_CHAIN_ID}`;
}

function simulatedPayment(entry, amount, facilitator) {
  return {
    recipient: entry.creator,
    skillId: entry.skillId,
    amountUsdc: formatUnits(amount, 6),
    amountAtomic: amount.toString(),
    txHash: null,
    status: 'simulated',
    scheme: 'x402-exact',
    protocol: 'x402',
    network: paymentNetwork(),
    facilitatorConfigured: Boolean(facilitator),
  };
}

export async function routeRoyaltyPayments(royaltyBreakdown, { dryRun = false } = {}) {
  const payments = [];
  const facilitator = process.env.X402_FACILITATOR_URL || '';
  const requireX402 = process.env.X402_STRICT === 'true';
  const network = paymentNetwork();

  const totalNeeded = royaltyBreakdown.reduce((sum, e) => sum + BigInt(e.amountAtomic || '0'), 0n);

  // dry run with no wallet, simulate and return without touching the chain
  if (dryRun && !process.env.PRIVATE_KEY) {
    for (const entry of royaltyBreakdown) {
      const amount = BigInt(entry.amountAtomic || '0');
      if (amount <= 0n || !isAddress(entry.creator)) continue;
      payments.push(simulatedPayment(entry, amount, facilitator));
    }
    return {
      payer: ZERO_ADDRESS,
      payments,
      totalPaidAtomic: totalNeeded.toString(),
      settlementMode: 'dry-run-x402-exact',
      x402Strict: requireX402,
      facilitatorConfigured: Boolean(facilitator),
    };
  }

  const { publicClient, walletClient, account } = getClients();
  const payer = account.address;

  if (!dryRun) {
    if (requireX402 && !facilitator) {
      throw new Error('X402_STRICT=true requires X402_FACILITATOR_URL for live settlement');
    }

    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [payer],
    });

    if (balance < totalNeeded) {
      throw new Error(`Insufficient USDC: need ${formatUnits(totalNeeded, 6)}, have ${formatUnits(balance, 6)}`);
    }
  }

  for (const entry of royaltyBreakdown) {
    const amount = BigInt(entry.amountAtomic || '0');
    if (amount <= 0n) continue;

    if (!isAddress(entry.creator)) {
      payments.push({
        recipient: entry.creator,
        skillId: entry.skillId,
        amountUsdc: formatUnits(amount, 6),
        amountAtomic: amount.toString(),
        txHash: null,
        status: 'skipped',
        scheme: 'invalid-recipient',
        protocol: 'none',
        network,
      });
      continue;
    }

    if (dryRun) {
      payments.push(simulatedPayment(entry, amount, facilitator));
      continue;
    }

    let txHash;
    let scheme = 'direct-usdc';
    let protocol = 'erc20-transfer';
    let fallbackReason = null;
    let x402Settlement = null;

    if (facilitator) {
      try {
        const result = await routeViaX402Facilitator({
          facilitator,
          payer,
          recipient: entry.creator,
          amount,
          skillId: entry.skillId,
          walletClient,
        });
        if (!result.txHash) throw new Error('facilitator response did not include a transaction hash');
        txHash = result.txHash;
        scheme = 'x402-exact';
        protocol = 'x402';
        x402Settlement = result.settlement;
      } catch (err) {
        if (requireX402) {
          throw new Error(`x402 facilitator settlement failed for ${entry.skillId}: ${err.message}`);
        }
        fallbackReason = 'x402 facilitator failed; used direct USDC transfer';
      }
    }

    if (!txHash) {
      txHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [entry.creator, amount],
      });
    }

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    payments.push({
      recipient: entry.creator,
      skillId: entry.skillId,
      amountUsdc: formatUnits(amount, 6),
      amountAtomic: amount.toString(),
      txHash,
      status: 'settled',
      scheme,
      protocol,
      network,
      facilitatorUrl: facilitator || null,
      fallbackReason,
      x402Settlement,
      explorerUrl: BLOCK_EXPLORER ? `${BLOCK_EXPLORER}/tx/${txHash}` : null,
    });
  }

  return {
    payer,
    payments,
    totalPaidAtomic: totalNeeded.toString(),
    settlementMode: dryRun
      ? 'dry-run-x402-exact'
      : payments.every((p) => p.protocol === 'x402')
        ? 'x402-exact'
        : payments.some((p) => p.protocol === 'x402')
          ? 'mixed-x402-and-direct'
          : 'direct-usdc',
    x402Strict: requireX402,
    facilitatorConfigured: Boolean(facilitator),
  };
}

// Settle via an x402 facilitator (EIP-3009 exact payments) when one is configured.
async function routeViaX402Facilitator({ facilitator, payer, recipient, amount, skillId, walletClient }) {
  const { x402Client } = await import('@x402/core/client');
  const { ExactEvmScheme } = await import('@x402/evm/exact/client');
  const { wrapFetchWithPayment } = await import('@x402/fetch');

  const client = new x402Client();
  client.register(`eip155:${PHAROS_CHAIN_ID}`, new ExactEvmScheme(walletClient.account));
  client.register('eip155:*', new ExactEvmScheme(walletClient.account));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(`${facilitator}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payer,
      recipient,
      amount: amount.toString(),
      asset: USDC_ADDRESS,
      chainId: PHAROS_CHAIN_ID,
      metadata: { skillId, scheme: 'exact' },
    }),
  });

  const body = await response.json();
  return { txHash: body.txHash || body.transactionHash || body.transaction, settlement: body };
}

export function toAtomicUsdc(amount) {
  return parseUnits(amount.toString(), 6);
}

export function fromAtomicUsdc(atomic) {
  return formatUnits(BigInt(atomic), 6);
}
