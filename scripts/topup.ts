/**
 * Top up an existing Cocoon client contract stake/balance.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/topup.ts
 *
 * Env:
 *   MNEMONIC=...                         (required)
 *   TOP_UP_TON=5                         (default: 5)
 *   NETWORK=mainnet|testnet              (default: mainnet)
 *   TON_V4_ENDPOINT=https://...          (optional)
 *   CLIENT_SC_ADDRESS=...                (recommended)
 *
 * Optional fallback to resolve CLIENT_SC via handshake:
 *   SECRET=...
 *   PROXY_URL=host:port
 *   COCOON_TLS_CERT_PATH=/path.pem
 *   COCOON_TLS_KEY_PATH=/path.pem
 */

import { existsSync, readFileSync } from 'node:fs';
import { Address, toNano, TonClient4, WalletContractV4 } from '@ton/ton';
import type { Sender } from '@ton/core';
import { MnemonicWallet } from '../src/ton/wallet.js';
import { CocoonClientContract } from '../src/ton/contracts/client-contract.js';
import { ProxyDiscovery } from '../src/ton/discovery.js';
import { CocoonConnection } from '../src/core/protocol/connection.js';
import { performHandshake } from '../src/core/protocol/handshake.js';

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

function createHybridSender(
  wallet: MnemonicWallet,
  network: 'mainnet' | 'testnet',
  tonV4Endpoint?: string,
): Sender {
  const key = wallet.secretKey;
  const walletContract = WalletContractV4.create({ workchain: 0, publicKey: wallet.publicKey });
  const endpoint = tonV4Endpoint ?? defaultTonV4Endpoint(network);
  const client = new TonClient4({ endpoint });
  return client.open(walletContract).sender(key);
}

function openWalletV4(
  wallet: MnemonicWallet,
  network: 'mainnet' | 'testnet',
  tonV4Endpoint?: string,
) {
  const endpoint = tonV4Endpoint ?? defaultTonV4Endpoint(network);
  const client = new TonClient4({ endpoint });
  const walletContract = WalletContractV4.create({ workchain: 0, publicKey: wallet.publicKey });
  return client.open(walletContract);
}

async function waitForWalletSeqnoIncrease(
  wallet: MnemonicWallet,
  network: 'mainnet' | 'testnet',
  tonV4Endpoint: string | undefined,
  previousSeqno: number,
  label: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const currentSeqno = await openWalletV4(wallet, network, tonV4Endpoint).getSeqno();
    if (currentSeqno > previousSeqno) return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`${label}: wallet seqno did not increase (tx not confirmed in time)`);
}

function parseProxyUrl(url: string): { host: string; port: number } {
  const lastColon = url.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === url.length - 1) {
    throw new Error(`Invalid PROXY_URL: ${url}`);
  }
  const host = url.slice(0, lastColon);
  const port = Number.parseInt(url.slice(lastColon + 1), 10);
  if (!host || Number.isNaN(port)) {
    throw new Error(`Invalid PROXY_URL: ${url}`);
  }
  return { host, port };
}

async function resolveProxy(
  network: 'mainnet' | 'testnet',
  proxyUrl?: string,
): Promise<{ host: string; port: number; display: string }> {
  if (proxyUrl) {
    const { host, port } = parseProxyUrl(proxyUrl);
    return { host, port, display: `${host}:${port}` };
  }

  const discovery = new ProxyDiscovery({ network });
  const proxy = await discovery.getRandomProxy();
  const entries = proxy.address.trim().split(/\s+/);
  const clientEntry = entries.length > 1 ? entries[1]! : entries[0]!;
  const { host, port } = parseProxyUrl(clientEntry);
  return { host, port, display: `${host}:${port}` };
}

