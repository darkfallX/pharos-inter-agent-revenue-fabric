/**
 * Wallet balance queries, PHRS native + USDC on Pharos.
 */

import { formatUnits } from 'viem';
import { getPublicClient } from './registry.js';
import { USDC_ADDRESS, USDC_ABI, CHAIN_META } from './chains.js';

/**
 * Fetch native (PHRS) and USDC balances for an address.
 */
export async function getWalletBalances(address) {
  const client = getPublicClient();

  const [nativeWei, usdcAtomic] = await Promise.all([
    client.getBalance({ address }),
    USDC_ADDRESS
      ? client.readContract({
          address: USDC_ADDRESS,
          abi: USDC_ABI,
          functionName: 'balanceOf',
          args: [address],
        })
      : Promise.resolve(0n),
  ]);

  return {
    address,
    network: CHAIN_META.name,
    chainId: CHAIN_META.chainId,
    native: {
      symbol: 'PHRS',
      amount: formatUnits(nativeWei, 18),
      wei: nativeWei.toString(),
    },
    usdc: {
      symbol: 'USDC',
      amount: formatUnits(usdcAtomic, 6),
      atomic: usdcAtomic.toString(),
    },
  };
}