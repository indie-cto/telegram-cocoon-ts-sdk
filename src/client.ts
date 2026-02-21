/**
 * Cocoon SDK Client — the main entry point.
 *
 * Usage:
 *   const client = new Cocoon({
 *     wallet: '24 word mnemonic...',
 *     network: 'mainnet',
 *   });
 *
 *   const response = await client.chat.completions.create({
 *     model: 'deepseek-r1',
 *     messages: [{ role: 'user', content: 'Hello!' }],
 *   });
 */

import { Completions } from './resources/chat/completions.js';
import { Models } from './resources/models/models.js';
import { MnemonicWallet } from './ton/wallet.js';
import { ProxyDiscovery } from './ton/discovery.js';
import { CocoonSession, type SessionOptions } from './core/protocol/session.js';
import { ConnectionError } from './core/error.js';
import crypto from 'node:crypto';

export interface CocoonOptions {
  /** 24-word mnemonic phrase */
  wallet: string;
  /** Network: mainnet or testnet. Default: mainnet */
  network?: 'mainnet' | 'testnet';
  /** Direct proxy URL (bypasses discovery). Format: host:port */
  proxyUrl?: string;
  /** Request timeout in ms. Default: 120000 */
  timeout?: number;
  /** Secret string for short auth. Auto-generated if not provided. */
  secretString?: string;
  /** Use TLS for proxy connection. Default: true */
  useTls?: boolean;
}

export class Cocoon {
  readonly chat: { completions: Completions };
  readonly models: Models;

  private readonly mnemonicWallet: MnemonicWallet;
  private readonly discovery: ProxyDiscovery | null;
  private session: CocoonSession | null = null;
  private connecting: Promise<CocoonSession> | null = null;

  private readonly options: Required<Pick<CocoonOptions, 'network' | 'timeout' | 'useTls'>> &
    CocoonOptions;

  constructor(options: CocoonOptions) {
    this.options = {
      network: 'mainnet',
      timeout: 120_000,
      useTls: true,
      ...options,
    };

    this.mnemonicWallet = new MnemonicWallet(options.wallet, this.options.network);

    // Set up discovery unless a direct proxyUrl is given
    if (!options.proxyUrl) {
      this.discovery = new ProxyDiscovery({ network: this.options.network });
    } else {
      this.discovery = null;
    }

    // Create resource namespaces with lazy session provider
    const getSession = () => this.ensureSession();
    this.chat = { completions: new Completions(getSession) };
    this.models = new Models(getSession);
  }

  /**
   * Explicitly connect to a proxy. Called lazily on first API call if not called manually.
   */
  async connect(): Promise<void> {
    await this.ensureSession();
  }

  /**
   * Disconnect from the proxy.
   */
  async disconnect(): Promise<void> {
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    this.connecting = null;
  }

  private async ensureSession(): Promise<CocoonSession> {
    if (this.session?.connected) {
      return this.session;
    }

    // Prevent concurrent connect attempts
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.createSession();
    try {
      this.session = await this.connecting;
      return this.session;
    } finally {
      this.connecting = null;
    }
  }

  private async createSession(): Promise<CocoonSession> {
    // Initialize wallet
    await this.mnemonicWallet.init();

    // Determine proxy address
    let host: string;
    let port: number;

    if (this.options.proxyUrl) {
      const parts = this.options.proxyUrl.split(':');
      host = parts.slice(0, -1).join(':');
      port = parseInt(parts[parts.length - 1]!, 10);
      if (!host || isNaN(port)) {
        throw new ConnectionError(`Invalid proxyUrl: ${this.options.proxyUrl}`);
      }
    } else if (this.discovery) {
      const proxy = await this.discovery.getRandomProxy();
      const parts = proxy.address.split(':');
      host = parts.slice(0, -1).join(':');
      port = parseInt(parts[parts.length - 1]!, 10);
      if (!host || isNaN(port)) {
        throw new ConnectionError(`Invalid proxy address from discovery: ${proxy.address}`);
      }
    } else {
      throw new ConnectionError('No proxy URL or discovery available');
    }

    // Generate or use secret string
    const secretString = this.options.secretString ?? crypto.randomBytes(32).toString('hex');

    const sessionOptions: SessionOptions = {
      host,
      port,
      useTls: this.options.useTls,
      timeout: this.options.timeout,
      ownerAddress: this.mnemonicWallet.addressString,
      secretString,
    };

    const session = new CocoonSession(sessionOptions);
    await session.connect();

    // Handle session close
    session.on('close', () => {
      if (this.session === session) {
        this.session = null;
      }
    });

    return session;
  }
}
