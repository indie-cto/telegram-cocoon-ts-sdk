/**
 * Register wallet with Cocoon network.
 *
 * This script:
 * 1. Connects to a Cocoon proxy to get the client smart contract address
 * 2. Sends a register transaction on TON blockchain
 * 3. Sets the secret hash for short authentication
 * 4. Tops up the client contract balance
 *
 * Usage:
 *   npx tsx --env-file=.env examples/register.ts
 *
 * Optional env vars:
 *   NETWORK=mainnet|testnet (default: mainnet)
 *   PROXY_URL=host:port (skip discovery, connect directly)
 *   TOP_UP_AMOUNT=20 (TON to stake, default: 16)
 *   SECRET=mysecret (default: auto-generated, printed to stdout)
 */

import { Address, toNano } from '@ton/ton';
import { MnemonicWallet } from '../src/ton/wallet.js';
import { ProxyDiscovery } from '../src/ton/discovery.js';
import { CocoonConnection } from '../src/core/protocol/connection.js';
import { performHandshake } from '../src/core/protocol/handshake.js';
import { CocoonClientContract } from '../src/ton/contracts/client-contract.js';
import crypto from 'node:crypto';

async function main() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error('Error: MNEMONIC env var required (24 words)');
    process.exit(1);
  }

  const network = (process.env.NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
  const topUpAmount = toNano(process.env.TOP_UP_AMOUNT ?? '16');
  const secret = process.env.SECRET || crypto.randomBytes(32).toString('hex');

  console.log(`Network: ${network}`);
  console.log(`Secret: ${secret}`);
  console.log('(Save this secret! You need it for inference)\n');

  // 1. Initialize wallet
  const wallet = new MnemonicWallet(mnemonic, network);
  await wallet.init();
  console.log(`Wallet address: ${wallet.addressString}`);

  // 2. Find proxy
  let host: string;
  let port: number;

  if (process.env.PROXY_URL) {
    const lastColon = process.env.PROXY_URL.lastIndexOf(':');
    host = process.env.PROXY_URL.substring(0, lastColon);
    port = parseInt(process.env.PROXY_URL.substring(lastColon + 1), 10);
  } else {
    console.log('Discovering proxies...');
    const discovery = new ProxyDiscovery({ network });
    const proxy = await discovery.getRandomProxy();
    console.log(`Found proxy: ${proxy.address}`);

    // Parse "host:workerPort host:clientPort" format
    const entries = proxy.address.trim().split(/\s+/);
    const clientEntry = entries.length > 1 ? entries[1]! : entries[0]!;
    const lastColon = clientEntry.lastIndexOf(':');
    host = clientEntry.substring(0, lastColon);
    port = parseInt(clientEntry.substring(lastColon + 1), 10);
  }

  console.log(`Connecting to proxy ${host}:${port}...`);

  // 3. Connect and get client SC address
  const conn = new CocoonConnection({ host, port, useTls: false });
  await conn.connect();
  console.log('TCP connected');

  let handshakeResult;
  try {
    handshakeResult = await performHandshake(conn, wallet.addressString, secret, 0);
    console.log(`Client SC address: ${handshakeResult.clientScAddress}`);
    console.log(`Tokens committed: ${handshakeResult.tokensCommittedToDb}`);
    console.log(`Max tokens: ${handshakeResult.maxTokens}`);
    console.log('\nAlready registered and authenticated! No on-chain tx needed.');
    conn.destroy();
    return;
  } catch (err: any) {
    // Expected: auth will fail if not registered yet
    console.log(`Handshake result: ${err.message}`);
    console.log('Need to register on-chain...\n');
  }
  conn.destroy();

  // 4. Connect again just to get the clientScAddress (without auth)
  const conn2 = new CocoonConnection({ host, port, useTls: false });
  await conn2.connect();

  // Do partial handshake: tcp.connect → tcp.connected → connectToProxy → connectedToProxy
  const { serializeTLObject } = await import('../src/core/tl/serializer.js');
  const { deserializeTLObject } = await import('../src/core/tl/deserializer.js');

  // tcp.connect
  const tcpId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  conn2.send(serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any));

  const tcpFrame = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 30000);
    conn2.once('frame', (data: Buffer) => { clearTimeout(timer); resolve(data); });
  });

  const tcpResp = deserializeTLObject(tcpFrame);
  if (tcpResp['_type'] !== 'tcp.connected') {
    throw new Error(`Expected tcp.connected, got ${tcpResp['_type']}`);
  }

  // connectToProxy
  const queryId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  const connectReq = {
    _type: 'client.connectToProxy',
    params: {
      _type: 'client.params',
      flags: 3,
      clientOwnerAddress: wallet.addressString,
      isTest: false,
      minProtoVersion: 0,
      maxProtoVersion: 1,
    },
    minConfigVersion: 0,
  };
  const queryData = serializeTLObject({
    _type: 'tcp.query',
    id: queryId,
    data: serializeTLObject(connectReq as any),
  } as any);
  conn2.send(queryData);

  const answerFrame = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 30000);
    const onFrame = (data: Buffer) => {
      const obj = deserializeTLObject(data);
      if (obj['_type'] === 'tcp.queryAnswer' && (obj['id'] as bigint) === queryId) {
        clearTimeout(timer);
        resolve(obj['data'] as Buffer);
      } else {
        conn2.once('frame', onFrame);
      }
    };
    conn2.once('frame', onFrame);
  });

  const connected = deserializeTLObject(answerFrame);
  const clientScAddress = connected['clientScAddress'] as string;
  const auth = connected['auth'] as Record<string, unknown>;
  const nonce = auth['nonce'] as bigint;

  console.log(`Client SC address: ${clientScAddress}`);
  console.log(`Auth nonce: ${nonce}`);
  conn2.destroy();

  // 5. Send on-chain transactions
  const sender = await wallet.createSender();
  const clientContract = new CocoonClientContract(Address.parse(clientScAddress));
  const secretHash = wallet.secretHash(secret);

  console.log('\nSending register transaction...');
  await clientContract.register(sender, wallet.address, nonce, toNano('1'));
  console.log('Register tx sent. Waiting 15s for confirmation...');
  await new Promise((r) => setTimeout(r, 15000));

  console.log('Sending changeSecretHash transaction...');
  await clientContract.changeSecretHash(sender, wallet.address, secretHash);
  console.log('ChangeSecretHash tx sent. Waiting 15s...');
  await new Promise((r) => setTimeout(r, 15000));

  console.log(`Sending topUp transaction (${topUpAmount} nanoton)...`);
  await clientContract.topUp(sender, wallet.address, topUpAmount);
  console.log('TopUp tx sent.\n');

  console.log('=== Registration complete ===');
  console.log(`Wallet: ${wallet.addressString}`);
  console.log(`Client SC: ${clientScAddress}`);
  console.log(`Secret: ${secret}`);
  console.log('\nYou can now run inference with:');
  console.log(`  MNEMONIC="..." SECRET="${secret}" npx tsx examples/inference.ts`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
