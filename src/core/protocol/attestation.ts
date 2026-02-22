import { readFile } from 'node:fs/promises';

export interface ClientTlsCredentials {
  cert: string | Buffer;
  key: string | Buffer;
}

export interface AttestationContext {
  host: string;
  port: number;
  network: 'mainnet' | 'testnet';
}

/**
 * Provides RA-TLS client credentials (certificate + private key) for mTLS.
 * Implementations may load static values, files, or fetch from sidecars.
 */
export interface AttestationProvider {
  getClientTlsCredentials(context: AttestationContext): Promise<ClientTlsCredentials>;
}

/**
 * Uses already available in-memory credentials.
 */
export class StaticAttestationProvider implements AttestationProvider {
  constructor(private readonly credentials: ClientTlsCredentials) {}

  async getClientTlsCredentials(): Promise<ClientTlsCredentials> {
    return this.credentials;
  }
}

/**
 * Loads credentials from PEM files on each call.
 * Useful when credentials are rotated externally.
 */
export class FileAttestationProvider implements AttestationProvider {
  constructor(
    private readonly certPath: string,
    private readonly keyPath: string,
  ) {}

  async getClientTlsCredentials(): Promise<ClientTlsCredentials> {
    const [cert, key] = await Promise.all([
      readFile(this.certPath),
      readFile(this.keyPath),
    ]);
    return { cert, key };
  }
}
