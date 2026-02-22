import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { serializeTLObject } from '../../src/core/tl/serializer';
import { deserializeTLObject } from '../../src/core/tl/deserializer';
import crypto from 'node:crypto';

// Test the individual helper functions by importing them directly
import { sendQuery, waitForFrame, waitForQueryAnswer } from '../../src/core/protocol/handshake';
import type { CocoonConnection } from '../../src/core/protocol/connection';

class MockConnection extends EventEmitter {
  sentData: Buffer[] = [];
  destroyed = false;

  send(data: Buffer): void {
    this.sentData.push(Buffer.from(data));
  }

  destroy(): void {
    this.destroyed = true;
  }

  get isConnected(): boolean {
    return !this.destroyed;
  }
}

describe('sendQuery', () => {
  it('should serialize a tcp.query with the given id and data', () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const queryId = 12345n;
    const data = Buffer.from('test payload');

    sendQuery(mockConn, queryId, data);

    expect((mockConn as unknown as MockConnection).sentData).toHaveLength(1);
    const sent = (mockConn as unknown as MockConnection).sentData[0]!;

    // Deserialize and verify
    const obj = deserializeTLObject(sent);
    expect(obj['_type']).toBe('tcp.query');
    expect(obj['id']).toBe(12345n);
    expect(obj['data']).toEqual(data);
  });
});

describe('waitForFrame', () => {
  it('should resolve on frame event', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const frameData = Buffer.from('frame content');

    const promise = waitForFrame(mockConn, 5000);
    (mockConn as unknown as MockConnection).emit('frame', frameData);

    const result = await promise;
    expect(result).toEqual(frameData);
  });

  it('should reject on timeout', async () => {
    vi.useFakeTimers();
    const mockConn = new MockConnection() as unknown as CocoonConnection;

    const promise = waitForFrame(mockConn, 1000);
    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow('Timeout waiting for frame');
    vi.useRealTimers();
  });

  it('should reject immediately on connection close', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const promise = waitForFrame(mockConn, 10_000);

    (mockConn as unknown as MockConnection).emit('close');

    await expect(promise).rejects.toThrow('Connection closed while waiting for handshake frame');
  });
});

describe('waitForQueryAnswer', () => {
  it('should resolve with data from matching tcp.queryAnswer', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const queryId = 42n;
    const answerData = Buffer.from('answer');

    const promise = waitForQueryAnswer(mockConn, queryId, 5000);

    // Emit a tcp.queryAnswer frame
    const answerObj = { _type: 'tcp.queryAnswer', id: queryId, data: answerData };
    const frame = serializeTLObject(answerObj as unknown as Record<string, unknown>);
    (mockConn as unknown as MockConnection).emit('frame', frame);

    const result = await promise;
    expect(result).toEqual(answerData);
  });

  it('should reject on matching tcp.queryError', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const queryId = 42n;

    const promise = waitForQueryAnswer(mockConn, queryId, 5000);

    const errorObj = {
      _type: 'tcp.queryError',
      id: queryId,
      code: 500,
      message: 'Internal error',
    };
    const frame = serializeTLObject(errorObj as unknown as Record<string, unknown>);
    (mockConn as unknown as MockConnection).emit('frame', frame);

    await expect(promise).rejects.toThrow('Query error: Internal error');
  });

  it('should ignore tcp.pong and keep listening', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const queryId = 42n;
    const answerData = Buffer.from('real answer');

    const promise = waitForQueryAnswer(mockConn, queryId, 5000);

    // First, emit a tcp.pong (should be ignored)
    const pongObj = { _type: 'tcp.pong', id: 999n };
    const pongFrame = serializeTLObject(pongObj as unknown as Record<string, unknown>);
    (mockConn as unknown as MockConnection).emit('frame', pongFrame);

    // Then emit the actual answer
    const answerObj = { _type: 'tcp.queryAnswer', id: queryId, data: answerData };
    const answerFrame = serializeTLObject(answerObj as unknown as Record<string, unknown>);
    (mockConn as unknown as MockConnection).emit('frame', answerFrame);

    const result = await promise;
    expect(result).toEqual(answerData);
  });

  it('should ignore answers for different query IDs', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;
    const queryId = 42n;
    const otherQueryId = 99n;
    const answerData = Buffer.from('correct answer');

    const promise = waitForQueryAnswer(mockConn, queryId, 5000);

    // Emit answer for a different query ID
    const wrongAnswer = {
      _type: 'tcp.queryAnswer',
      id: otherQueryId,
      data: Buffer.from('wrong'),
    };
    (mockConn as unknown as MockConnection).emit(
      'frame',
      serializeTLObject(wrongAnswer as unknown as Record<string, unknown>),
    );

    // Then emit the correct answer
    const correctAnswer = {
      _type: 'tcp.queryAnswer',
      id: queryId,
      data: answerData,
    };
    (mockConn as unknown as MockConnection).emit(
      'frame',
      serializeTLObject(correctAnswer as unknown as Record<string, unknown>),
    );

    const result = await promise;
    expect(result).toEqual(answerData);
  });

  it('should reject on timeout', async () => {
    vi.useFakeTimers();
    const mockConn = new MockConnection() as unknown as CocoonConnection;

    const promise = waitForQueryAnswer(mockConn, 42n, 1000);
    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow('Timeout waiting for query answer');
    vi.useRealTimers();
  });

  it('should reject immediately on connection close', async () => {
    const mockConn = new MockConnection() as unknown as CocoonConnection;

    const promise = waitForQueryAnswer(mockConn, 42n, 10_000);
    (mockConn as unknown as MockConnection).emit('close');

    await expect(promise).rejects.toThrow('Connection closed while waiting for query answer');
  });
});

