/**
 * CocoonClient smart contract wrapper.
 *
 * Handles client registration with a proxy and balance management.
 * The client contract is deployed per client-proxy pair.
 */

import { Address, beginCell, type Cell, toNano } from '@ton/ton';
import type { Sender, StateInit } from '@ton/core';

// Opcodes from the Cocoon smart contracts
const OPCODES = {
  ownerClientRegister: 0xc45f9f3b,
  ownerClientChangeSecretHash: 0xa9357034,
  extClientTopUp: 0xf172e6c2,
} as const;

export class CocoonClientContract {
  constructor(private readonly address: Address) {}

  /**
   * Create a registration message body for the proxy.
   * This is sent to the client smart contract to register with a proxy.
   */
  static createRegisterBody(
    nonce: bigint,
    sendExcessesTo: Address,
    queryId = 0n,
  ): Cell {
    const nonceU64 = BigInt.asUintN(64, nonce);
    const queryIdU64 = BigInt.asUintN(64, queryId);
    return beginCell()
      .storeUint(OPCODES.ownerClientRegister, 32)
      .storeUint(queryIdU64, 64)
      .storeUint(nonceU64, 64)
      .storeAddress(sendExcessesTo)
      .endCell();
  }

  /**
   * Create a message body to change the secret hash.
   */
  static createChangeSecretHashBody(
    secretHash: Buffer,
    sendExcessesTo: Address,
    queryId = 0n,
  ): Cell {
    const queryIdU64 = BigInt.asUintN(64, queryId);
    return beginCell()
      .storeUint(OPCODES.ownerClientChangeSecretHash, 32)
      .storeUint(queryIdU64, 64)
      .storeBuffer(secretHash, 32)
      .storeAddress(sendExcessesTo)
      .endCell();
  }

  /**
   * Create a top-up message body.
   */
  static createTopUpBody(coins: bigint, sendExcessesTo: Address, queryId = 0n): Cell {
    const queryIdU64 = BigInt.asUintN(64, queryId);
    return beginCell()
      .storeUint(OPCODES.extClientTopUp, 32)
      .storeUint(queryIdU64, 64)
      .storeCoins(coins)
      .storeAddress(sendExcessesTo)
      .endCell();
  }

  /**
   * Build client_sc data cell for deployment.
   * Mirrors ClientContract::init_data_cell in upstream C++ code.
   */
  static createDeployDataCell(
    ownerAddress: Address,
    proxyScAddress: Address,
    proxyPublicKey: Buffer,
    minClientStake: bigint,
    clientParamsCell: Cell,
  ): Cell {
    if (proxyPublicKey.length !== 32) {
      throw new Error(`proxyPublicKey must be 32 bytes, got ${proxyPublicKey.length}`);
    }

    const configDataRef = beginCell()
      .storeAddress(ownerAddress)
      .storeAddress(proxyScAddress)
      .storeBuffer(proxyPublicKey, 32)
      .endCell();

    return beginCell()
      .storeUint(0, 2) // state
      .storeCoins(0n) // balance
      .storeCoins(minClientStake) // stake
      .storeInt(0n, 64) // tokens_used
      .storeInt(0, 32) // unlock_ts
      .storeBuffer(Buffer.alloc(32), 32) // secret_hash
      .storeRef(configDataRef)
      .storeRef(clientParamsCell)
      .endCell();
  }

  static createStateInit(clientCode: Cell, dataCell: Cell): StateInit {
    return {
      code: clientCode,
      data: dataCell,
    };
  }

  /**
   * Send a registration transaction to the client contract.
   */
  async register(
    sender: Sender,
    ownerAddress: Address,
    nonce: bigint,
    amount = toNano('1'),
    init?: StateInit,
  ): Promise<void> {
    const body = CocoonClientContract.createRegisterBody(nonce, ownerAddress);
    const message: {
      to: Address;
      value: bigint;
      body: Cell;
      init?: StateInit;
    } = {
      to: this.address,
      value: amount,
      body,
    };
    if (init) {
      message.init = init;
    }
    await sender.send(message);
  }

  /**
   * Top up the client contract balance.
   */
  async topUp(sender: Sender, ownerAddress: Address, amount: bigint): Promise<void> {
    const body = CocoonClientContract.createTopUpBody(amount, ownerAddress);
    await sender.send({
      to: this.address,
      value: amount + toNano('0.7'),
      body,
    });
  }

  /**
   * Change the secret hash for short auth.
   */
  async changeSecretHash(
    sender: Sender,
    ownerAddress: Address,
    secretHash: Buffer,
    amount = toNano('0.7'),
  ): Promise<void> {
    const body = CocoonClientContract.createChangeSecretHashBody(secretHash, ownerAddress);
    await sender.send({
      to: this.address,
      value: amount,
      body,
    });
  }
}
