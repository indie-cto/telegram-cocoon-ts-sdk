/**
 * Proxy discovery via TON Root Contract.
 *
 * Queries the Root Contract to get the list of registered proxies,
 * then parses the addresses for client connections.
 */

import { Address, TonClient } from '@ton/ton';
import { CocoonRoot, type RootParams, type ProxyInfo } from './contracts/root.js';

export interface DiscoveryOptions {
  network: 'mainnet' | 'testnet';
  rootContractAddress?: string;
  tonApiEndpoint?: string;
}

// Known root contract addresses
const ROOT_CONTRACTS: Record<string, string> = {
  mainnet: 'EQDr5JVxzJYSRfEDnwLPBP1VaMUPBzGZWMFjJBOhGqhKgccU',
  testnet: 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA',
};

export class ProxyDiscovery {
  private tonClient: TonClient;
  private rootAddress: Address;
  private cachedParams: RootParams | null = null;
  private cacheTime = 0;
  private readonly cacheTtl = 60_000; // 1 minute

  constructor(options: DiscoveryOptions) {
    const endpoint =
      options.tonApiEndpoint ??
      (options.network === 'mainnet'
        ? 'https://toncenter.com/api/v2/jsonRPC'
        : 'https://testnet.toncenter.com/api/v2/jsonRPC');

    this.tonClient = new TonClient({ endpoint });

    const addr = options.rootContractAddress ?? ROOT_CONTRACTS[options.network];
    if (!addr) {
      throw new Error(`No root contract address for network: ${options.network}`);
    }
    this.rootAddress = Address.parse(addr);
  }

  /**
   * Get all registered proxies from the root contract.
   */
  async getProxies(): Promise<ProxyInfo[]> {
    const params = await this.getRootParams();
    return params.registeredProxies;
  }

  /**
   * Get a random proxy for connection.
   */
  async getRandomProxy(): Promise<ProxyInfo> {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error('No proxies available in the network');
    }
    const idx = Math.floor(Math.random() * proxies.length);
    return proxies[idx]!;
  }

  /**
   * Get root contract parameters (cached).
   */
  async getRootParams(): Promise<RootParams> {
    const now = Date.now();
    if (this.cachedParams && now - this.cacheTime < this.cacheTtl) {
      return this.cachedParams;
    }

    const root = new CocoonRoot(this.tonClient, this.rootAddress);
    this.cachedParams = await root.getAllParams();
    this.cacheTime = now;
    return this.cachedParams;
  }
}
