/**
 * Debug: PoW → immediate TLS → tcp.connect
 * No delay between PoW response and TLS handshake.
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

async function main() {
  console.log(`Connecting to ${host}:${port}...`);
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });
  console.log('TCP connected');

  // Receive PoW challenge
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
  console.log(`PoW: difficulty=${challenge.difficultyBits}`);

  const nonce = solvePow(challenge);
  console.log(`Solved: nonce=${nonce}`);

  // Send PoW response
  const powResp = buildPowResponse(nonce);
  rawSocket.write(powResp);
  console.log(`PoW response sent: ${powResp.toString('hex')}`);

  // IMMEDIATELY start TLS (no waiting)
  console.log('Starting TLS immediately...');
  try {
    const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('TLS handshake timeout (5s)'));
      }, 5000);

      const sock = tls.connect(
        {
          socket: rawSocket,
          rejectUnauthorized: false,
          // servername: host,
        },
        () => {
          clearTimeout(timer);
          console.log(`TLS connected! Protocol: ${sock.getProtocol()}, Cipher: ${sock.getCipher()?.name}`);
          resolve(sock);
        },
      );

      sock.on('error', (err) => {
        clearTimeout(timer);
        console.log('TLS error event:', err.message);
        reject(err);
      });
    });

    // Success! Send tcp.connect
    const tcpId = crypto.randomBytes(8).readBigInt64LE();
    const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    frame.writeInt32LE(0, 4);
    payload.copy(frame, 8);

    console.log(`\nSending tcp.connect over TLS (id=${tcpId})`);
    tlsSocket.write(frame);

    const resp = await new Promise<Buffer>((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        if (buf.length > 0) resolve(buf);
        else reject(new Error('Timeout'));
      }, 10000);
      tlsSocket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length >= 8) {
          const size = buf.readUInt32LE(0);
          if (size <= 1 << 24 && buf.length >= 8 + size) {
            clearTimeout(timer);
            resolve(buf);
          }
        }
      });
    });

    const size = resp.readUInt32LE(0);
    const seqno = resp.readInt32LE(4);
    console.log(`Response: size=${size}, seqno=${seqno}`);
    const p = resp.subarray(8, 8 + size);
    const obj = deserializeTLObject(p);
    console.log('Deserialized:', JSON.stringify(obj, (_, v) =>
      typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Buffer ? v.toString('hex') : v,
    2));

    console.log('\n=== SUCCESS! PoW + TLS + tcp.connect works! ===');
    tlsSocket.destroy();
  } catch (err: any) {
    console.log('\nTLS failed:', err.message);
    console.log('Error code:', err.code);

    // Maybe PoW failed and server closed. Try verifying PoW:
    const input = Buffer.alloc(24);
    challenge.salt.copy(input, 0);
    input.writeBigUInt64LE(BigInt(nonce), 16);
    const hash = crypto.createHash('sha256').update(input).digest();
    let zeroBits = 0;
    for (const byte of hash) {
      if (byte === 0) { zeroBits += 8; continue; }
      for (let bit = 7; bit >= 0; bit--) {
        if ((byte & (1 << bit)) === 0) zeroBits++;
        else break;
      }
      break;
    }
    console.log(`\nPoW verification: hash=${hash.toString('hex').substring(0, 16)}... zero_bits=${zeroBits} (need ${challenge.difficultyBits})`);

    rawSocket.destroy();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
