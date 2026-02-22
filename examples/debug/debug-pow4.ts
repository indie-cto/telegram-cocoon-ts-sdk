/**
 * Debug: What happens between PoW and TL framing?
 * After solving PoW, listen passively for any data from server.
 */
import * as net from 'node:net';
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
  console.log(`Connecting to ${host}:${port}...`);
  const sock = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });
  console.log('TCP connected');

  // Collect ALL data
  let allData = Buffer.alloc(0);
  sock.on('data', (chunk: Buffer) => {
    allData = Buffer.concat([allData, chunk]);
    console.log(`  [data] +${chunk.length} bytes (total: ${allData.length}): ${chunk.toString('hex').substring(0, 80)}...`);
  });
  sock.on('close', () => console.log('  [close]'));
  sock.on('error', (e) => console.log('  [error]', e.message));

  // Wait for PoW challenge
  await new Promise<void>((resolve) => {
    const check = () => {
      if (allData.length >= POW_CHALLENGE_SIZE) resolve();
      else setTimeout(check, 50);
    };
    check();
  });

  const challenge = parsePowChallenge(allData.subarray(0, POW_CHALLENGE_SIZE));
  console.log(`\nPoW: difficulty=${challenge.difficultyBits}`);

  const nonce = solvePow(challenge);
  console.log(`Solved: nonce=${nonce}`);

  const response = buildPowResponse(nonce);
  console.log(`Sending PoW response: ${response.toString('hex')}`);
  sock.write(response);

  // Now just wait and see what the server sends back
  console.log('\nWaiting for server data after PoW...');
  const before = allData.length;

  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 10000);
  });

  const after = allData.length;
  if (after > before) {
    const newData = allData.subarray(before);
    console.log(`\nServer sent ${newData.length} bytes after PoW:`);
    console.log(`Hex: ${newData.toString('hex')}`);

    // Try to interpret
    if (newData.length >= 4) {
      const magic = newData.readUInt32LE(0);
      console.log(`First 4 bytes LE: 0x${magic.toString(16)}`);
    }

    // Check if ASCII
    const ascii = newData.toString('ascii');
    const printable = ascii.split('').every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127);
    if (printable) {
      console.log(`ASCII: "${ascii}"`);
    }
  } else {
    console.log('Server sent NOTHING after PoW in 10 seconds');
  }

  sock.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
