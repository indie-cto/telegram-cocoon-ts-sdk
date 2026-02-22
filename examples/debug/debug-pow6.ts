/**
 * Debug: Try various TLS configurations after PoW.
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import crypto from 'node:crypto';
import {
  parsePowChallenge,
  solvePow,
  buildPowResponse,
  POW_CHALLENGE_SIZE,
} from '../../src/core/protocol/pow.js';

const host = '91.108.4.11';
const port = 8888;

async function connectAndSolvePow(): Promise<net.Socket> {
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });

  const challengeData = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timeout')), 10000);
    rawSocket.on('data', function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= POW_CHALLENGE_SIZE) {
        clearTimeout(timer);
        rawSocket.removeListener('data', onData);
        resolve(buf);
      }
    });
  });

  const challenge = parsePowChallenge(challengeData);
  const nonce = solvePow(challenge);
  rawSocket.write(buildPowResponse(nonce));
  console.log(`PoW solved (diff=${challenge.difficultyBits}, nonce=${nonce})`);
  return rawSocket;
}

async function tryTls(rawSocket: net.Socket, options: tls.ConnectionOptions, label: string): Promise<tls.TLSSocket | null> {
  try {
    const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TLS timeout')), 5000);
      const sock = tls.connect(
        { socket: rawSocket, ...options },
        () => { clearTimeout(timer); resolve(sock); },
      );
      sock.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    console.log(`  ${label}: SUCCESS! Protocol=${tlsSocket.getProtocol()}, Cipher=${tlsSocket.getCipher()?.name}`);
    return tlsSocket;
  } catch (err: any) {
    console.log(`  ${label}: FAILED - ${err.message} (${err.code ?? 'no code'})`);
    rawSocket.destroy();
    return null;
  }
}

async function main() {
  // Test 1: Default TLS with rejectUnauthorized: false
  console.log('\n=== Test 1: Default TLS ===');
  let sock = await connectAndSolvePow();
  await tryTls(sock, { rejectUnauthorized: false }, 'Default');

  // Test 2: With SNI
  console.log('\n=== Test 2: With SNI ===');
  sock = await connectAndSolvePow();
  await tryTls(sock, { rejectUnauthorized: false, servername: host }, 'SNI=host');

  // Test 3: With empty SNI (no SNI extension)
  console.log('\n=== Test 3: No SNI ===');
  sock = await connectAndSolvePow();
  await tryTls(sock, { rejectUnauthorized: false, servername: '' }, 'No SNI');

  // Test 4: TLS 1.2 only
  console.log('\n=== Test 4: TLS 1.2 only ===');
  sock = await connectAndSolvePow();
  await tryTls(sock, { rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }, 'TLS1.2');

  // Test 5: TLS 1.3 only
  console.log('\n=== Test 5: TLS 1.3 only ===');
  sock = await connectAndSolvePow();
  await tryTls(sock, { rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, 'TLS1.3');

  // Test 6: Wide cipher suite
  console.log('\n=== Test 6: All ciphers ===');
  sock = await connectAndSolvePow();
  await tryTls(sock, {
    rejectUnauthorized: false,
    ciphers: 'ALL:!eNULL',
    secureOptions: crypto.constants.SSL_OP_ALL,
  }, 'All ciphers');

  // Test 7: Check using openssl s_client (if available)
  console.log('\n=== Test 7: Checking with openssl (separate process) ===');
  const { execSync } = await import('node:child_process');
  try {
    // First solve PoW, write to a temp file, then pipe to openssl
    // Actually, openssl s_client can't do PoW. Let me just test raw TLS to the port.
    const result = execSync(
      `echo "" | timeout 5 openssl s_client -connect ${host}:${port} -no_ssl3 2>&1 | head -20`,
      { timeout: 10000 },
    );
    console.log(result.toString());
  } catch (e: any) {
    console.log('  openssl result:', e.stdout?.toString().substring(0, 200));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
