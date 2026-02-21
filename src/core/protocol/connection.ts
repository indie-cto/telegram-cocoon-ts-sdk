/**
 * TCP + TLS connection with Cocoon framing.
 *
 * Frame format: [4 bytes LE size][4 bytes LE seqno][payload]
 * Where `size` is the length of `payload` only.
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { ConnectionError } from '../error.js';

export interface ConnectionOptions {
  host: string;
  port: number;
  useTls?: boolean;
  timeout?: number;
}

export type ConnectionEvent =
  | { type: 'data'; seqno: number; data: Buffer }
  | { type: 'close'; error?: Error }
  | { type: 'ready' };

export class CocoonConnection extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private outSeqno = 0;
  private inSeqno = 0;
  private readBuffer = Buffer.alloc(0);
  private connected = false;
  private destroyed = false;

  private readonly host: string;
  private readonly port: number;
  private readonly useTls: boolean;
  private readonly timeout: number;

  constructor(options: ConnectionOptions) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.useTls = options.useTls ?? true;
    this.timeout = options.timeout ?? 120_000;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        this.connected = true;
        this.emit('ready');
        resolve();
      };

      const onError = (err: Error) => {
        reject(
          new ConnectionError(
            `Failed to connect to ${this.host}:${this.port}: ${err.message}`,
            err,
          ),
        );
      };

      if (this.useTls) {
        this.socket = tls.connect(
          {
            host: this.host,
            port: this.port,
            rejectUnauthorized: false, // Cocoon uses custom TDX attestation, not standard CA
          },
          onConnect,
        );
      } else {
        this.socket = net.connect({ host: this.host, port: this.port }, onConnect);
      }

      this.socket.setTimeout(this.timeout);
      this.socket.once('error', onError);

      this.socket.on('data', (data: Buffer) => this.onData(data));
      this.socket.on('close', () => this.onClose());
      this.socket.on('timeout', () => {
        this.destroy(new ConnectionError('Connection timed out'));
      });
      this.socket.on('error', (err: Error) => {
        if (this.connected) {
          this.destroy(new ConnectionError(`Socket error: ${err.message}`, err));
        }
      });
    });
  }

  /**
   * Send a framed packet: [4b size][4b seqno][payload]
   */
  send(payload: Buffer): void {
    if (!this.socket || this.destroyed) {
      throw new ConnectionError('Not connected');
    }

    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt32LE(payload.length, 0); // size
    frame.writeInt32LE(this.outSeqno, 4); // seqno
    payload.copy(frame, 8);

    this.outSeqno++;
    this.socket.write(frame);
  }

  destroy(error?: Error): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connected = false;

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.emit('close', error);
  }

  get isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  private onData(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    this.processFrames();
  }

  private processFrames(): void {
    while (this.readBuffer.length >= 8) {
      const size = this.readBuffer.readUInt32LE(0);

      if (size > 1 << 24 || size < 0) {
        this.destroy(new ConnectionError(`Invalid frame size: ${size}`));
        return;
      }

      const totalFrameSize = 8 + size;
      if (this.readBuffer.length < totalFrameSize) {
        break; // Wait for more data
      }

      const seqno = this.readBuffer.readInt32LE(4);
      if (seqno !== this.inSeqno) {
        this.destroy(
          new ConnectionError(`Sequence number mismatch: expected ${this.inSeqno}, got ${seqno}`),
        );
        return;
      }

      const payload = Buffer.alloc(size);
      this.readBuffer.copy(payload, 0, 8, totalFrameSize);
      this.readBuffer = this.readBuffer.subarray(totalFrameSize);

      this.inSeqno++;
      this.emit('frame', payload);
    }
  }

  private onClose(): void {
    if (!this.destroyed) {
      this.destroy();
    }
  }
}
