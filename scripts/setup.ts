/**
 * One-time onboarding helper:
 * - ensures mTLS client cert/key
 * - performs long auth registration if needed
 * - sets secret hash on client contract
 * - optionally tops up client contract
 * - verifies short auth with generated SECRET
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/setup.ts
 *
 * Env:
 *   MNEMONIC=...                     (required)
 *   NETWORK=mainnet|testnet          (default: mainnet)
 *   PROXY_URL=host:port              (optional, otherwise discovery)
 *   TON_ENDPOINT=https://...         (optional)
 *   TON_V4_ENDPOINT=https://...      (optional, default: tonhub v4 endpoint)
 *   SECRET=...                       (optional, auto-generated if empty)
 *   COCOON_TLS_CERT_PATH=/path.pem   (optional, auto-generated if empty)
 *   COCOON_TLS_KEY_PATH=/path.pem    (optional, auto-generated if empty)
 *   REGISTER_TON=1                   (default: 1)
 *   CHANGE_SECRET_TON=0.7            (default: 0.7)
 *   TOP_UP_TON=0                     (default: 0, set e.g. 16 for staking)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { Address, toNano, TonClient4, WalletContractV4 } from '@ton/ton';
import { MnemonicWallet } from '../src/ton/wallet.js';
import { ProxyDiscovery } from '../src/ton/discovery.js';
import { buildClientParamsCell } from '../src/ton/contracts/root.js';
import { CocoonConnection } from '../src/core/protocol/connection.js';
import {
  performHandshake,
  type LongAuthContext,
} from '../src/core/protocol/handshake.js';
import { CocoonClientContract } from '../src/ton/contracts/client-contract.js';
import { contractAddress, type Sender } from '@ton/core';

interface TlsMaterial {
  cert: string;
  key: string;
  certPath: string;
  keyPath: string;
}

function defaultTonV4Endpoint(network: 'mainnet' | 'testnet'): string {
  return network === 'mainnet'
    ? 'https://mainnet-v4.tonhubapi.com'
    : 'https://testnet-v4.tonhubapi.com';
}

function createHybridSender(
  wallet: MnemonicWallet,
  network: 'mainnet' | 'testnet',
  tonV4Endpoint?: string,
): Sender {
  const key = wallet.secretKey;
  const walletContract = WalletContractV4.create({ workchain: 0, publicKey: wallet.publicKey });
  // TonClient4 avoids strict JSON-RPC rate limits on public toncenter endpoints.
  const v4Endpoint = tonV4Endpoint ?? defaultTonV4Endpoint(network);
  const tonClient4 = new TonClient4({ endpoint: v4Endpoint });
  return tonClient4.open(walletContract).sender(key);
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
    if (currentSeqno > previousSeqno) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`${label}: wallet seqno did not increase (tx not confirmed in time)`);
}

async function isContractActive(
  address: Address,
  network: 'mainnet' | 'testnet',
  tonV4Endpoint?: string,
): Promise<boolean> {
  const endpoint = tonV4Endpoint ?? defaultTonV4Endpoint(network);
  const client = new TonClient4({ endpoint });
  const last = await client.getLastBlock();
  const state = await client.getAccount(last.last.seqno, address);
  return state.account.state.type === 'active';
}

function is429Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.includes('rate limit');
}

async function runWithRateLimitRetries<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 12,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!is429Error(err) || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = attempt * 4000;
      console.log(`${label}: RPC 429, retry in ${Math.round(delayMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function isShortAuthNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('provided SECRET does not match on-chain secret hash') ||
    message.includes('Proxy requires long auth')
  );
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

function ensureTlsMaterial(
  certPathFromEnv?: string,
  keyPathFromEnv?: string,
): TlsMaterial {
  if (certPathFromEnv && keyPathFromEnv) {
    if (!existsSync(certPathFromEnv)) {
      throw new Error(`COCOON_TLS_CERT_PATH does not exist: ${certPathFromEnv}`);
    }
    if (!existsSync(keyPathFromEnv)) {
      throw new Error(`COCOON_TLS_KEY_PATH does not exist: ${keyPathFromEnv}`);
    }
    return {
      certPath: certPathFromEnv,
      keyPath: keyPathFromEnv,
      cert: readFileSync(certPathFromEnv, 'utf-8'),
      key: readFileSync(keyPathFromEnv, 'utf-8'),
    };
  }

  if (certPathFromEnv || keyPathFromEnv) {
    throw new Error(
      'Set both COCOON_TLS_CERT_PATH and COCOON_TLS_KEY_PATH, or neither',
    );
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const certPath = `/tmp/cocoon-client-${suffix}.pem`;
  const keyPath = `/tmp/cocoon-client-${suffix}.key.pem`;

  execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', keyPath], {
    stdio: 'pipe',
  });
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-key',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/C=AE/ST=DUBAI/O=TDLib Development/OU=Security/CN=localhost',
    ],
    { stdio: 'pipe' },
  );

  return {
    certPath,
    keyPath,
    cert: readFileSync(certPath, 'utf-8'),
    key: readFileSync(keyPath, 'utf-8'),
  };
}

async function main(): Promise<void> {
  const mnemonic = process.env.MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error('MNEMONIC env var is required');
  }

  const network = (process.env.NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
  const tonEndpoint = process.env.TON_ENDPOINT;
  const tonV4Endpoint = process.env.TON_V4_ENDPOINT;
  const registerTon = process.env.REGISTER_TON ?? '1';
  const changeSecretTon = process.env.CHANGE_SECRET_TON ?? '0.7';
  const topUpTon = process.env.TOP_UP_TON ?? '0';

  const secret = process.env.SECRET?.trim() || crypto.randomBytes(32).toString('hex');
  const tls = ensureTlsMaterial(
    process.env.COCOON_TLS_CERT_PATH,
    process.env.COCOON_TLS_KEY_PATH,
  );
  const proxy = await resolveProxy(network, process.env.PROXY_URL);

  const wallet = new MnemonicWallet(mnemonic, network, { tonEndpoint, tonV4Endpoint });
  await wallet.init();
  const discovery = new ProxyDiscovery({ network, tonApiEndpoint: tonEndpoint });
  const rootParams = await discovery.getRootParams();

  console.log(`Network: ${network}`);
  console.log(`Wallet: ${wallet.addressString}`);
  console.log(`Proxy: ${proxy.display}`);
  console.log(`TLS cert: ${tls.certPath}`);
  console.log(`TLS key: ${tls.keyPath}`);

  const sender = createHybridSender(wallet, network, tonV4Endpoint);
  let clientScAddressFromAuth: string | null = null;
  let registerSubmitted = false;

  const onLongAuthRequired = async (ctx: LongAuthContext): Promise<void> => {
    clientScAddressFromAuth = ctx.clientScAddress;
    if (registerSubmitted) return;
    registerSubmitted = true;
    console.log('Long auth required, sending register transaction...');
    const clientContract = new CocoonClientContract(Address.parse(ctx.clientScAddress));
    const clientScAddress = Address.parse(ctx.clientScAddress);

    let init;
    const contractAlreadyActive = await isContractActive(clientScAddress, network, tonV4Endpoint);
    if (!contractAlreadyActive) {
      const clientCode = rootParams.codes.clientScCode;
      if (!clientCode) {
        throw new Error(
          'Root contract does not contain client_sc_code; cannot deploy client contract',
        );
      }
      const clientParamsCell = buildClientParamsCell(rootParams.params);
      const dataCell = CocoonClientContract.createDeployDataCell(
        wallet.address,
        Address.parse(ctx.proxyParams.proxyScAddress),
        ctx.proxyParams.proxyPublicKey,
        rootParams.params.minClientStake,
        clientParamsCell,
      );
      init = CocoonClientContract.createStateInit(clientCode, dataCell);

      const expectedClientScAddress = contractAddress(0, init);
      if (!expectedClientScAddress.equals(clientScAddress)) {
        throw new Error(
          `Computed client_sc mismatch: expected ${ctx.clientScAddress}, got ${expectedClientScAddress.toString({ bounceable: true, testOnly: network === 'testnet' })}`,
        );
      }
    }

    const registerSeqnoBefore = await openWalletV4(wallet, network, tonV4Endpoint).getSeqno();
    await runWithRateLimitRetries('register', () =>
      clientContract.register(
        sender,
        wallet.address,
        ctx.nonce,
        toNano(registerTon),
        init,
      ),
    );
    await waitForWalletSeqnoIncrease(
      wallet,
      network,
      tonV4Endpoint,
      registerSeqnoBefore,
      'register',
    );
    console.log('Register transaction sent');
  };

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
    const hs = await performHandshake(
      conn,
      wallet.addressString,
      secret,
      0,
      onLongAuthRequired,
    );
    clientScAddressFromAuth = hs.clientScAddress;
    console.log(`Handshake OK. client_sc: ${hs.clientScAddress}`);
  } finally {
    conn.destroy();
  }

  if (!clientScAddressFromAuth) {
    throw new Error('Could not determine client_sc_address');
  }

  const clientContract = new CocoonClientContract(Address.parse(clientScAddressFromAuth));
  const secretHash = wallet.secretHash(secret);

  console.log('Sending changeSecretHash transaction...');
  const changeSeqnoBefore = await openWalletV4(wallet, network, tonV4Endpoint).getSeqno();
  await runWithRateLimitRetries('changeSecretHash', () =>
    clientContract.changeSecretHash(
      sender,
      wallet.address,
      secretHash,
      toNano(changeSecretTon),
    ),
  );
  await waitForWalletSeqnoIncrease(
    wallet,
    network,
    tonV4Endpoint,
    changeSeqnoBefore,
    'changeSecretHash',
  );
  console.log('changeSecretHash transaction sent');

  if (Number(topUpTon) > 0) {
    console.log(`Sending top-up transaction (${topUpTon} TON)...`);
    const topUpSeqnoBefore = await openWalletV4(wallet, network, tonV4Endpoint).getSeqno();
    await runWithRateLimitRetries('topUp', () =>
      clientContract.topUp(sender, wallet.address, toNano(topUpTon)),
    );
    await waitForWalletSeqnoIncrease(
      wallet,
      network,
      tonV4Endpoint,
      topUpSeqnoBefore,
      'topUp',
    );
    console.log('Top-up transaction sent');
  }

  // Verify short-auth path with retry to allow on-chain state propagation.
  let verified = false;
  let verifyError: unknown;
  for (let attempt = 1; attempt <= 12; attempt++) {
    const verifyConn = new CocoonConnection({
      host: proxy.host,
      port: proxy.port,
      useTls: true,
      tlsCert: tls.cert,
      tlsKey: tls.key,
      timeout: 120_000,
    });
    try {
      await verifyConn.connect();
      await performHandshake(verifyConn, wallet.addressString, secret, 0);
      verified = true;
      break;
    } catch (err) {
      verifyError = err;
      if (!isShortAuthNotReadyError(err) || attempt === 12) {
        break;
      }
      const waitMs = attempt * 5000;
      console.log(
        `Short auth not ready yet (attempt ${attempt}/12), retry in ${Math.round(waitMs / 1000)}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } finally {
      verifyConn.destroy();
    }
  }
  if (!verified) {
    throw verifyError instanceof Error ? verifyError : new Error(String(verifyError));
  }

  console.log('\n=== Setup Complete ===');
  console.log('Put these into your .env:');
  console.log(`SECRET=${secret}`);
  console.log(`PROXY_URL=${proxy.display}`);
  console.log(`COCOON_TLS_CERT_PATH=${tls.certPath}`);
  console.log(`COCOON_TLS_KEY_PATH=${tls.keyPath}`);
  if (tonEndpoint) {
    console.log(`TON_ENDPOINT=${tonEndpoint}`);
  }
  if (tonV4Endpoint) {
    console.log(`TON_V4_ENDPOINT=${tonV4Endpoint}`);
  }
}

main().catch((err) => {
  console.error('Setup failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
