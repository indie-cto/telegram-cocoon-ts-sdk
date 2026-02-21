import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CocoonConnection } from '../../src/core/protocol/connection';

// We'll test the connection's frame logic by directly calling internal methods
// via the socket mock

class FakeSocket extends EventEmitter {
  destroyed = false;
  written: Buffer[] = [];
  timeoutMs = 0;

  write(data: Buffer): boolean {
    this.written.push(Buffer.from(data));
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    // Delay close emission like real sockets
    process.nextTick(() => this.emit('close'));
  }

  setTimeout(ms: number): void {
    this.timeoutMs = ms;
  }
}

// Helper to create a frame buffer: [4b size LE][4b seqno LE][payload]
function createFrame(seqno: number, payload: Buffer): Buffer {
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  frame.writeInt32LE(seqno, 4);
  payload.copy(frame, 8);
  return frame;
}

describe('CocoonConnection', () => {
  let conn: CocoonConnection;
  let fakeSocket: FakeSocket;

  beforeEach(() => {
    fakeSocket = new FakeSocket();

    // Create connection with plain TCP
    conn = new CocoonConnection({ host: 'localhost', port: 8080, useTls: false });

    // Replace connect to inject fake socket
    vi.spyOn(conn, 'connect').mockImplementation(async () => {
      // Simulate what connect() does internally
      (conn as unknown as { socket: FakeSocket }).socket = fakeSocket;
      (conn as unknown as { connected: boolean }).connected = true;
      (conn as unknown as { destroyed: boolean }).destroyed = false;

      // Wire up data handler
      fakeSocket.on('data', (data: Buffer) => {
        (conn as unknown as { onData: (d: Buffer) => void }).onData(data);
      });
      fakeSocket.on('close', () => {
        (conn as unknown as { onClose: () => void }).onClose();
      });

      conn.emit('ready');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('frame serialization (send)', () => {
    it('should write frame with [size][seqno][payload]', async () => {
      await conn.connect();
      const payload = Buffer.from('hello');
      conn.send(payload);

      expect(fakeSocket.written).toHaveLength(1);
      const frame = fakeSocket.written[0]!;
      expect(frame.readUInt32LE(0)).toBe(5); // size
      expect(frame.readInt32LE(4)).toBe(0); // seqno
      expect(frame.subarray(8).toString()).toBe('hello');
    });

    it('should increment outgoing seqno', async () => {
      await conn.connect();
      conn.send(Buffer.from('a'));
      conn.send(Buffer.from('b'));
      conn.send(Buffer.from('c'));

      expect(fakeSocket.written[0]!.readInt32LE(4)).toBe(0);
      expect(fakeSocket.written[1]!.readInt32LE(4)).toBe(1);
      expect(fakeSocket.written[2]!.readInt32LE(4)).toBe(2);
    });
  });

  describe('incoming frame parsing', () => {
    it('should emit frame events for valid incoming frames', async () => {
      await conn.connect();
      const frames: Buffer[] = [];
      conn.on('frame', (data: Buffer) => frames.push(data));

      const payload = Buffer.from('test data');
      fakeSocket.emit('data', createFrame(0, payload));

      expect(frames).toHaveLength(1);
      expect(frames[0]!.toString()).toBe('test data');
    });

    it('should handle partial frame buffering', async () => {
      await conn.connect();
      const frames: Buffer[] = [];
      conn.on('frame', (data: Buffer) => frames.push(data));

      const payload = Buffer.from('hello world');
      const frame = createFrame(0, payload);

      // Split the frame into two chunks
      const firstHalf = frame.subarray(0, 6);
      const secondHalf = frame.subarray(6);

      fakeSocket.emit('data', firstHalf);
      expect(frames).toHaveLength(0); // Not enough data yet

      fakeSocket.emit('data', secondHalf);
      expect(frames).toHaveLength(1);
      expect(frames[0]!.toString()).toBe('hello world');
    });

    it('should handle multiple frames in single chunk', async () => {
      await conn.connect();
      const frames: Buffer[] = [];
      conn.on('frame', (data: Buffer) => frames.push(data));

      const frame1 = createFrame(0, Buffer.from('first'));
      const frame2 = createFrame(1, Buffer.from('second'));
      const combined = Buffer.concat([frame1, frame2]);

      fakeSocket.emit('data', combined);

      expect(frames).toHaveLength(2);
      expect(frames[0]!.toString()).toBe('first');
      expect(frames[1]!.toString()).toBe('second');
    });

    it('should error on seqno mismatch', async () => {
      await conn.connect();
      const closeErrors: (Error | undefined)[] = [];
      conn.on('close', (err?: Error) => closeErrors.push(err));

      // Send frame with seqno 5 when expecting 0
      fakeSocket.emit('data', createFrame(5, Buffer.from('bad')));

      // Should have destroyed and emitted close
      await vi.waitFor(() => expect(closeErrors.length).toBeGreaterThan(0));
      expect(closeErrors[0]?.message).toContain('Sequence number mismatch');
    });

    it('should error on invalid frame size (too large)', async () => {
      await conn.connect();
      const closeErrors: (Error | undefined)[] = [];
      conn.on('close', (err?: Error) => closeErrors.push(err));

      // Create a frame header with impossibly large size
      const badFrame = Buffer.alloc(8);
      badFrame.writeUInt32LE(1 << 25, 0); // > 16MB
      badFrame.writeInt32LE(0, 4);

      fakeSocket.emit('data', badFrame);
      await vi.waitFor(() => expect(closeErrors.length).toBeGreaterThan(0));
      expect(closeErrors[0]?.message).toContain('Invalid frame size');
    });
  });

  describe('send when not connected', () => {
    it('should throw ConnectionError', () => {
      // Don't call connect()
      const freshConn = new CocoonConnection({
        host: 'localhost',
        port: 8080,
        useTls: false,
      });
      expect(() => freshConn.send(Buffer.from('test'))).toThrow('Not connected');
    });
  });

  describe('destroy', () => {
    it('should be idempotent', async () => {
      await conn.connect();
      conn.destroy();
      conn.destroy(); // Should not throw
      expect(conn.isConnected).toBe(false);
    });

    it('should emit close event', async () => {
      await conn.connect();
      let closeEmitted = false;
      conn.on('close', () => {
        closeEmitted = true;
      });
      conn.destroy();
      expect(closeEmitted).toBe(true);
    });

    it('should set isConnected to false', async () => {
      await conn.connect();
      expect(conn.isConnected).toBe(true);
      conn.destroy();
      expect(conn.isConnected).toBe(false);
    });

    it('should pass error to close event', async () => {
      await conn.connect();
      let closeError: Error | undefined;
      conn.on('close', (err?: Error) => {
        closeError = err;
      });
      const error = new Error('test error');
      conn.destroy(error);
      expect(closeError).toBe(error);
    });
  });

  describe('isConnected getter', () => {
    it('should be false initially', () => {
      const freshConn = new CocoonConnection({
        host: 'localhost',
        port: 8080,
      });
      expect(freshConn.isConnected).toBe(false);
    });

    it('should be true after connect', async () => {
      await conn.connect();
      expect(conn.isConnected).toBe(true);
    });

    it('should be false after destroy', async () => {
      await conn.connect();
      conn.destroy();
      expect(conn.isConnected).toBe(false);
    });
  });

  describe('constructor defaults', () => {
    it('should default useTls to true', () => {
      const c = new CocoonConnection({ host: 'test', port: 443 });
      expect((c as unknown as { useTls: boolean }).useTls).toBe(true);
    });

    it('should default timeout to 120000', () => {
      const c = new CocoonConnection({ host: 'test', port: 443 });
      expect((c as unknown as { timeout: number }).timeout).toBe(120_000);
    });
  });

  describe('empty payload frame', () => {
    it('should handle zero-length payload', async () => {
      await conn.connect();
      const frames: Buffer[] = [];
      conn.on('frame', (data: Buffer) => frames.push(data));

      fakeSocket.emit('data', createFrame(0, Buffer.alloc(0)));
      expect(frames).toHaveLength(1);
      expect(frames[0]!.length).toBe(0);
    });
  });
});
