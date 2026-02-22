import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serializeTLObject } from '../../src/core/tl/serializer';
import { deserializeTLObject } from '../../src/core/tl/deserializer';
import type { HttpHeader } from '../../src/core/tl/types';

// Use vi.hoisted so the mock fn is available to hoisted vi.mock factories
const { mockPerformHandshake } = vi.hoisted(() => ({
  mockPerformHandshake: vi.fn(),
}));

// Mock crypto to produce safe values within signed int64 range
let cryptoCallCount = 0;
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: {
      ...actual,
      randomBytes: (size: number) => {
        cryptoCallCount++;
        const buf = Buffer.alloc(size);
        if (size === 8) {
          buf.writeBigUInt64BE(BigInt(cryptoCallCount), 0);
        } else if (size === 32) {
          buf.writeUInt32BE(cryptoCallCount, 0);
        }
        return buf;
      },
    },
  };
});

// Mock connection and handshake
vi.mock('../../src/core/protocol/connection', async () => {
  const { EventEmitter } = await import('node:events');

  class MockConnection extends EventEmitter {
    socket = null;
    connected = true;
    destroyed = false;
    sentData: Buffer[] = [];

    constructor() {
      super();
    }

    async connect(): Promise<void> {
      this.connected = true;
    }

    send(data: Buffer): void {
      this.sentData.push(Buffer.from(data));
    }

    destroy(): void {
      this.destroyed = true;
      this.connected = false;
    }

    get isConnected(): boolean {
      return this.connected && !this.destroyed;
    }
  }

  return { CocoonConnection: MockConnection };
});

vi.mock('../../src/core/protocol/handshake', () => ({
  performHandshake: mockPerformHandshake,
}));

import { EventEmitter } from 'node:events';
import { buildHttpRequest, CocoonSession } from '../../src/core/protocol/session';

describe('buildHttpRequest', () => {
  it('should build correct HTTP request with default headers', () => {
    const body = Buffer.from('{"test":true}');
    const req = buildHttpRequest('POST', '/v1/chat/completions', body);

    expect(req._type).toBe('http.request');
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/chat/completions');
    expect(req.httpVersion).toBe('HTTP/1.1');
    expect(req.payload).toEqual(body);
  });

  it('should include Content-Type and Content-Length headers', () => {
    const body = Buffer.from('test body');
    const req = buildHttpRequest('POST', '/api', body);

    const contentType = req.headers.find((h) => h.name === 'Content-Type');
    const contentLength = req.headers.find((h) => h.name === 'Content-Length');

    expect(contentType?.value).toBe('application/json');
    expect(contentLength?.value).toBe(body.length.toString());
    const host = req.headers.find((h) => h.name === 'Host');
    expect(host?.value).toBe('api.openai.com');
  });

  it('should include extra headers', () => {
    const extra: HttpHeader[] = [{ _type: 'http.header', name: 'X-Custom', value: 'test' }];
    const req = buildHttpRequest('GET', '/api', Buffer.alloc(0), extra);

    const custom = req.headers.find((h) => h.name === 'X-Custom');
    expect(custom?.value).toBe('test');
    expect(req.headers.length).toBe(4); // Content-Type + Content-Length + Host + X-Custom
  });

  it('should handle GET with empty body', () => {
    const req = buildHttpRequest('GET', '/models', Buffer.alloc(0));
    expect(req.method).toBe('GET');
    expect(req.payload.length).toBe(0);
    const contentLength = req.headers.find((h) => h.name === 'Content-Length');
    expect(contentLength?.value).toBe('0');
  });

  it('should not duplicate Host when provided in extra headers', () => {
    const req = buildHttpRequest('POST', '/api', Buffer.from('{}'), [
      { _type: 'http.header', name: 'Host', value: 'localhost' },
    ]);
    const hosts = req.headers.filter((h) => h.name.toLowerCase() === 'host');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.value).toBe('localhost');
  });
});

