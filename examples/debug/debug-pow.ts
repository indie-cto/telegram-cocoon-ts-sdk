/**
 * Debug: Test PoW + TLS connection to Cocoon proxy.
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import {
  parsePowChallenge,
  solvePow,
  buildPowResponse,
  POW_CHALLENGE_SIZE,
} from '../../src/core/protocol/pow.js';
import { serializeTLObject } from '../../src/core/tl/serializer.js';
import { deserializeTLObject } from '../../src/core/tl/deserializer.js';
import crypto from 'node:crypto';

const host = '91.108.4.11';
const port = 8888;

async function main() {
  // Step 1: Raw TCP connect
  console.log(`Connecting to ${host}:${port}...`);
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.connect({ host, port }, () => {
      console.log('TCP connected');
      resolve(sock);
    });
    sock.setTimeout(30000);
    sock.once('error', reject);
  });

  // Step 2: Receive PoW challenge
  console.log('Waiting for PoW challenge...');
  const challengeData = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timeout waiting for PoW')), 30000);
    rawSocket.on('data', function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= POW_CHALLENGE_SIZE) {
        clearTimeout(timer);
        rawSocket.removeListener('data', onData);
        resolve(buf);
      }
    });
  });

  console.log(`Received ${challengeData.length} bytes: ${challengeData.toString('hex')}`);

  const challenge = parsePowChallenge(challengeData);
  console.log(`PoW challenge: difficulty=${challenge.difficultyBits}, salt=${challenge.salt.toString('hex')}`);

  // Step 3: Solve PoW
  console.log('Solving PoW...');
  const startTime = Date.now();
  const nonce = solvePow(challenge);
  const elapsed = Date.now() - startTime;
  console.log(`PoW solved in ${elapsed}ms, nonce=${nonce}`);

  // Step 4: Send PoW response
  const response = buildPowResponse(nonce);
  console.log(`Sending PoW response: ${response.toString('hex')}`);
  rawSocket.write(response);

  // Step 5: Upgrade to TLS
  console.log('Upgrading to TLS...');
  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const sock = tls.connect(
      { socket: rawSocket, rejectUnauthorized: false },
      () => {
        console.log(`TLS connected (protocol: ${sock.getProtocol()}, cipher: ${sock.getCipher()?.name})`);
        resolve(sock);
      },
    );
    sock.once('error', reject);
  });

  // Step 6: Send tcp.connect
  const tcpId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  console.log(`\nSending tcp.connect (id=${tcpId})...`);

  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4); // seqno = 0
  payload.copy(frame, 8);

  console.log(`Frame (${frame.length} bytes): ${frame.toString('hex')}`);
  tlsSocket.write(frame);

  // Step 7: Wait for tcp.connected response
  const responseData = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timeout waiting for tcp.connected')), 30000);
    tlsSocket.on('data', function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 8) {
        const size = buf.readUInt32LE(0);
        if (buf.length >= 8 + size) {
          clearTimeout(timer);
          tlsSocket.removeListener('data', onData);
          resolve(buf);
        }
      }
    });
  });

  console.log(`\nReceived (${responseData.length} bytes): ${responseData.toString('hex')}`);
  const size = responseData.readUInt32LE(0);
  const seqno = responseData.readInt32LE(4);
  console.log(`Frame: size=${size}, seqno=${seqno}`);

  const respPayload = responseData.subarray(8, 8 + size);
  try {
    const obj = deserializeTLObject(respPayload);
    console.log('Deserialized:', JSON.stringify(obj, (_, v) =>
      typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Buffer ? v.toString('hex') : v,
    2));
  } catch (e: any) {
    console.log('Deserialize error:', e.message);
    console.log('Raw payload:', respPayload.toString('hex'));
  }

  tlsSocket.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
