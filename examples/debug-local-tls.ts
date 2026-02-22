/**
 * Local test: verify that Node.js sends Ed25519 client certificates
 * when wrapping an existing socket with tls.connect({ socket, key, cert }).
 */
import * as net from 'node:net';
import * as tls from 'node:tls';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Generate server Ed25519 cert
execSync('openssl genpkey -algorithm ed25519 -out /tmp/test-server-key.pem', { stdio: 'pipe' });
execSync(
  'openssl req -x509 -key /tmp/test-server-key.pem -out /tmp/test-server-cert.pem -days 1 ' +
  '-subj "/CN=test-server" ' +
  '-addext "basicConstraints=critical,CA:FALSE" ' +
  '-addext "keyUsage=critical,digitalSignature" ' +
  '-addext "extendedKeyUsage=critical,serverAuth,clientAuth"',
  { stdio: 'pipe' },
);

// Generate client Ed25519 cert
execSync('openssl genpkey -algorithm ed25519 -out /tmp/test-client-key.pem', { stdio: 'pipe' });
execSync(
  'openssl req -x509 -key /tmp/test-client-key.pem -out /tmp/test-client-cert.pem -days 1 ' +
  '-subj "/CN=test-client" ' +
  '-addext "basicConstraints=critical,CA:FALSE" ' +
  '-addext "keyUsage=critical,digitalSignature" ' +
  '-addext "extendedKeyUsage=critical,serverAuth,clientAuth"',
  { stdio: 'pipe' },
);

const serverKey = readFileSync('/tmp/test-server-key.pem');
const serverCert = readFileSync('/tmp/test-server-cert.pem');
const clientKey = readFileSync('/tmp/test-client-key.pem');
const clientCert = readFileSync('/tmp/test-client-cert.pem');

async function test(label: string, useSocketWrapper: boolean, sendClientCert: boolean) {
  console.log(`\n=== ${label} ===`);

  return new Promise<void>((resolve) => {
    // Create TLS server
    const server = tls.createServer({
      key: serverKey,
      cert: serverCert,
      requestCert: true,
      rejectUnauthorized: false, // Accept self-signed client certs
    }, (socket) => {
      const peerCert = socket.getPeerCertificate();
      console.log(`  Server: client authorized=${socket.authorized}`);
      console.log(`  Server: client cert subject=${peerCert?.subject?.CN || 'NONE'}`);
      console.log(`  Server: client cert algorithm=${peerCert?.pubkey ? 'present' : 'NONE'}`);

      // Send a response
      socket.write('hello from server');
      socket.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      console.log(`  Server listening on ${addr.port}`);

      const doConnect = (sock?: net.Socket) => {
        const opts: tls.ConnectionOptions = {
          host: '127.0.0.1',
          port: addr.port,
          rejectUnauthorized: false,
          ...(sock ? { socket: sock } : {}),
          ...(sendClientCert ? { key: clientKey, cert: clientCert } : {}),
        };

        const client = tls.connect(opts, () => {
          console.log(`  Client: connected, protocol=${client.getProtocol()}, cipher=${client.getCipher()?.name}`);

          client.on('data', (data) => {
            console.log(`  Client: received "${data.toString()}"`);
          });

          client.on('end', () => {
            server.close();
            resolve();
          });
        });

        client.on('error', (err) => {
          console.log(`  Client error: ${err.message}`);
          server.close();
          resolve();
        });
      };

      if (useSocketWrapper) {
        // First create a raw TCP connection, then wrap with TLS (like we do with the proxy)
        const raw = net.connect({ host: '127.0.0.1', port: addr.port }, () => {
          console.log(`  Raw TCP connected, now wrapping with TLS...`);
          doConnect(raw);
        });
      } else {
        doConnect();
      }
    });
  });
}

async function main() {
  await test('Test 1: Direct TLS, with client cert', false, true);
  await test('Test 2: Direct TLS, no client cert', false, false);
  await test('Test 3: Socket wrapper, with client cert', true, true);
  await test('Test 4: Socket wrapper, no client cert', true, false);
}

main().catch(console.error);
