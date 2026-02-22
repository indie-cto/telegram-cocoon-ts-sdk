/**
 * Debug: mTLS with properly formatted Ed25519 client certificate.
 *
 * From the RA-TLS docs:
 * - Server requires client to present a certificate (mTLS)
 * - Certificate must use Ed25519 key (32 bytes)
 * - Self-signed, depth 0
 * - With policy @any, TDX extensions are optional
 * - Required extensions: Basic Constraints (CA:FALSE, critical),
 *   Key Usage (digitalSignature, critical),
 *   Extended Key Usage (serverAuth, clientAuth, critical)
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

function generateEd25519Cert(name: string): { key: string; cert: string } {
  // Generate Ed25519 key
  execSync(`openssl genpkey -algorithm ed25519 -out /tmp/cocoon-${name}-key.pem`, { stdio: 'pipe' });

  // Generate self-signed cert with proper extensions using -addext
  execSync(
    `openssl req -x509 -key /tmp/cocoon-${name}-key.pem ` +
    `-out /tmp/cocoon-${name}-cert.pem -days 1 ` +
    `-subj "/C=AE/ST=DUBAI/O=TDLib Development/OU=Security/CN=localhost" ` +
    `-addext "basicConstraints=critical,CA:FALSE" ` +
    `-addext "keyUsage=critical,digitalSignature" ` +
    `-addext "extendedKeyUsage=critical,serverAuth,clientAuth" ` +
    `-addext "subjectKeyIdentifier=hash" ` +
    `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
    { stdio: 'pipe' },
  );

  return {
    key: readFileSync(`/tmp/cocoon-${name}-key.pem`, 'utf-8'),
    cert: readFileSync(`/tmp/cocoon-${name}-cert.pem`, 'utf-8'),
  };
}

function generateEd25519CertWithTdxStubs(name: string): { key: string; cert: string } {
  // Generate Ed25519 key
  execSync(`openssl genpkey -algorithm ed25519 -out /tmp/cocoon-${name}-key.pem`, { stdio: 'pipe' });

  // Read the public key bytes
  const pubKeyDer = execSync(
    `openssl pkey -in /tmp/cocoon-${name}-key.pem -pubout -outform DER 2>/dev/null`,
    { encoding: 'buffer' },
  );
  // Ed25519 DER public key: the last 32 bytes are the raw key
  const rawPubKey = pubKeyDer.subarray(pubKeyDer.length - 32);

  // Create OpenSSL config with custom OID and extensions
  const pubKeyHex = rawPubKey.toString('hex').match(/../g)!.join(':');
  const confFile = `
[req]
distinguished_name = req_dn
x509_extensions = v3_ext
prompt = no

[req_dn]
C = AE
ST = DUBAI
O = TDLib Development
OU = Security
CN = localhost

[v3_ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, serverAuth, clientAuth
subjectKeyIdentifier = hash
subjectAltName = DNS:localhost, IP:127.0.0.1
1.3.6.1.4.1.12345.2 = critical, DER:${pubKeyHex}
`;
  writeFileSync(`/tmp/cocoon-${name}.cnf`, confFile);

  // Generate self-signed cert with TDX extension stubs
  execSync(
    `openssl req -x509 -key /tmp/cocoon-${name}-key.pem ` +
    `-out /tmp/cocoon-${name}-cert.pem -days 1 ` +
    `-config /tmp/cocoon-${name}.cnf`,
    { stdio: 'pipe' },
  );

  // Verify the cert
  const certText = execSync(`openssl x509 -in /tmp/cocoon-${name}-cert.pem -text -noout 2>&1`).toString();
  console.log(`Certificate (${name}):`);
  const lines = certText.split('\n');
  for (const l of lines) {
    if (l.includes('Issuer:') || l.includes('Subject:') || l.includes('Public Key') ||
        l.includes('Signature Algorithm') || l.includes('1.3.6.1') || l.includes('Critical') ||
        l.includes('Key Usage') || l.includes('Basic Constraints') || l.includes('critical')) {
      console.log(l.trim());
    }
  }

  return {
    key: readFileSync(`/tmp/cocoon-${name}-key.pem`, 'utf-8'),
    cert: readFileSync(`/tmp/cocoon-${name}-cert.pem`, 'utf-8'),
  };
}

async function connectPowTls(tlsOpts: tls.ConnectionOptions): Promise<{ tls: tls.TLSSocket; raw: net.Socket }> {
  const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30000);
    s.once('error', reject);
  });

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
  const nonce = solvePow(challenge);

  await new Promise<void>((resolve, reject) => {
    rawSocket.write(buildPowResponse(nonce), (err) => err ? reject(err) : resolve());
  });

  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TLS timeout')), 15000);
    const sock = tls.connect(
      { socket: rawSocket, rejectUnauthorized: false, ...tlsOpts },
      () => { clearTimeout(timer); resolve(sock); },
    );
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  return { tls: tlsSocket, raw: rawSocket };
}

async function testConnection(label: string, tlsOpts: tls.ConnectionOptions): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const t0 = Date.now();

  try {
    const conn = await connectPowTls(tlsOpts);
    console.log(`TLS: ${conn.tls.getProtocol()}, ${conn.tls.getCipher()?.name} (${Date.now() - t0}ms)`);

    // Check peer cert
    const peerCert = conn.tls.getPeerCertificate();
    console.log(`Server cert: ${peerCert.subject?.CN || 'unknown'}, ${peerCert.fingerprint?.substring(0, 20)}`);

    // Track close
    let closeTime = 0;
    conn.tls.on('close', () => {
      closeTime = Date.now() - t0;
      console.log(`  [close at ${closeTime}ms]`);
    });
    conn.tls.on('error', (err) => {
      console.log(`  [error at ${Date.now() - t0}ms: ${err.message}]`);
    });

    // Send tcp.connect immediately
    const connId = crypto.randomBytes(8).readBigInt64LE();
    const payload = serializeTLObject({ _type: 'tcp.connect', id: connId } as any);
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    frame.writeInt32LE(0, 4);
    payload.copy(frame, 8);

    conn.tls.write(frame, (err) => {
      if (err) console.log(`  Write error: ${err.message}`);
      else console.log(`  Frame sent at ${Date.now() - t0}ms`);
    });

    // Wait for response
    const response = await new Promise<Buffer | null>((resolve) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        conn.tls.removeListener('data', onData);
        resolve(buf.length > 0 ? buf : null);
      }, 10000);

      function onData(chunk: Buffer) {
        buf = Buffer.concat([buf, chunk]);
        console.log(`  Recv ${chunk.length}B at ${Date.now() - t0}ms: ${chunk.toString('hex').substring(0, 60)}`);
        if (buf.length >= 8) {
          const size = buf.readUInt32LE(0);
          if (size <= 1 << 24 && buf.length >= 8 + size) {
            clearTimeout(timer);
            conn.tls.removeListener('data', onData);
            resolve(buf);
          }
        }
      }

      conn.tls.on('data', onData);
      conn.tls.on('close', () => { clearTimeout(timer); resolve(buf.length > 0 ? buf : null); });
    });

    if (response && response.length >= 8) {
      const size = response.readUInt32LE(0);
      const seqno = response.readInt32LE(4);
      console.log(`  Response frame: size=${size}, seqno=${seqno}`);
      if (size <= 1 << 24 && response.length >= 8 + size) {
        try {
          const obj = deserializeTLObject(response.subarray(8, 8 + size));
          console.log(`  TL: ${JSON.stringify(obj, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v instanceof Buffer ? v.toString('hex') : v)}`);
          console.log(`  *** SUCCESS ***`);
        } catch (e: any) {
          console.log(`  Deserialize error: ${e.message}`);
        }
      }
    } else {
      console.log(`  No response (closed at ${closeTime}ms)`);
    }

    conn.tls.destroy();
    conn.raw.destroy();
  } catch (err: any) {
    console.log(`  Failed: ${err.message}`);
  }
}

async function main() {
  // Test 1: No client cert (baseline)
  await testConnection('Test 1: No client cert', {});

  // Test 2: Ed25519 with proper x509 extensions
  console.log('\nGenerating Ed25519 cert with proper extensions...');
  const cert1 = generateEd25519Cert('proper');
  await testConnection('Test 2: Ed25519 + proper extensions', {
    key: cert1.key,
    cert: cert1.cert,
  });

  // Test 3: Ed25519 with TDX user claims stub
  console.log('\nGenerating Ed25519 cert with TDX user claims stub...');
  const cert2 = generateEd25519CertWithTdxStubs('tdx-stub');
  await testConnection('Test 3: Ed25519 + TDX user claims stub', {
    key: cert2.key,
    cert: cert2.cert,
  });

  // Test 4: Ed25519 cert but try with requestCert behavior simulation
  // When the TLS server requests client cert, Node.js sends it if provided
  console.log('\nUsing cert2 with servername=localhost...');
  await testConnection('Test 4: Ed25519 + TDX stub + servername', {
    key: cert2.key,
    cert: cert2.cert,
    servername: 'localhost',
  });

  process.exit(0);
}

main().catch(console.error);
