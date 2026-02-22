/**
 * Debug: Trace exact TLS handshake details to find why server closes.
 * Uses SSLKEYLOGFILE and NODE_DEBUG=tls for visibility.
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  parsePowChallenge,
  solvePow,
  buildPowResponse,
  POW_CHALLENGE_SIZE,
} from '../../src/core/protocol/pow.js';

const host = '91.108.4.11';
const port = 8888;

// Generate Ed25519 client cert
execSync('openssl genpkey -algorithm ed25519 -out /tmp/cocoon-trace-key.pem', { stdio: 'pipe' });
execSync(
  'openssl req -x509 -key /tmp/cocoon-trace-key.pem -out /tmp/cocoon-trace-cert.pem -days 1 ' +
  '-subj "/C=AE/ST=DUBAI/O=TDLib Development/OU=Security/CN=localhost" ' +
  '-addext "basicConstraints=critical,CA:FALSE" ' +
  '-addext "keyUsage=critical,digitalSignature" ' +
  '-addext "extendedKeyUsage=critical,serverAuth,clientAuth"',
  { stdio: 'pipe' },
);

const clientKey = readFileSync('/tmp/cocoon-trace-key.pem');
const clientCert = readFileSync('/tmp/cocoon-trace-cert.pem');

// Verify our cert looks correct
const certInfo = execSync('openssl x509 -in /tmp/cocoon-trace-cert.pem -text -noout 2>&1').toString();
console.log('=== Client Certificate ===');
for (const line of certInfo.split('\n')) {
  if (line.match(/Issuer:|Subject:|Signature Algorithm|Public Key|Key Usage|Basic Constraints|critical/i)) {
    console.log(line.trim());
  }
}
console.log();

async function main() {
  const t0 = Date.now();

  // TCP
  console.log(`[${Date.now()-t0}ms] Connecting to ${host}:${port}...`);
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });
  console.log(`[${Date.now()-t0}ms] TCP connected`);

  // PoW
  const challengeData = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timeout')), 15000);
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
  console.log(`[${Date.now()-t0}ms] PoW challenge: diff=${challenge.difficultyBits}`);
  const nonce = solvePow(challenge);
  console.log(`[${Date.now()-t0}ms] PoW solved`);

  await new Promise<void>((resolve, reject) => {
    rawSocket.write(buildPowResponse(nonce), (err) => err ? reject(err) : resolve());
  });
  console.log(`[${Date.now()-t0}ms] PoW response sent`);

  // TLS with Ed25519 client cert
  console.log(`[${Date.now()-t0}ms] Starting TLS handshake with Ed25519 client cert...`);

  // Enable TLS keylog for debugging
  const keylogFile = '/tmp/cocoon-tls-keylog.txt';
  writeFileSync(keylogFile, '');

  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TLS timeout')), 15000);
    const sock = tls.connect(
      {
        socket: rawSocket,
        rejectUnauthorized: false,
        key: clientKey,
        cert: clientCert,
        enableTrace: true, // Enable TLS trace output to stderr
      },
      () => {
        clearTimeout(timer);
        resolve(sock);
      },
    );
    sock.on('error', (err) => {
      clearTimeout(timer);
      console.log(`[${Date.now()-t0}ms] TLS error: ${err.message}`);
      reject(err);
    });
    sock.on('keylog', (line) => {
      // TLS session keys for debugging
    });
  });

  console.log(`[${Date.now()-t0}ms] TLS handshake complete`);
  console.log(`  Protocol: ${tlsSocket.getProtocol()}`);
  console.log(`  Cipher: ${tlsSocket.getCipher()?.name}`);
  console.log(`  Authorized: ${tlsSocket.authorized}`);
  console.log(`  Auth error: ${tlsSocket.authorizationError}`);

  // Check peer certificate
  const peerCert = tlsSocket.getPeerCertificate(true);
  console.log(`  Server cert CN: ${peerCert.subject?.CN}`);
  console.log(`  Server cert algo: ${peerCert.asn1Curve || 'N/A'}`);

  // Listen for ALL events
  let closeHappened = false;
  rawSocket.on('close', () => console.log(`[${Date.now()-t0}ms] RAW socket close`));
  rawSocket.on('end', () => console.log(`[${Date.now()-t0}ms] RAW socket end`));
  rawSocket.on('error', (e) => console.log(`[${Date.now()-t0}ms] RAW socket error: ${e.message}`));

  tlsSocket.on('close', () => {
    closeHappened = true;
    console.log(`[${Date.now()-t0}ms] TLS close`);
  });
  tlsSocket.on('end', () => console.log(`[${Date.now()-t0}ms] TLS end`));
  tlsSocket.on('error', (e) => console.log(`[${Date.now()-t0}ms] TLS error event: ${e.message}`));

  // Wait and see what happens
  console.log(`\n[${Date.now()-t0}ms] Waiting to observe connection state...`);
  await new Promise(r => setTimeout(r, 5000));

  if (!closeHappened) {
    console.log(`[${Date.now()-t0}ms] Connection still alive after 5s!`);
  }

  tlsSocket.destroy();
  rawSocket.destroy();
  process.exit(0);
}

main().catch(console.error);
