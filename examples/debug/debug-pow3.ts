/**
 * Debug: PoW then plain TCP framing (no TLS).
 */
import * as net from 'node:net';
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

async function main() {
  console.log(`Connecting to ${host}:${port}...`);
  const sock = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => {
      console.log('TCP connected');
      resolve(s);
    });
    s.setTimeout(30000);
    s.once('error', reject);
  });

  // Receive and solve PoW
  const challengeData = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timeout')), 30000);
    sock.on('data', function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= POW_CHALLENGE_SIZE) {
        clearTimeout(timer);
        sock.removeListener('data', onData);
        resolve(buf);
      }
    });
  });

  const challenge = parsePowChallenge(challengeData);
  console.log(`PoW: difficulty=${challenge.difficultyBits}, salt=${challenge.salt.toString('hex')}`);

  const nonce = solvePow(challenge);
  console.log(`Solved: nonce=${nonce}`);

  const response = buildPowResponse(nonce);
  await new Promise<void>((resolve, reject) => {
    sock.write(response, (err) => err ? reject(err) : resolve());
  });
  console.log('PoW response sent');

  // Small delay then send tcp.connect
  await new Promise(r => setTimeout(r, 100));

  const tcpId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4);
  payload.copy(frame, 8);

  console.log(`Sending tcp.connect (id=${tcpId})`);
  console.log(`Frame: ${frame.toString('hex')}`);
  sock.write(frame);

  // Wait for any response
  const resp = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      sock.removeListener('data', onData);
      if (buf.length > 0) resolve(buf);
      else reject(new Error('Timeout - no response'));
    }, 10000);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      console.log(`  chunk ${chunk.length} bytes: ${chunk.toString('hex')}`);

      // Check if it's a valid frame
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
  });

  console.log(`\nFull response (${resp.length} bytes): ${resp.toString('hex')}`);
  const size = resp.readUInt32LE(0);
  const seqno = resp.readInt32LE(4);
  console.log(`Frame: size=${size}, seqno=${seqno}`);

  if (size <= 1 << 24 && resp.length >= 8 + size) {
    const p = resp.subarray(8, 8 + size);
    try {
      const obj = deserializeTLObject(p);
      console.log('\nDeserialized:', JSON.stringify(obj, (_, v) =>
        typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Buffer ? v.toString('hex') : v,
      2));
      console.log('\n=== SUCCESS! Plain TCP after PoW works! ===');
    } catch (e: any) {
      console.log('Deserialize error:', e.message);
      console.log('Raw payload:', p.toString('hex'));
    }
  }

  sock.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
