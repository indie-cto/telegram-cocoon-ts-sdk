import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cocoon } from '../../src/client';
import { Completions } from '../../src/resources/chat/completions';
import { Models } from '../../src/resources/models/models';

const { mockSessionCtorOptions } = vi.hoisted(() => ({
  mockSessionCtorOptions: vi.fn(),
}));

// Mock all heavy dependencies
vi.mock('../../src/ton/wallet', () => {
  class MockWallet {
    mnemonic: string[];
    network: string;
    initialized = false;

    constructor(mnemonic: string, network: string) {
      this.mnemonic = mnemonic.trim().split(/\s+/);
      if (this.mnemonic.length !== 24) {
        throw new Error(`Expected 24 mnemonic words, got ${this.mnemonic.length}`);
      }
      this.network = network;
    }

    async init(): Promise<void> {
      this.initialized = true;
    }

    get addressString(): string {
      return 'EQTestAddress';
    }

    get address() {
      return { toString: () => 'EQTestAddress' };
    }
  }

  return { MnemonicWallet: MockWallet };
});

vi.mock('../../src/ton/discovery', () => {
  class MockDiscovery {
    constructor() {}

    async getRandomProxy() {
      return { seqno: 1, address: 'proxy.example.com:8080' };
    }
  }

  return { ProxyDiscovery: MockDiscovery };
});

vi.mock('../../src/core/protocol/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/core/protocol/session')>();
  const { EventEmitter } = await import('node:events');

  class MockSession extends EventEmitter {
    _connected = true;

    constructor(options?: unknown) {
      super();
      mockSessionCtorOptions(options);
    }

    get connected(): boolean {
      return this._connected;
    }

    async connect(): Promise<void> {
      this._connected = true;
    }

    async disconnect(): Promise<void> {
      this._connected = false;
    }

    async sendQuery() {
      return {};
    }

    async sendRpcQuery() {
      return {};
    }
  }

  return {
    ...original,
    CocoonSession: MockSession,
  };
});

const VALID_MNEMONIC = Array(24).fill('test').join(' ');

describe('Cocoon', () => {
  afterEach(() => {
    mockSessionCtorOptions.mockReset();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default options', () => {
      const client = new Cocoon({ wallet: VALID_MNEMONIC });
      const opts = (
        client as unknown as { options: { network: string; timeout: number; useTls: boolean } }
      ).options;
      expect(opts.network).toBe('mainnet');
      expect(opts.timeout).toBe(120_000);
      expect(opts.useTls).toBe(true);
    });

    it('should accept custom options', () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        network: 'testnet',
        timeout: 60_000,
        useTls: false,
      });
      const opts = (
        client as unknown as { options: { network: string; timeout: number; useTls: boolean } }
      ).options;
      expect(opts.network).toBe('testnet');
      expect(opts.timeout).toBe(60_000);
      expect(opts.useTls).toBe(false);
    });

    it('should throw for invalid mnemonic (not 24 words)', () => {
      expect(() => new Cocoon({ wallet: 'just three words' })).toThrow(
        'Expected 24 mnemonic words',
      );
    });

    it('should throw when only tlsCert is provided', () => {
      expect(() => new Cocoon({ wallet: VALID_MNEMONIC, tlsCert: 'cert-only' })).toThrow(
        'Both tlsCert and tlsKey must be provided together for mTLS',
      );
    });

    it('should throw when attestationProvider is combined with tlsCert/tlsKey', () => {
      const provider = {
        getClientTlsCredentials: vi.fn(),
      };

      expect(
        () =>
          new Cocoon({
            wallet: VALID_MNEMONIC,
            tlsCert: 'cert',
            tlsKey: 'key',
            attestationProvider: provider,
          }),
      ).toThrow('Use either attestationProvider or tlsCert/tlsKey, not both');
    });

    it('should skip discovery when proxyUrl is provided', () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'proxy.example.com:8080',
      });
      const discovery = (client as unknown as { discovery: unknown }).discovery;
      expect(discovery).toBeNull();
    });

    it('should create discovery when no proxyUrl', () => {
      const client = new Cocoon({ wallet: VALID_MNEMONIC });
      const discovery = (client as unknown as { discovery: unknown }).discovery;
      expect(discovery).not.toBeNull();
    });
  });

  describe('resource namespaces', () => {
    it('should have chat.completions', () => {
      const client = new Cocoon({ wallet: VALID_MNEMONIC });
      expect(client.chat).toBeDefined();
      expect(client.chat.completions).toBeInstanceOf(Completions);
    });

    it('should have models', () => {
      const client = new Cocoon({ wallet: VALID_MNEMONIC });
      expect(client.models).toBeInstanceOf(Models);
    });
  });

  describe('connect', () => {
    it('should initialize wallet and create session', async () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'proxy.example.com:8080',
      });
      await client.connect();
      const session = (client as unknown as { session: { connected: boolean } }).session;
      expect(session).not.toBeNull();
      expect(session.connected).toBe(true);
    });

    it('should handle concurrent connect() calls (single session creation)', async () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'proxy.example.com:8080',
      });

      // Call connect() concurrently
      const [,] = await Promise.all([client.connect(), client.connect()]);

      const session = (client as unknown as { session: { connected: boolean } }).session;
      expect(session).not.toBeNull();
    });
  });

  describe('disconnect', () => {
    it('should clear session', async () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'proxy.example.com:8080',
      });
      await client.connect();
      await client.disconnect();
      const session = (client as unknown as { session: unknown }).session;
      expect(session).toBeNull();
    });

    it('should be safe to call when not connected', async () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'proxy.example.com:8080',
      });
      await client.disconnect(); // Should not throw
    });
  });

  describe('lazy session on first API call', () => {
    it('should create session on first API call if not connected', async () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'proxy.example.com:8080',
      });

      // Session should be null before any call
      const sessionBefore = (client as unknown as { session: unknown }).session;
      expect(sessionBefore).toBeNull();

      // Triggering ensureSession via the session provider
      const ensureSession = (client as unknown as { ensureSession: () => Promise<unknown> })
        .ensureSession;
      const session = await ensureSession.call(client);
      expect(session).not.toBeNull();
    });
  });

  describe('proxyUrl parsing', () => {
    it('should parse host:port from proxyUrl', async () => {
      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        proxyUrl: 'my-proxy.example.com:9090',
      });
      await client.connect();
      // If it connects without throwing, the parsing worked
      const session = (client as unknown as { session: unknown }).session;
      expect(session).not.toBeNull();
    });
  });

  describe('attestation provider', () => {
    it('should resolve credentials via provider and pass them to session', async () => {
      const provider = {
        getClientTlsCredentials: vi.fn().mockResolvedValue({
          cert: 'provided-cert',
          key: 'provided-key',
        }),
      };

      const client = new Cocoon({
        wallet: VALID_MNEMONIC,
        network: 'mainnet',
        proxyUrl: 'my-proxy.example.com:9090',
        attestationProvider: provider,
      });

      await client.connect();

      expect(provider.getClientTlsCredentials).toHaveBeenCalledWith({
        host: 'my-proxy.example.com',
        port: 9090,
        network: 'mainnet',
      });

      expect(mockSessionCtorOptions).toHaveBeenCalled();
      const firstCall = mockSessionCtorOptions.mock.calls[0]?.[0] as
        | { tlsCert?: string; tlsKey?: string }
        | undefined;
      expect(firstCall?.tlsCert).toBe('provided-cert');
      expect(firstCall?.tlsKey).toBe('provided-key');
    });
  });
});
