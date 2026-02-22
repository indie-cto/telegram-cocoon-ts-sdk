/**
 * Debug: PoW + TLS with various tweaks.
 * - ALPN protocols
 * - Longer wait before sending
 * - Peer cert inspection
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

async function main() {
  // Test: Inspect TLS certificate for attestation data
  console.log('=== Inspecting server TLS cert ===');
  const sock1 = await connectPowTls();
  const cert = sock1.getPeerCertificate(true);
  console.log('Subject:', cert.subject);
  console.log('Issuer:', cert.issuer);
  console.log('Valid from:', cert.valid_from);
  console.log('Valid to:', cert.valid_to);
  console.log('Fingerprint:', cert.fingerprint?.substring(0, 40));
  console.log('Serial:', cert.serialNumber);
  console.log('Protocol:', sock1.getProtocol());
  console.log('Cipher:', sock1.getCipher());
  console.log('ALPN:', sock1.alpnProtocol);

  // Check for x509 extensions (where attestation data would be)
  const raw = cert.raw;
  if (raw) {
    console.log('Raw cert size:', raw.length, 'bytes');
    // Look for known TDX attestation OID or extension markers
    const certHex = raw.toString('hex');
    // TDX attestation usually in custom x509 extension
    console.log('Cert hex (first 200 chars):', certHex.substring(0, 200));
  }

  // Check if server requested client cert
  console.log('Authorized:', sock1.authorized);
  console.log('Auth error:', sock1.authorizationError);

  // Now try sending tcp.connect with wait
  console.log('\n=== Sending tcp.connect after 2s wait ===');
  await new Promise(r => setTimeout(r, 2000));

  const tcpId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4);
  payload.copy(frame, 8);

  let gotClose = false;
  let gotData = false;
  sock1.on('close', () => { gotClose = true; console.log('  [close event]'); });
  sock1.on('error', (e) => console.log('  [error]', e.message));
  sock1.on('data', (chunk: Buffer) => {
    gotData = true;
    console.log(`  [data] ${chunk.length} bytes: ${chunk.toString('hex')}`);
  });

  sock1.write(frame);
  console.log(`Sent: ${frame.toString('hex')}`);

  // Wait for response or close
  await new Promise(r => setTimeout(r, 8000));
  if (!gotData && !gotClose) {
    console.log('No response, no close in 8s');
  }
  sock1.destroy();

  // Test: Try with ALPN
  console.log('\n=== Try with ALPN h2 ===');
  try {
    const sock2 = await connectPowTls({ ALPNProtocols: ['h2', 'http/1.1'] });
    console.log('ALPN negotiated:', sock2.alpnProtocol);

    const tcpId2 = crypto.randomBytes(8).readBigInt64LE();
    const p2 = serializeTLObject({ _type: 'tcp.connect', id: tcpId2 } as any);
    const f2 = Buffer.alloc(8 + p2.length);
    f2.writeUInt32LE(p2.length, 0);
    f2.writeInt32LE(0, 4);
    p2.copy(f2, 8);
    sock2.write(f2);

    const resp = await new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      sock2.on('data', (chunk: Buffer) => { clearTimeout(timer); resolve(chunk); });
      sock2.on('close', () => { clearTimeout(timer); resolve(null); });
    });
    console.log('Response:', resp ? resp.toString('hex') : 'none');
    sock2.destroy();
  } catch (e: any) {
    console.log('ALPN test failed:', e.message);
  }

  // Test: Send empty frame first (size=0), then tcp.connect
  console.log('\n=== Try empty frame then tcp.connect ===');
  try {
    const sock3 = await connectPowTls();

    // Send empty attestation-like frame: [4B size=0]
    const emptyFrame = Buffer.alloc(4);
    emptyFrame.writeUInt32LE(0, 0);
    sock3.write(emptyFrame);

    await new Promise(r => setTimeout(r, 500));

    const tcpId3 = crypto.randomBytes(8).readBigInt64LE();
    const p3 = serializeTLObject({ _type: 'tcp.connect', id: tcpId3 } as any);
    const f3 = Buffer.alloc(8 + p3.length);
    f3.writeUInt32LE(p3.length, 0);
    f3.writeInt32LE(0, 4);
    p3.copy(f3, 8);
    sock3.write(f3);

    const resp = await new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      sock3.on('data', (chunk: Buffer) => { clearTimeout(timer); resolve(chunk); });
      sock3.on('close', () => { clearTimeout(timer); console.log('  [closed]'); resolve(null); });
    });
    console.log('Response:', resp ? resp.toString('hex') : 'none');
    sock3.destroy();
  } catch (e: any) {
    console.log('Empty frame test failed:', e.message);
  }
}

main().catch(console.error);
