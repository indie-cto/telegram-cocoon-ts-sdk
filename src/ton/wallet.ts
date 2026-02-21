/**
 * Mnemonic wallet for Cocoon.
 *
 * Converts a 24-word mnemonic into a keypair and wallet address.
 * Uses @ton/crypto for key derivation and @ton/ton for wallet contract.
 */

import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, TonClient } from '@ton/ton';
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

  constructor(mnemonic: string, network: 'mainnet' | 'testnet' = 'mainnet') {
    this.mnemonic = mnemonic.trim().split(/\s+/);
    if (this.mnemonic.length !== 24) {
      throw new Error(`Expected 24 mnemonic words, got ${this.mnemonic.length}`);
    }
    this.network = network;
  }

  private readonly network: 'mainnet' | 'testnet';

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
        this.network === 'mainnet'
          ? 'https://toncenter.com/api/v2/jsonRPC'
          : 'https://testnet.toncenter.com/api/v2/jsonRPC';

      this.tonClient = new TonClient({ endpoint });
    }
    return this.tonClient;
  }

  /**
   * Create a sender for sending transactions.
   */
  async createSender(): Promise<Sender> {
    if (!this.wallet || !this.keyPair) {
      throw new Error('Wallet not initialized');
    }

    const client = this.getTonClient();
    const contract = client.open(this.wallet);

    return contract.sender(this.keyPair.secretKey);
  }
}
