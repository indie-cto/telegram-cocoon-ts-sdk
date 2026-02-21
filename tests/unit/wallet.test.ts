import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mock @ton/crypto and @ton/ton before importing MnemonicWallet
vi.mock('@ton/crypto', () => ({
  mnemonicToPrivateKey: vi.fn().mockResolvedValue({
    publicKey: Buffer.alloc(32, 1),
    secretKey: Buffer.alloc(64, 2),
  }),
}));

vi.mock('@ton/ton', () => {
  const mockAddress = {
    toString: (opts?: { bounceable?: boolean; testOnly?: boolean }) => {
      if (opts?.testOnly) return 'kQTestAddress';
      return 'EQTestAddress';
    },
  };

  const MockWalletContractV4 = {
    create: vi.fn().mockReturnValue({
      address: mockAddress,
    }),
  };

  const MockTonClient = vi.fn().mockImplementation((_opts: { endpoint: string }) => ({
    open: vi.fn().mockReturnValue({
      sender: vi.fn().mockReturnValue({}),
    }),
  }));

  return {
    WalletContractV4: MockWalletContractV4,
    TonClient: MockTonClient,
  };
});

vi.mock('@ton/core', () => ({
  Address: {
    parse: vi.fn().mockReturnValue({ toString: () => 'EQTestAddress' }),
  },
}));

import { MnemonicWallet } from '../../src/ton/wallet';
import { mnemonicToPrivateKey } from '@ton/crypto';

const VALID_MNEMONIC = Array(24).fill('word').join(' ');

describe('MnemonicWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should accept 24-word mnemonic', () => {
      expect(() => new MnemonicWallet(VALID_MNEMONIC)).not.toThrow();
    });

    it('should trim whitespace from mnemonic', () => {
      const mnemonic = '  ' + Array(24).fill('word').join('  ') + '  ';
      expect(() => new MnemonicWallet(mnemonic)).not.toThrow();
    });

    it('should throw for non-24 word mnemonic', () => {
      expect(() => new MnemonicWallet('one two three')).toThrow('Expected 24 mnemonic words');
    });

    it('should throw for empty string', () => {
      expect(() => new MnemonicWallet('')).toThrow('Expected 24 mnemonic words');
    });

    it('should throw for 23 words', () => {
      const mnemonic = Array(23).fill('word').join(' ');
      expect(() => new MnemonicWallet(mnemonic)).toThrow('Expected 24 mnemonic words, got 23');
    });
  });

  describe('init', () => {
    it('should call mnemonicToPrivateKey', async () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      await wallet.init();
      expect(mnemonicToPrivateKey).toHaveBeenCalledWith(Array(24).fill('word'));
    });

    it('should be idempotent', async () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      await wallet.init();
      await wallet.init();
      // mnemonicToPrivateKey should only be called once
      expect(mnemonicToPrivateKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('getters before init', () => {
    it('address should throw before init', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      expect(() => wallet.address).toThrow('Wallet not initialized');
    });

    it('publicKey should throw before init', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      expect(() => wallet.publicKey).toThrow('Wallet not initialized');
    });

    it('secretKey should throw before init', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      expect(() => wallet.secretKey).toThrow('Wallet not initialized');
    });
  });

  describe('getters after init', () => {
    it('should return public key', async () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      await wallet.init();
      expect(wallet.publicKey).toEqual(Buffer.alloc(32, 1));
    });

    it('should return secret key', async () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      await wallet.init();
      expect(wallet.secretKey).toEqual(Buffer.alloc(64, 2));
    });

    it('addressString should include testOnly for testnet', async () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC, 'testnet');
      await wallet.init();
      const addr = wallet.addressString;
      expect(addr).toBe('kQTestAddress');
    });

    it('addressString should not include testOnly for mainnet', async () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC, 'mainnet');
      await wallet.init();
      const addr = wallet.addressString;
      expect(addr).toBe('EQTestAddress');
    });
  });

  describe('secretHash', () => {
    it('should return SHA-256 hash', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      const hash = wallet.secretHash('test-secret');
      const expected = crypto.createHash('sha256').update('test-secret').digest();
      expect(hash).toEqual(expected);
    });

    it('should be deterministic', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      const hash1 = wallet.secretHash('same-input');
      const hash2 = wallet.secretHash('same-input');
      expect(hash1).toEqual(hash2);
    });

    it('should produce 32-byte output', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC);
      const hash = wallet.secretHash('anything');
      expect(hash.length).toBe(32);
    });
  });

  describe('getTonClient', () => {
    it('should return a TonClient instance', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC, 'mainnet');
      const client = wallet.getTonClient();
      expect(client).toBeDefined();
    });

    it('should cache the client instance', () => {
      const wallet = new MnemonicWallet(VALID_MNEMONIC, 'mainnet');
      const client1 = wallet.getTonClient();
      const client2 = wallet.getTonClient();
      expect(client1).toBe(client2);
    });
  });
});
