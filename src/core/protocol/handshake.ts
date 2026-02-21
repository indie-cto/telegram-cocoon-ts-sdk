/**
 * Cocoon protocol handshake.
 *
 * Flow:
 * 1. Client sends tcp.connect(id) → Server replies tcp.connected(id)
 * 2. Client sends client.connectToProxy(params, minConfigVersion)
 *    → Server replies client.connectedToProxy(params, clientScAddress, auth, signedPayment)
 * 3. Auth: short (secret hash match) or long (blockchain registration)
 *    - Short: client.authorizeWithProxyShort(secretData)
 *    - Long: client.authorizeWithProxyLong() (after on-chain tx)
 *    → Server replies client.AuthorizationWithProxy (success or failed)
 */

import { serializeTLObject } from '../tl/serializer.js';
import { deserializeTLObject } from '../tl/deserializer.js';
import { CocoonConnection } from './connection.js';
import { ConnectionError, AuthenticationError, ProtocolError } from '../error.js';
import type {
  TcpConnect,
  TcpConnected,
  ClientParams,
  ClientConnectToProxy,
  ClientConnectedToProxy,
  ClientAuthorizeWithProxyShort,
  ClientAuthorizationWithProxy,
  ProxyParams,
  ProxySignedPaymentType,
} from '../tl/types.js';
import { TL_SCHEMA } from '../tl/schema.js';
import crypto from 'node:crypto';

export interface HandshakeResult {
  proxyParams: ProxyParams;
  clientScAddress: string;
  signedPayment: ProxySignedPaymentType;
  tokensCommittedToDb: bigint;
  maxTokens: bigint;
  protoVersion: number;
}

/**
 * Perform the full TCP + proxy handshake and authentication.
 */
export async function performHandshake(
  conn: CocoonConnection,
  ownerAddress: string,
  secretString: string,
  configVersion: number,
): Promise<HandshakeResult> {
  // Step 1: TCP connect
  const tcpId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  const tcpConnect: TcpConnect = { _type: 'tcp.connect', id: tcpId };
  conn.send(serializeTLObject(tcpConnect as unknown as Record<string, unknown>));

  const tcpResponse = await waitForFrame(conn, 30_000);
  const tcpConnected = deserializeTLObject(tcpResponse) as unknown as TcpConnected;
  if (tcpConnected._type !== 'tcp.connected') {
    throw new ProtocolError(`Expected tcp.connected, got ${tcpConnected._type}`);
  }

  // Step 2: Connect to proxy
  const clientParams: ClientParams = {
    _type: 'client.params',
    flags: 3, // bit 0 (isTest) + bit 1 (proto versions)
    clientOwnerAddress: ownerAddress,
    isTest: false,
    minProtoVersion: 0,
    maxProtoVersion: 1,
  };

  const connectReq: ClientConnectToProxy = {
    _type: 'client.connectToProxy',
    params: clientParams,
    minConfigVersion: configVersion,
  };

  // Wrap in tcp.query for handshake
  const queryId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  sendQuery(conn, queryId, serializeTLObject(connectReq as unknown as Record<string, unknown>));

  const connectResponseData = await waitForQueryAnswer(conn, queryId, 30_000);
  const connected = deserializeTLObject(connectResponseData) as unknown as ClientConnectedToProxy;
  if (connected._type !== 'client.connectedToProxy') {
    throw new ProtocolError(`Expected client.connectedToProxy, got ${connected._type}`);
  }

  const protoVersion = connected.params.protoVersion ?? 0;

  // Step 3: Authenticate
  // Determine auth type from connected response
  const auth = connected.auth;
  let authResult: ClientAuthorizationWithProxy;

  if (auth._type === 'client.proxyConnectionAuthShort') {
    // Compute our secret hash and compare
    const ourSecretHash = Buffer.from(crypto.createHash('sha256').update(secretString).digest());

    if (ourSecretHash.equals(auth.secretHash)) {
      // Short auth — send secret string
      const authReq: ClientAuthorizeWithProxyShort = {
        _type: 'client.authorizeWithProxyShort',
        data: Buffer.from(secretString, 'utf-8'),
      };
      const authQueryId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
      sendQuery(
        conn,
        authQueryId,
        serializeTLObject(authReq as unknown as Record<string, unknown>),
      );
      const authResponseData = await waitForQueryAnswer(conn, authQueryId, 300_000);
      authResult = deserializeTLObject(authResponseData) as unknown as ClientAuthorizationWithProxy;
    } else {
      // Fallback to long auth
      authResult = await performLongAuth(conn);
    }
  } else {
    // Long auth required
    authResult = await performLongAuth(conn);
  }

  if (authResult._type === 'client.authorizationWithProxyFailed') {
    throw new AuthenticationError(`Proxy auth failed: ${authResult.error}`, authResult.errorCode);
  }

  if (authResult._type !== 'client.authorizationWithProxySuccess') {
    throw new ProtocolError(
      `Unexpected auth response type: ${(authResult as { _type: string })._type}`,
    );
  }

  return {
    proxyParams: connected.params,
    clientScAddress: connected.clientScAddress,
    signedPayment: authResult.signedPayment,
    tokensCommittedToDb: authResult.tokensCommittedToDb,
    maxTokens: authResult.maxTokens,
    protoVersion,
  };
}

