/**
 * Debug: raw TCP connection to Cocoon proxy.
 */
import * as net from 'node:net';
import crypto from 'node:crypto';
import { serializeTLObject } from '../../src/core/tl/serializer.js';
import { deserializeTLObject } from '../../src/core/tl/deserializer.js';

const host = '91.108.4.11';
const port = 8888;

const sock = net.connect({ host, port }, () => {
  console.log('TCP connected');

  // Build tcp.connect TL object
  const tcpId = BigInt('0x' + crypto.randomBytes(8).toString('hex')) & ((1n << 63n) - 1n);
  console.log(`tcp.connect id: ${tcpId}`);

  const payload = serializeTLObject({ _type: 'tcp.connect', id: tcpId } as any);
  console.log(`TL payload (${payload.length} bytes): ${payload.toString('hex')}`);

  // Frame it: [4b LE size][4b LE seqno][payload]
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(0, 4); // seqno = 0
  payload.copy(frame, 8);

  console.log(`Sending frame (${frame.length} bytes): ${frame.toString('hex')}`);
  sock.write(frame);
});

sock.on('data', (data: Buffer) => {
  console.log(`\nReceived (${data.length} bytes): ${data.toString('hex')}`);

  if (data.length >= 8) {
    const size = data.readUInt32LE(0);
    const seqno = data.readInt32LE(4);
    console.log(`Frame: size=${size}, seqno=${seqno}`);

    if (data.length >= 8 + size) {
      const payload = data.subarray(8, 8 + size);
      console.log(`Payload (${payload.length} bytes): ${payload.toString('hex')}`);
      try {
        const obj = deserializeTLObject(payload);
        console.log('Deserialized:', JSON.stringify(obj, (_, v) =>
          typeof v === 'bigint' ? v.toString() + 'n' : v
        , 2));
      } catch (e: any) {
        console.log('Deserialize error:', e.message);
      }
    }
  }
});

sock.on('error', (e) => console.log('Error:', e.message));
sock.on('close', () => console.log('Connection closed'));
sock.setTimeout(15000);
sock.on('timeout', () => { console.log('Timeout - no response'); sock.destroy(); });