describe('CocoonSession', () => {
  let session: CocoonSession;

  beforeEach(() => {
    vi.useFakeTimers();
    cryptoCallCount = 0;

    mockPerformHandshake.mockResolvedValue({
      proxyParams: {
        _type: 'proxy.params',
        flags: 0,
        proxyPublicKey: Buffer.alloc(32),
        proxyOwnerAddress: 'EQProxy',
        proxyScAddress: 'EQProxySC',
      },
      clientScAddress: 'EQClient',
      signedPayment: { _type: 'proxy.signedPaymentEmpty' },
      tokensCommittedToDb: 1000n,
      maxTokens: 10000n,
      protoVersion: 1,
    });

    session = new CocoonSession({
      host: 'localhost',
      port: 8080,
      useTls: false,
      ownerAddress: 'EQOwner',
      secretString: 'secret',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('should set connected to true after connect', async () => {
      await session.connect();
      expect(session.connected).toBe(true);
    });

    it('should be idempotent', async () => {
      await session.connect();
      await session.connect(); // Should not throw
      expect(session.connected).toBe(true);
    });

    it('should report protoVersion from handshake', async () => {
      await session.connect();
      expect(session.protoVersion).toBe(1);
    });
  });

  describe('sendRpcQuery', () => {
    it('should throw ConnectionError when not connected', async () => {
      await expect(session.sendRpcQuery({ _type: 'client.getWorkerTypesV2' })).rejects.toThrow(
        'Not connected',
      );
    });

    it('should send tcp.query and resolve on queryAnswer event', async () => {
      await session.connect();

      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const resultPromise = session.sendRpcQuery({ _type: 'client.getWorkerTypesV2' }, 30_000);

      const sent = conn.sentData[conn.sentData.length - 1]!;
      const sentObj = deserializeTLObject(sent);
      expect(sentObj['_type']).toBe('tcp.query');
      const queryId = sentObj['id'] as bigint;

      const responseData = serializeTLObject({
        _type: 'client.workerTypesV2',
        types: [],
      } as unknown as Record<string, unknown>);

      session.emit(`queryAnswer:${queryId}`, { data: responseData });

      const result = await resultPromise;
      expect(result['_type']).toBe('client.workerTypesV2');
    });

    it('should reject on query error', async () => {
      await session.connect();

      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const resultPromise = session.sendRpcQuery({ _type: 'client.getWorkerTypesV2' }, 30_000);

      const sent = conn.sentData[conn.sentData.length - 1]!;
      const sentObj = deserializeTLObject(sent);
      const queryId = sentObj['id'] as bigint;

      session.emit(`queryAnswer:${queryId}`, {
        error: { code: 500, message: 'Server error' },
      });

      await expect(resultPromise).rejects.toThrow('Server error');
    });

    it('should reject on timeout', async () => {
      await session.connect();

      const resultPromise = session.sendRpcQuery({ _type: 'client.getWorkerTypesV2' }, 5_000);

      vi.advanceTimersByTime(5001);

      await expect(resultPromise).rejects.toThrow('RPC query timed out');
    });
  });

  describe('sendQuery', () => {
    it('should throw ConnectionError when not connected', async () => {
      const httpReq = buildHttpRequest('POST', '/v1/chat/completions', Buffer.from('{}'));
      await expect(session.sendQuery('model', httpReq)).rejects.toThrow('Not connected');
    });

    it('should send tcp.packet containing client.runQueryEx', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const httpReq = buildHttpRequest('POST', '/v1/chat/completions', Buffer.from('{}'));

      const queryPromise = session.sendQuery('test-model', httpReq, { timeout: 60_000 });

      const sentItems = conn.sentData;
      const lastSent = sentItems[sentItems.length - 1]!;
      const outerObj = deserializeTLObject(lastSent);
      expect(outerObj['_type']).toBe('tcp.packet');

      const innerData = outerObj['data'] as Buffer;
      const innerObj = deserializeTLObject(innerData);
      expect(innerObj['_type']).toBe('client.runQueryEx');
      expect(innerObj['modelName']).toBe('test-model');

      vi.advanceTimersByTime(60_001);
      await expect(queryPromise).rejects.toThrow('Query timed out');
    });
  });

  describe('handleFrame routing', () => {
    it('should respond to tcp.ping with tcp.pong', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const pingData = serializeTLObject({
        _type: 'tcp.ping',
        id: 999n,
      } as unknown as Record<string, unknown>);

      conn.emit('frame', pingData);

      const lastSent = conn.sentData[conn.sentData.length - 1]!;
      const pong = deserializeTLObject(lastSent);
      expect(pong['_type']).toBe('tcp.pong');
      expect(pong['id']).toBe(999n);
    });

    it('should silently ignore tcp.pong', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const pongData = serializeTLObject({
        _type: 'tcp.pong',
        id: 123n,
      } as unknown as Record<string, unknown>);

      const sentBefore = conn.sentData.length;
      conn.emit('frame', pongData);
      expect(conn.sentData.length).toBe(sentBefore);
    });

    it('should route tcp.queryAnswer events', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      let receivedEvent = false;
      const queryId = 42n;

      session.on(`queryAnswer:${queryId}`, () => {
        receivedEvent = true;
      });

      const answerData = serializeTLObject({
        _type: 'tcp.queryAnswer',
        id: queryId,
        data: Buffer.from('response'),
      } as unknown as Record<string, unknown>);

      conn.emit('frame', answerData);
      expect(receivedEvent).toBe(true);
    });

    it('should route tcp.queryError events', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      let receivedError: { code: number; message: string } | undefined;
      const queryId = 42n;

      session.on(
        `queryAnswer:${queryId}`,
        (result: { error?: { code: number; message: string } }) => {
          receivedError = result.error;
        },
      );

      const errorData = serializeTLObject({
        _type: 'tcp.queryError',
        id: queryId,
        code: 500,
        message: 'test error',
      } as unknown as Record<string, unknown>);

      conn.emit('frame', errorData);
      expect(receivedError?.code).toBe(500);
      expect(receivedError?.message).toBe('test error');
    });

    it('should ignore empty frames', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const sentBefore = conn.sentData.length;
      conn.emit('frame', Buffer.alloc(0));
      expect(conn.sentData.length).toBe(sentBefore);
    });
  });

  describe('disconnect', () => {
    it('should clear session state', async () => {
      await session.connect();
      expect(session.connected).toBe(true);

      await session.disconnect();
      expect(session.connected).toBe(false);
    });

    it('should be safe to call when not connected', async () => {
      await session.disconnect(); // Should not throw
    });
  });

  describe('keepalive', () => {
    it('should send tcp.ping periodically', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      const sentBefore = conn.sentData.length;
      vi.advanceTimersByTime(10_001);

      const newSent = conn.sentData.slice(sentBefore);
      expect(newSent.length).toBeGreaterThan(0);

      const lastObj = deserializeTLObject(newSent[newSent.length - 1]!);
      expect(lastObj['_type']).toBe('tcp.ping');
    });

    it('should stop keepalive after disconnect', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter & { sentData: Buffer[] } }).conn;

      await session.disconnect();
      const sentAfterDisconnect = conn.sentData.length;

      vi.advanceTimersByTime(30_000);
      expect(conn.sentData.length).toBe(sentAfterDisconnect);
    });
  });

  describe('cleanup on connection close', () => {
    it('should reject pending queries on close', async () => {
      await session.connect();
      const conn = (session as unknown as { conn: EventEmitter }).conn;

      const httpReq = buildHttpRequest('POST', '/v1/chat/completions', Buffer.from('{}'));
      const queryPromise = session.sendQuery('model', httpReq, { timeout: 60_000 });

      conn.emit('close', new Error('connection lost'));

      await expect(queryPromise).rejects.toThrow('Connection closed');
    });
  });
});
