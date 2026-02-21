/**
 * Cocoon Session — manages an authenticated connection to a proxy.
 *
 * Handles:
 * - Keepalive (tcp.ping/tcp.pong)
 * - Query dispatch and response routing by requestId
 * - Streaming response assembly
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CocoonConnection, type ConnectionOptions } from './connection.js';
import { performHandshake, type HandshakeResult } from './handshake.js';
import { serializeTLObject } from '../tl/serializer.js';
import { deserializeTLObject } from '../tl/deserializer.js';
import { ConnectionError, ProtocolError, TimeoutError } from '../error.js';
import type {
  ClientQueryAnswerExType,
  ClientRunQueryEx,
  HttpRequest,
  HttpHeader,
} from '../tl/types.js';

export interface SessionOptions extends ConnectionOptions {
  ownerAddress: string;
  secretString: string;
  configVersion?: number;
}

interface PendingQuery {
  resolve: (value: ClientQueryAnswerExType) => void;
  reject: (error: Error) => void;
  onPart?: (part: ClientQueryAnswerExType) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CocoonSession extends EventEmitter {
  private conn: CocoonConnection | null = null;
  private handshakeResult: HandshakeResult | null = null;
  private pendingQueries: Map<string, PendingQuery> = new Map();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;

  private readonly options: SessionOptions;

  constructor(options: SessionOptions) {
    super();
    this.options = options;
  }

  get connected(): boolean {
    return this._connected;
  }

  get protoVersion(): number {
    return this.handshakeResult?.protoVersion ?? 0;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    this.conn = new CocoonConnection(this.options);
    await this.conn.connect();

    // Perform handshake
    this.handshakeResult = await performHandshake(
      this.conn,
      this.options.ownerAddress,
      this.options.secretString,
      this.options.configVersion ?? 0,
    );

    this._connected = true;

    // Set up frame handler for ongoing communication
    this.conn.on('frame', (data: Buffer) => this.handleFrame(data));
    this.conn.on('close', (error?: Error) => {
      this._connected = false;
      this.cleanup();
      this.emit('close', error);
    });

    // Start keepalive
    this.startKeepalive();
  }

  /**
   * Send a query and wait for the complete answer.
   */
  async sendQuery(
    modelName: string,
    httpRequest: HttpRequest,
    options: {
      maxCoefficient?: number;
      maxTokens?: number;
      timeout?: number;
      enableDebug?: boolean;
      onPart?: (part: ClientQueryAnswerExType) => void;
    } = {},
  ): Promise<ClientQueryAnswerExType> {
    if (!this.conn || !this._connected) {
      throw new ConnectionError('Not connected');
    }

    const requestId = crypto.randomBytes(32);
    const timeout = options.timeout ?? this.options.timeout ?? 120_000;

    // Serialize the HTTP request as the query payload
    const queryPayload = serializeTLObject(httpRequest as unknown as Record<string, unknown>, true);

    const runQuery: ClientRunQueryEx = {
      _type: 'client.runQueryEx',
      modelName,
      query: queryPayload,
      maxCoefficient: options.maxCoefficient ?? 4000,
      maxTokens: options.maxTokens ?? 1000,
      timeout: (timeout / 1000) * 0.95,
      requestId,
      minConfigVersion: this.options.configVersion ?? 0,
      flags: options.enableDebug ? 1 : 0,
      enableDebug: options.enableDebug,
    };

    // Send as tcp.packet (not tcp.query — queries are sent as messages after handshake)
    const tlData = serializeTLObject(runQuery as unknown as Record<string, unknown>, true);
    const tcpPacket = {
      _type: 'tcp.packet',
      data: tlData,
    };
    this.conn.send(serializeTLObject(tcpPacket as unknown as Record<string, unknown>));

    // Wait for answer
    return new Promise<ClientQueryAnswerExType>((resolve, reject) => {
      const requestIdHex = requestId.toString('hex');

      const timer = setTimeout(() => {
        this.pendingQueries.delete(requestIdHex);
        reject(new TimeoutError(`Query timed out after ${timeout}ms`));
      }, timeout);

      this.pendingQueries.set(requestIdHex, {
        resolve,
        reject,
        onPart: options.onPart,
        timer,
      });
    });
  }

  /**
   * Send a raw TL function (for getWorkerTypesV2, etc.)
   */
  async sendRpcQuery(
    tlObject: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    if (!this.conn || !this._connected) {
      throw new ConnectionError('Not connected');
    }

    const queryId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
    const data = serializeTLObject(tlObject, true);

    const tcpQuery = {
      _type: 'tcp.query',
      id: queryId,
      data,
    };
    this.conn.send(serializeTLObject(tcpQuery as unknown as Record<string, unknown>));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(`queryAnswer:${queryId}`, onAnswer);
        reject(new TimeoutError(`RPC query timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAnswer = (result: { data?: Buffer; error?: { code: number; message: string } }) => {
        clearTimeout(timer);
        if (result.error) {
          reject(new ProtocolError(result.error.message, result.error.code));
        } else if (result.data) {
          resolve(deserializeTLObject(result.data));
        }
      };

      this.once(`queryAnswer:${queryId}`, onAnswer);
    });
  }

  async disconnect(): Promise<void> {
    this.cleanup();
    this.conn?.destroy();
    this.conn = null;
    this._connected = false;
  }

  private handleFrame(data: Buffer): void {
    if (data.length === 0) {
      // Keepalive empty frame
      return;
    }

    let obj: Record<string, unknown>;
    try {
      obj = deserializeTLObject(data);
    } catch (e) {
      this.emit('error', new ProtocolError(`Failed to deserialize frame: ${e}`));
      return;
    }

    const type = obj['_type'] as string;

    switch (type) {
      case 'tcp.pong':
        // Keepalive response — ignore
        break;

      case 'tcp.ping': {
        // Server asking us for keepalive — respond with pong
        if (this.conn) {
          const pong = { _type: 'tcp.pong', id: obj['id'] };
          this.conn.send(serializeTLObject(pong as unknown as Record<string, unknown>));
        }
        break;
      }

      case 'tcp.queryAnswer': {
        const queryId = obj['id'] as bigint;
        this.emit(`queryAnswer:${queryId}`, { data: obj['data'] });
        break;
      }

      case 'tcp.queryError': {
        const queryId = obj['id'] as bigint;
        this.emit(`queryAnswer:${queryId}`, {
          error: { code: obj['code'] as number, message: obj['message'] as string },
        });
        break;
      }

      case 'tcp.packet': {
        // Unwrap tcp.packet data and process inner TL object
        const innerData = obj['data'] as Buffer;
        if (innerData.length === 0) break;

        let innerObj: Record<string, unknown>;
        try {
          innerObj = deserializeTLObject(innerData);
        } catch (e) {
          this.emit('error', new ProtocolError(`Failed to deserialize inner packet: ${e}`));
          return;
        }

        this.handleInnerPacket(innerObj);
        break;
      }

      default:
        this.emit('error', new ProtocolError(`Unexpected frame type: ${type}`));
    }
  }

  private handleInnerPacket(obj: Record<string, unknown>): void {
    const type = obj['_type'] as string;

    if (
      type === 'client.queryAnswerEx' ||
      type === 'client.queryAnswerErrorEx' ||
      type === 'client.queryAnswerPartEx'
    ) {
      const requestId = (obj['requestId'] as Buffer).toString('hex');
      const pending = this.pendingQueries.get(requestId);
      if (!pending) {
        return;
      }

      const answer = obj as unknown as ClientQueryAnswerExType;

      if (type === 'client.queryAnswerPartEx') {
        // Streaming part
        pending.onPart?.(answer);
      } else if (type === 'client.queryAnswerEx') {
        // Final answer (may also contain data for streaming)
        pending.onPart?.(answer);
        clearTimeout(pending.timer);
        this.pendingQueries.delete(requestId);
        pending.resolve(answer);
      } else if (type === 'client.queryAnswerErrorEx') {
        // Error
        clearTimeout(pending.timer);
        this.pendingQueries.delete(requestId);
        pending.resolve(answer);
      }
    }
  }

  private startKeepalive(): void {
    // Send ping every 10 seconds
    this.keepaliveTimer = setInterval(() => {
      if (this.conn?.isConnected) {
        const pingId = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
        const ping = { _type: 'tcp.ping', id: pingId };
        try {
          this.conn.send(serializeTLObject(ping as unknown as Record<string, unknown>));
        } catch {
          // Connection may have been closed
        }
      }
    }, 10_000);
  }

  private cleanup(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    for (const [, pending] of this.pendingQueries) {
      clearTimeout(pending.timer);
      pending.reject(new ConnectionError('Connection closed'));
    }
    this.pendingQueries.clear();
  }
}

/**
 * Helper to build an HTTP request TL object for inference.
 */
export function buildHttpRequest(
  method: string,
  url: string,
  body: Buffer,
  extraHeaders: HttpHeader[] = [],
): HttpRequest {
  const headers: HttpHeader[] = [
    { _type: 'http.header', name: 'Content-Type', value: 'application/json' },
    { _type: 'http.header', name: 'Content-Length', value: body.length.toString() },
    ...extraHeaders,
  ];

  return {
    _type: 'http.request',
    method,
    url,
    httpVersion: 'HTTP/1.1',
    headers,
    payload: body,
  };
}
