/**
 * CocoonRoot smart contract wrapper.
 *
 * Reads the root contract raw state to get network configuration:
 * - List of registered proxies with their addresses
 * - Supported worker/proxy/model hashes
 * - Pricing parameters
 *
 * On-chain cell layout (from official cocoon-contracts wrapper):
 *   top-level:
 *     ownerAddress:address  version:uint32  ref(data)  ref(params)
 *   data ref:
 *     proxyHashes:dict  registeredProxies:dict  lastProxySeqno:uint32
 *     workerHashes:dict  modelHashes:dict
 *   params ref:
 *     structVersion:uint8  paramsVersion:uint32  uniqueId:uint32  isTest:bit
 *     pricePerToken:coins  workerFeePerToken:coins  ...multipliers...
 *     delays  minStakes  ref(proxyScCode)  ref(workerScCode)  ref(clientScCode)
 */

import { Address, Cell, Dictionary, Slice, TonClient, beginCell } from '@ton/ton';

export interface ProxyInfo {
  seqno: number;
  /** Proxy address, typically "host:workerPort host:clientPort" */
  address: string;
}

export interface CocoonParams {
  structVersion: number;
  paramsVersion: number;
  uniqueId: number;
  isTest: boolean;
  pricePerToken: bigint;
  workerFeePerToken: bigint;
  promptTokensPriceMultiplier: number;
  cachedTokensPriceMultiplier: number;
  completionTokensPriceMultiplier: number;
  reasoningTokensPriceMultiplier: number;
  proxyDelayBeforeClose: number;
  clientDelayBeforeClose: number;
  minProxyStake: bigint;
  minClientStake: bigint;
}

export interface RootContractCodes {
  proxyScCode: Cell | null;
  workerScCode: Cell | null;
  clientScCode: Cell | null;
}

export interface RootParams {
  ownerAddress: Address;
  registeredProxies: ProxyInfo[];
  lastProxySeqno: number;
  version: number;
  params: CocoonParams;
  codes: RootContractCodes;
}

/**
 * Build the client params cell as RootContractConfig::serialize_client_params_cell(0).
 * This is needed for client_sc deployment state-init.
 */
export function buildClientParamsCell(params: CocoonParams): Cell {
  const b = beginCell()
    .storeUint(params.structVersion, 8)
    .storeUint(params.paramsVersion, 32)
    .storeUint(params.uniqueId, 32)
    .storeBit(params.isTest)
    .storeCoins(params.pricePerToken)
    .storeCoins(params.workerFeePerToken);

  if (params.structVersion >= 2) {
    if (params.structVersion >= 3) {
      b.storeUint(params.promptTokensPriceMultiplier, 32);
    }
    b.storeUint(params.cachedTokensPriceMultiplier, 32);
    if (params.structVersion >= 3) {
      b.storeUint(params.completionTokensPriceMultiplier, 32);
    }
    b.storeUint(params.reasoningTokensPriceMultiplier, 32);
  }

  b.storeUint(params.proxyDelayBeforeClose, 32);
  b.storeUint(params.clientDelayBeforeClose, 32);

  if (params.structVersion >= 1) {
    b.storeCoins(params.minProxyStake);
    b.storeCoins(params.minClientStake);
  }

  // serialize_client_params_cell(0): no code refs included.
  b.storeMaybeRef(null).storeMaybeRef(null).storeMaybeRef(null);
  return b.endCell();
}

/** Value codec for the registered_proxies dictionary (Uint32 → ProxyInfo). */
function proxyInfoValue() {
  return {
    serialize: () => {
      throw new Error('ProxyInfo serialization not needed for read-only usage');
    },
    parse: (src: Slice) => {
      src.loadBit(); // type bit (always 0)
      const strlen = src.loadUint(7);
      const buf = src.loadBuffer(strlen);
      return { addr: buf.toString('utf-8') };
    },
  };
}

export class CocoonRoot {
  constructor(
    private readonly client: TonClient,
    private readonly address: Address,
  ) {}

  /**
   * Get all parameters by reading the raw contract state and parsing the Cell.
   * Returns null if the contract is not initialized.
   */
  async getAllParams(): Promise<RootParams | null> {
    const state = await this.client.getContractState(this.address);

    if (!state.data) {
      return null;
    }

    const cell = Cell.fromBoc(Buffer.from(state.data))[0]!;
    const cs = cell.beginParse();

    // Top-level: ownerAddress + version + ref(data) + ref(params)
    const ownerAddress = cs.loadAddress();
    const version = cs.loadUint(32);

    // Data ref: proxyHashes, registeredProxies, lastProxySeqno, workerHashes, modelHashes
    const data = cs.loadRef().beginParse();

    // Skip proxyHashes dict (inline maybe-ref)
    if (data.loadBit()) data.loadRef();

    // registeredProxies dict (inline maybe-ref)
    const proxiesDict = data.loadDict<number, { addr: string }>(
      Dictionary.Keys.Uint(32),
      proxyInfoValue(),
    );

    const lastProxySeqno = data.loadUint(32);

    // Skip workerHashes and modelHashes
    if (data.loadBit()) data.loadRef();
    if (data.loadBit()) data.loadRef();

    // Params ref
    const pcs = cs.loadRef().beginParse();

    const structVersion = pcs.loadUint(8);
    const paramsVersion = pcs.loadUint(32);
    const uniqueId = pcs.loadUint(32);
    const isTest = pcs.loadBit();
    const pricePerToken = pcs.loadCoins();
    const workerFeePerToken = pcs.loadCoins();

    let promptTokensPriceMultiplier = 10000;
    if (structVersion >= 3) {
      promptTokensPriceMultiplier = pcs.loadUint(32);
    }
    let cachedTokensPriceMultiplier = 10000;
    if (structVersion >= 2) {
      cachedTokensPriceMultiplier = pcs.loadUint(32);
    }
    let completionTokensPriceMultiplier = 10000;
    if (structVersion >= 3) {
      completionTokensPriceMultiplier = pcs.loadUint(32);
    }
    let reasoningTokensPriceMultiplier = 10000;
    if (structVersion >= 2) {
      reasoningTokensPriceMultiplier = pcs.loadUint(32);
    }

    const proxyDelayBeforeClose = pcs.loadUint(32);
    const clientDelayBeforeClose = pcs.loadUint(32);

    let minProxyStake = 1000000000n; // 1 TON default
    let minClientStake = 1000000000n;
    if (structVersion >= 1) {
      minProxyStake = pcs.loadCoins();
      minClientStake = pcs.loadCoins();
    }

    const proxyScCode = pcs.loadMaybeRef();
    const workerScCode = pcs.loadMaybeRef();
    const clientScCode = pcs.loadMaybeRef();

    // Convert proxies dict to array
    const registeredProxies: ProxyInfo[] = [];
    if (proxiesDict) {
      for (const [seqno, info] of proxiesDict) {
        registeredProxies.push({ seqno, address: info.addr });
      }
    }

    return {
      ownerAddress,
      registeredProxies,
      lastProxySeqno,
      version,
      params: {
        structVersion,
        paramsVersion,
        uniqueId,
        isTest,
        pricePerToken,
        workerFeePerToken,
        promptTokensPriceMultiplier,
        cachedTokensPriceMultiplier,
        completionTokensPriceMultiplier,
        reasoningTokensPriceMultiplier,
        proxyDelayBeforeClose,
        clientDelayBeforeClose,
        minProxyStake,
        minClientStake,
      },
      codes: {
        proxyScCode,
        workerScCode,
        clientScCode,
      },
    };
  }
}
