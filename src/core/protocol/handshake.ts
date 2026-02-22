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

export interface LongAuthContext {
  nonce: bigint;
  clientScAddress: string;
  proxyParams: ProxyParams;
}

export type LongAuthHandler = (context: LongAuthContext) => Promise<void>;

/**
 * Perform the full TCP + proxy handshake and authentication.
 */
export async function performHandshake(
  conn: CocoonConnection,
  ownerAddress: string,
  secretString: string,
  configVersion: number,
  onLongAuthRequired?: LongAuthHandler,
): Promise<HandshakeResult> {
  // Step 1: TCP connect
  const tcpId = crypto.randomBytes(8).readBigInt64LE();
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
  const queryId = crypto.randomBytes(8).readBigInt64LE();
  sendQuery(conn, queryId, serializeTLObject(connectReq as unknown as Record<string, unknown>));

  const connectResponseData = await waitForQueryAnswer(
    conn,
    queryId,
    30_000,
    'connectToProxy response',
  );
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
      const authQueryId = crypto.randomBytes(8).readBigInt64LE();
      sendQuery(
        conn,
        authQueryId,
        serializeTLObject(authReq as unknown as Record<string, unknown>),
      );
      const authResponseData = await waitForQueryAnswer(
        conn,
        authQueryId,
        300_000,
        'short auth response',
      );
      authResult = deserializeTLObject(authResponseData) as unknown as ClientAuthorizationWithProxy;
    } else {
      // Fallback to long auth
      authResult = await performLongAuth(
        conn,
        connected,
        auth.nonce,
        onLongAuthRequired,
        'Proxy requested long auth because provided SECRET does not match on-chain secret hash',
      );
    }
  } else {
    // Long auth required
    authResult = await performLongAuth(
      conn,
      connected,
      auth.nonce,
      onLongAuthRequired,
      'Proxy requires long auth (wallet is not registered for this proxy or SECRET is unavailable)',
    );
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

function buildHandshakeCloseError(stage: string, error?: Error): ConnectionError {
  const suffix =
    ' This usually means RA-TLS/mTLS client credentials were rejected by the proxy.';
  return new ConnectionError(
    `Connection closed while waiting for ${stage}.${suffix}`,
    error,
  );
}

async function performLongAuth(
  conn: CocoonConnection,
  connected: ClientConnectedToProxy,
  nonce: bigint,
  onLongAuthRequired: LongAuthHandler | undefined,
  missingHandlerMessage: string,
): Promise<ClientAuthorizationWithProxy> {
  if (!onLongAuthRequired) {
    throw new AuthenticationError(
      `${missingHandlerMessage}. Provide SECRET for short auth, or keep automatic long-auth registration enabled`,
    );
  }

  await onLongAuthRequired({
    nonce,
    clientScAddress: connected.clientScAddress,
    proxyParams: connected.params,
  });

  const authQueryId = crypto.randomBytes(8).readBigInt64LE();
  const authReq = { _type: 'client.authorizeWithProxyLong' };
  sendQuery(conn, authQueryId, serializeTLObject(authReq as unknown as Record<string, unknown>));
  const authResponseData = await waitForQueryAnswer(
    conn,
    authQueryId,
    300_000,
    'long auth response',
  );
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
    const timer = setTimeout(() => cleanup(() => reject(new ConnectionError('Timeout waiting for frame'))), timeoutMs);

    const cleanup = (next?: () => void) => {
      clearTimeout(timer);
      conn.removeListener('frame', onFrame);
      conn.removeListener('close', onClose);
      if (next) next();
    };

    const onFrame = (data: Buffer) => {
      cleanup(() => resolve(data));
    };
    const onClose = (error?: Error) => {
      cleanup(() => reject(buildHandshakeCloseError('handshake frame', error)));
    };

    conn.once('frame', onFrame);
    conn.once('close', onClose);
  });
}

function waitForQueryAnswer(
  conn: CocoonConnection,
  queryId: bigint,
  timeoutMs: number,
  stage = 'query answer',
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => cleanup(() => reject(new ConnectionError(`Timeout waiting for ${stage}`))),
      timeoutMs,
    );

    const cleanup = (next?: () => void) => {
      clearTimeout(timer);
      conn.removeListener('frame', onFrame);
      conn.removeListener('close', onClose);
      if (next) next();
    };

    const onClose = (error?: Error) => {
      cleanup(() => reject(buildHandshakeCloseError(stage, error)));
    };

    const onFrame = (data: Buffer) => {
      let obj: Record<string, unknown>;
      try {
        obj = deserializeTLObject(data);
      } catch (err) {
        cleanup(() =>
          reject(new ProtocolError(`Failed to deserialize handshake frame: ${String(err)}`)),
        );
        return;
      }

      if (obj['_type'] === 'tcp.queryAnswer') {
        const answerId = obj['id'] as bigint;
        if (answerId === queryId) {
          cleanup(() => resolve(obj['data'] as Buffer));
          return;
        }
      } else if (obj['_type'] === 'tcp.queryError') {
        const errorId = obj['id'] as bigint;
        if (errorId === queryId) {
          cleanup(() =>
            reject(new ProtocolError(`Query error: ${obj['message']}`, obj['code'] as number)),
          );
          return;
        }
      }
      // Not our answer, keep listening.
    };

    conn.on('frame', onFrame);
    conn.once('close', onClose);
  });
}

export { sendQuery, waitForFrame, waitForQueryAnswer };
// Re-export for use in session
void TL_SCHEMA; // ensure import is preserved