describe('performHandshake flow', () => {
  // Mock crypto.randomBytes to return values within signed int64 range
  // (performHandshake converts 8 random bytes to BigInt via hex, which can overflow signed int64)
  let randomBytesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Return predictable small values: 0x0000000000000001 (8 bytes)
    let callCount = 0;
    randomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockImplementation(((size: number) => {
      callCount++;
      const buf = Buffer.alloc(size);
      // Write a small incrementing value that fits in signed int64
      if (size === 8) {
        buf.writeBigUInt64BE(BigInt(callCount), 0);
      }
      return buf;
    }) as typeof crypto.randomBytes);
  });

  afterEach(() => {
    randomBytesSpy.mockRestore();
  });

  it('should complete with short auth when secret hash matches', async () => {
    const { performHandshake } = await import('../../src/core/protocol/handshake');
    const mockConn = new MockConnection();
    const secretString = 'test-secret';
    const secretHash = crypto.createHash('sha256').update(secretString).digest();

    // Set up auto-responder for the mock connection
    let stepCount = 0;

    mockConn.send = function (data: Buffer) {
      this.sentData.push(Buffer.from(data));
      const obj = deserializeTLObject(data);

      if (obj['_type'] === 'tcp.connect') {
        // Respond with tcp.connected
        stepCount++;
        const response = { _type: 'tcp.connected', id: obj['id'] };
        const responseData = serializeTLObject(response as unknown as Record<string, unknown>);
        process.nextTick(() => mockConn.emit('frame', responseData));
      } else if (obj['_type'] === 'tcp.query') {
        const innerData = obj['data'] as Buffer;
        const innerObj = deserializeTLObject(innerData);

        if (innerObj['_type'] === 'client.connectToProxy') {
          stepCount++;
          // Respond with client.connectedToProxy
          const proxyParams = {
            _type: 'proxy.params',
            flags: 0,
            proxyPublicKey: Buffer.alloc(32),
            proxyOwnerAddress: 'EQProxy',
            proxyScAddress: 'EQProxySC',
          };
          const connected = {
            _type: 'client.connectedToProxy',
            params: proxyParams,
            clientScAddress: 'EQClient',
            auth: {
              _type: 'client.proxyConnectionAuthShort',
              secretHash,
              nonce: 1234n,
            },
            signedPayment: { _type: 'proxy.signedPaymentEmpty' },
          };
          const responseData = serializeTLObject(connected as unknown as Record<string, unknown>);
          const tcpAnswer = {
            _type: 'tcp.queryAnswer',
            id: obj['id'],
            data: responseData,
          };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        } else if (innerObj['_type'] === 'client.authorizeWithProxyShort') {
          stepCount++;
          // Respond with auth success
          const authSuccess = {
            _type: 'client.authorizationWithProxySuccess',
            signedPayment: { _type: 'proxy.signedPaymentEmpty' },
            tokensCommittedToDb: 1000n,
            maxTokens: 10000n,
          };
          const responseData = serializeTLObject(authSuccess as unknown as Record<string, unknown>);
          const tcpAnswer = {
            _type: 'tcp.queryAnswer',
            id: obj['id'],
            data: responseData,
          };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        }
      }
    };

    const result = await performHandshake(
      mockConn as unknown as CocoonConnection,
      'EQOwner',
      secretString,
      0,
    );

    expect(result.clientScAddress).toBe('EQClient');
    expect(result.tokensCommittedToDb).toBe(1000n);
    expect(result.maxTokens).toBe(10000n);
    expect(stepCount).toBe(3);
  });

  it('should throw AuthenticationError on auth failure', async () => {
    const { performHandshake } = await import('../../src/core/protocol/handshake');
    const mockConn = new MockConnection();
    const secretString = 'test-secret';
    const secretHash = crypto.createHash('sha256').update(secretString).digest();

    mockConn.send = function (data: Buffer) {
      this.sentData.push(Buffer.from(data));
      const obj = deserializeTLObject(data);

      if (obj['_type'] === 'tcp.connect') {
        const response = { _type: 'tcp.connected', id: obj['id'] };
        process.nextTick(() =>
          mockConn.emit('frame', serializeTLObject(response as unknown as Record<string, unknown>)),
        );
      } else if (obj['_type'] === 'tcp.query') {
        const innerData = obj['data'] as Buffer;
        const innerObj = deserializeTLObject(innerData);

        if (innerObj['_type'] === 'client.connectToProxy') {
          const connected = {
            _type: 'client.connectedToProxy',
            params: {
              _type: 'proxy.params',
              flags: 0,
              proxyPublicKey: Buffer.alloc(32),
              proxyOwnerAddress: 'EQProxy',
              proxyScAddress: 'EQProxySC',
            },
            clientScAddress: 'EQClient',
            auth: {
              _type: 'client.proxyConnectionAuthShort',
              secretHash,
              nonce: 1234n,
            },
            signedPayment: { _type: 'proxy.signedPaymentEmpty' },
          };
          const responseData = serializeTLObject(connected as unknown as Record<string, unknown>);
          const tcpAnswer = { _type: 'tcp.queryAnswer', id: obj['id'], data: responseData };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        } else if (innerObj['_type'] === 'client.authorizeWithProxyShort') {
          // Return auth failed
          const authFailed = {
            _type: 'client.authorizationWithProxyFailed',
            errorCode: 401,
            error: 'Invalid secret',
          };
          const responseData = serializeTLObject(authFailed as unknown as Record<string, unknown>);
          const tcpAnswer = { _type: 'tcp.queryAnswer', id: obj['id'], data: responseData };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        }
      }
    };

    await expect(
      performHandshake(mockConn as unknown as CocoonConnection, 'EQOwner', secretString, 0),
    ).rejects.toThrow('Proxy auth failed');
  });

  it('should throw ProtocolError if tcp.connected not received', async () => {
    const { performHandshake } = await import('../../src/core/protocol/handshake');
    const mockConn = new MockConnection();

    mockConn.send = function (data: Buffer) {
      this.sentData.push(Buffer.from(data));
      const obj = deserializeTLObject(data);

      if (obj['_type'] === 'tcp.connect') {
        // Respond with wrong type
        const response = { _type: 'tcp.pong', id: obj['id'] };
        process.nextTick(() =>
          mockConn.emit('frame', serializeTLObject(response as unknown as Record<string, unknown>)),
        );
      }
    };

    await expect(
      performHandshake(mockConn as unknown as CocoonConnection, 'EQOwner', 'secret', 0),
    ).rejects.toThrow('Expected tcp.connected');
  });

  it('should fall back to long auth when secret hash does not match', async () => {
    const { performHandshake } = await import('../../src/core/protocol/handshake');
    const mockConn = new MockConnection();
    const secretString = 'my-secret';
    // Use a different hash to force mismatch
    const wrongHash = crypto.createHash('sha256').update('wrong-secret').digest();

    let longAuthCalled = false;

    mockConn.send = function (data: Buffer) {
      this.sentData.push(Buffer.from(data));
      const obj = deserializeTLObject(data);

      if (obj['_type'] === 'tcp.connect') {
        const response = { _type: 'tcp.connected', id: obj['id'] };
        process.nextTick(() =>
          mockConn.emit('frame', serializeTLObject(response as unknown as Record<string, unknown>)),
        );
      } else if (obj['_type'] === 'tcp.query') {
        const innerData = obj['data'] as Buffer;
        const innerObj = deserializeTLObject(innerData);

        if (innerObj['_type'] === 'client.connectToProxy') {
          const connected = {
            _type: 'client.connectedToProxy',
            params: {
              _type: 'proxy.params',
              flags: 0,
              proxyPublicKey: Buffer.alloc(32),
              proxyOwnerAddress: 'EQProxy',
              proxyScAddress: 'EQProxySC',
            },
            clientScAddress: 'EQClient',
            auth: {
              _type: 'client.proxyConnectionAuthShort',
              secretHash: wrongHash, // Mismatched hash
              nonce: 1234n,
            },
            signedPayment: { _type: 'proxy.signedPaymentEmpty' },
          };
          const responseData = serializeTLObject(connected as unknown as Record<string, unknown>);
          const tcpAnswer = { _type: 'tcp.queryAnswer', id: obj['id'], data: responseData };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        } else if (innerObj['_type'] === 'client.authorizeWithProxyLong') {
          longAuthCalled = true;
          // Return auth success for long auth
          const authSuccess = {
            _type: 'client.authorizationWithProxySuccess',
            signedPayment: { _type: 'proxy.signedPaymentEmpty' },
            tokensCommittedToDb: 500n,
            maxTokens: 5000n,
          };
          const responseData = serializeTLObject(authSuccess as unknown as Record<string, unknown>);
          const tcpAnswer = { _type: 'tcp.queryAnswer', id: obj['id'], data: responseData };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        }
      }
    };

    const result = await performHandshake(
      mockConn as unknown as CocoonConnection,
      'EQOwner',
      secretString,
      0,
      async () => {},
    );

    expect(longAuthCalled).toBe(true);
    expect(result.tokensCommittedToDb).toBe(500n);
  });

  it('should fail fast with actionable error when long auth is required but no handler is configured', async () => {
    const { performHandshake } = await import('../../src/core/protocol/handshake');
    const mockConn = new MockConnection();

    mockConn.send = function (data: Buffer) {
      this.sentData.push(Buffer.from(data));
      const obj = deserializeTLObject(data);

      if (obj['_type'] === 'tcp.connect') {
        const response = { _type: 'tcp.connected', id: obj['id'] };
        process.nextTick(() =>
          mockConn.emit('frame', serializeTLObject(response as unknown as Record<string, unknown>)),
        );
      } else if (obj['_type'] === 'tcp.query') {
        const innerData = obj['data'] as Buffer;
        const innerObj = deserializeTLObject(innerData);

        if (innerObj['_type'] === 'client.connectToProxy') {
          const connected = {
            _type: 'client.connectedToProxy',
            params: {
              _type: 'proxy.params',
              flags: 0,
              proxyPublicKey: Buffer.alloc(32),
              proxyOwnerAddress: 'EQProxy',
              proxyScAddress: 'EQProxySC',
            },
            clientScAddress: 'EQClient',
            auth: {
              _type: 'client.proxyConnectionAuthLong',
              nonce: 777n,
            },
            signedPayment: { _type: 'proxy.signedPaymentEmpty' },
          };
          const responseData = serializeTLObject(connected as unknown as Record<string, unknown>);
          const tcpAnswer = { _type: 'tcp.queryAnswer', id: obj['id'], data: responseData };
          process.nextTick(() =>
            mockConn.emit(
              'frame',
              serializeTLObject(tcpAnswer as unknown as Record<string, unknown>),
            ),
          );
        }
      }
    };

    await expect(
      performHandshake(mockConn as unknown as CocoonConnection, 'EQOwner', 'secret', 0),
    ).rejects.toThrow('Proxy requires long auth');
  });
});