function resolveTlsMaterial(): { cert: string; key: string } {
  const certPath = process.env.COCOON_TLS_CERT_PATH?.trim();
  const keyPath = process.env.COCOON_TLS_KEY_PATH?.trim();

  if (!certPath || !keyPath) {
    throw new Error(
      'CLIENT_SC_ADDRESS is not set. To auto-resolve via handshake, set COCOON_TLS_CERT_PATH and COCOON_TLS_KEY_PATH',
    );
  }
  if (!existsSync(certPath)) {
    throw new Error(`COCOON_TLS_CERT_PATH does not exist: ${certPath}`);
  }
  if (!existsSync(keyPath)) {
    throw new Error(`COCOON_TLS_KEY_PATH does not exist: ${keyPath}`);
  }

  return {
    cert: readFileSync(certPath, 'utf-8'),
    key: readFileSync(keyPath, 'utf-8'),
  };
}

async function resolveClientScAddress(
  wallet: MnemonicWallet,
  network: 'mainnet' | 'testnet',
): Promise<string> {
  const clientScFromEnv = process.env.CLIENT_SC_ADDRESS?.trim();
  if (clientScFromEnv) {
    Address.parse(clientScFromEnv);
    return clientScFromEnv;
  }

  const secret = process.env.SECRET?.trim();
  if (!secret) {
    throw new Error(
      'CLIENT_SC_ADDRESS is not set. Provide CLIENT_SC_ADDRESS or set SECRET + TLS cert/key env vars to resolve it via handshake',
    );
  }

  const tls = resolveTlsMaterial();
  const proxy = await resolveProxy(network, process.env.PROXY_URL);

  const conn = new CocoonConnection({
    host: proxy.host,
    port: proxy.port,
    useTls: true,
    tlsCert: tls.cert,
    tlsKey: tls.key,
    timeout: 120_000,
  });

  try {
    await conn.connect();
    const hs = await performHandshake(conn, wallet.addressString, secret, 0);
    return hs.clientScAddress;
  } catch (err) {
    throw new Error(
      `Could not resolve CLIENT_SC_ADDRESS via handshake: ${err instanceof Error ? err.message : String(err)}. Set CLIENT_SC_ADDRESS explicitly.`,
    );
  } finally {
    conn.destroy();
  }
}

async function readContractBalance(
  address: Address,
  network: 'mainnet' | 'testnet',
  tonV4Endpoint?: string,
): Promise<{ state: string; balance: bigint }> {
  const endpoint = tonV4Endpoint ?? defaultTonV4Endpoint(network);
  const client = new TonClient4({ endpoint });
  const last = await client.getLastBlock();
  const account = await client.getAccount(last.last.seqno, address);
  return {
    state: account.account.state.type,
    balance: parseCoins(account.account.balance.coins),
  };
}

async function main(): Promise<void> {
  const mnemonic = process.env.MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error('MNEMONIC env var is required');
  }

  const network = (process.env.NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
  const tonV4Endpoint = process.env.TON_V4_ENDPOINT?.trim() || undefined;
  const topUpTon = process.env.TOP_UP_TON?.trim() || '5';

  const wallet = new MnemonicWallet(mnemonic, network, { tonV4Endpoint });
  await wallet.init();

  const clientScAddressString = await resolveClientScAddress(wallet, network);
  const clientScAddress = Address.parse(clientScAddressString);

  const sender = createHybridSender(wallet, network, tonV4Endpoint);
  const clientContract = new CocoonClientContract(clientScAddress);

  const before = await readContractBalance(clientScAddress, network, tonV4Endpoint);

  console.log(`Network: ${network}`);
  console.log(`Wallet: ${wallet.addressString}`);
  console.log(`Client SC: ${clientScAddressString}`);
  console.log(`Client SC state: ${before.state}`);
  console.log(`Client SC balance before: ${formatNano(before.balance)}`);
  console.log(`Top-up amount: ${topUpTon} TON`);

  const seqnoBefore = await openWalletV4(wallet, network, tonV4Endpoint).getSeqno();
  await clientContract.topUp(sender, wallet.address, toNano(topUpTon));
  await waitForWalletSeqnoIncrease(wallet, network, tonV4Endpoint, seqnoBefore, 'topUp');

  const after = await readContractBalance(clientScAddress, network, tonV4Endpoint);
  console.log('Top-up transaction sent and confirmed');
  console.log(`Client SC balance after: ${formatNano(after.balance)}`);
}

main().catch((err) => {
  console.error('Top-up failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
