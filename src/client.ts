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
import { CocoonClientContract } from './ton/contracts/client-contract.js';
import { buildClientParamsCell } from './ton/contracts/root.js';
import { CocoonSession, type SessionOptions } from './core/protocol/session.js';
import { ConnectionError } from './core/error.js';
import type {
  AttestationProvider,
  AttestationContext,
} from './core/protocol/attestation.js';
import crypto from 'node:crypto';
import { Address, toNano } from '@ton/ton';
import { contractAddress } from '@ton/core';

export interface CocoonOptions {
  /** 24-word mnemonic phrase */
  wallet: string;
  /** Network: mainnet or testnet. Default: mainnet */
  network?: 'mainnet' | 'testnet';
  /** Direct proxy URL (bypasses discovery). Format: host:port */
  proxyUrl?: string;
  /** Request timeout in ms. Default: 120000 */
  timeout?: number;
  /** Optional TON JSON-RPC endpoint for on-chain operations (registration, wallet tx). */
  tonEndpoint?: string;
  /** Optional TON v4 endpoint used for wallet transaction sending. */
  tonV4Endpoint?: string;
  /** Secret string for short auth. Auto-generated if not provided. */
  secretString?: string;
  /** Use TLS for proxy connection. Default: true */
  useTls?: boolean;
  /** PEM-encoded TLS client certificate for RA-TLS / mTLS authentication */
  tlsCert?: string | Buffer;
  /** PEM-encoded TLS client private key for RA-TLS / mTLS authentication */
  tlsKey?: string | Buffer;
  /** Dynamic provider for RA-TLS credentials (e.g. sidecar, file rotation). */
  attestationProvider?: AttestationProvider;
  /**
   * If true, automatically perform on-chain long-auth registration when proxy requests it.
   * This sends a TON transaction from the mnemonic wallet.
   * Default: true
   */
  autoRegisterOnLongAuth?: boolean;
  /** Amount in TON to attach to auto long-auth registration tx. Default: "1" */
  longAuthRegisterAmountTon?: string;
}

export class Cocoon {
  readonly chat: { completions: Completions };
  readonly models: Models;

  private readonly mnemonicWallet: MnemonicWallet;
  private readonly discovery: ProxyDiscovery | null;
  private session: CocoonSession | null = null;
  private connecting: Promise<CocoonSession> | null = null;

  private readonly options: Required<Pick<CocoonOptions, 'network' | 'timeout' | 'useTls'>> &
    Required<Pick<CocoonOptions, 'autoRegisterOnLongAuth' | 'longAuthRegisterAmountTon'>> &
    CocoonOptions;

  constructor(options: CocoonOptions) {
    if ((options.tlsCert && !options.tlsKey) || (!options.tlsCert && options.tlsKey)) {
      throw new ConnectionError(
        'Both tlsCert and tlsKey must be provided together for mTLS',
      );
    }
    if (options.attestationProvider && (options.tlsCert || options.tlsKey)) {
      throw new ConnectionError(
        'Use either attestationProvider or tlsCert/tlsKey, not both',
      );
    }

    this.options = {
      network: 'mainnet',
      timeout: 120_000,
      useTls: true,
      // Safety-first default for SDK consumers: don't submit on-chain tx implicitly.
      autoRegisterOnLongAuth: false,
      longAuthRegisterAmountTon: '1',
      ...options,
    };

    this.mnemonicWallet = new MnemonicWallet(options.wallet, this.options.network, {
      tonEndpoint: this.options.tonEndpoint,
      tonV4Endpoint: this.options.tonV4Endpoint,
    });

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
      // Proxy address format: "host:workerPort host:clientPort"
      // We need the client port (second entry)
      const entries = proxy.address.trim().split(/\s+/);
      const clientEntry = entries.length > 1 ? entries[1]! : entries[0]!;
      const lastColon = clientEntry.lastIndexOf(':');
      host = clientEntry.substring(0, lastColon);
      port = parseInt(clientEntry.substring(lastColon + 1), 10);
      if (!host || isNaN(port)) {
        throw new ConnectionError(`Invalid proxy address from discovery: ${proxy.address}`);
      }
    } else {
      throw new ConnectionError('No proxy URL or discovery available');
    }

    // Resolve TLS credentials (static or via provider).
    let tlsCert = this.options.tlsCert;
    let tlsKey = this.options.tlsKey;

    if (this.options.attestationProvider) {
      const context: AttestationContext = {
        host,
        port,
        network: this.options.network,
      };
      const credentials = await this.options.attestationProvider.getClientTlsCredentials(context);
      tlsCert = credentials.cert;
      tlsKey = credentials.key;
    }

    if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
      throw new ConnectionError('Attestation provider returned incomplete TLS credentials');
    }

    // Generate or use secret string
    const secretString = this.options.secretString ?? crypto.randomBytes(32).toString('hex');

    const onLongAuthRequired = this.options.autoRegisterOnLongAuth
      ? async (context: {
          nonce: bigint;
          clientScAddress: string;
          proxyParams: {
            proxyScAddress: string;
            proxyPublicKey: Buffer;
          };
        }): Promise<void> => {
          try {
            const sender = await this.mnemonicWallet.createSender();
            const clientScAddress = Address.parse(context.clientScAddress);
            const clientContract = new CocoonClientContract(clientScAddress);

            const v4Client = this.mnemonicWallet.getTonClient4();
            const last = await v4Client.getLastBlock();
            const account = await v4Client.getAccount(last.last.seqno, clientScAddress);

            let init;
            if (account.account.state.type !== 'active') {
              const discovery =
                this.discovery ??
                new ProxyDiscovery({
                  network: this.options.network,
                  tonApiEndpoint: this.options.tonEndpoint,
                });
              const rootParams = await discovery.getRootParams();
              const clientCode = rootParams.codes.clientScCode;
              if (!clientCode) {
                throw new Error(
                  'Root contract does not contain client_sc_code; cannot deploy client contract',
                );
              }
              const clientParamsCell = buildClientParamsCell(rootParams.params);
              const dataCell = CocoonClientContract.createDeployDataCell(
                this.mnemonicWallet.address,
                Address.parse(context.proxyParams.proxyScAddress),
                context.proxyParams.proxyPublicKey,
                rootParams.params.minClientStake,
                clientParamsCell,
              );
              init = CocoonClientContract.createStateInit(clientCode, dataCell);

              const expectedAddress = contractAddress(0, init);
              if (!expectedAddress.equals(clientScAddress)) {
                throw new Error(
                  `Computed client_sc mismatch: expected ${context.clientScAddress}, got ${expectedAddress.toString({ bounceable: true, testOnly: this.options.network === 'testnet' })}`,
                );
              }
            }

            await clientContract.register(
              sender,
              this.mnemonicWallet.address,
              context.nonce,
              toNano(this.options.longAuthRegisterAmountTon),
              init,
            );
          } catch (err) {
            throw new ConnectionError(
              `Auto long-auth registration failed: ${
                err instanceof Error ? err.message : String(err)
              }. Configure tonEndpoint / wallet balance or provide a valid SECRET`,
              err instanceof Error ? err : undefined,
            );
          }
        }
      : undefined;

    const sessionOptions: SessionOptions = {
      host,
      port,
      useTls: this.options.useTls,
      timeout: this.options.timeout,
      ownerAddress: this.mnemonicWallet.addressString,
      secretString,
      tlsCert,
      tlsKey,
      onLongAuthRequired,
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
