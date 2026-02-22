/**
 * Debug: Try mTLS with a self-signed client certificate.
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import crypto from 'node:crypto';
import {
  parsePowChallenge,
  solvePow,
  buildPowResponse,
  POW_CHALLENGE_SIZE,
} from '../src/core/protocol/pow.js';
import { serializeTLObject } from '../src/core/tl/serializer.js';
import { deserializeTLObject } from '../src/core/tl/deserializer.js';

const host = '91.108.4.11';
const port = 8888;

async function generateSelfSignedCert(): Promise<{ key: string; cert: string }> {
  const { execSync } = await import('node:child_process');
  // Generate a self-signed cert similar to the server's format
  execSync(
    'openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ' +
    '-keyout /tmp/cocoon-client-key.pem -out /tmp/cocoon-client-cert.pem ' +
    '-days 1 -nodes -subj "/CN=cocoon-client"',
    { stdio: 'pipe' },
  );
  const { readFileSync } = await import('node:fs');
  return {
    key: readFileSync('/tmp/cocoon-client-key.pem', 'utf-8'),
    cert: readFileSync('/tmp/cocoon-client-cert.pem', 'utf-8'),
  };
}

async function connectPowTls(tlsOpts: tls.ConnectionOptions = {}): Promise<tls.TLSSocket> {
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

  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TLS timeout')), 10000);
    const sock = tls.connect(
      { socket: rawSocket, rejectUnauthorized: false, ...tlsOpts },
      () => { clearTimeout(timer); resolve(sock); },
    );
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  return tlsSocket;
}

async function sendTcpConnect(sock: tls.TLSSocket, label: string): Promise<void> {
  const tcpId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4);
  payload.copy(frame, 8);

  console.log(`[${label}] Sending tcp.connect...`);
  sock.write(frame);

  const data = await new Promise<Buffer | null>((resolve) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      sock.removeListener('data', onData);
      resolve(buf.length > 0 ? buf : null);
    }, 5000);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      // Check for complete frame
      if (buf.length >= 8) {
        const size = buf.readUInt32LE(0);
        if (size <= 1 << 24 && buf.length >= 8 + size) {
          clearTimeout(timer);
          sock.removeListener('data', onData);
          resolve(buf);
        }
      }
    };
    sock.on('data', onData);
    sock.on('close', () => {
      clearTimeout(timer);
      console.log(`[${label}] closed`);
      resolve(buf.length > 0 ? buf : null);
    });
  });

  if (data && data.length > 0) {
    console.log(`[${label}] Response (${data.length} bytes): ${data.toString('hex')}`);
    if (data.length >= 8) {
      const size = data.readUInt32LE(0);
      const seqno = data.readInt32LE(4);
      console.log(`[${label}] Frame: size=${size}, seqno=${seqno}`);
      if (size <= 1 << 24 && data.length >= 8 + size) {
        const p = data.subarray(8, 8 + size);
        try {
          const obj = deserializeTLObject(p);
          console.log(`[${label}] TL:`, JSON.stringify(obj, (_, v) =>
            typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Buffer ? v.toString('hex') : v,
          2));
          console.log(`\n=== SUCCESS with ${label}! ===`);
        } catch (e: any) {
          console.log(`[${label}] Deserialize error: ${e.message}`);
        }
      }
    }
  } else {
    console.log(`[${label}] No response`);
  }

  sock.destroy();
}

async function main() {
  // Generate client cert
  console.log('Generating self-signed client cert...');
  const clientCert = await generateSelfSignedCert();
  console.log('Done\n');

  // Test 1: With client cert (mTLS)
  console.log('=== Test 1: With client cert (mTLS) ===');
  const sock1 = await connectPowTls({
    key: clientCert.key,
    cert: clientCert.cert,
  });
  console.log('TLS:', sock1.getProtocol(), sock1.getCipher()?.name);
  await sendTcpConnect(sock1, 'mTLS');

  // Test 2: With Ed25519 client cert (TDLib uses Ed25519)
  console.log('\n=== Test 2: Ed25519 client cert ===');
  const { execSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  try {
    execSync(
      'openssl genpkey -algorithm ed25519 -out /tmp/cocoon-ed-key.pem && ' +
      'openssl req -x509 -key /tmp/cocoon-ed-key.pem -out /tmp/cocoon-ed-cert.pem ' +
      '-days 1 -subj "/C=AE/ST=DUBAI/O=TDLib Development/OU=Security/CN=localhost"',
      { stdio: 'pipe' },
    );
    const edKey = readFileSync('/tmp/cocoon-ed-key.pem', 'utf-8');
    const edCert = readFileSync('/tmp/cocoon-ed-cert.pem', 'utf-8');

    const sock2 = await connectPowTls({ key: edKey, cert: edCert });
    console.log('TLS:', sock2.getProtocol(), sock2.getCipher()?.name);
    await sendTcpConnect(sock2, 'Ed25519');
  } catch (e: any) {
    console.log('Ed25519 test failed:', e.message);
  }

  // Test 3: Without client cert (baseline comparison)
  console.log('\n=== Test 3: Without client cert (baseline) ===');
  const sock3 = await connectPowTls();
  console.log('TLS:', sock3.getProtocol(), sock3.getCipher()?.name);
  await sendTcpConnect(sock3, 'No cert');
}

main().catch(console.error);
