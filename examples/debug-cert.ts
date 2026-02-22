/**
 * Debug: Decode the server's TLS certificate to find TDX attestation extensions.
 * Then try to create a client cert with matching extensions.
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import {
  parsePowChallenge,
  solvePow,
  buildPowResponse,
  POW_CHALLENGE_SIZE,
} from '../src/core/protocol/pow.js';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const host = '91.108.4.11';
const port = 8888;

async function main() {
  // Connect and get server cert
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
      { socket: rawSocket, rejectUnauthorized: false },
      () => { clearTimeout(timer); resolve(sock); },
    );
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  // Get raw cert
  const cert = tlsSocket.getPeerCertificate(true);
  const rawCert = cert.raw;

  // Save to file for openssl analysis
  writeFileSync('/tmp/cocoon-server.der', rawCert);

  // Also PEM format
  const pemCert = '-----BEGIN CERTIFICATE-----\n' +
    rawCert.toString('base64').match(/.{1,64}/g)!.join('\n') +
    '\n-----END CERTIFICATE-----\n';
  writeFileSync('/tmp/cocoon-server.pem', pemCert);

  console.log('Server cert saved to /tmp/cocoon-server.pem');
  console.log(`Size: ${rawCert.length} bytes\n`);

  // Decode with openssl
  try {
    const decoded = execSync('openssl x509 -in /tmp/cocoon-server.pem -text -noout 2>&1').toString();
    console.log('=== Certificate Details ===');
    console.log(decoded);
  } catch (e: any) {
    console.log('openssl decode failed:', e.stdout?.toString());
  }

  // Look for specific extensions
  try {
    const extensions = execSync('openssl x509 -in /tmp/cocoon-server.pem -text -noout 2>&1 | grep -A2 "X509v3 extensions"').toString();
    console.log('\n=== Extensions ===');
    console.log(extensions);
  } catch {}

  // Dump ASN.1 structure
  try {
    const asn1 = execSync('openssl asn1parse -in /tmp/cocoon-server.pem 2>&1 | tail -30').toString();
    console.log('\n=== ASN.1 Structure (last 30 lines) ===');
    console.log(asn1);
  } catch {}

  tlsSocket.destroy();
}

main().catch(console.error);
