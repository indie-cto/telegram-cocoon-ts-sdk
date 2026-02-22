/**
 * TCP + TLS connection with Cocoon framing.
 *
 * Connection flow:
 * 1. Raw TCP connect
 * 2. Receive PoW challenge (24 bytes), solve it, send response (12 bytes)
 * 3. Upgrade to TLS on same socket
 * 4. TL framing begins: [4 bytes LE size][4 bytes LE seqno][payload]
 *    Where `size` is the length of `payload` only.
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { ConnectionError } from '../error.js';
import {
  parsePowChallenge,
  solvePow,
  buildPowResponse,
  POW_CHALLENGE_SIZE,
  POW_CHALLENGE_MAGIC,
} from './pow.js';

export interface ConnectionOptions {
  host: string;
  port: number;
  useTls?: boolean;
  timeout?: number;
  /** PEM-encoded TLS client certificate (for RA-TLS / mTLS) */
  tlsCert?: string | Buffer;
  /** PEM-encoded TLS client private key (for RA-TLS / mTLS) */
  tlsKey?: string | Buffer;
}

export type ConnectionEvent =
  | { type: 'data'; seqno: number; data: Buffer }
  | { type: 'close'; error?: Error }
  | { type: 'ready' };

export class CocoonConnection extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private rawSocket: net.Socket | null = null;
  private outSeqno = 0;
  private inSeqno = 0;
  private readBuffer = Buffer.alloc(0);
  private connected = false;
  private destroyed = false;

  private readonly host: string;
  private readonly port: number;
  private readonly useTls: boolean;
  private readonly timeout: number;
  private readonly tlsCert?: string | Buffer;
  private readonly tlsKey?: string | Buffer;

  constructor(options: ConnectionOptions) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.useTls = options.useTls ?? true;
    this.timeout = options.timeout ?? 120_000;
    this.tlsCert = options.tlsCert;
    this.tlsKey = options.tlsKey;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.useTls) {
      await this.connectWithPowAndTls();
    } else {
      await this.connectPlainTcp();
    }
  }

  /**
   * Connect with PoW challenge + TLS upgrade (default for Cocoon proxies).
   */
  private async connectWithPowAndTls(): Promise<void> {
    // Step 1: Raw TCP connect
    const rawSocket = await this.rawTcpConnect();
    this.rawSocket = rawSocket;

    try {
      // Step 2: Read PoW challenge and solve it
      await this.handlePow(rawSocket);

      // Step 3: Upgrade to TLS
      this.socket = await this.upgradeTls(rawSocket);
    } catch (err) {
      rawSocket.destroy();
      this.rawSocket = null;
      throw err;
    }

    this.connected = true;
    this.setupSocketHandlers(this.socket);
    this.emit('ready');
  }

  /**
   * Connect with plain TCP (no PoW, no TLS).
   */
  private async connectPlainTcp(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        this.connected = true;
        this.setupSocketHandlers(this.socket!);
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

      this.socket = net.connect({ host: this.host, port: this.port }, onConnect);
      this.socket.setTimeout(this.timeout);
      this.socket.once('error', onError);
    });
  }

  private rawTcpConnect(): Promise<net.Socket> {
    return new Promise<net.Socket>((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port }, () => {
        sock.removeListener('error', onError);
        resolve(sock);
      });

      sock.setTimeout(this.timeout);

      const onError = (err: Error) => {
        reject(
          new ConnectionError(
            `Failed to connect to ${this.host}:${this.port}: ${err.message}`,
            err,
          ),
        );
      };

      sock.once('error', onError);
    });
  }

  private handlePow(sock: net.Socket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let powBuffer = Buffer.alloc(0);

      const timer = setTimeout(() => {
        sock.removeListener('data', onData);
        reject(new ConnectionError('Timeout waiting for PoW challenge'));
      }, 30_000);

      const onData = (chunk: Buffer) => {
        powBuffer = Buffer.concat([powBuffer, chunk]);

        // Check if first 4 bytes are the PoW magic
        if (powBuffer.length >= 4) {
          const magic = powBuffer.readUInt32LE(0);
          if (magic !== POW_CHALLENGE_MAGIC) {
            clearTimeout(timer);
            sock.removeListener('data', onData);
            reject(
              new ConnectionError(
                `Unexpected data from proxy (expected PoW challenge): 0x${magic.toString(16)}`,
              ),
            );
            return;
          }
        }

        if (powBuffer.length >= POW_CHALLENGE_SIZE) {
          clearTimeout(timer);
          sock.removeListener('data', onData);

          try {
            const challenge = parsePowChallenge(powBuffer);
            const nonce = solvePow(challenge);
            const response = buildPowResponse(nonce);
            sock.write(response, (err) => {
              if (err) {
                reject(new ConnectionError(`Failed to send PoW response: ${err.message}`, err));
              } else {
                resolve();
              }
            });
          } catch (err) {
            reject(
              new ConnectionError(
                `PoW failed: ${err instanceof Error ? err.message : err}`,
                err instanceof Error ? err : undefined,
              ),
            );
          }
        }
      };

      sock.on('data', onData);
    });
  }

  private upgradeTls(rawSocket: net.Socket): Promise<tls.TLSSocket> {
    return new Promise<tls.TLSSocket>((resolve, reject) => {
      const tlsOptions: tls.ConnectionOptions = {
        socket: rawSocket,
        rejectUnauthorized: false, // Cocoon uses custom TDX attestation, not standard CA
      };

      // RA-TLS: pass client certificate and key for mTLS
      if (this.tlsCert) tlsOptions.cert = this.tlsCert;
      if (this.tlsKey) tlsOptions.key = this.tlsKey;

      const tlsSocket = tls.connect(tlsOptions);

      const timer = setTimeout(() => {
        cleanup(() => reject(new ConnectionError('TLS handshake timeout')));
      }, this.timeout);

      const cleanup = (next?: () => void) => {
        clearTimeout(timer);
        tlsSocket.removeListener('secureConnect', onSecureConnect);
        tlsSocket.removeListener('error', onError);
        tlsSocket.removeListener('close', onClose);
        if (next) next();
      };

      const onSecureConnect = () => {
        cleanup(() => resolve(tlsSocket));
      };

      const onError = (err: Error) => {
        cleanup(() => reject(new ConnectionError(`TLS handshake failed: ${err.message}`, err)));
      };

      const onClose = () => {
        cleanup(() => reject(new ConnectionError('TLS socket closed before handshake completed')));
      };

      tlsSocket.once('secureConnect', onSecureConnect);
      tlsSocket.once('error', onError);
      tlsSocket.once('close', onClose);
    });
  }

  private setupSocketHandlers(sock: net.Socket | tls.TLSSocket): void {
    sock.setTimeout(this.timeout);
    sock.on('data', (data: Buffer) => this.onData(data));
    sock.on('close', () => this.onClose());
    sock.on('timeout', () => {
      this.destroy(new ConnectionError('Connection timed out'));
    });
    sock.on('error', (err: Error) => {
      if (this.connected) {
        this.destroy(new ConnectionError(`Socket error: ${err.message}`, err));
      }
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

    if (this.rawSocket) {
      this.rawSocket.destroy();
      this.rawSocket = null;
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
