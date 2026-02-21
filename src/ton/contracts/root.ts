/**
 * CocoonRoot smart contract wrapper.
 *
 * Reads the root contract state to get network configuration:
 * - List of registered proxies with their addresses
 * - Supported model hashes
 * - Pricing parameters
 */

import { Address, TonClient } from '@ton/ton';

export interface ProxyInfo {
  seqno: number;
  address: string; // host:port for client connections
}

export interface RootParams {
  registeredProxies: ProxyInfo[];
  version: number;
  paramsVersion: number;
  pricePerToken: bigint;
  workerFeePerToken: bigint;
  minClientStake: bigint;
}

export class CocoonRoot {
  constructor(
    private readonly client: TonClient,
    private readonly address: Address,
  ) {}

  /**
   * Get all parameters from the root contract via get method.
   */
  async getAllParams(): Promise<RootParams> {
    const result = await this.client.runMethod(this.address, 'get_all_params');

    // The root contract returns a complex structure
    // Parse the tuple result
    const stack = result.stack;

    // Read the version info
    const version = stack.readNumber();
    const paramsVersion = stack.readNumber();

    // Read pricing
    const pricePerToken = stack.readBigNumber();
    const workerFeePerToken = stack.readBigNumber();
    const minClientStake = stack.readBigNumber();

    // Read proxies list
    const proxiesCell = stack.readCellOpt();
    const registeredProxies: ProxyInfo[] = [];

    if (proxiesCell) {
      // Parse proxies from cell - this is a dictionary
      // For now, we'll use a simpler approach and let the client
      // provide proxyUrl directly if auto-discovery doesn't work
    }

    return {
      registeredProxies,
      version,
      paramsVersion,
      pricePerToken,
      workerFeePerToken,
      minClientStake,
    };
  }
}
