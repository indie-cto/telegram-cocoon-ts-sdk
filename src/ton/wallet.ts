/**
 * Mnemonic wallet for Cocoon.
 *
 * Converts a 24-word mnemonic into a keypair and wallet address.
 * Uses @ton/crypto for key derivation and @ton/ton for wallet contract.
 */

import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, TonClient, TonClient4 } from '@ton/ton';
import { Address, type Sender } from '@ton/core';
import crypto from 'node:crypto';

export interface WalletInfo {
  address: Address;
  publicKey: Buffer;
  secretKey: Buffer;
}

export class MnemonicWallet {
  private mnemonic: string[];
  private keyPair: { publicKey: Buffer; secretKey: Buffer } | null = null;
  private wallet: WalletContractV4 | null = null;
  private _address: Address | null = null;
  private tonClient: TonClient | null = null;
  private tonClient4: TonClient4 | null = null;

  constructor(
    mnemonic: string,
    network: 'mainnet' | 'testnet' = 'mainnet',
    options?: { tonEndpoint?: string; tonV4Endpoint?: string },
  ) {
    this.mnemonic = mnemonic.trim().split(/\s+/);
    if (this.mnemonic.length !== 24) {
      throw new Error(`Expected 24 mnemonic words, got ${this.mnemonic.length}`);
    }
    this.network = network;
    this.tonEndpoint = options?.tonEndpoint;
    this.tonV4Endpoint = options?.tonV4Endpoint;
  }

  private readonly network: 'mainnet' | 'testnet';
  private readonly tonEndpoint?: string;
  private readonly tonV4Endpoint?: string;

  async init(): Promise<void> {
    if (this.keyPair) return;

    this.keyPair = await mnemonicToPrivateKey(this.mnemonic);

    this.wallet = WalletContractV4.create({
      workchain: 0,
      publicKey: this.keyPair.publicKey,
    });

    this._address = this.wallet.address;
  }

  get address(): Address {
    if (!this._address) throw new Error('Wallet not initialized. Call init() first.');
    return this._address;
  }

  get addressString(): string {
    return this.address.toString({ bounceable: true, testOnly: this.network === 'testnet' });
  }

  get publicKey(): Buffer {
    if (!this.keyPair) throw new Error('Wallet not initialized. Call init() first.');
    return this.keyPair.publicKey;
  }

  get secretKey(): Buffer {
    if (!this.keyPair) throw new Error('Wallet not initialized. Call init() first.');
    return this.keyPair.secretKey;
  }

  /**
   * Compute SHA-256 hash of a secret string (for short auth).
   */
  secretHash(secret: string): Buffer {
    return crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Get or create a TonClient for blockchain queries.
   */
  getTonClient(): TonClient {
    if (!this.tonClient) {
      const endpoint =
        this.tonEndpoint ??
        (this.network === 'mainnet'
          ? 'https://toncenter.com/api/v2/jsonRPC'
          : 'https://testnet.toncenter.com/api/v2/jsonRPC');

      this.tonClient = new TonClient({ endpoint });
    }
    return this.tonClient;
  }

  /**
   * Get or create a TonClient4 for sending transactions via v4 HTTP API.
   */
  getTonClient4(): TonClient4 {
    if (!this.tonClient4) {
      const endpoint =
        this.tonV4Endpoint ??
        (this.network === 'mainnet'
          ? 'https://mainnet-v4.tonhubapi.com'
          : 'https://testnet-v4.tonhubapi.com');
      this.tonClient4 = new TonClient4({ endpoint });
    }
    return this.tonClient4;
  }

  /**
   * Create a sender for sending transactions.
   */
  async createSender(): Promise<Sender> {
    if (!this.wallet || !this.keyPair) {
      throw new Error('Wallet not initialized');
    }

    const client = this.getTonClient4();
    const contract = client.open(this.wallet);

    return contract.sender(this.keyPair.secretKey);
  }
}
