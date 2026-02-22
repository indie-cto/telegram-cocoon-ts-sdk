/**
 * Check Cocoon balances (wallet + client contract) against minClientStake.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/balance.ts
 *
 * Env:
 *   NETWORK=mainnet|testnet              (default: mainnet)
 *   TON_V4_ENDPOINT=https://...          (optional)
 *   TON_ENDPOINT=https://...             (optional)
 *   CLIENT_SC_ADDRESS=...                (required)
 *   MNEMONIC=...                         (optional, shows wallet balance if set)
 */

import { Address, TonClient4 } from '@ton/ton';
import { ProxyDiscovery } from '../src/ton/discovery.js';
import { MnemonicWallet } from '../src/ton/wallet.js';

function defaultTonV4Endpoint(network: 'mainnet' | 'testnet'): string {
  return network === 'mainnet'
    ? 'https://mainnet-v4.tonhubapi.com'
    : 'https://testnet-v4.tonhubapi.com';
}

function parseCoins(coins: unknown): bigint {
  if (typeof coins === 'bigint') return coins;
  if (typeof coins === 'string') return BigInt(coins);
  throw new Error(`Unexpected coins type: ${typeof coins}`);
}

function formatNano(n: bigint): string {
  const whole = n / 1000000000n;
  const frac = n % 1000000000n;
  return `${whole}.${frac.toString().padStart(9, '0')} TON`;
}

async function readAccount(
  client: TonClient4,
  address: Address,
): Promise<{ state: string; balance: bigint }> {
  const last = await client.getLastBlock();
  const account = await client.getAccount(last.last.seqno, address);
  return {
    state: account.account.state.type,
    balance: parseCoins(account.account.balance.coins),
  };
}

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
  const tonEndpoint = process.env.TON_ENDPOINT?.trim() || undefined;
  const tonV4Endpoint = process.env.TON_V4_ENDPOINT?.trim() || defaultTonV4Endpoint(network);

  const clientScString = process.env.CLIENT_SC_ADDRESS?.trim();
  if (!clientScString) {
    throw new Error('CLIENT_SC_ADDRESS env var is required');
  }
  const clientScAddress = Address.parse(clientScString);

  const v4 = new TonClient4({ endpoint: tonV4Endpoint });

  const discovery = new ProxyDiscovery({ network, tonApiEndpoint: tonEndpoint });
  const rootParams = await discovery.getRootParams();
  const minClientStake = rootParams.params.minClientStake;

  const clientSc = await readAccount(v4, clientScAddress);

  console.log(`Network: ${network}`);
  console.log(`Client SC: ${clientScAddress.toString()}`);
  console.log(`Client SC state: ${clientSc.state}`);
  console.log(`Client SC balance: ${formatNano(clientSc.balance)}`);
  console.log(`minClientStake: ${formatNano(minClientStake)}`);

  const delta = clientSc.balance - minClientStake;
  if (delta >= 0n) {
    console.log(`Stake headroom: +${formatNano(delta)}`);
  } else {
    console.log(`Stake deficit: -${formatNano(-delta)}`);
  }

  const mnemonic = process.env.MNEMONIC?.trim();
  if (mnemonic) {
    const wallet = new MnemonicWallet(mnemonic, network, { tonEndpoint, tonV4Endpoint });
    await wallet.init();
    const walletState = await readAccount(v4, wallet.address);
    console.log(`Wallet: ${wallet.addressString}`);
    console.log(`Wallet state: ${walletState.state}`);
    console.log(`Wallet balance: ${formatNano(walletState.balance)}`);
  }
}

main().catch((err) => {
  console.error('Balance check failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
