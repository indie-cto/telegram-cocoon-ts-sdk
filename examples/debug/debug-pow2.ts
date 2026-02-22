/**
 * Debug: Test PoW + TLS with detailed TLS options and PoW verification.
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
  const challengeData = await new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timeout')), 30000);
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
  console.log(`PoW: difficulty=${challenge.difficultyBits}, salt=${challenge.salt.toString('hex')}`);

  // Solve and verify
  const nonce = solvePow(challenge);
  console.log(`Nonce: ${nonce}`);

  // Verify manually
  const input = Buffer.alloc(24);
  challenge.salt.copy(input, 0);
  input.writeBigUInt64LE(nonce, 16);
  const hash = crypto.createHash('sha256').update(input).digest();
  console.log(`SHA256(salt||nonce): ${hash.toString('hex')}`);
  console.log(`First 3 bytes: ${hash[0]!.toString(2).padStart(8, '0')} ${hash[1]!.toString(2).padStart(8, '0')} ${hash[2]!.toString(2).padStart(8, '0')}`);

  // Check leading zeros
  let zeroBits = 0;
  for (const byte of hash) {
    if (byte === 0) { zeroBits += 8; continue; }
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte & (1 << bit)) === 0) zeroBits++;
      else break;
    }
    break;
  }
  console.log(`Leading zero bits: ${zeroBits} (need ${challenge.difficultyBits})`);

  // Send response
  const response = buildPowResponse(nonce);
  console.log(`PoW response hex: ${response.toString('hex')}`);

  // Write response and wait for it to be sent
  await new Promise<void>((resolve, reject) => {
    rawSocket.write(response, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  console.log('PoW response sent, waiting 100ms before TLS...');
  await new Promise(r => setTimeout(r, 100));

  // Check if server sent any data after PoW (before TLS)
  const extraData = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      rawSocket.removeListener('data', onData);
      resolve(null);
    }, 500);
    const onData = (chunk: Buffer) => {
      clearTimeout(timer);
      rawSocket.removeListener('data', onData);
      resolve(chunk);
    };
    rawSocket.once('data', onData);
  });

  if (extraData) {
    console.log(`Server sent ${extraData.length} bytes after PoW: ${extraData.toString('hex')}`);
  } else {
    console.log('No extra data from server after PoW (good)');
  }

  // Try TLS upgrade with different options
  console.log('\nUpgrading to TLS...');
  try {
    const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const sock = tls.connect(
        {
          socket: rawSocket,
          rejectUnauthorized: false,
          // Try various TLS options:
          // servername: host,  // SNI
          minVersion: 'TLSv1.2',
        },
        () => {
          console.log('TLS connected!');
          console.log(`  Protocol: ${sock.getProtocol()}`);
          console.log(`  Cipher: ${sock.getCipher()?.name}`);
          console.log(`  Authorized: ${sock.authorized}`);
          resolve(sock);
        },
      );

      sock.on('error', (err) => {
        console.log('TLS error:', err.message);
      });

      sock.once('error', (err) => {
        reject(err);
      });
    });

    tlsSocket.destroy();
  } catch (err: any) {
    console.log('TLS failed:', err.message);

    // Try without TLS - maybe after PoW, the connection is plain?
    console.log('\n--- Trying without TLS (just PoW, then plain frames) ---');

    const rawSocket2 = await new Promise<net.Socket>((resolve, reject) => {
      const sock = net.connect({ host, port }, () => resolve(sock));
      sock.setTimeout(30000);
      sock.once('error', reject);
    });

    // PoW again
    const cd2 = await new Promise<Buffer>((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error('Timeout')), 30000);
      rawSocket2.on('data', function onData(chunk: Buffer) {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length >= POW_CHALLENGE_SIZE) {
          clearTimeout(timer);
          rawSocket2.removeListener('data', onData);
          resolve(buf);
        }
      });
    });
    const ch2 = parsePowChallenge(cd2);
    const nonce2 = solvePow(ch2);
    const resp2 = buildPowResponse(nonce2);

    await new Promise<void>((resolve, reject) => {
      rawSocket2.write(resp2, (err) => err ? reject(err) : resolve());
    });
    console.log(`PoW solved (nonce=${nonce2}), response sent`);

    // Now try sending tcp.connect as plain frame
    await new Promise(r => setTimeout(r, 200));

    const { serializeTLObject } = await import('../src/core/tl/serializer.js');
    const { deserializeTLObject } = await import('../src/core/tl/deserializer.js');

    const tcpId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
    const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    frame.writeInt32LE(0, 4);
    payload.copy(frame, 8);

    console.log(`Sending tcp.connect frame: ${frame.toString('hex')}`);
    rawSocket2.write(frame);

    const respData = await new Promise<Buffer>((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        rawSocket2.removeListener('data', onData);
        if (buf.length > 0) {
          resolve(buf);
        } else {
          reject(new Error('Timeout'));
        }
      }, 5000);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        // Try to parse as frame
        if (buf.length >= 8) {
          const size = buf.readUInt32LE(0);
          if (size <= 1 << 24 && buf.length >= 8 + size) {
            clearTimeout(timer);
            rawSocket2.removeListener('data', onData);
            resolve(buf);
          }
        }
      };
      rawSocket2.on('data', onData);
    });

    console.log(`Received (${respData.length} bytes): ${respData.toString('hex')}`);
    if (respData.length >= 8) {
      const size = respData.readUInt32LE(0);
      const seqno = respData.readInt32LE(4);
      console.log(`Frame: size=${size}, seqno=${seqno}`);
      if (size <= 1 << 24 && respData.length >= 8 + size) {
        const p = respData.subarray(8, 8 + size);
        try {
          const obj = deserializeTLObject(p);
          console.log('Deserialized:', JSON.stringify(obj, (_, v) =>
            typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Buffer ? v.toString('hex') : v,
          2));
        } catch (e: any) {
          console.log('Deserialize error:', e.message);
        }
      }
    }

    rawSocket2.destroy();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
