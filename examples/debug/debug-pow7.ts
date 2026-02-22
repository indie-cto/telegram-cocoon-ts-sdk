/**
 * Debug: After PoW + TLS, listen for server data and try different frame formats.
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

async function powAndTls(): Promise<tls.TLSSocket> {
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

  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TLS timeout')), 10000);
    const sock = tls.connect(
      { socket: rawSocket, rejectUnauthorized: false },
      () => { clearTimeout(timer); resolve(sock); },
    );
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  console.log(`TLS: ${tlsSocket.getProtocol()}, ${tlsSocket.getCipher()?.name}`);
  return tlsSocket;
}

async function test1_listenPassively() {
  console.log('\n=== Test 1: Listen passively after TLS ===');
  const sock = await powAndTls();

  const data = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      sock.removeListener('data', onData);
      resolve(null);
    }, 5000);
    const onData = (chunk: Buffer) => {
      clearTimeout(timer);
      sock.removeListener('data', onData);
      resolve(chunk);
    };
    sock.on('data', onData);
  });

  if (data) {
    console.log(`Server sent ${data.length} bytes: ${data.toString('hex')}`);
    // Try to interpret as TL frame with seqno
    if (data.length >= 8) {
      const size = data.readUInt32LE(0);
      const seqno = data.readInt32LE(4);
      console.log(`  As frame: size=${size}, seqno=${seqno}`);
    }
    // Try as simple frame (size only, no seqno)
    if (data.length >= 4) {
      const size = data.readUInt32LE(0);
      console.log(`  As simple frame: size=${size}`);
    }
    // Try as raw TL object
    try {
      const obj = deserializeTLObject(data);
      console.log(`  As TL: ${JSON.stringify(obj)}`);
    } catch {}
  } else {
    console.log('Server sent nothing in 5s');
  }

  sock.on('close', () => console.log('  [closed]'));
  sock.on('error', (e) => console.log('  [error]', e.message));

  // Wait a bit more to see if close/error happens
  await new Promise(r => setTimeout(r, 2000));
  sock.destroy();
}

async function test2_sendFrameWithSeqno() {
  console.log('\n=== Test 2: Send [size][seqno=0][tcp.connect] ===');
  const sock = await powAndTls();

  const tcpId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4);
  payload.copy(frame, 8);

  sock.write(frame);
  console.log(`Sent ${frame.length} bytes: ${frame.toString('hex')}`);

  const data = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    sock.on('data', (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk);
    });
    sock.on('close', () => { clearTimeout(timer); console.log('  [closed]'); resolve(null); });
  });

  if (data) {
    console.log(`Response ${data.length} bytes: ${data.toString('hex')}`);
  } else {
    console.log('No response in 5s');
  }
  sock.destroy();
}

async function test3_sendSimpleFrame() {
  console.log('\n=== Test 3: Send [size][tcp.connect] (no seqno) ===');
  const sock = await powAndTls();

  const tcpId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  // Simple frame: [4B size][TL payload]
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);

  sock.write(frame);
  console.log(`Sent ${frame.length} bytes: ${frame.toString('hex')}`);

  const data = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    sock.on('data', (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk);
    });
    sock.on('close', () => { clearTimeout(timer); console.log('  [closed]'); resolve(null); });
  });

  if (data) {
    console.log(`Response ${data.length} bytes: ${data.toString('hex')}`);
  } else {
    console.log('No response in 5s');
  }
  sock.destroy();
}

async function test4_sendRawTl() {
  console.log('\n=== Test 4: Send raw TL tcp.connect (no framing) ===');
  const sock = await powAndTls();

  const tcpId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);

  sock.write(payload);
  console.log(`Sent ${payload.length} bytes: ${payload.toString('hex')}`);

  const data = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    sock.on('data', (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk);
    });
    sock.on('close', () => { clearTimeout(timer); console.log('  [closed]'); resolve(null); });
  });

  if (data) {
    console.log(`Response ${data.length} bytes: ${data.toString('hex')}`);
  } else {
    console.log('No response in 5s');
  }
  sock.destroy();
}

async function main() {
  await test1_listenPassively();
  await test2_sendFrameWithSeqno();
  await test3_sendSimpleFrame();
  await test4_sendRawTl();
}

main().catch(console.error);
