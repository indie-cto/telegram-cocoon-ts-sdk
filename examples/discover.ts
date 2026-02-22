/**
 * Discover Cocoon network — find proxies and query root contract params.
 *
 * Usage:
 *   npx tsx examples/discover.ts [mainnet|testnet]
 */

import { Address, TonClient } from '@ton/ton';
import { CocoonRoot } from '../src/ton/contracts/root.js';

const ROOT_CONTRACTS: Record<string, string> = {
  mainnet: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  testnet: 'EQBT4hy4vMEZ9uxSCuhw_gBKh9_AwmHXLe7Wo0O4Vh-4kRjJ',
};

function formatNano(n: bigint): string {
  const whole = n / 1000000000n;
  const frac = n % 1000000000n;
  return `${whole}.${frac.toString().padStart(9, '0')} TON`;
}

async function main() {
  const network = (process.argv[2] ?? 'mainnet') as 'mainnet' | 'testnet';
  console.log(`Network: ${network}`);

  const endpoint =
    network === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC';

  const client = new TonClient({ endpoint });
  const rootAddress = Address.parse(ROOT_CONTRACTS[network]!);

  console.log(`Root contract: ${rootAddress.toString()}`);
  console.log(`Querying root contract state...\n`);

  const root = new CocoonRoot(client, rootAddress);
  const params = await root.getAllParams();

  if (!params) {
    console.log('Contract is not initialized');
    return;
  }

  console.log('--- Network Info ---');
  console.log(`Owner: ${params.ownerAddress.toString()}`);
  console.log(`Version: ${params.version}`);
  console.log(`Params version: ${params.params.paramsVersion}`);
  console.log(`Is test: ${params.params.isTest}`);

  console.log('\n--- Pricing ---');
  console.log(`Price per token: ${params.params.pricePerToken}`);
  console.log(`Worker fee per token: ${params.params.workerFeePerToken}`);
  console.log(`Min client stake: ${formatNano(params.params.minClientStake)}`);
  console.log(`Min proxy stake: ${formatNano(params.params.minProxyStake)}`);

  console.log(`\n--- Proxies (${params.registeredProxies.length}) ---`);
  if (params.registeredProxies.length > 0) {
    for (const proxy of params.registeredProxies) {
      console.log(`  [seqno=${proxy.seqno}] ${proxy.address}`);
    }
  } else {
    console.log('  (no proxies registered)');
  }
}

main().catch(console.error);
