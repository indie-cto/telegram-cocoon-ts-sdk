/**
 * Verify TL serialization and tcp.connect frame format.
 * Also test actual connection with detailed logging.
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
import { TL_SCHEMA, crc32 } from '../src/core/tl/schema.js';
import { serializeTLObject } from '../src/core/tl/serializer.js';
import { deserializeTLObject } from '../src/core/tl/deserializer.js';

const host = '91.108.4.11';
const port = 8888;

function hexdump(buf: Buffer, label: string): void {
  console.log(`[${label}] ${buf.length} bytes:`);
  for (let i = 0; i < buf.length; i += 16) {
    const hex = buf.subarray(i, Math.min(i + 16, buf.length)).toString('hex').match(/../g)!.join(' ');
    console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex}`);
  }
}

async function main() {
  // 1. Verify constructor IDs
  console.log('=== Constructor ID Verification ===');
  const tcpConnectId = TL_SCHEMA['tcp.connect']!.id;
  const tcpConnectedId = TL_SCHEMA['tcp.connected']!.id;
  console.log(`tcp.connect:   0x${tcpConnectId.toString(16).padStart(8, '0')} = ${tcpConnectId}`);
  console.log(`tcp.connected: 0x${tcpConnectedId.toString(16).padStart(8, '0')} = ${tcpConnectedId}`);

  // Verify CRC32
  const crc = crc32('tcp.connect id:long = tcp.Packet');
  console.log(`CRC32 check:   0x${crc.toString(16).padStart(8, '0')} (should match tcp.connect)`);
  console.log(`Match: ${crc === tcpConnectId}`);

  // 2. Serialize tcp.connect
  console.log('\n=== tcp.connect Serialization ===');
  const connId = crypto.randomBytes(8).readBigInt64LE();
  const payload = serializeTLObject({ _type: 'tcp.connect', id: connId } as any);
  hexdump(payload, 'TL payload');
  console.log(`Constructor ID bytes: 0x${payload.subarray(0, 4).readUInt32LE(0).toString(16).padStart(8, '0')}`);
  console.log(`Connection ID: ${connId} (0x${(connId < 0n ? connId + (1n << 64n) : connId).toString(16)})`);

  // Frame it
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4);
  payload.copy(frame, 8);
  hexdump(frame, 'Full frame');
  console.log(`Frame: [size=${payload.length}][seqno=0][payload(${payload.length}B)]`);

  // 3. Connect, do PoW, TLS, and send tcp.connect with detailed logging
  console.log('\n=== Connection Test ===');

  // TCP connect
  console.log(`Connecting to ${host}:${port}...`);
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });
  console.log('TCP connected');

  // PoW
  console.log('Waiting for PoW challenge...');
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
  console.log(`PoW challenge: difficulty=${challenge.difficultyBits}, salt=${challenge.salt.toString('hex')}`);

  const t0 = Date.now();
  const nonce = solvePow(challenge);
  console.log(`PoW solved in ${Date.now() - t0}ms, nonce=${nonce}`);

  const powResponse = buildPowResponse(nonce);
  hexdump(powResponse, 'PoW response');

  // Send PoW and wait for write to flush
  await new Promise<void>((resolve, reject) => {
    rawSocket.write(powResponse, (err) => {
      if (err) reject(err); else resolve();
    });
  });
  console.log('PoW response sent and flushed');

  // Small delay before TLS
  await new Promise(r => setTimeout(r, 100));

  // Check if there's any data from server before TLS
  console.log('Checking for pre-TLS data...');
  const preTlsData = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      rawSocket.removeListener('data', onData);
      resolve(null);
    }, 500);
    const onData = (chunk: Buffer) => {
      clearTimeout(timer);
      rawSocket.removeListener('data', onData);
      resolve(chunk);
    };
    rawSocket.on('data', onData);
  });
  if (preTlsData) {
    hexdump(preTlsData, 'Pre-TLS data from server');
  } else {
    console.log('No pre-TLS data (good - TLS should start now)');
  }

  // TLS handshake
  console.log('Starting TLS handshake...');
  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TLS timeout')), 15000);
    const sock = tls.connect(
      { socket: rawSocket, rejectUnauthorized: false },
      () => { clearTimeout(timer); resolve(sock); },
    );
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  console.log(`TLS handshake complete: ${tlsSocket.getProtocol()}, ${tlsSocket.getCipher()?.name}`);
  console.log(`TLS authorized: ${tlsSocket.authorized}, error: ${tlsSocket.authorizationError}`);
  console.log(`ALPN: ${tlsSocket.alpnProtocol}`);

  // Check if server sends data after TLS but before we send anything
  console.log('\nWaiting 3s for any server-initiated data...');
  let gotServerData = false;
  const serverData = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      tlsSocket.removeListener('data', onData);
      resolve(null);
    }, 3000);
    const onData = (chunk: Buffer) => {
      clearTimeout(timer);
      gotServerData = true;
      tlsSocket.removeListener('data', onData);
      resolve(chunk);
    };
    tlsSocket.on('data', onData);
    tlsSocket.on('close', () => {
      clearTimeout(timer);
      console.log('  CONNECTION CLOSED BY SERVER before we sent anything!');
      resolve(null);
    });
  });

  if (serverData) {
    hexdump(serverData, 'Server-initiated data');
    // Try to interpret it
    if (serverData.length >= 4) {
      const first4 = serverData.readUInt32LE(0);
      console.log(`First 4 bytes as uint32 LE: ${first4} (0x${first4.toString(16)})`);
    }
  } else if (!gotServerData) {
    console.log('No server-initiated data in 3s');
  }

  if (tlsSocket.destroyed) {
    console.log('Connection already destroyed - cannot continue');
    return;
  }

  // Send tcp.connect
  console.log('\nSending tcp.connect frame...');
  const sendConnId = crypto.randomBytes(8).readBigInt64LE();
  const sendPayload = serializeTLObject({ _type: 'tcp.connect', id: sendConnId } as any);
  const sendFrame = Buffer.alloc(8 + sendPayload.length);
  sendFrame.writeUInt32LE(sendPayload.length, 0);
  sendFrame.writeInt32LE(0, 4);
  sendPayload.copy(sendFrame, 8);

  hexdump(sendFrame, 'Sending frame');

  let writeError = false;
  tlsSocket.write(sendFrame, (err) => {
    if (err) {
      console.log('Write error:', err.message);
      writeError = true;
    } else {
      console.log('Frame written successfully');
    }
  });

  // Listen for response with 30s timeout
  console.log('Waiting up to 30s for response...');
  const response = await new Promise<Buffer | null>((resolve) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      tlsSocket.removeListener('data', onData);
      resolve(buf.length > 0 ? buf : null);
    }, 30000);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      console.log(`  Received ${chunk.length} bytes (total: ${buf.length})`);
      // Check if we have a complete frame
      if (buf.length >= 8) {
        const size = buf.readUInt32LE(0);
        if (buf.length >= 8 + size) {
          clearTimeout(timer);
          tlsSocket.removeListener('data', onData);
          resolve(buf);
        }
      }
    };

    tlsSocket.on('data', onData);
    tlsSocket.on('close', () => {
      clearTimeout(timer);
      console.log('  Connection closed by server');
      resolve(buf.length > 0 ? buf : null);
    });
    tlsSocket.on('error', (err) => {
      console.log('  Socket error:', err.message);
    });
  });

  if (response) {
    hexdump(response, 'Response');
    if (response.length >= 8) {
      const respSize = response.readUInt32LE(0);
      const respSeqno = response.readInt32LE(4);
      console.log(`Response frame: size=${respSize}, seqno=${respSeqno}`);
      if (respSize <= 1 << 24 && response.length >= 8 + respSize) {
        const respPayload = response.subarray(8, 8 + respSize);
        try {
          const obj = deserializeTLObject(respPayload);
          console.log('Deserialized:', JSON.stringify(obj, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v instanceof Buffer ? v.toString('hex') : v, 2));
          console.log('\n=== SUCCESS! Server responded! ===');
        } catch (e: any) {
          console.log('Deserialize error:', e.message);
          hexdump(respPayload, 'Raw payload');
        }
      }
    }
  } else {
    console.log('No response received');
  }

  tlsSocket.destroy();
  rawSocket.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
