/**
 * Debug: Send tcp.connect immediately after TLS (no waiting).
 * Also try different TLS options: servername, minVersion, etc.
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
import { serializeTLObject } from '../../src/core/tl/serializer.js';
import { deserializeTLObject } from '../../src/core/tl/deserializer.js';

const host = '91.108.4.11';
const port = 8888;

async function connectPowTls(tlsOpts: tls.ConnectionOptions = {}): Promise<{ tls: tls.TLSSocket; raw: net.Socket }> {
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });

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
  const nonce = solvePow(challenge);

  await new Promise<void>((resolve, reject) => {
    rawSocket.write(buildPowResponse(nonce), (err) => err ? reject(err) : resolve());
  });

  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TLS timeout')), 15000);
    const sock = tls.connect(
      { socket: rawSocket, rejectUnauthorized: false, ...tlsOpts },
      () => { clearTimeout(timer); resolve(sock); },
    );
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  return { tls: tlsSocket, raw: rawSocket };
}

async function testImmediate(label: string, tlsOpts: tls.ConnectionOptions = {}): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const t0 = Date.now();

  try {
    const conn = await connectPowTls(tlsOpts);
    const elapsed = Date.now() - t0;
    console.log(`Connected in ${elapsed}ms: ${conn.tls.getProtocol()}, ${conn.tls.getCipher()?.name}`);

    // Track close event timing
    let closeTime = 0;
    conn.tls.on('close', () => {
      closeTime = Date.now() - t0;
      console.log(`  [close at ${closeTime}ms]`);
    });
    conn.tls.on('error', (err) => {
      console.log(`  [error at ${Date.now() - t0}ms: ${err.message}]`);
    });

    // IMMEDIATELY send tcp.connect (no wait)
    const connId = crypto.randomBytes(8).readBigInt64LE();
    const payload = serializeTLObject({ _type: 'tcp.connect', id: connId } as any);
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    frame.writeInt32LE(0, 4);
    payload.copy(frame, 8);

    conn.tls.write(frame, (err) => {
      if (err) {
        console.log(`  Write error at ${Date.now() - t0}ms: ${err.message}`);
      } else {
        console.log(`  Frame sent at ${Date.now() - t0}ms`);
      }
    });

    // Wait for response
    const response = await new Promise<Buffer | null>((resolve) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        conn.tls.removeListener('data', onData);
        resolve(buf.length > 0 ? buf : null);
      }, 10000);

      function onData(chunk: Buffer) {
        buf = Buffer.concat([buf, chunk]);
        console.log(`  Received ${chunk.length} bytes at ${Date.now() - t0}ms`);
        if (buf.length >= 8) {
          const size = buf.readUInt32LE(0);
          if (size <= 1 << 24 && buf.length >= 8 + size) {
            clearTimeout(timer);
            conn.tls.removeListener('data', onData);
            resolve(buf);
          }
        }
      }

      conn.tls.on('data', onData);
      conn.tls.on('close', () => {
        clearTimeout(timer);
        resolve(buf.length > 0 ? buf : null);
      });
    });

    if (response && response.length > 0) {
      console.log(`  Response: ${response.toString('hex').substring(0, 100)}`);
      if (response.length >= 8) {
        const size = response.readUInt32LE(0);
        const seqno = response.readInt32LE(4);
        console.log(`  Frame: size=${size}, seqno=${seqno}`);
        if (size <= 1 << 24 && response.length >= 8 + size) {
          try {
            const obj = deserializeTLObject(response.subarray(8, 8 + size));
            console.log(`  TL: ${JSON.stringify(obj, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v instanceof Buffer ? v.toString('hex') : v)}`);
            console.log(`  *** SUCCESS ***`);
          } catch (e: any) {
            console.log(`  Deserialize error: ${e.message}`);
          }
        }
      }
    } else {
      console.log(`  No response (connection closed at ${closeTime || '?'}ms)`);
    }

    conn.tls.destroy();
    conn.raw.destroy();
  } catch (err: any) {
    console.log(`  Failed: ${err.message}`);
  }
}

async function main() {
  // Test 1: Default (no extra options)
  await testImmediate('Test 1: Default TLS, immediate send');

  // Test 2: With servername=localhost (matching server cert CN)
  await testImmediate('Test 2: servername=localhost', { servername: 'localhost' });

  // Test 3: TLS 1.2 only
  await testImmediate('Test 3: TLS 1.2 max', { maxVersion: 'TLSv1.2' as any });

  // Test 4: Enable all ciphers
  await testImmediate('Test 4: All ciphers', {
    ciphers: 'ALL:@SECLEVEL=0',
    secureOptions: 0,
  });

  // Test 5: With ecdhCurve
  await testImmediate('Test 5: X25519 ECDH', {
    ecdhCurve: 'X25519:P-256:P-384',
  });

  process.exit(0);
}

main().catch(console.error);