async function performLongAuth(conn: CocoonConnection): Promise<ClientAuthorizationWithProxy> {
  const authQueryId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  const authReq = { _type: 'client.authorizeWithProxyLong' };
  sendQuery(conn, authQueryId, serializeTLObject(authReq as unknown as Record<string, unknown>));
  const authResponseData = await waitForQueryAnswer(conn, authQueryId, 300_000);
  return deserializeTLObject(authResponseData) as unknown as ClientAuthorizationWithProxy;
}

function sendQuery(conn: CocoonConnection, queryId: bigint, data: Buffer): void {
  const queryObj = {
    _type: 'tcp.query',
    id: queryId,
    data,
  };
  conn.send(serializeTLObject(queryObj as unknown as Record<string, unknown>));
}

function waitForFrame(conn: CocoonConnection, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.removeListener('frame', onFrame);
      reject(new ConnectionError('Timeout waiting for frame'));
    }, timeoutMs);

    const onFrame = (data: Buffer) => {
      clearTimeout(timer);
      resolve(data);
    };

    conn.once('frame', onFrame);
  });
}

function waitForQueryAnswer(
  conn: CocoonConnection,
  queryId: bigint,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.removeListener('frame', onFrame);
      reject(new ConnectionError('Timeout waiting for query answer'));
    }, timeoutMs);

    const onFrame = (data: Buffer) => {
      const obj = deserializeTLObject(data);
      if (obj['_type'] === 'tcp.queryAnswer') {
        const answerId = obj['id'] as bigint;
        if (answerId === queryId) {
          clearTimeout(timer);
          conn.removeListener('frame', onFrame);
          resolve(obj['data'] as Buffer);
          return;
        }
      } else if (obj['_type'] === 'tcp.queryError') {
        const errorId = obj['id'] as bigint;
        if (errorId === queryId) {
          clearTimeout(timer);
          conn.removeListener('frame', onFrame);
          reject(new ProtocolError(`Query error: ${obj['message']}`, obj['code'] as number));
          return;
        }
      } else if (obj['_type'] === 'tcp.pong') {
        // Ignore keepalive responses
        conn.on('frame', onFrame);
        return;
      }
      // Not our answer, keep listening
      conn.on('frame', onFrame);
    };

    conn.once('frame', onFrame);
  });
}

export { sendQuery, waitForFrame, waitForQueryAnswer };
// Re-export for use in session
void TL_SCHEMA; // ensure import is preserved
